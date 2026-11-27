import * as XLSX from 'xlsx';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildSuggestionWorkbook, getQueueDefaults, queueBlockers } from '@/app/producao/ops/queue-review';
import { previewOrders } from '@/services/production-orders-service';
import type { GenerationPreview, OrderSuggestion } from '@/server/persistence/pcp-orders-contract';

const sheet = { id: 'sheet', code: '00042', sku: '0007', name: 'Item inox', stepCount: 2 };
const row: OrderSuggestion = {
  sku: '0007', description: 'Item inox', tier: 'zerado', stock: 0, min: 4, max: 15, openQuantity: 8,
  sold: 7, weeklyAverage: 0.58, sheet, quantity: 5, minMaxQuantity: 0, stockSource: 'virtual',
};
const preview: GenerationPreview = {
  kind: 'corte', from: '2026-09-03', to: '2026-11-25', factor: 1, policy: 'bling',
  suggestions: [row, { ...row, sku: '0008', sheet: null, stockSource: 'ausente' }],
  notes: [], warnings: [], catalogSyncedAt: '2026-11-26T01:30:00Z',
};

describe('revisão da fila de OPs', () => {
  it('começa com margem 1 e 84 dias inclusivos até o dia de São Paulo, para os dois tipos', () => {
    const now = new Date('2026-11-26T01:30:00Z');
    for (const kind of ['semanal', 'corte'] as const) {
      expect(getQueueDefaults('bling', kind, now)).toEqual({
        kind, from: '2026-09-03', to: '2026-11-25', factor: 1, policy: 'bling',
      });
    }
    expect(getQueueDefaults('legacy', 'corte', now).factor).toBe(1.47);
  });

  it('permite saldo confirmado do depósito e acumula os motivos que impedem a geração', () => {
    expect(queueBlockers(row, 'bling')).toEqual([]);
    expect(queueBlockers({ ...row, stockSource: 'fisico' }, 'bling')).toEqual([]);
    expect(queueBlockers({ ...row, sheet: null, stockSource: 'total' }, 'bling'))
      .toEqual(['Sem ficha com roteiro', 'Saldo do depósito indisponível']);
    expect(queueBlockers({ ...row, stockSource: 'ausente' }, 'bling'))
      .toEqual(['Saldo do depósito indisponível']);
    expect(queueBlockers({ ...row, stockSource: 'total' }, 'legacy')).toEqual([]);
  });

  it('exporta todas as linhas na ordem revisada, com seleção, edição e códigos como texto', () => {
    const book = buildSuggestionWorkbook(preview, {
      '0007': { selected: true, quantity: '3' },
      '0008': { selected: false, quantity: '5' },
    });
    const reopened = XLSX.read(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' });
    expect(reopened.SheetNames).toEqual(['Sugestão']);
    const ws = reopened.Sheets['Sugestão'];
    const records = XLSX.utils.sheet_to_json(ws);
    expect(records).toMatchObject([
      { SKU: '0007', 'Ficha técnica': '00042', Selecionado: 'Sim', 'Quantidade sugerida': 5, 'Quantidade revisada': 3 },
      { SKU: '0008', 'Ficha técnica': '', Selecionado: 'Não', 'Quantidade sugerida': 5, 'Quantidade revisada': 5 },
    ]);
    expect(ws.A2.t).toBe('s');
  });
});

describe('prévia no navegador', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('lê progresso e o resultado NDJSON mesmo quando a rede divide uma linha ou um caractere', async () => {
    const progress = { stage: 'stock', completed: 1, total: 2 };
    const result = { data: preview, source: 'postgres', warnings: [], asOf: preview.catalogSyncedAt, nextCursor: null };
    const encoded = new TextEncoder().encode(
      JSON.stringify({ progress }) + '\n' + JSON.stringify({ result: { ...result, data: { ...preview, notes: ['Prévia'] } } }),
    );
    const split = encoded.indexOf(0xc3) + 1;
    const fetchMock = vi.fn(async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoded.slice(0, 13));
        controller.enqueue(encoded.slice(13, split));
        controller.enqueue(encoded.slice(split));
        controller.close();
      },
    }), { headers: { 'Content-Type': 'application/x-ndjson' } }));
    vi.stubGlobal('fetch', fetchMock);
    const onProgress = vi.fn();
    const { kind, from, to, factor, policy } = preview;

    await expect(previewOrders({ kind, from, to, factor, policy }, onProgress))
      .resolves.toMatchObject({ notes: ['Prévia'], suggestions: preview.suggestions });
    expect(onProgress).toHaveBeenCalledExactlyOnceWith(progress);
    expect(fetchMock).toHaveBeenCalledWith('/api/operations/production-orders', expect.objectContaining({
      body: JSON.stringify({ action: 'preview', data: { kind, from, to, factor, policy }, stream: true }),
    }));
  });

  it('mantém o POST JSON tradicional ao usar o cálculo anterior, mesmo com callback', async () => {
    const { kind, from, to, factor } = preview;
    const fetchMock = vi.fn(async () => Response.json({ ok: true, data: preview }));
    vi.stubGlobal('fetch', fetchMock);
    const onProgress = vi.fn();

    await expect(previewOrders({ kind, from, to, factor }, onProgress)).resolves.toEqual(preview);
    expect(onProgress).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith('/api/operations/production-orders', expect.objectContaining({
      body: JSON.stringify({ action: 'preview', data: { kind, from, to, factor } }),
    }));
  });

  it('apresenta falhas da API e distingue uma leitura interrompida sem resultado', async () => {
    const { kind, from, to, factor, policy } = preview;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{"error":"O Bling está indisponível."}\n', { headers: { 'Content-Type': 'application/x-ndjson' } }))
      .mockResolvedValueOnce(new Response('{"progress":{"stage":"sales"}}\n', { headers: { 'Content-Type': 'application/x-ndjson' } }))
      .mockResolvedValueOnce(new Response('{"result":', { headers: { 'Content-Type': 'application/x-ndjson' } }))
      .mockResolvedValueOnce(Response.json({ ok: false, error: 'Acesso negado.' }, { status: 403 }));
    vi.stubGlobal('fetch', fetchMock);
    const onProgress = vi.fn();
    const input = { kind, from, to, factor, policy };

    await expect(previewOrders(input, onProgress)).rejects.toThrow('O Bling está indisponível.');
    await expect(previewOrders(input, onProgress)).rejects.toThrow('A leitura da fila foi interrompida.');
    await expect(previewOrders(input, onProgress)).rejects.toThrow('A leitura da fila foi interrompida.');
    await expect(previewOrders(input, onProgress)).rejects.toThrow('Acesso negado.');
  });
});
