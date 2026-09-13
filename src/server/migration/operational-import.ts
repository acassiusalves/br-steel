import { Pool, type PoolClient } from 'pg';
import { COLLECTIONS, TABLES, contentHash, prepareSnapshot, type PreparedSnapshot, NATIVE_RUN_ID } from './operational-snapshot';
import { prepareStockReadModels } from '../persistence/stored-stock-model';
import { checkImportTarget } from './operational-hosted';

export function createLocalImportPool(connectionString: string): Pool {
  const url = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['127.0.0.1', '[::1]'].includes(url.hostname)
    || url.pathname !== '/brsteel_ops_local' || !url.port || url.search || url.hash) throw new Error('Explicit local operational database required');
  return new Pool({ connectionString, max: 2, connectionTimeoutMillis: 5000, ssl: false });
}
async function transaction<T>(client: PoolClient, fn: () => Promise<T>) {
  await client.query('begin');
  try {
    await client.query('set local role brsteel_ops_importer');
    const value = await fn();
    await client.query('commit');
    return value;
  } catch (error) { await client.query('rollback'); throw error; }
}

async function compare(client: PoolClient, snapshot: PreparedSnapshot) {
  let records = 0;
  for (const collection of COLLECTIONS) {
    const expected = new Map(snapshot.records.filter(r => r.collection === collection).map(r => [r.id, r]));
    const actual = await client.query(`select source_id, payload, source_version::text, source_hash
      from brsteel_ops.${TABLES[collection]} where not source_deleted and import_run_id <> $1`, [NATIVE_RUN_ID]);
    if (actual.rows.length !== expected.size) throw new Error(`Count mismatch: ${collection}`);
    for (const row of actual.rows) {
      const source = expected.get(row.source_id);
      if (!source || source.version !== row.source_version || contentHash(row.payload) !== contentHash(source.data)
        || row.source_hash !== contentHash(row.payload)) throw new Error(`Content mismatch: ${collection}/${row.source_id}`);
    }
    records += actual.rows.length;
  }
  const expectedItems = new Map<string, unknown>();
  for (const row of snapshot.records.filter(r => r.collection === 'salesOrders')) {
    const items = row.data.itens as unknown[] | null | undefined;
    items?.forEach((item, position) => expectedItems.set(`${row.id}/${position}`, item));
  }
  const items = await client.query(`select i.order_id, i.position, i.payload from brsteel_ops.sales_order_items i
    join brsteel_ops.sales_orders o on o.source_id = i.order_id where o.import_run_id <> $1`, [NATIVE_RUN_ID]);
  if (items.rows.length !== expectedItems.size) throw new Error('Order item count mismatch');
  for (const item of items.rows) {
    const source = expectedItems.get(`${item.order_id}/${item.position}`);
    if (!source || contentHash(source) !== contentHash(item.payload)) throw new Error('Order item content mismatch');
  }
  const stockModels = prepareStockReadModels(snapshot.records.filter(row => row.collection === 'stockUpdates'));
  for (const row of (await client.query(`select source_id,stock_read,observed_at_ms,sku_order
    from brsteel_ops.stock_observations where not source_deleted and import_run_id <> $1`, [NATIVE_RUN_ID])).rows) {
    const expected = stockModels.get(row.source_id);
    if (contentHash(row.stock_read) !== contentHash(expected?.stock ?? null)
      || row.observed_at_ms !== (expected?.observedAtMs ?? null) || row.sku_order !== (expected?.skuOrder ?? null)) {
      throw new Error('Stock read model mismatch');
    }
  }
  const limits = new Map(snapshot.records.filter(row => row.collection === 'supplies').map(row => [row.id,String(row.data.codigo || row.id)]));
  for (const row of (await client.query(`select source_id,lookup_sku from brsteel_ops.supplies
    where not source_deleted and import_run_id <> $1`, [NATIVE_RUN_ID])).rows) {
    if (row.lookup_sku !== limits.get(row.source_id)) throw new Error('Supply lookup key mismatch');
  }
  return { records, items: items.rows.length, hash: snapshot.hash };
}

