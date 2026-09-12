import 'server-only';
import { FieldPath } from 'firebase-admin/firestore';
import { z } from 'zod';
import { adminDb } from '@/lib/firebase-admin';
import type { SupplyRead } from '@/types/supply';
import { documentIdSchema, paginateQuery, result, OperationError } from '@/server/operations/common';
import type { SuppliesReadRepository } from './supplies-contract';
import { movementDateBounds } from './supplies-read-projection';

export const firestoreSuppliesReadRepository: SuppliesReadRepository = {
  async list(input) {
    const page = await paginateQuery(adminDb.collection('supplies'), input);
    // Advance by examined document IDs even when an entire page has no named supplies.
    const supplies = page.docs.flatMap(doc => {
      const data = doc.data();
      return typeof data.nome === 'string' && data.nome.trim() ? [{ ...data, id: doc.id } as SupplyRead] : [];
    });
    const warnings = supplies.length < page.docs.length
      ? ['Registros sem nome de insumo foram omitidos.' + (page.nextCursor ? ' Continue pela próxima página para consultar os demais registros.' : '')] : [];
    return result(supplies, 'firestore', warnings, page.nextCursor);
  },
  async listMovements(input) {
    let query: FirebaseFirestore.Query = adminDb.collection('inventoryMovements').where('supplyId', '==', input.supplyId);
    if (!input.from && !input.to) {
      const page = await paginateQuery(query, input);
      return result(page.docs.map(doc => ({ ...doc.data(), id: doc.id })), 'firestore', [], page.nextCursor);
    }
    const bounds = movementDateBounds(input);
    if (bounds.from) query = query.where('createdAt', '>=', bounds.from);
    if (bounds.to) query = query.where('createdAt', '<', bounds.to);
    query = query.orderBy('createdAt').orderBy(FieldPath.documentId());
    if (input.cursor) {
      try {
        const cursor = z.object({ createdAt: z.string().datetime(), id: documentIdSchema }).strict().parse(JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8')));
        query = query.startAfter(cursor.createdAt, cursor.id);
      } catch { throw new OperationError('INVALID_CURSOR', 'Paginação inválida.'); }
    }
    const snapshot = await query.limit(input.limit + 1).get();
    const docs = snapshot.docs.slice(0, input.limit), last = docs.at(-1);
    const nextCursor = snapshot.size > input.limit ? Buffer.from(JSON.stringify({ createdAt: last!.data().createdAt, id: last!.id })).toString('base64url') : null;
    return result(docs.map(doc => ({ ...doc.data(), id: doc.id })), 'firestore', [], nextCursor);
  },
};
