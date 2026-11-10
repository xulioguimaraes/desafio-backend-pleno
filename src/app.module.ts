import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { AllExceptionsFilter } from './common/http/all-exceptions.filter';
import { LoggingModule } from './common/logging/logging.module';
import { APP_CONFIG, AppConfig } from './config/app-config';
import { ConfigModule } from './config/config.module';
import { EventsModule } from './events/events.module';
import { HealthController } from './health.controller';
import { MetricsModule } from './metrics/metrics.module';
import { ProcessingModule } from './processing/processing.module';
import { QueueModule } from './queue/queue.module';
import { TenancyModule } from './tenancy/tenancy.module';

@Module({
  imports: [
    ConfigModule,
    LoggingModule,
    MongooseModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        uri: config.mongoUri,
        // Falha rápido quando o Mongo está fora (→ 503) em vez de segurar a requisição.
        serverSelectionTimeoutMS: 5_000,
        // Índices únicos são a base da idempotência: precisam existir antes do tráfego.
        autoIndex: true,
        autoCreate: true,
      }),
    }),
    QueueModule,
    TenancyModule,
    EventsModule,
    MetricsModule,
    ProcessingModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
})
export class AppModule {}
