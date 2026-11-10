import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { EventRecord } from '../src/events/event.schema';
import { MetricsRepository } from '../src/metrics/metrics.repository';
import { ProcessEventUseCase } from '../src/processing/process-event.use-case';
import { RecoveryService } from '../src/processing/recovery.service';
import { EventQueue } from '../src/queue/event-queue';
import {
  countBy,
  depositBody,
  runConcurrently,
  startTestApp,
  stopTestApp,
  TestApp,
  uid,
  waitFor,
  waitForStatus,
} from './support/test-app';

describe('processamento — camada 3, concorrência e métricas', () => {
  let t: TestApp;
  let events: Model<EventRecord>;

  beforeAll(async () => {
    t = await startTestApp();
    events = t.app.get(getModelToken(EventRecord.name));
  });

  afterAll(() => stopTestApp(t));
  afterEach(() => jest.restoreAllMocks());

  /** Faz o POST sem deixar o job chegar à fila: o teste controla o processamento. */
  async function postWithoutEnqueue(body: Record<string, unknown>): Promise<string> {
    jest.spyOn(t.app.get(EventQueue), 'enqueue').mockResolvedValueOnce(true);
    const res = await t.api.postEvent(body);
    expect(res.status).toBe(202);
    return res.body.id;
  }

  it('C11: 1.000 eventos distintos e simultâneos do mesmo cliente → count e total_cents exatos', async () => {
    const clientId = uid('c_load_');
    let expectedCents = 0;
    const bodies = Array.from({ length: 1000 }, (_, i) => {
      const cents = 100 + i; // valores distintos → impressões digitais distintas
      expectedCents += cents;
      return depositBody({
        client_id: clientId,
        amount: `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`,
        occurred_at: new Date(Date.UTC(2026, 10, 5, 12, 0, 0) + i * 1000).toISOString(),
      });
    });

    const responses = await runConcurrently(
      bodies.map((b) => () => t.api.postEvent(b)),
      100,
    );
    expect(countBy(responses, (r) => r.status)).toEqual({ '202': 1000 });

    const metrics = await waitFor(
      () => t.api.metrics(clientId),
      (r) => r.body?.actions?.DEPOSIT_CONFIRMED?.count === 1000,
      { timeoutMs: 90_000, intervalMs: 500 },
    );
    expect(metrics.body.actions.DEPOSIT_CONFIRMED.total_cents).toBe(expectedCents);
    expect(metrics.body.actions.DEPOSIT_CONFIRMED.first_at).toBe('2026-11-05T12:00:00.000Z');

    const report = await t.api.dailyReport('2026-11-05', '2026-11-05');
    const day = report.body.days.find((d: { day: string }) => d.day === '2026-11-05');
    expect(day.unique_clients).toBeGreaterThanOrEqual(1);
  }, 180_000);

  it('C12: job falha depois de aplicar parte do efeito e é reexecutado → métricas idênticas às de uma execução única', async () => {
    const body = depositBody({ occurred_at: '2026-10-20T15:00:00-03:00' });
    const metrics = t.app.get(MetricsRepository);

    // A 1ª execução aplica o client_kpi_state e falha antes do report_daily.
    const original = metrics.applyDailyReport.bind(metrics);
    let failedOnce = false;
    jest.spyOn(metrics, 'applyDailyReport').mockImplementation(async (event, contribution, session) => {
      if (event.client_id === body.client_id && !failedOnce) {
        failedOnce = true;
        throw new Error('falha simulada no meio do efeito');
      }
      return original(event, contribution, session);
    });

    const res = await t.api.postEvent(body);
    const processed = await waitForStatus(t.api, res.body.id, 'PROCESSED');

    expect(failedOnce).toBe(true);
    expect(processed.body.attempts).toBe(2);
    const kpi = await t.api.metrics(body.client_id);
    expect(kpi.body.actions.DEPOSIT_CONFIRMED).toMatchObject({ count: 1, total_cents: 1974 });

    const report = await t.api.dailyReport('2026-10-20', '2026-10-20');
    const day = report.body.days[0];
    expect(day.actions.DEPOSIT_CONFIRMED.count).toBeGreaterThanOrEqual(1);
    // O cliente deste teste foi contado uma única vez no dia.
    const clients = await t.connection
      .collection('report_daily_clients')
      .countDocuments({ client_id: body.client_id });
    expect(clients).toBe(1);
  });

  it('C13: dois workers recebem o mesmo evento ao mesmo tempo → efeito aplicado uma única vez', async () => {
    const body = depositBody();
    const id = await postWithoutEnqueue(body);
    const processEvent = t.app.get(ProcessEventUseCase);

    const outcomes = await Promise.all([
      processEvent.execute(id),
      processEvent.execute(id),
      processEvent.execute(id),
    ]);

    expect(outcomes.filter((o) => o === 'PROCESSED')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'SKIPPED')).toHaveLength(2);
    const kpi = await t.api.metrics(body.client_id);
    expect(kpi.body.actions.DEPOSIT_CONFIRMED.count).toBe(1);

    // Reprocessar um evento PROCESSED não faz nada.
    expect(await processEvent.execute(id)).toBe('SKIPPED');
    expect((await t.api.metrics(body.client_id)).body.actions.DEPOSIT_CONFIRMED.count).toBe(1);
  });

  it('C14: eventos fora de ordem → first_at e last_at corretos', async () => {
    const clientId = uid('c_');
    // O último a chegar não é nem o mais antigo nem o mais recente: um $set
    // (em vez de $min/$max) deixaria first_at/last_at errados.
    const times = [
      '2026-11-03T10:00:00-03:00',
      '2026-11-01T10:00:00-03:00', // mais antigo
      '2026-11-05T10:00:00-03:00', // mais recente
      '2026-11-02T10:00:00-03:00', // chega por último, no meio
    ];
    for (const occurred_at of times) {
      const res = await t.api.postEvent(depositBody({ client_id: clientId, occurred_at }));
      await waitForStatus(t.api, res.body.id, 'PROCESSED');
    }

    const kpi = await t.api.metrics(clientId);
    expect(kpi.body.actions.DEPOSIT_CONFIRMED).toMatchObject({
      count: 4,
      first_at: '2026-11-01T13:00:00.000Z',
      last_at: '2026-11-05T13:00:00.000Z',
    });
  });

  it('C15: evento às 23:50 de São Paulo (02:50 UTC do dia seguinte) → contado no dia de São Paulo', async () => {
    const res = await t.api.postEvent(
      depositBody({ occurred_at: '2026-08-08T02:50:00Z', amount: '10.00' }),
      'globex',
    );
    await waitForStatus(t.api, res.body.id, 'PROCESSED', 'globex');

    const report = await t.api.dailyReport('2026-08-07', '2026-08-08', 'globex');
    expect(report.body.days).toEqual([
      {
        day: '2026-08-07',
        unique_clients: 1,
        actions: { DEPOSIT_CONFIRMED: { count: 1, total_cents: 1000 } },
      },
    ]);
  });

  it('relatório diário: clientes únicos e totais por action', async () => {
    const day = '2026-07-01T12:00:00-03:00';
    const c1 = uid('c_');
    const c2 = uid('c_');
    const bodies = [
      depositBody({ client_id: c1, occurred_at: day, amount: '10.00' }),
      depositBody({ client_id: c1, occurred_at: '2026-07-01T13:00:00-03:00', amount: '5.50' }),
      { event_id: uid('evt_'), action: 'LOGIN', client_id: c2, occurred_at: day },
      depositBody({ client_id: c2, action: 'WITHDRAWAL_APPROVED', occurred_at: day, amount: '3.00' }),
    ];
    for (const b of bodies) {
      const res = await t.api.postEvent(b, 'globex');
      await waitForStatus(t.api, res.body.id, 'PROCESSED', 'globex');
    }

    const report = await t.api.dailyReport('2026-07-01', '2026-07-01', 'globex');
    expect(report.body.days[0]).toEqual({
      day: '2026-07-01',
      unique_clients: 2,
      actions: {
        DEPOSIT_CONFIRMED: { count: 2, total_cents: 1550 },
        LOGIN: { count: 1, total_cents: 0 },
        WITHDRAWAL_APPROVED: { count: 1, total_cents: 300 },
      },
    });
  });

  it('worker morto no meio do job (PROCESSING com posse vencida) → recuperado automaticamente, sem duplicar', async () => {
    const body = depositBody();
    const id = await postWithoutEnqueue(body);

    // Simula um worker que assumiu o evento e morreu.
    await events.updateOne(
      { _id: id },
      {
        $set: {
          status: 'PROCESSING',
          lock_token: 'worker-morto',
          locked_until: new Date(Date.now() - 1_000),
        },
        $inc: { attempts: 1 },
      },
    );

    const sweep = await t.app.get(RecoveryService).sweep();
    expect(sweep.requeued).toBeGreaterThanOrEqual(1);

    const processed = await waitForStatus(t.api, id, 'PROCESSED');
    expect(processed.body.attempts).toBe(2);
    expect((await t.api.metrics(body.client_id)).body.actions.DEPOSIT_CONFIRMED.count).toBe(1);
  });

  it('posse ainda válida não é roubada: varredura não reprocessa evento PROCESSING de worker vivo', async () => {
    const id = await postWithoutEnqueue(depositBody());
    await events.updateOne(
      { _id: id },
      { $set: { status: 'PROCESSING', lock_token: 'worker-vivo', locked_until: new Date(Date.now() + 60_000) } },
    );

    expect(await t.app.get(ProcessEventUseCase).execute(id)).toBe('SKIPPED');
    const stored = await events.findById(id).lean();
    expect(stored?.lock_token).toBe('worker-vivo');
  });

  it('3 tentativas com backoff; depois FAILED com o motivo gravado', async () => {
    const body = depositBody();
    const metrics = t.app.get(MetricsRepository);
    const original = metrics.applyEvent.bind(metrics);
    jest.spyOn(metrics, 'applyEvent').mockImplementation(async (event, contribution, session) => {
      if (event.client_id === body.client_id) throw new Error('erro permanente simulado');
      return original(event, contribution, session);
    });

    const res = await t.api.postEvent(body);
    const failed = await waitForStatus(t.api, res.body.id, 'FAILED');

    expect(failed.body.attempts).toBe(3);
    expect(failed.body.last_error).toBe('erro permanente simulado');
    expect((await t.api.metrics(body.client_id)).status).toBe(404); // nada foi aplicado
  });
});
