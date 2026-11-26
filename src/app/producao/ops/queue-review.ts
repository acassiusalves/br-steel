import { format, subDays } from 'date-fns';
import * as XLSX from 'xlsx';
import { saoPauloDay } from '@/lib/iso-week';
import { defaultBlingQueueRange } from '@/lib/pcp/bling-queue';
import { DEFAULT_FACTORS } from '@/lib/pcp/op-generator';
import type { GenerationPreview, OrderKind, OrderSuggestion, PreviewInput } from '@/server/persistence/pcp-orders-contract';

export type QueueMode = 'bling' | 'legacy';
export type QueueReviewRows = Record<string, { selected: boolean; quantity: string }>;

export const STOCK_SOURCE_LABEL = {
  virtual: 'Virtual do depósito',
  fisico: 'Físico do depósito',
  total: 'Total do Bling',
  ausente: 'Ausente na consulta',
};

export function queueTierLabel(tier: OrderSuggestion['tier'], mode: QueueMode) {
  switch (tier) {
    case 'zerado': return 'Zerado';
    case 'abaixo_minimo': return mode === 'bling' ? 'Abaixo do mínimo' : 'No mínimo ou abaixo';
    case 'entre_min_max': return 'Entre mín. e máx.';
    case 'sem_historico': return 'Sem histórico';
  }
}

export function getQueueDefaults(mode: QueueMode, kind: OrderKind, now = new Date()): PreviewInput {
  if (mode === 'legacy') {
    return { kind, factor: DEFAULT_FACTORS[kind], from: format(subDays(now, 90), 'yyyy-MM-dd'), to: format(now, 'yyyy-MM-dd') };
  }
  return { kind, factor: 1, ...defaultBlingQueueRange(saoPauloDay(now)), policy: 'bling' };
}

export function queueBlockers(row: OrderSuggestion, mode: QueueMode): string[] {
  const blockers: string[] = [];
  if (!row.sheet) blockers.push('Sem ficha com roteiro');
  if (mode === 'bling' && row.stockSource !== 'virtual' && row.stockSource !== 'fisico') {
    blockers.push('Saldo do depósito indisponível');
  }
  return blockers;
}

export function buildSuggestionWorkbook(preview: GenerationPreview, review: QueueReviewRows) {
  const mode = preview.policy ?? 'legacy';
  const header = [
    'SKU', 'Produto', 'Faixa', 'Saldo', 'Origem do saldo', 'Mínimo', 'Máximo', 'Em OP', 'Vendidos',
    'Média semanal', 'Ficha técnica', 'Estrutura no Bling', 'Quantidade sugerida', 'Quantidade revisada', 'Selecionado', 'Pendências',
  ];
  const rows = preview.suggestions.map(row => {
    const draft = review[row.sku];
    const quantity = draft ? Number(draft.quantity) : row.quantity;
    return [
      row.sku, row.description, queueTierLabel(row.tier, mode), row.stock,
      row.stockSource ? STOCK_SOURCE_LABEL[row.stockSource] : '', row.min, mode === 'legacy' ? row.max : '',
      row.openQuantity, row.sold, row.weeklyAverage, row.sheet?.code ?? '',
      row.hasStructure === undefined ? '' : row.hasStructure ? 'Sim' : 'Não',
      row.quantity, draft?.quantity === '' || !Number.isFinite(quantity) ? '' : quantity,
      draft?.selected ? 'Sim' : 'Não', queueBlockers(row, mode).join(' / '),
    ];
  });
  const sheet = XLSX.utils.aoa_to_sheet([header, ...rows]);
  rows.forEach((_, index) => {
    const row = index + 2;
    sheet[`A${row}`].z = '@';
    sheet[`K${row}`].z = '@';
    sheet[`J${row}`].z = '0.00';
  });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Sugestão');
  return workbook;
}
