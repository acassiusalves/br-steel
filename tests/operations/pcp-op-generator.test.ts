import { describe, expect, it } from 'vitest';
import {
  componentQuantity, DEFAULT_FACTORS, iappImportRows, minMaxQuantity, orderStepsFromRoute, pickSheet, productionQueue, queueTier, suggestedQuantity, suggestOrders,
} from '@/lib/pcp/op-generator';
import { OFFICIAL_LINE_SKUS } from '@/lib/pcp/official-line';

const row = (sku: string, stock: number | null, min: number | null, max: number | null, sold = 0, openQuantity = 0) =>
  ({ sku, description: sku, stockLevel: stock, stockMin: min, stockMax: max, totalQuantitySold: sold, weeklyAverage: sold / 12, openQuantity });

describe('política mín/máx do script de OP da fábrica', () => {
  it('reproduz a OP manual de 22/09: PTU200200150 = 64 e CNUL440205140IN = 80', () => {
    expect(minMaxQuantity(row('PTU200200150', 0, 30, 64))).toBe(64);
    expect(minMaxQuantity(row('CNUL440205140IN', 0, 40, 80))).toBe(80);
  });
  it('reproduz a validação de 25/09 com saldos do depósito Estoque', () => {
    expect(minMaxQuantity(row('RL100014060', 11, 85, 170))).toBe(159);
    expect(minMaxQuantity(row('CBA600400350', 14, 15, 30))).toBe(16);
  });
  it('acima do mínimo não gera OP; no mínimo exato gera', () => {
    expect(minMaxQuantity(row('A', 31, 30, 64))).toBe(0);
    expect(minMaxQuantity(row('A', 30, 30, 64))).toBe(34);
  });
  it('desconta o que já está em OP aberta, para não duplicar', () => {
    expect(minMaxQuantity(row('A', 0, 30, 64, 0, 40))).toBe(0);
    expect(minMaxQuantity(row('A', 0, 30, 64, 0, 20))).toBe(44);
  });
  it('sem saldo ou sem mínimo/máximo não dimensiona nem inventa número', () => {
    expect(minMaxQuantity(row('A', null, 30, 64))).toBeNull();
    expect(minMaxQuantity(row('TMPCLH440230', 23, null, null))).toBeNull();
  });
  it('a quantidade da OP é a média semanal vezes a margem, arredondada para cima (chamado nº 1)', () => {
    expect(DEFAULT_FACTORS).toEqual({ semanal: 1, corte: 1.47 });
    // 120 vendidos em 12 semanas = média 10 por semana.
    expect(suggestedQuantity(row('PTU200200150', 0, 30, 64, 120), DEFAULT_FACTORS.semanal)).toBe(10);
    expect(suggestedQuantity(row('PTU200200150', 0, 30, 64, 120), DEFAULT_FACTORS.corte)).toBe(15);
    expect(suggestedQuantity(row('B', 0, 30, 64, 1), 1)).toBe(1);
    expect(suggestedQuantity(row('A', 0, 30, 64, 0), DEFAULT_FACTORS.corte)).toBe(0);
  });
});

