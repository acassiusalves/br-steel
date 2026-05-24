import { adminDb } from '@/lib/firebase-admin';
import { getShippingCostFor1To2Kg } from '@/lib/utils';
import type { MercadoLivreCredentials } from '@/lib/types';
import { getMlToken } from '@/services/mercadolivre';
import { getMlCredentialsByIdAdmin, loadMlAccountsAdmin } from '@/services/firestore-admin';
import type {
  MercadoLivreAccountSummary,
  MercadoLivreCatalogOffersSnapshot,
  MercadoLivreCompetitor,
  MercadoLivreCompetitorsResponse,
  MercadoLivreFeeDetails,
  MercadoLivreMarketplaceData,
  MercadoLivrePublishedPresenceItem,
  MercadoLivreQueryStrategy,
  MercadoLivreSavedOffer,
  MercadoLivreSearchAttribute,
  MercadoLivreSearchCheapestShipping,
  MercadoLivreSearchItem,
  MercadoLivreSearchMode,
  MercadoLivreSearchOptions,
  MercadoLivreSearchQuestion,
  MercadoLivreSearchResponse,
  MercadoLivreSearchShippingOption,
  MercadoLivreVisitsRefreshEntry,
  MercadoLivreVisitsRefreshResponse,
  MercadoLivreVisitsRefreshResult,
  MercadoLivreVisitsWindow,
} from '@/types/mercado-livre-catalog-search';

const ML_API_BASE = 'https://api.mercadolibre.com';
const SAVED_OFFERS_COLLECTION = 'mercadoLivreSavedOffers';
const LISTINGS_COLLECTION = 'anuncios';
const CATALOG_VISITS_OFFERS_LIMIT = 15;

type SellerProfile = {
  sellerNickname: string | null;
  sellerCity: string | null;
  sellerState: string | null;
  raw: Record<string, unknown> | null;
};

type CompetitorSellerProfile = Pick<SellerProfile, 'sellerNickname' | 'sellerCity' | 'sellerState'> & {
  reputation: MercadoLivreCompetitor['reputation'];
};

class MercadoLivreApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'MercadoLivreApiError';
    this.status = status;
  }
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function asOptionalNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(asRecord) : [];
}

function roundToTwo(value: number) {
  return Math.round(value * 100) / 100;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = asOptionalNumber(value);
  if (parsed === null) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function parseBooleanFlag(value: unknown, defaultValue: boolean) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return defaultValue;
}

function parseVisitsWindow(value: unknown): MercadoLivreVisitsWindow {
  const parsed = asOptionalNumber(value);
  if (parsed === 1 || parsed === 3 || parsed === 7 || parsed === 15 || parsed === 30) return parsed;
  return 7;
}

function emptyMarketplaceData(): MercadoLivreMarketplaceData {
  return {
    catalogProduct: null,
    catalogOffers: null,
    referenceOffer: null,
    referenceItem: null,
    referenceItemDescription: null,
    seller: null,
    category: null,
    categoryAttributes: null,
  };
}

function mergeMarketplaceData(
  current: MercadoLivreMarketplaceData | null | undefined,
  patch: Partial<MercadoLivreMarketplaceData>
): MercadoLivreMarketplaceData {
  return {
    ...emptyMarketplaceData(),
    ...(current || {}),
    ...patch,
  };
}

function buildCatalogOffersSnapshot(
  offers: Record<string, unknown>[],
  total: number | null
): MercadoLivreCatalogOffersSnapshot {
  return {
    total,
    retrieved: offers.length,
    results: offers,
  };
}

export function getSearchItemKey(item: Pick<MercadoLivreSearchItem, 'sourceType' | 'id'>) {
  return `${item.sourceType}:${item.id}`;
}

export function normalizeSearchOptions(rawValue: unknown): Required<MercadoLivreSearchOptions> {
  const value = asRecord(rawValue);

  return {
    includeVisits: parseBooleanFlag(value.includeVisits, true),
    visitsWindow: parseVisitsWindow(value.visitsWindow ?? value.days),
    includeStockInfo: parseBooleanFlag(value.includeStockInfo, false),
    includePriceRange: parseBooleanFlag(value.includePriceRange, true),
    includeReviews: parseBooleanFlag(value.includeReviews, false),
    includeQuestions: parseBooleanFlag(value.includeQuestions, false),
    includeShipping: parseBooleanFlag(value.includeShipping, false),
    shippingZipCode: asTrimmedString(value.shippingZipCode)?.replace(/\D/g, '').slice(0, 8) || '',
    includeTrends: parseBooleanFlag(value.includeTrends, false),
    includeCategoryInfo: parseBooleanFlag(value.includeCategoryInfo, false),
  };
}

export function parseMercadoLivreMode(value: unknown): MercadoLivreSearchMode {
  return value === 'items' ? 'items' : 'catalog';
}

function normalizeMercadoLivreResourceId(sitePrefix: string, rawDigits: string) {
  const prefix = sitePrefix.toUpperCase();
  const digits = rawDigits.replace(/\D/g, '');
  return digits.length >= 5 ? `${prefix}${digits}` : null;
}

function extractMercadoLivreResourceIdFromText(value: string) {
  const match = value.match(/\b(ML[A-Z])[-\s]?(\d{5,})\b/i);
  if (!match) return null;
  return normalizeMercadoLivreResourceId(match[1], match[2]);
}

function extractMercadoLivreResourceIdFromUrl(value: string) {
  if (!/^https?:\/\//i.test(value)) return null;

  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (!host.includes('mercadolivre.') && !host.includes('mercadolibre.')) return null;

    for (const part of [url.pathname, url.search, url.hash]) {
      const resourceId = extractMercadoLivreResourceIdFromText(decodeURIComponent(part));
      if (resourceId) return resourceId;
    }
  } catch {
    return null;
  }

  return null;
}

function extractMercadoLivreResourceId(value: string | null | undefined, siteId = 'MLB') {
  const normalized = asTrimmedString(value);
  if (!normalized) return null;

  const urlResourceId = extractMercadoLivreResourceIdFromUrl(normalized);
  if (urlResourceId) return urlResourceId;

  const textResourceId = extractMercadoLivreResourceIdFromText(normalized);
  if (textResourceId) return textResourceId;

  if (/^[\d\s.-]+$/.test(normalized)) {
    const sitePrefix = (asTrimmedString(siteId) || 'MLB').slice(0, 3).toUpperCase();
    return normalizeMercadoLivreResourceId(sitePrefix, normalized);
  }

  return null;
}

