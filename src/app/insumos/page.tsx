
'use client';

import * as React from 'react';
import { PlusCircle, Loader2, MoreHorizontal, Pencil, Trash2, Search, Package, AlertTriangle, CheckCircle, BellRing, Boxes, ShoppingCart, ArrowRightLeft } from 'lucide-react';
import DashboardLayout from '@/components/dashboard-layout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useSearchParams } from 'next/navigation';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Supply } from '@/types/supply';
import type { InventoryItem } from '@/types/inventory';
import { addSupply, updateSupply, deleteSupply } from '@/services/supply-service';
import { getInventory } from '@/services/inventory-service';


const CadastroInsumo = () => {
  const [isFormOpen, setIsFormOpen] = React.useState(false);
  const [supplies, setSupplies] = React.useState<Supply[]>([]);
  const [isSaving, setIsSaving] = React.useState(false);
  const [isLoadingSupplies, setIsLoadingSupplies] = React.useState(true);
  const [editingSupply, setEditingSupply] = React.useState<Supply | null>(null);
  const [deletingSupply, setDeletingSupply] = React.useState<Supply | null>(null);
  
  const { toast } = useToast();

  React.useEffect(() => {
      const q = query(collection(db, "supplies"), orderBy('nome', 'asc'));
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


  const handleOpenForm = (supply: Supply | null = null) => {
    setEditingSupply(supply);
    setIsFormOpen(true);
  }

  const handleCloseForm = () => {
    setEditingSupply(null);
    setIsFormOpen(false);
  }

  const handleSaveSupply = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSaving(true);
    
    const formData = new FormData(event.currentTarget);

    const supplyData: Omit<Supply, 'id'> = {
        nome: formData.get('nome') as string,
        codigo: formData.get('codigo') as string,
        gtin: formData.get('gtin') as string,
        unidade: formData.get('unidade') as string,
        precoCusto: Number(formData.get('precoCusto')),
        estoqueMinimo: Number(formData.get('min-stock')),
        estoqueMaximo: Number(formData.get('max-stock')),
        tempoEntrega: Number(formData.get('delivery-time')),
    };
    
    try {
        if (editingSupply) {
            await updateSupply(editingSupply.id, supplyData);
            toast({
                title: "Sucesso!",
                description: "O insumo foi atualizado com sucesso."
            });
        } else {
            await addSupply(supplyData);
            toast({
                title: "Sucesso!",
                description: "O insumo foi cadastrado com sucesso."
            });
        }
        handleCloseForm();
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

  const handleDeleteSupply = async () => {
    if (!deletingSupply) return;
    try {
        await deleteSupply(deletingSupply.id);
        toast({
            title: 'Insumo Apagado',
            description: `O insumo "${deletingSupply.nome}" foi removido.`
        });
        setDeletingSupply(null); // Fecha o AlertDialog
    } catch(error: any) {
         toast({
            variant: 'destructive',
            title: 'Erro ao Apagar',
            description: error.message
        });
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
            <Button onClick={() => handleOpenForm()}>
                <PlusCircle className="mr-2 h-4 w-4" />
                Cadastrar Novo Insumo
            </Button>
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
                  <TableHead>Código (SKU)</TableHead>
                  <TableHead>GTIN/EAN</TableHead>
                  <TableHead>Unidade</TableHead>
                  <TableHead className="text-right">Custo Unitário</TableHead>
                  <TableHead className="text-right">Estoque Mínimo</TableHead>
                  <TableHead className="text-right">Estoque Máximo</TableHead>
                  <TableHead className="text-right">Prazo (dias)</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoadingSupplies ? (
                    <TableRow>
                        <TableCell colSpan={9} className="h-24 text-center">
                            <Loader2 className="mx-auto h-6 w-6 animate-spin" />
                        </TableCell>
                    </TableRow>
                ) : supplies.length > 0 ? (
                    supplies.map(supply => (
                        <TableRow key={supply.id}>
                            <TableCell className="font-medium">{supply.nome}</TableCell>
                            <TableCell>{supply.codigo}</TableCell>
                            <TableCell>{supply.gtin}</TableCell>
                            <TableCell>{supply.unidade}</TableCell>
                            <TableCell className="text-right">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(supply.precoCusto || 0)}</TableCell>
                            <TableCell className="text-right">{supply.estoqueMinimo}</TableCell>
                            <TableCell className="text-right">{supply.estoqueMaximo}</TableCell>
                            <TableCell className="text-right">{supply.tempoEntrega}</TableCell>
                            <TableCell className="text-right">
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button variant="ghost" className="h-8 w-8 p-0">
                                            <span className="sr-only">Abrir menu</span>
                                            <MoreHorizontal className="h-4 w-4" />
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                        <DropdownMenuItem onClick={() => handleOpenForm(supply)}>
                                            <Pencil className="mr-2 h-4 w-4" />
                                            Editar
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => setDeletingSupply(supply)} className="text-red-600 focus:text-red-600">
                                            <Trash2 className="mr-2 h-4 w-4" />
                                            Apagar
                                        </DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </TableCell>
                        </TableRow>
                    ))
                ) : (
                    <TableRow>
                        <TableCell colSpan={9} className="h-24 text-center">
                        Nenhum insumo cadastrado. Comece clicando em "Cadastrar Novo Insumo".
                        </TableCell>
                    </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Dialog para Criar/Editar */}
        <Dialog open={isFormOpen} onOpenChange={(open) => { if(!open) handleCloseForm()}}>
            <DialogContent className="sm:max-w-[480px]" onInteractOutside={(e) => e.preventDefault()} onEscapeKeyDown={() => handleCloseForm()}>
                <form onSubmit={handleSaveSupply}>
                    <DialogHeader>
                        <DialogTitle>{editingSupply ? 'Editar Insumo' : 'Cadastrar Novo Insumo'}</DialogTitle>
                        <DialogDescription>
                            {editingSupply ? 'Altere os detalhes do insumo abaixo.' : 'Preencha os detalhes do insumo para adicioná-lo ao sistema.'}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="nome" className="text-right">Nome</Label>
                            <Input id="nome" name="nome" required defaultValue={editingSupply?.nome} className="col-span-3" />
                        </div>
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="codigo" className="text-right">Código (SKU)</Label>
                            <Input id="codigo" name="codigo" required defaultValue={editingSupply?.codigo} className="col-span-3" />
                        </div>
                         <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="gtin" className="text-right">GTIN/EAN</Label>
                            <Input id="gtin" name="gtin" defaultValue={editingSupply?.gtin} className="col-span-3" />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="unidade">Unidade</Label>
                                <Input id="unidade" name="unidade" required defaultValue={editingSupply?.unidade} placeholder="Ex: KG, UN, LT" />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="precoCusto">Preço de Custo</Label>
                                <Input id="precoCusto" name="precoCusto" type="number" step="0.01" required defaultValue={editingSupply?.precoCusto} placeholder="R$ 0,00" />
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                           <div className="space-y-2">
                                <Label htmlFor="min-stock">Estoque Mínimo</Label>
                                <Input id="min-stock" name="min-stock" type="number" required defaultValue={editingSupply?.estoqueMinimo} />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="max-stock">Estoque Máximo</Label>
                                <Input id="max-stock" name="max-stock" type="number" required defaultValue={editingSupply?.estoqueMaximo} />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="delivery-time">Tempo de Entrega (dias)</Label>
                            <Input id="delivery-time" name="delivery-time" type="number" required defaultValue={editingSupply?.tempoEntrega} placeholder="Tempo médio para o fornecedor entregar"/>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="ghost" onClick={handleCloseForm}>Cancelar</Button>
                        <Button type="submit" disabled={isSaving}>
                            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {editingSupply ? 'Salvar Alterações' : 'Salvar Insumo'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>

        {/* AlertDialog para Apagar */}
         <AlertDialog open={!!deletingSupply} onOpenChange={(open) => !open && setDeletingSupply(null)}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Você tem certeza?</AlertDialogTitle>
                    <AlertDialogDescription>
                        Esta ação não pode ser desfeita. Isso irá apagar permanentemente o insumo
                        <span className="font-bold"> "{deletingSupply?.nome}"</span> do banco de dados.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={handleDeleteSupply} className="bg-destructive hover:bg-destructive/90">
                        Apagar
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>

      </div>
  )
}

const formatCurrency = (value: number | undefined) => {
    return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
    }).format(value || 0);
}

const StockStatusBadge = ({ item }: { item: InventoryItem }) => {
    if (item.estoqueAtual <= 0) {
      return (
        <Badge variant="destructive" className="flex items-center gap-1 whitespace-nowrap">
          <AlertTriangle className="w-3 h-3" /> Esgotado
        </Badge>
      );
    }
    if (item.estoqueAtual < item.estoqueMinimo) {
      return (
        <Badge variant="secondary" className="bg-yellow-400 text-yellow-900 flex items-center gap-1 whitespace-nowrap hover:bg-yellow-400/80">
          <AlertTriangle className="w-3 h-3" /> Estoque Baixo
        </Badge>
      );
    }
    return (
      <Badge variant="default" className="bg-green-600 flex items-center gap-1 whitespace-nowrap hover:bg-green-700">
        <CheckCircle className="w-3 h-3" /> Em Estoque
      </Badge>
    );
};

const EstoqueInsumo = () => {
    const [inventory, setInventory] = React.useState<InventoryItem[]>([]);
    const [filteredInventory, setFilteredInventory] = React.useState<InventoryItem[]>([]);
    const [isLoading, setIsLoading] = React.useState(true);
    const [searchTerm, setSearchTerm] = React.useState('');
    const { toast } = useToast();

    const fetchInventory = React.useCallback(async () => {
        setIsLoading(true);
        try {
            const data = await getInventory();
            setInventory(data);
            setFilteredInventory(data);
        } catch (error: any) {
            toast({
                variant: 'destructive',
                title: 'Erro ao buscar estoque',
                description: error.message
            });
        } finally {
            setIsLoading(false);
        }
    }, [toast]);

    React.useEffect(() => {
        fetchInventory();
    }, [fetchInventory]);

    React.useEffect(() => {
        const filtered = inventory.filter(item => {
            const term = searchTerm.toLowerCase();
            const nameMatch = item.supply?.nome?.toLowerCase().includes(term) || false;
            const codeMatch = item.supply?.codigo?.toLowerCase().includes(term) || false;
            return nameMatch || codeMatch;
        });
        setFilteredInventory(filtered);
    }, [searchTerm, inventory]);

    const stats = React.useMemo(() => {
        const totalValue = inventory.reduce((acc, item) => acc + item.valorEmEstoque, 0);
        const lowStockCount = inventory.filter(item => item.estoqueAtual > 0 && item.estoqueAtual < item.estoqueMinimo).length;
        const outOfStockCount = inventory.filter(item => item.estoqueAtual <= 0).length;
        return { totalValue, lowStockCount, outOfStockCount };
    }, [inventory]);

    return (
        <div className="space-y-8">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Estoque de Insumos</h2>
                    <p className="text-muted-foreground">
                        Visualize e gerencie o estoque atual dos seus insumos.
                    </p>
                </div>
                 <div className="flex items-center gap-2">
                    <Button variant="outline"><ShoppingCart className="mr-2" /> Gerar Ordem de Compra</Button>
                    <Button><ArrowRightLeft className="mr-2" /> Nova Entrada/Saída</Button>
                </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Valor Total em Estoque</CardTitle>
                    <Package className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                    {isLoading ? <Skeleton className="h-8 w-3/4" /> : <div className="text-2xl font-bold">{formatCurrency(stats.totalValue)}</div>}
                    <p className="text-xs text-muted-foreground">Custo total dos insumos em estoque</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Itens com Estoque Baixo</CardTitle>
                    <AlertTriangle className="h-4 w-4 text-yellow-500" />
                    </CardHeader>
                    <CardContent>
                    {isLoading ? <Skeleton className="h-8 w-1/2" /> : <div className="text-2xl font-bold">{stats.lowStockCount}</div>}
                    <p className="text-xs text-muted-foreground">Insumos abaixo do estoque mínimo</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Itens Esgotados</CardTitle>
                    <AlertTriangle className="h-4 w-4 text-red-500" />
                    </CardHeader>
                    <CardContent>
                    {isLoading ? <Skeleton className="h-8 w-1/2" /> : <div className="text-2xl font-bold">{stats.outOfStockCount}</div>}
                    <p className="text-xs text-muted-foreground">Insumos com estoque zerado ou negativo</p>
                    </CardContent>
                </Card>
            </div>
            
            <Card>
                <CardHeader>
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                        <div>
                            <CardTitle>Visão Geral do Estoque de Insumos</CardTitle>
                            <CardDescription>A lista abaixo mostra os níveis de estoque para cada insumo.</CardDescription>
                        </div>
                        <div className="relative">
                            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input 
                                placeholder="Buscar por nome ou SKU..." 
                                className="pl-8 w-full md:w-64"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                     <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Insumo</TableHead>
                                <TableHead>SKU</TableHead>
                                <TableHead className="text-right">Estoque Atual</TableHead>
                                <TableHead className="text-right">Estoque Mínimo</TableHead>
                                <TableHead className="text-right">Valor em Estoque</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead className="text-right">Ações</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoading ? (
                                Array.from({ length: 5 }).map((_, i) => (
                                    <TableRow key={i}>
                                        <TableCell colSpan={7}><Skeleton className="h-5 w-full" /></TableCell>
                                    </TableRow>
                                ))
                            ) : filteredInventory.length > 0 ? (
                                filteredInventory.map(item => (
                                <TableRow key={item.supply.id}>
                                    <TableCell className="font-medium">{item.supply.nome}</TableCell>
                                    <TableCell>{item.supply.codigo}</TableCell>
                                    <TableCell className="text-right font-bold">{item.estoqueAtual} {item.supply.unidade}</TableCell>
                                    <TableCell className="text-right">{item.estoqueMinimo} {item.supply.unidade}</TableCell>
                                    <TableCell className="text-right">{formatCurrency(item.valorEmEstoque)}</TableCell>
                                    <TableCell><StockStatusBadge item={item} /></TableCell>
                                    <TableCell className="text-right">
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button variant="ghost" className="h-8 w-8 p-0">
                                                    <span className="sr-only">Abrir menu</span>
                                                    <MoreHorizontal className="h-4 w-4" />
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end">
                                                <DropdownMenuItem>Ver Histórico</DropdownMenuItem>
                                                <DropdownMenuItem>Ajustar Estoque</DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </TableCell>
                                </TableRow>
                                ))
                            ) : (
                                <TableRow>
                                    <TableCell colSpan={7} className="h-24 text-center">
                                        Nenhum insumo encontrado.
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
