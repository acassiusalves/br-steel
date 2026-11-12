import type { OperationResult } from '@/types/operations';
import type { SupplyRead } from '@/types/supply';

export type SuppliesListInput = { limit: number; cursor?: string };
export type SuppliesMovementInput = SuppliesListInput & { supplyId: string; from?: string; to?: string };
export type SupplyMovementRead = { id: string; [field: string]: unknown };

/** Preserve legacy named supply and movement fields; operations authorize callers first. */
export interface SuppliesReadRepository {
  list(input: SuppliesListInput): Promise<OperationResult<SupplyRead[]>>;
  listMovements(input: SuppliesMovementInput): Promise<OperationResult<SupplyMovementRead[]>>;
}

export type SupplyLimits = { estoqueMinimo?: number; estoqueMaximo?: number };

/**
 * Stock limits per SKU as the legacy `supplies` collection keeps them, including unnamed product rows
 * that `list` omits. Keyed by `codigo`, falling back to the document ID; the highest ID wins a tie.
 */
export interface SupplyLimitsReadRepository {
  readLimits(): Promise<Map<string, SupplyLimits>>;
}
