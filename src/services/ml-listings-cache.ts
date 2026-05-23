import { adminDb } from '@/lib/firebase-admin';
import type { MercadoLivreCredentials } from '@/lib/types';
import type { DocumentData } from 'firebase-admin/firestore';
import { getMlToken } from '@/services/mercadolivre';
import { getPrimaryMlAccountIdAdmin, saveMlCredentialsAdmin } from '@/services/firestore-admin';
import {
  loadMercadoLivreAdsCampaignDailyRows,
  loadMercadoLivreAdsCampaignSummaries,
  loadMercadoLivreAdsListingsMap,
  loadMercadoLivreAdsSyncState,
  type MlAdsCampaignDailyRow,
  type MlAdsCampaignSummary,
  type MlAdsListingRow,
  type MlAdsSyncState,
} from '@/services/ml-ads-analytics-cache';

const ML_API_BASE = 'https://api.mercadolibre.com';
const LISTINGS_COLLECTION = 'anuncios';
const LISTING_ACTIONS_COLLECTION = 'mercadoLivreListingActions';
const SYNC_STATE_COLLECTION = 'mercadoLivreListingsSyncState';
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const SCAN_LIMIT = 100;
const FETCH_BATCH_SIZE = 20;
const ANALYTICS_CONCURRENCY = 5;
const WRITE_BATCH_SIZE = 450;

export type MlListingsViewMode = 'list' | 'grouped';
export type MlListingsGroupBy = 'sku' | 'catalog';
export type MlCatalogMode = 'catalog' | 'list';
export type MlListingsAnalysisFilter =
  | 'all'
  | 'with_visits'
  | 'without_visits'
  | 'low_conversion'
  | 'low_quality'
  | 'price_automation'
  | 'special_logistics'
  | 'with_ads'
  | 'without_ads'
  | 'ads_low_roas'
  | 'ads_high_acos'
  | 'ads_low_ctr'
  | 'ads_low_cvr'
  | 'ads_high_spend_no_sales';
export type MlListingUpdateAction = 'price' | 'stock' | 'status' | 'title' | 'description' | 'attributes';
export type MlListingEditableStatus = 'active' | 'paused' | 'closed';

export type MlListingUpdateActor = {
  userId: string;
  name: string | null;
  email: string | null;
  role: string | null;
};

export type MlListingCacheRow = {
  id: string;
  itemId: string;
  accountId: string;
  accountName: string | null;
  sellerId: number | null;
  title: string | null;
  status: string | null;
  listingTypeId: string | null;
  catalogProductId: string | null;
  catalogListing: boolean | null;
  sellerSku: string | null;
  currencyId: string | null;
  price: number | null;
  availableQuantity: number | null;
  soldQuantity: number | null;
  permalink: string | null;
  thumbnail: string | null;
  categoryId: string | null;
  logisticType: string | null;
  freeShipping: boolean | null;
  health: number | null;
  condition: string | null;
  buyingMode: string | null;
  tags: string[];
  shippingTags: string[];
  subStatus: string[];
  warranty: string | null;
  acceptsMercadopago: boolean | null;
  picturesCount: number | null;
  dateCreated: string | null;
  lastUpdated: string | null;
  savedAt: string;
  visitsTotal?: number | null;
  visitsLast30Days?: number | null;
  visitsDailyLast30Days?: Array<{ date: string; total: number }>;
  visitsSyncedAt?: string | null;
  performanceScore?: number | null;
  performanceLevel?: string | null;
  performanceLevelWording?: string | null;
  performanceCompletedGoals?: number | null;
  performancePendingGoals?: number | null;
  performanceActions?: Array<{
    key: string | null;
    status: string | null;
    mode: string | null;
    title: string | null;
    score: number | null;
    progress: number | null;
  }>;
  performanceCalculatedAt?: string | null;
  performanceSyncedAt?: string | null;
  salePriceAmount?: number | null;
  regularAmount?: number | null;
  standardPrice?: number | null;
  hasPromotion?: boolean | null;
  pricesSyncedAt?: string | null;
  priceAutomationActive?: boolean | null;
  priceAutomationStatus?: string | null;
  priceAutomationRuleId?: string | null;
  priceAutomationMinPrice?: number | null;
  priceAutomationMaxPrice?: number | null;
  priceAutomationSyncedAt?: string | null;
  analyticsSyncedAt?: string | null;
  analyticsError?: string | null;
  adsCampaignId?: number | null;
  adsCampaignName?: string | null;
  adsAdGroupId?: number | null;
  adsUserProductId?: string | null;
  adsUserProductName?: string | null;
  adsStatus?: string | null;
  adsRecommended?: boolean | null;
  adsBuyBoxWinner?: boolean | null;
  adsImageQuality?: string | null;
  adsClicks?: number | null;
  adsPrints?: number | null;
  adsCtr?: number | null;
  adsCost?: number | null;
  adsCpc?: number | null;
  adsAcos?: number | null;
  adsCvr?: number | null;
  adsRoas?: number | null;
  adsSov?: number | null;
  adsDirectAmount?: number | null;
  adsIndirectAmount?: number | null;
  adsTotalAmount?: number | null;
  adsDirectUnitsQuantity?: number | null;
  adsIndirectUnitsQuantity?: number | null;
  adsUnitsQuantity?: number | null;
  adsAdvertisingItemsQuantity?: number | null;
  adsOrganicUnitsQuantity?: number | null;
  adsOrganicUnitsAmount?: number | null;
  adsOrganicItemsQuantity?: number | null;
  adsDateFrom?: string | null;
  adsDateTo?: string | null;
  adsSyncedAt?: string | null;
  rawItem?: Record<string, unknown>;
};

export type MlListingGroup = {
  groupKey: string;
  groupBy: MlListingsGroupBy;
  title: string;
  thumbnail: string | null;
  sellerSku: string | null;
  catalogProductId: string | null;
  totalListings: number;
  activeListings: number;
  pausedListings: number;
  accountNames: string[];
  priceMin: number | null;
  priceMax: number | null;
  totalStock: number;
  totalSold: number;
  totalVisitsLast30Days: number;
  averageQualityScore: number | null;
  adsListings: number;
  adsCost: number;
  adsTotalAmount: number;
  adsRoas: number | null;
  adsAcos: number | null;
  priceAutomationListings: number;
  lowConversionListings: number;
  hasProblems: boolean;
  listings: MlListingCacheRow[];
};

export type MlListingsFilters = {
  accountId?: string | null;
  status?: string[];
  listingType?: string[];
  catalogMode?: MlCatalogMode | null;
  search?: string | null;
  problemsOnly?: boolean;
  analysisFilter?: MlListingsAnalysisFilter | null;
  offset?: number;
  limit?: number;
  viewMode?: MlListingsViewMode;
  groupBy?: MlListingsGroupBy;
};

export type MlListingsSyncState = {
  accountId: string;
  accountName: string | null;
  lastSyncedAt: string | null;
  lastSyncStatus: 'ok' | 'error' | null;
  lastSyncError: string | null;
  totalSynced: number;
  totalRemoved: number;
  durationMs: number | null;
  analyticsSynced: number;
  analyticsFailed: number;
};

export type MlAdsRecommendation = {
  id: string;
  type:
    | 'increase_budget'
    | 'reduce_spend'
    | 'improve_listing'
    | 'pause_review'
    | 'ads_candidate';
  severity: 'positive' | 'warning' | 'critical';
  title: string;
  description: string;
  itemId: string | null;
  campaignId: number | null;
  campaignName: string | null;
  metricLabel: string;
  metricValue: number | null;
};

export type MlAdsCampaignListingSummary = {
  id: string;
  itemId: string;
  accountId: string;
  accountName: string | null;
  title: string | null;
  sellerSku: string | null;
  status: string | null;
  price: number | null;
  availableQuantity: number | null;
  soldQuantity: number | null;
  permalink: string | null;
  thumbnail: string | null;
  visitsLast30Days: number | null;
  qualityScore: number | null;
  adsStatus: string | null;
  adsAdGroupId: number | null;
  adsUserProductId: string | null;
  adsUserProductName: string | null;
  adsRecommended: boolean | null;
  adsBuyBoxWinner: boolean | null;
  adsImageQuality: string | null;
  adsCost: number;
  adsTotalAmount: number;
  adsUnitsQuantity: number;
  adsClicks: number;
  adsPrints: number;
  adsCtr: number | null;
  adsCvr: number | null;
  adsRoas: number | null;
  adsAcos: number | null;
  adsCpc: number | null;
  adsSov: number | null;
};

export type MlAdsCampaignAdGroupSummary = {
  key: string;
  label: string;
  adGroupId: number | null;
  userProductId: string | null;
  listingsCount: number;
  activeListings: number;
  cost: number;
  totalAmount: number;
  unitsQuantity: number;
  clicks: number;
  prints: number;
  ctr: number | null;
  cvr: number | null;
  roas: number | null;
  acos: number | null;
  topItemId: string | null;
  thumbnail: string | null;
};

export type MlAdsCampaignDailyPoint = {
  date: string;
  cost: number;
  totalAmount: number;
  unitsQuantity: number;
  clicks: number;
  prints: number;
  ctr: number | null;
  cvr: number | null;
  cpc: number | null;
  roas: number | null;
  acos: number | null;
  sov: number | null;
};

export type MlAdsCampaignDetail = MlAdsCampaignSummary & {
  localListingsCount: number;
  activeListings: number;
  pausedListings: number;
  visitsLast30Days: number;
  averageQualityScore: number | null;
  highSpendNoSales: number;
  lowRoasListings: number;
  highAcosListings: number;
  lowCtrListings: number;
  lowCvrListings: number;
  history: MlAdsCampaignDailyPoint[];
  adGroups: MlAdsCampaignAdGroupSummary[];
  listings: MlAdsCampaignListingSummary[];
};

export type MlListingsListResult = {
  listings: MlListingCacheRow[];
  groups: MlListingGroup[];
  paging: {
    total: number;
    offset: number;
    limit: number;
  };
  statusSummary: {
    total: number;
    active: number;
    paused: number;
    closed: number;
    problems: number;
  };
  summary: {
    total: number;
    active: number;
    paused: number;
    closed: number;
    problems: number;
    totalStock: number;
    totalSold: number;
    visitsLast30Days: number;
    withVisitsLast30Days: number;
    withoutVisitsLast30Days: number;
    lowQuality: number;
    lowConversion: number;
    priceAutomationActive: number;
    specialLogistics: number;
    averageQualityScore: number | null;
    conversionRate30Days: number | null;
    gmvEstimated: number;
    averagePrice: number | null;
    adsListings: number;
    adsClicks: number;
    adsPrints: number;
    adsCost: number;
    adsTotalAmount: number;
    adsUnitsQuantity: number;
    adsRoas: number | null;
    adsAcos: number | null;
    adsCtr: number | null;
    adsCvr: number | null;
    adsLowRoas: number;
    adsHighAcos: number;
    adsLowCtr: number;
    adsLowCvr: number;
    adsHighSpendNoSales: number;
  };
  syncState: MlListingsSyncState | null;
  adsSyncState: MlAdsSyncState | null;
  adsCampaigns: MlAdsCampaignSummary[];
  adsCampaignDetails: MlAdsCampaignDetail[];
  adsRecommendations: MlAdsRecommendation[];
};

export type MlListingsSyncReport = MlListingsSyncState & {
  totalScanned: number;
  totalFetched: number;
  analyticsSynced: number;
  analyticsFailed: number;
  failedItems: Array<{ itemId: string; code: number | null; message: string | null }>;
};

export type MlListingUpdateResult = {
  action: MlListingUpdateAction;
  auditId: string;
  listing: MlListingCacheRow;
  previousValue: number | string | null;
  newValue: number | string | null;
};

export type MlListingDescription = {
  plainText: string;
  text: string | null;
  dateCreated: string | null;
  lastUpdated: string | null;
  syncedAt: string;
};

export type MlListingAttributeValue = {
  id: string;
  name: string | null;
  valueId: string | null;
  valueName: string | null;
  valueType: string | null;
  attributeGroupId: string | null;
  attributeGroupName: string | null;
  tags: Record<string, unknown>;
  editable: boolean;
  required: boolean;
  current: boolean;
};

export type MlCategoryAttributeDefinition = {
  id: string;
  name: string | null;
  valueType: string | null;
  tags: Record<string, unknown>;
  values: Array<{ id: string | null; name: string | null }>;
  attributeGroupId: string | null;
  attributeGroupName: string | null;
  required: boolean;
  editable: boolean;
};

