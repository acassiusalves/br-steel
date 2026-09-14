'use client';

import * as React from 'react';
import { ResponsiveContainer } from 'recharts';
import { Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { fetchOperation } from '@/lib/operation-client';
import { DemandAreaChart } from '@/components/producao/DemandAreaChart';
import { fillWeekGaps } from '@/lib/history-series';
import type { HistoryPoint } from '@/server/persistence/production-demand-contract';

type Props = {
  sku: string | null;
  description?: string;
  stockMin?: number;
  stockMax?: number;
  onOpenChange: (open: boolean) => void;
};

/** Detalhe do SKU: 52 semanas fechadas, onde o sparkline da tabela mostra 12. */
export function SkuHistorySheet({ sku, description, stockMin, stockMax, onOpenChange }: Props) {
  const [points, setPoints] = React.useState<HistoryPoint[]>([]);
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    // Limpa ao fechar, não só ao abrir: sem isto o SKU seguinte aparece no título por um quadro
    // com os dados do anterior ainda desenhados.
    if (!sku) { setPoints([]); setError(null); setIsLoading(false); return; }
    let active = true;
    setIsLoading(true); setError(null); setPoints([]);
    fetchOperation<HistoryPoint[]>(`/api/operations/sku-history?sku=${encodeURIComponent(sku)}&semanas=52`)
      .then(response => { if (active) { setPoints(response.data); setIsLoading(false); } })
      .catch((cause: Error) => { if (active) { setError(cause.message); setIsLoading(false); } });
    return () => { active = false; };
  }, [sku]);

  const series = React.useMemo(() => fillWeekGaps(points), [points]);
  const hasBand = typeof stockMin === 'number' && typeof stockMax === 'number' && stockMax > 0;

  return (
    <Dialog open={Boolean(sku)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="font-mono">{sku}</DialogTitle>
          <DialogDescription>
            {description ? `${description} · ` : ''}Unidades vendidas por semana, até 52 semanas fechadas.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex h-72 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : error ? (
          // Falha de rede/servidor: estado distinto do "série vazia" abaixo — mesma ausência de
          // desenho, mas aqui é uma pane, não um SKU sem venda faturada. Não colapsar os dois.
          <p role="alert" className="text-destructive py-16 text-center text-sm">{error}</p>
        ) : series.length > 1 ? (
          <>
            <ResponsiveContainer width="100%" height={288}>
              <DemandAreaChart series={series} stockMin={stockMin} stockMax={stockMax} />
            </ResponsiveContainer>
            <p className="text-muted-foreground text-xs">
              {hasBand
                ? `A faixa cinza é o estoque alvo deste SKU, de ${stockMin} a ${stockMax} unidades.`
                : 'Este SKU não tem estoque mínimo e máximo configurados, então o gráfico não mostra a faixa de referência.'}
            </p>
          </>
        ) : (
          <p className="text-muted-foreground py-16 text-center text-sm">
            Ainda não há semanas consolidadas para este SKU.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
