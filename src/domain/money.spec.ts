import { formatCents, parseAmountToCents } from './money';

describe('parseAmountToCents', () => {
  it.each([
    ['19.74', 1974n],
    ['19.7', 1970n],
    ['19.70', 1970n],
    ['0.01', 1n],
    ['0.5', 50n],
    ['100', 10000n],
    ['9999999999999.99', 999999999999999n],
  ])('converte %s em %s centavos', (input, expected) => {
    expect(parseAmountToCents(input)).toBe(expected);
  });

  it('não sofre com imprecisão de ponto flutuante (19.99 * 100 = 1998.9999...)', () => {
    expect(parseAmountToCents('19.99')).toBe(1999n);
    expect(parseAmountToCents('0.29')).toBe(29n);
    expect(parseAmountToCents('1.15')).toBe(115n);
  });

  it('"19.7" e "19.70" são o mesmo valor', () => {
    expect(parseAmountToCents('19.7')).toBe(parseAmountToCents('19.70'));
  });

  it.each([
    ['0'],
    ['0.00'],
    ['-1'],
    ['19.745'],
    ['1e2'],
    ['.5'],
    ['5.'],
    ['019.70'],
    [' 19.70'],
    ['19,70'],
    ['abc'],
    [''],
    ['10000000000000'], // 14 dígitos inteiros
  ])('rejeita %p', (input) => {
    expect(parseAmountToCents(input)).toBeNull();
  });
});

describe('formatCents', () => {
  it('formata centavos inteiros como decimal com 2 casas', () => {
    expect(formatCents(1970n)).toBe('19.70');
    expect(formatCents(1)).toBe('0.01');
    expect(formatCents(10000)).toBe('100.00');
  });
});
