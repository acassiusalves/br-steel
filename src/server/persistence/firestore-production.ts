import 'server-only';
import { FieldPath } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { paginateQuery, result, OperationError } from '@/server/operations/common';
import type { ProductionPageInput, ProductionReadRepository } from './production-contract';
import { projectProductionOrder, projectProductionRecord } from './production-read-projection';
import { productionDocumentCursor, productionOrderOffset } from './production-read-pagination';

const collections = { columns: 'productionColumns', lots: 'productionLots', items: 'productionLotItems', comments: 'productionComments', orders: 'salesOrders' };
function exists(doc: FirebaseFirestore.DocumentSnapshot) {
  if (!doc.exists) throw new OperationError('NOT_FOUND', 'Registro não encontrado.', 404);
  return doc.data()!;
}

async function transactionPage(tx: FirebaseFirestore.Transaction, query: FirebaseFirestore.Query, input: ProductionPageInput) {
  let page = query.orderBy(FieldPath.documentId());
  const cursor = productionDocumentCursor(input.cursor);
  if (cursor) page = page.startAfter(cursor);
  const snapshot = await tx.get(page.limit(input.limit + 1));
  const docs = snapshot.docs.slice(0, input.limit);
  return { docs, nextCursor: snapshot.size > input.limit ? Buffer.from(docs.at(-1)!.id).toString('base64url') : null };
}

export const firestoreProductionReadRepository: ProductionReadRepository = {
  async list(input) {
    let query: FirebaseFirestore.Query = adminDb.collection(collections[input.view]);
    if (input.view === 'items' || input.view === 'comments') {
      if (!input.lotId) throw new OperationError('INVALID_INPUT', 'Informe o lote.');
      exists(await adminDb.collection('productionLots').doc(input.lotId).get());
      query = query.where('lotId', '==', input.lotId);
    }
    const { docs, nextCursor } = await paginateQuery(query, input);
    return result(docs.map(doc => projectProductionRecord(doc.id, exists(doc), input.view)), 'firestore', [], nextCursor);
  },
  async getOrder(input) {
    const offset = productionOrderOffset(input.cursor);
    const doc = await adminDb.collection('salesOrders').doc(input.orderId).get();
    const projected = projectProductionOrder(doc.id, exists(doc));
    const nextCursor = offset + input.limit < projected.itens.length ? String(offset + input.limit) : null;
    return result({ ...projected, itens: projected.itens.slice(offset, offset + input.limit) }, 'firestore', [], nextCursor);
  },
  async getLot(input) {
    return adminDb.runTransaction(async tx => {
      const doc = await tx.get(adminDb.collection('productionLots').doc(input.lotId));
      const lot = projectProductionRecord(doc.id, exists(doc), 'lots');
      const { docs, nextCursor } = await transactionPage(tx, adminDb.collection('productionLotItems').where('lotId', '==', input.lotId), input);
      const linked = Array.isArray(lot.linkedOrderIds) ? lot.linkedOrderIds : [];
      lot.linkedOrderIds = linked.slice(0, 100);
      return result({ lot, items: docs.map(item => projectProductionRecord(item.id, exists(item), 'items')) }, 'firestore',
        linked.length > 100 ? ['Pedidos vinculados limitados a 100 entradas.'] : [], nextCursor);
    }, { readOnly: true });
  },
};
