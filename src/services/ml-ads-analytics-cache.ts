import { adminDb } from '@/lib/firebase-admin';
import type { MercadoLivreCredentials } from '@/lib/types';
import { getMlToken } from '@/services/mercadolivre';
import { getPrimaryMlAccountIdAdmin } from '@/services/firestore-admin';
import type { DocumentData } from 'firebase-admin/firestore';

const ML_API_BASE = 'https://api.mercadolibre.com';
const ADS_CAMPAIGNS_COLLECTION = 'mercadoLivreAdsCampaigns';
const ADS_LISTINGS_COLLECTION = 'mercadoLivreAdsListings';
const ADS_CAMPAIGN_DAILY_COLLECTION = 'mercadoLivreAdsCampaignDaily';
const ADS_LISTING_DAILY_COLLECTION = 'mercadoLivreAdsListingDaily';
const ADS_SYNC_STATE_COLLECTION = 'mercadoLivreAdsSyncState';
const ADS_PAGE_SIZE = 100;
const WRITE_BATCH_SIZE = 450;
const MAX_DAILY_HISTORY_DAYS = 45;
const DAILY_HISTORY_CONCURRENCY = 4;

const PRODUCT_ADS_METRICS = [
  'clicks',
  'prints',
  'ctr',
  'cost',
  'cpc',
  'acos',
  'organic_units_quantity',
  'organic_units_amount',
  'organic_items_quantity',
  'direct_items_quantity',
  'indirect_items_quantity',
  'advertising_items_quantity',
  'cvr',
  'roas',
  'sov',
  'direct_units_quantity',
  'indirect_units_quantity',
  'units_quantity',
  'direct_amount',
  'indirect_amount',
  'total_amount',
].join(',');

export type MlAdsMetrics = {
  clicks: number | null;
  prints: number | null;
  ctr: number | null;
  cost: number | null;
  cpc: number | null;
  acos: number | null;
  cvr: number | null;
  roas: number | null;
  sov: number | null;
  directAmount: number | null;
  indirectAmount: number | null;
  totalAmount: number | null;
  directUnitsQuantity: number | null;
  indirectUnitsQuantity: number | null;
  unitsQuantity: number | null;
  advertisingItemsQuantity: number | null;
  organicUnitsQuantity: number | null;
  organicUnitsAmount: number | null;
  organicItemsQuantity: number | null;
};

export type MlAdsCampaignRow = {
  id: string;
  accountId: string;
  accountName: string | null;
  advertiserId: number;
  advertiserName: string | null;
  siteId: string;
  campaignId: number;
  name: string | null;
  status: string | null;
  strategy: string | null;
  budget: number | null;
  automaticBudget: boolean | null;
  roasTarget: number | null;
  acosTarget: number | null;
  lastUpdated: string | null;
  dateCreated: string | null;
  metrics: MlAdsMetrics;
  dateFrom: string;
  dateTo: string;
  syncedAt: string;
  rawCampaign?: Record<string, unknown>;
};

export type MlAdsListingRow = {
  id: string;
  accountId: string;
  accountName: string | null;
  advertiserId: number;
  advertiserName: string | null;
  siteId: string;
  itemId: string;
  campaignId: number | null;
  campaignName: string | null;
  adGroupId: number | null;
  userProductId: string | null;
  userProductName: string | null;
  familyId: number | null;
  familyName: string | null;
  title: string | null;
  status: string | null;
  statusRaw: string | null;
  price: number | null;
  thumbnail: string | null;
  permalink: string | null;
  domainId: string | null;
  channel: string | null;
  recommended: boolean | null;
  buyBoxWinner: boolean | null;
  imageQuality: string | null;
  metrics: MlAdsMetrics;
  dateFrom: string;
  dateTo: string;
  syncedAt: string;
  rawAd?: Record<string, unknown>;
};

export type MlAdsCampaignDailyRow = MlAdsCampaignRow & {
  date: string;
};

export type MlAdsListingDailyRow = MlAdsListingRow & {
  date: string;
};

export type MlAdsSyncState = {
  accountId: string;
  accountName: string | null;
  advertiserId: number | null;
  advertiserName: string | null;
  siteId: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  lastSyncedAt: string | null;
  lastSyncStatus: 'ok' | 'error' | null;
  lastSyncError: string | null;
  campaignsSynced: number;
  adsSynced: number;
  campaignDailySynced: number;
  adsDailySynced: number;
  dailyDateFrom: string | null;
  dailyDateTo: string | null;
  durationMs: number | null;
};

