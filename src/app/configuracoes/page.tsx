
'use client';

import * as React from 'react';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import DashboardLayout from '@/components/dashboard-layout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PlusCircle, Trash2, Loader2 } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { getUsers, addUser, deleteUser, seedUsers } from '@/app/actions';
import type { User } from '@/types/user';


function UsersTabContent() {
    const [users, setUsers] = React.useState<User[]>([]);
    const [isLoading, setIsLoading] = React.useState(true);
    const [isFormOpen, setIsFormOpen] = React.useState(false);
    const [isSaving, setIsSaving] = React.useState(false);
    const [deletingUser, setDeletingUser] = React.useState<User | null>(null);
    const { toast } = useToast();

    const fetchUsers = React.useCallback(async () => {
        setIsLoading(true);
        try {
            const userList = await getUsers();
            setUsers(userList);
        } catch (error: any) {
            toast({
                variant: 'destructive',
                title: 'Erro ao buscar usuários',
                description: error.message,
            });
        } finally {
            setIsLoading(false);
        }
    }, [toast]);
    
    // Seed initial users on first load if collection is empty
    React.useEffect(() => {
        const initializeUsers = async () => {
            await seedUsers();
            fetchUsers();
        };
        initializeUsers();
    }, [fetchUsers]);


    const handleSaveUser = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setIsSaving(true);
        const formData = new FormData(event.currentTarget);
        const userData = {
            name: formData.get('name') as string,
            email: formData.get('email') as string,
            role: formData.get('role') as string,
        };

        try {
            await addUser(userData);
            toast({
                title: 'Usuário Adicionado!',
                description: 'O novo usuário foi cadastrado com sucesso.'
            });
            setIsFormOpen(false);
            fetchUsers(); // Refresh list
        } catch (error: any) {
            toast({
                variant: 'destructive',
                title: 'Erro ao Adicionar',
                description: error.message,
            });
        } finally {
            setIsSaving(false);
        }
    };

    const handleDeleteUser = async () => {
        if (!deletingUser) return;
        try {
            await deleteUser(deletingUser.id);
            toast({
                title: 'Usuário Removido',
                description: `O usuário "${deletingUser.name}" foi removido com sucesso.`
            });
            setDeletingUser(null);
            fetchUsers(); // Refresh list
        } catch (error: any) {
            toast({
                variant: 'destructive',
                title: 'Erro ao Remover',
                description: error.message,
            });
        }
    };


    return (
        <>
            <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                        <CardTitle>Gerenciamento de Usuários</CardTitle>
                        <CardDescription>
                            Adicione, edite ou remova usuários do sistema.
                        </CardDescription>
                    </div>
                     <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
                        <DialogTrigger asChild>
                            <Button>
                                <PlusCircle className="mr-2 h-4 w-4" />
                                Adicionar Usuário
                            </Button>
                        </DialogTrigger>
                        <DialogContent>
                             <form onSubmit={handleSaveUser}>
                                <DialogHeader>
                                    <DialogTitle>Adicionar Novo Usuário</DialogTitle>
                                    <DialogDescription>
                                        Preencha os dados abaixo para criar um novo acesso.
                                    </DialogDescription>
                                </DialogHeader>
                                <div className="grid gap-4 py-4">
                                    <div className="space-y-2">
                                        <Label htmlFor="name">Nome</Label>
                                        <Input id="name" name="name" required />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="email">E-mail</Label>
                                        <Input id="email" name="email" type="email" required />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="role">Função</Label>
                                        <Select name="role" required defaultValue="Vendedor">
                                            <SelectTrigger>
                                                <SelectValue placeholder="Selecione a função" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="Administrador">Administrador</SelectItem>
                                                <SelectItem value="Vendedor">Vendedor</SelectItem>
                                                <SelectItem value="Operador">Operador</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>
                                <DialogFooter>
                                    <Button type="button" variant="ghost" onClick={() => setIsFormOpen(false)}>Cancelar</Button>
                                    <Button type="submit" disabled={isSaving}>
                                        {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                        Salvar Usuário
                                    </Button>
                                </DialogFooter>
                            </form>
                        </DialogContent>
                    </Dialog>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Nome</TableHead>
                                <TableHead>Email</TableHead>
                                <TableHead>Função</TableHead>
                                <TableHead className="text-right">Ações</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoading ? (
                                <TableRow>
                                    <TableCell colSpan={4} className="h-24 text-center">
                                        <Loader2 className="mx-auto h-6 w-6 animate-spin" />
                                    </TableCell>
                                </TableRow>
                            ) : users.length > 0 ? (
                                users.map(user => (
                                    <TableRow key={user.id}>
                                        <TableCell className="font-medium">{user.name}</TableCell>
                                        <TableCell>{user.email}</TableCell>
                                        <TableCell>{user.role}</TableCell>
                                        <TableCell className="text-right">
                                            <Button variant="ghost" size="icon" onClick={() => setDeletingUser(user)}>
                                                <Trash2 className="h-4 w-4 text-destructive" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))
                            ) : (
                                 <TableRow>
                                    <TableCell colSpan={4} className="h-24 text-center">
                                        Nenhum usuário cadastrado.
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
            
            <AlertDialog open={!!deletingUser} onOpenChange={(open) => !open && setDeletingUser(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Você tem certeza?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Esta ação é irreversível e irá remover permanentemente o usuário <strong>{deletingUser?.name}</strong>.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDeleteUser} className="bg-destructive hover:bg-destructive/90">
                            Sim, remover
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}

function ConfiguracoesClient() {
  const searchParams = useSearchParams();
  const tab = searchParams.get('tab') || 'usuarios';

  return (
     <DashboardLayout>
      <div className="flex-1 space-y-8 p-4 pt-6 md:p-8">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Configurações</h2>
          <p className="text-muted-foreground">
            Gerencie as configurações de usuários e do sistema.
          </p>
        </div>

        <Tabs defaultValue={tab} className="w-full">
            <TabsList className="grid w-full grid-cols-1 max-w-lg">
                <TabsTrigger value="usuarios">Usuários</TabsTrigger>
            </TabsList>
            <TabsContent value="usuarios" className="pt-6">
                <UsersTabContent />
            </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  )
}

export default function ConfiguracoesPage() {
  return (
    <Suspense fallback={<div className="p-4">Carregando Configurações…</div>}>
      <ConfiguracoesClient />
    </Suspense>
  );
}
