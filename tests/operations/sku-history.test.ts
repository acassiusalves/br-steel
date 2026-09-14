import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { seedOperations, context } from './fixtures';
import { adminDb } from '../helpers/firestore';
import { resetWeeklyHistoryCache, rollUpWeek } from '@/server/persistence/firestore-sku-weekly-demand';
import { skuHistory } from '@/server/operations/sku-history';

const order = (id: number, data: string, quantidade: number) =>
  adminDb.collection('salesOrders').doc(String(id)).set({
    id, numero: id, data, total: 100, contato: { id, nome: 'Cliente' },
    notaFiscal: { id: 900 + id }, situacao: { id: 9, nome: 'Atendido', valor: 1 },
    itens: [{ id: id * 10, codigo: 'CHAPA/10', descricao: 'Chapa', quantidade, valor: 50, unidade: 'UN' }],
  });

// Congela só o relógio (Date), nunca os timers: este arquivo fala com o emulador por gRPC, e fakear
// setTimeout travaria o cliente. Mesmo cuidado de sku-history-read.test.ts.
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-16T12:00:00Z')); // quarta de W38
  await seedOperations();
  resetWeeklyHistoryCache();
});
afterEach(() => { vi.useRealTimers(); });

// Regressão: CHAPA/10 é dado real (tests/mcp/audit.test.ts tem o mesmo caso para
// consultar_estoque_produtos). O rollup já sabe gravar esse SKU sob um id de documento saneado
// (firestore-sku-weekly-demand.ts:weeklyDemandDocId); esta operação precisa aceitar o SKU verdadeiro
// de volta na consulta, em vez de rejeitá-lo no schema de entrada antes mesmo de chegar ao Map.get.
it('returns the series for a SKU containing a slash instead of throwing', async () => {
  await order(701, '2026-09-01', 6); // W36
  await rollUpWeek('2026-W36');
  const response = await skuHistory(context(), { sku: 'CHAPA/10', semanas: 12 });
  expect(response.data).toEqual([{ week: '2026-W36', units: 6, orders: 1 }]);
});
