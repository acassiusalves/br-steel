import { nextWeek } from '@/lib/iso-week';
import type { HistoryPoint } from '@/server/persistence/production-demand-contract';

/**
 * Preenche com zero as semanas sem venda faturada.
 *
 * Elas não voltam da API — simplesmente não existem lá. Desenhá-las como ausência encosta as
 * vizinhas e comprime a linha do tempo em silêncio, o que faz um vale parecer continuidade.
 * Preenchidas, ocupam seu lugar e o eixo volta a ser linear no tempo.
 */
export function fillWeekGaps(points: HistoryPoint[]): HistoryPoint[] {
  if (points.length < 2) return points;
  const known = new Map(points.map(point => [point.week, point]));
  const last = points[points.length - 1].week;
  const series: HistoryPoint[] = [];
  let week = points[0].week;
  // Teto acima da janela de retenção de 104 semanas: uma chave corrompida não pode girar para sempre.
  for (let guard = 0; guard <= 120; guard += 1) {
    series.push(known.get(week) ?? { week, units: 0, orders: 0 });
    if (week === last) break;
    week = nextWeek(week);
  }
  return series;
}
