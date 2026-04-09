/**
 * Utilitários para dados do Mercado Livre
 * Este arquivo contém funções puras (não async) que podem ser usadas tanto no cliente quanto no servidor
 */

// ============================================
// MAPEAMENTO DE FAIXAS DE ESTOQUE
// ============================================

/**
 * Tabela de faixas de estoque do Mercado Livre
 * O available_quantity retorna valores referenciais, não o número exato
 */
export const STOCK_RANGES: Record<number, { min: number; max: number; label: string }> = {
  1: { min: 1, max: 50, label: '1-50' },
  50: { min: 51, max: 100, label: '51-100' },
  100: { min: 101, max: 150, label: '101-150' },
  150: { min: 151, max: 200, label: '151-200' },
  200: { min: 201, max: 250, label: '201-250' },
  250: { min: 251, max: 500, label: '251-500' },
  500: { min: 501, max: 5000, label: '501-5000' },
};

/**
 * Converte o available_quantity retornado pela API para uma faixa legível
 * @param availableQuantity - Valor retornado pela API (1, 50, 100, 150, 200, 250, 500)
 * @returns Objeto com min, max e label da faixa
 */
export function getStockRange(availableQuantity: number): { min: number; max: number; label: string } {
  // Procura a faixa correspondente
  const range = STOCK_RANGES[availableQuantity];

  if (range) {
    return range;
  }

  // Se não encontrou faixa exata, tenta encontrar a mais próxima
  const keys = Object.keys(STOCK_RANGES).map(Number).sort((a, b) => a - b);

  // Se for menor que 1, retorna a primeira faixa
  if (availableQuantity < 1) {
    return { min: 0, max: 0, label: 'Sem estoque' };
  }

  // Encontra a faixa onde o valor se encaixa
  for (let i = keys.length - 1; i >= 0; i--) {
    if (availableQuantity >= keys[i]) {
      return STOCK_RANGES[keys[i]];
    }
  }

  // Fallback para a primeira faixa
  return STOCK_RANGES[1];
}

/**
 * Retorna um nível de estoque para uso em badges/indicadores visuais
 * @param availableQuantity - Valor retornado pela API
 * @returns 'none' | 'low' | 'medium' | 'high' | 'very_high'
 */
export function getStockLevel(availableQuantity: number): 'none' | 'low' | 'medium' | 'high' | 'very_high' {
  if (availableQuantity <= 0) return 'none';
  if (availableQuantity <= 1) return 'low';      // 1-50 unidades
  if (availableQuantity <= 100) return 'medium'; // 51-150 unidades
  if (availableQuantity <= 250) return 'high';   // 151-500 unidades
  return 'very_high';                             // 501+ unidades
}

// ============================================
// MAPEAMENTO DE TIPOS DE FRETE
// ============================================

export const FREIGHT_MAP: Record<string, string> = {
  "drop_off": "Correios",
  "xd_drop_off": "Correios",
  "xd_pick_up": "Correios",
  "fulfillment": "Full ML",
  "cross_docking": "Agência ML",
  "pick_up": "Retirada",
  "prepaid": "Frete pré-pago",
  "self_service": "Sem Mercado Envios",
  "custom": "A combinar"
};

export function getShippingLabel(logisticType: string): string {
  return FREIGHT_MAP[logisticType] || logisticType || 'N/A';
}

// ============================================
// MAPEAMENTO DE TIPOS DE LISTAGEM
// ============================================

export const LISTING_TYPE_MAP: Record<string, string> = {
  "gold_special": "Clássico",
  "gold_pro": "Premium"
};

export function getListingTypeLabel(listingTypeId: string): string {
  return LISTING_TYPE_MAP[listingTypeId] || listingTypeId || 'N/A';
}

// ============================================
// HELPERS DE ENRIQUECIMENTO
// ============================================

/**
 * Tipo para dados enriquecidos de produto
 */
export interface EnrichedProductData {
  totalVisits?: number;
  stockRange?: { min: number; max: number; label: string };
  stockLevel?: 'none' | 'low' | 'medium' | 'high' | 'very_high';
  competitorCount?: number;
  priceRange?: { min: number; max: number; avg: number };
  ratingAverage?: number;
  reviewsCount?: number;
}

/**
 * Prepara estrutura de produtos para enriquecimento a partir do resultado da busca
 */
export function prepareCatalogProductsForEnrichment(
  catalogProducts: any[],
  offersByCatalogId: Map<string, any[]>
): Array<{
  id: string;
  items: Array<{
    id: string;
    seller_id: number;
    price: number;
    available_quantity: number;
    listing_type_id: string;
  }>;
}> {
  return catalogProducts.map(p => ({
    id: p.id,
    items: (offersByCatalogId.get(p.id) || []).map((item: any) => ({
      // A API /products/{id}/items retorna item_id, não id
      id: item.item_id || item.id,
      seller_id: item.seller_id,
      price: item.price,
      available_quantity: item.available_quantity || 0,
      listing_type_id: item.listing_type_id
    }))
  }));
}

/**
 * Aplica dados enriquecidos ao resultado da busca
 */
export function applyEnrichmentToResults(
  results: any[],
  enrichmentData: Map<string, EnrichedProductData>
): any[] {
  return results.map(result => {
    const enriched = enrichmentData.get(result.id || result.catalog_product_id);
    if (!enriched) return result;

    return {
      ...result,
      totalVisits: enriched.totalVisits,
      stockRange: enriched.stockRange,
      stockLevel: enriched.stockLevel,
      competitorCount: enriched.competitorCount,
      priceRange: enriched.priceRange,
      ratingAverage: enriched.ratingAverage,
      reviewsCount: enriched.reviewsCount
    };
  });
}
