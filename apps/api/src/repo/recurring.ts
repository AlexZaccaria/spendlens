import { addDays, daysBetween, FALLBACK_EXPENSE_CATEGORY, todayIso, type IgnoredRecurring, type RecurringItem } from '@spendlens/contracts';
import { transaction, type Db } from '../db/database.ts';
import { convertLatestMinor } from '../lib/fx.ts';
import { merchantKey, newId, nowIso } from '../lib/text.ts';
import { baseCurrency } from './settings.ts';

interface Cadence {
  readonly days: number;
  readonly min: number;
  readonly max: number;
}

const CADENCES: readonly Cadence[] = [
  { days: 7, min: 5, max: 9 },
  { days: 14, min: 12, max: 16 },
  { days: 30, min: 25, max: 36 },
  { days: 61, min: 52, max: 70 },
  { days: 91, min: 80, max: 100 },
  { days: 365, min: 340, max: 390 },
];

/** Charges further than this from the merchant's median amount break the pattern (utility bills vary). */
const AMOUNT_TOLERANCE = 0.35;
const MIN_OCCURRENCES = 3;

const median = (values: readonly number[]): number => {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};

const monthly = (amountMinor: number, cadenceDays: number): number => Math.round((amountMinor * 30.44) / cadenceDays);

interface Charge {
  readonly id: string;
  readonly key: string;
  readonly merchant: string;
  readonly category: string;
  readonly date: string;
  /** In the base currency. */
  readonly amount: number;
  /** As billed, in `currency`. */
  readonly original: number;
  readonly currency: string;
}

interface Found {
  readonly item: RecurringItem;
  readonly ids: readonly string[];
}

/**
 * A merchant is recurring when it charged at least three times at a steady cadence (weekly to
 * yearly) and for a steady amount: rent, bills, subscriptions, a gym. Detection runs on the
 * whole history, so it needs no configuration and adapts as statements are imported.
 */
function detect(db: Db, today: string, base: string): Found[] {
  const rows = db
    .prepare(
      `SELECT id, merchant_key AS key, coalesce(merchant, raw_description) AS merchant, category_id AS category,
              date, -base_amount_minor AS amount, -amount_minor AS original, currency
       FROM transactions
       WHERE kind = 'expense' AND merchant_key IS NOT NULL AND base_amount_minor < 0
       ORDER BY merchant_key, date`,
    )
    .all() as unknown as Charge[];

  const groups = new Map<string, Charge[]>();
  for (const r of rows) groups.set(r.key, [...(groups.get(r.key) ?? []), { ...r, amount: Number(r.amount) }]);

  const found: Found[] = [];
  for (const [key, charges] of groups) {
    if (charges.length < MIN_OCCURRENCES) continue;
    const typical = median(charges.map((c) => c.amount));
    const steady = charges.filter((c) => Math.abs(c.amount - typical) <= typical * AMOUNT_TOLERANCE);
    if (steady.length < MIN_OCCURRENCES || steady.length < charges.length * 0.7) continue;

    const gaps = steady.slice(1).map((c, i) => daysBetween(steady[i]!.date, c.date)).filter((g) => g > 0);
    if (gaps.length < MIN_OCCURRENCES - 1) continue;
    const gap = median(gaps);
    const cadence = CADENCES.find((c) => gap >= c.min && gap <= c.max);
    if (!cadence) continue;
    if (gaps.filter((g) => g >= cadence.min && g <= cadence.max).length < gaps.length * 0.7) continue;

    const last = steady.at(-1)!;
    const average = Math.round(steady.reduce((s, c) => s + c.amount, 0) / steady.length);
    found.push({
      ids: steady.map((c) => c.id),
      item: {
        id: `auto:${key}`,
        key,
        source: 'detected',
        merchant: last.merchant,
        categoryId: last.category,
        averageMinor: average,
        // A charge billed in another currency is shown as billed, the last time.
        original: last.currency === base ? null : { amountMinor: Number(last.original), currency: last.currency },
        cadenceDays: cadence.days,
        occurrences: steady.length,
        lastDate: last.date,
        nextDate: addDays(last.date, Math.round(gap)),
        monthlyMinor: monthly(average, cadence.days),
        active: daysBetween(last.date, today) <= cadence.max * 1.5,
      },
    });
  }
  return found;
}

// --- What the user states ------------------------------------------------------------------------

interface RuleRow {
  id: string;
  kind: 'fixed' | 'ignored';
  merchant: string;
  merchant_key: string;
  category_id: string | null;
  amount_minor: number | null;
  cadence_days: number | null;
  anchor_date: string | null;
  currency: string | null;
}

const MONTHS_PER_CADENCE: Readonly<Record<number, number>> = { 30: 1, 61: 2, 91: 3, 365: 12 };

/** `date` moved by whole months, the day kept (the 31st becomes the last day of a shorter month). */
function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

/**
 * The first charge of the series on or after `from`. The series starts at `anchor`, the next charge
 * the user gave; monthly cadences keep the day of the month.
 */
export function nextOnSchedule(anchor: string, cadenceDays: number, from: string): string {
  const months = MONTHS_PER_CADENCE[cadenceDays];
  const at = (k: number): string => (months ? addMonths(anchor, k * months) : addDays(anchor, k * cadenceDays));
  let k = 0;
  while (at(k) < from) k++;
  return at(k);
}

/** A declared charge, with the payments of its merchant at about its amount. */
/**
 * A declared charge, in the base currency at the latest known rate when declared in another one
 * (0 until a rate has ever been fetched), with the payments of its merchant at about that amount.
 */
