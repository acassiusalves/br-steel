import { OperationError } from '@/server/operations/common';
export function stockOffset(cursor?: string): number {
  if (!cursor) return 0;
  if (!/^\d+$/.test(cursor) || !Number.isSafeInteger(Number(cursor))) throw new OperationError('INVALID_CURSOR', 'Paginação inválida.');
  return Number(cursor);
}
