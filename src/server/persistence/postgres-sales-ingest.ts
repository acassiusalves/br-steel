import 'server-only';
import type { Pool, PoolClient } from 'pg';
import { NATIVE_RUN_ID, contentHash } from '@/server/migration/operational-snapshot';
import type { IngestCounts, SalesIngestRepository, SourceOrder } from './sales-ingest-contract';
import { prepareStockReadModels } from './stored-stock-model';
import { withOperationalWrite } from './postgres-write';

type Doc = Record<string, unknown>;
const nativeVersion = () => String(BigInt(Date.now()) * BigInt(1000000));

const writeOrder = (client: PoolClient, id: string, payload: Doc) => client.query(
  `insert into brsteel_ops.sales_orders (source_id, payload, source_version, source_hash, import_run_id)
   values ($1, $2, $3, $4, $5)
   on conflict (source_id) do update set payload = excluded.payload, source_version = excluded.source_version,
     source_hash = excluded.source_hash, source_deleted = false`,
  [id, JSON.stringify(payload), nativeVersion(), contentHash(payload), NATIVE_RUN_ID]);

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
async function rebuildStockProjection(client: PoolClient) {
  const rows = (await client.query(
    'select source_id, payload from brsteel_ops.stock_observations where not source_deleted')).rows;
  const models = prepareStockReadModels(rows.map(row => ({ id: row.source_id, data: row.payload as Doc })));
  for (const row of rows) {
    const model = models.get(row.source_id);
    await client.query(
      `update brsteel_ops.stock_observations set stock_read = $2, observed_at_ms = $3, sku_order = $4
       where source_id = $1`,
      [row.source_id, model ? JSON.stringify(model.stock) : null, model?.observedAtMs ?? null, model?.skuOrder ?? null]);
  }
}

export function createPostgresSalesIngestRepository(pool: Pool): SalesIngestRepository {
  return {
    async upsertOrders(orders: SourceOrder[]): Promise<IngestCounts> {
      if (!orders.length) return { count: 0, created: 0, updated: 0 };
      return withOperationalWrite(pool, async client => {
        let created = 0, updated = 0;
        for (const order of orders) {
          const id = String(order.id);
          const existing = await client.query(
            'select 1 from brsteel_ops.sales_orders where source_id = $1 and not source_deleted', [id]);
          const at = new Date().toISOString();
          await writeOrder(client, id, { ...order, importedAt: at, lastUpdated: at, isImported: true });
          await rebuildItems(client, id, order as Doc);
          if (existing.rowCount) updated++; else created++;
        }
        return { count: orders.length, created, updated };
      });
    },

    async applyStockObservation(sku: string, observation: Doc) {
      await withOperationalWrite(pool, async client => {
        const current = (await client.query(
          'select payload from brsteel_ops.stock_observations where source_id = $1 for update', [sku])).rows[0];
        const payload = { ...(current?.payload as Doc | undefined), ...observation };
        await client.query(
          `insert into brsteel_ops.stock_observations (source_id, payload, source_version, source_hash, import_run_id)
           values ($1, $2, $3, $4, $5)
           on conflict (source_id) do update set payload = excluded.payload, source_version = excluded.source_version,
             source_hash = excluded.source_hash, source_deleted = false`,
          [sku, JSON.stringify(payload), nativeVersion(), contentHash(payload), NATIVE_RUN_ID]);
        await rebuildStockProjection(client);
      });
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
