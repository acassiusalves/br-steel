import 'server-only';
import { Pool } from 'pg';
import type { AccessContext } from '@/server/access/types';
import { createSalesReadOperations } from '@/server/operations/sales';
import { createStoredStockOperations } from '@/server/operations/stock';
import { createSuppliesReadOperations } from '@/server/operations/supplies';
import { createProductionReadOperations } from '@/server/operations/production';
import { createProductionDemandOperation } from '@/server/operations/production-demand';
import { createPostgresSalesRepository } from '@/server/persistence/postgres-sales';
import { createPostgresStockRepository } from '@/server/persistence/postgres-stock';
import { createPostgresSuppliesRepository } from '@/server/persistence/postgres-supplies';
import { createPostgresProductionRepository } from '@/server/persistence/postgres-production';
import { createPostgresProductionDemandRepository } from '@/server/persistence/postgres-production-demand';
import { withPilotSnapshot, type PilotSnapshotPolicy } from '@/server/persistence/pilot-snapshot';
import { hostedPoolConfig } from '@/server/migration/operational-hosted';
import { createReadTools, readTools } from './read-tools';
import { getPostgresPilotConfig } from './postgres-pilot-config';

export function createPostgresReadTools(pool: Pool, policy: PilotSnapshotPolicy) {
  return createReadTools({
    ...createSalesReadOperations(createPostgresSalesRepository(pool)),
    ...createStoredStockOperations(createPostgresStockRepository(pool)),
    ...createSuppliesReadOperations(createPostgresSuppliesRepository(pool)),
    ...createProductionReadOperations(createPostgresProductionRepository(pool)),
    productionDemand:createProductionDemandOperation(createPostgresProductionDemandRepository(pool)),
  }).map(tool => tool.name === 'consultar_meu_acesso' ? tool : {
    ...tool, description:`${tool.description} Neste piloto, lê uma cópia identificada por data de captura; não representa dados atuais do sistema.`,
    run:(context: AccessContext,input: unknown)=>withPilotSnapshot(policy,()=>tool.run(context,input)),
  });
}

let cachedPool: { databaseUrl: string; ca: string; pool: Pool } | undefined;
/** Only the MCP registry calls this selector; construction does not open a database connection. */
export function readToolsForContext(context: AccessContext) {
  const config = getPostgresPilotConfig(context);
  if (!config) return readTools;
  if (!cachedPool || cachedPool.databaseUrl !== config.databaseUrl || cachedPool.ca !== config.ca) {
    const previous = cachedPool;
    cachedPool = { databaseUrl:config.databaseUrl,ca:config.ca,pool:new Pool(hostedPoolConfig(config.databaseUrl,'reader',config.ca)) };
    // A failed idle connection must not crash the server process or log credentials.
    cachedPool.pool.on('error',()=>{});
    if (previous) void previous.pool.end().catch(()=>{});
  }
  return createPostgresReadTools(cachedPool.pool,config.policy);
}
