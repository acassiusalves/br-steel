import type { OperationResult, OperationSource } from '@/types/operations';
import type { SalesRange } from './sales-contract';

/** Um ponto da série semanal. `open` marca a semana corrente, que é parcial por definição. */
export interface HistoryPoint { week: string; units: number; orders: number; open?: true }

export interface ProductionDemand { sku: string; description: string; orderCount: number; totalQuantitySold: number; weeklyAverage: number; corte: number; dobra: number; stockLevel?: number | null; stockSource: OperationSource; stockAsOf: string | null; stockMin?: number; stockMax?: number; }

export interface ProductionDemandReadRepository { read(input: SalesRange): Promise<OperationResult<ProductionDemand[]>>; }
