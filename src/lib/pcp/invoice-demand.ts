/**
 * Vendidos por SKU a partir das NF-e de saída do Bling (regra do Marcos, 10/11/2026):
 *
 * - notas pendentes contam e canceladas não (o filtro de situação fica na consulta);
 * - só itens com CFOP de venda: x101 a x125 e x401 a x405, com x = 5, 6 ou 7;
 * - só SKUs da linha oficial;
 * - na nota o Bling já traz o kit desmontado. Só se explode o kit quando o próprio código dele aparece
 *   na nota; o que já veio desmontado não é explodido de novo.
 *
 * O total por SKU deve bater com o relatório "Notas por produto" do Bling no mesmo período.
 */
export type InvoiceItemTotal = { sku: string; cfop: string | null; quantity: number };
export type KitComponent = { sku: string; quantity: number };

export function isSaleCfop(cfop: string | null | undefined): boolean {
  const code = (cfop ?? '').replace(/\D/g, '');
  if (!/^[567]\d{3}$/.test(code)) return false;
  const rest = Number(code.slice(1));
  return (rest >= 101 && rest <= 125) || (rest >= 401 && rest <= 405);
}

export function invoiceDemand(items: readonly InvoiceItemTotal[], kits: ReadonlyMap<string, readonly KitComponent[]>, line: ReadonlySet<string>) {
  const sold = new Map<string, number>();
  const add = (sku: string, quantity: number) => { if (line.has(sku)) sold.set(sku, (sold.get(sku) ?? 0) + quantity); };
  // Itens da linha (ou de kit com componente da linha) deixados de fora por não terem CFOP de venda.
  const skippedCfop = new Map<string, number>();
  for (const item of items) {
    const components = line.has(item.sku) ? null : kits.get(item.sku) ?? null;
    if (!line.has(item.sku) && !components?.some(c => line.has(c.sku))) continue;
    if (!isSaleCfop(item.cfop)) {
      if (!item.cfop) skippedCfop.set(item.sku, (skippedCfop.get(item.sku) ?? 0) + item.quantity);
      continue;
    }
    if (!components) add(item.sku, item.quantity);
    else for (const c of components) add(c.sku, item.quantity * c.quantity);
  }
  return { sold, missingCfop: skippedCfop };
}

/** Semanas do período inclusivo (AAAA-MM-DD), como na demanda por pedidos: no mínimo uma. */
export function weeksInRange(from: string, to: string): number {
  return Math.max(1, (Date.parse(to) - Date.parse(from) + 86_400_000) / 86_400_000 / 7);
}