describe('productionQueue (chamado nº 1)', () => {
  const rows = [
    row('ABAIXO-POUCO', 2, 20, 50, 300),
    row('ZERADO-POUCO', 0, 5, 10, 10),
    row('ZERADO-MUITO', 0, 5, 10, 90),
    row('ABAIXO-MUITO', 8, 10, 50, 500),
    row('ENTRE-MUITO', 30, 10, 50, 999),
    row('ENTRE-POUCO', 20, 10, 50, 50),
    row('NO-MAXIMO', 50, 10, 50, 999),
    row('SEM-SALDO', null, 10, 50, 999),
    row('SEM-LIMITES', 0, null, null, 999),
    row('COBERTO-POR-OP', 0, 10, 50, 999, 60),
  ];
  it('com zerados: zerados do mais vendido para o menos, depois os do mínimo para baixo, também por venda; nada entre mín e máx', () => {
    expect(productionQueue(rows).map(r => r.sku)).toEqual(['ZERADO-MUITO', 'ZERADO-POUCO', 'ABAIXO-MUITO', 'ABAIXO-POUCO']);
  });
  it('sem zerados: entram os acima do mínimo e abaixo do máximo, depois dos do mínimo para baixo, por venda', () => {
    const noZero = rows.filter(r => !r.sku.startsWith('ZERADO'));
    expect(productionQueue(noZero).map(r => [r.sku, r.tier])).toEqual([
      ['ABAIXO-MUITO', 'abaixo_minimo'], ['ABAIXO-POUCO', 'abaixo_minimo'], ['ENTRE-MUITO', 'entre_min_max'], ['ENTRE-POUCO', 'entre_min_max']]);
  });
  it('a posição soma o que já está em OP: no mínimo exato entra, no máximo não', () => {
    expect(queueTier(row('A', 30, 30, 64))).toBe('abaixo_minimo');
    expect(queueTier(row('A', 0, 30, 64, 0, 40))).toBe('entre_min_max');
    expect(queueTier(row('A', 0, 30, 64, 0, 64))).toBeNull();
    expect(queueTier(row('A', 0, 30, 64))).toBe('zerado');
  });
});

describe('linha oficial', () => {
  it('tem os 71 SKUs da tag inox, sem repetição e sem kits conhecidos', () => {
    expect(OFFICIAL_LINE_SKUS).toHaveLength(71);
    expect(new Set(OFFICIAL_LINE_SKUS).size).toBe(71);
    for (const kit of ['CLHLINCOMTAM440INOX', 'KIT2GPTOALHA', 'CBA700CSTE', 'LTMACTD27', 'MLB7457053222']) expect(OFFICIAL_LINE_SKUS).not.toContain(kit);
  });
});

describe('pickSheet e sugestões', () => {
  it('escolhe a ficha com roteiro mais completo e ignora fichas vazias', () => {
    const sheets = [
      { id: 'a', code: '00000161', sku: 'X', name: 'X', stepCount: 0 },
      { id: 'b', code: '00000102', sku: 'X', name: 'X', stepCount: 3 },
      { id: 'c', code: '00000160', sku: 'X', name: 'X', stepCount: 3 },
    ];
    expect(pickSheet(sheets)?.id).toBe('b');
    expect(pickSheet([sheets[0]])).toBeNull();
  });
  it('monta sugestões com ficha, faixa e quantidade pela média semanal com margem; sem venda não vira OP', () => {
    const sheets = new Map([['ZERADO', [{ id: 's1', code: '00000067', sku: 'ZERADO', name: 'Cuba', stepCount: 10 }]]]);
    const list = suggestOrders([row('ZERADO', 0, 4, 10, 24), row('SEM-FICHA', 1, 4, 10, 6, 2), row('SEM-VENDA', 0, 4, 10, 0)], sheets, 1.5);
    expect(list.map(s => s.sku)).toEqual(['ZERADO', 'SEM-FICHA']);
    expect(list[0]).toMatchObject({ sku: 'ZERADO', tier: 'zerado', minMaxQuantity: 10, quantity: 3, openQuantity: 0, sheet: { code: '00000067' } });
    expect(list[1]).toMatchObject({ sku: 'SEM-FICHA', tier: 'abaixo_minimo', sheet: null, quantity: 1, openQuantity: 2 });
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
  it('a OP de pedido com partes no corte vai com multinível "S"', () => {
    expect(iappImportRows([{ sheetCode: '00000067', quantity: 3, kind: 'semanal', multilevel: true }])).toEqual([['00000067', 3, '', 'S', 'N']]);
  });
  it('multiplica a parte pela quantidade da OP mãe, respeitando a quantidade base', () => {
    expect(componentQuantity(21, 2, 1)).toBe(42);
    expect(componentQuantity(10, 3, 2)).toBe(15);
  });
});
