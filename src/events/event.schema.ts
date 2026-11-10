import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, Types } from 'mongoose';
import { EVENT_STATUSES, EventStatus, Metadata } from '../domain/event';

@Schema({
  collection: 'events',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  versionKey: false,
})
export class EventRecord {
  /** UUID interno, gerado pela API (é o `id` das respostas). */
  @Prop({ type: String, required: true })
  _id: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  company_id: Types.ObjectId;

  @Prop({ required: true })
  company_code: string;

  @Prop({ required: true })
  country: string;

  /** Id gerado pelo operador. Único por empresa, para sempre (camada 1). */
  @Prop({ required: true })
  event_id: string;

  @Prop({ required: true })
  action: string;

  @Prop({ required: true })
  client_id: string;

  /** Centavos como Int64 (BigInt → Long no BSON). Nunca double. */
  @Prop({ type: MongooseSchema.Types.BigInt, default: null })
  amount_cents: bigint | null;

  @Prop({ type: Date, required: true })
  occurred_at: Date;

  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  metadata: Metadata | null;

  /** Hash do conteúdo para comparar reenvios do mesmo event_id. */
  @Prop({ required: true })
  payload_hash: string;

  @Prop({ required: true })
  fingerprint: string;

  @Prop({ type: String, enum: EVENT_STATUSES, required: true, default: 'PENDING' })
  status: EventStatus;

  /** Quantas vezes um worker iniciou o processamento. */
  @Prop({ default: 0 })
  attempts: number;

  @Prop({ type: String, default: null })
  last_error: string | null;

  /** Token do worker que possui o evento enquanto PROCESSING. */
  @Prop({ type: String, default: null })
  lock_token: string | null;

  /** Até quando a posse vale. Depois disso, outro worker pode assumir. */
  @Prop({ type: Date, default: null })
  locked_until: Date | null;

  @Prop({ type: Date, default: null })
  processed_at: Date | null;

  created_at: Date;
  updated_at: Date;
}

export const EventSchema = SchemaFactory.createForClass(EventRecord);

// Camada 1: (empresa, event_id) único para sempre. Garante idempotência mesmo com
// requisições simultâneas e sem depender do Redis.
EventSchema.index({ company_id: 1, event_id: 1 }, { unique: true, name: 'uniq_company_event_id' });

// GET /v1/events/:id é por _id (índice padrão) + filtro de empresa/país.

// Varredura de recuperação: PENDING antigos e PROCESSING com posse vencida.
EventSchema.index({ status: 1, updated_at: 1 }, { name: 'recovery_status_updated_at' });
