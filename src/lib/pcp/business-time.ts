/**
 * Tempo útil entre dois instantes: só conta o que cai dentro do expediente cadastrado (intervalos de
 * trabalho por dia da semana) e fora dos feriados. É como o iApp mede a espera e a execução das OS:
 * uma OS parada das 17:30 até a manhã seguinte não acumula a noite.
 *
 * Os horários do expediente são locais da fábrica (America/Sao_Paulo). O deslocamento de cada dia vem
 * do Intl, então a conta continua certa se o horário de verão voltar.
 */

export type WorkPeriod = { weekday: number; startsAt: string; endsAt: string };

export const FACTORY_TIME_ZONE = 'America/Sao_Paulo';
const DAY_MS = 86_400_000;

/** Data local (AAAA-MM-DD) de um instante no fuso da fábrica. */
function localDate(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
}

/** Deslocamento do fuso em minutos para uma data local (ex.: -180 em São Paulo). */
function offsetMinutes(date: string, timeZone: string): number {
  const noon = new Date(`${date}T12:00:00Z`);
  const name = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' }).formatToParts(noon)
    .find(part => part.type === 'timeZoneName')?.value ?? 'GMT';
  const match = /GMT([+-])(\d{2}):?(\d{2})?/.exec(name);
  if (!match) return 0;
  return (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3] ?? 0));
}

/** Instante de um horário local (HH:MM) numa data local. */
function localInstant(date: string, time: string, timeZone: string): number {
  return Date.parse(`${date}T${time}:00Z`) - offsetMinutes(date, timeZone) * 60_000;
}

export function businessMinutes(start: Date, end: Date, periods: readonly WorkPeriod[], holidays: ReadonlySet<string>,
  timeZone = FACTORY_TIME_ZONE): number {
  const from = start.getTime(), to = end.getTime();
  if (!(to > from) || !periods.length) return 0;
  let total = 0;
  // Um dia de folga antes e depois cobre qualquer diferença de fuso na borda.
  for (let day = Date.parse(`${localDate(start, timeZone)}T00:00:00Z`) - DAY_MS; day <= Date.parse(`${localDate(end, timeZone)}T00:00:00Z`) + DAY_MS; day += DAY_MS) {
    const date = new Date(day).toISOString().slice(0, 10);
    if (holidays.has(date)) continue;
    const weekday = new Date(day).getUTCDay();
    for (const period of periods) {
      if (period.weekday !== weekday) continue;
      const overlapStart = Math.max(from, localInstant(date, period.startsAt, timeZone));
      const overlapEnd = Math.min(to, localInstant(date, period.endsAt, timeZone));
      if (overlapEnd > overlapStart) total += overlapEnd - overlapStart;
    }
  }
  return Math.round(total / 60_000);
}

/** 259 → "4h19"; 45 → "45min". */
export function formatMinutes(minutes: number | null): string {
  if (minutes === null) return '—';
  if (minutes < 60) return `${minutes}min`;
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}`;
}
