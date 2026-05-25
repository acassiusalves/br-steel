import {
  DEFAULT_DEEP_SEARCH_CONFIG,
  type DeepSearchConfig,
  type DeepSearchCategoryInsight,
  type DeepSearchConsideredItem,
  type DeepSearchGeneratedQuery,
  type DeepSearchMarketSignals,
  type DeepSearchOccurrence,
  type DeepSearchProgress,
  type DeepSearchQueryLevel,
  type DeepSearchQueryResult,
  type DeepSearchResult,
  type DeepSearchResultItem,
  type DeepSearchScoreBreakdown,
  type DeepSearchScores,
  type DeepSearchTermInsight,
} from '@/lib/deep-search-types';
import {
  getMercadoLivreSearchableText,
  normalizeMercadoLivreSearchText,
} from '@/lib/mercado-livre-catalog-search-text';
import {
  getSearchItemKey,
  loadMercadoLivreCategoryTrends,
  normalizeSearchOptions,
  runMercadoLivreCatalogSearch,
} from '@/services/mercado-livre-catalog-search';
import type {
  MercadoLivreSearchAttribute,
  MercadoLivreSearchItem,
  MercadoLivreSearchMode,
  MercadoLivreSearchResponse,
} from '@/types/mercado-livre-catalog-search';

const TITLE_NOISE_WORDS = new Set([
  'original',
  'novo',
  'nova',
  'lacrado',
  'lacrada',
  'garantia',
  'oficial',
  'promoção',
  'promocao',
  'envio',
  'imediato',
  'full',
  'frete',
  'gratis',
  'grátis',
  'produto',
  'com',
  'sem',
  'para',
  'brinde',
]);

const ATTRIBUTE_WEIGHTS = new Map<string, number>([
  ['BRAND', 12],
  ['MODEL', 18],
  ['LINE', 10],
  ['ALPHANUMERIC_MODEL', 14],
  ['PROCESSOR_MODEL', 10],
  ['INTERNAL_MEMORY', 8],
  ['RAM_MEMORY', 8],
  ['MEMORY_RAM', 8],
  ['SCREEN_SIZE', 6],
  ['DISPLAY_SIZE', 6],
  ['COLOR', 3],
]);

const DEPTH_QUERY_LIMITS: Record<DeepSearchConfig['depth'], number> = {
  balanced: 4,
  deep: 7,
  maximum: 10,
};

const EXPLORATION_LIMITS: Record<
  DeepSearchConfig['depth'],
  {
    level2Categories: number;
    level2TermsPerCategory: number;
    level3Categories: number;
    level3TermsPerCategory: number;
  }
> = {
  balanced: {
    level2Categories: 3,
    level2TermsPerCategory: 5,
    level3Categories: 3,
    level3TermsPerCategory: 5,
  },
  deep: {
    level2Categories: 5,
    level2TermsPerCategory: 10,
    level3Categories: 5,
    level3TermsPerCategory: 8,
  },
  maximum: {
    level2Categories: 8,
    level2TermsPerCategory: 15,
    level3Categories: 8,
    level3TermsPerCategory: 10,
  },
};

type Candidate = {
  item: MercadoLivreSearchItem;
  baseProduct: MercadoLivreSearchItem;
  foundBy: DeepSearchGeneratedQuery;
  occurrences: DeepSearchOccurrence[];
};

type ProgressCallback = (progress: DeepSearchProgress) => void;

type CategorySeed = {
  id: string;
  name: string | null;
  path: string | null;
  sourceLevel: DeepSearchQueryLevel;
  count: number;
  totalVisits: number;
  maxVisits: number;
};

type CategoryStats = {
  categoryId: string;
  name: string;
  path: string | null;
  sourceLevel: DeepSearchQueryLevel;
  termsUsed: Set<string>;
  scanned: number;
  uniqueItemKeys: Set<string>;
  totalVisits: number;
  maxVisits: number;
};

function clamp(value: number, min = 0, max = 100) {
  return Math.min(Math.max(value, min), max);
}

function roundScore(value: number) {
  return Math.round(clamp(value));
}

function compactText(value: string | null | undefined) {
  if (!value) return '';
  return value.replace(/\s+/g, ' ').trim();
}

function normalized(value: string | null | undefined) {
  return normalizeMercadoLivreSearchText(compactText(value));
}

function uniqueStrings(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const result: string[] = [];

  values.forEach((value) => {
    const compacted = compactText(value);
    if (!compacted) return;
    const key = normalized(compacted);
    if (!key || seen.has(key)) return;
    seen.add(key);
    result.push(compacted);
  });

  return result;
}

function titleWords(title: string) {
  return normalized(title)
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 2 && !TITLE_NOISE_WORDS.has(word));
}

function simplifyTitle(title: string, maxWords: number) {
  return titleWords(title)
    .slice(0, maxWords)
    .join(' ');
}

function getAttributeValue(item: MercadoLivreSearchItem, ids: string[]) {
  const wanted = new Set(ids.map((id) => id.toUpperCase()));
  return item.attributes.find((attribute) => wanted.has(attribute.id.toUpperCase()))?.valueName || null;
}

