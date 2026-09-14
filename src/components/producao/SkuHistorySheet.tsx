'use client';

import * as React from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { fetchOperation } from '@/lib/operation-client';
import type { HistoryPoint } from '@/server/persistence/production-demand-contract';

/** Detalhe do SKU: 52 semanas fechadas, onde o sparkline mostra 12. */
export function SkuHistorySheet({ sku, description, onOpenChange }:
  { sku: string | null; description?: string; onOpenChange: (open: boolean) => void }) {
  const [points, setPoints] = React.useState<HistoryPoint[]>([]);
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!sku) return;
    let active = true;
    setIsLoading(true); setError(null); setPoints([]);
    fetchOperation<HistoryPoint[]>(`/api/operations/sku-history?sku=${encodeURIComponent(sku)}&semanas=52`)
      .then(response => { if (active) { setPoints(response.data); setIsLoading(false); } })
      .catch((cause: Error) => { if (active) { setError(cause.message); setIsLoading(false); } });
    return () => { active = false; };
  }, [sku]);

  return (
    <Dialog open={Boolean(sku)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{sku}</DialogTitle>
          <DialogDescription>{description ?? 'Demanda semanal das últimas 52 semanas fechadas.'}</DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : error ? (
          // Falha de rede/servidor: estado distinto do "série vazia" abaixo — mesma ausência de
          // barras, mas aqui é uma pane, não um SKU sem venda faturada. Não colapsar os dois.
          <p role="alert" className="text-destructive py-12 text-center text-sm">{error}</p>
        ) : points.length ? (
          <ResponsiveContainer width="100%" height={256}>
            <BarChart data={points} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="week" tickFormatter={week => week.slice(-3)} fontSize={11} interval="preserveStartEnd" />
              <YAxis fontSize={11} allowDecimals={false} />
              <Tooltip formatter={(value: number) => [`${value} unidades`, 'Vendidas']} />
              <Bar dataKey="units" fill="currentColor" className="text-primary" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-muted-foreground py-12 text-center text-sm">
            Ainda não há semanas consolidadas para este SKU.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
