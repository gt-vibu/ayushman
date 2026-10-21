export function localDateTime(date: string, minute: number, timeZone: string): Date | null {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7)) - 1;
  const day = Number(date.slice(8, 10));
  const target = Date.UTC(year, month, day, Math.floor(minute / 60), minute % 60);
  let guess = target;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = formatter.formatToParts(new Date(guess));
    const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
    const observed = Date.UTC(value('year'), value('month') - 1, value('day'), value('hour'), value('minute'));
    const correction = target - observed;
    if (correction === 0) return new Date(guess);
    guess += correction;
  }
  return null;
}

export function weekdayForDate(date: string): number {
  return new Date(`${date}T00:00:00.000Z`).getUTCDay();
}

export function addLocalDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function localNowDate(timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}
