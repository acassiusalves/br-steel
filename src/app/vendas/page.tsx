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

const mockSales = [
  { id: 'PED-001', date: '25/07/2024', customer: 'João da Silva', marketplace: 'Mercado Livre', total: 'R$ 150,00', status: 'Enviado' },
  { id: 'PED-002', date: '25/07/2024', customer: 'Maria Oliveira', marketplace: 'Amazon', total: 'R$ 89,90', status: 'Processando' },
  { id: 'PED-003', date: '24/07/2024', customer: 'Carlos Pereira', marketplace: 'Magazine Luiza', total: 'R$ 299,99', status: 'Entregue' },
  { id: 'PED-004', date: '24/07/2024', customer: 'Ana Costa', marketplace: 'Mercado Livre', total: 'R$ 45,50', status: 'Cancelado' },
  { id: 'PED-005', date: '23/07/2024', customer: 'Pedro Martins', marketplace: 'Amazon', total: 'R$ 1.200,00', status: 'Entregue' },
];


export default function VendasPage() {
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
            <CardTitle>Últimos Pedidos</CardTitle>
            <CardDescription>
              Uma lista dos seus pedidos de venda mais recentes.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pedido</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Marketplace</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mockSales.map((sale) => (
                    <TableRow key={sale.id}>
                        <TableCell className="font-medium">{sale.id}</TableCell>
                        <TableCell>{sale.date}</TableCell>
                        <TableCell>{sale.customer}</TableCell>
                        <TableCell>{sale.marketplace}</TableCell>
                        <TableCell>{sale.status}</TableCell>
                        <TableCell className="text-right">{sale.total}</TableCell>
                    </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
