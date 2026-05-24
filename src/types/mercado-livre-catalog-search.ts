export type MercadoLivreSearchMode = 'items' | 'catalog';
export type MercadoLivreQueryStrategy = 'items_search' | 'catalog_search' | 'catalog_id' | 'item_id';
export type MercadoLivreVisitsWindow = 1 | 3 | 7 | 15 | 30;

export interface MercadoLivreAccountSummary {
  accountId: string;
  accountName: string;
  nickname: string | null;
  siteId: string;
  userId: string | number | null;
  connected: boolean;
  requiresReconnect: boolean;
  status: 'connected' | 'reconnect' | 'error' | 'disconnected' | 'unchecked';
}

export interface MercadoLivreSearchAttribute {
  id: string;
  name: string;
  valueName: string;
  valueId?: string | null;
}

export interface MercadoLivreSearchQuestion {
  id: string;
  text: string;
  status: string | null;
  dateCreated: string | null;
  itemId: string | null;
  sellerId: number | null;
  answer: {
    text: string | null;
    dateCreated: string | null;
  } | null;
}

export interface MercadoLivreSearchShippingOption {
  id: string;
  name: string;
  currencyId: string | null;
  listCost: number;
  cost: number;
  estimatedDeliveryDays: number | null;
  estimatedDeliveryDate: string | null;
}

export interface MercadoLivreSearchCheapestShipping {
  cost: number;
  name: string;
  estimatedDeliveryDays: number | null;
}

export interface MercadoLivreSearchCategoryTrend {
  keyword: string;
  url: string | null;
}

export interface MercadoLivreSearchCategoryInfo {
  id: string;
  name: string;
  path: string;
}

export type MercadoLivreShippingCostSource =
  | 'mercado_livre'
  | 'fixed_fee'
  | 'fallback_table'
  | 'not_requested'
  | 'unavailable';

export interface MercadoLivreFeeDetails {
  listingTypeId: string;
  currencyId: string | null;
  saleFeeAmount: number;
  saleFeePercentage: number;
  fixedFee: number;
  commissionAmount: number;
  listingFeeAmount: number;
  netAmount: number;
  shippingCost: number;
  shippingCostSource: MercadoLivreShippingCostSource;
  shippingError: string | null;
  totalFees: number;
  netAmountAfterShipping: number;
}

export interface MercadoLivreCatalogOffersSnapshot {
  total: number | null;
  retrieved: number;
  results: Record<string, unknown>[];
}

export interface MercadoLivreCompetitorReputation {
  levelId: string | null;
  powerSellerStatus: string | null;
  transactionsTotal: number | null;
}

export interface MercadoLivreCompetitor {
  itemId: string;
  sellerId: number | null;
  sellerNickname: string | null;
  price: number | null;
  availableQuantity: number | null;
  soldQuantity: number | null;
  listingTypeId: string | null;
  logisticType: string | null;
  shippingTags: string[];
  hasFlex: boolean;
  freeShipping: boolean;
  condition: string | null;
  permalink: string | null;
  officialStoreName: string | null;
  sellerCity: string | null;
  sellerState: string | null;
  reputation: MercadoLivreCompetitorReputation | null;
  visits: number | null;
  isBuyBoxWinner: boolean;
}

export interface MercadoLivreCompetitorsResponse {
  account: {
    accountId: string;
    accountName: string;
    siteId: string;
  };
  catalogProductId: string;
  totalCompetitors: number;
  winnerItemId: string | null;
  priceStats: {
    min: number | null;
    max: number | null;
    avg: number | null;
  };
  competitors: MercadoLivreCompetitor[];
}

export interface MercadoLivreVisitsRefreshEntry {
  itemKey: string;
  sourceType: 'item' | 'catalog';
  id: string;
  referenceItemId?: string | null;
  catalogProductId?: string | null;
  offerItemIds?: string[];
}

export interface MercadoLivreVisitsRefreshResult {
  itemKey: string;
  totalVisits: number;
}

export interface MercadoLivreVisitsRefreshResponse {
  account: {
    accountId: string;
    accountName: string;
    siteId: string;
  };
  days: MercadoLivreVisitsWindow;
  results: MercadoLivreVisitsRefreshResult[];
}

