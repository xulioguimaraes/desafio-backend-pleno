import { createHash } from 'node:crypto';
import type { Metadata, NormalizedEvent } from './event';

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * Camada 2 — impressão digital: empresa + país + client_id + action + amount + occurred_at.
 *
 * Normalização:
 *  - amount já vem em centavos inteiros → "19.7" e "19.70" viram 1970.
 *  - occurred_at vira epoch em ms → o mesmo instante em fusos diferentes é igual.
 *  - LOGIN não tem amount → entra como null, de forma consistente (C8).
 *  - metadata NÃO entra.
 *
 * Serializamos como array JSON (e não "a|b|c") para que um client_id contendo
 * o separador não consiga colidir com outra combinação de campos.
 */
export function computeFingerprint(
  companyId: string,
  country: string,
  event: Pick<NormalizedEvent, 'clientId' | 'action' | 'amountCents' | 'occurredAt'>,
): string {
  return sha256(
    JSON.stringify([
      companyId,
      country,
      event.clientId,
      event.action,
      event.amountCents === null ? null : event.amountCents.toString(),
      event.occurredAt.getTime(),
    ]),
  );
}

function sortedMetadata(metadata: Metadata | null): Array<[string, unknown]> | null {
  if (!metadata) return null;
  return Object.keys(metadata)
    .sort()
    .map((key) => [key, metadata[key]]);
}

/**
 * Camada 1 — hash do CONTEÚDO de um event_id, para decidir entre
 * "reenvio idêntico" (200) e "mesmo id, conteúdo diferente" (409).
 *
 * Decisão: aqui o país e o metadata ENTRAM. A chave da camada 1 é
 * (empresa, event_id) sem país, então o mesmo event_id vindo de outro país
 * é conteúdo diferente → 409. Metadata diferente também é outro payload.
 */
export function computePayloadHash(country: string, event: NormalizedEvent): string {
  return sha256(
    JSON.stringify([
      country,
      event.clientId,
      event.action,
      event.amountCents === null ? null : event.amountCents.toString(),
      event.occurredAt.getTime(),
      sortedMetadata(event.metadata),
    ]),
  );
}
