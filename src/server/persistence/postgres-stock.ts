import 'server-only';
import type { Pool, PoolClient } from 'pg';
import type { ProductStock } from '@/types/product-stock';
import { result } from '@/server/operations/common';
import type { StockReadRepository, StockListInput } from './stock-contract';
import { withOperationalSnapshot } from './postgres-read';
import { storedStockWarnings } from './stored-stock-model';
import { stockOffset } from './stock-pagination';

export const latestStockSql = `select distinct on (observed_sku) stock_read,observed_sku,sku_order
  from brsteel_ops.stock_observations where not source_deleted and stock_read is not null
  order by observed_sku,observed_at_ms desc,source_id desc`;

async function read(client: PoolClient, input?: StockListInput) {
  const offset = stockOffset(input?.cursor);
  const metadata = (await client.query(`select
    exists(select from brsteel_ops.stock_observations where not source_deleted and stock_read is not null) as has_data,
    (select stock_read->>'asOf' from brsteel_ops.stock_observations where not source_deleted and stock_read is not null
      order by observed_at_ms desc,source_id limit 1) as as_of`)).rows[0];
  const values: unknown[] = [];
  let filter = '', pagination = '';
  if (input?.sku) { values.push(input.sku); filter = 'where observed_sku=$1'; }
  if (input) { values.push(input.limit + 1, offset); pagination = `limit $${values.length-1} offset $${values.length}`; }
  const rows = (await client.query(`with latest as (${latestStockSql}) select stock_read from latest ${filter} order by sku_order ${pagination}`, values)).rows;
  const warnings = storedStockWarnings(metadata.has_data);
  if (input?.sku && metadata.has_data) {
    // A cursor beyond the selected SKU is not the same as a missing SKU.
    const exists = (await client.query(`select exists(select from brsteel_ops.stock_observations
      where not source_deleted and stock_read is not null and observed_sku=$1) as found`, [input.sku])).rows[0].found;
    if (!exists) warnings.push('Não há saldo de produto salvo no banco para o SKU informado.');
  }
  const data = (input ? rows.slice(0,input.limit) : rows).map(row => ({ ...row.stock_read, source: 'postgres' }) as ProductStock);
  return result(data, 'postgres', warnings, input && rows.length > input.limit ? String(offset + input.limit) : null, metadata.as_of ?? new Date().toISOString());
}
export function createPostgresStockRepository(pool: Pool): StockReadRepository {
  return { snapshot: () => withOperationalSnapshot(pool, client => read(client)),
    list: input => withOperationalSnapshot(pool, client => read(client,input)) };
}
