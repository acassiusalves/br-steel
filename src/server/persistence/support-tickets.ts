import 'server-only';
import { createPostgresSupportTicketRepository } from './postgres-support-tickets';
import { postgresOnlyRepository } from './source';

/** Só PostgreSQL (Supabase): os chamados não existem no Firestore. */
export const supportTicketRepository = postgresOnlyRepository(createPostgresSupportTicketRepository);
