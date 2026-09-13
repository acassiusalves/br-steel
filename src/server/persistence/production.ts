import 'server-only';
import { firestoreProductionReadRepository } from './firestore-production';
import { createPostgresProductionRepository } from './postgres-production';
import { selectRepository } from './source';

/** Resolved per call. Firestore stays active until the shared record says otherwise. */
export const productionReadRepository = selectRepository(firestoreProductionReadRepository, createPostgresProductionRepository);
