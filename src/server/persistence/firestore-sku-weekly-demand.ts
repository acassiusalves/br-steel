import 'server-only';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import type { SaleOrder } from '@/types/sale-order';
import { closedWeeksSince, isoWeekRange } from '@/lib/iso-week';
import { countsAsConsumption } from './demand-eligibility';
import type { HistoryPoint } from './production-demand-contract';

export const WEEKLY_DEMAND = 'skuWeeklyDemand';
export const ROLLUP_CHECKPOINT = 'skuWeeklyDemandRollup';

export type WeekBucket = { units: number; orders: number };

const checkpointRef = () => adminDb.collection('appConfig').doc(ROLLUP_CHECKPOINT);

/**
 * Firestore recusa um batch com mais de 500 operações. O teto aqui fica com folga abaixo disso: tanto
 * o batch de escrita (um SKU vendido na semana por operação) quanto o de fechamento (um documento da
 * coleção inteira por operação) crescem com o catálogo, sem limite superior conhecido no código — e o
 * emulador local não recusa um batch grande demais, só a produção recusaria.
 */
const BATCH_CHUNK_SIZE = 450;

/** Aplica `apply` a cada item de `items` em lotes de até `BATCH_CHUNK_SIZE`, um commit por lote. */
async function commitInChunks<T>(
  items: readonly T[],
  apply: (batch: FirebaseFirestore.WriteBatch, item: T) => void,
): Promise<void> {
  for (let start = 0; start < items.length; start += BATCH_CHUNK_SIZE) {
    const batch = adminDb.batch();
    for (const item of items.slice(start, start + BATCH_CHUNK_SIZE)) apply(batch, item);
    await batch.commit();
  }
}

/**
 * Fecha uma semana: lê os pedidos daquele intervalo e grava um bucket por SKU.
 *
 * A escrita é por mapa aninhado com merge, então reprocessar com o mesmo resultado é no-op — e crons
 * repetem. Mas o fechamento é autoritativo, não apenas aditivo: `closeWeek` varre a coleção inteira
 * depois da escrita e remove `weeks.{week}` de qualquer SKU que tinha um bucket de uma execução
 * anterior mas não está mais em `buckets` agora — pedidos cancelados ou editados depois do último
 * rollup não podem deixar demanda fantasma parada até a retenção de 104 semanas expirar. A mesma
 * passagem também descarta semanas fora da janela de retenção, evitando um segundo percurso pela
 * coleção só para isso.
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

  // closedWeeksSince(null, now) cobre a janela de retenção inteira (HISTORY_WEEKS é uma constante
  // positiva), então sempre devolve ao menos um elemento — ao contrário de um `?? week` aqui, que se
  // algum dia disparasse faria a poda tratar a própria semana que acabou de fechar como a borda da
  // retenção, descartando quase todo o histórico guardado.
  const oldest = closedWeeksSince(null, now)[0];

  await commitInChunks([...buckets], (batch, [sku, bucket]) => {
    const ref = adminDb.collection(WEEKLY_DEMAND).doc(sku);
    batch.set(ref, {
      sku, description: bucket.description,
      weeks: { [week]: { units: bucket.units, orders: bucket.orders.size } satisfies WeekBucket },
      lastClosedWeek: week, updatedAt: now.toISOString(),
    }, { merge: true });
  });
  await closeWeek(week, oldest, new Set(buckets.keys()));
  // Local: a instância que acabou de escrever não pode continuar servindo a cópia antiga. As demais
  // convergem pelo TTL, que é o suficiente para um valor semanal.
  resetWeeklyHistoryCache();
  return { week, skus: buckets.size };
}

/**
 * Único percurso pela coleção inteira, cobrindo dois motivos para uma entrada de semana sair do
 * documento de um SKU:
 *  - está fora da janela de retenção (`key < oldest`), como antes;
 *  - é a semana que acabou de fechar, mas este SKU não está em `freshSkus` — a consulta que acabou de
 *    rodar não confirmou nenhuma demanda qualificada para ele, então um bucket de uma execução
 *    anterior ficou desatualizado (pedido cancelado ou editado) e precisa sumir, não ficar parado.
 *
 * Um SKU cujo mapa `weeks` fica vazio depois da remoção é apagado por inteiro: sem isso a coleção só
 * cresce, com documentos-tumba de `weeks: {}` que nunca mais aparecem em `readWeeklyHistory` mas
 * continuam sendo lidos por toda consulta futura à coleção.
 */
async function closeWeek(week: string, oldest: string, freshSkus: ReadonlySet<string>): Promise<void> {
  const snapshot = await adminDb.collection(WEEKLY_DEMAND).get();
  const changes: Array<{ ref: FirebaseFirestore.DocumentReference; stale: string[]; remaining: number }> = [];
  for (const doc of snapshot.docs) {
    const weeks = (doc.data().weeks ?? {}) as Record<string, WeekBucket>;
    const keys = Object.keys(weeks);
    const stale = keys.filter(key => key < oldest || (key === week && !freshSkus.has(doc.id)));
    if (!stale.length) continue;
    changes.push({ ref: doc.ref, stale, remaining: keys.length - stale.length });
  }
  await commitInChunks(changes, (batch, { ref, stale, remaining }) => {
    if (remaining === 0) batch.delete(ref);
    else batch.update(ref, Object.fromEntries(stale.map(key => [`weeks.${key}`, FieldValue.delete()])));
  });
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
  // `Array.prototype.slice(-0)` é `slice(0)` — a série inteira, não vazia. Pedir zero semanas tem
  // que devolver vazio, não virar sinônimo de "sem limite".
  return new Map([...cached.series].map(([sku, points]) => [sku, weeks > 0 ? points.slice(-weeks) : []]));
}
