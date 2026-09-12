import 'server-only';
import type { Pool, PoolClient } from 'pg';
import { OperationError, result } from '@/server/operations/common';
import type { ProductionListInput, ProductionOrder, ProductionReadRepository, ProductionRecord, ProductionView } from './production-contract';
import { productionFields, productionIdentityFields, productionOrderItemFields } from './production-read-projection';
import { productionDocumentCursor, productionOrderOffset } from './production-read-pagination';
import { withOperationalSnapshot } from './postgres-read';

const tables = { columns: 'production_columns', lots: 'production_lots', items: 'production_lot_items', comments: 'production_comments', orders: 'sales_orders' };

// Expressions and field names here are source constants, never caller input.
function pickSql(expression: string, fields: readonly string[]) {
  return `(select coalesce(jsonb_object_agg(key,value),'{}'::jsonb)
    from jsonb_each(case when jsonb_typeof(${expression})='object' then ${expression} else '{}'::jsonb end)
    where key in (${fields.map(field => `'${field}'`).join(',')}))`;
}
function falsySql(expression: string) {
  return `(${expression} is null or ${expression} in ('null'::jsonb,'false'::jsonb,'0'::jsonb,'""'::jsonb))`;
}
function recordSql(view: Exclude<ProductionView, 'orders'>) {
  const fields: readonly string[] = productionFields[view];
  const identities = (Object.keys(productionIdentityFields) as (keyof typeof productionIdentityFields)[]).filter(key => fields.includes(key));
  const ordinary = fields.filter(key => !identities.includes(key as keyof typeof productionIdentityFields));
  let expression = `jsonb_build_object('id',o.source_id) || ${pickSql('o.payload', ordinary)}`;
  for (const key of identities) {
    const identity = `o.payload->'${key}'`;
    expression += ` || case when o.payload ? '${key}' then jsonb_build_object('${key}',
      case when ${falsySql(identity)} then ${identity} else ${pickSql(identity, productionIdentityFields[key])} end) else '{}'::jsonb end`;
  }
  if (view === 'items') expression += ` || jsonb_build_object('customerName','')`;
  return expression;
}
const orderItemSql = `${pickSql('i.payload', productionOrderItemFields)} || jsonb_build_object(
  'id',coalesce(nullif(i.payload->'id','null'::jsonb),to_jsonb(i.position)),
  'unidade',case when ${falsySql("i.payload->'unidade'")} then '"UN"'::jsonb else i.payload->'unidade' end)`;
const orderSql = `jsonb_build_object('id',o.source_id) || ${pickSql('o.payload', ['numero'])} || jsonb_build_object('itens',
  (select coalesce(jsonb_agg(${orderItemSql} order by i.position),'[]'::jsonb) from brsteel_ops.sales_order_items i where i.order_id=o.source_id))`;

function missing() { return new OperationError('NOT_FOUND', 'Registro não encontrado.', 404); }
async function requireLot(client: PoolClient, lotId: string) {
  const found = await client.query('select 1 from brsteel_ops.production_lots where source_id=$1 and not source_deleted', [lotId]);
  if (!found.rowCount) throw missing();
}
async function listPage(client: PoolClient, input: ProductionListInput) {
  const cursor = productionDocumentCursor(input.cursor);
  const values: unknown[] = [];
  const param = (value: unknown) => { values.push(value); return `$${values.length}`; };
  const filters = ['not o.source_deleted'];
  if (input.view === 'items' || input.view === 'comments') {
    const lot = param(input.lotId);
    filters.push(`o.lot_id=${lot}`, `o.payload->'lotId'=to_jsonb(${lot}::text)`);
  }
  if (cursor) filters.push(`o.source_id>${param(cursor)}`);
  const projection = input.view === 'orders' ? orderSql : recordSql(input.view);
  const rows = (await client.query(`select o.source_id,${projection} as data from brsteel_ops.${tables[input.view]} o
    where ${filters.join(' and ')} order by o.source_id limit ${param(input.limit + 1)}`, values)).rows;
  const page = rows.slice(0, input.limit);
  const nextCursor = rows.length > input.limit ? Buffer.from(page.at(-1)!.source_id).toString('base64url') : null;
  return { data: page.map(row => row.data as ProductionRecord), nextCursor };
}

/** Candidate only. Every SQL response is projected before it leaves the database. */
export function createPostgresProductionRepository(pool: Pool): ProductionReadRepository {
  return {
    async list(input) {
      if ((input.view === 'items' || input.view === 'comments') && !input.lotId) throw new OperationError('INVALID_INPUT', 'Informe o lote.');
      return withOperationalSnapshot(pool, async client => {
        if (input.view === 'items' || input.view === 'comments') await requireLot(client, input.lotId!);
        const page = await listPage(client, input);
        return result(page.data, 'postgres', [], page.nextCursor);
      });
    },
    async getOrder(input) {
      const offset = productionOrderOffset(input.cursor);
      return withOperationalSnapshot(pool, async client => {
        const row = (await client.query(`select jsonb_build_object('id',o.source_id) || ${pickSql('o.payload', ['numero'])} as data
          from brsteel_ops.sales_orders o where o.source_id=$1 and not o.source_deleted`, [input.orderId])).rows[0];
        if (!row) throw missing();
        const items = (await client.query(`select ${orderItemSql} as data from brsteel_ops.sales_order_items i
          where i.order_id=$1 order by i.position limit $2 offset $3`, [input.orderId, input.limit + 1, offset])).rows;
        const data: ProductionOrder = { ...row.data, itens: items.slice(0, input.limit).map(item => item.data) };
        return result(data, 'postgres', [], items.length > input.limit ? String(offset + input.limit) : null);
      });
    },
    async getLot(input) {
      return withOperationalSnapshot(pool, async client => {
        const row = (await client.query(`select ${recordSql('lots')} as data from brsteel_ops.production_lots o
          where o.source_id=$1 and not o.source_deleted`, [input.lotId])).rows[0];
        if (!row) throw missing();
        const lot = row.data as ProductionRecord;
        const page = await listPage(client, { ...input, view: 'items' });
        const linked = Array.isArray(lot.linkedOrderIds) ? lot.linkedOrderIds : [];
        lot.linkedOrderIds = linked.slice(0, 100);
        return result({ lot, items: page.data }, 'postgres', linked.length > 100 ? ['Pedidos vinculados limitados a 100 entradas.'] : [], page.nextCursor);
      });
    },
  };
}
