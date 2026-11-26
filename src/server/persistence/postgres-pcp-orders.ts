import 'server-only';
import type { Pool, PoolClient } from 'pg';
import { OperationError, result } from '@/server/operations/common';
import {
  IAPP_HEADER, componentQuantity, iappImportRows, orderStepsFromRoute, pickSheet, productionQueue, suggestOrders, suggestedQuantity, type SheetOption,
} from '@/lib/pcp/op-generator';
import type {
  BatchInput, BatchSummary, GenerationPreview, OrderKind, OrderOrigin, OrderStatus, ProducibleProduct, ProductionOrderRepository,
  ProductionOrderRow, SalesOrderPreview,
} from './pcp-orders-contract';
import { planSalesOrder, type SheetDetail } from '@/lib/pcp/sales-order-plan';
import { createBlingSalesOrderReader, type BlingSalesOrderReader, type SalesOrderHeader } from '@/server/integrations/bling-sales-orders';
import { createPostgresSalesInvoices, INVOICE_WINDOW_DAYS, saoPauloDate, type SalesInvoices } from './postgres-sales-invoices';
import { invoiceDemand, weeksInRange } from '@/lib/pcp/invoice-demand';
import { OFFICIAL_LINE_SKUS } from '@/lib/pcp/official-line';
import { createBlingReader, type BlingReader } from '@/server/integrations/bling-catalog';
import type { PlanningRow } from '@/lib/pcp/op-generator';
import { recordWriteAudit, replayIdempotent, storeIdempotent, type WriteActor } from './write-audit';
import { previewBlingQueue } from './postgres-pcp-bling-queue';
import { validateQueuePreview } from './pcp-queue-preview-token';
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

/** Origem, prioridade e pedido do Bling de uma OP; o padrão é a OP da fila de reposição. */
type OrderExtra = { origin: OrderOrigin; urgent: boolean; notes: string | null; salesOrder: { blingId: number; number: string } | null };
const BLING_QUEUE_BATCH_LOCK = 63891;
const CREATE_BATCH_OPERATION = 'pcp.createOrderBatch';
type CreatedBatch = { batchId: string; orderCount: number; childCount: number };

const FROM_QUEUE: OrderExtra = { origin: 'fila', urgent: false, notes: null, salesOrder: null };

