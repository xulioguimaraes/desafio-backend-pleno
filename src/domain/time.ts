import { DateTime } from 'luxon';

export const REPORT_TIMEZONE = 'America/Sao_Paulo';

/**
 * ISO-8601 COM fuso obrigatório (Z ou ±HH:MM).
 *
 * Pegadinha: `new Date("2026-11-07T23:30:00")` é aceito pelo JS e interpretado
 * no fuso do servidor. Por isso exigimos o offset pela regex antes de parsear,
 * e o Luxon rejeita datas impossíveis (ex.: 2026-02-30).
 */
const ISO_WITH_OFFSET =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})$/;

export function parseOccurredAt(value: string): Date | null {
  if (!ISO_WITH_OFFSET.test(value)) return null;
  const parsed = DateTime.fromISO(value, { setZone: true });
  return parsed.isValid ? parsed.toJSDate() : null;
}

/**
 * Dia (YYYY-MM-DD) de um instante no fuso de São Paulo.
 * Usa a base de fusos (IANA) em vez de "-03:00" fixo: se o Brasil voltar a ter
 * horário de verão, continua correto.
 */
export function saoPauloDay(instant: Date): string {
  return DateTime.fromJSDate(instant, { zone: REPORT_TIMEZONE }).toISODate()!;
}

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Valida "YYYY-MM-DD" de verdade (rejeita 2026-02-30). */
export function parseDay(value: unknown): DateTime | null {
  if (typeof value !== 'string' || !DAY_PATTERN.test(value)) return null;
  const parsed = DateTime.fromISO(value, { zone: REPORT_TIMEZONE });
  return parsed.isValid ? parsed : null;
}

/** Quantidade de dias de `from` até `to`, contando os dois extremos. */
export function inclusiveDayCount(from: DateTime, to: DateTime): number {
  return Math.round(to.startOf('day').diff(from.startOf('day'), 'days').days) + 1;
}
