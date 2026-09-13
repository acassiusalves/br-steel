import 'server-only';
import { firestoreStockReadRepository } from './firestore-stock';
import { createPostgresStockRepository } from './postgres-stock';
import { selectRepository } from './source';

/** Resolved per call. Firestore stays active until the shared record says otherwise. */
export const stockReadRepository = selectRepository(firestoreStockReadRepository, createPostgresStockRepository);
