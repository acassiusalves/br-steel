import 'server-only';
import type { Pool } from 'pg';
import { OperationError, result } from '@/server/operations/common';
import { OFFICIAL_LINE_SKUS } from '@/lib/pcp/official-line';
import type { InvoiceItemTotal, KitComponent } from '@/lib/pcp/invoice-demand';
import { createBlingInvoiceReader, INVOICE_PAGE, type BlingInvoiceReader, type InvoiceHeader } from '@/server/integrations/bling-invoices';
import { recordWriteAudit, type WriteActor } from './write-audit';
import { withOperationalWrite } from './postgres-write';

type Row = Record<string, unknown>;
const DAY_MS = 86_400_000;
/** Janela copiada do Bling: cobre os 90 dias padrão do gerador com folga. */
export const INVOICE_WINDOW_DAYS = 120;
/** Nota fora das listagens por mais que isso foi excluída no Bling (evita apagar por uma página que mudou no meio da leitura). */
const VANISHED = '2 hours';
/** Teto de páginas por listagem: 20 mil notas em 120 dias é muito acima do volume da fábrica. */
const MAX_PAGES = 200;
const KIT_RECHECK = '7 days';
const CANCELLED = 2;

export type InvoiceSyncSummary = { listed: number; fetched: number; failed: number; pending: number; removed: number; codesChecked: number };
export type InvoiceDemandRead = {
  items: InvoiceItemTotal[]; kits: Map<string, KitComponent[]>;
  /** Notas do período que ainda não tiveram os itens copiados. */
  pendingInvoices: number;
  listedAt: Date | null;
};

/** Data (AAAA-MM-DD) no horário de Brasília. */
export const saoPauloDate = (ms: number) => new Date(ms - 3 * 3_600_000).toISOString().slice(0, 10);
const dayStart = (date: string) => `${date}T00:00:00-03:00`;

