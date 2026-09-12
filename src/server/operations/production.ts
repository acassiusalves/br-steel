import 'server-only';
import { z } from 'zod';
import { adminDb } from '@/lib/firebase-admin';
import type { AccessContext } from '@/server/access/types';
import { documentIdSchema, pageInputSchema, paginateQuery, requireOperation, result, serialize, OperationError } from './common';
const page = '/producao/kanban';
const text = z.string().trim().min(1).max(200);
const order = z.number().int().min(0).max(1000000);
const priority = z.enum(['baixa', 'normal', 'alta', 'urgente']);
const assignee = z.object({ userId: documentIdSchema, userName: z.unknown().optional(), assignedAt: z.unknown().optional() }).strict();
const columnSchema = z.object({ name: text, order, color: z.string().regex(/^#[0-9a-fA-F]{6}$/) }).strict();
const updateSchema = z.object({ title: text.optional(), description: z.string().max(5000).optional(), columnId: documentIdSchema.optional(), columnOrder: order.optional(), priority: priority.optional(), assignedTo: assignee.nullable().optional(), dueDate: z.string().datetime().nullable().optional() }).strict();
const createSchema = updateSchema.omit({ columnOrder: true }).extend({ title: text, columnId: documentIdSchema, priority, createdBy: z.unknown().optional(), items: z.array(z.object({ sourceOrderId: z.union([documentIdSchema, z.number().int().positive()]), sku: text, quantity: z.number().finite().positive(), productName: z.unknown().optional(), unit: z.unknown().optional(), sourceOrderNumber: z.unknown().optional(), customerName: z.unknown().optional() }).strict()).min(1).max(400, 'O lote permite no máximo 400 itens.') }).strict();
const ordersSchema = z.array(z.object({ id: documentIdSchema, order }).strict()).min(1).max(400).refine(a => new Set(a.map(x => x.id)).size === a.length, 'IDs duplicados.');
const ref = (collection: string, id: unknown) => adminDb.collection(collection).doc(documentIdSchema.parse(id));
const missing = () => new OperationError('NOT_FOUND', 'Registro não encontrado.', 404);
function exists(s: FirebaseFirestore.DocumentSnapshot) { if (!s.exists) throw missing(); return s.data()!; }
const write = (ctx: AccessContext) => requireOperation(ctx, 'producao:write', page);
async function identity(tx: FirebaseFirestore.Transaction, userId: string) {
  const user = exists(await tx.get(ref('users', userId)));
  if (user.active === false || user.mustChangePassword === true || !['Administrador', 'Operador'].includes(user.role)) throw new OperationError('INVALID_USER', 'Responsável indisponível.', 400);
  return { userId, userName: String(user.name || userId) };
}
function projectOrder(doc: FirebaseFirestore.DocumentSnapshot) {
  const d = exists(doc);
  return { id: doc.id, numero: d.numero, itens: (Array.isArray(d.itens) ? d.itens : []).map((i: Record<string, unknown>, index: number) => ({ id: i.id ?? index, codigo: i.codigo, descricao: i.descricao, quantidade: i.quantidade, unidade: i.unidade || 'UN' })) };
}
function project(doc: FirebaseFirestore.DocumentSnapshot, view: string) {
  const d = exists(doc);
  if (view === 'orders') return projectOrder(doc);
  const fields: Record<string, string[]> = {
    columns: ['name', 'order', 'color', 'createdAt', 'updatedAt'],
    lots: ['lotNumber', 'title', 'description', 'columnId', 'columnOrder', 'assignedTo', 'priority', 'linkedOrderIds', 'totalItems', 'totalSkus', 'dueDate', 'createdAt', 'updatedAt', 'createdBy'],
    items: ['lotId', 'sku', 'productName', 'quantity', 'unit', 'sourceOrderId', 'sourceOrderNumber', 'createdAt'],
    comments: ['lotId', 'content', 'author', 'createdAt', 'updatedAt'],
  };
  const data: Record<string, unknown> = { id: doc.id };
  for (const key of fields[view]) if (d[key] !== undefined) data[key] = d[key];
  if (view === 'items') data.customerName = '';
  // Nested identities are allowlisted too, including legacy documents.
  for (const key of ['assignedTo', 'createdBy', 'author']) if (data[key]) {
    const u = data[key] as Record<string, unknown>;
    data[key] = { userId: u.userId, userName: u.userName, ...(key === 'assignedTo' ? { assignedAt: u.assignedAt } : {}) };
  }
  return data;
}
export async function listProduction(ctx: AccessContext, input: unknown) {
  requireOperation(ctx, 'producao:read', page);
  const args = pageInputSchema.extend({ view: z.enum(['columns', 'lots', 'items', 'comments', 'orders']), lotId: documentIdSchema.optional() }).strict().parse(input);
  const collections = { columns: 'productionColumns', lots: 'productionLots', items: 'productionLotItems', comments: 'productionComments', orders: 'salesOrders' };
  let query: FirebaseFirestore.Query = adminDb.collection(collections[args.view]);
  if (args.view === 'items' || args.view === 'comments') {
    if (!args.lotId) throw new OperationError('INVALID_INPUT', 'Informe o lote.');
    exists(await ref('productionLots', args.lotId).get());
    query = query.where('lotId', '==', args.lotId);
  }
  const { docs, nextCursor } = await paginateQuery(query, args);
  return result(serialize(docs.map(d => project(d, args.view))), 'firestore', [], nextCursor);
}
/** Production-authorized item continuation; never reads through the commercial service. */
export async function getProductionOrder(ctx: AccessContext, input: unknown) {
  requireOperation(ctx, 'producao:read', page);
  const args = pageInputSchema.extend({ orderId: documentIdSchema }).strict().parse(input);
  let offset = 0;
  if (args.cursor) {
    if (!/^\d+$/.test(args.cursor) || !Number.isSafeInteger(Number(args.cursor))) throw new OperationError('INVALID_CURSOR', 'Paginação inválida.');
    offset = Number(args.cursor);
  }
  const projected = projectOrder(await ref('salesOrders', args.orderId).get());
  const nextCursor = offset + args.limit < projected.itens.length ? String(offset + args.limit) : null;
  return result({ ...projected, itens: projected.itens.slice(offset, offset + args.limit) }, 'firestore', [], nextCursor);
}
export async function getProductionLot(ctx: AccessContext, input: unknown) {
  requireOperation(ctx, 'producao:read', page);
  const args = pageInputSchema.extend({ lotId: documentIdSchema }).strict().parse(input);
  const lot = await ref('productionLots', args.lotId).get(); exists(lot);
  const items = await listProduction(ctx, { ...args, view: 'items' });
  const projected: Record<string, unknown> = project(lot, 'lots');
  const linked = Array.isArray(projected.linkedOrderIds) ? projected.linkedOrderIds : [];
  projected.linkedOrderIds = linked.slice(0, 100);
  return result(serialize({ lot: projected, items: items.data }), items.source,
    [...items.warnings, ...(linked.length > 100 ? ['Pedidos vinculados limitados a 100 entradas.'] : [])], items.nextCursor, items.asOf);
}
export async function createColumn(ctx: AccessContext, input: unknown) {
  write(ctx); const data = columnSchema.parse(input); const r = adminDb.collection('productionColumns').doc(); const now = new Date().toISOString();
  await r.create({ ...data, createdAt: now, updatedAt: now }); return result({ id: r.id });
}
export async function updateColumn(ctx: AccessContext, id: unknown, input: unknown) {
  write(ctx); const data = columnSchema.partial().parse(input); const r = ref('productionColumns', id);
  await adminDb.runTransaction(async tx => { exists(await tx.get(r)); tx.update(r, { ...data, updatedAt: new Date().toISOString() }); }); return result(null);
}
export async function deleteColumn(ctx: AccessContext, id: unknown) {
  write(ctx); const r = ref('productionColumns', id);
  await adminDb.runTransaction(async tx => { exists(await tx.get(r)); const lots = await tx.get(adminDb.collection('productionLots').where('columnId', '==', r.id).limit(1)); if (!lots.empty) throw new OperationError('COLUMN_NOT_EMPTY', 'Mova os lotes antes de excluir a coluna.'); tx.delete(r); }); return result(null);
}
export async function reorderColumns(ctx: AccessContext, input: unknown) {
  write(ctx); const data = ordersSchema.parse(input);
  await adminDb.runTransaction(async tx => { const docs = await tx.getAll(...data.map(x => ref('productionColumns', x.id))); docs.forEach(exists); data.forEach((x, i) => tx.update(docs[i].ref, { order: x.order, updatedAt: new Date().toISOString() })); }); return result(null);
}
export async function seedDefaultColumns(ctx: AccessContext) {
  write(ctx);
  await adminDb.runTransaction(async tx => {
    const lock = ref('operationsMetadata', 'production-columns'); await tx.get(lock);
    const columns = await tx.get(adminDb.collection('productionColumns').limit(1)); if (!columns.empty) return;
    const now = new Date().toISOString();
    ['Fila', 'Em Produção', 'Concluído'].forEach((name, order) => tx.set(ref('productionColumns', `default-${order}`), { name, order, color: ['#6b7280', '#f59e0b', '#22c55e'][order], createdAt: now, updatedAt: now }));
    tx.set(lock, { initializedAt: now });
  }); return result(null);
}
export async function createLot(ctx: AccessContext, input: unknown) {
  write(ctx);
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    if (parsed.error.issues.some(issue => issue.code === 'too_big' && issue.path[0] === 'items')) throw new OperationError('TOO_LARGE', 'O lote permite no máximo 400 itens.', 413);
    throw parsed.error;
  }
  const data = parsed.data; const lot = adminDb.collection('productionLots').doc(); const year = new Date().getUTCFullYear();
  const created = await adminDb.runTransaction(async tx => {
    const author = await identity(tx, ctx.actor.userId);
    const assignedTo = data.assignedTo ? { ...await identity(tx, data.assignedTo.userId), assignedAt: new Date().toISOString() } : null;
    const column = ref('productionColumns', data.columnId); exists(await tx.get(column));
    const linkedOrderIds = [...new Set(data.items.map(i => String(i.sourceOrderId)))];
    const orders = await tx.getAll(...linkedOrderIds.map(id => ref('salesOrders', id)));
    const requested = new Map<string, number>();
    const items = data.items.map(i => {
      const sale = exists(orders[linkedOrderIds.indexOf(String(i.sourceOrderId))]);
      const matches = (Array.isArray(sale.itens) ? sale.itens : []).filter((s: Record<string, unknown>) => s.codigo === i.sku);
      if (!matches.length) throw new OperationError('INVALID_ITEM', 'SKU não pertence ao pedido.');
      const key = `${i.sourceOrderId}:${i.sku}`; const quantity = (requested.get(key) || 0) + i.quantity; requested.set(key, quantity);
      if (quantity > matches.reduce((sum: number, s: Record<string, unknown>) => sum + Number(s.quantidade || 0), 0)) throw new OperationError('INVALID_QUANTITY', 'Quantidade excede o pedido.');
      return { lotId: lot.id, sku: i.sku, quantity: i.quantity, productName: String(matches[0].descricao || i.sku), unit: String(matches[0].unidade || 'UN'), sourceOrderId: i.sourceOrderId, sourceOrderNumber: String(sale.numero || sale.id), customerName: '' };
    });
    const counter = ref('operationsMetadata', `production-lots-${year}`); const counterDoc = await tx.get(counter);
    // Bootstrap once from existing numbers to avoid collisions after migrating legacy lots.
    const existingLots = await tx.get(counterDoc.exists ? adminDb.collection('productionLots').where('columnId', '==', column.id) : adminDb.collection('productionLots'));
    let sequence = Number(counterDoc.data()?.sequence || 0);
    let maxOrder = -1;
    existingLots.docs.forEach(d => { const l = d.data(); const match = String(l.lotNumber || '').match(new RegExp(`^LOT-${year}-(\\d+)$`)); if (match) sequence = Math.max(sequence, Number(match[1])); if (l.columnId === column.id) maxOrder = Math.max(maxOrder, Number(l.columnOrder || 0)); });
    sequence++; const lotNumber = `LOT-${year}-${String(sequence).padStart(4, '0')}`; const now = new Date().toISOString();
    tx.set(counter, { sequence });
    // Touch the column so create/delete and concurrent appends serialize on its document.
    tx.update(column, { updatedAt: now });
    tx.create(lot, { title: data.title, description: data.description || null, priority: data.priority, columnId: column.id, columnOrder: maxOrder + 1, dueDate: data.dueDate || null, assignedTo, createdBy: author, linkedOrderIds, totalItems: items.reduce<number>((sum, i) => sum + i.quantity, 0), totalSkus: new Set(items.map(i => i.sku)).size, lotNumber, createdAt: now, updatedAt: now });
    items.forEach(i => tx.create(adminDb.collection('productionLotItems').doc(), { ...i, createdAt: now }));
    return { id: lot.id, lotNumber };
  }); return result(created);
}
export async function updateLot(ctx: AccessContext, id: unknown, input: unknown) {
  write(ctx); const data = updateSchema.parse(input); const r = ref('productionLots', id);
  await adminDb.runTransaction(async tx => {
    const old = exists(await tx.get(r));
    const assignedTo = data.assignedTo ? { ...await identity(tx, data.assignedTo.userId), assignedAt: new Date().toISOString() } : data.assignedTo;
    const column = ref('productionColumns', data.columnId || old.columnId); exists(await tx.get(column));
    const now = new Date().toISOString(); tx.update(column, { updatedAt: now });
    tx.update(r, serialize({ ...data, ...(assignedTo !== undefined ? { assignedTo } : {}), updatedAt: now }));
  }); return result(null);
}
export async function reorderLotsInColumn(ctx: AccessContext, columnId: unknown, input: unknown) {
  write(ctx); const data = ordersSchema.parse(input); const column = ref('productionColumns', columnId);
  await adminDb.runTransaction(async tx => { exists(await tx.get(column)); const docs = await tx.getAll(...data.map(x => ref('productionLots', x.id))); docs.forEach(d => { if (exists(d).columnId !== column.id) throw new OperationError('INVALID_COLUMN', 'Lote não pertence à coluna.'); }); data.forEach((x, i) => tx.update(docs[i].ref, { columnOrder: x.order, updatedAt: new Date().toISOString() })); }); return result(null);
}
export async function deleteLot(ctx: AccessContext, id: unknown) {
  write(ctx); const r = ref('productionLots', id);
  await adminDb.runTransaction(async tx => {
    exists(await tx.get(r));
    const items = await tx.get(adminDb.collection('productionLotItems').where('lotId', '==', r.id).limit(500));
    const comments = await tx.get(adminDb.collection('productionComments').where('lotId', '==', r.id).limit(500));
    if (items.size + comments.size > 498) throw new OperationError('TOO_LARGE', 'Exclua comentários antes de remover este lote; limite de 498 registros associados.');
    items.docs.forEach(d => tx.delete(d.ref)); comments.docs.forEach(d => tx.delete(d.ref)); tx.delete(r);
  }); return result(null);
}
export async function createComment(ctx: AccessContext, input: unknown) {
  write(ctx); const data = z.object({ lotId: documentIdSchema, content: z.string().trim().min(1).max(5000), author: z.unknown().optional() }).strict().parse(input); const r = adminDb.collection('productionComments').doc();
  await adminDb.runTransaction(async tx => { const lot = ref('productionLots', data.lotId); exists(await tx.get(lot)); const author = await identity(tx, ctx.actor.userId); const now = new Date().toISOString(); tx.update(lot, { updatedAt: now }); tx.create(r, { lotId: lot.id, content: data.content, author, createdAt: now }); }); return result({ id: r.id });
}
async function changeComment(ctx: AccessContext, id: unknown, content?: string) {
  write(ctx); const r = ref('productionComments', id);
  await adminDb.runTransaction(async tx => { const comment = exists(await tx.get(r)); exists(await tx.get(ref('productionLots', comment.lotId))); if (comment.author?.userId !== ctx.actor.userId && ctx.actor.role !== 'Administrador') throw new OperationError('FORBIDDEN', 'Somente o autor pode alterar o comentário.', 403); if (content === undefined) tx.delete(r); else tx.update(r, { content, updatedAt: new Date().toISOString() }); }); return result(null);
}
export async function updateComment(ctx: AccessContext, id: unknown, content: unknown) { return changeComment(ctx, id, z.string().trim().min(1).max(5000).parse(content)); }
export async function deleteComment(ctx: AccessContext, id: unknown) { return changeComment(ctx, id); }
