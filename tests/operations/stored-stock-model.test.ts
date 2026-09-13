import { expect, it } from 'vitest';
import { normalizeStoredStockObservation, prepareStockReadModels } from '@/server/persistence/stored-stock-model';

const at = '2026-09-12T10:00:00.000Z';
it('preserves zero and missing physical balance and rejects invalid observations', () => {
  const row = normalizeStoredStockObservation('A', { estoqueAtual: 0, webhookReceivedAt: at });
  expect(row?.stock).toMatchObject({ produto: { codigo: 'A' }, saldoVirtualTotal: 0, saldoFisicoTotal: null, asOf: at });
  for (const patch of [{ estoqueAtual: '0' }, { webhookReceivedAt: 'invalid' }, { isSimulated: true },
    { source: 'simulated' }, { lastEvent: 'event (test)' }]) {
    expect(normalizeStoredStockObservation('A', { estoqueAtual: 0, webhookReceivedAt: at, ...patch })).toBeNull();
  }
});
it('keeps legacy string coercion, parsed instants and the locale ordering of unique SKUs', () => {
  const input = ['Z', 'á', 'a', 'A'].map((sku, index) => ({ id: String(index), data: { sku, estoqueAtual: 1, webhookReceivedAt: at } }));
  input.push({ id: 'x', data: { sku: 'a', estoqueAtual: 2, webhookReceivedAt: at } });
  const models = prepareStockReadModels(input);
  const expected = ['Z', 'á', 'a', 'A'].sort((a,b) => a.localeCompare(b));
  expect(input.slice(0,4).sort((a,b) => models.get(a.id)!.skuOrder-models.get(b.id)!.skuOrder).map(r=>r.data.sku)).toEqual(expected);
  expect(models.get('x')!.skuOrder).toBe(models.get('2')!.skuOrder);
  expect(normalizeStoredStockObservation('fallback', { sku: 0, estoqueAtual: 1, webhookReceivedAt: '2026-09-12T07:00:00-03:00' })?.observedAtMs).toBe(Date.parse(at));
});