function getStrongAttributeValues(item: MercadoLivreSearchItem) {
  return item.attributes
    .filter((attribute) => ATTRIBUTE_WEIGHTS.has(attribute.id.toUpperCase()))
    .map((attribute) => attribute.valueName)
    .filter(Boolean);
}

function buildQuery(
  queries: DeepSearchGeneratedQuery[],
  baseProduct: MercadoLivreSearchItem,
  query: string,
  mode: MercadoLivreSearchMode,
  priority: number,
  reason: string,
  meta: Partial<Pick<DeepSearchGeneratedQuery, 'level' | 'categoryId' | 'categoryName' | 'categoryPath' | 'trendRank'>> = {}
) {
  const normalizedQuery = compactText(query);
  if (!normalizedQuery) return;
  const level = meta.level || 'base';
  const categoryKey = meta.categoryId || baseProduct.categoryId || 'no-category';
  const queryKey = normalized(normalizedQuery)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'query';
  const sequence = queries.length + 1;

  const duplicate = queries.some(
    (entry) =>
      entry.mode === mode &&
      entry.baseProductId === baseProduct.id &&
      normalized(entry.query) === normalized(normalizedQuery) &&
      (entry.categoryId || null) === (meta.categoryId || null) &&
      (entry.level || 'base') === level
  );
  if (duplicate) return;

  queries.push({
    id: `${baseProduct.id}:${level}:${categoryKey}:${mode}:${meta.trendRank ?? sequence}:${queryKey}`,
    baseProductId: baseProduct.id,
    baseProductTitle: baseProduct.title,
    query: normalizedQuery,
    mode,
    priority,
    reason,
    level: meta.level || 'base',
    categoryId: meta.categoryId ?? null,
    categoryName: meta.categoryName ?? null,
    categoryPath: meta.categoryPath ?? null,
    trendRank: meta.trendRank ?? null,
  });
}

export function generateDeepSearchQueries(baseProducts: MercadoLivreSearchItem[], config: DeepSearchConfig) {
  const queries: DeepSearchGeneratedQuery[] = [];
  const perProductLimit = DEPTH_QUERY_LIMITS[config.depth] || DEPTH_QUERY_LIMITS.deep;

  for (const baseProduct of baseProducts) {
    const brand = compactText(baseProduct.brand || getAttributeValue(baseProduct, ['BRAND']));
    const model = compactText(baseProduct.model || getAttributeValue(baseProduct, ['MODEL', 'ALPHANUMERIC_MODEL']));
    const line = compactText(getAttributeValue(baseProduct, ['LINE']));
    const storage = compactText(getAttributeValue(baseProduct, ['INTERNAL_MEMORY']));
    const ram = compactText(getAttributeValue(baseProduct, ['RAM_MEMORY', 'MEMORY_RAM']));
    const categoryName = compactText(baseProduct.categoryInfo?.name);
    const shortTitle = simplifyTitle(baseProduct.title, 7);
    const shorterTitle = simplifyTitle(baseProduct.title, 5);
    const strongAttributes = getStrongAttributeValues(baseProduct).slice(0, 4).join(' ');
    const customTerms = uniqueStrings(config.customTerms || []).join(' ');

    const baseQueries = uniqueStrings([
      shortTitle,
      [brand, model, storage, ram].filter(Boolean).join(' '),
      [brand, model].filter(Boolean).join(' '),
      [model, storage, ram].filter(Boolean).join(' '),
      [brand, line, model].filter(Boolean).join(' '),
      [categoryName, brand, model].filter(Boolean).join(' '),
      shorterTitle,
      [brand, strongAttributes].filter(Boolean).join(' '),
      [model, customTerms].filter(Boolean).join(' '),
      [brand, customTerms].filter(Boolean).join(' '),
    ]).slice(0, perProductLimit);

    baseQueries.forEach((query, index) => {
      buildQuery(queries, baseProduct, query, 'items', index + 1, getQueryReason(index));
      if (config.includeCatalogSearch && index < Math.min(4, perProductLimit)) {
        buildQuery(queries, baseProduct, query, 'catalog', index + 1, `Catálogo: ${getQueryReason(index)}`);
      }
    });
  }

  return queries.sort((left, right) => left.priority - right.priority || left.mode.localeCompare(right.mode));
}

function getQueryReason(index: number) {
  if (index === 0) return 'Título forte do produto base';
  if (index === 1) return 'Marca, modelo e especificações principais';
  if (index === 2) return 'Marca e modelo';
  if (index === 3) return 'Modelo com características técnicas';
  if (index === 4) return 'Linha e variação comercial';
  if (index === 5) return 'Categoria e identificação do produto';
  return 'Variação ampliada da busca';
}

function isSameBaseItem(candidate: MercadoLivreSearchItem, baseProduct: MercadoLivreSearchItem) {
  const candidateIds = new Set(
    [candidate.id, candidate.referenceItemId, candidate.catalogProductId].filter(Boolean)
  );
  return [baseProduct.id, baseProduct.referenceItemId, baseProduct.catalogProductId]
    .filter(Boolean)
    .some((id) => candidateIds.has(id));
}

