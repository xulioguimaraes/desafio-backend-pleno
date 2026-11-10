import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { EventRecord } from '../src/events/event.schema';
import { EventsRepository } from '../src/events/events.repository';
import { RecoveryService } from '../src/processing/recovery.service';
import { EventQueue } from '../src/queue/event-queue';
import { SEED_COMPANIES } from '../src/seed/seed-data';
import {
  countBy,
  depositBody,
  sleep,
  startTestApp,
  stopTestApp,
  TestApp,
  uid,
  waitFor,
  waitForStatus,
} from './support/test-app';

describe('POST /v1/events — idempotência (camadas 1 e 2)', () => {
  let t: TestApp;
  let events: Model<EventRecord>;

  beforeAll(async () => {
    t = await startTestApp();
    events = t.app.get(getModelToken(EventRecord.name));
  });

  afterAll(() => stopTestApp(t));
  afterEach(() => jest.restoreAllMocks());

  it('C1: mesmo payload 2× em sequência → 202 e depois 200 DUPLICATE_EVENT_ID com o mesmo id; métrica conta 1', async () => {
    const body = depositBody();

    const first = await t.api.postEvent(body);
    const second = await t.api.postEvent(body);

    expect(first.status).toBe(202);
    expect(first.body).toEqual({ id: expect.any(String), status: 'PENDING' });
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({
      id: first.body.id,
      duplicate: true,
      reason: 'DUPLICATE_EVENT_ID',
    });
    expect(['PENDING', 'PROCESSING', 'PROCESSED']).toContain(second.body.status);

    await waitForStatus(t.api, first.body.id, 'PROCESSED');
    const metrics = await t.api.metrics(body.client_id);
    expect(metrics.body.actions.DEPOSIT_CONFIRMED).toMatchObject({ count: 1, total_cents: 1974 });
  });

  it('C1: o 200 devolve o status ATUAL do evento original', async () => {
    const body = depositBody();
    const first = await t.api.postEvent(body);
    await waitForStatus(t.api, first.body.id, 'PROCESSED');

    const again = await t.api.postEvent(body);
    expect(again.body).toMatchObject({ id: first.body.id, status: 'PROCESSED' });
  });

  it('C2: 50 requisições simultâneas com o mesmo event_id → 1 × 202, 49 × 200, um documento, um processamento', async () => {
    const body = depositBody();

    const responses = await Promise.all(Array.from({ length: 50 }, () => t.api.postEvent(body)));

    expect(countBy(responses, (r) => r.status)).toEqual({ '202': 1, '200': 49 });
    const accepted = responses.find((r) => r.status === 202)!;
    for (const r of responses.filter((x) => x.status === 200)) {
      expect(r.body).toMatchObject({ id: accepted.body.id, reason: 'DUPLICATE_EVENT_ID' });
    }

    expect(await events.countDocuments({ event_id: body.event_id })).toBe(1);

    const processed = await waitForStatus(t.api, accepted.body.id, 'PROCESSED');
    expect(processed.body.attempts).toBe(1);
    const metrics = await t.api.metrics(body.client_id);
    expect(metrics.body.actions.DEPOSIT_CONFIRMED.count).toBe(1);
  });

  it('C2 (camada 1 isolada): mesmo com a janela de conteúdo zerada, 50 simultâneos com o mesmo event_id → 1 × 202', async () => {
    // Com janela 0 a camada 2 não segura nada; quem garante é o índice único
    // (empresa, event_id). Prova que a camada 1 é permanente, não só dentro da janela.
    const original = t.config.dedupWindowMs;
    t.config.dedupWindowMs = 0;
    try {
      const body = depositBody();
      const responses = await Promise.all(Array.from({ length: 50 }, () => t.api.postEvent(body)));

      expect(countBy(responses, (r) => r.status)).toEqual({ '202': 1, '200': 49 });
      for (const r of responses.filter((x) => x.status === 200)) {
        expect(r.body.reason).toBe('DUPLICATE_EVENT_ID');
      }
      expect(await events.countDocuments({ event_id: body.event_id })).toBe(1);
    } finally {
      t.config.dedupWindowMs = original;
    }
  });

  it('C3 concorrente: 20 simultâneos com o mesmo event_id e amounts diferentes → 1 × 202, 19 × 409', async () => {
    const body = depositBody();
    const responses = await Promise.all(
      Array.from({ length: 20 }, (_, i) => t.api.postEvent({ ...body, amount: `${i + 1}.00` })),
    );

    expect(countBy(responses, (r) => r.status)).toEqual({ '202': 1, '409': 19 });
    expect(await events.countDocuments({ event_id: body.event_id })).toBe(1);
  });

  it('C3: mesmo event_id com amount diferente → 409 IDEMPOTENCY_CONFLICT; nada é alterado', async () => {
    const body = depositBody();
    const first = await t.api.postEvent(body);
    await waitForStatus(t.api, first.body.id, 'PROCESSED');

    const conflict = await t.api.postEvent({ ...body, amount: '99.99' });

    expect(conflict.status).toBe(409);
    expect(conflict.body).toEqual({ code: 'IDEMPOTENCY_CONFLICT', message: expect.any(String) });

    const stored = await t.api.getEvent(first.body.id);
    expect(stored.body.amount).toBe('19.74');
    expect(await events.countDocuments({ event_id: body.event_id })).toBe(1);
    const metrics = await t.api.metrics(body.client_id);
    expect(metrics.body.actions.DEPOSIT_CONFIRMED).toMatchObject({ count: 1, total_cents: 1974 });
  });

  it('C3: mesmo event_id vindo de outro país também é conteúdo diferente → 409', async () => {
    const body = depositBody();
    await t.api.postEvent(body, 'acme', 'BR');
    const otherCountry = await t.api.postEvent(body, 'acme', 'AR');
    expect(otherCountry.status).toBe(409);
  });

  it('C4: event_id diferente, mesmo conteúdo, dentro da janela → 200 DUPLICATE_CONTENT com o id do original', async () => {
    const body = depositBody();
    const first = await t.api.postEvent(body);
    const second = await t.api.postEvent({ ...body, event_id: uid('evt_'), metadata: { channel: 'ted' } });

    expect(first.status).toBe(202);
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({
      id: first.body.id,
      duplicate: true,
      reason: 'DUPLICATE_CONTENT',
    });
  });

  it('C5: 50 requisições simultâneas, event_ids diferentes, mesmo conteúdo → 1 × 202, 49 × DUPLICATE_CONTENT apontando para ela', async () => {
    const base = depositBody();

    const responses = await Promise.all(
      Array.from({ length: 50 }, () => t.api.postEvent({ ...base, event_id: uid('evt_') })),
    );

    expect(countBy(responses, (r) => r.status)).toEqual({ '202': 1, '200': 49 });
    const accepted = responses.find((r) => r.status === 202)!;
    for (const r of responses.filter((x) => x.status === 200)) {
      expect(r.body).toMatchObject({ id: accepted.body.id, reason: 'DUPLICATE_CONTENT' });
    }
    expect(await events.countDocuments({ client_id: base.client_id })).toBe(1);

    await waitForStatus(t.api, accepted.body.id, 'PROCESSED');
    const metrics = await t.api.metrics(base.client_id);
    expect(metrics.body.actions.DEPOSIT_CONFIRMED.count).toBe(1);
  });

  it('C6: mesmo conteúdo, event_id diferente, depois da janela → 202; métrica conta 2', async () => {
    const original = t.config.dedupWindowMs;
    t.config.dedupWindowMs = 300; // janela curta só neste teste
    try {
      const body = depositBody();
      const first = await t.api.postEvent(body);
      await sleep(400);
      const second = await t.api.postEvent({ ...body, event_id: uid('evt_') });

      expect(first.status).toBe(202);
      expect(second.status).toBe(202);
      expect(second.body.id).not.toBe(first.body.id);

      await waitForStatus(t.api, first.body.id, 'PROCESSED');
      await waitForStatus(t.api, second.body.id, 'PROCESSED');
      const metrics = await t.api.metrics(body.client_id);
      expect(metrics.body.actions.DEPOSIT_CONFIRMED).toMatchObject({ count: 2, total_cents: 3948 });
    } finally {
      t.config.dedupWindowMs = original;
    }
  });

  it('C7: "19.7" vs "19.70" e o mesmo instante em fusos diferentes → mesma impressão digital', async () => {
    const body = depositBody({ amount: '19.7', occurred_at: '2026-11-07T23:30:00-03:00' });
    const first = await t.api.postEvent(body);
    const second = await t.api.postEvent({
      ...body,
      event_id: uid('evt_'),
      amount: '19.70',
      occurred_at: '2026-11-08T02:30:00Z',
    });

    expect(first.status).toBe(202);
    expect(second.body).toMatchObject({ id: first.body.id, reason: 'DUPLICATE_CONTENT' });
  });

  it('C8: dois LOGIN iguais (sem amount) dentro da janela → o segundo é DUPLICATE_CONTENT', async () => {
    const login = {
      event_id: uid('evt_'),
      action: 'LOGIN',
      client_id: uid('c_'),
      occurred_at: '2026-11-07T10:00:00-03:00',
    };
    const first = await t.api.postEvent(login);
    const second = await t.api.postEvent({ ...login, event_id: uid('evt_') });

    expect(first.status).toBe(202);
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ id: first.body.id, reason: 'DUPLICATE_CONTENT' });
  });

  it('C9: mesmo conteúdo (e mesmo event_id) por duas empresas → ambos aceitos, sem vazamento', async () => {
    const body = depositBody();

    const acme = await t.api.postEvent(body, 'acme');
    const globex = await t.api.postEvent(body, 'globex');

    expect(acme.status).toBe(202);
    expect(globex.status).toBe(202);
    expect(globex.body.id).not.toBe(acme.body.id);

    // Uma empresa não enxerga o evento da outra (404, não 403).
    const leak = await t.api.getEvent(acme.body.id, 'globex');
    expect(leak.status).toBe(404);
    expect(leak.body.code).toBe('EVENT_NOT_FOUND');

    await waitForStatus(t.api, acme.body.id, 'PROCESSED', 'acme');
    await waitForStatus(t.api, globex.body.id, 'PROCESSED', 'globex');
    expect((await t.api.metrics(body.client_id, 'acme')).body.actions.DEPOSIT_CONFIRMED.count).toBe(1);
    expect((await t.api.metrics(body.client_id, 'globex')).body.actions.DEPOSIT_CONFIRMED.count).toBe(1);
  });

  it('C10: Mongo falha ao gravar logo após reservar a impressão digital → requisição falha; reenvio é aceito sem esperar a janela', async () => {
    const repository = t.app.get(EventsRepository);
    const reserve = jest.spyOn(repository, 'reserveFingerprint');
    const mongoFailure = Object.assign(new Error('conexão perdida (simulada)'), {
      name: 'MongoNetworkError',
    });
    jest.spyOn(repository, 'insert').mockRejectedValueOnce(mongoFailure);

    const body = depositBody();
    const failed = await t.api.postEvent(body);

    expect(reserve).toHaveBeenCalledTimes(1); // a reserva aconteceu antes da falha
    expect(failed.status).toBe(503);
    expect(failed.body.code).toBe('SERVICE_UNAVAILABLE');

    const retry = await t.api.postEvent(body);
    expect(retry.status).toBe(202);

    // E um reenvio com OUTRO event_id e mesmo conteúdo também não fica preso numa reserva órfã.
    const other = depositBody();
    jest.spyOn(repository, 'insert').mockRejectedValueOnce(mongoFailure);
    expect((await t.api.postEvent(other)).status).toBe(503);
    const retryNewId = await t.api.postEvent({ ...other, event_id: uid('evt_') });
    expect(retryNewId.status).toBe(202);
  });

  it('C16: Redis indisponível no POST → 202 (evento salvo como PENDING); a varredura enfileira depois e conta 1 vez', async () => {
    const queue = t.app.get(EventQueue);
    // Simula o Redis fora: o add nunca responde (é o que o ioredis faz offline).
    const bullQueue = (queue as unknown as { queue: { addBulk: () => Promise<unknown> } }).queue;
    const addBulk = jest.spyOn(bullQueue, 'addBulk').mockImplementation(() => new Promise(() => {}));

    const body = depositBody();
    const started = Date.now();
    const res = await t.api.postEvent(body);

    expect(res.status).toBe(202);
    expect(Date.now() - started).toBeLessThan(t.config.enqueueTimeoutMs + 1_500);
    const stored = await t.api.getEvent(res.body.id);
    expect(stored.body.status).toBe('PENDING');

    // Reenvio enquanto o Redis segue fora: idempotente, não duplica.
    const again = await t.api.postEvent(body);
    expect(again.body).toMatchObject({ id: res.body.id, reason: 'DUPLICATE_EVENT_ID' });

    // Redis volta. A varredura acha o PENDING antigo e enfileira.
    addBulk.mockRestore();
    const future = new Date(Date.now() + t.config.recoveryPendingAgeMs + 1_000);
    const sweep = await t.app.get(RecoveryService).sweep(future);
    expect(sweep.requeued).toBeGreaterThanOrEqual(1);

    await waitForStatus(t.api, res.body.id, 'PROCESSED');
    const metrics = await t.api.metrics(body.client_id);
    expect(metrics.body.actions.DEPOSIT_CONFIRMED.count).toBe(1);
  });
});

