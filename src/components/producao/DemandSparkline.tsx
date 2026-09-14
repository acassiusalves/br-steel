'use client';

import * as React from 'react';
import type { HistoryPoint } from '@/server/persistence/production-demand-contract';

const WIDTH = 72, HEIGHT = 24, PADDING = 3;

/**
 * Tendência de demanda semanal numa linha de tabela.
 *
 * SVG inline em vez de recharts: são até 50 linhas visíveis por página, e montar um gráfico completo
 * por linha custa caro sem entregar nada que a curva não diga. O recharts fica para o detalhe.
 *
 * A semana corrente é sempre parcial, então o segmento final é tracejado. Com linha sólida todo SKU
 * pareceria despencar no último ponto, que é leitura falsa e não erro de dado.
 */
export function DemandSparkline({ history }: { history: HistoryPoint[] }) {
  if (history.length < 2) {
    // Reta no zero se lê como "não vendeu", que é diferente de "ainda não temos série".
    return <span className="text-muted-foreground" aria-label="Sem histórico consolidado">—</span>;
  }

  const units = history.map(point => point.units);
  const max = Math.max(...units, 1);
  const step = (WIDTH - PADDING * 2) / (history.length - 1);
  const y = (value: number) => HEIGHT - PADDING - (value / max) * (HEIGHT - PADDING * 2);
  const points = history.map((point, index) => [PADDING + index * step, y(point.units)] as const);

  const openIndex = history.findIndex(point => point.open);
  // Exclui o ponto aberto do traço sólido: se o sólido também cobrisse esse segmento, o tracejado
  // desenhado por cima (mesma cor, mesma espessura) não teria efeito visual nenhum — os vãos do
  // tracejado só revelariam o sólido por baixo, e o SKU pareceria ter a semana corrente sólida.
  const solid = openIndex === -1 ? points : points.slice(0, openIndex);
  const dashed = openIndex === -1 ? [] : points.slice(openIndex - 1);
  const [lastX, lastY] = points.at(-1)!;
  const path = (list: readonly (readonly [number, number])[]) => list.map(([x, v]) => `${x},${v}`).join(' ');

  const label = `${history.length} semanas, de ${Math.min(...units)} a ${max} unidades, `
    + `última semana ${units.at(-1)}${openIndex === -1 ? '' : ' (parcial)'}`;

  return (
    <svg width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={label} className="inline-block align-middle">
      <polyline points={path(solid)} fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" strokeLinecap="round" />
      {dashed.length > 1 && (
        <polyline points={path(dashed)} fill="none" stroke="currentColor" strokeWidth="1.25" strokeDasharray="2 2" strokeLinecap="round" />
      )}
      <circle cx={lastX} cy={lastY} r="1.75" fill="currentColor" />
    </svg>
  );
}