export type MlListingAttributePatch = {
  id: string;
  valueName: string;
};

export type MlListingDetails = {
  listing: MlListingCacheRow;
  description: MlListingDescription | null;
  attributes: MlListingAttributeValue[];
  categoryAttributes: MlCategoryAttributeDefinition[];
};

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asInteger(value: unknown): number | null {
  const parsed = asNumber(value);
  return parsed === null ? null : Math.trunc(parsed);
}

function asBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
  return null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(asString).filter((entry): entry is string => Boolean(entry));
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.map(asRecord).filter((entry) => Object.keys(entry).length > 0);
}

function asTags(value: unknown): Record<string, unknown> {
  return asRecord(value);
}

function isTruthyTag(tags: Record<string, unknown>, keys: string[]) {
  return keys.some((key) => {
    const value = tags[key];
    if (value === true) return true;
    if (typeof value === 'string') return value.toLowerCase() === 'true';
    if (typeof value === 'number') return value === 1;
    return false;
  });
}

function isRequiredAttribute(tags: Record<string, unknown>) {
  return isTruthyTag(tags, ['required', 'catalog_required']);
}

function isEditableAttribute(valueType: string | null, tags: Record<string, unknown>) {
  const supportedValueTypes = new Set(['string', 'number', 'number_unit']);
  if (!valueType || !supportedValueTypes.has(valueType)) return false;
  if (isTruthyTag(tags, ['read_only', 'hidden', 'fixed', 'variation_attribute', 'multivalued'])) return false;
  return true;
}

function asNumberOrNull(value: unknown): number | null {
  return asNumber(value);
}

function asBooleanOrNull(value: unknown): boolean | null {
  return asBoolean(value);
}

function asVisitsDailyArray(value: unknown): Array<{ date: string; total: number }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const record = asRecord(entry);
      const date = asString(record.date);
      const total = asInteger(record.total) ?? asInteger(record.total_visits);
      if (!date || total === null) return null;
      return { date, total };
    })
    .filter((entry): entry is { date: string; total: number } => Boolean(entry));
}

function asPerformanceActions(value: unknown): MlListingCacheRow['performanceActions'] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const record = asRecord(entry);
      return {
        key: asString(record.key),
        status: asString(record.status),
        mode: asString(record.mode),
        title: asString(record.title),
        score: asNumber(record.score),
        progress: asNumber(record.progress),
      };
    })
    .filter((entry) => entry.key || entry.title);
}

function normalizeMlScore(value: number | null) {
  if (value === null) return null;
  return value <= 1 ? Math.round(value * 100) : Math.round(value);
}

function qualityScore(row: MlListingCacheRow) {
  return normalizeMlScore(row.performanceScore ?? null)
    ?? normalizeMlScore(row.health ?? null);
}

function isSpecialLogistics(row: MlListingCacheRow) {
  const logisticType = row.logisticType || '';
  const tags = new Set([...row.tags, ...row.shippingTags]);
  return (
    logisticType === 'fulfillment' ||
    logisticType === 'self_service' ||
    tags.has('fulfillment') ||
    tags.has('self_service')
  );
}

function isLowConversion(row: MlListingCacheRow) {
  const visits = row.visitsLast30Days ?? 0;
  const sold = row.soldQuantity ?? 0;
  return visits >= 20 && sold === 0;
}

function hasAds(row: MlListingCacheRow) {
  return Boolean(row.adsCampaignId || (row.adsCost ?? 0) > 0 || (row.adsPrints ?? 0) > 0 || (row.adsClicks ?? 0) > 0);
}

function isAdsLowRoas(row: MlListingCacheRow) {
  return hasAds(row) && (row.adsCost ?? 0) > 0 && (row.adsRoas ?? 0) > 0 && (row.adsRoas ?? 0) < 3;
}

function isAdsHighAcos(row: MlListingCacheRow) {
  return hasAds(row) && (row.adsTotalAmount ?? 0) > 0 && (row.adsAcos ?? 0) > 30;
}

function isAdsLowCtr(row: MlListingCacheRow) {
  return hasAds(row) && (row.adsPrints ?? 0) >= 1000 && (row.adsCtr ?? 0) < 0.2;
}

function isAdsLowCvr(row: MlListingCacheRow) {
  return hasAds(row) && (row.adsClicks ?? 0) >= 50 && (row.adsCvr ?? 0) < 1;
}

function isAdsHighSpendNoSales(row: MlListingCacheRow) {
  return hasAds(row) && (row.adsCost ?? 0) >= 50 && (row.adsUnitsQuantity ?? 0) === 0;
}

function firstImageUrl(raw: Record<string, unknown>): string | null {
  const direct = asString(raw.thumbnail) || asString(raw.secure_thumbnail);
  if (direct) return direct;

  const pictures = Array.isArray(raw.pictures) ? raw.pictures : [];
  for (const picture of pictures) {
    const record = asRecord(picture);
    const url = asString(record.secure_url) || asString(record.url);
    if (url) return url;
  }
  return null;
}

function extractAttributeValue(rawAttributes: unknown, ids: string[]): string | null {
  if (!Array.isArray(rawAttributes)) return null;
  const accepted = new Set(ids);
  for (const entry of rawAttributes) {
    const attribute = asRecord(entry);
    const id = asString(attribute.id);
    if (!id || !accepted.has(id)) continue;
    return asString(attribute.value_name) || asString(attribute.valueName);
  }
  return null;
}

function normalizeCategoryAttributeDefinition(raw: Record<string, unknown>): MlCategoryAttributeDefinition | null {
  const id = asString(raw.id);
  if (!id) return null;

  const tags = asTags(raw.tags);
  const valueType = asString(raw.value_type) || asString(raw.valueType);
  return {
    id,
    name: asString(raw.name),
    valueType,
    tags,
    values: asRecordArray(raw.values)
      .map((value) => ({
        id: asString(value.id),
        name: asString(value.name),
      }))
      .filter((value) => value.id || value.name),
    attributeGroupId: asString(raw.attribute_group_id) || asString(raw.attributeGroupId),
    attributeGroupName: asString(raw.attribute_group_name) || asString(raw.attributeGroupName),
    required: isRequiredAttribute(tags),
    editable: isEditableAttribute(valueType, tags),
  };
}

function normalizeListingAttributes(
  rawAttributes: unknown,
  categoryAttributes: MlCategoryAttributeDefinition[],
): MlListingAttributeValue[] {
  const definitionsById = new Map(categoryAttributes.map((definition) => [definition.id, definition]));
  const seenIds = new Set<string>();
  const currentAttributes = asRecordArray(rawAttributes)
    .map((raw) => {
      const id = asString(raw.id);
      if (!id) return null;
      const definition = definitionsById.get(id);
      const rawTags = asTags(raw.tags);
      const tags = { ...(definition?.tags || {}), ...rawTags };
      const valueType = asString(raw.value_type) || asString(raw.valueType) || definition?.valueType || null;
      const valueId = asString(raw.value_id) || asString(raw.valueId);
      const valueName = asString(raw.value_name) || asString(raw.valueName);
      seenIds.add(id);
      return {
        id,
        name: asString(raw.name) || definition?.name || null,
        valueId,
        valueName,
        valueType,
        attributeGroupId: asString(raw.attribute_group_id) || asString(raw.attributeGroupId) || definition?.attributeGroupId || null,
        attributeGroupName: asString(raw.attribute_group_name) || asString(raw.attributeGroupName) || definition?.attributeGroupName || null,
        tags,
        editable: definition?.editable ?? isEditableAttribute(valueType, tags),
        required: definition?.required ?? isRequiredAttribute(tags),
        current: Boolean(valueId || valueName),
      } satisfies MlListingAttributeValue;
    })
    .filter((attribute): attribute is MlListingAttributeValue => Boolean(attribute));

  const missingCategoryAttributes = categoryAttributes
    .filter((definition) => !seenIds.has(definition.id) && (definition.editable || definition.required))
    .map((definition) => ({
      id: definition.id,
      name: definition.name,
      valueId: null,
      valueName: null,
      valueType: definition.valueType,
      attributeGroupId: definition.attributeGroupId,
      attributeGroupName: definition.attributeGroupName,
      tags: definition.tags,
      editable: definition.editable,
      required: definition.required,
      current: false,
    } satisfies MlListingAttributeValue));

  return [...currentAttributes, ...missingCategoryAttributes];
}

function validateAttributePatches(input: MlListingAttributePatch[]): MlListingAttributePatch[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error('Nenhum atributo informado para atualizar.');
  }

  const normalized = new Map<string, MlListingAttributePatch>();
  for (const patch of input) {
    const id = typeof patch?.id === 'string' ? patch.id.trim() : '';
    const valueName = typeof patch?.valueName === 'string' ? patch.valueName.trim() : '';
    if (!id) throw new Error('Atributo sem identificador.');
    if (id.length > 80) throw new Error(`Identificador de atributo muito longo: ${id}.`);
    if (!valueName) throw new Error(`Valor do atributo ${id} nao informado.`);
    if (valueName.length > 255) throw new Error(`Valor do atributo ${id} excede 255 caracteres.`);
    normalized.set(id, { id, valueName });
  }

  if (normalized.size > 50) {
    throw new Error('Atualize no maximo 50 atributos por vez.');
  }

  return Array.from(normalized.values());
}

function attributeValueForAudit(
  patches: MlListingAttributePatch[],
  attributes: MlListingAttributeValue[],
) {
  const attributesById = new Map(attributes.map((attribute) => [attribute.id, attribute]));
  return patches
    .map((patch) => {
      const attribute = attributesById.get(patch.id);
      const label = attribute?.name ? `${attribute.name} (${patch.id})` : patch.id;
      return `${label}: ${attribute?.valueName || '-'}`;
    })
    .join(' | ')
    .slice(0, 5000);
}

function attributePatchesForAudit(patches: MlListingAttributePatch[]) {
  return patches
    .map((patch) => `${patch.id}: ${patch.valueName}`)
    .join(' | ')
    .slice(0, 5000);
}

function assertAttributePatchesEditable(
  patches: MlListingAttributePatch[],
  attributes: MlListingAttributeValue[],
  categoryAttributes: MlCategoryAttributeDefinition[],
) {
  const attributesById = new Map(attributes.map((attribute) => [attribute.id, attribute]));
  const definitionsById = new Map(categoryAttributes.map((definition) => [definition.id, definition]));

  for (const patch of patches) {
    const attribute = attributesById.get(patch.id);
    const definition = definitionsById.get(patch.id);
    const editable = attribute?.editable ?? definition?.editable ?? false;
    if (!editable) {
      const label = attribute?.name || definition?.name || patch.id;
      throw new Error(`O atributo ${label} nao esta liberado para edicao por texto/numerico nesta versao.`);
    }
  }
}

function normalizeAttributeForPut(raw: Record<string, unknown>): Record<string, unknown> | null {
  const id = asString(raw.id);
  if (!id) return null;

  const valueId = asString(raw.value_id) || asString(raw.valueId);
  const valueName = asString(raw.value_name) || asString(raw.valueName);
  const output: Record<string, unknown> = { id };
  if (valueId) output.value_id = valueId;
  if (valueName) output.value_name = valueName;
  if (raw.value_struct && typeof raw.value_struct === 'object') output.value_struct = raw.value_struct;
  if (Array.isArray(raw.values) && raw.values.length > 0) output.values = raw.values;
  return output;
}

function mergeAttributesForUpdate(
  rawAttributes: unknown,
  patches: MlListingAttributePatch[],
): Record<string, unknown>[] {
  const order: string[] = [];
  const byId = new Map<string, Record<string, unknown>>();

  for (const rawAttribute of asRecordArray(rawAttributes)) {
    const normalized = normalizeAttributeForPut(rawAttribute);
    const id = asString(normalized?.id);
    if (!normalized || !id || byId.has(id)) continue;
    byId.set(id, normalized);
    order.push(id);
  }

  for (const patch of patches) {
    const next = { ...(byId.get(patch.id) || { id: patch.id }) };
    next.value_name = patch.valueName;
    delete next.value_id;
    delete next.value_struct;
    delete next.values;
    if (!byId.has(patch.id)) order.push(patch.id);
    byId.set(patch.id, next);
  }

  return order.map((id) => byId.get(id)).filter((attribute): attribute is Record<string, unknown> => Boolean(attribute));
}

