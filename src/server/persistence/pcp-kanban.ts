import 'server-only';
import { createPostgresKanbanRepository } from './postgres-pcp-kanban';
import { postgresOnlyRepository } from './source';

/** Só PostgreSQL (Supabase): o Kanban de OPs não existe no Firestore. */
export const kanbanRepository = postgresOnlyRepository(createPostgresKanbanRepository);