function passesConfigFilters(item: MercadoLivreSearchItem, config: DeepSearchConfig) {
  if (!config.includeUsed && normalized(item.condition) === 'used') return false;
  if (typeof config.priceMin === 'number' && item.price !== null && item.price < config.priceMin) return false;
  if (typeof config.priceMax === 'number' && item.price !== null && item.price > config.priceMax) return false;
  return true;
}

function tokenOverlapScore(baseText: string, candidateText: string, maxScore: number) {
  const baseTokens = new Set(titleWords(baseText));
  const candidateTokens = new Set(titleWords(candidateText));
  if (baseTokens.size === 0 || candidateTokens.size === 0) return 0;

  let matches = 0;
  baseTokens.forEach((token) => {
    if (candidateTokens.has(token)) matches += 1;
  });

  return (matches / baseTokens.size) * maxScore;
}

function exactOrContainedScore(baseValue: string | null | undefined, candidateValue: string | null | undefined, maxScore: number) {
  const base = normalized(baseValue);
  const candidate = normalized(candidateValue);
  if (!base || !candidate) return 0;
  if (base === candidate) return maxScore;
  if (candidate.includes(base) || base.includes(candidate)) return maxScore * 0.7;
  return 0;
}

function attributeSimilarity(baseAttributes: MercadoLivreSearchAttribute[], candidateAttributes: MercadoLivreSearchAttribute[]) {
  let available = 0;
  let matched = 0;

  baseAttributes.forEach((baseAttribute) => {
    const weight = ATTRIBUTE_WEIGHTS.get(baseAttribute.id.toUpperCase());
    if (!weight) return;
    available += weight;

    const candidateAttribute = candidateAttributes.find(
      (attribute) => attribute.id.toUpperCase() === baseAttribute.id.toUpperCase()
    );
    if (!candidateAttribute) return;

    const baseValue = normalized(baseAttribute.valueName);
    const candidateValue = normalized(candidateAttribute.valueName);
    if (!baseValue || !candidateValue) return;
    if (baseValue === candidateValue) matched += weight;
    else if (baseValue.includes(candidateValue) || candidateValue.includes(baseValue)) matched += weight * 0.65;
  });

  return available > 0 ? (matched / available) * 20 : 0;
}

function priceSimilarity(basePrice: number | null, candidatePrice: number | null) {
  if (!basePrice || !candidatePrice) return 4;
  const delta = Math.abs(candidatePrice - basePrice) / basePrice;
  if (delta <= 0.1) return 10;
  if (delta <= 0.25) return 7;
  if (delta <= 0.45) return 4;
  return 1;
}

function hasFullShipping(item: MercadoLivreSearchItem) {
  return item.logisticType === 'fulfillment' || item.shippingTags.includes('fulfillment');
}

function getSellerReputationLabel(item: MercadoLivreSearchItem) {
  const seller = item.marketplaceData.seller as Record<string, unknown> | null;
  const reputation = seller && typeof seller === 'object' ? (seller.seller_reputation as Record<string, unknown>) : null;
  return compactText(
    (reputation?.power_seller_status as string | undefined) ||
      (reputation?.level_id as string | undefined) ||
      null
  ) || null;
}

function scoreSimilarity(baseProduct: MercadoLivreSearchItem, item: MercadoLivreSearchItem) {
  const baseBrand = baseProduct.brand || getAttributeValue(baseProduct, ['BRAND']);
  const itemBrand = item.brand || getAttributeValue(item, ['BRAND']);
  const baseModel = baseProduct.model || getAttributeValue(baseProduct, ['MODEL', 'ALPHANUMERIC_MODEL']);
  const itemModel = item.model || getAttributeValue(item, ['MODEL', 'ALPHANUMERIC_MODEL']);
  const brand = exactOrContainedScore(baseBrand, itemBrand || item.title, 18);
  const model = exactOrContainedScore(baseModel, itemModel || item.title, 22);
  const category = baseProduct.categoryId && item.categoryId && baseProduct.categoryId === item.categoryId ? 12 : 0;
  const attributes = attributeSimilarity(baseProduct.attributes, item.attributes);
  const title = tokenOverlapScore(baseProduct.title, getMercadoLivreSearchableText(item), 28);
  const price = priceSimilarity(baseProduct.price, item.price);

  return {
    score: roundScore(brand + model + category + attributes + title + price),
    partial: { brand, model, category, attributes, title, price },
  };
}

function scorePerformance(baseProduct: MercadoLivreSearchItem, item: MercadoLivreSearchItem) {
  const visits = item.totalVisits || 0;
  const visitsScore = visits <= 0 ? 0 : Math.min(35, Math.log10(visits + 1) * 10);
  const offers = Math.min(15, (item.offersCount || 0) * 1.5);
  const logistics = (item.freeShipping ? 5 : 0) + (hasFullShipping(item) ? 7 : item.hasFlex ? 5 : 0);
  const seller = (item.officialStoreId || item.officialStoreName ? 8 : 0) + (getSellerReputationLabel(item) ? 7 : 0);
  const price =
    baseProduct.price && item.price
      ? item.price <= baseProduct.price
        ? 15
        : Math.max(0, 15 - ((item.price - baseProduct.price) / baseProduct.price) * 25)
      : 5;

  return {
    score: roundScore(visitsScore + offers + logistics + seller + price),
    partial: { visits: visitsScore, offers, logistics, seller },
  };
}

