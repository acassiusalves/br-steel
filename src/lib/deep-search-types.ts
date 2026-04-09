/**
 * @fileOverview Tipos TypeScript para a funcionalidade Deep Search
 *
 * Deep Search permite encontrar o máximo de anúncios para produtos
 * idênticos com as mesmas especificações técnicas no Mercado Livre.
 *
 * NOTA: Este arquivo contém apenas tipos TypeScript puros, sem dependências
 * de servidor. Os schemas Zod para validação ficam em deep-search-flows.ts
 */

import type { ProductResult, MlSearchResult } from './types';

// ============================================
// DNA DO PRODUTO (Extração por IA)
// ============================================

/**
 * DNA extraído de um produto - identificação única normalizada
 */
export interface ProductDNA {
  /** Marca normalizada (ex: "Xiaomi", "Samsung") */
  brand: string;
  /** Linha do produto (ex: "Redmi Note", "Galaxy S") */
  productLine: string;
  /** Número do modelo (ex: "15", "24") */
  modelNumber: string;
  /** Sufixo do modelo (ex: "Pro", "Ultra", "C") */
  modelSuffix: string | null;
  /** Capacidade de armazenamento (ex: "128GB", "256GB") */
  storage: string | null;
  /** Capacidade de RAM (ex: "8GB", "12GB") */
  ram: string | null;
  /** Cor do produto */
  color: string | null;
  /** Região/versão (ex: "Global", "India", "China") */
  region: string | null;
  /** Atributos-chave adicionais */
  keyAttributes: Record<string, string>;
  /** Scores de confiança */
  confidence: {
    overall: number;
    fields: Record<string, number>;
  };
}

/**
 * Entrada para extração de DNA do produto
 */
export interface ExtractProductDNAInput {
  title: string;
  brand?: string;
  model?: string;
  attributes: Array<{
    id: string;
    name: string;
    value_name: string | null;
  }>;
}

/**
 * Saída da extração de DNA (pode ter campos opcionais vindos da IA)
 */
export interface ExtractProductDNAOutput {
  brand?: string;
  productLine?: string;
  modelNumber?: string;
  modelSuffix?: string | null;
  storage?: string | null;
  ram?: string | null;
  color?: string | null;
  region?: string | null;
  keyAttributes?: Record<string, string>;
  confidence?: {
    overall?: number;
    fields?: Record<string, number>;
  };
}

// ============================================
// ESTRATÉGIAS DE BUSCA (Geração por IA)
// ============================================

/**
 * Query de busca gerada pela IA
 */
export interface SearchQuery {
  /** Query de busca */
  query: string;
  /** Precisão esperada (0-100) */
  expectedPrecision: number;
  /** Recall esperado (0-100) */
  expectedRecall: number;
  /** Prioridade de execução (menor = mais importante) */
  priority: number;
  /** Justificativa da query */
  rationale: string;
}

/**
 * Estratégia de busca completa para um produto
 */
export interface SearchStrategy {
  /** DNA do produto base */
  productDNA: ProductDNA;
  /** Queries geradas */
  queries: SearchQuery[];
  /** Estimativa total de resultados esperados */
  totalExpectedResults: number;
}

/**
 * Entrada para geração de estratégia de busca
 */
export interface GenerateSearchStrategyInput {
  productDNA: ProductDNA;
}

/**
 * Saída da geração de estratégia (pode ter campos opcionais vindos da IA)
 */
export interface GenerateSearchStrategyOutput {
  queries?: Array<{
    query?: string;
    expectedPrecision?: number;
    expectedRecall?: number;
    priority?: number;
    rationale?: string;
  }>;
  totalExpectedResults?: number;
}

// ============================================
// VALIDAÇÃO DE MATCH (IA)
// ============================================

/**
 * Resultado de validação de match
 */
export type MatchVerdict = 'MATCH' | 'PROBABLE_MATCH' | 'NO_MATCH';

/**
 * Resultado da validação de um produto candidato
 */
