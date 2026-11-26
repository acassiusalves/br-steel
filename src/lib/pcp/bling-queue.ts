const DAY_MS = 86_400_000;
const DEFAULT_DAYS = 84;
const INOX_CATEGORY = 'Produtos Inox Marketplace';

export type StockSource = 'virtual' | 'fisico' | 'total' | 'ausente';
export type BlingQueueTier = 'zerado' | 'abaixo_minimo' | 'sem_historico';
export type BlingQueueCandidate = {
  sku: string;
  description: string;
  stock: number;
  min: number;
  sold: number;
  openQuantity: number;
  stockSource: StockSource;
  hasStructure: boolean;
};

export function defaultBlingQueueRange(today: string): { from: string; to: string } {
  const from = new Date(Date.parse(today) - (DEFAULT_DAYS - 1) * DAY_MS);
  return { from: from.toISOString().slice(0, 10), to: today };
}

export function blingQueueWeeks(from: string, to: string): number {
  return ((Date.parse(to) - Date.parse(from)) / DAY_MS + 1) / 7;
}

const TIER_ORDER: Record<BlingQueueTier, number> = { zerado: 0, abaixo_minimo: 1, sem_historico: 2 };

export function calculateBlingQueue(rows: readonly BlingQueueCandidate[], { weeks, factor }: { weeks: number; factor: number }) {
  return rows.flatMap(row => {
    if (row.stock > 0 && row.stock >= row.min) return [];
    const tier: BlingQueueTier = row.sold === 0 ? 'sem_historico' : row.stock <= 0 ? 'zerado' : 'abaixo_minimo';
    const average = row.sold / weeks;
    return [{
      ...row, tier, weeklyAverage: Math.round(average * 100) / 100,
      // Ignore floating-point noise before rounding up to whole units.
      quantity: Math.max(5, Math.ceil(Number((average * factor).toFixed(6)))),
    }];
  }).sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || b.sold - a.sold || a.sku.localeCompare(b.sku));
}

type Category = {
  id: string | number;
  descricao?: string;
  categoriaPai?: { id?: string | number } | null;
};

const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');

export function resolveBlingQueueCategories(categories: readonly Category[], configuredIds: readonly string[]) {
  const roots = configuredIds.length ? configuredIds :
    categories.filter(category => normalize(category.descricao ?? '') === normalize(INOX_CATEGORY)).map(category => String(category.id));
  const byId = new Map(categories.map(category => [String(category.id), category]));
  const ids = new Set(roots);
  const children = new Map<string, string[]>();
  for (const category of categories) {
    const parentId = String(category.categoriaPai?.id ?? '0');
    if (parentId === '0' || parentId === String(category.id)) continue;
    const siblings = children.get(parentId) ?? [];
    siblings.push(String(category.id));
    children.set(parentId, siblings);
  }
  for (const id of ids) for (const child of children.get(id) ?? []) ids.add(child);

  function categoryPath(id: string, visited = new Set<string>()): string {
    const category = byId.get(id);
    const name = category?.descricao?.trim() || `Categoria ${id}`;
    const parentId = String(category?.categoriaPai?.id ?? '0');
    visited.add(id);
    return ids.has(parentId) && !visited.has(parentId) ? `${categoryPath(parentId, visited)} › ${name}` : name;
  }

  return { ids, names: [...ids].map(id => categoryPath(id)).sort((a, b) => a.localeCompare(b, 'pt-BR')) };
}
