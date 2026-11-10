import { InjectQueue } from '@nestjs/bull';
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Job, Queue } from 'bull';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { EVENTS_QUEUE, PROCESS_EVENT_JOB, ProcessEventJobData } from '../queue/event-queue';
import { ProcessEventUseCase } from './process-event.use-case';

/**
 * Consumidor Bull. Só traduz job → use-case; não conhece actions nem métricas.
 *
 * Registrado com queue.process() (e não com o decorator @Process) para que a
 * concorrência venha do ambiente em tempo de execução (QUEUE_CONCURRENCY).
 */
@Injectable()
export class EventWorker implements OnModuleInit {
  private readonly logger = new Logger(EventWorker.name);

  constructor(
    @InjectQueue(EVENTS_QUEUE) private readonly queue: Queue<ProcessEventJobData>,
    private readonly processEvent: ProcessEventUseCase,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    void this.queue.process(PROCESS_EVENT_JOB, this.config.queueConcurrency, (job) =>
      this.handle(job),
    );
    this.logger.log({ concurrency: this.config.queueConcurrency }, 'worker iniciado');
  }

  private handle(job: Job<ProcessEventJobData>) {
    return this.processEvent.execute(job.data.eventId);
  }
}