export interface MercadoLivreMarketplaceData {
  catalogProduct: Record<string, unknown> | null;
  catalogOffers: MercadoLivreCatalogOffersSnapshot | null;
  referenceOffer: Record<string, unknown> | null;
  referenceItem: Record<string, unknown> | null;
  referenceItemDescription: Record<string, unknown> | null;
  seller: Record<string, unknown> | null;
  category: Record<string, unknown> | null;
  categoryAttributes: Record<string, unknown>[] | null;
}

export interface MercadoLivreSearchOptions {
  includeVisits?: boolean;
  visitsWindow?: MercadoLivreVisitsWindow;
  includeStockInfo?: boolean;
  includePriceRange?: boolean;
  includeReviews?: boolean;
  includeQuestions?: boolean;
  includeShipping?: boolean;
  shippingZipCode?: string;
  includeTrends?: boolean;
  includeCategoryInfo?: boolean;
}

export interface MercadoLivreSearchItem {
  sourceType: 'item' | 'catalog';
  id: string;
  referenceItemId?: string | null;
  title: string;
  price: number | null;
  currencyId: string | null;
  thumbnail: string | null;
  permalink: string | null;
  condition: string | null;
  listingTypeId: string | null;
  catalogProductId: string | null;
  availableQuantity: number | null;
  soldQuantity: number | null;
  officialStoreName: string | null;
  acceptsMercadoPago: boolean;
  freeShipping: boolean;
  shippingMode: string | null;
  logisticType: string | null;
  shippingTags: string[];
  shippingDimensions: string | null;
  shippingLocalPickUp: boolean;
  shippingStorePickUp: boolean;
  sellerId: number | null;
  categoryId: string | null;
  brand: string | null;
  model: string | null;
  attributes: MercadoLivreSearchAttribute[];
  officialStoreId: number | null;
  offersCount: number | null;
  classicPrice: number | null;
  premiumPrice: number | null;
  classicFees: MercadoLivreFeeDetails | null;
  premiumFees: MercadoLivreFeeDetails | null;
  minPrice: number | null;
  maxPrice: number | null;
  avgPrice: number | null;
  buyBoxWinnerPrice: number | null;
  buyBoxWinnerListingType: string | null;
  hasFlex: boolean;
  sellerNickname: string | null;
  sellerCity: string | null;
  sellerState: string | null;
  dateCreated: string | null;
  totalVisits: number | null;
  ratingAverage: number | null;
  reviewsCount: number | null;
  questionsCount: number | null;
  questions: MercadoLivreSearchQuestion[];
  shippingOptions: MercadoLivreSearchShippingOption[];
  cheapestShipping: MercadoLivreSearchCheapestShipping | null;
  categoryTrends: MercadoLivreSearchCategoryTrend[];
  categoryInfo: MercadoLivreSearchCategoryInfo | null;
  marketplaceData: MercadoLivreMarketplaceData;
}

export interface MercadoLivreSearchResponse {
  mode: MercadoLivreSearchMode;
  queryStrategy: MercadoLivreQueryStrategy;
  account: {
    accountId: string;
    accountName: string;
    siteId: string;
  };
  query: string;
  paging: {
    total: number;
    limit: number;
    offset: number;
  };
  searchOptions: Required<MercadoLivreSearchOptions>;
  results: MercadoLivreSearchItem[];
}

export interface MercadoLivreSavedOffer {
  offerKey: string;
  itemId: string;
  sourceType: 'item' | 'catalog';
  title: string;
  thumbnail: string | null;
  permalink: string | null;
  catalogProductId: string | null;
  price: number | null;
  currencyId: string | null;
  createdAt: string;
  item: MercadoLivreSearchItem;
}

export interface MercadoLivrePublishedPresenceAccount {
  accountId: string;
  accountName: string | null;
  itemIds: string[];
  listingTypeIds: string[];
}

export interface MercadoLivrePublishedPresenceItem {
  itemKey: string;
  catalogProductId: string | null;
  referenceItemId: string | null;
  accounts: MercadoLivrePublishedPresenceAccount[];
}
