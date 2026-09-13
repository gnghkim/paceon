const DAY = 86_400_000;

export function dayNumber(value: string): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '0001-01-01') throw new RangeError('Expected a valid YYYY-MM-DD date');
  const instant = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(instant) || new Date(instant).toISOString().slice(0, 10) !== value) throw new RangeError('Invalid calendar date');
  return instant / DAY;
}

export function dateFromDay(day: number): string {
  if (!Number.isInteger(day)) throw new RangeError('Expected an integer day');
  const value = new Date(day * DAY).toISOString().slice(0, 10);
  dayNumber(value);
  return value;
}

export function addDays(date: string, count: number): string {
  if (!Number.isInteger(count)) throw new RangeError('Expected an integer day offset');
  return dateFromDay(dayNumber(date) + count);
}

export function isoWeekday(day: number): number {
  return ((day + 3) % 7 + 7) % 7 + 1;
}

export function validateTimezone(timezone: string): void {
  if (typeof timezone !== 'string' || !timezone) throw new RangeError('Timezone is required');
  new Intl.DateTimeFormat('en', { timeZone: timezone });
}

export function toStudyDate(instant: string, timezone: string): string {
  validateTimezone(timezone);
  if (typeof instant !== 'string' || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(instant)) throw new RangeError('Instant must include a timezone offset');
  dayNumber(instant.slice(0, 10));
  const date = new Date(instant);
  if (!Number.isFinite(date.getTime())) throw new RangeError('Invalid instant');
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = (type: string) => parts.find(part => part.type === type)?.value;
  const result = `${get('year')?.padStart(4, '0')}-${get('month')}-${get('day')}`;
  dayNumber(result);
  return result;
}
