import { expect, it } from 'vitest';
import { fillWeekGaps } from '@/lib/history-series';

const point = (week: string, units: number) => ({ week, units, orders: units });

it('fills a week with no invoiced sale as an explicit zero', () => {
  // 2025-W39 não volta da API. Sem o preenchimento, W38 e W40 encostam e o vale desaparece.
  const series = fillWeekGaps([point('2025-W38', 5), point('2025-W40', 2)]);
  expect(series).toEqual([
    { week: '2025-W38', units: 5, orders: 5 },
    { week: '2025-W39', units: 0, orders: 0 },
    { week: '2025-W40', units: 2, orders: 2 },
  ]);
});

it('crosses the year boundary, including a 53-week year', () => {
  // 2026 tem 53 semanas ISO: assumir 52 pularia a virada.
  expect(fillWeekGaps([point('2026-W52', 3), point('2027-W01', 4)]).map(p => p.week))
    .toEqual(['2026-W52', '2026-W53', '2027-W01']);
});

it('leaves an already-continuous series untouched', () => {
  const input = [point('2026-W10', 1), point('2026-W11', 2), point('2026-W12', 3)];
  expect(fillWeekGaps(input)).toEqual(input);
});

it('returns a series of fewer than two points unchanged', () => {
  expect(fillWeekGaps([])).toEqual([]);
  expect(fillWeekGaps([point('2026-W10', 1)])).toEqual([point('2026-W10', 1)]);
});
