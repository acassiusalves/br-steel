import 'server-only';
import { blingFetchWithRefresh } from './bling';

/**
 * Leitura das NF-e de saída no Bling para os vendidos do gerador de OP. Só GET: nada é gravado no Bling.
 * A listagem traz o cabeçalho (sem itens); os itens vêm do detalhe de cada nota.
 */
export type InvoiceHeader = { blingId: number; number: string | null; situation: number; issuedAt: string | null };
export type InvoiceItem = { sku: string; quantity: number; cfop: string | null };
export type InvoiceDetail = InvoiceHeader & { items: InvoiceItem[] };
export type ItemProduct = { sku: string; blingId: number; format: string | null };
export type KitStructure = { blingId: number; quantity: number }[];

export type BlingInvoiceReader = {
  /** Uma página (100 notas) de NF-e de saída emitidas no período. `cancelled` lista só as canceladas. */
  listOutgoing(input: { from: string; to: string; page: number; cancelled: boolean }): Promise<InvoiceHeader[]>;
  invoice(blingId: number): Promise<InvoiceDetail>;
  /** Formato dos códigos pedidos; códigos que o Bling não devolve ficam de fora. */
  productsByCode(codes: readonly string[]): Promise<ItemProduct[]>;
  /** Componentes do kit (formato E), por id de produto do Bling. */
  kitStructure(blingId: number): Promise<KitStructure>;
};

export const INVOICE_PAGE = 100;
const BASE = 'https://api.bling.com.br/Api/v3';
const CANCELLED = 2;
const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : value != null && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null);

/** O Bling devolve a data no horário de Brasília, sem fuso ("2026-11-10 12:05:55"); zerada quando não há. */
export function blingDateTime(value: unknown): string | null {
  const match = typeof value === 'string' ? /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/.exec(value) : null;
  if (!match || match[1].startsWith('0000')) return null;
  const iso = `${match[1]}T${match[2]}-03:00`;
  return Number.isFinite(Date.parse(iso)) ? iso : null;
}

type RawHeader = { id: number; numero?: string; situacao?: number; dataEmissao?: string };
type RawItem = { codigo?: string; quantidade?: number | string; cfop?: string };
const header = (raw: RawHeader): InvoiceHeader => ({
  blingId: Number(raw.id), number: raw.numero ? String(raw.numero).slice(0, 20) : null,
  situation: num(raw.situacao) ?? 0, issuedAt: blingDateTime(raw.dataEmissao),
});

export function createBlingInvoiceReader(get: (url: string) => Promise<{ data?: unknown }> = blingFetchWithRefresh): BlingInvoiceReader {
  return {
    async listOutgoing({ from, to, page, cancelled }) {
      const query = new URLSearchParams({ tipo: '1', pagina: String(page), limite: String(INVOICE_PAGE),
        dataEmissaoInicial: `${from} 00:00:00`, dataEmissaoFinal: `${to} 23:59:59` });
      // Sem situação o Bling omite as canceladas; elas vêm numa listagem própria.
      if (cancelled) query.set('situacao', String(CANCELLED));
      const response = await get(`${BASE}/nfe?${query}`);
      if (!Array.isArray(response?.data)) throw new Error('Listagem de NF-e inválida.');
      return (response.data as RawHeader[]).map(header);
    },
    async invoice(blingId) {
      const raw = ((await get(`${BASE}/nfe/${blingId}`))?.data ?? {}) as RawHeader & { itens?: RawItem[] };
      if (Number(raw.id) !== blingId) throw new Error(`Nota ${blingId} não devolvida pelo Bling.`);
      const items = (raw.itens ?? []).flatMap(item => {
        const sku = String(item.codigo ?? '').trim().slice(0, 100);
        const quantity = num(item.quantidade);
        return sku && quantity !== null ? [{ sku, quantity, cfop: item.cfop ? String(item.cfop).slice(0, 10) : null }] : [];
      });
      return { ...header(raw), items };
    },
    async productsByCode(codes) {
      const out: ItemProduct[] = [];
      for (let i = 0; i < codes.length; i += 50) {
        // A busca por código do Bling não é exata: um lote pode passar de uma página.
        for (let page = 1; ; page++) {
          const query = new URLSearchParams({ criterio: '5', limite: '100', pagina: String(page) });
          for (const code of codes.slice(i, i + 50)) query.append('codigos[]', code);
          const items = ((await get(`${BASE}/produtos?${query}`))?.data as { id: number; codigo: string; formato?: string }[] | undefined) ?? [];
          for (const p of items) out.push({ sku: p.codigo, blingId: Number(p.id), format: p.formato ?? null });
          if (items.length < 100) break;
          if (page >= 20) throw new Error('listagem de produtos sem fim');
        }
      }
      return out;
    },
    async kitStructure(blingId) {
      const detail = ((await get(`${BASE}/produtos/${blingId}`))?.data ?? {}) as
        { estrutura?: { componentes?: { produto?: { id?: number }; quantidade?: number | string }[] } };
      return (detail.estrutura?.componentes ?? []).flatMap(c => {
        const id = num(c.produto?.id), quantity = num(c.quantidade);
        return id !== null && quantity !== null ? [{ blingId: id, quantity }] : [];
      });
    },
  };
}
