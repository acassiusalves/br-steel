'use client';

import * as React from 'react';
import {
  AlertTriangle,
  Activity,
  Boxes,
  CheckCircle2,
  Eye,
  ExternalLink,
  FileText,
  Gauge,
  Info,
  Layers,
  ListChecks,
  Loader2,
  MoreHorizontal,
  PackageSearch,
  PauseCircle,
  Pencil,
  PlayCircle,
  RefreshCw,
  Save,
  Search,
  ShoppingBag,
  ShieldAlert,
  Store,
  Tag,
  XCircle,
} from 'lucide-react';

import DashboardLayout from '@/components/dashboard-layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import {
  getMercadoLivreListingDetails,
  getMercadoLivreListings,
  listMlAccounts,
  syncMercadoLivreListings,
  updateMercadoLivreListingAttributes,
  updateMercadoLivreListingDescription,
  updateMercadoLivreListingPrice,
  updateMercadoLivreListingStatus,
  updateMercadoLivreListingStock,
  updateMercadoLivreListingTitle,
} from '@/app/actions';
import type {
  MlListingAttributePatch,
  MlListingAttributeValue,
  MlListingEditableStatus,
  MlListingDetails,
  MlListingsAnalysisFilter,
  MlListingCacheRow,
  MlListingGroup,
  MlListingsGroupBy,
  MlListingsListResult,
  MlListingsViewMode,
} from '@/services/ml-listings-cache';
import { cn, parsePriceToNumber } from '@/lib/utils';

type StatusTab = 'all' | 'active' | 'paused' | 'closed' | 'problems';
type CatalogFilter = 'all' | 'catalog' | 'list';
type ListingTypeFilter = 'all' | 'gold_special' | 'gold_pro' | 'free';
type AnalysisFilter = MlListingsAnalysisFilter;
type MlAccountSummary = Awaited<ReturnType<typeof listMlAccounts>>[number];
type ListingEditMode = 'price' | 'stock' | 'status';
type ListingEditState = {
  mode: ListingEditMode;
  row: MlListingCacheRow;
  nextStatus?: MlListingEditableStatus;
} | null;
type DetailSaveMode = 'title' | 'description' | 'attributes' | null;

const PAGE_SIZE = 25;

const emptyResult: MlListingsListResult = {
  listings: [],
  groups: [],
  paging: { total: 0, offset: 0, limit: PAGE_SIZE },
  statusSummary: {
    total: 0,
    active: 0,
    paused: 0,
    closed: 0,
    problems: 0,
  },
  summary: {
    total: 0,
    active: 0,
    paused: 0,
    closed: 0,
    problems: 0,
    totalStock: 0,
    totalSold: 0,
    visitsLast30Days: 0,
    withVisitsLast30Days: 0,
    withoutVisitsLast30Days: 0,
    lowQuality: 0,
    lowConversion: 0,
    priceAutomationActive: 0,
    specialLogistics: 0,
    averageQualityScore: null,
    conversionRate30Days: null,
    gmvEstimated: 0,
    averagePrice: null,
  },
  syncState: null,
};

function formatMoney(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

function formatNumber(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '0';
  return new Intl.NumberFormat('pt-BR').format(value);
}

function formatPercent(value: number | null | undefined, decimals = 1) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  return `${value.toFixed(decimals).replace('.', ',')}%`;
}

function formatDate(value: string | null | undefined) {
  if (!value) return 'Nunca sincronizado';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Data indisponivel';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function statusLabel(status: string | null | undefined) {
  if (status === 'active') return 'Ativo';
  if (status === 'paused') return 'Pausado';
  if (status === 'closed') return 'Fechado';
  if (status === 'under_review') return 'Em revisao';
  if (status === 'inactive') return 'Inativo';
  return status || '-';
}

function listingTypeLabel(value: string | null | undefined) {
  if (value === 'gold_pro') return 'Premium';
  if (value === 'gold_special') return 'Classico';
  if (value === 'free') return 'Gratis';
  return value || '-';
}

function qualityScore(row: MlListingCacheRow) {
  if (typeof row.performanceScore === 'number') return row.performanceScore;
  if (typeof row.health === 'number') return row.health <= 1 ? Math.round(row.health * 100) : Math.round(row.health);
  return null;
}

function qualityLabel(score: number | null) {
  if (score === null) return 'Sem dados';
  if (score >= 80) return 'Profissional';
  if (score >= 60) return 'Satisfatoria';
  return 'Basica';
}

function performanceLevelLabel(level: string | null | undefined) {
  if (level === 'good') return 'Boa';
  if (level === 'medium') return 'Media';
  if (level === 'poor') return 'Basica';
  return level || null;
}

function conversionRate(row: MlListingCacheRow) {
  const visits = row.visitsLast30Days ?? 0;
  const sold = row.soldQuantity ?? 0;
  if (visits <= 0) return null;
  return (sold / visits) * 100;
}

function isSpecialLogisticsListing(row: MlListingCacheRow) {
  const tags = new Set([...(row.tags || []), ...(row.shippingTags || [])]);
  return row.logisticType === 'fulfillment' || row.logisticType === 'self_service' || tags.has('fulfillment') || tags.has('self_service');
}

function problemCount(row: MlListingCacheRow) {
  let count = 0;
  if (row.status === 'paused') count += 1;
  if (row.availableQuantity === 0) count += 1;
  if (typeof row.health === 'number' && row.health < 0.5) count += 1;
  if (qualityScore(row) !== null && qualityScore(row)! < 60) count += 1;
  if ((row.performancePendingGoals ?? 0) > 0) count += 1;
  if ((row.visitsLast30Days ?? 0) >= 20 && (row.soldQuantity ?? 0) === 0) count += 1;
  if (!row.sellerSku) count += 1;
  if (row.subStatus.length > 0) count += 1;
  return count;
}

const priorityAttributeIds = new Set([
  'GTIN',
  'UPC',
  'EAN',
  'ISBN',
  'BRAND',
  'MODEL',
  'PART_NUMBER',
  'MPN',
  'SELLER_SKU',
  'LINE',
  'MATERIAL',
  'WIDTH',
  'HEIGHT',
  'LENGTH',
  'WEIGHT',
]);

function attributeTypeLabel(valueType: string | null | undefined) {
  if (valueType === 'string') return 'Texto';
  if (valueType === 'number') return 'Numero';
  if (valueType === 'number_unit') return 'Numero com unidade';
  if (valueType === 'list') return 'Lista';
  if (valueType === 'boolean') return 'Sim/nao';
  return valueType || 'Indefinido';
}

function attributeSortRank(attribute: MlListingAttributeValue) {
  if (priorityAttributeIds.has(attribute.id)) return 0;
  if (attribute.required) return 1;
  if (attribute.current) return 2;
  if (attribute.editable) return 3;
  return 4;
}

