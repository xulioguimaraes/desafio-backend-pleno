import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ActionsModule } from '../actions/actions.module';
import { EventRecord, EventSchema } from './event.schema';
import { EventsController } from './events.controller';
import { EventsRepository } from './events.repository';
import { EventFingerprint, EventFingerprintSchema } from './fingerprint.schema';
import { GetEventUseCase } from './get-event.use-case';
import { IngestEventUseCase } from './ingest-event.use-case';
import { IngestEventValidator } from './ingest-event.validator';

@Module({
  imports: [
    ActionsModule,
    MongooseModule.forFeature([
      { name: EventRecord.name, schema: EventSchema },
      { name: EventFingerprint.name, schema: EventFingerprintSchema },
    ]),
  ],
  controllers: [EventsController],
  providers: [IngestEventValidator, EventsRepository, IngestEventUseCase, GetEventUseCase],
  exports: [MongooseModule, EventsRepository],
})
export class EventsModule {}
