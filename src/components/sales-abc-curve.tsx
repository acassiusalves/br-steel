'use client';

import * as React from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  type TooltipProps,
  XAxis,
  YAxis,
} from 'recharts';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import {
  endOfDay,
  endOfMonth,
  format,
  parseISO,
  startOfDay,
  startOfMonth,
  subDays,
  subMonths,
} from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { DateRange } from 'react-day-picker';
import {
  Calendar as CalendarIcon,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ChevronUp,
  DollarSign,
  FileDown,
  Layers,
  Loader2,
  Package,
  Search,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import * as XLSX from 'xlsx';

import { db } from '@/lib/firebase';
import { cn } from '@/lib/utils';
import {
  computeAbc,
  type AbcClass,
  type AbcMetric,
  type SkuGroupLookup,
} from '@/lib/abc-analysis';
import type { SaleOrder } from '@/types/sale-order';
import {
  loadProductGroupIndex,
  type ProductGroup,
} from '@/services/product-groups-service';
import {
  suggestProductGroupsChunkAction,
  commitProductGroupsAction,
} from '@/app/abc-actions';
import { MAX_PRODUCTS_PER_CHUNK } from '@/lib/abc-constants';
import type { GroupProductsOutput } from '@/ai/flows/group-products';
import AbcGroupReviewModal, {
  type ApprovedGroup,
  type ReviewSkuInfo,
} from '@/components/abc-group-review-modal';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';

// ---------- Formatters ----------
const formatCurrency = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);

const formatPercent = (value: number, fractionDigits = 2) =>
  `${(value * 100).toFixed(fractionDigits)}%`;

const formatInteger = (value: number) =>
  new Intl.NumberFormat('pt-BR').format(value || 0);

// ---------- Stat card ----------
const StatCard = ({
  title,
  primary,
  secondary,
  icon: Icon,
  isLoading,
  accent,
}: {
  title: string;
  primary: string;
  secondary?: string;
  icon: React.ElementType;
  isLoading: boolean;
  accent?: string;
}) => (
  <Card>
    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
      <CardTitle className="text-sm font-medium">{title}</CardTitle>
      <Icon className={cn('h-4 w-4 text-muted-foreground', accent)} />
    </CardHeader>
    <CardContent>
      {isLoading ? (
        <>
          <Skeleton className="mb-2 h-8 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </>
      ) : (
        <>
          <div className="text-2xl font-bold">{primary}</div>
          {secondary ? (
            <p className="text-xs text-muted-foreground">{secondary}</p>
          ) : null}
        </>
      )}
    </CardContent>
  </Card>
);

// ---------- Class badge ----------
const classStyles: Record<AbcClass, string> = {
  A: 'bg-emerald-100 text-emerald-800 border-emerald-200 hover:bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-200 dark:border-emerald-900',
  B: 'bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100 dark:bg-amber-900/30 dark:text-amber-200 dark:border-amber-900',
  C: 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-100 dark:bg-slate-800/60 dark:text-slate-300 dark:border-slate-700',
};

const ClassBadge = ({ value }: { value: AbcClass }) => (
  <Badge variant="outline" className={cn('font-bold', classStyles[value])}>
    {value}
  </Badge>
);

// ---------- Chart tooltip ----------
const ChartTooltip = ({ active, payload }: TooltipProps<number, string>) => {
  if (!active || !payload?.length) return null;
  const data = payload[0]?.payload as {
    sku: string;
    name: string;
    revenue: number;
    cumulativeShare: number;
    class: AbcClass;
  };
  if (!data) return null;
  return (
    <div className="rounded-md border bg-background p-2 text-xs shadow-lg">
      <p className="mb-1 font-bold">
        {data.sku} <span className="text-muted-foreground">({data.class})</span>
      </p>
      <p className="max-w-xs truncate text-muted-foreground">{data.name}</p>
      <p>Faturamento: {formatCurrency(data.revenue)}</p>
      <p>% Acumulado: {formatPercent(data.cumulativeShare)}</p>
    </div>
  );
};

// ---------- Main component ----------
type MetricOption = { value: AbcMetric; label: string };
const METRIC_OPTIONS: MetricOption[] = [
  { value: 'revenue', label: 'Faturamento' },
  { value: 'quantity', label: 'Quantidade vendida' },
  { value: 'orderCount', label: 'Nº de pedidos' },
];

