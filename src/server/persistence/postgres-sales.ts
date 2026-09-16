import 'server-only';
import type { Pool } from 'pg';
import { z } from 'zod';
import type { SaleOrder } from '@/types/sale-order';
import { dateSchema, dateRangeSchema, documentIdSchema, result, OperationError } from '@/server/operations/common';
import type { ImportedOrderFilter, SalesMetric, SalesReadRepository, SalesSummary } from './sales-contract';
import { withOperationalSnapshot } from './postgres-read';

const metrics = (table: string) => `(select jsonb_build_object('totalRevenue',coalesce(sum(amount order by order_date,source_id),0),
  'totalSales',count(*),'averageTicket',case when count(*)=0 then 0 else sum(amount order by order_date,source_id)/count(*) end,
  'uniqueCustomers',count(distinct customer_key)) from ${table})`;
const summarySql = `with current_orders as (
  select *,row_number() over(order by order_date,source_id) as source_position
  from brsteel_ops.sales_orders where not source_deleted and order_date between $1 and $2
), previous_orders as (
  select * from brsteel_ops.sales_orders where not source_deleted and order_date between $3 and $4
), current_items as (
  select i.payload,i.quantity,i.unit_price,
    row_number() over(order by o.order_date,o.source_id,i.position) as item_position
  from current_orders o join brsteel_ops.sales_order_items i on i.order_id=o.source_id
), products as (
  select coalesce(nullif(payload->>'descricao',''),nullif(payload->>'codigo',''),'Produto sem nome') as name,
    sum(quantity order by item_position) as total,
    sum(quantity*unit_price order by item_position) as revenue,
    min(item_position) as first_seen
  from current_items group by 1
), states as (
  select coalesce(nullif(payload#>>'{transporte,etiqueta,uf}',''),'N/A') as state,
    sum(amount order by order_date,source_id) as revenue,
    min(source_position) as first_seen
  from current_orders group by 1
)
select ${metrics('current_orders')} as current, ${metrics('previous_orders')} as previous,
  (select coalesce(jsonb_agg(jsonb_build_object('name',name,'total',total,'revenue',revenue) order by revenue desc,first_seen), '[]'::jsonb)
    from (select * from products order by revenue desc,first_seen limit 10) ranked) as products,
  (select coalesce(jsonb_agg(jsonb_build_object('state',state,'revenue',revenue) order by revenue desc,first_seen),'[]'::jsonb) from states) as states`;

