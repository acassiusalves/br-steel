import { describe, expect, it } from 'vitest';
import { blingQueueWeeks, calculateBlingQueue, defaultBlingQueueRange, resolveBlingQueueCategories } from '@/lib/pcp/bling-queue';

const row = (sku: string, stock: number, sold: number, min = 10, openQuantity = 0) => ({
  sku, stock, sold, min, openQuantity, description: sku, stockSource: 'virtual' as const, hasStructure: true,
});

describe('fila das vendas por categoria do Bling', () => {
  it('usa 84 dias inclusivos no padrão e conta fração de semana no período curto', () => {
    expect(defaultBlingQueueRange('2026-11-10')).toEqual({ from: '2026-08-19', to: '2026-11-10' });
    expect(blingQueueWeeks('2026-08-19', '2026-11-10')).toBe(12);
    expect(blingQueueWeeks('2026-11-10', '2026-11-10')).toBe(1 / 7);
  });

  it('ordena zerados por venda e SKU, depois os abaixo do mínimo e os sem histórico', () => {
    const rows = [
      row('CUBA', 0, 120), row('GANCHO-B', -1, 36), row('GANCHO-A', 0, 36),
      row('PLAQ', 0, 7), row('RALO', 4, 24, 7), row('NO-MINIMO', 7, 24, 7),
      row('EM-OP', 0, 60, 8, 30), row('SEM-HISTORICO', 0, 0),
    ];
    expect(calculateBlingQueue(rows, { weeks: 12, factor: 1.7 }).map(r => [r.sku, r.tier, r.quantity]))
      .toEqual([
        ['CUBA', 'zerado', 17], ['EM-OP', 'zerado', 9], ['GANCHO-A', 'zerado', 6],
        ['GANCHO-B', 'zerado', 6], ['PLAQ', 'zerado', 5], ['RALO', 'abaixo_minimo', 5],
        ['SEM-HISTORICO', 'sem_historico', 5],
      ]);
    expect(calculateBlingQueue(rows, { weeks: 12, factor: 1.7 }).find(r => r.sku === 'PLAQ')?.weeklyAverage).toBe(0.58);
  });

  it('calcula com a média integral e neutraliza imprecisão no arredondamento', () => {
    expect(calculateBlingQueue([row('FRACAO', 0, 2)], { weeks: 1 / 7, factor: 1 })[0]?.quantity).toBe(14);
    expect(calculateBlingQueue([row('EXATO', 0, 72)], { weeks: 12, factor: 1.0000000001 })[0]?.quantity).toBe(6);
    expect(calculateBlingQueue([row('MEDIA', 0, 61)], { weeks: 12, factor: 3 })[0]?.quantity).toBe(16);
  });

  it('busca as categorias descendentes e aceita raiz configurada no lugar do nome padrão', () => {
    const categories = [
      { id: 3, descricao: 'Sub', categoriaPai: { id: 2 } },
      { id: 2, descricao: 'Ralos', categoriaPai: { id: 1 } },
      { id: 1, descricao: ' Produtos Inóx   Marketplace ' },
      { id: 4, descricao: 'Revenda' },
    ];
    expect(resolveBlingQueueCategories(categories, []).ids).toEqual(new Set(['1', '2', '3']));
    expect(resolveBlingQueueCategories(categories, ['4']).ids).toEqual(new Set(['4']));
  });
});
