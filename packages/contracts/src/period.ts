/** A calendar month, `YYYY-MM`. Dates are plain `YYYY-MM-DD` strings: a transaction happens on a
 *  day, not at an instant, so no time zone ever applies. */
export type MonthKey = string;

export interface DateRange {
  readonly from: string;
  readonly to: string;
}

const pad = (n: number): string => String(n).padStart(2, '0');

export function monthKeyOf(date: string): MonthKey {
  return date.slice(0, 7);
}

let clockOffsetMs = 0;

/** The current instant: real time, except in the static demo, which lives on the day its data was
 *  captured (`setToday`). */
export function now(): Date {
  return new Date(Date.now() + clockOffsetMs);
}

/** Moves the clock to `day` (`YYYY-MM-DD`); the time of day keeps running. */
export function setToday(day: string): void {
  const real = new Date();
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const moved = new Date(real);
  moved.setFullYear(y, m - 1, d);
  clockOffsetMs = moved.getTime() - real.getTime();
}

export function todayIso(at: Date = now()): string {
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

export function currentMonthKey(at: Date = now()): MonthKey {
  return monthKeyOf(todayIso(at));
}

export function shiftMonth(key: MonthKey, delta: number): MonthKey {
  const [y, m] = key.split('-').map(Number) as [number, number];
  const index = y * 12 + (m - 1) + delta;
  return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}`;
}

export function daysInMonth(key: MonthKey): number {
  const [y, m] = key.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function monthRange(key: MonthKey): DateRange {
  return { from: `${key}-01`, to: `${key}-${pad(daysInMonth(key))}` };
}

/** The `count` months ending with `last`, oldest first. */
export function monthsEndingAt(last: MonthKey, count: number): MonthKey[] {
  return Array.from({ length: count }, (_, i) => shiftMonth(last, i - count + 1));
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}
