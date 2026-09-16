import type { SaleOrder } from '@/types/sale-order';
import type { OperationResult } from '@/types/operations';

export type SalesRange = { from: string; to: string };
export type SalesListInput = {
  limit: number;
  cursor?: string;
  from?: string;
  to?: string;
  storeId?: number;
  statusId?: number;
};
export type SalesMetric = 'totalRevenue' | 'totalSales' | 'averageTicket' | 'uniqueCustomers';
export type SalesSummary = Record<SalesMetric, number> & {
  previousPeriod: SalesRange;
  topProducts: { name: string; total: number; revenue: number }[];
  salesByState: { state: string; revenue: number }[];
  stats: Record<SalesMetric, { value: number; change: number | null }>;
};

export type ImportedOrderFilter = { requireInvoiceDetails?: boolean; requireInvoiceXml?: boolean };

/** Server-internal persistence. Operations authorize callers and validate inputs first. */
export interface SalesReadRepository {
  list(input: SalesListInput): Promise<OperationResult<SaleOrder[]>>;
  get(id: string): Promise<OperationResult<SaleOrder>>;
  summarize(input: SalesRange, options: { databaseOnly: boolean }): Promise<OperationResult<SalesSummary>>;
  readOrdersForPeriod(input: SalesRange): Promise<SaleOrder[]>;
  /** Total de pedidos salvos, incluindo os excluídos na origem — é o que a tela conta hoje. */
  count(): Promise<number>;
  /** Data `YYYY-MM-DD` do pedido mais recente, ou `null` quando não há nenhum. */
  lastOrderDate(): Promise<string | null>;
  /**
   * IDs dos pedidos que já têm itens e satisfazem as exigências fiscais pedidas. É o que decide, na
   * importação manual, quais pedidos do Bling ainda precisam ser buscados em detalhe.
   */
  importedOrderIds(filter: ImportedOrderFilter): Promise<Set<string>>;
}
