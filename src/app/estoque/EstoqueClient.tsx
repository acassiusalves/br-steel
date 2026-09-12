'use client';

import * as React from 'react';
import { Search, Download, RefreshCw, Package, AlertTriangle, CheckCircle, AlertCircle, Info, BellRing, ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight } from 'lucide-react';
import DashboardLayout from '@/components/dashboard-layout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from '@/components/ui/skeleton';
import { fetchAllOperationPages, subscribeOperation, notifyOperationsChanged } from '@/lib/operation-client';
import type { OperationResult } from '@/types/operations';
import type { ProductStock } from '@/types/product-stock';
import { useToast } from '@/hooks/use-toast';
import { ScrollArea } from '@/components/ui/scroll-area';

export default function EstoqueClient() {
  const [stockData, setStockData] = React.useState<ProductStock[]>([]);
  const [filteredData, setFilteredData] = React.useState<ProductStock[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [searchTerm, setSearchTerm] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState('all');
  const [error, setError] = React.useState<string | null>(null);
  const [metadata, setMetadata] = React.useState<OperationResult<ProductStock[]> | null>(null);
  const [isAlertsModalOpen, setIsAlertsModalOpen] = React.useState(false);
  
  // Pagination State
  const [currentPage, setCurrentPage] = React.useState(1);
  const [rowsPerPage, setRowsPerPage] = React.useState(10);
  
  const { toast } = useToast();

  React.useEffect(() => subscribeOperation(async () => {
    let metadata: OperationResult<ProductStock[]> | null = null;
    const rows = await fetchAllOperationPages<ProductStock>('/api/operations/stock', page => {
      metadata = metadata ? { ...page, warnings: [...new Set([...metadata.warnings, ...page.warnings])] } : page;
    });
    return { rows, metadata };
  }, result => {
    setStockData(result.rows); setMetadata(result.metadata); setError(null); setIsLoading(false);
  }, error => { setStockData([]); setFilteredData([]); setMetadata(null); setError(error.message); setIsLoading(false); }), []);

  React.useEffect(() => {
    let filtered = stockData;

    if (searchTerm) {
      filtered = filtered.filter(item => 
        item.produto.nome.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.produto.codigo.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    if (statusFilter !== 'all') {
      filtered = filtered.filter(item => {
        switch (statusFilter) {
          case 'out-of-stock':
            return item.saldoVirtualTotal !== null && item.saldoVirtualTotal <= 0;
          case 'low-stock':
            return item.saldoVirtualTotal !== null && item.saldoVirtualTotal > 0 && item.saldoVirtualTotal < 10;
          case 'in-stock':
            return item.saldoVirtualTotal !== null && item.saldoVirtualTotal >= 10;
          default:
            return true;
        }
      });
    }

    setFilteredData(filtered);

  }, [stockData, searchTerm, statusFilter]);
  
  React.useEffect(() => { setCurrentPage(1); }, [searchTerm, statusFilter, rowsPerPage]);

  // Pagination Logic
  const totalPages = Math.max(1, Math.ceil(filteredData.length / rowsPerPage));
  const paginatedData = filteredData.slice(
    (currentPage - 1) * rowsPerPage,
    currentPage * rowsPerPage
  );


  const StockStatusBadge = ({ virtual }: { virtual: number | null }) => {
    if (virtual === null) return <Badge variant="outline">Não informado</Badge>;
    if (virtual <= 0) {
      return (
        <Badge variant="destructive" className="flex items-center gap-1 whitespace-nowrap">
          <AlertTriangle className="w-3 h-3" />
          Esgotado
        </Badge>
      );
    }
    if (virtual < 10) {
      return (
        <Badge variant="secondary" className="bg-yellow-500 text-black flex items-center gap-1 whitespace-nowrap">
          <AlertTriangle className="w-3 h-3" />
          Estoque Baixo
        </Badge>
      );
    }
    return (
      <Badge variant="default" className="bg-green-600 flex items-center gap-1 whitespace-nowrap">
        <CheckCircle className="w-3 h-3" />
        Em Estoque
      </Badge>
    );
  };

  const getStockStats = () => {
    const total = stockData.length;
    const outOfStock = stockData.filter(item => item.saldoVirtualTotal !== null && item.saldoVirtualTotal <= 0).length;
    const lowStock = stockData.filter(item => item.saldoVirtualTotal !== null && item.saldoVirtualTotal > 0 && item.saldoVirtualTotal < 10).length;
    const inStock = stockData.filter(item => item.saldoVirtualTotal !== null && item.saldoVirtualTotal >= 10).length;

    return { total, outOfStock, lowStock, inStock };
  };

  const stats = getStockStats();

  const handleRefresh = notifyOperationsChanged;

  return (
    <DashboardLayout>
      <div className="flex-1 space-y-6 p-4 pt-6 md:p-8">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Gestão de Estoque</h2>
            <p className="text-muted-foreground">
              Visualize e gerencie os níveis de estoque dos seus produtos em tempo real.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={handleRefresh} disabled={isLoading} variant="outline">
              <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
              Atualizar
            </Button>
            <Dialog open={isAlertsModalOpen} onOpenChange={setIsAlertsModalOpen}>
              <DialogTrigger asChild>
                <Button variant="outline">
                  <BellRing className="w-4 h-4 mr-2" />
                  Alertas
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                  <DialogTitle>Configurar Alertas de Estoque Mínimo</DialogTitle>
                  <DialogDescription>
                    Defina a quantidade mínima para cada produto para ser notificado quando o estoque estiver baixo.
                  </DialogDescription>
                </DialogHeader>
                <ScrollArea className="max-h-[50vh] pr-4">
                  <div className="space-y-4 py-4">
                    {stockData.length > 0 ? (
                      stockData.map((item) => (
                        <div key={item.produto.codigo} className="grid grid-cols-3 items-center gap-4">
                          <Label htmlFor={`alert-${item.produto.id}`} className="col-span-2 truncate" title={item.produto.nome}>
                            {item.produto.nome}
                          </Label>
                          <Input
                            id={`alert-${item.produto.id}`}
                            type="number"
                            placeholder="Qtd."
                            className="col-span-1"
                            // Você pode gerenciar o estado desses inputs aqui
                          />
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-center text-muted-foreground">
                        {isLoading ? "Carregando produtos..." : "Nenhum produto para configurar."}
                      </p>
                    )}
                  </div>
                </ScrollArea>
                <DialogFooter>
                  <Button onClick={() => setIsAlertsModalOpen(false)} type="submit">Salvar Configurações</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {error}
            </AlertDescription>
          </Alert>
        )}

        {metadata && <p className="text-sm text-muted-foreground">Fonte: {metadata.source} · Consulta: {new Date(metadata.asOf).toLocaleString('pt-BR')} {metadata.warnings.join(' ')}</p>}
        {stockData.some(item => item.saldoVirtualTotal === null) && <p className="text-sm">Há produtos com estoque não informado; eles não entram nos indicadores de disponibilidade.</p>}

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total de Produtos</CardTitle>
              <Package className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {isLoading ? <Skeleton className="h-8 w-1/2" /> : <div className="text-2xl font-bold">{stats.total}</div>}
              <p className="text-xs text-muted-foreground">
                SKUs únicos cadastrados
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Em Estoque</CardTitle>
              <CheckCircle className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              {isLoading ? <Skeleton className="h-8 w-1/2" /> : <div className="text-2xl font-bold text-green-600">{stats.inStock}</div>}
              <p className="text-xs text-muted-foreground">
                Estoque adequado (≥10 unidades)
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Estoque Baixo</CardTitle>
              <AlertTriangle className="h-4 w-4 text-yellow-500" />
            </CardHeader>
            <CardContent>
              {isLoading ? <Skeleton className="h-8 w-1/2" /> : <div className="text-2xl font-bold text-yellow-600">{stats.lowStock}</div>}
              <p className="text-xs text-muted-foreground">
                Atenção necessária (1 a 9 unidades)
              </p>
            </CardContent>
          </Card>

           <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Esgotado</CardTitle>
              <AlertTriangle className="h-4 w-4 text-red-500" />
            </CardHeader>
            <CardContent>
              {isLoading ? <Skeleton className="h-8 w-1/2" /> : <div className="text-2xl font-bold text-red-600">{stats.outOfStock}</div>}
              <p className="text-xs text-muted-foreground">
                Itens sem estoque virtual
              </p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <CardTitle>Níveis de Estoque por SKU</CardTitle>
                <p className="text-muted-foreground mt-1 text-sm">
                  A lista abaixo mostra o saldo de estoque consolidado de todos os depósitos.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input 
                    placeholder="Buscar por SKU ou nome..." 
                    className="pl-8 w-full md:w-64"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </div>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-full md:w-[180px]">
                    <SelectValue placeholder="Filtrar por status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos os Status</SelectItem>
                    <SelectItem value="in-stock">Em Estoque</SelectItem>
                    <SelectItem value="low-stock">Estoque Baixo</SelectItem>
                    <SelectItem value="out-of-stock">Esgotado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Descrição do Produto</TableHead>
                  <TableHead className="text-right">Estoque Físico Total</TableHead>
                  <TableHead className="text-right">Estoque Virtual Total</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, index) => (
                    <TableRow key={index}>
                      <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-64" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-20 ml-auto" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-20 ml-auto" /></TableCell>
                      <TableCell><Skeleton className="h-6 w-24" /></TableCell>
                    </TableRow>
                  ))
                ) : paginatedData.length > 0 ? (
                    paginatedData.map((item) => (
                        <TableRow key={item.produto.codigo}>
                            <TableCell className="font-medium">{item.produto.codigo}</TableCell>
                            <TableCell>{item.produto.nome}<span className="block text-xs text-muted-foreground">{item.source} · {new Date(item.asOf).toLocaleString('pt-BR')}</span></TableCell>
                            <TableCell className="text-right font-bold">{item.saldoFisicoTotal ?? 'Não informado'}</TableCell>
                            <TableCell className="text-right font-bold">{item.saldoVirtualTotal ?? 'Não informado'}</TableCell>
                            <TableCell>
                                <StockStatusBadge 
                                    virtual={item.saldoVirtualTotal} 
                                />
                            </TableCell>
                        </TableRow>
                    ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center">
                      Nenhum produto encontrado.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
          <CardFooter className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              Total de {filteredData.length} produtos.
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