export function createPostgresSalesInvoices(pool: Pool, reader: BlingInvoiceReader = createBlingInvoiceReader()) {
  return {
    /**
     * Copia as NF-e de saída dos últimos 120 dias: lista todos os cabeçalhos (inclusive canceladas), depois
     * lê os itens das notas novas ou que mudaram de situação, das mais recentes para as mais antigas, até o
     * fim do tempo disponível. O que faltar fica para a próxima execução.
     */
    async sync(actor: WriteActor, options: { budgetMs?: number; now?: () => number } = {}) {
      const now = options.now ?? Date.now;
      const started = now();
      const budgetMs = options.budgetMs ?? 240_000;
      const from = saoPauloDate(started - INVOICE_WINDOW_DAYS * DAY_MS), to = saoPauloDate(started + DAY_MS);
      const headers = new Map<number, InvoiceHeader>();
      try {
        for (const cancelled of [false, true]) {
          for (let page = 1; ; page++) {
            const batch = await reader.listOutgoing({ from, to, page, cancelled });
            for (const h of batch) if (h.issuedAt && Number.isSafeInteger(h.blingId)) headers.set(h.blingId, h);
            if (batch.length < INVOICE_PAGE) break;
            if (page >= MAX_PAGES) throw new Error('listagem sem fim');
          }
        }
      } catch {
        throw new OperationError('BLING_UNAVAILABLE', 'Não foi possível listar as notas fiscais no Bling. Tente de novo em instantes.', 503);
      }
      const listed = [...headers.values()];
      const removed = await withOperationalWrite(pool, async client => {
        const listedAt = new Date(started).toISOString();
        await client.query(
          `insert into brsteel_pcp.sales_invoices (bling_id, number, situation, issued_at, listed_at)
           select b, n, s, i, $5::timestamptz from unnest($1::bigint[], $2::text[], $3::smallint[], $4::timestamptz[]) as t(b, n, s, i)
           on conflict (bling_id) do update set number = excluded.number, situation = excluded.situation,
             issued_at = excluded.issued_at, listed_at = excluded.listed_at`,
          [listed.map(h => h.blingId), listed.map(h => h.number), listed.map(h => h.situation), listed.map(h => h.issuedAt), listedAt]);
        // Uma listagem vazia não apaga nada: pode ser falha do Bling, não ausência de notas.
        const gone = listed.length === 0 ? 0 : (await client.query(
          `delete from brsteel_pcp.sales_invoices where issued_at >= $1 and listed_at < $2::timestamptz - interval '${VANISHED}'`,
          [dayStart(from), listedAt])).rowCount ?? 0;
        await recordWriteAudit(client, { operation: 'pcp.syncSalesInvoices', actor, target: { collection: 'pcp.salesInvoices', id: `${from}..${to}` } });
        return gone;
      });

      const due = ((await pool.query(
        `select bling_id from brsteel_pcp.sales_invoices
         where situation <> $1 and items_situation is distinct from situation and issued_at >= $2
         order by issued_at desc, bling_id desc`, [CANCELLED, dayStart(from)])).rows as Row[]).map(r => Number(r.bling_id));
      let fetched = 0, failed = 0, streak = 0;
      for (const blingId of due) {
        if (now() - started > budgetMs || streak >= 3) break;
        let detail;
        try { detail = await reader.invoice(blingId); streak = 0; }
        catch { failed++; streak++; continue; }
        await withOperationalWrite(pool, async client => {
          await client.query('delete from brsteel_pcp.sales_invoice_items where invoice_id = $1', [blingId]);
          await client.query(
            `insert into brsteel_pcp.sales_invoice_items (invoice_id, position, sku, quantity, cfop)
             select $1, p, s, q, c from unnest($2::smallint[], $3::text[], $4::numeric[], $5::text[]) as t(p, s, q, c)`,
            [blingId, detail.items.map((_, i) => i), detail.items.map(i => i.sku), detail.items.map(i => i.quantity), detail.items.map(i => i.cfop)]);
          await client.query(
            `update brsteel_pcp.sales_invoices set situation = $2, items_situation = $2, number = coalesce($3, number),
               issued_at = coalesce($4::timestamptz, issued_at) where bling_id = $1`,
            [blingId, detail.situation, detail.number, detail.issuedAt]);
        });
        fetched++;
      }

      // Códigos fora da linha que aparecem nas notas: descobre quais são kits e guarda a estrutura.
      let codesChecked = 0;
      if (now() - started <= budgetMs && streak < 3) {
        const codes = ((await pool.query(
          `select distinct i.sku from brsteel_pcp.sales_invoice_items i join brsteel_pcp.sales_invoices n on n.bling_id = i.invoice_id
           where n.issued_at >= $1 and not (i.sku = any($2))
             and not exists (select 1 from brsteel_pcp.sales_item_products p where p.sku = i.sku and p.checked_at > now() - interval '${KIT_RECHECK}')
           order by 1 limit 200`, [dayStart(from), OFFICIAL_LINE_SKUS])).rows as Row[]).map(r => String(r.sku));
        try {
          const products = new Map((codes.length ? await reader.productsByCode(codes) : []).map(p => [p.sku, p]));
          const rows: { sku: string; blingId: number | null; format: string | null; components: string }[] = [];
          for (const sku of codes) {
            const product = products.get(sku);
            const components = product?.format === 'E' ? await reader.kitStructure(product.blingId) : [];
            rows.push({ sku, blingId: product?.blingId ?? null, format: product?.format?.slice(0, 5) ?? null, components: JSON.stringify(components) });
          }
          if (rows.length) {
            await withOperationalWrite(pool, client => client.query(
              `insert into brsteel_pcp.sales_item_products (sku, bling_id, format, components, checked_at)
               select s, b, f, c::jsonb, now() from unnest($1::text[], $2::bigint[], $3::text[], $4::text[]) as t(s, b, f, c)
               on conflict (sku) do update set bling_id = excluded.bling_id, format = excluded.format,
                 components = excluded.components, checked_at = now()`,
              [rows.map(r => r.sku), rows.map(r => r.blingId), rows.map(r => r.format), rows.map(r => r.components)]));
          }
          codesChecked = rows.length;
        } catch { /* fica para a próxima execução */ }
      }

      const pending = Number((await pool.query(
        `select count(*)::int as n from brsteel_pcp.sales_invoices
         where situation <> $1 and items_situation is distinct from situation and issued_at >= $2`, [CANCELLED, dayStart(from)])).rows[0].n);
      const summary: InvoiceSyncSummary = { listed: listed.length, fetched, failed, pending, removed, codesChecked };
      return result(summary, 'postgres');
    },

    /** Itens das notas do período (sem as canceladas) somados por SKU e CFOP, e as estruturas dos kits. */
    async demand(from: string, to: string): Promise<InvoiceDemandRead> {
      const range = [dayStart(from), dayStart(new Date(Date.parse(`${to}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10))];
      const items = ((await pool.query(
        `select i.sku, i.cfop, sum(i.quantity)::float8 as quantity
         from brsteel_pcp.sales_invoices n join brsteel_pcp.sales_invoice_items i on i.invoice_id = n.bling_id
         where n.situation <> $3 and n.items_situation is not null and n.issued_at >= $1 and n.issued_at < $2
         group by i.sku, i.cfop`, [...range, CANCELLED])).rows as Row[])
        .map(r => ({ sku: String(r.sku), cfop: (r.cfop as string) ?? null, quantity: Number(r.quantity) }));
      const kits = new Map<string, KitComponent[]>();
      for (const r of (await pool.query(
        `select k.sku as kit, p.sku as component, (c->>'quantity')::float8 as quantity
         from brsteel_pcp.sales_item_products k cross join jsonb_array_elements(k.components) c
         join brsteel_pcp.bling_products p on p.bling_id = (c->>'blingId')::bigint
         where k.format = 'E'`)).rows as Row[]) {
        kits.set(String(r.kit), [...(kits.get(String(r.kit)) ?? []), { sku: String(r.component), quantity: Number(r.quantity) }]);
      }
      const state = (await pool.query(
        `select (select max(listed_at) from brsteel_pcp.sales_invoices) as listed_at,
           (select count(*)::int from brsteel_pcp.sales_invoices where situation <> $3 and items_situation is null
              and issued_at >= $1 and issued_at < $2) as pending`, [...range, CANCELLED])).rows[0] as Row;
      return { items, kits, pendingInvoices: Number(state.pending), listedAt: (state.listed_at as Date | null) ?? null };
    },
  };
}

export type SalesInvoices = ReturnType<typeof createPostgresSalesInvoices>;
