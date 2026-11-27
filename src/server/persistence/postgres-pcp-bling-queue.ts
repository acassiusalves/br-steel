import 'server-only';
import type { Pool } from 'pg';
import { blingQueueWeeks, calculateBlingQueue, resolveBlingQueueCategories } from '@/lib/pcp/bling-queue';
import { pickSheet, type SheetOption } from '@/lib/pcp/op-generator';
import type { BlingReader, QueueBlingProduct } from '@/server/integrations/bling-catalog';
import { OperationError, result } from '@/server/operations/common';
import type { BlingQueueProgress, GenerationPreview, PreviewInput } from './pcp-orders-contract';
import { issueQueuePreviewToken } from './pcp-queue-preview-token';
import type { SalesInvoices } from './postgres-sales-invoices';
import { withOperationalWrite } from './postgres-write';
import type { WriteActor } from './write-audit';

const CATALOG_FRESH_MS = 24 * 60 * 60 * 1000;
const INVOICE_FRESH_MS = 60 * 60 * 1000;
const PRODUCT_BATCH_SIZE = 30;

type CatalogRow = {
  sku: string; bling_id: string; name: string | null; format: string | null; stock_min: string | null; stock_max: string | null;
  active: boolean | null; category_id: string | null; structure_stock_type: string | null;
  has_structure: boolean | null; queue_synced_at: Date | null;
};

async function loadCatalog(pool: Pool, skus: readonly string[], readProducts: NonNullable<BlingReader['queueProducts']>, actor: WriteActor | null,
  progress: (step: BlingQueueProgress) => void) {
  const read = async () => (await pool.query<CatalogRow>(
    `select sku, bling_id, name, format, stock_min, stock_max, active, category_id, structure_stock_type, has_structure, queue_synced_at
     from brsteel_pcp.bling_products where sku = any($1)`, [skus],
  )).rows;
  if (!skus.length) return { products: [], catalogSyncedAt: null, unchecked: 0 };

  let catalog = await read();
  const catalogBySku = new Map(catalog.map(row => [row.sku, row]));
  const expiresBefore = Date.now() - CATALOG_FRESH_MS;
  const pending = skus.filter(sku => (catalogBySku.get(sku)?.queue_synced_at?.getTime() ?? 0) < expiresBefore);
  progress({ stage: 'catalog', completed: skus.length - pending.length, total: skus.length });
  if (actor && pending.length) {
    for (let i = 0; i < pending.length; i += PRODUCT_BATCH_SIZE) {
      const batch = pending.slice(i, i + PRODUCT_BATCH_SIZE);
      let products: QueueBlingProduct[];
      try { products = await readProducts(batch); }
      catch { throw new OperationError('BLING_UNAVAILABLE', 'Não foi possível conferir o cadastro dos produtos vendidos no Bling.', 503); }
      await withOperationalWrite(pool, async client => {
        for (const p of products) {
          // O Bling mantém o ID quando o SKU muda. Mantém só o código confirmado na leitura atual.
          await client.query('delete from brsteel_pcp.bling_products where bling_id = $1 and sku <> $2', [p.blingId, p.sku]);
          await client.query(
            `insert into brsteel_pcp.bling_products
               (sku, bling_id, name, format, stock_min, stock_max, active, category_id, structure_stock_type, has_structure, queue_synced_at)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
             on conflict (sku) do update set bling_id = excluded.bling_id, name = excluded.name, format = excluded.format,
               stock_min = excluded.stock_min, stock_max = excluded.stock_max, active = excluded.active,
               category_id = excluded.category_id, structure_stock_type = excluded.structure_stock_type,
               has_structure = excluded.has_structure, queue_synced_at = excluded.queue_synced_at`,
            [p.sku, p.blingId, p.name?.slice(0, 300) ?? null, p.format?.slice(0, 5) ?? null,
              p.stockMin === null ? null : Math.max(0, p.stockMin), p.stockMax === null ? null : Math.max(0, p.stockMax), p.active, p.categoryId, p.structureStockType, p.hasStructure],
          );
        }
        const found = products.map(p => p.sku);
        await client.query(
          `update brsteel_pcp.bling_products set active = false, queue_synced_at = now()
           where sku = any($1) and not (sku = any($2))`, [batch, found],
        );
      });
      progress({ stage: 'catalog', completed: skus.length - pending.length + Math.min(pending.length, i + PRODUCT_BATCH_SIZE), total: skus.length });
    }
    catalog = await read();
  }
  const verified = catalog.filter(row => (row.queue_synced_at?.getTime() ?? 0) >= expiresBefore);
  const catalogSyncedAt = verified.length ? new Date(Math.min(...verified.map(row => row.queue_synced_at!.getTime()))).toISOString() : null;
  return { products: verified, catalogSyncedAt, unchecked: actor ? 0 : pending.length };
}

type LoadOrdersAndSheets = () => Promise<{ open: Map<string, number>; sheets: Map<string, SheetOption[]> }>;

