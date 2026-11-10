import { Inject, Injectable } from '@nestjs/common';
import { ActionStrategyRegistry } from '../actions/action-strategy.registry';
import { AppError } from '../common/errors/app-error';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import type { Metadata, NormalizedEvent } from '../domain/event';
import { parseAmountToCents } from '../domain/money';
import { parseOccurredAt } from '../domain/time';

const MAX_ID_LENGTH = 64;
const MAX_METADATA_KEYS = 10;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireId(body: Record<string, unknown>, field: 'event_id' | 'client_id'): string {
  const value = body[field];
  if (typeof value !== 'string' || value.length < 1 || value.length > MAX_ID_LENGTH) {
    throw AppError.invalidPayload(`${field} é obrigatório e deve ter de 1 a ${MAX_ID_LENGTH} caracteres.`);
  }
  return value;
}

/**
 * Validação manual (em vez de class-validator) porque o contrato exige códigos
 * de erro específicos por campo (INVALID_AMOUNT, INVALID_OCCURRED_AT) e regras
 * que dependem da action (amount obrigatório/proibido vem da strategy).
 *
 * Campos desconhecidos no body são ignorados (compatibilidade futura).
 */
@Injectable()
export class IngestEventValidator {
  constructor(
    private readonly strategies: ActionStrategyRegistry,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  validate(body: unknown, now: Date = new Date()): NormalizedEvent {
    if (!isPlainObject(body)) {
      throw AppError.invalidPayload('O corpo da requisição deve ser um objeto JSON.');
    }

    const eventId = requireId(body, 'event_id');
    const clientId = requireId(body, 'client_id');

    const action = body.action;
    const strategy = typeof action === 'string' ? this.strategies.find(action) : undefined;
    if (!strategy) {
      throw AppError.invalidPayload(
        `action inválida. Valores aceitos: ${this.strategies.actions().join(', ')}.`,
      );
    }

    return {
      eventId,
      action: strategy.action,
      clientId,
      amountCents: this.validateAmount(body.amount, strategy.requiresAmount, strategy.action),
      occurredAt: this.validateOccurredAt(body.occurred_at, now),
      metadata: this.validateMetadata(body.metadata),
    };
  }

  private validateAmount(amount: unknown, required: boolean, action: string): bigint | null {
    if (!required) {
      if (amount !== undefined) {
        throw AppError.invalidAmount(`amount não é permitido para a action ${action}.`);
      }
      return null;
    }

    if (typeof amount !== 'string') {
      throw AppError.invalidAmount(
        `amount é obrigatório para ${action} e deve ser uma string decimal (ex.: "19.74").`,
      );
    }
    const cents = parseAmountToCents(amount);
    if (cents === null) {
      throw AppError.invalidAmount(
        'amount deve ser um decimal maior que zero, com no máximo 2 casas (ex.: "19.74").',
      );
    }
    return cents;
  }

  private validateOccurredAt(value: unknown, now: Date): Date {
    const occurredAt = typeof value === 'string' ? parseOccurredAt(value) : null;
    if (!occurredAt) {
      throw AppError.invalidOccurredAt(
        'occurred_at deve ser uma data ISO-8601 com fuso (ex.: "2026-11-07T23:30:00-03:00").',
      );
    }
    if (occurredAt.getTime() > now.getTime() + this.config.maxFutureSkewMs) {
      throw AppError.invalidOccurredAt('occurred_at não pode estar mais de 5 minutos no futuro.');
    }
    return occurredAt;
  }

  private validateMetadata(value: unknown): Metadata | null {
    if (value === undefined || value === null) return null;
    if (!isPlainObject(value)) {
      throw AppError.invalidPayload('metadata deve ser um objeto.');
    }

    const keys = Object.keys(value);
    if (keys.length > MAX_METADATA_KEYS) {
      throw AppError.invalidPayload(`metadata aceita no máximo ${MAX_METADATA_KEYS} chaves.`);
    }

    for (const key of keys) {
      const v = value[key];
      const ok =
        v === null ||
        typeof v === 'string' ||
        typeof v === 'boolean' ||
        (typeof v === 'number' && Number.isFinite(v));
      if (!ok) {
        throw AppError.invalidPayload(
          `metadata.${key} deve ser string, número, booleano ou null.`,
        );
      }
      // Chaves com "$" ou "." são interpretadas como operadores/caminhos pelo Mongo.
      if (key.startsWith('$') || key.includes('.')) {
        throw AppError.invalidPayload(`metadata.${key}: chave inválida.`);
      }
    }
    return value as Metadata;
  }
}
