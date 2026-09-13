import 'server-only';
import { firestoreSalesIngestRepository } from './firestore-sales-ingest';
import { createPostgresSalesIngestRepository } from './postgres-sales-ingest';
import { selectRepository } from './source';

/** Resolved per call. Firestore stays active until the shared record says otherwise. */
export const salesIngestRepository = selectRepository(firestoreSalesIngestRepository, createPostgresSalesIngestRepository);
