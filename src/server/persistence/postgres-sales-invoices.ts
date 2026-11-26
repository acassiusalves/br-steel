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
const PENDING_RECHECK = '6 hours';
const ITEM_LIMIT = 1_000;
const detailsDue = (asOf: string) => `(items_situation is distinct from situation
  or (situation = 1 and (items_read_at is null or items_read_at < ${asOf} - interval '${PENDING_RECHECK}')))`;

export type InvoiceSyncSummary = { listed: number; fetched: number; failed: number; pending: number; removed: number; codesChecked: number };
export type InvoiceDemandRead = {
  items: InvoiceItemTotal[]; kits: Map<string, KitComponent[]>;
  /** Notas do período que ainda não tiveram os itens copiados. */
  pendingInvoices: number;
  listedAt: Date | null;
};

export type QueueInvoiceDemandRead = {
  sold: Map<string, number>;
  ignored: { invoice: string; sku: string; quantity: number }[];
  invoiceCount: number;
  pendingInvoices: number;
  listedAt: Date | null;
  coveredFrom: string | null;
  coveredTo: string | null;
};

type QueueLine = { sku: string; cfop: string | null; quantity: number };
type QueueDemandRow = {
  totals: QueueLine[];
  ignored: (QueueLine & { invoice: string })[];
  invoice_count: number;
  pending_invoices: number;
  listed_at: Date | null;
  covered_from: string | null;
  covered_to: string | null;
};

function isQueueSaleCfop(cfop: string | null) {
  const code = Number(cfop);
  const family = Math.floor(code / 1_000);
  const suffix = code % 1_000;
  return Number.isInteger(code) && family >= 5 && family <= 7
    && ((suffix >= 101 && suffix <= 125) || (suffix >= 401 && suffix <= 405));
}

/** Data (AAAA-MM-DD) no horário de Brasília. */
export const saoPauloDate = (ms: number) => new Date(ms - 3 * 3_600_000).toISOString().slice(0, 10);
const dayStart = (date: string) => `${date}T00:00:00-03:00`;