async function fetchMercadoLivreJson<T>(url: string, accessToken?: string | null): Promise<T> {
  const headers: HeadersInit = {
    Accept: 'application/json',
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
  };
  const response = await fetch(url, { headers, cache: 'no-store' });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};

  if (!response.ok) {
    const record = asRecord(payload);
    const message =
      asTrimmedString(record.message) ||
      asTrimmedString(record.error) ||
      `Mercado Livre respondeu ${response.status}.`;
    throw new MercadoLivreApiError(response.status, message);
  }

  return payload as T;
}

async function fetchMercadoLivreJsonWithPublicFallback<T>(url: string, accessToken?: string | null): Promise<T> {
  try {
    return await fetchMercadoLivreJson<T>(url, accessToken);
  } catch (error) {
    if (!accessToken) throw error;
    return fetchMercadoLivreJson<T>(url, null);
  }
}

function resolveAttributeValueName(attribute: Record<string, unknown>): string | null {
  const direct =
    asTrimmedString(attribute.value_name) ||
    asTrimmedString(attribute.valueName) ||
    asTrimmedString(attribute.value_id) ||
    asTrimmedString(attribute.valueId);
  if (direct) return direct;

  for (const entry of asRecordArray(attribute.values)) {
    const valueName = asTrimmedString(entry.name) || asTrimmedString(entry.value_name) || asTrimmedString(entry.id);
    if (valueName) return valueName;
  }

  return null;
}

function resolveAttributeValueId(attribute: Record<string, unknown>): string | null {
  const direct = asTrimmedString(attribute.value_id) || asTrimmedString(attribute.valueId);
  if (direct) return direct;

  for (const entry of asRecordArray(attribute.values)) {
    const valueId = asTrimmedString(entry.id) || asTrimmedString(entry.value_id);
    if (valueId) return valueId;
  }

  return null;
}

function mapAttributes(rawAttributes: unknown): MercadoLivreSearchAttribute[] {
  return asRecordArray(rawAttributes)
    .map((attribute) => {
      const id = asTrimmedString(attribute.id);
      const valueName = resolveAttributeValueName(attribute);
      if (!id || !valueName) return null;

      const mapped: MercadoLivreSearchAttribute = {
        id,
        name: asTrimmedString(attribute.name) || id,
        valueName,
      };
      const valueId = resolveAttributeValueId(attribute);
      if (valueId) mapped.valueId = valueId;
      return mapped;
    })
    .filter((attribute): attribute is MercadoLivreSearchAttribute => Boolean(attribute));
}

function mergeAttributes(...groups: MercadoLivreSearchAttribute[][]) {
  const seen = new Set<string>();
  const merged: MercadoLivreSearchAttribute[] = [];

  groups.flat().forEach((attribute) => {
    const key = `${attribute.id}:${attribute.valueName}`.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(attribute);
  });

  return merged;
}

function findAttributeValue(attributes: MercadoLivreSearchAttribute[], ids: string[]) {
  const wanted = new Set(ids.map((id) => id.toUpperCase()));
  return attributes.find((attribute) => wanted.has(attribute.id.toUpperCase()))?.valueName || null;
}

function mapShippingTags(shipping: Record<string, unknown>, fallbackTags?: unknown) {
  const tags = Array.isArray(shipping.tags) ? shipping.tags : fallbackTags;
  return Array.isArray(tags) ? tags.map((tag) => asTrimmedString(tag)).filter((tag): tag is string => Boolean(tag)) : [];
}

function hasFlexShipping(shipping: Record<string, unknown>, tags?: unknown) {
  const logisticType = asTrimmedString(shipping.logistic_type);
  const shippingTags = mapShippingTags(shipping, tags);
  return logisticType === 'self_service' || shippingTags.includes('self_service_in') || shippingTags.includes('self_service_out');
}

function mapSearchItem(raw: Record<string, unknown>): MercadoLivreSearchItem {
  const shipping = asRecord(raw.shipping);
  const seller = asRecord(raw.seller);
  const pictures = asRecordArray(raw.pictures);
  const attributes = mapAttributes(raw.attributes);
  const catalogProductId = asTrimmedString(raw.catalog_product_id) || asTrimmedString(raw.catalogProductId);
  const itemId = asTrimmedString(raw.id) || catalogProductId || '';
  const sellerId = asOptionalNumber(raw.seller_id ?? seller.id);
  const address = asRecord(raw.address);

  return {
    sourceType: 'item',
    id: itemId,
    referenceItemId: itemId,
    title: asTrimmedString(raw.title) || asTrimmedString(raw.name) || itemId,
    price: asOptionalNumber(raw.price),
    currencyId: asTrimmedString(raw.currency_id) || 'BRL',
    thumbnail:
      asTrimmedString(raw.thumbnail) ||
      asTrimmedString(raw.secure_thumbnail) ||
      asTrimmedString(pictures[0]?.secure_url) ||
      asTrimmedString(pictures[0]?.url),
    permalink: asTrimmedString(raw.permalink),
    condition: asTrimmedString(raw.condition),
    listingTypeId: asTrimmedString(raw.listing_type_id),
    catalogProductId,
    availableQuantity: asOptionalNumber(raw.available_quantity),
    soldQuantity: asOptionalNumber(raw.sold_quantity),
    officialStoreName: asTrimmedString(raw.official_store_name),
    acceptsMercadoPago: raw.accepts_mercadopago === true,
    freeShipping: shipping.free_shipping === true,
    shippingMode: asTrimmedString(shipping.mode),
    logisticType: asTrimmedString(shipping.logistic_type),
    shippingTags: mapShippingTags(shipping, raw.tags),
    shippingDimensions: asTrimmedString(shipping.dimensions),
    shippingLocalPickUp: shipping.local_pick_up === true,
    shippingStorePickUp: shipping.store_pick_up === true,
    sellerId,
    categoryId: asTrimmedString(raw.category_id),
    brand: findAttributeValue(attributes, ['BRAND', 'Marca']),
    model: findAttributeValue(attributes, ['MODEL', 'Modelo']),
    attributes,
    officialStoreId: asOptionalNumber(raw.official_store_id),
    offersCount: null,
    classicPrice: asTrimmedString(raw.listing_type_id) === 'gold_special' ? asOptionalNumber(raw.price) : null,
    premiumPrice: asTrimmedString(raw.listing_type_id) === 'gold_pro' ? asOptionalNumber(raw.price) : null,
    classicFees: null,
    premiumFees: null,
    minPrice: asOptionalNumber(raw.price),
    maxPrice: asOptionalNumber(raw.price),
    avgPrice: asOptionalNumber(raw.price),
    buyBoxWinnerPrice: asOptionalNumber(raw.price),
    buyBoxWinnerListingType: asTrimmedString(raw.listing_type_id),
    hasFlex: hasFlexShipping(shipping, raw.tags),
    sellerNickname: asTrimmedString(seller.nickname) || null,
    sellerCity: asTrimmedString(address.city_name),
    sellerState: asTrimmedString(address.state_name),
    dateCreated: asTrimmedString(raw.date_created) || asTrimmedString(raw.stop_time),
    totalVisits: null,
    ratingAverage: null,
    reviewsCount: null,
    questionsCount: null,
    questions: [],
    shippingOptions: [],
    cheapestShipping: null,
    categoryTrends: [],
    categoryInfo: null,
    marketplaceData: mergeMarketplaceData(null, { referenceItem: raw }),
  };
}

