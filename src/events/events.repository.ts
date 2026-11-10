import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { ClientSession } from 'mongoose';
import { Model } from 'mongoose';
import type { EventStatus } from '../domain/event';
import type { Tenant } from '../tenancy/tenant';
import { EventRecord } from './event.schema';
import { EventFingerprint } from './fingerprint.schema';

export type NewEventRecord = Omit<
  EventRecord,
  'created_at' | 'updated_at' | 'attempts' | 'last_error' | 'lock_token' | 'locked_until' | 'processed_at' | 'status'
>;

export type EventSummary = Pick<EventRecord, '_id' | 'event_id' | 'payload_hash' | 'status'>;

const SUMMARY_FIELDS = { _id: 1, event_id: 1, payload_hash: 1, status: 1 } as const;

/**
 * Acesso a `events` e `event_fingerprints` no caminho do POST.
 * Toda leitura recebe o Tenant: não existe método sem escopo de empresa.
 */
@Injectable()
export class EventsRepository {
  constructor(
    @InjectModel(EventRecord.name) private readonly events: Model<EventRecord>,
    @InjectModel(EventFingerprint.name) private readonly fingerprints: Model<EventFingerprint>,
  ) {}

  /** Camada 1: busca pelo par (empresa, event_id). */
  findByEventId(tenant: Tenant, eventId: string): Promise<EventSummary | null> {
    return this.events
      .findOne({ company_id: tenant.companyId, event_id: eventId }, SUMMARY_FIELDS)
      .lean<EventSummary>();
  }

  findSummaryById(tenant: Tenant, id: string): Promise<EventSummary | null> {
    return this.events
      .findOne({ _id: id, company_id: tenant.companyId }, SUMMARY_FIELDS)
      .lean<EventSummary>();
  }

  /**
   * Camada 2: tenta reservar a impressão digital.
   *
   * O filtro só casa se o documento existir E estiver vencido. Então:
   *  - não existe            → upsert insere → reservado;
   *  - existe e venceu       → atualiza (toma a reserva) → reservado;
   *  - existe e está na janela → filtro não casa, upsert tenta inserir o mesmo
   *    _id → E11000. O chamador interpreta como DUPLICATE_CONTENT.
   *
   * É atômico no Mongo: com 50 requisições simultâneas, só uma reserva.
   */
  async reserveFingerprint(
    fingerprint: string,
    eventRef: string,
    now: Date,
    windowMs: number,
    session: ClientSession,
  ): Promise<void> {
    await this.fingerprints.updateOne(
      { _id: fingerprint, expires_at: { $lte: now } },
      { $set: { event_ref: eventRef, expires_at: new Date(now.getTime() + windowMs) } },
      { upsert: true, session },
    );
  }

  /** Quem está segurando a impressão digital agora (dentro da janela). */
  async findActiveFingerprintOwner(fingerprint: string, now: Date): Promise<string | null> {
    const doc = await this.fingerprints
      .findOne({ _id: fingerprint, expires_at: { $gt: now } }, { event_ref: 1 })
      .lean();
    return doc?.event_ref ?? null;
  }

  async insert(record: NewEventRecord, session: ClientSession): Promise<void> {
    await this.events.create([{ ...record, status: 'PENDING' satisfies EventStatus }], { session });
  }
}
