/**
 * Dinheiro trafega como string e é convertido para centavos INTEIROS
 * manipulando texto — nunca com parseFloat (19.99 * 100 = 1998.9999...).
 *
 * Formato aceito: inteiro sem zeros à esquerda + até 2 casas decimais.
 *   "19.7" | "19.70" | "0.50" | "100"   → válidos
 *   "019.70" | ".5" | "1e2" | "-1" | "19.745" | "0" | "0.00" → inválidos
 *
 * O limite de 13 dígitos inteiros mantém qualquer soma realista bem abaixo
 * de Number.MAX_SAFE_INTEGER, e os centavos são guardados como Int64 (Long)
 * no Mongo, não como double.
 */
const AMOUNT_PATTERN = /^(0|[1-9]\d{0,12})(?:\.(\d{1,2}))?$/;

export function parseAmountToCents(amount: string): bigint | null {
  const match = AMOUNT_PATTERN.exec(amount);
  if (!match) return null;

  const [, integerPart, fraction = ''] = match;
  const cents = BigInt(integerPart) * 100n + BigInt(fraction.padEnd(2, '0'));
  return cents > 0n ? cents : null;
}

/** 1970n → "19.70" */
export function formatCents(cents: bigint | number): string {
  const value = BigInt(cents);
  const sign = value < 0n ? '-' : '';
  const abs = value < 0n ? -value : value;
  const fraction = (abs % 100n).toString().padStart(2, '0');
  return `${sign}${abs / 100n}.${fraction}`;
}
