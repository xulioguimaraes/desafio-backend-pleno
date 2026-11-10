import { Module } from '@nestjs/common';
import { ActionsModule } from '../actions/actions.module';
import { EventsModule } from '../events/events.module';
import { MetricsModule } from '../metrics/metrics.module';
import { EventWorker } from './event.worker';
import { ProcessEventUseCase } from './process-event.use-case';
import { RecoveryService } from './recovery.service';

@Module({
  imports: [ActionsModule, EventsModule, MetricsModule],
  providers: [ProcessEventUseCase, EventWorker, RecoveryService],
  exports: [ProcessEventUseCase, RecoveryService],
})
export class ProcessingModule {}
