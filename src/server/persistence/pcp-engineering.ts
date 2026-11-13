import 'server-only';
import { createPostgresEngineeringRepository } from './postgres-pcp-engineering';
import { postgresOnlyRepository } from './source';

/** Só PostgreSQL (Supabase): os cadastros do PCP não existem no Firestore. */
export const engineeringRepository = postgresOnlyRepository(createPostgresEngineeringRepository);
