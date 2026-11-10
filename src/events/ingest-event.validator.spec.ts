import { ActionStrategyRegistry } from '../actions/action-strategy.registry';
import {
  BetPlacedStrategy,
  DepositConfirmedStrategy,
  LoginStrategy,
  WithdrawalApprovedStrategy,
} from '../actions/strategies';
import { AppError } from '../common/errors/app-error';
import { loadConfig } from '../config/app-config';
import { IngestEventValidator } from './ingest-event.validator';

const NOW = new Date('2026-11-08T03:00:00Z');

const validator = new IngestEventValidator(
  new ActionStrategyRegistry([
    new DepositConfirmedStrategy(),
    new WithdrawalApprovedStrategy(),
    new BetPlacedStrategy(),
    new LoginStrategy(),
  ]),
  loadConfig(),
);

function body(overrides: Record<string, unknown> = {}) {
  return {
    event_id: 'evt_01HZX9',
    action: 'DEPOSIT_CONFIRMED',
    client_id: 'c_42',
    amount: '19.74',
    occurred_at: '2026-11-07T23:30:00-03:00',
    metadata: { channel: 'pix' },
    ...overrides,
  };
}

function errorCode(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return (error as AppError).code;
  }
  return undefined;
}

describe('IngestEventValidator', () => {
  it('normaliza um evento válido', () => {
    expect(validator.validate(body(), NOW)).toEqual({
      eventId: 'evt_01HZX9',
      action: 'DEPOSIT_CONFIRMED',
      clientId: 'c_42',
      amountCents: 1974n,
      occurredAt: new Date('2026-11-08T02:30:00Z'),
      metadata: { channel: 'pix' },
    });
  });

  it('aceita LOGIN sem amount e sem metadata', () => {
    const result = validator.validate(
      body({ action: 'LOGIN', amount: undefined, metadata: undefined }),
      NOW,
    );
    expect(result.amountCents).toBeNull();
    expect(result.metadata).toBeNull();
  });

  describe('INVALID_PAYLOAD', () => {
    it.each([
      ['body não-objeto', () => validator.validate([], NOW)],
      ['body nulo', () => validator.validate(null, NOW)],
      ['sem event_id', () => validator.validate(body({ event_id: undefined }), NOW)],
      ['event_id vazio', () => validator.validate(body({ event_id: '' }), NOW)],
      ['event_id com 65 caracteres', () => validator.validate(body({ event_id: 'x'.repeat(65) }), NOW)],
      ['event_id numérico', () => validator.validate(body({ event_id: 123 }), NOW)],
      ['sem client_id', () => validator.validate(body({ client_id: undefined }), NOW)],
      ['action desconhecida', () => validator.validate(body({ action: 'REFUND' }), NOW)],
      ['action minúscula', () => validator.validate(body({ action: 'login' }), NOW)],
      ['metadata array', () => validator.validate(body({ metadata: ['a'] }), NOW)],
      ['metadata aninhado', () => validator.validate(body({ metadata: { a: { b: 1 } } }), NOW)],
      ['metadata com array', () => validator.validate(body({ metadata: { a: [1] } }), NOW)],
      ['metadata com chave $', () => validator.validate(body({ metadata: { $where: 'x' } }), NOW)],
      [
        'metadata com 11 chaves',
        () =>
          validator.validate(
            body({ metadata: Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`k${i}`, i])) }),
            NOW,
          ),
      ],
    ])('%s', (_, fn) => {
      expect(errorCode(fn)).toBe('INVALID_PAYLOAD');
    });

    it('aceita metadata com 10 chaves de tipos primitivos e null', () => {
      const metadata = {
        a: 's',
        b: 1,
        c: 1.5,
        d: true,
        e: null,
        f: 'x',
        g: 0,
        h: false,
        i: '',
        j: -1,
      };
      expect(validator.validate(body({ metadata }), NOW).metadata).toEqual(metadata);
    });
  });

  describe('INVALID_AMOUNT', () => {
    it.each([
      ['ausente em ação financeira', body({ amount: undefined })],
      ['número em vez de string', body({ amount: 19.74 })],
      ['zero', body({ amount: '0.00' })],
      ['negativo', body({ amount: '-5' })],
      ['3 casas decimais', body({ amount: '19.745' })],
      ['presente em LOGIN', body({ action: 'LOGIN', amount: '1.00' })],
      ['null em LOGIN', body({ action: 'LOGIN', amount: null })],
    ])('%s', (_, input) => {
      expect(errorCode(() => validator.validate(input, NOW))).toBe('INVALID_AMOUNT');
    });
  });

  describe('INVALID_OCCURRED_AT', () => {
    it.each([
      ['sem fuso', body({ occurred_at: '2026-11-07T23:30:00' })],
      ['ausente', body({ occurred_at: undefined })],
      ['data impossível', body({ occurred_at: '2026-02-30T10:00:00Z' })],
      ['mais de 5 min no futuro', body({ occurred_at: '2026-11-08T03:05:01Z' })],
    ])('%s', (_, input) => {
      expect(errorCode(() => validator.validate(input, NOW))).toBe('INVALID_OCCURRED_AT');
    });

    it('aceita até 5 minutos no futuro', () => {
      expect(() => validator.validate(body({ occurred_at: '2026-11-08T03:05:00Z' }), NOW)).not.toThrow();
    });
  });
});
