import { MongoDBContainer } from '@testcontainers/mongodb';
import { RedisContainer } from '@testcontainers/redis';

/**
 * Sobe Mongo (replica set, necessário para transações) e Redis reais.
 *
 * Alternativa sem Testcontainers: exporte TEST_MONGO_URI e TEST_REDIS_HOST/PORT
 * (ex.: apontando para o `docker compose up mongo redis`) e os containers não sobem.
 */
export default async function globalSetup(): Promise<void> {
  process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'silent';

  if (process.env.TEST_MONGO_URI) {
    process.env.MONGO_URI = process.env.TEST_MONGO_URI;
    process.env.REDIS_HOST = process.env.TEST_REDIS_HOST ?? 'localhost';
    process.env.REDIS_PORT = process.env.TEST_REDIS_PORT ?? '6379';
    return;
  }

  const [mongo, redis] = await Promise.all([
    new MongoDBContainer('mongo:7.0').start(),
    new RedisContainer('redis:7-alpine').start(),
  ]);

  process.env.MONGO_URI = `${mongo.getConnectionString()}/loyalty_test?directConnection=true`;
  process.env.REDIS_HOST = redis.getHost();
  process.env.REDIS_PORT = String(redis.getPort());

  (globalThis as Record<string, unknown>).__TEST_CONTAINERS__ = [mongo, redis];
}