async function fetchItemDetail(accessToken: string | null, itemId: string) {
  return fetchMercadoLivreJsonWithPublicFallback<Record<string, unknown>>(
    `${ML_API_BASE}/items/${encodeURIComponent(itemId)}`,
    accessToken
  );
}

async function fetchItemDescription(accessToken: string | null, itemId: string) {
  try {
    return await fetchMercadoLivreJsonWithPublicFallback<Record<string, unknown>>(
      `${ML_API_BASE}/items/${encodeURIComponent(itemId)}/description`,
      accessToken
    );
  } catch {
    return null;
  }
}

async function fetchCatalogProductDetail(accessToken: string | null, catalogProductId: string) {
  return fetchMercadoLivreJsonWithPublicFallback<Record<string, unknown>>(
    `${ML_API_BASE}/products/${encodeURIComponent(catalogProductId)}`,
    accessToken
  );
}

async function fetchCatalogOffers(accessToken: string | null, catalogProductId: string) {
  const url = new URL(`${ML_API_BASE}/products/${encodeURIComponent(catalogProductId)}/items`);
  url.searchParams.set('limit', '50');

  const data = await fetchMercadoLivreJsonWithPublicFallback<Record<string, unknown>>(url.toString(), accessToken);
  const results = asRecordArray(data.results);
  const total = asOptionalNumber(asRecord(data.paging).total) ?? asOptionalNumber(data.total) ?? results.length;

  return { offers: results, total };
}

async function fetchCatalogCompetitors(accessToken: string | null, catalogProductId: string, limit: number) {
  const url = new URL(`${ML_API_BASE}/products/${encodeURIComponent(catalogProductId)}/items`);
  url.searchParams.set('limit', String(limit));

  const data = await fetchMercadoLivreJsonWithPublicFallback<Record<string, unknown>>(url.toString(), accessToken);
  const results = asRecordArray(data.results);
  const paging = asRecord(data.paging);

  return {
    competitors: results,
    totalCompetitors: asOptionalNumber(paging.total) ?? asOptionalNumber(data.total) ?? results.length,
  };
}

async function mapCatalogProducts(
  products: Record<string, unknown>[],
  accessToken: string | null,
  catalogOffersById: Map<string, Record<string, unknown>[]>
) {
  const mapped: MercadoLivreSearchItem[] = [];

  for (const product of products) {
    const catalogProductId = asTrimmedString(product.id);
    if (!catalogProductId) continue;

    let offers: Record<string, unknown>[] = [];
    let total: number | null = null;
    try {
      const response = await fetchCatalogOffers(accessToken, catalogProductId);
      offers = response.offers;
      total = response.total;
      catalogOffersById.set(catalogProductId, offers);
    } catch (error) {
      console.warn(`[mercado-livre-search] Falha ao carregar ofertas de ${catalogProductId}:`, error);
    }

    const winner = offers[0] || {};
    const winnerShipping = asRecord(winner.shipping);
    const attributes = mergeAttributes(mapAttributes(product.attributes), mapAttributes(winner.attributes));
    const priceValues = offers.map((offer) => asOptionalNumber(offer.price)).filter((value): value is number => value !== null);
    const classicPriceValues = offers
      .filter((offer) => asTrimmedString(offer.listing_type_id) === 'gold_special')
      .map((offer) => asOptionalNumber(offer.price))
      .filter((value): value is number => value !== null);
    const premiumPriceValues = offers
      .filter((offer) => asTrimmedString(offer.listing_type_id) === 'gold_pro')
      .map((offer) => asOptionalNumber(offer.price))
      .filter((value): value is number => value !== null);
    const pictures = asRecordArray(product.pictures);

    mapped.push({
      sourceType: 'catalog',
      id: catalogProductId,
      referenceItemId: asTrimmedString(winner.item_id) || asTrimmedString(winner.id),
      title: asTrimmedString(product.name) || asTrimmedString(product.title) || asTrimmedString(winner.title) || catalogProductId,
      price: asOptionalNumber(winner.price) ?? (priceValues.length > 0 ? Math.min(...priceValues) : null),
      currencyId: asTrimmedString(winner.currency_id) || asTrimmedString(product.currency_id) || 'BRL',
      thumbnail:
        asTrimmedString(product.thumbnail) ||
        asTrimmedString(winner.thumbnail) ||
        asTrimmedString(pictures[0]?.secure_url) ||
        asTrimmedString(pictures[0]?.url),
      permalink:
        asTrimmedString(product.permalink) ||
        (catalogProductId ? `https://www.mercadolivre.com.br/p/${catalogProductId}` : asTrimmedString(winner.permalink)),
      condition: asTrimmedString(winner.condition),
      listingTypeId: asTrimmedString(winner.listing_type_id),
      catalogProductId,
      availableQuantity: asOptionalNumber(winner.available_quantity),
      soldQuantity: asOptionalNumber(winner.sold_quantity),
      officialStoreName: asTrimmedString(winner.official_store_name),
      acceptsMercadoPago: winner.accepts_mercadopago === true,
      freeShipping: winnerShipping.free_shipping === true,
      shippingMode: asTrimmedString(winnerShipping.mode),
      logisticType: asTrimmedString(winnerShipping.logistic_type),
      shippingTags: mapShippingTags(winnerShipping, winner.tags),
      shippingDimensions: asTrimmedString(winnerShipping.dimensions),
      shippingLocalPickUp: winnerShipping.local_pick_up === true,
      shippingStorePickUp: winnerShipping.store_pick_up === true,
      sellerId: asOptionalNumber(winner.seller_id),
      categoryId: asTrimmedString(product.category_id) || asTrimmedString(winner.category_id),
      brand: findAttributeValue(attributes, ['BRAND']),
      model: findAttributeValue(attributes, ['MODEL']),
      attributes,
      officialStoreId: asOptionalNumber(winner.official_store_id),
      offersCount: total ?? offers.length,
      classicPrice: classicPriceValues.length > 0 ? Math.min(...classicPriceValues) : null,
      premiumPrice: premiumPriceValues.length > 0 ? Math.min(...premiumPriceValues) : null,
      classicFees: null,
      premiumFees: null,
      minPrice: priceValues.length > 0 ? Math.min(...priceValues) : null,
      maxPrice: priceValues.length > 0 ? Math.max(...priceValues) : null,
      avgPrice: priceValues.length > 0 ? priceValues.reduce((sum, price) => sum + price, 0) / priceValues.length : null,
      buyBoxWinnerPrice: asOptionalNumber(winner.price),
      buyBoxWinnerListingType: asTrimmedString(winner.listing_type_id),
      hasFlex: hasFlexShipping(winnerShipping, winner.tags),
      sellerNickname: null,
      sellerCity: null,
      sellerState: null,
      dateCreated: asTrimmedString(winner.date_created),
      totalVisits: null,
      ratingAverage: null,
      reviewsCount: null,
      questionsCount: null,
      questions: [],
      shippingOptions: [],
      cheapestShipping: null,
      categoryTrends: [],
      categoryInfo: null,
      marketplaceData: mergeMarketplaceData(null, {
        catalogProduct: product,
        catalogOffers: buildCatalogOffersSnapshot(offers, total),
        referenceOffer: Object.keys(winner).length > 0 ? winner : null,
      }),
    });
  }

  return mapped;
}

