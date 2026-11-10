import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

/**
 * Reserva de impressão digital (camada 2).
 *
 * Um documento por impressão digital (_id = hash, que já inclui empresa e país).
 * `expires_at` define a janela: a reserva só bloqueia enquanto expires_at > agora.
 * Depois disso, o próximo evento igual "toma" o documento (ver repositório).
 *
 * O índice TTL é só limpeza: o Mongo remove documentos vencidos a cada ~60s,
 * então a janela NUNCA depende dele — a comparação com expires_at é feita na query.
 */
@Schema({ collection: 'event_fingerprints', versionKey: false })
export class EventFingerprint {
  @Prop({ type: String, required: true })
  _id: string;

  /** id interno (uuid) do evento que reservou a impressão digital. */
  @Prop({ required: true })
  event_ref: string;

  @Prop({ type: Date, required: true })
  expires_at: Date;
}

export const EventFingerprintSchema = SchemaFactory.createForClass(EventFingerprint);

EventFingerprintSchema.index(
  { expires_at: 1 },
  { expireAfterSeconds: 60, name: 'ttl_cleanup_expires_at' },
);