export function createPostgresSalesInvoices(pool: Pool, reader: BlingInvoiceReader = createBlingInvoiceReader()) {
  return {
    /**
     * Copia as NF-e de saída dos últimos 120 dias: lista todos os cabeçalhos (inclusive canceladas), depois
     * lê os itens das notas novas, das que mudaram de situação e das pendentes lidas há mais de 6 horas.
     * Lê das mais recentes para as mais antigas até o fim do tempo disponível.
     */
    async sync(actor: WriteActor, options: { budgetMs?: number; now?: () => number } = {}) {
      const now = options.now ?? Date.now;
      const started = now();
      const budgetMs = options.budgetMs ?? 240_000;
      const from = saoPauloDate(started - INVOICE_WINDOW_DAYS * DAY_MS);
      const today = saoPauloDate(started), to = saoPauloDate(started + DAY_MS);
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
      const listedAt = new Date(started).toISOString();
      const removed = await withOperationalWrite(pool, async client => {
        if (!listed.length) {
          const existing = await client.query(
            `select 1 from brsteel_pcp.sales_invoices
             where issued_at >= $1 and issued_at < (($2::date + 1)::timestamp at time zone 'America/Sao_Paulo') limit 1`,
            [dayStart(from), to],
          );
          if (existing.rows.length) {
            throw new OperationError('BLING_INVOICES_EMPTY', 'O Bling retornou uma listagem vazia em um período com NF-e já copiadas.', 503);
          }
        }
        // Só a listagem mais recente pode atualizar a cobertura, os cabeçalhos e as ausências.
        const coverage = await client.query(
          `insert into brsteel_pcp.sales_invoice_sync_state as current (singleton, covered_from, covered_to, listed_at)
           values (true, $1, $2, $3)
           on conflict (singleton) do update set covered_from = excluded.covered_from,
             covered_to = excluded.covered_to, listed_at = excluded.listed_at
           where current.listed_at < excluded.listed_at`, [from, today, listedAt]);
        if (!coverage.rowCount) return 0;
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
         where situation <> $1 and issued_at >= $2 and ${detailsDue('$3::timestamptz')}
         order by issued_at desc, bling_id desc`, [CANCELLED, dayStart(from), listedAt])).rows as Row[]).map(r => Number(r.bling_id));
      let fetched = 0, failed = 0, streak = 0;
      for (const blingId of due) {
        if (now() - started > budgetMs || streak >= 3) break;
        const readingStartedAt = new Date(now()).toISOString();
        let detail;
        try { detail = await reader.invoice(blingId); streak = 0; }
        catch { failed++; streak++; continue; }
        const readAt = new Date(now()).toISOString();
        const saved = await withOperationalWrite(pool, async client => {
          const updated = await client.query(
            `update brsteel_pcp.sales_invoices set situation = $2, items_situation = $2, number = coalesce($3, number),
               issued_at = coalesce($4::timestamptz, issued_at), items_read_at = $5
             where bling_id = $1 and listed_at <= $6::timestamptz
               and (items_read_at is null or items_read_at <= $6::timestamptz)`,
            [blingId, detail.situation, detail.number, detail.issuedAt, readAt, readingStartedAt]);
          if (!updated.rowCount) return false;
          await client.query('delete from brsteel_pcp.sales_invoice_items where invoice_id = $1', [blingId]);
          await client.query(
            `insert into brsteel_pcp.sales_invoice_items (invoice_id, position, sku, quantity, cfop)
             select $1, p, s, q, c from unnest($2::smallint[], $3::text[], $4::numeric[], $5::text[]) as t(p, s, q, c)`,
            [blingId, detail.items.map((_, i) => i), detail.items.map(i => i.sku), detail.items.map(i => i.quantity), detail.items.map(i => i.cfop)]);
          return true;
        });
        if (saved) fetched++;
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
         where situation <> $1 and issued_at >= $2 and ${detailsDue('$3::timestamptz')}`,
        [CANCELLED, dayStart(from), new Date(now()).toISOString()])).rows[0].n);
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

    /** Vendas por código fiscal para a fila por categoria, sem expandir kits. */
    async queueDemand(from: string, to: string): Promise<QueueInvoiceDemandRead> {
      const nextDay = new Date(Date.parse(`${to}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
      const { rows: [data] } = await pool.query<QueueDemandRow>(
        `with notes as (
           select bling_id, number, situation, items_situation, items_read_at, issued_at
           from brsteel_pcp.sales_invoices
           where issued_at >= $1 and issued_at < $2 and situation <> $3
         ), lines as (
           select coalesce(n.number, n.bling_id::text) as invoice, n.issued_at, n.bling_id,
             i.position, i.sku, i.cfop, i.quantity
           from notes n join brsteel_pcp.sales_invoice_items i on i.invoice_id = n.bling_id
           where n.items_situation = n.situation
         ), totals as (
           select sku, cfop, sum(quantity)::float8 as quantity from lines
           where quantity <= $4 group by sku, cfop
         )
         select (select count(*)::int from notes) as invoice_count,
           (select count(*)::int from notes where ${detailsDue('statement_timestamp()')}) as pending_invoices,
           (select coalesce(json_agg(totals), '[]'::json) from totals) as totals,
           (select coalesce(json_agg(json_build_object('invoice', invoice, 'sku', sku, 'cfop', cfop, 'quantity', quantity)
               order by issued_at desc, bling_id desc, position), '[]'::json) from lines where quantity > $4) as ignored,
           coverage.listed_at, coverage.covered_from::text, coverage.covered_to::text
         from (values (true)) as state(singleton) left join brsteel_pcp.sales_invoice_sync_state coverage using (singleton)`,
        [dayStart(from), dayStart(nextDay), CANCELLED, ITEM_LIMIT]);
      const sold = new Map<string, number>();
      for (const { sku, cfop, quantity } of data.totals) {
        if (isQueueSaleCfop(cfop)) sold.set(sku, (sold.get(sku) ?? 0) + quantity);
      }
      const ignored = data.ignored.filter(line => isQueueSaleCfop(line.cfop))
        .map(({ invoice, sku, quantity }) => ({ invoice, sku, quantity }));
      return {
        sold, ignored, invoiceCount: data.invoice_count, pendingInvoices: data.pending_invoices,
        listedAt: data.listed_at, coveredFrom: data.covered_from, coveredTo: data.covered_to,
      };
    },
  };
}

export type SalesInvoices = ReturnType<typeof createPostgresSalesInvoices>;
