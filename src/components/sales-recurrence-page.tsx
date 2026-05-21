'use client';

import * as React from 'react';
import {
  Building2,
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Clock,
  FileDown,
  Filter,
  Loader2,
  Package,
  RefreshCw,
  Search,
  Target,
  TrendingUp,
  Users,
} from 'lucide-react';
import { endOfMonth, format, startOfMonth, subMonths } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { DateRange } from 'react-day-picker';
import * as XLSX from 'xlsx';

import {
  getCustomerProductRecurrenceData,
  type CustomerProductRecurrenceRequest,
} from '@/app/recurrence-actions';
import { cn } from '@/lib/utils';
import type {
  ConfidenceLevel,
  OpportunityStatus,
  PriorityLevel,
} from '@/lib/customer-product-recurrence';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  Card,
  CardContent,
  CardDescription,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';

type RecurrenceData = Awaited<ReturnType<typeof getCustomerProductRecurrenceData>>;
type Opportunity = RecurrenceData['opportunities'][number];
type CustomerRow = RecurrenceData['customersByDocument'][number];
type RecurrenceWindow = Pick<Opportunity, 'daysUntilNextExpected'>;
type ViewMode = 'product' | 'customer';
type StatusFilter = OpportunityStatus | 'all';
type ConfidenceFilter = ConfidenceLevel | 'all';
type PriorityFilter = PriorityLevel | 'all';

const PAGE_SIZES = [10, 20, 30, 50, 100];

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value || 0);

const formatInteger = (value: number) =>
  new Intl.NumberFormat('pt-BR').format(value || 0);

const formatDate = (value: string | null) => {
  if (!value) return 'N/A';
  try {
    return new Intl.DateTimeFormat('pt-BR').format(new Date(`${value}T00:00:00`));
  } catch {
    return value;
  }
};

const statusLabels: Record<OpportunityStatus, string> = {
  overdue: 'Vencida',
  due_soon: 'Próxima',
  future: 'Futura',
  insufficient: 'Pouco histórico',
};

const statusStyles: Record<OpportunityStatus, string> = {
  overdue:
    'border-red-200 bg-red-50 text-red-700 hover:bg-red-50 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300',
  due_soon:
    'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300',
  future:
    'border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-50 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300',
  insufficient:
    'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300',
};

const confidenceLabels: Record<ConfidenceLevel, string> = {
  high: 'Alta',
  medium: 'Média',
  low: 'Baixa',
};

const priorityLabels: Record<PriorityLevel, string> = {
  high: 'Alta',
  medium: 'Média',
  low: 'Baixa',
};

const priorityStyles: Record<PriorityLevel, string> = {
  high: 'bg-emerald-100 text-emerald-800 hover:bg-emerald-100 dark:bg-emerald-900/40 dark:text-emerald-200',
  medium: 'bg-amber-100 text-amber-800 hover:bg-amber-100 dark:bg-amber-900/40 dark:text-amber-200',
  low: 'bg-slate-100 text-slate-700 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-300',
};

const abcStyles = {
  A: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  B: 'border-amber-200 bg-amber-50 text-amber-700',
  C: 'border-slate-200 bg-slate-50 text-slate-700',
};

const StatCard = ({
  title,
  value,
  secondary,
  icon: Icon,
  isLoading,
  valueFormatter = (v: number) => formatInteger(v),
}: {
  title: string;
  value: number;
  secondary?: string;
  icon: React.ElementType;
  isLoading: boolean;
  valueFormatter?: (value: number) => string;
}) => (
  <Card>
    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
      <CardTitle className="text-sm font-medium">{title}</CardTitle>
      <Icon className="h-4 w-4 text-muted-foreground" />
    </CardHeader>
    <CardContent>
      {isLoading ? (
        <>
          <Skeleton className="mb-2 h-8 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </>
      ) : (
        <>
          <div className="text-2xl font-bold">{valueFormatter(value)}</div>
          {secondary ? <p className="text-xs text-muted-foreground">{secondary}</p> : null}
        </>
      )}
    </CardContent>
  </Card>
);

function formatNextWindow(row: RecurrenceWindow): string {
  if (row.daysUntilNextExpected === null) return 'Sem previsão';
  if (row.daysUntilNextExpected < 0) {
    return `${Math.abs(row.daysUntilNextExpected)} dias atrasada`;
  }
  if (row.daysUntilNextExpected === 0) return 'Vence hoje';
  return `Em ${row.daysUntilNextExpected} dias`;
}