function buildAttributeRows(details: MlListingDetails | null): MlListingAttributeValue[] {
  if (!details) return [];
  const rowsById = new Map(details.attributes.map((attribute) => [attribute.id, attribute]));

  for (const definition of details.categoryAttributes) {
    if (rowsById.has(definition.id) || (!definition.editable && !definition.required)) continue;
    rowsById.set(definition.id, {
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
    });
  }

  return Array.from(rowsById.values()).sort((a, b) => {
    const rankDiff = attributeSortRank(a) - attributeSortRank(b);
    if (rankDiff !== 0) return rankDiff;
    return (a.name || a.id).localeCompare(b.name || b.id, 'pt-BR');
  });
}

function attributeMatchesSearch(attribute: MlListingAttributeValue, search: string) {
  if (!search) return true;
  const normalized = search.toLowerCase();
  return [
    attribute.id,
    attribute.name,
    attribute.valueName,
    attribute.attributeGroupName,
    attribute.valueType,
  ]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(normalized));
}

function ProductThumb({ row }: { row: Pick<MlListingCacheRow, 'thumbnail' | 'title' | 'itemId'> }) {
  return (
    <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-background">
      {row.thumbnail ? (
        <img src={row.thumbnail} alt={row.title || row.itemId} className="h-full w-full object-contain" />
      ) : (
        <PackageSearch className="h-5 w-5 text-muted-foreground" />
      )}
    </div>
  );
}

