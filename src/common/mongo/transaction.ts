import type { ClientSession, Connection } from 'mongoose';

/**
 * Executa `work` numa transação multi-documento.
 *
 * `withTransaction` do driver repete automaticamente o callback inteiro em
 * erros transitórios (TransientTransactionError, ex.: WriteConflict quando dois
 * workers mexem no mesmo documento) e no commit (UnknownTransactionCommitResult).
 * Erros não transitórios (ex.: E11000) abortam e sobem para o chamador.
 *
 * Requer replica set — por isso o docker-compose sobe o Mongo com --replSet.
 */
export async function runInTransaction<T>(
  connection: Connection,
  work: (session: ClientSession) => Promise<T>,
): Promise<T> {
  const session = await connection.startSession();
  try {
    let result: T | undefined;
    await session.withTransaction(
      async () => {
        result = await work(session);
      },
      {
        readConcern: { level: 'snapshot' },
        writeConcern: { w: 'majority' },
      },
    );
    return result as T;
  } finally {
    await session.endSession();
  }
}
