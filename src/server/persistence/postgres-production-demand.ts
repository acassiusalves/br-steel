import 'server-only';
import type { Pool } from 'pg';
import { dateRangeSchema, result } from '@/server/operations/common';
import type { HistoryPoint, ProductionDemand, ProductionDemandReadRepository } from './production-demand-contract';
import { isoWeekOf, isoWeekRange } from '@/lib/iso-week';
import { withOperationalSnapshot } from './postgres-read';
import { latestStockSql } from './postgres-stock';
import { storedStockWarnings } from './stored-stock-model';
import { buildCancelledStatusSqlFragment } from './demand-eligibility';

function buildDemandSql(): string {
  const cancelledStatusFragment = buildCancelledStatusSqlFragment();
  return `with valid_items as (
  select o.source_id,i.position,i.payload->'codigo' as sku,i.payload->'descricao' as description,
    i.payload ? 'descricao' as description_present,i.quantity,
    row_number() over(order by o.order_date,o.source_id,i.position) as item_order,
    case when jsonb_typeof(i.payload->'codigo') in ('object','array')
      then jsonb_build_array('reference',o.source_id,i.position) else jsonb_build_array('value',i.payload->'codigo') end as sku_key,
    case when not (o.payload ? 'id') then jsonb_build_array('missing')
      when jsonb_typeof(o.payload->'id') in ('object','array') then jsonb_build_array('reference',o.source_id)
      else jsonb_build_array('value',o.payload->'id') end as order_key
  from brsteel_ops.sales_orders o join brsteel_ops.sales_order_items i on i.order_id=o.source_id
  where not o.source_deleted and o.order_date between $1 and $2
    and coalesce(o.payload#>'{notaFiscal,id}','null'::jsonb) not in ('null'::jsonb,'false'::jsonb,'0'::jsonb,'""'::jsonb)
    and coalesce(o.payload#>'{situacao,id}','null'::jsonb) ${cancelledStatusFragment}
    and coalesce(i.payload->'codigo','null'::jsonb) not in ('null'::jsonb,'false'::jsonb,'0'::jsonb,'""'::jsonb)
    and i.quantity>0
), aggregated as (
  select sku_key,count(distinct order_key)::int as order_count,sum(quantity order by item_order) as quantity,min(item_order) as first_seen
  from valid_items group by sku_key
), latest_stock as (${latestStockSql}), limits as (
  select distinct on (lookup_sku) lookup_sku,payload->'estoqueMinimo' as minimum,payload->'estoqueMaximo' as maximum
  from brsteel_ops.supplies where not source_deleted order by lookup_sku,source_id desc
)
select f.sku,f.description,f.description_present,a.order_count,a.quantity,s.stock_read,l.minimum,l.maximum
from aggregated a join valid_items f on f.item_order=a.first_seen
left join latest_stock s on to_jsonb(s.observed_sku)=f.sku
left join limits l on to_jsonb(l.lookup_sku)=f.sku
order by a.quantity desc,a.first_seen`;
}

export const demandSql = buildDemandSql();

export function createPostgresProductionDemandRepository(pool: Pool): ProductionDemandReadRepository {
  return { async read(raw) {
    const input = dateRangeSchema.parse(raw);
    return withOperationalSnapshot(pool, async client => {
      const rows = (await client.query(demandSql, [input.from,input.to])).rows;
      const hasStock = (await client.query(`select exists(select from brsteel_ops.stock_observations
        where not source_deleted and stock_read is not null) as found`)).rows[0].found;
      // Mesma semântica do leitor Firestore: as 12 semanas fechadas mais recentes do rollup e, se o
      // período alcança a semana corrente, o ponto aberto calculado dos pedidos vivos. A semana
      // corrente nunca é gravada pelo rollup; o filtro é só uma garantia.
      const currentWeek = isoWeekOf(new Date());
      const { from: weekFrom, to: weekTo } = isoWeekRange(currentWeek);
      // O source_id de linhas importadas do Firestore pode ser um id saneado (`CHAPA_10~abc...`):
      // o SKU verdadeiro está em payload.sku.
      const stored = (await client.query(
        'select source_id, payload from brsteel_ops.sku_weekly_demand where not source_deleted order by source_id')).rows;
      const closed = new Map<string, HistoryPoint[]>();
      for (const row of stored) {
        const weeksMap = (row.payload.weeks ?? {}) as Record<string, { units: number; orders: number }>;
        const points = Object.keys(weeksMap).sort().filter(week => week !== currentWeek)
          .map(week => ({ week, units: weeksMap[week].units, orders: weeksMap[week].orders })).slice(-12);
        if (points.length) closed.set(String(row.payload.sku || row.source_id), points);
      }
      const openFrom = input.from > weekFrom ? input.from : weekFrom;
      const openTo = input.to < weekTo ? input.to : weekTo;
      const open = new Map<string, { units: number; orders: number }>();
      if (openFrom <= openTo) {
        for (const row of (await client.query(demandSql, [openFrom, openTo])).rows) {
          if (typeof row.sku === 'string') open.set(row.sku, { units: Number(row.quantity), orders: row.order_count });
        }
      }
      const weeks = Math.max(1,(Date.parse(input.to)-Date.parse(input.from)+86400000)/86400000/7);
      const data: ProductionDemand[] = rows.map(row => ({
        sku: row.sku, description: row.description_present ? row.description : undefined,
        orderCount: row.order_count, totalQuantitySold: row.quantity, weeklyAverage: row.quantity/weeks,
        corte: Math.floor(row.quantity/weeks*2), dobra: Math.floor(row.quantity/weeks*1.5),
        stockLevel: row.stock_read?.saldoVirtualTotal ?? null,
        stockSource: row.stock_read ? 'postgres' : 'unavailable', stockAsOf: row.stock_read?.virtualAsOf ?? null,
        stockMin: row.minimum ?? undefined, stockMax: row.maximum ?? undefined,
        history: (() => {
          const sku = typeof row.sku === 'string' ? row.sku : String(row.sku);
          const point = open.get(sku);
          const closedPoints = closed.get(sku) ?? [];
          return point ? [...closedPoints, { week: currentWeek, units: point.units, orders: point.orders, open: true as const }] : closedPoints;
        })(),
      }));
      const warnings = storedStockWarnings(hasStock);
      if (data.some(row => row.stockLevel === null)) warnings.push('Saldo de estoque não encontrado no banco para parte dos SKUs da demanda; esses valores são nulos.');
      if (!data.length) warnings.push('Nenhum pedido faturado com itens válidos foi encontrado no banco de dados deste ambiente no período informado.');
      return result(data, 'postgres', warnings);
    });
  } };
}
