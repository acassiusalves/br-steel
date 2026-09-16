import { beforeEach, expect, it, vi } from 'vitest';
import { seedOperations } from './fixtures';
import { adminDb } from '../helpers/firestore';
import { readWeeklyHistory, resetWeeklyHistoryCache, rollUpPendingWeeks, rollUpWeek, WEEKLY_DEMAND } from '@/server/persistence/firestore-sku-weekly-demand';
import { resetOperationalSource } from '@/server/persistence/source';

/**
 * Conta quantos `.commit()` de batch acontecem durante `run` — não quantos `.batch()` são criados.
 * Contar commits é o que distingue chunking real (N operações viram vários commits pequenos) de uma
 * implementação que ainda despeja tudo (ou nada) num commit só, ainda que crie vários objetos batch.
 */
async function countBatchCommits(run: () => Promise<unknown>): Promise<number> {
  let commits = 0;
  const original = adminDb.batch.bind(adminDb);
  const spy = vi.spyOn(adminDb, 'batch').mockImplementation(() => {
    const batch = original();
    const commit = batch.commit.bind(batch);
    batch.commit = (() => { commits++; return commit(); }) as typeof batch.commit;
    return batch;
  });
  try {
    await run();
  } finally {
    spy.mockRestore();
  }
  return commits;
}

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

it('makes a bucket disappear once its orders no longer qualify (retroactive cancellation)', async () => {
  await order(201, '2026-09-08', 'REVSKU', 3);
  await order(202, '2026-09-09', 'REVSKU', 5);
  await rollUpWeek('2026-W37');
  expect(await weeksOf('REVSKU')).toEqual({ '2026-W37': { units: 8, orders: 2 } });

  // Mesmos pedidos, cancelados depois do rollup: a fonte da verdade agora não tem demanda
  // qualificada nenhuma para REVSKU em W37. Fechar a semana de novo tem que refletir isso.
  await adminDb.collection('salesOrders').doc('201').update({ situacao: { id: 12, nome: 'Cancelado', valor: 2 } });
  await adminDb.collection('salesOrders').doc('202').update({ situacao: { id: 12, nome: 'Cancelado', valor: 2 } });
  await rollUpWeek('2026-W37');
  expect(await weeksOf('REVSKU')).toEqual({});
});

it('chunks the write batch instead of shipping every SKU sold that week in one commit', async () => {
  // 451 SKUs distintos num único pedido: barato de semear (1 doc), caro de escrever (1 doc por SKU).
  const itens = Array.from({ length: 451 }, (_, i) => ({
    id: i + 1, codigo: `BULK${String(i).padStart(4, '0')}`, descricao: 'Peça em massa', quantidade: 1, valor: 10, unidade: 'UN',
  }));
  await adminDb.collection('salesOrders').doc('900').set({
    id: 900, numero: 900, data: '2026-09-08', total: 4510, contato: { id: 900, nome: 'Cliente' },
    notaFiscal: { id: 1900 }, situacao: { id: 9, nome: 'Atendido', valor: 1 }, itens,
  });

  const commits = await countBatchCommits(() => rollUpWeek('2026-W37'));
  // 451 SKUs > o teto de chunk (450): sem chunking isto seria 1 commit só, com 451 operações — acima
  // do limite de 500 por batch do Firestore real (o emulador não recusaria, mas produção recusaria).
  expect(commits).toBe(2);
  expect((await adminDb.collection(WEEKLY_DEMAND).get()).size).toBe(451);
});

it('chunks the week-closing batch instead of shipping every stale doc in one commit', async () => {
  // 451 documentos pré-existentes, cada um só com uma semana fora da janela de retenção: fechar
  // qualquer semana nova precisa apagar essa entrada de todos — e, como é a única que cada um tem,
  // apagar o documento inteiro (Finding 2: sem isso a coleção acumula tumbas de `weeks: {}`).
  const seed = adminDb.batch();
  for (let i = 0; i < 451; i++) {
    const sku = `STALE${String(i).padStart(4, '0')}`;
    seed.set(adminDb.collection(WEEKLY_DEMAND).doc(sku), { sku, weeks: { '2020-W01': { units: 1, orders: 1 } } });
  }
  await seed.commit();
  // Um único item novo mantém o batch de ESCRITA em 1 commit fixo nas duas implementações, para que
  // a diferença observada venha só do batch de FECHAMENTO.
  await order(210, '2026-09-08', 'CBA600', 2);

  const commits = await countBatchCommits(() => rollUpWeek('2026-W37', new Date('2026-09-16T12:00:00Z')));
  // 1 commit da escrita (CBA600) + 2 do fechamento (451 documentos > o teto de chunk). Sem chunking,
  // o fechamento sozinho seria 1 commit com 451 operações — total 2, não 3.
  expect(commits).toBe(3);
  expect((await adminDb.collection(WEEKLY_DEMAND).get()).size).toBe(1); // só CBA600 sobra
});