function declared(db: Db, rule: RuleRow, today: string, base: string): Found {
  const currency = rule.currency ?? base;
  const amount = convertLatestMinor(db, rule.amount_minor!, currency, base) ?? 0;
  const payments = db
    .prepare(
      `SELECT id, date FROM transactions
       WHERE kind = 'expense' AND merchant_key = ? AND base_amount_minor < 0 AND abs(-base_amount_minor - ?) <= ?
       ORDER BY date`,
    )
    .all(rule.merchant_key, amount, Math.round(amount * AMOUNT_TOLERANCE)) as { id: string; date: string }[];
  const lastDate = payments.at(-1)?.date ?? null;
  // A charge paid today is settled: the next one is the following.
  const from = lastDate && addDays(lastDate, 1) > today ? addDays(lastDate, 1) : today;
  return {
    ids: payments.map((p) => p.id),
    item: {
      id: rule.id,
      key: rule.merchant_key,
      source: 'manual',
      merchant: rule.merchant,
      categoryId: rule.category_id ?? FALLBACK_EXPENSE_CATEGORY,
      averageMinor: amount,
      original: currency === base ? null : { amountMinor: rule.amount_minor!, currency },
      cadenceDays: rule.cadence_days!,
      occurrences: payments.length,
      lastDate,
      nextDate: nextOnSchedule(rule.anchor_date!, rule.cadence_days!, from),
      monthlyMinor: monthly(amount, rule.cadence_days!),
      active: true,
    },
  };
}

function rules(db: Db): RuleRow[] {
  return db.prepare('SELECT * FROM recurring_rules ORDER BY created_at').all() as unknown as RuleRow[];
}

/** Declared charges, then detected ones the user neither declared nor ruled out. */
function collect(db: Db, today: string): Found[] {
  const all = rules(db);
  const base = baseCurrency(db);
  const stated = new Set(all.map((r) => r.merchant_key));
  const found = [
    ...all.filter((r) => r.kind === 'fixed').map((r) => declared(db, r, today, base)),
    ...detect(db, today, base).filter((d) => !stated.has(d.item.key)),
  ];
  return found.sort((a, b) => Number(b.item.active) - Number(a.item.active) || b.item.monthlyMinor - a.item.monthlyMinor);
}

export function listRecurring(db: Db, today: string = todayIso()): RecurringItem[] {
  return collect(db, today).map((f) => f.item);
}

/** Re-derives the `recurring` flag of every transaction; call after imports, edits and rule changes. */
export function refreshRecurringFlags(db: Db, today: string = todayIso()): void {
  const ids = collect(db, today).flatMap((f) => f.ids);
  transaction(db, () => {
    db.exec('UPDATE transactions SET recurring = 0 WHERE recurring = 1');
    db.prepare('UPDATE transactions SET recurring = 1 WHERE id IN (SELECT value FROM json_each(?))').run(JSON.stringify(ids));
  });
}

/** Thrown when a merchant name normalises to nothing (only digits or punctuation). */
export class InvalidMerchantError extends Error {}

const keyOf = (merchant: string): string => {
  const key = merchantKey(merchant);
  if (!key) throw new InvalidMerchantError(`"${merchant}" does not name a merchant.`);
  return key;
};

/**
 * Declares a fixed cost, or rewrites one (`id`). A merchant has one rule: declaring it replaces
 * an earlier declaration or exclusion of the same merchant.
 */
export function saveFixed(
  db: Db,
  input: { merchant: string; amountMinor: number; currency: string; categoryId: string; cadenceDays: number; nextDate: string },
  id?: string,
): void {
  const key = keyOf(input.merchant);
  transaction(db, () => {
    db.prepare('DELETE FROM recurring_rules WHERE merchant_key = ? OR id = ?').run(key, id ?? '');
    db.prepare(
      `INSERT INTO recurring_rules (id, kind, merchant, merchant_key, category_id, amount_minor, currency, cadence_days, anchor_date, created_at)
       VALUES (?, 'fixed', ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id ?? newId(), input.merchant.trim(), key, input.categoryId, input.amountMinor, input.currency, input.cadenceDays, input.nextDate, nowIso());
  });
}

/** Rules a merchant out of the fixed costs: detection skips it until the rule is removed. */
export function ignoreRecurring(db: Db, merchant: string): void {
  const key = keyOf(merchant);
  transaction(db, () => {
    db.prepare('DELETE FROM recurring_rules WHERE merchant_key = ?').run(key);
    db.prepare(`INSERT INTO recurring_rules (id, kind, merchant, merchant_key, created_at) VALUES (?, 'ignored', ?, ?, ?)`).run(
      newId(),
      merchant.trim(),
      key,
      nowIso(),
    );
  });
}

/** Removes a declaration or an exclusion; false when there was none. */
export function deleteRecurringRule(db: Db, id: string): boolean {
  return Number(db.prepare('DELETE FROM recurring_rules WHERE id = ?').run(id).changes) === 1;
}

export function listIgnored(db: Db): IgnoredRecurring[] {
  return rules(db)
    .filter((r) => r.kind === 'ignored')
    .map((r) => ({ id: r.id, merchant: r.merchant }));
}

/** Merchants seen in the spending, most frequent first: suggestions for the declaration form. */
export function knownMerchants(db: Db, limit = 200): string[] {
  const rows = db
    .prepare(
      `SELECT merchant FROM transactions
       WHERE kind = 'expense' AND merchant IS NOT NULL AND merchant_key IS NOT NULL
       GROUP BY merchant_key ORDER BY count(*) DESC, max(date) DESC LIMIT ?`,
    )
    .all(limit) as { merchant: string }[];
  return rows.map((r) => r.merchant);
}
