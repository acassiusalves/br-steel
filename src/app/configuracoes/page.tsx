
'use client';

import * as React from 'react';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import DashboardLayout from '@/components/dashboard-layout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PlusCircle, Trash2 } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";


function UsersTabContent() {
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
