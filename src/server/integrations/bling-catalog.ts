import 'server-only';
import { BLING_DEPOSITS } from '@/lib/pcp/official-line';
import { blingFetchWithRefresh } from './bling';

/**
 * Leitura do cadastro e do saldo por depósito no Bling para o gerador de OP. Só GET: nada é gravado no
 * Bling. Segue a leitura do script de OP da fábrica (listagem por código, detalhe por produto para
 * mín/máx e formato, saldo em lotes de 50 produtos).
 */
export type BlingProduct = { sku: string; blingId: number; name: string | null; format: string | null; stockMin: number | null; stockMax: number | null };
export type BlingReader = {
  /** Cadastro dos SKUs pedidos; SKUs que o Bling não devolve ficam de fora. */
  products(skus: readonly string[]): Promise<BlingProduct[]>;
  /** Saldo virtual do depósito Estoque por id de produto do Bling. Produto sem o depósito = 0. */
  estoqueBalances(blingIds: readonly number[]): Promise<Map<number, number>>;
};

const BASE = 'https://api.bling.com.br/Api/v3';
const BATCH = 50;
const chunks = <T,>(items: readonly T[], size: number) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, i * size + size));
const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : value != null && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null);

type ListItem = { id: number; codigo: string; nome?: string; formato?: string };
type Detail = ListItem & { estoque?: { minimo?: number; maximo?: number } };
type Balance = { produto: { id: number; codigo?: string }; depositos?: { id: number; saldoFisico?: number; saldoVirtual?: number }[] };

export function createBlingReader(get: (url: string) => Promise<{ data?: unknown }> = blingFetchWithRefresh): BlingReader {
  return {
    async products(skus) {
      const listed: ListItem[] = [];
      for (const batch of chunks(skus, BATCH)) {
        const query = new URLSearchParams({ criterio: '5', limite: String(BATCH) });
        for (const sku of batch) query.append('codigos[]', sku);
        const response = await get(`${BASE}/produtos?${query}`);
        listed.push(...((response?.data as ListItem[] | undefined) ?? []));
      }
      const wanted = new Set(skus);
      const out: BlingProduct[] = [];
      for (const item of listed.filter(p => wanted.has(p.codigo))) {
        // A listagem não traz mín/máx: o detalhe é por produto (a fila do cliente respeita o limite do Bling).
        const detail = ((await get(`${BASE}/produtos/${item.id}`))?.data ?? item) as Detail;
        out.push({ sku: item.codigo, blingId: item.id, name: detail.nome ?? item.nome ?? null, format: detail.formato ?? item.formato ?? null,
          stockMin: num(detail.estoque?.minimo), stockMax: num(detail.estoque?.maximo) });
      }
      return out;
    },
    async estoqueBalances(blingIds) {
      const out = new Map<number, number>();
      for (const batch of chunks(blingIds, BATCH)) {
        const query = new URLSearchParams();
        for (const id of batch) query.append('idsProdutos[]', String(id));
        const response = await get(`${BASE}/estoques/saldos?${query}`);
        for (const row of (response?.data as Balance[] | undefined) ?? []) {
          const deposit = row.depositos?.find(d => d.id === BLING_DEPOSITS.estoque);
          out.set(row.produto.id, num(deposit?.saldoVirtual) ?? 0);
        }
      }
      return out;
    },
  };
}
