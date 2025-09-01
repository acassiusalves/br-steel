
'use client';

import * as React from 'react';
import DashboardLayout from '@/components/dashboard-layout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Factory } from 'lucide-react';

export default function ProducaoPage() {
  return (
    <DashboardLayout>
      <div className="flex-1 space-y-8 p-4 pt-6 md:p-8">
        <div className="flex items-center justify-between">
            <div>
                <h2 className="text-3xl font-bold tracking-tight">Produção</h2>
                <p className="text-muted-foreground">
                    Acompanhe e gerencie as ordens de produção.
                </p>
            </div>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Ordens de Produção</CardTitle>
            <CardDescription>
              Esta área está em desenvolvimento. Em breve, você poderá gerenciar suas ordens de produção aqui.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col items-center justify-center text-center text-muted-foreground h-48">
                <Factory className="w-12 h-12 mb-4" />
                <p>Página de Produção em Construção</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
