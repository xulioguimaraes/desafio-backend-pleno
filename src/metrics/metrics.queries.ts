import { Injectable } from '@nestjs/common';
import { AppError } from '../common/errors/app-error';
import { inclusiveDayCount, parseDay, REPORT_TIMEZONE } from '../domain/time';
import type { Tenant } from '../tenancy/tenant';
import { MetricsRepository } from './metrics.repository';

const MAX_REPORT_DAYS = 31;

/** Long/bigint/number vindos do Mongo → number para o JSON. */
function toNumber(value: unknown): number {
  if (value === undefined || value === null) return 0;
  return Number(value);
}

@Injectable()
export class MetricsQueries {
  constructor(private readonly repository: MetricsRepository) {}

  async clientMetrics(tenant: Tenant, clientId: string) {
    const state = await this.repository.findClientKpi(tenant, clientId);
    if (!state) throw AppError.clientNotFound();

    const actions: Record<string, unknown> = {};
    for (const [action, kpi] of Object.entries(state.actions ?? {})) {
      actions[action] = {
        count: toNumber(kpi.count),
        total_cents: toNumber(kpi.total_cents),
        first_at: kpi.first_at?.toISOString() ?? null,
        last_at: kpi.last_at?.toISOString() ?? null,
      };
    }

    return { client_id: state.client_id, country: state.country, actions };
  }

  async dailyReport(tenant: Tenant, fromRaw: unknown, toRaw: unknown) {
    const from = parseDay(fromRaw);
    const to = parseDay(toRaw);
    if (!from || !to) {
      throw AppError.invalidDateRange('from e to são obrigatórios no formato YYYY-MM-DD.');
    }
    if (to < from) {
      throw AppError.invalidDateRange('from deve ser menor ou igual a to.');
    }
    if (inclusiveDayCount(from, to) > MAX_REPORT_DAYS) {
      throw AppError.invalidDateRange(`O intervalo máximo é de ${MAX_REPORT_DAYS} dias.`);
    }

    const fromDay = from.toISODate()!;
    const toDay = to.toISODate()!;
    const rows = await this.repository.findDailyReports(tenant, fromDay, toDay);

    return {
      from: fromDay,
      to: toDay,
      timezone: REPORT_TIMEZONE,
      country: tenant.country,
      days: rows.map((row) => ({
        day: row.day,
        unique_clients: toNumber(row.unique_clients),
        actions: Object.fromEntries(
          Object.entries(row.actions ?? {}).map(([action, v]) => [
            action,
            { count: toNumber(v.count), total_cents: toNumber(v.total_cents) },
          ]),
        ),
      })),
    };
  }
}
