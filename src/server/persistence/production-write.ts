import 'server-only';
import { firestoreProductionWriteRepository } from './firestore-production-write';
import { createPostgresProductionWriteRepository } from './postgres-production-write';
import { selectRepository } from './source';

/** Resolved per call. Firestore stays active until the shared record says otherwise. */
export const productionWriteRepository = selectRepository(firestoreProductionWriteRepository, createPostgresProductionWriteRepository);
