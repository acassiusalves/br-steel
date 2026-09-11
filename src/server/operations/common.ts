import 'server-only';
import { FieldPath } from 'firebase-admin/firestore';
import { z } from 'zod';
import { canAccessPage, requireCapability } from '@/server/access/policy';
import { mcpCapabilities } from '@/lib/mcp-capabilities';
import type { AccessContext, Capability } from '@/server/access/types';
import type { OperationResult, OperationSource } from '@/types/operations';
export class OperationError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}
export const documentIdSchema = z.string().min(1).max(200).refine(id => !['.', '..'].includes(id) && !id.includes('/'), 'Identificador inválido.');
export const pageInputSchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50), cursor: z.string().max(1000).optional() });
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => { const date = new Date(`${value}T00:00:00Z`); return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value; }, 'Data inválida.');
export const dateRangeSchema = z.object({ from: dateSchema, to: dateSchema }).refine(v => v.from <= v.to, 'O início deve ser anterior ao fim.');
export function requireOperation(context: AccessContext, capability: Capability, page?: string) {
  const definition = mcpCapabilities.find(item => item.key === capability);
  if (context.actor.source === 'mcp' && definition?.write && process.env.MCP_WRITES_ENABLED !== 'true') throw new OperationError('WRITE_DISABLED', 'Escrita MCP desabilitada.', 403);
  const pages = page ? [page] : definition?.pages ?? [];
  for (const candidate of pages) {
    try { requireCapability(context, capability, candidate); return; } catch { /* Try another valid entry point. */ }
  }
  throw new OperationError('FORBIDDEN', 'Sem permissão para esta operação.', 403);
}
export function requireWebPage(context: AccessContext, page: string) {
  if (context.actor.source !== 'web' || !canAccessPage({ role: context.actor.role, active: context.active, mustChangePassword: context.mustChangePassword }, context, page)) {
    throw new OperationError('FORBIDDEN', 'Sem permissão para esta página.', 403);
  }
}
export function serialize<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value.toISOString() as T;
  if (typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(serialize) as T;
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).map(([k, v]) => [k, serialize(v)])) as T;
  return value;
}
export function result<T>(data: T, source: OperationSource = 'firestore', warnings: string[] = [], nextCursor: string | null = null, asOf = new Date().toISOString()): OperationResult<T> {
  return { data: serialize(data), source, asOf, warnings, nextCursor };
}
export async function paginateQuery(query: FirebaseFirestore.Query, input: { limit: number; cursor?: string }) {
  let page = query.orderBy(FieldPath.documentId());
  if (input.cursor) {
    let id: string;
    try { id = documentIdSchema.parse(Buffer.from(input.cursor, 'base64url').toString('utf8')); } catch { throw new OperationError('INVALID_CURSOR', 'Paginação inválida.'); }
    page = page.startAfter(id);
  }
  const snapshot = await page.limit(input.limit + 1).get();
  const docs = snapshot.docs.slice(0, input.limit);
  return { docs, nextCursor: snapshot.size > input.limit ? Buffer.from(docs.at(-1)!.id).toString('base64url') : null };
}
