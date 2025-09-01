'use client';

import * as React from 'react';
import { Search, Download, RefreshCw, Package, AlertTriangle, CheckCircle, AlertCircle, Info, BellRing } from 'lucide-react';
import DashboardLayout from '@/components/dashboard-layout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
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
import { getProductsStock, getBlingCredentials } from '@/app/actions';
import type { ProductStock } from '@/app/actions';
import { useToast } from '@/hooks/use-toast';
import { ScrollArea } from '@/components/ui/scroll-area';

export default function EstoquePage() {
  const [stockData, setStockData] = React.useState<ProductStock[]>([]);
  const [filteredData, setFilteredData] = React.useState<ProductStock[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [searchTerm, setSearchTerm] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState('all');
  const [error, setError] = React.useState<string | null>(null);
  const [isConnected, setIsConnected] = React.useState(false);
  const [isSimulatedData, setIsSimulatedData] = React.useState(false);
  const [isAlertsModalOpen, setIsAlertsModalOpen] = React.useState(false);
  const { toast } = useToast();

  const fetchStockData = React.useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
        const credentials = await getBlingCredentials();
        const hasToken = !!credentials.accessToken;
        setIsConnected(hasToken);

        if (!hasToken) {
            setError('Não conectado ao Bling. Por favor, configure a conexão na página de API para visualizar o estoque.');
            setIsLoading(false);
            return;
        }

      const result = await getProductsStock();
      const data = result.data;
      const isSimulated = result.isSimulated || false;
      
      setIsSimulatedData(isSimulated);
      
      if (data.length === 0) {
          setError('Nenhum produto com estoque foi encontrado. Verifique se há produtos cadastrados com estoque no Bling.');
          setStockData([]);
          setIsLoading(false);
          return;
      }

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
          } else {
              const existing = aggregatedStock.get(sku)!;
              existing.saldoFisicoTotal += item.saldoFisico;
              existing.saldoVirtualTotal += item.saldoVirtual;
          }
      });
      
      const processedData = Array.from(aggregatedStock.entries()).map(([sku, value]) => ({
          produto: { id: value.productId, codigo: sku, nome: value.productName },
          saldoFisicoTotal: value.saldoFisicoTotal,
          saldoVirtualTotal: value.saldoVirtualTotal,
          deposito: { id: 0, nome: ''},
          saldoFisico: value.saldoFisicoTotal,
          saldoVirtual: value.saldoVirtualTotal,
      }));
      
      setStockData(processedData);

    } catch (error: any) {
      console.error("Failed to fetch stock data:", error);
      setError(error.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchStockData();
  }, [fetchStockData]);

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
    if(!error) {
        toast({
            title: "Dados Atualizados",
            description: "Os níveis de estoque foram sincronizados com o Bling.",
        });
    }
  };

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
                        <div key={item.produto.id} className="grid grid-cols-3 items-center gap-4">
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
              {!isConnected && (
                <div className="mt-2">
                  <Button asChild variant="outline" size="sm">
                    <a href="/api">Configurar Conexão</a>
                  </Button>
                </div>
              )}
            </AlertDescription>
          </Alert>
        )}

        {isSimulatedData && !error && (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              <strong>Dados Simulados:</strong> A API de estoque do Bling pode não estar disponível para sua conta. Usando dados simulados com base na sua lista de produtos.
            </AlertDescription>
          </Alert>
        )}

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total de Produtos</CardTitle>
              <Package className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {isLoading ? <Skeleton className="h-8 w-1/2" /> : <div className="text-2xl font-bold">{stats.total}</div>}
              <p className="text-xs text-muted-foreground">
                SKUs únicos {isSimulatedData ? '(simulado)' : 'cadastrados'}
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
                      Nenhum produto encontrado.
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

    