'use server';

/**
 * Serviço Unificado de Enriquecimento de Dados do Mercado Livre
 *
 * Centraliza a lógica de buscar dados adicionais para produtos de catálogo:
 * - Visitas
 * - Estoque (faixas)
 * - Reputação dos vendedores
 * - Avaliações
 * - Dados de competição (Buy Box)
 * - Range de preços
 */

import {
  getMlToken,
  getItemsVisits,
  getSellersReputationCached,
  getItemsReviews,
  getCatalogCompetition,
  getBuyBoxStatus,
  getQuestionsFromMultipleItems,
  getShippingSimulation,
  getCategoryTrends,
  getCategoryInfo,
  type ItemVisits,
  type ItemReviews,
  type CompetitorData,
  type BuyBoxStatus
} from '@/services/mercadolivre';

import type {
  ProductQuestion,
  ShippingSimulationOption,
  CategoryTrendItem,
  CategoryInfoResult
} from '@/lib/types';

import { getStockRange, getStockLevel } from '@/lib/ml-utils';

// ============================================
// TIPOS
// ============================================

export interface EnrichmentOptions {
  includeVisits?: boolean;
  includeReputation?: boolean;
  includeReviews?: boolean;
  includeStockInfo?: boolean;
  includePriceRange?: boolean;
  includeCompetition?: boolean;
  includeBuyBox?: boolean;
  // Novos campos
  includeQuestions?: boolean;
  includeShipping?: boolean;
  shippingZipCode?: string;
  includeTrends?: boolean;
  includeCategoryInfo?: boolean;
}

export interface EnrichedProductData {
  // Visitas
  totalVisits?: number;

  // Estoque
  stockRange?: { min: number; max: number; label: string };
  stockLevel?: 'none' | 'low' | 'medium' | 'high' | 'very_high';

  // Competição
  competitorCount?: number;
  priceRange?: { min: number; max: number; avg: number };

  // Buy Box
  buyBoxStatus?: BuyBoxStatus;

  // Reviews
  ratingAverage?: number;
  reviewsCount?: number;

  // Reputação do vendedor winner
  reputation?: {
    nickname: string | null;
    level_id: string | null;
    power_seller_status: string | null;
    transactions_total: number;
  };

  // Perguntas (dos top 5 vendedores)
  questions?: ProductQuestion[];
  questionsCount?: number;

  // Simulação de frete
  shippingOptions?: ShippingSimulationOption[];
  cheapestShipping?: {
    cost: number;
    name: string;
    estimatedDays: number;
  };

  // Tendências da categoria
  categoryTrends?: CategoryTrendItem[];

  // Info da categoria
  categoryInfo?: {
    name: string;
    path: string; // Ex: "Celulares > Smartphones"
  };
}

export interface EnrichmentResult {
  success: boolean;
  data: Map<string, EnrichedProductData>;
  errors: string[];
  stats: {
    productsProcessed: number;
    visitsLoaded: number;
    reputationsLoaded: number;
    reviewsLoaded: number;
    questionsLoaded: number;
    shippingSimulated: number;
    timeMs: number;
  };
}

// ============================================
// SERVIÇO PRINCIPAL
// ============================================

/**
 * Enriquece dados de múltiplos produtos de catálogo
 *
 * @param catalogProducts - Array de produtos com estrutura { id, items: [...] }
 * @param options - Opções de enriquecimento
 * @param accountId - ID da conta para autenticação
 */