export interface MatchValidationResult {
  /** Veredicto final */
  verdict: MatchVerdict;
  /** Score de confiança (0-100) */
  confidence: number;
  /** Razão do veredicto */
  reasoning: string;
  /** Detalhes de comparação */
  comparison: {
    brandMatch: 'exact' | 'close' | 'different';
    modelMatch: 'exact' | 'variant' | 'different';
    storageMatch: 'exact' | 'unspecified' | 'different';
    ramMatch: 'exact' | 'unspecified' | 'different';
  };
}

/**
 * Entrada para validação de match
 */
export interface ValidateMatchInput {
  baseProductDNA: ProductDNA;
  candidateTitle: string;
  candidateAttributes: Array<{
    id: string;
    name: string;
    value_name: string | null;
  }>;
}

/**
 * Saída da validação de match (pode ter campos opcionais vindos da IA)
 */
export interface ValidateMatchOutput {
  verdict?: MatchVerdict;
  confidence?: number;
  reasoning?: string;
  comparison?: {
    brandMatch?: 'exact' | 'close' | 'different';
    modelMatch?: 'exact' | 'variant' | 'different';
    storageMatch?: 'exact' | 'unspecified' | 'different';
    ramMatch?: 'exact' | 'unspecified' | 'different';
  };
}

// ============================================
// CONFIGURAÇÃO DO DEEP SEARCH
// ============================================

/**
 * Configuração para execução do Deep Search
 */
export interface DeepSearchConfig {
  /** Produtos base selecionados */
  baseProducts: MlSearchResult[];
  /** Máximo de resultados por query (default: 50) */
  maxResultsPerQuery: number;
  /** Máximo de resultados totais (default: 500) */
  maxTotalResults: number;
  /** Threshold de confiança para aceitar match (default: 0.8) */
  confidenceThreshold: number;
  /** Incluir dados de enriquecimento */
  includeEnrichment: boolean;
}

/**
 * Configuração padrão do Deep Search
 */
export const DEFAULT_DEEP_SEARCH_CONFIG: Omit<DeepSearchConfig, 'baseProducts'> = {
  maxResultsPerQuery: 50,
  maxTotalResults: 500,
  confidenceThreshold: 0.8,
  includeEnrichment: true,
};

// ============================================
// PROGRESSO E STATUS
// ============================================

/**
 * Fases do Deep Search
 */
export type DeepSearchPhase =
  | 'idle'
  | 'extracting_dna'
  | 'generating_strategies'
  | 'searching'
  | 'matching'
  | 'aggregating'
  | 'completed'
  | 'failed'
  | 'cancelled';

/**
 * Progresso do Deep Search
 */
export interface DeepSearchProgress {
  /** Fase atual */
  phase: DeepSearchPhase;
  /** Query atual (quando em fase 'searching') */
  currentQuery: number;
  /** Total de queries */
  totalQueries: number;
  /** Resultados encontrados até agora */
  resultsFound: number;
  /** Resultados validados (matches) */
  matchedResults: number;
  /** Mensagem de status */
  message: string;
  /** Erros encontrados */
  errors: string[];
  /** Timestamp de início */
  startedAt?: string;
  /** Timestamp de conclusão */
  completedAt?: string;
}

/**
 * Progresso inicial
 */
export const INITIAL_DEEP_SEARCH_PROGRESS: DeepSearchProgress = {
  phase: 'idle',
  currentQuery: 0,
  totalQueries: 0,
  resultsFound: 0,
  matchedResults: 0,
  message: '',
  errors: [],
};

// ============================================
// RESULTADOS AGREGADOS
// ============================================

/**
 * Item individual encontrado
 */