/** Grava a OP e suas ordens de serviço copiadas do roteiro da ficha. */
async function insertOrder(client: PoolClient, order: { batchId: string; parentId: string | null; kind: OrderKind; sku: string;
  description: string | null; sheetId: string; quantity: number; createdBy: string }, extra: OrderExtra = FROM_QUEUE): Promise<string> {
  const id = (await client.query(
    `insert into brsteel_pcp.production_orders (batch_id, parent_order_id, kind, sku, description, sheet_id, quantity, created_by,
       origin, priority, notes, bling_order_id, bling_order_number)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) returning id`,
    [order.batchId, order.parentId, order.kind, order.sku, order.description, order.sheetId, order.quantity, order.createdBy,
      extra.origin, extra.urgent ? 'urgente' : 'estoque', extra.notes, extra.salesOrder?.blingId ?? null, extra.salesOrder?.number ?? null])).rows[0].id as string;
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

/** Partes da ficha com quantidade somada por SKU. */
async function sheetComponents(db: Pool | PoolClient, sheetIds: readonly string[]) {
  const rows = (await db.query(
    `select sheet_id, component_sku, component_name, sum(quantity) as quantity from brsteel_pcp.product_sheet_components
     where sheet_id = any($1) group by sheet_id, component_sku, component_name order by component_sku`, [sheetIds])).rows as Row[];
  const map = new Map<string, { sku: string; name: string | null; quantity: number }[]>();
  for (const r of rows) map.set(String(r.sheet_id), [...(map.get(String(r.sheet_id)) ?? []),
    { sku: String(r.component_sku), name: (r.component_name as string) ?? null, quantity: Number(r.quantity) }]);
  return map;
}

/** Multinível do corte: uma OP filha por parte da estrutura que tem ficha própria. */
async function insertParts(client: PoolClient, input: { batchId: string; parentId: string; sheet: Row; quantity: number; bySku: Map<string, SheetOption[]>;
  createdBy: string; extra?: OrderExtra }): Promise<number> {
  const components = (await sheetComponents(client, [String(input.sheet.id)])).get(String(input.sheet.id)) ?? [];
  const bySku = new Map<string, { name: string | null; quantity: number }>();
  for (const c of components) bySku.set(c.sku, { name: bySku.get(c.sku)?.name ?? c.name, quantity: (bySku.get(c.sku)?.quantity ?? 0) + c.quantity });
  let count = 0;
  for (const [sku, component] of bySku) {
    const childSheet = pickSheet(input.bySku.get(sku) ?? []);
    if (!childSheet) continue;
    await insertOrder(client, { batchId: input.batchId, parentId: input.parentId, kind: 'corte', sku, description: component.name, sheetId: childSheet.id,
      quantity: componentQuantity(input.quantity, component.quantity, Number(input.sheet.base_quantity)), createdBy: input.createdBy }, input.extra);
    count++;
  }
  return count;
}

/** Teto de consultas de produto no Bling por leitura de pedido (cada uma leva ~400 ms na fila do cliente). */
const MAX_PRODUCT_READS = 30;

/**
 * O mín/máx exige um GET por produto no Bling (~30 s para a linha toda). O cálculo relê o cadastro
 * quando a última leitura passou de uma hora; dentro da hora, reaproveita. O saldo é lido sempre.
 */
const CATALOG_FRESH_MS = 3_600_000;
/** Depois de uma releitura que falhou, só tenta de novo após este intervalo (não martela o Bling). */
const CATALOG_RETRY_MS = 5 * 60_000;
const CATALOG_SQL = 'select sku, bling_id, name, format, stock_min, stock_max, synced_at from brsteel_pcp.bling_products where sku = any($1)';

/** Cópia das notas mais velha que isso gera aviso: o cron roda a cada 15 minutos. */
const INVOICES_FRESH_MS = 3_600_000;
const brt = (date: Date) => date.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

export function createPostgresProductionOrderRepository(pool: Pool, bling: BlingReader = createBlingReader(),
  invoices: Pick<SalesInvoices, 'demand'> & Partial<Pick<SalesInvoices, 'queueDemand'>> = createPostgresSalesInvoices(pool),
  salesOrders: BlingSalesOrderReader = createBlingSalesOrderReader()): ProductionOrderRepository {
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

  /** Lê o pedido no Bling (só GET) e desdobra pela ficha técnica. Kits sem ficha são abertos pela estrutura do Bling. */
  async function readSalesOrderPlan(header: Pick<SalesOrderHeader, 'blingId'>) {
    const warnings: string[] = [];
    const sheetRows = (await pool.query(SHEETS_SQL)).rows as Row[];
    const sheetsBySku = groupBySku(sheetRows);
    const kits = new Map<string, { sku: string; description: string | null; quantity: number }[]>();
    let order;
    try {
      order = await salesOrders.order(header.blingId);
      let reads = 0;
      const known = new Map<number, { sku: string; name: string | null }>(((await pool.query('select bling_id, sku, name from brsteel_pcp.bling_products')).rows as Row[])
        .map(r => [Number(r.bling_id), { sku: String(r.sku), name: (r.name as string) ?? null }]));
      for (const item of order.items) {
        if (pickSheet(sheetsBySku.get(item.sku) ?? []) || !item.productBlingId || kits.has(item.sku)) continue;
        if (reads >= MAX_PRODUCT_READS) { warnings.push(`Pedido com muitos produtos sem ficha: ${item.sku} não foi conferido no Bling.`); continue; }
        reads++;
        const product = await salesOrders.product(item.productBlingId);
        if (product?.format !== 'E' || !product.components.length) continue;
        const components: { sku: string; description: string | null; quantity: number }[] = [];
        for (const c of product.components) {
          let found = known.get(c.blingId) ?? null;
          if (!found && reads < MAX_PRODUCT_READS) {
            reads++;
            const read = await salesOrders.product(c.blingId);
            if (read) { found = { sku: read.sku, name: read.name }; known.set(c.blingId, found); }
          }
          if (!found) { warnings.push(`Um componente do kit ${item.sku} não foi encontrado no Bling.`); continue; }
          components.push({ sku: found.sku, description: found.name, quantity: c.quantity });
        }
        if (components.length) kits.set(item.sku, components);
      }
    } catch (error) {
      if (error instanceof OperationError) throw error;
      throw new OperationError('BLING_UNAVAILABLE', 'Não foi possível ler o pedido no Bling. Tente de novo em instantes.', 503);
    }
    const candidates = new Set([...order.items.map(i => i.sku), ...[...kits.values()].flat().map(c => c.sku)]);
    const picked = [...candidates].map(sku => pickSheet(sheetsBySku.get(sku) ?? [])).filter((x): x is SheetOption => Boolean(x));
    const components = await sheetComponents(pool, picked.map(p => p.id));
    const base = new Map(sheetRows.map(r => [String(r.id), Number(r.base_quantity)]));
    const sheetDetails = new Map<string, SheetDetail>(picked.map(p => [p.id, { baseQuantity: base.get(p.id) ?? 1, components: components.get(p.id) ?? [] }]));
    const plan = planSalesOrder({ items: order.items, kits, sheetsBySku, sheetDetails });
    return { order, lines: plan.lines, warnings: [...warnings, ...plan.warnings] };
  }
  async function openOrders(kind: OrderKind) {
    const { rows } = await pool.query<{ sku: string; quantity: string }>(
      `select sku, sum(quantity) as quantity from brsteel_pcp.production_orders
       where parent_order_id is null and kind = $1 and status in ('a_produzir', 'produzindo', 'suspenso') group by sku`, [kind]);
    return new Map(rows.map(r => [r.sku, Number(r.quantity)]));
  }

  const repository: ProductionOrderRepository = {
    async preview(input, actor, progress) {
      if (input.policy === 'bling') {
        return previewBlingQueue(pool, bling, invoices.queueDemand?.bind(invoices), async () => {
          const [open, sheets] = await Promise.all([openOrders(input.kind), pool.query(SHEETS_SQL)]);
          return { open, sheets: groupBySku(sheets.rows) };
        }, input, actor, progress);
      }
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
          warnings.push(`Mínimo e máximo da última leitura do Bling (${brt(new Date(syncedAt))}); não foi possível reler agora.`);
        }
      }
      const catalog = new Map(catalogRows.map(r => [String(r.sku), r]));
      // Saldo do depósito Estoque lido do Bling agora: é o único que decide OP (sem Perdas, cortado ou matéria-prima).
      let balances: Map<number, number>;
      try { balances = await bling.estoqueBalances(catalogRows.map(r => Number(r.bling_id))); }
      catch { throw new OperationError('BLING_UNAVAILABLE', 'Não foi possível ler o saldo do depósito Estoque no Bling. Tente de novo em instantes.', 503); }
      // Vendidos e média vêm das NF-e de saída copiadas do Bling (regra do Marcos), nunca dos pedidos.
      const invoiceRead = await invoices.demand(input.from, input.to);
      const { sold, missingCfop } = invoiceDemand(invoiceRead.items, invoiceRead.kits, new Set(OFFICIAL_LINE_SKUS));
      const weeks = weeksInRange(input.from, input.to);
      const open = await openOrders(input.kind);
      const rows: PlanningRow[] = [];
      const missingCatalog: string[] = [], missingLimits: string[] = [], kits: string[] = [];
      for (const sku of OFFICIAL_LINE_SKUS) {
        const product = catalog.get(sku);
        if (!product) { missingCatalog.push(sku); continue; }
        if (product.format === 'E') { kits.push(sku); continue; }
        const limitsKnown = product.stock_min !== null && product.stock_max !== null;
        if (!limitsKnown) missingLimits.push(sku);
        const quantitySold = sold.get(sku) ?? 0;
        rows.push({
          sku, description: (product.name as string) ?? null,
          totalQuantitySold: quantitySold, weeklyAverage: quantitySold / weeks,
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
      if (!invoiceRead.listedAt) warnings.push('As notas fiscais de saída ainda não foram copiadas do Bling: vendidos e média aparecem zerados.');
      else if (Date.now() - invoiceRead.listedAt.getTime() > INVOICES_FRESH_MS) warnings.push(`Vendidos das notas fiscais copiadas até ${brt(invoiceRead.listedAt)}.`);
      if (invoiceRead.pendingInvoices) warnings.push(`${invoiceRead.pendingInvoices} nota(s) do período ainda sem itens copiados do Bling: os vendidos podem estar abaixo do real.`);
      if (input.from < saoPauloDate(Date.now() - INVOICE_WINDOW_DAYS * 86_400_000)) warnings.push(`Só as notas dos últimos ${INVOICE_WINDOW_DAYS} dias são copiadas do Bling: o começo do período fica sem vendas.`);
      if (missingCfop.size) warnings.push(`Itens sem CFOP nas notas ficaram fora dos vendidos: ${[...missingCfop.keys()].join(', ')}.`);
      const noSales = productionQueue(rows).filter(r => !suggestedQuantity(r, input.factor)).map(r => r.sku);
      const notes = noSales.length ? [`Sem venda no período, fora da fila: ${noSales.join(', ')}.`] : [];
      const missing = suggestions.filter(s => !s.sheet).map(s => s.sku);
      if (missing.length) warnings.push(`Sem ficha técnica com roteiro, não pode virar OP: ${missing.join(', ')}.`);
      const preview: GenerationPreview = { ...input, suggestions, warnings, notes, catalogSyncedAt: new Date(syncedAt).toISOString() };
      return result(preview, 'postgres', [], null, (invoiceRead.listedAt ?? new Date()).toISOString());
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
               stock_min = excluded.stock_min, stock_max = excluded.stock_max, synced_at = now(),
               queue_synced_at = case when
                 (bling_products.bling_id, bling_products.format, bling_products.stock_min, bling_products.stock_max)
                   is distinct from (excluded.bling_id, excluded.format, excluded.stock_min, excluded.stock_max)
                 then null else bling_products.queue_synced_at end`,
            [p.sku, p.blingId, p.name?.slice(0, 300) ?? null, p.format?.slice(0, 5) ?? null, p.stockMin, p.stockMax]);
        }
        await recordWriteAudit(client, { operation: 'pcp.syncBlingCatalog', actor, target: { collection: 'pcp.blingProducts', id: 'linha-oficial' } });
        const found = new Set(products.map(p => p.sku));
        return result({ synced: products.length, missing: OFFICIAL_LINE_SKUS.filter(sku => !found.has(sku)) }, 'postgres');
      });
    },

    async createBatch(input: BatchInput, actor: WriteActor) {
      const isBlingQueue = input.policy === 'bling';
      const batchActor = isBlingQueue ? { ...actor, idempotencyKey: input.idempotencyKey ?? null } : actor;
      const request = { kind: input.kind, from: input.from, to: input.to, factor: input.factor, policy: input.policy, items: input.items };
      return withOperationalWrite(pool, async client => {
        if (isBlingQueue) {
          if (!batchActor.idempotencyKey) throw new OperationError('QUEUE_PREVIEW_INVALID', 'Recalcule a prévia antes de gerar o lote.');
          const previous = await replayIdempotent<CreatedBatch>(client, batchActor, CREATE_BATCH_OPERATION, request);
          if (previous) return result(previous, 'postgres');
          validateQueuePreview(input, actor);
        }
        const duplicate = await client.query(
          `select 1 from brsteel_pcp.production_order_batches b
           where b.kind = $1 and b.origin = 'fila' and b.params->>'from' = $2 and b.params->>'to' = $3
             and ($4::boolean or b.params->>'policy' = 'bling')
             and exists (select 1 from brsteel_pcp.production_orders o
               where o.batch_id = b.id and o.status in ('a_produzir', 'produzindo', 'suspenso'))
           limit 1`, [input.kind, input.from, input.to, isBlingQueue]);
        if (duplicate.rows.length) {
          throw new OperationError('DUPLICATE_QUEUE_BATCH', 'Já existe um lote deste tipo e período com OPs em aberto.', 409);
        }
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
          [input.kind, JSON.stringify({ from: input.from, to: input.to, factor: input.factor, policy: input.policy }), actor.userId])).rows[0].id as string;
        let childCount = 0;
        for (const item of input.items) {
          const parentId = await insertOrder(client, { batchId, parentId: null, kind: input.kind, sku: item.sku,
            description: item.description, sheetId: item.sheetId, quantity: item.quantity, createdBy: actor.userId });
          if (input.kind !== 'corte') continue;
          childCount += await insertParts(client, { batchId, parentId, sheet: byId.get(item.sheetId)!, quantity: item.quantity, bySku, createdBy: actor.userId });
        }
        const response = { batchId, orderCount: input.items.length, childCount };
        await recordWriteAudit(client, { operation: CREATE_BATCH_OPERATION, actor: batchActor, target: { collection: 'pcp.orderBatches', id: batchId } });
        if (isBlingQueue) await storeIdempotent(client, batchActor, CREATE_BATCH_OPERATION, request, response);
        return result(response, 'postgres');
      }, { serializeOn: BLING_QUEUE_BATCH_LOCK });
    },

    async listBatches() {
      const rows = (await pool.query(
        `select b.id, b.kind, b.origin, b.params->>'blingOrderNumber' as sales_order_number, b.created_at, b.created_by, b.exported_at,
           (select count(*)::int from brsteel_pcp.production_orders o where o.batch_id = b.id and o.parent_order_id is null) order_count,
           (select count(*)::int from brsteel_pcp.production_orders o where o.batch_id = b.id and o.parent_order_id is not null) child_count
         from brsteel_pcp.production_order_batches b order by b.created_at desc limit 100`)).rows as Row[];
      return result(rows.map((r): BatchSummary => ({ id: String(r.id), kind: r.kind as OrderKind, createdAt: (r.created_at as Date).toISOString(),
        createdBy: String(r.created_by), exportedAt: r.exported_at ? (r.exported_at as Date).toISOString() : null,
        orderCount: Number(r.order_count), childCount: Number(r.child_count),
        origin: r.origin as BatchSummary['origin'], salesOrderNumber: (r.sales_order_number as string) ?? null })), 'postgres');
    },

    async listOrders(batchId: string | null) {
      const rows = (await pool.query(
        `select o.id, o.number, o.kind, o.sku, o.description, s.code as sheet_code, o.quantity, o.status, o.parent_order_id, o.batch_id,
           o.origin, o.priority, o.bling_order_number,
           o.created_at, (select count(*)::int from brsteel_pcp.production_order_steps t where t.order_id = o.id) step_count
         from brsteel_pcp.production_orders o left join brsteel_pcp.product_sheets s on s.id = o.sheet_id
         where ($1::uuid is null or o.batch_id = $1) order by o.number desc limit 500`, [batchId])).rows as Row[];
      return result(rows.map((r): ProductionOrderRow => ({ id: String(r.id), number: Number(r.number), kind: r.kind as OrderKind, sku: String(r.sku),
        description: (r.description as string) ?? null, sheetCode: (r.sheet_code as string) ?? null, quantity: Number(r.quantity),
        status: r.status as OrderStatus, parentOrderId: (r.parent_order_id as string) ?? null, batchId: (r.batch_id as string) ?? null,
        createdAt: (r.created_at as Date).toISOString(), stepCount: Number(r.step_count),
        origin: r.origin as OrderOrigin, urgent: r.priority === 'urgente', salesOrderNumber: (r.bling_order_number as string) ?? null })), 'postgres');
    },

    async exportIapp(batchId: string, actor: WriteActor) {
      return withOperationalWrite(pool, async client => {
        const batch = (await client.query('select kind from brsteel_pcp.production_order_batches where id = $1 for update', [batchId])).rows[0];
        if (!batch) throw new OperationError('NOT_FOUND', 'Lote não encontrado.', 404);
        // Só as OPs mães, sem as excluídas: no corte o iApp gera as OPs das partes a partir do multinível "S".
        const orders = (await client.query(
          `select s.code, o.quantity, o.kind,
             exists (select 1 from brsteel_pcp.production_orders c where c.parent_order_id = o.id and c.status <> 'encerrado') has_children
           from brsteel_pcp.production_orders o join brsteel_pcp.product_sheets s on s.id = o.sheet_id
           where o.batch_id = $1 and o.parent_order_id is null and o.status <> 'encerrado' order by o.number`, [batchId])).rows as Row[];
        await client.query('update brsteel_pcp.production_order_batches set exported_at = now() where id = $1', [batchId]);
        await recordWriteAudit(client, { operation: 'pcp.exportIapp', actor, target: { collection: 'pcp.orderBatches', id: batchId } });
        const rows = iappImportRows(orders.map(o => ({ sheetCode: String(o.code), quantity: Number(o.quantity), kind: o.kind as OrderKind,
          multilevel: Boolean(o.has_children) })));
        return result({ batchId, kind: batch.kind as OrderKind, header: IAPP_HEADER, rows }, 'postgres');
      });
    },

    async listProducible() {
      const sheetRows = (await pool.query(SHEETS_SQL)).rows as Row[];
      const bySku = groupBySku(sheetRows);
      const picked = [...bySku.values()].map(options => pickSheet(options)).filter((x): x is SheetOption => Boolean(x));
      const components = await sheetComponents(pool, picked.map(p => p.id));
      const products = picked.map((sheet): ProducibleProduct => ({
        sku: sheet.sku, name: sheet.name, sheetId: sheet.id, sheetCode: sheet.code, stepCount: sheet.stepCount,
        partCount: new Set((components.get(sheet.id) ?? []).filter(c => pickSheet(bySku.get(c.sku) ?? [])).map(c => c.sku)).size,
      }));
      return result(products.sort((a, b) => a.sku.localeCompare(b.sku)), 'postgres');
    },

    async createManualOrder(input, actor) {
      return withOperationalWrite(pool, async client => {
        const sheetRows = (await client.query(SHEETS_SQL)).rows as Row[];
        const sheet = sheetRows.find(r => String(r.id) === input.sheetId);
        if (!sheet) throw new OperationError('INVALID_INPUT', `Ficha não encontrada para ${input.sku}.`);
        if (String(sheet.sku) !== input.sku) throw new OperationError('INVALID_INPUT', `A ficha ${sheet.code} não é do SKU ${input.sku}.`);
        if (!Number(sheet.step_count)) throw new OperationError('INVALID_INPUT', `A ficha ${sheet.code} não tem roteiro.`);
        const batchId = (await client.query(
          `insert into brsteel_pcp.production_order_batches (kind, origin, params, created_by) values ($1, 'avulsa', $2, $3) returning id`,
          [input.kind, JSON.stringify({ manual: true }), actor.userId])).rows[0].id as string;
        const extra: OrderExtra = { origin: 'avulsa', urgent: input.urgent, notes: input.notes, salesOrder: null };
        const id = await insertOrder(client, { batchId, parentId: null, kind: input.kind, sku: input.sku, description: String(sheet.name),
          sheetId: input.sheetId, quantity: input.quantity, createdBy: actor.userId }, extra);
        const childCount = input.kind === 'corte'
          ? await insertParts(client, { batchId, parentId: id, sheet, quantity: input.quantity, bySku: groupBySku(sheetRows), createdBy: actor.userId, extra: { ...extra, notes: null } })
          : 0;
        const number = Number((await client.query('select number from brsteel_pcp.production_orders where id = $1', [id])).rows[0].number);
        await recordWriteAudit(client, { operation: 'pcp.createManualOrder', actor, target: { collection: 'pcp.orders', id } });
        return result({ batchId, number, childCount }, 'postgres');
      });
    },

    async previewSalesOrder(number) {
      let headers: SalesOrderHeader[];
      try { headers = await salesOrders.findByNumber(number); }
      catch { throw new OperationError('BLING_UNAVAILABLE', 'Não foi possível buscar o pedido no Bling. Tente de novo em instantes.', 503); }
      if (!headers.length) throw new OperationError('NOT_FOUND', 'Pedido não encontrado no Bling.', 404);
      const plan = await readSalesOrderPlan(headers[0]);
      if (headers.length > 1) plan.warnings.unshift(`${headers.length} pedidos têm este número no Bling; mostrando o pedido ${plan.order.number} de ${plan.order.date ?? 'data desconhecida'}.`);
      const existing = ((await pool.query(
        `select number, sku, kind, status, created_at from brsteel_pcp.production_orders
         where bling_order_id = $1 and status <> 'encerrado' order by number`, [plan.order.blingId])).rows as Row[])
        .map(r => ({ number: Number(r.number), sku: String(r.sku), kind: r.kind as OrderKind, status: r.status as OrderStatus, createdAt: (r.created_at as Date).toISOString() }));
      const { items: _items, ...header } = plan.order;
      void _items;
      const preview: SalesOrderPreview = { order: header, lines: plan.lines, warnings: plan.warnings, existing };
      return result(preview, 'postgres');
    },

    async createFromSalesOrder(input, actor) {
      // O pedido é relido no Bling fora da transação: o número gravado e os itens válidos vêm de lá, não do cliente.
      const plan = await readSalesOrderPlan({ blingId: input.blingOrderId });
      const lines = new Map(plan.lines.map(line => [line.sku, line]));
      for (const item of input.items) {
        const line = lines.get(item.sku);
        if (!line?.sheet) throw new OperationError('INVALID_INPUT', `${item.sku} não está no pedido ou não tem ficha com roteiro.`);
        if (line.sheet.id !== item.sheetId) throw new OperationError('INVALID_INPUT', `A ficha de ${item.sku} mudou. Busque o pedido de novo.`);
        if (new Set(item.parts.map(p => p.sku)).size !== item.parts.length) throw new OperationError('INVALID_INPUT', `Parte repetida em ${item.sku}.`);
        for (const part of item.parts) {
          const known = line.parts.find(p => p.sku === part.sku);
          if (!known || known.sheet.id !== part.sheetId) throw new OperationError('INVALID_INPUT', `${part.sku} não é parte de ${item.sku}. Busque o pedido de novo.`);
        }
      }
      const salesOrder = { blingId: plan.order.blingId, number: plan.order.number.slice(0, 30) || String(plan.order.blingId) };
      return withOperationalWrite(pool, async client => {
        const existing = (await client.query(
          `select number from brsteel_pcp.production_orders where bling_order_id = $1 and status <> 'encerrado' order by number`, [salesOrder.blingId])).rows as Row[];
        if (existing.length && !input.confirmDuplicate) {
          throw new OperationError('DUPLICATE_SALES_ORDER',
            `O pedido ${salesOrder.number} já gerou a(s) OP(s) ${existing.map(r => r.number).join(', ')}. Confirme para gerar de novo.`, 409);
        }
        const batchId = (await client.query(
          `insert into brsteel_pcp.production_order_batches (kind, origin, params, created_by) values ('semanal', 'pedido', $1, $2) returning id`,
          [JSON.stringify({ blingOrderId: salesOrder.blingId, blingOrderNumber: salesOrder.number }), actor.userId])).rows[0].id as string;
        const extra: OrderExtra = { origin: 'pedido', urgent: input.urgent, notes: null, salesOrder };
        let childCount = 0;
        for (const item of input.items) {
          // Produto do pedido na produção semanal (dobra); as partes no corte, como OPs filhas.
          const parentId = await insertOrder(client, { batchId, parentId: null, kind: 'semanal', sku: item.sku, description: item.description,
            sheetId: item.sheetId, quantity: item.quantity, createdBy: actor.userId }, extra);
          for (const part of item.parts) {
            await insertOrder(client, { batchId, parentId, kind: 'corte', sku: part.sku, description: part.description,
              sheetId: part.sheetId, quantity: part.quantity, createdBy: actor.userId }, extra);
            childCount++;
          }
        }
        await recordWriteAudit(client, { operation: 'pcp.createSalesOrderBatch', actor, target: { collection: 'pcp.orderBatches', id: batchId } });
        return result({ batchId, orderCount: input.items.length, childCount, salesOrderNumber: salesOrder.number }, 'postgres');
      });
    },
  };
  return repository;
}
