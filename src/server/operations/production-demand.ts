import 'server-only';
import type { AccessContext } from '@/server/access/types';
import type { ProductionDemandReadRepository } from '@/server/persistence/production-demand-contract';
import { productionDemandReadRepository } from '@/server/persistence/production-demand';
import { readFirestoreProductionDemand } from '@/server/persistence/firestore-production-demand';
import { dateRangeSchema, requireOperation } from './common';
export type { ProductionDemand } from '@/server/persistence/production-demand-contract';

export function createProductionDemandOperation(repository: ProductionDemandReadRepository) {
  return async (context: AccessContext, raw: unknown) => {
    requireOperation(context, 'producao:read', '/producao');
    return repository.read(dateRangeSchema.parse(raw));
  };
}
const storedDemand = createProductionDemandOperation(productionDemandReadRepository);
export async function productionDemand(context: AccessContext, raw: unknown) {
  if (context.actor.source === 'mcp') return storedDemand(context, raw);
  requireOperation(context, 'producao:read', '/producao');
  return readFirestoreProductionDemand(dateRangeSchema.parse(raw), false);
}
