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