async function fetchSellerProfile(accessToken: string | null, sellerId: number): Promise<SellerProfile> {
  try {
    const raw = await fetchMercadoLivreJsonWithPublicFallback<Record<string, unknown>>(
      `${ML_API_BASE}/users/${sellerId}`,
      accessToken
    );
    const address = asRecord(raw.address);
    return {
      sellerNickname: asTrimmedString(raw.nickname),
      sellerCity: asTrimmedString(address.city),
      sellerState: asTrimmedString(address.state),
      raw,
    };
  } catch {
    return { sellerNickname: null, sellerCity: null, sellerState: null, raw: null };
  }
}

async function fetchCompetitorSellerProfile(
  accessToken: string | null,
  sellerId: number
): Promise<CompetitorSellerProfile> {
  try {
    const raw = await fetchMercadoLivreJsonWithPublicFallback<Record<string, unknown>>(
      `${ML_API_BASE}/users/${sellerId}`,
      accessToken
    );

    const address = asRecord(raw.address);
    const city = asRecord(address.city);
    const state = asRecord(address.state);
    const sellerReputation = asRecord(raw.seller_reputation);
    const metrics = asRecord(sellerReputation.metrics);
    const sales = asRecord(metrics.sales);
    const completed = asRecord(sales.completed);

    return {
      sellerNickname: asTrimmedString(raw.nickname),
      sellerCity: asTrimmedString(city.name) || asTrimmedString(address.city),
      sellerState: asTrimmedString(state.name) || asTrimmedString(address.state),
      reputation: {
        levelId: asTrimmedString(sellerReputation.level_id),
        powerSellerStatus: asTrimmedString(sellerReputation.power_seller_status),
        transactionsTotal: asOptionalNumber(completed.total ?? sellerReputation.transactions_total),
      },
    };
  } catch {
    return {
      sellerNickname: null,
      sellerCity: null,
      sellerState: null,
      reputation: null,
    };
  }
}

async function fetchItemVisits(accessToken: string | null, itemId: string, days: MercadoLivreVisitsWindow) {
  try {
    const url = new URL(`${ML_API_BASE}/items/${encodeURIComponent(itemId)}/visits/time_window`);
    url.searchParams.set('last', String(days));
    url.searchParams.set('unit', 'day');

    const data = await fetchMercadoLivreJsonWithPublicFallback<Record<string, unknown>>(
      url.toString(),
      accessToken
    );

    const totalVisits = asOptionalNumber(data.total_visits);
    if (totalVisits !== null) return totalVisits;

    if (Array.isArray(data.results)) {
      return data.results.reduce((sum, entry) => sum + (asOptionalNumber(asRecord(entry).total) || 0), 0);
    }

    return 0;
  } catch {
    return 0;
  }
}

function getOfferItemId(offer: Record<string, unknown>) {
  return asTrimmedString(offer.item_id ?? offer.id);
}

async function fetchOfferItemIdsTotalVisits(
  accessToken: string | null,
  rawItemIds: string[],
  days: MercadoLivreVisitsWindow
) {
  const itemIds = Array.from(new Set(rawItemIds.map(asTrimmedString).filter((itemId): itemId is string => Boolean(itemId)))).slice(
    0,
    CATALOG_VISITS_OFFERS_LIMIT
  );
  const concurrency = 5;
  let totalVisits = 0;

  for (let index = 0; index < itemIds.length; index += concurrency) {
    const batch = itemIds.slice(index, index + concurrency);
    const visits = await Promise.all(batch.map((itemId) => fetchItemVisits(accessToken, itemId, days)));
    totalVisits += visits.reduce((sum, value) => sum + (value || 0), 0);
  }

  return totalVisits;
}

async function fetchCatalogOffersTotalVisits(
  accessToken: string | null,
  offers: Record<string, unknown>[],
  days: MercadoLivreVisitsWindow
) {
  return fetchOfferItemIdsTotalVisits(
    accessToken,
    offers.map(getOfferItemId).filter((itemId): itemId is string => Boolean(itemId)),
    days
  );
}

async function fetchItemReviews(accessToken: string | null, itemId: string) {
  try {
    const data = await fetchMercadoLivreJsonWithPublicFallback<Record<string, unknown>>(
      `${ML_API_BASE}/reviews/item/${encodeURIComponent(itemId)}`,
      accessToken
    );
    const rating = asRecord(data.rating_average);
    return {
      ratingAverage: asOptionalNumber(data.rating_average) ?? asOptionalNumber(rating.average) ?? null,
      reviewsCount: asOptionalNumber(data.total) ?? asOptionalNumber(data.reviews_count) ?? null,
    };
  } catch {
    return { ratingAverage: null, reviewsCount: null };
  }
}

function mapQuestions(rawQuestions: unknown): MercadoLivreSearchQuestion[] {
  return asRecordArray(rawQuestions).map((question) => {
    const answer = asRecord(question.answer);
    const hasAnswer = Object.keys(answer).length > 0;
    return {
      id: asTrimmedString(question.id) || String(asOptionalNumber(question.id) ?? crypto.randomUUID()),
      text: asTrimmedString(question.text) || '',
      status: asTrimmedString(question.status),
      dateCreated: asTrimmedString(question.date_created),
      itemId: asTrimmedString(question.item_id),
      sellerId: asOptionalNumber(question.seller_id),
      answer: hasAnswer
        ? {
            text: asTrimmedString(answer.text),
            dateCreated: asTrimmedString(answer.date_created),
          }
        : null,
    };
  });
}

