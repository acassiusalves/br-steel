import 'server-only';
import { firestoreSalesReadRepository } from './firestore-sales';
import { createPostgresSalesRepository } from './postgres-sales';
import { selectRepository } from './source';

/** Resolved per call. Firestore stays active until the shared record says otherwise. */
export const salesReadRepository = selectRepository(firestoreSalesReadRepository, createPostgresSalesRepository);
