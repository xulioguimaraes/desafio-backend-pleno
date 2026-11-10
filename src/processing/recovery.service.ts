import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { EventRecord } from '../events/event.schema';
import { EventQueue } from '../queue/event-queue';

const SWEEP_BATCH_SIZE = 500;

/**
 * Recupera eventos presos, usando o MONGO como fonte da verdade:
 *  - PENDING antigo: o enfileiramento falhou (Redis fora no POST, C16) ou o job
 *    se perdeu (Redis reiniciou sem persistir);
 *  - PROCESSING com posse vencida: o worker morreu no meio.
 *
 * Reenfileirar é seguro: o jobId evita job duplicado na fila e o claim +
 * transação do worker evitam efeito duplicado. Pode rodar em todas as
 * instâncias ao mesmo tempo sem coordenação.
 */
@Injectable()
export class RecoveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RecoveryService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @InjectModel(EventRecord.name) private readonly events: Model<EventRecord>,
    private readonly queue: EventQueue,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    if (this.config.recoveryIntervalMs <= 0) return;
    this.timer = setInterval(() => void this.tick(), this.config.recoveryIntervalMs);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running) return; // evita varreduras sobrepostas na mesma instância
    this.running = true;
    try {
      await this.sweep();
    } catch (error) {
      this.logger.warn({ err_message: (error as Error).message }, 'varredura falhou');
    } finally {
      this.running = false;
    }
  }

  /** Público para os testes chamarem diretamente. Retorna quantos foram reenfileirados. */
  async sweep(now: Date = new Date()): Promise<{ requeued: number; failed: number }> {
    // Worker morreu na última tentativa: não há mais tentativas, vira FAILED.
    const exhausted = await this.events.updateMany(
      { status: 'PROCESSING', locked_until: { $lte: now }, attempts: { $gte: this.config.maxAttempts } },
      {
        $set: {
          status: 'FAILED',
          last_error: 'processamento interrompido (worker parou) e tentativas esgotadas',
          lock_token: null,
          locked_until: null,
        },
      },
    );

    const pendingBefore = new Date(now.getTime() - this.config.recoveryPendingAgeMs);
    const stuck = await this.events
      .find(
        {
          $or: [
            { status: 'PENDING', updated_at: { $lte: pendingBefore } },
            { status: 'PROCESSING', locked_until: { $lte: now } },
          ],
        },
        { _id: 1 },
      )
      .limit(SWEEP_BATCH_SIZE)
      .lean<{ _id: string }[]>();

    // Um único addBulk para o lote (sem N+1 no Redis).
    const requeued = await this.queue.enqueueMany(stuck.map((e) => e._id));

    if (requeued > 0 || exhausted.modifiedCount > 0) {
      this.logger.log(
        { requeued, failed: exhausted.modifiedCount },
        'varredura de recuperação',
      );
    }
    return { requeued, failed: exhausted.modifiedCount };
  }
}
