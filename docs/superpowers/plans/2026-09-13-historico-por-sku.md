# Histórico por SKU — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar a cada SKU da Análise para Produção uma série semanal de demanda visível na própria linha da tabela, e parar de destruir o histórico de saldo de estoque a cada webhook do Bling.

**Architecture:** A demanda semanal é pré-computada num rollup por SKU (`skuWeeklyDemand`), fechado por um Vercel Cron e reconstruído retroativamente por um script pontual; a semana corrente sai do loop de agregação que já roda. A captura de estoque passa a escrever num log append-only (`stockObservations`) sem alterar a projeção "último valor" que todo o resto consome. Ambas as séries nascem alcançáveis pelo MCP.

**Tech Stack:** Next.js 15 App Router, TypeScript estrito, Firestore (Admin SDK), Vercel Cron, vitest contra emulador do Firestore, SVG inline para o sparkline, `recharts` (já no projeto) para o detalhe.

**Spec:** `docs/superpowers/specs/2026-09-13-historico-por-sku-design.md`

## Global Constraints

- TypeScript estrito, exports nomeados; `default` só em pages.
- Todo arquivo sob `src/server/` começa com `import 'server-only';`.
- Fuso dos buckets: `America/Sao_Paulo`, fixo no código. É regra de negócio (o turno da fábrica), não preferência de quem olha a tela.
- Semana ISO de segunda a domingo. Chave `YYYY-Www`. **2026 tem 53 semanas ISO** — a virada de ano não pode assumir 52.
- Janela de retenção: 104 semanas no rollup, 24 meses de TTL no log de observações.
- Crons que gravam: `CRON_SECRET` + `Authorization: Bearer`; 503 sem segredo configurado, 401 com segredo errado. Padrão de `src/app/api/cron/bling-webhook-drain/route.ts`.
- `stockUpdates/{sku}` **nunca muda de forma**. É a projeção "último valor" que `readStoredStockSnapshot`, `readStockSnapshot`, a projeção Postgres e as ferramentas MCP consomem.
- Testes com emulador rodam assim:
  `firebase emulators:exec --only firestore --project demo-brsteel-auth --config firebase.test.json 'npx --no-install vitest run <caminho>'`
- Antes de cada commit: `npx tsc --noEmit` não pode introduzir diagnóstico novo (a baseline atual é de 25, verificada por `npm run typecheck:ci`).
- **Tasks 6, 9 e 10 não têm teste automatizado, por decisão de escopo tomada antes da execução.** A
  infra de testes é server-side (`vitest.config`: `environment: 'node'`, `include: ['tests/**/*.test.ts']`,
  sem jsdom e sem `.tsx`), e adicioná-la seria dependência nova fora do escopo. Essas três são
  verificadas no navegador, conforme os passos de cada uma. Não é omissão.

## File Structure

**Criar**

| Arquivo | Responsabilidade |
| --- | --- |
| `src/lib/iso-week.ts` | Aritmética de semana ISO no fuso da fábrica. Puro, sem I/O, importável do cliente. |
| `src/server/persistence/demand-eligibility.ts` | Predicado único: um pedido conta como consumo? |
| `src/server/persistence/firestore-sku-weekly-demand.ts` | Escrita do rollup e leitura da série. |
| `src/server/operations/sku-history.ts` | Operação autorizada de leitura do histórico. |
| `src/app/api/cron/sku-weekly-rollup/route.ts` | Cron semanal. |
| `scripts/backfill-sku-weekly-demand.ts` | Backfill retroativo, retomável. |
| `src/components/producao/DemandSparkline.tsx` | Sparkline SVG da linha da tabela. |
| `src/components/producao/SkuHistorySheet.tsx` | Painel de detalhe com 52 semanas. |

**Modificar**

| Arquivo | Mudança |
| --- | --- |
| `src/server/persistence/firestore-sales-ingest.ts:38-41` | `applyStockObservation` passa a gravar o log. |
| `src/server/persistence/firestore-production-demand.ts:16-18` | Usa o predicado compartilhado; anexa `history`. |
| `src/server/persistence/production-demand-contract.ts:3` | Campo `history` no contrato. |
| `src/server/persistence/postgres-production-demand.ts:20` | Mesmo predicado, em SQL. |
| `src/app/producao/ProducaoClient.tsx` | Coluna "Tendência". |
| `src/server/mcp/read-tools.ts` | Ferramenta `consultar_historico_sku`. |
| `firestore.indexes.json` | Índice `(sku, observedAt)` e TTL em `expiresAt`. |
| `vercel.json` | Entrada do cron. |

---

### Task 1: Aritmética de semana ISO no fuso da fábrica

Fundação das tarefas 3 a 9. Puro, sem I/O, sem emulador.

**Files:**
- Create: `src/lib/iso-week.ts`
- Test: `tests/operations/iso-week.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `saoPauloDay(instant: Date | string | number): string` — dia civil `YYYY-MM-DD`
  - `isoWeekKey(day: string): string` — `YYYY-Www` de um dia civil
  - `isoWeekOf(instant: Date | string | number): string`
  - `isoWeekRange(week: string): { from: string; to: string }` — segunda e domingo civis
  - `nextWeek(week: string): string`
  - `closedWeeksSince(after: string | null, now?: Date): string[]`

- [ ] **Step 1: Write the failing test**

`tests/operations/iso-week.test.ts`:

```ts
import { expect, it } from 'vitest';
import { closedWeeksSince, isoWeekKey, isoWeekOf, isoWeekRange, nextWeek, previousWeek, saoPauloDay } from '@/lib/iso-week';

it('resolves the civil day in the factory timezone, not UTC', () => {
  // São Paulo é UTC-3 o ano inteiro desde 2019. 03:00Z é a virada do dia civil.
  expect(saoPauloDay('2026-09-14T02:59:00Z')).toBe('2026-09-13');
  expect(saoPauloDay('2026-09-14T03:00:00Z')).toBe('2026-09-14');
});

it('puts a Sunday-night order in the week that is closing, not the one starting', () => {
  // O caso que motiva o fuso: 02:59Z de segunda ainda é domingo na fábrica.
  expect(isoWeekOf('2026-09-14T02:59:00Z')).toBe('2026-W37');
  expect(isoWeekOf('2026-09-14T03:00:00Z')).toBe('2026-W38');
});

it('keys weeks from Monday to Sunday', () => {
  expect(isoWeekKey('2026-09-07')).toBe('2026-W37'); // segunda
  expect(isoWeekKey('2026-09-13')).toBe('2026-W37'); // domingo
  expect(isoWeekKey('2026-09-14')).toBe('2026-W38'); // segunda seguinte
  expect(isoWeekRange('2026-W37')).toEqual({ from: '2026-09-07', to: '2026-09-13' });
});

it('handles the ISO year boundary, where the week can belong to the other year', () => {
  expect(isoWeekKey('2026-01-01')).toBe('2026-W01');
  expect(isoWeekRange('2026-W01')).toEqual({ from: '2025-12-29', to: '2026-01-04' });
  // 2026 tem 53 semanas ISO: assumir 52 quebraria a virada.
  expect(isoWeekKey('2026-12-31')).toBe('2026-W53');
  expect(nextWeek('2026-W53')).toBe('2027-W01');
  expect(nextWeek('2026-W37')).toBe('2026-W38');
  // A volta precisa saber que 2026 terminou em W53, e não em W52.
  expect(previousWeek('2027-W01')).toBe('2026-W53');
  expect(previousWeek('2026-W38')).toBe('2026-W37');
});

it('lists the closed weeks after a checkpoint, never including the current one', () => {
  const now = new Date('2026-09-16T12:00:00Z'); // quarta da semana W38
  expect(closedWeeksSince('2026-W35', now)).toEqual(['2026-W36', '2026-W37']);
  expect(closedWeeksSince('2026-W37', now)).toEqual([]);
});

