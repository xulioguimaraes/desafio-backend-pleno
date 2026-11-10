import { HttpStatus } from '@nestjs/common';

export type ErrorCode =
  | 'UNAUTHORIZED'
  | 'INVALID_PAYLOAD'
  | 'INVALID_AMOUNT'
  | 'INVALID_OCCURRED_AT'
  | 'IDEMPOTENCY_CONFLICT'
  | 'EVENT_NOT_FOUND'
  | 'CLIENT_NOT_FOUND'
  | 'INVALID_DATE_RANGE'
  | 'NOT_FOUND'
  | 'PAYLOAD_TOO_LARGE'
  | 'SERVICE_UNAVAILABLE'
  | 'INTERNAL_ERROR';

/**
 * Erro de aplicação já no formato do contrato: { code, message }.
 * Toda camada lança AppError; o filtro HTTP só traduz para resposta.
 */
export class AppError extends Error {
  constructor(
    readonly status: HttpStatus,
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }

  static invalidPayload(message: string) {
    return new AppError(HttpStatus.BAD_REQUEST, 'INVALID_PAYLOAD', message);
  }

  static invalidAmount(message: string) {
    return new AppError(HttpStatus.BAD_REQUEST, 'INVALID_AMOUNT', message);
  }

  static invalidOccurredAt(message: string) {
    return new AppError(HttpStatus.BAD_REQUEST, 'INVALID_OCCURRED_AT', message);
  }

  static invalidDateRange(message: string) {
    return new AppError(HttpStatus.BAD_REQUEST, 'INVALID_DATE_RANGE', message);
  }

  static unauthorized() {
    return new AppError(
      HttpStatus.UNAUTHORIZED,
      'UNAUTHORIZED',
      'Credenciais inválidas ou ausentes.',
    );
  }

  static idempotencyConflict() {
    return new AppError(
      HttpStatus.CONFLICT,
      'IDEMPOTENCY_CONFLICT',
      'Já existe um evento com este event_id e conteúdo diferente.',
    );
  }

  static eventNotFound() {
    return new AppError(HttpStatus.NOT_FOUND, 'EVENT_NOT_FOUND', 'Evento não encontrado.');
  }

  static clientNotFound() {
    return new AppError(
      HttpStatus.NOT_FOUND,
      'CLIENT_NOT_FOUND',
      'Nenhuma métrica encontrada para este cliente.',
    );
  }
}
