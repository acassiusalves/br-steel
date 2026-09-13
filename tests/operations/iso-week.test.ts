import { expect, it } from 'vitest';
import { closedWeeksSince, isoWeekKey, isoWeekOf, isoWeekRange, nextWeek, previousWeek, saoPauloDay } from '@/lib/iso-week';

it('resolves the civil day in the factory timezone, not UTC', () => {
  // São Paulo é UTC-3 o ano inteiro desde 2019. 03:00Z é a virada do dia civil.
  expect(saoPauloDay('2026-09-14T02:59:00Z')).toBe('2026-09-13');
  expect(saoPauloDay('2026-09-14T03:00:00Z')).toBe('2026-09-14');
});

it('puts a Sunday-night order in the week that is closing, not the one starting', () => {
  // O caso que motiva o fuso: 02:59Z de segunda ainda é domingo na fábrica.
  expect(isoWeekOf('2026-09-14T02:59:00Z')).toBe('2026-W37');
  expect(isoWeekOf('2026-09-14T03:00:00Z')).toBe('2026-W38');
});

it('keys weeks from Monday to Sunday', () => {
  expect(isoWeekKey('2026-09-07')).toBe('2026-W37'); // segunda
  expect(isoWeekKey('2026-09-13')).toBe('2026-W37'); // domingo
  expect(isoWeekKey('2026-09-14')).toBe('2026-W38'); // segunda seguinte
  expect(isoWeekRange('2026-W37')).toEqual({ from: '2026-09-07', to: '2026-09-13' });
});

it('handles the ISO year boundary, where the week can belong to the other year', () => {
  expect(isoWeekKey('2026-01-01')).toBe('2026-W01');
  expect(isoWeekRange('2026-W01')).toEqual({ from: '2025-12-29', to: '2026-01-04' });
  // 2026 tem 53 semanas ISO: assumir 52 quebraria a virada.
  expect(isoWeekKey('2026-12-31')).toBe('2026-W53');
  expect(nextWeek('2026-W53')).toBe('2027-W01');
  expect(nextWeek('2026-W37')).toBe('2026-W38');
  // A volta precisa saber que 2026 terminou em W53, e não em W52.
  expect(previousWeek('2027-W01')).toBe('2026-W53');
  expect(previousWeek('2026-W38')).toBe('2026-W37');
});

it('lists the closed weeks after a checkpoint, never including the current one', () => {
  const now = new Date('2026-09-16T12:00:00Z'); // quarta da semana W38
  expect(closedWeeksSince('2026-W35', now)).toEqual(['2026-W36', '2026-W37']);
  expect(closedWeeksSince('2026-W37', now)).toEqual([]);
});

it('rejects an unparseable instant instead of silently bucketing it', () => {
  expect(() => saoPauloDay('não é data')).toThrow();
});
