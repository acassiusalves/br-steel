export type SourceOrder = Record<string, unknown> & { id: string | number };
export type IngestCounts = { count: number; created: number; updated: number };

/** Server-internal persistence for ingestion. Callers authorize and validate before reaching it. */
export interface SalesIngestRepository {
  upsertOrders(orders: SourceOrder[]): Promise<IngestCounts>;
  /**
   * Última observação vence por SKU na projeção `stockUpdates`; um saldo físico desconhecido continua
   * nulo, nunca zero. A implementação Firestore também registra cada mudança em `stockObservations`.
   */
  applyStockObservation(sku: string, observation: Record<string, unknown>): Promise<void>;
  /** Logical deletion, distinct from an absent record. */
  markOrderDeleted(orderId: string, at: string): Promise<void>;
}