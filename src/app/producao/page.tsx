
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
import { getProductionDemand } from '@/app/actions';
import type { ProductionDemand } from '@/app/actions';

export default function ProducaoPage() {
  const [demand, setDemand] = React.useState<ProductionDemand[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);

  React.useEffect(() => {
    async function fetchData() {
      setIsLoading(true);
      try {
        const data = await getProductionDemand();
        setDemand(data);
      } catch (error) {
        console.error("Failed to fetch production demand:", error);
        // Here you might want to show a toast message to the user
      } finally {
        setIsLoading(false);
      }
    }
    fetchData();
  }, []);

  return (
    <DashboardLayout>
      <div className="flex-1 space-y-8 p-4 pt-6 md:p-8">
        <div className="flex items-center justify-between">
            <div>
                <h2 className="text-3xl font-bold tracking-tight">Análise para Produção</h2>
                <p className="text-muted-foreground">
                    Demanda de produtos baseada em vendas com Nota Fiscal emitida.
                </p>
            </div>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Demanda por SKU</CardTitle>
            <CardDescription>
              A lista abaixo mostra a quantidade total de cada produto vendido em pedidos que já tiveram a nota fiscal gerada.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Descrição do Produto</TableHead>
                  <TableHead className="text-right">Quantidade Vendida (com NF)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={3} className="h-24 text-center">
                      Carregando demanda de produção...
                    </TableCell>
                  </TableRow>
                ) : demand.length > 0 ? (
                  demand.map((item) => (
                    <TableRow key={item.sku}>
                      <TableCell className="font-medium">{item.sku}</TableCell>
                      <TableCell>{item.description}</TableCell>
                      <TableCell className="text-right font-bold">{item.quantity}</TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={3} className="h-24 text-center">
                      Nenhum item vendido com nota fiscal encontrada.
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
