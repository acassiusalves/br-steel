
'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import DashboardLayout from '@/components/dashboard-layout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Loader2, PlusCircle, Trash2 } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";


function GeneralSettingsTab() {
  const { toast } = useToast();
  const [isSaving, setIsSaving] = React.useState(false);

  const handleSaveChanges = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);

    // Simulate saving settings
    setTimeout(() => {
      toast({
        title: 'Configurações Salvas!',
        description: 'Suas alterações foram salvas com sucesso.',
      });
      setIsSaving(false);
    }, 1500);
  };
  
  return (
      <form onSubmit={handleSaveChanges}>
        <Card>
          <CardHeader>
            <CardTitle>Configurações Gerais</CardTitle>
            <CardDescription>
              Ajustes e preferências para o funcionamento do sistema.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="appName">Nome da Aplicação</Label>
              <Input id="appName" defaultValue="BR Steel - MarketFlow" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="notificationEmail">E-mail para Notificações</Label>
              <Input id="notificationEmail" type="email" placeholder="exemplo@email.com" />
                <p className="text-sm text-muted-foreground">
                  E-mails importantes sobre o sistema serão enviados para este endereço.
              </p>
            </div>
          </CardContent>
          <div className="p-6 pt-0">
              <Button type="submit" disabled={isSaving}>
                {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Salvar Alterações
              </Button>
          </div>
        </Card>
      </form>
  )
}

function UsersTab() {
    // Mock data - replace with actual data fetching
    const users = [
        { id: '1', name: 'Admin', email: 'admin@brsteel.com', role: 'Administrador' },
        { id: '2', name: 'Usuário Vendas', email: 'vendas@brsteel.com', role: 'Vendedor' },
    ];

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between">
                <div>
                    <CardTitle>Gerenciamento de Usuários</CardTitle>
                    <CardDescription>
                        Adicione, edite ou remova usuários do sistema.
                    </CardDescription>
                </div>
                <Button>
                    <PlusCircle className="mr-2 h-4 w-4" />
                    Adicionar Usuário
                </Button>
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
                        {users.map(user => (
                            <TableRow key={user.id}>
                                <TableCell className="font-medium">{user.name}</TableCell>
                                <TableCell>{user.email}</TableCell>
                                <TableCell>{user.role}</TableCell>
                                <TableCell className="text-right">
                                    <Button variant="ghost" size="icon">
                                        <Trash2 className="h-4 w-4 text-destructive" />
                                    </Button>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </CardContent>
        </Card>
    );
}


export default function ConfiguracoesPage() {
  const searchParams = useSearchParams();
  const defaultTab = searchParams.get('tab') || 'geral';

  return (
    <DashboardLayout>
      <div className="flex-1 space-y-8 p-4 pt-6 md:p-8">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Configurações</h2>
          <p className="text-muted-foreground">
            Gerencie as configurações gerais e de usuários da sua aplicação.
          </p>
        </div>

        <Tabs defaultValue={defaultTab} className="space-y-4">
            <TabsList>
                <TabsTrigger value="geral">Geral</TabsTrigger>
                <TabsTrigger value="usuarios">Usuários</TabsTrigger>
            </TabsList>
            <TabsContent value="geral">
                <GeneralSettingsTab />
            </TabsContent>
            <TabsContent value="usuarios">
                <UsersTab />
            </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}

    