import type { OperationResult } from '@/types/operations';

export type ProductionView = 'columns' | 'lots' | 'items' | 'comments' | 'orders';
export type ProductionPageInput = { limit: number; cursor?: string };
export type ProductionListInput = ProductionPageInput & { view: ProductionView; lotId?: string };
export type ProductionOrderInput = ProductionPageInput & { orderId: string };
export type ProductionLotInput = ProductionPageInput & { lotId: string };
export type ProductionRecord = { id: string; [field: string]: unknown };
export type ProductionOrderItem = { id: unknown; codigo?: unknown; descricao?: unknown; quantidade?: unknown; unidade: unknown };
export type ProductionOrder = ProductionRecord & { numero?: unknown; itens: ProductionOrderItem[] };
export type ProductionLotDetail = { lot: ProductionRecord; items: ProductionRecord[] };

/** Internal persistence; the operations authorize callers and validate inputs first. */
export interface ProductionReadRepository {
  list(input: ProductionListInput): Promise<OperationResult<ProductionRecord[]>>;
  getOrder(input: ProductionOrderInput): Promise<OperationResult<ProductionOrder>>;
  getLot(input: ProductionLotInput): Promise<OperationResult<ProductionLotDetail>>;
}
