import 'server-only';
import { firestoreSuppliesReadRepository, firestoreSupplyLimitsRepository } from './firestore-supplies';
import { createPostgresSuppliesRepository, createPostgresSupplyLimitsRepository } from './postgres-supplies';
import { selectRepository } from './source';

/** Resolved per call. Firestore stays active until the shared record says otherwise. */
export const suppliesReadRepository = selectRepository(firestoreSuppliesReadRepository, createPostgresSuppliesRepository);
export const supplyLimitsRepository = selectRepository(firestoreSupplyLimitsRepository, createPostgresSupplyLimitsRepository);
