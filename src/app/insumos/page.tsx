
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
import { useSearchParams } from 'next/navigation';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Supply } from '@/types/supply';
import { addSupply } from '@/services/supply-service';


type BlingProduct = {
    id: number;
    nome: string;
    codigo: string;
}

const CadastroInsumo = () => {
  const [isFormOpen, setIsFormOpen] = React.useState(false);
  const [products, setProducts] = React.useState<BlingProduct[]>([]);
  const [supplies, setSupplies] = React.useState<Supply[]>([]);
  const [isLoadingProducts, setIsLoadingProducts] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);
  const [isLoadingSupplies, setIsLoadingSupplies] = React.useState(true);
  
  const { toast } = useToast();

  const fetchProducts = React.useCallback(async () => {
    setIsLoadingProducts(true);
    try {
        const productData = await getBlingProducts(1000);
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
    fetchProducts();
  }, [fetchProducts]);
  
  React.useEffect(() => {
      const q = query(collection(db, "supplies"), orderBy('produto.nome', 'asc'));
      const unsubscribe = onSnapshot(q, (querySnapshot) => {
          const suppliesData: Supply[] = [];
          querySnapshot.forEach((doc) => {
              suppliesData.push({ id: doc.id, ...(doc.data() as Omit<Supply, 'id'>) });
          });
          setSupplies(suppliesData);
          setIsLoadingSupplies(false);
      }, (error) => {
          console.error("Error fetching supplies:", error);
          toast({
              variant: 'destructive',
              title: 'Erro ao Listar Insumos',
              description: 'Não foi possível buscar os insumos cadastrados.'
          });
          setIsLoadingSupplies(false);
      });

      return () => unsubscribe();
  }, [toast]);


  const handleSaveSupply = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSaving(true);
    
    const formData = new FormData(event.currentTarget);
    const productId = formData.get('produto-id') as string;
    const productName = products.find(p => String(p.id) === productId)?.nome || 'Nome não encontrado';

    const supplyData: Omit<Supply, 'id'> = {
        produto: {
            id: productId,
            nome: productName
        },
        estoqueMinimo: Number(formData.get('min-stock')),
        estoqueMaximo: Number(formData.get('max-stock')),
        tempoEntrega: Number(formData.get('delivery-time')),
        custoUnitario: 0, // Campo removido do form
        fornecedor: '', // Campo removido do form
    };
    
    try {
        await addSupply(supplyData);
        toast({
            title: "Sucesso!",
            description: "O insumo foi cadastrado com sucesso."
        });
        setIsFormOpen(false);
    } catch (error: any) {
         toast({
            variant: 'destructive',
            title: 'Erro ao Salvar',
            description: error.message
        });
    } finally {
        setIsSaving(false);
    }
  }
  
  return (
      <div className="space-y-8">
        <div className="flex items-center justify-between">
            <div>
                <h2 className="text-3xl font-bold tracking-tight">Cadastro de Insumos</h2>
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
                                <Label htmlFor="produto-id" className="text-right">
                                    Produto
                                </Label>
                                <div className="col-span-3 flex items-center gap-2">
                                     <Select name="produto-id" required>
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
                                <Input id="min-stock" name="min-stock" type="number" required className="col-span-3" />
                            </div>
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="max-stock" className="text-right">
                                    Estoque Máximo
                                </Label>
                                <Input id="max-stock" name="max-stock" type="number" required className="col-span-3" />
                            </div>
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="delivery-time" className="text-right">
                                    Entrega (dias)
                                </Label>
                                <Input id="delivery-time" name="delivery-time" type="number" required className="col-span-3" placeholder="Tempo médio"/>
                            </div>
                        </div>
                        <DialogFooter>
                            <Button type="submit" disabled={isSaving}>
                                {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                Salvar Insumo
                            </Button>
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
                  <TableHead>Nome do Insumo (Produto)</TableHead>
                  <TableHead className="text-right">Estoque Mínimo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoadingSupplies ? (
                    <TableRow>
                        <TableCell colSpan={4} className="h-24 text-center">
                            <Loader2 className="mx-auto h-6 w-6 animate-spin" />
                        </TableCell>
                    </TableRow>
                ) : supplies.length > 0 ? (
                    supplies.map(supply => (
                        <TableRow key={supply.id}>
                            <TableCell className="font-medium">{supply.produto.nome}</TableCell>
                            <TableCell className="text-right">{supply.estoqueMinimo}</TableCell>
                        </TableRow>
                    ))
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
  )
}

const EstoqueInsumo = () => {
    return (
        <div className="space-y-8">
            <div>
                <h2 className="text-3xl font-bold tracking-tight">Estoque de Insumos</h2>
                <p className="text-muted-foreground">
                    Visualize o estoque atual dos seus insumos.
                </p>
            </div>
            <Card>
                <CardHeader>
                    <CardTitle>Níveis de Estoque</CardTitle>
                    <CardDescription>
                        A lista abaixo mostra os níveis de estoque para cada insumo.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                     <Table>
                        <TableHeader>
                            <TableRow>
                            <TableHead>Nome do Insumo</TableHead>
                            <TableHead>Estoque Atual</TableHead>
                            <TableHead>Status</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            <TableRow>
                                <TableCell colSpan={3} className="h-24 text-center">
                                    Funcionalidade em desenvolvimento.
                                </TableCell>
                            </TableRow>
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    )
}

export default function InsumosPage() {
  const searchParams = useSearchParams();
  const tab = searchParams.get('tab') || 'cadastro'; 

  return (
    <DashboardLayout>
      <div className="flex-1 p-4 pt-6 md:p-8">
        {tab === 'cadastro' ? <CadastroInsumo /> : <EstoqueInsumo />}
      </div>
    </DashboardLayout>
  );
}
