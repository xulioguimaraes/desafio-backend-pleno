/**
 * Configuração lida das variáveis de ambiente uma única vez.
 *
 * É um objeto simples (e não o ConfigModule do Nest) para ficar fácil de
 * ler e de sobrescrever nos testes (ex.: encurtar a janela de deduplicação no C6).
 */
export interface AppConfig {
  port: number;
  mongoUri: string;
  redisHost: string;
  redisPort: number;
  /** Janela da camada 2 (impressão digital), em ms. */
  dedupWindowMs: number;
  /** Concorrência do consumidor Bull por instância. */
  queueConcurrency: number;
  /** Tentativas totais de processamento antes de FAILED. */
  maxAttempts: number;
  /** Atraso base do backoff exponencial do Bull, em ms. */
  backoffDelayMs: number;
  /** Por quanto tempo um worker "possui" um evento em PROCESSING. */
  processingLeaseMs: number;
  /** Intervalo da varredura de recuperação (0 desliga). */
  recoveryIntervalMs: number;
  /** Idade mínima de um PENDING para a varredura reenfileirar. */
  recoveryPendingAgeMs: number;
  /** Tempo máximo esperando o Redis ao enfileirar no POST. */
  enqueueTimeoutMs: number;
  /** Tolerância de occurred_at no futuro. */
  maxFutureSkewMs: number;
  logLevel: string;
}

export const APP_CONFIG = Symbol('APP_CONFIG');

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Variável de ambiente ${name} inválida: ${raw}`);
  }
  return value;
}

export function loadConfig(): AppConfig {
  const queueConcurrency = int('QUEUE_CONCURRENCY', 10);
  if (queueConcurrency < 1) throw new Error('QUEUE_CONCURRENCY deve ser >= 1');

  return {
    port: int('PORT', 3000),
    mongoUri:
      process.env.MONGO_URI ??
      'mongodb://localhost:27017/loyalty?replicaSet=rs0&directConnection=true',
    redisHost: process.env.REDIS_HOST ?? 'localhost',
    redisPort: int('REDIS_PORT', 6379),
    dedupWindowMs: int('DEDUP_WINDOW_MS', 10_000),
    queueConcurrency,
    maxAttempts: int('MAX_ATTEMPTS', 3),
    backoffDelayMs: int('BACKOFF_DELAY_MS', 1_000),
    processingLeaseMs: int('PROCESSING_LEASE_MS', 30_000),
    recoveryIntervalMs: int('RECOVERY_INTERVAL_MS', 15_000),
    recoveryPendingAgeMs: int('RECOVERY_PENDING_AGE_MS', 30_000),
    enqueueTimeoutMs: int('ENQUEUE_TIMEOUT_MS', 1_000),
    maxFutureSkewMs: int('MAX_FUTURE_SKEW_MS', 5 * 60_000),
    logLevel: process.env.LOG_LEVEL ?? 'info',
  };
}
