import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import type { Connection } from 'mongoose';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { APP_CONFIG, AppConfig, loadConfig } from '../../src/config/app-config';
import { seedCompanies } from '../../src/seed/seed';
import { SEED_COMPANIES } from '../../src/seed/seed-data';

export type CompanyCode = (typeof SEED_COMPANIES)[number]['code'];

export interface ApiResponse<T = any> {
  status: number;
  body: T;
}

/**
 * Sobe o MESMO AppModule de produção (HTTP real numa porta aleatória, Mongo e
 * Redis reais). Só a configuração muda: backoff curto e varredura desligada
 * (os testes chamam a varredura na mão).
 */
export async function startTestApp(overrides: Partial<AppConfig> = {}) {
  const config: AppConfig = {
    ...loadConfig(),
    backoffDelayMs: 50,
    recoveryIntervalMs: 0,
    ...overrides,
  };

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_CONFIG)
    .useValue(config)
    .compile();

  const app = moduleRef.createNestApplication({ bufferLogs: true });
  await configureApp(app);
  await app.listen(0, '127.0.0.1');

  const connection = app.get<Connection>(getConnectionToken());
  await seedCompanies(connection);

  const { port } = app.getHttpServer().address() as AddressInfo;
  return { app, config, connection, api: new ApiClient(`http://127.0.0.1:${port}`) };
}

export type TestApp = Awaited<ReturnType<typeof startTestApp>>;

export class ApiClient {
  constructor(readonly baseUrl: string) {}

  private headers(company: CompanyCode, country: string): Record<string, string> {
    const c = SEED_COMPANIES.find((x) => x.code === company)!;
    return {
      'content-type': 'application/json',
      'x-company-key': c.public_key,
      'x-company-secret': c.secret,
      'x-country-code': country,
    };
  }

  async request(
    method: string,
    path: string,
    options: { company?: CompanyCode; country?: string; body?: unknown; headers?: Record<string, string> } = {},
  ): Promise<ApiResponse> {
    const headers = options.headers ?? this.headers(options.company ?? 'acme', options.country ?? 'BR');
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }

  postEvent(body: unknown, company: CompanyCode = 'acme', country = 'BR') {
    return this.request('POST', '/v1/events', { company, country, body });
  }

  getEvent(id: string, company: CompanyCode = 'acme', country = 'BR') {
    return this.request('GET', `/v1/events/${id}`, { company, country });
  }

  metrics(clientId: string, company: CompanyCode = 'acme', country = 'BR') {
    return this.request('GET', `/v1/clients/${encodeURIComponent(clientId)}/metrics`, {
      company,
      country,
    });
  }

  dailyReport(from: string, to: string, company: CompanyCode = 'acme', country = 'BR') {
    return this.request('GET', `/v1/reports/daily?from=${from}&to=${to}`, { company, country });
  }
}

/** Gera ids únicos por teste: os testes não dependem de limpar o banco. */
export function uid(prefix = ''): string {
  return `${prefix}${randomUUID().slice(0, 12)}`;
}

export function depositBody(overrides: Record<string, unknown> = {}) {
  return {
    event_id: uid('evt_'),
    action: 'DEPOSIT_CONFIRMED',
    client_id: uid('c_'),
    amount: '19.74',
    occurred_at: '2026-11-07T23:30:00-03:00',
    metadata: { channel: 'pix' },
    ...overrides,
  };
}

export async function waitFor<T>(
  fn: () => Promise<T>,
  predicate: (value: T) => boolean,
  { timeoutMs = 30_000, intervalMs = 100 } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T = await fn();
  while (!predicate(last)) {
    if (Date.now() > deadline) {
      throw new Error(`waitFor: tempo esgotado. Último valor: ${JSON.stringify(last)}`);
    }
    await sleep(intervalMs);
    last = await fn();
  }
  return last;
}

export function waitForStatus(api: ApiClient, id: string, status: string, company: CompanyCode = 'acme') {
  return waitFor(
    () => api.getEvent(id, company),
    (r) => r.body?.status === status,
  );
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Executa tarefas com no máximo `limit` em voo ao mesmo tempo. */
export async function runConcurrently<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  async function lane() {
    while (next < tasks.length) {
      const index = next++;
      results[index] = await tasks[index]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, lane));
  return results;
}

/** Status → quantidade. Ex.: { 202: 1, 200: 49 } */
export function countBy<T>(items: T[], key: (item: T) => string | number): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const k = String(key(item));
    counts[k] = (counts[k] ?? 0) + 1;
  }
  return counts;
}

export async function stopTestApp(testApp: TestApp | undefined): Promise<void> {
  jest.restoreAllMocks();
  await testApp?.app.close();
}
