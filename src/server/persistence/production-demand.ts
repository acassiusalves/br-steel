import 'server-only';
import { firestoreProductionDemandReadRepository } from './firestore-production-demand';
import { createPostgresProductionDemandRepository } from './postgres-production-demand';
import { selectRepository } from './source';

/** Resolved per call. Firestore stays active until the shared record says otherwise. */
export const productionDemandReadRepository = selectRepository(firestoreProductionDemandReadRepository, createPostgresProductionDemandRepository);