function priceDeltaPercent(basePrice: number | null, candidatePrice: number | null) {
  if (!basePrice || !candidatePrice) return null;
  return Math.round(((candidatePrice - basePrice) / basePrice) * 1000) / 10;
}

function buildScores(baseProduct: MercadoLivreSearchItem, item: MercadoLivreSearchItem, focus: DeepSearchConfig['focus']): DeepSearchScores {
  const similarity = scoreSimilarity(baseProduct, item);
  const performance = scorePerformance(baseProduct, item);
  const priceDelta = priceDeltaPercent(baseProduct.price, item.price);
  const priceOpportunity = priceDelta !== null && priceDelta < 0 ? Math.min(15, Math.abs(priceDelta) * 0.5) : 0;

  const opportunity =
    focus === 'similarity'
      ? similarity.score * 0.65 + performance.score * 0.25 + priceOpportunity
      : focus === 'performance'
        ? similarity.score * 0.35 + performance.score * 0.55 + priceOpportunity
        : similarity.score * 0.45 + performance.score * 0.45 + priceOpportunity;

  const breakdown: DeepSearchScoreBreakdown = {
    brand: roundScore(similarity.partial.brand),
    model: roundScore(similarity.partial.model),
    category: roundScore(similarity.partial.category),
    attributes: roundScore(similarity.partial.attributes),
    title: roundScore(similarity.partial.title),
    price: roundScore(similarity.partial.price),
    visits: roundScore(performance.partial.visits),
    offers: roundScore(performance.partial.offers),
    logistics: roundScore(performance.partial.logistics),
    seller: roundScore(performance.partial.seller),
  };

  return {
    similarity: similarity.score,
    performance: performance.score,
    opportunity: roundScore(opportunity),
    breakdown,
  };
}

function buildLabels(scores: DeepSearchScores, item: MercadoLivreSearchItem, occurrenceCount = 1) {
  const labels: string[] = [];
  if (scores.similarity >= 78) labels.push('Muito semelhante');
  else if (scores.similarity >= 62) labels.push('Semelhante');
  else labels.push('Relacionado');

  if (occurrenceCount >= 5) labels.push('Muito recorrente');
  else if (occurrenceCount >= 2) labels.push('Recorrente');
  if ((item.totalVisits || 0) >= 100) labels.push('Muitas visitas');
  if (scores.performance >= 70) labels.push('Boa performance');
  if (scores.opportunity >= 75) labels.push('Oportunidade provável');
  if (hasFullShipping(item)) labels.push('Full');
  else if (item.hasFlex) labels.push('Flex');
  if (item.officialStoreId || item.officialStoreName) labels.push('Loja oficial');

  return labels;
}

function buildReasons(baseProduct: MercadoLivreSearchItem, item: MercadoLivreSearchItem, scores: DeepSearchScores, occurrenceCount = 1) {
  const reasons: string[] = [];
  if (occurrenceCount > 1) reasons.push(`apareceu em ${occurrenceCount} buscas`);
  if (scores.breakdown.brand > 0) reasons.push('marca compatível');
  if (scores.breakdown.model > 0) reasons.push('modelo ou linha compatível');
  if (scores.breakdown.attributes >= 8) reasons.push('atributos técnicos próximos');
  if (baseProduct.categoryId && item.categoryId && baseProduct.categoryId === item.categoryId) reasons.push('mesma categoria');
  if ((item.totalVisits || 0) > 0) reasons.push(`${item.totalVisits} visitas na janela analisada`);
  if ((item.offersCount || 0) > 0) reasons.push(`${item.offersCount} ofertas no catálogo`);
  if (item.freeShipping || item.hasFlex || hasFullShipping(item)) reasons.push('logística competitiva');
  return reasons.slice(0, 5);
}

function buildSignals(baseProduct: MercadoLivreSearchItem, item: MercadoLivreSearchItem): DeepSearchMarketSignals {
  return {
    visits: item.totalVisits,
    offersCount: item.offersCount,
    sellerId: item.sellerId,
    sellerNickname: item.sellerNickname,
    sellerReputation: getSellerReputationLabel(item),
    isOfficialStore: Boolean(item.officialStoreId || item.officialStoreName),
    hasFull: hasFullShipping(item),
    hasFlex: item.hasFlex,
    freeShipping: item.freeShipping,
    priceDeltaPercent: priceDeltaPercent(baseProduct.price, item.price),
  };
}

function buildOccurrence(query: DeepSearchGeneratedQuery): DeepSearchOccurrence {
  return {
    queryId: query.id,
    query: query.query,
    mode: query.mode,
    reason: query.reason,
    level: query.level || 'base',
    categoryId: query.categoryId || null,
    categoryName: query.categoryName || null,
    trendRank: query.trendRank ?? null,
  };
}

