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


// Tipagem para os dados do pedido que vêm do Bling (e salvos no Firestore)
interface SaleOrder {
  id: number;
  numero: number;
  numeroLoja: string;
  data: string;
  dataSaida: string;
  cliente: {
    nome: string;
    numeroDocumento?: string;
  };
  loja?: {
      nome: string;
  };
  situacao: {
    id: number;
    valor: number;
    nome: string;
  };
  totalProdutos: number;
  total: number;
}


// Função para buscar os pedidos do Firestore
async function getSalesFromFirestore(): Promise<SaleOrder[]> {
  try {
    const ordersCollection = collection(db, 'salesOrders');
    // Ordena os pedidos pela data, dos mais recentes para os mais antigos
    const q = query(ordersCollection, orderBy('data', 'desc'));
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      console.log("Nenhum pedido encontrado no Firestore.");
      return [];
    }

    const sales: SaleOrder[] = [];
    snapshot.forEach(doc => {
      // O doc.data() contém o objeto completo do pedido do Bling
      sales.push(doc.data() as SaleOrder);
    });
    
    return sales;
  } catch (error) {
    console.error("Erro ao buscar pedidos do Firestore:", error);
    return []; // Retorna um array vazio em caso de erro
  }
}

// Função para formatar a data
const formatDate = (dateString: string) => {
    if (!dateString) return 'N/A';
    try {
        const [year, month, day] = dateString.split('-');
        return `${day}/${month}/${year}`;
    } catch {
        return dateString; // Retorna a data original se o formato for inesperado
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
    if (statusName.toLowerCase().includes('entregue')) variant = "default";
    if (statusName.toLowerCase().includes('cancelado')) variant = "destructive";
    if (statusName.toLowerCase().includes('enviado')) variant = "outline";

    return <Badge variant={variant}>{statusName}</Badge>
}


export default async function VendasPage() {
  const sales = await getSalesFromFirestore();

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
              Uma lista dos seus pedidos de venda mais recentes sincronizados do Bling.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID Pedido</TableHead>
                  <TableHead>Nº Pedido</TableHead>
                  <TableHead>Nº Loja</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead>Data Saída</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Documento</TableHead>
                  <TableHead>Marketplace</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total Produtos</TableHead>
                  <TableHead className="text-right">Total Pedido</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sales.length > 0 ? (
                    sales.map((sale) => (
                        <TableRow key={sale.id}>
                            <TableCell className="font-medium">{sale.id}</TableCell>
                            <TableCell>{sale.numero || 'N/A'}</TableCell>
                            <TableCell>{sale.numeroLoja || 'N/A'}</TableCell>
                            <TableCell>{formatDate(sale.data)}</TableCell>
                            <TableCell>{formatDate(sale.dataSaida)}</TableCell>
                            <TableCell>{sale.cliente?.nome || 'N/A'}</TableCell>
                            <TableCell>{sale.cliente?.numeroDocumento || 'N/A'}</TableCell>
                            <TableCell>{sale.loja?.nome || 'N/A'}</TableCell>
                            <TableCell>
                                <StatusBadge statusName={sale.situacao?.nome || 'Desconhecido'} />
                            </TableCell>
                            <TableCell className="text-right">{formatCurrency(sale.totalProdutos)}</TableCell>
                            <TableCell className="text-right">{formatCurrency(sale.total)}</TableCell>
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
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