/** Independently reads payloads back; stored digest columns alone are not evidence of equivalence. */
export async function verifySnapshot(pool: Pool, raw: unknown) {
  const snapshot = prepareSnapshot(raw), client = await pool.connect();
  try {
    await checkImportTarget(pool, client, snapshot.sourceProject);
    await client.query('begin isolation level repeatable read read only');
    await client.query('set local role brsteel_ops_importer');
    const state=(await client.query('select source_project,ready from brsteel_import.state where singleton')).rows[0];
    if (!state?.ready || state.source_project!==snapshot.sourceProject) throw new Error('Source copy not ready for verification');
    const result = await compare(client, snapshot);
    await client.query('commit');
    return result;
  } catch (error) { await client.query('rollback'); throw error; }
  finally { client.release(); }
}

export async function importSnapshot(pool: Pool, raw: unknown, options: {
  batchSize?: number;
  onProgress?: (progress: { processed: number; total: number }) => void | Promise<void>;
} = {}) {
  const snapshot = prepareSnapshot(raw), size = options.batchSize ?? 100;
  const stockModels = prepareStockReadModels(snapshot.records.filter(row => row.collection === 'stockUpdates'));
  if (!Number.isInteger(size) || size < 1 || size > 500) throw new Error('Batch size must be between 1 and 500');
  const client = await pool.connect();
  let locked = false;
  try {
    await checkImportTarget(pool, client, snapshot.sourceProject);
    locked = (await client.query('select pg_try_advisory_lock(738219, 1) as locked')).rows[0].locked;
    if (!locked) throw new Error('Another import is running');
    const initial = await transaction(client, async () => {
      const state = (await client.query('select * from brsteel_import.state for update')).rows[0];
      if (state && state.source_project !== snapshot.sourceProject) throw new Error('Source project mismatch');
      const existing = (await client.query('select * from brsteel_import.runs where id=$1', [snapshot.hash])).rows[0];
      if (existing?.status === 'complete') return { next: snapshot.records.length, complete: true };
      if (state && !state.ready && state.active_run !== snapshot.hash) throw new Error('Resume the incomplete snapshot before importing another');
      if (state?.ready) {
        const previous = (await client.query('select captured_at from brsteel_import.runs where id=$1', [state.active_run])).rows[0];
        if (previous.captured_at.valueOf() > Date.parse(snapshot.capturedAt)) throw new Error('Snapshot is older than the ready copy');
      }
      // Reject stale or conflicting versions before making the existing copy unavailable.
      for (const collection of COLLECTIONS) {
        const wanted = new Map(snapshot.records.filter(r => r.collection === collection).map(r => [r.id, r]));
        // Native rows share deterministic ids with snapshot documents (the annual lot counter, the
        // SKU key hash, the default columns). Without this filter a native write newer than the
        // Firestore document aborts the whole import, and the opposite order silently reclaims the
        // row for the snapshot — which would walk the lot counter backwards and mint duplicates.
        const current = await client.query(
          `select source_id, source_version::text, source_hash from brsteel_ops.${TABLES[collection]}
           where import_run_id <> $1`, [NATIVE_RUN_ID]);
        for (const row of current.rows) {
          const incoming = wanted.get(row.source_id);
          if (incoming && (BigInt(incoming.version) < BigInt(row.source_version)
            || (incoming.version === row.source_version && contentHash(incoming.data) !== row.source_hash))) {
            throw new Error(`Source version conflict: ${collection}/${row.source_id}`);
          }
        }
        // Three collections derive their ids the same way on both sides — the annual lot counter, the
        // SKU key hash and the default column ids — so a snapshot document can land on a row this
        // application wrote itself. Refuse loudly: letting the snapshot win would walk the lot counter
        // backwards and mint duplicate numbers, and there is no merge rule that is obviously right.
        // Resolving a collision is a deliberate act, not something an import should decide.
        const collided = await client.query(
          `select source_id from brsteel_ops.${TABLES[collection]}
           where import_run_id = $1 and source_id = any($2) limit 1`,
          [NATIVE_RUN_ID, [...wanted.keys()]]);
        if (collided.rowCount) {
          throw new Error(`Native row collision: ${collection}/${collided.rows[0].source_id}. `
            + 'A cópia contém uma linha gravada pela aplicação com o mesmo identificador do snapshot. '
            + 'Resolva explicitamente antes de importar.');
        }
      }
      await client.query(`insert into brsteel_import.runs(id,source_project,captured_at,status,total_records)
        values($1,$2,$3,'loading',$4) on conflict(id) do nothing`, [snapshot.hash,snapshot.sourceProject,snapshot.capturedAt,snapshot.records.length]);
      await client.query(`insert into brsteel_import.state(singleton,source_project,active_run,ready,captured_at,completed_at) values(true,$1,$2,false,$3,null)
        on conflict(singleton) do update set active_run=excluded.active_run,ready=false,captured_at=excluded.captured_at,completed_at=null`, [snapshot.sourceProject,snapshot.hash,snapshot.capturedAt]);
      return { next: existing?.next_index ?? 0, complete: false };
    });
    if (initial.complete) return { records: snapshot.records.length, hash: snapshot.hash, alreadyComplete: true };
    for (let offset = initial.next; offset < snapshot.records.length; offset += size) {
      const batch = snapshot.records.slice(offset, offset + size);
      await transaction(client, async () => {
        for (const row of batch) {
          await client.query(`insert into brsteel_ops.${TABLES[row.collection]}
            (source_id,payload,source_version,source_hash,import_run_id,source_deleted) values($1,$2,$3,$4,$5,false)
            on conflict(source_id) do update set payload=excluded.payload,source_version=excluded.source_version,
            source_hash=excluded.source_hash,import_run_id=excluded.import_run_id,source_deleted=false`,
          [row.id,JSON.stringify(row.data),row.version,contentHash(row.data),snapshot.hash]);
          if (row.collection === 'stockUpdates') {
            const model = stockModels.get(row.id);
            await client.query(`update brsteel_ops.stock_observations set stock_read=$2,observed_at_ms=$3,sku_order=$4 where source_id=$1`,
              [row.id, model ? JSON.stringify(model.stock) : null, model?.observedAtMs ?? null, model?.skuOrder ?? null]);
          }
          if (row.collection === 'supplies') {
            await client.query('update brsteel_ops.supplies set lookup_sku=$2 where source_id=$1', [row.id,String(row.data.codigo || row.id)]);
          }
          if (row.collection === 'salesOrders') {
            await client.query('delete from brsteel_ops.sales_order_items where order_id=$1', [row.id]);
            await client.query(`insert into brsteel_ops.sales_order_items(order_id,position,payload)
              select $1,ordinality-1,value from jsonb_array_elements($2::jsonb) with ordinality`, [row.id,JSON.stringify(row.data.itens ?? [])]);
          }
        }
        await client.query('update brsteel_import.runs set next_index=$2 where id=$1', [snapshot.hash,offset+batch.length]);
      });
      await options.onProgress?.({ processed: offset + batch.length, total: snapshot.records.length });
    }
    const result = await transaction(client, async () => {
      for (const table of Object.values(TABLES)) {
        await client.query(`update brsteel_ops.${table} set source_deleted=true
          where import_run_id<>$1 and import_run_id<>$2`, [snapshot.hash, NATIVE_RUN_ID]);
      }
      await client.query('delete from brsteel_ops.sales_order_items i using brsteel_ops.sales_orders o where i.order_id=o.source_id and o.source_deleted');
      const compared = await compare(client, snapshot);
      await client.query("update brsteel_import.runs set status='complete',completed_at=now() where id=$1", [snapshot.hash]);
      await client.query('update brsteel_import.state s set ready=true,completed_at=r.completed_at from brsteel_import.runs r where s.singleton and s.active_run=$1 and r.id=s.active_run', [snapshot.hash]);
      return compared;
    });
    return { ...result, alreadyComplete: false };
  } finally {
    let destroy = false;
    try { if (locked) await client.query('select pg_advisory_unlock(738219, 1)'); }
    catch { destroy = true; } // A broken connection must never return to the pool.
    finally { client.release(destroy); }
  }
}
