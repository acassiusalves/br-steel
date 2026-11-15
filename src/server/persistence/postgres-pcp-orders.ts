import 'server-only';
import type { Pool, PoolClient } from 'pg';
import { OperationError, result } from '@/server/operations/common';
import {
  IAPP_HEADER, componentQuantity, iappImportRows, orderStepsFromRoute, pickSheet, suggestOrders, type SheetOption,
} from '@/lib/pcp/op-generator';
import type {
  BatchInput, BatchSummary, GenerationPreview, OrderKind, OrderStatus, PreviewInput, ProductionOrderRepository, ProductionOrderRow,
} from './pcp-orders-contract';
import { createPostgresProductionDemandRepository } from './postgres-production-demand';
import { OFFICIAL_LINE_SKUS } from '@/lib/pcp/official-line';
import { createBlingReader, type BlingReader } from '@/server/integrations/bling-catalog';
import type { PlanningRow } from '@/lib/pcp/op-generator';
import { recordWriteAudit, type WriteActor } from './write-audit';
import { withOperationalWrite } from './postgres-write';

type Row = Record<string, unknown>;

const SHEETS_SQL = `select s.id, s.code, s.sku, s.name, s.base_quantity,
  (select count(*)::int from brsteel_pcp.product_sheet_steps t where t.sheet_id = s.id) step_count
  from brsteel_pcp.product_sheets s where s.status in ('aberto', 'aberto_avulso')`;

const sheetOption = (r: Row): SheetOption => ({ id: String(r.id), code: String(r.code), sku: String(r.sku), name: String(r.name), stepCount: Number(r.step_count) });

function groupBySku(rows: Row[]): Map<string, SheetOption[]> {
  const map = new Map<string, SheetOption[]>();
  for (const row of rows) map.set(String(row.sku), [...(map.get(String(row.sku)) ?? []), sheetOption(row)]);
  return map;
}