export type MlAdsSyncReport = MlAdsSyncState & {
  advertisersFound: number;
};

export type MlAdsCampaignSummary = {
  accountId: string;
  accountName: string | null;
  campaignId: number;
  name: string | null;
  status: string | null;
  strategy: string | null;
  budget: number | null;
  roasTarget: number | null;
  acosTarget: number | null;
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
  adsCount: number;
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

function dateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function defaultAdsDateRange() {
  const toDate = addDays(new Date(), -1);
  const fromDate = addDays(toDate, -29);
  return {
    dateFrom: dateOnly(fromDate),
    dateTo: dateOnly(toDate),
  };
}

function validateDate(value: string, label: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} deve estar no formato YYYY-MM-DD.`);
  }
  return value;
}

function parseDateOnly(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`Data invalida: ${value}.`);
  }
  return date;
}

function enumerateDateRange(dateFrom: string, dateTo: string, maxDays = MAX_DAILY_HISTORY_DAYS) {
  const fromDate = parseDateOnly(dateFrom);
  const toDate = parseDateOnly(dateTo);
  if (fromDate.getTime() > toDate.getTime()) {
    throw new Error('dateFrom nao pode ser maior que dateTo.');
  }

  const dates: string[] = [];
  let current = fromDate;
  while (current.getTime() <= toDate.getTime() && dates.length < maxDays) {
    dates.push(dateOnly(current));
    current = addDays(current, 1);
  }
  return dates;
}

function normalizeMetrics(value: unknown): MlAdsMetrics {
  const metrics = asRecord(value);
  return {
    clicks: asNumber(metrics.clicks),
    prints: asNumber(metrics.prints),
    ctr: asNumber(metrics.ctr),
    cost: asNumber(metrics.cost),
    cpc: asNumber(metrics.cpc),
    acos: asNumber(metrics.acos),
    cvr: asNumber(metrics.cvr),
    roas: asNumber(metrics.roas),
    sov: asNumber(metrics.sov),
    directAmount: asNumber(metrics.direct_amount),
    indirectAmount: asNumber(metrics.indirect_amount),
    totalAmount: asNumber(metrics.total_amount),
    directUnitsQuantity: asNumber(metrics.direct_units_quantity),
    indirectUnitsQuantity: asNumber(metrics.indirect_units_quantity),
    unitsQuantity: asNumber(metrics.units_quantity),
    advertisingItemsQuantity: asNumber(metrics.advertising_items_quantity),
    organicUnitsQuantity: asNumber(metrics.organic_units_quantity),
    organicUnitsAmount: asNumber(metrics.organic_units_amount),
    organicItemsQuantity: asNumber(metrics.organic_items_quantity),
  };
}

function metricsToFirestore(metrics: MlAdsMetrics) {
  return { ...metrics };
}

function normalizeMetricsFromFirestore(data: DocumentData): MlAdsMetrics {
  return {
    clicks: asNumber(data.clicks),
    prints: asNumber(data.prints),
    ctr: asNumber(data.ctr),
    cost: asNumber(data.cost),
    cpc: asNumber(data.cpc),
    acos: asNumber(data.acos),
    cvr: asNumber(data.cvr),
    roas: asNumber(data.roas),
    sov: asNumber(data.sov),
    directAmount: asNumber(data.directAmount),
    indirectAmount: asNumber(data.indirectAmount),
    totalAmount: asNumber(data.totalAmount),
    directUnitsQuantity: asNumber(data.directUnitsQuantity),
    indirectUnitsQuantity: asNumber(data.indirectUnitsQuantity),
    unitsQuantity: asNumber(data.unitsQuantity),
    advertisingItemsQuantity: asNumber(data.advertisingItemsQuantity),
    organicUnitsQuantity: asNumber(data.organicUnitsQuantity),
    organicUnitsAmount: asNumber(data.organicUnitsAmount),
    organicItemsQuantity: asNumber(data.organicItemsQuantity),
  };
}

function errorMessageFromMlPayload(payload: unknown, fallback: string) {
  const data = asRecord(payload);
  const causes = Array.isArray(data.cause) ? data.cause : [];
  const causeMessage = causes
    .map((entry) => asString(asRecord(entry).message))
    .find(Boolean);
  return causeMessage || asString(data.message) || asString(data.error) || fallback;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex]);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function fetchMlJson(input: {
  url: string;
  accessToken: string;
  apiVersion: '1' | '2';
}) {
  const response = await fetch(input.url, {
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Api-Version': input.apiVersion,
      'api-version': input.apiVersion,
    },
    cache: 'no-store',
  });
  const payload = await readJson(response).catch(() => null);
  if (!response.ok) {
    throw new Error(errorMessageFromMlPayload(payload, `Falha ao consultar Mercado Ads (${response.status}).`));
  }
  return asRecord(payload);
}

async function resolveAdsAccount(accountId?: string | null) {
  const resolvedAccountId = accountId || await getPrimaryMlAccountIdAdmin();
  if (!resolvedAccountId) {
    throw new Error('Nenhuma conta Mercado Livre configurada.');
  }

  const accountSnap = await adminDb.collection('mercadoLivreAccounts').doc(resolvedAccountId).get();
  if (!accountSnap.exists) {
    throw new Error(`Conta Mercado Livre ${resolvedAccountId} não encontrada.`);
  }

  const credentials = accountSnap.data() as MercadoLivreCredentials;
  const accessToken = await getMlToken(resolvedAccountId);
  const accountName = credentials.accountName || credentials.nickname || resolvedAccountId;

  return { accountId: resolvedAccountId, accountName, accessToken };
}

async function fetchProductAdsAdvertisers(input: {
  accessToken: string;
}) {
  const payload = await fetchMlJson({
    url: `${ML_API_BASE}/advertising/advertisers?product_id=PADS`,
    accessToken: input.accessToken,
    apiVersion: '1',
  });
  const advertisers = Array.isArray(payload.advertisers) ? payload.advertisers : [];
  return advertisers
    .map((entry) => {
      const advertiser = asRecord(entry);
      const advertiserId = asInteger(advertiser.advertiser_id);
      const siteId = asString(advertiser.site_id);
      if (!advertiserId || !siteId) return null;
      return {
        advertiserId,
        siteId,
        advertiserName: asString(advertiser.advertiser_name) || asString(advertiser.account_name),
      };
    })
    .filter((entry): entry is { advertiserId: number; siteId: string; advertiserName: string | null } => Boolean(entry));
}

async function fetchProductAdsPaged(input: {
  accessToken: string;
  urlBase: string;
  dateFrom: string;
  dateTo: string;
  includeMetricsSummary?: boolean;
}) {
  const rows: Record<string, unknown>[] = [];
  let offset = 0;
  let total: number | null = null;

  while (total === null || offset < total) {
    const url = new URL(input.urlBase);
    url.searchParams.set('limit', String(ADS_PAGE_SIZE));
    url.searchParams.set('offset', String(offset));
    url.searchParams.set('date_from', input.dateFrom);
    url.searchParams.set('date_to', input.dateTo);
    url.searchParams.set('metrics', PRODUCT_ADS_METRICS);
    if (input.includeMetricsSummary) url.searchParams.set('metrics_summary', 'true');

    const payload = await fetchMlJson({
      url: url.toString(),
      accessToken: input.accessToken,
      apiVersion: '2',
    });
    const paging = asRecord(payload.paging);
    total = asInteger(paging.total) ?? rows.length;
    const results = Array.isArray(payload.results) ? payload.results : [];
    rows.push(...results.map(asRecord));
    if (results.length === 0 || results.length < ADS_PAGE_SIZE) break;
    offset += ADS_PAGE_SIZE;
  }

  return rows;
}

function normalizeCampaign(input: {
  raw: Record<string, unknown>;
  accountId: string;
  accountName: string | null;
  advertiserId: number;
  advertiserName: string | null;
  siteId: string;
  dateFrom: string;
  dateTo: string;
  syncedAt: string;
}): MlAdsCampaignRow | null {
  const campaignId = asInteger(input.raw.id) ?? asInteger(input.raw.campaign_id);
  if (!campaignId) return null;

  return {
    id: `${input.accountId}:${input.advertiserId}:${campaignId}`,
    accountId: input.accountId,
    accountName: input.accountName,
    advertiserId: input.advertiserId,
    advertiserName: input.advertiserName,
    siteId: input.siteId,
    campaignId,
    name: asString(input.raw.name),
    status: asString(input.raw.status),
    strategy: asString(input.raw.strategy),
    budget: asNumber(input.raw.budget),
    automaticBudget: asBoolean(input.raw.automatic_budget),
    roasTarget: asNumber(input.raw.roas_target),
    acosTarget: asNumber(input.raw.acos_target),
    lastUpdated: asString(input.raw.last_updated),
    dateCreated: asString(input.raw.date_created),
    metrics: normalizeMetrics(input.raw.metrics),
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
    syncedAt: input.syncedAt,
    rawCampaign: input.raw,
  };
}

function normalizeAd(input: {
  raw: Record<string, unknown>;
  campaignsById: Map<number, MlAdsCampaignRow>;
  accountId: string;
  accountName: string | null;
  advertiserId: number;
  advertiserName: string | null;
  siteId: string;
  dateFrom: string;
  dateTo: string;
  syncedAt: string;
}): MlAdsListingRow | null {
  const itemId = asString(input.raw.item_id);
  if (!itemId) return null;
  const campaignId = asInteger(input.raw.campaign_id);
  const campaign = campaignId ? input.campaignsById.get(campaignId) : null;

  return {
    id: `${input.accountId}:${itemId}`,
    accountId: input.accountId,
    accountName: input.accountName,
    advertiserId: input.advertiserId,
    advertiserName: input.advertiserName,
    siteId: input.siteId,
    itemId,
    campaignId,
    campaignName: campaign?.name || null,
    adGroupId: asInteger(input.raw.ad_group_id),
    userProductId: asString(input.raw.user_product_id),
    userProductName: asString(input.raw.user_product_name),
    familyId: asInteger(input.raw.family_id),
    familyName: asString(input.raw.family_name),
    title: asString(input.raw.title),
    status: asString(input.raw.status),
    statusRaw: asString(input.raw.status_raw),
    price: asNumber(input.raw.price),
    thumbnail: asString(input.raw.thumbnail),
    permalink: asString(input.raw.permalink),
    domainId: asString(input.raw.domain_id),
    channel: asString(input.raw.channel),
    recommended: asBoolean(input.raw.recommended),
    buyBoxWinner: asBoolean(input.raw.buy_box_winner),
    imageQuality: asString(input.raw.image_quality),
    metrics: normalizeMetrics(input.raw.metrics),
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
    syncedAt: input.syncedAt,
    rawAd: input.raw,
  };
}

function normalizeCampaignDaily(input: {
  raw: Record<string, unknown>;
  accountId: string;
  accountName: string | null;
  advertiserId: number;
  advertiserName: string | null;
  siteId: string;
  date: string;
  syncedAt: string;
}): MlAdsCampaignDailyRow | null {
  const row = normalizeCampaign({
    raw: input.raw,
    accountId: input.accountId,
    accountName: input.accountName,
    advertiserId: input.advertiserId,
    advertiserName: input.advertiserName,
    siteId: input.siteId,
    dateFrom: input.date,
    dateTo: input.date,
    syncedAt: input.syncedAt,
  });
  if (!row) return null;
  return {
    ...row,
    id: `${row.id}:${input.date}`,
    date: input.date,
  };
}

function normalizeAdDaily(input: {
  raw: Record<string, unknown>;
  campaignsById: Map<number, MlAdsCampaignRow>;
  accountId: string;
  accountName: string | null;
  advertiserId: number;
  advertiserName: string | null;
  siteId: string;
  date: string;
  syncedAt: string;
}): MlAdsListingDailyRow | null {
  const row = normalizeAd({
    raw: input.raw,
    campaignsById: input.campaignsById,
    accountId: input.accountId,
    accountName: input.accountName,
    advertiserId: input.advertiserId,
    advertiserName: input.advertiserName,
    siteId: input.siteId,
    dateFrom: input.date,
    dateTo: input.date,
    syncedAt: input.syncedAt,
  });
  if (!row) return null;
  return {
    ...row,
    id: `${row.id}:${input.date}`,
    date: input.date,
  };
}

function campaignToFirestore(row: MlAdsCampaignRow) {
  return {
    ...row,
    metrics: metricsToFirestore(row.metrics),
  };
}

function adToFirestore(row: MlAdsListingRow) {
  return {
    ...row,
    metrics: metricsToFirestore(row.metrics),
  };
}

function campaignDailyToFirestore(row: MlAdsCampaignDailyRow) {
  return {
    ...campaignToFirestore(row),
    date: row.date,
  };
}

function adDailyToFirestore(row: MlAdsListingDailyRow) {
  return {
    ...adToFirestore(row),
    date: row.date,
  };
}

function fromFirestoreAd(data: DocumentData, id: string): MlAdsListingRow {
  const metrics = normalizeMetricsFromFirestore(asRecord(data.metrics));
  return {
    id,
    accountId: String(data.accountId || ''),
    accountName: data.accountName ?? null,
    advertiserId: asInteger(data.advertiserId) ?? 0,
    advertiserName: data.advertiserName ?? null,
    siteId: String(data.siteId || ''),
    itemId: String(data.itemId || ''),
    campaignId: asInteger(data.campaignId),
    campaignName: data.campaignName ?? null,
    adGroupId: asInteger(data.adGroupId),
    userProductId: data.userProductId ?? null,
    userProductName: data.userProductName ?? null,
    familyId: asInteger(data.familyId),
    familyName: data.familyName ?? null,
    title: data.title ?? null,
    status: data.status ?? null,
    statusRaw: data.statusRaw ?? null,
    price: asNumber(data.price),
    thumbnail: data.thumbnail ?? null,
    permalink: data.permalink ?? null,
    domainId: data.domainId ?? null,
    channel: data.channel ?? null,
    recommended: asBoolean(data.recommended),
    buyBoxWinner: asBoolean(data.buyBoxWinner),
    imageQuality: data.imageQuality ?? null,
    metrics,
    dateFrom: data.dateFrom ?? '',
    dateTo: data.dateTo ?? '',
    syncedAt: data.syncedAt ?? '',
    rawAd: asRecord(data.rawAd),
  };
}

function fromFirestoreCampaign(data: DocumentData, id: string): MlAdsCampaignRow {
  const metrics = normalizeMetricsFromFirestore(asRecord(data.metrics));
  return {
    id,
    accountId: String(data.accountId || ''),
    accountName: data.accountName ?? null,
    advertiserId: asInteger(data.advertiserId) ?? 0,
    advertiserName: data.advertiserName ?? null,
    siteId: String(data.siteId || ''),
    campaignId: asInteger(data.campaignId) ?? 0,
    name: data.name ?? null,
    status: data.status ?? null,
    strategy: data.strategy ?? null,
    budget: asNumber(data.budget),
    automaticBudget: asBoolean(data.automaticBudget),
    roasTarget: asNumber(data.roasTarget),
    acosTarget: asNumber(data.acosTarget),
    lastUpdated: data.lastUpdated ?? null,
    dateCreated: data.dateCreated ?? null,
    metrics,
    dateFrom: data.dateFrom ?? '',
    dateTo: data.dateTo ?? '',
    syncedAt: data.syncedAt ?? '',
    rawCampaign: asRecord(data.rawCampaign),
  };
}

function fromFirestoreCampaignDaily(data: DocumentData, id: string): MlAdsCampaignDailyRow {
  const row = fromFirestoreCampaign(data, id);
  return {
    ...row,
    date: data.date ?? row.dateFrom,
  };
}

async function writeRows(collectionName: string, rows: Array<{ id: string } & Record<string, unknown>>) {
  for (let index = 0; index < rows.length; index += WRITE_BATCH_SIZE) {
    const batch = adminDb.batch();
    rows.slice(index, index + WRITE_BATCH_SIZE).forEach((row) => {
      batch.set(adminDb.collection(collectionName).doc(row.id), row, { merge: true });
    });
    await batch.commit();
  }
}

async function deleteOrphanRows(input: {
  collectionName: string;
  accountId: string;
  keepIds: Set<string>;
}) {
  const snapshot = await adminDb
    .collection(input.collectionName)
    .where('accountId', '==', input.accountId)
    .get();

  const refs = snapshot.docs
    .filter((docSnap) => !input.keepIds.has(docSnap.id))
    .map((docSnap) => docSnap.ref);

  for (let index = 0; index < refs.length; index += WRITE_BATCH_SIZE) {
    const batch = adminDb.batch();
    refs.slice(index, index + WRITE_BATCH_SIZE).forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
}

async function saveSyncState(state: MlAdsSyncState) {
  await adminDb.collection(ADS_SYNC_STATE_COLLECTION).doc(state.accountId).set(state, { merge: true });
}

async function syncDailyProductAdsHistory(input: {
  accessToken: string;
  adsBase: string;
  accountId: string;
  accountName: string | null;
  advertiserId: number;
  advertiserName: string | null;
  siteId: string;
  dateFrom: string;
  dateTo: string;
  syncedAt: string;
  campaignsById: Map<number, MlAdsCampaignRow>;
}) {
  const dates = enumerateDateRange(input.dateFrom, input.dateTo);

  const dailyResults = await mapWithConcurrency(dates, DAILY_HISTORY_CONCURRENCY, async (date) => {
    const rawDailyCampaigns = await fetchProductAdsPaged({
      accessToken: input.accessToken,
      urlBase: `${input.adsBase}/campaigns/search`,
      dateFrom: date,
      dateTo: date,
      includeMetricsSummary: true,
    });
    const campaignRows = rawDailyCampaigns
      .map((raw) => normalizeCampaignDaily({
        raw,
        accountId: input.accountId,
        accountName: input.accountName,
        advertiserId: input.advertiserId,
        advertiserName: input.advertiserName,
        siteId: input.siteId,
        date,
        syncedAt: input.syncedAt,
      }))
      .filter((row): row is MlAdsCampaignDailyRow => Boolean(row));

    const dailyCampaignsById = new Map(input.campaignsById);
    campaignRows.forEach((campaign) => {
      dailyCampaignsById.set(campaign.campaignId, campaign);
    });

    const rawDailyAds = await fetchProductAdsPaged({
      accessToken: input.accessToken,
      urlBase: `${input.adsBase}/ads/search`,
      dateFrom: date,
      dateTo: date,
      includeMetricsSummary: true,
    });
    const adRows = rawDailyAds
      .map((raw) => normalizeAdDaily({
        raw,
        campaignsById: dailyCampaignsById,
        accountId: input.accountId,
        accountName: input.accountName,
        advertiserId: input.advertiserId,
        advertiserName: input.advertiserName,
        siteId: input.siteId,
        date,
        syncedAt: input.syncedAt,
      }))
      .filter((row): row is MlAdsListingDailyRow => Boolean(row));

    return { campaignRows, adRows };
  });
  const dailyCampaigns = dailyResults.flatMap((result) => result.campaignRows);
  const dailyAds = dailyResults.flatMap((result) => result.adRows);

  await writeRows(ADS_CAMPAIGN_DAILY_COLLECTION, dailyCampaigns.map(campaignDailyToFirestore));
  await writeRows(ADS_LISTING_DAILY_COLLECTION, dailyAds.map(adDailyToFirestore));

  return {
    campaignDailySynced: dailyCampaigns.length,
    adsDailySynced: dailyAds.length,
    dailyDateFrom: dates[0] || null,
    dailyDateTo: dates[dates.length - 1] || null,
  };
}

export async function syncMercadoLivreAdsAnalyticsCache(input: {
  accountId?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
} = {}): Promise<MlAdsSyncReport> {
  const startedAt = Date.now();
  const syncedAt = new Date(startedAt).toISOString();
  const defaultRange = defaultAdsDateRange();
  const dateFrom = validateDate(input.dateFrom || defaultRange.dateFrom, 'dateFrom');
  const dateTo = validateDate(input.dateTo || defaultRange.dateTo, 'dateTo');
  const account = await resolveAdsAccount(input.accountId);

  try {
    const advertisers = await fetchProductAdsAdvertisers({
      accessToken: account.accessToken,
    });
    const advertiser = advertisers.find((entry) => entry.siteId === 'MLB') || advertisers[0];
    if (!advertiser) {
      const state: MlAdsSyncState = {
        accountId: account.accountId,
        accountName: account.accountName,
        advertiserId: null,
        advertiserName: null,
        siteId: null,
        dateFrom,
        dateTo,
        lastSyncedAt: syncedAt,
        lastSyncStatus: 'ok',
        lastSyncError: null,
        campaignsSynced: 0,
        adsSynced: 0,
        campaignDailySynced: 0,
        adsDailySynced: 0,
        dailyDateFrom: null,
        dailyDateTo: null,
        durationMs: Date.now() - startedAt,
      };
      await saveSyncState(state);
      return { ...state, advertisersFound: 0 };
    }

    const adsBase = `${ML_API_BASE}/advertising/${advertiser.siteId}/advertisers/${advertiser.advertiserId}/product_ads`;
    const rawCampaigns = await fetchProductAdsPaged({
      accessToken: account.accessToken,
      urlBase: `${adsBase}/campaigns/search`,
      dateFrom,
      dateTo,
      includeMetricsSummary: true,
    });
    const campaigns = rawCampaigns
      .map((raw) => normalizeCampaign({
        raw,
        accountId: account.accountId,
        accountName: account.accountName,
        advertiserId: advertiser.advertiserId,
        advertiserName: advertiser.advertiserName,
        siteId: advertiser.siteId,
        dateFrom,
        dateTo,
        syncedAt,
      }))
      .filter((row): row is MlAdsCampaignRow => Boolean(row));
    const campaignsById = new Map(campaigns.map((campaign) => [campaign.campaignId, campaign]));

    const rawAds = await fetchProductAdsPaged({
      accessToken: account.accessToken,
      urlBase: `${adsBase}/ads/search`,
      dateFrom,
      dateTo,
      includeMetricsSummary: true,
    });
    const ads = rawAds
      .map((raw) => normalizeAd({
        raw,
        campaignsById,
        accountId: account.accountId,
        accountName: account.accountName,
        advertiserId: advertiser.advertiserId,
        advertiserName: advertiser.advertiserName,
        siteId: advertiser.siteId,
        dateFrom,
        dateTo,
        syncedAt,
      }))
      .filter((row): row is MlAdsListingRow => Boolean(row));

    await writeRows(ADS_CAMPAIGNS_COLLECTION, campaigns.map(campaignToFirestore));
    await writeRows(ADS_LISTINGS_COLLECTION, ads.map(adToFirestore));
    await deleteOrphanRows({
      collectionName: ADS_CAMPAIGNS_COLLECTION,
      accountId: account.accountId,
      keepIds: new Set(campaigns.map((campaign) => campaign.id)),
    });
    await deleteOrphanRows({
      collectionName: ADS_LISTINGS_COLLECTION,
      accountId: account.accountId,
      keepIds: new Set(ads.map((ad) => ad.id)),
    });
    const dailyHistory = await syncDailyProductAdsHistory({
      accessToken: account.accessToken,
      adsBase,
      accountId: account.accountId,
      accountName: account.accountName,
      advertiserId: advertiser.advertiserId,
      advertiserName: advertiser.advertiserName,
      siteId: advertiser.siteId,
      dateFrom,
      dateTo,
      syncedAt,
      campaignsById,
    });

    const state: MlAdsSyncState = {
      accountId: account.accountId,
      accountName: account.accountName,
      advertiserId: advertiser.advertiserId,
      advertiserName: advertiser.advertiserName,
      siteId: advertiser.siteId,
      dateFrom,
      dateTo,
      lastSyncedAt: syncedAt,
      lastSyncStatus: 'ok',
      lastSyncError: null,
      campaignsSynced: campaigns.length,
      adsSynced: ads.length,
      campaignDailySynced: dailyHistory.campaignDailySynced,
      adsDailySynced: dailyHistory.adsDailySynced,
      dailyDateFrom: dailyHistory.dailyDateFrom,
      dailyDateTo: dailyHistory.dailyDateTo,
      durationMs: Date.now() - startedAt,
    };
    await saveSyncState(state);
    return {
      ...state,
      advertisersFound: advertisers.length,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const state: MlAdsSyncState = {
      accountId: account.accountId,
      accountName: account.accountName,
      advertiserId: null,
      advertiserName: null,
      siteId: null,
      dateFrom,
      dateTo,
      lastSyncedAt: syncedAt,
      lastSyncStatus: 'error',
      lastSyncError: message,
      campaignsSynced: 0,
      adsSynced: 0,
      campaignDailySynced: 0,
      adsDailySynced: 0,
      dailyDateFrom: null,
      dailyDateTo: null,
      durationMs: Date.now() - startedAt,
    };
    await saveSyncState(state).catch(() => {});
    throw error;
  }
}

export async function loadMercadoLivreAdsListingsMap(accountId?: string | null) {
  const query = accountId
    ? adminDb.collection(ADS_LISTINGS_COLLECTION).where('accountId', '==', accountId)
    : adminDb.collection(ADS_LISTINGS_COLLECTION);
  const snapshot = await query.get();
  const map = new Map<string, MlAdsListingRow>();
  snapshot.docs.forEach((docSnap) => {
    const row = fromFirestoreAd(docSnap.data(), docSnap.id);
    if (row.accountId && row.itemId) {
      map.set(`${row.accountId}:${row.itemId}`, row);
    }
  });
  return map;
}

export async function loadMercadoLivreAdsCampaignSummaries(accountId?: string | null): Promise<MlAdsCampaignSummary[]> {
  const campaignsQuery = accountId
    ? adminDb.collection(ADS_CAMPAIGNS_COLLECTION).where('accountId', '==', accountId)
    : adminDb.collection(ADS_CAMPAIGNS_COLLECTION);
  const adsQuery = accountId
    ? adminDb.collection(ADS_LISTINGS_COLLECTION).where('accountId', '==', accountId)
    : adminDb.collection(ADS_LISTINGS_COLLECTION);

  const [campaignsSnapshot, adsSnapshot] = await Promise.all([
    campaignsQuery.get(),
    adsQuery.get(),
  ]);
  const adsCountByCampaign = new Map<string, number>();
  adsSnapshot.docs.forEach((docSnap) => {
    const data = docSnap.data();
    const campaignId = asInteger(data.campaignId);
    const rowAccountId = String(data.accountId || '');
    if (!campaignId) return;
    const key = `${rowAccountId}:${campaignId}`;
    adsCountByCampaign.set(key, (adsCountByCampaign.get(key) || 0) + 1);
  });

  return campaignsSnapshot.docs
    .map((docSnap) => fromFirestoreCampaign(docSnap.data(), docSnap.id))
    .filter((campaign) => campaign.campaignId > 0)
    .map((campaign) => ({
      accountId: campaign.accountId,
      accountName: campaign.accountName,
      campaignId: campaign.campaignId,
      name: campaign.name,
      status: campaign.status,
      strategy: campaign.strategy,
      budget: campaign.budget,
      roasTarget: campaign.roasTarget,
      acosTarget: campaign.acosTarget,
      cost: campaign.metrics.cost || 0,
      totalAmount: campaign.metrics.totalAmount || 0,
      unitsQuantity: campaign.metrics.unitsQuantity || 0,
      clicks: campaign.metrics.clicks || 0,
      prints: campaign.metrics.prints || 0,
      ctr: campaign.metrics.ctr,
      cvr: campaign.metrics.cvr,
      cpc: campaign.metrics.cpc,
      roas: campaign.metrics.roas,
      acos: campaign.metrics.acos,
      sov: campaign.metrics.sov,
      adsCount: adsCountByCampaign.get(`${campaign.accountId}:${campaign.campaignId}`) || 0,
    }))
    .sort((a, b) => b.cost - a.cost || (b.roas || 0) - (a.roas || 0));
}

export async function loadMercadoLivreAdsCampaignDailyRows(input: {
  accountId?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
} = {}): Promise<MlAdsCampaignDailyRow[]> {
  const defaultRange = defaultAdsDateRange();
  const dateFrom = validateDate(input.dateFrom || defaultRange.dateFrom, 'dateFrom');
  const dateTo = validateDate(input.dateTo || defaultRange.dateTo, 'dateTo');
  const query = input.accountId
    ? adminDb.collection(ADS_CAMPAIGN_DAILY_COLLECTION).where('accountId', '==', input.accountId)
    : adminDb.collection(ADS_CAMPAIGN_DAILY_COLLECTION);
  const snapshot = await query.get();

  return snapshot.docs
    .map((docSnap) => fromFirestoreCampaignDaily(docSnap.data(), docSnap.id))
    .filter((row) => row.date >= dateFrom && row.date <= dateTo && row.campaignId > 0)
    .sort((a, b) => a.date.localeCompare(b.date) || b.metrics.cost! - a.metrics.cost!);
}

export async function loadMercadoLivreAdsSyncState(accountId?: string | null): Promise<MlAdsSyncState | null> {
  const normalizeState = (data: DocumentData): MlAdsSyncState => ({
    accountId: String(data.accountId || ''),
    accountName: data.accountName ?? null,
    advertiserId: asInteger(data.advertiserId),
    advertiserName: data.advertiserName ?? null,
    siteId: data.siteId ?? null,
    dateFrom: data.dateFrom ?? null,
    dateTo: data.dateTo ?? null,
    lastSyncedAt: data.lastSyncedAt ?? null,
    lastSyncStatus: data.lastSyncStatus ?? null,
    lastSyncError: data.lastSyncError ?? null,
    campaignsSynced: asInteger(data.campaignsSynced) ?? 0,
    adsSynced: asInteger(data.adsSynced) ?? 0,
    campaignDailySynced: asInteger(data.campaignDailySynced) ?? 0,
    adsDailySynced: asInteger(data.adsDailySynced) ?? 0,
    dailyDateFrom: data.dailyDateFrom ?? null,
    dailyDateTo: data.dailyDateTo ?? null,
    durationMs: asInteger(data.durationMs),
  });

  if (accountId) {
    const snap = await adminDb.collection(ADS_SYNC_STATE_COLLECTION).doc(accountId).get();
    return snap.exists ? normalizeState(snap.data() || {}) : null;
  }

  const snap = await adminDb
    .collection(ADS_SYNC_STATE_COLLECTION)
    .orderBy('lastSyncedAt', 'desc')
    .limit(1)
    .get();
  if (snap.empty) return null;
  return normalizeState(snap.docs[0].data() || {});
}