/** Candidate adapter only. The active repository still exports Firestore. Callers authorize access. */
export function createPostgresSalesRepository(pool: Pool): SalesReadRepository {
  return {
    async list(input) {
      let cursor: { date: string; id: string } | undefined;
      if (input.cursor) {
        try { cursor = z.object({ date: dateSchema, id: documentIdSchema }).parse(JSON.parse(Buffer.from(input.cursor,'base64url').toString('utf8'))); }
        catch { throw new OperationError('INVALID_CURSOR','Paginação inválida.'); }
      }
      return withOperationalSnapshot(pool, async client => {
        const filters = ['not source_deleted','order_date is not null'];
        const values: unknown[] = [];
        const param = (value: unknown) => { values.push(value); return `$${values.length}`; };
        if (input.from) filters.push(`order_date>=${param(input.from)}`);
        if (input.to) filters.push(`order_date<=${param(input.to)}`);
        if (input.storeId !== undefined) filters.push(`store_key=to_jsonb(${param(input.storeId)}::double precision)`);
        if (input.statusId !== undefined) filters.push(`status_key=to_jsonb(${param(input.statusId)}::double precision)`);
        if (cursor) filters.push(`(order_date,source_id)<(${param(cursor.date)},${param(cursor.id)})`);
        const rows = (await client.query(`select source_id,order_date,payload from brsteel_ops.sales_orders where ${filters.join(' and ')}
          order by order_date desc,source_id desc limit ${param(input.limit+1)}`, values)).rows;
        const page = rows.slice(0,input.limit), last = page.at(-1);
        const next = rows.length>input.limit ? Buffer.from(JSON.stringify({ date:last.order_date,id:last.source_id })).toString('base64url') : null;
        return result(page.map(row => row.payload as SaleOrder),'postgres',[],next);
      });
    },
    async get(id) {
      return withOperationalSnapshot(pool, async client => {
        const row = (await client.query('select payload from brsteel_ops.sales_orders where source_id=$1 and not source_deleted',[id])).rows[0];
        if (!row) throw new OperationError('NOT_FOUND','Pedido não encontrado.',404);
        return result(row.payload as SaleOrder,'postgres');
      });
    },
    async count() {
      // Sem filtrar `source_deleted`, para igualar o adaptador Firestore: a tela administrativa conta
      // documentos, e um pedido excluído na origem continua salvo aqui. Divergir por fonte seria pior
      // que qualquer definição — a mesma tela tem de responder o mesmo número nos dois bancos.
      return withOperationalSnapshot(pool, async client => Number(
        (await client.query('select count(*)::bigint as total from brsteel_ops.sales_orders')).rows[0].total));
    },
    async lastOrderDate() {
      return withOperationalSnapshot(pool, async client => {
        const row = (await client.query(
          'select max(order_date) as last from brsteel_ops.sales_orders')).rows[0];
        // `order_date` é `date`; o driver devolve `Date`, e a fronteira fala texto civil.
        return row?.last ? new Date(row.last).toISOString().slice(0, 10) : null;
      });
    },
    async importedOrderIds(filter: ImportedOrderFilter) {
      return withOperationalSnapshot(pool, async client => {
        // Mesmas regras do Firestore: itens obrigatórios, exigências fiscais só para quem tem nota.
        const rows = (await client.query(
          `select source_id from brsteel_ops.sales_orders
             where jsonb_array_length(coalesce(payload->'itens','[]'::jsonb)) > 0
               and (not $1::boolean or coalesce((payload->'notaFiscal'->>'id')::numeric,0) <= 0
                    or coalesce((payload->'notaFiscal'->>'xmlAvailable')::boolean,false))
               and (not $2::boolean or coalesce((payload->'notaFiscal'->>'id')::numeric,0) <= 0
                    or coalesce((payload->'notaFiscal'->>'hasFiscalDetails')::boolean,false))`,
          [Boolean(filter.requireInvoiceXml), Boolean(filter.requireInvoiceDetails)])).rows;
        return new Set(rows.map(row => String(row.source_id)));
      });
    },
    async readOrdersForPeriod(input) {
      const range = dateRangeSchema.parse(input);
      return withOperationalSnapshot(pool, async client => (await client.query(
        'select payload from brsteel_ops.sales_orders where not source_deleted and order_date between $1 and $2 order by order_date,source_id',
        [range.from,range.to])).rows.map(row => row.payload as SaleOrder));
    },
    async summarize(input, options) {
      dateRangeSchema.parse(input);
      const day = 86400000, from = Date.parse(`${input.from}T00:00:00Z`), to = Date.parse(`${input.to}T00:00:00Z`);
      const previousPeriod = dateRangeSchema.parse({ from:new Date(from-(to-from+day)).toISOString().slice(0,10), to:new Date(from-day).toISOString().slice(0,10) });
      return withOperationalSnapshot(pool, async client => {
        const row = (await client.query(summarySql,[input.from,input.to,previousPeriod.from,previousPeriod.to])).rows[0];
        const current = row.current as Record<SalesMetric,number>, previous = row.previous as Record<SalesMetric,number>;
        const warnings: string[] = [];
        if (options.databaseOnly && !current.totalSales) warnings.push('Nenhum pedido encontrado no banco de dados deste ambiente no período informado. Os totais representam somente os dados salvos; esta consulta não verifica o estado das integrações externas.');
        const comparison = (key: SalesMetric) => {
          if (previous[key]===0) { warnings.push(`Comparação de ${key} indisponível: o período anterior não tem base maior que zero.`); return { value:current[key],change:null }; }
          return { value:current[key],change:(current[key]-previous[key])/Math.abs(previous[key])*100 };
        };
        const data: SalesSummary = { ...current,previousPeriod,topProducts:row.products,salesByState:row.states,
          stats:{ totalRevenue:comparison('totalRevenue'),totalSales:comparison('totalSales'),averageTicket:comparison('averageTicket'),uniqueCustomers:comparison('uniqueCustomers') } };
        return result(data,'postgres',warnings);
      });
    },
  };
}
