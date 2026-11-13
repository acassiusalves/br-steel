import { describe, expect, it } from 'vitest';
import { businessMinutes, formatMinutes } from '@/lib/pcp/business-time';

// Expediente da fábrica no iApp: seg–sex, 07:45–12:00, 13:00–16:00 e 16:15–17:30.
const periods = [1, 2, 3, 4, 5].flatMap(weekday => [
  { weekday, startsAt: '07:45', endsAt: '12:00' }, { weekday, startsAt: '13:00', endsAt: '16:00' }, { weekday, startsAt: '16:15', endsAt: '17:30' },
]);
// Horários locais de São Paulo (UTC-3).
const sp = (iso: string) => new Date(`${iso}-03:00`);
const none = new Set<string>();

describe('businessMinutes', () => {
  it('reproduz o exemplo da reunião: OS das 10:19 às 15:38 conta 4h19, sem o almoço', () => {
    expect(businessMinutes(sp('2026-11-04T10:19:00'), sp('2026-11-04T15:38:00'), periods, none)).toBe(259);
  });
  it('não conta a noite: das 15:38 de um dia às 10:00 do seguinte', () => {
    // 15:38–16:00 (22) + 16:15–17:30 (75) + 07:45–10:00 (135)
    expect(businessMinutes(sp('2026-11-03T15:38:00'), sp('2026-11-04T10:00:00'), periods, none)).toBe(232);
  });
  it('pula fim de semana e feriado', () => {
    // Sexta 17:00 → segunda 08:00: 30 min na sexta + 15 min na segunda.
    expect(businessMinutes(sp('2026-11-06T17:00:00'), sp('2026-11-09T08:00:00'), periods, none)).toBe(45);
    // Com a segunda feriado, só a sexta conta.
    expect(businessMinutes(sp('2026-11-06T17:00:00'), sp('2026-11-09T08:00:00'), periods, new Set(['2026-11-09']))).toBe(30);
  });
  it('fora do expediente, sem expediente cadastrado ou com fim antes do início, é zero', () => {
    expect(businessMinutes(sp('2026-11-04T18:00:00'), sp('2026-11-04T22:00:00'), periods, none)).toBe(0);
    expect(businessMinutes(sp('2026-11-04T10:00:00'), sp('2026-11-04T11:00:00'), [], none)).toBe(0);
    expect(businessMinutes(sp('2026-11-04T11:00:00'), sp('2026-11-04T10:00:00'), periods, none)).toBe(0);
  });
});

describe('formatMinutes', () => {
  it('formata como o iApp', () => {
    expect(formatMinutes(259)).toBe('4h19');
    expect(formatMinutes(45)).toBe('45min');
    expect(formatMinutes(60)).toBe('1h00');
    expect(formatMinutes(null)).toBe('—');
  });
});
