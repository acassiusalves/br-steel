import 'server-only';
import type { Pool } from 'pg';
import { contentHash, NATIVE_RUN_ID } from '@/server/migration/operational-snapshot';
import { closedWeeksSince, isoWeekRange } from '@/lib/iso-week';
import { serialize } from '@/server/operations/common';
import { countsAsConsumption } from './demand-eligibility';
import { createPostgresSalesRepository } from './postgres-sales';
import { withOperationalWrite } from './postgres-write';
import { withOperationalSnapshot } from './postgres-read';
import type { HistoryPoint } from './production-demand-contract';
import type { RollupResult, SkuWeeklyDemandRepository } from './sku-weekly-demand-contract';

type WeekBucket = { units: number; orders: number };
type Stored = { sku: string; description?: string; weeks: Record<string, WeekBucket>; lastClosedWeek?: string; updatedAt?: string };
const ROLLUP_BUDGET_MS = 240_000;
const CACHE_TTL_MS = 600_000;
const nativeVersion = () => String(BigInt(Date.now()) * BigInt(1000000));

/** O SKU é a chave: no PostgreSQL não há restrição de caracteres como a do id de documento do Firestore. */
export function createPostgresSkuWeeklyDemandRepository(pool: Pool): SkuWeeklyDemandRepository {
  let cached: { at: number; series: Map<string, HistoryPoint[]> } | null = null;
  // Os pedidos vêm do mesmo banco, nunca do repositório trocável: esta implementação só é escolhida
  // com a fonte em PostgreSQL, e o trocável leria `operationalSource` de novo (no teste, Firestore).
  const sales = createPostgresSalesRepository(pool);

  async function rollUpWeek(week: string, now: Date) {
    const { from, to } = isoWeekRange(week);
    const orders = await sales.readOrdersForPeriod({ from, to });
    const buckets = new Map<string, { description: string; orders: Set<number>; units: number }>();
    for (const order of orders) {
      if (!countsAsConsumption(order)) continue;
      for (const item of order.itens ?? []) {
        if (!item.codigo || !Number.isFinite(item.quantidade) || item.quantidade <= 0) continue;
        const description = typeof item.descricao === 'string' ? item.descricao : '';
        const bucket = buckets.get(item.codigo) ?? { description, orders: new Set<number>(), units: 0 };
        bucket.orders.add(order.id); bucket.units += item.quantidade; buckets.set(item.codigo, bucket);
      }
    }
    // Janela de retenção inteira: sempre tem ao menos um elemento (ver a versão Firestore).
    const oldest = closedWeeksSince(null, now)[0];
    await withOperationalWrite(pool, async client => {
      const rows = (await client.query(
        'select source_id, payload from brsteel_ops.sku_weekly_demand where not source_deleted for update')).rows;
      // Chaveado pelo SKU verdadeiro: uma linha importada pode ter o id saneado do Firestore
      // (`CHAPA_10~<hash>`), com o SKU em `payload.sku`. Atualiza-se sempre pela linha existente.
      const stored = new Map(rows.map(row => [String((row.payload as Stored).sku || row.source_id),
        { sourceId: row.source_id as string, payload: row.payload as Stored }]));
      for (const sku of new Set([...stored.keys(), ...buckets.keys()])) {
        const previous = stored.get(sku)?.payload;
        const sourceId = stored.get(sku)?.sourceId ?? sku;
        const fresh = buckets.get(sku);
        const weeks = { ...(previous?.weeks ?? {}) };
        // Fechamento autoritativo: poda fora da retenção e tira o bucket da semana de quem não vendeu nela.
        for (const key of Object.keys(weeks)) if (key < oldest || key === week) delete weeks[key];
        if (fresh) weeks[week] = { units: fresh.units, orders: fresh.orders.size };
        if (!fresh && previous && Object.keys(weeks).length === Object.keys(previous.weeks ?? {}).length) continue;
        if (!Object.keys(weeks).length) {
          await client.query(
            `update brsteel_ops.sku_weekly_demand set source_deleted = true, source_version = $2
             where source_id = $1`, [sourceId, nativeVersion()]);
          continue;
        }
        const payload = serialize({ ...previous, sku, weeks,
          ...(fresh?.description ? { description: fresh.description } : {}),
          ...(fresh ? { lastClosedWeek: week } : {}), updatedAt: now.toISOString() }) as Stored;
        await client.query(
          `insert into brsteel_ops.sku_weekly_demand (source_id, payload, source_version, source_hash, import_run_id)
           values ($1, $2, $3, $4, $5)
           on conflict (source_id) do update set payload = excluded.payload, source_version = excluded.source_version,
             source_hash = excluded.source_hash, source_deleted = false`,
          [sourceId, JSON.stringify(payload), nativeVersion(), contentHash(payload), NATIVE_RUN_ID]);
      }
    });
    cached = null;
    return buckets.size;
  }

  return {
    async rollUpPendingWeeks(now = new Date(), budgetMs = ROLLUP_BUDGET_MS): Promise<RollupResult> {
      const startedAt = Date.now();
      // Sem documento de checkpoint: a semana mais recente gravada serve de marca. Diferenças residuais
      // em relação ao Firestore:
      //  - semanas finais sem nenhuma venda não avançam a marca e são reprocessadas a cada execução
      //    (inofensivo: o fechamento é idempotente);
      //  - o documento de checkpoint do Firestore não é levado na migração, então a primeira execução
      //    depois do corte parte do maior `lastClosedWeek` presente nas linhas.
      const last = (await withOperationalSnapshot(pool, client => client.query(
        `select max(payload->>'lastClosedWeek') as week from brsteel_ops.sku_weekly_demand where not source_deleted`))).rows[0]?.week ?? null;
      const pending = closedWeeksSince(typeof last === 'string' ? last : null, now);
      const weeks: string[] = [];
      let skus = 0;
      for (const week of pending) {
        if (weeks.length && Date.now() - startedAt >= budgetMs) break;
        skus += await rollUpWeek(week, now);
        weeks.push(week);
      }
      return { weeks, skus, remaining: pending.length - weeks.length };
    },
    async readWeeklyHistory(weeks: number) {
      if (!cached || Date.now() - cached.at > CACHE_TTL_MS) {
        const rows = (await withOperationalSnapshot(pool, client => client.query(
          'select source_id, payload from brsteel_ops.sku_weekly_demand where not source_deleted order by source_id'))).rows;
        const series = new Map<string, HistoryPoint[]>();
        for (const row of rows) {
          const stored = ((row.payload as Stored).weeks ?? {});
          const points = Object.keys(stored).sort().map(week => ({ week, units: stored[week].units, orders: stored[week].orders }));
          if (points.length) series.set(String((row.payload as Stored).sku || row.source_id), points);
        }
        cached = { at: Date.now(), series };
      }
      return new Map([...cached.series].map(([sku, points]) => [sku, weeks > 0 ? points.slice(-weeks) : []]));
    },
  };
}
