import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { serialize } from '@/server/operations/common';
import { NATIVE_RUN_ID, canonicalJson, contentHash } from '@/server/migration/operational-snapshot';
import type { IngestCounts, SalesIngestRepository, SourceOrder } from './sales-ingest-contract';
import { prepareStockReadModels } from './stored-stock-model';
import { withOperationalWrite } from './postgres-write';

type Doc = Record<string, unknown>;
const OBSERVATION_TTL_MS = 730 * 86_400_000;
const nativeVersion = () => String(BigInt(Date.now()) * BigInt(1000000));

/**
 * serialize() first: canonicalJson throws on undefined, Date and exotic prototypes, while
 * JSON.stringify silently drops them — the two halves of this statement would disagree.
 */
const writeOrder = (client: PoolClient, id: string, raw: Doc) => {
  const payload = serialize(raw);
  return client.query(
  `insert into brsteel_ops.sales_orders (source_id, payload, source_version, source_hash, import_run_id)
   values ($1, $2, $3, $4, $5)
   on conflict (source_id) do update set payload = excluded.payload, source_version = excluded.source_version,
     source_hash = excluded.source_hash, source_deleted = false`,
  [id, JSON.stringify(payload), nativeVersion(), contentHash(payload), NATIVE_RUN_ID]);
};

/** Rebuilt from the payload so the stored projection can never drift from the document it derives from. */
async function rebuildItems(client: PoolClient, orderId: string, payload: Doc) {
  await client.query('delete from brsteel_ops.sales_order_items where order_id = $1', [orderId]);
  const items = Array.isArray(payload.itens) ? payload.itens : [];
  for (const [position, item] of items.entries()) {
    await client.query(
      `insert into brsteel_ops.sales_order_items (order_id, position, payload) values ($1, $2, $3)`,
      [orderId, position, JSON.stringify(item)]);
  }
}

/**
 * sku_order is a position in the locale ordering of every SKU, so a new observation shifts the others.
 * The whole projection is rebuilt inside the same transaction rather than guessing an insertion point.
 */
/** Advisory lock key that queues stock observation writes; any constant unused elsewhere in the database. */
const STOCK_PROJECTION_LOCK = 730_201;

/**
 * Recomputes the read projection and writes back only the rows whose values changed, in one statement.
 * Rewriting every row one statement at a time held row locks on the whole table for tens of seconds per
 * webhook, so bursts of stock events deadlocked, hit the statement timeout and exhausted connections.
 */
async function rebuildStockProjection(client: PoolClient) {
  const rows = (await client.query(`select source_id, payload, stock_read, observed_at_ms, sku_order
    from brsteel_ops.stock_observations where not source_deleted`)).rows;
  const models = prepareStockReadModels(rows.map(row => ({ id: row.source_id, data: row.payload as Doc })));
  const ids: string[] = [], reads: (string | null)[] = [], observed: (number | null)[] = [], orders: (number | null)[] = [];
  for (const row of rows) {
    const model = models.get(row.source_id);
    const read = model ? JSON.parse(JSON.stringify(model.stock)) as Doc : null;
    const at = model?.observedAtMs ?? null, order = model?.skuOrder ?? null;
    const same = (row.observed_at_ms === null ? null : Number(row.observed_at_ms)) === at && row.sku_order === order
      && (read === null ? row.stock_read === null : row.stock_read !== null && canonicalJson(row.stock_read) === canonicalJson(read));
    if (same) continue;
    ids.push(row.source_id); reads.push(read === null ? null : JSON.stringify(read)); observed.push(at); orders.push(order);
  }
  if (!ids.length) return;
  await client.query(`update brsteel_ops.stock_observations o
    set stock_read = v.stock_read, observed_at_ms = v.observed_at_ms, sku_order = v.sku_order
    from unnest($1::text[], $2::jsonb[], $3::double precision[], $4::integer[]) as v(source_id, stock_read, observed_at_ms, sku_order)
    where o.source_id = v.source_id`, [ids, reads, observed, orders]);
}

