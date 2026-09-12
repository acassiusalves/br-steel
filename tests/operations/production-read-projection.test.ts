import { describe, expect, it } from 'vitest';
import { projectProductionOrder, projectProductionRecord } from '@/server/persistence/production-read-projection';
import { movementDateBounds } from '@/server/persistence/supplies-read-projection';

describe('production read projections', () => {
  it('retains the document ID and strips private fields from lot identities', () => {
    const projected = projectProductionRecord('source-lot', {
      id: 'payload-id', title: 'Steel', description: null, linkedOrderIds: ['order'],
      assignedTo: { userId: 'worker', userName: 'Worker', assignedAt: '2026-09-12', email: 'secret' },
      createdBy: { userId: 'author', userName: 'Author', password: 'secret', assignedAt: 'private' },
      contato: { nome: 'secret' }, invoiceXml: 'secret', total: 100,
    }, 'lots');
    expect(projected).toEqual({
      id: 'source-lot', title: 'Steel', description: null, linkedOrderIds: ['order'],
      assignedTo: { userId: 'worker', userName: 'Worker', assignedAt: '2026-09-12' },
      createdBy: { userId: 'author', userName: 'Author' },
    });
  });

  it('preserves missing and null identity fields without leaking nested metadata', () => {
    expect(projectProductionRecord('lot', { assignedTo: null, createdBy: { email: 'secret' } }, 'lots'))
      .toEqual({ id: 'lot', assignedTo: null, createdBy: {} });
    expect(projectProductionRecord('comment', {
      lotId: 'lot', content: 'Ready', author: { userId: 'worker', userName: null, email: 'secret' }, customerName: 'secret',
    }, 'comments')).toEqual({ id: 'comment', lotId: 'lot', content: 'Ready', author: { userId: 'worker', userName: null } });
  });

  it('returns operational order items with original positions and legacy unit defaults', () => {
    expect(projectProductionOrder('document-id', {
      id: 999, numero: 123, contato: { nome: 'secret' }, total: 200, xml: 'secret',
      itens: [
        { id: 0, codigo: 'A', descricao: 'Steel', quantidade: 0, unidade: '', valor: 99 },
        { id: null, codigo: 'B', quantidade: 2, unidade: 'KG', customerName: 'secret' },
        { codigo: 'C', quantidade: 1, unidade: null },
      ],
    })).toEqual({
      id: 'document-id', numero: 123,
      itens: [
        { id: 0, codigo: 'A', descricao: 'Steel', quantidade: 0, unidade: 'UN' },
        { id: 1, codigo: 'B', quantidade: 2, unidade: 'KG' },
        { id: 2, codigo: 'C', quantidade: 1, unidade: 'UN' },
      ],
    });
    expect(projectProductionOrder('empty', { itens: null })).toEqual({ id: 'empty', itens: [] });
  });

  it('blanks commercial customer names and exposes only the selected view fields', () => {
    expect(projectProductionRecord('item', {
      lotId: 'lot', sku: 'A', quantity: 1, sourceOrderId: 123, customerName: 'secret', precoCusto: 99,
    }, 'items')).toEqual({ id: 'item', lotId: 'lot', sku: 'A', quantity: 1, sourceOrderId: 123, customerName: '' });
    expect(projectProductionRecord('column', {
      name: 'Fila', order: 0, color: '#000000', createdAt: null, assignedTo: { email: 'secret' },
    }, 'columns')).toEqual({ id: 'column', name: 'Fila', order: 0, color: '#000000', createdAt: null });
  });
});

describe('movement civil-day bounds', () => {
  it('includes the complete São Paulo civil day instead of UTC midnight', () => {
    expect(movementDateBounds({ from: '2026-09-12', to: '2026-09-12' }))
      .toEqual({ from: '2026-09-12T03:00:00.000Z', to: '2026-09-13T03:00:00.000Z' });
  });

  it('handles the historical day whose midnight was skipped by daylight saving', () => {
    expect(movementDateBounds({ from: '2018-11-04', to: '2018-11-04' }))
      .toEqual({ from: '2018-11-04T03:00:00.000Z', to: '2018-11-05T02:00:00.000Z' });
    expect(movementDateBounds({})).toEqual({});
  });
});