export interface DeepSearchItem {
  /** ID do item no ML */
  itemId: string;
  /** ID do vendedor */
  sellerId: number;
  /** Nickname do vendedor */
  sellerNickname: string;
  /** Preço do item */
  price: number;
  /** Tipo de listagem */
  listingType: 'gold_special' | 'gold_pro';
  /** Visitas (se disponível) */
  visits?: number;
  /** É loja oficial? */
  isOfficialStore: boolean;
  /** Quantidade disponível */
  availableQuantity: number;
  /** Link permanente */
  permalink?: string;
  /** Thumbnail */
  thumbnail?: string;
  /** Query que encontrou este item */
  foundByQuery: string;
  /** Confiança do match */
  matchConfidence: number;
}

/**
 * Resultado agregado por produto
 */
export interface AggregatedDeepSearchResult {
  /** ID único (catalog_product_id ou hash) */
  uniqueId: string;
  /** DNA do produto */
  productDNA: ProductDNA;
  /** Nome do produto */
  productName: string;
  /** Thumbnail */
  thumbnail?: string;
  /** Todos os itens encontrados */
  items: DeepSearchItem[];
  /** Estatísticas agregadas */
  stats: {
    /** Total de anúncios */
    totalListings: number;
    /** Vendedores únicos */
    uniqueSellers: number;
    /** Faixa de preço */
    priceRange: {
      min: number;
      max: number;
      avg: number;
    };
    /** Total de visitas */
    totalVisits: number;
    /** Lojas oficiais */
    officialStoreCount: number;
    /** Melhor preço clássico */
    bestClassicPrice?: number;
    /** Melhor preço premium */
    bestPremiumPrice?: number;
  };
  /** Confiança média do match */
  averageMatchConfidence: number;
}

/**
 * Resultado completo do Deep Search
 */
export interface DeepSearchResult {
  /** ID da sessão */
  sessionId: string;
  /** Configuração usada */
  config: DeepSearchConfig;
  /** Progresso final */
  progress: DeepSearchProgress;
  /** Resultados agregados */
  results: AggregatedDeepSearchResult[];
  /** Metadados da execução */
  metadata: {
    /** Total de queries executadas */
    totalQueries: number;
    /** Total de itens escaneados */
    totalItemsScanned: number;
    /** Total de matches únicos */
    uniqueMatches: number;
    /** Tempo de execução (ms) */
    executionTimeMs: number;
    /** Timestamp de início */
    startedAt: string;
    /** Timestamp de conclusão */
    completedAt: string;
  };
}

// ============================================
// SESSÃO DO DEEP SEARCH (FIRESTORE)
// ============================================

/**
 * Sessão de Deep Search salva no Firestore
 */
export interface DeepSearchSession {
  /** ID da sessão */
  id: string;
  /** ID do usuário */
  userId: string;
  /** Status da sessão */
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  /** Produtos base (simplificados) */
  baseProducts: Array<{
    id: string;
    name: string;
    catalog_product_id: string;
    thumbnail?: string;
  }>;
  /** Configuração */
  config: Omit<DeepSearchConfig, 'baseProducts'>;
  /** Progresso */
  progress: DeepSearchProgress;
  /** Resumo dos resultados */
  resultsSummary?: {
    totalFound: number;
    uniqueProducts: number;
    executionTimeMs: number;
  };
  /** Erros */
  errors: Array<{
    timestamp: string;
    phase: DeepSearchPhase;
    message: string;
  }>;
  /** Timestamps */
  createdAt: string;
  updatedAt: string;
}

// ============================================
// RATE LIMITING
// ============================================

/**
 * Configuração de rate limiting
 */
export interface RateLimitConfig {
  /** Requests paralelos */
  concurrency: number;
  /** Delay entre batches (ms) */
  batchDelayMs: number;
  /** Max requests por minuto */
  maxRequestsPerMinute: number;
  /** Delay em caso de retry (ms) */
  retryDelayMs: number;
  /** Máximo de retries */
  maxRetries: number;
}

/**
 * Configuração padrão de rate limiting
 */
export const DEFAULT_RATE_LIMIT_CONFIG: RateLimitConfig = {
  concurrency: 8,
  batchDelayMs: 100,
  maxRequestsPerMinute: 500,
  retryDelayMs: 1000,
  maxRetries: 3,
};
