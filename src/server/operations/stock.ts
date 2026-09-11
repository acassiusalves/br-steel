import 'server-only';
import { z } from 'zod';
import { adminDb } from '@/lib/firebase-admin';
import { blingGetPaged, blingFetchWithRefresh } from '@/server/integrations/bling';
import type { ProductStock } from '@/types/product-stock';
import type { AccessContext } from '@/server/access/types';
import { documentIdSchema, pageInputSchema, requireOperation, result, OperationError } from './common';
let cached: { data: ProductStock[]; asOf: string; expiresAt: number } | null = null;
let loading: Promise<void> | null = null;
export function invalidateProductStockCache() { cached = null; }
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
export async function readStoredStockSnapshot() {
  const snapshot = await adminDb.collection('stockUpdates').get();
  const bySku = new Map<string, ProductStock>();
  let latestObservation: string | undefined;
  for (const doc of snapshot.docs) {
    const data = doc.data(), balance = number(data.estoqueAtual);
    if (data.isSimulated || data.source === 'simulated' || String(data.lastEvent ?? '').includes('(test)') || balance === null) continue;
    const sku = String(data.sku || doc.id), at = String(data.webhookReceivedAt || '');
    if (!Number.isFinite(Date.parse(at))) continue;
    const existing = bySku.get(sku);
    if (existing && Date.parse(existing.asOf) > Date.parse(at)) continue;
    bySku.set(sku, {
      produto: { id: number(data.produtoId) ?? 0, codigo: sku, nome: String(data.nome || sku) },
      deposito: { id: 0, nome: '' }, saldoFisico: null, saldoFisicoTotal: null,
      saldoVirtual: balance, saldoVirtualTotal: balance,
      source: 'firestore', asOf: at, physicalAsOf: null, virtualAsOf: at,
    });
    if (!latestObservation || Date.parse(at) > Date.parse(latestObservation)) latestObservation = at;
  }
  const data = [...bySku.values()].sort((a, b) => a.produto.codigo.localeCompare(b.produto.codigo));
  const warnings = ['Consulta somente aos saldos salvos no banco de dados deste ambiente. A data de cada saldo indica sua última observação; integrações externas não são consultadas.'];
  if (!data.length) warnings.push('Nenhum saldo de produto válido está salvo no banco de dados deste ambiente.');
  else warnings.push('Saldos físicos não registrados são nulos, não zero.');
  return result(data, 'firestore', warnings, null, latestObservation ?? new Date().toISOString());
}
/** Live ERP/cache source for the web application; MCP uses readStoredStockSnapshot. */
export async function readStockSnapshot() {
  let failed = false, fromCache = Boolean(cached && cached.expiresAt > Date.now());
  if (!fromCache) {
    try {
      loading ??= (async () => {
        const raw = await blingGetPaged('https://api.bling.com.br/Api/v3/produtos');
        if (!Array.isArray(raw)) throw new Error('Invalid provider data');
        const asOf = new Date().toISOString(); const data = raw.map(item => normalize(item, asOf)).filter((item): item is ProductStock => item !== null);
        if (raw.length && !data.length) throw new Error('Simulated provider data rejected');
        cached = { data, asOf, expiresAt: Date.now() + 300000 };
      })();
      await loading;
    } catch { failed = true; } finally { loading = null; }
  }
  const warnings: string[] = [];
  if (failed) warnings.push('Bling indisponível. O resultado contém somente observações anteriores ou de webhook; não representa uma consulta atual ao ERP.');
  const bySku = new Map<string, ProductStock>((cached?.data ?? []).map(row => [row.produto.codigo, { ...row, source: fromCache || failed ? 'cache' : 'bling' }]));
  const webhooks = await adminDb.collection('stockUpdates').get();
  for (const doc of webhooks.docs) {
    const data = doc.data(); if (data.isSimulated || String(data.lastEvent ?? '').includes('(test)') || number(data.estoqueAtual) === null) continue;
    const sku = String(data.sku || doc.id), at = String(data.webhookReceivedAt || '');
    if (!Number.isFinite(Date.parse(at))) continue;
    const existing = bySku.get(sku);
    if (existing?.virtualAsOf && Date.parse(existing.virtualAsOf) > Date.parse(at)) continue;
    bySku.set(sku, { ...(existing ?? { produto: { id: 0, codigo: sku, nome: String(data.nome || sku) }, deposito: { id: 0, nome: '' }, saldoFisico: null, saldoFisicoTotal: null, physicalAsOf: null }),
      saldoVirtual: data.estoqueAtual, saldoVirtualTotal: data.estoqueAtual, source: existing ? 'mixed' : 'webhook', asOf: at, virtualAsOf: at });
  }
  const data = [...bySku.values()].sort((a, b) => a.produto.codigo.localeCompare(b.produto.codigo));
  if (data.some(row => row.saldoVirtualTotal === null || row.saldoFisicoTotal === null)) warnings.push('Há saldos não informados. Campos desconhecidos são nulos, não zero.');
  const sources = new Set(data.map(row => row.source));
  const source = !data.length && failed ? 'unavailable' : sources.size > 1 ? 'mixed' : data[0]?.source ?? (fromCache ? 'cache' : 'bling');
  return result(data, source, warnings, null, cached?.asOf ?? data.at(-1)?.asOf ?? new Date().toISOString());
}
export async function listProductStock(context: AccessContext, raw: unknown) {
  requireOperation(context, 'estoque:read');
  const input = pageInputSchema.extend({ sku: z.string().max(200).optional() }).strict().parse(raw);
  const snapshot = await (context.actor.source === 'mcp' ? readStoredStockSnapshot() : readStockSnapshot());
  const rows = input.sku ? snapshot.data.filter(row => row.produto.codigo === input.sku) : snapshot.data;
  if (context.actor.source === 'mcp' && input.sku && snapshot.data.length && !rows.length) snapshot.warnings.push('Não há saldo de produto salvo no banco para o SKU informado.');
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
  invalidateProductStockCache();
  return result({ stockLevel: normalized.saldoVirtualTotal, stockMin: normalized.stockMin, stockMax: normalized.stockMax }, 'bling');
}
