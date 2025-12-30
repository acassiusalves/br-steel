
'use client';

import * as React from 'react';
import {
  Calendar as CalendarIcon,
  Filter,
  Loader2,
  RefreshCw,
  ChevronsLeft,
  ChevronLeft,
  ChevronRight,
  ChevronsRight,
  Columns,
  TrendingUp,
  TrendingDown,
  Wifi,
  WifiOff,
} from "lucide-react";
import { format, subDays, startOfMonth, endOfMonth, startOfYesterday, endOfYesterday, startOfWeek, endOfWeek, startOfYear, endOfYear, subMonths, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { DateRange } from "react-day-picker";
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';

import DashboardLayout from '@/components/dashboard-layout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getProductionDemand, updateSingleSkuStock } from '@/app/actions';
import type { ProductionDemand } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator as DropdownMenuSeparatorColumn,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';


type ColumnVisibility = {
    [key: string]: boolean;
}

export default function ProducaoClient() {
  const [demand, setDemand] = React.useState<ProductionDemand[]>([]);
  const [displayDemand, setDisplayDemand] = React.useState<ProductionDemand[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [updatingSku, setUpdatingSku] = React.useState<string | null>(null);
  const [date, setDate] = React.useState<DateRange | undefined>(undefined);
  const { toast } = useToast();

  // Progress states
  const [loadingProgress, setLoadingProgress] = React.useState(0);
  const [loadingStatus, setLoadingStatus] = React.useState('');

  const [productionQueueFilter, setProductionQueueFilter] = React.useState(false);

  const [columnVisibility, setColumnVisibility] = React.useState<ColumnVisibility>({
    sku: true,
    description: true,
    stockMin: true,
    stockMax: true,
    stockLevel: true,
    orderCount: true,
    totalQuantitySold: true,
    weeklyAverage: true,
    corte: true,
    dobra: true,
    actions: true,
  });

  // Pagination State
  const [currentPage, setCurrentPage] = React.useState(1);
  const [rowsPerPage, setRowsPerPage] = React.useState(10);

  // Real-time webhook state
  const [lastWebhookUpdate, setLastWebhookUpdate] = React.useState<string | null>(null);
  const [isWebhookConnected, setIsWebhookConnected] = React.useState(false);
  const [webhookTotalReceived, setWebhookTotalReceived] = React.useState(0);

  const fetchData = React.useCallback(async (currentDate: DateRange | undefined) => {
    setIsLoading(true);
    setLoadingProgress(0);
    setLoadingStatus('Iniciando...');

    try {
      if (!currentDate?.from || !currentDate?.to) {
        toast({
          variant: "destructive",
          title: "Período Inválido",
          description: "Por favor, selecione uma data de início e fim.",
        });
        setDemand([]);
        setIsLoading(false);
        return;
      }

      // Etapas de progresso simulado durante o carregamento
      const progressSteps = [
        { progress: 10, status: 'Buscando pedidos do Firebase...' },
        { progress: 30, status: 'Consultando estoque no Bling...' },
        { progress: 50, status: 'Carregando dados de suprimentos...' },
        { progress: 70, status: 'Processando demanda por SKU...' },
        { progress: 85, status: 'Calculando métricas...' },
      ];

      let stepIndex = 0;
      const progressInterval = setInterval(() => {
        if (stepIndex < progressSteps.length) {
          setLoadingProgress(progressSteps[stepIndex].progress);
          setLoadingStatus(progressSteps[stepIndex].status);
          stepIndex++;
        }
      }, 400);

      // Buscar pedidos do Firebase + estoque do Bling
      const data = await getProductionDemand({ from: currentDate.from, to: currentDate.to });

      clearInterval(progressInterval);
      setLoadingProgress(95);
      setLoadingStatus('Finalizando...');

      // Pequeno delay para mostrar a finalização
      await new Promise(resolve => setTimeout(resolve, 200));

      setLoadingProgress(100);
      setLoadingStatus('Concluído!');
      setDemand(data);

    } catch (error) {
      console.error('❌ [PRODUÇÃO] Erro ao buscar dados:', error);
      setLoadingStatus('Erro ao carregar dados');
      toast({
        variant: "destructive",
        title: "Erro ao Buscar Dados",
        description: "Não foi possível carregar a demanda de produção.",
      });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  React.useEffect(() => {
    const today = new Date();
    const initialDate = {
        from: new Date(today.getFullYear(), today.getMonth(), 1),
        to: today,
    };
    setDate(initialDate);
    fetchData(initialDate);
  }, [fetchData]);

  // Real-time listener for webhook updates
  React.useEffect(() => {
    const webhookStatusRef = doc(db, 'appConfig', 'webhookStatus');
    let lastKnownTotal = 0;

    const unsubscribe = onSnapshot(
      webhookStatusRef,
      (snapshot) => {
        setIsWebhookConnected(true);

        if (snapshot.exists()) {
          const data = snapshot.data();
          const newTotal = data.totalReceived || 0;

          setLastWebhookUpdate(data.lastUpdate || null);
          setWebhookTotalReceived(newTotal);

          // If we received a new webhook and we have a date range, refresh data
          if (newTotal > lastKnownTotal && lastKnownTotal > 0 && date?.from && date?.to) {
            console.log('🔔 [WEBHOOK] Novo pedido recebido! Atualizando dados...');
            toast({
              title: "Novo Pedido Recebido!",
              description: `Pedido ${data.lastOrderId} foi sincronizado via webhook.`,
            });
            fetchData(date);
          }

          lastKnownTotal = newTotal;
        }
      },
      (error) => {
        console.error('❌ [WEBHOOK] Erro ao escutar webhookStatus:', error);
        setIsWebhookConnected(false);
      }
    );

    return () => unsubscribe();
  }, [date, fetchData, toast]);

  React.useEffect(() => {
    console.log('🔄 [FILTRO] Aplicando filtro na lista de demanda...');
    console.log(`📊 Total de SKUs antes do filtro: ${demand.length}`);
    console.log(`🏭 Filtro "Fila de Produção" ativo: ${productionQueueFilter ? 'SIM' : 'NÃO'}`);

    let filteredDemand = [...demand];

    if (productionQueueFilter) {
      const beforeFilter = filteredDemand.length;
      filteredDemand = filteredDemand
        .filter(item => {
          const stock = item.stockLevel;
          const min = item.stockMin;
          const max = item.stockMax;

          if (stock === undefined || min === undefined || max === undefined) return false;

          // Regras de inclusão:
          // 1. Estoque atual < Estoque Mínimo
          const needsProduction = stock < min;
          // 2. Estoque atual NÃO está acima do máximo
          const isNotOverstocked = stock <= max;

          return needsProduction && isNotOverstocked;
        })
        .sort((a, b) => {
          const aStock = a.stockLevel ?? 0;
          const bStock = b.stockLevel ?? 0;
          const aMin = a.stockMin ?? 0;
          const bMin = b.stockMin ?? 0;

          // Calcular déficit (quanto falta para o mínimo)
          const aDeficit = aMin - aStock; // maior = mais urgente
          const bDeficit = bMin - bStock;

          // PRIORIDADE 1: Estoque = 0 + maior quantidade total vendida
          const aIsZero = aStock === 0;
          const bIsZero = bStock === 0;

          if (aIsZero && bIsZero) {
            // Ambos com estoque 0: desempata por quantidade total vendida
            return b.totalQuantitySold - a.totalQuantitySold;
          }
          if (aIsZero && !bIsZero) return -1; // a vem primeiro (estoque 0)
          if (!aIsZero && bIsZero) return 1;  // b vem primeiro (estoque 0)

          // PRIORIDADE 2: Maior déficit + maior quantidade total vendida
          // PRIORIDADE 3: Maior déficit (quando vendas são iguais)
          if (aDeficit !== bDeficit) {
            return bDeficit - aDeficit; // maior déficit primeiro
          }

          // Mesmo déficit: desempata por quantidade total vendida
          return b.totalQuantitySold - a.totalQuantitySold;
        });

      console.log(`🏭 [FILA DE PRODUÇÃO] Filtro aplicado: ${beforeFilter} -> ${filteredDemand.length} SKUs`);
      if (filteredDemand.length > 0) {
        console.log('📋 Primeiros 5 itens na fila de produção:');
        filteredDemand.slice(0, 5).forEach((item, i) => {
          const deficit = (item.stockMin ?? 0) - (item.stockLevel ?? 0);
          console.log(`   ${i+1}. ${item.sku} | Estoque: ${item.stockLevel} | Mín: ${item.stockMin} | Déficit: ${deficit} | Vendido: ${item.totalQuantitySold}`);
        });
      }
    }

    console.log(`📊 Total de SKUs após filtro: ${filteredDemand.length}`);
    setDisplayDemand(filteredDemand);
    setCurrentPage(1); // Reset page on filter change
  }, [demand, productionQueueFilter]);


  const handleFilter = () => {
    if (!date) {
        toast({
            variant: "destructive",
            title: "Período não selecionado",
            description: "Por favor, escolha um período para filtrar.",
        });
        return;
    }
    fetchData(date);
  };
  
    const setDatePreset = (preset: 'today' | 'yesterday' | 'last7' | 'last30' | 'last3Months' | 'thisMonth' | 'lastMonth') => {
      const today = new Date();
      switch (preset) {
          case 'today':
              setDate({ from: today, to: today });
              break;
          case 'yesterday':
              const yesterday = subDays(today, 1);
              setDate({ from: yesterday, to: yesterday });
              break;
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
          case 'lastMonth':
              const lastMonthStart = startOfMonth(subMonths(today, 1));
              const lastMonthEnd = endOfMonth(subMonths(today, 1));
              setDate({ from: lastMonthStart, to: lastMonthEnd });
              break;
      }
  }

  const handleUpdateStock = async (sku: string) => {
    setUpdatingSku(sku);
    try {
        const stockData = await updateSingleSkuStock(sku);
        if (stockData) {
            setDemand(prevDemand => 
                prevDemand.map(item => 
                    item.sku === sku 
                        ? { ...item, ...stockData } 
                        : item
                )
            );
            toast({
                title: "Estoque Atualizado!",
                description: `Dados de estoque para ${sku} foram atualizados.`,
            });
        }
    } catch (error: any) {
        toast({
            variant: "destructive",
            title: "Erro ao Atualizar",
            description: error.message,
        });
    } finally {
        setUpdatingSku(null);
    }
  };

  const toggleColumn = (column: string) => {
      setColumnVisibility(prev => ({
          ...prev,
          [column]: !prev[column]
      }));
  }

  // Pagination Logic
  const totalPages = Math.ceil(displayDemand.length / rowsPerPage);
  const paginatedDemand = displayDemand.slice(
    (currentPage - 1) * rowsPerPage,
    currentPage * rowsPerPage
  );


  return (
    <DashboardLayout>
      <div className="flex-1 space-y-8 p-4 pt-6 md:p-8">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
                <h2 className="text-3xl font-bold tracking-tight">Análise para Produção</h2>
                <p className="text-muted-foreground">
                    Demanda de produtos baseada em vendas com Nota Fiscal emitida no período.
                </p>
                {/* Webhook status indicator */}
                <div className="flex items-center gap-2 mt-2">
                  {isWebhookConnected ? (
                    <Badge variant="outline" className="flex items-center gap-1 text-green-600 border-green-300">
                      <Wifi className="h-3 w-3" />
                      <span>Real-time ativo</span>
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="flex items-center gap-1 text-muted-foreground">
                      <WifiOff className="h-3 w-3" />
                      <span>Conectando...</span>
                    </Badge>
                  )}
                  {lastWebhookUpdate && (
                    <span className="text-xs text-muted-foreground">
                      Última atualização: {formatDistanceToNow(new Date(lastWebhookUpdate), { addSuffix: true, locale: ptBR })}
                    </span>
                  )}
                  {webhookTotalReceived > 0 && (
                    <Badge variant="secondary" className="text-xs">
                      {webhookTotalReceived} webhooks recebidos
                    </Badge>
                  )}
                </div>
            </div>
             <div className="flex flex-wrap items-center gap-2">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      id="date"
                      variant={"outline"}
                      className={cn(
                        "w-full sm:w-[280px] justify-start text-left font-normal",
                        !date && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {date?.from ? (
                        date.to ? (
                          <>
                            {format(date.from, "dd/MM/yy")} -{" "}
                            {format(date.to, "dd/MM/yy")}
                          </>
                        ) : (
                          format(date.from, "dd/MM/yy")
                        )
                      ) : (
                        <span>Escolha um período</span>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0 flex" align="end">
                    <div className="flex flex-col space-y-1 p-2 border-r">
                        <Button variant="ghost" className="justify-start text-left font-normal h-8 px-2" onClick={() => setDatePreset('today')}>Hoje</Button>
                        <Button variant="ghost" className="justify-start text-left font-normal h-8 px-2" onClick={() => setDatePreset('yesterday')}>Ontem</Button>
                        <Button variant="ghost" className="justify-start text-left font-normal h-8 px-2" onClick={() => setDatePreset('last7')}>Últimos 7 dias</Button>
                        <Button variant="ghost" className="justify-start text-left font-normal h-8 px-2" onClick={() => setDatePreset('last30')}>Últimos 30 dias</Button>
                        <Button variant="ghost" className="justify-start text-left font-normal h-8 px-2" onClick={() => setDatePreset('last3Months')}>Últimos 3 meses</Button>
                        <Separator />
                        <Button variant="ghost" className="justify-start text-left font-normal h-8 px-2" onClick={() => setDatePreset('thisMonth')}>Este mês</Button>
                        <Button variant="ghost" className="justify-start text-left font-normal h-8 px-2" onClick={() => setDatePreset('lastMonth')}>Mês passado</Button>
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
                <Button onClick={handleFilter} disabled={isLoading} variant="outline" className="w-full sm:w-auto">
                    {isLoading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                    <Filter className="mr-2 h-4 w-4" />
                    )}
                    {isLoading ? 'Carregando...' : 'Filtrar'}
                </Button>
            </div>
        </div>
        <Card>
          <CardHeader>
            <div className="flex justify-between items-center">
                <div>
                    <CardTitle>Demanda por SKU</CardTitle>
                    <CardDescription>
                      A lista abaixo mostra a quantidade de pedidos únicos (com nota fiscal emitida) para cada produto no período selecionado.
                    </CardDescription>
                </div>
                 <div className="flex items-center gap-4">
                    <div className="flex items-center space-x-2">
                        <Label htmlFor="production-queue-filter" className="font-semibold text-sm">
                            Fila de Produção
                        </Label>
                        <Switch
                            id="production-queue-filter"
                            checked={productionQueueFilter}
                            onCheckedChange={setProductionQueueFilter}
                            aria-label="Filtro de Fila de Produção"
                        />
                    </div>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline" className="ml-auto">
                            <Columns className="mr-2 h-4 w-4" />
                            Exibir Colunas
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel>Alternar Colunas</DropdownMenuLabel>
                          <DropdownMenuSeparatorColumn />
                          {Object.keys(columnVisibility).map((key) => {
                              const name = {
                                  sku: "SKU",
                                  description: "Descrição",
                                  stockMin: "Estoque Mínimo",
                                  stockMax: "Estoque Máximo",
                                  stockLevel: "Estoque Atual",
                                  orderCount: "Qtd. Pedidos",
                                  totalQuantitySold: "Qtd. Vendida",
                                  weeklyAverage: "Média Semanal",
                                  corte: "Corte",
                                  dobra: "Dobra",
                                  actions: "Ações",
                              }[key] || key;
                              
                              return (
                                <DropdownMenuCheckboxItem
                                  key={key}
                                  className="capitalize"
                                  checked={columnVisibility[key]}
                                  onCheckedChange={() => toggleColumn(key)}
                                >
                                  {name}
                                </DropdownMenuCheckboxItem>
                              )
                          })}
                        </DropdownMenuContent>
                    </DropdownMenu>
                 </div>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  {columnVisibility.sku && <TableHead>SKU</TableHead>}
                  {columnVisibility.description && <TableHead>Descrição do Produto</TableHead>}
                  {columnVisibility.stockMin && <TableHead className="text-right">Estoque Mínimo</TableHead>}
                  {columnVisibility.stockMax && <TableHead className="text-right">Estoque Máximo</TableHead>}
                  {columnVisibility.stockLevel && <TableHead className="text-right">Estoque Atual (Bling)</TableHead>}
                  {columnVisibility.orderCount && <TableHead className="text-right">Qtd. de Pedidos (com NF)</TableHead>}
                  {columnVisibility.totalQuantitySold && <TableHead className="text-right">Qtd. Total Vendida</TableHead>}
                  {columnVisibility.weeklyAverage && <TableHead className="text-right">Média Semanal (Pedidos)</TableHead>}
                  {columnVisibility.corte && <TableHead className="text-right">Corte</TableHead>}
                  {columnVisibility.dobra && <TableHead className="text-right">Dobra</TableHead>}
                  {columnVisibility.actions && <TableHead className="text-center">Ações</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={Object.values(columnVisibility).filter(Boolean).length} className="h-32 text-center">
                      <div className="flex flex-col items-center justify-center gap-3 px-4">
                        <Loader2 className="h-6 w-6 animate-spin text-primary" />
                        <div className="w-full max-w-xs space-y-2">
                          <Progress value={loadingProgress} className="h-2" />
                          <p className="text-sm text-muted-foreground">
                            {loadingStatus} ({loadingProgress}%)
                          </p>
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : paginatedDemand.length > 0 ? (
                  paginatedDemand.map((item) => (
                    <TableRow key={item.sku}>
                      {columnVisibility.sku && <TableCell className="font-medium">{item.sku}</TableCell>}
                      {columnVisibility.description && <TableCell>{item.description}</TableCell>}
                      {columnVisibility.stockMin && <TableCell className="text-right font-bold">{item.stockMin ?? ''}</TableCell>}
                      {columnVisibility.stockMax && <TableCell className="text-right font-bold">{item.stockMax ?? ''}</TableCell>}
                      {columnVisibility.stockLevel && <TableCell className="text-right font-bold">{item.stockLevel ?? ''}</TableCell>}
                      {columnVisibility.orderCount && <TableCell className="text-right font-bold">{item.orderCount}</TableCell>}
                      {columnVisibility.totalQuantitySold && <TableCell className="text-right font-bold">{item.totalQuantitySold}</TableCell>}
                      {columnVisibility.weeklyAverage && (
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            {item.weeklyAverage.toFixed(1)}
                            {/* Prioridade: Crítico (vermelho) > Alta demanda (verde) */}
                            {(item.stockLevel ?? 0) < ((item.stockMin ?? 0) * 0.5) ? (
                              // Crítico: estoque atual < 50% do mínimo
                              <TrendingDown className="h-4 w-4 text-red-500" />
                            ) : item.weeklyAverage > (item.stockLevel ?? 0) ? (
                              // Alta demanda: média semanal > estoque atual
                              <TrendingUp className="h-4 w-4 text-green-500" />
                            ) : null}
                          </div>
                        </TableCell>
                      )}
                      {columnVisibility.corte && <TableCell className="text-right">{item.corte}</TableCell>}
                      {columnVisibility.dobra && <TableCell className="text-right">{item.dobra}</TableCell>}
                      {columnVisibility.actions && (
                          <TableCell className="text-center">
                              <Button 
                                  variant="outline" 
                                  size="sm"
                                  onClick={() => handleUpdateStock(item.sku)}
                                  disabled={updatingSku === item.sku}
                              >
                                  {updatingSku === item.sku ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                      <RefreshCw className="h-4 w-4" />
                                  )}
                              </Button>
                          </TableCell>
                      )}
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={Object.values(columnVisibility).filter(Boolean).length} className="h-24 text-center">
                      Nenhum item vendido com nota fiscal encontrada para o período.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
           <CardFooter className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              Total de {displayDemand.length} produtos.
            </div>
            <div className="flex items-center space-x-6 lg:space-x-8">
              <div className="flex items-center space-x-2">
                <p className="text-sm font-medium">Itens por página</p>
                <Select
                  value={`${rowsPerPage}`}
                  onValueChange={(value) => {
                    setRowsPerPage(Number(value))
                    setCurrentPage(1)
                  }}
                >
                  <SelectTrigger className="h-8 w-[70px]">
                    <SelectValue placeholder={rowsPerPage} />
                  </SelectTrigger>
                  <SelectContent side="top">
                    {[10, 20, 30, 40, 50].map((pageSize) => (
                      <SelectItem key={pageSize} value={`${pageSize}`}>
                        {pageSize}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex w-[100px] items-center justify-center text-sm font-medium">
                Página {currentPage} de {totalPages}
              </div>
              <div className="flex items-center space-x-2">
                <Button
                  variant="outline"
                  className="hidden h-8 w-8 p-0 lg:flex"
                  onClick={() => setCurrentPage(1)}
                  disabled={currentPage === 1}
                >
                  <span className="sr-only">Go to first page</span>
                  <ChevronsLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  className="h-8 w-8 p-0"
                  onClick={() => setCurrentPage(currentPage - 1)}
                  disabled={currentPage === 1}
                >
                  <span className="sr-only">Go to previous page</span>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  className="h-8 w-8 p-0"
                  onClick={() => setCurrentPage(currentPage + 1)}
                  disabled={currentPage === totalPages}
                >
                  <span className="sr-only">Go to next page</span>
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  className="hidden h-8 w-8 p-0 lg:flex"
                  onClick={() => setCurrentPage(totalPages)}
                  disabled={currentPage === totalPages}
                >
                  <span className="sr-only">Go to last page</span>
                  <ChevronsRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardFooter>
        </Card>
      </div>
    </DashboardLayout>
  );
}
