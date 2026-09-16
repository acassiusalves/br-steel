import 'server-only';
import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { documentIdSchema } from '@/server/operations/common';
import type { SaleOrder } from '@/types/sale-order';
import { closedWeeksSince, isoWeekRange } from '@/lib/iso-week';
import { countsAsConsumption } from './demand-eligibility';
import { salesReadRepository } from './sales';
import type { HistoryPoint } from './production-demand-contract';

export const WEEKLY_DEMAND = 'skuWeeklyDemand';
export const ROLLUP_CHECKPOINT = 'skuWeeklyDemandRollup';

export type WeekBucket = { units: number; orders: number };

const checkpointRef = () => adminDb.collection('appConfig').doc(ROLLUP_CHECKPOINT);

/** Firestore recusa um id que case com `__.*__`, o que `documentIdSchema` não cobre. */
const RESERVED_DOC_ID = /^__.*__$/;

/**
 * Id de documento para um SKU, ou `null` quando o SKU não serve de identificador.
 *
 * O SKU vem do pedido, não de um cadastro nosso: `CHAPA/10` é dado real aqui — tests/mcp/audit.test.ts
 * tem um caso de regressão dedicado a ele — e `collection.doc('CHAPA/10')` estoura antes de qualquer
 * escrita, derrubando o lote inteiro. A convenção que `stockUpdates` já estabeleceu é a que vale:
 * o id do documento pode ser uma versão saneada e o SKU verdadeiro mora no campo `sku`, que é por onde
 * a leitura passa (`normalizeStoredStockObservation` lê `String(data.sku || id)`, nunca o id sozinho).
 *
 * Quando o próprio SKU já serve de id, ele continua sendo o id: nenhum documento existente troca de
 * chave e a coleção segue legível no console. Só o SKU que não serve ganha um id derivado, com sufixo
 * de hash do SKU original — `CHAPA/10` e `CHAPA_10` são dois produtos e não podem cair no mesmo
 * documento, que é o que uma substituição simples de `/` por `_` faria.
 */
function weeklyDemandDocId(sku: unknown): string | null {
  if (typeof sku !== 'string' || !sku) return null;
  if (documentIdSchema.safeParse(sku).success && !RESERVED_DOC_ID.test(sku)) return sku;
  // O sufixo garante unicidade; o prefixo legível é só para quem for olhar a coleção. O corte em 180
  // deixa o resultado dentro do teto de 200 de `documentIdSchema` com folga para o sufixo.
  const id = `${sku.replace(/\//g, '_').slice(0, 180)}~${createHash('sha256').update(sku).digest('hex').slice(0, 12)}`;
  return documentIdSchema.safeParse(id).success && !RESERVED_DOC_ID.test(id) ? id : null;
}

/** SKU verdadeiro de um documento do rollup, no mesmo padrão de `normalizeStoredStockObservation`. */
const storedSku = (doc: FirebaseFirestore.QueryDocumentSnapshot): string => String(doc.data().sku || doc.id);

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
  // Pelo repositório, nunca por `adminDb.collection('salesOrders')` direto. A consulta direta ignora
  // `operationalSource`: depois de um corte para PostgreSQL ela continuaria somando a partir de uma
  // coleção que parou de crescer, devolvendo demanda cada vez mais defasada sem sinalizar nada. Uma
  // fonte indisponível tem de falhar alto; número errado em silêncio é pior que falha.
  const orders = await salesReadRepository.readOrdersForPeriod({ from, to });

  const buckets = new Map<string, { description: string; orders: Set<number>; units: number }>();
  for (const order of orders) {
    if (!countsAsConsumption(order)) continue;
    for (const item of order.itens ?? []) {
      if (!item.codigo || !Number.isFinite(item.quantidade) || item.quantidade <= 0) continue;
      // `descricao` é obrigatório no tipo e ausente na fonte: o repositório devolve `SaleOrder`
      // sem verificar nada, e o próprio leitor Postgres carrega uma coluna `description_present`
      // (postgres-production-demand.ts:13) porque o item sem descrição existe de verdade. Sem esta
      // coerção o `undefined` chega ao batch e derruba o lote inteiro, não só este SKU.
      const description = typeof item.descricao === 'string' ? item.descricao : '';
      const bucket = buckets.get(item.codigo) ?? { description, orders: new Set<number>(), units: 0 };
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

  // Resolver os ids antes de abrir qualquer batch: um SKU que não vira id é descartado com aviso, e
  // não leva junto os até 450 SKUs saudáveis do mesmo commit. Uma semana inteira não pode ficar presa
  // por causa de um item — o checkpoint nunca avançaria e toda segunda-feira repetiria a mesma falha.
  const entries: Array<{ id: string; sku: string; bucket: { description: string; units: number; orders: Set<number> } }> = [];
  for (const [sku, bucket] of buckets) {
    const id = weeklyDemandDocId(sku);
    if (!id) {
      console.warn('[SKU-ROLLUP] SKU sem id de documento utilizável; ignorado nesta semana.', { week, sku });
      continue;
    }
    entries.push({ id, sku, bucket });
  }

  await commitInChunks(entries, (batch, { id, sku, bucket }) => {
    const ref = adminDb.collection(WEEKLY_DEMAND).doc(id);
    batch.set(ref, {
      sku,
      // Sem descrição não se grava campo nenhum: a escrita é `merge`, então omitir preserva a
      // descrição que já estava lá, enquanto gravar `''` a apagaria.
      ...(bucket.description ? { description: bucket.description } : {}),
      weeks: { [week]: { units: bucket.units, orders: bucket.orders.size } satisfies WeekBucket },
      lastClosedWeek: week, updatedAt: now.toISOString(),
    }, { merge: true });
  });
  await closeWeek(week, oldest, new Set(entries.map(entry => entry.sku)));
  // Local: a instância que acabou de escrever não pode continuar servindo a cópia antiga. As demais
  // convergem pelo TTL, que é o suficiente para um valor semanal.
  resetWeeklyHistoryCache();
  return { week, skus: entries.length };
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
    // `freshSkus` traz SKUs verdadeiros; o id do documento pode ser uma versão saneada deles.
    const sku = storedSku(doc);
    const stale = keys.filter(key => key < oldest || (key === week && !freshSkus.has(sku)));
    if (!stale.length) continue;
    changes.push({ ref: doc.ref, stale, remaining: keys.length - stale.length });
  }
  await commitInChunks(changes, (batch, { ref, stale, remaining }) => {
    if (remaining === 0) batch.delete(ref);
    else batch.update(ref, Object.fromEntries(stale.map(key => [`weeks.${key}`, FieldValue.delete()])));
  });
}