function extractWarranty(rawSaleTerms: unknown): string | null {
  if (!Array.isArray(rawSaleTerms)) return null;
  for (const entry of rawSaleTerms) {
    const term = asRecord(entry);
    if (asString(term.id) !== 'WARRANTY_TYPE' && asString(term.id) !== 'WARRANTY_TIME') continue;
    const value = asString(term.value_name) || asString(term.valueName);
    if (value) return value;
  }
  return null;
}

function normalizeListingFromMl(input: {
  raw: Record<string, unknown>;
  accountId: string;
  accountName: string | null;
  sellerId: number | null;
  savedAt: string;
}): MlListingCacheRow | null {
  const raw = input.raw;
  const itemId = asString(raw.id);
  if (!itemId) return null;

  const shipping = asRecord(raw.shipping);
  const attributes = raw.attributes;
  const sellerSku =
    asString(raw.seller_custom_field) ||
    extractAttributeValue(attributes, ['SELLER_SKU', 'SELLER_CUSTOM_FIELD']);
  const listingTypeId = asString(raw.listing_type_id);
  const price = asNumber(raw.price);

  return {
    id: `${input.accountId}:${itemId}`,
    itemId,
    accountId: input.accountId,
    accountName: input.accountName,
    sellerId: input.sellerId,
    title: asString(raw.title),
    status: asString(raw.status),
    listingTypeId,
    catalogProductId: asString(raw.catalog_product_id),
    catalogListing: asBoolean(raw.catalog_listing),
    sellerSku,
    currencyId: asString(raw.currency_id),
    price,
    availableQuantity: asInteger(raw.available_quantity),
    soldQuantity: asInteger(raw.sold_quantity),
    permalink: asString(raw.permalink),
    thumbnail: firstImageUrl(raw),
    categoryId: asString(raw.category_id),
    logisticType: asString(shipping.logistic_type),
    freeShipping: asBoolean(shipping.free_shipping),
    health: asNumber(raw.health) ?? asNumber(asRecord(raw.health_score).value),
    condition: asString(raw.condition),
    buyingMode: asString(raw.buying_mode),
    tags: asStringArray(raw.tags),
    shippingTags: asStringArray(shipping.tags),
    subStatus: asStringArray(raw.sub_status),
    warranty: extractWarranty(raw.sale_terms),
    acceptsMercadopago: asBoolean(raw.accepts_mercadopago),
    picturesCount: Array.isArray(raw.pictures) ? raw.pictures.length : null,
    dateCreated: asString(raw.date_created),
    lastUpdated: asString(raw.last_updated),
    savedAt: input.savedAt,
    rawItem: raw,
  };
}

function fromFirestoreRow(data: DocumentData, id: string): MlListingCacheRow {
  return {
    id,
    itemId: String(data.itemId || data.id || ''),
    accountId: String(data.accountId || ''),
    accountName: data.accountName ?? null,
    sellerId: typeof data.sellerId === 'number' ? data.sellerId : null,
    title: data.title ?? null,
    status: data.status ?? null,
    listingTypeId: data.listingTypeId ?? data.listing_type_id ?? null,
    catalogProductId: data.catalogProductId ?? data.catalog_product_id ?? null,
    catalogListing: typeof data.catalogListing === 'boolean' ? data.catalogListing : data.catalog_listing ?? null,
    sellerSku: data.sellerSku ?? data.seller_custom_field ?? null,
    currencyId: data.currencyId ?? data.currency_id ?? null,
    price: typeof data.price === 'number' ? data.price : asNumber(data.price),
    availableQuantity: typeof data.availableQuantity === 'number' ? data.availableQuantity : asInteger(data.available_quantity),
    soldQuantity: typeof data.soldQuantity === 'number' ? data.soldQuantity : asInteger(data.sold_quantity),
    permalink: data.permalink ?? null,
    thumbnail: data.thumbnail ?? null,
    categoryId: data.categoryId ?? data.category_id ?? null,
    logisticType: data.logisticType ?? data.shipping?.logistic_type ?? null,
    freeShipping: typeof data.freeShipping === 'boolean' ? data.freeShipping : data.shipping?.free_shipping ?? null,
    health: typeof data.health === 'number' ? data.health : asNumber(data.health),
    condition: data.condition ?? null,
    buyingMode: data.buyingMode ?? data.buying_mode ?? null,
    tags: Array.isArray(data.tags) ? data.tags : [],
    shippingTags: Array.isArray(data.shippingTags) ? data.shippingTags : Array.isArray(data.shipping_tags) ? data.shipping_tags : [],
    subStatus: Array.isArray(data.subStatus) ? data.subStatus : Array.isArray(data.sub_status) ? data.sub_status : [],
    warranty: data.warranty ?? null,
    acceptsMercadopago: typeof data.acceptsMercadopago === 'boolean' ? data.acceptsMercadopago : data.accepts_mercadopago ?? null,
    picturesCount: typeof data.picturesCount === 'number' ? data.picturesCount : null,
    dateCreated: data.dateCreated ?? data.date_created ?? null,
    lastUpdated: data.lastUpdated ?? data.last_updated ?? null,
    savedAt: data.savedAt ?? data.saved_at ?? '',
    visitsTotal: asNumberOrNull(data.visitsTotal),
    visitsLast30Days: asNumberOrNull(data.visitsLast30Days),
    visitsDailyLast30Days: asVisitsDailyArray(data.visitsDailyLast30Days),
    visitsSyncedAt: data.visitsSyncedAt ?? null,
    performanceScore: asNumberOrNull(data.performanceScore),
    performanceLevel: data.performanceLevel ?? null,
    performanceLevelWording: data.performanceLevelWording ?? null,
    performanceCompletedGoals: asInteger(data.performanceCompletedGoals),
    performancePendingGoals: asInteger(data.performancePendingGoals),
    performanceActions: asPerformanceActions(data.performanceActions),
    performanceCalculatedAt: data.performanceCalculatedAt ?? null,
    performanceSyncedAt: data.performanceSyncedAt ?? null,
    salePriceAmount: asNumberOrNull(data.salePriceAmount),
    regularAmount: asNumberOrNull(data.regularAmount),
    standardPrice: asNumberOrNull(data.standardPrice),
    hasPromotion: asBooleanOrNull(data.hasPromotion),
    pricesSyncedAt: data.pricesSyncedAt ?? null,
    priceAutomationActive: asBooleanOrNull(data.priceAutomationActive),
    priceAutomationStatus: data.priceAutomationStatus ?? null,
    priceAutomationRuleId: data.priceAutomationRuleId ?? null,
    priceAutomationMinPrice: asNumberOrNull(data.priceAutomationMinPrice),
    priceAutomationMaxPrice: asNumberOrNull(data.priceAutomationMaxPrice),
    priceAutomationSyncedAt: data.priceAutomationSyncedAt ?? null,
    analyticsSyncedAt: data.analyticsSyncedAt ?? null,
    analyticsError: data.analyticsError ?? null,
    rawItem: asRecord(data.rawItem),
  };
}

function applyAdsToListing(row: MlListingCacheRow, ad: MlAdsListingRow | undefined): MlListingCacheRow {
  if (!ad) return row;
  return {
    ...row,
    adsCampaignId: ad.campaignId,
    adsCampaignName: ad.campaignName,
    adsAdGroupId: ad.adGroupId,
    adsUserProductId: ad.userProductId,
    adsUserProductName: ad.userProductName,
    adsStatus: ad.status,
    adsRecommended: ad.recommended,
    adsBuyBoxWinner: ad.buyBoxWinner,
    adsImageQuality: ad.imageQuality,
    adsClicks: ad.metrics.clicks,
    adsPrints: ad.metrics.prints,
    adsCtr: ad.metrics.ctr,
    adsCost: ad.metrics.cost,
    adsCpc: ad.metrics.cpc,
    adsAcos: ad.metrics.acos,
    adsCvr: ad.metrics.cvr,
    adsRoas: ad.metrics.roas,
    adsSov: ad.metrics.sov,
    adsDirectAmount: ad.metrics.directAmount,
    adsIndirectAmount: ad.metrics.indirectAmount,
    adsTotalAmount: ad.metrics.totalAmount,
    adsDirectUnitsQuantity: ad.metrics.directUnitsQuantity,
    adsIndirectUnitsQuantity: ad.metrics.indirectUnitsQuantity,
    adsUnitsQuantity: ad.metrics.unitsQuantity,
    adsAdvertisingItemsQuantity: ad.metrics.advertisingItemsQuantity,
    adsOrganicUnitsQuantity: ad.metrics.organicUnitsQuantity,
    adsOrganicUnitsAmount: ad.metrics.organicUnitsAmount,
    adsOrganicItemsQuantity: ad.metrics.organicItemsQuantity,
    adsDateFrom: ad.dateFrom,
    adsDateTo: ad.dateTo,
    adsSyncedAt: ad.syncedAt,
  };
}