function compactDeepSearchItem(item: MercadoLivreSearchItem): MercadoLivreSearchItem {
  const catalogOffers = item.marketplaceData.catalogOffers;

  return {
    ...item,
    questions: item.questions.slice(0, 3),
    shippingOptions: item.shippingOptions.slice(0, 3),
    categoryTrends: item.categoryTrends.slice(0, 10),
    marketplaceData: {
      ...item.marketplaceData,
      catalogOffers: catalogOffers
        ? {
            ...catalogOffers,
            results: catalogOffers.results.slice(0, 3),
          }
        : null,
      referenceItemDescription: null,
      categoryAttributes: null,
    },
  };
}

function buildResultItem(candidate: Candidate, config: DeepSearchConfig): DeepSearchResultItem | null {
  const scores = buildScores(candidate.baseProduct, candidate.item, config.focus);
  if (scores.similarity < config.similarityThreshold) return null;
  const occurrences = candidate.occurrences.length > 0 ? candidate.occurrences : [buildOccurrence(candidate.foundBy)];

  return {
    id: `${candidate.baseProduct.id}:${getSearchItemKey(candidate.item)}`,
    item: candidate.item,
    baseProduct: {
      id: candidate.baseProduct.id,
      title: candidate.baseProduct.title,
      thumbnail: candidate.baseProduct.thumbnail,
      price: candidate.baseProduct.price,
      catalogProductId: candidate.baseProduct.catalogProductId,
    },
    foundBy: {
      query: candidate.foundBy.query,
      mode: candidate.foundBy.mode,
      reason: candidate.foundBy.reason,
    },
    occurrences,
    occurrenceCount: occurrences.length,
    scores,
    signals: buildSignals(candidate.baseProduct, candidate.item),
    labels: buildLabels(scores, candidate.item, occurrences.length),
    reasons: buildReasons(candidate.baseProduct, candidate.item, scores, occurrences.length),
  };
}

function sortResults(results: DeepSearchResultItem[], focus: DeepSearchConfig['focus']) {
  const scoreKey = focus === 'similarity' ? 'similarity' : focus === 'performance' ? 'performance' : 'opportunity';
  return [...results].sort((left, right) => {
    const occurrenceDiff = right.occurrenceCount - left.occurrenceCount;
    if (occurrenceDiff !== 0) return occurrenceDiff;
    const scoreDiff = right.scores[scoreKey] - left.scores[scoreKey];
    if (scoreDiff !== 0) return scoreDiff;
    const visitsDiff = (right.signals.visits || 0) - (left.signals.visits || 0);
    if (visitsDiff !== 0) return visitsDiff;
    return right.scores.opportunity - left.scores.opportunity;
  });
}

function mergeConfig(config: DeepSearchConfig): DeepSearchConfig {
  return {
    ...DEFAULT_DEEP_SEARCH_CONFIG,
    ...config,
    baseProducts: Array.isArray(config.baseProducts) ? config.baseProducts : [],
    maxResultsPerQuery: 50,
    maxTotalResults: clamp(Number(config.maxTotalResults) || DEFAULT_DEEP_SEARCH_CONFIG.maxTotalResults, 50, 1000),
    similarityThreshold: clamp(Number(config.similarityThreshold) || DEFAULT_DEEP_SEARCH_CONFIG.similarityThreshold, 20, 95),
    customTerms: uniqueStrings(config.customTerms || []).slice(0, 6),
  };
}

function updateProgress(callback: ProgressCallback | undefined, progress: DeepSearchProgress, patch: Partial<DeepSearchProgress>) {
  const next = { ...progress, ...patch };
  callback?.(next);
  return next;
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error('Execução cancelada pelo usuário.');
}

async function withQueryTimeout<T>(promise: Promise<T>, query: DeepSearchGeneratedQuery, timeoutMs = 30000): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`Tempo limite excedido para "${query.query}".`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function executeQuery(accountId: string, query: DeepSearchGeneratedQuery, config: DeepSearchConfig) {
  const searchOptions = normalizeSearchOptions({
    includeVisits: false,
    visitsWindow: config.visitsWindow,
    includeStockInfo: false,
    includePriceRange: true,
    includeReviews: false,
    includeQuestions: false,
    includeShipping: false,
    includeTrends: false,
    includeCategoryInfo: false,
  });

  try {
    return await withQueryTimeout(
      runMercadoLivreCatalogSearch({
        accountId,
        query: query.query,
        mode: query.mode,
        limit: config.maxResultsPerQuery,
        offset: 0,
        searchOptions,
        lightweight: true,
      }),
      query
    );
  } catch (error) {
    if (query.mode !== 'items') throw error;
    const fallbackSearchOptions = normalizeSearchOptions({
      ...searchOptions,
      includeVisits: false,
      includeCategoryInfo: false,
    });
    return withQueryTimeout(
      runMercadoLivreCatalogSearch({
        accountId,
        query: query.query,
        mode: 'catalog',
        limit: config.maxResultsPerQuery,
        offset: 0,
        searchOptions: fallbackSearchOptions,
        lightweight: true,
      }),
      query
    );
  }
}

