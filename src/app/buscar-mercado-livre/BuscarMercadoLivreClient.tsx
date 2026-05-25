'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  AlertCircle,
  BarChart3,
  Bookmark,
  BookmarkCheck,
  Box,
  CheckCircle2,
  CircleDollarSign,
  Clock,
  Crown,
  ExternalLink,
  Eye,
  Filter,
  Info,
  Layers3,
  Loader2,
  MapPin,
  MessageSquare,
  PackageCheck,
  RefreshCw,
  Search,
  Settings2,
  Shield,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Star,
  Store,
  Truck,
  Users,
  X,
} from 'lucide-react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { DeepSearchDialog } from '@/components/deep-search-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import DashboardLayout from '@/components/dashboard-layout';
import { useToast } from '@/hooks/use-toast';
import type { DeepSearchConfig } from '@/lib/deep-search-types';
import { cn, formatCurrency } from '@/lib/utils';
import {
  calculateMercadoLivreSearchTermMatchScore,
  getMercadoLivreSearchableText,
  normalizeMercadoLivreSearchText,
} from '@/lib/mercado-livre-catalog-search-text';
import type {
  MercadoLivreAccountSummary,
  MercadoLivreCompetitor,
  MercadoLivreCompetitorsResponse,
  MercadoLivreFeeDetails,
  MercadoLivrePublishedPresenceItem,
  MercadoLivreSavedOffer,
  MercadoLivreSearchAttribute,
  MercadoLivreSearchCategoryInfo,
  MercadoLivreSearchCategoryTrend,
  MercadoLivreSearchItem,
  MercadoLivreSearchMode,
  MercadoLivreSearchOptions,
  MercadoLivreSearchResponse,
  MercadoLivreVisitsRefreshEntry,
  MercadoLivreVisitsRefreshResponse,
  MercadoLivreVisitsWindow,
} from '@/types/mercado-livre-catalog-search';

type SearchOptionsState = Required<MercadoLivreSearchOptions>;
type StoreFilter = 'official' | 'marketplace';
type ShippingFilter = 'free' | 'flex' | 'full';
type ListingFilter = 'gold_special' | 'gold_pro';

type SearchApiResponse = MercadoLivreSearchResponse & {
  ok: boolean;
  error?: string;
  publishedPresence?: MercadoLivrePublishedPresenceItem[];
};

type SearchState = MercadoLivreSearchResponse & {
  publishedPresence: MercadoLivrePublishedPresenceItem[];
};

type AccountApiResponse = {
  ok: boolean;
  error?: string;
  accounts: MercadoLivreAccountSummary[];
};

type SavedOffersApiResponse = {
  ok: boolean;
  error?: string;
  offers: MercadoLivreSavedOffer[];
};

type SavedOfferApiResponse = {
  ok: boolean;
  error?: string;
  offer: MercadoLivreSavedOffer;
};

type CompetitorsApiResponse = MercadoLivreCompetitorsResponse & {
  ok: boolean;
  error?: string;
};

type VisitsRefreshApiResponse = MercadoLivreVisitsRefreshResponse & {
  ok: boolean;
  error?: string;
};

type CategoryTrendsApiResponse = {
  ok: boolean;
  error?: string;
  categoryId: string;
  categoryInfo: MercadoLivreSearchCategoryInfo | null;
  trends: MercadoLivreSearchCategoryTrend[];
  cached?: boolean;
};

type ResultCategorySummary = {
  id: string;
  name: string;
  count: number;
  maxVisits: number | null;
  firstIndex: number;
};

type CategoryTrendLoadState = {
  trends: MercadoLivreSearchCategoryTrend[];
  categoryInfo: MercadoLivreSearchCategoryInfo | null;
  loading: boolean;
  error: string | null;
};

type MercadoLivreSearchSnapshot = {
  accountId: string;
  mode: MercadoLivreSearchMode;
  query: string;
  queryChips: string[];
  limit: number;
  offset: number;
  searchOptions: SearchOptionsState;
  searchState: SearchState;
  localTerms: string[];
  storeFilters: StoreFilter[];
  shippingFilters: ShippingFilter[];
  listingFilters: ListingFilter[];
  attributeFilters: Record<string, string[]>;
  selectedItemKeys: string[];
  savedAt: string;
};

type AttributeFacet = {
  id: string;
  name: string;
  values: Array<{ value: string; count: number }>;
};

type TrendGroup = NonNullable<MercadoLivreSearchCategoryTrend['group']>;

const ML_DEEP_SEARCH_REQUEST_KEY = 'mercadoLivreDeepSearchRequest';
const ML_SEARCH_SNAPSHOT_KEY = 'mercadoLivreSearchSnapshot';
const ML_RESTORE_SEARCH_ON_RETURN_KEY = 'mercadoLivreRestoreSearchOnReturn';

const DEFAULT_SEARCH_OPTIONS: SearchOptionsState = {
  includeVisits: true,
  visitsWindow: 7,
  includeStockInfo: false,
  includePriceRange: true,
  includeReviews: false,
  includeQuestions: false,
  includeShipping: false,
  shippingZipCode: '',
  includeTrends: false,
  includeCategoryInfo: false,
};

const LIMIT_OPTIONS = [50, 100, 200];
const TREND_GROUPS: TrendGroup[] = ['growth', 'most_wanted', 'popular'];
const VISITS_WINDOW_OPTIONS: Array<{ value: MercadoLivreVisitsWindow; label: string }> = [
  { value: 1, label: 'Hoje' },
  { value: 3, label: '3 dias' },
  { value: 7, label: '7 dias' },
  { value: 15, label: '15 dias' },
  { value: 30, label: '30 dias' },
];
const REPUTATION_LEVELS: Record<string, { label: string; colorClass: string; icon: typeof Shield }> = {
  '5_green': { label: 'Platinum', colorClass: 'text-green-600', icon: ShieldCheck },
  '4_green': { label: 'Gold', colorClass: 'text-yellow-500', icon: ShieldCheck },
  '3_green': { label: 'MercadoLider', colorClass: 'text-yellow-600', icon: ShieldCheck },
  '2_orange': { label: 'Laranja', colorClass: 'text-orange-500', icon: Shield },
  '1_red': { label: 'Vermelha', colorClass: 'text-red-500', icon: Shield },
};

const numberFormatter = new Intl.NumberFormat('pt-BR');

function getItemKey(item: Pick<MercadoLivreSearchItem, 'sourceType' | 'id'>) {
  return `${item.sourceType}:${item.id}`;
}

function formatMoney(value: number | null | undefined) {
  return value === null || value === undefined || Number.isNaN(value) ? 'N/A' : formatCurrency(value);
}

function formatCount(value: number | null | undefined) {
  return value === null || value === undefined ? '-' : numberFormatter.format(value);
}

function visitsWindowLabel(value: MercadoLivreVisitsWindow) {
  return value === 1 ? 'hoje' : `${value} dias`;
}

function listingTypeLabel(value: string | null | undefined) {
  if (value === 'gold_pro') return 'Premium';
  if (value === 'gold_special') return 'Clássico';
  return value || 'Não informado';
}

function shippingLabel(value: ShippingFilter) {
  if (value === 'free') return 'Frete grátis';
  if (value === 'flex') return 'Flex';
  return 'Full';
}

function storeLabel(value: StoreFilter) {
  return value === 'official' ? 'Loja oficial' : 'Marketplace';
}

function trendGroupLabel(value: MercadoLivreSearchCategoryTrend['group']) {
  if (value === 'growth') return 'Crescendo';
  if (value === 'most_wanted') return 'Mais buscadas';
  return 'Populares';
}

function uniqueStrings(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized.toLowerCase())) return false;
    seen.add(normalized.toLowerCase());
    return true;
  });
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers || {}),
    },
  });
  const data = (await response.json().catch(() => ({}))) as T & { ok?: boolean; error?: string };
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || 'A operação não pôde ser concluída.');
  }
  return data;
}

function switchRow(
  label: string,
  checked: boolean,
  onCheckedChange: (checked: boolean) => void,
  description?: string
) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

