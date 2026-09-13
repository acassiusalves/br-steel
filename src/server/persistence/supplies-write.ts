import 'server-only';
import { firestoreSuppliesWriteRepository } from './firestore-supplies-write';
import { createPostgresSuppliesWriteRepository } from './postgres-supplies-write';
import { selectRepository } from './source';

/** Resolved per call. Firestore stays active until the shared record says otherwise. */
export const suppliesWriteRepository = selectRepository(firestoreSuppliesWriteRepository, createPostgresSuppliesWriteRepository);