/**
 * Um pedido cujos itens são dados exatamente como vierem — sem `descricao`, com `codigo` de outro
 * tipo — para exercitar o que a fonte realmente entrega, e não o que o tipo `SaleOrder` promete.
 */
const rawOrder = (id: number, data: string, itens: unknown[]) =>
  adminDb.collection('salesOrders').doc(String(id)).set({
    id, numero: id, data, total: 100, contato: { id, nome: 'Cliente' },
    notaFiscal: { id: 900 + id }, situacao: { id: 9, nome: 'Atendido', valor: 1 }, itens,
  });

it('stores a slash-containing SKU instead of failing the whole chunk on the document path', async () => {
  // `CHAPA/10` é SKU real neste repositório: tests/mcp/audit.test.ts:11 existe por causa dele.
  await order(301, '2026-09-08', 'CHAPA/10', 5);
  await order(302, '2026-09-09', 'CBA600', 2);
  await rollUpWeek('2026-W37');

  // O SKU saudável do mesmo lote não pode ter sido levado junto: o commit é por lote inteiro.
  expect(await weeksOf('CBA600')).toEqual({ '2026-W37': { units: 2, orders: 1 } });
  const stored = (await adminDb.collection(WEEKLY_DEMAND).get()).docs.find(doc => doc.data().sku === 'CHAPA/10');
  expect(stored).toBeDefined();
  expect(stored!.id).not.toContain('/');
  expect(stored!.data().weeks).toEqual({ '2026-W37': { units: 5, orders: 1 } });
  // Quem lê continua enxergando o SKU verdadeiro, não o id saneado.
  expect((await readWeeklyHistory(12)).get('CHAPA/10')).toEqual([{ week: '2026-W37', units: 5, orders: 1 }]);
});

it('keeps two SKUs apart when only the sanitized character separates them', async () => {
  await order(303, '2026-09-08', 'CHAPA/10', 5);
  await order(304, '2026-09-09', 'CHAPA_10', 7);
  await rollUpWeek('2026-W37');
  const history = await readWeeklyHistory(12);
  expect(history.get('CHAPA/10')).toEqual([{ week: '2026-W37', units: 5, orders: 1 }]);
  expect(history.get('CHAPA_10')).toEqual([{ week: '2026-W37', units: 7, orders: 1 }]);
});

it('closes a week whose items have no descricao at all', async () => {
  // `descricao` é obrigatório no tipo e opcional na fonte — postgres-production-demand.ts:13 carrega
  // uma coluna `description_present` justamente porque o campo falta de verdade.
  await rawOrder(305, '2026-09-08', [{ id: 3050, codigo: 'SEMDESC', quantidade: 3, valor: 50, unidade: 'UN' }]);
  await rollUpWeek('2026-W37');
  expect(await weeksOf('SEMDESC')).toEqual({ '2026-W37': { units: 3, orders: 1 } });
  expect((await adminDb.collection(WEEKLY_DEMAND).doc('SEMDESC').get()).data()).not.toHaveProperty('description');
});

it('never overwrites a stored description with an empty one', async () => {
  await order(306, '2026-09-01', 'CBA600', 1);
  await rollUpWeek('2026-W36');
  await rawOrder(307, '2026-09-08', [{ id: 3070, codigo: 'CBA600', quantidade: 2, valor: 50, unidade: 'UN' }]);
  await rollUpWeek('2026-W37');
  expect((await adminDb.collection(WEEKLY_DEMAND).doc('CBA600').get()).data()?.description).toBe('Peça CBA600');
});

