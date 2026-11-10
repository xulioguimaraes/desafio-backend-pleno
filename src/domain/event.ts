export const EVENT_STATUSES = ['PENDING', 'PROCESSING', 'PROCESSED', 'FAILED'] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export type MetadataValue = string | number | boolean | null;
export type Metadata = Record<string, MetadataValue>;

/** Evento já validado e normalizado (saída do validador, entrada do use-case). */
export interface NormalizedEvent {
  eventId: string;
  action: string;
  clientId: string;
  /** Centavos inteiros; null para ações não financeiras (LOGIN). */
  amountCents: bigint | null;
  occurredAt: Date;
  metadata: Metadata | null;
}
