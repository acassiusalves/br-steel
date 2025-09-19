

'use client';

import * as React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Badge } from '@/components/ui/badge';
import SaleOrderDetailModal from '@/components/sale-order-detail-modal';
import type { SaleOrder } from '@/types/sale-order';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight, Loader2, Calendar as CalendarIcon, Filter, DollarSign, ShoppingCart, Users, Search } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import { format, parseISO, subDays, startOfMonth, endOfMonth, subMonths } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { DateRange } from "react-day-picker";
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';

// Função para formatar a data
const formatDate = (dateString: string) => {
    if (!dateString || dateString.startsWith('0000')) return 'N/A';
    try {
        const date = new Date(dateString + 'T00:00:00');
        return new Intl.DateTimeFormat('pt-BR').format(date);
    } catch {
        return dateString;
    }
}

// Função para formatar a moeda
const formatCurrency = (value: number | undefined) => {
    return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
    }).format(value || 0);
}

// Badge de status
const StatusBadge = ({ statusName }: { statusName: string }) => {
    let variant: "default" | "secondary" | "destructive" | "outline" = "secondary";
    if (!statusName) return <Badge variant={variant}>Desconhecido</Badge>;

    const lowerStatus = statusName.toLowerCase();
    if (lowerStatus.includes('entregue') || lowerStatus.includes('concluído') || lowerStatus.includes('atendido')) variant = "default";
    if (lowerStatus.includes('cancelado')) variant = "destructive";
    if (lowerStatus.includes('enviado') || lowerStatus.includes('em trânsito')) variant = "outline";
    if (lowerStatus.includes('em aberto') || lowerStatus.includes('em andamento')) variant = "secondary";

    return <Badge variant={variant} className="whitespace-nowrap">{statusName}</Badge>
}

// Componente para os cards de estatísticas
const StatCard = ({ title, value, icon: Icon, isLoading, valueFormatter = (v) => v.toLocaleString() }: {
  title: string;
  value: number;
  icon: React.ElementType;
  isLoading: boolean;
  valueFormatter?: (value: number) => string;
}) => {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <>
            <Skeleton className="h-8 w-3/4 mb-2" />
          </>
        ) : (
          <div className="text-2xl font-bold">{valueFormatter(value)}</div>
        )}
      </CardContent>
    </Card>
  );
};


