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
