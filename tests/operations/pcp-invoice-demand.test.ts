import { describe, expect, it } from 'vitest';
import { invoiceDemand, isSaleCfop, weeksInRange } from '@/lib/pcp/invoice-demand';

const line = new Set(['GPTOALHA', 'CNUL440205140IN', 'TMPCLH440230']);

describe('CFOP de venda (regra do Marcos)', () => {
  it('aceita x101–x125 e x401–x405 dentro e fora do estado', () => {
    for (const cfop of ['5101', '5102', '6102', '6108', '5125', '7101', '5401', '6403', '5405', '6.102']) expect(isSaleCfop(cfop)).toBe(true);
  });
  it('recusa devolução, remessa, transferência e entrada', () => {
    for (const cfop of ['5100', '5126', '5202', '5915', '6949', '5152', '5406', '1102', '2102', '', null, '510']) expect(isSaleCfop(cfop)).toBe(false);
  });
});

describe('vendidos por nota fiscal', () => {
  it('soma só a linha oficial com CFOP de venda', () => {
    const { sold, missingCfop } = invoiceDemand([
      { sku: 'GPTOALHA', cfop: '6102', quantity: 360 },
      { sku: 'GPTOALHA', cfop: '5102', quantity: 10 },
      // Remessa e devolução não são venda.
      { sku: 'GPTOALHA', cfop: '5915', quantity: 7 },
      { sku: 'GPTOALHA', cfop: '6202', quantity: 3 },
      // Fora da linha oficial.
      { sku: 'LCO21250', cfop: '6102', quantity: 9 },
      { sku: 'CNUL440205140IN', cfop: null, quantity: 2 },
    ], new Map(), line);
    expect(Object.fromEntries(sold)).toEqual({ GPTOALHA: 370 });
    expect(Object.fromEntries(missingCfop)).toEqual({ CNUL440205140IN: 2 });
  });

  it('explode o kit só quando o código do kit aparece na nota', () => {
    const kits = new Map([
      ['CLHLINCOMTAM440INOX', [{ sku: 'CNUL440205140IN', quantity: 1 }, { sku: 'TMPCLH440230', quantity: 1 }]],
      ['KIT2GPTOALHA', [{ sku: 'GPTOALHA', quantity: 2 }]],
    ]);
    const { sold } = invoiceDemand([
      // O Bling já desmontou estes: contam como vieram.
      { sku: 'CNUL440205140IN', cfop: '6102', quantity: 5 },
      { sku: 'GPTOALHA', cfop: '6102', quantity: 4 },
      // Estes vieram com o código do kit na nota.
      { sku: 'CLHLINCOMTAM440INOX', cfop: '6102', quantity: 3 },
      { sku: 'KIT2GPTOALHA', cfop: '5102', quantity: 2 },
      { sku: 'KIT2GPTOALHA', cfop: '5915', quantity: 1 },
    ], kits, line);
    expect(Object.fromEntries(sold)).toEqual({ CNUL440205140IN: 8, TMPCLH440230: 3, GPTOALHA: 8 });
  });

  it('84 dias são 12 semanas; período curto conta como uma semana', () => {
    expect(weeksInRange('2026-08-19', '2026-11-10')).toBe(12);
    expect(weeksInRange('2026-11-10', '2026-11-10')).toBe(1);
  });
});
