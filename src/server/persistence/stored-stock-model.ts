import type { ProductStock } from '@/types/product-stock';

export interface StockReadModel { stock: ProductStock; observedAtMs: number; skuOrder: number; }
const finite = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;

/** Keep the persisted-stock rules in one place for Firestore reads and the import projection. */
export function normalizeStoredStockObservation(id: string, data: Record<string, unknown>): Omit<StockReadModel, 'skuOrder'> | null {
  const balance = finite(data.estoqueAtual);
  if (data.isSimulated || data.source === 'simulated' || String(data.lastEvent ?? '').includes('(test)') || balance === null) return null;
  const sku = String(data.sku || id), at = String(data.webhookReceivedAt || '');
  const observedAtMs = Date.parse(at);
  if (!Number.isFinite(observedAtMs)) return null;
  return { observedAtMs, stock: {
    produto: { id: finite(data.produtoId) ?? 0, codigo: sku, nome: String(data.nome || sku) },
    deposito: { id: 0, nome: '' }, saldoFisico: null, saldoFisicoTotal: null,
    saldoVirtual: balance, saldoVirtualTotal: balance, source: 'firestore', asOf: at, physicalAsOf: null, virtualAsOf: at,
  } };
}

export function prepareStockReadModels(records: { id: string; data: Record<string, unknown> }[]): Map<string, StockReadModel> {
  const models = new Map<string, StockReadModel>(), skus = new Set<string>();
  for (const row of [...records].sort((a,b) => Buffer.compare(Buffer.from(a.id), Buffer.from(b.id)))) {
    const model = normalizeStoredStockObservation(row.id, row.data);
    if (model) { models.set(row.id, { ...model, skuOrder: 0 }); skus.add(model.stock.produto.codigo); }
  }
  const order = new Map([...skus].sort((a,b) => a.localeCompare(b)).map((sku,index) => [sku,index]));
  for (const model of models.values()) model.skuOrder = order.get(model.stock.produto.codigo)!;
  return models;
}

export function storedStockWarnings(hasData: boolean) {
  return ['Consulta somente aos saldos salvos no banco de dados deste ambiente. A data de cada saldo indica sua última observação; integrações externas não são consultadas.',
    hasData ? 'Saldos físicos não registrados são nulos, não zero.' : 'Nenhum saldo de produto válido está salvo no banco de dados deste ambiente.'];
}