async function fetchQuestions(accessToken: string | null, itemId: string) {
  try {
    const url = new URL(`${ML_API_BASE}/questions/search`);
    url.searchParams.set('item_id', itemId);
    url.searchParams.set('limit', '5');
    url.searchParams.set('api_version', '4');
    const data = await fetchMercadoLivreJsonWithPublicFallback<Record<string, unknown>>(url.toString(), accessToken);
    return mapQuestions(data.questions);
  } catch {
    return [];
  }
}

function mapShippingOptions(rawOptions: unknown): {
  shippingOptions: MercadoLivreSearchShippingOption[];
  cheapestShipping: MercadoLivreSearchCheapestShipping | null;
} {
  const shippingOptions = asRecordArray(rawOptions).map((option) => {
    const estimated = asRecord(option.estimated_delivery_time);
    return {
      id: asTrimmedString(option.id) || asTrimmedString(option.name) || crypto.randomUUID(),
      name: asTrimmedString(option.name) || 'Entrega',
      currencyId: asTrimmedString(option.currency_id),
      listCost: asOptionalNumber(option.list_cost) ?? 0,
      cost: asOptionalNumber(option.cost) ?? asOptionalNumber(option.list_cost) ?? 0,
      estimatedDeliveryDays:
        asOptionalNumber(estimated.shipping) ?? asOptionalNumber(estimated.offset) ?? asOptionalNumber(option.estimatedDeliveryDays),
      estimatedDeliveryDate: asTrimmedString(estimated.date),
    };
  });
  const cheapest = shippingOptions.reduce<MercadoLivreSearchShippingOption | null>(
    (current, option) => (!current || option.cost < current.cost ? option : current),
    null
  );

  return {
    shippingOptions,
    cheapestShipping: cheapest
      ? {
          cost: cheapest.cost,
          name: cheapest.name,
          estimatedDeliveryDays: cheapest.estimatedDeliveryDays,
        }
      : null,
  };
}

async function fetchShippingOptions(accessToken: string | null, itemId: string, zipCode: string) {
  try {
    const url = new URL(`${ML_API_BASE}/items/${encodeURIComponent(itemId)}/shipping_options`);
    url.searchParams.set('zip_code', zipCode);
    const data = await fetchMercadoLivreJsonWithPublicFallback<Record<string, unknown>>(url.toString(), accessToken);
    return mapShippingOptions(data.options);
  } catch {
    return { shippingOptions: [], cheapestShipping: null };
  }
}

async function fetchCategoryInfo(accessToken: string | null, categoryId: string) {
  try {
    const data = await fetchMercadoLivreJsonWithPublicFallback<Record<string, unknown>>(
      `${ML_API_BASE}/categories/${encodeURIComponent(categoryId)}`,
      accessToken
    );
    const path = asRecordArray(data.path_from_root)
      .map((entry) => asTrimmedString(entry.name))
      .filter(Boolean)
      .join(' > ');
    return {
      categoryInfo: {
        id: categoryId,
        name: asTrimmedString(data.name) || categoryId,
        path: path || asTrimmedString(data.name) || categoryId,
      },
      raw: data,
    };
  } catch {
    return { categoryInfo: null, raw: null };
  }
}

async function fetchCategoryTrends(accessToken: string | null, siteId: string, categoryId: string) {
  try {
    const data = await fetchMercadoLivreJsonWithPublicFallback<unknown[]>(
      `${ML_API_BASE}/trends/${encodeURIComponent(siteId)}/${encodeURIComponent(categoryId)}`,
      accessToken
    );
    return Array.isArray(data)
      ? data.slice(0, 10).map((entry) => {
          const record = asRecord(entry);
          return {
            keyword: asTrimmedString(record.keyword) || asTrimmedString(record.name) || '',
            url: asTrimmedString(record.url),
          };
        }).filter((entry) => Boolean(entry.keyword))
      : [];
  } catch {
    return [];
  }
}

function estimateFees(price: number | null, listingTypeId: 'gold_special' | 'gold_pro', currencyId: string | null): MercadoLivreFeeDetails | null {
  if (!price || !(price > 0)) return null;

  const saleFeePercentage = listingTypeId === 'gold_pro' ? 16 : 11;
  const fixedFee = price < 79 ? 6 : 0;
  const commissionAmount = roundToTwo(price * (saleFeePercentage / 100));
  const saleFeeAmount = roundToTwo(commissionAmount + fixedFee);
  const fallbackShipping = getShippingCostFor1To2Kg(price);
  const shippingCost = fallbackShipping ?? 0;
  const listingFeeAmount = 0;
  const totalFees = roundToTwo(saleFeeAmount + listingFeeAmount + shippingCost);

  return {
    listingTypeId,
    currencyId: currencyId || 'BRL',
    saleFeeAmount,
    saleFeePercentage,
    fixedFee,
    commissionAmount,
    listingFeeAmount,
    netAmount: roundToTwo(price - saleFeeAmount - listingFeeAmount),
    shippingCost,
    shippingCostSource: fallbackShipping === null ? 'unavailable' : 'fallback_table',
    shippingError: fallbackShipping === null ? 'Frete estimado indisponível para esta faixa de preço.' : null,
    totalFees,
    netAmountAfterShipping: roundToTwo(price - totalFees),
  };
}

function attachFees(item: MercadoLivreSearchItem): MercadoLivreSearchItem {
  return {
    ...item,
    classicFees: estimateFees(item.classicPrice ?? item.price, 'gold_special', item.currencyId),
    premiumFees: estimateFees(item.premiumPrice ?? item.price, 'gold_pro', item.currencyId),
  };
}