function setCategorySeed(seeds: Map<string, CategorySeed>, item: MercadoLivreSearchItem, sourceLevel: DeepSearchQueryLevel) {
  if (!item.categoryId) return;
  const visits = item.totalVisits || 0;
  const current = seeds.get(item.categoryId);
  if (current) {
    current.count += 1;
    current.totalVisits += visits;
    current.maxVisits = Math.max(current.maxVisits, visits);
    if (!current.name && item.categoryInfo?.name) current.name = item.categoryInfo.name;
    if (!current.path && item.categoryInfo?.path) current.path = item.categoryInfo.path;
    return;
  }

  seeds.set(item.categoryId, {
    id: item.categoryId,
    name: item.categoryInfo?.name || null,
    path: item.categoryInfo?.path || null,
    sourceLevel,
    count: 1,
    totalVisits: visits,
    maxVisits: visits,
  });
}

function sortedCategorySeeds(seeds: Map<string, CategorySeed>, limit: number, excluded = new Set<string>()) {
  return [...seeds.values()]
    .filter((seed) => !excluded.has(seed.id))
    .sort((left, right) => {
      const visitsDiff = right.maxVisits - left.maxVisits;
      if (visitsDiff !== 0) return visitsDiff;
      const totalVisitsDiff = right.totalVisits - left.totalVisits;
      if (totalVisitsDiff !== 0) return totalVisitsDiff;
      return right.count - left.count;
    })
    .slice(0, limit);
}

async function buildTrendQueriesForCategories(input: {
  accountId: string;
  categories: CategorySeed[];
  baseProducts: MercadoLivreSearchItem[];
  level: DeepSearchQueryLevel;
  termsPerCategory: number;
  priorityStart: number;
  trendsCache: Map<string, Awaited<ReturnType<typeof loadMercadoLivreCategoryTrends>>>;
}) {
  const queries: DeepSearchGeneratedQuery[] = [];

  for (const category of input.categories) {
    let trendData = input.trendsCache.get(category.id);
    if (!trendData) {
      trendData = await loadMercadoLivreCategoryTrends({
        accountId: input.accountId,
        categoryId: category.id,
      });
      input.trendsCache.set(category.id, trendData);
    }

    const categoryName = trendData.categoryInfo?.name || category.name || category.id;
    const categoryPath = trendData.categoryInfo?.path || category.path || null;
    const terms = trendData.trends.slice(0, input.termsPerCategory);
    const baseProduct =
      input.baseProducts.find((product) => product.categoryId === category.id) || input.baseProducts[0];
    if (!baseProduct) continue;

    terms.forEach((term, index) => {
      buildQuery(
        queries,
        baseProduct,
        term.keyword,
        'items',
        input.priorityStart + index,
        input.level === 'category_trend'
          ? `Termo mais buscado da categoria ${categoryName}`
          : `Termo de categoria derivada ${categoryName}`,
        {
          level: input.level,
          categoryId: category.id,
          categoryName,
          categoryPath,
          trendRank: term.rank || index + 1,
        }
      );
    });
  }

  return queries;
}

function updateCategoryStats(
  statsByCategory: Map<string, CategoryStats>,
  query: DeepSearchGeneratedQuery,
  items: MercadoLivreSearchItem[]
) {
  if (!query.categoryId) return;
  const current = statsByCategory.get(query.categoryId) || {
    categoryId: query.categoryId,
    name: query.categoryName || query.categoryId,
    path: query.categoryPath || null,
    sourceLevel: query.level || 'category_trend',
    termsUsed: new Set<string>(),
    scanned: 0,
    uniqueItemKeys: new Set<string>(),
    totalVisits: 0,
    maxVisits: 0,
  };

  current.termsUsed.add(query.query);
  current.scanned += items.length;
  items.forEach((item) => {
    current.uniqueItemKeys.add(getSearchItemKey(item));
    const visits = item.totalVisits || 0;
    current.totalVisits += visits;
    current.maxVisits = Math.max(current.maxVisits, visits);
  });
  statsByCategory.set(query.categoryId, current);
}

function buildCategoryInsights(statsByCategory: Map<string, CategoryStats>): DeepSearchCategoryInsight[] {
  return [...statsByCategory.values()]
    .map((stats) => ({
      categoryId: stats.categoryId,
      name: stats.name,
      path: stats.path,
      sourceLevel: stats.sourceLevel,
      termsUsed: stats.termsUsed.size,
      scanned: stats.scanned,
      uniqueCandidates: stats.uniqueItemKeys.size,
      totalVisits: stats.totalVisits,
      maxVisits: stats.maxVisits,
    }))
    .sort((left, right) => {
      const visitsDiff = right.maxVisits - left.maxVisits;
      if (visitsDiff !== 0) return visitsDiff;
      return right.totalVisits - left.totalVisits;
    });
}

