import { describe, expect, it } from 'vitest';
import { createBlingSalesOrderReader } from '@/server/integrations/bling-sales-orders';

// Dados sintéticos no formato da API v3 do Bling.
function fakeBling(pages: Record<string, unknown[]>, details: Record<number, unknown> = {}) {
  const calls: string[] = [];
  const get = async (...args: unknown[]) => {
    expect(args).toHaveLength(1);
    const url = String(args[0]);
    calls.push(url);
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/pedidos/vendas')) {
      const filter = parsed.searchParams.get('numero') ?? parsed.searchParams.get('numerosLojas[]') ?? '';
      const page = Number(parsed.searchParams.get('pagina')), size = Number(parsed.searchParams.get('limite'));
      return { data: (pages[filter] ?? []).slice((page - 1) * size, page * size) };
    }
    return { data: details[Number(parsed.pathname.split('/').pop())] };
  };
  return { calls, get };
}

describe('pedidos de venda no Bling', () => {
  it('segue as páginas da listagem e devolve só o número exato', async () => {
    const many = [...Array.from({ length: 100 }, (_, i) => ({ id: i + 1, numero: 10000 + i })), { id: 500, numero: 777, numeroLoja: 'L-1', data: '2026-11-14' }];
    const bling = fakeBling({ '777': many });
    const found = await createBlingSalesOrderReader(bling.get).findByNumber('777');
    expect(found).toEqual([{ blingId: 500, number: '777', storeNumber: 'L-1', date: '2026-11-14', customerName: null }]);
    expect(bling.calls.map(u => new URL(u).searchParams.get('pagina'))).toEqual(['1', '2']);
  });
  it('sem resultado pelo número, procura pelo número da loja', async () => {
    const bling = fakeBling({ 'LOJA-99': [{ id: 9, numero: 12, numeroLoja: 'LOJA-99' }] });
    const reader = createBlingSalesOrderReader(bling.get);
    expect((await reader.findByNumber('LOJA-99')).map(o => o.blingId)).toEqual([9]);
    expect(bling.calls).toHaveLength(1);
    expect(new URL(bling.calls[0]).searchParams.get('numerosLojas[]')).toBe('LOJA-99');
    const numeric = fakeBling({ '123456': [{ id: 3, numero: 1, numeroLoja: '123456' }] });
    expect((await createBlingSalesOrderReader(numeric.get).findByNumber('123456')).map(o => o.blingId)).toEqual([3]);
    expect(numeric.calls.map(u => [...new URL(u).searchParams.keys()][2])).toEqual(['numero', 'numerosLojas[]']);
  });
  it('lê os itens do pedido e descarta item sem código ou sem quantidade', async () => {
    const bling = fakeBling({}, { 42: { id: 42, numero: 900, data: '2026-11-15', contato: { nome: 'Cliente Teste' }, itens: [
      { codigo: 'CUBA1', descricao: 'Cuba', quantidade: 2, produto: { id: 7 } },
      { codigo: '', descricao: 'Frete', quantidade: 1 }, { codigo: 'X', quantidade: 0 }] } });
    const order = await createBlingSalesOrderReader(bling.get).order(42);
    expect(order).toMatchObject({ blingId: 42, number: '900', customerName: 'Cliente Teste' });
    expect(order.items).toEqual([{ sku: 'CUBA1', description: 'Cuba', quantity: 2, productBlingId: 7 }]);
  });
  it('recusa detalhe de outro pedido', async () => {
    const bling = fakeBling({}, { 42: { id: 43, itens: [] } });
    await expect(createBlingSalesOrderReader(bling.get).order(42)).rejects.toThrow(/42/);
  });
  it('lê a estrutura do kit (formato E)', async () => {
    const bling = fakeBling({}, { 7: { id: 7, codigo: 'KIT', nome: 'Kit', formato: 'E', estrutura: { componentes: [
      { produto: { id: 8 }, quantidade: 2 }, { produto: {}, quantidade: 1 }] } } });
    const reader = createBlingSalesOrderReader(bling.get);
    expect(await reader.product(7)).toEqual({ blingId: 7, sku: 'KIT', name: 'Kit', format: 'E', components: [{ blingId: 8, quantity: 2 }] });
    expect(await reader.product(99)).toBeNull();
    expect(bling.calls.every(u => u.startsWith('https://api.bling.com.br/Api/v3/'))).toBe(true);
  });
});
