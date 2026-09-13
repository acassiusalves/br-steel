import 'server-only';
import { adminDb } from '@/lib/firebase-admin';
import { OperationError, documentIdSchema, result, serialize } from '@/server/operations/common';
import type { ColumnInput, LotInput, LotUpdate, OrderInput, ProductionWriteRepository, WriteIdentity } from './production-write-contract';
import type { WriteActor } from './write-audit';

const ref = (collection: string, id: unknown) => adminDb.collection(collection).doc(documentIdSchema.parse(id));
const missing = () => new OperationError('NOT_FOUND', 'Registro não encontrado.', 404);
function exists(snapshot: FirebaseFirestore.DocumentSnapshot) { if (!snapshot.exists) throw missing(); return snapshot.data()!; }
const now = () => new Date().toISOString();

async function createColumn(input: ColumnInput) {
  const r = adminDb.collection('productionColumns').doc(), at = now();
  await r.create({ ...input, createdAt: at, updatedAt: at });
  return result({ id: r.id });
}

async function updateColumn(id: string, input: Partial<ColumnInput>) {
  const r = ref('productionColumns', id);
  await adminDb.runTransaction(async tx => { exists(await tx.get(r)); tx.update(r, { ...input, updatedAt: now() }); });
  return result(null);
}

async function deleteColumn(id: string) {
  const r = ref('productionColumns', id);
  await adminDb.runTransaction(async tx => {
    exists(await tx.get(r));
    const lots = await tx.get(adminDb.collection('productionLots').where('columnId', '==', r.id).limit(1));
    if (!lots.empty) throw new OperationError('COLUMN_NOT_EMPTY', 'Mova os lotes antes de excluir a coluna.');
    tx.delete(r);
  });
  return result(null);
}

async function reorderColumns(input: OrderInput[]) {
  await adminDb.runTransaction(async tx => {
    const docs = await tx.getAll(...input.map(x => ref('productionColumns', x.id)));
    docs.forEach(exists);
    input.forEach((x, i) => tx.update(docs[i].ref, { order: x.order, updatedAt: now() }));
  });
  return result(null);
}

async function seedDefaultColumns() {
  await adminDb.runTransaction(async tx => {
    const lock = ref('operationsMetadata', 'production-columns'); await tx.get(lock);
    const columns = await tx.get(adminDb.collection('productionColumns').limit(1)); if (!columns.empty) return;
    const at = now();
    ['Fila', 'Em Produção', 'Concluído'].forEach((name, order) => tx.set(ref('productionColumns', `default-${order}`),
      { name, order, color: ['#6b7280', '#f59e0b', '#22c55e'][order], createdAt: at, updatedAt: at }));
    tx.set(lock, { initializedAt: at });
  });
  return result(null);
}