const SalesListPage = () => {
  const [allSales, setAllSales] = React.useState<SaleOrder[]>([]);
  const [filteredSales, setFilteredSales] = React.useState<SaleOrder[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isFiltering, setIsFiltering] = React.useState(false);
  const [selectedOrder, setSelectedOrder] = React.useState<SaleOrder | null>(null);
  const [searchTerm, setSearchTerm] = React.useState('');

  // Pagination State
  const [currentPage, setCurrentPage] = React.useState(1);
  const [rowsPerPage, setRowsPerPage] = React.useState(10);
  
  // Date filter state
  const [date, setDate] = React.useState<DateRange | undefined>(() => {
    const today = new Date();
    return {
      from: startOfMonth(today),
      to: endOfMonth(today),
    };
  });

  // Stats state
  const [stats, setStats] = React.useState({
    totalRevenue: 0,
    totalSales: 0,
    averageTicket: 0,
  });

  React.useEffect(() => {
    setIsLoading(true);
    const ordersCollection = collection(db, 'salesOrders');
    const q = query(ordersCollection, orderBy('data', 'desc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
        if (snapshot.empty) {
            console.log("Nenhum pedido encontrado no Firestore.");
            setAllSales([]);
            setFilteredSales([]);
            setIsLoading(false);
            return;
        }

        const sales: SaleOrder[] = [];
        snapshot.forEach(doc => {
            sales.push(doc.data() as SaleOrder);
        });

        setAllSales(sales);
        setIsLoading(false);
    }, (error) => {
        console.error("Erro ao buscar pedidos do Firestore em tempo real:", error);
        setIsLoading(false);
    });
    
    // Limpa o listener quando o componente é desmontado
    return () => unsubscribe();
  }, []); 
  
  // Recalculate stats and apply filters
  React.useEffect(() => {
    handleFilter(searchTerm);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allSales, date, searchTerm]);


  const handleFilter = React.useCallback((currentSearchTerm: string) => {
    setIsFiltering(true);
    let newFilteredSales = allSales;

    // Date filter
    if (date?.from && date?.to) {
        newFilteredSales = newFilteredSales.filter(sale => {
            try {
                const saleDate = parseISO(sale.data);
                return saleDate >= date.from! && saleDate <= date.to!;
            } catch (e) {
                return false;
            }
        });
    }
    
    // Search term filter
    if (currentSearchTerm) {
        const lowerCaseSearchTerm = currentSearchTerm.toLowerCase();
        newFilteredSales = newFilteredSales.filter(sale => {
            const hasMatchingSku = sale.itens?.some(item => 
                String(item.codigo).toLowerCase().includes(lowerCaseSearchTerm)
            );
            const hasMatchingOrderNumber = 
                String(sale.id).includes(lowerCaseSearchTerm) ||
                String(sale.numero).includes(lowerCaseSearchTerm) ||
                String(sale.numeroLoja).toLowerCase().includes(lowerCaseSearchTerm);

            return hasMatchingSku || hasMatchingOrderNumber;
        });
    }

    setFilteredSales(newFilteredSales);
    setCurrentPage(1); // Reset to first page on filter change
    
    const totalRevenue = newFilteredSales.reduce((sum, order) => sum + (order.total || 0), 0);
    const totalSales = newFilteredSales.length;
    const averageTicket = totalSales > 0 ? totalRevenue / totalSales : 0;
    
    setStats({ totalRevenue, totalSales, averageTicket });
    
    // Give a small delay to show the loader, improving UX
    setTimeout(() => setIsFiltering(false), 300);
  }, [allSales, date]);


  // Pagination Logic
  const totalPages = Math.ceil(filteredSales.length / rowsPerPage);
  const paginatedSales = filteredSales.slice(
    (currentPage - 1) * rowsPerPage,
    currentPage * rowsPerPage
  );

  const handleRowClick = (sale: SaleOrder) => {
    setSelectedOrder(sale);
  };

  const handleModalClose = () => {
    setSelectedOrder(null);
  };

  const getTotalQuantity = (items: SaleOrder['itens']) => {
    if (!items || items.length === 0) return 0;
    return items.reduce((total, item) => total + item.quantidade, 0);
  }
  
  const getMarketplaceName = (sale: SaleOrder): string => {
    const rastreio = String(sale.transporte?.volumes?.[0]?.codigoRastreamento || '');
    if (rastreio.startsWith('MEL')) {
        return 'Mercado Livre';
    }
    if (sale.intermediador?.nomeUsuario) {
        return sale.intermediador.nomeUsuario;
    }
    return sale.loja?.nome || 'N/A';
  }
  
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

  return (
    <>
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
              <h2 className="text-3xl font-bold tracking-tight">Listagem de Vendas</h2>
              <p className="text-muted-foreground">
                  Liste e gerencie todos os pedidos de venda dos seus marketplaces.
              </p>
          </div>
          <div className="flex flex-col sm:flex-row items-center gap-2">
            <div className="relative w-full sm:w-auto">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input 
                    placeholder="Buscar por SKU ou pedido..." 
                    className="pl-8 w-full sm:w-64"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                />
            </div>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  id="date"
                  variant={"outline"}
                  className={cn(
                    "w-full sm:w-[260px] justify-start text-left font-normal",
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
          </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 mt-8">
          <StatCard 
            title="Receita Total"
            value={stats.totalRevenue}
            icon={DollarSign}
            isLoading={isFiltering}
            valueFormatter={formatCurrency}
          />
           <StatCard 
            title="Vendas"
            value={stats.totalSales}
            icon={ShoppingCart}
            isLoading={isFiltering}
          />
          <StatCard 
            title="Ticket Médio"
            value={stats.averageTicket}
            icon={DollarSign}
            isLoading={isFiltering}
            valueFormatter={formatCurrency}
          />
      </div>

      <Card className="mt-8">
        <CardHeader>
          <CardTitle>Pedidos Importados</CardTitle>
          <CardDescription>
            Uma lista detalhada dos seus pedidos de venda. Clique em um pedido para ver todos os detalhes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="w-full overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID Pedido</TableHead>
                  <TableHead>Nº Pedido</TableHead>
                  <TableHead>Nº Loja</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Marketplace</TableHead>
                  <TableHead>Qtd. Itens</TableHead>
                  <TableHead>Itens</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Vendedor</TableHead>
                  <TableHead className="text-right">Total Pedido</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading || isFiltering ? (
                   <TableRow>
                      <TableCell colSpan={11} className="text-center h-24">
                         <Loader2 className="mx-auto h-6 w-6 animate-spin" />
                      </TableCell>
                  </TableRow>
                ) : paginatedSales.length > 0 ? (
                    paginatedSales.map((sale) => (
                        <TableRow key={sale.id} onClick={() => handleRowClick(sale)} className="cursor-pointer">
                            <TableCell className="font-medium">{sale.id}</TableCell>
                            <TableCell>{sale.numero || 'N/A'}</TableCell>
                            <TableCell>{sale.numeroLoja || 'N/A'}</TableCell>
                            <TableCell className="whitespace-nowrap">{formatDate(sale.data)}</TableCell>
                            <TableCell>{sale.contato?.nome || 'N/A'}</TableCell>
                            <TableCell>{getMarketplaceName(sale)}</TableCell>
                             <TableCell className="text-center">{getTotalQuantity(sale.itens)}</TableCell>
                            <TableCell>
                              {sale.itens && sale.itens.length > 0 ? (
                                <ul className="text-xs space-y-1">
                                  {sale.itens.slice(0, 2).map((item, index) => (
                                    <li key={item.id || index} title={item.descricao} className="truncate max-w-xs">
                                      {item.descricao}
                                    </li>
                                  ))}
                                  {sale.itens.length > 2 && <li className="text-muted-foreground">e mais {sale.itens.length - 2}...</li>}
                                </ul>
                              ) : 'Sem itens'}
                            </TableCell>
                            <TableCell>
                                <StatusBadge statusName={sale.situacao?.nome || 'Desconhecido'} />
                            </TableCell>
                            <TableCell>{sale.vendedor?.nome || 'N/A'}</TableCell>
                            <TableCell className="text-right whitespace-nowrap">{formatCurrency(sale.total)}</TableCell>
                        </TableRow>
                    ))
                ) : (
                    <TableRow>
                        <TableCell colSpan={11} className="text-center h-24">
                           Nenhum pedido encontrado. <a href="/api" className="text-primary underline">Importe seus pedidos aqui.</a>
                        </TableCell>
                    </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
         <CardFooter className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            Total de {filteredSales.length} pedidos.
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
      {selectedOrder && (
        <SaleOrderDetailModal 
          order={selectedOrder} 
          isOpen={!!selectedOrder}
          onClose={handleModalClose}
        />
      )}
    </>
  );
};

export default SalesListPage;


    