it('rejects an unparseable instant instead of silently bucketing it', () => {
  expect(() => saoPauloDay('não é data')).toThrow();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/operations/iso-week.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/iso-week"`.

- [ ] **Step 3: Write the implementation**

`src/lib/iso-week.ts`:

```ts
/**
 * Semanas ISO no fuso da fábrica.
 *
 * Os buckets do histórico por SKU são semanas civis de America/Sao_Paulo, não de UTC: um pedido às
 * 02:00Z de segunda ainda é domingo em São Paulo e pertence à semana que fechou. O fuso é fixo aqui
 * porque é regra de negócio — o turno da fábrica — e não preferência de quem está olhando a tela.
 *
 * Sem dependência de fuso: `Intl` resolve o dia civil e o resto é aritmética de calendário sobre a
 * data já resolvida. É o mesmo padrão de src/server/persistence/supplies-read-projection.ts:4.
 */
const SAO_PAULO = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
});

const DAY_MS = 86_400_000;

/** Dia civil de São Paulo (`YYYY-MM-DD`) para um instante qualquer. */
export function saoPauloDay(instant: Date | string | number): string {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (!Number.isFinite(date.valueOf())) throw new Error('Instante inválido para bucket semanal.');
  return SAO_PAULO.format(date);
}

/** Segunda-feira da semana ISO que contém o dia civil, em UTC puro. */
function isoMonday(day: string): Date {
  const [year, month, date] = day.split('-').map(Number);
  const utc = new Date(Date.UTC(year, month - 1, date));
  utc.setUTCDate(utc.getUTCDate() - ((utc.getUTCDay() + 6) % 7));
  return utc;
}

/** Chave ISO (`YYYY-Www`) da semana que contém o dia civil informado. */
export function isoWeekKey(day: string): string {
  // A quinta-feira decide o ano ISO da semana: é a definição da norma.
  const thursday = new Date(isoMonday(day).valueOf() + 3 * DAY_MS);
  const firstThursday = new Date(isoMonday(`${thursday.getUTCFullYear()}-01-04`).valueOf() + 3 * DAY_MS);
  const week = 1 + Math.round((thursday.valueOf() - firstThursday.valueOf()) / (7 * DAY_MS));
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Chave da semana que contém o instante, no fuso da fábrica. */
export const isoWeekOf = (instant: Date | string | number): string => isoWeekKey(saoPauloDay(instant));

/** Dias civis de início e fim da semana, no formato que `salesOrders.data` usa. */
export function isoWeekRange(week: string): { from: string; to: string } {
  const [year, number] = week.split('-W').map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(number)) throw new Error('Semana ISO inválida.');
  const monday = new Date(isoMonday(`${year}-01-04`).valueOf() + (number - 1) * 7 * DAY_MS);
  return { from: monday.toISOString().slice(0, 10), to: new Date(monday.valueOf() + 6 * DAY_MS).toISOString().slice(0, 10) };
}

/** Semana seguinte. Atravessa a virada de ano, inclusive quando o ano tem 53 semanas. */
export function nextWeek(week: string): string {
  return shiftWeek(week, 7);
}

/** Semana anterior. Nunca deduza `W52` do ano passado: 2026, por exemplo, tem 53. */
export function previousWeek(week: string): string {
  return shiftWeek(week, -7);
}

/** Desloca a semana por dias inteiros a partir da segunda-feira, deixando a norma decidir o resto. */
function shiftWeek(week: string, days: number): string {
  const monday = Date.parse(`${isoWeekRange(week).from}T00:00:00Z`);
  return isoWeekKey(new Date(monday + days * DAY_MS).toISOString().slice(0, 10));
}

/** Janela máxima mantida no rollup. */
export const HISTORY_WEEKS = 104;

/**
 * Semanas fechadas depois de `after`, em ordem, sem incluir a semana corrente.
 *
 * Sem checkpoint, começa uma janela inteira atrás. O laço tem teto para que uma chave corrompida no
 * checkpoint não gere iteração infinita.
 */
export function closedWeeksSince(after: string | null, now: Date = new Date()): string[] {
  const current = isoWeekOf(now);
  const windowEdge = isoWeekOf(new Date(now.valueOf() - HISTORY_WEEKS * 7 * DAY_MS));
  // Uma lacuna maior que a janela de retenção recomeça na borda dela: semanas anteriores seriam
  // podadas logo depois de escritas, e processá-las adiaria a chegada às que importam.
  let cursor = after ? nextWeek(after) : windowEdge;
  if (cursor < windowEdge) cursor = windowEdge;
  const weeks: string[] = [];
  for (let guard = 0; guard < HISTORY_WEEKS && cursor !== current; guard++) {
    weeks.push(cursor);
    cursor = nextWeek(cursor);
  }
  // Com o recorte acima o laço sempre alcança a semana corrente. Não alcançar significa checkpoint
  // corrompido ou no futuro — falhar alto é melhor que devolver uma lista silenciosamente incompleta.
  if (cursor !== current) {
    throw new Error(`closedWeeksSince: checkpoint corrompido ou no futuro — depois de ${HISTORY_WEEKS} semanas a partir de ${after ?? '(sem checkpoint)'} ainda não alcançou a semana corrente ${current}.`);
  }
  return weeks;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/operations/iso-week.test.ts`
Expected: PASS — 6 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/iso-week.ts tests/operations/iso-week.test.ts
git commit -m "feat(producao): ISO week keys in the factory timezone

Buckets follow the São Paulo civil day, so a Sunday 23:00 order stays in
the week that is closing instead of opening the next one."
```

---

### Task 2: Captura append-only de estoque

Primeira do plano por ser o único relógio irreversível: cada webhook processado sem essa mudança apaga uma leitura para sempre.

**Files:**
- Modify: `src/server/persistence/firestore-sales-ingest.ts:38-41`
- Modify: `src/server/persistence/sales-ingest-contract.ts:8`
- Modify: `firestore.indexes.json`
- Test: `tests/operations/stock-observations.test.ts`

**Interfaces:**
- Consumes: nada da Task 1.
- Produces: coleção `stockObservations` com documentos `{ sku: string; estoqueAtual: number; observedAt: string; event: string; source: 'webhook'; expiresAt: Date }`. Consumida pela Task 10 (futura série de saldo) e por consultas manuais.

- [ ] **Step 1: Write the failing test**

`tests/operations/stock-observations.test.ts`:

```ts
import { beforeEach, expect, it, vi } from 'vitest';
import { seedOperations } from './fixtures';
import { adminDb } from '../helpers/firestore';
import { firestoreSalesIngestRepository } from '@/server/persistence/firestore-sales-ingest';

const observe = (estoqueAtual: number, at: string) =>
  firestoreSalesIngestRepository.applyStockObservation('ZERO', {
    sku: 'ZERO', nome: 'Chapa', estoqueAtual, produtoId: 1, depositos: [],
    webhookReceivedAt: at, lastEvent: 'stock.updated',
  });

const readings = async () =>
  (await adminDb.collection('stockObservations').where('sku', '==', 'ZERO').get())
    .docs.map(doc => doc.data()).sort((a, b) => String(a.observedAt).localeCompare(String(b.observedAt)));

beforeEach(async () => { await seedOperations(); });

it('keeps the latest-value projection byte-for-byte compatible', async () => {
  await observe(42, '2026-09-10T12:00:00.000Z');
  const latest = (await adminDb.collection('stockUpdates').doc('ZERO').get()).data();
  expect(latest).toMatchObject({ sku: 'ZERO', estoqueAtual: 42, webhookReceivedAt: '2026-09-10T12:00:00.000Z' });
});

it('appends one reading per change and keeps the earlier ones', async () => {
  await observe(42, '2026-09-10T12:00:00.000Z');
  await observe(30, '2026-09-11T12:00:00.000Z');
  await observe(0, '2026-09-12T12:00:00.000Z');
  expect((await readings()).map(r => r.estoqueAtual)).toEqual([42, 30, 0]);
  // O último valor continua sendo o último, não o primeiro.
  expect((await adminDb.collection('stockUpdates').doc('ZERO').get()).data()?.estoqueAtual).toBe(0);
});

it('does not log a webhook that repeats the balance already recorded', async () => {
  await observe(42, '2026-09-10T12:00:00.000Z');
  await observe(42, '2026-09-10T13:00:00.000Z');
  expect(await readings()).toHaveLength(1);
});

it('stamps an expiry so the log is bounded by the TTL policy', async () => {
  await observe(42, '2026-09-10T12:00:00.000Z');
  const [reading] = await readings();
  const expires = (reading.expiresAt as { toDate(): Date }).toDate();
  // 24 meses depois da observação, com tolerância de um dia.
  expect(expires.valueOf() - Date.parse('2026-09-10T12:00:00.000Z')).toBeGreaterThan(700 * 86400000);
  expect(reading).toMatchObject({ sku: 'ZERO', observedAt: '2026-09-10T12:00:00.000Z', event: 'stock.updated', source: 'webhook' });
});

it('never loses the balance update when the log write fails', async () => {
  const failing = vi.spyOn(adminDb, 'runTransaction').mockRejectedValueOnce(new Error('log indisponível'));
  await expect(observe(7, '2026-09-13T12:00:00.000Z')).resolves.toBeUndefined();
  expect((await adminDb.collection('stockUpdates').doc('ZERO').get()).data()?.estoqueAtual).toBe(7);
  failing.mockRestore();
});

it('ignores an observation whose balance is not a finite number', async () => {
  await firestoreSalesIngestRepository.applyStockObservation('ZERO', {
    sku: 'ZERO', estoqueAtual: null, webhookReceivedAt: '2026-09-10T12:00:00.000Z', lastEvent: 'stock.updated',
  });
  expect(await readings()).toHaveLength(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `firebase emulators:exec --only firestore --project demo-brsteel-auth --config firebase.test.json 'npx --no-install vitest run tests/operations/stock-observations.test.ts'`
Expected: FAIL — a coleção `stockObservations` fica vazia; o segundo teste falha com `[] toEqual [42, 30, 0]`.

- [ ] **Step 3: Write the implementation**

Em `src/server/persistence/firestore-sales-ingest.ts`, substituir a função `applyStockObservation` (linhas 38-41):

```ts
/** 24 meses, casando com a janela de 104 semanas do rollup de demanda. */
const OBSERVATION_TTL_MS = 730 * 86_400_000;

/**
 * Grava o saldo observado em dois lugares com propósitos diferentes.
 *
 * `stockUpdates/{sku}` continua sendo a projeção "último valor" — é o que readStockSnapshot,
 * readStoredStockSnapshot, a projeção Postgres e o MCP consomem, e seu formato não muda.
 * `stockObservations` é o log append-only, que antes não existia: até aqui cada webhook sobrescrevia
 * a leitura anterior e o histórico de saldo era perdido de forma irrecuperável.
 *
 * Só registra quando o saldo muda. Um webhook que repete o mesmo número não é observação nova, e o
 * Bling reentrega com frequência.
 */
async function applyStockObservation(sku: string, observation: Record<string, unknown>) {
  const id = documentIdSchema.parse(sku);
  const latest = adminDb.collection('stockUpdates').doc(id);
  try {
    await adminDb.runTransaction(async tx => {
      const previous = (await tx.get(latest)).data();
      tx.set(latest, observation, { merge: true });
      const balance = observation.estoqueAtual;
      if (typeof balance !== 'number' || !Number.isFinite(balance)) return;
      if (previous && previous.estoqueAtual === balance) return;
      const observedAt = String(observation.webhookReceivedAt ?? '');
      const at = Date.parse(observedAt);
      if (!Number.isFinite(at)) return;
      tx.create(adminDb.collection('stockObservations').doc(), {
        sku: id, estoqueAtual: balance, observedAt,
        event: String(observation.lastEvent ?? ''), source: 'webhook',
        expiresAt: new Date(at + OBSERVATION_TTL_MS),
      });
    });
  } catch (error) {
    // O log é acessório; o último saldo não é. Uma falha ao registrar a observação não pode impedir
    // a atualização que o webhook já confirmou ao Bling — mesmo princípio de
    // invalidateProductStockCache().catch(() => undefined) em src/app/api/webhook/bling/route.ts.
    console.error('[STOCK-OBSERVATION]', error);
    await latest.set(observation, { merge: true });
  }
}
```

Em `src/server/persistence/sales-ingest-contract.ts`, atualizar o comentário da linha 8:

```ts
  /**
   * Última observação vence por SKU na projeção `stockUpdates`; um saldo físico desconhecido continua
   * nulo, nunca zero. A implementação Firestore também registra cada mudança em `stockObservations`.
   */
  applyStockObservation(sku: string, observation: Record<string, unknown>): Promise<void>;
```

- [ ] **Step 4: Add the index and TTL policy**

Em `firestore.indexes.json`, acrescentar ao array `indexes`:

```json
{
  "collectionGroup": "stockObservations",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "sku", "order": "ASCENDING" },
    { "fieldPath": "observedAt", "order": "ASCENDING" }
  ]
}
```

E ao array `fieldOverrides`, junto das duas políticas de TTL que já existem:

```json
{ "collectionGroup": "stockObservations", "fieldPath": "expiresAt", "ttl": true, "indexes": [] }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `firebase emulators:exec --only firestore --project demo-brsteel-auth --config firebase.test.json 'npx --no-install vitest run tests/operations/stock-observations.test.ts tests/operations/webhook.test.ts tests/operations/stock.test.ts tests/operations/stored-stock-model.test.ts'`
Expected: PASS — os 6 novos passam e as suítes de estoque e webhook seguem verdes, provando que a projeção "último valor" não mudou.

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/server/persistence/firestore-sales-ingest.ts src/server/persistence/sales-ingest-contract.ts firestore.indexes.json tests/operations/stock-observations.test.ts
git commit -m "feat(estoque): keep a stock observation log instead of overwriting

Every Bling webhook used to overwrite stockUpdates/{sku}, so no balance
history existed. The latest-value projection is unchanged; changed
balances now also append to stockObservations under a 24-month TTL."
```

- [ ] **Step 7: Deploy the index before the code reaches production**

Run: `firebase deploy --only firestore:indexes --project marketflow-9h4tg`
Expected: os 12 índices e as 3 políticas de TTL aplicados. O índice precisa existir antes de qualquer consulta por `(sku, observedAt)`.

---

### Task 3: Predicado de elegibilidade compartilhado

Corrige o achado C1. Sem isso o sparkline e a coluna "Qtd. Total Vendida" divergem para o mesmo SKU.

**Files:**
- Create: `src/server/persistence/demand-eligibility.ts`
- Modify: `src/server/persistence/firestore-production-demand.ts:17`
- Modify: `src/server/persistence/postgres-production-demand.ts:20`
- Test: `tests/operations/demand-eligibility.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `countsAsConsumption(order: Pick<SaleOrder, 'notaFiscal' | 'situacao'>): boolean` e a constante `CANCELLED_ORDER_STATUS: ReadonlySet<number>`. Usado pela Task 4.

- [ ] **Step 1: Write the failing test**

`tests/operations/demand-eligibility.test.ts`:

```ts
import { expect, it } from 'vitest';
import { countsAsConsumption } from '@/server/persistence/demand-eligibility';

const order = (over: Record<string, unknown> = {}) =>
  ({ notaFiscal: { id: 500 }, situacao: { id: 9, nome: 'Atendido', valor: 1 }, ...over }) as never;

it('counts an invoiced order that was not cancelled', () => {
  expect(countsAsConsumption(order())).toBe(true);
});

it('does not count an order without an invoice', () => {
  expect(countsAsConsumption(order({ notaFiscal: undefined }))).toBe(false);
  expect(countsAsConsumption(order({ notaFiscal: {} }))).toBe(false);
});

it('does not count a cancelled order even when the invoice was issued', () => {
  // Situação 12 = "Cancelado", verificada nos dados reais de produção.
  expect(countsAsConsumption(order({ situacao: { id: 12, nome: 'Cancelado', valor: 2 } }))).toBe(false);
});

it('counts an order whose status is missing rather than dropping it', () => {
  // Ausência de situação é dado incompleto, não cancelamento. Descartar subestimaria a demanda.
  expect(countsAsConsumption(order({ situacao: undefined }))).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/operations/demand-eligibility.test.ts`
Expected: FAIL — `Failed to resolve import "@/server/persistence/demand-eligibility"`.

- [ ] **Step 3: Write the implementation**

`src/server/persistence/demand-eligibility.ts`:

```ts
import 'server-only';
import type { SaleOrder } from '@/types/sale-order';

/**
 * Situações do Bling que representam pedido cancelado.
 *
 * O id 12 ("Cancelado") foi verificado nos dados reais de produção. Para estender a lista, consulte o
 * mapa de situações que o webhook carrega em src/app/api/webhook/bling/route.ts:163 e acrescente o id
 * junto de um caso de teste — nunca por suposição sobre o significado do número.
 */
export const CANCELLED_ORDER_STATUS: ReadonlySet<number> = new Set([12]);

/**
 * Um pedido conta como consumo de estoque?
 *
 * O mesmo predicado governa a agregação ao vivo e o rollup semanal. Se os dois divergirem, o sparkline
 * e a coluna "Qtd. Total Vendida" mostram números diferentes para o mesmo SKU no mesmo instante.
 *
 * Nota fiscal emitida é o sinal de baixa do estoque, que é a premissa do modelo de reposição. Um
 * cancelamento não é: um pedido cancelado que chegou a ter NF inflaria a média que comanda a produção.
 * Situação ausente é dado incompleto e conta — descartar subestimaria a demanda.
 */
export function countsAsConsumption(order: Pick<SaleOrder, 'notaFiscal' | 'situacao'>): boolean {
  if (!order.notaFiscal?.id) return false;
  const status = order.situacao?.id;
  return !(typeof status === 'number' && CANCELLED_ORDER_STATUS.has(status));
}
```

- [ ] **Step 4: Wire it into the live aggregation**

Em `src/server/persistence/firestore-production-demand.ts`, acrescentar o import e trocar a linha 17:

```ts
import { countsAsConsumption } from './demand-eligibility';
```

```ts
    if (!countsAsConsumption(order)) continue;
```

Em `src/server/persistence/postgres-production-demand.ts`, na cláusula `where` do CTE `valid_items` (linha 20), acrescentar depois do filtro de nota fiscal:

```sql
    and coalesce(o.payload#>'{situacao,id}','null'::jsonb) not in ('12'::jsonb)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `firebase emulators:exec --only firestore --project demo-brsteel-auth --config firebase.test.json 'npx --no-install vitest run tests/operations/demand-eligibility.test.ts tests/operations/production.test.ts tests/operations/sales.test.ts'`
Expected: PASS — 4 novos, e as suítes de produção e vendas seguem verdes.

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/server/persistence/demand-eligibility.ts src/server/persistence/firestore-production-demand.ts src/server/persistence/postgres-production-demand.ts tests/operations/demand-eligibility.test.ts
git commit -m "fix(producao): exclude cancelled orders from demand

The only filter was notaFiscal.id, so a cancelled order that had reached
invoicing counted as real consumption and inflated the average that drives
replenishment. One predicate now governs both repositories."
```

---

### Task 4: Rollup semanal — coleção e escritor

**Files:**
- Create: `src/server/persistence/firestore-sku-weekly-demand.ts`
- Test: `tests/operations/sku-weekly-demand.test.ts`

**Interfaces:**
- Consumes: `isoWeekOf`, `isoWeekRange`, `closedWeeksSince`, `HISTORY_WEEKS` (Task 1); `countsAsConsumption` (Task 3).
- Produces:
  - `type WeekBucket = { units: number; orders: number }`
  - `rollUpWeek(week: string): Promise<{ week: string; skus: number }>`
  - `rollUpPendingWeeks(now?: Date): Promise<{ weeks: string[]; skus: number }>`
  - `readWeeklyHistory(weeks: number): Promise<Map<string, { week: string; units: number; orders: number }[]>>`
  - `WEEKLY_DEMAND = 'skuWeeklyDemand'`, `ROLLUP_CHECKPOINT` (doc id em `appConfig`)

- [ ] **Step 1: Write the failing test**

`tests/operations/sku-weekly-demand.test.ts`:

```ts
import { beforeEach, expect, it } from 'vitest';
import { seedOperations } from './fixtures';
import { adminDb } from '../helpers/firestore';
import { readWeeklyHistory, resetWeeklyHistoryCache, rollUpPendingWeeks, rollUpWeek, WEEKLY_DEMAND } from '@/server/persistence/firestore-sku-weekly-demand';

/** Pedido faturado no dia civil informado, com um item do SKU. */
const order = (id: number, data: string, codigo: string, quantidade: number, over: Record<string, unknown> = {}) =>
  adminDb.collection('salesOrders').doc(String(id)).set({
    id, numero: id, data, total: 100, contato: { id, nome: 'Cliente' },
    notaFiscal: { id: 900 + id }, situacao: { id: 9, nome: 'Atendido', valor: 1 },
    itens: [{ id: id * 10, codigo, descricao: `Peça ${codigo}`, quantidade, valor: 50, unidade: 'UN' }],
    ...over,
  });

const weeksOf = async (sku: string) => (await adminDb.collection(WEEKLY_DEMAND).doc(sku).get()).data()?.weeks ?? {};

// O cache é de processo e sobrevive ao reset do banco: sem isto um teste serviria dado do anterior.
beforeEach(async () => { await seedOperations(); resetWeeklyHistoryCache(); });

it('buckets a Sunday-night order into the week that is closing', async () => {
  // `data` é o dia civil que o Bling já entrega; 2026-09-13 é domingo, último dia de W37.
  await order(101, '2026-09-13', 'CBA600', 4);
  await order(102, '2026-09-14', 'CBA600', 9); // segunda: W38
  await rollUpWeek('2026-W37');
  expect(await weeksOf('CBA600')).toEqual({ '2026-W37': { units: 4, orders: 1 } });
});

it('counts distinct orders and sums quantities across items', async () => {
  await order(103, '2026-09-08', 'CBA600', 3);
  await order(104, '2026-09-09', 'CBA600', 5);
  await rollUpWeek('2026-W37');
  expect(await weeksOf('CBA600')).toEqual({ '2026-W37': { units: 8, orders: 2 } });
});

it('leaves cancelled orders out, matching the live aggregation', async () => {
  await order(105, '2026-09-08', 'CBA600', 3);
  await order(106, '2026-09-09', 'CBA600', 50, { situacao: { id: 12, nome: 'Cancelado', valor: 2 } });
  await rollUpWeek('2026-W37');
  expect(await weeksOf('CBA600')).toEqual({ '2026-W37': { units: 3, orders: 1 } });
});

it('is idempotent: the same week twice produces the same document', async () => {
  await order(107, '2026-09-08', 'CBA600', 3);
  await rollUpWeek('2026-W37');
  const first = await weeksOf('CBA600');
  await rollUpWeek('2026-W37');
  expect(await weeksOf('CBA600')).toEqual(first);
});

it('closes every pending week in one run after a missed schedule', async () => {
  await order(108, '2026-08-25', 'CBA600', 2); // W35
  await order(109, '2026-09-01', 'CBA600', 6); // W36
  await order(110, '2026-09-08', 'CBA600', 4); // W37
  await adminDb.collection('appConfig').doc('skuWeeklyDemandRollup').set({ lastClosedWeek: '2026-W34' });
  const run = await rollUpPendingWeeks(new Date('2026-09-16T12:00:00Z')); // quarta de W38
  expect(run.weeks).toEqual(['2026-W35', '2026-W36', '2026-W37']);
  expect(await weeksOf('CBA600')).toEqual({
    '2026-W35': { units: 2, orders: 1 }, '2026-W36': { units: 6, orders: 1 }, '2026-W37': { units: 4, orders: 1 },
  });
  expect((await adminDb.collection('appConfig').doc('skuWeeklyDemandRollup').get()).data()?.lastClosedWeek).toBe('2026-W37');
});

it('never writes the current week', async () => {
  await order(111, '2026-09-15', 'CBA600', 7); // terça de W38, semana em curso
  const run = await rollUpPendingWeeks(new Date('2026-09-16T12:00:00Z'));
  expect(run.weeks).not.toContain('2026-W38');
  expect(await weeksOf('CBA600')).not.toHaveProperty('2026-W38');
});

it('prunes weeks beyond the retention window', async () => {
  await adminDb.collection(WEEKLY_DEMAND).doc('CBA600').set({
    sku: 'CBA600', weeks: { '2024-W01': { units: 1, orders: 1 }, '2026-W36': { units: 2, orders: 1 } },
  });
  await order(112, '2026-09-08', 'CBA600', 4);
  await rollUpWeek('2026-W37', new Date('2026-09-16T12:00:00Z'));
  const weeks = await weeksOf('CBA600');
  expect(weeks).not.toHaveProperty('2024-W01');
  expect(weeks).toHaveProperty('2026-W36');
  expect(weeks).toHaveProperty('2026-W37');
});

it('reads back the most recent weeks in chronological order', async () => {
  await order(113, '2026-09-01', 'CBA600', 6);
  await order(114, '2026-09-08', 'CBA600', 4);
  await rollUpWeek('2026-W36');
  await rollUpWeek('2026-W37');
  const history = await readWeeklyHistory(2);
  expect(history.get('CBA600')).toEqual([
    { week: '2026-W36', units: 6, orders: 1 },
    { week: '2026-W37', units: 4, orders: 1 },
  ]);
});

it('honours the requested window and does not serve a stale cache after a rollup', async () => {
  await order(115, '2026-09-01', 'CBA600', 6);
  await rollUpWeek('2026-W36');
  expect((await readWeeklyHistory(12)).get('CBA600')).toHaveLength(1);

  // Fechar outra semana precisa aparecer na leitura seguinte, não daqui a dez minutos.
  await order(116, '2026-09-08', 'CBA600', 4);
  await rollUpWeek('2026-W37');
  expect((await readWeeklyHistory(12)).get('CBA600')).toHaveLength(2);
  expect((await readWeeklyHistory(1)).get('CBA600')).toEqual([{ week: '2026-W37', units: 4, orders: 1 }]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `firebase emulators:exec --only firestore --project demo-brsteel-auth --config firebase.test.json 'npx --no-install vitest run tests/operations/sku-weekly-demand.test.ts'`
Expected: FAIL — `Failed to resolve import "@/server/persistence/firestore-sku-weekly-demand"`.

- [ ] **Step 3: Declare the shared point type**

`HistoryPoint` mora no contrato porque a Task 7 o expõe em `ProductionDemand` e a Task 9 o consome do
cliente. Definir aqui e importar evita duas declarações com o mesmo nome divergindo depois.

Em `src/server/persistence/production-demand-contract.ts`, acrescentar antes da interface existente:

```ts
/** Um ponto da série semanal. `open` marca a semana corrente, que é parcial por definição. */
export interface HistoryPoint { week: string; units: number; orders: number; open?: true }
```

- [ ] **Step 4: Write the implementation**

`src/server/persistence/firestore-sku-weekly-demand.ts`:

```ts
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `firebase emulators:exec --only firestore --project demo-brsteel-auth --config firebase.test.json 'npx --no-install vitest run tests/operations/sku-weekly-demand.test.ts'`
Expected: PASS — 9 passed.

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/server/persistence/firestore-sku-weekly-demand.ts src/server/persistence/production-demand-contract.ts tests/operations/sku-weekly-demand.test.ts
git commit -m "feat(producao): weekly demand rollup per SKU

One document per SKU with weeks as a nested map, so reprocessing a week is
a no-op and reading the whole table costs one read per SKU instead of one
per week. Closed weeks only; the current week stays live."
```

---

### Task 5: Cron do rollup

**Files:**
- Create: `src/app/api/cron/sku-weekly-rollup/route.ts`
- Modify: `vercel.json`
- Test: `tests/operations/sku-weekly-rollup-cron.test.ts`

**Interfaces:**
- Consumes: `rollUpPendingWeeks` (Task 4); `readCoreWriteMode` de `@/server/operations/maintenance`.
- Produces: `GET(request: Request): Promise<NextResponse>` em `/api/cron/sku-weekly-rollup`.

- [ ] **Step 1: Write the failing test**

`tests/operations/sku-weekly-rollup-cron.test.ts`:

```ts
import { beforeEach, expect, it, vi } from 'vitest';
import { seedOperations } from './fixtures';
import { adminDb } from '../helpers/firestore';
import { GET as rollup } from '@/app/api/cron/sku-weekly-rollup/route';
import { resetCoreWriteModeCache } from '@/server/operations/maintenance';

const cronSecret = 'local-cron-only-secret';
const call = (auth?: string) =>
  rollup(new Request('http://localhost/api/cron/sku-weekly-rollup', { headers: auth ? { authorization: auth } : {} }));

beforeEach(async () => {
  await seedOperations();
  resetCoreWriteModeCache();
  vi.stubEnv('CRON_SECRET', cronSecret);
  await adminDb.collection('salesOrders').doc('201').set({
    id: 201, numero: 201, data: '2026-09-08', total: 100, contato: { id: 1, nome: 'Cliente' },
    notaFiscal: { id: 901 }, situacao: { id: 9, nome: 'Atendido', valor: 1 },
    itens: [{ id: 2010, codigo: 'CBA600', descricao: 'Cuba', quantidade: 4, valor: 50, unidade: 'UN' }],
  });
});

it('refuses an unauthenticated or unconfigured run before touching the rollup', async () => {
  expect((await call()).status).toBe(401);
  expect((await call('Bearer errado')).status).toBe(401);
  vi.stubEnv('CRON_SECRET', '');
  expect((await call('Bearer ' + cronSecret)).status).toBe(503);
  expect((await adminDb.collection('skuWeeklyDemand').get()).empty).toBe(true);
});

it('closes the pending weeks and reports them', async () => {
  await adminDb.collection('appConfig').doc('skuWeeklyDemandRollup').set({ lastClosedWeek: '2026-W36' });
  const response = await call('Bearer ' + cronSecret);
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.ok).toBe(true);
  expect(body.weeks).toContain('2026-W37');
  expect((await adminDb.collection('skuWeeklyDemand').doc('CBA600').get()).data()?.weeks)
    .toHaveProperty('2026-W37');
});

it('writes nothing while the core is blocked', async () => {
  await adminDb.collection('appConfig').doc('coreWriteMode').set({ mode: 'blocked' });
  resetCoreWriteModeCache();
  expect(await (await call('Bearer ' + cronSecret)).json()).toMatchObject({ ok: true, suspended: true, weeks: [] });
  expect((await adminDb.collection('skuWeeklyDemand').get()).empty).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `firebase emulators:exec --only firestore --project demo-brsteel-auth --config firebase.test.json 'npx --no-install vitest run tests/operations/sku-weekly-rollup-cron.test.ts'`
Expected: FAIL — `Failed to resolve import "@/app/api/cron/sku-weekly-rollup/route"`.

- [ ] **Step 3: Write the implementation**

`src/app/api/cron/sku-weekly-rollup/route.ts`:

```ts
/**
 * GET /api/cron/sku-weekly-rollup
 *
 * Fecha as semanas de demanda por SKU que ainda não foram consolidadas. Roda semanalmente, mas
 * processa tudo que estiver pendente desde o checkpoint: uma execução perdida se corrige sozinha na
 * seguinte, sem intervenção.
 *
 * Durante a janela de manutenção do corte de fonte o rollup fica suspenso e as semanas acumulam,
 * pelo mesmo motivo que o dreno de webhooks: nada de gravação de negócio com o núcleo bloqueado.
 */
import { NextResponse } from 'next/server';
import { rollUpPendingWeeks } from '@/server/persistence/firestore-sku-weekly-demand';
import { readCoreWriteMode } from '@/server/operations/maintenance';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  // Fecha fechado, como o bling-webhook-drain: este cron aplica gravações de negócio.
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: 'Cron não configurado.' }, { status: 503 });
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  try {
    if (await readCoreWriteMode() !== 'open') {
      return NextResponse.json({ ok: true, suspended: true, weeks: [], skus: 0 });
    }
    const { weeks, skus } = await rollUpPendingWeeks();
    return NextResponse.json({ ok: true, suspended: false, weeks, skus });
  } catch (error) {
    // Nunca devolver a mensagem crua do driver: pode carregar payload ou credencial.
    console.error('[CRON-SKU-ROLLUP]', error);
    return NextResponse.json({ ok: false, error: 'Falha ao consolidar as semanas.' }, { status: 500 });
  }
}
```

Em `vercel.json`, acrescentar ao array `crons`:

```json
{ "path": "/api/cron/sku-weekly-rollup", "schedule": "15 3 * * 1" }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `firebase emulators:exec --only firestore --project demo-brsteel-auth --config firebase.test.json 'npx --no-install vitest run tests/operations/sku-weekly-rollup-cron.test.ts'`
Expected: PASS — 3 passed.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/app/api/cron/sku-weekly-rollup/route.ts vercel.json tests/operations/sku-weekly-rollup-cron.test.ts
git commit -m "feat(producao): weekly cron closing the SKU demand rollup

Processes every week pending since the checkpoint, not just the previous
one, so a missed run heals itself. Suspended while the core is blocked."
```

---

### Task 6: Script de backfill

Deliberadamente fora do cron: reconstruir 12.521 pedidos num passe único arrisca o teto de 300s da função, e o job não precisa viver no deploy.

**Files:**
- Create: `scripts/backfill-sku-weekly-demand.ts`

**Interfaces:**
- Consumes: `rollUpWeek` (Task 4); `closedWeeksSince`, `nextWeek` (Task 1).
- Produces: executável via `npx tsx`. Sem consumidor de código.

- [ ] **Step 1: Write the script**

`scripts/backfill-sku-weekly-demand.ts`:

```ts
/**
 * Reconstrói o rollup semanal de demanda a partir dos pedidos já salvos.
 *
 * Roda uma vez, localmente, com as credenciais de administrador do ambiente. Não é cron por decisão:
 * o histórico completo passa de 12 mil pedidos, e um passe único encostaria no teto de 300s da função.
 *
 *   npx tsx scripts/backfill-sku-weekly-demand.ts            # janela padrão (104 semanas)
 *   npx tsx scripts/backfill-sku-weekly-demand.ts 2025-W01   # a partir de uma semana específica
 *
 * Retomável: o checkpoint avança semana a semana, então uma interrupção continua de onde parou.
 */
import { adminDb } from '../src/lib/firebase-admin';
import { closedWeeksSince, previousWeek } from '../src/lib/iso-week';
import { ROLLUP_CHECKPOINT, rollUpWeek } from '../src/server/persistence/firestore-sku-weekly-demand';

async function main() {
  const requested = process.argv[2];
  const checkpoint = adminDb.collection('appConfig').doc(ROLLUP_CHECKPOINT);
  const stored = (await checkpoint.get()).data()?.lastClosedWeek;
  // `closedWeeksSince` é exclusivo no início, então uma semana pedida entra pela sua antecessora.
  const after = requested ? previousWeek(requested) : (typeof stored === 'string' ? stored : null);
  const weeks = closedWeeksSince(after);

  if (!weeks.length) {
    console.log('Nada pendente: o rollup já está na semana corrente.');
    return;
  }
  console.log(`Consolidando ${weeks.length} semanas, de ${weeks[0]} a ${weeks.at(-1)}.`);

  let total = 0;
  for (const [index, week] of weeks.entries()) {
    const { skus } = await rollUpWeek(week);
    total += skus;
    await checkpoint.set({ lastClosedWeek: week, updatedAt: new Date().toISOString() }, { merge: true });
    console.log(`  [${index + 1}/${weeks.length}] ${week}: ${skus} SKUs`);
  }
  console.log(`Concluído. ${total} buckets escritos em ${weeks.length} semanas.`);
}

main().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
```

- [ ] **Step 2: Dry-run against the emulator before touching production**

```bash
firebase emulators:exec --only firestore --project demo-brsteel-auth --config firebase.test.json \
  'FIRESTORE_EMULATOR_HOST=127.0.0.1:8188 GCLOUD_PROJECT=demo-brsteel-auth npx tsx scripts/backfill-sku-weekly-demand.ts 2026-W36'
```

Expected: imprime "Consolidando N semanas", uma linha por semana, e termina com "Concluído". O emulador está vazio, então cada semana reporta 0 SKUs — o que valida o caminho sem tocar em dado real.

- [ ] **Step 3: Commit**

```bash
git add scripts/backfill-sku-weekly-demand.ts
git commit -m "feat(producao): resumable backfill for the weekly demand rollup

Kept out of the cron on purpose: the full history is over 12k orders and a
single pass would risk the 300s function ceiling."
```

- [ ] **Step 4: Run it once against production, after Task 5 is deployed**

```bash
npx tsx scripts/backfill-sku-weekly-demand.ts
```

Expected: uma linha por semana e a contagem final. Conferir no console do Firestore que `skuWeeklyDemand` tem um documento por SKU e que `appConfig/skuWeeklyDemandRollup.lastClosedWeek` é a semana fechada mais recente.

---

### Task 7: Caminho de leitura — `history` no contrato

**Files:**
- Modify: `src/server/persistence/production-demand-contract.ts:3`
- Modify: `src/server/persistence/firestore-production-demand.ts`
- Test: `tests/operations/sku-history-read.test.ts`

**Interfaces:**
- Consumes: `readWeeklyHistory` (Task 4); `isoWeekOf` (Task 1).
- Produces: campo `history: HistoryPoint[]` em `ProductionDemand`, onde
  `HistoryPoint = { week: string; units: number; orders: number; open?: true }`.

- [ ] **Step 1: Write the failing test**

`tests/operations/sku-history-read.test.ts`:

```ts
import { beforeEach, expect, it, vi } from 'vitest';
import { seedOperations } from './fixtures';
import { adminDb } from '../helpers/firestore';
import { resetWeeklyHistoryCache, rollUpWeek } from '@/server/persistence/firestore-sku-weekly-demand';
import { readFirestoreProductionDemand } from '@/server/persistence/firestore-production-demand';

const order = (id: number, data: string, quantidade: number) =>
  adminDb.collection('salesOrders').doc(String(id)).set({
    id, numero: id, data, total: 100, contato: { id, nome: 'Cliente' },
    notaFiscal: { id: 900 + id }, situacao: { id: 9, nome: 'Atendido', valor: 1 },
    itens: [{ id: id * 10, codigo: 'CBA600', descricao: 'Cuba', quantidade, valor: 50, unidade: 'UN' }],
  });

const rowFor = async (from: string, to: string) =>
  (await readFirestoreProductionDemand({ from, to })).data.find(row => row.sku === 'CBA600');

beforeEach(async () => {
  await seedOperations();
  resetWeeklyHistoryCache();
  vi.setSystemTime(new Date('2026-09-16T12:00:00Z')); // quarta de W38
});

it('attaches the closed weeks from the rollup', async () => {
  await order(301, '2026-09-01', 6); // W36
  await order(302, '2026-09-08', 4); // W37
  await rollUpWeek('2026-W36'); await rollUpWeek('2026-W37');
  expect((await rowFor('2026-09-01', '2026-09-16'))?.history).toMatchObject([
    { week: '2026-W36', units: 6, orders: 1 },
    { week: '2026-W37', units: 4, orders: 1 },
  ]);
});

it('adds the current week from the live aggregation, flagged as open', async () => {
  await order(303, '2026-09-08', 4); // W37, fechada
  await order(304, '2026-09-15', 7); // W38, em curso
  await rollUpWeek('2026-W37');
  const history = (await rowFor('2026-09-01', '2026-09-16'))?.history ?? [];
  expect(history.at(-1)).toEqual({ week: '2026-W38', units: 7, orders: 1, open: true });
});

it('omits the open point when the selected range does not reach the current week', async () => {
  await order(305, '2026-09-08', 4);
  await rollUpWeek('2026-W37');
  const history = (await rowFor('2026-09-01', '2026-09-13'))?.history ?? [];
  expect(history.some(point => point.open)).toBe(false);
  expect(history.at(-1)?.week).toBe('2026-W37');
});

it('returns an empty history rather than failing when the rollup has not run', async () => {
  await order(306, '2026-09-08', 4);
  expect((await rowFor('2026-09-01', '2026-09-13'))?.history).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `firebase emulators:exec --only firestore --project demo-brsteel-auth --config firebase.test.json 'npx --no-install vitest run tests/operations/sku-history-read.test.ts'`
Expected: FAIL — `history` é `undefined`.

- [ ] **Step 3: Extend the contract**

`HistoryPoint` já foi declarado na Task 4. Aqui só entra o campo. Em
`src/server/persistence/production-demand-contract.ts`, substituir a interface por:

```ts
export interface ProductionDemand {
  sku: string; description: string; orderCount: number; totalQuantitySold: number; weeklyAverage: number;
  corte: number; dobra: number; stockLevel?: number | null; stockSource: OperationSource;
  stockAsOf: string | null; stockMin?: number; stockMax?: number;
  /** Semanas fechadas vindas do rollup, mais a semana corrente quando o período a alcança. */
  history: HistoryPoint[];
}
```

- [ ] **Step 4: Attach the history in the aggregation**

Em `src/server/persistence/firestore-production-demand.ts`, acrescentar os imports:

```ts
import { isoWeekOf } from '@/lib/iso-week';
import { readWeeklyHistory } from './firestore-sku-weekly-demand';
import type { HistoryPoint } from './production-demand-contract';
```

Incluir `readWeeklyHistory(12)` no `Promise.all` existente e acumular a semana corrente no mesmo laço que já percorre os pedidos. Dentro do `for (const order of orders)`, depois do `countsAsConsumption`, resolver a semana uma vez por pedido:

```ts
  const currentWeek = isoWeekOf(new Date());
  const openWeek = new Map<string, { units: number; orders: Set<number> }>();
```

e, dentro do laço de itens:

```ts
      if (isoWeekOf(`${order.data}T12:00:00Z`) === currentWeek) {
        const bucket = openWeek.get(item.codigo) ?? { units: 0, orders: new Set<number>() };
        bucket.units += item.quantidade; bucket.orders.add(order.id);
        openWeek.set(item.codigo, bucket);
      }
```

No `map` que monta `data`, acrescentar o campo:

```ts
    history: buildHistory(sku),
```

e a função auxiliar, no fim do arquivo:

```ts
  /**
   * Semanas fechadas vêm do rollup; a corrente vem do loop acima, porque só ela muda entre duas
   * consultas. Se o período selecionado não alcança a semana corrente, o ponto aberto simplesmente
   * não existe — não se inventa o valor nem se dispara uma segunda consulta de pedidos para obtê-lo.
   */
  function buildHistory(sku: string): HistoryPoint[] {
    const closed = (history.get(sku) ?? []).filter(point => point.week !== currentWeek);
    const open = openWeek.get(sku);
    return open ? [...closed, { week: currentWeek, units: open.units, orders: open.orders.size, open: true }] : closed;
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `firebase emulators:exec --only firestore --project demo-brsteel-auth --config firebase.test.json 'npx --no-install vitest run tests/operations/sku-history-read.test.ts tests/operations/production.test.ts'`
Expected: PASS — 4 novos e a suíte de produção verde.

- [ ] **Step 6: Fill the field on the Postgres path**

Em `src/server/persistence/postgres-production-demand.ts`, no objeto do `rows.map`, acrescentar:

```ts
        // O rollup semanal ainda não tem equivalente em Postgres; o contrato exige o campo.
        history: [],
```

- [ ] **Step 7: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/server/persistence/production-demand-contract.ts src/server/persistence/firestore-production-demand.ts src/server/persistence/postgres-production-demand.ts tests/operations/sku-history-read.test.ts
git commit -m "feat(producao): serve the weekly history with the demand rows

Closed weeks come from the rollup, the current week from the aggregation
that already runs, so the last point is never stale and never re-read."
```

---

### Task 8: Ferramenta MCP `consultar_historico_sku`

Fecha a exigência de que o MCP alcance tudo que a tela mostra: o histórico nasce alcançável em vez de preso ao cliente, como aconteceu com a Fila de Produção.

**Files:**
- Create: `src/server/operations/sku-history.ts`
- Modify: `src/server/mcp/read-tools.ts`
- Test: `tests/mcp/sku-history.test.ts`

**Interfaces:**
- Consumes: `readWeeklyHistory` (Task 4); `requireOperation`, `result` de `@/server/operations/common`.
- Produces: `skuHistory(context: AccessContext, raw: unknown): Promise<OperationResult<HistoryPoint[]>>`.

- [ ] **Step 1: Write the failing test**

`tests/mcp/sku-history.test.ts`:

```ts
import { beforeEach, expect, it } from 'vitest';
import { seedOperations, context } from '../operations/fixtures';
import { adminDb } from '../helpers/firestore';
import { readTools } from '@/server/mcp/read-tools';
import { resetWeeklyHistoryCache } from '@/server/persistence/firestore-sku-weekly-demand';

const tool = () => readTools.find(item => item.name === 'consultar_historico_sku')!;

beforeEach(async () => {
  await seedOperations();
  resetWeeklyHistoryCache();
  await adminDb.collection('skuWeeklyDemand').doc('CBA600').set({
    sku: 'CBA600', description: 'Cuba',
    weeks: { '2026-W35': { units: 2, orders: 1 }, '2026-W36': { units: 6, orders: 2 }, '2026-W37': { units: 4, orders: 1 } },
  });
});

it('is registered and reachable with producao:read', () => {
  expect(tool()).toBeDefined();
  expect(tool().capability).toBe('producao:read');
});

it('returns the series in chronological order', async () => {
  const response = await tool().run(context(), { sku: 'CBA600', semanas: 12 });
  expect(response.data).toEqual([
    { week: '2026-W35', units: 2, orders: 1 },
    { week: '2026-W36', units: 6, orders: 2 },
    { week: '2026-W37', units: 4, orders: 1 },
  ]);
});

it('honours the requested window, keeping the most recent weeks', async () => {
  const response = await tool().run(context(), { sku: 'CBA600', semanas: 2 });
  expect((response.data as { week: string }[]).map(point => point.week)).toEqual(['2026-W36', '2026-W37']);
});

it('warns instead of failing when the SKU has no rollup yet', async () => {
  const response = await tool().run(context(), { sku: 'NAO-EXISTE' });
  expect(response.data).toEqual([]);
  expect(response.warnings.join(' ')).toContain('Não há histórico');
});

it('refuses a role without access to production', async () => {
  await expect(tool().run(context('Vendedor'), { sku: 'CBA600' })).rejects.toThrow();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `firebase emulators:exec --only firestore --project demo-brsteel-auth --config firebase.test.json 'npx --no-install vitest run tests/mcp/sku-history.test.ts'`
Expected: FAIL — `tool()` é `undefined`.

- [ ] **Step 3: Write the operation**

`src/server/operations/sku-history.ts`:

```ts
import 'server-only';
import { z } from 'zod';
import type { AccessContext } from '@/server/access/types';
import { HISTORY_WEEKS } from '@/lib/iso-week';
import { readWeeklyHistory } from '@/server/persistence/firestore-sku-weekly-demand';
import { documentIdSchema, requireOperation, result } from './common';

const input = z.object({
  sku: documentIdSchema,
  semanas: z.coerce.number().int().min(1).max(HISTORY_WEEKS).default(26),
}).strict();

/**
 * Série semanal de demanda de um SKU.
 *
 * Só semanas fechadas: a semana corrente é parcial e viaja junto das linhas de demanda, onde há o
 * contexto do período consultado para decidir se ela existe.
 */
export async function skuHistory(context: AccessContext, raw: unknown) {
  requireOperation(context, 'producao:read', '/producao');
  const { sku, semanas } = input.parse(raw);
  const points = (await readWeeklyHistory(semanas)).get(sku) ?? [];
  return result(points, 'firestore', points.length ? [] : [
    'Não há histórico consolidado para este SKU. O rollup cobre apenas semanas fechadas; um SKU novo ou sem venda faturada fica vazio, o que não indica falha.',
  ]);
}
```

- [ ] **Step 4: Register the tool**

Em `src/server/mcp/read-tools.ts`, acrescentar o import:

```ts
import { skuHistory } from '@/server/operations/sku-history';
```

Acrescentar `skuHistory` ao objeto `defaultReadOperations` e ao destructuring de `createReadTools`, e inserir a definição logo depois de `consultar_demanda_producao`:

```ts
 { name: 'consultar_historico_sku', title: 'Histórico do SKU',
   description: 'Consulta a série semanal de demanda de um SKU, em semanas ISO de America/Sao_Paulo. Somente semanas fechadas e salvas no banco; a semana corrente acompanha consultar_demanda_producao. Série vazia indica SKU sem venda faturada consolidada, não falha de integração.',
   capability: 'producao:read', page: '/producao',
   schema: z.object({ sku: documentIdSchema, semanas: z.number().int().min(1).max(104).optional() }).strict(),
   run: skuHistory },
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `firebase emulators:exec --only firestore --project demo-brsteel-auth --config firebase.test.json 'npx --no-install vitest run tests/mcp'`
Expected: PASS — os 5 novos e toda a suíte MCP verde, incluindo a contagem de ferramentas em `consultar_meu_acesso`, que passa de 12 para 13.

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/server/operations/sku-history.ts src/server/mcp/read-tools.ts tests/mcp/sku-history.test.ts
git commit -m "feat(mcp): expose the per-SKU weekly demand history

The Fila de Produção lives in a client useMemo and is unreachable from
MCP; the history is born on the server so both consumers read the same
series from the same place."
```

---

### Task 9: Sparkline na coluna Tendência

**Files:**
- Create: `src/components/producao/DemandSparkline.tsx`
- Modify: `src/app/producao/ProducaoClient.tsx`

**Interfaces:**
- Consumes: `HistoryPoint` de `@/server/persistence/production-demand-contract`.
- Produces: `<DemandSparkline history={HistoryPoint[]} />`.

- [ ] **Step 1: Write the component**

`src/components/producao/DemandSparkline.tsx`:

```tsx
'use client';

import * as React from 'react';
import type { HistoryPoint } from '@/server/persistence/production-demand-contract';

const WIDTH = 72, HEIGHT = 24, PADDING = 3;

/**
 * Tendência de demanda semanal numa linha de tabela.
 *
 * SVG inline em vez de recharts: são até 50 linhas visíveis por página, e montar um gráfico completo
 * por linha custa caro sem entregar nada que a curva não diga. O recharts fica para o detalhe.
 *
 * A semana corrente é sempre parcial, então o segmento final é tracejado. Com linha sólida todo SKU
 * pareceria despencar no último ponto, que é leitura falsa e não erro de dado.
 */
export function DemandSparkline({ history }: { history: HistoryPoint[] }) {
  if (history.length < 2) {
    // Reta no zero se lê como "não vendeu", que é diferente de "ainda não temos série".
    return <span className="text-muted-foreground" aria-label="Sem histórico consolidado">—</span>;
  }

  const units = history.map(point => point.units);
  const max = Math.max(...units, 1);
  const step = (WIDTH - PADDING * 2) / (history.length - 1);
  const y = (value: number) => HEIGHT - PADDING - (value / max) * (HEIGHT - PADDING * 2);
  const points = history.map((point, index) => [PADDING + index * step, y(point.units)] as const);

  const openIndex = history.findIndex(point => point.open);
  const solid = openIndex === -1 ? points : points.slice(0, openIndex + 1);
  const dashed = openIndex === -1 ? [] : points.slice(openIndex - 1);
  const [lastX, lastY] = points.at(-1)!;
  const path = (list: readonly (readonly [number, number])[]) => list.map(([x, v]) => `${x},${v}`).join(' ');

  const label = `${history.length} semanas, de ${Math.min(...units)} a ${max} unidades, `
    + `última semana ${units.at(-1)}${openIndex === -1 ? '' : ' (parcial)'}`;

  return (
    <svg width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={label} className="inline-block align-middle">
      <polyline points={path(solid)} fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" strokeLinecap="round" />
      {dashed.length > 1 && (
        <polyline points={path(dashed)} fill="none" stroke="currentColor" strokeWidth="1.25" strokeDasharray="2 2" strokeLinecap="round" />
      )}
      <circle cx={lastX} cy={lastY} r="1.75" fill="currentColor" />
    </svg>
  );
}
```

- [ ] **Step 2: Wire the column into the table**

Em `src/app/producao/ProducaoClient.tsx`:

Import:

```tsx
import { DemandSparkline } from '@/components/producao/DemandSparkline';
```

No estado `columnVisibility`, acrescentar `trend: true` logo depois de `weeklyAverage: true`.

No mapa de nomes do menu "Exibir Colunas", acrescentar `trend: "Tendência",`.

No `TableHeader`, depois da célula de `weeklyAverage`:

```tsx
                  {columnVisibility.trend && <TableHead className="text-center">Tendência</TableHead>}
```

No corpo da linha, depois da célula de `weeklyAverage`:

```tsx
                      {columnVisibility.trend && (
                        <TableCell className="text-center text-primary">
                          <DemandSparkline history={item.history ?? []} />
                        </TableCell>
                      )}
```

- [ ] **Step 3: Verify in the browser**

```bash
npm run dev
```

Abrir `http://localhost:9003/producao`, autenticar e conferir:
- a coluna "Tendência" aparece entre "Média Semanal" e "Corte";
- SKUs com histórico mostram a curva, com o último segmento tracejado quando o período alcança a semana corrente;
- SKUs sem rollup mostram "—", nunca uma linha reta;
- desligar "Tendência" no menu "Exibir Colunas" remove a coluna do cabeçalho e do corpo juntos.

- [ ] **Step 4: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/components/producao/DemandSparkline.tsx src/app/producao/ProducaoClient.tsx
git commit -m "feat(producao): demand trend sparkline on the SKU row

Inline SVG rather than a chart per row. The current week is dashed because
it is always partial, and a solid line would make every SKU look like it
just fell off a cliff."
```

---

### Task 10: Painel de detalhe do SKU

**Files:**
- Create: `src/components/producao/SkuHistorySheet.tsx`
- Modify: `src/app/producao/ProducaoClient.tsx`

**Interfaces:**
- Consumes: `fetchOperation` de `@/lib/operation-client`; `skuHistory` via a rota da Task 8.
- Produces: `<SkuHistorySheet sku={string | null} onOpenChange={(open: boolean) => void} />`.

- [ ] **Step 1: Add the read route**

`src/app/api/operations/sku-history/route.ts`:

```ts
import { requireWebContext } from '@/server/operations/context';
import { operationJson } from '@/server/operations/http';
import { skuHistory } from '@/server/operations/sku-history';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return operationJson(async () =>
    skuHistory(await requireWebContext(request), Object.fromEntries(new URL(request.url).searchParams)));
}
```

- [ ] **Step 2: Write the sheet**

`src/components/producao/SkuHistorySheet.tsx`:

```tsx
'use client';

import * as React from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { fetchOperation } from '@/lib/operation-client';
import type { HistoryPoint } from '@/server/persistence/production-demand-contract';

/** Detalhe do SKU: 52 semanas fechadas, onde o sparkline mostra 12. */
export function SkuHistorySheet({ sku, description, onOpenChange }:
  { sku: string | null; description?: string; onOpenChange: (open: boolean) => void }) {
  const [points, setPoints] = React.useState<HistoryPoint[]>([]);
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!sku) return;
    let active = true;
    setIsLoading(true); setError(null); setPoints([]);
    fetchOperation<HistoryPoint[]>(`/api/operations/sku-history?sku=${encodeURIComponent(sku)}&semanas=52`)
      .then(response => { if (active) { setPoints(response.data); setIsLoading(false); } })
      .catch((cause: Error) => { if (active) { setError(cause.message); setIsLoading(false); } });
    return () => { active = false; };
  }, [sku]);

  return (
    <Dialog open={Boolean(sku)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{sku}</DialogTitle>
          <DialogDescription>{description ?? 'Demanda semanal das últimas 52 semanas fechadas.'}</DialogDescription>
        </DialogHeader>
        {error && <p role="alert" className="text-destructive text-sm">{error}</p>}
        {isLoading ? (
          <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : points.length ? (
          <ResponsiveContainer width="100%" height={256}>
            <BarChart data={points} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="week" tickFormatter={week => week.slice(-3)} fontSize={11} interval="preserveStartEnd" />
              <YAxis fontSize={11} allowDecimals={false} />
              <Tooltip formatter={(value: number) => [`${value} unidades`, 'Vendidas']} />
              <Bar dataKey="units" fill="currentColor" className="text-primary" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-muted-foreground py-12 text-center text-sm">
            Ainda não há semanas consolidadas para este SKU.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Open it from the row**

Em `src/app/producao/ProducaoClient.tsx`, acrescentar o import, o estado e o gatilho:

```tsx
import { SkuHistorySheet } from '@/components/producao/SkuHistorySheet';
```

```tsx
  const [openSku, setOpenSku] = React.useState<{ sku: string; description: string } | null>(null);
```

Tornar a célula do sparkline clicável, substituindo a célula criada na Task 9:

```tsx
                      {columnVisibility.trend && (
                        <TableCell className="text-center text-primary">
                          <button
                            type="button"
                            onClick={() => setOpenSku({ sku: item.sku, description: item.description })}
                            aria-label={`Ver histórico de ${item.sku}`}
                            className="rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                          >
                            <DemandSparkline history={item.history ?? []} />
                          </button>
                        </TableCell>
                      )}
```

E, logo antes do `</DashboardLayout>` de fechamento:

```tsx
        <SkuHistorySheet
          sku={openSku?.sku ?? null}
          description={openSku?.description}
          onOpenChange={open => { if (!open) setOpenSku(null); }}
        />
```

- [ ] **Step 4: Verify in the browser**

```bash
npm run dev
```

Em `http://localhost:9003/producao`: clicar no sparkline abre o painel com as barras semanais; um SKU sem rollup mostra a mensagem de série vazia em vez de gráfico vazio; fechar e reabrir em outro SKU troca os dados; navegar por teclado até o sparkline mostra foco visível e Enter abre o painel.

- [ ] **Step 5: Run the full suite, typecheck and commit**

```bash
npm run test:vitest
npx tsc --noEmit
git add src/components/producao/SkuHistorySheet.tsx src/app/api/operations/sku-history/route.ts src/app/producao/ProducaoClient.tsx
git commit -m "feat(producao): SKU history panel with 52 closed weeks

The sparkline answers 'is this accelerating'; the panel answers 'since
when'. Reached from the row so the table stays the entry point."
```

---

## Ordem e dependências

```
Task 1 (semana ISO) ──┬── Task 3 (predicado) ── Task 4 (rollup) ──┬── Task 5 (cron)
                      │                                           ├── Task 6 (backfill)
                      │                                           ├── Task 7 (leitura) ── Task 9 (sparkline) ── Task 10 (detalhe)
                      │                                           └── Task 8 (MCP)
Task 2 (log de estoque) — independente, entregar primeiro
```

Task 2 não depende de nada e é a única com custo por adiamento: cada webhook processado sem ela apaga uma leitura de saldo para sempre. Entregar antes de qualquer outra, mesmo que o resto do plano demore.

## Fora de escopo deste plano

- **Tabela `stock_observation_log` no Postgres.** Registrada como dívida assumida no spec. A fonte
  operacional ainda é Firestore e o Postgres é piloto; a Task 7 preenche `history: []` naquele caminho
  para satisfazer o contrato. O passo precisa entrar no runbook da cadeia de migração, que é aplicada à
  mão — não acontece sozinho.
- **Modelo de previsão** com tendência e sazonalidade. A série passa a existir; usá-la é outro trabalho.
- **Série de saldo no sparkline.** A Task 2 começa a capturar hoje; o gráfico só faz sentido depois de
  alguns meses de massa.
- **Substituir "Corte" e "Dobra"** (achado C5) e **ligar lote do Kanban a SKU**.

## Divergência deliberada em relação ao spec

O spec previa cache "com invalidação pelo marcador compartilhado", espelhando `stock.ts`. O plano usa
TTL de 10 minutos com invalidação apenas local. O marcador compartilhado existe no cache do Bling
porque um refresh manual do operador precisa aparecer imediatamente; aqui a única escrita é um cron
semanal, e uma leitura extra por consulta para evitar dez minutos de atraso num número que muda toda
segunda-feira não se paga. Se um dia o rollup passar a ser disparado sob demanda, a decisão muda.
