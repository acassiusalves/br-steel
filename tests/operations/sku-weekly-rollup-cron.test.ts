import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { seedOperations } from './fixtures';
import { adminDb } from '../helpers/firestore';
import { GET as rollup } from '@/app/api/cron/sku-weekly-rollup/route';
import { resetCoreWriteModeCache } from '@/server/operations/maintenance';

const cronSecret = 'local-cron-only-secret';
const call = (auth?: string) =>
  rollup(new Request('http://localhost/api/cron/sku-weekly-rollup', { headers: auth ? { authorization: auth } : {} }));

beforeEach(async () => {
  // Congela só o relógio (Date), não os timers: este teste bate no emulador do Firestore por gRPC, e
  // fakear setTimeout/setInterval junto travaria o cliente. 2026-09-16T12:00:00Z é quarta de W38, a
  // mesma data de referência usada em tests/operations/sku-weekly-demand.test.ts, então W37 vira uma
  // semana fechada que o rollup pode legitimamente processar.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-16T12:00:00Z'));
  await seedOperations();
  resetCoreWriteModeCache();
  vi.stubEnv('CRON_SECRET', cronSecret);
  await adminDb.collection('salesOrders').doc('201').set({
    id: 201, numero: 201, data: '2026-09-08', total: 100, contato: { id: 1, nome: 'Cliente' },
    notaFiscal: { id: 901 }, situacao: { id: 9, nome: 'Atendido', valor: 1 },
    itens: [{ id: 2010, codigo: 'CBA600', descricao: 'Cuba', quantidade: 4, valor: 50, unidade: 'UN' }],
  });
});

afterEach(() => {
  // Sem isto o relógio congelado vazaria para o próximo arquivo: vitest.config.ts roda com
  // fileParallelism: false, então um relógio fake esquecido aqui envenenaria o que rodar depois.
  vi.useRealTimers();
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

it('declares the function ceiling explicitly instead of inheriting the platform default', async () => {
  // Sem isto o cron herda o padrão da plataforma e um cold start de 104 semanas morre em silêncio.
  const route = await import('@/app/api/cron/sku-weekly-rollup/route');
  expect(route.maxDuration).toBe(300);
});

it('reports how many weeks are still pending after a run', async () => {
  await adminDb.collection('appConfig').doc('skuWeeklyDemandRollup').set({ lastClosedWeek: '2026-W36' });
  expect(await (await call('Bearer ' + cronSecret)).json())
    .toMatchObject({ ok: true, weeks: ['2026-W37'], remaining: 0 });
});
