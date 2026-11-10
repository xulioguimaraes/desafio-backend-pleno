/**
 * npm run load — dispara C2, C5 e C11 contra a API rodando e imprime
 * "esperado × obtido". Sai com código 1 se algum cenário divergir.
 *
 *   LOAD_BASE_URL     (padrão http://localhost:3000)
 *   LOAD_CONCURRENCY  requisições em voo no C11 (padrão 200)
 *
 * Cada execução usa ids aleatórios: rodar duas vezes não soma métricas da
 * execução anterior nem cai na janela de deduplicação.
 */
import { randomUUID } from 'node:crypto';
import { SEED_COMPANIES } from '../src/seed/seed-data';

const BASE_URL = process.env.LOAD_BASE_URL ?? 'http://localhost:3000';
const CONCURRENCY = Number(process.env.LOAD_CONCURRENCY ?? 200);
const company = SEED_COMPANIES[0];
const run = randomUUID().slice(0, 8);

const headers = {
  'content-type': 'application/json',
  'x-company-key': company.public_key,
  'x-company-secret': company.secret,
  'x-country-code': 'BR',
};

interface Row {
  scenario: string;
  expected: string;
  obtained: string;
  ok: boolean;
}
const rows: Row[] = [];

function check(scenario: string, expected: unknown, obtained: unknown) {
  const e = typeof expected === 'string' ? expected : JSON.stringify(expected);
  const o = typeof obtained === 'string' ? obtained : JSON.stringify(obtained);
  rows.push({ scenario, expected: e, obtained: o, ok: e === o });
}

async function post(body: unknown) {
  const res = await fetch(`${BASE_URL}/v1/events`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

async function get(path: string) {
  const res = await fetch(`${BASE_URL}${path}`, { headers });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

function tally(responses: Array<{ status: number; body: Record<string, any> }>) {
  const counts: Record<string, number> = {};
  for (const r of responses) {
    const key = r.status === 200 ? `200 ${r.body.reason}` : String(r.status);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort());
}

async function runConcurrently<T>(tasks: Array<() => Promise<T>>, limit: number) {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, async () => {
      while (next < tasks.length) {
        const i = next++;
        results[i] = await tasks[i]();
      }
    }),
  );
  return results;
}

async function waitFor<T>(fn: () => Promise<T>, done: (v: T) => boolean, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let value = await fn();
  while (!done(value) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
    value = await fn();
  }
  return value;
}

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

async function c2() {
  const body = {
    event_id: `load_c2_${run}`,
    action: 'DEPOSIT_CONFIRMED',
    client_id: `load_c2_${run}`,
    amount: '19.74',
    occurred_at: minutesAgo(1),
  };
  const responses = await Promise.all(Array.from({ length: 50 }, () => post(body)));
  check('C2 respostas', { '200 DUPLICATE_EVENT_ID': 49, '202': 1 }, tally(responses));
  check('C2 ids distintos', 1, new Set(responses.map((r) => r.body.id)).size);

  const metrics = await waitFor(
    () => get(`/v1/clients/${body.client_id}/metrics`),
    (r) => r.status === 200,
  );
  check('C2 métrica count', 1, metrics.body.actions?.DEPOSIT_CONFIRMED?.count);
}

async function c5() {
  const base = {
    action: 'DEPOSIT_CONFIRMED',
    client_id: `load_c5_${run}`,
    amount: '50.00',
    occurred_at: minutesAgo(2),
  };
  const responses = await Promise.all(
    Array.from({ length: 50 }, (_, i) => post({ ...base, event_id: `load_c5_${run}_${i}` })),
  );
  check('C5 respostas', { '200 DUPLICATE_CONTENT': 49, '202': 1 }, tally(responses));
  const acceptedId = responses.find((r) => r.status === 202)?.body.id;
  check(
    'C5 duplicatas apontam para a aceita',
    true,
    responses.filter((r) => r.status === 200).every((r) => r.body.id === acceptedId),
  );
}

async function c11() {
  const clientId = `load_c11_${run}`;
  const start = Date.now() - 60 * 60_000;
  let expectedCents = 0;
  const bodies = Array.from({ length: 1000 }, (_, i) => {
    const cents = 100 + i; // amounts distintos → impressões digitais distintas
    expectedCents += cents;
    return {
      event_id: `load_c11_${run}_${i}`,
      action: 'DEPOSIT_CONFIRMED',
      client_id: clientId,
      amount: `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`,
      occurred_at: new Date(start + i * 1000).toISOString(),
    };
  });

  const t0 = Date.now();
  const responses = await runConcurrently(bodies.map((b) => () => post(b)), CONCURRENCY);
  const ingestMs = Date.now() - t0;
  check('C11 respostas', { '202': 1000 }, tally(responses));

  const metrics = await waitFor(
    () => get(`/v1/clients/${clientId}/metrics`),
    (r) => r.body.actions?.DEPOSIT_CONFIRMED?.count === 1000,
  );
  const totalMs = Date.now() - t0;
  const kpi = metrics.body.actions?.DEPOSIT_CONFIRMED ?? {};
  check('C11 count', 1000, kpi.count);
  check('C11 total_cents', expectedCents, kpi.total_cents);
  console.log(`C11: ingestão em ${ingestMs} ms; processamento completo em ${totalMs} ms`);
}

async function main() {
  const health = await fetch(`${BASE_URL}/health`).catch(() => null);
  if (!health?.ok) {
    console.error(`API não respondeu em ${BASE_URL}. Rode "docker compose up" antes.`);
    process.exit(1);
  }

  console.log(`Carga contra ${BASE_URL} (execução ${run})\n`);
  await c2();
  await c5();
  await c11();

  console.log('');
  console.table(
    rows.map((r) => ({
      cenário: r.scenario,
      esperado: r.expected,
      obtido: r.obtained,
      resultado: r.ok ? 'OK' : 'FALHOU',
    })),
  );

  const failed = rows.filter((r) => !r.ok);
  if (failed.length > 0) {
    console.error(`\n${failed.length} verificação(ões) falharam.`);
    process.exit(1);
  }
  console.log('\nTodas as verificações passaram.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
