/** First instant of the civil day, including days whose midnight is skipped by DST. */
function saoPauloMidnight(day: string) {
  const target = Date.parse(`${day}T00:00:00Z`);
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });
  let low = target - 86400000, high = target + 86400000;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    const parts = Object.fromEntries(formatter.formatToParts(new Date(middle)).map(part => [part.type, part.value]));
    const civilDay = `${parts.year}-${parts.month}-${parts.day}`;
    if (civilDay < day) low = middle + 1; else high = middle;
  }
  return new Date(low).toISOString();
}

export function movementDateBounds(input: { from?: string; to?: string }) {
  const bounds: { from?: string; to?: string } = {};
  if (input.from) bounds.from = saoPauloMidnight(input.from);
  if (input.to) {
    const nextDay = new Date(Date.parse(`${input.to}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
    bounds.to = saoPauloMidnight(nextDay);
  }
  return bounds;
}
