
'use client';

import * as React from 'react';
import { PlusCircle, Loader2, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { useSearchParams } from 'next/navigation';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Supply } from '@/types/supply';
import { addSupply, updateSupply, deleteSupply } from '@/services/supply-service';


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
                  <TableHead className="text-right">Estoque Mínimo</TableHead>
                  <TableHead className="text-right">Estoque Máximo</TableHead>
                  <TableHead className="text-right">Entrega (dias)</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoadingSupplies ? (
                    <TableRow>
                        <TableCell colSpan={7} className="h-24 text-center">
                            <Loader2 className="mx-auto h-6 w-6 animate-spin" />
                        </TableCell>
                    </TableRow>
                ) : supplies.length > 0 ? (
                    supplies.map(supply => (
                        <TableRow key={supply.id}>
                            <TableCell className="font-medium">{supply.nome}</TableCell>
                            <TableCell>{supply.codigo}</TableCell>
                            <TableCell>{supply.gtin}</TableCell>
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
                                        <DropdownMenuItem onClick={() => setDeletingSupply(supply)} className="text-red-600">
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
                        <TableCell colSpan={7} className="h-24 text-center">
                        Nenhum insumo cadastrado. Comece clicando em "Cadastrar Novo Insumo".
                        </TableCell>
                    </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Dialog para Criar/Editar */}
        <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
            <DialogContent className="sm:max-w-[425px]" onInteractOutside={(e) => e.preventDefault()} onEscapeKeyDown={() => handleCloseForm()}>
                <form onSubmit={handleSaveSupply}>
                    <DialogHeader>
                        <DialogTitle>{editingSupply ? 'Editar Insumo' : 'Cadastrar Novo Insumo'}</DialogTitle>
                        <DialogDescription>
                            {editingSupply ? 'Altere os detalhes do insumo abaixo.' : 'Preencha os detalhes do insumo para adicioná-lo ao sistema.'}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                         <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="nome" className="text-right">
                                Nome
                            </Label>
                            <Input id="nome" name="nome" required defaultValue={editingSupply?.nome} className="col-span-3" />
                        </div>
                         <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="codigo" className="text-right">
                                Código (SKU)
                            </Label>
                            <Input id="codigo" name="codigo" required defaultValue={editingSupply?.codigo} className="col-span-3" />
                        </div>
                         <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="min-stock" className="text-right">
                                Estoque Mínimo
                            </Label>
                            <Input id="min-stock" name="min-stock" type="number" required defaultValue={editingSupply?.estoqueMinimo} className="col-span-3" />
                        </div>
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="max-stock" className="text-right">
                                Estoque Máximo
                            </Label>
                            <Input id="max-stock" name="max-stock" type="number" required defaultValue={editingSupply?.estoqueMaximo} className="col-span-3" />
                        </div>
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="delivery-time" className="text-right">
                                Entrega (dias)
                            </Label>
                            <Input id="delivery-time" name="delivery-time" type="number" required defaultValue={editingSupply?.tempoEntrega} className="col-span-3" placeholder="Tempo médio"/>
                        </div>
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="gtin" className="text-right">
                                GTIN/EAN
                            </Label>
                            <Input id="gtin" name="gtin" defaultValue={editingSupply?.gtin} className="col-span-3" />
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
