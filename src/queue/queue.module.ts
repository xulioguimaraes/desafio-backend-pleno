import { BullModule } from '@nestjs/bull';
import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { EVENTS_QUEUE, EventQueue } from './event-queue';

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        redis: { host: config.redisHost, port: config.redisPort },
      }),
    }),
    BullModule.registerQueue({ name: EVENTS_QUEUE }),
  ],
  providers: [EventQueue],
  exports: [EventQueue, BullModule],
})
export class QueueModule {}
