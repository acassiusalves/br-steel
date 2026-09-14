import { expect, it } from 'vitest';
import { HISTORY_WEEKS, closedWeeksSince, isoWeekKey, isoWeekOf, isoWeekRange, nextWeek, previousWeek, saoPauloDay } from '@/lib/iso-week';

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

it('with no checkpoint, starts exactly one retention window back and still stops before the current week', () => {
  const now = new Date('2026-09-16T12:00:00Z'); // quarta da semana W38
  // 104 semanas (728 dias) antes de 2026-W38 cai em 2024-W38 — conferido por cálculo direto de data.
  expect(closedWeeksSince(null, now)).toHaveLength(HISTORY_WEEKS);
  expect(closedWeeksSince(null, now)[0]).toBe('2024-W38');
  expect(closedWeeksSince(null, now).at(-1)).toBe('2026-W37');
});

it('clamps to the retention window edge when the gap is longer than history, instead of truncating before reaching the current week', () => {
  const now = new Date('2026-09-16T12:00:00Z'); // quarta da semana W38
  // 2023-W20 está a 173 semanas reais de distância — bem além de HISTORY_WEEKS (104). Antes do fix, o
  // laço parava depois de 106 pushes contados a partir de 2023-W21 (a mais velha) e nunca chegava
  // perto de 2026 — essas semanas mais velhas que a janela de retenção seriam podadas de qualquer jeito.
  const weeks = closedWeeksSince('2023-W20', now);
  expect(weeks).toHaveLength(HISTORY_WEEKS);
  expect(weeks[0]).toBe('2024-W38'); // borda da janela, não 2023-W21
  expect(weeks.at(-1)).toBe('2026-W37'); // alcança a semana antes da corrente
});

it('throws instead of silently truncating when the checkpoint can never reach the current week', () => {
  const now = new Date('2026-09-16T12:00:00Z'); // quarta da semana W38
  // Checkpoint na própria semana corrente: nextWeek só anda pra frente, então o cursor nunca volta a
  // ser igual a `current` — antes do fix isso devolvia 106 semanas de "futuro" em silêncio.
  expect(() => closedWeeksSince('2026-W38', now)).toThrow();
  // Checkpoint bem no futuro: mesmo problema, só que mais óbvio.
  expect(() => closedWeeksSince('2030-W01', now)).toThrow();
});

it('rejects an implausible ISO week number instead of computing a nonsense date', () => {
  expect(() => isoWeekRange('2026-W99')).toThrow();
  expect(() => isoWeekRange('2026-W00')).toThrow();
});