export async function enrichCatalogProducts(
  catalogProducts: Array<{
    id: string;
    items: Array<{
      id: string;
      seller_id: number;
      price: number;
      available_quantity: number;
      listing_type_id: string;
    }>;
  }>,
  options: EnrichmentOptions = {},
  accountId?: string
): Promise<EnrichmentResult> {
  const startTime = Date.now();
  const result: EnrichmentResult = {
    success: true,
    data: new Map(),
    errors: [],
    stats: {
      productsProcessed: 0,
      visitsLoaded: 0,
      reputationsLoaded: 0,
      reviewsLoaded: 0,
      questionsLoaded: 0,
      shippingSimulated: 0,
      timeMs: 0
    }
  };

  // Opções padrão
  const {
    includeVisits = true,
    includeReputation = true,
    includeReviews = false,
    includeStockInfo = true,
    includePriceRange = true,
    includeCompetition = false,
    includeBuyBox = false,
    includeQuestions = false,
    includeShipping = false,
    shippingZipCode = '',
    includeTrends = false,
    includeCategoryInfo = false
  } = options;

  try {
    // Busca token se necessário
    let token: string | null = null;
    if (accountId) {
      try {
        token = await getMlToken(accountId);
      } catch (e) {
        result.errors.push('Não foi possível obter token de autenticação');
      }
    }

    // Coleta todos os IDs necessários
    const allItemIds: string[] = [];
    const allSellerIds: number[] = [];
    const winnerItemIds: string[] = [];

    catalogProducts.forEach(product => {
      if (product.items && product.items.length > 0) {
        // Todos os items para visitas/reviews
        product.items.forEach(item => {
          allItemIds.push(item.id);
          if (item.seller_id) allSellerIds.push(item.seller_id);
        });

        // Winner (primeiro item ou menor preço)
        const winner = product.items.reduce((min, item) =>
          item.price < min.price ? item : min, product.items[0]
        );
        winnerItemIds.push(winner.id);
      }
    });

    console.log(`[enrichCatalogProducts] IDs coletados: ${allItemIds.length} items, ${winnerItemIds.length} winners`);
    if (winnerItemIds.length > 0) {
      console.log(`[enrichCatalogProducts] Primeiros 3 winners:`, winnerItemIds.slice(0, 3));
    }

    // NOTA: A API do Mercado Livre NÃO permite acessar o estoque (available_quantity)
    // de itens de outros vendedores. O endpoint /items/{id} retorna 403 Forbidden
    // para itens que não pertencem ao usuário autenticado.
    // O endpoint /products/{id}/items também não retorna o campo available_quantity.
    // Por isso, não buscamos estoque de concorrentes - apenas mostramos contagem de ofertas.
    const stockMap = new Map<string, number>();

    // Executa buscas em paralelo
    const [visitsResult, reputationResult, reviewsResult] = await Promise.all([
      // Visitas
      includeVisits && winnerItemIds.length > 0
        ? getItemsVisits(winnerItemIds, accountId)
        : { success: true, data: [] as ItemVisits[] },

      // Reputação
      includeReputation && token && allSellerIds.length > 0
        ? getSellersReputationCached(Array.from(new Set(allSellerIds)), token)
        : {},

      // Reviews
      includeReviews && winnerItemIds.length > 0
        ? getItemsReviews(winnerItemIds, accountId)
        : { success: true, data: [] as ItemReviews[] }
    ]);

    // Mapeia resultados por ID
    const visitsMap = new Map<string, number>(
      visitsResult.data.map((v: ItemVisits) => [v.itemId, v.totalVisits])
    );

    console.log(`[enrichCatalogProducts] Visitas obtidas: ${visitsResult.data.length}, success: ${visitsResult.success}`);
    if (visitsResult.data.length > 0) {
      console.log(`[enrichCatalogProducts] Amostra de visitas:`, visitsResult.data.slice(0, 3));
    }
    if (visitsResult.error) {
      console.error(`[enrichCatalogProducts] Erro na busca de visitas:`, visitsResult.error);
    }

    const reviewsMap = new Map<string, ItemReviews>(
      reviewsResult.data.map((r: ItemReviews) => [r.itemId, r])
    );

    result.stats.visitsLoaded = visitsResult.data.length;
    result.stats.reputationsLoaded = Object.keys(reputationResult).length;
    result.stats.reviewsLoaded = reviewsResult.data.length;

    // Processa cada produto
    for (const product of catalogProducts) {
      const enrichedData: EnrichedProductData = {};

      if (!product.items || product.items.length === 0) {
        result.data.set(product.id, enrichedData);
        continue;
      }

      // Encontra winner
      const winner = product.items.reduce((min, item) =>
        item.price < min.price ? item : min, product.items[0]
      );

      // Visitas do winner
      if (includeVisits) {
        const winnerVisits = visitsMap.get(winner.id);
        enrichedData.totalVisits = winnerVisits;

        // Debug para o primeiro produto
        if (result.stats.productsProcessed === 0) {
          console.log(`[enrichCatalogProducts] Debug primeiro produto:`, {
            productId: product.id,
            winnerId: winner.id,
            visitsFromMap: winnerVisits,
            mapSize: visitsMap.size,
            mapHasKey: visitsMap.has(winner.id)
          });
        }
      }

      // Estoque do winner (usa available_quantity buscado via /items/{id})
      // O valor é uma faixa referencial: 1=1-50, 50=51-100, 100=101-150, etc.
      if (includeStockInfo) {
        const availableQuantity = stockMap.get(winner.id) ?? 0;
        enrichedData.stockRange = getStockRange(availableQuantity);
        enrichedData.stockLevel = getStockLevel(availableQuantity);

        // Debug para o primeiro produto
        if (result.stats.productsProcessed === 0) {
          console.log(`[enrichCatalogProducts] Debug estoque primeiro produto:`, {
            productId: product.id,
            winnerId: winner.id,
            availableQuantity,
            stockRange: enrichedData.stockRange,
            stockLevel: enrichedData.stockLevel
          });
        }
      }

      // Range de preços
      if (includePriceRange && product.items.length > 0) {
        const prices = product.items.map(i => i.price).filter(p => p > 0);
        if (prices.length > 0) {
          enrichedData.priceRange = {
            min: Math.min(...prices),
            max: Math.max(...prices),
            avg: Math.round((prices.reduce((a, b) => a + b, 0) / prices.length) * 100) / 100
          };
        }
        enrichedData.competitorCount = product.items.length;
      }

      // Reputação do seller do winner
      if (includeReputation && winner.seller_id) {
        const sellerRep = reputationResult[winner.seller_id];
        if (sellerRep) {
          enrichedData.reputation = {
            nickname: sellerRep.nickname,
            level_id: sellerRep.level_id,
            power_seller_status: sellerRep.power_seller_status,
            transactions_total: sellerRep.transactions_total || 0
          };
        }
      }

      // Reviews do winner
      if (includeReviews) {
        const reviewData = reviewsMap.get(winner.id);
        if (reviewData) {
          enrichedData.ratingAverage = reviewData.rating_average;
          enrichedData.reviewsCount = reviewData.reviews_count;
        }
      }

      result.data.set(product.id, enrichedData);
      result.stats.productsProcessed++;
    }

    // ============================================
    // NOVOS ENRIQUECIMENTOS (por produto)
    // ============================================

    // Buscar perguntas dos top 5 vendedores de cada produto
    if (includeQuestions) {
      for (const product of catalogProducts) {
        if (!product.items || product.items.length === 0) continue;

        // Pega os top 5 itens por menor preço
        const top5Items = [...product.items]
          .sort((a, b) => a.price - b.price)
          .slice(0, 5)
          .map(i => i.id);

        const questionsResult = await getQuestionsFromMultipleItems(top5Items, accountId, 3);

        if (questionsResult.success && questionsResult.questions.length > 0) {
          const existingData = result.data.get(product.id) || {};
          result.data.set(product.id, {
            ...existingData,
            questions: questionsResult.questions,
            questionsCount: questionsResult.questions.length
          });
          result.stats.questionsLoaded += questionsResult.questions.length;
        }
      }
    }

    // Simular frete se CEP foi fornecido
    if (includeShipping && shippingZipCode) {
      for (const product of catalogProducts) {
        if (!product.items || product.items.length === 0) continue;

        // Usa o winner para simular frete
        const winner = product.items.reduce((min, item) =>
          item.price < min.price ? item : min, product.items[0]
        );

        const shippingResult = await getShippingSimulation(winner.id, shippingZipCode, accountId);

        if (shippingResult.success && shippingResult.options.length > 0) {
          const existingData = result.data.get(product.id) || {};

          // Encontra a opção mais barata
          const cheapest = shippingResult.options.reduce((min, opt) =>
            opt.cost < min.cost ? opt : min, shippingResult.options[0]
          );

          result.data.set(product.id, {
            ...existingData,
            shippingOptions: shippingResult.options,
            cheapestShipping: {
              cost: cheapest.cost,
              name: cheapest.name,
              estimatedDays: cheapest.estimated_delivery_time?.offset?.shipping || 0
            }
          });
          result.stats.shippingSimulated++;
        }
      }
    }

    // Buscar tendências e info da categoria (uma vez por categoria única)
    if (includeTrends || includeCategoryInfo) {
      // Coleta categorias únicas
      const categoryIds = new Set<string>();
      const productCategoryMap = new Map<string, string>(); // productId -> categoryId

      // Busca category_id do primeiro item de cada produto
      for (const product of catalogProducts) {
        if (product.items && product.items.length > 0) {
          const firstItem = product.items[0] as any;
          if (firstItem.category_id) {
            categoryIds.add(firstItem.category_id);
            productCategoryMap.set(product.id, firstItem.category_id);
          }
        }
      }

      // Cache de resultados por categoria
      const trendsCache = new Map<string, CategoryTrendItem[]>();
      const categoryInfoCache = new Map<string, CategoryInfoResult>();

      for (const categoryId of categoryIds) {
        // Tendências
        if (includeTrends) {
          const trendsResult = await getCategoryTrends(categoryId, accountId);
          if (trendsResult.success) {
            trendsCache.set(categoryId, trendsResult.trends);
          }
        }

        // Info da categoria
        if (includeCategoryInfo) {
          const infoResult = await getCategoryInfo(categoryId, accountId);
          if (infoResult.success) {
            categoryInfoCache.set(categoryId, infoResult);
          }
        }
      }

      // Aplica os dados aos produtos
      for (const product of catalogProducts) {
        const categoryId = productCategoryMap.get(product.id);
        if (!categoryId) continue;

        const existingData = result.data.get(product.id) || {};
        const updates: Partial<EnrichedProductData> = {};

        // Tendências
        const trends = trendsCache.get(categoryId);
        if (trends && trends.length > 0) {
          updates.categoryTrends = trends;
        }

        // Info da categoria
        const info = categoryInfoCache.get(categoryId);
        if (info && info.success) {
          const path = info.path_from_root.map(p => p.name).join(' > ');
          updates.categoryInfo = {
            name: info.name,
            path
          };
        }

        if (Object.keys(updates).length > 0) {
          result.data.set(product.id, { ...existingData, ...updates });
        }
      }
    }

    result.stats.timeMs = Date.now() - startTime;
    return result;

  } catch (e: any) {
    result.success = false;
    result.errors.push(e.message || 'Erro inesperado no enriquecimento');
    result.stats.timeMs = Date.now() - startTime;
    return result;
  }
}

