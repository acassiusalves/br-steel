
'use client';

import * as React from 'react';
import { Search, Download, RefreshCw, Package, AlertTriangle, CheckCircle } from 'lucide-react';
import DashboardLayout from '@/components/dashboard-layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
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
import { Skeleton } from '@/components/ui/skeleton';
import { getProductsStock } from '@/app/actions';
import type { ProductStock } from '@/app/actions';
import { useToast } from '@/hooks/use-toast';

export default function EstoquePage() {
  const [stockData, setStockData] = React.useState<ProductStock[]>([]);
  const [filteredData, setFilteredData] = React.useState<ProductStock[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [searchTerm, setSearchTerm] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState('all');
  const { toast } = useToast();

  const fetchStockData = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const { data } = await getProductsStock();
      
      const aggregatedStock = new Map<string, { 
          productId: number;
          productName: string;
          saldoFisicoTotal: number;
          saldoVirtualTotal: number;
      }>();

      data.forEach(item => {
          const sku = item.produto.codigo;
          if (!aggregatedStock.has(sku)) {
              aggregatedStock.set(sku, {
                  productId: item.produto.id,
                  productName: item.produto.nome,
                  saldoFisicoTotal: item.saldoFisicoTotal,
                  saldoVirtualTotal: item.saldoVirtualTotal,
              });
          }
      });
      
      const processedData = Array.from(aggregatedStock.entries()).map(([sku, value]) => ({
          produto: { id: value.productId, codigo: sku, nome: value.productName },
          saldoFisicoTotal: value.saldoFisicoTotal,
          saldoVirtualTotal: value.saldoVirtualTotal,
          deposito: { id: 0, nome: ''},
          saldoFisico: 0,
          saldoVirtual: 0,
      }));
      
      setStockData(processedData);

    } catch (error: any) {
      console.error("Failed to fetch stock data:", error);
      toast({
          variant: "destructive",
          title: "Erro ao Buscar Estoque",
          description: `Não foi possível carregar os dados de estoque do Bling: ${error.message}`,
      });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  // Carregamento inicial dos dados
  React.useEffect(() => {
    fetchStockData();
  }, [fetchStockData]);

  // Filtros
  React.useEffect(() => {
    let filtered = stockData;

    // Filtro por texto de busca
    if (searchTerm) {
      filtered = filtered.filter(item => 
        item.produto.nome.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.produto.codigo.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    // Filtro por status
    if (statusFilter !== 'all') {
      filtered = filtered.filter(item => {
        switch (statusFilter) {
          case 'out-of-stock':
            return item.saldoVirtualTotal <= 0;
          case 'low-stock':
            return item.saldoVirtualTotal > 0 && item.saldoVirtualTotal < 10;
          case 'in-stock':
            return item.saldoVirtualTotal >= 10;
          default:
            return true;
        }
      });
    }

    setFilteredData(filtered);
  }, [stockData, searchTerm, statusFilter]);

  const StockStatusBadge = ({ virtual }: { virtual: number }) => {
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
    const outOfStock = stockData.filter(item => item.saldoVirtualTotal <= 0).length;
    const lowStock = stockData.filter(item => item.saldoVirtualTotal > 0 && item.saldoVirtualTotal < 10).length;
    const inStock = stockData.filter(item => item.saldoVirtualTotal >= 10).length;

    return { total, outOfStock, lowStock, inStock };
  };

  const stats = getStockStats();

  const handleRefresh = async () => {
    await fetchStockData();
    toast({
      title: "Dados Atualizados",
      description: "Os níveis de estoque foram sincronizados com o Bling.",
    });
  };

  const handleExport = () => {
    // Criar CSV
    const headers = ['SKU', 'Produto', 'Estoque Físico', 'Estoque Virtual', 'Status'];
    const csvContent = [
      headers.join(','),
      ...filteredData.map(item => [
        item.produto.codigo,
        `"${item.produto.nome.replace(/"/g, '""')}"`, // Escape double quotes
        item.saldoFisicoTotal,
        item.saldoVirtualTotal,
        item.saldoVirtualTotal <= 0 ? 'Esgotado' : item.saldoVirtualTotal < 10 ? 'Estoque Baixo' : 'Em Estoque'
      ].join(','))
    ].join('\\n');

    // Download do arquivo
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    if (link.download !== undefined) {
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', `estoque_${new Date().toISOString().split('T')[0]}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
    
    toast({
      title: "Arquivo Exportado",
      description: "Os dados de estoque foram exportados para CSV.",
    });
  };

  return (
    <DashboardLayout>
      <div className="flex-1 space-y-6 p-4 pt-6 md:p-8">
        {/* Header */}
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
            <Button onClick={handleExport} variant="outline" disabled={filteredData.length === 0}>
              <Download className="w-4 h-4 mr-2" />
              Exportar
            </Button>
          </div>
        </div>

        {/* Cards de Estatísticas */}
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
                ) : filteredData.length > 0 ? (
                    filteredData.map((item) => (
                        <TableRow key={item.produto.id}>
                            <TableCell className="font-medium">{item.produto.codigo}</TableCell>
                            <TableCell>{item.produto.nome}</TableCell>
                            <TableCell className="text-right font-bold">{item.saldoFisicoTotal}</TableCell>
                            <TableCell className="text-right font-bold">{item.saldoVirtualTotal}</TableCell>
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
                      Nenhum produto encontrado com os filtros atuais.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