async function enrichListingsWithAds(rows: MlListingCacheRow[], accountId?: string | null) {
  if (rows.length === 0) return rows;
  const adsByListing = await loadMercadoLivreAdsListingsMap(accountId);
  return rows.map((row) => applyAdsToListing(row, adsByListing.get(`${row.accountId}:${row.itemId}`)));
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

function listingAuditSnapshot(row: MlListingCacheRow) {
  return {
    id: row.id,
    itemId: row.itemId,
    accountId: row.accountId,
    accountName: row.accountName,
    title: row.title,
    sellerSku: row.sellerSku,
    status: row.status,
    price: row.price,
    availableQuantity: row.availableQuantity,
    soldQuantity: row.soldQuantity,
    permalink: row.permalink,
  };
}

function errorMessageFromMlPayload(payload: unknown, fallback: string) {
  const data = asRecord(payload);
  const causes = Array.isArray(data.cause) ? data.cause : [];
  const causeMessage = causes
    .map((entry) => asString(asRecord(entry).message))
    .find(Boolean);
  return (
    causeMessage ||
    asString(data.message) ||
    asString(data.error) ||
    fallback
  );
}

function validateItemId(itemId: string) {
  const normalized = itemId.trim();
  if (!normalized) throw new Error('ID do anúncio não informado.');
  if (!/^ML[A-Z]?\d+$/i.test(normalized)) {
    throw new Error('ID do anúncio Mercado Livre inválido.');
  }
  return normalized.toUpperCase();
}

function validateAccountId(accountId: string) {
  const normalized = accountId.trim();
  if (!normalized) throw new Error('Conta Mercado Livre não informada.');
  return normalized;
}

function validatePrice(price: number) {
  if (!Number.isFinite(price)) throw new Error('Preço inválido.');
  const normalized = Math.round(price * 100) / 100;
  if (normalized <= 0) throw new Error('Preço precisa ser maior que zero.');
  return normalized;
}

function validateStock(stock: number) {
  if (!Number.isFinite(stock)) throw new Error('Estoque inválido.');
  const normalized = Math.trunc(stock);
  if (normalized < 0) throw new Error('Estoque não pode ser negativo.');
  return normalized;
}

function validateTitle(title: string) {
  const normalized = title.trim().replace(/\s+/g, ' ');
  if (!normalized) throw new Error('Título não informado.');
  if (normalized.length > 120) throw new Error('Título precisa ter no máximo 120 caracteres.');
  return normalized;
}

function validateDescription(plainText: string) {
  const normalized = plainText.replace(/\r\n/g, '\n').trim();
  if (!normalized) throw new Error('Descrição não informada.');
  if (normalized.length > 50000) throw new Error('Descrição muito longa. Limite local: 50.000 caracteres.');
  return normalized;
}

function validateEditableStatus(status: string): MlListingEditableStatus {
  if (status !== 'active' && status !== 'paused' && status !== 'closed') {
    throw new Error('Status permitido: active, paused ou closed.');
  }
  return status;
}

async function getListingForMutation(accountId: string, itemId: string) {
  const id = `${accountId}:${itemId}`;
  const snap = await adminDb.collection(LISTINGS_COLLECTION).doc(id).get();
  if (!snap.exists) {
    throw new Error('Anúncio não encontrado no cache local. Sincronize os anúncios antes de editar.');
  }
  const listing = fromFirestoreRow(snap.data() || {}, snap.id);
  if (listing.accountId !== accountId || listing.itemId !== itemId) {
    throw new Error('Anúncio não pertence à conta Mercado Livre informada.');
  }
  return listing;
}

async function createListingActionLog(input: {
  actor: MlListingUpdateActor;
  action: MlListingUpdateAction;
  field: string;
  listing: MlListingCacheRow;
  previousValue: number | string | null;
  newValue: number | string | null;
}) {
  const now = new Date().toISOString();
  const ref = adminDb.collection(LISTING_ACTIONS_COLLECTION).doc();
  await ref.set({
    accountId: input.listing.accountId,
    itemId: input.listing.itemId,
    listingDocId: input.listing.id,
    sellerSku: input.listing.sellerSku,
    title: input.listing.title,
    action: input.action,
    field: input.field,
    previousValue: input.previousValue,
    newValue: input.newValue,
    status: 'pending',
    error: null,
    actor: input.actor,
    listingBefore: listingAuditSnapshot(input.listing),
    createdAt: now,
    completedAt: null,
  });
  return ref;
}

async function markListingActionLogSuccess(input: {
  auditId: string;
  listing: MlListingCacheRow;
}) {
  await adminDb.collection(LISTING_ACTIONS_COLLECTION).doc(input.auditId).set({
    status: 'success',
    error: null,
    listingAfter: listingAuditSnapshot(input.listing),
    completedAt: new Date().toISOString(),
  }, { merge: true });
}

async function markListingActionLogError(input: {
  auditId: string;
  error: string;
}) {
  await adminDb.collection(LISTING_ACTIONS_COLLECTION).doc(input.auditId).set({
    status: 'error',
    error: input.error,
    completedAt: new Date().toISOString(),
  }, { merge: true });
}

async function resolveAccountForSync(accountId?: string | null) {
  const resolvedAccountId = accountId || await getPrimaryMlAccountIdAdmin();
  if (!resolvedAccountId) {
    throw new Error('Nenhuma conta Mercado Livre configurada.');
  }

  const accountRef = adminDb.collection('mercadoLivreAccounts').doc(resolvedAccountId);
  const accountSnap = await accountRef.get();
  if (!accountSnap.exists) {
    throw new Error(`Conta Mercado Livre ${resolvedAccountId} não encontrada.`);
  }

  const credentials = accountSnap.data() as MercadoLivreCredentials;
  const accessToken = await getMlToken(resolvedAccountId);
  let sellerId = asInteger(credentials.sellerId) ?? asInteger(credentials.userId);
  let accountName = credentials.accountName || credentials.nickname || resolvedAccountId;

  if (!sellerId || !credentials.nickname) {
    const response = await fetch(`${ML_API_BASE}/users/me`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(`Falha ao identificar vendedor Mercado Livre (${response.status}).`);
    }

    const profile = asRecord(await readJson(response));
    sellerId = asInteger(profile.id) ?? sellerId;
    accountName = asString(profile.nickname) || accountName;

    await saveMlCredentialsAdmin(resolvedAccountId, {
      sellerId: sellerId ?? undefined,
      userId: sellerId ?? undefined,
      nickname: accountName ?? undefined,
      accountName: accountName ?? undefined,
      apiStatus: 'valid',
    });
  }

  if (!sellerId) {
    throw new Error('Conta Mercado Livre sem seller/user id. Reconecte a conta.');
  }

  return { accountId: resolvedAccountId, accountName, sellerId, accessToken };
}

async function scanSellerItemIds(input: {
  sellerId: number;
  accessToken: string;
  maxItems?: number;
}) {
  const collected = new Set<string>();
  const cap = Math.max(1, input.maxItems ?? 20000);
  let scrollId: string | null = null;
  let reportedTotal: number | null = null;

  while (collected.size < cap) {
    const url = new URL(`${ML_API_BASE}/users/${input.sellerId}/items/search`);
    url.searchParams.set('search_type', 'scan');
    url.searchParams.set('limit', String(SCAN_LIMIT));
    if (scrollId) url.searchParams.set('scroll_id', scrollId);

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${input.accessToken}`, Accept: 'application/json' },
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(`Falha ao varrer anúncios do vendedor (${response.status}).`);
    }

    const data = asRecord(await readJson(response));
    const paging = asRecord(data.paging);
    if (reportedTotal === null) reportedTotal = asInteger(paging.total);

    const results = Array.isArray(data.results) ? data.results : [];
    for (const result of results) {
      const itemId = asString(result);
      if (itemId) collected.add(itemId);
      if (collected.size >= cap) break;
    }

    scrollId = asString(data.scroll_id);
    if (!scrollId || results.length === 0 || results.length < SCAN_LIMIT) break;
  }

  return { itemIds: Array.from(collected), reportedTotal };
}

async function fetchItemsBatch(input: {
  itemIds: string[];
  accessToken: string;
}): Promise<{
  items: Record<string, unknown>[];
  failedItems: Array<{ itemId: string; code: number | null; message: string | null }>;
}> {
  const items: Record<string, unknown>[] = [];
  const failedItems: Array<{ itemId: string; code: number | null; message: string | null }> = [];

  for (let index = 0; index < input.itemIds.length; index += FETCH_BATCH_SIZE) {
    const batch = input.itemIds.slice(index, index + FETCH_BATCH_SIZE);
    const url = new URL(`${ML_API_BASE}/items`);
    url.searchParams.set('ids', batch.join(','));
    url.searchParams.set('include_attributes', 'all');

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${input.accessToken}`, Accept: 'application/json' },
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(`Falha ao carregar detalhes dos anúncios (${response.status}).`);
    }

    const rows = await readJson(response);
    if (!Array.isArray(rows)) continue;

    rows.forEach((row, rowIndex) => {
      const record = asRecord(row);
      const code = asInteger(record.code);
      const body = asRecord(record.body);
      const fallbackId = batch[rowIndex] || 'unknown';
      const itemId = asString(body.id) || fallbackId;

      if (code !== null && code !== 200) {
        failedItems.push({
          itemId,
          code,
          message: asString(body.message) || asString(record.error),
        });
        return;
      }

      if (Object.keys(body).length > 0) {
        items.push(body);
      }
    });
  }

  return { items, failedItems };
}

async function fetchSingleItem(input: {
  itemId: string;
  accessToken: string;
}) {
  const url = new URL(`${ML_API_BASE}/items/${input.itemId}`);
  url.searchParams.set('include_attributes', 'all');

  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${input.accessToken}`, Accept: 'application/json' },
    cache: 'no-store',
  });
  const payload = await readJson(response).catch(() => null);
  if (!response.ok) {
    throw new Error(errorMessageFromMlPayload(payload, `Falha ao atualizar cache do anúncio (${response.status}).`));
  }
  return asRecord(payload);
}

async function fetchCategoryAttributesFromMl(input: {
  categoryId: string;
  accessToken: string;
}): Promise<MlCategoryAttributeDefinition[]> {
  const response = await fetch(`${ML_API_BASE}/categories/${input.categoryId}/attributes`, {
    headers: { Authorization: `Bearer ${input.accessToken}`, Accept: 'application/json' },
    cache: 'no-store',
  });
  const payload = await readJson(response).catch(() => null);
  if (response.status === 404) return [];
  if (!response.ok) {
    throw new Error(errorMessageFromMlPayload(payload, `Falha ao carregar ficha tecnica da categoria (${response.status}).`));
  }
  if (!Array.isArray(payload)) return [];
  return payload
    .map((entry) => normalizeCategoryAttributeDefinition(asRecord(entry)))
    .filter((entry): entry is MlCategoryAttributeDefinition => Boolean(entry));
}

async function putMercadoLivreItem(input: {
  itemId: string;
  accessToken: string;
  payload: Record<string, unknown>;
}) {
  const response = await fetch(`${ML_API_BASE}/items/${input.itemId}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
    body: JSON.stringify(input.payload),
  });
  const payload = await readJson(response).catch(() => null);
  if (!response.ok) {
    throw new Error(errorMessageFromMlPayload(payload, `Falha ao editar anúncio no Mercado Livre (${response.status}).`));
  }
  return asRecord(payload);
}

async function fetchListingDescriptionFromMl(input: {
  itemId: string;
  accessToken: string;
}): Promise<MlListingDescription | null> {
  const response = await fetch(`${ML_API_BASE}/items/${input.itemId}/description`, {
    headers: { Authorization: `Bearer ${input.accessToken}`, Accept: 'application/json' },
    cache: 'no-store',
  });
  const payload = await readJson(response).catch(() => null);
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(errorMessageFromMlPayload(payload, `Falha ao carregar descrição do anúncio (${response.status}).`));
  }

  const data = asRecord(payload);
  return {
    plainText: asString(data.plain_text) || '',
    text: asString(data.text),
    dateCreated: asString(data.date_created),
    lastUpdated: asString(data.last_updated),
    syncedAt: new Date().toISOString(),
  };
}

async function saveListingDescriptionToMl(input: {
  itemId: string;
  accessToken: string;
  plainText: string;
  hasExistingDescription: boolean;
}) {
  const url = input.hasExistingDescription
    ? `${ML_API_BASE}/items/${input.itemId}/description?api_version=2`
    : `${ML_API_BASE}/items/${input.itemId}/description`;
  const response = await fetch(url, {
    method: input.hasExistingDescription ? 'PUT' : 'POST',
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
    body: JSON.stringify({ plain_text: input.plainText }),
  });
  const payload = await readJson(response).catch(() => null);
  if (!response.ok) {
    throw new Error(errorMessageFromMlPayload(payload, `Falha ao salvar descrição no Mercado Livre (${response.status}).`));
  }
  return asRecord(payload);
}