/** Grava a OP e suas ordens de serviço copiadas do roteiro da ficha. */
async function insertOrder(client: PoolClient, order: { batchId: string; parentId: string | null; kind: OrderKind; sku: string;
  description: string | null; sheetId: string; quantity: number; createdBy: string }): Promise<string> {
  const id = (await client.query(
    `insert into brsteel_pcp.production_orders (batch_id, parent_order_id, kind, sku, description, sheet_id, quantity, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
    [order.batchId, order.parentId, order.kind, order.sku, order.description, order.sheetId, order.quantity, order.createdBy])).rows[0].id as string;
  const route = (await client.query(
    `select t.id, t.operation_id, p.operation_id as predecessor_operation_id
     from brsteel_pcp.product_sheet_steps t left join brsteel_pcp.product_sheet_steps p on p.id = t.predecessor_step_id
     where t.sheet_id = $1 order by t.position`, [order.sheetId])).rows as Row[];
  const steps = orderStepsFromRoute(route.map(r => ({ id: String(r.id), operationId: String(r.operation_id),
    predecessorOperationId: (r.predecessor_operation_id as string) ?? null })));
  const stepIds = new Map<string, string>();
  for (const step of steps) {
    stepIds.set(step.operationId, (await client.query(
      'insert into brsteel_pcp.production_order_steps (order_id, operation_id, position) values ($1, $2, $3) returning id',
      [id, step.operationId, step.position])).rows[0].id as string);
  }
  for (const step of steps.filter(s => s.predecessorOperationId)) {
    await client.query('update brsteel_pcp.production_order_steps set predecessor_step_id = $2 where id = $1',
      [stepIds.get(step.operationId), stepIds.get(step.predecessorOperationId!)]);
  }
  return id;
}

/**
 * O mín/máx exige um GET por produto no Bling (~30 s para a linha toda). O cálculo relê o cadastro
 * quando a última leitura passou de uma hora; dentro da hora, reaproveita. O saldo é lido sempre.
 */
const CATALOG_FRESH_MS = 3_600_000;
/** Depois de uma releitura que falhou, só tenta de novo após este intervalo (não martela o Bling). */
const CATALOG_RETRY_MS = 5 * 60_000;
const CATALOG_SQL = 'select sku, bling_id, name, format, stock_min, stock_max, synced_at from brsteel_pcp.bling_products where sku = any($1)';

export function createPostgresProductionOrderRepository(pool: Pool, bling: BlingReader = createBlingReader()): ProductionOrderRepository {
  const demand = createPostgresProductionDemandRepository(pool);
  // Uma releitura por vez nesta instância: cálculos simultâneos esperam a mesma leitura do Bling.
  let refreshing: Promise<unknown> | null = null;
  let lastAttempt = 0;
  const refreshCatalog = (actor: WriteActor) => {
    if (refreshing) return refreshing;
    if (Date.now() - lastAttempt < CATALOG_RETRY_MS) return Promise.resolve();
    lastAttempt = Date.now();
    refreshing = repository.syncBlingCatalog(actor).finally(() => { refreshing = null; });
    return refreshing;
  };
  const readCatalog = async () => (await pool.query(CATALOG_SQL, [OFFICIAL_LINE_SKUS])).rows as Row[];
  const latestSync = (rows: Row[]) => rows.reduce((latest, r) => Math.max(latest, (r.synced_at as Date).getTime()), 0);
  const repository: ProductionOrderRepository = {
    async preview(input: PreviewInput, actor: WriteActor | null) {
      const warnings: string[] = [];
      let catalogRows = await readCatalog();
      if (Date.now() - latestSync(catalogRows) > CATALOG_FRESH_MS) {
        // Só quem pode gerar OP dispara a releitura (que grava a cópia); os demais usam a última leitura.
        if (actor) {
          try { await refreshCatalog(actor); } catch { /* segue com a leitura anterior, com aviso abaixo */ }
          catalogRows = await readCatalog();
        }
        if (!catalogRows.length) {
          throw new OperationError('NO_CATALOG', actor
            ? 'Não foi possível ler o mínimo e o máximo no Bling. Tente de novo em instantes.'
            : 'O mínimo e o máximo ainda não foram lidos do Bling. Peça a quem gera OP para calcular a sugestão.', 503);
        }
        const syncedAt = latestSync(catalogRows);
        if (Date.now() - syncedAt > CATALOG_FRESH_MS) {
          warnings.push(`Mínimo e máximo da última leitura do Bling (${new Date(syncedAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}); não foi possível reler agora.`);
        }
      }
      const catalog = new Map(catalogRows.map(r => [String(r.sku), r]));
      // Saldo do depósito Estoque lido do Bling agora: é o único que decide OP (sem Perdas, cortado ou matéria-prima).
      let balances: Map<number, number>;
      try { balances = await bling.estoqueBalances(catalogRows.map(r => Number(r.bling_id))); }
      catch { throw new OperationError('BLING_UNAVAILABLE', 'Não foi possível ler o saldo do depósito Estoque no Bling. Tente de novo em instantes.', 503); }
      // Vendidos e média continuam vindo dos pedidos faturados gravados no banco (a troca pelas notas fiscais vem depois).
      const read = await demand.read({ from: input.from, to: input.to });
      const sold = new Map(read.data.map(d => [String(d.sku), d]));
      const open = new Map(((await pool.query(
        `select sku, sum(quantity) as quantity from brsteel_pcp.production_orders
         where parent_order_id is null and kind = $1 and status in ('a_produzir', 'produzindo', 'suspenso') group by sku`,
        [input.kind])).rows as Row[]).map(r => [String(r.sku), Number(r.quantity)]));
      const rows: PlanningRow[] = [];
      const missingCatalog: string[] = [], missingLimits: string[] = [], kits: string[] = [];
      for (const sku of OFFICIAL_LINE_SKUS) {
        const product = catalog.get(sku);
        if (!product) { missingCatalog.push(sku); continue; }
        if (product.format === 'E') { kits.push(sku); continue; }
        const limitsKnown = product.stock_min !== null && product.stock_max !== null;
        if (!limitsKnown) missingLimits.push(sku);
        const demandRow = sold.get(sku);
        rows.push({
          sku, description: (product.name as string) ?? (demandRow?.description as string | undefined) ?? null,
          totalQuantitySold: Number(demandRow?.totalQuantitySold ?? 0), weeklyAverage: Number(demandRow?.weeklyAverage ?? 0),
          stockLevel: balances.get(Number(product.bling_id)) ?? null,
          stockMin: limitsKnown ? Number(product.stock_min) : null, stockMax: limitsKnown ? Number(product.stock_max) : null,
          openQuantity: open.get(sku) ?? 0,
        });
      }
      const sheets = groupBySku((await pool.query(SHEETS_SQL)).rows as Row[]);
      const suggestions = suggestOrders(rows, sheets, input.factor);
      const syncedAt = latestSync(catalogRows);
      if (missingCatalog.length) warnings.push(`${missingCatalog.length} SKU(s) da linha oficial não estão no cadastro copiado do Bling: ${missingCatalog.join(', ')}.`);
      if (missingLimits.length) warnings.push(`${missingLimits.length} SKU(s) sem estoque mínimo e máximo no Bling não foram dimensionados: ${missingLimits.join(', ')}.`);
      if (kits.length) warnings.push(`Kits fora da fila de fábrica: ${kits.join(', ')}.`);
      const missing = suggestions.filter(s => !s.sheet).length;
      if (missing) warnings.push(`${missing} item(ns) da fila não têm ficha técnica com roteiro e não podem virar OP.`);
      const preview: GenerationPreview = { ...input, suggestions, warnings, catalogSyncedAt: new Date(syncedAt).toISOString() };
      return result(preview, 'postgres', [], null, read.asOf);
    },

    async syncBlingCatalog(actor: WriteActor) {
      let products;
      try { products = await bling.products(OFFICIAL_LINE_SKUS); }
      catch { throw new OperationError('BLING_UNAVAILABLE', 'Não foi possível ler o cadastro no Bling. Tente de novo em instantes.', 503); }
      return withOperationalWrite(pool, async client => {
        for (const p of products) {
          await client.query(
            `insert into brsteel_pcp.bling_products (sku, bling_id, name, format, stock_min, stock_max, synced_at)
             values ($1, $2, $3, $4, $5, $6, now())
             on conflict (sku) do update set bling_id = excluded.bling_id, name = excluded.name, format = excluded.format,
               stock_min = excluded.stock_min, stock_max = excluded.stock_max, synced_at = now()`,
            [p.sku, p.blingId, p.name?.slice(0, 300) ?? null, p.format?.slice(0, 5) ?? null, p.stockMin, p.stockMax]);
        }
        await recordWriteAudit(client, { operation: 'pcp.syncBlingCatalog', actor, target: { collection: 'pcp.blingProducts', id: 'linha-oficial' } });
        const found = new Set(products.map(p => p.sku));
        return result({ synced: products.length, missing: OFFICIAL_LINE_SKUS.filter(sku => !found.has(sku)) }, 'postgres');
      });
    },

    async createBatch(input: BatchInput, actor: WriteActor) {
      return withOperationalWrite(pool, async client => {
        const sheetRows = (await client.query(SHEETS_SQL)).rows as Row[];
        const byId = new Map(sheetRows.map(r => [String(r.id), r]));
        const bySku = groupBySku(sheetRows);
        for (const item of input.items) {
          const sheet = byId.get(item.sheetId);
          if (!sheet) throw new OperationError('INVALID_INPUT', `Ficha não encontrada para ${item.sku}.`);
          if (String(sheet.sku) !== item.sku) throw new OperationError('INVALID_INPUT', `A ficha ${sheet.code} não é do SKU ${item.sku}.`);
          if (!Number(sheet.step_count)) throw new OperationError('INVALID_INPUT', `A ficha ${sheet.code} não tem roteiro.`);
        }
        const batchId = (await client.query(
          'insert into brsteel_pcp.production_order_batches (kind, params, created_by) values ($1, $2, $3) returning id',
          [input.kind, JSON.stringify({ from: input.from, to: input.to, factor: input.factor }), actor.userId])).rows[0].id as string;
        let childCount = 0;
        for (const item of input.items) {
          const parentId = await insertOrder(client, { batchId, parentId: null, kind: input.kind, sku: item.sku,
            description: item.description, sheetId: item.sheetId, quantity: item.quantity, createdBy: actor.userId });
          if (input.kind !== 'corte') continue;
          // Multinível do corte: uma OP filha por parte da estrutura que tem ficha própria.
          const sheet = byId.get(item.sheetId)!;
          const components = (await client.query(
            `select component_sku, component_name, sum(quantity) as quantity from brsteel_pcp.product_sheet_components
             where sheet_id = $1 group by component_sku, component_name order by component_sku`, [item.sheetId])).rows as Row[];
          for (const component of components) {
            const childSheet = pickSheet(bySku.get(String(component.component_sku)) ?? []);
            if (!childSheet) continue;
            await insertOrder(client, { batchId, parentId, kind: 'corte', sku: String(component.component_sku),
              description: (component.component_name as string) ?? null, sheetId: childSheet.id,
              quantity: componentQuantity(item.quantity, Number(component.quantity), Number(sheet.base_quantity)), createdBy: actor.userId });
            childCount++;
          }
        }
        await recordWriteAudit(client, { operation: 'pcp.createOrderBatch', actor, target: { collection: 'pcp.orderBatches', id: batchId } });
        return result({ batchId, orderCount: input.items.length, childCount }, 'postgres');
      });
    },

    async listBatches() {
      const rows = (await pool.query(
        `select b.id, b.kind, b.created_at, b.created_by, b.exported_at,
           (select count(*)::int from brsteel_pcp.production_orders o where o.batch_id = b.id and o.parent_order_id is null) order_count,
           (select count(*)::int from brsteel_pcp.production_orders o where o.batch_id = b.id and o.parent_order_id is not null) child_count
         from brsteel_pcp.production_order_batches b order by b.created_at desc limit 100`)).rows as Row[];
      return result(rows.map((r): BatchSummary => ({ id: String(r.id), kind: r.kind as OrderKind, createdAt: (r.created_at as Date).toISOString(),
        createdBy: String(r.created_by), exportedAt: r.exported_at ? (r.exported_at as Date).toISOString() : null,
        orderCount: Number(r.order_count), childCount: Number(r.child_count) })), 'postgres');
    },

    async listOrders(batchId: string | null) {
      const rows = (await pool.query(
        `select o.id, o.number, o.kind, o.sku, o.description, s.code as sheet_code, o.quantity, o.status, o.parent_order_id, o.batch_id,
           o.created_at, (select count(*)::int from brsteel_pcp.production_order_steps t where t.order_id = o.id) step_count
         from brsteel_pcp.production_orders o left join brsteel_pcp.product_sheets s on s.id = o.sheet_id
         where ($1::uuid is null or o.batch_id = $1) order by o.number desc limit 500`, [batchId])).rows as Row[];
      return result(rows.map((r): ProductionOrderRow => ({ id: String(r.id), number: Number(r.number), kind: r.kind as OrderKind, sku: String(r.sku),
        description: (r.description as string) ?? null, sheetCode: (r.sheet_code as string) ?? null, quantity: Number(r.quantity),
        status: r.status as OrderStatus, parentOrderId: (r.parent_order_id as string) ?? null, batchId: (r.batch_id as string) ?? null,
        createdAt: (r.created_at as Date).toISOString(), stepCount: Number(r.step_count) })), 'postgres');
    },

    async exportIapp(batchId: string, actor: WriteActor) {
      return withOperationalWrite(pool, async client => {
        const batch = (await client.query('select kind from brsteel_pcp.production_order_batches where id = $1 for update', [batchId])).rows[0];
        if (!batch) throw new OperationError('NOT_FOUND', 'Lote não encontrado.', 404);
        // Só as OPs mães: no corte o iApp gera as OPs das partes a partir do multinível "S".
        const orders = (await client.query(
          `select s.code, o.quantity, o.kind from brsteel_pcp.production_orders o join brsteel_pcp.product_sheets s on s.id = o.sheet_id
           where o.batch_id = $1 and o.parent_order_id is null order by o.number`, [batchId])).rows as Row[];
        await client.query('update brsteel_pcp.production_order_batches set exported_at = now() where id = $1', [batchId]);
        await recordWriteAudit(client, { operation: 'pcp.exportIapp', actor, target: { collection: 'pcp.orderBatches', id: batchId } });
        const rows = iappImportRows(orders.map(o => ({ sheetCode: String(o.code), quantity: Number(o.quantity), kind: o.kind as OrderKind })));
        return result({ batchId, kind: batch.kind as OrderKind, header: IAPP_HEADER, rows }, 'postgres');
      });
    },
  };
  return repository;
}