function getTopProductsTitle(row: CustomerRow): string {
  return row.topProducts
    .map((product) => `${product.productName} - ${formatCurrency(product.totalRevenue)}`)
    .join(' | ');
}

function getDateButtonLabel(date: DateRange | undefined): string {
  if (!date?.from) return 'Escolha um período';
  if (!date.to) return format(date.from, 'dd/MM/yy');
  return `${format(date.from, 'dd/MM/yy')} - ${format(date.to, 'dd/MM/yy')}`;
}

export default function SalesRecurrencePage() {
  const { toast } = useToast();
  const [date, setDate] = React.useState<DateRange | undefined>(() => {
    const today = new Date();
    return {
      from: subMonths(today, 12),
      to: today,
    };
  });
  const [minDates, setMinDates] = React.useState('2');
  const [lookaheadDays, setLookaheadDays] = React.useState('30');
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>('all');
  const [confidenceFilter, setConfidenceFilter] =
    React.useState<ConfidenceFilter>('all');
  const [priorityFilter, setPriorityFilter] = React.useState<PriorityFilter>('all');
  const [viewMode, setViewMode] = React.useState<ViewMode>('product');
  const [searchTerm, setSearchTerm] = React.useState('');
  const [currentPage, setCurrentPage] = React.useState(1);
  const [rowsPerPage, setRowsPerPage] = React.useState(20);
  const [data, setData] = React.useState<RecurrenceData | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);

  const fetchData = React.useCallback(async () => {
    if (!date?.from || !date?.to) return;
    setIsLoading(true);
    try {
      const request: CustomerProductRecurrenceRequest = {
        from: date.from,
        to: date.to,
        minDistinctPurchaseDates: Number(minDates),
        lookaheadDays: Number(lookaheadDays),
      };
      const result = await getCustomerProductRecurrenceData(request);
      setData(result);
      setCurrentPage(1);
    } catch (error: any) {
      console.error('Erro ao buscar análise de recorrência:', error);
      toast({
        variant: 'destructive',
        title: 'Erro ao buscar recorrência',
        description: error?.message || 'Não foi possível calcular os dados.',
      });
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }, [date, minDates, lookaheadDays, toast]);

  React.useEffect(() => {
    fetchData();
  }, [fetchData]);

  React.useEffect(() => {
    setCurrentPage(1);
  }, [viewMode]);

  const filteredOpportunityRows = React.useMemo(() => {
    let rows = data?.opportunities || [];

    if (statusFilter !== 'all') {
      rows = rows.filter((row) => row.opportunityStatus === statusFilter);
    }

    if (confidenceFilter !== 'all') {
      rows = rows.filter((row) => row.confidence === confidenceFilter);
    }

    if (priorityFilter !== 'all') {
      rows = rows.filter((row) => row.priority === priorityFilter);
    }

    if (searchTerm.trim()) {
      const search = searchTerm.trim().toLowerCase();
      rows = rows.filter((row) => {
        return (
          row.customerName.toLowerCase().includes(search) ||
          (row.customerDocument || '').toLowerCase().includes(search) ||
          row.productName.toLowerCase().includes(search) ||
          row.skus.some((sku) => sku.toLowerCase().includes(search)) ||
          row.marketplaceNames.some((name) => name.toLowerCase().includes(search)) ||
          row.states.some((state) => state.toLowerCase().includes(search))
        );
      });
    }

    return rows;
  }, [data, statusFilter, confidenceFilter, priorityFilter, searchTerm]);

  const filteredCustomerRows = React.useMemo(() => {
    let rows = data?.customersByDocument || [];

    if (statusFilter !== 'all') {
      rows = rows.filter((row) => row.opportunityStatus === statusFilter);
    }

    if (confidenceFilter !== 'all') {
      rows = rows.filter((row) => row.confidence === confidenceFilter);
    }

    if (priorityFilter !== 'all') {
      rows = rows.filter((row) => row.priority === priorityFilter);
    }

    if (searchTerm.trim()) {
      const search = searchTerm.trim().toLowerCase();
      rows = rows.filter((row) => {
        return (
          row.customerName.toLowerCase().includes(search) ||
          (row.customerDocument || '').toLowerCase().includes(search) ||
          row.marketplaceNames.some((name) => name.toLowerCase().includes(search)) ||
          row.states.some((state) => state.toLowerCase().includes(search)) ||
          row.topProducts.some((product) =>
            product.productName.toLowerCase().includes(search) ||
            product.skus.some((sku) => sku.toLowerCase().includes(search))
          )
        );
      });
    }

    return rows;
  }, [data, statusFilter, confidenceFilter, priorityFilter, searchTerm]);

  const activeRowsCount =
    viewMode === 'customer' ? filteredCustomerRows.length : filteredOpportunityRows.length;
  const totalPages = Math.max(1, Math.ceil(activeRowsCount / rowsPerPage));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const paginatedOpportunityRows = filteredOpportunityRows.slice(
    (safeCurrentPage - 1) * rowsPerPage,
    safeCurrentPage * rowsPerPage
  );
  const paginatedCustomerRows = filteredCustomerRows.slice(
    (safeCurrentPage - 1) * rowsPerPage,
    safeCurrentPage * rowsPerPage
  );
  const visibleRowsCount =
    viewMode === 'customer' ? paginatedCustomerRows.length : paginatedOpportunityRows.length;
  const filteredCustomerRevenue = filteredCustomerRows.reduce(
    (sum, row) => sum + row.totalRevenue,
    0
  );

  const setDatePreset = (preset: 'last90' | 'last6Months' | 'last12Months' | 'thisMonth' | 'lastMonth') => {
    const today = new Date();
    if (preset === 'last90') {
      setDate({ from: subMonths(today, 3), to: today });
    } else if (preset === 'last6Months') {
      setDate({ from: subMonths(today, 6), to: today });
    } else if (preset === 'last12Months') {
      setDate({ from: subMonths(today, 12), to: today });
    } else if (preset === 'thisMonth') {
      setDate({ from: startOfMonth(today), to: endOfMonth(today) });
    } else {
      const lastMonth = subMonths(today, 1);
      setDate({ from: startOfMonth(lastMonth), to: endOfMonth(lastMonth) });
    }
  };

  const handleExport = () => {
    const hasRows =
      viewMode === 'customer'
        ? filteredCustomerRows.length > 0
        : filteredOpportunityRows.length > 0;

    if (!hasRows) {
      toast({
        variant: 'destructive',
        title: 'Nenhum dado para exportar',
        description: 'A lista filtrada está vazia.',
      });
      return;
    }

    const rows =
      viewMode === 'customer'
        ? filteredCustomerRows.map((row) => ({
            Cliente: row.customerName,
            Documento: row.customerDocument || '',
            Canal: row.marketplaceNames.join(' | '),
            UF: row.states.join(' | '),
            Pedidos: row.orderCount,
            'Datas distintas': row.distinctPurchaseDates,
            Quantidade: row.totalQuantity,
            'Produtos distintos': row.productCount,
            'SKUs distintos': row.skuCount,
            Faturamento: row.totalRevenue,
            'Ticket medio': row.averageOrderValue,
            'Primeira compra': row.firstPurchaseDate || '',
            'Ultima compra': row.lastPurchaseDate || '',
            'Intervalo mediano': row.medianIntervalDays || '',
            'Proxima prevista': row.nextExpectedDate || '',
            'Dias ate previsao': row.daysUntilNextExpected ?? '',
            Status: statusLabels[row.opportunityStatus],
            Confianca: confidenceLabels[row.confidence],
            Prioridade: priorityLabels[row.priority],
            'Principais produtos': row.topProducts
              .map((product) => `${product.productName} (${formatCurrency(product.totalRevenue)})`)
              .join(' | '),
            Acao: row.suggestedAction,
          }))
        : filteredOpportunityRows.map((row) => ({
            Cliente: row.customerName,
            Documento: row.customerDocument || '',
            Produto: row.productName,
            SKUs: row.skus.join(' | '),
            ABC: row.productAbcClass || '',
            Canal: row.marketplaceNames.join(' | '),
            UF: row.states.join(' | '),
            Pedidos: row.orderCount,
            'Datas distintas': row.distinctPurchaseDates,
            Quantidade: row.totalQuantity,
            Faturamento: row.totalRevenue,
            'Ticket medio': row.averageOrderValue,
            'Primeira compra': row.firstPurchaseDate || '',
            'Ultima compra': row.lastPurchaseDate || '',
            'Intervalo mediano': row.medianIntervalDays || '',
            'Proxima prevista': row.nextExpectedDate || '',
            'Dias ate previsao': row.daysUntilNextExpected ?? '',
            Status: statusLabels[row.opportunityStatus],
            Confianca: confidenceLabels[row.confidence],
            Prioridade: priorityLabels[row.priority],
            Acao: row.suggestedAction,
          }));

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      worksheet,
      viewMode === 'customer' ? 'Clientes CNPJ' : 'Recorrencia'
    );
    XLSX.writeFile(
      workbook,
      viewMode === 'customer'
        ? 'recorrencia-clientes-cnpj.xlsx'
        : 'recorrencia-clientes-produtos.xlsx'
    );
  };

  const summary = data?.summary;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Recorrência de Clientes e Produtos</h2>
          <p className="text-muted-foreground">
            Priorize clientes com padrão de recompra para condições especiais.
          </p>
          <div className="mt-3 inline-flex rounded-md border bg-background p-1">
            <Button
              type="button"
              size="sm"
              variant={viewMode === 'product' ? 'default' : 'ghost'}
              className="h-8"
              onClick={() => setViewMode('product')}
            >
              <Package className="mr-2 h-4 w-4" />
              Cliente-produto
            </Button>
            <Button
              type="button"
              size="sm"
              variant={viewMode === 'customer' ? 'default' : 'ghost'}
              className="h-8"
              onClick={() => setViewMode('customer')}
            >
              <Building2 className="mr-2 h-4 w-4" />
              Por CNPJ
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                id="recurrence-date"
                variant="outline"
                className={cn(
                  'w-full justify-start text-left font-normal sm:w-[260px]',
                  !date && 'text-muted-foreground'
                )}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {getDateButtonLabel(date)}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="flex w-auto p-0" align="end">
              <div className="flex flex-col space-y-1 border-r p-2">
                <Button variant="ghost" className="h-8 justify-start px-2 text-left font-normal" onClick={() => setDatePreset('last90')}>
                  Últimos 90 dias
                </Button>
                <Button variant="ghost" className="h-8 justify-start px-2 text-left font-normal" onClick={() => setDatePreset('last6Months')}>
                  Últimos 6 meses
                </Button>
                <Button variant="ghost" className="h-8 justify-start px-2 text-left font-normal" onClick={() => setDatePreset('last12Months')}>
                  Últimos 12 meses
                </Button>
                <Separator />
                <Button variant="ghost" className="h-8 justify-start px-2 text-left font-normal" onClick={() => setDatePreset('thisMonth')}>
                  Este mês
                </Button>
                <Button variant="ghost" className="h-8 justify-start px-2 text-left font-normal" onClick={() => setDatePreset('lastMonth')}>
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
          <Button onClick={fetchData} disabled={isLoading} className="w-full sm:w-auto">
            {isLoading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Filter className="mr-2 h-4 w-4" />
            )}
            Filtrar
          </Button>
          <Button variant="outline" onClick={handleExport} disabled={isLoading || !activeRowsCount}>
            <FileDown className="mr-2 h-4 w-4" />
            Exportar
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <StatCard
          title="Clientes recorrentes"
          value={summary?.recurringCustomers || 0}
          secondary={`${formatInteger(summary?.strongRecurringCustomers || 0)} com 3+ datas`}
          icon={Users}
          isLoading={isLoading}
        />
        <StatCard
          title={viewMode === 'customer' ? 'CNPJs na lista' : 'Pares recorrentes'}
          value={viewMode === 'customer' ? filteredCustomerRows.length : summary?.recurringPairs || 0}
          secondary={
            viewMode === 'customer'
              ? `${formatCurrency(filteredCustomerRevenue)} em compras`
              : `${formatInteger(summary?.strongRecurringPairs || 0)} cliente-produto fortes`
          }
          icon={viewMode === 'customer' ? Building2 : RefreshCw}
          isLoading={isLoading}
        />
        <StatCard
          title="Vencidas"
          value={summary?.overdueOpportunities || 0}
          secondary="fora da janela prevista"
          icon={Clock}
          isLoading={isLoading}
        />
        <StatCard
          title="Próximas"
          value={summary?.dueSoonOpportunities || 0}
          secondary={`próximos ${lookaheadDays} dias`}
          icon={Target}
          isLoading={isLoading}
        />
        <StatCard
          title={viewMode === 'customer' ? 'Faturamento filtrado' : 'Receita potencial'}
          value={viewMode === 'customer' ? filteredCustomerRevenue : summary?.potentialRevenue || 0}
          secondary={
            viewMode === 'customer'
              ? 'clientes visíveis na lista'
              : 'ticket médio das oportunidades'
          }
          icon={TrendingUp}
          isLoading={isLoading}
          valueFormatter={formatCurrency}
        />
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <CardTitle>
                {viewMode === 'customer'
                  ? 'Faturamento por CNPJ'
                  : 'Oportunidades de recompra'}
              </CardTitle>
              <CardDescription>
                {summary
                  ? viewMode === 'customer'
                    ? `${formatInteger(filteredCustomerRows.length)} clientes agrupados por documento, considerando ${formatInteger(summary.ordersAnalyzed)} pedidos analisados.`
                    : `${formatInteger(summary.ordersAnalyzed)} pedidos analisados, ${formatInteger(summary.ignoredCancelled)} cancelados e ${formatInteger(summary.ignoredReturns)} devoluções ignoradas.`
                  : 'Carregando análise de recorrência.'}
              </CardDescription>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              <div className="relative sm:col-span-2 lg:col-span-1">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={
                    viewMode === 'customer'
                      ? 'Cliente, CNPJ, produto...'
                      : 'Cliente, produto, SKU...'
                  }
                  className="pl-8"
                  value={searchTerm}
                  onChange={(event) => {
                    setSearchTerm(event.target.value);
                    setCurrentPage(1);
                  }}
                />
              </div>
              <Select value={statusFilter} onValueChange={(value) => { setStatusFilter(value as StatusFilter); setCurrentPage(1); }}>
                <SelectTrigger>
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos status</SelectItem>
                  <SelectItem value="overdue">Vencidas</SelectItem>
                  <SelectItem value="due_soon">Próximas</SelectItem>
                  <SelectItem value="future">Futuras</SelectItem>
                </SelectContent>
              </Select>
              <Select value={priorityFilter} onValueChange={(value) => { setPriorityFilter(value as PriorityFilter); setCurrentPage(1); }}>
                <SelectTrigger>
                  <SelectValue placeholder="Prioridade" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas prioridades</SelectItem>
                  <SelectItem value="high">Alta</SelectItem>
                  <SelectItem value="medium">Média</SelectItem>
                  <SelectItem value="low">Baixa</SelectItem>
                </SelectContent>
              </Select>
              <Select value={confidenceFilter} onValueChange={(value) => { setConfidenceFilter(value as ConfidenceFilter); setCurrentPage(1); }}>
                <SelectTrigger>
                  <SelectValue placeholder="Confiança" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas confianças</SelectItem>
                  <SelectItem value="high">Alta</SelectItem>
                  <SelectItem value="medium">Média</SelectItem>
                  <SelectItem value="low">Baixa</SelectItem>
                </SelectContent>
              </Select>
              <Select value={minDates} onValueChange={(value) => { setMinDates(value); setCurrentPage(1); }}>
                <SelectTrigger>
                  <SelectValue placeholder="Datas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="2">2+ datas</SelectItem>
                  <SelectItem value="3">3+ datas</SelectItem>
                  <SelectItem value="4">4+ datas</SelectItem>
                  <SelectItem value="5">5+ datas</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="w-full overflow-x-auto">
            <Table>
              {viewMode === 'customer' ? (
                <>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[240px]">Cliente / CNPJ</TableHead>
                      <TableHead className="min-w-[160px]">Estado / Canal</TableHead>
                      <TableHead className="min-w-[140px]">Pedidos</TableHead>
                      <TableHead className="min-w-[170px] text-right">Faturamento total</TableHead>
                      <TableHead className="min-w-[260px]">Produtos comprados</TableHead>
                      <TableHead className="min-w-[150px]">Próxima compra</TableHead>
                      <TableHead>Confiança</TableHead>
                      <TableHead>Prioridade</TableHead>
                      <TableHead className="min-w-[260px]">Ação sugerida</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? (
                      <TableRow>
                        <TableCell colSpan={9} className="h-24 text-center">
                          <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
                        </TableCell>
                      </TableRow>
                    ) : paginatedCustomerRows.length ? (
                      paginatedCustomerRows.map((row) => (
                        <TableRow key={row.key}>
                          <TableCell>
                            <div className="space-y-1">
                              <div className="flex flex-wrap items-center gap-1">
                                <Badge variant="secondary">
                                  {row.customerDocument
                                    ? row.customerType === 'F'
                                      ? 'CPF'
                                      : 'CNPJ'
                                    : 'Sem documento'}
                                </Badge>
                              </div>
                              <p className="font-medium leading-tight">{row.customerName}</p>
                              <p className="text-xs text-muted-foreground">
                                {row.customerDocument || 'Documento N/A'}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="space-y-1 text-sm">
                              <p className="font-medium">
                                {row.states.length ? row.states.join(', ') : 'UF N/A'}
                              </p>
                              <p
                                className="max-w-[180px] truncate text-xs text-muted-foreground"
                                title={row.marketplaceNames.join(' | ')}
                              >
                                {row.marketplaceNames.length
                                  ? row.marketplaceNames.join(' | ')
                                  : 'Canal N/A'}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="space-y-1 whitespace-nowrap text-sm">
                              <p className="font-medium">{row.orderCount} pedidos</p>
                              <p className="text-xs text-muted-foreground">
                                {row.distinctPurchaseDates} datas de compra
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {formatInteger(row.totalQuantity)} unidades
                              </p>
                              <p className="text-xs text-muted-foreground">
                                Mediana: {row.medianIntervalDays ? `${row.medianIntervalDays} dias` : 'N/A'}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="space-y-1 whitespace-nowrap">
                              <p className="font-medium">{formatCurrency(row.totalRevenue)}</p>
                              <p className="text-xs text-muted-foreground">
                                Ticket médio {formatCurrency(row.averageOrderValue)}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="space-y-1">
                              <p className="font-medium">
                                {row.productCount} produtos / {row.skuCount} SKUs
                              </p>
                              <div className="space-y-1" title={getTopProductsTitle(row)}>
                                {row.topProducts.slice(0, 3).map((product) => (
                                  <p
                                    key={product.productKey}
                                    className="max-w-[300px] truncate text-xs text-muted-foreground"
                                  >
                                    {product.productName} - {formatCurrency(product.totalRevenue)}
                                  </p>
                                ))}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="space-y-1 whitespace-nowrap">
                              <Badge variant="outline" className={statusStyles[row.opportunityStatus]}>
                                {statusLabels[row.opportunityStatus]}
                              </Badge>
                              <p className="text-xs text-muted-foreground">
                                Última: {formatDate(row.lastPurchaseDate)}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                Próxima: {formatDate(row.nextExpectedDate)}
                              </p>
                              <p className="text-xs font-medium">{formatNextWindow(row)}</p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="space-y-1 whitespace-nowrap">
                              <Badge variant="secondary">{confidenceLabels[row.confidence]}</Badge>
                              <p className="text-xs text-muted-foreground">{row.confidenceScore}/100</p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="space-y-1 whitespace-nowrap">
                              <Badge className={priorityStyles[row.priority]}>
                                {priorityLabels[row.priority]}
                              </Badge>
                              <p className="text-xs text-muted-foreground">{row.priorityScore}/100</p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <p className="text-sm leading-snug">{row.suggestedAction}</p>
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={9} className="h-24 text-center">
                          Nenhum cliente encontrado com os filtros atuais.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </>
              ) : (
                <>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[240px]">Cliente</TableHead>
                      <TableHead className="min-w-[160px]">Estado / Canal</TableHead>
                      <TableHead className="min-w-[300px]">Produto / SKU</TableHead>
                      <TableHead className="min-w-[140px]">Pedidos</TableHead>
                      <TableHead className="min-w-[160px] text-right">Valor total comprado</TableHead>
                      <TableHead className="min-w-[150px]">Próxima compra</TableHead>
                      <TableHead>Confiança</TableHead>
                      <TableHead>Prioridade</TableHead>
                      <TableHead className="min-w-[260px]">Ação sugerida</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? (
                      <TableRow>
                        <TableCell colSpan={9} className="h-24 text-center">
                          <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
                        </TableCell>
                      </TableRow>
                    ) : paginatedOpportunityRows.length ? (
                      paginatedOpportunityRows.map((row) => (
                        <TableRow key={row.key}>
                          <TableCell>
                            <div className="space-y-1">
                              <p className="font-medium leading-tight">{row.customerName}</p>
                              <p className="text-xs text-muted-foreground">
                                {row.customerDocument || 'Documento N/A'}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="space-y-1 text-sm">
                              <p className="font-medium">
                                {row.states.length ? row.states.join(', ') : 'UF N/A'}
                              </p>
                              <p
                                className="max-w-[180px] truncate text-xs text-muted-foreground"
                                title={row.marketplaceNames.join(' | ')}
                              >
                                {row.marketplaceNames.length
                                  ? row.marketplaceNames.join(' | ')
                                  : 'Canal N/A'}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="space-y-1">
                              <div className="flex flex-wrap items-center gap-1">
                                {row.productAbcClass ? (
                                  <Badge variant="outline" className={abcStyles[row.productAbcClass]}>
                                    ABC {row.productAbcClass}
                                  </Badge>
                                ) : null}
                                {row.isGroup ? <Badge variant="secondary">Grupo</Badge> : null}
                              </div>
                              <p className="font-medium leading-tight">{row.productName}</p>
                              <p className="max-w-[360px] truncate text-xs text-muted-foreground" title={row.skus.join(' | ')}>
                                {row.skus.join(' | ')}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="space-y-1 whitespace-nowrap text-sm">
                              <p className="font-medium">{row.orderCount} pedidos</p>
                              <p className="text-xs text-muted-foreground">
                                {row.distinctPurchaseDates} datas de compra
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {formatInteger(row.totalQuantity)} unidades
                              </p>
                              <p className="text-xs text-muted-foreground">
                                Mediana: {row.medianIntervalDays ? `${row.medianIntervalDays} dias` : 'N/A'}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="space-y-1 whitespace-nowrap">
                              <p className="font-medium">{formatCurrency(row.totalRevenue)}</p>
                              <p className="text-xs text-muted-foreground">
                                Ticket médio {formatCurrency(row.averageOrderValue)}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                Preço médio un. {formatCurrency(row.averageUnitPrice)}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="space-y-1 whitespace-nowrap">
                              <Badge variant="outline" className={statusStyles[row.opportunityStatus]}>
                                {statusLabels[row.opportunityStatus]}
                              </Badge>
                              <p className="text-xs text-muted-foreground">
                                Última: {formatDate(row.lastPurchaseDate)}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                Próxima: {formatDate(row.nextExpectedDate)}
                              </p>
                              <p className="text-xs font-medium">{formatNextWindow(row)}</p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="space-y-1 whitespace-nowrap">
                              <Badge variant="secondary">{confidenceLabels[row.confidence]}</Badge>
                              <p className="text-xs text-muted-foreground">{row.confidenceScore}/100</p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="space-y-1 whitespace-nowrap">
                              <Badge className={priorityStyles[row.priority]}>
                                {priorityLabels[row.priority]}
                              </Badge>
                              <p className="text-xs text-muted-foreground">{row.priorityScore}/100</p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <p className="text-sm leading-snug">{row.suggestedAction}</p>
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={9} className="h-24 text-center">
                          Nenhuma oportunidade encontrada com os filtros atuais.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </>
              )}
            </Table>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-muted-foreground">
          Mostrando {formatInteger(visibleRowsCount)} de {formatInteger(activeRowsCount)}{' '}
          {viewMode === 'customer' ? 'clientes agrupados por CNPJ' : 'oportunidades'}.
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium">Linhas</p>
            <Select
              value={`${rowsPerPage}`}
              onValueChange={(value) => {
                setRowsPerPage(Number(value));
                setCurrentPage(1);
              }}
            >
              <SelectTrigger className="h-8 w-[76px]">
                <SelectValue placeholder={rowsPerPage} />
              </SelectTrigger>
              <SelectContent side="top">
                {PAGE_SIZES.map((pageSize) => (
                  <SelectItem key={pageSize} value={`${pageSize}`}>
                    {pageSize}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="text-sm font-medium">
            Página {safeCurrentPage} de {totalPages}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              className="hidden h-8 w-8 p-0 sm:flex"
              onClick={() => setCurrentPage(1)}
              disabled={safeCurrentPage === 1}
            >
              <span className="sr-only">Primeira página</span>
              <ChevronsLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              className="h-8 w-8 p-0"
              onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
              disabled={safeCurrentPage === 1}
            >
              <span className="sr-only">Página anterior</span>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              className="h-8 w-8 p-0"
              onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
              disabled={safeCurrentPage === totalPages}
            >
              <span className="sr-only">Próxima página</span>
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              className="hidden h-8 w-8 p-0 sm:flex"
              onClick={() => setCurrentPage(totalPages)}
              disabled={safeCurrentPage === totalPages}
            >
              <span className="sr-only">Última página</span>
              <ChevronsRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
