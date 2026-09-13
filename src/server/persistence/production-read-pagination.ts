import 'server-only';
import { documentIdSchema, OperationError } from '@/server/operations/common';

export function productionDocumentCursor(cursor?: string) {
  if (!cursor) return undefined;
  try { return documentIdSchema.parse(Buffer.from(cursor, 'base64url').toString('utf8')); }
  catch { throw new OperationError('INVALID_CURSOR', 'Paginação inválida.'); }
}

export function productionOrderOffset(cursor?: string) {
  if (!cursor) return 0;
  if (!/^\d+$/.test(cursor) || !Number.isSafeInteger(Number(cursor))) throw new OperationError('INVALID_CURSOR', 'Paginação inválida.');
  return Number(cursor);
}