/**
 * Enriquece um único produto de catálogo com dados completos de competição
 * Útil para visualização detalhada
 */
export async function enrichSingleProduct(
  catalogProductId: string,
  options: EnrichmentOptions = {},
  accountId?: string
): Promise<{
  success: boolean;
  data: EnrichedProductData | null;
  competitors?: CompetitorData[];
  error?: string;
}> {
  try {
    const {
      includeVisits = true,
      includeReputation = true,
      includeReviews = false,
      includeBuyBox = false
    } = options;

    // Busca dados completos de competição
    const competition = await getCatalogCompetition(
      catalogProductId,
      accountId,
      { includeVisits, includeReputation, includeReviews }
    );

    if (!competition.success) {
      return {
        success: false,
        data: null,
        error: competition.error
      };
    }

    const enrichedData: EnrichedProductData = {
      competitorCount: competition.totalCompetitors,
      priceRange: competition.lowestPrice !== null ? {
        min: competition.lowestPrice!,
        max: competition.highestPrice!,
        avg: competition.averagePrice!
      } : undefined
    };

    // Dados do winner
    if (competition.competitors.length > 0) {
      const winner = competition.competitors[0];
      enrichedData.totalVisits = winner.visits;
      enrichedData.stockRange = winner.stockRange;
      enrichedData.stockLevel = winner.stockLevel;

      if (winner.reputation) {
        enrichedData.reputation = {
          nickname: null, // Não está disponível em CompetitorData
          level_id: winner.reputation.level_id,
          power_seller_status: winner.reputation.power_seller_status,
          transactions_total: winner.reputation.transactions_total
        };
      }
    }

    // Buy Box status
    if (includeBuyBox) {
      const myItemIds: string[] = []; // Precisa ser passado como parâmetro
      enrichedData.buyBoxStatus = await getBuyBoxStatus(
        catalogProductId,
        myItemIds,
        accountId
      );
    }

    return {
      success: true,
      data: enrichedData,
      competitors: competition.competitors
    };

  } catch (e: any) {
    return {
      success: false,
      data: null,
      error: e.message || 'Erro inesperado'
    };
  }
}