it('skips a SKU with no usable document id and still closes the week for the rest', async () => {
  await rawOrder(308, '2026-09-08', [
    { id: 3080, codigo: { valor: 'objeto' }, descricao: 'Item corrompido', quantidade: 3, valor: 10, unidade: 'UN' },
    { id: 3081, codigo: 'CBA600', descricao: 'Peça CBA600', quantidade: 2, valor: 50, unidade: 'UN' },
  ]);
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  let warnings: unknown[][] = [];
  try {
    await expect(rollUpWeek('2026-W37')).resolves.toMatchObject({ week: '2026-W37', skus: 1 });
    // `mockRestore` limpa o histórico junto com a implementação, então o registro sai antes dele.
    warnings = warn.mock.calls;
  } finally {
    warn.mockRestore();
  }
  expect(await weeksOf('CBA600')).toEqual({ '2026-W37': { units: 2, orders: 1 } });
  expect(warnings).toHaveLength(1);
  expect(String(warnings[0][0])).toContain('[SKU-ROLLUP]');
});

it('advances the checkpoint week by week, so an interrupted run resumes where it stopped', async () => {
  await order(401, '2026-08-25', 'CBA600', 2); // W35
  await order(402, '2026-09-01', 'CBA600', 6); // W36
  await order(403, '2026-09-08', 'CBA600', 4); // W37
  const checkpoint = adminDb.collection('appConfig').doc('skuWeeklyDemandRollup');
  await checkpoint.set({ lastClosedWeek: '2026-W34' });

  // Cada semana faz exatamente uma consulta a `salesOrders`: estourar na terceira mata a execução no
  // meio, como o teto de 300s da função mataria um cold start de 104 semanas.
  let weekQueries = 0;
  const real = adminDb.collection.bind(adminDb);
  const spy = vi.spyOn(adminDb, 'collection').mockImplementation(path => {
    if (path === 'salesOrders' && ++weekQueries === 3) throw new Error('função encerrada pelo teto de tempo');
    return real(path);
  });
  try {
    await expect(rollUpPendingWeeks(new Date('2026-09-16T12:00:00Z'))).rejects.toThrow('teto de tempo');
  } finally {
    spy.mockRestore();
  }

  // As duas semanas já fechadas não podem ser descartadas: com o checkpoint só no fim do laço, a
  // execução seguinte recomeça do zero e a lacuna nunca fecha, por mais vezes que o cron rode.
  expect((await checkpoint.get()).data()?.lastClosedWeek).toBe('2026-W36');
  expect((await rollUpPendingWeeks(new Date('2026-09-16T12:00:00Z'))).weeks).toEqual(['2026-W37']);
  expect(await weeksOf('CBA600')).toEqual({
    '2026-W35': { units: 2, orders: 1 }, '2026-W36': { units: 6, orders: 1 }, '2026-W37': { units: 4, orders: 1 },
  });
});

it('stops at the time budget and reports what is left, instead of running until the function is killed', async () => {
  await order(404, '2026-08-25', 'CBA600', 2); // W35
  await order(405, '2026-09-01', 'CBA600', 6); // W36
  await order(406, '2026-09-08', 'CBA600', 4); // W37
  const checkpoint = adminDb.collection('appConfig').doc('skuWeeklyDemandRollup');
  await checkpoint.set({ lastClosedWeek: '2026-W34' });

  // Orçamento zerado: uma semana sempre fecha, para que toda execução avance, e a seguinte para.
  const run = await rollUpPendingWeeks(new Date('2026-09-16T12:00:00Z'), 0);
  expect(run.weeks).toEqual(['2026-W35']);
  expect(run.remaining).toBe(2);
  expect((await checkpoint.get()).data()?.lastClosedWeek).toBe('2026-W35');
  expect(await weeksOf('CBA600')).toEqual({ '2026-W35': { units: 2, orders: 1 } });
});

/**
 * O rollup lia `salesOrders` direto do Firestore, sem passar pelo repositório trocável e sem
 * consultar `operationalSource`. Depois de um corte para PostgreSQL isso não quebra: ele continua
 * somando a partir de uma coleção que parou de crescer, e devolve demanda cada vez mais defasada
 * sem sinal nenhum de que algo está errado. Números errados em silêncio são piores que uma falha.
 *
 * Com a fonte em `postgres` e sem conexão configurada, a leitura tem de falhar alto. Este teste
 * passa a valer quando o rollup lê pelo repositório; antes disso ele conclui normalmente, provando
 * que a coleção do Firestore estava sendo lida apesar do seletor.
 */
it('recusa somar a partir do Firestore quando a fonte operacional é postgres', async () => {
  await seedOperations();
  await adminDb.collection('appConfig').doc('operationalSource').set({ source: 'postgres' });
  resetOperationalSource();
  try {
    await expect(rollUpWeek('2026-W37')).rejects.toThrow();
  } finally {
    await adminDb.collection('appConfig').doc('operationalSource').delete();
    resetOperationalSource();
  }
});
