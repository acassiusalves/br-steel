import 'server-only';
import { z } from 'zod';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { blingGetPaged, blingFetchWithRefresh } from '@/server/integrations/bling';
import type { ProductStock } from '@/types/product-stock';
import type { AccessContext } from '@/server/access/types';
import { stockReadRepository } from '@/server/persistence/stock';
import type { StockReadRepository } from '@/server/persistence/stock-contract';
import { documentIdSchema, pageInputSchema, requireOperation, result, OperationError } from './common';
let cached: { data: ProductStock[]; asOf: string; expiresAt: number; version: number } | null = null;
let loading: Promise<void> | null = null;

/**
 * The provider snapshot is cached per process. Under Fluid Compute the application runs on several
 * instances, so clearing the local copy only reaches the instance that did the write: every other one
 * would keep serving a stale snapshot for the rest of its 300s window. A shared marker is what actually
 * crosses instances — each cached entry records the version it was built from and is discarded when the
 * shared value moves on.
 *
 * The cache is deliberately NOT segmented by identity. It holds provider data that is identical for
 * every caller, authorization is checked before it is ever consulted, and the per-SKU observations it is
 * merged with are read fresh on each call. Keying it per user would multiply memory and cut the hit rate
 * without preventing any disclosure.
 */
const stockCacheVersionRef = () => adminDb.collection('appConfig').doc('stockCacheVersion');

async function readSharedCacheVersion() {
  return Number((await stockCacheVersionRef().get()).data()?.version ?? 0);
}

