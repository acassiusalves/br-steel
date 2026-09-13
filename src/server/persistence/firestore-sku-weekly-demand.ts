import 'server-only';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import type { SaleOrder } from '@/types/sale-order';
import { HISTORY_WEEKS, closedWeeksSince, isoWeekOf, isoWeekRange } from '@/lib/iso-week';
import { countsAsConsumption } from './demand-eligibility';
import type { HistoryPoint } from './production-demand-contract';

export const WEEKLY_DEMAND = 'skuWeeklyDemand';
export const ROLLUP_CHECKPOINT = 'skuWeeklyDemandRollup';

export type WeekBucket = { units: number; orders: number };

const checkpointRef = () => adminDb.collection('appConfig').doc(ROLLUP_CHECKPOINT);

/**
 * Fecha uma semana: lê os pedidos daquele intervalo e grava um bucket por SKU.
 *
 * A escrita é por mapa aninhado com merge, então reprocessar a mesma semana é no-op — e crons repetem.
 * A poda usa a mesma passagem para descartar semanas fora da janela de retenção, evitando um segundo
 * percurso sobre a coleção.
 */
export async function rollUpWeek(week: string, now: Date = new Date()) {
  const { from, to } = isoWeekRange(week);
  const snapshot = await adminDb.collection('salesOrders')
    .where('data', '>=', from).where('data', '<=', to).get();

  const buckets = new Map<string, { description: string; orders: Set<number>; units: number }>();
  for (const doc of snapshot.docs) {
    const order = doc.data() as SaleOrder;
    if (!countsAsConsumption(order)) continue;
    for (const item of order.itens ?? []) {
      if (!item.codigo || !Number.isFinite(item.quantidade) || item.quantidade <= 0) continue;
      const bucket = buckets.get(item.codigo) ?? { description: item.descricao, orders: new Set<number>(), units: 0 };
      bucket.orders.add(order.id);
      bucket.units += item.quantidade;
      buckets.set(item.codigo, bucket);
    }
  }

  const oldest = closedWeeksSince(null, now)[0] ?? week;
  const batch = adminDb.batch();
  for (const [sku, bucket] of buckets) {
    const ref = adminDb.collection(WEEKLY_DEMAND).doc(sku);
    batch.set(ref, {
      sku, description: bucket.description,
      weeks: { [week]: { units: bucket.units, orders: bucket.orders.size } satisfies WeekBucket },
      lastClosedWeek: week, updatedAt: now.toISOString(),
    }, { merge: true });
  }
  await batch.commit();
  await pruneBefore(oldest);
  // Local: a instância que acabou de escrever não pode continuar servindo a cópia antiga. As demais
  // convergem pelo TTL, que é o suficiente para um valor semanal.
  resetWeeklyHistoryCache();
  return { week, skus: buckets.size };
}

/** Remove buckets anteriores à janela de retenção. Fora dela o dado não é lido por ninguém. */
async function pruneBefore(oldest: string) {
  const snapshot = await adminDb.collection(WEEKLY_DEMAND).get();
  const batch = adminDb.batch();
  let pending = 0;
  for (const doc of snapshot.docs) {
    const weeks = (doc.data().weeks ?? {}) as Record<string, WeekBucket>;
    const stale = Object.keys(weeks).filter(key => key < oldest);
    if (!stale.length) continue;
    batch.update(doc.ref, Object.fromEntries(stale.map(key => [`weeks.${key}`, FieldValue.delete()])));
    pending++;
  }
  if (pending) await batch.commit();
}

/**
 * Fecha todas as semanas pendentes desde o checkpoint, sem tocar na semana corrente.
 *
 * Processar a lista inteira, e não apenas a semana anterior, é o que faz uma execução perdida se
 * auto-corrigir na seguinte sem intervenção.
 */
export async function rollUpPendingWeeks(now: Date = new Date()) {
  const last = (await checkpointRef().get()).data()?.lastClosedWeek;
  const weeks = closedWeeksSince(typeof last === 'string' ? last : null, now);
  let skus = 0;
  for (const week of weeks) skus += (await rollUpWeek(week, now)).skus;
  if (weeks.length) {
    await checkpointRef().set({ lastClosedWeek: weeks.at(-1), updatedAt: now.toISOString() }, { merge: true });
  }
  return { weeks, skus };
}

/**
 * Cache do rollup, por instância e por tempo.
 *
 * O rollup muda uma vez por semana, mas a tela consulta a cada 10 segundos: sem cache seriam 79
 * leituras por ciclo, por aba aberta, de um valor que não mudou.
 *
 * Sem o marcador compartilhado que o cache do Bling usa, e de propósito: lá um refresh manual do
 * operador precisa aparecer na hora, aqui a única escrita é um cron semanal. Alguns minutos de atraso
 * num número que muda toda segunda-feira não têm consequência, e um marcador custaria uma leitura por
 * consulta para evitar um problema que não existe.
 */
const CACHE_TTL_MS = 600_000;
let cached: { at: number; series: Map<string, HistoryPoint[]> } | null = null;

/** Para os testes e para o rollup, que não pode ler a cópia que acabou de tornar obsoleta. */
export function resetWeeklyHistoryCache() { cached = null; }

/** Série das `weeks` semanas fechadas mais recentes, por SKU, em ordem cronológica. */
export async function readWeeklyHistory(weeks: number): Promise<Map<string, HistoryPoint[]>> {
  if (!cached || Date.now() - cached.at > CACHE_TTL_MS) {
    const snapshot = await adminDb.collection(WEEKLY_DEMAND).get();
    const series = new Map<string, HistoryPoint[]>();
    for (const doc of snapshot.docs) {
      const stored = (doc.data().weeks ?? {}) as Record<string, WeekBucket>;
      // A chave ISO ordena lexicograficamente igual à ordem cronológica, dentro e entre anos.
      const points = Object.keys(stored).sort()
        .map(week => ({ week, units: stored[week].units, orders: stored[week].orders }));
      if (points.length) series.set(doc.id, points);
    }
    // Guarda a série inteira e recorta por chamada, para que janelas diferentes dividam um cache só.
    cached = { at: Date.now(), series };
  }
  return new Map([...cached.series].map(([sku, points]) => [sku, points.slice(-weeks)]));
}
