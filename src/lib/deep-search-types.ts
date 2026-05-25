/**
 * Tipos do Deep Search de mercado.
 *
 * O objetivo desta versão é descobrir anúncios e catálogos semelhantes aos
 * produtos base, priorizando sinais comerciais como visitas, oferta, logística
 * e competitividade de preço.
 */

import type {
  MercadoLivreSearchItem,
  MercadoLivreSearchMode,
  MercadoLivreVisitsWindow,
} from '@/types/mercado-livre-catalog-search';

export type DeepSearchFocus = 'similarity' | 'performance' | 'opportunity';
export type DeepSearchDepth = 'balanced' | 'deep' | 'maximum';
export type DeepSearchQueryLevel = 'base' | 'category_trend' | 'derived_category_trend';

export interface DeepSearchConfig {
  baseProducts: MercadoLivreSearchItem[];
  depth: DeepSearchDepth;
  focus: DeepSearchFocus;
  maxResultsPerQuery: number;
  maxTotalResults: number;
  similarityThreshold: number;
  includeEnrichment: boolean;
  includeCatalogSearch: boolean;
  includeUsed: boolean;
  visitsWindow: MercadoLivreVisitsWindow;
  priceMin?: number | null;
  priceMax?: number | null;
  customTerms?: string[];
}

export const DEFAULT_DEEP_SEARCH_CONFIG: Omit<DeepSearchConfig, 'baseProducts'> = {
  depth: 'deep',
  focus: 'opportunity',
  maxResultsPerQuery: 50,
  maxTotalResults: 300,
  similarityThreshold: 55,
  includeEnrichment: true,
  includeCatalogSearch: true,
  includeUsed: false,
  visitsWindow: 7,
  priceMin: null,
  priceMax: null,
  customTerms: [],
};

export type DeepSearchPhase =
  | 'idle'
  | 'preparing'
  | 'generating_queries'
  | 'level_1'
  | 'level_2'
  | 'level_3'
  | 'searching'
  | 'scoring'
  | 'completed'
  | 'failed';

export interface DeepSearchProgress {
  phase: DeepSearchPhase;
  currentQuery: number;
  totalQueries: number;
  resultsFound: number;
  matchedResults: number;
  message: string;
  errors: string[];
  startedAt?: string;
  completedAt?: string;
}

export const INITIAL_DEEP_SEARCH_PROGRESS: DeepSearchProgress = {
  phase: 'idle',
  currentQuery: 0,
  totalQueries: 0,
  resultsFound: 0,
  matchedResults: 0,
  message: '',
  errors: [],
};

export interface DeepSearchGeneratedQuery {
  id: string;
  baseProductId: string;
  baseProductTitle: string;
  query: string;
  mode: MercadoLivreSearchMode;
  priority: number;
  reason: string;
  level?: DeepSearchQueryLevel;
  categoryId?: string | null;
  categoryName?: string | null;
  categoryPath?: string | null;
  trendRank?: number | null;
}

export interface DeepSearchOccurrence {
  queryId: string;
  query: string;
  mode: MercadoLivreSearchMode;
  reason: string;
  level: DeepSearchQueryLevel;
  categoryId: string | null;
  categoryName: string | null;
  trendRank: number | null;
}

export type DeepSearchSkippedReason = 'base_product' | 'filters' | null;

export interface DeepSearchConsideredItem {
  itemKey: string;
  item: MercadoLivreSearchItem;
  accepted: boolean;
  skippedReason: DeepSearchSkippedReason;
  occurrenceNumber: number;
}

export interface DeepSearchQueryResult {
  queryId: string;
  query: string;
  mode: MercadoLivreSearchMode;
  level: DeepSearchQueryLevel;
  reason: string;
  baseProductId: string;
  baseProductTitle: string;
  categoryId: string | null;
  categoryName: string | null;
  trendRank: number | null;
  scanned: number;
  uniqueCandidates: number;
  acceptedCandidates: number;
  totalVisits: number;
  items: DeepSearchConsideredItem[];
}

export interface DeepSearchScoreBreakdown {
  brand: number;
  model: number;
  category: number;
  attributes: number;
  title: number;
  price: number;
  visits: number;
  offers: number;
  logistics: number;
  seller: number;
}

