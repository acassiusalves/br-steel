import 'server-only';
import { firestoreSuppliesReadRepository } from './firestore-supplies';
import { createPostgresSuppliesRepository } from './postgres-supplies';
import { selectRepository } from './source';

/** Resolved per call. Firestore stays active until the shared record says otherwise. */
export const suppliesReadRepository = selectRepository(firestoreSuppliesReadRepository, createPostgresSuppliesRepository);
