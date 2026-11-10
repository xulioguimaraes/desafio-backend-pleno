import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Por que SHA-256 e não bcrypt/argon2?
 * Os segredos são gerados pela plataforma (aleatórios, >= 128 bits). Hashes
 * lentos existem para proteger senhas fracas escolhidas por humanos. Com um
 * segredo de alta entropia, força bruta sobre SHA-256 é inviável, e um bcrypt
 * custaria dezenas de ms em CADA requisição (o C11 manda 1.000 de uma vez).
 */
export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

/** Hash de um valor que nunca será um segredo válido (usado quando a key não existe). */
const DUMMY_HASH = hashSecret('__dummy_secret_never_valid__');

/**
 * Compara em tempo constante. Quando a empresa não existe, comparamos contra
 * um hash falso para que "key inexistente" e "secret errado" levem o mesmo tempo.
 */
export function verifySecret(secret: string, storedHash: string | undefined): boolean {
  const expected = Buffer.from(storedHash ?? DUMMY_HASH, 'hex');
  const actual = Buffer.from(hashSecret(secret), 'hex');
  const equal = expected.length === actual.length && timingSafeEqual(expected, actual);
  return equal && storedHash !== undefined;
}
