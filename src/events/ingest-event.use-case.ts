import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { randomUUID } from 'node:crypto';
import type { Connection } from 'mongoose';
import { AppError } from '../common/errors/app-error';
import { isDuplicateKeyError } from '../common/mongo/mongo-errors';
import { runInTransaction } from '../common/mongo/transaction';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import type { EventStatus, NormalizedEvent } from '../domain/event';
import { computeFingerprint, computePayloadHash } from '../domain/fingerprint';
import { EventQueue } from '../queue/event-queue';
import type { Tenant } from '../tenancy/tenant';
import { EventsRepository, EventSummary } from './events.repository';
import { IngestEventValidator } from './ingest-event.validator';

export type DuplicateReason = 'DUPLICATE_EVENT_ID' | 'DUPLICATE_CONTENT';

export type IngestResult =
  | { kind: 'accepted'; id: string; status: EventStatus }
  | { kind: 'duplicate'; id: string; status: EventStatus; reason: DuplicateReason };

/** Quantas vezes refazemos o fluxo se uma corrida terminar num estado intermediário. */
const MAX_RACE_RETRIES = 3;

/**
 * POST /v1/events — camadas 1 e 2 de idempotência.
 *
 *  1. Camada 1 (caminho rápido): (empresa, event_id) já existe? → 200 ou 409.
 *  2. Numa ÚNICA transação: reserva a impressão digital e insere o evento.
 *     - Os dois índices únicos (fingerprint _id e company_id+event_id) são quem
 *       decide corridas. Não há lock em memória: funciona com N instâncias.
 *     - Se a inserção do evento falhar depois da reserva (C10), a transação é
 *       abortada e a reserva some junto. Nada fica "órfão" bloqueando a janela.
 *  3. Depois do commit, enfileira. Se o Redis estiver fora (C16), responde 202
 *     mesmo assim: o evento está salvo como PENDING e a varredura enfileira depois.
 */
@Injectable()
export class IngestEventUseCase {
  private readonly logger = new Logger(IngestEventUseCase.name);

  constructor(
    private readonly validator: IngestEventValidator,
    private readonly repository: EventsRepository,
    private readonly queue: EventQueue,
    @InjectConnection() private readonly connection: Connection,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async execute(tenant: Tenant, body: unknown): Promise<IngestResult> {
    const event = this.validator.validate(body);
    const payloadHash = computePayloadHash(tenant.country, event);
    const fingerprint = computeFingerprint(tenant.companyId.toHexString(), tenant.country, event);

    for (let attempt = 1; attempt <= MAX_RACE_RETRIES; attempt++) {
      const result = await this.tryIngest(tenant, event, payloadHash, fingerprint);
      if (result) {
        // company_code e event_id já entram via customProps do pino-http.
        this.logger.log(
          {
            id: result.id,
            outcome: result.kind === 'accepted' ? 'ACCEPTED' : result.reason,
          },
          'evento recebido',
        );
        return result;
      }
    }
    // Só acontece se o estado mudar continuamente entre leituras; o cliente pode reenviar.
    throw new Error('não foi possível resolver a corrida de idempotência');
  }

  /** Retorna null quando a corrida terminou num estado intermediário e vale tentar de novo. */
  private async tryIngest(
    tenant: Tenant,
    event: NormalizedEvent,
    payloadHash: string,
    fingerprint: string,
  ): Promise<IngestResult | null> {
    // Camada 1 — caminho rápido (a garantia real é o índice único, abaixo).
    const existing = await this.repository.findByEventId(tenant, event.eventId);
    if (existing) return this.sameEventId(existing, payloadHash);

    const id = randomUUID();
    try {
      await runInTransaction(this.connection, async (session) => {
        const now = new Date();
        await this.repository.reserveFingerprint(
          fingerprint,
          id,
          now,
          this.config.dedupWindowMs,
          session,
        );
        await this.repository.insert(
          {
            _id: id,
            company_id: tenant.companyId,
            company_code: tenant.companyCode,
            country: tenant.country,
            event_id: event.eventId,
            action: event.action,
            client_id: event.clientId,
            amount_cents: event.amountCents,
            occurred_at: event.occurredAt,
            metadata: event.metadata,
            payload_hash: payloadHash,
            fingerprint,
          },
          session,
        );
      });
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      return this.resolveConflict(tenant, event, payloadHash, fingerprint);
    }

    await this.queue.enqueue(id);
    return { kind: 'accepted', id, status: 'PENDING' };
  }

  /**
   * Perdemos uma corrida (E11000). Descobrimos contra quem:
   *  - alguém gravou o MESMO event_id → camada 1 (C2: 49 × DUPLICATE_EVENT_ID);
   *  - alguém reservou a MESMA impressão digital → camada 2 (C5).
   */
  private async resolveConflict(
    tenant: Tenant,
    event: NormalizedEvent,
    payloadHash: string,
    fingerprint: string,
  ): Promise<IngestResult | null> {
    const sameId = await this.repository.findByEventId(tenant, event.eventId);
    if (sameId) return this.sameEventId(sameId, payloadHash);

    const ownerId = await this.repository.findActiveFingerprintOwner(fingerprint, new Date());
    if (ownerId) {
      const original = await this.repository.findSummaryById(tenant, ownerId);
      if (original) {
        return {
          kind: 'duplicate',
          id: original._id,
          status: original.status,
          reason: 'DUPLICATE_CONTENT',
        };
      }
    }
    // A reserva venceu entre o erro e a leitura: tenta o fluxo de novo.
    return null;
  }

  private sameEventId(existing: EventSummary, payloadHash: string): IngestResult {
    if (existing.payload_hash !== payloadHash) throw AppError.idempotencyConflict();
    return {
      kind: 'duplicate',
      id: existing._id,
      status: existing.status,
      reason: 'DUPLICATE_EVENT_ID',
    };
  }
}