/**
 * Orçamento de tempo de uma execução, abaixo do teto de 300s declarado em `maxDuration` na rota do
 * cron. Sem checkpoint, `closedWeeksSince(null, now)` devolve as 104 semanas da janela inteira: é o
 * cold start, que o plano manda fazer pelo script de backfill justamente porque um passe único
 * arrisca o teto. O cron não tinha nada que o impedisse de tentar assim mesmo — e ser morto no meio
 * é pior que parar: nada indica o que faltou.
 */
const ROLLUP_BUDGET_MS = 240_000;

/**
 * Fecha as semanas pendentes desde o checkpoint, sem tocar na semana corrente.
 *
 * Processar a lista inteira, e não apenas a semana anterior, é o que faz uma execução perdida se
 * auto-corrigir na seguinte sem intervenção.
 *
 * O checkpoint avança **dentro** do laço, a cada semana fechada, como o backfill em
 * `scripts/backfill-sku-weekly-demand.ts:39` já faz. Com a gravação só no fim, um encerramento no
 * meio — teto de tempo, deploy, falha de rede — descartava todo o progresso e a execução seguinte
 * recomeçava do zero: uma lacuna grande demais para um passe nunca fecharia, por mais vezes que o
 * cron rodasse. A semana fechada já está escrita e é idempotente; o checkpoint apenas registra isso.
 *
 * Ao esgotar o orçamento a execução para limpa e devolve `remaining`, em vez de seguir até ser morta.
 * A primeira semana roda sempre, custe o que custar, para que toda execução avance pelo menos uma.
 */
export async function rollUpPendingWeeks(now: Date = new Date(), budgetMs: number = ROLLUP_BUDGET_MS) {
  const startedAt = Date.now();
  const last = (await checkpointRef().get()).data()?.lastClosedWeek;
  const pending = closedWeeksSince(typeof last === 'string' ? last : null, now);
  const weeks: string[] = [];
  let skus = 0;
  for (const week of pending) {
    if (weeks.length && Date.now() - startedAt >= budgetMs) break;
    skus += (await rollUpWeek(week, now)).skus;
    await checkpointRef().set({ lastClosedWeek: week, updatedAt: now.toISOString() }, { merge: true });
    weeks.push(week);
  }
  return { weeks, skus, remaining: pending.length - weeks.length };
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
      // Chaveado pelo SKU verdadeiro, não pelo id: quem consulta conhece `CHAPA/10`, não o id saneado.
      if (points.length) series.set(storedSku(doc), points);
    }
    // Guarda a série inteira e recorta por chamada, para que janelas diferentes dividam um cache só.
    cached = { at: Date.now(), series };
  }
  // `Array.prototype.slice(-0)` é `slice(0)` — a série inteira, não vazia. Pedir zero semanas tem
  // que devolver vazio, não virar sinônimo de "sem limite".
  return new Map([...cached.series].map(([sku, points]) => [sku, weeks > 0 ? points.slice(-weeks) : []]));
}
