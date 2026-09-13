import type { OperationResult } from '@/types/operations';
import { OperationError } from '@/server/operations/common';
import type { WriteActor } from './write-audit';

export type SupplyFields = {
  nome: string; codigo: string; gtin: string; unidade: string;
  precoCusto: number; estoqueMinimo: number; estoqueMaximo: number; tempoEntrega: number;
};
export type MovementInput = {
  supplyId: string; type: 'entrada' | 'saida'; quantity: number; unitCost?: number; notes?: string;
};

/**
 * Compares whatever pair is present, so a partial update is checked against the values already stored.
 * Non-numeric legacy values are ignored here exactly as before; they fail later, where balance is read.
 */
export function validateLimits(data: { estoqueMinimo?: unknown; estoqueMaximo?: unknown }) {
  if (typeof data.estoqueMinimo === 'number' && typeof data.estoqueMaximo === 'number'
    && data.estoqueMinimo > data.estoqueMaximo) {
    throw new OperationError('INVALID_LIMITS', 'O estoque mínimo não pode ser maior que o máximo.');
  }
}

/** Server-internal persistence. Operations authorize callers and validate inputs first. */
export interface SuppliesWriteRepository {
  /** Up to two ids, so the caller can tell "missing" from "ambiguous" without a second query. */
  findBySku(sku: string): Promise<string[]>;
  create(input: SupplyFields, actor: WriteActor): Promise<OperationResult<{ id: string }>>;
  update(id: string, input: Partial<SupplyFields>, actor: WriteActor): Promise<OperationResult<{ id: string }>>;
  remove(id: string, actor: WriteActor): Promise<OperationResult<{ id: string }>>;
  recordMovement(input: MovementInput, actor: WriteActor): Promise<OperationResult<{ id: string; newStock: number }>>;
}
