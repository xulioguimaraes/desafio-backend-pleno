import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AppError } from '../common/errors/app-error';
import { formatCents } from '../domain/money';
import type { Tenant } from '../tenancy/tenant';
import { EventRecord } from './event.schema';

@Injectable()
export class GetEventUseCase {
  constructor(@InjectModel(EventRecord.name) private readonly events: Model<EventRecord>) {}

  async execute(tenant: Tenant, id: string) {
    // Escopo de empresa E país. Evento de outra empresa → 404 (não 403: não
    // revelamos que o id existe).
    const event = await this.events
      .findOne({ _id: id, company_id: tenant.companyId, country: tenant.country })
      .lean<EventRecord>();
    if (!event) throw AppError.eventNotFound();

    return {
      id: event._id,
      event_id: event.event_id,
      action: event.action,
      client_id: event.client_id,
      amount: event.amount_cents === null ? null : formatCents(event.amount_cents),
      occurred_at: event.occurred_at.toISOString(),
      metadata: event.metadata,
      status: event.status,
      attempts: event.attempts,
      last_error: event.last_error,
      created_at: event.created_at.toISOString(),
      processed_at: event.processed_at?.toISOString() ?? null,
    };
  }
}
