import { describe, expect, it } from 'vitest';
import {
  componentQuantity, iappImportRows, orderStepsFromRoute, pickSheet, productionQueue, suggestedQuantity, suggestOrders,
} from '@/lib/pcp/op-generator';

const row = (sku: string, stock: number | null, min: number, max: number, sold: number, weeklyAverage = sold / 12) =>
  ({ sku, description: sku, stockLevel: stock, stockMin: min, stockMax: max, totalQuantitySold: sold, weeklyAverage });

describe('productionQueue', () => {
  it('ordena como a fila da reunião: zerados por venda, depois déficit, depois venda', () => {
    const demand = [
      row('ABAIXO-GRANDE', 2, 20, 50, 300), // déficit 18
      row('ZERADO-POUCO', 0, 5, 10, 10),
      row('ZERADO-MUITO', 0, 5, 10, 90),
      row('ABAIXO-PEQUENO', 8, 10, 50, 500), // déficit 2
      row('OK', 30, 10, 50, 999),
      row('SEM-SALDO', null, 10, 50, 999),
      row('ACIMA-MAX', 5, 10, 4, 999),
    ];
    expect(productionQueue(demand).map(r => r.sku)).toEqual(['ZERADO-MUITO', 'ZERADO-POUCO', 'ABAIXO-GRANDE', 'ABAIXO-PEQUENO']);
  });
});

describe('pickSheet e suggestedQuantity', () => {
  it('escolhe a ficha com roteiro mais completo e ignora fichas vazias', () => {
    const sheets = [
      { id: 'a', code: '00000161', sku: 'X', name: 'X', stepCount: 0 },
      { id: 'b', code: '00000102', sku: 'X', name: 'X', stepCount: 3 },
      { id: 'c', code: '00000160', sku: 'X', name: 'X', stepCount: 3 },
    ];
    expect(pickSheet(sheets)?.id).toBe('b');
    expect(pickSheet([sheets[0]])).toBeNull();
  });
  it('usa média × fator sem ficar abaixo do déficit do mínimo, e no mínimo 1', () => {
    expect(suggestedQuantity(row('A', 0, 5, 10, 120, 10), 1.5)).toBe(15);
    expect(suggestedQuantity(row('A', 0, 40, 60, 12, 1), 2)).toBe(40);
    expect(suggestedQuantity(row('A', 9.5, 10, 60, 0, 0), 2)).toBe(1);
  });
  it('monta sugestões com ficha e quantidade', () => {
    const sheets = new Map([['ZERADO', [{ id: 's1', code: '00000067', sku: 'ZERADO', name: 'Cuba', stepCount: 10 }]]]);
    const [first, second] = suggestOrders([row('ZERADO', 0, 4, 10, 24, 2), row('SEM-FICHA', 1, 4, 10, 6, 0.5)], sheets, 2);
    expect(first).toMatchObject({ sku: 'ZERADO', quantity: 4, sheet: { code: '00000067' } });
    expect(second).toMatchObject({ sku: 'SEM-FICHA', sheet: null, quantity: 3 });
  });
});

describe('orderStepsFromRoute', () => {
  it('usa a predecessora da ficha quando existe e o passo anterior quando não', () => {
    const steps = orderStepsFromRoute([
      { id: '1', operationId: 'check-corte', predecessorOperationId: null },
      { id: '2', operationId: 'dobrar', predecessorOperationId: 'check-corte' },
      { id: '3', operationId: 'check-dobra', predecessorOperationId: null },
      { id: '4', operationId: 'embalar', predecessorOperationId: 'fora-do-roteiro' },
    ]);
    expect(steps.map(s => s.predecessorOperationId)).toEqual([null, 'check-corte', 'dobrar', 'check-dobra']);
    expect(steps.map(s => s.position)).toEqual([0, 1, 2, 3]);
  });
});

describe('planilha do iApp e quantidade das partes', () => {
  it('gera as cinco colunas do modelo, com multinível S só no corte', () => {
    expect(iappImportRows([{ sheetCode: '00000067', quantity: 21, kind: 'semanal' }, { sheetCode: '00000137', quantity: 5, kind: 'corte' }]))
      .toEqual([['00000067', 21, '', 'N', 'N'], ['00000137', 5, '', 'S', 'N']]);
  });
  it('multiplica a parte pela quantidade da OP mãe, respeitando a quantidade base', () => {
    expect(componentQuantity(21, 2, 1)).toBe(42);
    expect(componentQuantity(10, 3, 2)).toBe(15);
  });
});
