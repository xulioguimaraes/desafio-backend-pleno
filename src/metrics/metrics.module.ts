import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MetricsController } from './metrics.controller';
import { MetricsQueries } from './metrics.queries';
import { MetricsRepository } from './metrics.repository';
import {
  ClientKpiState,
  ClientKpiStateSchema,
  ReportDaily,
  ReportDailyClient,
  ReportDailyClientSchema,
  ReportDailySchema,
} from './metrics.schemas';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ClientKpiState.name, schema: ClientKpiStateSchema },
      { name: ReportDaily.name, schema: ReportDailySchema },
      { name: ReportDailyClient.name, schema: ReportDailyClientSchema },
    ]),
  ],
  controllers: [MetricsController],
  providers: [MetricsRepository, MetricsQueries],
  exports: [MetricsRepository],
})
export class MetricsModule {}
