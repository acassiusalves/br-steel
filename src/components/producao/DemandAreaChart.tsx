'use client';

import * as React from 'react';
import { Area, AreaChart, CartesianGrid, ReferenceArea, ReferenceDot, ReferenceLine, Tooltip, XAxis, YAxis } from 'recharts';
import { fillWeekGaps } from '@/lib/history-series';
import type { HistoryPoint } from '@/server/persistence/production-demand-contract';

/** `2026-W37` → `S37/26`, curto o bastante para o eixo sem perder o ano. */
export const tickLabel = (week: string) => {
  const [year, number] = week.split('-W');
  return `S${number}/${year.slice(2)}`;
};

/** Valor primeiro, rótulo depois: quem passa o mouse já sabe a série e quer o número. */
function DemandTooltip({ active, payload }: { active?: boolean; payload?: { payload: HistoryPoint }[] }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  const [year, number] = point.week.split('-W');
  return (
    <div className="bg-popover text-popover-foreground rounded-md border px-3 py-2 shadow-md">
      <p className="text-sm font-semibold">
        {point.units} {point.units === 1 ? 'unidade' : 'unidades'} · {point.orders} {point.orders === 1 ? 'pedido' : 'pedidos'}
      </p>
      <p className="text-muted-foreground text-xs">semana {number} de {year}</p>
    </div>
  );
}

type Props = {
  series: HistoryPoint[];
  stockMin?: number;
  stockMax?: number;
  /** Preenchidos por `ResponsiveContainer`, que clona seu filho com as medidas calculadas. */
  width?: number;
  height?: number;
};

/**
 * Demanda semanal como área: uma forma contínua, não dezenas de objetos separados.
 *
 * Sem `ResponsiveContainer` por dentro de propósito — assim o mesmo componente renderiza na tela,
 * clonado pelo container, e fora do navegador com medidas explícitas, que é como ele pôde ser
 * olhado antes de subir.
 */
export function DemandAreaChart({ series, stockMin, stockMax, width, height }: Props) {
  // Onde 2025 vira 2026. Sem essa marca o eixo repete "S34" em dois pontos distantes e ninguém
  // consegue se localizar no tempo.
  const yearTurn = series.find(
    (point, index) => index > 0 && point.week.slice(0, 4) !== series[index - 1].week.slice(0, 4),
  )?.week;

  const hasBand = typeof stockMin === 'number' && typeof stockMax === 'number' && stockMax > 0;
  const last = series[series.length - 1];
  // O topo precisa comportar a série E a faixa de estoque, senão a referência sai do desenho.
  // Arredondado para um múltiplo de 20 para que os traços caiam em números redondos.
  const peak = Math.max(...series.map(point => point.units), hasBand ? stockMax : 0, 1);
  const ceiling = Math.ceil(peak / 20) * 20;
  const ticks = [0, 1, 2, 3, 4].map(step => (ceiling / 4) * step);
  // Uma etiqueta a cada N semanas: com 52 categorias o recharts desenha todas por cima das outras.
  const everyNth = Math.max(1, Math.ceil(series.length / 9));

  return (
    <AreaChart width={width} height={height} data={series} margin={{ top: 18, right: 64, bottom: 4, left: 0 }}>
      <defs>
        <linearGradient id="demandaSemanal" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="hsl(var(--chart-2))" stopOpacity={0.3} />
          <stop offset="100%" stopColor="hsl(var(--chart-2))" stopOpacity={0.04} />
        </linearGradient>
      </defs>

      {/* Grade contínua e recuada: tracejado aqui vira ruído e sugere projeção. */}
      <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
      <XAxis
        dataKey="week" tickFormatter={tickLabel} interval={everyNth} tickMargin={8}
        tickLine={false} axisLine={false} fontSize={11} stroke="hsl(var(--muted-foreground))"
      />
      <YAxis
        allowDecimals={false} width={38} domain={[0, ceiling]} ticks={ticks}
        tickLine={false} axisLine={false} fontSize={11} stroke="hsl(var(--muted-foreground))"
      />

      {/* Faixa de estoque: contexto atrás do dado, nunca competindo com ele. Quando uma semana de
          demanda passa do máximo, o giro semanal supera todo o estoque alvo. */}
      {hasBand && (
        <ReferenceArea
          y1={stockMin} y2={stockMax} fill="hsl(var(--muted-foreground))" fillOpacity={0.055}
          stroke="none" ifOverflow="extendDomain"
        />
      )}
      {hasBand && (
        <ReferenceLine
          y={stockMin} stroke="hsl(var(--muted-foreground))" strokeOpacity={0.55} strokeDasharray="4 4"
          label={{ value: `mín ${stockMin}`, position: 'right', fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
        />
      )}
      {hasBand && (
        <ReferenceLine
          y={stockMax} stroke="hsl(var(--muted-foreground))" strokeOpacity={0.55} strokeDasharray="4 4"
          label={{ value: `máx ${stockMax}`, position: 'right', fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
        />
      )}

      {yearTurn && (
        <ReferenceLine
          x={yearTurn} stroke="hsl(var(--muted-foreground))" strokeOpacity={0.45}
          label={{ value: yearTurn.slice(0, 4), position: 'insideTopRight', fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
        />
      )}

      <Tooltip content={<DemandTooltip />} cursor={{ stroke: 'hsl(var(--chart-2))', strokeWidth: 1, strokeOpacity: 0.55 }} />

      {/* `linear`, não `monotone`: uma curva suavizada inventaria valores entre semanas. */}
      <Area
        type="linear" dataKey="units" stroke="hsl(var(--chart-2))" strokeWidth={2}
        fill="url(#demandaSemanal)" dot={false}
        activeDot={{ r: 4, strokeWidth: 2, stroke: 'hsl(var(--background))' }}
      />

      {/* O presente é o que o leitor procura primeiro. */}
      {last && (
        <ReferenceDot
          x={last.week} y={last.units} r={4}
          fill="hsl(var(--chart-2))" stroke="hsl(var(--background))" strokeWidth={2}
          label={{ value: `${last.units} un`, position: 'top', fontSize: 12, fontWeight: 600, fill: 'hsl(var(--foreground))' }}
        />
      )}
    </AreaChart>
  );
}
