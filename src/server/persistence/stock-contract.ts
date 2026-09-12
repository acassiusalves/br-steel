import type { OperationResult } from '@/types/operations';
import type { ProductStock } from '@/types/product-stock';
export interface StockListInput { limit: number; cursor?: string; sku?: string; }
/** Internal database reads. Operations authorize before calling these methods. */
export interface StockReadRepository {
  snapshot(): Promise<OperationResult<ProductStock[]>>;
  list(input: StockListInput): Promise<OperationResult<ProductStock[]>>;
}