function VisitsWindowSelect({
  value,
  onChange,
  disabled = false,
  triggerClassName,
  id,
}: {
  value: MercadoLivreVisitsWindow;
  onChange: (value: MercadoLivreVisitsWindow) => void;
  disabled?: boolean;
  triggerClassName?: string;
  id?: string;
}) {
  return (
    <Select value={String(value)} onValueChange={(nextValue) => onChange(Number(nextValue) as MercadoLivreVisitsWindow)} disabled={disabled}>
      <SelectTrigger id={id} className={triggerClassName}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {VISITS_WINDOW_OPTIONS.map((option) => (
          <SelectItem key={option.value} value={String(option.value)}>
            Visitas {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function getAttributeValue(item: MercadoLivreSearchItem, attributeId: string) {
  return item.attributes.find((attribute) => attribute.id === attributeId)?.valueName || null;
}

function hasFullShipping(item: MercadoLivreSearchItem) {
  return item.logisticType === 'fulfillment' || item.shippingTags.includes('fulfillment');
}

function hasAnySelected<T extends string>(selected: T[], value: T) {
  return selected.includes(value);
}

function getTopAttributes(items: MercadoLivreSearchItem[]): AttributeFacet[] {
  const facets = new Map<string, { name: string; values: Map<string, number> }>();

  items.forEach((item) => {
    item.attributes.forEach((attribute) => {
      if (!attribute.valueName) return;
      const current = facets.get(attribute.id) || { name: attribute.name || attribute.id, values: new Map<string, number>() };
      current.values.set(attribute.valueName, (current.values.get(attribute.valueName) || 0) + 1);
      facets.set(attribute.id, current);
    });
  });

  return Array.from(facets.entries())
    .map(([id, facet]) => ({
      id,
      name: facet.name,
      values: Array.from(facet.values.entries())
        .map(([value, count]) => ({ value, count }))
        .sort((left, right) => right.count - left.count)
        .slice(0, 8),
    }))
    .filter((facet) => facet.values.length > 1)
    .sort((left, right) => right.values.reduce((sum, value) => sum + value.count, 0) - left.values.reduce((sum, value) => sum + value.count, 0))
    .slice(0, 6);
}

function itemMatchesLocalTerms(item: MercadoLivreSearchItem, terms: string[]) {
  if (terms.length === 0) return { matches: true, score: 0 };

  const searchable = normalizeMercadoLivreSearchText(getMercadoLivreSearchableText(item));
  const scores = terms.map((term) => {
    const normalized = normalizeMercadoLivreSearchText(term);
    if (!normalized) return 0;
    if (searchable.includes(normalized)) return 100;
    return calculateMercadoLivreSearchTermMatchScore(term, item).score;
  });

  return {
    matches: scores.every((score) => score > 0),
    score: scores.reduce((sum, score) => sum + score, 0),
  };
}

function compactText(value: string | null | undefined, fallback = '-') {
  return value && value.trim() ? value.trim() : fallback;
}

function marginFromFee(price: number | null | undefined, fee: MercadoLivreFeeDetails | null | undefined) {
  if (!price || !fee) return null;
  return price - fee.totalFees;
}

function formatLabel(value: string | null | undefined) {
  if (!value) return '-';
  return value
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function formatShippingMode(value: string | null | undefined) {
  if (!value) return null;
  const known: Record<string, string> = {
    me1: 'Mercado Envios 1',
    me2: 'Mercado Envios 2',
    custom: 'Personalizado',
    not_specified: 'Não especificado',
  };
  return known[value] || formatLabel(value);
}

function formatLogisticType(value: string | null | undefined) {
  if (!value) return null;
  const known: Record<string, string> = {
    drop_off: 'Correios',
    xd_drop_off: 'Correios',
    xd_pick_up: 'Correios',
    fulfillment: 'Full ML',
    cross_docking: 'Agência ML',
    pick_up: 'Retirada',
    self_service: 'Flex',
    custom: 'A combinar',
  };
  return known[value] || formatLabel(value);
}

function formatShortDateTime(value: string | null | undefined) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function normalizeFeePercentage(value: number) {
  if (!Number.isFinite(value)) return 0;
  return value <= 1 ? value * 100 : value;
}

function formatPercent(value: number) {
  return `${normalizeFeePercentage(value).toFixed(1)}%`;
}

function formatShippingSource(fees: MercadoLivreFeeDetails) {
  if (fees.shippingCostSource === 'mercado_livre') return 'ML';
  if (fees.shippingCostSource === 'fixed_fee') return 'taxa fixa';
  if (fees.shippingCostSource === 'fallback_table') return 'estimado';
  if (fees.shippingCostSource === 'unavailable') return 'indisponível';
  return null;
}

function getFeeShippingCost(fees: MercadoLivreFeeDetails | null | undefined) {
  return typeof fees?.shippingCost === 'number' && Number.isFinite(fees.shippingCost) ? fees.shippingCost : 0;
}

function pricesMatch(left: number | null | undefined, right: number | null | undefined) {
  return left !== null && left !== undefined && right !== null && right !== undefined && Math.abs(left - right) < 0.01;
}

function asDetailRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function getDetailString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (typeof value === 'boolean') return value ? 'sim' : 'não';
  }
  return null;
}

function getDetailArray(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return Array.isArray(value) ? value : [];
}

function getDetailNumber(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

type ParentListingAttribute = {
  id: string;
  name: string;
  valueName: string;
};

type ParentListingImage = {
  id: string;
  url: string;
  alt: string;
};

function resolveRawAttributeValue(record: Record<string, unknown>) {
  const directValue = getDetailString(record, ['value_name', 'valueName', 'text', 'description', 'value_id', 'valueId']);
  if (directValue) return directValue;

  const values = getDetailArray(record, 'values');
  const resolvedValues = values
    .map((entry) => {
      const valueRecord = asDetailRecord(entry);
      return getDetailString(valueRecord, ['name', 'value_name', 'valueName', 'id']);
    })
    .filter((value): value is string => Boolean(value));

  return resolvedValues.length > 0 ? resolvedValues.join(', ') : null;
}

function mapRawAttributes(rawAttributes: unknown, fallbackName: string): ParentListingAttribute[] {
  if (!Array.isArray(rawAttributes)) return [];

  return rawAttributes
    .map((entry, index) => {
      if (typeof entry === 'string' && entry.trim()) {
        return {
          id: `${fallbackName}_${index + 1}`,
          name: fallbackName,
          valueName: entry.trim(),
        };
      }

      const record = asDetailRecord(entry);
      const valueName = resolveRawAttributeValue(record);
      if (!valueName) return null;

      const id = getDetailString(record, ['id', 'attribute_id']) || `${fallbackName}_${index + 1}`;
      const name = getDetailString(record, ['name', 'attribute_name', 'label']) || id;

      return { id, name, valueName };
    })
    .filter((attribute): attribute is ParentListingAttribute => Boolean(attribute));
}

function dedupeAttributes(attributes: ParentListingAttribute[]) {
  const seen = new Set<string>();
  return attributes.filter((attribute) => {
    const key = `${attribute.id.toUpperCase()}:${attribute.valueName.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getParentListingAttributes(item: MercadoLivreSearchItem) {
  const catalogProduct = asDetailRecord(item.marketplaceData?.catalogProduct);
  const referenceItem = asDetailRecord(item.marketplaceData?.referenceItem);
  const referenceOffer = asDetailRecord(item.marketplaceData?.referenceOffer);

  const catalogAttributes = mapRawAttributes(catalogProduct.attributes, 'Atributo');
  const referenceAttributes =
    catalogAttributes.length > 0
      ? []
      : [...mapRawAttributes(referenceItem.attributes, 'Atributo'), ...mapRawAttributes(referenceOffer.attributes, 'Atributo')];
  const normalizedAttributes =
    catalogAttributes.length > 0 || referenceAttributes.length > 0
      ? []
      : item.attributes.map((attribute) => ({
          id: attribute.id,
          name: attribute.name || attribute.id,
          valueName: attribute.valueName,
        }));

  return dedupeAttributes([...catalogAttributes, ...referenceAttributes, ...normalizedAttributes]);
}

function getParentListingFeatures(item: MercadoLivreSearchItem) {
  const catalogProduct = asDetailRecord(item.marketplaceData?.catalogProduct);
  const referenceItem = asDetailRecord(item.marketplaceData?.referenceItem);

  return dedupeAttributes([
    ...mapRawAttributes(catalogProduct.main_features, 'Característica'),
    ...mapRawAttributes(referenceItem.main_features, 'Característica'),
  ]);
}

function mapRawImages(rawImages: unknown, fallbackAlt: string): ParentListingImage[] {
  if (!Array.isArray(rawImages)) return [];

  return rawImages
    .map((entry, index) => {
      if (typeof entry === 'string' && entry.trim()) {
        return {
          id: `image_${index + 1}`,
          url: entry.trim(),
          alt: `${fallbackAlt} - imagem ${index + 1}`,
        };
      }

      const record = asDetailRecord(entry);
      const url = getDetailString(record, ['secure_url', 'url', 'full_url', 'thumbnail', 'picture_url']);
      if (!url) return null;

      return {
        id: getDetailString(record, ['id']) || `image_${index + 1}`,
        url,
        alt: `${fallbackAlt} - imagem ${index + 1}`,
      };
    })
    .filter((image): image is ParentListingImage => Boolean(image));
}

function dedupeImages(images: ParentListingImage[]) {
  const seen = new Set<string>();
  return images.filter((image) => {
    if (seen.has(image.url)) return false;
    seen.add(image.url);
    return true;
  });
}

function getParentListingImages(item: MercadoLivreSearchItem) {
  const catalogProduct = asDetailRecord(item.marketplaceData?.catalogProduct);
  const referenceItem = asDetailRecord(item.marketplaceData?.referenceItem);
  const referenceOffer = asDetailRecord(item.marketplaceData?.referenceOffer);
  const images = dedupeImages([
    ...mapRawImages(catalogProduct.pictures, item.title),
    ...mapRawImages(referenceItem.pictures, item.title),
    ...mapRawImages(referenceOffer.pictures, item.title),
  ]);

  if (images.length > 0) return images;
  return item.thumbnail ? [{ id: 'thumbnail', url: item.thumbnail, alt: item.title }] : [];
}

function getParentListingDescription(item: MercadoLivreSearchItem) {
  const description = asDetailRecord(item.marketplaceData?.referenceItemDescription);
  const catalogProduct = asDetailRecord(item.marketplaceData?.catalogProduct);
  return (
    getDetailString(description, ['plain_text', 'text']) ||
    getDetailString(asDetailRecord(catalogProduct.description), ['plain_text', 'text']) ||
    getDetailString(catalogProduct, ['description']) ||
    null
  );
}

function compactSearchItemForSnapshot(item: MercadoLivreSearchItem): MercadoLivreSearchItem {
  const catalogOffers = item.marketplaceData.catalogOffers;

  return {
    ...item,
    marketplaceData: {
      ...item.marketplaceData,
      catalogOffers: catalogOffers
        ? {
            ...catalogOffers,
            results: catalogOffers.results.slice(0, 10),
          }
        : null,
      referenceItemDescription: null,
      categoryAttributes: null,
    },
  };
}

function compactSearchStateForSnapshot(searchState: SearchState): SearchState {
  return {
    ...searchState,
    results: searchState.results.map(compactSearchItemForSnapshot),
  };
}

function saveMercadoLivreSearchSnapshot(snapshot: MercadoLivreSearchSnapshot) {
  const compactSnapshot: MercadoLivreSearchSnapshot = {
    ...snapshot,
    searchState: compactSearchStateForSnapshot(snapshot.searchState),
  };

  window.sessionStorage.setItem(ML_SEARCH_SNAPSHOT_KEY, JSON.stringify(compactSnapshot));
  window.sessionStorage.setItem(ML_RESTORE_SEARCH_ON_RETURN_KEY, 'true');
}

export default function BuscarMercadoLivreClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const initialQuery = searchParams.get('q') || '';
  const autoSearchRef = useRef(false);
  const restoredSearchRef = useRef(false);

  const [accounts, setAccounts] = useState<MercadoLivreAccountSummary[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [mode, setMode] = useState<MercadoLivreSearchMode>('catalog');
  const [query, setQuery] = useState(initialQuery);
  const [queryChips, setQueryChips] = useState<string[]>([]);
  const [queryChipInput, setQueryChipInput] = useState('');
  const [limit, setLimit] = useState(50);
  const [offset, setOffset] = useState(0);
  const [searchOptions, setSearchOptions] = useState<SearchOptionsState>(DEFAULT_SEARCH_OPTIONS);
  const [searchState, setSearchState] = useState<SearchState | null>(null);
  const [searching, setSearching] = useState(false);
  const [visitsRefreshing, setVisitsRefreshing] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [savedOffers, setSavedOffers] = useState<Map<string, MercadoLivreSavedOffer>>(new Map());
  const [savingKeys, setSavingKeys] = useState<Set<string>>(new Set());
  const [localTermInput, setLocalTermInput] = useState('');
  const [localTerms, setLocalTerms] = useState<string[]>([]);
  const [storeFilters, setStoreFilters] = useState<StoreFilter[]>([]);
  const [shippingFilters, setShippingFilters] = useState<ShippingFilter[]>([]);
  const [listingFilters, setListingFilters] = useState<ListingFilter[]>([]);
  const [attributeFilters, setAttributeFilters] = useState<Record<string, string[]>>({});
  const [detailsItem, setDetailsItem] = useState<MercadoLivreSearchItem | null>(null);
  const [selectedItemKeys, setSelectedItemKeys] = useState<Set<string>>(new Set());
  const [deepSearchOpen, setDeepSearchOpen] = useState(false);
  const [categoryTrendsById, setCategoryTrendsById] = useState<Record<string, CategoryTrendLoadState>>({});
  const [trendDialogCategoryId, setTrendDialogCategoryId] = useState<string | null>(null);

  const loadAccounts = useCallback(async () => {
    setAccountsLoading(true);
    try {
      const data = await fetchJson<AccountApiResponse>('/api/mercado-livre/accounts');
      setAccounts(data.accounts);
      setSelectedAccountId((current) => {
        if (current && data.accounts.some((account) => account.accountId === current)) return current;
        return data.accounts.find((account) => account.connected)?.accountId || data.accounts[0]?.accountId || '';
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao carregar contas.';
      toast({ title: 'Contas Mercado Livre', description: message, variant: 'destructive' });
    } finally {
      setAccountsLoading(false);
    }
  }, [toast]);

  const loadSavedOffers = useCallback(async () => {
    try {
      const data = await fetchJson<SavedOffersApiResponse>('/api/mercado-livre/saved-offers');
      setSavedOffers(new Map(data.offers.map((offer) => [offer.offerKey, offer])));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao carregar ofertas salvas.';
      toast({ title: 'Ofertas salvas', description: message, variant: 'destructive' });
    }
  }, [toast]);

  useEffect(() => {
    void loadAccounts();
    void loadSavedOffers();
  }, [loadAccounts, loadSavedOffers]);

  useEffect(() => {
    if (restoredSearchRef.current) return;
    restoredSearchRef.current = true;

    const shouldRestore = window.sessionStorage.getItem(ML_RESTORE_SEARCH_ON_RETURN_KEY) === 'true';
    if (!shouldRestore) return;

    const rawSnapshot = window.sessionStorage.getItem(ML_SEARCH_SNAPSHOT_KEY);
    window.sessionStorage.removeItem(ML_RESTORE_SEARCH_ON_RETURN_KEY);
    if (!rawSnapshot) return;

    try {
      const snapshot = JSON.parse(rawSnapshot) as MercadoLivreSearchSnapshot;
      if (!snapshot.searchState || !Array.isArray(snapshot.searchState.results)) return;

      autoSearchRef.current = true;
      setSelectedAccountId(snapshot.accountId || '');
      setMode(snapshot.mode || 'catalog');
      setQuery(snapshot.query || '');
      setQueryChips(Array.isArray(snapshot.queryChips) ? snapshot.queryChips : []);
      setQueryChipInput('');
      setLimit(snapshot.limit || 50);
      setOffset(snapshot.offset || 0);
      setSearchOptions({ ...DEFAULT_SEARCH_OPTIONS, ...(snapshot.searchOptions || {}) });
      setSearchState(snapshot.searchState);
      setSearchError(null);
      setLocalTermInput('');
      setLocalTerms(Array.isArray(snapshot.localTerms) ? snapshot.localTerms : []);
      setStoreFilters(Array.isArray(snapshot.storeFilters) ? snapshot.storeFilters : []);
      setShippingFilters(Array.isArray(snapshot.shippingFilters) ? snapshot.shippingFilters : []);
      setListingFilters(Array.isArray(snapshot.listingFilters) ? snapshot.listingFilters : []);
      setAttributeFilters(snapshot.attributeFilters || {});
      setSelectedItemKeys(new Set(snapshot.selectedItemKeys || []));

      if (snapshot.query) {
        router.replace(`/buscar-mercado-livre?q=${encodeURIComponent(snapshot.query)}`);
      }
    } catch (error) {
      console.warn('[buscar-mercado-livre] Falha ao restaurar busca anterior:', error);
    }
  }, [router]);

  const runSearch = useCallback(
    async (
      queryOverride?: string,
      optionsOverride?: Partial<SearchOptionsState>,
      offsetOverride = offset,
      queryChipsOverride = queryChips
    ) => {
      const terms = uniqueStrings([queryOverride ?? query, ...queryChipsOverride]);
      const searchQuery = terms.join(' ').trim();

      if (!selectedAccountId) {
        toast({ title: 'Selecione uma conta', description: 'Escolha a conta ativa do Mercado Livre para buscar.', variant: 'destructive' });
        return;
      }

      if (!searchQuery) {
        toast({ title: 'Informe a busca', description: 'Digite um termo, ID ou URL do Mercado Livre.', variant: 'destructive' });
        return;
      }

      setSearching(true);
      setSearchError(null);
      setSearchState(null);
      setSelectedItemKeys(new Set());
      setOffset(offsetOverride);
      router.replace(`/buscar-mercado-livre?q=${encodeURIComponent(searchQuery)}`);

      try {
        const data = await fetchJson<SearchApiResponse>('/api/mercado-livre/search', {
          method: 'POST',
          body: JSON.stringify({
            accountId: selectedAccountId,
            query: searchQuery,
            mode,
            limit,
            offset: offsetOverride,
            options: {
              ...searchOptions,
              ...optionsOverride,
            },
          }),
        });

        setSearchState({
          mode: data.mode,
          queryStrategy: data.queryStrategy,
          account: data.account,
          query: data.query,
          paging: data.paging,
          searchOptions: data.searchOptions,
          results: data.results,
          publishedPresence: data.publishedPresence || [],
        });
        setLocalTerms([]);
        toast({ title: 'Busca concluída', description: `${data.results.length} resultados carregados.` });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Falha ao buscar no Mercado Livre.';
        setSearchError(message);
        toast({ title: 'Erro na busca', description: message, variant: 'destructive' });
      } finally {
        setSearching(false);
      }
    },
    [limit, mode, offset, query, queryChips, router, searchOptions, selectedAccountId, toast]
  );

  useEffect(() => {
    if (!initialQuery || !selectedAccountId || autoSearchRef.current) return;
    autoSearchRef.current = true;
    void runSearch(initialQuery, undefined, 0);
  }, [initialQuery, runSearch, selectedAccountId]);

  const results = searchState?.results || [];
  const selectedProducts = useMemo(
    () => results.filter((item) => selectedItemKeys.has(getItemKey(item))),
    [results, selectedItemKeys]
  );
  const resultCategories = useMemo<ResultCategorySummary[]>(() => {
    const counts = new Map<string, ResultCategorySummary>();

    results.forEach((item, index) => {
      if (!item.categoryId) return;
      const itemVisits = item.totalVisits ?? null;
      const current = counts.get(item.categoryId);
      if (current) {
        current.count += 1;
        if (item.categoryInfo?.name) current.name = item.categoryInfo.name;
        if (itemVisits !== null && (current.maxVisits === null || itemVisits > current.maxVisits)) {
          current.maxVisits = itemVisits;
        }
        return;
      }

      counts.set(item.categoryId, {
        id: item.categoryId,
        name: item.categoryInfo?.name || item.categoryId,
        count: 1,
        maxVisits: itemVisits,
        firstIndex: index,
      });
    });

    return [...counts.values()].sort((left, right) => {
      const visitsDiff = (right.maxVisits ?? -1) - (left.maxVisits ?? -1);
      if (visitsDiff !== 0) return visitsDiff;
      const countDiff = right.count - left.count;
      if (countDiff !== 0) return countDiff;
      return left.firstIndex - right.firstIndex;
    });
  }, [results]);
  const resultCategoryIds = useMemo(() => resultCategories.map((category) => category.id).join('|'), [resultCategories]);
  const trendDialogCategory = useMemo(
    () => resultCategories.find((category) => category.id === trendDialogCategoryId) || null,
    [resultCategories, trendDialogCategoryId]
  );
  const presenceByKey = useMemo(
    () => new Map((searchState?.publishedPresence || []).map((presence) => [presence.itemKey, presence])),
    [searchState?.publishedPresence]
  );

  const attributeFacets = useMemo(() => getTopAttributes(results), [results]);

  const filterCounts = useMemo(() => {
    return {
      official: results.filter((item) => Boolean(item.officialStoreId || item.officialStoreName)).length,
      marketplace: results.filter((item) => !item.officialStoreId && !item.officialStoreName).length,
      free: results.filter((item) => item.freeShipping).length,
      flex: results.filter((item) => item.hasFlex).length,
      full: results.filter(hasFullShipping).length,
      classic: results.filter((item) => item.classicPrice !== null || item.listingTypeId === 'gold_special').length,
      premium: results.filter((item) => item.premiumPrice !== null || item.listingTypeId === 'gold_pro').length,
    };
  }, [results]);

  const filteredResults = useMemo(() => {
    const withScore = results
      .map((item) => {
        const termMatch = itemMatchesLocalTerms(item, localTerms);
        return { item, score: termMatch.score, matches: termMatch.matches };
      })
      .filter(({ item, matches }) => {
        if (!matches) return false;

        if (storeFilters.length > 0) {
          const isOfficial = Boolean(item.officialStoreId || item.officialStoreName);
          const storeMatch =
            (isOfficial && storeFilters.includes('official')) || (!isOfficial && storeFilters.includes('marketplace'));
          if (!storeMatch) return false;
        }

        if (shippingFilters.length > 0) {
          const shippingMatch = shippingFilters.some((filter) => {
            if (filter === 'free') return item.freeShipping;
            if (filter === 'flex') return item.hasFlex;
            return hasFullShipping(item);
          });
          if (!shippingMatch) return false;
        }

        if (listingFilters.length > 0) {
          const listingMatch = listingFilters.some((filter) => {
            if (item.listingTypeId === filter) return true;
            if (filter === 'gold_special') return item.classicPrice !== null;
            return item.premiumPrice !== null;
          });
          if (!listingMatch) return false;
        }

        const attributeMatch = Object.entries(attributeFilters).every(([attributeId, selectedValues]) => {
          if (selectedValues.length === 0) return true;
          const value = getAttributeValue(item, attributeId);
          return value ? selectedValues.includes(value) : false;
        });

        return attributeMatch;
      });

    withScore.sort((left, right) => {
      const visitsDiff = (right.item.totalVisits ?? -1) - (left.item.totalVisits ?? -1);
      if (visitsDiff !== 0) return visitsDiff;
      return right.score - left.score;
    });

    return withScore.map(({ item }) => item);
  }, [attributeFilters, listingFilters, localTerms, results, shippingFilters, storeFilters]);

  useEffect(() => {
    if (!selectedAccountId || resultCategories.length === 0) {
      setCategoryTrendsById({});
      return;
    }

    let cancelled = false;
    const categories = resultCategories.map((category) => ({ id: category.id }));

    setCategoryTrendsById((current) => {
      const next: Record<string, CategoryTrendLoadState> = {};
      categories.forEach((category) => {
        const existing = current[category.id];
        next[category.id] = {
          trends: existing?.trends || [],
          categoryInfo: existing?.categoryInfo || null,
          loading: true,
          error: null,
        };
      });
      return next;
    });

    async function loadCategory(categoryId: string) {
      try {
        const data = await fetchJson<CategoryTrendsApiResponse>('/api/mercado-livre/category-trends', {
          method: 'POST',
          body: JSON.stringify({
            accountId: selectedAccountId,
            categoryId,
          }),
        });

        if (cancelled) return;
        setCategoryTrendsById((current) => ({
          ...current,
          [categoryId]: {
            trends: data.trends || [],
            categoryInfo: data.categoryInfo || null,
            loading: false,
            error: null,
          },
        }));
      } catch (error) {
        if (cancelled) return;
        setCategoryTrendsById((current) => ({
          ...current,
          [categoryId]: {
            trends: current[categoryId]?.trends || [],
            categoryInfo: current[categoryId]?.categoryInfo || null,
            loading: false,
            error: error instanceof Error ? error.message : 'Falha ao carregar tendências.',
          },
        }));
      }
    }

    async function loadAllCategories() {
      const queue = [...categories];
      const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
        while (!cancelled) {
          const next = queue.shift();
          if (!next) return;
          await loadCategory(next.id);
        }
      });

      await Promise.all(workers);
    }

    void loadAllCategories();

    return () => {
      cancelled = true;
    };
  }, [resultCategories.length, resultCategoryIds, selectedAccountId]);

  function addQueryChip() {
    const next = queryChipInput.trim();
    if (!next) return;
    setQueryChips((current) => uniqueStrings([...current, next]));
    setQueryChipInput('');
  }

  function addLocalTerm() {
    const next = localTermInput.trim();
    if (!next) return;
    setLocalTerms((current) => uniqueStrings([...current, next]));
    setLocalTermInput('');
  }

  function runTrendSearch(keyword: string) {
    const nextQuery = keyword.trim();
    if (!nextQuery) return;

    setQuery(nextQuery);
    setQueryChips([]);
    setLocalTerms([]);
    setOffset(0);
    void runSearch(nextQuery, undefined, 0, []);
  }

  function updateSearchOption<K extends keyof SearchOptionsState>(key: K, value: SearchOptionsState[K]) {
    setSearchOptions((current) => ({ ...current, [key]: value }));
  }

  async function updateResultsVisitsWindow(value: MercadoLivreVisitsWindow) {
    const nextOptions: Partial<SearchOptionsState> = {
      includeVisits: true,
      visitsWindow: value,
    };
    setSearchOptions((current) => ({ ...current, ...nextOptions }));

    if (!searchState || !selectedAccountId) return;

    setVisitsRefreshing(true);
    try {
      const data = await fetchJson<VisitsRefreshApiResponse>('/api/mercado-livre/visits', {
        method: 'POST',
        body: JSON.stringify({
          accountId: selectedAccountId,
          days: value,
          entries: searchState.results.map(buildVisitsRefreshEntry),
        }),
      });
      const visitsByKey = new Map(data.results.map((entry) => [entry.itemKey, entry.totalVisits]));

      setSearchState((current) => {
        if (!current) return current;
        return {
          ...current,
          searchOptions: {
            ...current.searchOptions,
            includeVisits: true,
            visitsWindow: data.days,
          },
          results: current.results.map((item) => {
            const nextVisits = visitsByKey.get(getItemKey(item));
            return nextVisits === undefined ? item : { ...item, totalVisits: nextVisits };
          }),
        };
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao atualizar visitas.';
      toast({ title: 'Visitas Mercado Livre', description: message, variant: 'destructive' });
    } finally {
      setVisitsRefreshing(false);
    }
  }

  function toggleStoreFilter(value: StoreFilter) {
    setStoreFilters((current) => (hasAnySelected(current, value) ? current.filter((item) => item !== value) : [...current, value]));
  }

  function toggleShippingFilter(value: ShippingFilter) {
    setShippingFilters((current) => (hasAnySelected(current, value) ? current.filter((item) => item !== value) : [...current, value]));
  }

  function toggleListingFilter(value: ListingFilter) {
    setListingFilters((current) => (hasAnySelected(current, value) ? current.filter((item) => item !== value) : [...current, value]));
  }

  function toggleAttributeFilter(attributeId: string, value: string) {
    setAttributeFilters((current) => {
      const selected = current[attributeId] || [];
      const nextValues = selected.includes(value) ? selected.filter((entry) => entry !== value) : [...selected, value];
      return {
        ...current,
        [attributeId]: nextValues,
      };
    });
  }

  async function toggleSavedOffer(item: MercadoLivreSearchItem) {
    const itemKey = getItemKey(item);
    setSavingKeys((current) => new Set([...current, itemKey]));

    try {
      if (savedOffers.has(itemKey)) {
        await fetchJson<{ ok: boolean }>(`/api/mercado-livre/saved-offers?offerKey=${encodeURIComponent(itemKey)}`, {
          method: 'DELETE',
        });
        setSavedOffers((current) => {
          const next = new Map(current);
          next.delete(itemKey);
          return next;
        });
        toast({ title: 'Oferta removida', description: 'O item saiu da lista de salvos.' });
      } else {
        const data = await fetchJson<SavedOfferApiResponse>('/api/mercado-livre/saved-offers', {
          method: 'POST',
          body: JSON.stringify({ item }),
        });
        setSavedOffers((current) => new Map(current).set(data.offer.offerKey, data.offer));
        toast({ title: 'Oferta salva', description: 'O item foi salvo para análise posterior.' });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao atualizar oferta salva.';
      toast({ title: 'Ofertas salvas', description: message, variant: 'destructive' });
    } finally {
      setSavingKeys((current) => {
        const next = new Set(current);
        next.delete(itemKey);
        return next;
      });
    }
  }

  function toggleSelectedItem(item: MercadoLivreSearchItem) {
    const itemKey = getItemKey(item);
    setSelectedItemKeys((current) => {
      const next = new Set(current);
      if (next.has(itemKey)) next.delete(itemKey);
      else next.add(itemKey);
      return next;
    });
  }

  function setVisibleSelection(selected: boolean) {
    setSelectedItemKeys((current) => {
      const next = new Set(current);
      filteredResults.forEach((item) => {
        const key = getItemKey(item);
        if (selected) next.add(key);
        else next.delete(key);
      });
      return next;
    });
  }

  function startDeepSearch(config: DeepSearchConfig) {
    if (!selectedAccountId) {
      toast({ title: 'Selecione uma conta', description: 'Escolha a conta ativa do Mercado Livre.', variant: 'destructive' });
      return;
    }

    if (searchState) {
      const snapshot: MercadoLivreSearchSnapshot = {
        accountId: selectedAccountId,
        mode,
        query,
        queryChips,
        limit,
        offset,
        searchOptions,
        searchState,
        localTerms,
        storeFilters,
        shippingFilters,
        listingFilters,
        attributeFilters,
        selectedItemKeys: Array.from(selectedItemKeys),
        savedAt: new Date().toISOString(),
      };
      try {
        saveMercadoLivreSearchSnapshot(snapshot);
      } catch (error) {
        console.warn('[buscar-mercado-livre] Não foi possível salvar snapshot da busca:', error);
      }
    }

    const payload = {
      accountId: selectedAccountId,
      config,
      createdAt: new Date().toISOString(),
    };

    window.sessionStorage.setItem(ML_DEEP_SEARCH_REQUEST_KEY, JSON.stringify(payload));
    router.push('/buscar-mercado-livre/deep-search');
  }

  return (
    <DashboardLayout>
      <div className="space-y-5 p-4 md:p-6 lg:p-8">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">Buscar Mercado Livre</h1>
            <Badge variant="secondary" className="gap-1">
              <Layers3 className="h-3.5 w-3.5" />
              {mode === 'catalog' ? 'Catálogo' : 'Anúncios'}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Pesquise produtos, compare ofertas, veja sinais comerciais e salve oportunidades.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDeepSearchOpen(true)}
            disabled={selectedProducts.length === 0}
          >
            <Sparkles className="h-4 w-4" />
            Deep Search ({selectedProducts.length})
          </Button>
        </div>
      </div>

      <Card className="overflow-hidden">
        <CardHeader className="border-b bg-muted/20 pb-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <Search className="h-4 w-4" />
              Pesquisar Produtos
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant={mode === 'catalog' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setMode('catalog')}
            >
              <PackageCheck className="h-4 w-4" />
              Buscar catálogo
            </Button>
            <Button
              type="button"
              variant={mode === 'items' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setMode('items')}
            >
              <ShoppingBag className="h-4 w-4" />
              Buscar anúncios
            </Button>
            <Badge variant="outline" className="gap-1">
              <CircleDollarSign className="h-3.5 w-3.5" />
              Taxas estimadas
            </Badge>
            <Badge variant="outline" className="gap-1">
              <BarChart3 className="h-3.5 w-3.5" />
              Dados enriquecidos
            </Badge>
          </div>

          <div className="grid gap-3 lg:grid-cols-[minmax(260px,1fr)_120px_auto]">
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void runSearch(undefined, undefined, 0);
                }}
                className="pl-9"
                placeholder="Termo, ID MLB ou URL do Mercado Livre"
              />
            </div>
            <Select value={String(limit)} onValueChange={(value) => setLimit(Number(value))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LIMIT_OPTIONS.map((option) => (
                  <SelectItem key={option} value={String(option)}>
                    {option} itens
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={() => void runSearch(undefined, undefined, 0)} disabled={searching || accountsLoading}>
              {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Buscar
            </Button>
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Termos adicionais</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                value={queryChipInput}
                onChange={(event) => setQueryChipInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addQueryChip();
                  }
                }}
                placeholder="Ex.: 128gb, titanium, lacrado"
              />
              <Button type="button" variant="outline" onClick={addQueryChip}>
                Adicionar
              </Button>
            </div>
            {queryChips.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {queryChips.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-muted"
                    onClick={() => setQueryChips((current) => current.filter((item) => item !== chip))}
                  >
                    {chip}
                    <X className="h-3.5 w-3.5" />
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <Accordion type="single" collapsible className="rounded-md border px-3">
            <AccordionItem value="enrichment" className="border-none">
              <AccordionTrigger className="py-3 text-sm">
                <span className="flex items-center gap-2">
                  <Settings2 className="h-4 w-4" />
                  Enriquecimento da busca
                </span>
              </AccordionTrigger>
              <AccordionContent>
                <div className="grid gap-3 pb-3 md:grid-cols-2 xl:grid-cols-3">
                  {switchRow('Visitas do anúncio', searchOptions.includeVisits, (checked) =>
                    updateSearchOption('includeVisits', checked)
                  )}
                  {switchRow('Avaliações', searchOptions.includeReviews, (checked) =>
                    updateSearchOption('includeReviews', checked)
                  )}
                  {switchRow('Perguntas recentes', searchOptions.includeQuestions, (checked) =>
                    updateSearchOption('includeQuestions', checked)
                  )}
                  {switchRow('Categoria', searchOptions.includeCategoryInfo, (checked) =>
                    updateSearchOption('includeCategoryInfo', checked)
                  )}
                  {switchRow('Tendências', searchOptions.includeTrends, (checked) =>
                    updateSearchOption('includeTrends', checked)
                  )}
                  {switchRow('Frete por CEP', searchOptions.includeShipping, (checked) =>
                    updateSearchOption('includeShipping', checked)
                  )}
                </div>
                {searchOptions.includeVisits ? (
                  <div className="max-w-xs pb-3">
                    <Label htmlFor="visitsWindow">Janela das visitas</Label>
                    <VisitsWindowSelect
                      id="visitsWindow"
                      value={searchOptions.visitsWindow}
                      onChange={(value) => updateSearchOption('visitsWindow', value)}
                    />
                  </div>
                ) : null}
                {searchOptions.includeShipping ? (
                  <div className="max-w-xs pb-3">
                    <Label htmlFor="shippingZipCode">CEP para simular frete</Label>
                    <Input
                      id="shippingZipCode"
                      value={searchOptions.shippingZipCode}
                      onChange={(event) => updateSearchOption('shippingZipCode', event.target.value.replace(/\D/g, '').slice(0, 8))}
                      placeholder="00000000"
                    />
                  </div>
                ) : null}
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </CardContent>
      </Card>

      {searching ? (
        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center gap-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              Buscando dados no Mercado Livre e enriquecendo resultados...
            </div>
            <Progress value={65} />
          </CardContent>
        </Card>
      ) : null}

      {searchError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Não foi possível concluir a busca</AlertTitle>
          <AlertDescription>{searchError}</AlertDescription>
        </Alert>
      ) : null}

      {searchState ? (
        <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
          <aside className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Filter className="h-4 w-4" />
                  Filtros locais
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-md border bg-muted/20 p-3 text-sm">
                  <div className="font-medium">{filteredResults.length} / {results.length} resultados</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Total informado pelo ML: {formatCount(searchState.paging.total)}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Buscar nos resultados</Label>
                  <div className="flex gap-2">
                    <Input
                      value={localTermInput}
                      onChange={(event) => setLocalTermInput(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          addLocalTerm();
                        }
                      }}
                      placeholder="Filtrar cards"
                    />
                    <Button type="button" variant="outline" size="icon" onClick={addLocalTerm}>
                      <Search className="h-4 w-4" />
                    </Button>
                  </div>
                  {localTerms.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {localTerms.map((term) => (
                        <button
                          key={term}
                          type="button"
                          className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted"
                          onClick={() => setLocalTerms((current) => current.filter((item) => item !== term))}
                        >
                          {term}
                          <X className="h-3 w-3" />
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>

                <Separator />

                <FacetSection title="Loja">
                  {(['official', 'marketplace'] as StoreFilter[]).map((filter) => (
                    <FacetButton
                      key={filter}
                      active={storeFilters.includes(filter)}
                      label={storeLabel(filter)}
                      count={filter === 'official' ? filterCounts.official : filterCounts.marketplace}
                      onClick={() => toggleStoreFilter(filter)}
                    />
                  ))}
                </FacetSection>

                <FacetSection title="Entrega">
                  {(['free', 'flex', 'full'] as ShippingFilter[]).map((filter) => (
                    <FacetButton
                      key={filter}
                      active={shippingFilters.includes(filter)}
                      label={shippingLabel(filter)}
                      count={filter === 'free' ? filterCounts.free : filter === 'flex' ? filterCounts.flex : filterCounts.full}
                      onClick={() => toggleShippingFilter(filter)}
                    />
                  ))}
                </FacetSection>

                <FacetSection title="Tipo de anúncio">
                  <FacetButton
                    active={listingFilters.includes('gold_special')}
                    label="Clássico"
                    count={filterCounts.classic}
                    onClick={() => toggleListingFilter('gold_special')}
                  />
                  <FacetButton
                    active={listingFilters.includes('gold_pro')}
                    label="Premium"
                    count={filterCounts.premium}
                    onClick={() => toggleListingFilter('gold_pro')}
                  />
                </FacetSection>

                {attributeFacets.map((facet) => (
                  <FacetSection key={facet.id} title={facet.name}>
                    {facet.values.map((option) => (
                      <FacetButton
                        key={`${facet.id}:${option.value}`}
                        active={(attributeFilters[facet.id] || []).includes(option.value)}
                        label={option.value}
                        count={option.count}
                        onClick={() => toggleAttributeFilter(facet.id, option.value)}
                      />
                    ))}
                  </FacetSection>
                ))}
              </CardContent>
            </Card>
          </aside>

          <section className="space-y-4">
            <Card>
              <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setVisibleSelection(true)}
                    disabled={filteredResults.length === 0}
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    Selecionar visíveis
                  </Button>
                  {selectedProducts.length > 0 ? (
                    <>
                      <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedItemKeys(new Set())}>
                        Limpar seleção
                      </Button>
                      <Badge variant="secondary">{selectedProducts.length} para Deep Search</Badge>
                    </>
                  ) : null}
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  {searchState.searchOptions.includeVisits ? (
                    <div className="flex items-center gap-2 rounded-md border bg-white px-2 py-1.5">
                      {visitsRefreshing ? (
                        <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                      ) : (
                        <Eye className="h-4 w-4 text-blue-500" />
                      )}
                      <span className="whitespace-nowrap text-xs font-medium text-slate-600">Janela</span>
                      <VisitsWindowSelect
                        value={searchState.searchOptions.visitsWindow}
                        onChange={updateResultsVisitsWindow}
                        disabled={searching || visitsRefreshing}
                        triggerClassName="h-8 w-[130px]"
                      />
                    </div>
                  ) : null}
                </div>
                <PaginationControls
                  disabled={searching}
                  offset={searchState.paging.offset}
                  limit={searchState.paging.limit}
                  total={searchState.paging.total}
                  loaded={results.length}
                  onPrevious={() =>
                    void runSearch(searchState.query, undefined, Math.max(0, searchState.paging.offset - searchState.paging.limit))
                  }
                  onNext={() => void runSearch(searchState.query, undefined, searchState.paging.offset + searchState.paging.limit)}
                />
              </CardContent>
            </Card>

            <CategoryTrendsCardsSection
              categories={resultCategories}
              trendsById={categoryTrendsById}
              onTrendClick={runTrendSearch}
              onOpenCategory={(categoryId) => setTrendDialogCategoryId(categoryId)}
            />

            {filteredResults.length === 0 ? (
              <Card>
                <CardContent className="flex min-h-[240px] flex-col items-center justify-center gap-2 p-6 text-center">
                  <Search className="h-8 w-8 text-muted-foreground" />
                  <p className="font-medium">Nenhum resultado nos filtros atuais</p>
                  <p className="max-w-md text-sm text-muted-foreground">
                    Remova filtros locais ou ajuste os termos de busca para ampliar os resultados.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                {filteredResults.map((item) => {
                  const itemKey = getItemKey(item);
                  return (
                    <ResultCard
                      key={itemKey}
                      item={item}
                      presence={presenceByKey.get(itemKey)}
                      isSaved={savedOffers.has(itemKey)}
                      isSaving={savingKeys.has(itemKey)}
                      isSelected={selectedItemKeys.has(itemKey)}
                      onToggleSelected={() => toggleSelectedItem(item)}
                      onToggleSaved={() => void toggleSavedOffer(item)}
                      onDetails={() => setDetailsItem(item)}
                      searchTerm={searchState.query}
                      visitsWindow={searchState.searchOptions.visitsWindow}
                      accountId={selectedAccountId}
                    />
                  );
                })}
              </div>
            )}
          </section>
        </div>
      ) : !searching ? (
        <Card>
          <CardContent className="flex min-h-[260px] flex-col items-center justify-center gap-3 p-8 text-center">
            <div className="rounded-full border bg-muted p-3">
              <Search className="h-7 w-7 text-muted-foreground" />
            </div>
            <div>
              <p className="font-medium">Use a busca acima para carregar oportunidades</p>
              <p className="mt-1 max-w-lg text-sm text-muted-foreground">
                A tela foi preparada para reproduzir o fluxo da referência: conta ativa, busca por catálogo ou anúncio,
                enriquecimento, filtros e cards de análise.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

        <DeepSearchDialog
          open={deepSearchOpen}
          onOpenChange={setDeepSearchOpen}
          selectedProducts={selectedProducts}
          onStart={startDeepSearch}
        />
        <CategoryTrendsDialog
          category={trendDialogCategory}
          state={trendDialogCategory ? categoryTrendsById[trendDialogCategory.id] : undefined}
          open={Boolean(trendDialogCategory)}
          onOpenChange={(open) => !open && setTrendDialogCategoryId(null)}
          onTrendClick={(keyword) => {
            setTrendDialogCategoryId(null);
            runTrendSearch(keyword);
          }}
        />
        <DetailsDialog item={detailsItem} onOpenChange={(open) => !open && setDetailsItem(null)} />
      </div>
    </DashboardLayout>
  );
}

function PaginationControls({
  disabled,
  offset,
  limit,
  total,
  loaded,
  onPrevious,
  onNext,
}: {
  disabled: boolean;
  offset: number;
  limit: number;
  total: number;
  loaded: number;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const first = total > 0 ? offset + 1 : 0;
  const last = Math.min(offset + loaded, total);
  const canPrevious = offset > 0;
  const canNext = offset + limit < total;

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <span className="whitespace-nowrap text-xs text-muted-foreground">
        {formatCount(first)}-{formatCount(last)} de {formatCount(total)}
      </span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={onPrevious} disabled={disabled || !canPrevious}>
          Anterior
        </Button>
        <Button variant="outline" size="sm" onClick={onNext} disabled={disabled || !canNext}>
          Próxima
        </Button>
      </div>
    </div>
  );
}

function CategoryTrendsCardsSection({
  categories,
  trendsById,
  onTrendClick,
  onOpenCategory,
}: {
  categories: ResultCategorySummary[];
  trendsById: Record<string, CategoryTrendLoadState>;
  onTrendClick: (keyword: string) => void;
  onOpenCategory: (categoryId: string) => void;
}) {
  if (categories.length === 0) return null;

  const loadingCount = categories.filter((category) => trendsById[category.id]?.loading ?? true).length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4" />
            Tendências por categoria
          </span>
          <span className="text-xs font-normal text-muted-foreground">
            {categories.length} categoria{categories.length !== 1 ? 's' : ''} única{categories.length !== 1 ? 's' : ''}
            {loadingCount > 0 ? ` · ${loadingCount} carregando` : ''}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 lg:grid-cols-2">
          {categories.map((category) => (
            <CategoryTrendSummaryCard
              key={category.id}
              category={category}
              state={trendsById[category.id]}
              onTrendClick={onTrendClick}
              onOpen={() => onOpenCategory(category.id)}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function CategoryTrendSummaryCard({
  category,
  state,
  onTrendClick,
  onOpen,
}: {
  category: ResultCategorySummary;
  state: CategoryTrendLoadState | undefined;
  onTrendClick: (keyword: string) => void;
  onOpen: () => void;
}) {
  const loading = state?.loading ?? true;
  const error = state?.error || null;
  const trends = state?.trends || [];
  const topTrends = trends.slice(0, 10);
  const categoryName = state?.categoryInfo?.name || category.name;
  const categoryPath = state?.categoryInfo?.path || null;

  return (
    <div className="space-y-3 rounded-md border bg-background p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold">{categoryName}</h3>
            <Badge variant="outline" className="shrink-0 font-mono text-[10px]">
              {category.id}
            </Badge>
          </div>
          {categoryPath && categoryPath !== categoryName ? (
            <p className="truncate text-[11px] text-muted-foreground" title={categoryPath}>
              {categoryPath}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>
              {category.count} resultado{category.count !== 1 ? 's' : ''}
            </span>
            {category.maxVisits !== null ? <span>Maior anúncio: {formatCount(category.maxVisits)} visitas</span> : null}
          </div>
        </div>
        {loading ? <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-muted-foreground" /> : null}
      </div>

      {error ? <p className="text-xs text-red-600">{error}</p> : null}

      {!loading && !error && trends.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nenhuma tendência retornada para esta categoria.</p>
      ) : null}

      {topTrends.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {topTrends.map((trend) => (
            <TrendKeywordButton key={`${category.id}:${trend.rank || trend.keyword}:${trend.keyword}`} trend={trend} onClick={onTrendClick} />
          ))}
        </div>
      ) : loading ? (
        <div className="grid gap-1.5 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-7 animate-pulse rounded-md bg-muted" />
          ))}
        </div>
      ) : null}

      {trends.length > 10 ? (
        <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onOpen}>
          Ver tudo ({trends.length})
        </Button>
      ) : null}
    </div>
  );
}

function CategoryTrendsDialog({
  category,
  state,
  open,
  onOpenChange,
  onTrendClick,
}: {
  category: ResultCategorySummary | null;
  state: CategoryTrendLoadState | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTrendClick: (keyword: string) => void;
}) {
  if (!category) return null;

  const loading = state?.loading ?? false;
  const error = state?.error || null;
  const trends = state?.trends || [];
  const grouped = groupCategoryTrends(trends);
  const categoryName = state?.categoryInfo?.name || category.name;
  const categoryPath = state?.categoryInfo?.path || null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[86vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{categoryName}</DialogTitle>
          <DialogDescription>
            {category.id} · {category.count} resultado{category.count !== 1 ? 's' : ''}
            {categoryPath && categoryPath !== categoryName ? ` · ${categoryPath}` : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {loading ? (
            <div className="flex items-center gap-2 rounded-md border bg-muted/20 p-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando tendências da categoria...
            </div>
          ) : null}

          {error ? <p className="text-sm text-red-600">{error}</p> : null}

          {!loading && !error && trends.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma tendência retornada para esta categoria.</p>
          ) : null}

          {TREND_GROUPS.map((group) => {
            const entries = grouped[group] || [];
            if (entries.length === 0) return null;

            return (
              <div key={group} className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{trendGroupLabel(group)}</h3>
                <div className="flex flex-wrap gap-2">
                  {entries.map((trend) => (
                    <TrendKeywordButton
                      key={`${category.id}:dialog:${trend.rank || trend.keyword}:${trend.keyword}`}
                      trend={trend}
                      onClick={onTrendClick}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TrendKeywordButton({
  trend,
  onClick,
}: {
  trend: MercadoLivreSearchCategoryTrend;
  onClick: (keyword: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onClick(trend.keyword)}
      className="inline-flex max-w-full items-center gap-1 rounded-md border bg-background px-2 py-1 text-left text-[11px] font-medium hover:bg-muted"
      title={trend.keyword}
    >
      {trend.rank ? <span className="shrink-0 text-muted-foreground">#{trend.rank}</span> : null}
      <span className="truncate">{trend.keyword}</span>
    </button>
  );
}

function groupCategoryTrends(trends: MercadoLivreSearchCategoryTrend[]) {
  return trends.reduce<Record<TrendGroup, MercadoLivreSearchCategoryTrend[]>>(
    (acc, trend) => {
      acc[trend.group || 'popular'].push(trend);
      return acc;
    },
    { growth: [], most_wanted: [], popular: [] }
  );
}

function FacetSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function FacetButton({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex max-w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors',
        active ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted'
      )}
    >
      <span className="truncate">{label}</span>
      <span className={cn('rounded bg-muted px-1.5 text-[10px]', active ? 'bg-primary-foreground/20 text-primary-foreground' : '')}>
        {count}
      </span>
    </button>
  );
}

function getCatalogUrl(item: MercadoLivreSearchItem) {
  if (item.sourceType === 'item' || !item.catalogProductId) return item.permalink || '#';
  try {
    const base = new URL(item.permalink || 'https://www.mercadolivre.com.br/');
    return `${base.origin}/p/${item.catalogProductId}`;
  } catch {
    return `https://www.mercadolivre.com.br/p/${item.catalogProductId}`;
  }
}

const matchConfig = {
  high: {
    icon: CheckCircle2,
    bg: 'bg-green-100',
    border: 'border-green-200',
    text: 'text-green-800',
    iconColor: 'text-green-600',
    badge: 'bg-green-600 text-white',
    label: 'Alta Correspondência',
  },
  medium: {
    icon: AlertCircle,
    bg: 'bg-yellow-100',
    border: 'border-yellow-200',
    text: 'text-yellow-800',
    iconColor: 'text-yellow-600',
    badge: 'bg-yellow-500 text-white',
    label: 'Correspondência Parcial',
  },
  low: {
    icon: AlertCircle,
    bg: 'bg-orange-100',
    border: 'border-orange-200',
    text: 'text-orange-800',
    iconColor: 'text-orange-600',
    badge: 'bg-orange-500 text-white',
    label: 'Baixa Correspondência',
  },
  none: {
    icon: AlertCircle,
    bg: 'bg-slate-100',
    border: 'border-slate-200',
    text: 'text-slate-700',
    iconColor: 'text-slate-500',
    badge: 'bg-slate-500 text-white',
    label: 'Resultado',
  },
};

const summaryToneClasses: Record<'slate' | 'emerald' | 'amber' | 'blue' | 'rose', { box: string; icon: string; value: string }> = {
  slate: { box: 'border-slate-200 bg-white', icon: 'text-slate-500', value: 'text-slate-900' },
  emerald: { box: 'border-emerald-200 bg-emerald-50', icon: 'text-emerald-600', value: 'text-emerald-800' },
  amber: { box: 'border-amber-200 bg-amber-50', icon: 'text-amber-600', value: 'text-amber-800' },
  blue: { box: 'border-blue-200 bg-blue-50', icon: 'text-blue-600', value: 'text-blue-800' },
  rose: { box: 'border-rose-200 bg-rose-50', icon: 'text-rose-600', value: 'text-rose-800' },
};

function getShippingMetricTone(fees: MercadoLivreFeeDetails | null | undefined): keyof typeof summaryToneClasses {
  if (!fees) return 'slate';
  if (fees.shippingCostSource === 'mercado_livre') return 'emerald';
  if (fees.shippingCostSource === 'fallback_table') return 'amber';
  if (fees.shippingCostSource === 'unavailable') return 'rose';
  return 'slate';
}

function CommercialSummaryMetric({
  label,
  value,
  detail,
  icon: Icon,
  tone = 'slate',
  isBuyBox = false,
}: {
  label: string;
  value: string;
  detail?: string | null;
  icon: React.ComponentType<{ className?: string }>;
  tone?: keyof typeof summaryToneClasses;
  isBuyBox?: boolean;
}) {
  const classes = summaryToneClasses[tone];
  return (
    <div className={cn('rounded-md border px-3 py-2', classes.box, isBuyBox && 'border-amber-300 bg-amber-50 ring-1 ring-amber-200')}>
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase text-slate-500">
        <span className="flex min-w-0 items-center gap-1.5 truncate">
          <Icon className={cn('h-3.5 w-3.5', isBuyBox ? 'text-amber-600' : classes.icon)} />
          {label}
        </span>
        {isBuyBox ? <Crown className="ml-auto h-3.5 w-3.5 text-amber-700" /> : null}
      </div>
      <div className={cn('mt-1 text-sm font-semibold', isBuyBox ? 'text-amber-900' : classes.value)}>{value}</div>
      {detail ? <div className="mt-0.5 text-[11px] text-slate-500">{detail}</div> : null}
    </div>
  );
}

function getCatalogOffers(item: MercadoLivreSearchItem) {
  return item.marketplaceData?.catalogOffers?.results || [];
}

function getOfferItemIdFromRaw(offer: Record<string, unknown>) {
  return getDetailString(offer, ['item_id', 'id']);
}

function buildVisitsRefreshEntry(item: MercadoLivreSearchItem): MercadoLivreVisitsRefreshEntry {
  return {
    itemKey: getItemKey(item),
    sourceType: item.sourceType,
    id: item.id,
    referenceItemId: item.referenceItemId,
    catalogProductId: item.catalogProductId,
    offerItemIds: getCatalogOffers(item)
      .map((offer) => getOfferItemIdFromRaw(asDetailRecord(offer)))
      .filter((itemId): itemId is string => Boolean(itemId)),
  };
}

function CompetitorRow({ competitor, days }: { competitor: MercadoLivreCompetitor; days: MercadoLivreVisitsWindow }) {
  const reputation = competitor.reputation?.levelId ? REPUTATION_LEVELS[competitor.reputation.levelId] : null;
  const ReputationIcon = reputation?.icon;
  const location = [competitor.sellerCity, competitor.sellerState].filter(Boolean).join(' - ');

  return (
    <div
      className={cn(
        'rounded-lg border bg-white p-3 text-sm',
        competitor.isBuyBoxWinner ? 'border-yellow-300 bg-yellow-50' : 'border-slate-200'
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {competitor.isBuyBoxWinner ? <Crown className="h-4 w-4 shrink-0 text-yellow-500" /> : null}
          {competitor.sellerNickname ? (
            <a
              href={`https://www.mercadolivre.com.br/perfil/${competitor.sellerNickname}`}
              target="_blank"
              rel="noreferrer"
              className="truncate font-medium text-blue-600 hover:underline"
            >
              {competitor.sellerNickname}
            </a>
          ) : (
            <span className="font-medium text-slate-900">Seller {competitor.sellerId ?? '-'}</span>
          )}
          {competitor.isBuyBoxWinner ? (
            <Badge className="border-yellow-300 bg-yellow-400 text-yellow-950">Buy Box</Badge>
          ) : null}
        </div>
        <div className="font-semibold text-slate-900">{formatMoney(competitor.price)}</div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <Badge variant="outline">{listingTypeLabel(competitor.listingTypeId)}</Badge>
        <span className="inline-flex items-center gap-1">
          <Truck className="h-3 w-3" />
          {formatLogisticType(competitor.logisticType) || 'N/A'}
        </span>
        {competitor.hasFlex ? (
          <Badge className="border-violet-200 bg-violet-100 text-violet-700">
            Flex
          </Badge>
        ) : null}
        {competitor.freeShipping ? (
          <Badge variant="outline" className="border-emerald-200 text-emerald-700">
            Frete grátis
          </Badge>
        ) : null}
        {location ? (
          <span className="inline-flex items-center gap-1">
            <MapPin className="h-3 w-3" />
            {location}
          </span>
        ) : null}
        {reputation && ReputationIcon ? (
          <span className={cn('inline-flex items-center gap-1 font-medium', reputation.colorClass)}>
            <ReputationIcon className="h-3 w-3" />
            {reputation.label}
          </span>
        ) : null}
        {competitor.reputation?.powerSellerStatus ? (
          <Badge variant="outline">{competitor.reputation.powerSellerStatus}</Badge>
        ) : null}
        <span className="inline-flex items-center gap-1 font-medium text-slate-700">
          <Eye className="h-3 w-3 text-blue-500" />
          Visitas {visitsWindowLabel(days)}: {formatCount(competitor.visits ?? 0)}
        </span>
      </div>
    </div>
  );
}

function CompetitorsDialog({
  accountId,
  catalogProductId,
  offerCount,
  productTitle,
  days,
}: {
  accountId: string;
  catalogProductId: string;
  offerCount: number | null;
  productTitle: string;
  days: MercadoLivreVisitsWindow;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<MercadoLivreCompetitorsResponse | null>(null);

  const fetchCompetitors = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchJson<CompetitorsApiResponse>('/api/mercado-livre/competitors', {
        method: 'POST',
        body: JSON.stringify({
          accountId,
          catalogProductId,
          days,
          limit: 15,
        }),
      });
      setData(response);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Erro inesperado ao buscar concorrentes.');
    } finally {
      setLoading(false);
    }
  }, [accountId, catalogProductId, days]);

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
  };

  useEffect(() => {
    setData(null);
    setError(null);
    if (open) void fetchCompetitors();
  }, [catalogProductId, days, fetchCompetitors, open]);
  const listedVisitsTotal = data?.competitors.reduce((sum, competitor) => sum + (competitor.visits || 0), 0) ?? 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <button type="button" className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline">
          <Users className="h-3.5 w-3.5" />
          {formatCount(offerCount ?? 0)} ofertas
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Concorrentes
          </DialogTitle>
          <DialogDescription className="line-clamp-2">{productTitle}</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex min-h-56 flex-col items-center justify-center gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-slate-500" />
            <p className="text-sm text-slate-500">Buscando concorrentes...</p>
          </div>
        ) : null}

        {!loading && error ? (
          <div className="flex min-h-56 flex-col items-center justify-center gap-3">
            <p className="text-sm text-red-600">{error}</p>
            <Button variant="outline" size="sm" onClick={() => void fetchCompetitors()}>
              <RefreshCw className="h-3.5 w-3.5" />
              Tentar novamente
            </Button>
          </div>
        ) : null}

        {!loading && !error && data ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
              <span>{formatCount(data.totalCompetitors)} vendedores</span>
              <span>
                Visitas listadas: <strong className="text-slate-900">{formatCount(listedVisitsTotal)}</strong>
              </span>
              {data.priceStats.min !== null ? (
                <>
                  <span>
                    Min: <strong className="text-slate-900">{formatMoney(data.priceStats.min)}</strong>
                  </span>
                  <span>
                    Média: <strong className="text-slate-900">{formatMoney(data.priceStats.avg)}</strong>
                  </span>
                  <span>
                    Max: <strong className="text-slate-900">{formatMoney(data.priceStats.max)}</strong>
                  </span>
                </>
              ) : null}
            </div>

            {data.competitors.length === 0 ? (
              <div className="flex min-h-40 items-center justify-center">
                <p className="text-sm text-slate-500">Nenhum concorrente encontrado para este produto.</p>
              </div>
            ) : (
              <div className="max-h-[420px] space-y-2 overflow-y-auto pr-2">
                {data.competitors.map((competitor) => (
                  <CompetitorRow key={competitor.itemId} competitor={competitor} days={days} />
                ))}
                {data.totalCompetitors > data.competitors.length ? (
                  <p className="pt-1 text-center text-xs text-slate-500">
                    Exibindo os {data.competitors.length} principais de {data.totalCompetitors}
                  </p>
                ) : null}
              </div>
            )}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ResultCard({
  item,
  presence,
  isSaved,
  isSaving,
  isSelected,
  onToggleSelected,
  onToggleSaved,
  onDetails,
  searchTerm,
  visitsWindow,
  accountId,
}: {
  item: MercadoLivreSearchItem;
  presence: MercadoLivrePublishedPresenceItem | undefined;
  isSaved: boolean;
  isSaving: boolean;
  isSelected: boolean;
  onToggleSelected: () => void;
  onToggleSaved: () => void;
  onDetails: () => void;
  searchTerm?: string;
  visitsWindow: MercadoLivreVisitsWindow;
  accountId: string;
}) {
  const isOfficial = Boolean(item.officialStoreId || item.officialStoreName);
  const hasCatalog = Boolean(item.catalogProductId);
  const listingId = item.referenceItemId || (item.sourceType === 'item' ? item.id : null);
  const primaryId = item.sourceType === 'item' ? listingId || item.id : item.catalogProductId || item.id;
  const catalogUrl = getCatalogUrl(item);
  const location = [item.sellerCity, item.sellerState].filter(Boolean).join(' / ');
  const shippingModeLabel = formatShippingMode(item.shippingMode);
  const logisticTypeLabel = formatLogisticType(item.logisticType);
  const visibleShippingTags = item.shippingTags.filter((tag) => tag !== item.logisticType && tag !== item.shippingMode).slice(0, 5);
  const shippingOptions = Array.isArray(item.shippingOptions) ? item.shippingOptions : [];
  const catalogOffers = getCatalogOffers(item);
  const matchResult = searchTerm ? calculateMercadoLivreSearchTermMatchScore(searchTerm, item) : { score: 0, type: 'none' as const };
  const cfg = matchConfig[matchResult.type];
  const MatchIcon = cfg.icon;
  const classicIsBuyBox = item.buyBoxWinnerListingType
    ? item.buyBoxWinnerListingType === 'gold_special'
    : pricesMatch(item.buyBoxWinnerPrice, item.classicPrice);
  const premiumIsBuyBox = item.buyBoxWinnerListingType
    ? item.buyBoxWinnerListingType === 'gold_pro'
    : pricesMatch(item.buyBoxWinnerPrice, item.premiumPrice);
  const [cardVisitsWindow, setCardVisitsWindow] = useState<MercadoLivreVisitsWindow>(visitsWindow);
  const [cardTotalVisits, setCardTotalVisits] = useState<number | null>(item.totalVisits);
  const [cardVisitsLoading, setCardVisitsLoading] = useState(false);
  const [cardVisitsError, setCardVisitsError] = useState<string | null>(null);

  useEffect(() => {
    setCardVisitsWindow(visitsWindow);
    setCardTotalVisits(item.totalVisits);
    setCardVisitsError(null);
  }, [item.id, item.totalVisits, visitsWindow]);

  const updateCardVisitsWindow = useCallback(
    async (value: MercadoLivreVisitsWindow) => {
      setCardVisitsWindow(value);
      setCardVisitsError(null);

      if (!item.catalogProductId) return;

      setCardVisitsLoading(true);
      try {
        const response = await fetchJson<VisitsRefreshApiResponse>('/api/mercado-livre/visits', {
          method: 'POST',
          body: JSON.stringify({
            accountId,
            days: value,
            entries: [buildVisitsRefreshEntry(item)],
          }),
        });
        setCardTotalVisits(response.results[0]?.totalVisits ?? 0);
      } catch (error) {
        setCardVisitsError(error instanceof Error ? error.message : 'Falha ao atualizar visitas.');
      } finally {
        setCardVisitsLoading(false);
      }
    },
    [accountId, item.catalogProductId]
  );

  return (
    <Card className={cn('overflow-hidden rounded-lg bg-white shadow-sm hover:border-slate-300', isSelected ? 'border-primary ring-1 ring-primary/25' : 'border-slate-200')}>
      <div className={cn('border-b px-4 py-2', cfg.bg, cfg.border)}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Checkbox
              checked={isSelected}
              onCheckedChange={onToggleSelected}
              aria-label={`Selecionar ${item.title} para Deep Search`}
              className="border-slate-400 bg-white"
            />
            <MatchIcon className={cn('h-4 w-4 shrink-0', cfg.iconColor)} />
            <span className={cn('truncate text-xs font-semibold', cfg.text)}>
              {searchTerm ? `Busca: ${searchTerm}` : 'Resultado do catálogo'}
            </span>
            {matchResult.type !== 'none' ? (
              <Badge className={cn('h-5 px-1.5 text-[10px]', cfg.badge)}>
                {cfg.label} ({Math.round(matchResult.score)}%)
              </Badge>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {hasCatalog ? (
              <Badge variant="outline" className="h-5 border-blue-200 bg-blue-50 text-[10px] text-blue-700">
                Catálogo
              </Badge>
            ) : null}
            {presence ? <Badge className="h-5 border-rose-200 bg-rose-100 text-[10px] text-rose-800">Já publicado</Badge> : null}
          </div>
        </div>
      </div>

      <div className="grid items-start gap-4 p-4 lg:grid-cols-[96px_minmax(0,1fr)_300px]">
        <div className="h-24 w-24 flex-shrink-0 overflow-hidden rounded-md border border-slate-200 bg-slate-50">
          {item.thumbnail ? <img src={item.thumbnail} alt={item.title} className="h-full w-full object-contain" /> : <Box className="m-auto mt-7 h-9 w-9 text-muted-foreground" />}
        </div>

        <div className="min-w-0 flex-grow space-y-3">
          <div className="space-y-1.5">
            <a
              href={catalogUrl}
              target="_blank"
              rel="noreferrer"
              className="group line-clamp-2 text-sm font-semibold text-blue-600 transition-colors hover:text-blue-800 hover:underline"
            >
              {item.title}
              <ExternalLink className="ml-1 inline-block h-3 w-3 opacity-60 transition-opacity group-hover:opacity-100" />
            </a>
            <p className="text-xs text-slate-500">ID: {primaryId}</p>
            {item.sourceType === 'item' && item.catalogProductId ? <p className="text-xs text-slate-500">Catálogo: {item.catalogProductId}</p> : null}
            <p className="flex items-center gap-1.5 text-xs text-slate-500">
              <Clock className="h-3 w-3" />
              Criado em: {formatShortDateTime(item.dateCreated)}
            </p>
          </div>

          <div className="space-y-0.5 text-xs text-slate-600">
            {item.brand ? <p>Marca: <span className="font-semibold text-slate-800">{item.brand}</span></p> : null}
            {item.model ? <p>Modelo: <span className="font-semibold text-slate-800">{item.model}</span></p> : null}
            {item.sellerNickname ? (
              <a
                href={`https://www.mercadolivre.com.br/perfil/${item.sellerNickname}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-slate-600 transition-colors hover:text-blue-600 hover:underline"
              >
                <Store className="h-3 w-3" />
                {item.sellerNickname}
                {location ? ` (${location})` : ''}
              </a>
            ) : null}
            <div className="flex flex-wrap items-center gap-1.5">
              <Truck className="h-3 w-3" />
              {logisticTypeLabel || (item.freeShipping ? 'Frete grátis' : 'Frete normal')}
              {item.hasFlex ? <Badge className="h-4 border-violet-200 bg-violet-100 px-1.5 text-[9px] text-violet-700">Flex</Badge> : null}
              {hasFullShipping(item) ? <Badge className="h-4 border-blue-200 bg-blue-100 px-1.5 text-[9px] text-blue-700">Full</Badge> : null}
              {isOfficial ? <Badge className="h-4 border-emerald-200 bg-emerald-100 px-1.5 text-[9px] text-emerald-700">Loja oficial</Badge> : null}
            </div>
            {item.catalogProductId ? (
              <div className="flex items-center gap-1.5">
                <CompetitorsDialog
                  accountId={accountId}
                  catalogProductId={item.catalogProductId}
                  offerCount={item.offersCount}
                  productTitle={item.title}
                  days={cardVisitsWindow}
                />
              </div>
            ) : null}
          </div>

          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Dados do anúncio</span>
              {item.sourceType !== 'item' && item.referenceItemId && item.referenceItemId !== item.catalogProductId ? (
                <Badge variant="outline" className="h-5 border-slate-200 bg-white text-[10px] text-slate-600">
                  Ref. {item.referenceItemId}
                </Badge>
              ) : null}
            </div>
            <div className="grid gap-x-4 gap-y-1 text-xs text-slate-600 sm:grid-cols-2 lg:grid-cols-3">
              <ListingData label="Logística" value={logisticTypeLabel || '-'} />
              <ListingData label="Modo" value={shippingModeLabel || '-'} />
              <ListingData label="Frete grátis" value={item.freeShipping ? 'sim' : 'não'} />
              <ListingData label="Dimensões" value={item.shippingDimensions || '-'} />
              <ListingData label="Retirada local" value={item.shippingLocalPickUp ? 'sim' : 'não'} />
              <ListingData label="Retirada loja" value={item.shippingStorePickUp ? 'sim' : 'não'} />
              <ListingData label="Condição" value={formatLabel(item.condition)} />
              <ListingData label="Tipo" value={listingTypeLabel(item.listingTypeId)} />
              <ListingData label="Categoria" value={item.categoryInfo?.name || item.categoryId || '-'} />
              <ListingData label="Seller ID" value={item.sellerId ? String(item.sellerId) : '-'} />
              <ListingData label="MercadoPago" value={item.acceptsMercadoPago ? 'sim' : 'não'} />
              <ListingData label="Estoque" value={formatCount(item.availableQuantity)} />
            </div>
            {visibleShippingTags.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {visibleShippingTags.map((tag) => (
                  <Badge key={tag} variant="outline" className="h-5 border-slate-200 bg-white text-[10px] text-slate-500">
                    {formatLabel(tag)}
                  </Badge>
                ))}
              </div>
            ) : null}
          </div>

          {shippingOptions.length > 0 ? (
            <Accordion type="single" collapsible>
              <AccordionItem value="shipping-options" className="rounded-md border border-orange-200 bg-orange-50 px-3">
                <AccordionTrigger className="py-2 text-xs font-semibold text-orange-800 hover:no-underline">
                  <span className="flex items-center gap-1.5">
                    <Truck className="h-3.5 w-3.5" />
                    Opções de frete por CEP
                    {item.cheapestShipping ? <span className="font-normal text-orange-700">menor: {formatMoney(item.cheapestShipping.cost)}</span> : null}
                  </span>
                </AccordionTrigger>
                <AccordionContent className="pb-3">
                  <div className="space-y-1.5">
                    {shippingOptions.map((option) => (
                      <div key={option.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-orange-100 bg-white px-2 py-1.5 text-xs">
                        <span className="font-medium text-slate-700">{option.name}</span>
                        <span className="text-slate-600">
                          {formatMoney(option.cost)}
                          {option.estimatedDeliveryDays !== null ? <span className="ml-2 text-slate-400">{option.estimatedDeliveryDays} dia(s)</span> : null}
                        </span>
                      </div>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          ) : null}

          {catalogOffers.length > 0 ? (
            <Accordion type="single" collapsible>
              <AccordionItem value="catalog-offers" className="rounded-md border border-slate-200 bg-white px-3">
                <AccordionTrigger className="py-2 text-xs font-semibold text-slate-700 hover:no-underline">
                  <span className="flex items-center gap-1.5">
                    <Store className="h-3.5 w-3.5" />
                    Ofertas do catálogo ({item.marketplaceData.catalogOffers?.retrieved || catalogOffers.length} carregadas)
                  </span>
                </AccordionTrigger>
                <AccordionContent className="pb-3">
                  <div className="space-y-1.5">
                    {catalogOffers.slice(0, 6).map((rawOffer, index) => {
                      const offer = asDetailRecord(rawOffer);
                      const offerShipping = asDetailRecord(offer.shipping);
                      const offerId = getDetailString(offer, ['item_id', 'id']) || `oferta-${index + 1}`;
                      return (
                        <div key={offerId} className="grid gap-2 rounded border border-slate-100 bg-slate-50 px-2 py-1.5 text-xs sm:grid-cols-[minmax(0,1fr)_auto]">
                          <div className="min-w-0">
                            <p className="truncate font-medium text-slate-800">{offerId}</p>
                            <p className="text-slate-500">
                              Seller {getDetailString(offer, ['seller_id']) || '-'} - {listingTypeLabel(getDetailString(offer, ['listing_type_id']))}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="font-semibold text-slate-800">{formatMoney(getDetailNumber(offer, ['price']))}</p>
                            <p className="text-slate-500">{offerShipping.free_shipping === true ? 'frete grátis' : 'frete normal'}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          ) : null}

          <div className="flex flex-wrap items-center gap-3 pt-1 text-xs text-slate-500">
            {cardTotalVisits !== null ? (
              <div className="flex flex-wrap items-center gap-1.5">
                {cardVisitsLoading ? <Loader2 className="h-3 w-3 animate-spin text-blue-500" /> : <Eye className="h-3 w-3 text-blue-500" />}
                <span className="font-semibold text-slate-900">{formatCount(cardTotalVisits)}</span>
                <span>
                  {item.sourceType === 'catalog' ? 'visitas totais das ofertas listadas em' : 'visitas em'}{' '}
                  {visitsWindowLabel(cardVisitsWindow)}
                </span>
                {hasCatalog ? (
                  <VisitsWindowSelect
                    value={cardVisitsWindow}
                    onChange={updateCardVisitsWindow}
                    disabled={cardVisitsLoading}
                    triggerClassName="h-6 w-[118px] border-slate-200 bg-white px-2 text-[10px]"
                  />
                ) : null}
                {cardVisitsError ? <span className="text-[10px] text-red-500">{cardVisitsError}</span> : null}
              </div>
            ) : null}
            {item.ratingAverage !== null ? (
              <span className="flex items-center gap-1">
                <Star className="h-3 w-3 fill-yellow-400 text-yellow-500" />
                <span className="font-semibold text-slate-900">{item.ratingAverage.toFixed(1)}</span>
                {item.reviewsCount !== null ? <span>({formatCount(item.reviewsCount)})</span> : null}
              </span>
            ) : null}
            {item.questionsCount !== null && item.questionsCount > 0 ? (
              <span className="flex items-center gap-1">
                <MessageSquare className="h-3 w-3 text-purple-500" />
                <span className="font-semibold text-slate-900">{item.questionsCount}</span>
                perguntas
              </span>
            ) : null}
          </div>
        </div>

        <aside className="space-y-3 self-start">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="mb-2 text-[11px] font-semibold uppercase text-slate-500">Resumo comercial</div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              <CommercialSummaryMetric
                label="Clássico"
                value={formatMoney(item.classicPrice)}
                detail={item.classicFees ? `Frete ${formatMoney(getFeeShippingCost(item.classicFees))}` : 'Frete indisponível'}
                icon={Truck}
                tone={classicIsBuyBox ? 'amber' : getShippingMetricTone(item.classicFees)}
                isBuyBox={classicIsBuyBox}
              />
              <CommercialSummaryMetric
                label="Premium"
                value={formatMoney(item.premiumPrice)}
                detail={item.premiumFees ? `Frete ${formatMoney(getFeeShippingCost(item.premiumFees))}` : 'Frete indisponível'}
                icon={Truck}
                tone={premiumIsBuyBox ? 'amber' : getShippingMetricTone(item.premiumFees)}
                isBuyBox={premiumIsBuyBox}
              />
            </div>
            <div className="mt-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
              <div className="flex justify-between gap-3">
                <span>Buy Box</span>
                <span className="font-semibold text-slate-900">{formatMoney(item.buyBoxWinnerPrice ?? item.price)}</span>
              </div>
              <div className="mt-1 flex justify-between gap-3">
                <span>Ofertas</span>
                <span className="font-semibold text-slate-900">{formatCount(item.offersCount)}</span>
              </div>
              <div className="mt-1 flex justify-between gap-3">
                <span>Preço médio</span>
                <span className="font-semibold text-slate-900">{formatMoney(item.avgPrice)}</span>
              </div>
            </div>
          </div>

          {presence ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
              Já publicado em {presence.accounts.length} conta(s): {presence.accounts.map((account) => account.accountName || account.accountId).join(', ')}.
            </div>
          ) : null}

          <div className="flex flex-col gap-2">
            <Button variant="outline" size="sm" disabled title="Publicação avançada será conectada na próxima fase" className="w-full justify-center">
              <Store className="h-4 w-4" />
              Criar anúncio
            </Button>
            <Button variant="outline" size="sm" onClick={onDetails} className="w-full justify-center">
              <Info className="h-4 w-4" />
              Detalhes
            </Button>
            <Button variant="ghost" size="sm" onClick={onToggleSaved} disabled={isSaving} className="w-full justify-center">
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : isSaved ? <BookmarkCheck className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
              {isSaved ? 'Salvo' : 'Salvar'}
            </Button>
          </div>
        </aside>
      </div>

      <div className="border-t bg-slate-50/60 px-4 pb-4 pt-4">
        <div className="mb-3 text-[11px] font-semibold uppercase text-slate-500">Detalhamento de taxas</div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FeeSection label="Clássico" price={item.classicPrice} fee={item.classicFees} />
          <FeeSection label="Premium" price={item.premiumPrice} fee={item.premiumFees} />
        </div>
      </div>
    </Card>
  );
}

function ListingData({ label, value }: { label: string; value: string }) {
  return (
    <span>
      {label}: <b className="font-semibold text-slate-800">{value}</b>
    </span>
  );
}

function FeeSection({ label, price, fee }: { label: string; price: number | null; fee: MercadoLivreFeeDetails | null }) {
  const shippingSourceLabel = fee ? formatShippingSource(fee) : null;

  return (
    <div className="space-y-1 rounded-lg border border-slate-100 bg-slate-50 p-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-slate-700">
          {label}
          {fee ? <span className="ml-1.5 text-xs font-normal text-slate-500">({formatPercent(fee.saleFeePercentage)})</span> : null}
        </div>
        {price !== null ? <span className="text-sm font-bold text-slate-800">{formatMoney(price)}</span> : null}
      </div>
      {fee ? (
        <div className="space-y-0.5 pt-1 text-xs text-slate-600">
          <div className="flex items-center justify-between">
            <span>Comissão</span>
            <span className="font-semibold text-slate-800">{formatMoney(fee.saleFeeAmount)}</span>
          </div>
          {fee.fixedFee > 0 ? (
            <div className="flex items-center justify-between">
              <span>Taxa fixa</span>
              <span className="font-semibold text-slate-800">{formatMoney(fee.fixedFee)}</span>
            </div>
          ) : null}
          <div className="flex items-center justify-between">
            <span>Frete</span>
            <span className="font-semibold text-slate-800">
              {formatMoney(getFeeShippingCost(fee))}
              {shippingSourceLabel ? <span className="ml-1 text-[10px] font-normal text-slate-400">{shippingSourceLabel}</span> : null}
            </span>
          </div>
          <Separator className="my-2" />
          <div className="flex items-center justify-between font-semibold text-slate-900">
            <span>Líquido após taxas</span>
            <span>{formatMoney(fee.netAmountAfterShipping)}</span>
          </div>
        </div>
      ) : (
        <p className="pt-1 text-xs text-slate-400">Taxas não disponíveis</p>
      )}
    </div>
  );
}

function DetailsDialog({
  item,
  onOpenChange,
}: {
  item: MercadoLivreSearchItem | null;
  onOpenChange: (open: boolean) => void;
}) {
  const open = Boolean(item);
  const images = item ? getParentListingImages(item) : [];
  const features = item ? getParentListingFeatures(item) : [];
  const attributes = item ? getParentListingAttributes(item) : [];
  const description = item ? getParentListingDescription(item) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[86vh] max-w-5xl overflow-y-auto p-0">
        {item ? (
          <>
            <DialogHeader className="px-5 py-4">
              <DialogTitle>Detalhes do anúncio pai</DialogTitle>
              <DialogDescription className="line-clamp-2">{item.title}</DialogDescription>
            </DialogHeader>

            <div className="space-y-4 p-5">
              <ListingDetailsSection title="Imagens">
                {images.length > 0 ? (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                    {images.map((image) => (
                      <a
                        key={`${image.id}:${image.url}`}
                        href={image.url}
                        target="_blank"
                        rel="noreferrer"
                        className="group aspect-square overflow-hidden rounded-md border border-slate-200 bg-white"
                      >
                        <img src={image.url} alt={image.alt} className="h-full w-full object-contain p-2 transition-transform group-hover:scale-105" loading="lazy" />
                      </a>
                    ))}
                  </div>
                ) : (
                  <EmptyDetailsState>Nenhuma imagem retornada para este anúncio.</EmptyDetailsState>
                )}
              </ListingDetailsSection>

              <ListingDetailsSection title="Características">
                {features.length > 0 ? (
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {features.map((feature) => (
                      <ListingDetailField key={`${feature.id}:${feature.valueName}`} label={feature.name} value={feature.valueName} />
                    ))}
                  </div>
                ) : (
                  <EmptyDetailsState>Nenhuma característica destacada foi retornada.</EmptyDetailsState>
                )}
              </ListingDetailsSection>

              <ListingDetailsSection title="Atributos">
                {attributes.length > 0 ? (
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {attributes.map((attribute) => (
                      <ListingDetailField key={`${attribute.id}:${attribute.valueName}`} label={attribute.name} value={attribute.valueName} />
                    ))}
                  </div>
                ) : (
                  <EmptyDetailsState>Nenhum atributo foi retornado.</EmptyDetailsState>
                )}
              </ListingDetailsSection>

              <ListingDetailsSection title="Descrição">
                {description ? (
                  <div className="whitespace-pre-wrap rounded-md border border-slate-200 bg-white px-3 py-2 text-sm leading-relaxed text-slate-700">
                    {description}
                  </div>
                ) : (
                  <EmptyDetailsState>Nenhuma descrição foi retornada para este anúncio.</EmptyDetailsState>
                )}
              </ListingDetailsSection>

              <ListingDetailsSection title="Taxas estimadas">
                <div className="grid gap-3 md:grid-cols-2">
                  <FeeSection label="Clássico" price={item.classicPrice} fee={item.classicFees} />
                  <FeeSection label="Premium" price={item.premiumPrice} fee={item.premiumFees} />
                </div>
              </ListingDetailsSection>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ListingDetailsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <h4 className="mb-2 text-[11px] font-semibold uppercase text-slate-500">{title}</h4>
      {children}
    </section>
  );
}

function ListingDetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
      <div className="text-[10px] font-semibold uppercase text-slate-500">{label}</div>
      <div className="mt-1 break-words text-xs font-medium text-slate-800">{value}</div>
    </div>
  );
}

function EmptyDetailsState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-slate-200 bg-white px-3 py-6 text-center text-sm text-slate-500">
      {children}
    </div>
  );
}
