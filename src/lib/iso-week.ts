/**
 * Semanas ISO no fuso da fábrica.
 *
 * Os buckets do histórico por SKU são semanas civis de America/Sao_Paulo, não de UTC: um pedido às
 * 02:00Z de segunda ainda é domingo em São Paulo e pertence à semana que fechou. O fuso é fixo aqui
 * porque é regra de negócio — o turno da fábrica — e não preferência de quem está olhando a tela.
 *
 * Sem dependência de fuso: `Intl` resolve o dia civil e o resto é aritmética de calendário sobre a
 * data já resolvida. É o mesmo padrão de src/server/persistence/supplies-read-projection.ts:4.
 */
const SAO_PAULO = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
});

const DAY_MS = 86_400_000;

/** Dia civil de São Paulo (`YYYY-MM-DD`) para um instante qualquer. */
export function saoPauloDay(instant: Date | string | number): string {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (!Number.isFinite(date.valueOf())) throw new Error('Instante inválido para bucket semanal.');
  return SAO_PAULO.format(date);
}

/** Segunda-feira da semana ISO que contém o dia civil, em UTC puro. */
function isoMonday(day: string): Date {
  const [year, month, date] = day.split('-').map(Number);
  const utc = new Date(Date.UTC(year, month - 1, date));
  utc.setUTCDate(utc.getUTCDate() - ((utc.getUTCDay() + 6) % 7));
  return utc;
}

/** Chave ISO (`YYYY-Www`) da semana que contém o dia civil informado. */
export function isoWeekKey(day: string): string {
  // A quinta-feira decide o ano ISO da semana: é a definição da norma.
  const thursday = new Date(isoMonday(day).valueOf() + 3 * DAY_MS);
  const firstThursday = new Date(isoMonday(`${thursday.getUTCFullYear()}-01-04`).valueOf() + 3 * DAY_MS);
  const week = 1 + Math.round((thursday.valueOf() - firstThursday.valueOf()) / (7 * DAY_MS));
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Chave da semana que contém o instante, no fuso da fábrica. */
export const isoWeekOf = (instant: Date | string | number): string => isoWeekKey(saoPauloDay(instant));

/** Dias civis de início e fim da semana, no formato que `salesOrders.data` usa. */
export function isoWeekRange(week: string): { from: string; to: string } {
  const [year, number] = week.split('-W').map(Number);
  // Só finito não basta: uma chave corrompida como "2026-W99" é finita e computaria uma data sem
  // sentido em vez de estourar aqui, que é onde o erro é barato de diagnosticar.
  if (!Number.isFinite(year) || !Number.isInteger(number) || number < 1 || number > 53) {
    throw new Error('Semana ISO inválida.');
  }
  const monday = new Date(isoMonday(`${year}-01-04`).valueOf() + (number - 1) * 7 * DAY_MS);
  return { from: monday.toISOString().slice(0, 10), to: new Date(monday.valueOf() + 6 * DAY_MS).toISOString().slice(0, 10) };
}

/** Semana seguinte. Atravessa a virada de ano, inclusive quando o ano tem 53 semanas. */
export function nextWeek(week: string): string {
  return shiftWeek(week, 7);
}

/** Semana anterior. Nunca deduza `W52` do ano passado: 2026, por exemplo, tem 53. */
export function previousWeek(week: string): string {
  return shiftWeek(week, -7);
}

/** Desloca a semana por dias inteiros a partir da segunda-feira, deixando a norma decidir o resto. */
function shiftWeek(week: string, days: number): string {
  const monday = Date.parse(`${isoWeekRange(week).from}T00:00:00Z`);
  return isoWeekKey(new Date(monday + days * DAY_MS).toISOString().slice(0, 10));
}

/** Janela máxima mantida no rollup. */
export const HISTORY_WEEKS = 104;

/**
 * Semanas fechadas depois de `after`, em ordem, sem incluir a semana corrente.
 *
 * Sem checkpoint, começa uma janela inteira atrás. Se `after` for mais velho que a janela de
 * retenção, o início é adiantado para a borda da janela em vez de para onde o checkpoint parou:
 * semanas mais velhas que isso seriam podadas assim que gravadas, e processá-las só atrasaria
 * alcançar as semanas que de fato importam. Chaves ISO (`YYYY-Www`, semana sempre com 2 dígitos)
 * ordenam lexicograficamente na mesma ordem cronológica, então a comparação de string basta pro clamp.
 *
 * Com o clamp, a distância máxima legítima entre o início e `current` é sempre `HISTORY_WEEKS` — a
 * mesma do caso sem checkpoint. Se o laço precisar de mais voltas que isso, não é histórico grande:
 * é aritmética quebrada ou um checkpoint corrompido (inclusive uma chave no futuro, que o cursor
 * nunca alcança porque só anda pra frente). Por isso o laço estoura em exceção nesse caso, em vez de
 * devolver uma lista incompleta em silêncio — era exatamente pra isso que o teto do laço existia.
 */
export function closedWeeksSince(after: string | null, now: Date = new Date()): string[] {
  const current = isoWeekOf(now);
  const windowEdge = isoWeekOf(new Date(now.valueOf() - HISTORY_WEEKS * 7 * DAY_MS));
  let cursor = after ? nextWeek(after) : windowEdge;
  if (cursor < windowEdge) cursor = windowEdge;
  const weeks: string[] = [];
  for (let guard = 0; guard < HISTORY_WEEKS && cursor !== current; guard++) {
    weeks.push(cursor);
    cursor = nextWeek(cursor);
  }
  if (cursor !== current) {
    throw new Error(
      `closedWeeksSince: checkpoint corrompido ou no futuro — depois de ${HISTORY_WEEKS} semanas a partir de ${after ?? '(sem checkpoint)'} ainda não alcançou a semana corrente ${current}.`,
    );
  }
  return weeks;
}
