'use client';

import * as React from 'react';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import DashboardLayout from '@/components/dashboard-layout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PlusCircle, Trash2, Loader2, Lock, Users, UserPlus } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { getUsers, addUser, deleteUser, seedUsers, updateUserRole } from '@/services/user-service';
import { loadAppSettings, saveAppSettings } from '@/services/app-settings-service';
import type { User } from '@/types/user';
import { pagePermissions as defaultPagePermissions, availableRoles } from "@/lib/permissions";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from '@/components/ui/switch';


function UsersTabContent() {
    const [users, setUsers] = React.useState<User[]>([]);
    const [permissions, setPermissions] = React.useState(defaultPagePermissions);
    const [inactivePages, setInactivePages] = React.useState<string[]>([]);
    
    const [isLoading, setIsLoading] = React.useState(true);
    const [isFormOpen, setIsFormOpen] = React.useState(false);
    
    const [isSaving, setIsSaving] = React.useState(false);
    const [isSavingPermissions, setIsSavingPermissions] = React.useState(false);

    const [deletingUser, setDeletingUser] = React.useState<User | null>(null);
    const { toast } = useToast();

    const fetchInitialData = React.useCallback(async () => {
        setIsLoading(true);
        try {
            const [userList, appSettings] = await Promise.all([
                getUsers(),
                loadAppSettings()
            ]);
            
            setUsers(userList);

            if (appSettings) {
                 if (appSettings.permissions) {
                    const mergedPermissions = { ...defaultPagePermissions };
                    for (const page in mergedPermissions) {
                        if (appSettings.permissions[page]) {
                            mergedPermissions[page] = appSettings.permissions[page];
                        }
                    }
                    setPermissions(mergedPermissions);
                }
                if (appSettings.inactivePages) {
                    setInactivePages(appSettings.inactivePages);
                }
            }
            
            if (userList.length === 0) {
              await seedUsers();
              const seededUsers = await getUsers();
              setUsers(seededUsers);
            }

        } catch (error: any) {
            toast({
                variant: 'destructive',
                title: 'Erro ao buscar dados',
                description: error.message,
            });
        } finally {
            setIsLoading(false);
        }
    }, [toast]);
    
    React.useEffect(() => {
        fetchInitialData();
    }, [fetchInitialData]);

    const handlePermissionChange = (page: string, role: string, checked: boolean) => {
        setPermissions(prev => {
            const newPermissions = { ...prev };
            const pageRoles = newPermissions[page] || [];
            if (checked) {
                if (!pageRoles.includes(role)) {
                    newPermissions[page] = [...pageRoles, role];
                }
            } else {
                newPermissions[page] = pageRoles.filter(r => r !== role);
            }
            return newPermissions;
        });
    };

    const handlePageActiveChange = (page: string, isActive: boolean) => {
        setInactivePages(prev => {
            const newInactive = new Set(prev);
            if (isActive) {
                newInactive.delete(page);
            } else {
                newInactive.add(page);
            }
            return Array.from(newInactive);
        });
    };

    const handleRoleChange = (userId: string, newRole: string) => {
        setUsers(currentUsers =>
            currentUsers.map(u => (u.id === userId ? { ...u, role: newRole } : u))
        );
    };

    const handleSavePermissions = async () => {
        setIsSavingPermissions(true);
        try {
            await saveAppSettings({ permissions: permissions, inactivePages: inactivePages });
            toast({
                title: "Permissões Salvas!",
                description: "As regras de acesso foram atualizadas."
            })
        } catch (e) {
            toast({ variant: "destructive", title: "Erro", description: "Não foi possível salvar as permissões."})
        } finally {
            setIsSavingPermissions(false);
        }
    };
    
    const handleSaveUsers = async () => {
        setIsSaving(true);
        try {
            const updatePromises = users.map(user => updateUserRole(user.id, user.role));
            await Promise.all(updatePromises);
            toast({
                title: "Funções Salvas!",
                description: "As funções dos usuários foram atualizadas com sucesso."
            });
        } catch (e) {
             toast({ variant: "destructive", title: "Erro", description: "Não foi possível salvar as funções dos usuários."})
        } finally {
            setIsSaving(false);
        }
    }


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
            fetchInitialData();
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
            fetchInitialData();
        } catch (error: any) {
            toast({
                variant: 'destructive',
                title: 'Erro ao Remover',
                description: error.message,
            });
        }
    };

    if (isLoading) {
        return <div className="flex items-center justify-center h-[calc(100vh-200px)]"><Loader2 className="animate-spin h-8 w-8" /></div>
    }


    return (
        <>
           <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2"><Lock /> Permissões por Função</CardTitle>
                    <CardDescription>Defina o que cada função pode ver e fazer no sistema. A função de Administrador sempre tem acesso a tudo.</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="rounded-md border overflow-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Página do Sistema</TableHead>
                                    {availableRoles.map(role => (
                                        <TableHead key={role.key} className="text-center">{role.name}</TableHead>
                                    ))}
                                    <TableHead className="text-center">Ativa</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {Object.keys(permissions).filter(p => p !== '/login' && p !== '/perfil').map(page => (
                                    <TableRow key={page}>
                                        <TableCell className="font-medium">{page}</TableCell>
                                        {availableRoles.map(role => {
                                            const isSuperUser = role.key === 'Administrador';
                                            const isChecked = isSuperUser || permissions[page]?.includes(role.key);
                                            return (
                                                <TableCell key={`${page}-${role.key}`} className="text-center">
                                                    <Checkbox
                                                        checked={isChecked}
                                                        onCheckedChange={(checked) => handlePermissionChange(page, role.key, !!checked)}
                                                        disabled={isSuperUser}
                                                    />
                                                </TableCell>
                                            );
                                        })}
                                        <TableCell className="text-center">
                                            <Switch
                                                checked={!inactivePages.includes(page)}
                                                onCheckedChange={(checked) => handlePageActiveChange(page, checked)}
                                                disabled={page === '/configuracoes'} // prevent locking out
                                            />
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
                 <CardFooter className="justify-end">
                    <Button onClick={handleSavePermissions} disabled={isSavingPermissions}>
                        {isSavingPermissions && <Loader2 className="animate-spin mr-2"/>}
                        Salvar Permissões
                    </Button>
                </CardFooter>
            </Card>

             <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                        <CardTitle className="flex items-center gap-2"><Users /> Gerenciamento de Usuários</CardTitle>
                        <CardDescription>
                           Atribua funções para controlar o acesso de cada usuário.
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
                                        Preencha os dados abaixo para criar um novo acesso. O usuário receberá um convite por e-mail para definir sua senha.
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
                                                {availableRoles.map(role => (
                                                    <SelectItem key={role.key} value={role.key}>
                                                        {role.name}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>
                                <DialogFooter>
                                    <Button type="button" variant="ghost" onClick={() => setIsFormOpen(false)}>Cancelar</Button>
                                    <Button type="submit" disabled={isSaving}>
                                        {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                        Salvar e Enviar Convite
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
                                        <TableCell>
                                             <Select
                                                value={user.role}
                                                onValueChange={(newRole) => handleRoleChange(user.id, newRole)}
                                                disabled={user.email?.toLowerCase().includes('admin@')}
                                            >
                                                <SelectTrigger className="w-[180px]">
                                                    <SelectValue placeholder="Selecione a função" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {availableRoles.map(role => (
                                                        <SelectItem key={role.key} value={role.key}>
                                                            {role.name}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <Button variant="ghost" size="icon" onClick={() => setDeletingUser(user)} disabled={user.email?.toLowerCase().includes('admin@')}>
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
                 <CardFooter className="justify-end">
                    <Button onClick={handleSaveUsers} disabled={isSaving}>
                         {isSaving && <Loader2 className="animate-spin mr-2"/>}
                        Salvar Funções de Usuário
                    </Button>
                </CardFooter>
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
                <TabsTrigger value="usuarios">Usuários e Permissões</TabsTrigger>
            </TabsList>
            <TabsContent value="usuarios" className="pt-6 space-y-8">
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

    