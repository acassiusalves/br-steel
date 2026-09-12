import type { OperationResult, OperationSource } from '@/types/operations';
import type { SalesRange } from './sales-contract';
export interface ProductionDemand { sku: string; description: string; orderCount: number; totalQuantitySold: number; weeklyAverage: number; corte: number; dobra: number; stockLevel?: number | null; stockSource: OperationSource; stockAsOf: string | null; stockMin?: number; stockMax?: number; }

export interface ProductionDemandReadRepository { read(input: SalesRange): Promise<OperationResult<ProductionDemand[]>>; }
