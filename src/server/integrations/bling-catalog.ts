import 'server-only';
import { BLING_DEPOSITS } from '@/lib/pcp/official-line';
import { blingFetchWithRefresh } from './bling';

/**
 * Leitura do cadastro e do saldo por depósito no Bling para o gerador de OP. Só GET: nada é gravado no
 * Bling. A listagem é por código, seguida do detalhe por produto e de saldo em lotes de 50 produtos.
 */
export type BlingProduct = { sku: string; blingId: number; name: string | null; format: string | null; stockMin: number | null; stockMax: number | null };
export type BlingCategory = { id: number | string; descricao?: string; categoriaPai?: { id?: number | string } | null };
export type QueueBlingProduct = BlingProduct & { active: boolean; categoryId: string | null; structureStockType: string | null; hasStructure: boolean };
export type QueueBlingBalance = { value: number; source: 'virtual' | 'fisico' | 'total' | 'ausente' };
export type BlingReader = {
  /** Cadastro dos SKUs pedidos; SKUs que o Bling não devolve ficam de fora. */
  products(skus: readonly string[]): Promise<BlingProduct[]>;
  /** Saldo virtual do depósito Estoque por id de produto do Bling. Produto sem o depósito = 0. */
  estoqueBalances(blingIds: readonly number[]): Promise<Map<number, number>>;
  categories?(): Promise<BlingCategory[]>;
  queueProducts?(skus: readonly string[]): Promise<QueueBlingProduct[]>;
  queueBalances?(blingIds: readonly number[]): Promise<Map<number, QueueBlingBalance>>;
};

const BASE = 'https://api.bling.com.br/Api/v3';
const BATCH = 50;
const QUEUE_PRODUCT_BATCH = 30;
const LIST_PAGE = 100;
const MAX_LIST_PAGES = 20;
const chunks = <T,>(items: readonly T[], size: number) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, i * size + size));
const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : value != null && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null);
const queueNumber = (value: unknown) =>
  typeof value === 'number' || (typeof value === 'string' && value.trim() !== '') ? num(value) : null;
type ListItem = { id: number; codigo: string; nome?: string; formato?: string; situacao?: string };
type Detail = ListItem & {
  estoque?: { minimo?: number | string; maximo?: number | string };
  categoria?: { id?: number | string } | null;
  estrutura?: { tipoEstoque?: string; componentes?: unknown[] } | null;
};
type Balance = {
  produto?: { id: number | string };
  saldoVirtualTotal?: number | string;
  depositos?: { id: number | string; saldoFisico?: number | string; saldoVirtual?: number | string }[];
};

