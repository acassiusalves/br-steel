
'use client';

import * as React from 'react';
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
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Badge } from '@/components/ui/badge';
import SaleOrderDetailModal from '@/components/sale-order-detail-modal';
import type { SaleOrder } from '@/types/sale-order';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight, Loader2, Calendar as CalendarIcon, Filter, DollarSign, ShoppingCart, Users } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { DateRange } from "react-day-picker";
import { Skeleton } from '@/components/ui/skeleton';

// Função para buscar os pedidos do Firestore
async function getSalesFromFirestore(): Promise<SaleOrder[]> {
  try {
    const ordersCollection = collection(db, 'salesOrders');
    const q = query(ordersCollection, orderBy('data', 'desc'));
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      console.log("Nenhum pedido encontrado no Firestore.");
      return [];
    }

    const sales: SaleOrder[] = [];
    snapshot.forEach(doc => {
      sales.push(doc.data() as SaleOrder);
    });
    
    return sales;
  } catch (error) {
    console.error("Erro ao buscar pedidos do Firestore:", error);
    return [];
  }
}

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


export default function VendasPage() {
  const [allSales, setAllSales] = React.useState<SaleOrder[]>([]);
  const [filteredSales, setFilteredSales] = React.useState<SaleOrder[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isFiltering, setIsFiltering] = React.useState(false);
  const [selectedOrder, setSelectedOrder] = React.useState<SaleOrder | null>(null);

  // Pagination State
  const [currentPage, setCurrentPage] = React.useState(1);
  const [rowsPerPage, setRowsPerPage] = React.useState(10);
  
  // Date filter state
  const [date, setDate] = React.useState<DateRange | undefined>(undefined);

  // Stats state
  const [stats, setStats] = React.useState({
    totalRevenue: 0,
    totalSales: 0,
    averageTicket: 0,
  });

  React.useEffect(() => {
    async function fetchData() {
      setIsLoading(true);
      const data = await getSalesFromFirestore();
      setAllSales(data);
      setFilteredSales(data); // Initially, show all sales
      
      const today = new Date();
      const initialDate = { from: new Date(today.getFullYear(), 0, 1), to: today };
      setDate(initialDate);
      
      setIsLoading(false);
    }
    fetchData();
  }, []);
  
  // Recalculate stats whenever filteredSales changes
  React.useEffect(() => {
    const totalRevenue = filteredSales.reduce((sum, order) => sum + (order.total || 0), 0);
    const totalSales = filteredSales.length;
    const averageTicket = totalSales > 0 ? totalRevenue / totalSales : 0;
    
    setStats({ totalRevenue, totalSales, averageTicket });
    setCurrentPage(1); // Reset to first page on filter change
  }, [filteredSales]);


  const handleFilter = React.useCallback(() => {
    setIsFiltering(true);
    let newFilteredSales = allSales;

    if (date?.from && date?.to) {
        newFilteredSales = allSales.filter(sale => {
            try {
                const saleDate = parseISO(sale.data);
                return saleDate >= date.from! && saleDate <= date.to!;
            } catch (e) {
                return false;
            }
        });
    }

    setFilteredSales(newFilteredSales);
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
        return `Marketplace (${sale.intermediador.nomeUsuario})`;
    }
    return sale.loja?.nome || 'N/A';
  }

  return (
    <DashboardLayout>
      <div className="flex-1 space-y-8 p-4 pt-6 md:p-8">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
                <h2 className="text-3xl font-bold tracking-tight">Vendas</h2>
                <p className="text-muted-foreground">
                    Liste e gerencie todos os pedidos de venda dos seus marketplaces.
                </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
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
                  <PopoverContent className="w-auto p-0" align="end">
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
              <Button onClick={handleFilter} disabled={isFiltering} className="w-full sm:w-auto">
                {isFiltering ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Filter className="mr-2 h-4 w-4" />
                )}
                Filtrar
              </Button>
            </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
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

        <Card>
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
                                    {sale.itens.map((item, index) => (
                                      <li key={item.id || index} title={item.descricao} className="flex items-start gap-2">
                                        <span>{item.descricao}</span>
                                      </li>
                                    ))}
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
      </div>
      {selectedOrder && (
        <SaleOrderDetailModal 
          order={selectedOrder} 
          isOpen={!!selectedOrder}
          onClose={handleModalClose}
        />
      )}
    </DashboardLayout>
  );
}
