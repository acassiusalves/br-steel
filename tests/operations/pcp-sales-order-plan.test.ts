import { describe, expect, it } from 'vitest';
import { planSalesOrder, type SheetDetail } from '@/lib/pcp/sales-order-plan';
import type { SheetOption } from '@/lib/pcp/op-generator';

// SKUs sintéticos: a cuba CUBA1 leva 1 corpo e 2 laterais com ficha própria, mais caixa (matéria-prima).
const sheet = (sku: string, steps = 3, code = `F-${sku}`): SheetOption => ({ id: `s-${sku}`, code, sku, name: `Produto ${sku}`, stepCount: steps });
const sheetsBySku = new Map<string, SheetOption[]>([
  ['CUBA1', [sheet('CUBA1')]], ['CORPO1', [sheet('CORPO1', 1)]], ['LATERAL1', [sheet('LATERAL1', 1)]],
  ['CUBA2', [sheet('CUBA2')]], ['SEMROTEIRO', [sheet('SEMROTEIRO', 0)]],
]);
const sheetDetails = new Map<string, SheetDetail>([
  ['s-CUBA1', { baseQuantity: 1, components: [
    { sku: 'CORPO1', name: 'Corpo', quantity: 1 }, { sku: 'LATERAL1', name: 'Lateral', quantity: 1 },
    { sku: 'LATERAL1', name: 'Lateral', quantity: 1 }, { sku: 'CAIXA', name: 'Caixa', quantity: 1 }] }],
  ['s-CUBA2', { baseQuantity: 2, components: [{ sku: 'CORPO1', name: 'Corpo', quantity: 3 }] }],
]);

describe('desdobramento do pedido de venda', () => {
  it('produto com ficha vira a OP de dobra e as partes com ficha viram o corte', () => {
    const { lines, warnings } = planSalesOrder({ items: [{ sku: 'CUBA1', description: 'Cuba', quantity: 4 }], kits: new Map(), sheetsBySku, sheetDetails });
    expect(warnings).toEqual([]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ sku: 'CUBA1', quantity: 4, source: 'item', sheet: { id: 's-CUBA1' }, materials: ['CAIXA'] });
    expect(lines[0].parts.map(p => [p.sku, p.quantity, p.sheet.id])).toEqual([['CORPO1', 4, 's-CORPO1'], ['LATERAL1', 8, 's-LATERAL1']]);
  });
  it('respeita a quantidade base da ficha e soma o mesmo SKU repetido no pedido', () => {
    const { lines } = planSalesOrder({ items: [{ sku: 'CUBA2', description: null, quantity: 1 }, { sku: 'CUBA2', description: null, quantity: 3 }],
      kits: new Map(), sheetsBySku, sheetDetails });
    expect(lines[0].quantity).toBe(4);
    expect(lines[0].parts).toMatchObject([{ sku: 'CORPO1', quantity: 6 }]);
  });
  it('kit do Bling sem ficha abre nos componentes e soma com item direto do mesmo SKU', () => {
    const kits = new Map([['KIT', [{ sku: 'CUBA1', description: 'Cuba', quantity: 2 }, { sku: 'TAMPA', description: 'Tampa', quantity: 1 }]]]);
    const { lines, warnings } = planSalesOrder({ items: [{ sku: 'KIT', description: 'Kit', quantity: 3 }, { sku: 'CUBA1', description: 'Cuba', quantity: 1 }],
      kits, sheetsBySku, sheetDetails });
    const cuba = lines.find(l => l.sku === 'CUBA1')!;
    expect(cuba).toMatchObject({ quantity: 7, source: 'item', kitSkus: ['KIT'] });
    expect(lines.find(l => l.sku === 'TAMPA')).toMatchObject({ quantity: 3, source: 'kit', sheet: null });
    expect(lines.some(l => l.sku === 'KIT')).toBe(false);
    expect(warnings).toEqual(['TAMPA não tem ficha técnica com roteiro e não pode virar OP.']);
  });
  it('item sem ficha com roteiro fica sem OP, com aviso', () => {
    const { lines, warnings } = planSalesOrder({ items: [{ sku: 'SEMROTEIRO', description: null, quantity: 1 }, { sku: 'REVENDA', description: null, quantity: 2 }],
      kits: new Map(), sheetsBySku, sheetDetails });
    expect(lines.map(l => [l.sku, l.sheet])).toEqual([['SEMROTEIRO', null], ['REVENDA', null]]);
    expect(warnings).toHaveLength(2);
  });
  it('item com ficha não é aberto pelo kit do Bling', () => {
    const kits = new Map([['CUBA1', [{ sku: 'TAMPA', description: null, quantity: 1 }]]]);
    const { lines } = planSalesOrder({ items: [{ sku: 'CUBA1', description: null, quantity: 1 }], kits, sheetsBySku, sheetDetails });
    expect(lines.map(l => l.sku)).toEqual(['CUBA1']);
  });
});
