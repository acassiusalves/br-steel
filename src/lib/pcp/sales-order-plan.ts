/**
 * Desdobramento de um pedido de venda em OPs, sem acesso a banco nem ao Bling.
 *
 * Quem diz do que o produto é feito é a ficha técnica do BR Steel: o produto do pedido vira a OP de
 * dobra (produção semanal) e cada parte da ficha que tem ficha própria vira uma OP de corte filha, com a
 * quantidade pela quantidade base da ficha (mesmo critério do corte multinível). A estrutura do Bling
 * só entra para abrir um kit comercial (formato E) que não tem ficha: cada componente vira uma linha.
 */
import { componentQuantity, pickSheet, type SheetOption } from './op-generator';

export type PlanItem = { sku: string; description: string | null; quantity: number };
export type SheetDetail = { baseQuantity: number; components: { sku: string; name: string | null; quantity: number }[] };
export type PlanPart = { sku: string; description: string | null; quantity: number; sheet: SheetOption };
export type PlanLine = {
  sku: string; description: string | null; quantity: number;
  /** 'item' = veio direto no pedido; 'kit' = componente de um kit do pedido. */
  source: 'item' | 'kit'; kitSkus: string[];
  /** null = não pode virar OP (sem ficha técnica com roteiro). */
  sheet: SheetOption | null;
  parts: PlanPart[];
  /** Componentes da ficha sem ficha própria (matéria-prima, caixa): só informativo. */
  materials: string[];
};

const round = (value: number) => Math.round(value * 100000) / 100000;

export function planSalesOrder(input: {
  items: readonly PlanItem[];
  /** Componentes (já em SKU) dos kits do Bling, só para itens sem ficha. */
  kits: ReadonlyMap<string, readonly { sku: string; description: string | null; quantity: number }[]>;
  sheetsBySku: ReadonlyMap<string, readonly SheetOption[]>;
  sheetDetails: ReadonlyMap<string, SheetDetail>;
}): { lines: PlanLine[]; warnings: string[] } {
  const warnings: string[] = [];
  const sheetOf = (sku: string) => pickSheet(input.sheetsBySku.get(sku) ?? []);
  const lines = new Map<string, PlanLine>();
  const add = (sku: string, description: string | null, quantity: number, source: PlanLine['source'], kitSku: string | null) => {
    const line = lines.get(sku);
    if (line) {
      line.quantity = round(line.quantity + quantity);
      if (kitSku && !line.kitSkus.includes(kitSku)) line.kitSkus.push(kitSku);
      if (source === 'item') line.source = 'item';
      return;
    }
    lines.set(sku, { sku, description, quantity: round(quantity), source, kitSkus: kitSku ? [kitSku] : [], sheet: sheetOf(sku), parts: [], materials: [] });
  };
  const items = new Map<string, PlanItem>();
  for (const item of input.items) {
    const seen = items.get(item.sku);
    items.set(item.sku, seen ? { ...seen, quantity: round(seen.quantity + item.quantity) } : { ...item });
  }
  for (const item of items.values()) {
    const kit = input.kits.get(item.sku);
    if (!sheetOf(item.sku) && kit?.length) {
      for (const component of kit) add(component.sku, component.description, item.quantity * component.quantity, 'kit', item.sku);
    } else {
      add(item.sku, item.description, item.quantity, 'item', null);
    }
  }
  for (const line of lines.values()) {
    if (!line.sheet) {
      warnings.push(`${line.sku} não tem ficha técnica com roteiro e não pode virar OP.`);
      continue;
    }
    const detail = input.sheetDetails.get(line.sheet.id);
    if (!detail) continue;
    const bySku = new Map<string, { name: string | null; quantity: number }>();
    for (const c of detail.components) {
      const seen = bySku.get(c.sku);
      bySku.set(c.sku, { name: seen?.name ?? c.name, quantity: (seen?.quantity ?? 0) + c.quantity });
    }
    for (const [sku, c] of [...bySku].sort(([a], [b]) => a.localeCompare(b))) {
      const sheet = sheetOf(sku);
      if (!sheet) { line.materials.push(sku); continue; }
      line.parts.push({ sku, description: c.name, quantity: componentQuantity(line.quantity, c.quantity, detail.baseQuantity), sheet });
    }
  }
  return { lines: [...lines.values()], warnings };
}