export function createBlingReader(get: (url: string) => Promise<{ data?: unknown }> = blingFetchWithRefresh): Required<BlingReader> {
  async function listProducts(skus: readonly string[], batchSize: number) {
    const listed: ListItem[] = [];
    for (const batch of chunks(skus, batchSize)) {
      // A busca por código pode trazer cadastros semelhantes e ocupar mais de uma página.
      for (let page = 1; ; page++) {
        const query = new URLSearchParams({ criterio: '5', limite: String(LIST_PAGE), pagina: String(page) });
        for (const sku of batch) query.append('codigos[]', sku);
        const items = ((await get(`${BASE}/produtos?${query}`))?.data as ListItem[] | undefined) ?? [];
        listed.push(...items);
        if (items.length < LIST_PAGE) break;
        if (page >= MAX_LIST_PAGES) throw new Error('listagem de produtos sem fim');
      }
    }
    return listed;
  }

  async function listBalances(blingIds: readonly number[]) {
    const query = new URLSearchParams();
    for (const id of blingIds) query.append('idsProdutos[]', String(id));
    const response = await get(`${BASE}/estoques/saldos?${query}`);
    return (response?.data as Balance[] | undefined) ?? [];
  }

  return {
    async products(skus) {
      const listed = await listProducts(skus, BATCH);
      const wanted = new Set(skus);
      const out: BlingProduct[] = [];
      const unique = new Map(listed.filter(p => wanted.has(p.codigo)).map(p => [p.id, p]));
      for (const item of unique.values()) {
        const detail = ((await get(`${BASE}/produtos/${item.id}`))?.data ?? item) as Detail;
        out.push({ sku: item.codigo, blingId: item.id, name: detail.nome ?? item.nome ?? null, format: detail.formato ?? item.formato ?? null,
          stockMin: num(detail.estoque?.minimo), stockMax: num(detail.estoque?.maximo) });
      }
      return out;
    },
    async estoqueBalances(blingIds) {
      const out = new Map<number, number>();
      for (const batch of chunks(blingIds, BATCH)) {
        for (const row of await listBalances(batch)) {
          if (!row.produto) continue;
          const deposit = row.depositos?.find(d => d.id === BLING_DEPOSITS.estoque);
          out.set(Number(row.produto.id), num(deposit?.saldoVirtual) ?? 0);
        }
      }
      return out;
    },
    async categories() {
      const categories: BlingCategory[] = [];
      for (let page = 1; ; page++) {
        const query = new URLSearchParams({ limite: String(LIST_PAGE), pagina: String(page) });
        const batch = ((await get(`${BASE}/categorias/produtos?${query}`))?.data as BlingCategory[] | undefined) ?? [];
        categories.push(...batch);
        if (batch.length < LIST_PAGE) return categories;
        if (page >= MAX_LIST_PAGES) throw new Error('listagem de categorias sem fim');
      }
    },
    async queueProducts(skus) {
      const wanted = new Set(skus);
      const unique = new Map<string, ListItem>();
      for (const item of await listProducts([...wanted], QUEUE_PRODUCT_BATCH)) {
        const sku = item.codigo?.trim();
        if (!wanted.has(sku)) continue;
        const found = unique.get(sku);
        if (!found || (found.situacao !== 'A' && item.situacao === 'A')) unique.set(sku, item);
      }
      const products: QueueBlingProduct[] = [];
      for (const [sku, item] of unique) {
        const detail = ((await get(`${BASE}/produtos/${item.id}`))?.data ?? item) as Detail;
        if (detail.codigo && detail.codigo.trim() !== sku) continue;
        const situation = detail.situacao || item.situacao;
        const category = detail.categoria?.id;
        products.push({
          sku, blingId: Number(detail.id ?? item.id), name: detail.nome?.trim() || null, format: detail.formato ?? item.formato ?? null,
          stockMin: queueNumber(detail.estoque?.minimo), stockMax: queueNumber(detail.estoque?.maximo),
          active: !situation || situation === 'A',
          categoryId: category && String(category) !== '0' ? String(category) : null,
          structureStockType: detail.estrutura?.tipoEstoque ?? null,
          hasStructure: Array.isArray(detail.estrutura?.componentes) && detail.estrutura.componentes.length > 0,
        });
      }
      return products;
    },
    async queueBalances(blingIds) {
      const configuredDeposit = Number(process.env.BLING_DEPOSITO_ESTOQUE_ID);
      const depositId = Number.isSafeInteger(configuredDeposit) && configuredDeposit > 0 ? configuredDeposit : BLING_DEPOSITS.estoque;
      const out = new Map<number, QueueBlingBalance>();
      for (const batch of chunks([...new Set(blingIds)], BATCH)) {
        const wanted = new Set(batch);
        for (const row of await listBalances(batch)) {
          const id = Number(row.produto?.id);
          if (!wanted.has(id)) continue;
          const deposit = row.depositos?.find(d => Number(d.id) === depositId);
          if (!deposit) {
            const total = queueNumber(row.saldoVirtualTotal);
            out.set(id, total === null ? { value: 0, source: 'ausente' } : { value: total, source: 'total' });
            continue;
          }
          const virtual = queueNumber(deposit.saldoVirtual);
          const physical = queueNumber(deposit.saldoFisico);
          if (virtual !== null) out.set(id, { value: virtual, source: 'virtual' });
          else if (physical !== null) out.set(id, { value: physical, source: 'fisico' });
          else out.set(id, { value: 0, source: 'ausente' });
        }
      }
      return out;
    },
  };
}