async function enrichSearchResults(
  results: MercadoLivreSearchItem[],
  accessToken: string | null,
  searchOptions: Required<MercadoLivreSearchOptions>,
  siteId: string
) {
  const enriched: MercadoLivreSearchItem[] = [];

  for (const item of results) {
    let nextItem = { ...item };
    const referenceItemId = nextItem.referenceItemId || (nextItem.sourceType === 'item' ? nextItem.id : null);
    let referenceCategoryId = nextItem.categoryId;
    let referenceSellerId = nextItem.sellerId;

    if (nextItem.catalogProductId && !nextItem.marketplaceData.catalogProduct) {
      try {
        const catalogProduct = await fetchCatalogProductDetail(accessToken, nextItem.catalogProductId);
        nextItem = {
          ...nextItem,
          marketplaceData: mergeMarketplaceData(nextItem.marketplaceData, { catalogProduct }),
        };
      } catch {
        // enrichment best-effort
      }
    }

    if (referenceItemId) {
      try {
        const itemDetail = await fetchItemDetail(accessToken, referenceItemId);
        const detailShipping = asRecord(itemDetail.shipping);
        const detailSeller = asRecord(itemDetail.seller);
        const detailSellerId = asOptionalNumber(itemDetail.seller_id ?? detailSeller.id);

        nextItem = {
          ...nextItem,
          referenceItemId,
          attributes: mergeAttributes(nextItem.attributes, mapAttributes(itemDetail.attributes)),
          availableQuantity: asOptionalNumber(itemDetail.available_quantity) ?? nextItem.availableQuantity,
          freeShipping: detailShipping.free_shipping === true || nextItem.freeShipping,
          shippingMode: asTrimmedString(detailShipping.mode) || nextItem.shippingMode,
          logisticType: asTrimmedString(detailShipping.logistic_type) || nextItem.logisticType,
          shippingTags: mapShippingTags(detailShipping).length > 0 ? mapShippingTags(detailShipping) : nextItem.shippingTags,
          shippingDimensions: asTrimmedString(detailShipping.dimensions) || nextItem.shippingDimensions,
          shippingLocalPickUp: detailShipping.local_pick_up === true || nextItem.shippingLocalPickUp,
          shippingStorePickUp: detailShipping.store_pick_up === true || nextItem.shippingStorePickUp,
          permalink: asTrimmedString(itemDetail.permalink) || nextItem.permalink,
          dateCreated: asTrimmedString(itemDetail.date_created) || nextItem.dateCreated,
          sellerId: detailSellerId ?? nextItem.sellerId,
          hasFlex: nextItem.hasFlex || hasFlexShipping(detailShipping, itemDetail.tags),
          brand: nextItem.brand || findAttributeValue(mapAttributes(itemDetail.attributes), ['BRAND']),
          model: nextItem.model || findAttributeValue(mapAttributes(itemDetail.attributes), ['MODEL']),
          marketplaceData: mergeMarketplaceData(nextItem.marketplaceData, { referenceItem: itemDetail }),
        };

        referenceSellerId = referenceSellerId ?? detailSellerId;
        referenceCategoryId = referenceCategoryId || asTrimmedString(itemDetail.category_id);
      } catch {
        // enrichment best-effort
      }

      const description = await fetchItemDescription(accessToken, referenceItemId);
      if (description) {
        nextItem = {
          ...nextItem,
          marketplaceData: mergeMarketplaceData(nextItem.marketplaceData, { referenceItemDescription: description }),
        };
      }
    }

    if (referenceSellerId) {
      const sellerProfile = await fetchSellerProfile(accessToken, referenceSellerId);
      nextItem = {
        ...nextItem,
        sellerNickname: sellerProfile.sellerNickname || nextItem.sellerNickname,
        sellerCity: sellerProfile.sellerCity || nextItem.sellerCity,
        sellerState: sellerProfile.sellerState || nextItem.sellerState,
        marketplaceData: mergeMarketplaceData(nextItem.marketplaceData, { seller: sellerProfile.raw }),
      };
    }

    if (searchOptions.includeVisits) {
      const catalogOffers = nextItem.marketplaceData.catalogOffers?.results || [];
      if (nextItem.sourceType === 'catalog' && catalogOffers.length > 0) {
        const totalVisits = await fetchCatalogOffersTotalVisits(accessToken, catalogOffers, searchOptions.visitsWindow);
        nextItem = { ...nextItem, totalVisits };
      } else if (referenceItemId) {
        const totalVisits = await fetchItemVisits(accessToken, referenceItemId, searchOptions.visitsWindow);
        nextItem = { ...nextItem, totalVisits };
      }
    }

    if (searchOptions.includeReviews && referenceItemId) {
      const { ratingAverage, reviewsCount } = await fetchItemReviews(accessToken, referenceItemId);
      nextItem = { ...nextItem, ratingAverage, reviewsCount };
    }

    if (searchOptions.includeQuestions && referenceItemId) {
      const questions = await fetchQuestions(accessToken, referenceItemId);
      nextItem = { ...nextItem, questions, questionsCount: questions.length };
    }

    if (searchOptions.includeShipping && referenceItemId && searchOptions.shippingZipCode.length === 8) {
      const shipping = await fetchShippingOptions(accessToken, referenceItemId, searchOptions.shippingZipCode);
      nextItem = { ...nextItem, ...shipping };
    }

    if (referenceCategoryId && (searchOptions.includeCategoryInfo || searchOptions.includeTrends)) {
      const category = await fetchCategoryInfo(accessToken, referenceCategoryId);
      nextItem = {
        ...nextItem,
        categoryInfo: searchOptions.includeCategoryInfo ? category.categoryInfo : nextItem.categoryInfo,
        marketplaceData: mergeMarketplaceData(nextItem.marketplaceData, { category: category.raw }),
      };

      if (searchOptions.includeTrends) {
        nextItem = {
          ...nextItem,
          categoryTrends: await fetchCategoryTrends(accessToken, siteId, referenceCategoryId),
        };
      }
    }

    enriched.push(attachFees(nextItem));
  }

  return enriched;
}

function isMercadoLivreNotFoundError(error: unknown) {
  return error instanceof MercadoLivreApiError && (error.status === 400 || error.status === 404);
}

function resolvePagingTotal(data: Record<string, unknown>, fallback: number) {
  const paging = asRecord(data.paging);
  return asOptionalNumber(paging.total) ?? asOptionalNumber(data.total) ?? fallback;
}

function getCredentialSiteId(credentials: MercadoLivreCredentials | null) {
  return (
    asTrimmedString((credentials as MercadoLivreCredentials & { siteId?: string; site_id?: string } | null)?.siteId) ||
    asTrimmedString((credentials as MercadoLivreCredentials & { siteId?: string; site_id?: string } | null)?.site_id) ||
    'MLB'
  );
}

