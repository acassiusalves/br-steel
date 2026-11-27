import { describe, expect, it, vi } from 'vitest';
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

describe('fontes Bling da fila por categoria', () => {
  it('pagina categorias e preserva os vínculos da árvore', async () => {
    const filler = Array.from({ length: 99 }, (_, i) => ({ id: 100 + i, descricao: `Categoria ${i}` }));
    const root = { id: 1, descricao: 'Produtos Inox Marketplace' };
    const child = { id: '2', descricao: 'Cubas', categoriaPai: { id: 1 } };
    const resale = { id: 3, descricao: 'Revenda', categoriaPai: null };
    const get = vi.fn(async (url: string) => {
      const { pathname, searchParams } = new URL(url);
      expect(pathname).toMatch(/\/categorias\/produtos$/);
      expect(searchParams.get('limite')).toBe('100');
      return { data: searchParams.get('pagina') === '1' ? [...filler, root] : [child, resale] };
    });

    const categories = await createBlingReader(get).categories();

    expect(categories.slice(99)).toEqual([root, child, resale]);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('prioriza o cadastro ativo por código exato e traz os metadados da categoria e da estrutura', async () => {
    const get = vi.fn(async (url: string) => {
      const { pathname } = new URL(url);
      if (pathname.endsWith('/produtos')) return { data: [
        { id: 1, codigo: 'CUBA', situacao: 'I' },
        { id: 2, codigo: 'COMPCUBA', situacao: 'A' },
        { id: 3, codigo: ' CUBA ', situacao: 'A' },
        { id: 4, codigo: 'KIT', situacao: 'A' },
        { id: 5, codigo: 'REVENDA', situacao: 'I' },
      ] };
      const details: Record<string, unknown> = {
        '3': { id: 3, nome: ' Cuba ', formato: 'E', categoria: { id: 2 },
          estoque: { minimo: '5', maximo: 10 }, estrutura: { tipoEstoque: 'F', componentes: [{}] } },
        '4': { id: 4, formato: 'E', categoria: { id: '2' }, estrutura: { tipoEstoque: 'V', componentes: [] } },
        '5': { id: 5, formato: 'S', categoria: { id: '0' }, situacao: 'I' },
      };
      return { data: details[pathname.split('/').pop()!] };
    });

    const products = await createBlingReader(get).queueProducts(['CUBA', 'KIT', 'REVENDA', 'AUSENTE']);

    expect(products).toHaveLength(3);
    expect(products).toEqual(expect.arrayContaining([
      { sku: 'CUBA', blingId: 3, name: 'Cuba', format: 'E', stockMin: 5, stockMax: 10, active: true,
        categoryId: '2', structureStockType: 'F', hasStructure: true },
      { sku: 'KIT', blingId: 4, name: null, format: 'E', stockMin: null, stockMax: null, active: true,
        categoryId: '2', structureStockType: 'V', hasStructure: false },
      { sku: 'REVENDA', blingId: 5, name: null, format: 'S', stockMin: null, stockMax: null, active: false,
        categoryId: null, structureStockType: null, hasStructure: false },
    ]));
    expect(get.mock.calls.map(([url]) => new URL(url).pathname)).toEqual([
      '/Api/v3/produtos', '/Api/v3/produtos/3', '/Api/v3/produtos/4', '/Api/v3/produtos/5',
    ]);
  });

  it('divide a busca de cadastro em lotes de 30 códigos', async () => {
    const get = vi.fn<(url: string) => Promise<{ data: unknown[] }>>(async () => ({ data: [] }));
    await createBlingReader(get).queueProducts(Array.from({ length: 31 }, (_, i) => `SKU${i}`));
    expect(get.mock.calls.map(([url]) => new URL(url).searchParams.getAll('codigos[]').length)).toEqual([30, 1]);
  });

  it('preserva a origem do saldo do depósito e divide as consultas em lotes de 50 IDs', async () => {
    const deposit = 1234;
    vi.stubEnv('BLING_DEPOSITO_ESTOQUE_ID', String(deposit));
    try {
      const get = vi.fn(async (url: string) => {
        const { pathname, searchParams } = new URL(url);
        expect(pathname).toMatch(/\/estoques\/saldos$/);
        if (searchParams.getAll('idsProdutos[]').length === 1) return { data: [] };
        return { data: [
          { produto: { id: 1 }, depositos: [{ id: String(deposit), saldoVirtual: 0, saldoFisico: 11 }] },
          { produto: { id: 2 }, depositos: [{ id: deposit, saldoFisico: 7 }] },
          { produto: { id: 3 }, saldoVirtualTotal: 19, depositos: [{ id: 14886494459, saldoVirtual: 9 }] },
          { produto: { id: 4 }, depositos: [{ id: deposit }], saldoVirtualTotal: 20 },
          { produto: { id: 5 }, depositos: [] },
          { produto: { id: 999 }, depositos: [{ id: deposit, saldoVirtual: 13 }] },
        ] };
      });

      const balances = await createBlingReader(get).queueBalances(Array.from({ length: 51 }, (_, i) => i + 1));

      expect(balances.get(1)).toEqual({ value: 0, source: 'virtual' });
      expect(balances.get(2)).toEqual({ value: 7, source: 'fisico' });
      expect(balances.get(3)).toEqual({ value: 19, source: 'total' });
      expect(balances.get(4)).toEqual({ value: 0, source: 'ausente' });
      expect(balances.get(5)).toEqual({ value: 0, source: 'ausente' });
      expect(balances.has(51)).toBe(false);
      expect(balances.has(999)).toBe(false);
      expect(get.mock.calls.map(([url]) => new URL(url).searchParams.getAll('idsProdutos[]').length)).toEqual([50, 1]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('usa o depósito Estoque padrão e propaga erros do Bling', async () => {
    vi.stubEnv('BLING_DEPOSITO_ESTOQUE_ID', '');
    try {
      const get = vi.fn(async () => ({ data: [{ produto: { id: 1 }, depositos: [{ id: 14886494459, saldoVirtual: -3 }] }] }));
      expect((await createBlingReader(get).queueBalances([1])).get(1)).toEqual({ value: -3, source: 'virtual' });
      const offline = new Error('limite de chamadas');
      await expect(createBlingReader(async () => { throw offline; }).queueBalances([1])).rejects.toBe(offline);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

it('só usa saldo virtual ou físico quando o valor recebido é numérico', async () => {
  const reader = createBlingReader(async () => ({ data: [
    { produto: { id: 101 }, depositos: [{ id: 14886494459, saldoVirtual: false, saldoFisico: '3' }] },
    { produto: { id: 102 }, depositos: [{ id: 14886494459, saldoVirtual: ' ', saldoFisico: [] }] },
    { produto: { id: 103 }, saldoVirtualTotal: false, depositos: [] },
  ] }));
  expect(await reader.queueBalances([101, 102, 103])).toEqual(new Map([
    [101, { value: 3, source: 'fisico' }], [102, { value: 0, source: 'ausente' }], [103, { value: 0, source: 'ausente' }],
  ]));
});

it('não trata resposta inválida da lista de NF-e como intervalo vazio', async () => {
  const { createBlingInvoiceReader } = await import('@/server/integrations/bling-invoices');
  const reader = createBlingInvoiceReader(async () => ({}));
  await expect(reader.listOutgoing({ from: '2026-11-01', to: '2026-11-02', page: 1, cancelled: false })).rejects.toThrow();
});
