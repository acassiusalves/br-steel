
'use client';

import * as React from 'react';
import { PlusCircle, Loader2, RefreshCw } from 'lucide-react';
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
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { getBlingProducts } from '@/app/actions';

type BlingProduct = {
    id: number;
    nome: string;
    codigo: string;
}

export default function InsumosPage() {
  const [isLoading, setIsLoading] = React.useState(true);
  const [isFormOpen, setIsFormOpen] = React.useState(false);
  const [products, setProducts] = React.useState<BlingProduct[]>([]);
  const [isLoadingProducts, setIsLoadingProducts] = React.useState(false);

  const { toast } = useToast();

  const fetchProducts = React.useCallback(async () => {
    setIsLoadingProducts(true);
    try {
        const productData = await getBlingProducts(1000); // Fetch a good amount of products
        if (productData && productData.data) {
            setProducts(productData.data);
        }
    } catch (error: any) {
        toast({
            variant: 'destructive',
            title: 'Erro ao Buscar Produtos',
            description: error.message
        });
    } finally {
        setIsLoadingProducts(false);
    }
  }, [toast]);

  React.useEffect(() => {
    // Simula o carregamento de dados da página principal
    const timer = setTimeout(() => setIsLoading(false), 1000);
    
    // Busca produtos quando o componente é montado
    fetchProducts();
    
    return () => clearTimeout(timer);
  }, [fetchProducts]);
  
  const handleSaveSupply = (event: React.FormEvent) => {
    event.preventDefault();
    // TODO: Implementar lógica de salvamento
    toast({
        title: "Em Desenvolvimento",
        description: "A lógica para salvar o insumo ainda será implementada."
    });
    setIsFormOpen(false);
  }

  return (
    <DashboardLayout>
      <div className="flex-1 space-y-8 p-4 pt-6 md:p-8">
        <div className="flex items-center justify-between">
            <div>
                <h2 className="text-3xl font-bold tracking-tight">Gestão de Insumos</h2>
                <p className="text-muted-foreground">
                    Cadastre e gerencie os insumos utilizados na sua produção.
                </p>
            </div>
            <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
                <DialogTrigger asChild>
                    <Button>
                        <PlusCircle className="mr-2 h-4 w-4" />
                        Cadastrar Novo Insumo
                    </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-[425px]">
                    <form onSubmit={handleSaveSupply}>
                        <DialogHeader>
                            <DialogTitle>Cadastrar Novo Insumo</DialogTitle>
                            <DialogDescription>
                                Vincule um insumo a um produto e defina suas regras de estoque.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="grid gap-4 py-4">
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="produto" className="text-right">
                                    Produto
                                </Label>
                                <div className="col-span-3 flex items-center gap-2">
                                     <Select required>
                                        <SelectTrigger disabled={isLoadingProducts}>
                                            <SelectValue placeholder={isLoadingProducts ? "Carregando..." : "Selecione um produto"} />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {products.map(p => (
                                                <SelectItem key={p.id} value={String(p.id)}>
                                                    <span title={p.nome}>{p.nome}</span>
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <Button type="button" variant="ghost" size="icon" onClick={fetchProducts} disabled={isLoadingProducts}>
                                        <RefreshCw className={`h-4 w-4 ${isLoadingProducts ? 'animate-spin' : ''}`} />
                                    </Button>
                                </div>
                            </div>
                             <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="min-stock" className="text-right">
                                    Estoque Mínimo
                                </Label>
                                <Input id="min-stock" type="number" required className="col-span-3" />
                            </div>
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="max-stock" className="text-right">
                                    Estoque Máximo
                                </Label>
                                <Input id="max-stock" type="number" required className="col-span-3" />
                            </div>
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="delivery-time" className="text-right">
                                    Entrega (dias)
                                </Label>
                                <Input id="delivery-time" type="number" required className="col-span-3" placeholder="Tempo médio"/>
                            </div>
                        </div>
                        <DialogFooter>
                            <Button type="submit">Salvar Insumo</Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Insumos Cadastrados</CardTitle>
            <CardDescription>
              A lista abaixo mostra todos os insumos cadastrados no sistema.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome do Insumo</TableHead>
                  <TableHead>Unidade de Medida</TableHead>
                  <TableHead>Fornecedor Principal</TableHead>
                  <TableHead className="text-right">Custo Unitário</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center">
                      <Loader2 className="mx-auto h-6 w-6 animate-spin" />
                    </TableCell>
                  </TableRow>
                ) : (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center">
                      Nenhum insumo cadastrado. Comece clicando em "Cadastrar Novo Insumo".
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
