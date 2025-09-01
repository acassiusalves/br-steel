
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
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Badge } from '@/components/ui/badge';
import SaleOrderDetailModal from '@/components/sale-order-detail-modal';
import type { SaleOrder } from '@/types/sale-order';


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
const formatCurrency = (value: number) => {
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

export default function VendasPage() {
  const [sales, setSales] = React.useState<SaleOrder[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [selectedOrder, setSelectedOrder] = React.useState<SaleOrder | null>(null);

  React.useEffect(() => {
    async function fetchData() {
      setIsLoading(true);
      const data = await getSalesFromFirestore();
      setSales(data);
      setIsLoading(false);
    }
    fetchData();
  }, []);

  const handleRowClick = (sale: SaleOrder) => {
    setSelectedOrder(sale);
  };

  const handleModalClose = () => {
    setSelectedOrder(null);
  };

  return (
    <DashboardLayout>
      <div className="flex-1 space-y-8 p-4 pt-6 md:p-8">
        <div className="flex items-center justify-between">
            <div>
                <h2 className="text-3xl font-bold tracking-tight">Vendas</h2>
                <p className="text-muted-foreground">
                    Liste e gerencie todos os pedidos de venda dos seus marketplaces.
                </p>
            </div>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Últimos Pedidos Importados</CardTitle>
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
                    <TableHead>Itens</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Vendedor</TableHead>
                    <TableHead className="text-right">Total Pedido</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                     <TableRow>
                        <TableCell colSpan={10} className="text-center h-24">
                           Carregando pedidos...
                        </TableCell>
                    </TableRow>
                  ) : sales.length > 0 ? (
                      sales.map((sale) => (
                          <TableRow key={sale.id} onClick={() => handleRowClick(sale)} className="cursor-pointer">
                              <TableCell className="font-medium">{sale.id}</TableCell>
                              <TableCell>{sale.numero || 'N/A'}</TableCell>
                              <TableCell>{sale.numeroLoja || 'N/A'}</TableCell>
                              <TableCell className="whitespace-nowrap">{formatDate(sale.data)}</TableCell>
                              <TableCell>{sale.contato?.nome || 'N/A'}</TableCell>
                              <TableCell>{sale.loja?.nome || 'N/A'}</TableCell>
                              <TableCell>
                                {sale.itens && sale.itens.length > 0 ? (
                                  <ul className="text-xs space-y-1">
                                    {sale.itens.map((item, index) => (
                                      <li key={item.produto?.id || index} title={item.descricao} className="flex items-start gap-2">
                                        <span className="font-bold">{item.quantidade}x</span>
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
                          <TableCell colSpan={10} className="text-center h-24">
                             Nenhum pedido encontrado. <a href="/api" className="text-primary underline">Importe seus pedidos aqui.</a>
                          </TableCell>
                      </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
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