export function createPostgresSalesIngestRepository(pool: Pool): SalesIngestRepository {
  return {
    async upsertOrders(orders: SourceOrder[]): Promise<IngestCounts> {
      if (!orders.length) return { count: 0, created: 0, updated: 0 };
      return withOperationalWrite(pool, async client => {
        let created = 0, updated = 0;
        for (const order of orders) {
          const id = String(order.id);
          // Firestore merges: fields absent from an incoming order keep their stored value. A sparse
          // re-save happens for real (an order whose detail fetch failed), so replacing the payload
          // would drop itens, XML and invoice fields — and rebuildItems would delete the item rows.
          const current = (await client.query(
            'select payload from brsteel_ops.sales_orders where source_id = $1 for update', [id])).rows[0];
          const at = new Date().toISOString();
          const merged = { ...(current?.payload as Doc | undefined), ...order, importedAt: at, lastUpdated: at, isImported: true };
          await writeOrder(client, id, merged);
          await rebuildItems(client, id, merged);
          if (current) updated++; else created++;
        }
        return { count: orders.length, created, updated };
      });
    },

    async applyStockObservation(sku: string, observation: Doc) {
      await withOperationalWrite(pool, async client => {
        const current = (await client.query(
          'select payload from brsteel_ops.stock_observations where source_id = $1 for update', [sku])).rows[0];
        const previous = current?.payload as Doc | undefined;
        const payload = { ...previous, ...observation };
        await client.query(
          `insert into brsteel_ops.stock_observations (source_id, payload, source_version, source_hash, import_run_id)
           values ($1, $2, $3, $4, $5)
           on conflict (source_id) do update set payload = excluded.payload, source_version = excluded.source_version,
             source_hash = excluded.source_hash, source_deleted = false`,
          [sku, JSON.stringify(payload), nativeVersion(), contentHash(payload), NATIVE_RUN_ID]);
        // Same rule as the Firestore log (firestore-sales-ingest.ts): only a numeric balance that changed,
        // with a readable instant. Bling often redelivers the same number.
        const balance = observation.estoqueAtual;
        const observedAt = String(observation.webhookReceivedAt ?? '');
        const at = Date.parse(observedAt);
        if (typeof balance === 'number' && Number.isFinite(balance) && previous?.estoqueAtual !== balance && Number.isFinite(at)) {
          const entry = { sku, estoqueAtual: balance, observedAt, event: String(observation.lastEvent ?? ''),
            source: 'webhook', expiresAt: new Date(at + OBSERVATION_TTL_MS).toISOString() };
          // Diverge do Firestore de propósito: lá uma falha ao gravar o histórico não derruba o saldo; aqui o
          // insert está na mesma transação, então a falha aborta a gravação do saldo. Falha alta com retry do
          // webhook é melhor que perder histórico em silêncio.
          await client.query(
            `insert into brsteel_ops.stock_observation_log (source_id, payload, source_version, source_hash, import_run_id)
             values ($1, $2, $3, $4, $5)`,
            [randomUUID(), JSON.stringify(entry), nativeVersion(), contentHash(entry), NATIVE_RUN_ID]);
        }
        await rebuildStockProjection(client);
      // Every observation reads the whole projection, so concurrent ones conflict under serializable
      // isolation. Bling sends them in bursts: queue them on one lock instead of failing with 40001.
      }, { serializeOn: STOCK_PROJECTION_LOCK });
    },

    async markOrderDeleted(orderId: string, at: string) {
      await withOperationalWrite(pool, async client => {
        const current = (await client.query(
          'select payload from brsteel_ops.sales_orders where source_id = $1 for update', [orderId])).rows[0];
        // Absent is not deleted: a webhook for an order we never stored changes nothing.
        if (!current) return;
        await writeOrder(client, orderId, { ...(current.payload as Doc), deleted: true, deletedAt: at });
      });
    },
  };
}
