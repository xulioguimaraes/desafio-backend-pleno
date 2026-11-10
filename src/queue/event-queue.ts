import { InjectQueue } from '@nestjs/bull';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { JobOptions, Queue } from 'bull';
import { APP_CONFIG, AppConfig } from '../config/app-config';

export const EVENTS_QUEUE = 'events';
export const PROCESS_EVENT_JOB = 'process-event';

export interface ProcessEventJobData {
  eventId: string;
}

/**
 * Enfileiramento. A fila é só um "gatilho": a fonte da verdade do estado do
 * evento é o Mongo. Se o Redis falhar, o evento continua PENDING e a varredura
 * de recuperação enfileira depois.
 */
@Injectable()
export class EventQueue {
  private readonly logger = new Logger(EventQueue.name);

  constructor(
    @InjectQueue(EVENTS_QUEUE) private readonly queue: Queue<ProcessEventJobData>,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private jobOptions(eventId: string): JobOptions {
    return {
      // jobId = id do evento: o Bull ignora um add com jobId que já está na fila,
      // então reenfileirar (varredura, várias instâncias) não duplica jobs.
      jobId: eventId,
      attempts: this.config.maxAttempts,
      backoff: { type: 'exponential', delay: this.config.backoffDelayMs },
      // Pegadinha: se jobs concluídos/falhos ficassem guardados, um novo add com o
      // mesmo jobId seria ignorado em silêncio e a recuperação nunca reprocessaria.
      removeOnComplete: true,
      removeOnFail: true,
    };
  }

  /**
   * Retorna true se enfileirou. Nunca lança: com o Redis fora, o ioredis
   * segura comandos na fila offline indefinidamente, então limitamos a espera.
   */
  async enqueue(eventId: string): Promise<boolean> {
    return this.enqueueMany([eventId]).then((n) => n === 1);
  }

  async enqueueMany(eventIds: string[]): Promise<number> {
    if (eventIds.length === 0) return 0;
    const jobs = eventIds.map((eventId) => ({
      name: PROCESS_EVENT_JOB,
      data: { eventId },
      opts: this.jobOptions(eventId),
    }));

    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('timeout ao enfileirar no Redis')),
        this.config.enqueueTimeoutMs,
      );
    });

    try {
      await Promise.race([this.queue.addBulk(jobs), timeout]);
      return eventIds.length;
    } catch (error) {
      this.logger.warn(
        { err_message: (error as Error).message, count: eventIds.length },
        'falha ao enfileirar; a varredura de recuperação vai reenfileirar',
      );
      return 0;
    } finally {
      clearTimeout(timer);
    }
  }
}