export async function runMercadoLivreCatalogSearch(input: {
  accountId: string;
  query: string;
  mode: MercadoLivreSearchMode;
  limit: number;
  offset: number;
  searchOptions: Required<MercadoLivreSearchOptions>;
}): Promise<MercadoLivreSearchResponse> {
  const account = await getMlCredentialsByIdAdmin(input.accountId);
  if (!account) throw new Error('Conta do Mercado Livre não encontrada.');

  const siteId = getCredentialSiteId(account);
  let accessToken: string | null = null;
  try {
    accessToken = await getMlToken(input.accountId);
  } catch (error) {
    console.warn('[mercado-livre-search] Token indisponível; tentando busca pública:', error);
  }

  let results: MercadoLivreSearchItem[] = [];
  let total = 0;
  let responseLimit = input.limit;
  let responseOffset = input.offset;
  let queryStrategy: MercadoLivreQueryStrategy = 'items_search';
  let responseQuery = input.query;
  const catalogOffersById = new Map<string, Record<string, unknown>[]>();
  const directResourceId = extractMercadoLivreResourceId(input.query, siteId);

  const loadDirectItemById = async (itemId: string) => {
    const raw = await fetchItemDetail(accessToken, itemId);
    return mapSearchItem(raw);
  };

  if (input.mode === 'catalog') {
    if (directResourceId) {
      responseLimit = 1;
      responseOffset = 0;
      responseQuery = directResourceId;

      try {
        queryStrategy = 'item_id';
        results = [await loadDirectItemById(directResourceId)];
        total = results.length;
      } catch (error) {
        if (!isMercadoLivreNotFoundError(error)) throw error;
        queryStrategy = 'catalog_id';
        const product = await fetchCatalogProductDetail(accessToken, directResourceId);
        results = await mapCatalogProducts([product], accessToken, catalogOffersById);
        total = results.length;
      }
    } else {
      queryStrategy = 'catalog_search';
      const url = new URL(`${ML_API_BASE}/products/search`);
      url.searchParams.set('q', input.query);
      url.searchParams.set('status', 'active');
      url.searchParams.set('site_id', siteId);
      url.searchParams.set('limit', String(input.limit));
      url.searchParams.set('offset', String(input.offset));

      const data = await fetchMercadoLivreJsonWithPublicFallback<Record<string, unknown>>(url.toString(), accessToken);
      const products = asRecordArray(data.results);
      results = await mapCatalogProducts(products, accessToken, catalogOffersById);
      total = resolvePagingTotal(data, results.length);
    }
  } else if (directResourceId) {
    queryStrategy = 'item_id';
    responseLimit = 1;
    responseOffset = 0;
    responseQuery = directResourceId;
    results = [await loadDirectItemById(directResourceId)];
    total = results.length;
  } else {
    const url = new URL(`${ML_API_BASE}/sites/${encodeURIComponent(siteId)}/search`);
    url.searchParams.set('q', input.query);
    url.searchParams.set('limit', String(input.limit));
    url.searchParams.set('offset', String(input.offset));

    const data = await fetchMercadoLivreJsonWithPublicFallback<Record<string, unknown>>(url.toString(), accessToken);
    results = asRecordArray(data.results).map(mapSearchItem);
    total = resolvePagingTotal(data, results.length);
  }

  const enrichedResults =
    results.length > 0 ? await enrichSearchResults(results, accessToken, input.searchOptions, siteId) : results;

  return {
    mode: input.mode,
    queryStrategy,
    account: {
      accountId: input.accountId,
      accountName: account.accountName || account.nickname || input.accountId,
      siteId,
    },
    query: responseQuery,
    paging: {
      total,
      limit: responseLimit,
      offset: responseOffset,
    },
    searchOptions: input.searchOptions,
    results: enrichedResults,
  };
}

export async function loadMercadoLivreCompetitors(input: {
  accountId: string;
  catalogProductId: string;
  days: MercadoLivreVisitsWindow;
  limit: number;
}): Promise<MercadoLivreCompetitorsResponse> {
  const account = await getMlCredentialsByIdAdmin(input.accountId);
  if (!account) throw new Error('Conta do Mercado Livre não encontrada.');

  const siteId = getCredentialSiteId(account);
  let accessToken: string | null = null;
  try {
    accessToken = await getMlToken(input.accountId);
  } catch (error) {
    console.warn('[mercado-livre-competitors] Token indisponível; tentando leitura pública:', error);
  }

  const { competitors: rawCompetitors, totalCompetitors } = await fetchCatalogCompetitors(
    accessToken,
    input.catalogProductId,
    input.limit
  );
  const priceValues = rawCompetitors
    .map((competitor) => asOptionalNumber(competitor.price))
    .filter((price): price is number => price !== null);

  const competitors = await Promise.all(
    rawCompetitors.map(async (competitor, index): Promise<MercadoLivreCompetitor> => {
      const shipping = asRecord(competitor.shipping);
      const shippingTags = mapShippingTags(shipping, competitor.tags);
      const sellerId = asOptionalNumber(competitor.seller_id);
      const itemId = asTrimmedString(competitor.item_id ?? competitor.id) || `item-${index}`;

      const [sellerProfile, visits] = await Promise.all([
        sellerId
          ? fetchCompetitorSellerProfile(accessToken, sellerId)
          : Promise.resolve<CompetitorSellerProfile>({
              sellerNickname: null,
              sellerCity: null,
              sellerState: null,
              reputation: null,
            }),
        itemId ? fetchItemVisits(accessToken, itemId, input.days) : Promise.resolve(0),
      ]);

      return {
        itemId,
        sellerId,
        sellerNickname: sellerProfile.sellerNickname || asTrimmedString(competitor.seller_nickname),
        price: asOptionalNumber(competitor.price),
        availableQuantity: asOptionalNumber(competitor.available_quantity),
        soldQuantity: asOptionalNumber(competitor.sold_quantity),
        listingTypeId: asTrimmedString(competitor.listing_type_id),
        logisticType: asTrimmedString(shipping.logistic_type),
        shippingTags,
        hasFlex: hasFlexShipping(shipping, competitor.tags),
        freeShipping: shipping.free_shipping === true,
        condition: asTrimmedString(competitor.condition),
        permalink: asTrimmedString(competitor.permalink),
        officialStoreName: asTrimmedString(competitor.official_store_name),
        sellerCity: sellerProfile.sellerCity,
        sellerState: sellerProfile.sellerState,
        reputation: sellerProfile.reputation,
        visits,
        isBuyBoxWinner: index === 0,
      };
    })
  );
  const avgPrice =
    priceValues.length > 0 ? priceValues.reduce((sum, price) => sum + price, 0) / priceValues.length : null;

  return {
    account: {
      accountId: input.accountId,
      accountName: account.accountName || account.nickname || input.accountId,
      siteId,
    },
    catalogProductId: input.catalogProductId,
    totalCompetitors,
    winnerItemId: competitors[0]?.itemId || null,
    priceStats: {
      min: priceValues.length > 0 ? Math.min(...priceValues) : null,
      max: priceValues.length > 0 ? Math.max(...priceValues) : null,
      avg: avgPrice,
    },
    competitors,
  };
}