const CHART_TOP_N = 30;
const PAGE_SIZES = [10, 20, 30, 50, 100];

const isCancelled = (order: SaleOrder) =>
  (order?.situacao?.nome || '').toLowerCase().includes('cancelado');

export default function SalesAbcCurve() {
  const { toast } = useToast();

  const [allSales, setAllSales] = React.useState<SaleOrder[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [metric, setMetric] = React.useState<AbcMetric>('revenue');
  const [searchTerm, setSearchTerm] = React.useState('');
  const [currentPage, setCurrentPage] = React.useState(1);
  const [rowsPerPage, setRowsPerPage] = React.useState(20);

  // AI grouping state
  const [groupingEnabled, setGroupingEnabled] = React.useState(true);
  const [productGroups, setProductGroups] = React.useState<ProductGroup[]>([]);
  const [skuToGroup, setSkuToGroup] = React.useState<SkuGroupLookup>(new Map());
  const [isGroupingSaving, setIsGroupingSaving] = React.useState(false);
  const [isSuggesting, setIsSuggesting] = React.useState(false);
  const [suggestProgress, setSuggestProgress] = React.useState<{
    done: number;
    total: number;
  } | null>(null);
  const [suggestions, setSuggestions] = React.useState<
    GroupProductsOutput['groups']
  >([]);
  const [reviewSkuInfo, setReviewSkuInfo] = React.useState<
    Map<string, ReviewSkuInfo>
  >(new Map());
  const [reviewOpen, setReviewOpen] = React.useState(false);
  const [expandedGroupRows, setExpandedGroupRows] = React.useState<
    Set<string>
  >(new Set());

  const [date, setDate] = React.useState<DateRange | undefined>(() => {
    const today = new Date();
    return { from: startOfMonth(today), to: endOfMonth(today) };
  });

  // Load existing product groups from Firestore on mount
  const refreshGroups = React.useCallback(async () => {
    try {
      const { groups, skuToGroup: map } = await loadProductGroupIndex();
      setProductGroups(groups);
      setSkuToGroup(map);
    } catch (err) {
      console.error('Erro ao carregar productGroups:', err);
    }
  }, []);

  React.useEffect(() => {
    refreshGroups();
  }, [refreshGroups]);

  // Firestore subscription — mirrors sales-list-page.tsx:125-154
  React.useEffect(() => {
    setIsLoading(true);
    const ordersCollection = collection(db, 'salesOrders');
    const q = query(ordersCollection, orderBy('data', 'desc'));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const sales: SaleOrder[] = [];
        snapshot.forEach((doc) => sales.push(doc.data() as SaleOrder));
        setAllSales(sales);
        setIsLoading(false);
      },
      (error) => {
        console.error('Erro ao buscar pedidos do Firestore:', error);
        setIsLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  // Filter orders by date and drop cancelled ones
  const filteredOrders = React.useMemo(() => {
    if (!allSales.length) return [] as SaleOrder[];
    const from = date?.from ? startOfDay(date.from) : undefined;
    const to = date?.to ? endOfDay(date.to) : undefined;

    return allSales.filter((sale) => {
      if (isCancelled(sale)) return false;
      if (!sale?.data) return false;
      try {
        const saleDate = parseISO(sale.data);
        if (from && saleDate < from) return false;
        if (to && saleDate > to) return false;
        return true;
      } catch {
        return false;
      }
    });
  }, [allSales, date]);

  // Aggregate + classify (with or without AI grouping)
  const { rows, summary } = React.useMemo(
    () =>
      computeAbc(filteredOrders, {
        metric,
        skuGroups: groupingEnabled ? skuToGroup : undefined,
      }),
    [filteredOrders, metric, groupingEnabled, skuToGroup]
  );

  // Search within the resulting rows
  const searchedRows = React.useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter(
      (row) =>
        row.sku.toLowerCase().includes(term) || row.name.toLowerCase().includes(term)
    );
  }, [rows, searchTerm]);

  // Reset pagination whenever the derived list shrinks/grows
  React.useEffect(() => {
    setCurrentPage(1);
  }, [searchedRows.length, metric, rowsPerPage]);

  const totalPages = Math.max(1, Math.ceil(searchedRows.length / rowsPerPage));
  const paginatedRows = searchedRows.slice(
    (currentPage - 1) * rowsPerPage,
    currentPage * rowsPerPage
  );

  // Top N for the Pareto chart (always from the full ranked list, not search)
  const chartData = React.useMemo(
    () =>
      rows.slice(0, CHART_TOP_N).map((row) => ({
        sku: row.sku,
        name: row.name,
        revenue: row.revenue,
        cumulativeSharePct: Number((row.cumulativeShare * 100).toFixed(2)),
        cumulativeShare: row.cumulativeShare,
        class: row.class,
      })),
    [rows]
  );

  // --- AI grouping handlers -------------------------------------------------

  /**
   * Collects every distinct SKU in the current period that is NOT already
   * assigned to a product group, along with one representative description
   * and the aggregated revenue. Used both as Gemini input and as the info
   * map the review modal renders.
   */
  const collectUnmappedSkus = React.useCallback(() => {
    const info = new Map<string, ReviewSkuInfo>();
    for (const order of filteredOrders) {
      if (!order?.itens?.length) continue;
      for (const item of order.itens) {
        const sku = String(item.codigo ?? '').trim();
        if (!sku) continue;
        if (skuToGroup.has(sku)) continue;
        const qty = Number(item.quantidade) || 0;
        const unit = Number(item.valor) || 0;
        const discount = Number(item.desconto) || 0;
        const revenue = Math.max(0, qty * unit - discount);
        const existing = info.get(sku);
        if (existing) {
          existing.revenue += revenue;
        } else {
          info.set(sku, {
            sku,
            description: item.descricao || sku,
            revenue,
          });
        }
      }
    }
    return info;
  }, [filteredOrders, skuToGroup]);

  const handleSuggestGroups = async () => {
    const info = collectUnmappedSkus();
    if (info.size < 2) {
      toast({
        title: 'Nada para agrupar',
        description:
          info.size === 0
            ? 'Todos os SKUs do período já estão mapeados.'
            : 'É preciso ter ao menos 2 SKUs ainda não mapeados.',
      });
      return;
    }

    // Sort unmapped products by revenue desc, so each chunk has a coherent
    // set of products and the biggest revenue is processed first.
    const products = Array.from(info.values())
      .sort((a, b) => b.revenue - a.revenue)
      .map((p) => ({ sku: p.sku, description: p.description }));

    // Split into chunks — each chunk becomes one short-lived server action
    // call, so we never blow the Next.js request timeout on a huge period.
    const chunks: (typeof products)[] = [];
    for (let i = 0; i < products.length; i += MAX_PRODUCTS_PER_CHUNK) {
      chunks.push(products.slice(i, i + MAX_PRODUCTS_PER_CHUNK));
    }

    setIsSuggesting(true);
    setSuggestProgress({ done: 0, total: chunks.length });

    const allGroups: GroupProductsOutput['groups'] = [];
    const seenSkus = new Set<string>();
    const failures: number[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      // Chunks of 1 product can't produce a group; skip.
      if (chunk.length < 2) {
        setSuggestProgress({ done: i + 1, total: chunks.length });
        continue;
      }
      try {
        const result = await suggestProductGroupsChunkAction({ products: chunk });
        // Dedupe SKUs across chunks: the first chunk that claims a SKU keeps it.
        for (const g of result.groups) {
          const kept = g.skus.filter((s) => !seenSkus.has(s));
          if (kept.length >= 2) {
            kept.forEach((s) => seenSkus.add(s));
            allGroups.push({ ...g, skus: kept });
          }
        }
      } catch (err) {
        console.error(`[abc] chunk ${i + 1}/${chunks.length} failed:`, err);
        failures.push(i + 1);
      }
      setSuggestProgress({ done: i + 1, total: chunks.length });
    }

    setIsSuggesting(false);
    setSuggestProgress(null);

    if (failures.length === chunks.length) {
      toast({
        variant: 'destructive',
        title: 'Erro ao consultar o Gemini',
        description:
          'Todos os lotes falharam. Verifique a chave GOOGLE_GENAI_API_KEY e tente novamente.',
      });
      return;
    }

    if (failures.length > 0) {
      toast({
        variant: 'destructive',
        title: `${failures.length} de ${chunks.length} lotes falharam`,
        description: 'Os demais resultados estão prontos para revisão.',
      });
    }

    setSuggestions(allGroups);
    setReviewSkuInfo(info);
    setReviewOpen(true);

    if (allGroups.length === 0 && failures.length === 0) {
      toast({
        title: 'Nenhum agrupamento encontrado',
        description:
          'O Gemini analisou os produtos mas não encontrou grupos com confiança suficiente.',
      });
    }
  };

  const handleConfirmGroups = async (approved: ApprovedGroup[]) => {
    if (!approved.length) return;
    setIsGroupingSaving(true);
    try {
      const { savedCount } = await commitProductGroupsAction(
        approved.map((g) => ({
          canonicalName: g.canonicalName,
          skus: g.skus,
          reason: g.reason,
          createdBy: 'ai' as const,
        }))
      );
      await refreshGroups();
      setReviewOpen(false);
      setGroupingEnabled(true);
      toast({
        title: 'Grupos salvos',
        description: `${savedCount} grupo${savedCount === 1 ? '' : 's'} aplicado${
          savedCount === 1 ? '' : 's'
        } à Curva ABC.`,
      });
    } catch (err) {
      console.error(err);
      toast({
        variant: 'destructive',
        title: 'Erro ao salvar',
        description:
          err instanceof Error ? err.message : 'Falha ao gravar os grupos no Firestore.',
      });
    } finally {
      setIsGroupingSaving(false);
    }
  };

  const toggleGroupExpansion = (key: string) => {
    setExpandedGroupRows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // XLSX export — mirrors sales-list-page.tsx:212-262
  const handleExport = () => {
    if (!rows.length) {
      toast({
        variant: 'destructive',
        title: 'Nada para exportar',
        description: 'Nenhum produto no período selecionado.',
      });
      return;
    }

    const headers = [
      '#',
      'SKU / Grupo',
      'Produto',
      'Qtd SKUs',
      'SKUs originais',
      'Quantidade',
      'Nº Pedidos',
      'Faturamento (R$)',
      '% Participação',
      '% Acumulado',
      'Classe',
    ];

    const dataToExport = rows.map((row) => ({
      '#': row.rank,
      'SKU / Grupo': row.isGroup ? `[GRUPO] ${row.name}` : row.sku,
      Produto: row.name,
      'Qtd SKUs': row.skus.length,
      'SKUs originais': row.skus.join(' | '),
      Quantidade: row.quantity,
      'Nº Pedidos': row.orderCount,
      'Faturamento (R$)': Number(row.revenue.toFixed(2)),
      '% Participação': Number((row.share * 100).toFixed(2)),
      '% Acumulado': Number((row.cumulativeShare * 100).toFixed(2)),
      Classe: row.class,
    }));

    const worksheet = XLSX.utils.json_to_sheet(dataToExport, { header: headers });
    const cols = headers.map((h) => ({
      wch:
        Math.max(
          ...dataToExport.map((d) => String(d[h as keyof typeof d] ?? '').length),
          h.length
        ) + 2,
    }));
    worksheet['!cols'] = cols;

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Curva ABC');

    const fromStr = date?.from ? format(date.from, 'yyyy-MM-dd') : 'inicio';
    const toStr = date?.to ? format(date.to, 'yyyy-MM-dd') : 'fim';
    const filename = `curva-abc-brsteel-${fromStr}-a-${toStr}.xlsx`;
    XLSX.writeFile(workbook, filename);

    toast({
      title: 'Exportação concluída',
      description: `${rows.length} produtos exportados para ${filename}.`,
    });
  };

  const setDatePreset = (
    preset:
      | 'today'
      | 'yesterday'
      | 'last7'
      | 'last30'
      | 'last3Months'
      | 'thisMonth'
      | 'lastMonth'
  ) => {
    const today = new Date();
    switch (preset) {
      case 'today':
        setDate({ from: today, to: today });
        break;
      case 'yesterday': {
        const y = subDays(today, 1);
        setDate({ from: y, to: y });
        break;
      }
      case 'last7':
        setDate({ from: subDays(today, 6), to: today });
        break;
      case 'last30':
        setDate({ from: subDays(today, 29), to: today });
        break;
      case 'last3Months':
        setDate({ from: subMonths(today, 3), to: today });
        break;
      case 'thisMonth':
        setDate({ from: startOfMonth(today), to: endOfMonth(today) });
        break;
      case 'lastMonth': {
        const start = startOfMonth(subMonths(today, 1));
        const end = endOfMonth(subMonths(today, 1));
        setDate({ from: start, to: end });
        break;
      }
    }
  };

  const metricColumnLabel =
    METRIC_OPTIONS.find((m) => m.value === metric)?.label ?? 'Faturamento';

  const renderMainMetric = (row: (typeof rows)[number]) => {
    if (metric === 'quantity') return formatInteger(row.quantity);
    if (metric === 'orderCount') return formatInteger(row.orderCount);
    return formatCurrency(row.revenue);
  };

  return (
    <>
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Curva ABC de Produtos</h2>
          <p className="text-muted-foreground">
            Classifica produtos por participação acumulada no faturamento (Pareto).
            Pedidos cancelados são ignorados.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={metric} onValueChange={(v) => setMetric(v as AbcMetric)}>
            <SelectTrigger className="w-full sm:w-[220px]">
              <SelectValue placeholder="Métrica" />
            </SelectTrigger>
            <SelectContent>
              {METRIC_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  Métrica: {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Popover>
            <PopoverTrigger asChild>
              <Button
                id="abc-date"
                variant="outline"
                className={cn(
                  'w-full justify-start text-left font-normal sm:w-[260px]',
                  !date && 'text-muted-foreground'
                )}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {date?.from ? (
                  date.to ? (
                    <>
                      {format(date.from, 'dd/MM/yy')} - {format(date.to, 'dd/MM/yy')}
                    </>
                  ) : (
                    format(date.from, 'dd/MM/yy')
                  )
                ) : (
                  <span>Escolha um período</span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="flex w-auto p-0" align="end">
              <div className="flex flex-col space-y-1 border-r p-2">
                <Button
                  variant="ghost"
                  className="h-8 justify-start px-2 text-left font-normal"
                  onClick={() => setDatePreset('today')}
                >
                  Hoje
                </Button>
                <Button
                  variant="ghost"
                  className="h-8 justify-start px-2 text-left font-normal"
                  onClick={() => setDatePreset('yesterday')}
                >
                  Ontem
                </Button>
                <Button
                  variant="ghost"
                  className="h-8 justify-start px-2 text-left font-normal"
                  onClick={() => setDatePreset('last7')}
                >
                  Últimos 7 dias
                </Button>
                <Button
                  variant="ghost"
                  className="h-8 justify-start px-2 text-left font-normal"
                  onClick={() => setDatePreset('last30')}
                >
                  Últimos 30 dias
                </Button>
                <Button
                  variant="ghost"
                  className="h-8 justify-start px-2 text-left font-normal"
                  onClick={() => setDatePreset('last3Months')}
                >
                  Últimos 3 meses
                </Button>
                <Separator />
                <Button
                  variant="ghost"
                  className="h-8 justify-start px-2 text-left font-normal"
                  onClick={() => setDatePreset('thisMonth')}
                >
                  Este mês
                </Button>
                <Button
                  variant="ghost"
                  className="h-8 justify-start px-2 text-left font-normal"
                  onClick={() => setDatePreset('lastMonth')}
                >
                  Mês passado
                </Button>
              </div>
              <Calendar
                initialFocus
                mode="range"
                defaultMonth={date?.from}
                selected={date}
                onSelect={setDate}
                numberOfMonths={2}
                locale={ptBR}
              />
            </PopoverContent>
          </Popover>

          <Button
            onClick={handleSuggestGroups}
            disabled={isSuggesting || isLoading}
          >
            {isSuggesting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {suggestProgress
                  ? `Analisando ${suggestProgress.done}/${suggestProgress.total}...`
                  : 'Analisando...'}
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4" />
                Agrupar com IA
              </>
            )}
          </Button>

          <Button onClick={handleExport} variant="outline">
            <FileDown className="mr-2 h-4 w-4" />
            Exportar
          </Button>
        </div>
      </div>

      {/* Grouping toggle + info */}
      <div className="mt-4 flex flex-col items-start gap-2 rounded-lg border bg-muted/30 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <Layers className="mt-0.5 h-5 w-5 text-muted-foreground" />
          <div>
            <div className="text-sm font-medium">
              Agrupamento de produtos por IA
            </div>
            <div className="text-xs text-muted-foreground">
              {productGroups.length > 0
                ? `${productGroups.length} grupo${
                    productGroups.length === 1 ? '' : 's'
                  } salvo${productGroups.length === 1 ? '' : 's'} — ${
                    Array.from(skuToGroup.keys()).length
                  } SKUs mapeados.`
                : 'Nenhum grupo salvo ainda. Use "Agrupar com IA" para começar.'}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {groupingEnabled ? 'Agregando por grupo' : 'SKUs separados'}
          </span>
          <Switch
            checked={groupingEnabled}
            onCheckedChange={setGroupingEnabled}
            disabled={productGroups.length === 0}
            aria-label="Ativar agrupamento"
          />
        </div>
      </div>

      {/* Stat cards */}
      <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Faturamento no período"
          primary={formatCurrency(summary.totalRevenue)}
          secondary={`${formatInteger(summary.totalSkus)} SKUs • ${formatInteger(
            summary.totalQuantity
          )} unidades`}
          icon={DollarSign}
          isLoading={isLoading}
        />
        <StatCard
          title="Classe A"
          primary={`${summary.counts.A} SKUs`}
          secondary={`${formatCurrency(summary.revenueByClass.A)} (${formatPercent(
            summary.totalRevenue > 0
              ? summary.revenueByClass.A / summary.totalRevenue
              : 0,
            1
          )})`}
          icon={TrendingUp}
          isLoading={isLoading}
          accent="text-emerald-600"
        />
        <StatCard
          title="Classe B"
          primary={`${summary.counts.B} SKUs`}
          secondary={`${formatCurrency(summary.revenueByClass.B)} (${formatPercent(
            summary.totalRevenue > 0
              ? summary.revenueByClass.B / summary.totalRevenue
              : 0,
            1
          )})`}
          icon={Package}
          isLoading={isLoading}
          accent="text-amber-600"
        />
        <StatCard
          title="Classe C"
          primary={`${summary.counts.C} SKUs`}
          secondary={`${formatCurrency(summary.revenueByClass.C)} (${formatPercent(
            summary.totalRevenue > 0
              ? summary.revenueByClass.C / summary.totalRevenue
              : 0,
            1
          )})`}
          icon={Package}
          isLoading={isLoading}
          accent="text-slate-500"
        />
      </div>

      {/* Pareto chart */}
      <Card className="mt-8">
        <CardHeader>
          <CardTitle>Gráfico de Pareto — Top {CHART_TOP_N} produtos</CardTitle>
          <CardDescription>
            Barras mostram o {metricColumnLabel.toLowerCase()} por SKU; a linha
            representa o % acumulado. As linhas tracejadas marcam os limites 80% e
            95%.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-[360px] w-full" />
          ) : chartData.length === 0 ? (
            <div className="flex h-[360px] items-center justify-center text-sm text-muted-foreground">
              Nenhuma venda no período selecionado.
            </div>
          ) : (
            <div className="h-[360px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={chartData}
                  margin={{ top: 16, right: 24, left: 0, bottom: 24 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="sku"
                    interval={0}
                    angle={-35}
                    textAnchor="end"
                    height={60}
                    tick={{ fontSize: 11 }}
                  />
                  <YAxis
                    yAxisId="left"
                    tickFormatter={(v) => formatCurrency(Number(v))}
                    width={90}
                    tick={{ fontSize: 11 }}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    domain={[0, 100]}
                    tickFormatter={(v) => `${v}%`}
                    width={50}
                    tick={{ fontSize: 11 }}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar
                    yAxisId="left"
                    dataKey="revenue"
                    fill="hsl(var(--primary))"
                    name="Faturamento"
                    radius={[4, 4, 0, 0]}
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="cumulativeSharePct"
                    stroke="hsl(var(--destructive))"
                    strokeWidth={2}
                    name="% Acumulado"
                    dot={false}
                  />
                  <ReferenceLine
                    yAxisId="right"
                    y={80}
                    stroke="hsl(var(--muted-foreground))"
                    strokeDasharray="4 4"
                    label={{ value: '80%', position: 'right', fontSize: 11 }}
                  />
                  <ReferenceLine
                    yAxisId="right"
                    y={95}
                    stroke="hsl(var(--muted-foreground))"
                    strokeDasharray="4 4"
                    label={{ value: '95%', position: 'right', fontSize: 11 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Ranking table */}
      <Card className="mt-8">
        <CardHeader>
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle>Ranking de produtos</CardTitle>
              <CardDescription>
                Ordenado por {metricColumnLabel.toLowerCase()} descendente.
              </CardDescription>
            </div>
            <div className="relative w-full sm:w-auto">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por SKU ou nome..."
                className="w-full pl-8 sm:w-72"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="w-full overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Produto</TableHead>
                  <TableHead className="text-right">Quantidade</TableHead>
                  <TableHead className="text-right">Nº Pedidos</TableHead>
                  <TableHead className="text-right">Faturamento</TableHead>
                  <TableHead className="text-right">{metricColumnLabel}</TableHead>
                  <TableHead className="text-right">% Participação</TableHead>
                  <TableHead className="text-right">% Acumulado</TableHead>
                  <TableHead className="text-center">Classe</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={10} className="h-24 text-center">
                      <Loader2 className="mx-auto h-6 w-6 animate-spin" />
                    </TableCell>
                  </TableRow>
                ) : paginatedRows.length > 0 ? (
                  paginatedRows.flatMap((row) => {
                    const expanded = expandedGroupRows.has(row.sku);
                    const mainRow = (
                      <TableRow key={row.sku}>
                        <TableCell className="font-medium text-muted-foreground">
                          {row.rank}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {row.isGroup ? (
                            <button
                              type="button"
                              onClick={() => toggleGroupExpansion(row.sku)}
                              className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-primary hover:bg-primary/20"
                              title={`${row.skus.length} SKUs`}
                            >
                              {expanded ? (
                                <ChevronUp className="h-3 w-3" />
                              ) : (
                                <ChevronDown className="h-3 w-3" />
                              )}
                              <Layers className="h-3 w-3" />
                              {row.skus.length} SKUs
                            </button>
                          ) : (
                            row.sku
                          )}
                        </TableCell>
                        <TableCell
                          className="max-w-[320px] truncate"
                          title={row.name}
                        >
                          {row.name}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatInteger(row.quantity)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatInteger(row.orderCount)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right">
                          {formatCurrency(row.revenue)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right font-semibold">
                          {renderMainMetric(row)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatPercent(row.share)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatPercent(row.cumulativeShare)}
                        </TableCell>
                        <TableCell className="text-center">
                          <ClassBadge value={row.class} />
                        </TableCell>
                      </TableRow>
                    );

                    if (!row.isGroup || !expanded) return [mainRow];

                    const detailRow = (
                      <TableRow key={`${row.sku}-expanded`} className="bg-muted/30">
                        <TableCell />
                        <TableCell colSpan={9} className="py-2">
                          <div className="text-xs text-muted-foreground">
                            SKUs no grupo:
                          </div>
                          <ul className="mt-1 space-y-1 text-xs">
                            {row.skus.map((s) => (
                              <li key={s} className="font-mono">
                                • {s}
                              </li>
                            ))}
                          </ul>
                        </TableCell>
                      </TableRow>
                    );

                    return [mainRow, detailRow];
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={10} className="h-24 text-center">
                      Nenhuma venda no período selecionado.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
        <CardFooter className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            {formatInteger(searchedRows.length)} produtos
            {searchTerm ? ' (filtrados)' : ''}.
          </div>
          <div className="flex items-center space-x-6 lg:space-x-8">
            <div className="flex items-center space-x-2">
              <p className="text-sm font-medium">Itens por página</p>
              <Select
                value={`${rowsPerPage}`}
                onValueChange={(value) => setRowsPerPage(Number(value))}
              >
                <SelectTrigger className="h-8 w-[70px]">
                  <SelectValue placeholder={rowsPerPage} />
                </SelectTrigger>
                <SelectContent side="top">
                  {PAGE_SIZES.map((size) => (
                    <SelectItem key={size} value={`${size}`}>
                      {size}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex w-[120px] items-center justify-center text-sm font-medium">
              Página {currentPage} de {totalPages}
            </div>
            <div className="flex items-center space-x-2">
              <Button
                variant="outline"
                className="hidden h-8 w-8 p-0 lg:flex"
                onClick={() => setCurrentPage(1)}
                disabled={currentPage === 1}
              >
                <span className="sr-only">Primeira página</span>
                <ChevronsLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                className="h-8 w-8 p-0"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
              >
                <span className="sr-only">Página anterior</span>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                className="h-8 w-8 p-0"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
              >
                <span className="sr-only">Próxima página</span>
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                className="hidden h-8 w-8 p-0 lg:flex"
                onClick={() => setCurrentPage(totalPages)}
                disabled={currentPage === totalPages}
              >
                <span className="sr-only">Última página</span>
                <ChevronsRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardFooter>
      </Card>

      <AbcGroupReviewModal
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        suggestions={suggestions}
        skuInfo={reviewSkuInfo}
        isSaving={isGroupingSaving}
        onConfirm={handleConfirmGroups}
      />
    </>
  );
}
