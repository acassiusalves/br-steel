import 'server-only';
import { createPostgresProductionOrderRepository } from './postgres-pcp-orders';
import { postgresOnlyRepository } from './source';

/** Só PostgreSQL (Supabase): as OPs do PCP não existem no Firestore. */
export const productionOrderRepository = postgresOnlyRepository(createPostgresProductionOrderRepository);
