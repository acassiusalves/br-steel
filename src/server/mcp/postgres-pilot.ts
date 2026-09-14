import 'server-only';
import { Pool } from 'pg';
import type { AccessContext } from '@/server/access/types';
import { createSalesReadOperations } from '@/server/operations/sales';
import { createStoredStockOperations } from '@/server/operations/stock';
import { createSuppliesReadOperations } from '@/server/operations/supplies';
import { createProductionReadOperations } from '@/server/operations/production';
import { createProductionDemandOperation } from '@/server/operations/production-demand';
import { skuHistory } from '@/server/operations/sku-history';
import { createPostgresSalesRepository } from '@/server/persistence/postgres-sales';
import { createPostgresStockRepository } from '@/server/persistence/postgres-stock';
import { createPostgresSuppliesRepository } from '@/server/persistence/postgres-supplies';
import { createPostgresProductionRepository } from '@/server/persistence/postgres-production';
import { createPostgresProductionDemandRepository } from '@/server/persistence/postgres-production-demand';
import { withPilotSnapshot, type PilotSnapshotPolicy } from '@/server/persistence/pilot-snapshot';
import { hostedPoolConfig } from '@/server/migration/operational-hosted';
import { createReadTools, readTools } from './read-tools';
import { getPostgresPilotConfig } from './postgres-pilot-config';

// Ferramentas permanentemente ao vivo por design: nunca fazem sentido como cópia congelada, em
// nenhum piloto futuro. `consultar_meu_acesso` não tem `capability` e devolve as permissões efetivas
// do próprio chamador — congelar isso seria um bug (usuário revogado continuaria autorizado na
// cópia). Ficam na lista do piloto, mas sem o wrapper `withPilotSnapshot` nem o aviso de cópia.
const PERMANENTLY_LIVE_TOOLS = new Set(['consultar_meu_acesso']);

// Ferramentas que ainda não têm cópia no piloto Postgres — lacuna de cobertura temporária, não uma
// escolha de design. `withPilotSnapshot` rejeitaria (unavailable) qualquer resultado que não viesse
// do Postgres, e servir a fonte ao vivo escondida atrás da descrição de "cópia datada" seria
// metadata falsa. Em vez de forçar o wrapper ou mentir na descrição, essas ferramentas são
// removidas inteiramente da lista do piloto: um agente em modo piloto nunca as vê. Tire uma entrada
// daqui quando sua leitura ganhar cópia no Postgres — ela passa a ser empacotada como as demais.
// `consultar_historico_sku` lê o rollup semanal, que existe só no Firestore (mesma decisão já
// tomada para o campo `history` embutido em ProductionDemand, que o leitor Postgres devolve vazio).
const PENDING_POSTGRES_COVERAGE_TOOLS = new Set(['consultar_historico_sku']);

export function createPostgresReadTools(pool: Pool, policy: PilotSnapshotPolicy) {
  return createReadTools({
    ...createSalesReadOperations(createPostgresSalesRepository(pool)),
    ...createStoredStockOperations(createPostgresStockRepository(pool)),
    ...createSuppliesReadOperations(createPostgresSuppliesRepository(pool)),
    ...createProductionReadOperations(createPostgresProductionRepository(pool)),
    productionDemand:createProductionDemandOperation(createPostgresProductionDemandRepository(pool)),
    skuHistory,
  })
    .filter(tool => !PENDING_POSTGRES_COVERAGE_TOOLS.has(tool.name))
    .map(tool => PERMANENTLY_LIVE_TOOLS.has(tool.name) ? tool : {
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