describe('autenticação, validação e isolamento', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await startTestApp();
  });
  afterAll(() => stopTestApp(t));

  const acme = SEED_COMPANIES[0];

  it.each([
    ['sem headers', {}],
    ['secret errado', { 'x-company-key': acme.public_key, 'x-company-secret': 'errado', 'x-country-code': 'BR' }],
    ['key inexistente', { 'x-company-key': 'ck_nope', 'x-company-secret': acme.secret, 'x-country-code': 'BR' }],
    ['sem país', { 'x-company-key': acme.public_key, 'x-company-secret': acme.secret }],
    ['país inválido', { 'x-company-key': acme.public_key, 'x-company-secret': acme.secret, 'x-country-code': 'BRA' }],
  ])('%s → 401 UNAUTHORIZED', async (_, headers) => {
    const res = await t.api.request('POST', '/v1/events', {
      headers: { 'content-type': 'application/json', ...headers },
      body: depositBody(),
    });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ code: 'UNAUTHORIZED', message: expect.any(String) });
  });

  it('nunca devolve o segredo nem o hash nas respostas', async () => {
    const res = await t.api.postEvent(depositBody());
    const stored = await t.api.getEvent(res.body.id);
    const serialized = JSON.stringify([res.body, stored.body]);
    expect(serialized).not.toContain(acme.secret);
    expect(serialized).not.toContain('secret');
  });

  it.each([
    ['JSON malformado', '{bad', 'INVALID_PAYLOAD'],
    ['amount inválido', depositBody({ amount: '19.745' }), 'INVALID_AMOUNT'],
    ['occurred_at sem fuso', depositBody({ occurred_at: '2026-11-07T23:30:00' }), 'INVALID_OCCURRED_AT'],
    ['action inválida', depositBody({ action: 'REFUND' }), 'INVALID_PAYLOAD'],
  ])('%s → 400 com o código certo', async (_, body, code) => {
    const res =
      typeof body === 'string'
        ? await fetchRaw(t, body)
        : await t.api.postEvent(body);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ code, message: expect.any(String) });
  });

  it('GET /v1/events/:id respeita empresa e país', async () => {
    const res = await t.api.postEvent(depositBody(), 'acme', 'BR');
    expect((await t.api.getEvent(res.body.id, 'acme', 'BR')).status).toBe(200);
    expect((await t.api.getEvent(res.body.id, 'acme', 'AR')).status).toBe(404);
    expect((await t.api.getEvent(res.body.id, 'globex', 'BR')).status).toBe(404);
    expect((await t.api.getEvent('nao-existe', 'acme', 'BR')).body.code).toBe('EVENT_NOT_FOUND');
  });

  it('relatório: valida intervalo (máximo 31 dias, from <= to, datas reais)', async () => {
    expect((await t.api.dailyReport('2026-10-01', '2026-10-31')).status).toBe(200);
    for (const [from, to] of [
      ['2026-10-01', '2026-11-01'],
      ['2026-11-10', '2026-11-01'],
      ['2026-02-30', '2026-03-01'],
      ['', ''],
    ]) {
      const res = await t.api.dailyReport(from, to);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_DATE_RANGE');
    }
  });

  it('métricas e relatório só trazem dados da empresa e do país autenticados', async () => {
    const body = depositBody({ occurred_at: '2026-09-15T12:00:00-03:00' });
    const res = await t.api.postEvent(body, 'acme', 'BR');
    await waitForStatus(t.api, res.body.id, 'PROCESSED');

    expect((await t.api.metrics(body.client_id, 'acme', 'BR')).status).toBe(200);
    expect((await t.api.metrics(body.client_id, 'acme', 'AR')).status).toBe(404);
    expect((await t.api.metrics(body.client_id, 'globex', 'BR')).status).toBe(404);

    const report = await waitFor(
      () => t.api.dailyReport('2026-09-15', '2026-09-15', 'globex', 'BR'),
      (r) => r.status === 200,
    );
    expect(report.body.days).toEqual([]);
  });
});

async function fetchRaw(t: TestApp, raw: string) {
  const acme = SEED_COMPANIES[0];
  const res = await fetch(`${t.api.baseUrl}/v1/events`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-company-key': acme.public_key,
      'x-company-secret': acme.secret,
      'x-country-code': 'BR',
    },
    body: raw,
  });
  return { status: res.status, body: await res.json() };
}
