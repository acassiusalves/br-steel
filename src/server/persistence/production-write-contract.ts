import type { OperationResult } from '@/types/operations';
import type { WriteActor } from './write-audit';

export type WriteIdentity = { userId: string; userName: string };
export type Priority = 'baixa' | 'normal' | 'alta' | 'urgente';
export type ColumnInput = { name: string; order: number; color: string };
export type OrderInput = { id: string; order: number };
export type LotItemInput = { sourceOrderId: string | number; sku: string; quantity: number };
export type LotInput = {
  title: string; description?: string; columnId: string; priority: Priority;
  dueDate?: string | null; items: LotItemInput[];
};
export type LotUpdate = {
  title?: string; description?: string; columnId?: string; columnOrder?: number;
  priority?: Priority; dueDate?: string | null;
};

/**
 * Server-internal persistence. Operations authorize callers, validate inputs and resolve identities
 * first: no adapter reads the identity store, because users are not part of the operational core.
 */
export interface ProductionWriteRepository {
  createColumn(input: ColumnInput, actor: WriteActor): Promise<OperationResult<{ id: string }>>;
  updateColumn(id: string, input: Partial<ColumnInput>, actor: WriteActor): Promise<OperationResult<null>>;
  deleteColumn(id: string, actor: WriteActor): Promise<OperationResult<null>>;
  reorderColumns(input: OrderInput[], actor: WriteActor): Promise<OperationResult<null>>;
  seedDefaultColumns(actor: WriteActor): Promise<OperationResult<null>>;
  createLot(input: LotInput, identities: { author: WriteIdentity; assignedTo: WriteIdentity | null },
    actor: WriteActor): Promise<OperationResult<{ id: string; lotNumber: string }>>;
  /** `assignedTo` undefined leaves the assignment untouched; null clears it. */
  updateLot(id: string, input: LotUpdate, assignedTo: WriteIdentity | null | undefined,
    actor: WriteActor): Promise<OperationResult<null>>;
  reorderLotsInColumn(columnId: string, input: OrderInput[], actor: WriteActor): Promise<OperationResult<null>>;
  deleteLot(id: string, actor: WriteActor): Promise<OperationResult<null>>;
  createComment(input: { lotId: string; content: string }, author: WriteIdentity,
    actor: WriteActor): Promise<OperationResult<{ id: string }>>;
  /** `content` undefined deletes the comment. `isAdmin` overrides the authorship check. */
  changeComment(id: string, content: string | undefined, options: { isAdmin: boolean },
    actor: WriteActor): Promise<OperationResult<null>>;
}
