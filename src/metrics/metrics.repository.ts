import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { ClientSession } from 'mongoose';
import { Model, Types } from 'mongoose';
import type { MetricContribution } from '../actions/action-strategy';
import { saoPauloDay } from '../domain/time';
import type { Tenant } from '../tenancy/tenant';
import { ClientKpiState, ReportDaily, ReportDailyClient } from './metrics.schemas';

export interface EventForMetrics {
  company_id: Types.ObjectId;
  country: string;
  client_id: string;
  action: string;
  occurred_at: Date;
}

@Injectable()
export class MetricsRepository {
  constructor(
    @InjectModel(ClientKpiState.name) private readonly kpis: Model<ClientKpiState>,
    @InjectModel(ReportDaily.name) private readonly reports: Model<ReportDaily>,
    @InjectModel(ReportDailyClient.name) private readonly dailyClients: Model<ReportDailyClient>,
  ) {}

  /**
   * Aplica o efeito de UM evento. Sempre chamado dentro da transação do worker:
   * ou tudo é aplicado (junto com status=PROCESSED), ou nada é (C12).
   *
   * Todas as operações são atômicas no servidor ($inc, $min, $max), nunca
   * "ler → somar em memória → gravar". Assim 1.000 eventos simultâneos do
   * mesmo cliente não perdem atualização (C11).
   */
  async applyEvent(
    event: EventForMetrics,
    contribution: MetricContribution,
    session: ClientSession,
  ): Promise<void> {
    await this.applyClientKpi(event, contribution, session);
    await this.applyDailyReport(event, contribution, session);
  }

  async applyClientKpi(
    event: EventForMetrics,
    contribution: MetricContribution,
    session: ClientSession,
  ): Promise<void> {
    const prefix = `actions.${event.action}`;
    await this.kpis.collection.updateOne(
      { company_id: event.company_id, country: event.country, client_id: event.client_id },
      {
        $inc: {
          [`${prefix}.count`]: contribution.count,
          // bigint é serializado como Int64 (Long) no BSON: soma inteira, sem double.
          [`${prefix}.total_cents`]: contribution.totalCents,
        },
        // Eventos fora de ordem (C14): $min/$max, nunca $set.
        $min: { [`${prefix}.first_at`]: event.occurred_at },
        $max: { [`${prefix}.last_at`]: event.occurred_at },
        $currentDate: { updated_at: true },
      },
      { upsert: true, session },
    );
  }

  async applyDailyReport(
    event: EventForMetrics,
    contribution: MetricContribution,
    session: ClientSession,
  ): Promise<void> {
    // Dia no fuso de São Paulo (C15): 02:50 UTC do dia 8 = 23:50 do dia 7.
    const day = saoPauloDay(event.occurred_at);
    const scope = { company_id: event.company_id, country: event.country, day };

    // Upsert "inserir se não existe": upsertedCount = 1 só na primeira vez que o
    // cliente aparece no dia. Não usa insert+catch(E11000) porque um E11000
    // dentro da transação a abortaria.
    const marker = await this.dailyClients.collection.updateOne(
      { ...scope, client_id: event.client_id },
      { $setOnInsert: { ...scope, client_id: event.client_id } },
      { upsert: true, session },
    );
    const isNewClientToday = marker.upsertedCount === 1 ? 1 : 0;

    const prefix = `actions.${event.action}`;
    await this.reports.collection.updateOne(
      scope,
      {
        $inc: {
          [`${prefix}.count`]: contribution.count,
          [`${prefix}.total_cents`]: contribution.totalCents,
          unique_clients: isNewClientToday,
        },
      },
      { upsert: true, session },
    );
  }

  findClientKpi(tenant: Tenant, clientId: string) {
    return this.kpis
      .findOne({ company_id: tenant.companyId, country: tenant.country, client_id: clientId })
      .lean<ClientKpiState>();
  }

  /** Uma única consulta para o intervalo inteiro (sem N+1 por dia). */
  findDailyReports(tenant: Tenant, from: string, to: string) {
    return this.reports
      .find({
        company_id: tenant.companyId,
        country: tenant.country,
        day: { $gte: from, $lte: to },
      })
      .sort({ day: 1 })
      .lean<ReportDaily[]>();
  }
}