async function fetchJsonOptional(input: {
  url: string;
  accessToken: string;
  label: string;
}) {
  try {
    const response = await fetch(input.url, {
      headers: { Authorization: `Bearer ${input.accessToken}`, Accept: 'application/json' },
      cache: 'no-store',
    });
    const payload = await readJson(response).catch(() => null);
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        payload,
        error: errorMessageFromMlPayload(payload, `${input.label} (${response.status}).`),
      };
    }
    return { ok: true, status: response.status, payload, error: null };
  } catch (error) {
    return {
      ok: false,
      status: null,
      payload: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function parseVisitsTotal(payload: unknown, itemId: string) {
  const data = asRecord(payload);
  const directById = asInteger(data[itemId]);
  if (directById !== null) return directById;

  const directTotal = asInteger(data.total_visits) ?? asInteger(data.totalVisits);
  if (directTotal !== null) return directTotal;

  if (Array.isArray(payload)) {
    for (const entry of payload) {
      const record = asRecord(entry);
      if (asString(record.item_id) === itemId || asString(record.itemId) === itemId) {
        const total = asInteger(record.total_visits) ?? asInteger(record.totalVisits) ?? asInteger(record.visits);
        if (total !== null) return total;
      }
    }
  }

  return null;
}

function parseVisitsDetail(payload: unknown) {
  const data = asRecord(payload);
  return asRecordArray(data.visits_detail)
    .map((entry) => {
      const rawDate = asString(entry.date) || asString(entry.date_from) || asString(entry.period);
      const date = rawDate ? rawDate.slice(0, 10) : null;
      const total = asInteger(entry.total)
        ?? asInteger(entry.total_visits)
        ?? asInteger(entry.visits);
      if (!date || total === null) return null;
      return { date, total };
    })
    .filter((entry): entry is { date: string; total: number } => Boolean(entry));
}

async function fetchItemVisitsAnalytics(input: {
  itemId: string;
  accessToken: string;
  syncedAt: string;
}): Promise<Partial<MlListingCacheRow>> {
  const totalUrl = `${ML_API_BASE}/visits/items?ids=${encodeURIComponent(input.itemId)}`;
  const windowUrl = `${ML_API_BASE}/items/${encodeURIComponent(input.itemId)}/visits/time_window?last=30&unit=day`;
  const [totalResult, windowResult] = await Promise.all([
    fetchJsonOptional({ url: totalUrl, accessToken: input.accessToken, label: 'Falha ao buscar visitas totais' }),
    fetchJsonOptional({ url: windowUrl, accessToken: input.accessToken, label: 'Falha ao buscar visitas recentes' }),
  ]);

  const totalWindow = windowResult.ok ? asInteger(asRecord(windowResult.payload).total_visits) : null;
  const visitsDaily = windowResult.ok ? parseVisitsDetail(windowResult.payload) : [];

  return {
    visitsTotal: totalResult.ok ? parseVisitsTotal(totalResult.payload, input.itemId) : null,
    visitsLast30Days: totalWindow,
    visitsDailyLast30Days: visitsDaily,
    visitsSyncedAt: input.syncedAt,
  };
}

function extractPerformanceActions(payload: unknown) {
  const data = asRecord(payload);
  const roots = [
    ...asRecordArray(data.goals),
    ...asRecordArray(data.objectives),
    ...asRecordArray(data.components),
    ...asRecordArray(data.buckets),
  ];
  const actions: NonNullable<MlListingCacheRow['performanceActions']> = [];
  let completed = 0;
  let pending = 0;
  const seen = new Set<string>();

  const visit = (entries: Record<string, unknown>[], depth: number) => {
    if (depth > 4) return;

    entries.forEach((entry) => {
      const status = asString(entry.status);
      const key = asString(entry.key) || asString(entry.id);
      const title = asString(entry.title) || asString(entry.message);
      const mode = asString(entry.mode);

      if (status) {
        if (status === 'COMPLETED') completed += 1;
        else pending += 1;
      }

      if (status && status !== 'COMPLETED' && (key || title)) {
        const actionKey = `${key || ''}:${title || ''}`;
        if (!seen.has(actionKey)) {
          seen.add(actionKey);
          actions.push({
            key,
            status,
            mode,
            title,
            score: asNumber(entry.score),
            progress: asNumber(entry.progress),
          });
        }
      }

      visit(asRecordArray(entry.variables), depth + 1);
      visit(asRecordArray(entry.rules), depth + 1);
      visit(asRecordArray(entry.actions), depth + 1);
      visit(asRecordArray(entry.recommendations), depth + 1);
    });
  };

  visit(roots, 0);

  return {
    completed,
    pending,
    actions: actions.slice(0, 12),
  };
}

async function fetchItemPerformanceAnalytics(input: {
  itemId: string;
  accessToken: string;
  syncedAt: string;
}): Promise<Partial<MlListingCacheRow>> {
  const url = `${ML_API_BASE}/item/${encodeURIComponent(input.itemId)}/performance`;
  const result = await fetchJsonOptional({
    url,
    accessToken: input.accessToken,
    label: 'Falha ao buscar qualidade do anúncio',
  });

  if (!result.ok) {
    return {
      performanceSyncedAt: input.syncedAt,
    };
  }

  const data = asRecord(result.payload);
  const detail = extractPerformanceActions(result.payload);

  return {
    performanceScore: normalizeMlScore(asNumber(data.score)),
    performanceLevel: asString(data.level),
    performanceLevelWording: asString(data.level_wording),
    performanceCompletedGoals: detail.completed,
    performancePendingGoals: detail.pending,
    performanceActions: detail.actions,
    performanceCalculatedAt: asString(data.calculated_at),
    performanceSyncedAt: input.syncedAt,
  };
}

async function fetchItemPriceAnalytics(input: {
  itemId: string;
  accessToken: string;
  syncedAt: string;
}): Promise<Partial<MlListingCacheRow>> {
  const pricesUrl = `${ML_API_BASE}/items/${encodeURIComponent(input.itemId)}/prices`;
  const salePriceUrl = `${ML_API_BASE}/items/${encodeURIComponent(input.itemId)}/sale_price?context=channel_marketplace`;
  const [pricesResult, salePriceResult] = await Promise.all([
    fetchJsonOptional({ url: pricesUrl, accessToken: input.accessToken, label: 'Falha ao buscar preços' }),
    fetchJsonOptional({ url: salePriceUrl, accessToken: input.accessToken, label: 'Falha ao buscar preço de venda' }),
  ]);

  const pricesPayload = asRecord(pricesResult.payload);
  const prices = asRecordArray(pricesPayload.prices);
  const standard = prices.find((entry) => asString(entry.type) === 'standard');
  const promotional = prices.some((entry) => asString(entry.type) !== 'standard');
  const salePayload = asRecord(salePriceResult.payload);
  const salePriceAmount = salePriceResult.ok ? asNumber(salePayload.amount) : null;
  const regularAmount = salePriceResult.ok ? asNumber(salePayload.regular_amount) : null;

  return {
    standardPrice: standard ? asNumber(standard.amount) ?? asNumber(standard.price) : null,
    salePriceAmount,
    regularAmount,
    hasPromotion: promotional || (
      typeof regularAmount === 'number' &&
      typeof salePriceAmount === 'number' &&
      regularAmount > salePriceAmount
    ),
    pricesSyncedAt: input.syncedAt,
  };
}

async function fetchPriceAutomationItemIds(input: {
  sellerId: number;
  accessToken: string;
}) {
  const itemIds = new Set<string>();
  let offset = 0;
  const limit = 100;

  while (true) {
    const url = new URL(`${ML_API_BASE}/pricing-automation/users/${input.sellerId}/items`);
    url.searchParams.set('offset', String(offset));
    url.searchParams.set('limit', String(limit));

    const result = await fetchJsonOptional({
      url: url.toString(),
      accessToken: input.accessToken,
      label: 'Falha ao buscar automações de preço',
    });

    if (!result.ok) break;

    const data = asRecord(result.payload);
    asStringArray(data.items).forEach((itemId) => itemIds.add(itemId));
    const paging = asRecord(data.paging);
    const total = asInteger(paging.total) ?? itemIds.size;
    const returned = asStringArray(data.items).length;
    offset += limit;
    if (returned === 0 || offset >= total) break;
  }

  return itemIds;
}

async function fetchItemPriceAutomation(input: {
  itemId: string;
  accessToken: string;
  syncedAt: string;
}): Promise<Partial<MlListingCacheRow>> {
  const url = `${ML_API_BASE}/pricing-automation/items/${encodeURIComponent(input.itemId)}/automation`;
  const result = await fetchJsonOptional({
    url,
    accessToken: input.accessToken,
    label: 'Falha ao buscar automação de preço',
  });

  if (!result.ok) {
    const notFound = result.status === 404;
    return {
      priceAutomationActive: notFound ? false : null,
      priceAutomationStatus: null,
      priceAutomationRuleId: null,
      priceAutomationMinPrice: null,
      priceAutomationMaxPrice: null,
      priceAutomationSyncedAt: input.syncedAt,
    };
  }

  const data = asRecord(result.payload);
  const itemRule = asRecord(data.item_rule);
  const status = asString(data.status);

  return {
    priceAutomationActive: status === 'ACTIVE',
    priceAutomationStatus: status,
    priceAutomationRuleId: asString(itemRule.rule_id),
    priceAutomationMinPrice: asNumber(data.min_price),
    priceAutomationMaxPrice: asNumber(data.max_price),
    priceAutomationSyncedAt: input.syncedAt,
  };
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
) {
  const results = new Array<R>(values.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(values[index], index);
    }
  });

  await Promise.all(workers);
  return results;
}

async function enrichListingRowsWithAnalytics(input: {
  rows: MlListingCacheRow[];
  accessToken: string;
  sellerId: number;
  syncedAt: string;
}) {
  const automationItemIds = await fetchPriceAutomationItemIds({
    sellerId: input.sellerId,
    accessToken: input.accessToken,
  });

  let analyticsSynced = 0;
  let analyticsFailed = 0;

  const rows = await mapWithConcurrency(input.rows, ANALYTICS_CONCURRENCY, async (row) => {
    const errors: string[] = [];
    const baseAutomation: Partial<MlListingCacheRow> = {
      priceAutomationActive: automationItemIds.has(row.itemId),
      priceAutomationStatus: automationItemIds.has(row.itemId) ? 'ACTIVE' : null,
      priceAutomationSyncedAt: input.syncedAt,
    };

    const [visits, performance, prices, automation] = await Promise.allSettled([
      fetchItemVisitsAnalytics({ itemId: row.itemId, accessToken: input.accessToken, syncedAt: input.syncedAt }),
      row.status === 'active'
        ? fetchItemPerformanceAnalytics({ itemId: row.itemId, accessToken: input.accessToken, syncedAt: input.syncedAt })
        : Promise.resolve({ performanceSyncedAt: input.syncedAt }),
      fetchItemPriceAnalytics({ itemId: row.itemId, accessToken: input.accessToken, syncedAt: input.syncedAt }),
      automationItemIds.has(row.itemId)
        ? fetchItemPriceAutomation({ itemId: row.itemId, accessToken: input.accessToken, syncedAt: input.syncedAt })
        : Promise.resolve(baseAutomation),
    ]);

    const patch: Partial<MlListingCacheRow> = { ...baseAutomation };
    [visits, performance, prices, automation].forEach((result) => {
      if (result.status === 'fulfilled') {
        Object.assign(patch, result.value);
      } else {
        errors.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
      }
    });

    if (errors.length > 0) analyticsFailed += 1;
    else analyticsSynced += 1;

    return {
      ...row,
      ...patch,
      analyticsSyncedAt: input.syncedAt,
      analyticsError: errors.length > 0 ? errors.join(' | ') : null,
    };
  });

  return { rows, analyticsSynced, analyticsFailed };
}

async function writeListingRows(rows: MlListingCacheRow[]) {
  for (let index = 0; index < rows.length; index += WRITE_BATCH_SIZE) {
    const batch = adminDb.batch();
    rows.slice(index, index + WRITE_BATCH_SIZE).forEach((row) => {
      const ref = adminDb.collection(LISTINGS_COLLECTION).doc(row.id);
      batch.set(ref, row, { merge: true });
    });
    await batch.commit();
  }
}

function preserveAnalyticsFields(
  row: MlListingCacheRow,
  existing: MlListingCacheRow | null,
): MlListingCacheRow {
  if (!existing) return row;

  return {
    ...row,
    visitsTotal: existing.visitsTotal,
    visitsLast30Days: existing.visitsLast30Days,
    visitsDailyLast30Days: existing.visitsDailyLast30Days,
    visitsSyncedAt: existing.visitsSyncedAt,
    performanceScore: existing.performanceScore,
    performanceLevel: existing.performanceLevel,
    performanceLevelWording: existing.performanceLevelWording,
    performanceCompletedGoals: existing.performanceCompletedGoals,
    performancePendingGoals: existing.performancePendingGoals,
    performanceActions: existing.performanceActions,
    performanceCalculatedAt: existing.performanceCalculatedAt,
    performanceSyncedAt: existing.performanceSyncedAt,
    salePriceAmount: existing.salePriceAmount,
    regularAmount: existing.regularAmount,
    standardPrice: existing.standardPrice,
    hasPromotion: existing.hasPromotion,
    pricesSyncedAt: existing.pricesSyncedAt,
    priceAutomationActive: existing.priceAutomationActive,
    priceAutomationStatus: existing.priceAutomationStatus,
    priceAutomationRuleId: existing.priceAutomationRuleId,
    priceAutomationMinPrice: existing.priceAutomationMinPrice,
    priceAutomationMaxPrice: existing.priceAutomationMaxPrice,
    priceAutomationSyncedAt: existing.priceAutomationSyncedAt,
    analyticsSyncedAt: existing.analyticsSyncedAt,
    analyticsError: existing.analyticsError,
  };
}

async function refreshListingCacheFromMl(input: {
  accountId: string;
  accountName: string | null;
  sellerId: number | null;
  itemId: string;
  accessToken: string;
}) {
  const raw = await fetchSingleItem({
    itemId: input.itemId,
    accessToken: input.accessToken,
  });
  const row = normalizeListingFromMl({
    raw,
    accountId: input.accountId,
    accountName: input.accountName,
    sellerId: input.sellerId,
    savedAt: new Date().toISOString(),
  });
  if (!row) {
    throw new Error('Mercado Livre retornou um anúncio inválido após a edição.');
  }
  const existingSnap = await adminDb.collection(LISTINGS_COLLECTION).doc(row.id).get();
  const existing = existingSnap.exists ? fromFirestoreRow(existingSnap.data() || {}, existingSnap.id) : null;
  const rowWithAnalytics = preserveAnalyticsFields(row, existing);
  await writeListingRows([rowWithAnalytics]);
  return rowWithAnalytics;
}

export async function getMercadoLivreListingDetailsCache(input: {
  accountId: string;
  itemId: string;
}): Promise<MlListingDetails> {
  const accountId = validateAccountId(input.accountId);
  const itemId = validateItemId(input.itemId);
  const listing = await getListingForMutation(accountId, itemId);
  const account = await resolveAccountForSync(accountId);
  const [description, liveRaw] = await Promise.all([
    fetchListingDescriptionFromMl({
      itemId,
      accessToken: account.accessToken,
    }),
    fetchSingleItem({
      itemId,
      accessToken: account.accessToken,
    }),
  ]);
  const liveListing = normalizeListingFromMl({
    raw: liveRaw,
    accountId: account.accountId,
    accountName: account.accountName,
    sellerId: account.sellerId,
    savedAt: listing.savedAt || new Date().toISOString(),
  });
  const currentListingBase = liveListing ? preserveAnalyticsFields(liveListing, listing) : listing;
  const adsByListing = await loadMercadoLivreAdsListingsMap(accountId);
  const currentListing = applyAdsToListing(
    currentListingBase,
    adsByListing.get(`${currentListingBase.accountId}:${currentListingBase.itemId}`),
  );
  const categoryId = asString(liveRaw.category_id) || currentListing.categoryId;
  const categoryAttributes = categoryId
    ? await fetchCategoryAttributesFromMl({
      categoryId,
      accessToken: account.accessToken,
    }).catch(() => [])
    : [];
  const attributes = normalizeListingAttributes(liveRaw.attributes, categoryAttributes);
  return {
    listing: currentListing,
    description,
    attributes,
    categoryAttributes,
  };
}

