/**
 * Renderiza o gráfico de demanda fora do navegador, nos dois temas, para que dê para olhá-lo
 * antes de subir. A tela /producao exige login, então este é o único caminho para conferir
 * geometria, colisão de rótulos e contraste sem autenticar.
 *
 *   node --conditions=react-server --import tsx scripts/render-chart-preview.tsx
 *   open chart-preview.html
 *
 * A série é a de PTU200200150 lida da produção em 2026-09-14, com mín/máx reais de 30 e 64.
 */
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { writeFileSync } from 'node:fs';
import { DemandAreaChart } from '../src/components/producao/DemandAreaChart';
import { fillWeekGaps } from '../src/lib/history-series';
import type { HistoryPoint } from '../src/server/persistence/production-demand-contract';

const raw: HistoryPoint[] = [
 ['2025-W31',2,2],['2025-W32',4,3],['2025-W33',8,6],['2025-W34',7,5],['2025-W35',2,2],['2025-W36',4,2],
 ['2025-W37',2,2],['2025-W38',5,3],['2025-W40',2,2],['2025-W41',2,2],['2025-W42',1,1],['2025-W43',1,1],
 ['2025-W44',1,1],['2025-W46',2,2],['2025-W47',2,2],['2025-W49',2,2],['2025-W50',2,2],['2025-W51',2,1],
 ['2026-W01',3,1],['2026-W02',4,3],['2026-W03',6,5],['2026-W04',17,10],['2026-W05',10,9],['2026-W06',15,9],
 ['2026-W07',6,5],['2026-W08',6,5],['2026-W09',4,4],['2026-W10',11,5],['2026-W11',12,10],['2026-W12',7,7],
 ['2026-W13',12,9],['2026-W14',7,6],['2026-W15',14,12],['2026-W16',18,13],['2026-W17',36,31],['2026-W18',25,25],
 ['2026-W19',23,23],['2026-W20',25,18],['2026-W21',23,18],['2026-W22',17,13],['2026-W23',21,18],['2026-W24',21,19],
 ['2026-W25',14,14],['2026-W26',14,12],['2026-W27',14,12],['2026-W28',11,10],['2026-W29',23,17],['2026-W30',35,30],
 ['2026-W31',17,13],['2026-W32',13,13],['2026-W33',25,20],['2026-W34',27,22],['2026-W35',22,20],['2026-W36',42,29],
 ['2026-W37',40,29],
].map(([week, units, orders]) => ({ week, units, orders } as HistoryPoint));

const series = fillWeekGaps(raw);
const svg = renderToStaticMarkup(
  <DemandAreaChart series={series} stockMin={30} stockMax={64} width={880} height={288} />,
);
const light = ':root{--background:0 0% 95%;--foreground:0 4% 25%;--muted-foreground:0 0% 45.1%;--border:0 0% 89.8%;--chart-2:173 58% 39%}';
const dark = '.dark{--background:240 6% 10%;--foreground:0 0% 95%;--muted-foreground:0 0% 60%;--border:240 4% 16%;--chart-2:160 60% 45%}';
writeFileSync('chart-preview.html', `<style>
${light} ${dark}
body{font-family:system-ui,sans-serif;margin:0;padding:24px;background:#e6e6e6;display:grid;gap:24px}
.pane{padding:18px;border-radius:8px}
.pane.l{background:hsl(0 0% 95%);color:hsl(0 4% 25%)}
.pane.d{background:hsl(240 6% 10%);color:hsl(0 0% 95%)}
h2{font:600 13px system-ui;margin:0 0 10px;letter-spacing:.08em;text-transform:uppercase;opacity:.6}
</style>
<div class="pane l"><h2>tema claro</h2>${svg}</div>
<div class="pane d dark"><h2>tema escuro</h2>${svg}</div>`);
console.log('gerado: chart-preview.html |', series.length, 'pontos |', svg.length, 'bytes de SVG');
