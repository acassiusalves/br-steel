import { describe, expect, it } from 'vitest';
import { createBlingReader } from '@/server/integrations/bling-catalog';
import { createBlingInvoiceReader } from '@/server/integrations/bling-invoices';

// A busca por código do Bling não é exata: pedir TMPCLH440230 traz também COMPTMPCLH440230. Com 50
// códigos por lote o resultado passa de 100 e vem em mais de uma página.
const listed = [
  ...Array.from({ length: 99 }, (_, i) => ({ id: 1000 + i, codigo: `COMP${i}`, formato: 'S' })),
  { id: 1, codigo: 'GPTOALHA', formato: 'S' },
  { id: 2, codigo: 'TMPCLH440230', formato: 'S' },
  { id: 3, codigo: 'SPA4151P', formato: 'S' },
];

function fakeBling() {
  const calls: string[] = [];
  const get = async (url: string) => {
    calls.push(url);
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/produtos')) {
      const page = Number(parsed.searchParams.get('pagina') ?? 1), size = Number(parsed.searchParams.get('limite'));
      return { data: listed.slice((page - 1) * size, page * size) };
    }
    const id = Number(parsed.pathname.split('/').pop());
    const item = listed.find(p => p.id === id)!;
    return { data: { ...item, nome: item.codigo, estoque: { minimo: 5, maximo: 10 } } };
  };
  return { calls, get };
}

describe('cadastro do Bling por código', () => {
  it('segue as páginas da listagem e não perde os códigos da segunda página', async () => {
    const bling = fakeBling();
    const products = await createBlingReader(bling.get).products(['GPTOALHA', 'TMPCLH440230', 'SPA4151P']);
    expect(products.map(p => p.sku).sort()).toEqual(['GPTOALHA', 'SPA4151P', 'TMPCLH440230']);
    expect(products.find(p => p.sku === 'SPA4151P')).toMatchObject({ blingId: 3, stockMin: 5, stockMax: 10 });
    expect(bling.calls.filter(u => u.includes('/produtos?')).map(u => new URL(u).searchParams.get('pagina'))).toEqual(['1', '2']);
  });

  it('a classificação dos códigos das notas também segue as páginas', async () => {
    const bling = fakeBling();
    const products = await createBlingInvoiceReader(bling.get).productsByCode(['TMPCLH440230', 'SPA4151P']);
    expect(products.filter(p => !p.sku.startsWith('COMP')).map(p => p.sku).sort()).toEqual(['GPTOALHA', 'SPA4151P', 'TMPCLH440230']);
  });
});
