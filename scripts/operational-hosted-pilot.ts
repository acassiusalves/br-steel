import { readFile, stat } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import type { Pool } from 'pg';
import { createHostedPilotPool, checkHostedConnection, HOSTED_PROJECT, assertHostedSource } from '../src/server/migration/operational-hosted';
import { importSnapshot, verifySnapshot } from '../src/server/migration/operational-import';
import { prepareSnapshot } from '../src/server/migration/operational-snapshot';
import { createPostgresSalesRepository } from '../src/server/persistence/postgres-sales';
import { createPostgresStockRepository } from '../src/server/persistence/postgres-stock';
import { createPostgresProductionRepository } from '../src/server/persistence/postgres-production';
import { createPostgresSuppliesRepository } from '../src/server/persistence/postgres-supplies';
import { createPostgresProductionDemandRepository } from '../src/server/persistence/postgres-production-demand';
import { recordPilotReport, withStableCopy, safePilotErrorCode } from '../src/server/migration/operational-pilot-evidence';

// pg does not expose its socket in its public types. This probe is CLI-only and fails closed
// if the pinned driver changes its shape. TLSSocket.bytesRead measures decrypted protocol bytes.
function wireCounter(pool: Pool) {
  const streams: { bytesRead:number;bytesWritten:number }[] = [];
  pool.on('connect',client => {
    const stream = (client as unknown as { connection:{stream:{bytesRead:number;bytesWritten:number}} }).connection.stream;
    if (!Number.isFinite(stream.bytesRead) || !Number.isFinite(stream.bytesWritten)) throw new Error('Protocol measurement unavailable');
    streams.push(stream);
  });
  return () => ({ received:streams.reduce((sum,s)=>sum+s.bytesRead,0),sent:streams.reduce((sum,s)=>sum+s.bytesWritten,0) });
}

async function main() {
  const [command,path,reportPath,...extra] = process.argv.slice(2);
  if (!['import','verify','measure'].includes(command) || !path?.startsWith('/') || !reportPath?.startsWith('/') || extra.length) {
    throw new Error('Usage: operational-hosted-pilot.ts import|verify|measure /absolute/snapshot.json /absolute/report.json');
  }
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size > 128*1024*1024) throw new Error('Snapshot limit exceeded');
  // Reserve report first: a typo or existing report must not trigger a new import/measurement.
  const report=await recordPilotReport(reportPath,command,async()=>{
    const raw:unknown = JSON.parse(await readFile(path,'utf8'));
    const snapshot = prepareSnapshot(raw);
    assertHostedSource(snapshot.sourceProject);
    const ca = process.env.BRSTEEL_PG_CA_FILE ? await readFile(process.env.BRSTEEL_PG_CA_FILE,'utf8') : undefined;
    const purpose = command === 'measure' ? 'reader' : 'importer';
    const pool = createHostedPilotPool(process.env[purpose === 'reader' ? 'BRSTEEL_PG_PILOT_READER_URL' : 'BRSTEEL_PG_PILOT_IMPORTER_URL'] ?? '',purpose,ca);
    let connectionFailed=false;
    pool.on('error',() => { connectionFailed=true; });
    const wire = wireCounter(pool), startedAt = new Date().toISOString(), start = performance.now();
    try {
      const client = await pool.connect();
      try { await checkHostedConnection(client,purpose); } finally { client.release(); }
      let result: unknown;
      if (command === 'import') {
        let lastProgress = 0;
        result = await importSnapshot(pool,raw,{onProgress:({processed,total}) => {
          if (processed-lastProgress >= 1000 || processed === total) { console.log(JSON.stringify({processed,total}));lastProgress=processed; }
        }});
      } else if (command === 'verify') result = await verifySnapshot(pool,raw);
      else {
        result=await withStableCopy(snapshot.hash,async()=>(await pool.query('select active_run,ready from brsteel_import.state where singleton')).rows[0],async()=>{
          const to = snapshot.capturedAt.slice(0,10), from = to.slice(0,7)+'-01';
          const sales = createPostgresSalesRepository(pool), stock = createPostgresStockRepository(pool);
          const production = createPostgresProductionRepository(pool), supplies = createPostgresSuppliesRepository(pool);
          const demand = createPostgresProductionDemandRepository(pool);
          const firstOrder = snapshot.records.find(r=>r.collection==='salesOrders');
          const firstLot = snapshot.records.find(r=>r.collection==='productionLots');
          const firstSupply = snapshot.records.find(r=>r.collection==='supplies');
          const cases: [string,()=>Promise<unknown>][] = [
            ['sales_summary',()=>sales.summarize({from,to},{databaseOnly:true})],
            ['sales_page',()=>sales.list({limit:50,from,to})],
            ['stock_page',()=>stock.list({limit:50})],
            ['production_demand',()=>demand.read({from,to})],
            ['production_lots',()=>production.list({view:'lots',limit:50})],
            ['production_orders',()=>production.list({view:'orders',limit:50})],
            ['supplies_page',()=>supplies.list({limit:50})],
          ];
          if(firstOrder) cases.push(['production_order',()=>production.getOrder({orderId:firstOrder.id,limit:50})]);
          if(firstLot) cases.push(['production_lot',()=>production.getLot({lotId:firstLot.id,limit:50})]);
          if(firstSupply) cases.push(['supply_movements',()=>supplies.listMovements({supplyId:firstSupply.id,limit:50})]);
          const samples = [];
          for (const [name,read] of cases) {
            for (let iteration=0;iteration<5;iteration++) {
              const before=wire(),at=performance.now(),response=await read(),after=wire();
              samples.push({name,iteration,durationMs:performance.now()-at,protocolReceivedBytes:after.received-before.received,
                protocolSentBytes:after.sent-before.sent,responseJsonBytes:Buffer.byteLength(JSON.stringify(response))});
            }
          }
          return {range:{from,to},samples};
        });
      }
      if(connectionFailed) throw new Error('Pilot database connection unavailable');
      const report={status:'complete',command,project:HOSTED_PROJECT,sourceProject:snapshot.sourceProject,
        snapshotHash:snapshot.hash,capturedAt:snapshot.capturedAt,startedAt,finishedAt:new Date().toISOString(),
        durationMs:performance.now()-start,protocol:wire(),result};
      return report;
    } finally { await pool.end(); }
  });
  console.log(JSON.stringify({status:report.status,command,durationMs:report.durationMs,protocol:report.protocol}));
}
main().catch((error:unknown) => {
  // SQL errors can include passwords, source IDs or row contents in DETAIL. Codes alone are safe.
  console.error(JSON.stringify({status:'failed',code:safePilotErrorCode(error),
    message:'Pilot failed. Check the source, private connection configuration and import state. No runtime switch was requested.'}));
  process.exitCode=1;
});
