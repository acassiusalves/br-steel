import { beforeEach, expect, it } from 'vitest';
import { adminDb } from '../helpers/firestore';
import { seedOperations, context } from './fixtures';
import { listSupplies } from '@/server/operations/supplies';
import { inventoryItem } from '@/services/inventory-service';
import type { SupplyRead } from '@/types/supply';

beforeEach(seedOperations);
async function legacyFixture() {
 await adminDb.collection('supplies').doc('steel').delete();
 const batch = adminDb.batch();
 for (let i = 0; i < 51; i++) batch.set(adminDb.collection('supplies').doc(`a-limit-${String(i).padStart(2, '0')}`), { codigo: `SKU-${i}`, estoqueMinimo: i, estoqueMaximo: i + 10, updatedAt: '2026-01-01' });
 batch.set(adminDb.collection('supplies').doc('b-code'), { codigo: 'CODE-ONLY', updatedAt: '2026-01-01' });
 batch.set(adminDb.collection('supplies').doc('c-nested'), { produto: { nome: 'Nested legacy', codigo: 'NESTED' }, custoUnitario: 12, fornecedor: 'Synthetic supplier', estoqueMinimo: 2, estoqueMaximo: 8, prazo: 3 });
 batch.set(adminDb.collection('supplies').doc('z-named'), { codigo: 'NAMED', nome: 'Named partial', gtin: 'synthetic', estoqueAtual: 7, estoqueMinimo: 1, estoqueMaximo: 9, tempoEntrega: 2, createdAt: '2026-01-01' });
 await batch.commit();
}
it('excludes unnamed configuration and nested legacy rows before consumers sort inventory', async () => {
 await legacyFixture();
 const page = await listSupplies(context('Operador'), { limit: 100 });
 expect(() => [...page.data].sort((a, b) => a.nome.localeCompare(b.nome))).not.toThrow();
 expect(page.data).toEqual([{ id: 'z-named', codigo: 'NAMED', nome: 'Named partial', gtin: 'synthetic', estoqueAtual: 7, estoqueMinimo: 1, estoqueMaximo: 9, tempoEntrega: 2, createdAt: '2026-01-01' }]);
 expect((await adminDb.collection('supplies').get()).size).toBe(54);
});
it('preserves continuation through pages occupied by excluded documents', async () => {
 await legacyFixture();
 const rows = []; let cursor: string | undefined; let first = true;
 do {
  const page = await listSupplies(context('Operador'), { limit: 10, ...(cursor ? { cursor } : {}) });
  if (first) { expect(page.nextCursor).toBeTruthy(); first = false; }
  rows.push(...page.data); cursor = page.nextCursor ?? undefined;
 } while (cursor);
 expect(rows.map(row => row.id)).toEqual(['z-named']);
 await expect(listSupplies(context('Vendedor'), {})).rejects.toThrow();
});
it('keeps absent cost, unit and balance unknown while retaining genuine zero values', () => {
 const named: SupplyRead = { id: 'partial', nome: 'Partial', estoqueAtual: 7, estoqueMinimo: 1 };
 expect(inventoryItem(named)).toMatchObject({ estoqueAtual: 7, valorEmEstoque: null, status: 'em_estoque' });
 expect(inventoryItem({ id: 'unknown', nome: 'Unknown' })).toMatchObject({ estoqueAtual: null, estoqueMinimo: null, valorEmEstoque: null, status: 'desconhecido' });
 expect(inventoryItem({ ...named, precoCusto: 0 })).toMatchObject({ valorEmEstoque: 0 });
 expect(inventoryItem({ ...named, estoqueAtual: 0, precoCusto: 2 })).toMatchObject({ estoqueAtual: 0, valorEmEstoque: 0, status: 'esgotado' });
 expect(named).not.toHaveProperty('unidade'); expect(named).not.toHaveProperty('precoCusto');
});