export async function loadMercadoLivreVisitsRefresh(input: {
  accountId: string;
  days: MercadoLivreVisitsWindow;
  entries: MercadoLivreVisitsRefreshEntry[];
}): Promise<MercadoLivreVisitsRefreshResponse> {
  const account = await getMlCredentialsByIdAdmin(input.accountId);
  if (!account) throw new Error('Conta do Mercado Livre não encontrada.');

  const siteId = getCredentialSiteId(account);
  let accessToken: string | null = null;
  try {
    accessToken = await getMlToken(input.accountId);
  } catch (error) {
    console.warn('[mercado-livre-visits] Token indisponível; tentando leitura pública:', error);
  }

  const concurrency = 5;
  const results: MercadoLivreVisitsRefreshResult[] = [];

  for (let index = 0; index < input.entries.length; index += concurrency) {
    const batch = input.entries.slice(index, index + concurrency);
    const batchResults = await Promise.all(
      batch.map(async (entry): Promise<MercadoLivreVisitsRefreshResult> => {
        if (entry.sourceType === 'catalog' && Array.isArray(entry.offerItemIds) && entry.offerItemIds.length > 0) {
          return {
            itemKey: entry.itemKey,
            totalVisits: await fetchOfferItemIdsTotalVisits(accessToken, entry.offerItemIds, input.days),
          };
        }

        const itemId = asTrimmedString(entry.referenceItemId) || asTrimmedString(entry.id);
        return {
          itemKey: entry.itemKey,
          totalVisits: itemId ? await fetchItemVisits(accessToken, itemId, input.days) : 0,
        };
      })
    );
    results.push(...batchResults);
  }

  return {
    account: {
      accountId: input.accountId,
      accountName: account.accountName || account.nickname || input.accountId,
      siteId,
    },
    days: input.days,
    results,
  };
}

export function parseSearchPayload(payload: Record<string, unknown>) {
  return {
    accountId: asTrimmedString(payload.accountId),
    query: asTrimmedString(payload.query),
    mode: parseMercadoLivreMode(payload.mode),
    limit: clampNumber(payload.limit, 25, 1, 50),
    offset: clampNumber(payload.offset, 0, 0, 1000),
    searchOptions: normalizeSearchOptions(payload.options ?? payload),
  };
}

export async function listMercadoLivreAccountSummaries(): Promise<MercadoLivreAccountSummary[]> {
  const accounts = await loadMlAccountsAdmin();

  return accounts.map((account) => {
    const credentials = account as MercadoLivreCredentials & { id: string; siteId?: string; site_id?: string };
    const connected = Boolean(credentials.accessToken || credentials.refreshToken) && credentials.apiStatus !== 'invalid';
    const requiresReconnect = !credentials.refreshToken && !credentials.accessToken;
    const status: MercadoLivreAccountSummary['status'] =
      credentials.apiStatus === 'invalid'
        ? 'error'
        : requiresReconnect
          ? 'reconnect'
          : connected
            ? 'connected'
            : 'unchecked';

    return {
      accountId: credentials.id,
      accountName: credentials.accountName || credentials.nickname || credentials.id,
      nickname: credentials.nickname || null,
      siteId: getCredentialSiteId(credentials),
      userId: credentials.userId ?? credentials.sellerId ?? null,
      connected,
      requiresReconnect,
      status,
    };
  });
}

export async function loadMercadoLivreSavedOffers(): Promise<MercadoLivreSavedOffer[]> {
  const snapshot = await adminDb.collection(SAVED_OFFERS_COLLECTION).get();
  return snapshot.docs
    .map((doc) => doc.data() as MercadoLivreSavedOffer)
    .sort((left, right) => (right.createdAt || '').localeCompare(left.createdAt || ''));
}

export async function saveMercadoLivreOffer(item: MercadoLivreSearchItem): Promise<MercadoLivreSavedOffer> {
  const offerKey = getSearchItemKey(item);
  const offer: MercadoLivreSavedOffer = {
    offerKey,
    itemId: item.id,
    sourceType: item.sourceType,
    title: item.title,
    thumbnail: item.thumbnail,
    permalink: item.permalink,
    catalogProductId: item.catalogProductId,
    price: item.price,
    currencyId: item.currencyId,
    createdAt: new Date().toISOString(),
    item,
  };

  await adminDb.collection(SAVED_OFFERS_COLLECTION).doc(offerKey).set(offer, { merge: true });
  return offer;
}

export async function deleteMercadoLivreSavedOffer(offerKey: string) {
  await adminDb.collection(SAVED_OFFERS_COLLECTION).doc(offerKey).delete();
}

export async function loadMercadoLivrePublishedPresence(items: MercadoLivreSearchItem[]) {
  const wantedCatalogIds = new Set(items.map((item) => item.catalogProductId).filter(Boolean) as string[]);
  const wantedReferenceIds = new Set(
    items.flatMap((item) => [item.referenceItemId, item.id]).filter(Boolean) as string[]
  );
  const itemKeyByCatalogId = new Map(items.filter((item) => item.catalogProductId).map((item) => [item.catalogProductId!, getSearchItemKey(item)]));
  const itemKeyByReferenceId = new Map(
    items.flatMap((item) => [item.referenceItemId, item.id].filter(Boolean).map((id) => [id as string, getSearchItemKey(item)] as const))
  );
  const presenceByKey = new Map<string, MercadoLivrePublishedPresenceItem>();

  if (wantedCatalogIds.size === 0 && wantedReferenceIds.size === 0) return [];

  const snapshot = await adminDb.collection(LISTINGS_COLLECTION).get();
  snapshot.docs.forEach((doc) => {
    const data = doc.data() as Record<string, unknown>;
    const catalogProductId = asTrimmedString(data.catalogProductId ?? data.catalog_product_id);
    const itemId = asTrimmedString(data.itemId ?? data.id ?? doc.id);
    const status = asTrimmedString(data.status);
    if (status && status !== 'active') return;

    const itemKey =
      (catalogProductId && wantedCatalogIds.has(catalogProductId) ? itemKeyByCatalogId.get(catalogProductId) : null) ||
      (itemId && wantedReferenceIds.has(itemId) ? itemKeyByReferenceId.get(itemId) : null);
    if (!itemKey) return;

    const existing =
      presenceByKey.get(itemKey) ||
      ({
        itemKey,
        catalogProductId,
        referenceItemId: itemId,
        accounts: [],
      } satisfies MercadoLivrePublishedPresenceItem);
    const accountId = asTrimmedString(data.accountId) || 'primary';
    let accountEntry = existing.accounts.find((entry) => entry.accountId === accountId);
    if (!accountEntry) {
      accountEntry = {
        accountId,
        accountName: asTrimmedString(data.accountName),
        itemIds: [],
        listingTypeIds: [],
      };
      existing.accounts.push(accountEntry);
    }
    if (itemId && !accountEntry.itemIds.includes(itemId)) accountEntry.itemIds.push(itemId);
    const listingTypeId = asTrimmedString(data.listingTypeId ?? data.listing_type_id);
    if (listingTypeId && !accountEntry.listingTypeIds.includes(listingTypeId)) {
      accountEntry.listingTypeIds.push(listingTypeId);
    }
    presenceByKey.set(itemKey, existing);
  });

  return Array.from(presenceByKey.values());
}