export interface DeepSearchScores {
  similarity: number;
  performance: number;
  opportunity: number;
  breakdown: DeepSearchScoreBreakdown;
}

export interface DeepSearchMarketSignals {
  visits: number | null;
  offersCount: number | null;
  sellerId: number | null;
  sellerNickname: string | null;
  sellerReputation: string | null;
  isOfficialStore: boolean;
  hasFull: boolean;
  hasFlex: boolean;
  freeShipping: boolean;
  priceDeltaPercent: number | null;
}

export interface DeepSearchResultItem {
  id: string;
  item: MercadoLivreSearchItem;
  baseProduct: {
    id: string;
    title: string;
    thumbnail: string | null;
    price: number | null;
    catalogProductId: string | null;
  };
  foundBy: {
    query: string;
    mode: MercadoLivreSearchMode;
    reason: string;
  };
  occurrences: DeepSearchOccurrence[];
  occurrenceCount: number;
  scores: DeepSearchScores;
  signals: DeepSearchMarketSignals;
  labels: string[];
  reasons: string[];
}

export interface DeepSearchTermInsight {
  queryId: string;
  term: string;
  level: DeepSearchQueryLevel;
  categoryId: string | null;
  categoryName: string | null;
  trendRank: number | null;
  scanned: number;
  uniqueCandidates: number;
  totalVisits: number;
}

export interface DeepSearchCategoryInsight {
  categoryId: string;
  name: string;
  path: string | null;
  sourceLevel: DeepSearchQueryLevel;
  termsUsed: number;
  scanned: number;
  uniqueCandidates: number;
  totalVisits: number;
  maxVisits: number;
}

export interface DeepSearchRecurringProductInsight {
  itemKey: string;
  title: string;
  thumbnail: string | null;
  categoryId: string | null;
  categoryName: string | null;
  occurrences: number;
  visits: number | null;
  terms: string[];
}

export interface DeepSearchInsights {
  categories: DeepSearchCategoryInsight[];
  terms: DeepSearchTermInsight[];
  recurringProducts: DeepSearchRecurringProductInsight[];
}

export interface DeepSearchSavedAnalysisSummary {
  analysisId: string;
  accountId: string;
  accountName: string | null;
  siteId: string | null;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  title: string;
  baseProductTitles: string[];
  focus: DeepSearchFocus;
  depth: DeepSearchDepth;
  visitsWindow: MercadoLivreVisitsWindow;
  totalQueries: number;
  totalItemsScanned: number;
  uniqueCandidates: number;
  totalOccurrences: number;
  matchedResults: number;
  categoriesExplored: number;
  termsExplored: number;
  executionTimeMs: number;
  topCategories: Array<{
    categoryId: string;
    name: string;
    termsUsed: number;
    uniqueCandidates: number;
    totalVisits: number;
  }>;
  createdAt: string;
  completedAt: string;
}

export interface DeepSearchSavedAnalysis {
  summary: DeepSearchSavedAnalysisSummary;
  result: DeepSearchResult;
}

export interface DeepSearchRequest {
  accountId: string;
  config: DeepSearchConfig;
}

export interface DeepSearchResult {
  sessionId: string;
  account: {
    accountId: string;
    accountName: string;
    siteId: string;
  } | null;
  config: DeepSearchConfig;
  progress: DeepSearchProgress;
  queries: DeepSearchGeneratedQuery[];
  queryResults: DeepSearchQueryResult[];
  results: DeepSearchResultItem[];
  insights: DeepSearchInsights;
  savedAnalysis?: DeepSearchSavedAnalysisSummary | null;
  metadata: {
    totalQueries: number;
    totalItemsScanned: number;
    uniqueCandidates: number;
    totalOccurrences: number;
    matchedResults: number;
    categoriesExplored: number;
    termsExplored: number;
    executionTimeMs: number;
    startedAt: string;
    completedAt: string;
  };
}

export interface PriceHistoryEntry {
  date: string;
  classicPrice: number | null;
  premiumPrice: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  avgPrice: number | null;
}
