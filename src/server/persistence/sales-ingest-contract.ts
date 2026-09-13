export type SourceOrder = Record<string, unknown> & { id: string | number };
export type IngestCounts = { count: number; created: number; updated: number };

/** Server-internal persistence for ingestion. Callers authorize and validate before reaching it. */
export interface SalesIngestRepository {
  upsertOrders(orders: SourceOrder[]): Promise<IngestCounts>;
  /** Last observation wins per SKU; an unknown physical balance stays null, never zero. */
  applyStockObservation(sku: string, observation: Record<string, unknown>): Promise<void>;
  /** Logical deletion, distinct from an absent record. */
  markOrderDeleted(orderId: string, at: string): Promise<void>;
}