function KpiCard({
  title,
  value,
  hint,
  icon: Icon,
  tone,
}: {
  title: string;
  value: string;
  hint?: string;
  icon: React.ElementType;
  tone?: 'danger' | 'ok';
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className={cn('h-4 w-4 text-muted-foreground', tone === 'danger' && 'text-destructive', tone === 'ok' && 'text-emerald-600')} />
      </CardHeader>
      <CardContent>
        <div className={cn('text-2xl font-bold', tone === 'danger' && 'text-destructive')}>{value}</div>
        {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

function ListingBadges({ row }: { row: MlListingCacheRow }) {
  const problems = problemCount(row);
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {row.accountName ? <Badge variant="outline" className="gap-1"><Store className="h-3 w-3" />{row.accountName}</Badge> : null}
      {row.sellerSku ? <Badge variant="secondary">SKU {row.sellerSku}</Badge> : <Badge variant="destructive">Sem SKU</Badge>}
      {row.catalogProductId || row.catalogListing ? <Badge variant="outline" className="gap-1"><Layers className="h-3 w-3" />Catalogo</Badge> : null}
      {row.listingTypeId ? <Badge variant="outline">{listingTypeLabel(row.listingTypeId)}</Badge> : null}
      {row.freeShipping ? <Badge variant="outline">Frete gratis</Badge> : null}
      {row.priceAutomationActive ? <Badge variant="outline" className="gap-1"><ShieldAlert className="h-3 w-3" />Auto preco</Badge> : null}
      {isSpecialLogisticsListing(row) ? <Badge variant="outline">Full/Flex</Badge> : null}
      {problems > 0 ? <Badge variant="destructive" className="gap-1"><AlertTriangle className="h-3 w-3" />{problems} alerta(s)</Badge> : null}
    </div>
  );
}

function ListingActionMenu({
  row,
  disabled,
  onEdit,
  onDetails,
}: {
  row: MlListingCacheRow;
  disabled: boolean;
  onEdit: (edit: NonNullable<ListingEditState>) => void;
  onDetails: (row: MlListingCacheRow) => void;
}) {
  const nextStatus: MlListingEditableStatus | null =
    row.status === 'active' ? 'paused' : row.status === 'paused' ? 'active' : null;
  const priceBlocked = row.priceAutomationActive === true;
  const stockBlocked = isSpecialLogisticsListing(row);

  return (
    <div className="flex justify-end gap-1">
      {row.permalink ? (
        <Button asChild size="icon" variant="ghost" title="Abrir no Mercado Livre">
          <a href={row.permalink} target="_blank" rel="noreferrer">
            <ExternalLink className="h-4 w-4" />
          </a>
        </Button>
      ) : null}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button size="icon" variant="ghost" title="Acoes do anuncio" disabled={disabled}>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuLabel>Acoes</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => onDetails(row)} disabled={disabled}>
            <Info className="mr-2 h-4 w-4" />
            Ver detalhes
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => onEdit({ mode: 'price', row })} disabled={disabled || row.status === 'closed' || priceBlocked}>
            <Pencil className="mr-2 h-4 w-4" />
            Editar preco
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onEdit({ mode: 'stock', row })} disabled={disabled || row.status === 'closed' || stockBlocked}>
            <Boxes className="mr-2 h-4 w-4" />
            Editar estoque
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => nextStatus && onEdit({ mode: 'status', row, nextStatus })}
            disabled={disabled || !nextStatus}
          >
            {nextStatus === 'active' ? <PlayCircle className="mr-2 h-4 w-4" /> : <PauseCircle className="mr-2 h-4 w-4" />}
            {nextStatus === 'active' ? 'Ativar anuncio' : 'Pausar anuncio'}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => onEdit({ mode: 'status', row, nextStatus: 'closed' })}
            disabled={disabled || row.status === 'closed'}
            className="text-destructive focus:text-destructive"
          >
            <XCircle className="mr-2 h-4 w-4" />
            Encerrar anuncio
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function ListingEditDialog({
  edit,
  isSaving,
  onOpenChange,
  onSubmit,
}: {
  edit: ListingEditState;
  isSaving: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: {
    edit: NonNullable<ListingEditState>;
    value?: number;
  }) => Promise<void>;
}) {
  const [value, setValue] = React.useState('');

  React.useEffect(() => {
    if (!edit) {
      setValue('');
      return;
    }
    if (edit.mode === 'price') {
      setValue(edit.row.price !== null ? String(edit.row.price) : '');
      return;
    }
    if (edit.mode === 'stock') {
      setValue(edit.row.availableQuantity !== null ? String(edit.row.availableQuantity) : '0');
      return;
    }
    setValue('');
  }, [edit]);

  if (!edit) return null;

  const isPrice = edit.mode === 'price';
  const isStock = edit.mode === 'stock';
  const isStatus = edit.mode === 'status';
  const title = isPrice
    ? 'Editar preco'
    : isStock
      ? 'Editar estoque'
      : edit.nextStatus === 'active'
        ? 'Ativar anuncio'
        : edit.nextStatus === 'closed'
          ? 'Encerrar anuncio'
          : 'Pausar anuncio';
  const priceBlocked = isPrice && edit.row.priceAutomationActive === true;
  const stockBlocked = isStock && isSpecialLogisticsListing(edit.row);
  const submitDisabled = isSaving || priceBlocked || stockBlocked;

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isStatus) {
      await onSubmit({ edit });
      return;
    }
    const parsed = isPrice ? parsePriceToNumber(value) : Number(value);
    await onSubmit({ edit, value: parsed });
  };

  return (
    <Dialog open={Boolean(edit)} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              Esta acao altera diretamente o anuncio {edit.row.itemId} no Mercado Livre e registra auditoria no sistema.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-md border bg-muted/30 p-3 text-sm">
            <div className="font-medium leading-snug">{edit.row.title || edit.row.itemId}</div>
            <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
              {edit.row.sellerSku ? <span>SKU {edit.row.sellerSku}</span> : null}
              <span>Status atual: {statusLabel(edit.row.status)}</span>
              <span>Vendidos: {formatNumber(edit.row.soldQuantity)}</span>
            </div>
          </div>

          {isPrice ? (
            <div className="space-y-2">
              <label htmlFor="ml-listing-price" className="text-sm font-medium">Novo preco</label>
              <Input
                id="ml-listing-price"
                value={value}
                onChange={(event) => setValue(event.target.value)}
                inputMode="decimal"
                placeholder="Ex: 199,90"
                disabled={isSaving}
              />
              <p className="text-xs text-muted-foreground">Preco atual: {formatMoney(edit.row.price)}</p>
              {priceBlocked ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  Este anuncio possui automacao de preco ativa no Mercado Livre. A API bloqueia edicao direta de preco.
                </div>
              ) : null}
            </div>
          ) : null}

          {isStock ? (
            <div className="space-y-2">
              <label htmlFor="ml-listing-stock" className="text-sm font-medium">Novo estoque disponivel</label>
              <Input
                id="ml-listing-stock"
                value={value}
                onChange={(event) => setValue(event.target.value)}
                inputMode="numeric"
                type="number"
                min={0}
                step={1}
                disabled={isSaving}
              />
              <p className="text-xs text-muted-foreground">Estoque atual: {formatNumber(edit.row.availableQuantity)}</p>
              {stockBlocked ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  Este anuncio usa logistica Full/Flex e exige o fluxo especifico de estoque do Mercado Livre.
                </div>
              ) : null}
            </div>
          ) : null}

          {isStatus ? (
            <div className={cn(
              'rounded-md border p-3 text-sm',
              edit.nextStatus === 'closed'
                ? 'border-destructive/30 bg-destructive/10 text-destructive'
                : 'border-amber-200 bg-amber-50 text-amber-900',
            )}>
              O status sera alterado de {statusLabel(edit.row.status)} para {statusLabel(edit.nextStatus)}.
              {edit.nextStatus === 'closed' ? ' Um anuncio encerrado nao pode ser reativado diretamente; normalmente precisa ser republicado.' : null}
            </div>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
              Cancelar
            </Button>
            <Button type="submit" disabled={submitDisabled}>
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {isSaving ? 'Salvando...' : 'Salvar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PriceCell({ row }: { row: MlListingCacheRow }) {
  const displayPrice = row.salePriceAmount ?? row.price;
  return (
    <div className="space-y-1 text-right">
      <div className="font-medium">{formatMoney(displayPrice)}</div>
      {row.hasPromotion && row.regularAmount ? (
        <div className="text-xs text-muted-foreground line-through">{formatMoney(row.regularAmount)}</div>
      ) : null}
      {row.priceAutomationActive ? (
        <Badge variant="outline" className="text-[10px]">auto</Badge>
      ) : null}
    </div>
  );
}

function QualityCell({ row }: { row: MlListingCacheRow }) {
  const score = qualityScore(row);
  const pending = row.performancePendingGoals ?? 0;
  const label = row.performanceLevelWording || performanceLevelLabel(row.performanceLevel) || qualityLabel(score);

  if (score === null) {
    return <div className="text-right text-muted-foreground">-</div>;
  }

  return (
    <div className="ml-auto w-28 space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="truncate text-muted-foreground">{label}</span>
        <span className="font-medium">{Math.round(score)}%</span>
      </div>
      <Progress value={Math.max(0, Math.min(100, score))} className="h-1.5" />
      {pending > 0 ? (
        <div className="text-right text-[10px] text-amber-700">{pending} pend.</div>
      ) : null}
    </div>
  );
}

function ConversionCell({ row }: { row: MlListingCacheRow }) {
  const conversion = conversionRate(row);
  const visits = row.visitsLast30Days ?? 0;
  return (
    <div className="space-y-1 text-right">
      <div className="font-medium">{conversion === null ? '-' : formatPercent(conversion)}</div>
      <div className="text-xs text-muted-foreground">{formatNumber(visits)} visitas</div>
    </div>
  );
}

function DetailMetric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
      {hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

function ListingDetailSheet({
  row,
  details,
  isLoading,
  isSaving,
  onOpenChange,
  onSaveTitle,
  onSaveDescription,
  onSaveAttributes,
}: {
  row: MlListingCacheRow | null;
  details: MlListingDetails | null;
  isLoading: boolean;
  isSaving: DetailSaveMode;
  onOpenChange: (open: boolean) => void;
  onSaveTitle: (title: string) => Promise<void>;
  onSaveDescription: (plainText: string) => Promise<void>;
  onSaveAttributes: (attributes: MlListingAttributePatch[]) => Promise<void>;
}) {
  const current = details?.listing || row;
  const [titleValue, setTitleValue] = React.useState('');
  const [descriptionValue, setDescriptionValue] = React.useState('');
  const [attributeValues, setAttributeValues] = React.useState<Record<string, string>>({});
  const [attributeSearch, setAttributeSearch] = React.useState('');
  const attributeRows = React.useMemo(() => buildAttributeRows(details), [details]);

  React.useEffect(() => {
    setTitleValue(current?.title || '');
  }, [current?.id, current?.title]);

  React.useEffect(() => {
    setDescriptionValue(details?.description?.plainText || '');
  }, [details?.listing.id, details?.description?.plainText]);

  React.useEffect(() => {
    const nextValues: Record<string, string> = {};
    for (const attribute of attributeRows) {
      nextValues[attribute.id] = attribute.valueName || '';
    }
    setAttributeValues(nextValues);
    setAttributeSearch('');
  }, [attributeRows]);

  if (!current) return null;

  const score = qualityScore(current);
  const conversion = conversionRate(current);
  const canEditTitle = (current.soldQuantity ?? 0) === 0 && current.status !== 'closed';
  const canEditDescription = current.status !== 'closed';
  const pendingActions = current.performanceActions || [];
  const titleChanged = titleValue.trim() !== (current.title || '').trim();
  const descriptionChanged = descriptionValue.trim() !== (details?.description?.plainText || '').trim();
  const canEditAttributes = current.status !== 'closed';
  const changedAttributes = attributeRows
    .filter((attribute) => attribute.editable)
    .map((attribute) => ({
      id: attribute.id,
      valueName: (attributeValues[attribute.id] || '').trim(),
      previousValue: (attribute.valueName || '').trim(),
    }))
    .filter((attribute) => attribute.valueName && attribute.valueName !== attribute.previousValue)
    .map(({ id, valueName }) => ({ id, valueName }));
  const filteredAttributeRows = attributeRows.filter((attribute) => attributeMatchesSearch(attribute, attributeSearch.trim()));

  return (
    <Sheet open={Boolean(row)} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <div className="border-b p-6">
          <SheetHeader className="space-y-3 pr-8">
            <div className="flex items-start gap-3">
              <ProductThumb row={current} />
              <div className="min-w-0">
                <SheetTitle className="line-clamp-2 text-base leading-snug">
                  {current.title || current.itemId}
                </SheetTitle>
                <SheetDescription>
                  <span className="font-mono">{current.itemId}</span>
                  {current.sellerSku ? <span> · SKU {current.sellerSku}</span> : null}
                </SheetDescription>
                <ListingBadges row={current} />
              </div>
            </div>
          </SheetHeader>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          {isLoading ? (
            <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Carregando detalhes...
            </div>
          ) : (
            <Tabs defaultValue="resumo" className="space-y-4">
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="resumo" className="gap-2">
                  <Gauge className="h-4 w-4" />
                  Resumo
                </TabsTrigger>
                <TabsTrigger value="saude" className="gap-2">
                  <ListChecks className="h-4 w-4" />
                  Saude
                </TabsTrigger>
                <TabsTrigger value="conteudo" className="gap-2">
                  <FileText className="h-4 w-4" />
                  Conteudo
                </TabsTrigger>
                <TabsTrigger value="ficha" className="gap-2">
                  <Tag className="h-4 w-4" />
                  Ficha
                </TabsTrigger>
              </TabsList>

              <TabsContent value="resumo" className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <DetailMetric label="Preco de venda" value={formatMoney(current.salePriceAmount ?? current.price)} hint={current.hasPromotion ? `De ${formatMoney(current.regularAmount)}` : undefined} />
                  <DetailMetric label="Estoque ML" value={formatNumber(current.availableQuantity)} hint={isSpecialLogisticsListing(current) ? 'Full/Flex' : current.logisticType || undefined} />
                  <DetailMetric label="Vendidos" value={formatNumber(current.soldQuantity)} />
                  <DetailMetric label="Visitas 30d" value={formatNumber(current.visitsLast30Days)} hint={`${formatNumber(current.visitsTotal)} visitas totais`} />
                  <DetailMetric label="Conversao est." value={formatPercent(conversion)} />
                  <DetailMetric label="Qualidade" value={formatPercent(score, 0)} hint={current.performanceLevelWording || performanceLevelLabel(current.performanceLevel) || undefined} />
                </div>

                <Separator />

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2 rounded-md border p-3">
                    <div className="text-sm font-medium">Preco e automacao</div>
                    <div className="text-sm text-muted-foreground">
                      Preco padrao: <span className="font-medium text-foreground">{formatMoney(current.standardPrice ?? current.price)}</span>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      Automacao: <span className="font-medium text-foreground">{current.priceAutomationActive ? 'ativa' : 'inativa'}</span>
                    </div>
                    {current.priceAutomationActive ? (
                      <div className="text-sm text-muted-foreground">
                        Regra: <span className="font-medium text-foreground">{current.priceAutomationRuleId || '-'}</span>
                      </div>
                    ) : null}
                  </div>

                  <div className="space-y-2 rounded-md border p-3">
                    <div className="text-sm font-medium">Publicacao</div>
                    <div className="text-sm text-muted-foreground">
                      Status: <span className="font-medium text-foreground">{statusLabel(current.status)}</span>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      Tipo: <span className="font-medium text-foreground">{listingTypeLabel(current.listingTypeId)}</span>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      Atualizado: <span className="font-medium text-foreground">{formatDate(current.lastUpdated)}</span>
                    </div>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="saude" className="space-y-4">
                <div className="rounded-md border p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium">Qualidade do anuncio</div>
                      <div className="text-xs text-muted-foreground">
                        Calculado em {formatDate(current.performanceCalculatedAt)}
                      </div>
                    </div>
                    <div className="text-xl font-semibold">{formatPercent(score, 0)}</div>
                  </div>
                  <Progress value={score ?? 0} className="h-2" />
                  <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                    <div className="text-muted-foreground">
                      Concluidos: <span className="font-medium text-foreground">{formatNumber(current.performanceCompletedGoals)}</span>
                    </div>
                    <div className="text-muted-foreground">
                      Pendentes: <span className="font-medium text-foreground">{formatNumber(current.performancePendingGoals)}</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="text-sm font-medium">Acoes recomendadas</div>
                  {pendingActions.length === 0 ? (
                    <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
                      Nenhuma acao pendente retornada pelo Mercado Livre para este anuncio.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {pendingActions.map((action, index) => (
                        <div key={`${action.key || action.title || 'acao'}-${index}`} className="rounded-md border p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="text-sm font-medium">{action.title || action.key || 'Acao pendente'}</div>
                              <div className="mt-1 text-xs text-muted-foreground">
                                {action.key ? <span>{action.key}</span> : null}
                                {action.mode ? <span> · {action.mode}</span> : null}
                                {action.status ? <span> · {action.status}</span> : null}
                              </div>
                            </div>
                            {typeof action.score === 'number' ? <Badge variant="outline">{formatPercent(action.score, 0)}</Badge> : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="conteudo" className="space-y-5">
                <div className="space-y-3 rounded-md border p-4">
                  <div>
                    <div className="text-sm font-medium">Titulo</div>
                    <div className="text-xs text-muted-foreground">
                      O Mercado Livre permite alterar titulo apenas quando o anuncio nao possui vendas.
                    </div>
                  </div>
                  <Input
                    value={titleValue}
                    onChange={(event) => setTitleValue(event.target.value)}
                    maxLength={120}
                    disabled={!canEditTitle || isSaving === 'title'}
                  />
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs text-muted-foreground">
                      {canEditTitle ? `${titleValue.length}/120 caracteres` : 'Bloqueado porque o anuncio possui vendas ou esta encerrado.'}
                    </div>
                    <Button
                      size="sm"
                      onClick={() => onSaveTitle(titleValue)}
                      disabled={!canEditTitle || !titleChanged || isSaving !== null}
                      className="gap-2"
                    >
                      {isSaving === 'title' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      Salvar titulo
                    </Button>
                  </div>
                </div>

                <div className="space-y-3 rounded-md border p-4">
                  <div>
                    <div className="text-sm font-medium">Descricao</div>
                    <div className="text-xs text-muted-foreground">
                      Texto simples conforme regra do Mercado Livre; quebras de linha sao aceitas.
                    </div>
                  </div>
                  <Textarea
                    value={descriptionValue}
                    onChange={(event) => setDescriptionValue(event.target.value)}
                    disabled={!canEditDescription || isSaving === 'description'}
                    className="min-h-[260px] font-mono text-sm"
                    placeholder="Descricao do anuncio..."
                  />
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs text-muted-foreground">
                      {descriptionValue.length} caracteres
                    </div>
                    <Button
                      size="sm"
                      onClick={() => onSaveDescription(descriptionValue)}
                      disabled={!canEditDescription || !descriptionChanged || isSaving !== null}
                      className="gap-2"
                    >
                      {isSaving === 'description' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      Salvar descricao
                    </Button>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="ficha" className="space-y-4">
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  A ficha tecnica altera atributos individuais do anuncio. Nesta versao o sistema adiciona ou atualiza campos de texto, numero e numero com unidade; remocao e campos de lista ficam bloqueados.
                </div>

                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">{formatNumber(attributeRows.length)} atributos</Badge>
                    <Badge variant="outline">{formatNumber(attributeRows.filter((attribute) => attribute.current).length)} preenchidos</Badge>
                    <Badge variant="outline">{formatNumber(attributeRows.filter((attribute) => attribute.required).length)} obrigatorios</Badge>
                  </div>
                  <Input
                    value={attributeSearch}
                    onChange={(event) => setAttributeSearch(event.target.value)}
                    placeholder="Buscar atributo..."
                    className="sm:w-64"
                  />
                </div>

                {filteredAttributeRows.length === 0 ? (
                  <div className="rounded-md border p-6 text-center text-sm text-muted-foreground">
                    Nenhum atributo encontrado para este filtro.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {filteredAttributeRows.map((attribute) => {
                      const disabled = !canEditAttributes || !attribute.editable || isSaving === 'attributes';
                      return (
                        <div key={attribute.id} className="space-y-3 rounded-md border p-3">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <div className="text-sm font-medium">{attribute.name || attribute.id}</div>
                                {attribute.required ? <Badge variant="destructive">Obrigatorio</Badge> : null}
                                {attribute.current ? <Badge variant="secondary">Preenchido</Badge> : null}
                                {!attribute.editable ? <Badge variant="outline">Bloqueado</Badge> : null}
                              </div>
                              <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                                <span className="font-mono">{attribute.id}</span>
                                <span>{attributeTypeLabel(attribute.valueType)}</span>
                                {attribute.attributeGroupName ? <span>{attribute.attributeGroupName}</span> : null}
                              </div>
                            </div>
                            {priorityAttributeIds.has(attribute.id) ? <Badge variant="outline">Prioritario</Badge> : null}
                          </div>

                          <Input
                            value={attributeValues[attribute.id] || ''}
                            onChange={(event) => {
                              const value = event.target.value;
                              setAttributeValues((currentValues) => ({
                                ...currentValues,
                                [attribute.id]: value,
                              }));
                            }}
                            disabled={disabled}
                            maxLength={255}
                            placeholder={attribute.editable ? 'Informe o valor' : 'Campo nao editavel'}
                          />

                          {!canEditAttributes ? (
                            <div className="text-xs text-muted-foreground">
                              Anuncio encerrado nao permite alteracao de ficha tecnica.
                            </div>
                          ) : !attribute.editable ? (
                            <div className="text-xs text-muted-foreground">
                              Campo bloqueado para edicao direta pela API ou ainda nao suportado por este formulario.
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="sticky bottom-0 -mx-6 border-t bg-background/95 px-6 py-4 backdrop-blur">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-xs text-muted-foreground">
                      {changedAttributes.length > 0
                        ? `${formatNumber(changedAttributes.length)} atributo(s) alterado(s)`
                        : 'Nenhuma alteracao pendente'}
                    </div>
                    <Button
                      size="sm"
                      onClick={() => onSaveAttributes(changedAttributes)}
                      disabled={!canEditAttributes || changedAttributes.length === 0 || isSaving !== null}
                      className="gap-2"
                    >
                      {isSaving === 'attributes' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      Salvar ficha tecnica
                    </Button>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ListingTable({
  rows,
  isLoading,
  onEdit,
  onDetails,
  mutatingListingId,
}: {
  rows: MlListingCacheRow[];
  isLoading: boolean;
  onEdit: (edit: NonNullable<ListingEditState>) => void;
  onDetails: (row: MlListingCacheRow) => void;
  mutatingListingId: string | null;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="min-w-[420px]">Anuncio</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Preco</TableHead>
          <TableHead className="text-right">Estoque</TableHead>
          <TableHead className="text-right">Vendidos</TableHead>
          <TableHead className="text-right">Conversao</TableHead>
          <TableHead className="text-right">Qualidade</TableHead>
          <TableHead className="text-right">Acoes</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {isLoading ? (
          <TableRow>
            <TableCell colSpan={8} className="h-28 text-center text-muted-foreground">
              <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
              Carregando anuncios...
            </TableCell>
          </TableRow>
        ) : rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={8} className="h-28 text-center text-muted-foreground">
              Nenhum anuncio encontrado com os filtros atuais.
            </TableCell>
          </TableRow>
        ) : (
          rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell>
                <div className="flex gap-3">
                  <ProductThumb row={row} />
                  <div className="min-w-0">
                    <div className="line-clamp-2 font-medium leading-snug">{row.title || row.itemId}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      <span className="font-mono">{row.itemId}</span>
                      {row.categoryId ? <span> · {row.categoryId}</span> : null}
                    </div>
                    <ListingBadges row={row} />
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <Badge
                  variant={row.status === 'active' ? 'default' : row.status === 'paused' ? 'secondary' : 'outline'}
                  className={cn(row.status === 'active' && 'bg-emerald-600 hover:bg-emerald-600')}
                >
                  {statusLabel(row.status)}
                </Badge>
              </TableCell>
              <TableCell className="text-right"><PriceCell row={row} /></TableCell>
              <TableCell className="text-right">{formatNumber(row.availableQuantity)}</TableCell>
              <TableCell className="text-right">{formatNumber(row.soldQuantity)}</TableCell>
              <TableCell className="text-right"><ConversionCell row={row} /></TableCell>
              <TableCell className="text-right"><QualityCell row={row} /></TableCell>
              <TableCell className="text-right">
                <ListingActionMenu
                  row={row}
                  disabled={mutatingListingId === row.id}
                  onEdit={onEdit}
                  onDetails={onDetails}
                />
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}

function GroupedList({
  groups,
  isLoading,
  onEdit,
  onDetails,
  mutatingListingId,
}: {
  groups: MlListingGroup[];
  isLoading: boolean;
  onEdit: (edit: NonNullable<ListingEditState>) => void;
  onDetails: (row: MlListingCacheRow) => void;
  mutatingListingId: string | null;
}) {
  if (isLoading) {
    return (
      <div className="flex h-28 items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Carregando grupos...
      </div>
    );
  }

  if (groups.length === 0) {
    return <div className="flex h-28 items-center justify-center text-sm text-muted-foreground">Nenhum grupo encontrado.</div>;
  }

  return (
    <div className="divide-y">
      {groups.map((group) => (
        <details key={group.groupKey} className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-4 hover:bg-muted/50">
            <div className="flex min-w-0 items-center gap-3">
              <div className="relative">
                <ProductThumb row={{ thumbnail: group.thumbnail, title: group.title, itemId: group.groupKey }} />
                <span className="absolute -bottom-1 -right-1 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
                  {group.totalListings}
                </span>
              </div>
              <div className="min-w-0">
                <div className="truncate font-semibold">{group.title}</div>
                <div className="mt-1 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                  {group.sellerSku ? <span>SKU {group.sellerSku}</span> : null}
                  {group.catalogProductId ? <span>Catalogo {group.catalogProductId}</span> : null}
                  <span>{group.accountNames.join(', ')}</span>
                  {group.hasProblems ? <span className="text-destructive">Com alertas</span> : null}
                </div>
              </div>
            </div>
            <div className="grid min-w-[560px] grid-cols-5 gap-4 text-right text-sm">
              <div>
                <div className="font-medium">{formatMoney(group.priceMin)} - {formatMoney(group.priceMax)}</div>
                <div className="text-xs text-muted-foreground">faixa de preco</div>
              </div>
              <div>
                <div className="font-medium">{formatNumber(group.totalStock)}</div>
                <div className="text-xs text-muted-foreground">estoque ML</div>
              </div>
              <div>
                <div className="font-medium">{formatNumber(group.totalSold)}</div>
                <div className="text-xs text-muted-foreground">vendidos</div>
              </div>
              <div>
                <div className="font-medium">{formatNumber(group.totalVisitsLast30Days)}</div>
                <div className="text-xs text-muted-foreground">visitas 30d</div>
              </div>
              <div>
                <div className="font-medium">{formatPercent(group.averageQualityScore, 0)}</div>
                <div className="text-xs text-muted-foreground">{group.lowConversionListings} baixa conv.</div>
              </div>
            </div>
          </summary>
          <div className="border-t bg-muted/20">
            <ListingTable
              rows={group.listings}
              isLoading={false}
              onEdit={onEdit}
              onDetails={onDetails}
              mutatingListingId={mutatingListingId}
            />
          </div>
        </details>
      ))}
    </div>
  );
}

export default function AnunciosMercadoLivreClient() {
  const { toast } = useToast();
  const [accounts, setAccounts] = React.useState<MlAccountSummary[]>([]);
  const [selectedAccountId, setSelectedAccountId] = React.useState<string>('all');
  const [statusTab, setStatusTab] = React.useState<StatusTab>('all');
  const [viewMode, setViewMode] = React.useState<MlListingsViewMode>('list');
  const [groupBy, setGroupBy] = React.useState<MlListingsGroupBy>('sku');
  const [catalogMode, setCatalogMode] = React.useState<CatalogFilter>('all');
  const [listingType, setListingType] = React.useState<ListingTypeFilter>('all');
  const [analysisFilter, setAnalysisFilter] = React.useState<AnalysisFilter>('all');
  const [searchInput, setSearchInput] = React.useState('');
  const [searchQuery, setSearchQuery] = React.useState('');
  const [offset, setOffset] = React.useState(0);
  const [data, setData] = React.useState<MlListingsListResult>(emptyResult);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSyncing, setIsSyncing] = React.useState(false);
  const [editState, setEditState] = React.useState<ListingEditState>(null);
  const [mutatingListingId, setMutatingListingId] = React.useState<string | null>(null);
  const [detailRow, setDetailRow] = React.useState<MlListingCacheRow | null>(null);
  const [details, setDetails] = React.useState<MlListingDetails | null>(null);
  const [isDetailsLoading, setIsDetailsLoading] = React.useState(false);
  const [detailSaving, setDetailSaving] = React.useState<DetailSaveMode>(null);

  React.useEffect(() => {
    const handle = window.setTimeout(() => {
      setOffset(0);
      setSearchQuery(searchInput.trim());
    }, 350);
    return () => window.clearTimeout(handle);
  }, [searchInput]);

  React.useEffect(() => {
    let cancelled = false;
    listMlAccounts()
      .then((result) => {
        if (!cancelled) setAccounts(result);
      })
      .catch((error) => {
        toast({
          title: 'Erro ao carregar contas ML',
          description: error instanceof Error ? error.message : 'Nao foi possivel listar contas.',
          variant: 'destructive',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [toast]);

  const loadData = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const status = statusTab === 'all' || statusTab === 'problems' ? [] : [statusTab];
      const result = await getMercadoLivreListings({
        accountId: selectedAccountId === 'all' ? null : selectedAccountId,
        status,
        listingType: listingType === 'all' ? [] : [listingType],
        catalogMode: catalogMode === 'all' ? null : catalogMode,
        search: searchQuery,
        problemsOnly: statusTab === 'problems',
        analysisFilter,
        offset,
        limit: PAGE_SIZE,
        viewMode,
        groupBy,
      });
      setData(result);
    } catch (error) {
      toast({
        title: 'Erro ao carregar anuncios',
        description: error instanceof Error ? error.message : 'Tente novamente.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  }, [analysisFilter, catalogMode, groupBy, listingType, offset, searchQuery, selectedAccountId, statusTab, toast, viewMode]);

  React.useEffect(() => {
    loadData();
  }, [loadData]);

  const loadDetails = React.useCallback(async (row: MlListingCacheRow) => {
    setIsDetailsLoading(true);
    try {
      const result = await getMercadoLivreListingDetails({
        accountId: row.accountId,
        itemId: row.itemId,
      });
      setDetails(result);
      setDetailRow(result.listing);
    } catch (error) {
      toast({
        title: 'Erro ao carregar detalhes',
        description: error instanceof Error ? error.message : 'Nao foi possivel carregar o anuncio.',
        variant: 'destructive',
      });
    } finally {
      setIsDetailsLoading(false);
    }
  }, [toast]);

  const handleOpenDetails = React.useCallback((row: MlListingCacheRow) => {
    setDetailRow(row);
    setDetails(null);
    void loadDetails(row);
  }, [loadDetails]);

  const handleSync = React.useCallback(async () => {
    setIsSyncing(true);
    try {
      const targetAccounts =
        selectedAccountId !== 'all'
          ? [selectedAccountId]
          : accounts.length > 0
            ? accounts.map((account) => account.accountId)
            : [null];

      let synced = 0;
      let metrics = 0;
      let metricFailures = 0;
      for (const accountId of targetAccounts) {
        const report = await syncMercadoLivreListings(accountId);
        synced += report.totalSynced;
        metrics += report.analyticsSynced;
        metricFailures += report.analyticsFailed;
      }

      toast({
        title: 'Anuncios sincronizados',
        description: `${formatNumber(synced)} anuncio(s), ${formatNumber(metrics)} metrica(s) atualizadas${metricFailures ? `, ${formatNumber(metricFailures)} falha(s)` : ''}.`,
      });
      setOffset(0);
      await loadData();
    } catch (error) {
      toast({
        title: 'Erro na sincronizacao',
        description: error instanceof Error ? error.message : 'Nao foi possivel sincronizar os anuncios.',
        variant: 'destructive',
      });
    } finally {
      setIsSyncing(false);
    }
  }, [accounts, loadData, selectedAccountId, toast]);

  const handleSubmitEdit = React.useCallback(async ({
    edit,
    value,
  }: {
    edit: NonNullable<ListingEditState>;
    value?: number;
  }) => {
    setMutatingListingId(edit.row.id);
    try {
      if (edit.mode === 'price') {
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          throw new Error('Informe um preco valido.');
        }
        await updateMercadoLivreListingPrice({
          accountId: edit.row.accountId,
          itemId: edit.row.itemId,
          price: value,
        });
      } else if (edit.mode === 'stock') {
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          throw new Error('Informe um estoque valido.');
        }
        await updateMercadoLivreListingStock({
          accountId: edit.row.accountId,
          itemId: edit.row.itemId,
          availableQuantity: value,
        });
      } else if (edit.nextStatus) {
        await updateMercadoLivreListingStatus({
          accountId: edit.row.accountId,
          itemId: edit.row.itemId,
          status: edit.nextStatus,
        });
      }

      toast({
        title: 'Anuncio atualizado',
        description: `${edit.row.itemId} foi atualizado no Mercado Livre.`,
      });
      setEditState(null);
      await loadData();
    } catch (error) {
      toast({
        title: 'Erro ao atualizar anuncio',
        description: error instanceof Error ? error.message : 'Nao foi possivel alterar o anuncio.',
        variant: 'destructive',
      });
    } finally {
      setMutatingListingId(null);
    }
  }, [loadData, toast]);

  const handleSaveTitle = React.useCallback(async (title: string) => {
    if (!detailRow) return;
    setDetailSaving('title');
    try {
      const result = await updateMercadoLivreListingTitle({
        accountId: detailRow.accountId,
        itemId: detailRow.itemId,
        title,
      });
      setDetailRow(result.listing);
      setDetails((current) => current ? { ...current, listing: result.listing } : current);
      toast({
        title: 'Titulo atualizado',
        description: `${result.listing.itemId} foi atualizado no Mercado Livre.`,
      });
      await loadData();
    } catch (error) {
      toast({
        title: 'Erro ao atualizar titulo',
        description: error instanceof Error ? error.message : 'Nao foi possivel alterar o titulo.',
        variant: 'destructive',
      });
    } finally {
      setDetailSaving(null);
    }
  }, [detailRow, loadData, toast]);

  const handleSaveDescription = React.useCallback(async (plainText: string) => {
    if (!detailRow) return;
    setDetailSaving('description');
    try {
      await updateMercadoLivreListingDescription({
        accountId: detailRow.accountId,
        itemId: detailRow.itemId,
        plainText,
      });
      await loadDetails(detailRow);
      toast({
        title: 'Descricao atualizada',
        description: `${detailRow.itemId} foi atualizado no Mercado Livre.`,
      });
    } catch (error) {
      toast({
        title: 'Erro ao atualizar descricao',
        description: error instanceof Error ? error.message : 'Nao foi possivel alterar a descricao.',
        variant: 'destructive',
      });
    } finally {
      setDetailSaving(null);
    }
  }, [detailRow, loadDetails, toast]);

  const handleSaveAttributes = React.useCallback(async (attributes: MlListingAttributePatch[]) => {
    if (!detailRow || attributes.length === 0) return;
    setDetailSaving('attributes');
    try {
      const result = await updateMercadoLivreListingAttributes({
        accountId: detailRow.accountId,
        itemId: detailRow.itemId,
        attributes,
      });
      setDetailRow(result.listing);
      setDetails((current) => current ? { ...current, listing: result.listing } : current);
      await loadDetails(result.listing);
      await loadData();
      toast({
        title: 'Ficha tecnica atualizada',
        description: `${result.listing.itemId} foi atualizado no Mercado Livre.`,
      });
    } catch (error) {
      toast({
        title: 'Erro ao atualizar ficha tecnica',
        description: error instanceof Error ? error.message : 'Nao foi possivel alterar os atributos.',
        variant: 'destructive',
      });
    } finally {
      setDetailSaving(null);
    }
  }, [detailRow, loadData, loadDetails, toast]);

  const totalPages = Math.max(1, Math.ceil(data.paging.total / PAGE_SIZE));
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <DashboardLayout>
      <div className="flex-1 space-y-6 p-4 pt-6 md:p-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-yellow-400 text-sm font-bold text-black">
                ML
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight">Anuncios Mercado Livre</h1>
                <p className="text-sm text-muted-foreground">
                  Catalogo · Mercado Livre · {accounts.length} {accounts.length === 1 ? 'conta conectada' : 'contas conectadas'}
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <Select
              value={selectedAccountId}
              onValueChange={(value) => {
                setSelectedAccountId(value);
                setOffset(0);
              }}
            >
              <SelectTrigger className="w-full sm:w-[240px]">
                <SelectValue placeholder="Todas as contas" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as contas</SelectItem>
                {accounts.map((account) => (
                  <SelectItem key={account.accountId} value={account.accountId}>
                    {account.nickname || account.accountName || account.accountId}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={handleSync} disabled={isSyncing} className="gap-2">
              {isSyncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {isSyncing ? 'Sincronizando...' : 'Sincronizar'}
            </Button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8">
          <KpiCard title="Anuncios ativos" value={formatNumber(data.summary.active)} icon={CheckCircle2} tone="ok" />
          <KpiCard title="Visitas 30d" value={formatNumber(data.summary.visitsLast30Days)} hint={`${formatNumber(data.summary.withVisitsLast30Days)} com visitas`} icon={Eye} />
          <KpiCard title="Conversao est." value={formatPercent(data.summary.conversionRate30Days)} hint="vendidos historicos / visitas 30d" icon={Activity} />
          <KpiCard title="Qualidade media" value={formatPercent(data.summary.averageQualityScore, 0)} hint={`${formatNumber(data.summary.lowQuality)} abaixo de 60%`} icon={Gauge} tone={data.summary.lowQuality > 0 ? 'danger' : undefined} />
          <KpiCard title="Preco medio" value={formatMoney(data.summary.averagePrice)} icon={Tag} />
          <KpiCard title="Estoque ML" value={formatNumber(data.summary.totalStock)} hint="unidades informadas no ML" icon={Boxes} />
          <KpiCard title="Vendidos" value={formatNumber(data.summary.totalSold)} icon={ShoppingBag} />
          <KpiCard title="Alertas" value={formatNumber(data.summary.problems)} hint={`${formatNumber(data.summary.lowConversion)} baixa conversao`} icon={AlertTriangle} tone={data.summary.problems > 0 ? 'danger' : undefined} />
        </div>

        <Card>
          <CardHeader className="space-y-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <Tabs
                value={statusTab}
                onValueChange={(value) => {
                  setStatusTab(value as StatusTab);
                  setOffset(0);
                }}
              >
                <TabsList className="flex h-auto flex-wrap justify-start">
                  <TabsTrigger value="all">Todos {formatNumber(data.statusSummary.total)}</TabsTrigger>
                  <TabsTrigger value="active">Ativos {formatNumber(data.statusSummary.active)}</TabsTrigger>
                  <TabsTrigger value="paused">Pausados {formatNumber(data.statusSummary.paused)}</TabsTrigger>
                  <TabsTrigger value="closed">Fechados {formatNumber(data.statusSummary.closed)}</TabsTrigger>
                  <TabsTrigger value="problems">Problemas {formatNumber(data.statusSummary.problems)}</TabsTrigger>
                </TabsList>
              </Tabs>
              <div className="text-sm text-muted-foreground">
                Ultima sync: <span className="font-medium text-foreground">{formatDate(data.syncState?.lastSyncedAt)}</span>
                {data.syncState ? (
                  <span> · metricas {formatNumber(data.syncState.analyticsSynced)}</span>
                ) : null}
              </div>
            </div>

            <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
              <div className="relative min-w-[260px] flex-1">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  placeholder="Buscar titulo, SKU, MLB, catalogo..."
                  className="pl-9"
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <Tabs
                  value={viewMode}
                  onValueChange={(value) => {
                    setViewMode(value as MlListingsViewMode);
                    setOffset(0);
                  }}
                >
                  <TabsList>
                    <TabsTrigger value="list">Lista</TabsTrigger>
                    <TabsTrigger value="grouped">Agrupado</TabsTrigger>
                  </TabsList>
                </Tabs>

                {viewMode === 'grouped' ? (
                  <Select
                    value={groupBy}
                    onValueChange={(value) => {
                      setGroupBy(value as MlListingsGroupBy);
                      setOffset(0);
                    }}
                  >
                    <SelectTrigger className="w-[150px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="sku">Por SKU</SelectItem>
                      <SelectItem value="catalog">Por catalogo</SelectItem>
                    </SelectContent>
                  </Select>
                ) : null}

                <Select
                  value={listingType}
                  onValueChange={(value) => {
                    setListingType(value as ListingTypeFilter);
                    setOffset(0);
                  }}
                >
                  <SelectTrigger className="w-[150px]">
                    <SelectValue placeholder="Tipo" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos tipos</SelectItem>
                    <SelectItem value="gold_special">Classico</SelectItem>
                    <SelectItem value="gold_pro">Premium</SelectItem>
                    <SelectItem value="free">Gratis</SelectItem>
                  </SelectContent>
                </Select>

                <Select
                  value={analysisFilter}
                  onValueChange={(value) => {
                    setAnalysisFilter(value as AnalysisFilter);
                    setOffset(0);
                  }}
                >
                  <SelectTrigger className="w-[190px]">
                    <SelectValue placeholder="Analise" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas metricas</SelectItem>
                    <SelectItem value="with_visits">Com visitas 30d</SelectItem>
                    <SelectItem value="without_visits">Sem visitas 30d</SelectItem>
                    <SelectItem value="low_conversion">Baixa conversao</SelectItem>
                    <SelectItem value="low_quality">Baixa qualidade</SelectItem>
                    <SelectItem value="price_automation">Auto preco</SelectItem>
                    <SelectItem value="special_logistics">Full/Flex</SelectItem>
                  </SelectContent>
                </Select>

                <Select
                  value={catalogMode}
                  onValueChange={(value) => {
                    setCatalogMode(value as CatalogFilter);
                    setOffset(0);
                  }}
                >
                  <SelectTrigger className="w-[170px]">
                    <SelectValue placeholder="Catalogo" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Catalogo e lista</SelectItem>
                    <SelectItem value="catalog">So catalogo</SelectItem>
                    <SelectItem value="list">So anuncio proprio</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>

          <CardContent>
            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-base">
                  {formatNumber(data.paging.total)} {viewMode === 'grouped' ? 'grupo(s)' : 'anuncio(s)'}
                </CardTitle>
                <CardDescription>
                  Conta: {selectedAccountId === 'all' ? 'Todas' : accounts.find((a) => a.accountId === selectedAccountId)?.nickname || selectedAccountId}
                </CardDescription>
              </div>
              {data.summary.total === 0 && !isLoading ? (
                <Button variant="outline" onClick={handleSync} disabled={isSyncing} className="gap-2">
                  {isSyncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  Buscar anuncios agora
                </Button>
              ) : null}
            </div>

            <div className="overflow-hidden rounded-md border">
              {viewMode === 'grouped' ? (
                <GroupedList
                  groups={data.groups}
                  isLoading={isLoading}
                  onEdit={setEditState}
                  onDetails={handleOpenDetails}
                  mutatingListingId={mutatingListingId}
                />
              ) : (
                <ListingTable
                  rows={data.listings}
                  isLoading={isLoading}
                  onEdit={setEditState}
                  onDetails={handleOpenDetails}
                  mutatingListingId={mutatingListingId}
                />
              )}
            </div>

            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-muted-foreground">
                Pagina <span className="font-medium text-foreground">{currentPage}</span> de{' '}
                <span className="font-medium text-foreground">{totalPages}</span>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  disabled={offset === 0 || isLoading}
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                >
                  Anterior
                </Button>
                <Button
                  variant="outline"
                  disabled={currentPage >= totalPages || isLoading}
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                >
                  Proxima
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
      <ListingEditDialog
        edit={editState}
        isSaving={Boolean(mutatingListingId)}
        onOpenChange={(open) => {
          if (!open && !mutatingListingId) setEditState(null);
        }}
        onSubmit={handleSubmitEdit}
      />
      <ListingDetailSheet
        row={detailRow}
        details={details}
        isLoading={isDetailsLoading}
        isSaving={detailSaving}
        onOpenChange={(open) => {
          if (!open && !detailSaving) {
            setDetailRow(null);
            setDetails(null);
          }
        }}
        onSaveTitle={handleSaveTitle}
        onSaveDescription={handleSaveDescription}
        onSaveAttributes={handleSaveAttributes}
      />
    </DashboardLayout>
  );
}