async function deleteOrphanListings(accountId: string, keepIds: Set<string>) {
  const snapshot = await adminDb
    .collection(LISTINGS_COLLECTION)
    .where('accountId', '==', accountId)
    .get();

  const refs = snapshot.docs
    .filter((docSnap) => !keepIds.has(docSnap.id))
    .map((docSnap) => docSnap.ref);

  for (let index = 0; index < refs.length; index += WRITE_BATCH_SIZE) {
    const batch = adminDb.batch();
    refs.slice(index, index + WRITE_BATCH_SIZE).forEach((ref) => batch.delete(ref));
    await batch.commit();
  }

  return refs.length;
}

async function saveSyncState(state: MlListingsSyncState) {
  await adminDb
    .collection(SYNC_STATE_COLLECTION)
    .doc(state.accountId)
    .set(state, { merge: true });
}

export async function syncMercadoLivreListingsCache(input: {
  accountId?: string | null;
  maxItems?: number;
} = {}): Promise<MlListingsSyncReport> {
  const startedAt = Date.now();
  const syncedAt = new Date(startedAt).toISOString();
  const account = await resolveAccountForSync(input.accountId);

  try {
    const scan = await scanSellerItemIds({
      sellerId: account.sellerId,
      accessToken: account.accessToken,
      maxItems: input.maxItems,
    });
    const fetched = await fetchItemsBatch({
      itemIds: scan.itemIds,
      accessToken: account.accessToken,
    });

    const rows = fetched.items
      .map((raw) => normalizeListingFromMl({
        raw,
        accountId: account.accountId,
        accountName: account.accountName,
        sellerId: account.sellerId,
        savedAt: syncedAt,
      }))
      .filter((row): row is MlListingCacheRow => Boolean(row));

    await writeListingRows(rows);
    const analytics = await enrichListingRowsWithAnalytics({
      rows,
      accessToken: account.accessToken,
      sellerId: account.sellerId,
      syncedAt,
    });
    await writeListingRows(analytics.rows);
    const keepIds = new Set(rows.map((row) => row.id));
    const removed = input.maxItems ? 0 : await deleteOrphanListings(account.accountId, keepIds);
    const durationMs = Date.now() - startedAt;

    const state: MlListingsSyncState = {
      accountId: account.accountId,
      accountName: account.accountName,
      lastSyncedAt: syncedAt,
      lastSyncStatus: 'ok',
      lastSyncError: null,
      totalSynced: rows.length,
      totalRemoved: removed,
      durationMs,
      analyticsSynced: analytics.analyticsSynced,
      analyticsFailed: analytics.analyticsFailed,
    };

    await saveSyncState(state);

    return {
      ...state,
      totalScanned: scan.itemIds.length,
      totalFetched: rows.length,
      analyticsSynced: analytics.analyticsSynced,
      analyticsFailed: analytics.analyticsFailed,
      failedItems: fetched.failedItems,
    };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const message = error instanceof Error ? error.message : String(error);
    const state: MlListingsSyncState = {
      accountId: account.accountId,
      accountName: account.accountName,
      lastSyncedAt: syncedAt,
      lastSyncStatus: 'error',
      lastSyncError: message,
      totalSynced: 0,
      totalRemoved: 0,
      durationMs,
      analyticsSynced: 0,
      analyticsFailed: 0,
    };
    await saveSyncState(state).catch(() => {});
    throw error;
  }
}