export async function invalidateProductStockCache() {
  cached = null;
  await stockCacheVersionRef().set(
    { version: FieldValue.increment(1), updatedAt: new Date().toISOString() }, { merge: true });
}
const number = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;
function normalize(item: any, asOf: string): ProductStock | null {
  if (item?.isSimulated || item?.source === 'simulated' || !item?.codigo) return null;
  const virtual = number(item.estoque?.saldoVirtualTotal);
  const physical = number(item.estoque?.saldoFisicoTotal);
  return { produto: { id: number(item.id) ?? 0, codigo: String(item.codigo), nome: String(item.nome || item.codigo) },
    deposito: { id: number(item.deposito?.id) ?? 0, nome: String(item.deposito?.nome || '') },
    saldoFisico: number(item.estoque?.saldoFisico), saldoVirtual: number(item.estoque?.saldoVirtual) ?? virtual,
    saldoFisicoTotal: physical, saldoVirtualTotal: virtual, stockMin: number(item.estoque?.minimo) ?? undefined, stockMax: number(item.estoque?.maximo) ?? undefined,
    source: 'bling', asOf, physicalAsOf: physical === null ? null : asOf, virtualAsOf: virtual === null ? null : asOf };
}
/** Persisted observations only. Callers authorize stock access or a minimal production projection. */
export const readStoredStockSnapshot = () => stockReadRepository.snapshot();
export function createStoredStockOperations(repository: StockReadRepository) {
  return { async listProductStock(context: AccessContext, raw: unknown) {
    requireOperation(context, 'estoque:read');
    const input = pageInputSchema.extend({ sku: z.string().max(200).optional() }).strict().parse(raw);
    return repository.list(input);
  } };
}
const storedOperations = createStoredStockOperations(stockReadRepository);
/** Live ERP/cache source for the web application; MCP uses readStoredStockSnapshot. */
export async function readStockSnapshot() {
  const version = await readSharedCacheVersion();
  if (cached && cached.version !== version) cached = null;
  let failed = false, fromCache = Boolean(cached && cached.expiresAt > Date.now());
  if (!fromCache) {
    try {
      loading ??= (async () => {
        const raw = await blingGetPaged('https://api.bling.com.br/Api/v3/produtos');
        if (!Array.isArray(raw)) throw new Error('Invalid provider data');
        const asOf = new Date().toISOString(); const data = raw.map(item => normalize(item, asOf)).filter((item): item is ProductStock => item !== null);
        if (raw.length && !data.length) throw new Error('Simulated provider data rejected');
        cached = { data, asOf, expiresAt: Date.now() + 300000, version };
      })();
      await loading;
    } catch { failed = true; } finally { loading = null; }
  }
  const warnings: string[] = [];
  if (failed) warnings.push('Bling indisponível. O resultado contém somente observações anteriores ou de webhook; não representa uma consulta atual ao ERP.');
  const bySku = new Map<string, ProductStock>((cached?.data ?? []).map(row => [row.produto.codigo, { ...row, source: fromCache || failed ? 'cache' : 'bling' }]));
  // Pelo repositório, nunca por `adminDb.collection('stockUpdates')` direto: a leitura direta ignora
  // `operationalSource` e, depois de um corte, sobreporia observações de uma coleção que parou de
  // receber webhooks. O repositório já aplica a mesma normalização — descarta simulados, eventos de
  // teste, saldo nulo e data impossível — e devolve a última observação válida por SKU.
  const observations = (await stockReadRepository.snapshot()).data;
  for (const observed of observations) {
    const sku = observed.produto.codigo, at = observed.virtualAsOf ?? observed.asOf;
    if (!at || !Number.isFinite(Date.parse(at))) continue;
    const existing = bySku.get(sku);
    if (existing?.virtualAsOf && Date.parse(existing.virtualAsOf) > Date.parse(at)) continue;
    bySku.set(sku, { ...(existing ?? { ...observed, deposito: { id: 0, nome: '' }, saldoFisico: null, saldoFisicoTotal: null, physicalAsOf: null }),
      saldoVirtual: observed.saldoVirtual, saldoVirtualTotal: observed.saldoVirtualTotal, source: existing ? 'mixed' : 'webhook', asOf: at, virtualAsOf: at });
  }
  const data = [...bySku.values()].sort((a, b) => a.produto.codigo.localeCompare(b.produto.codigo));
  if (data.some(row => row.saldoVirtualTotal === null || row.saldoFisicoTotal === null)) warnings.push('Há saldos não informados. Campos desconhecidos são nulos, não zero.');
  const sources = new Set(data.map(row => row.source));
  const source = !data.length && failed ? 'unavailable' : sources.size > 1 ? 'mixed' : data[0]?.source ?? (fromCache ? 'cache' : 'bling');
  return result(data, source, warnings, null, cached?.asOf ?? data.at(-1)?.asOf ?? new Date().toISOString());
}
export async function listProductStock(context: AccessContext, raw: unknown) {
  if (context.actor.source === 'mcp') return storedOperations.listProductStock(context, raw);
  requireOperation(context, 'estoque:read');
  const input = pageInputSchema.extend({ sku: z.string().max(200).optional() }).strict().parse(raw);
  const snapshot = await readStockSnapshot();
  const rows = input.sku ? snapshot.data.filter(row => row.produto.codigo === input.sku) : snapshot.data;
  let offset = 0; if (input.cursor) { if (!/^\d+$/.test(input.cursor)) throw new OperationError('INVALID_CURSOR', 'Paginação inválida.'); offset = Number(input.cursor); if (!Number.isSafeInteger(offset)) throw new OperationError('INVALID_CURSOR', 'Paginação inválida.'); }
  return { ...snapshot, data: rows.slice(offset, offset + input.limit), nextCursor: offset + input.limit < rows.length ? String(offset + input.limit) : null };
}
export async function refreshProductionSku(context: AccessContext, sku: string) {
  requireOperation(context, 'producao:read', '/producao'); documentIdSchema.parse(sku);
  const list = await blingFetchWithRefresh(`https://api.bling.com.br/Api/v3/produtos?codigo=${encodeURIComponent(sku)}`);
  const product = list?.data?.find((item: any) => item.codigo === sku);
  if (!product?.id) throw new OperationError('NOT_FOUND', 'SKU não encontrado no Bling.', 404);
  const detail = await blingFetchWithRefresh(`https://api.bling.com.br/Api/v3/produtos/${encodeURIComponent(String(product.id))}`);
  const normalized = normalize(detail?.data, new Date().toISOString());
  if (!normalized || normalized.produto.codigo !== sku) throw new OperationError('UNAVAILABLE', 'Saldo indisponível.', 503);
  await invalidateProductStockCache();
  return result({ stockLevel: normalized.saldoVirtualTotal, stockMin: normalized.stockMin, stockMax: normalized.stockMax }, 'bling');
}
