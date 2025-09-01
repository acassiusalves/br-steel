
'use client';

import * as React from 'react';
import DashboardLayout from '@/components/dashboard-layout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2 } from 'lucide-react';
import { getProductsStock } from '@/app/actions';
import type { ProductStock } from '@/app/actions';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';


export default function EstoquePage() {
  const [stockData, setStockData] = React.useState<ProductStock[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const { toast } = useToast();

  React.useEffect(() => {
    const fetchStockData = async () => {
      setIsLoading(true);
      try {
        const { data } = await getProductsStock();
        
        // The API returns stock per warehouse. We need to aggregate it per product.
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
            // If an item is already in the map, its total values should be the same
            // across all warehouse entries, so no need to sum them up.
        });
        
        setStockData(Array.from(aggregatedStock.entries()).map(([sku, value]) => ({
            produto: { id: value.productId, codigo: sku, nome: value.productName },
            saldoFisicoTotal: value.saldoFisicoTotal,
            saldoVirtualTotal: value.saldoVirtualTotal,
            // These fields are not needed for the aggregated view
            deposito: { id: 0, nome: ''},
            saldoFisico: 0,
            saldoVirtual: 0,
        })));

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
    };

    fetchStockData();
  }, [toast]);

  const StockStatusBadge = ({ physical, virtual }: { physical: number; virtual: number }) => {
    if (virtual <= 0) {
      return <Badge variant="destructive">Esgotado</Badge>;
    }
    if (virtual < 10) { // Example threshold for low stock
      return <Badge variant="secondary" className="bg-yellow-500 text-black">Estoque Baixo</Badge>;
    }
    return <Badge variant="default" className="bg-green-600">Em Estoque</Badge>;
  }

  return (
    <DashboardLayout>
      <div className="flex-1 space-y-8 p-4 pt-6 md:p-8">
        <div className="flex items-center justify-between">
            <div>
                <h2 className="text-3xl font-bold tracking-tight">Gestão de Estoque</h2>
                <p className="text-muted-foreground">
                    Visualize os níveis de estoque dos seus produtos em tempo real.
                </p>
            </div>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Níveis de Estoque por SKU</CardTitle>
            <CardDescription>
              A lista abaixo mostra o saldo de estoque físico e virtual para cada produto, consolidado de todos os depósitos.
            </CardDescription>
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
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center">
                      <Loader2 className="mx-auto h-6 w-6 animate-spin" />
                    </TableCell>
                  </TableRow>
                ) : stockData.length > 0 ? (
                    stockData.map((item) => (
                        <TableRow key={item.produto.id}>
                            <TableCell className="font-medium">{item.produto.codigo}</TableCell>
                            <TableCell>{item.produto.nome}</TableCell>
                            <TableCell className="text-right font-bold">{item.saldoFisicoTotal}</TableCell>
                            <TableCell className="text-right font-bold">{item.saldoVirtualTotal}</TableCell>
                            <TableCell>
                                <StockStatusBadge 
                                    physical={item.saldoFisicoTotal} 
                                    virtual={item.saldoVirtualTotal} 
                                />
                            </TableCell>
                        </TableRow>
                    ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center">
                      Nenhum dado de estoque encontrado. Verifique sua conexão com o Bling na <a href="/api" className="text-primary underline">página da API</a>.
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