export async function previewBlingQueue(pool: Pool, bling: BlingReader, readDemand: SalesInvoices['queueDemand'] | undefined,
  loadOrdersAndSheets: LoadOrdersAndSheets, input: PreviewInput, actor: WriteActor | null,
  progress: (step: BlingQueueProgress) => void = () => undefined) {
  const { categories, queueProducts, queueBalances } = bling;
  if (!categories || !queueProducts || !queueBalances || !readDemand) {
    throw new OperationError('QUEUE_UNAVAILABLE', 'A fila por categoria do Bling está indisponível.', 503);
  }

  progress({ stage: 'sales' });
  const fiscal = await readDemand(input.from, input.to);
  const covered = Boolean(fiscal.coveredFrom && fiscal.coveredTo && input.from >= fiscal.coveredFrom && input.to <= fiscal.coveredTo);
  const warnings: string[] = [];
  if (!covered) {
    warnings.push(fiscal.coveredFrom && fiscal.coveredTo
      ? `A cópia das NF-e cobre ${fiscal.coveredFrom} a ${fiscal.coveredTo}. Escolha um período dentro dessas datas para gerar OPs.`
      : 'A cópia das NF-e ainda não registrou uma janela completa. A geração pela fila precisa dessa sincronização.');
  }
  if (fiscal.listedAt && Date.now() - fiscal.listedAt.getTime() > INVOICE_FRESH_MS) {
    warnings.push(`NF-e listadas pela última vez em ${fiscal.listedAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.`);
  }
  if (fiscal.pendingInvoices) {
    warnings.push(`${fiscal.pendingInvoices} NF-e do período ainda têm itens a conferir. As vendas podem mudar após a próxima sincronização.`);
  }

  let listedCategories;
  try { listedCategories = await categories(); }
  catch { throw new OperationError('BLING_UNAVAILABLE', 'Não foi possível ler as categorias. Confira a permissão de categorias de produtos no Bling.', 503); }
  const configured = (process.env.BLING_CATEGORIA_INOX_ID ?? '').split(',').map(id => id.trim()).filter(Boolean);
  const inox = resolveBlingQueueCategories(listedCategories, configured);
  if (!inox.ids.size) {
    throw new OperationError('NO_BLING_CATEGORY', 'A categoria Produtos Inox Marketplace não foi encontrada no Bling.', 422);
  }

  const { products, catalogSyncedAt, unchecked } = await loadCatalog(pool, [...fiscal.sold.keys()].sort(), queueProducts, actor, progress);
  if (unchecked) warnings.push(`${unchecked} cadastros do Bling precisam ser atualizados por quem pode gerar OPs.`);
  const candidates = products.filter(p => p.active && p.category_id && inox.ids.has(p.category_id) &&
    (p.format !== 'E' || p.structure_stock_type === 'F'));
  progress({ stage: 'stock', total: candidates.length });
  let balances: Awaited<ReturnType<typeof queueBalances>>;
  try { balances = candidates.length ? await queueBalances(candidates.map(p => Number(p.bling_id))) : new Map(); }
  catch { throw new OperationError('BLING_UNAVAILABLE', 'Não foi possível ler o depósito Estoque no Bling.', 503); }

  progress({ stage: 'sheets' });
  const { sheets, open } = await loadOrdersAndSheets();
  const weeks = blingQueueWeeks(input.from, input.to);
  const planningRows = candidates.map(p => {
    const saldo = balances.get(Number(p.bling_id));
    return {
      sku: p.sku, description: p.name ?? p.sku, stock: saldo?.value ?? 0, stockSource: saldo?.source ?? 'ausente',
      min: Number(p.stock_min ?? 0), sold: fiscal.sold.get(p.sku) ?? 0, openQuantity: open.get(p.sku) ?? 0,
      hasStructure: p.has_structure === true,
    };
  });
  const rows = calculateBlingQueue(planningRows, { weeks, factor: input.factor });
  const suggestions = rows.map(row => ({
    ...row, max: 0, minMaxQuantity: 0, sheet: pickSheet(sheets.get(row.sku) ?? []),
  }));
  const noStock = planningRows.filter(row => row.stockSource === 'total' || row.stockSource === 'ausente');
  if (noStock.length) warnings.push(`Saldo do depósito Estoque não confirmado. Fora da seleção do lote: ${noStock.map(row => row.sku).join(', ')}.`);

  const eligibleSheets = suggestions.flatMap(row => row.sheet && (row.stockSource === 'virtual' || row.stockSource === 'fisico')
    ? [row.sheet.id] : []);
  const preview: GenerationPreview = {
    ...input, suggestions, warnings, notes: [], catalogSyncedAt: catalogSyncedAt ?? '',
    weeks, categories: inox.names, ignored: fiscal.ignored, invoiceCount: fiscal.invoiceCount,
    previewToken: actor && covered && eligibleSheets.length ? issueQueuePreviewToken(input, actor, eligibleSheets) : undefined,
  };
  return result(preview, 'postgres', [], null, (fiscal.listedAt ?? new Date()).toISOString());
}