async function createLot(input: LotInput, identities: { author: WriteIdentity; assignedTo: WriteIdentity | null }) {
  const lot = adminDb.collection('productionLots').doc(), year = new Date().getUTCFullYear();
  // Highest number already minted this year, read outside the transaction so migrated lots cannot
  // collide with the counter without enlarging the contended read set.
  const pattern = new RegExp(`^LOT-${year}-(\\d+)$`);
  const allLots = (await adminDb.collection('productionLots').get()).docs.map(doc => doc.data());
  const bootstrapSeed = allLots.reduce((highest, lot) => {
    const match = String(lot.lotNumber || '').match(pattern);
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0);
  // Read here rather than inside the transaction on purpose. Querying this column's lots while also
  // creating one makes two concurrent transactions invalidate each other's read set on every attempt,
  // which is what exhausted the retries. The cost is that two simultaneous creations can land on the
  // same columnOrder: a display tie any reorder fixes, unlike a duplicate lot number, which is why the
  // counter stays inside the transaction.
  const seedOrder = allLots.reduce((highest, lot) =>
    lot.columnId === input.columnId ? Math.max(highest, Number(lot.columnOrder || 0)) : highest, -1);
  // The annual counter is a single hot document and the bootstrap path scans every lot, so two people
  // creating a lot at the same time genuinely contend. Five attempts — the default — is thin for that:
  // the loser exhausts them and surfaces "Transaction is invalid or closed" as if it were a real error.
  const created = await adminDb.runTransaction(async tx => {
    const assignedTo = identities.assignedTo ? { ...identities.assignedTo, assignedAt: now() } : null;
    const column = ref('productionColumns', input.columnId); exists(await tx.get(column));
    const linkedOrderIds = [...new Set(input.items.map(i => String(i.sourceOrderId)))];
    const orders = await tx.getAll(...linkedOrderIds.map(id => ref('salesOrders', id)));
    const requested = new Map<string, number>();
    const items = input.items.map(i => {
      const sale = exists(orders[linkedOrderIds.indexOf(String(i.sourceOrderId))]);
      const matches = (Array.isArray(sale.itens) ? sale.itens : []).filter((s: Record<string, unknown>) => s.codigo === i.sku);
      if (!matches.length) throw new OperationError('INVALID_ITEM', 'SKU não pertence ao pedido.');
      const key = `${i.sourceOrderId}:${i.sku}`; const quantity = (requested.get(key) || 0) + i.quantity; requested.set(key, quantity);
      if (quantity > matches.reduce((sum: number, s: Record<string, unknown>) => sum + Number(s.quantidade || 0), 0)) throw new OperationError('INVALID_QUANTITY', 'Quantidade excede o pedido.');
      return { lotId: lot.id, sku: i.sku, quantity: i.quantity, productName: String(matches[0].descricao || i.sku), unit: String(matches[0].unidade || 'UN'), sourceOrderId: i.sourceOrderId, sourceOrderNumber: String(sale.numero || sale.id), customerName: '' };
    });
    const counter = ref('operationsMetadata', `production-lots-${year}`); const counterDoc = await tx.get(counter);
    // Only the lots of this column are read inside the transaction. The legacy bootstrap scan used to
    // live here too, and reading the whole collection while also writing to it made two concurrent
    // creations invalidate each other's read set on every attempt. It is computed before the
    // transaction now and folded in with Math.max, so a stale seed can never lower the sequence.
    const sequence = Math.max(Number(counterDoc.data()?.sequence || 0), bootstrapSeed) + 1;
    const maxOrder = seedOrder; const lotNumber = `LOT-${year}-${String(sequence).padStart(4, '0')}`; const at = now();
    tx.set(counter, { sequence });
    // Touch the column so create/delete and concurrent appends serialize on its document.
    tx.update(column, { updatedAt: at });
    tx.create(lot, { title: input.title, description: input.description || null, priority: input.priority, columnId: column.id, columnOrder: maxOrder + 1, dueDate: input.dueDate || null, assignedTo, createdBy: identities.author, linkedOrderIds, totalItems: items.reduce<number>((sum, i) => sum + i.quantity, 0), totalSkus: new Set(items.map(i => i.sku)).size, lotNumber, createdAt: at, updatedAt: at });
    items.forEach(i => tx.create(adminDb.collection('productionLotItems').doc(), { ...i, createdAt: at }));
    return { id: lot.id, lotNumber };
  }, { maxAttempts: 10 });
  return result(created);
}

async function updateLot(id: string, input: LotUpdate, assigned: WriteIdentity | null | undefined) {
  const r = ref('productionLots', id);
  await adminDb.runTransaction(async tx => {
    const old = exists(await tx.get(r));
    const assignedTo = assigned ? { ...assigned, assignedAt: now() } : assigned;
    const column = ref('productionColumns', input.columnId || old.columnId); exists(await tx.get(column));
    const at = now(); tx.update(column, { updatedAt: at });
    tx.update(r, serialize({ ...input, ...(assignedTo !== undefined ? { assignedTo } : {}), updatedAt: at }));
  });
  return result(null);
}

async function reorderLotsInColumn(columnId: string, input: OrderInput[]) {
  const column = ref('productionColumns', columnId);
  await adminDb.runTransaction(async tx => {
    exists(await tx.get(column));
    const docs = await tx.getAll(...input.map(x => ref('productionLots', x.id)));
    docs.forEach(d => { if (exists(d).columnId !== column.id) throw new OperationError('INVALID_COLUMN', 'Lote não pertence à coluna.'); });
    input.forEach((x, i) => tx.update(docs[i].ref, { columnOrder: x.order, updatedAt: now() }));
  });
  return result(null);
}

async function deleteLot(id: string) {
  const r = ref('productionLots', id);
  await adminDb.runTransaction(async tx => {
    exists(await tx.get(r));
    const items = await tx.get(adminDb.collection('productionLotItems').where('lotId', '==', r.id).limit(500));
    const comments = await tx.get(adminDb.collection('productionComments').where('lotId', '==', r.id).limit(500));
    if (items.size + comments.size > 498) throw new OperationError('TOO_LARGE', 'Exclua comentários antes de remover este lote; limite de 498 registros associados.');
    items.docs.forEach(d => tx.delete(d.ref)); comments.docs.forEach(d => tx.delete(d.ref)); tx.delete(r);
  });
  return result(null);
}

async function createComment(input: { lotId: string; content: string }, author: WriteIdentity) {
  const r = adminDb.collection('productionComments').doc();
  await adminDb.runTransaction(async tx => {
    const lot = ref('productionLots', input.lotId); exists(await tx.get(lot));
    const at = now(); tx.update(lot, { updatedAt: at });
    tx.create(r, { lotId: lot.id, content: input.content, author, createdAt: at });
  });
  return result({ id: r.id });
}

async function changeComment(id: string, content: string | undefined, options: { isAdmin: boolean }, actor: WriteActor) {
  const r = ref('productionComments', id);
  await adminDb.runTransaction(async tx => {
    const comment = exists(await tx.get(r));
    exists(await tx.get(ref('productionLots', comment.lotId)));
    if (comment.author?.userId !== actor.userId && !options.isAdmin) throw new OperationError('FORBIDDEN', 'Somente o autor pode alterar o comentário.', 403);
    if (content === undefined) tx.delete(r); else tx.update(r, { content, updatedAt: now() });
  });
  return result(null);
}

export const firestoreProductionWriteRepository: ProductionWriteRepository = {
  createColumn, updateColumn, deleteColumn, reorderColumns, seedDefaultColumns,
  createLot, updateLot, reorderLotsInColumn, deleteLot, createComment, changeComment,
};
