import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { randomUUID } from 'node:crypto';
import type { Connection } from 'mongoose';
import { Model } from 'mongoose';
import { ActionStrategyRegistry } from '../actions/action-strategy.registry';
import { runInTransaction } from '../common/mongo/transaction';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { EventRecord } from '../events/event.schema';
import { MetricsRepository } from '../metrics/metrics.repository';

export type ProcessOutcome = 'PROCESSED' | 'FAILED' | 'SKIPPED';

/** Outro worker assumiu o evento (nossa posse venceu). Não é falha: só paramos. */
class LeaseLostError extends Error {}

function toBigIntOrNull(value: unknown): bigint | null {
  if (value === null || value === undefined) return null;
  return BigInt(String(value)); // aceita number, bigint e Long
}

const MAX_ERROR_LENGTH = 500;

/**
 * Camada 3 — efeito exatamente uma vez.
 *
 *  1. CLAIM atômico (findOneAndUpdate): só um worker consegue passar o evento
 *     para PROCESSING com o seu lock_token e um prazo de posse (locked_until).
 *     Outro worker com o mesmo evento (C13) recebe null e sai sem fazer nada.
 *  2. Numa TRANSAÇÃO: marca PROCESSED (condicionado ao lock_token) e aplica as
 *     métricas. Se o job morrer no meio (C12), a transação aborta e NADA foi
 *     aplicado; a reexecução aplica tudo uma vez. Como a mudança de status está
 *     na mesma transação das métricas, não existe "métrica aplicada mas evento
 *     ainda PENDING".
 *  3. Falhou? Devolve para PENDING (o Bull tenta de novo com backoff) ou, na
 *     última tentativa, marca FAILED com o motivo.
 */
@Injectable()
export class ProcessEventUseCase {
  private readonly logger = new Logger(ProcessEventUseCase.name);

  constructor(
    @InjectModel(EventRecord.name) private readonly events: Model<EventRecord>,
    @InjectConnection() private readonly connection: Connection,
    private readonly metrics: MetricsRepository,
    private readonly strategies: ActionStrategyRegistry,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async execute(eventId: string): Promise<ProcessOutcome> {
    const startedAt = Date.now();
    const token = randomUUID();
    const event = await this.claim(eventId, token);
    if (!event) return 'SKIPPED';

    const log = { company_code: event.company_code, event_id: event.event_id, id: event._id };

    const strategy = this.strategies.find(event.action);
    if (!strategy) {
      // Erro permanente: tentar de novo não resolve.
      await this.finish(eventId, token, 'FAILED', `strategy não encontrada para ${event.action}`);
      this.logger.error({ ...log, latency_ms: Date.now() - startedAt }, 'evento FAILED');
      return 'FAILED';
    }

    try {
      await runInTransaction(this.connection, async (session) => {
        const marked = await this.events.updateOne(
          { _id: eventId, status: 'PROCESSING', lock_token: token },
          {
            $set: {
              status: 'PROCESSED',
              processed_at: new Date(),
              lock_token: null,
              locked_until: null,
              last_error: null,
            },
          },
          { session },
        );
        if (marked.modifiedCount !== 1) throw new LeaseLostError();

        const contribution = strategy.contribution({
          amountCents: toBigIntOrNull(event.amount_cents),
        });
        await this.metrics.applyEvent(event, contribution, session);
      });
    } catch (error) {
      if (error instanceof LeaseLostError) {
        this.logger.warn(log, 'posse do evento perdida para outro worker; ignorando');
        return 'SKIPPED';
      }

      const reason = ((error as Error).message || 'erro desconhecido').slice(0, MAX_ERROR_LENGTH);
      const latency_ms = Date.now() - startedAt;

      if (event.attempts >= this.config.maxAttempts) {
        await this.finish(eventId, token, 'FAILED', reason);
        this.logger.error({ ...log, attempts: event.attempts, reason, latency_ms }, 'evento FAILED');
        return 'FAILED';
      }

      await this.finish(eventId, token, 'PENDING', reason);
      this.logger.warn({ ...log, attempts: event.attempts, reason, latency_ms }, 'falha; vai tentar de novo');
      throw error; // o Bull agenda a próxima tentativa com backoff exponencial
    }

    this.logger.log(
      { ...log, attempts: event.attempts, latency_ms: Date.now() - startedAt },
      'evento PROCESSED',
    );
    return 'PROCESSED';
  }

  /**
   * Assume o evento se ele estiver PENDING, ou PROCESSING com posse vencida
   * (worker morreu). Incrementa attempts a cada posse.
   */
  private claim(eventId: string, token: string) {
    const now = new Date();
    return this.events
      .findOneAndUpdate(
        {
          _id: eventId,
          status: { $in: ['PENDING', 'PROCESSING'] },
          $or: [{ locked_until: null }, { locked_until: { $lte: now } }],
        },
        {
          $set: {
            status: 'PROCESSING',
            lock_token: token,
            locked_until: new Date(now.getTime() + this.config.processingLeaseMs),
          },
          $inc: { attempts: 1 },
        },
        { new: true },
      )
      .lean<EventRecord>();
  }

  /** Libera a posse, só se ainda for nossa. */
  private async finish(
    eventId: string,
    token: string,
    status: 'PENDING' | 'FAILED',
    reason: string,
  ): Promise<void> {
    await this.events.updateOne(
      { _id: eventId, status: 'PROCESSING', lock_token: token },
      { $set: { status, last_error: reason, lock_token: null, locked_until: null } },
    );
  }
}
