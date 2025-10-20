
'use client';

import * as React from 'react';
import { Suspense } from 'react';
import DashboardLayout from '@/components/dashboard-layout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PlusCircle, Trash2, Loader2, Lock, Users, Clock } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from '@/hooks/use-toast';
import { getUsers, addUser, deleteUser, updateUserRole, seedUsers } from '@/services/user-service';
import { loadAppSettings, saveAppSettings } from '@/services/app-settings-service';
import type { User } from '@/types/user';
import { pagePermissions as defaultPagePermissions, availableRoles } from "@/lib/permissions";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from '@/components/ui/switch';


function UsersPageContent() {
    const [users, setUsers] = React.useState<User[]>([]);
    const [currentUser, setCurrentUser] = React.useState<User | null>(null);
    const [permissions, setPermissions] = React.useState(defaultPagePermissions);
    const [inactivePages, setInactivePages] = React.useState<string[]>([]);

    const [isLoading, setIsLoading] = React.useState(true);
    const [isFormOpen, setIsFormOpen] = React.useState(false);

    const [isSaving, setIsSaving] = React.useState(false);
    const [isSavingPermissions, setIsSavingPermissions] = React.useState(false);
    const [hasUnsavedChanges, setHasUnsavedChanges] = React.useState(false);

    const [deletingUser, setDeletingUser] = React.useState<User | null>(null);
    const { toast } = useToast();

    // Validação de permissão
    const isAdmin = React.useMemo(() => currentUser?.role === 'Administrador', [currentUser]);

    const fetchInitialData = React.useCallback(async () => {
        setIsLoading(true);
        try {
            const userEmail = localStorage.getItem('userEmail');
            const [userList, appSettings] = await Promise.all([
                getUsers(),
                loadAppSettings()
            ]);

            const loggedInUser = userList.find(u => u.email === userEmail);
            setCurrentUser(loggedInUser || null);

            // Seed users apenas se não houver usuários
            if (userList.length === 0) {
              await seedUsers();
              const seededUsers = await getUsers();
              setUsers(seededUsers);
            } else {
              setUsers(userList);
            }

            // Merge de permissões otimizado
            if (appSettings?.permissions) {
                const mergedPermissions = {
                    ...defaultPagePermissions,
                    ...appSettings.permissions
                };
                setPermissions(mergedPermissions);
            }

            if (appSettings?.inactivePages) {
                setInactivePages(appSettings.inactivePages);
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

    // Aviso ao sair da página com mudanças não salvas
    React.useEffect(() => {
        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            if (hasUnsavedChanges) {
                e.preventDefault();
                e.returnValue = '';
            }
        };

        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [hasUnsavedChanges]);

    const handlePermissionChange = (page: string, role: string, checked: boolean) => {
        if (!isAdmin) {
            toast({ variant: 'destructive', title: 'Sem Permissão', description: 'Apenas administradores podem alterar permissões.' });
            return;
        }
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
        setHasUnsavedChanges(true);
    };

    const handlePageActiveChange = (page: string, isActive: boolean) => {
        if (!isAdmin) {
            toast({ variant: 'destructive', title: 'Sem Permissão', description: 'Apenas administradores podem alterar páginas ativas.' });
            return;
        }
        setInactivePages(prev => {
            const newInactive = new Set(prev);
            if (isActive) {
                newInactive.delete(page);
            } else {
                newInactive.add(page);
            }
            return Array.from(newInactive);
        });
        setHasUnsavedChanges(true);
    };

    const handleRoleChange = (userId: string, newRole: string) => {
        if (!isAdmin) {
            toast({ variant: 'destructive', title: 'Sem Permissão', description: 'Apenas administradores podem alterar funções.' });
            return;
        }
        setUsers(currentUsers =>
            currentUsers.map(u => (u.id === userId ? { ...u, role: newRole } : u))
        );
        setHasUnsavedChanges(true);
    };

    const handleSaveAll = async () => {
        if (!isAdmin) {
            toast({ variant: 'destructive', title: 'Sem Permissão', description: 'Apenas administradores podem salvar alterações.' });
            return;
        }

        setIsSaving(true);
        try {
            // Salva permissões e funções de usuários em paralelo
            const updatePromises = users.map(user => updateUserRole(user.id, user.role));
            await Promise.all([
                saveAppSettings({ permissions: permissions, inactivePages: inactivePages }),
                ...updatePromises
            ]);

            setHasUnsavedChanges(false);
            toast({
                title: "Alterações Salvas!",
                description: "Todas as configurações foram atualizadas com sucesso."
            });
        } catch (e) {
             toast({ variant: "destructive", title: "Erro", description: "Não foi possível salvar as configurações."})
        } finally {
            setIsSaving(false);
        }
    };


    const handleSaveUser = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!isAdmin) {
            toast({ variant: 'destructive', title: 'Sem Permissão', description: 'Apenas administradores podem adicionar usuários.' });
            return;
        }

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

    const rolesForNewUser = React.useMemo(() => {
        if (currentUser?.role === 'Administrador') {
            return availableRoles;
        }
        // Operador e Vendedor só podem criar Vendedores e Operadores
        return availableRoles.filter(role => role.key !== 'Administrador');
    }, [currentUser]);

    const formatLastLogin = (isoString?: string) => {
        if (!isoString) return "Nunca acessou";
        try {
            return new Date(isoString).toLocaleString('pt-BR', {
                dateStyle: 'short',
                timeStyle: 'medium'
            });
        } catch {
            return "Data inválida";
        }
    }

    if (isLoading) {
        return <div className="flex items-center justify-center h-[calc(100vh-200px)]"><Loader2 className="animate-spin h-8 w-8" /></div>
    }


    return (
        <div className="space-y-8">
            {!isAdmin && (
                <Card className="border-yellow-500 bg-yellow-50 dark:bg-yellow-950">
                    <CardContent className="pt-6">
                        <p className="text-sm text-yellow-800 dark:text-yellow-200">
                            Você está visualizando esta página no modo somente leitura. Apenas administradores podem fazer alterações.
                        </p>
                    </CardContent>
                </Card>
            )}

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
                                                        disabled={isSuperUser || !isAdmin}
                                                    />
                                                </TableCell>
                                            );
                                        })}
                                        <TableCell className="text-center">
                                            <Switch
                                                checked={!inactivePages.includes(page)}
                                                onCheckedChange={(checked) => handlePageActiveChange(page, checked)}
                                                disabled={page === '/configuracoes' || !isAdmin}
                                            />
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
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
                            <Button disabled={!isAdmin}>
                                <PlusCircle className="mr-2 h-4 w-4" />
                                Adicionar Usuário
                            </Button>
                        </DialogTrigger>
                        <DialogContent>
                             <form onSubmit={handleSaveUser}>
                                <DialogHeader>
                                    <DialogTitle>Adicionar Novo Usuário</DialogTitle>
                                    <DialogDescription>
                                        Preencha os dados abaixo para criar um novo acesso. A senha padrão para o primeiro login será '123456'. O usuário poderá entrar no sistema imediatamente.
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
                                                {rolesForNewUser.map(role => (
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
                                        Salvar Usuário
                                    </Button>
                                </DialogFooter>
                            </form>
                        </DialogContent>
                    </Dialog>
                </CardHeader>
                <CardContent>
                    <TooltipProvider>
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
                                    users.map(user => {
                                        const isAdministrator = user.role === 'Administrador';
                                        const isCurrentUserFromState = user.email === currentUser?.email;

                                        return (
                                            <TableRow key={user.id}>
                                                <TableCell className="font-medium">
                                                    <div className="flex items-center gap-2">
                                                        <span>{user.name}</span>
                                                        {currentUser?.role === 'Administrador' && (
                                                            <Tooltip>
                                                                <TooltipTrigger asChild>
                                                                    <button>
                                                                        <Clock className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                                                                    </button>
                                                                </TooltipTrigger>
                                                                <TooltipContent>
                                                                    <p>Último acesso: {formatLastLogin(user.lastLogin)}</p>
                                                                </TooltipContent>
                                                            </Tooltip>
                                                        )}
                                                    </div>
                                                </TableCell>
                                                <TableCell>{user.email}</TableCell>
                                                <TableCell>
                                                    <Select
                                                        value={user.role}
                                                        onValueChange={(newRole) => handleRoleChange(user.id, newRole)}
                                                        disabled={!isAdmin || isAdministrator || isCurrentUserFromState}
                                                    >
                                                        <SelectTrigger className="w-[180px]">
                                                            <SelectValue placeholder="Selecione a função" />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {availableRoles.map(role => (
                                                                <SelectItem key={role.key} value={role.key} disabled={role.key === 'Administrador' && currentUser?.role !== 'Administrador'}>
                                                                    {role.name}
                                                                </SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <Button
                                                      variant="ghost"
                                                      size="icon"
                                                      onClick={() => setDeletingUser(user)}
                                                      disabled={!isAdmin || isAdministrator || isCurrentUserFromState}
                                                    >
                                                        <Trash2 className="h-4 w-4 text-destructive" />
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })
                                ) : (
                                     <TableRow>
                                        <TableCell colSpan={4} className="h-24 text-center">
                                            Nenhum usuário cadastrado.
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </TooltipProvider>
                </CardContent>
            </Card>

            {isAdmin && (
                <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
                    <div className="flex-1">
                        {hasUnsavedChanges && (
                            <p className="text-sm text-muted-foreground">
                                Você tem alterações não salvas. Clique em "Salvar Todas as Alterações" para aplicá-las.
                            </p>
                        )}
                    </div>
                    <Button onClick={handleSaveAll} disabled={isSaving || !hasUnsavedChanges} size="lg">
                        {isSaving && <Loader2 className="animate-spin mr-2"/>}
                        Salvar Todas as Alterações
                    </Button>
                </div>
            )}

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
        </div>
    );
}


function ConfiguracoesClient() {
  return (
     <DashboardLayout>
      <div className="flex-1 space-y-8 p-4 pt-6 md:p-8">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Usuários e Permissões</h2>
          <p className="text-muted-foreground">
            Gerencie as configurações de usuários e permissões de acesso do sistema.
          </p>
        </div>
         <UsersPageContent />
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