async function mutateMercadoLivreListing(input: {
  accountId: string;
  itemId: string;
  actor: MlListingUpdateActor;
  action: MlListingUpdateAction;
  field: 'price' | 'available_quantity' | 'status' | 'title';
  previousValue: number | string | null;
  newValue: number | string | null;
  payload: Record<string, unknown>;
}): Promise<MlListingUpdateResult> {
  const accountId = validateAccountId(input.accountId);
  const itemId = validateItemId(input.itemId);
  const listing = await getListingForMutation(accountId, itemId);
  const account = await resolveAccountForSync(accountId);
  const auditRef = await createListingActionLog({
    actor: input.actor,
    action: input.action,
    field: input.field,
    listing,
    previousValue: input.previousValue,
    newValue: input.newValue,
  });

  try {
    await putMercadoLivreItem({
      itemId,
      accessToken: account.accessToken,
      payload: input.payload,
    });
    const refreshed = await refreshListingCacheFromMl({
      accountId: account.accountId,
      accountName: account.accountName,
      sellerId: account.sellerId,
      itemId,
      accessToken: account.accessToken,
    });
    await markListingActionLogSuccess({
      auditId: auditRef.id,
      listing: refreshed,
    });
    return {
      action: input.action,
      auditId: auditRef.id,
      listing: refreshed,
      previousValue: input.previousValue,
      newValue: input.newValue,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markListingActionLogError({ auditId: auditRef.id, error: message }).catch(() => {});
    throw error;
  }
}

export async function updateMercadoLivreListingPriceCache(input: {
  accountId: string;
  itemId: string;
  price: number;
  actor: MlListingUpdateActor;
}): Promise<MlListingUpdateResult> {
  const accountId = validateAccountId(input.accountId);
  const itemId = validateItemId(input.itemId);
  const price = validatePrice(input.price);
  const listing = await getListingForMutation(accountId, itemId);
  if (listing.priceAutomationActive) {
    throw new Error('Este anúncio possui automação de preço ativa no Mercado Livre. A API bloqueia edição direta de preço desde 18/03/2026.');
  }

  const account = await resolveAccountForSync(accountId);
  const liveAutomation = await fetchItemPriceAutomation({
    itemId,
    accessToken: account.accessToken,
    syncedAt: new Date().toISOString(),
  });
  if (liveAutomation.priceAutomationActive) {
    await writeListingRows([{ ...listing, ...liveAutomation }]);
    throw new Error('Este anúncio possui automação de preço ativa no Mercado Livre. A edição direta de preço foi bloqueada.');
  }

  return mutateMercadoLivreListing({
    accountId,
    itemId,
    actor: input.actor,
    action: 'price',
    field: 'price',
    previousValue: listing.price,
    newValue: price,
    payload: { price },
  });
}

export async function updateMercadoLivreListingStockCache(input: {
  accountId: string;
  itemId: string;
  availableQuantity: number;
  actor: MlListingUpdateActor;
}): Promise<MlListingUpdateResult> {
  const accountId = validateAccountId(input.accountId);
  const itemId = validateItemId(input.itemId);
  const availableQuantity = validateStock(input.availableQuantity);
  const listing = await getListingForMutation(accountId, itemId);
  if (isSpecialLogistics(listing)) {
    throw new Error('Este anúncio usa logística Full/Flex. O estoque precisa ser tratado pelo fluxo específico de estoque do Mercado Livre, não pelo available_quantity simples.');
  }
  return mutateMercadoLivreListing({
    accountId,
    itemId,
    actor: input.actor,
    action: 'stock',
    field: 'available_quantity',
    previousValue: listing.availableQuantity,
    newValue: availableQuantity,
    payload: { available_quantity: availableQuantity },
  });
}

export async function updateMercadoLivreListingStatusCache(input: {
  accountId: string;
  itemId: string;
  status: MlListingEditableStatus;
  actor: MlListingUpdateActor;
}): Promise<MlListingUpdateResult> {
  const accountId = validateAccountId(input.accountId);
  const itemId = validateItemId(input.itemId);
  const status = validateEditableStatus(input.status);
  const listing = await getListingForMutation(accountId, itemId);
  return mutateMercadoLivreListing({
    accountId,
    itemId,
    actor: input.actor,
    action: 'status',
    field: 'status',
    previousValue: listing.status,
    newValue: status,
    payload: { status },
  });
}

export async function updateMercadoLivreListingTitleCache(input: {
  accountId: string;
  itemId: string;
  title: string;
  actor: MlListingUpdateActor;
}): Promise<MlListingUpdateResult> {
  const accountId = validateAccountId(input.accountId);
  const itemId = validateItemId(input.itemId);
  const title = validateTitle(input.title);
  const listing = await getListingForMutation(accountId, itemId);
  if ((listing.soldQuantity ?? 0) > 0) {
    throw new Error('O Mercado Livre não permite alterar título de anúncio com vendas.');
  }
  if (listing.status === 'closed') {
    throw new Error('Não é possível alterar título de anúncio encerrado.');
  }

  return mutateMercadoLivreListing({
    accountId,
    itemId,
    actor: input.actor,
    action: 'title',
    field: 'title',
    previousValue: listing.title,
    newValue: title,
    payload: { title },
  });
}

export async function updateMercadoLivreListingDescriptionCache(input: {
  accountId: string;
  itemId: string;
  plainText: string;
  actor: MlListingUpdateActor;
}): Promise<MlListingUpdateResult & { description: MlListingDescription | null }> {
  const accountId = validateAccountId(input.accountId);
  const itemId = validateItemId(input.itemId);
  const plainText = validateDescription(input.plainText);
  const listing = await getListingForMutation(accountId, itemId);
  if (listing.status === 'closed') {
    throw new Error('Não é possível alterar descrição de anúncio encerrado.');
  }

  const account = await resolveAccountForSync(accountId);
  const beforeDescription = await fetchListingDescriptionFromMl({
    itemId,
    accessToken: account.accessToken,
  });
  const auditRef = await createListingActionLog({
    actor: input.actor,
    action: 'description',
    field: 'description.plain_text',
    listing,
    previousValue: beforeDescription?.plainText ?? null,
    newValue: plainText,
  });

  try {
    await saveListingDescriptionToMl({
      itemId,
      accessToken: account.accessToken,
      plainText,
      hasExistingDescription: Boolean(beforeDescription),
    });
    const afterDescription = await fetchListingDescriptionFromMl({
      itemId,
      accessToken: account.accessToken,
    });
    await markListingActionLogSuccess({
      auditId: auditRef.id,
      listing,
    });
    return {
      action: 'description',
      auditId: auditRef.id,
      listing,
      previousValue: beforeDescription?.plainText ?? null,
      newValue: plainText,
      description: afterDescription,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markListingActionLogError({ auditId: auditRef.id, error: message }).catch(() => {});
    throw error;
  }
}

export async function updateMercadoLivreListingAttributesCache(input: {
  accountId: string;
  itemId: string;
  attributes: MlListingAttributePatch[];
  actor: MlListingUpdateActor;
}): Promise<MlListingUpdateResult> {
  const accountId = validateAccountId(input.accountId);
  const itemId = validateItemId(input.itemId);
  const patches = validateAttributePatches(input.attributes);
  const listing = await getListingForMutation(accountId, itemId);
  if (listing.status === 'closed') {
    throw new Error('Não é possível alterar ficha técnica de anúncio encerrado.');
  }

  const account = await resolveAccountForSync(accountId);
  const liveRaw = await fetchSingleItem({
    itemId,
    accessToken: account.accessToken,
  });
  const categoryId = asString(liveRaw.category_id) || listing.categoryId;
  if (!categoryId) {
    throw new Error('Anúncio sem categoria; não foi possível validar a ficha técnica.');
  }

  const categoryAttributes = await fetchCategoryAttributesFromMl({
    categoryId,
    accessToken: account.accessToken,
  });
  const currentAttributes = normalizeListingAttributes(liveRaw.attributes, categoryAttributes);
  assertAttributePatchesEditable(patches, currentAttributes, categoryAttributes);
  const mergedAttributes = mergeAttributesForUpdate(liveRaw.attributes, patches);
  const auditRef = await createListingActionLog({
    actor: input.actor,
    action: 'attributes',
    field: 'attributes',
    listing,
    previousValue: attributeValueForAudit(patches, currentAttributes),
    newValue: attributePatchesForAudit(patches),
  });

  try {
    await putMercadoLivreItem({
      itemId,
      accessToken: account.accessToken,
      payload: { attributes: mergedAttributes },
    });
    const refreshed = await refreshListingCacheFromMl({
      accountId: account.accountId,
      accountName: account.accountName,
      sellerId: account.sellerId,
      itemId,
      accessToken: account.accessToken,
    });
    await markListingActionLogSuccess({
      auditId: auditRef.id,
      listing: refreshed,
    });
    return {
      action: 'attributes',
      auditId: auditRef.id,
      listing: refreshed,
      previousValue: attributeValueForAudit(patches, currentAttributes),
      newValue: attributePatchesForAudit(patches),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markListingActionLogError({ auditId: auditRef.id, error: message }).catch(() => {});
    throw error;
  }
}

async function loadSyncState(accountId?: string | null): Promise<MlListingsSyncState | null> {
  const normalizeState = (data: DocumentData): MlListingsSyncState => ({
    accountId: String(data.accountId || ''),
    accountName: data.accountName ?? null,
    lastSyncedAt: data.lastSyncedAt ?? null,
    lastSyncStatus: data.lastSyncStatus ?? null,
    lastSyncError: data.lastSyncError ?? null,
    totalSynced: asInteger(data.totalSynced) ?? 0,
    totalRemoved: asInteger(data.totalRemoved) ?? 0,
    durationMs: asInteger(data.durationMs),
    analyticsSynced: asInteger(data.analyticsSynced) ?? 0,
    analyticsFailed: asInteger(data.analyticsFailed) ?? 0,
  });

  if (accountId) {
    const snap = await adminDb.collection(SYNC_STATE_COLLECTION).doc(accountId).get();
    return snap.exists ? normalizeState(snap.data() || {}) : null;
  }

  const snap = await adminDb
    .collection(SYNC_STATE_COLLECTION)
    .orderBy('lastSyncedAt', 'desc')
    .limit(1)
    .get();
  if (snap.empty) return null;
  return normalizeState(snap.docs[0].data() || {});
}

function containsSearch(row: MlListingCacheRow, search: string) {
  const haystack = [
    row.title,
    row.itemId,
    row.sellerSku,
    row.catalogProductId,
    row.accountName,
    row.categoryId,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(search);
}

function rowHasProblem(row: MlListingCacheRow) {
  return (
    row.status === 'paused' ||
    row.availableQuantity === 0 ||
    (row.health !== null && row.health < 0.5) ||
    (qualityScore(row) !== null && qualityScore(row)! < 60) ||
    (row.performancePendingGoals ?? 0) > 0 ||
    isLowConversion(row) ||
    !row.sellerSku ||
    row.subStatus.length > 0
  );
}

function matchesAnalysisFilter(row: MlListingCacheRow, filter?: MlListingsAnalysisFilter | null) {
  if (!filter || filter === 'all') return true;
  const visits = row.visitsLast30Days ?? 0;
  const score = qualityScore(row);

  if (filter === 'with_visits') return visits > 0;
  if (filter === 'without_visits') return visits === 0;
  if (filter === 'low_conversion') return isLowConversion(row);
  if (filter === 'low_quality') return score !== null && score < 60;
  if (filter === 'price_automation') return row.priceAutomationActive === true;
  if (filter === 'special_logistics') return isSpecialLogistics(row);
  if (filter === 'with_ads') return hasAds(row);
  if (filter === 'without_ads') return !hasAds(row);
  if (filter === 'ads_low_roas') return isAdsLowRoas(row);
  if (filter === 'ads_high_acos') return isAdsHighAcos(row);
  if (filter === 'ads_low_ctr') return isAdsLowCtr(row);
  if (filter === 'ads_low_cvr') return isAdsLowCvr(row);
  if (filter === 'ads_high_spend_no_sales') return isAdsHighSpendNoSales(row);
  return true;
}

function applyFilters(rows: MlListingCacheRow[], filters: MlListingsFilters) {
  const search = filters.search?.trim().toLowerCase();
  const status = new Set((filters.status || []).filter(Boolean));
  const listingType = new Set((filters.listingType || []).filter(Boolean));

  return rows.filter((row) => {
    if (filters.accountId && row.accountId !== filters.accountId) return false;
    if (status.size > 0 && (!row.status || !status.has(row.status))) return false;
    if (listingType.size > 0 && (!row.listingTypeId || !listingType.has(row.listingTypeId))) return false;
    if (filters.catalogMode === 'catalog' && !row.catalogProductId && !row.catalogListing) return false;
    if (filters.catalogMode === 'list' && (row.catalogProductId || row.catalogListing)) return false;
    if (filters.problemsOnly && !rowHasProblem(row)) return false;
    if (!matchesAnalysisFilter(row, filters.analysisFilter)) return false;
    if (search && !containsSearch(row, search)) return false;
    return true;
  });
}

function calculateSummary(rows: MlListingCacheRow[]) {
  const active = rows.filter((row) => row.status === 'active').length;
  const paused = rows.filter((row) => row.status === 'paused').length;
  const closed = rows.filter((row) => row.status === 'closed').length;
  const problems = rows.filter(rowHasProblem).length;
  const totalStock = rows.reduce((sum, row) => sum + (row.availableQuantity || 0), 0);
  const totalSold = rows.reduce((sum, row) => sum + (row.soldQuantity || 0), 0);
  const visitsLast30Days = rows.reduce((sum, row) => sum + (row.visitsLast30Days || 0), 0);
  const withVisitsLast30Days = rows.filter((row) => (row.visitsLast30Days ?? 0) > 0).length;
  const withoutVisitsLast30Days = rows.filter((row) => (row.visitsLast30Days ?? 0) === 0).length;
  const qualityScores = rows
    .map(qualityScore)
    .filter((value): value is number => typeof value === 'number');
  const averageQualityScore = qualityScores.length
    ? qualityScores.reduce((sum, score) => sum + score, 0) / qualityScores.length
    : null;
  const lowQuality = rows.filter((row) => {
    const score = qualityScore(row);
    return score !== null && score < 60;
  }).length;
  const lowConversion = rows.filter(isLowConversion).length;
  const priceAutomationActive = rows.filter((row) => row.priceAutomationActive === true).length;
  const specialLogistics = rows.filter(isSpecialLogistics).length;
  const priced = rows.map((row) => row.price).filter((value): value is number => typeof value === 'number');
  const averagePrice = priced.length ? priced.reduce((sum, price) => sum + price, 0) / priced.length : null;
  const gmvEstimated = rows.reduce((sum, row) => {
    const price = row.price || 0;
    const sold = row.soldQuantity || 0;
    return sum + price * sold;
  }, 0);
  const adsListings = rows.filter(hasAds).length;
  const adsClicks = rows.reduce((sum, row) => sum + (row.adsClicks || 0), 0);
  const adsPrints = rows.reduce((sum, row) => sum + (row.adsPrints || 0), 0);
  const adsCost = rows.reduce((sum, row) => sum + (row.adsCost || 0), 0);
  const adsTotalAmount = rows.reduce((sum, row) => sum + (row.adsTotalAmount || 0), 0);
  const adsUnitsQuantity = rows.reduce((sum, row) => sum + (row.adsUnitsQuantity || 0), 0);

  return {
    total: rows.length,
    active,
    paused,
    closed,
    problems,
    totalStock,
    totalSold,
    visitsLast30Days,
    withVisitsLast30Days,
    withoutVisitsLast30Days,
    lowQuality,
    lowConversion,
    priceAutomationActive,
    specialLogistics,
    averageQualityScore,
    conversionRate30Days: visitsLast30Days > 0 ? (totalSold / visitsLast30Days) * 100 : null,
    gmvEstimated,
    averagePrice,
    adsListings,
    adsClicks,
    adsPrints,
    adsCost,
    adsTotalAmount,
    adsUnitsQuantity,
    adsRoas: adsCost > 0 ? adsTotalAmount / adsCost : null,
    adsAcos: adsTotalAmount > 0 ? (adsCost / adsTotalAmount) * 100 : null,
    adsCtr: adsPrints > 0 ? (adsClicks / adsPrints) * 100 : null,
    adsCvr: adsClicks > 0 ? (adsUnitsQuantity / adsClicks) * 100 : null,
    adsLowRoas: rows.filter(isAdsLowRoas).length,
    adsHighAcos: rows.filter(isAdsHighAcos).length,
    adsLowCtr: rows.filter(isAdsLowCtr).length,
    adsLowCvr: rows.filter(isAdsLowCvr).length,
    adsHighSpendNoSales: rows.filter(isAdsHighSpendNoSales).length,
  };
}

function buildStatusSummary(rows: MlListingCacheRow[]) {
  const summary = calculateSummary(rows);
  return {
    total: summary.total,
    active: summary.active,
    paused: summary.paused,
    closed: summary.closed,
    problems: summary.problems,
  };
}

function groupListings(rows: MlListingCacheRow[], groupBy: MlListingsGroupBy): MlListingGroup[] {
  const groups = new Map<string, MlListingCacheRow[]>();

  rows.forEach((row) => {
    const key =
      groupBy === 'catalog'
        ? row.catalogProductId || `sem-catalogo:${row.sellerSku || row.itemId}`
        : row.sellerSku || row.catalogProductId || row.itemId;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  });

  return Array.from(groups.entries())
    .map(([groupKey, listings]) => {
      const prices = listings.map((row) => row.price).filter((value): value is number => typeof value === 'number');
      const qualityScores = listings
        .map(qualityScore)
        .filter((value): value is number => typeof value === 'number');
      const first = listings[0];
      const accountNames = Array.from(new Set(listings.map((row) => row.accountName || row.accountId))).sort();
      const adsCost = listings.reduce((sum, row) => sum + (row.adsCost || 0), 0);
      const adsTotalAmount = listings.reduce((sum, row) => sum + (row.adsTotalAmount || 0), 0);
      return {
        groupKey,
        groupBy,
        title: first.title || first.sellerSku || first.catalogProductId || first.itemId,
        thumbnail: first.thumbnail,
        sellerSku: first.sellerSku,
        catalogProductId: first.catalogProductId,
        totalListings: listings.length,
        activeListings: listings.filter((row) => row.status === 'active').length,
        pausedListings: listings.filter((row) => row.status === 'paused').length,
        accountNames,
        priceMin: prices.length ? Math.min(...prices) : null,
        priceMax: prices.length ? Math.max(...prices) : null,
        totalStock: listings.reduce((sum, row) => sum + (row.availableQuantity || 0), 0),
        totalSold: listings.reduce((sum, row) => sum + (row.soldQuantity || 0), 0),
        totalVisitsLast30Days: listings.reduce((sum, row) => sum + (row.visitsLast30Days || 0), 0),
        averageQualityScore: qualityScores.length
          ? qualityScores.reduce((sum, score) => sum + score, 0) / qualityScores.length
          : null,
        adsListings: listings.filter(hasAds).length,
        adsCost,
        adsTotalAmount,
        adsRoas: adsCost > 0 ? adsTotalAmount / adsCost : null,
        adsAcos: adsTotalAmount > 0 ? (adsCost / adsTotalAmount) * 100 : null,
        priceAutomationListings: listings.filter((row) => row.priceAutomationActive === true).length,
        lowConversionListings: listings.filter(isLowConversion).length,
        hasProblems: listings.some(rowHasProblem),
        listings: listings.sort(sortListings),
      };
    })
    .sort((a, b) => b.totalSold - a.totalSold || b.totalListings - a.totalListings || a.title.localeCompare(b.title));
}

function sortListings(a: MlListingCacheRow, b: MlListingCacheRow) {
  const aDate = a.lastUpdated || a.savedAt || '';
  const bDate = b.lastUpdated || b.savedAt || '';
  return bDate.localeCompare(aDate);
}

function adsCampaignKey(accountId: string, campaignId: number) {
  return `${accountId}:${campaignId}`;
}

function summarizeAdsRows(rows: MlListingCacheRow[]) {
  const cost = rows.reduce((sum, row) => sum + (row.adsCost || 0), 0);
  const totalAmount = rows.reduce((sum, row) => sum + (row.adsTotalAmount || 0), 0);
  const unitsQuantity = rows.reduce((sum, row) => sum + (row.adsUnitsQuantity || 0), 0);
  const clicks = rows.reduce((sum, row) => sum + (row.adsClicks || 0), 0);
  const prints = rows.reduce((sum, row) => sum + (row.adsPrints || 0), 0);

  return {
    cost,
    totalAmount,
    unitsQuantity,
    clicks,
    prints,
    ctr: prints > 0 ? (clicks / prints) * 100 : null,
    cvr: clicks > 0 ? (unitsQuantity / clicks) * 100 : null,
    roas: cost > 0 ? totalAmount / cost : null,
    acos: totalAmount > 0 ? (cost / totalAmount) * 100 : null,
  };
}

function toAdsCampaignListingSummary(row: MlListingCacheRow): MlAdsCampaignListingSummary {
  return {
    id: row.id,
    itemId: row.itemId,
    accountId: row.accountId,
    accountName: row.accountName,
    title: row.title,
    sellerSku: row.sellerSku,
    status: row.status,
    price: row.price,
    availableQuantity: row.availableQuantity,
    soldQuantity: row.soldQuantity,
    permalink: row.permalink,
    thumbnail: row.thumbnail,
    visitsLast30Days: row.visitsLast30Days ?? null,
    qualityScore: qualityScore(row),
    adsStatus: row.adsStatus ?? null,
    adsAdGroupId: row.adsAdGroupId ?? null,
    adsUserProductId: row.adsUserProductId ?? null,
    adsUserProductName: row.adsUserProductName ?? null,
    adsRecommended: row.adsRecommended ?? null,
    adsBuyBoxWinner: row.adsBuyBoxWinner ?? null,
    adsImageQuality: row.adsImageQuality ?? null,
    adsCost: row.adsCost || 0,
    adsTotalAmount: row.adsTotalAmount || 0,
    adsUnitsQuantity: row.adsUnitsQuantity || 0,
    adsClicks: row.adsClicks || 0,
    adsPrints: row.adsPrints || 0,
    adsCtr: row.adsCtr ?? null,
    adsCvr: row.adsCvr ?? null,
    adsRoas: row.adsRoas ?? null,
    adsAcos: row.adsAcos ?? null,
    adsCpc: row.adsCpc ?? null,
    adsSov: row.adsSov ?? null,
  };
}

function buildAdsCampaignAdGroups(rows: MlListingCacheRow[]): MlAdsCampaignAdGroupSummary[] {
  const groups = new Map<string, MlListingCacheRow[]>();

  rows.forEach((row) => {
    const key = row.adsAdGroupId
      ? `adgroup:${row.adsAdGroupId}`
      : row.adsUserProductId
        ? `product:${row.adsUserProductId}`
        : `listing:${row.itemId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  });

  return Array.from(groups.entries())
    .map(([key, listings]) => {
      const sorted = listings.slice().sort((a, b) => (b.adsCost || 0) - (a.adsCost || 0));
      const first = sorted[0];
      const metrics = summarizeAdsRows(listings);
      return {
        key,
        label: first.adsUserProductName || first.sellerSku || first.title || first.itemId,
        adGroupId: first.adsAdGroupId ?? null,
        userProductId: first.adsUserProductId ?? null,
        listingsCount: listings.length,
        activeListings: listings.filter((row) => row.status === 'active').length,
        topItemId: first.itemId,
        thumbnail: first.thumbnail,
        ...metrics,
      };
    })
    .sort((a, b) => b.cost - a.cost || (b.roas || 0) - (a.roas || 0))
    .slice(0, 12);
}

function toAdsCampaignDailyPoint(row: MlAdsCampaignDailyRow): MlAdsCampaignDailyPoint {
  return {
    date: row.date,
    cost: row.metrics.cost || 0,
    totalAmount: row.metrics.totalAmount || 0,
    unitsQuantity: row.metrics.unitsQuantity || 0,
    clicks: row.metrics.clicks || 0,
    prints: row.metrics.prints || 0,
    ctr: row.metrics.ctr,
    cvr: row.metrics.cvr,
    cpc: row.metrics.cpc,
    roas: row.metrics.roas,
    acos: row.metrics.acos,
    sov: row.metrics.sov,
  };
}

function buildAdsCampaignDetails(
  rows: MlListingCacheRow[],
  campaigns: MlAdsCampaignSummary[],
  dailyRows: MlAdsCampaignDailyRow[],
): MlAdsCampaignDetail[] {
  const rowsByCampaign = new Map<string, MlListingCacheRow[]>();
  const dailyRowsByCampaign = new Map<string, MlAdsCampaignDailyRow[]>();

  rows
    .filter((row) => hasAds(row) && row.adsCampaignId)
    .forEach((row) => {
      const key = adsCampaignKey(row.accountId, row.adsCampaignId!);
      if (!rowsByCampaign.has(key)) rowsByCampaign.set(key, []);
      rowsByCampaign.get(key)!.push(row);
    });
  dailyRows.forEach((row) => {
    const key = adsCampaignKey(row.accountId, row.campaignId);
    if (!dailyRowsByCampaign.has(key)) dailyRowsByCampaign.set(key, []);
    dailyRowsByCampaign.get(key)!.push(row);
  });

  return campaigns.map((campaign) => {
    const campaignRows = rowsByCampaign.get(adsCampaignKey(campaign.accountId, campaign.campaignId)) || [];
    const campaignDailyRows = dailyRowsByCampaign.get(adsCampaignKey(campaign.accountId, campaign.campaignId)) || [];
    const qualityScores = campaignRows
      .map(qualityScore)
      .filter((value): value is number => typeof value === 'number');

    return {
      ...campaign,
      localListingsCount: campaignRows.length,
      activeListings: campaignRows.filter((row) => row.status === 'active').length,
      pausedListings: campaignRows.filter((row) => row.status === 'paused').length,
      visitsLast30Days: campaignRows.reduce((sum, row) => sum + (row.visitsLast30Days || 0), 0),
      averageQualityScore: qualityScores.length
        ? qualityScores.reduce((sum, score) => sum + score, 0) / qualityScores.length
        : null,
      highSpendNoSales: campaignRows.filter(isAdsHighSpendNoSales).length,
      lowRoasListings: campaignRows.filter(isAdsLowRoas).length,
      highAcosListings: campaignRows.filter(isAdsHighAcos).length,
      lowCtrListings: campaignRows.filter(isAdsLowCtr).length,
      lowCvrListings: campaignRows.filter(isAdsLowCvr).length,
      history: campaignDailyRows
        .slice()
        .sort((a, b) => a.date.localeCompare(b.date))
        .map(toAdsCampaignDailyPoint),
      adGroups: buildAdsCampaignAdGroups(campaignRows),
      listings: campaignRows
        .slice()
        .sort((a, b) => (b.adsCost || 0) - (a.adsCost || 0) || (b.adsTotalAmount || 0) - (a.adsTotalAmount || 0))
        .slice(0, 12)
        .map(toAdsCampaignListingSummary),
    };
  });
}

function buildAdsRecommendations(rows: MlListingCacheRow[], campaigns: MlAdsCampaignSummary[]): MlAdsRecommendation[] {
  const recommendations: MlAdsRecommendation[] = [];

  campaigns
    .filter((campaign) => (campaign.cost || 0) > 100 && campaign.roas !== null && campaign.roas < 3)
    .slice(0, 3)
    .forEach((campaign) => {
      recommendations.push({
        id: `campaign-reduce-${campaign.accountId}-${campaign.campaignId}`,
        type: 'reduce_spend',
        severity: 'critical',
        title: 'Revisar investimento da campanha',
        description: `${campaign.name || campaign.campaignId} consumiu verba com ROAS abaixo de 3.`,
        itemId: null,
        campaignId: campaign.campaignId,
        campaignName: campaign.name,
        metricLabel: 'ROAS',
        metricValue: campaign.roas,
      });
    });

  campaigns
    .filter((campaign) => (campaign.cost || 0) > 50 && (campaign.sov ?? 100) < 50 && campaign.roas !== null && campaign.roas >= 7)
    .slice(0, 3)
    .forEach((campaign) => {
      recommendations.push({
        id: `campaign-increase-${campaign.accountId}-${campaign.campaignId}`,
        type: 'increase_budget',
        severity: 'positive',
        title: 'Candidato a aumentar alcance',
        description: `${campaign.name || campaign.campaignId} tem ROAS forte e SOV baixo.`,
        itemId: null,
        campaignId: campaign.campaignId,
        campaignName: campaign.name,
        metricLabel: 'ROAS',
        metricValue: campaign.roas,
      });
    });

  rows
    .filter(isAdsHighSpendNoSales)
    .sort((a, b) => (b.adsCost || 0) - (a.adsCost || 0))
    .slice(0, 4)
    .forEach((row) => {
      recommendations.push({
        id: `ad-no-sales-${row.itemId}`,
        type: 'pause_review',
        severity: 'critical',
        title: 'Gasto sem venda no anúncio',
        description: `${row.title || row.itemId} investiu em Ads sem gerar unidades no período.`,
        itemId: row.itemId,
        campaignId: row.adsCampaignId || null,
        campaignName: row.adsCampaignName || null,
        metricLabel: 'Investimento',
        metricValue: row.adsCost ?? null,
      });
    });

  rows
    .filter((row) => hasAds(row) && (row.adsPrints ?? 0) >= 3000 && (row.adsCtr ?? 0) < 0.2)
    .sort((a, b) => (b.adsPrints || 0) - (a.adsPrints || 0))
    .slice(0, 4)
    .forEach((row) => {
      recommendations.push({
        id: `ad-low-ctr-${row.itemId}`,
        type: 'improve_listing',
        severity: 'warning',
        title: 'Melhorar atratividade do anúncio',
        description: `${row.title || row.itemId} tem muitas impressões e CTR baixo.`,
        itemId: row.itemId,
        campaignId: row.adsCampaignId || null,
        campaignName: row.adsCampaignName || null,
        metricLabel: 'CTR',
        metricValue: row.adsCtr ?? null,
      });
    });

  rows
    .filter((row) => !hasAds(row) && row.status === 'active' && (row.soldQuantity ?? 0) >= 10 && (row.availableQuantity ?? 0) > 0)
    .sort((a, b) => (b.soldQuantity || 0) - (a.soldQuantity || 0))
    .slice(0, 4)
    .forEach((row) => {
      recommendations.push({
        id: `candidate-${row.itemId}`,
        type: 'ads_candidate',
        severity: 'positive',
        title: 'Candidato para testar Ads',
        description: `${row.title || row.itemId} vende bem organicamente e ainda não aparece com Ads no período.`,
        itemId: row.itemId,
        campaignId: null,
        campaignName: null,
        metricLabel: 'Vendidos',
        metricValue: row.soldQuantity ?? null,
      });
    });

  return recommendations.slice(0, 12);
}

function clampPaging(input: MlListingsFilters) {
  const offset = Math.max(0, Math.trunc(input.offset || 0));
  const limit = Math.max(1, Math.min(MAX_PAGE_SIZE, Math.trunc(input.limit || DEFAULT_PAGE_SIZE)));
  return { offset, limit };
}

export async function listMercadoLivreListingsCache(
  filters: MlListingsFilters = {},
): Promise<MlListingsListResult> {
  const snapshot = await adminDb.collection(LISTINGS_COLLECTION).get();
  const allRows = snapshot.docs
    .map((docSnap) => fromFirestoreRow(docSnap.data(), docSnap.id))
    .filter((row) => row.itemId && row.accountId)
    .sort(sortListings);
  const allRowsWithAds = await enrichListingsWithAds(allRows, filters.accountId);

  const filtered = applyFilters(allRowsWithAds, filters);
  const statusRows = applyFilters(allRowsWithAds, {
    ...filters,
    status: [],
    problemsOnly: false,
  });
  const { offset, limit } = clampPaging(filters);
  const viewMode = filters.viewMode || 'list';
  const groupBy = filters.groupBy || 'sku';
  const groups = groupListings(filtered, groupBy);
  const total = viewMode === 'grouped' ? groups.length : filtered.length;
  const [adsCampaigns, adsCampaignDailyRows] = await Promise.all([
    loadMercadoLivreAdsCampaignSummaries(filters.accountId),
    loadMercadoLivreAdsCampaignDailyRows({ accountId: filters.accountId }),
  ]);
  const adsCampaignDetails = buildAdsCampaignDetails(allRowsWithAds, adsCampaigns, adsCampaignDailyRows);

  return {
    listings: viewMode === 'list' ? filtered.slice(offset, offset + limit) : [],
    groups: viewMode === 'grouped' ? groups.slice(offset, offset + limit) : [],
    paging: { total, offset, limit },
    statusSummary: buildStatusSummary(statusRows),
    summary: calculateSummary(filtered),
    syncState: await loadSyncState(filters.accountId),
    adsSyncState: await loadMercadoLivreAdsSyncState(filters.accountId),
    adsCampaigns,
    adsCampaignDetails,
    adsRecommendations: buildAdsRecommendations(allRowsWithAds, adsCampaigns),
  };
}
