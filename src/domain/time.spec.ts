import { inclusiveDayCount, parseDay, parseOccurredAt, saoPauloDay } from './time';

describe('parseOccurredAt', () => {
  it('aceita ISO-8601 com offset ou Z', () => {
    expect(parseOccurredAt('2026-11-07T23:30:00-03:00')?.toISOString()).toBe(
      '2026-11-08T02:30:00.000Z',
    );
    expect(parseOccurredAt('2026-11-08T02:30:00Z')?.toISOString()).toBe(
      '2026-11-08T02:30:00.000Z',
    );
    expect(parseOccurredAt('2026-11-08T02:30:00.123+00:00')?.toISOString()).toBe(
      '2026-11-08T02:30:00.123Z',
    );
  });

  it('o mesmo instante em fusos diferentes resulta na mesma data', () => {
    expect(parseOccurredAt('2026-11-07T23:30:00-03:00')!.getTime()).toBe(
      parseOccurredAt('2026-11-08T02:30:00Z')!.getTime(),
    );
  });

  it.each([
    ['2026-11-07T23:30:00'], // sem fuso: o JS interpretaria no fuso do servidor
    ['2026-11-07'],
    ['2026-02-30T10:00:00Z'], // data impossível
    ['2026-11-07T25:00:00Z'],
    ['07/11/2026 23:30'],
    ['not a date'],
  ])('rejeita %p', (input) => {
    expect(parseOccurredAt(input)).toBeNull();
  });
});

describe('saoPauloDay', () => {
  it('C15: 23:50 em São Paulo (02:50 UTC do dia seguinte) conta no dia de São Paulo', () => {
    expect(saoPauloDay(new Date('2026-11-08T02:50:00Z'))).toBe('2026-11-07');
  });

  it('03:00 UTC já é o dia seguinte em São Paulo', () => {
    expect(saoPauloDay(new Date('2026-11-08T03:00:00Z'))).toBe('2026-11-08');
  });
});

describe('parseDay e inclusiveDayCount', () => {
  it('valida datas reais', () => {
    expect(parseDay('2026-11-01')).not.toBeNull();
    expect(parseDay('2026-02-30')).toBeNull();
    expect(parseDay('2026-11-1')).toBeNull();
    expect(parseDay(undefined)).toBeNull();
  });

  it('conta os dois extremos', () => {
    expect(inclusiveDayCount(parseDay('2026-11-01')!, parseDay('2026-11-01')!)).toBe(1);
    expect(inclusiveDayCount(parseDay('2026-10-01')!, parseDay('2026-10-31')!)).toBe(31);
    expect(inclusiveDayCount(parseDay('2026-10-01')!, parseDay('2026-11-01')!)).toBe(32);
  });
});
