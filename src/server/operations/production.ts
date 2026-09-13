import 'server-only';
import { z } from 'zod';
import { adminDb } from '@/lib/firebase-admin';
import type { AccessContext } from '@/server/access/types';
import type { ProductionReadRepository } from '@/server/persistence/production-contract';
import { productionReadRepository } from '@/server/persistence/production';
import type { ProductionWriteRepository, WriteIdentity } from '@/server/persistence/production-write-contract';
import { productionWriteRepository } from '@/server/persistence/production-write';
import type { WriteActor } from '@/server/persistence/write-audit';
import { documentIdSchema, pageInputSchema, requireOperation, OperationError } from './common';

const page = '/producao/kanban';
const text = z.string().trim().min(1).max(200);
const order = z.number().int().min(0).max(1000000);
const priority = z.enum(['baixa', 'normal', 'alta', 'urgente']);
const assignee = z.object({ userId: documentIdSchema, userName: z.unknown().optional(), assignedAt: z.unknown().optional() }).strict();
const columnSchema = z.object({ name: text, order, color: z.string().regex(/^#[0-9a-fA-F]{6}$/) }).strict();
const updateSchema = z.object({ title: text.optional(), description: z.string().max(5000).optional(), columnId: documentIdSchema.optional(), columnOrder: order.optional(), priority: priority.optional(), assignedTo: assignee.nullable().optional(), dueDate: z.string().datetime().nullable().optional() }).strict();
const createSchema = updateSchema.omit({ columnOrder: true }).extend({ title: text, columnId: documentIdSchema, priority, createdBy: z.unknown().optional(), items: z.array(z.object({ sourceOrderId: z.union([documentIdSchema, z.number().int().positive()]), sku: text, quantity: z.number().finite().positive(), productName: z.unknown().optional(), unit: z.unknown().optional(), sourceOrderNumber: z.unknown().optional(), customerName: z.unknown().optional() }).strict()).min(1).max(400, 'O lote permite no máximo 400 itens.') }).strict();
const ordersSchema = z.array(z.object({ id: documentIdSchema, order }).strict()).min(1).max(400).refine(a => new Set(a.map(x => x.id)).size === a.length, 'IDs duplicados.');
const commentSchema = z.object({ lotId: documentIdSchema, content: z.string().trim().min(1).max(5000), author: z.unknown().optional() }).strict();
const contentSchema = z.string().trim().min(1).max(5000);

const writeActor = (context: AccessContext): WriteActor => ({
  userId: context.actor.userId, source: context.actor.source,
  clientId: context.actor.clientId ?? null, idempotencyKey: null,
});

/**
 * Reads the identity store, which stays outside the operational core and is not being migrated.
 *
 * It runs BEFORE the persistence transaction rather than inside it. A write repository must not be
 * asked to join two databases atomically, so this opens a window: a user deactivated between this
 * check and the commit still completes the write it had already been authorized for. That is an
 * accepted, recorded consequence — not something to paper over with a simulated cross-database
 * transaction. Closing it would require the identity to live in the same database as the core.
 */
export async function resolveWriteIdentity(userId: string): Promise<WriteIdentity> {
  const snapshot = await adminDb.collection('users').doc(documentIdSchema.parse(userId)).get();
  if (!snapshot.exists) throw new OperationError('NOT_FOUND', 'Registro não encontrado.', 404);
  const user = snapshot.data()!;
  if (user.active === false || user.mustChangePassword === true || !['Administrador', 'Operador'].includes(user.role)) {
    throw new OperationError('INVALID_USER', 'Responsável indisponível.', 400);
  }
  return { userId, userName: String(user.name || userId) };
}

/** Authorization remains at the operation boundary for every persistence adapter. */
export function createProductionReadOperations(repository: ProductionReadRepository) {
  return {
    async listProduction(ctx: AccessContext, input: unknown) {
      requireOperation(ctx, 'producao:read', page);
      const args = pageInputSchema.extend({ view: z.enum(['columns', 'lots', 'items', 'comments', 'orders']), lotId: documentIdSchema.optional() }).strict().parse(input);
      if ((args.view === 'items' || args.view === 'comments') && !args.lotId) throw new OperationError('INVALID_INPUT', 'Informe o lote.');
      return repository.list(args);
    },
    /** Production-authorized continuation; never reads through the commercial service. */
    async getProductionOrder(ctx: AccessContext, input: unknown) {
      requireOperation(ctx, 'producao:read', page);
      return repository.getOrder(pageInputSchema.extend({ orderId: documentIdSchema }).strict().parse(input));
    },
    async getProductionLot(ctx: AccessContext, input: unknown) {
      requireOperation(ctx, 'producao:read', page);
      return repository.getLot(pageInputSchema.extend({ lotId: documentIdSchema }).strict().parse(input));
    },
  };
}
export const { listProduction, getProductionOrder, getProductionLot } = createProductionReadOperations(productionReadRepository);

export function createProductionWriteOperations(repository: ProductionWriteRepository) {
  const write = (ctx: AccessContext) => requireOperation(ctx, 'producao:write', page);
  const change = async (ctx: AccessContext, id: unknown, content?: string) => {
    write(ctx);
    return repository.changeComment(documentIdSchema.parse(id), content,
      { isAdmin: ctx.actor.role === 'Administrador' }, writeActor(ctx));
  };
  return {
    async createColumn(ctx: AccessContext, input: unknown) {
      write(ctx); return repository.createColumn(columnSchema.parse(input), writeActor(ctx));
    },
    async updateColumn(ctx: AccessContext, id: unknown, input: unknown) {
      write(ctx); return repository.updateColumn(documentIdSchema.parse(id), columnSchema.partial().parse(input), writeActor(ctx));
    },
    async deleteColumn(ctx: AccessContext, id: unknown) {
      write(ctx); return repository.deleteColumn(documentIdSchema.parse(id), writeActor(ctx));
    },
    async reorderColumns(ctx: AccessContext, input: unknown) {
      write(ctx); return repository.reorderColumns(ordersSchema.parse(input), writeActor(ctx));
    },
    async seedDefaultColumns(ctx: AccessContext) {
      write(ctx); return repository.seedDefaultColumns(writeActor(ctx));
    },
    async createLot(ctx: AccessContext, input: unknown) {
      write(ctx);
      const parsed = createSchema.safeParse(input);
      if (!parsed.success) {
        if (parsed.error.issues.some(issue => issue.code === 'too_big' && issue.path[0] === 'items')) throw new OperationError('TOO_LARGE', 'O lote permite no máximo 400 itens.', 413);
        throw parsed.error;
      }
      const data = parsed.data;
      const author = await resolveWriteIdentity(ctx.actor.userId);
      const assignedTo = data.assignedTo ? await resolveWriteIdentity(data.assignedTo.userId) : null;
      return repository.createLot({
        title: data.title, description: data.description, columnId: data.columnId, priority: data.priority,
        dueDate: data.dueDate, items: data.items.map(item => ({ sourceOrderId: item.sourceOrderId, sku: item.sku, quantity: item.quantity })),
      }, { author, assignedTo }, writeActor(ctx));
    },
    async updateLot(ctx: AccessContext, id: unknown, input: unknown) {
      write(ctx);
      const { assignedTo, ...rest } = updateSchema.parse(input);
      const resolved = assignedTo ? await resolveWriteIdentity(assignedTo.userId) : assignedTo;
      return repository.updateLot(documentIdSchema.parse(id), rest, resolved, writeActor(ctx));
    },
    async reorderLotsInColumn(ctx: AccessContext, columnId: unknown, input: unknown) {
      write(ctx); return repository.reorderLotsInColumn(documentIdSchema.parse(columnId), ordersSchema.parse(input), writeActor(ctx));
    },
    async deleteLot(ctx: AccessContext, id: unknown) {
      write(ctx); return repository.deleteLot(documentIdSchema.parse(id), writeActor(ctx));
    },
    async createComment(ctx: AccessContext, input: unknown) {
      write(ctx);
      const data = commentSchema.parse(input);
      const author = await resolveWriteIdentity(ctx.actor.userId);
      return repository.createComment({ lotId: data.lotId, content: data.content }, author, writeActor(ctx));
    },
    updateComment: (ctx: AccessContext, id: unknown, content: unknown) => change(ctx, id, contentSchema.parse(content)),
    deleteComment: (ctx: AccessContext, id: unknown) => change(ctx, id),
  };
}
export const { createColumn, updateColumn, deleteColumn, reorderColumns, seedDefaultColumns,
  createLot, updateLot, reorderLotsInColumn, deleteLot, createComment, updateComment, deleteComment } =
  createProductionWriteOperations(productionWriteRepository);
