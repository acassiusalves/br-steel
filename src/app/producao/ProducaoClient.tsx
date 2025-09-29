
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
} from "lucide-react";
import { format, subDays, startOfMonth, endOfMonth, startOfYesterday, endOfYesterday, startOfWeek, endOfWeek, startOfYear, endOfYear, subMonths } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { DateRange } from "react-day-picker";

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
import { getProductionDemand, smartSyncOrders, updateSingleSkuStock } from '@/app/actions';
import type { ProductionDemand } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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


type ColumnVisibility = {
    [key: string]: boolean;
}

export default function ProducaoClient() {
  const [demand, setDemand] = React.useState<ProductionDemand[]>([]);
  const [displayDemand, setDisplayDemand] = React.useState<ProductionDemand[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSyncing, setIsSyncing] = React.useState(false);
  const [updatingSku, setUpdatingSku] = React.useState<string | null>(null);
  const [date, setDate] = React.useState<DateRange | undefined>(undefined);
  const { toast } = useToast();
  
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
  
  const fetchData = React.useCallback(async (currentDate: DateRange | undefined, forceSync: boolean = false) => {
    setIsLoading(true);
    if (forceSync) {
        setIsSyncing(true);
    }
    try {
      if (!currentDate?.from || !currentDate?.to) {
        toast({
          variant: "destructive",
          title: "Período Inválido",
          description: "Por favor, selecione uma data de início e fim.",
        });
        setDemand([]);
        return;
      }
      
      if (forceSync) {
        toast({
            title: "Sincronizando...",
            description: "Atualizando pedidos com o Bling para garantir dados precisos.",
        });
        await smartSyncOrders();
      }

      const data = await getProductionDemand({ from: currentDate.from, to: currentDate.to });
      setDemand(data);
      if(forceSync) {
        toast({
            title: "Dados Atualizados!",
            description: "A análise de produção foi recalculada com sucesso.",
        });
      }

    } catch (error) {
      console.error("Failed to fetch production demand:", error);
      toast({
        variant: "destructive",
        title: "Erro ao Buscar Dados",
        description: "Não foi possível carregar a demanda de produção.",
      });
    } finally {
      setIsLoading(false);
      if (forceSync) {
        setIsSyncing(false);
      }
    }
  }, [toast]);

  React.useEffect(() => {
    const today = new Date();
    const initialDate = {
        from: new Date(today.getFullYear(), today.getMonth(), 1),
        to: today,
    };
    setDate(initialDate);
    fetchData(initialDate, false);
  }, [fetchData]);

  React.useEffect(() => {
    let filteredDemand = [...demand];

    if (productionQueueFilter) {
      filteredDemand = filteredDemand
        .filter(item => {
          const stock = item.stockLevel;
          const min = item.stockMin;
          const max = item.stockMax;
          
          if (stock === undefined || min === undefined || max === undefined) return false;

          // Regras atualizadas:
          // 1. Estoque atual < Estoque Mínimo (Exclui quando é igual)
          const needsProduction = stock < min;
          // 2. Estoque atual NÃO está acima do máximo
          const isNotOverstocked = stock <= max;
          
          return needsProduction && isNotOverstocked;
        })
        .sort((a, b) => b.weeklyAverage - a.weeklyAverage);
    }

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
    fetchData(date, false);
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
                <Button onClick={handleFilter} disabled={isLoading || isSyncing} className="w-full sm:w-auto">
                    {isLoading || isSyncing ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                    <RefreshCw className="mr-2 h-4 w-4" />
                    )}
                    {isSyncing ? 'Sincronizando...' : (isLoading ? 'Carregando...' : 'Atualizar e Filtrar')}
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
                    <TableCell colSpan={Object.values(columnVisibility).filter(Boolean).length} className="h-24 text-center">
                      <Loader2 className="mx-auto h-6 w-6 animate-spin" />
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
                      {columnVisibility.weeklyAverage && <TableCell className="text-right">{item.weeklyAverage.toFixed(1)}</TableCell>}
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
