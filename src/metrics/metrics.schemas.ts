import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, Types } from 'mongoose';

/**
 * Os três schemas existem para declarar coleções e índices. As escritas usam
 * o driver nativo (MetricsRepository) porque os caminhos são dinâmicos
 * (`actions.<ACTION>.count`) e precisamos de $inc/$min/$max atômicos.
 *
 * Formato de `actions`:
 *   { DEPOSIT_CONFIRMED: { count, total_cents (Int64), first_at, last_at }, ... }
 */

@Schema({ collection: 'client_kpi_state', versionKey: false })
export class ClientKpiState {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  company_id: Types.ObjectId;

  @Prop({ required: true })
  country: string;

  @Prop({ required: true })
  client_id: string;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  actions: Record<string, ActionKpi>;

  @Prop({ type: Date })
  updated_at: Date;
}

export interface ActionKpi {
  count: number;
  total_cents: number | bigint;
  first_at: Date;
  last_at: Date;
}

export const ClientKpiStateSchema = SchemaFactory.createForClass(ClientKpiState);
// Um documento por (empresa, país, cliente). Sustenta o upsert do worker e o
// GET /v1/clients/:clientId/metrics. Único: impede dois documentos para o mesmo cliente.
ClientKpiStateSchema.index(
  { company_id: 1, country: 1, client_id: 1 },
  { unique: true, name: 'uniq_company_country_client' },
);

@Schema({ collection: 'report_daily', versionKey: false })
export class ReportDaily {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  company_id: Types.ObjectId;

  @Prop({ required: true })
  country: string;

  /** YYYY-MM-DD no fuso America/Sao_Paulo. */
  @Prop({ required: true })
  day: string;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  actions: Record<string, { count: number; total_cents: number | bigint }>;

  @Prop({ default: 0 })
  unique_clients: number;
}

export const ReportDailySchema = SchemaFactory.createForClass(ReportDaily);
// Um documento por (empresa, país, dia). Também atende o range de dias do relatório.
ReportDailySchema.index(
  { company_id: 1, country: 1, day: 1 },
  { unique: true, name: 'uniq_company_country_day' },
);

/** Marca "este cliente já apareceu neste dia" para contar clientes únicos. */
@Schema({ collection: 'report_daily_clients', versionKey: false })
export class ReportDailyClient {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  company_id: Types.ObjectId;

  @Prop({ required: true })
  country: string;

  @Prop({ required: true })
  day: string;

  @Prop({ required: true })
  client_id: string;
}

export const ReportDailyClientSchema = SchemaFactory.createForClass(ReportDailyClient);
ReportDailyClientSchema.index(
  { company_id: 1, country: 1, day: 1, client_id: 1 },
  { unique: true, name: 'uniq_company_country_day_client' },
);
