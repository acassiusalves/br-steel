

'use client';

import * as React from 'react';
import { Suspense } from 'react';
import { PlusCircle, Loader2, MoreHorizontal, Pencil, Trash2, Search, Package, AlertTriangle, CheckCircle, BellRing, Boxes, ShoppingCart, ArrowRightLeft, Calendar as CalendarIcon, ArrowUp, ArrowDown } from 'lucide-react';
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
import { collection, query, orderBy, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Supply } from '@/types/supply';
import type { InventoryItem } from '@/types/inventory';
import { addSupply, updateSupply, deleteSupply } from '@/services/supply-service';
import { addInventoryMovement } from '@/services/inventory-service';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';


const CadastroInsumo = ({ supplies, isLoading, fetchSupplies, onAction }: { 
    supplies: Supply[], 
    isLoading: boolean, 
    fetchSupplies: () => void,
    onAction: () => void
}) => {
  const [isFormOpen, setIsFormOpen] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);
  const [editingSupply, setEditingSupply] = React.useState<Supply | null>(null);
  const [deletingSupply, setDeletingSupply] = React.useState<Supply | null>(null);
  
  const { toast } = useToast();

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

    const supplyData: Omit<Supply, 'id' | 'estoqueAtual'> = {
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
        onAction(); // Trigger parent data refresh
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
        onAction(); // Trigger parent data refresh
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
                {isLoading ? (
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

const EstoqueInsumo = ({ inventory, isLoading, fetchSupplies, onAction }: { 
    inventory: InventoryItem[], 
    isLoading: boolean,
    fetchSupplies: () => void,
    onAction: () => void
}) => {
    const [filteredInventory, setFilteredInventory] = React.useState<InventoryItem[]>([]);
    const [isSaving, setIsSaving] = React.useState(false);
    const [searchTerm, setSearchTerm] = React.useState('');
    const [isMovementDialogOpen, setIsMovementDialogOpen] = React.useState(false);
    const [movementType, setMovementType] = React.useState<'entrada' | 'saida'>('entrada');
    const { toast } = useToast();
    
    React.useEffect(() => {
        const filtered = inventory.filter(item => {
            const term = searchTerm.toLowerCase();
            const nameMatch = item.supply?.nome?.toLowerCase().includes(term);
            const codeMatch = item.supply?.codigo?.toLowerCase().includes(term);
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

    const handleSaveMovement = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setIsSaving(true);
        const formData = new FormData(event.currentTarget);
        
        const supplyId = formData.get('insumo') as string;
        const quantity = Number(formData.get('quantidade'));
        const unitCost = formData.get('custoUnitario') ? Number(formData.get('custoUnitario')) : undefined;
        const notes = formData.get('observacao') as string;

        if (!supplyId || !quantity) {
            toast({ variant: 'destructive', title: "Dados incompletos", description: "Selecione o insumo e a quantidade." });
            setIsSaving(false);
            return;
        }

        try {
            await addInventoryMovement({
                supplyId,
                type: movementType,
                quantity,
                unitCost,
                notes,
            });

            toast({ title: "Sucesso!", description: `Movimentação de ${movementType} registrada.` });
            setIsMovementDialogOpen(false);
            onAction(); // Re-fetch data after successful movement

        } catch (error: any) {
             toast({
                variant: 'destructive',
                title: 'Erro ao Salvar Movimentação',
                description: error.message
            });
        } finally {
            setIsSaving(false);
        }
    }

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
                    <Dialog open={isMovementDialogOpen} onOpenChange={setIsMovementDialogOpen}>
                        <DialogTrigger asChild>
                            <Button><ArrowRightLeft className="mr-2" /> Nova Entrada/Saída</Button>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-md">
                           <form onSubmit={handleSaveMovement}>
                                <DialogHeader>
                                    <DialogTitle>Registrar Movimentação de Insumo</DialogTitle>
                                    <DialogDescription>
                                        Selecione o tipo de movimentação e preencha os detalhes abaixo.
                                    </DialogDescription>
                                </DialogHeader>
                                <div className="space-y-4 py-4">
                                    <div className="space-y-2">
                                        <Label>Tipo de Movimentação</Label>
                                        <RadioGroup 
                                            value={movementType} 
                                            onValueChange={(value: 'entrada' | 'saida') => setMovementType(value)}
                                            className="grid grid-cols-2 gap-4"
                                        >
                                            <div>
                                                <RadioGroupItem value="entrada" id="entrada" className="peer sr-only" />
                                                <Label htmlFor="entrada" className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">
                                                    <ArrowDown className="mb-3 h-6 w-6 text-green-500"/>
                                                    Entrada
                                                </Label>
                                            </div>
                                            <div>
                                                <RadioGroupItem value="saida" id="saida" className="peer sr-only" />
                                                <Label htmlFor="saida" className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">
                                                    <ArrowUp className="mb-3 h-6 w-6 text-red-500"/>
                                                    Saída
                                                </Label>
                                            </div>
                                        </RadioGroup>
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="insumo">Insumo</Label>
                                        <Select name="insumo" required>
                                            <SelectTrigger>
                                                <SelectValue placeholder="Selecione um insumo" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {inventory.map(item => (
                                                    <SelectItem key={item.supply.id} value={item.supply.id}>
                                                        {item.supply.nome} ({item.supply.codigo})
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                     <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <Label htmlFor="quantidade">Quantidade</Label>
                                            <Input id="quantidade" name="quantidade" type="number" required placeholder="0"/>
                                        </div>
                                        {movementType === 'entrada' && (
                                            <div className="space-y-2">
                                                <Label htmlFor="custoUnitario">Custo Unitário</Label>
                                                <Input id="custoUnitario" name="custoUnitario" type="number" step="0.01" placeholder="R$ 0,00" />
                                            </div>
                                        )}
                                    </div>
                                     <div className="space-y-2">
                                        <Label htmlFor="observacao">Observação</Label>
                                        <Textarea id="observacao" name="observacao" placeholder="Ex: Compra do fornecedor X, NF 123..."/>
                                    </div>
                                </div>
                                <DialogFooter>
                                    <Button type="button" variant="ghost" onClick={() => setIsMovementDialogOpen(false)}>Cancelar</Button>
                                    <Button type="submit" disabled={isSaving}>
                                      {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                      Salvar Movimentação
                                    </Button>
                                </DialogFooter>
                            </form>
                        </DialogContent>
                    </Dialog>
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

function InsumosTabView({
  supplies,
  inventory,
  isLoading,
  fetchSupplies,
}: {
  supplies: Supply[];
  inventory: InventoryItem[];
  isLoading: boolean;
  fetchSupplies: () => void;
}) {
  const searchParams = useSearchParams();
  const tab = searchParams.get('tab') || 'cadastro';

  return tab === 'cadastro' ? (
    <CadastroInsumo
      supplies={supplies}
      isLoading={isLoading}
      fetchSupplies={fetchSupplies}
      onAction={fetchSupplies}
    />
  ) : (
    <EstoqueInsumo
      inventory={inventory}
      isLoading={isLoading}
      fetchSupplies={fetchSupplies}
      onAction={fetchSupplies}
    />
  );
}

export default function InsumosPage() {
  const [supplies, setSupplies] = React.useState<Supply[]>([]);
  const [inventory, setInventory] = React.useState<InventoryItem[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const { toast } = useToast();

  const fetchSupplies = React.useCallback(async () => {
    setIsLoading(true);
    try {
        const q = query(collection(db, "supplies"), orderBy('nome', 'asc'));
        const querySnapshot = await getDocs(q);

        const suppliesData: Supply[] = [];
        const inventoryItems: InventoryItem[] = [];

        querySnapshot.forEach(doc => {
            const supply = { id: doc.id, ...doc.data() } as Supply;
            suppliesData.push(supply);

            const estoqueAtual = supply.estoqueAtual || 0;
            const valorEmEstoque = estoqueAtual > 0 ? estoqueAtual * supply.precoCusto : 0;
            inventoryItems.push({
                supply: supply,
                estoqueAtual: estoqueAtual,
                estoqueMinimo: supply.estoqueMinimo,
                valorEmEstoque: valorEmEstoque,
                status: estoqueAtual <= 0 ? 'esgotado' : (estoqueAtual < supply.estoqueMinimo ? 'baixo' : 'em_estoque'),
            });
        });
        
        setSupplies(suppliesData);
        setInventory(inventoryItems);

    } catch (error) {
        console.error("Error fetching supplies:", error);
        toast({
            variant: 'destructive',
            title: 'Erro ao Buscar Dados',
            description: 'Não foi possível carregar os insumos e o estoque.'
        });
    } finally {
        setIsLoading(false);
    }
  }, [toast]);
  
  React.useEffect(() => {
    fetchSupplies();
  }, [fetchSupplies]);


  return (
    <DashboardLayout>
      <div className="flex-1 p-4 pt-6 md:p-8">
        <Suspense fallback={<div className="p-4">Carregando…</div>}>
          <InsumosTabView
            supplies={supplies}
            inventory={inventory}
            isLoading={isLoading}
            fetchSupplies={fetchSupplies}
          />
        </Suspense>
      </div>
    </DashboardLayout>
  );
}
