import type { NormalizedEvent } from './event';
import { computeFingerprint, computePayloadHash } from './fingerprint';
import { parseAmountToCents } from './money';
import { parseOccurredAt } from './time';

const COMPANY = '665f1c2b9a1e4b0012345678';

function event(overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return {
    eventId: 'evt_1',
    action: 'DEPOSIT_CONFIRMED',
    clientId: 'c_42',
    amountCents: parseAmountToCents('19.7'),
    occurredAt: parseOccurredAt('2026-11-07T23:30:00-03:00')!,
    metadata: { channel: 'pix' },
    ...overrides,
  };
}

describe('computeFingerprint (camada 2)', () => {
  it('C7: "19.7" vs "19.70" e o mesmo instante em fusos diferentes geram a mesma impressão digital', () => {
    const a = event();
    const b = event({
      amountCents: parseAmountToCents('19.70'),
      occurredAt: parseOccurredAt('2026-11-08T02:30:00Z')!,
    });
    expect(computeFingerprint(COMPANY, 'BR', a)).toBe(computeFingerprint(COMPANY, 'BR', b));
  });

  it('ignora event_id e metadata', () => {
    const a = event();
    const b = event({ eventId: 'evt_outro', metadata: { channel: 'ted', extra: true } });
    expect(computeFingerprint(COMPANY, 'BR', a)).toBe(computeFingerprint(COMPANY, 'BR', b));
  });

  it('C8: LOGIN sem amount gera impressão digital estável', () => {
    const login = event({ action: 'LOGIN', amountCents: null });
    expect(computeFingerprint(COMPANY, 'BR', login)).toBe(
      computeFingerprint(COMPANY, 'BR', { ...login }),
    );
  });

  it.each([
    ['empresa', () => computeFingerprint('665f1c2b9a1e4b0099999999', 'BR', event())],
    ['país', () => computeFingerprint(COMPANY, 'AR', event())],
    ['cliente', () => computeFingerprint(COMPANY, 'BR', event({ clientId: 'c_43' }))],
    ['action', () => computeFingerprint(COMPANY, 'BR', event({ action: 'BET_PLACED' }))],
    ['amount', () => computeFingerprint(COMPANY, 'BR', event({ amountCents: 1971n }))],
    [
      'occurred_at',
      () =>
        computeFingerprint(COMPANY, 'BR', event({ occurredAt: new Date('2026-11-08T02:30:01Z') })),
    ],
  ])('muda quando muda %s', (_, other) => {
    expect(other()).not.toBe(computeFingerprint(COMPANY, 'BR', event()));
  });

  it('não colide quando um campo contém o separador', () => {
    const a = computeFingerprint(COMPANY, 'BR', event({ clientId: 'a|DEPOSIT_CONFIRMED' }));
    const b = computeFingerprint(COMPANY, 'BR', event({ clientId: 'a' }));
    expect(a).not.toBe(b);
  });
});

describe('computePayloadHash (camada 1)', () => {
  it('é igual para o mesmo conteúdo normalizado, com metadata em outra ordem', () => {
    const a = event({ metadata: { a: 1, b: 'x' } });
    const b = event({ amountCents: parseAmountToCents('19.70'), metadata: { b: 'x', a: 1 } });
    expect(computePayloadHash('BR', a)).toBe(computePayloadHash('BR', b));
  });

  it('muda com amount diferente (C3)', () => {
    expect(computePayloadHash('BR', event({ amountCents: 2000n }))).not.toBe(
      computePayloadHash('BR', event()),
    );
  });

  it('inclui país e metadata', () => {
    expect(computePayloadHash('AR', event())).not.toBe(computePayloadHash('BR', event()));
    expect(computePayloadHash('BR', event({ metadata: { channel: 'ted' } }))).not.toBe(
      computePayloadHash('BR', event()),
    );
  });
});