export async function executeDeepSearch(
  accountId: string,
  rawConfig: DeepSearchConfig,
  onProgress?: ProgressCallback,
  signal?: AbortSignal
): Promise<DeepSearchResult> {
  const startedAt = new Date();
  throwIfAborted(signal);
  const config = mergeConfig(rawConfig);
  const sessionId = `ds_${startedAt.getTime()}_${Math.random().toString(36).slice(2, 9)}`;
  let progress: DeepSearchProgress = {
    phase: 'preparing',
    currentQuery: 0,
    totalQueries: 0,
    resultsFound: 0,
    matchedResults: 0,
    message: 'Preparando produtos base...',
    errors: [],
    startedAt: startedAt.toISOString(),
  };
  onProgress?.(progress);

  if (!accountId) throw new Error('Conta do Mercado Livre não informada.');
  if (config.baseProducts.length === 0) throw new Error('Selecione pelo menos um produto base para o Deep Search.');

  progress = updateProgress(onProgress, progress, {
    phase: 'generating_queries',
    message: 'Gerando variações de busca...',
  });

  const queries = generateDeepSearchQueries(config.baseProducts, config);
  const allQueries: DeepSearchGeneratedQuery[] = [...queries];
  progress = updateProgress(onProgress, progress, {
    phase: 'level_1',
    totalQueries: allQueries.length,
    message: `Nível 1: executando ${queries.length} buscas com produtos base...`,
  });

  const candidateByKey = new Map<string, Candidate>();
  const categorySeeds = new Map<string, CategorySeed>();
  const derivedCategorySeeds = new Map<string, CategorySeed>();
  const statsByCategory = new Map<string, CategoryStats>();
  const trendsCache = new Map<string, Awaited<ReturnType<typeof loadMercadoLivreCategoryTrends>>>();
  const termInsights: DeepSearchTermInsight[] = [];
  const queryResults: DeepSearchQueryResult[] = [];
  const executedCategoryIds = new Set<string>();
  const limits = EXPLORATION_LIMITS[config.depth] || EXPLORATION_LIMITS.deep;
  let totalItemsScanned = 0;
  let totalOccurrences = 0;
  let executedQueries = 0;
  let account: MercadoLivreSearchResponse['account'] | null = null;

  config.baseProducts.forEach((baseProduct) => setCategorySeed(categorySeeds, baseProduct, 'base'));

  async function runQueryQueue(queue: DeepSearchGeneratedQuery[], phase: DeepSearchProgress['phase'], label: string) {
    for (const query of queue) {
      throwIfAborted(signal);
      const baseProduct = config.baseProducts.find((product) => product.id === query.baseProductId);
      if (!baseProduct) continue;
      executedQueries += 1;

      progress = updateProgress(onProgress, progress, {
        phase,
        currentQuery: executedQueries,
        totalQueries: allQueries.length,
        message: `${label}: buscando "${query.query}"...`,
      });

      try {
        const response = await executeQuery(accountId, query, config);
        throwIfAborted(signal);
        account = response.account;
        totalItemsScanned += response.results.length;

        const uniqueInQuery = new Set<string>();
        const consideredItems: DeepSearchConsideredItem[] = [];
        let queryVisits = 0;
        let acceptedCandidates = 0;
        const occurrence = buildOccurrence(query);

        if (query.level === 'category_trend' || query.level === 'derived_category_trend') {
          updateCategoryStats(statsByCategory, query, response.results);
        }

        for (const item of response.results) {
          const itemKey = getSearchItemKey(item);
          queryVisits += item.totalVisits || 0;
          if (query.level === 'base') {
            setCategorySeed(categorySeeds, item, 'category_trend');
          } else if (query.level === 'category_trend') {
            setCategorySeed(derivedCategorySeeds, item, 'derived_category_trend');
          }

          let skippedReason: DeepSearchConsideredItem['skippedReason'] = null;
          let occurrenceNumber = 0;
          if (isSameBaseItem(item, baseProduct)) {
            skippedReason = 'base_product';
          } else if (!passesConfigFilters(item, config)) {
            skippedReason = 'filters';
          }

          if (skippedReason) {
            consideredItems.push({
              itemKey,
              item: compactDeepSearchItem(item),
              accepted: false,
              skippedReason,
              occurrenceNumber,
            });
            continue;
          }

          const key = `${baseProduct.id}:${itemKey}`;
          uniqueInQuery.add(key);
          totalOccurrences += 1;
          acceptedCandidates += 1;
          const current = candidateByKey.get(key);
          if (current) {
            current.occurrences.push(occurrence);
            occurrenceNumber = current.occurrences.length;
            if (query.priority < current.foundBy.priority) {
              current.foundBy = query;
              current.item = item;
            }
          } else {
            candidateByKey.set(key, { item, baseProduct, foundBy: query, occurrences: [occurrence] });
            occurrenceNumber = 1;
          }

          consideredItems.push({
            itemKey,
            item: compactDeepSearchItem(item),
            accepted: true,
            skippedReason: null,
            occurrenceNumber,
          });
        }

        termInsights.push({
          queryId: query.id,
          term: query.query,
          level: query.level || 'base',
          categoryId: query.categoryId || baseProduct.categoryId || null,
          categoryName: query.categoryName || baseProduct.categoryInfo?.name || null,
          trendRank: query.trendRank ?? null,
          scanned: response.results.length,
          uniqueCandidates: uniqueInQuery.size,
          totalVisits: queryVisits,
        });

        queryResults.push({
          queryId: query.id,
          query: query.query,
          mode: query.mode,
          level: query.level || 'base',
          reason: query.reason,
          baseProductId: baseProduct.id,
          baseProductTitle: baseProduct.title,
          categoryId: query.categoryId || baseProduct.categoryId || null,
          categoryName: query.categoryName || baseProduct.categoryInfo?.name || null,
          trendRank: query.trendRank ?? null,
          scanned: response.results.length,
          uniqueCandidates: uniqueInQuery.size,
          acceptedCandidates,
          totalVisits: queryVisits,
          items: consideredItems,
        });

        progress = updateProgress(onProgress, progress, {
          resultsFound: totalItemsScanned,
          matchedResults: candidateByKey.size,
        });
      } catch (error) {
        progress = updateProgress(onProgress, progress, {
          errors: [
            ...progress.errors,
            `${query.query}: ${error instanceof Error ? error.message : 'falha na busca'}`,
          ],
        });
      }
    }
  }

  await runQueryQueue(queries, 'level_1', 'Nível 1');
  throwIfAborted(signal);

  const level2Categories = sortedCategorySeeds(categorySeeds, limits.level2Categories);
  level2Categories.forEach((category) => executedCategoryIds.add(category.id));

  progress = updateProgress(onProgress, progress, {
    phase: 'generating_queries',
    message: `Nível 2: carregando termos de ${level2Categories.length} categoria(s)...`,
  });

  const level2Queries = await buildTrendQueriesForCategories({
    accountId,
    categories: level2Categories,
    baseProducts: config.baseProducts,
    level: 'category_trend',
    termsPerCategory: limits.level2TermsPerCategory,
    priorityStart: 100,
    trendsCache,
  });
  allQueries.push(...level2Queries);

  progress = updateProgress(onProgress, progress, {
    phase: 'level_2',
    totalQueries: allQueries.length,
    message: `Nível 2: executando ${level2Queries.length} buscas termo a termo...`,
  });

  await runQueryQueue(level2Queries, 'level_2', 'Nível 2');
  throwIfAborted(signal);

  const level3Categories = sortedCategorySeeds(derivedCategorySeeds, limits.level3Categories, executedCategoryIds);
  level3Categories.forEach((category) => executedCategoryIds.add(category.id));

  progress = updateProgress(onProgress, progress, {
    phase: 'generating_queries',
    message: `Nível 3: carregando termos de ${level3Categories.length} categoria(s) derivada(s)...`,
  });

  const level3Queries = await buildTrendQueriesForCategories({
    accountId,
    categories: level3Categories,
    baseProducts: config.baseProducts,
    level: 'derived_category_trend',
    termsPerCategory: limits.level3TermsPerCategory,
    priorityStart: 200,
    trendsCache,
  });
  allQueries.push(...level3Queries);

  progress = updateProgress(onProgress, progress, {
    phase: 'level_3',
    totalQueries: allQueries.length,
    message: `Nível 3: aprofundando com ${level3Queries.length} buscas termo a termo...`,
  });

  await runQueryQueue(level3Queries, 'level_3', 'Nível 3');
  throwIfAborted(signal);

  const recurringProducts = Array.from(candidateByKey.values())
    .filter((candidate) => candidate.occurrences.length > 1)
    .map((candidate) => ({
      itemKey: getSearchItemKey(candidate.item),
      title: candidate.item.title,
      thumbnail: candidate.item.thumbnail,
      categoryId: candidate.item.categoryId,
      categoryName: candidate.item.categoryInfo?.name || null,
      occurrences: candidate.occurrences.length,
      visits: candidate.item.totalVisits,
      terms: uniqueStrings(candidate.occurrences.map((occurrence) => occurrence.query)).slice(0, 8),
    }))
    .sort((left, right) => {
      const occurrenceDiff = right.occurrences - left.occurrences;
      if (occurrenceDiff !== 0) return occurrenceDiff;
      return (right.visits || 0) - (left.visits || 0);
    })
    .slice(0, 20);

  progress = updateProgress(onProgress, progress, {
    phase: 'scoring',
    message: 'Calculando similaridade e performance...',
  });

  const scoredResults = Array.from(candidateByKey.values())
    .map((candidate) => buildResultItem(candidate, config))
    .filter((item): item is DeepSearchResultItem => Boolean(item));
  const results = sortResults(scoredResults, config.focus).slice(0, config.maxTotalResults);
  const completedAt = new Date();

  progress = updateProgress(onProgress, progress, {
    phase: 'completed',
    currentQuery: allQueries.length,
    totalQueries: allQueries.length,
    resultsFound: totalItemsScanned,
    matchedResults: results.length,
    message: 'Deep Search concluído.',
    completedAt: completedAt.toISOString(),
  });

  return {
    sessionId,
    account,
    config,
    progress,
    queries: allQueries,
    queryResults,
    results,
    insights: {
      categories: buildCategoryInsights(statsByCategory),
      terms: termInsights.sort((left, right) => {
        const visitsDiff = right.totalVisits - left.totalVisits;
        if (visitsDiff !== 0) return visitsDiff;
        return right.uniqueCandidates - left.uniqueCandidates;
      }),
      recurringProducts,
    },
    metadata: {
      totalQueries: allQueries.length,
      totalItemsScanned,
      uniqueCandidates: candidateByKey.size,
      totalOccurrences,
      matchedResults: results.length,
      categoriesExplored: executedCategoryIds.size,
      termsExplored: termInsights.length,
      executionTimeMs: completedAt.getTime() - startedAt.getTime(),
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
    },
  };
}
