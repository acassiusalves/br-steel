
'use client';

import * as React from 'react';
import DashboardLayout from '@/components/dashboard-layout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';

export default function ConfiguracoesPage() {
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
    <DashboardLayout>
      <div className="flex-1 space-y-8 p-4 pt-6 md:p-8">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Configurações</h2>
          <p className="text-muted-foreground">
            Gerencie as configurações gerais da sua aplicação.
          </p>
        </div>

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

      </div>
    </DashboardLayout>
  );
}
