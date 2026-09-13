import 'server-only';
import { adminDb } from '@/lib/firebase-admin';
import { result } from '@/server/operations/common';
import type { ProductStock } from '@/types/product-stock';
import type { StockReadRepository } from './stock-contract';
import { prepareStockReadModels, storedStockWarnings } from './stored-stock-model';
import { stockOffset } from './stock-pagination';

async function snapshot() {
  const docs = (await adminDb.collection('stockUpdates').get()).docs;
  const models = prepareStockReadModels(docs.map(doc => ({ id: doc.id, data: doc.data() })));
  const bySku = new Map<string, ProductStock>();
  let latest: string | undefined;
  for (const { stock, observedAtMs } of models.values()) {
    const existing = bySku.get(stock.produto.codigo);
    if (existing && Date.parse(existing.asOf) > observedAtMs) continue;
    bySku.set(stock.produto.codigo, stock);
    if (!latest || observedAtMs > Date.parse(latest)) latest = stock.asOf;
  }
  const data = [...bySku.values()].sort((a,b) => a.produto.codigo.localeCompare(b.produto.codigo));
  return result(data, 'firestore', storedStockWarnings(Boolean(data.length)), null, latest ?? new Date().toISOString());
}
export const firestoreStockReadRepository: StockReadRepository = {
  snapshot,
  async list(input) {
    const offset = stockOffset(input.cursor), response = await snapshot();
    const rows = input.sku ? response.data.filter(row => row.produto.codigo === input.sku) : response.data;
    if (input.sku && response.data.length && !rows.length) response.warnings.push('Não há saldo de produto salvo no banco para o SKU informado.');
    return { ...response, data: rows.slice(offset, offset + input.limit), nextCursor: offset + input.limit < rows.length ? String(offset + input.limit) : null };
  },
};
