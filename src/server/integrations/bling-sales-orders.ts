import 'server-only';
import { blingFetchWithRefresh } from './bling';

/**
 * Leitura de pedidos de venda no Bling para gerar OP a partir de um pedido. Só GET: nada é gravado no
 * Bling. O nome do cliente é devolvido só para a tela conferir o pedido; não é gravado.
 */
export type SalesOrderHeader = { blingId: number; number: string; storeNumber: string | null; date: string | null; customerName: string | null };
export type SalesOrderItem = { sku: string; description: string | null; quantity: number; productBlingId: number | null };
export type SalesOrderDetail = SalesOrderHeader & { items: SalesOrderItem[] };
export type BlingProductStructure = { blingId: number; sku: string; name: string | null; format: string | null; components: { blingId: number; quantity: number }[] };

export type BlingSalesOrderReader = {
  /** Pedidos com este número no Bling; sem resultado, procura pelo número da loja. Segue as páginas. */
  findByNumber(number: string): Promise<SalesOrderHeader[]>;
  order(blingId: number): Promise<SalesOrderDetail>;
  /** Código, formato e estrutura (componentes do kit) do produto; null quando o Bling não devolve. */
  product(blingId: number): Promise<BlingProductStructure | null>;
};

const BASE = 'https://api.bling.com.br/Api/v3';
const PAGE = 100;
const MAX_PAGES = 5;
const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : value != null && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null);
const text = (value: unknown, max: number) => (value == null || String(value).trim() === '' ? null : String(value).trim().slice(0, max));

type RawHeader = { id: number; numero?: number | string; numeroLoja?: string; data?: string; contato?: { nome?: string } };
type RawItem = { codigo?: string; descricao?: string; quantidade?: number | string; produto?: { id?: number } };

const header = (raw: RawHeader): SalesOrderHeader => ({
  blingId: Number(raw.id), number: text(raw.numero, 30) ?? '', storeNumber: text(raw.numeroLoja, 60),
  date: typeof raw.data === 'string' && /^\d{4}-\d{2}-\d{2}/.test(raw.data) && !raw.data.startsWith('0000') ? raw.data.slice(0, 10) : null,
  customerName: text(raw.contato?.nome, 120),
});

export function createBlingSalesOrderReader(get: (url: string) => Promise<{ data?: unknown }> = blingFetchWithRefresh): BlingSalesOrderReader {
  async function list(filter: [string, string]): Promise<SalesOrderHeader[]> {
    const out: SalesOrderHeader[] = [];
    for (let page = 1; ; page++) {
      const query = new URLSearchParams({ pagina: String(page), limite: String(PAGE) });
      query.append(...filter);
      const items = ((await get(`${BASE}/pedidos/vendas?${query}`))?.data as RawHeader[] | undefined) ?? [];
      out.push(...items.map(header));
      if (items.length < PAGE) break;
      if (page >= MAX_PAGES) throw new Error('listagem de pedidos sem fim');
    }
    return out;
  }
  return {
    async findByNumber(number) {
      const term = number.trim();
      if (/^\d+$/.test(term)) {
        const byNumber = (await list(['numero', term])).filter(o => o.number === term);
        if (byNumber.length) return byNumber;
      }
      return (await list(['numerosLojas[]', term])).filter(o => o.storeNumber === term);
    },
    async order(blingId) {
      const raw = ((await get(`${BASE}/pedidos/vendas/${blingId}`))?.data ?? {}) as RawHeader & { itens?: RawItem[] };
      if (Number(raw.id) !== blingId) throw new Error(`Pedido ${blingId} não devolvido pelo Bling.`);
      const items = (raw.itens ?? []).flatMap(item => {
        const sku = text(item.codigo, 100), quantity = num(item.quantidade);
        return sku && quantity !== null && quantity > 0
          ? [{ sku, description: text(item.descricao, 300), quantity, productBlingId: num(item.produto?.id) || null }] : [];
      });
      return { ...header(raw), items };
    },
    async product(blingId) {
      const raw = ((await get(`${BASE}/produtos/${blingId}`))?.data ?? null) as
        { id?: number; codigo?: string; nome?: string; formato?: string; estrutura?: { componentes?: { produto?: { id?: number }; quantidade?: number | string }[] } } | null;
      if (!raw || Number(raw.id) !== blingId || !text(raw.codigo, 100)) return null;
      return {
        blingId, sku: text(raw.codigo, 100)!, name: text(raw.nome, 300), format: text(raw.formato, 5),
        components: (raw.estrutura?.componentes ?? []).flatMap(c => {
          const id = num(c.produto?.id), quantity = num(c.quantidade);
          return id !== null && quantity !== null && quantity > 0 ? [{ blingId: id, quantity }] : [];
        }),
      };
    },
  };
}
