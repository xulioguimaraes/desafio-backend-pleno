/** E11000: violação de índice único. É o mecanismo central da idempotência. */
export function isDuplicateKeyError(error: unknown): boolean {
  return (error as { code?: number } | null)?.code === 11000;
}

const UNAVAILABLE_ERROR_NAMES = new Set([
  'MongoServerSelectionError',
  'MongooseServerSelectionError',
  'MongoNetworkError',
  'MongoNetworkTimeoutError',
  'MongoNotConnectedError',
  'MongoTopologyClosedError',
]);

/** Erros que significam "o Mongo não está acessível agora" (→ 503). */
export function isMongoUnavailableError(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name;
  return !!name && UNAVAILABLE_ERROR_NAMES.has(name);
}
