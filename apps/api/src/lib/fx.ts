import { addDays, currencyExponent, todayIso } from '@spendlens/contracts';
import { transaction, type Db } from '../db/database.ts';
import { setSetting } from '../repo/settings.ts';
import { rebalanceItems } from '../repo/transactions.ts';

// Exchange rates are the ECB daily reference rates served by Frankfurter (no key, no quota).
// They are cached in `fx_rates`; a day without a rate (weekend, holiday) uses the latest
// earlier one, as banks do.

const API = process.env['SPENDLENS_FX_API'] ?? 'https://api.frankfurter.dev/v1';
const LOOKBACK_DAYS = 7;

function cachedRate(db: Db, date: string, base: string, quote: string): number | null {
  const row = db
    .prepare('SELECT rate FROM fx_rates WHERE base = ? AND quote = ? AND date <= ? AND date >= ? ORDER BY date DESC LIMIT 1')
    .get(base, quote, date, addDays(date, -LOOKBACK_DAYS)) as { rate: number } | undefined;
  return row ? row.rate : null;
}

function storeRates(db: Db, base: string, quote: string, rates: Record<string, Record<string, number>>): void {
  const insert = db.prepare('INSERT OR REPLACE INTO fx_rates (date, base, quote, rate) VALUES (?, ?, ?, ?)');
  for (const [date, byQuote] of Object.entries(rates)) {
    const rate = byQuote[quote];
    if (typeof rate === 'number') insert.run(date, base, quote, rate);
  }
}

/** Downloads the rates covering `dates` in one request; failures are silent (amounts stay unconverted). */
export async function prefetchRates(db: Db, from: string, to: string, dates: readonly string[]): Promise<void> {
  if (from === to || dates.length === 0) return;
  const missing = dates.filter((d) => cachedRate(db, d, from, to) === null);
  if (missing.length === 0) return;
  const sorted = [...missing].sort();
  const today = todayIso();
  const start = addDays(sorted[0]!, -LOOKBACK_DAYS);
  const end = sorted.at(-1)! > today ? today : sorted.at(-1)!;
  try {
    const res = await fetch(`${API}/${start}..${end}?base=${from}&symbols=${to}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return;
    const body = (await res.json()) as { rates?: Record<string, Record<string, number>> };
    if (body.rates) storeRates(db, from, to, body.rates);
    // Dates after the last published rate (today, the future) fall back to the latest one.
    if (sorted.some((d) => cachedRate(db, d, from, to) === null)) {
      const latest = await fetch(`${API}/latest?base=${from}&symbols=${to}`, { signal: AbortSignal.timeout(8000) });
      if (latest.ok) {
        const l = (await latest.json()) as { date: string; rates: Record<string, number> };
        storeRates(db, from, to, { [l.date]: l.rates });
        for (const d of sorted) if (d > l.date) storeRates(db, from, to, { [d]: l.rates });
      }
    }
  } catch {
    // offline or the service is down: the caller keeps the original amount and flags it
  }
}

/** Converts minor units of `from` into minor units of `to` at the rate of `date`; null if unknown. */
export function convertMinor(db: Db, amountMinor: number, from: string, to: string, date: string): number | null {
  if (from === to) return amountMinor;
  const rate = cachedRate(db, date, from, to);
  if (rate === null) return null;
  const major = amountMinor / 10 ** currencyExponent(from);
  return Math.round(major * rate * 10 ** currencyExponent(to));
}

/**
 * Converts at the most recent cached rate, however old: for amounts that belong to no date, such
 * as a declared fixed cost. Null when the pair was never fetched.
 */
export function convertLatestMinor(db: Db, amountMinor: number, from: string, to: string): number | null {
  if (from === to) return amountMinor;
  const row = db.prepare('SELECT rate FROM fx_rates WHERE base = ? AND quote = ? ORDER BY date DESC LIMIT 1').get(from, to) as { rate: number } | undefined;
  if (!row) return null;
  return Math.round((amountMinor / 10 ** currencyExponent(from)) * row.rate * 10 ** currencyExponent(to));
}

/**
 * Makes `base` the currency of every total: each transaction is converted again at the rate of
 * its own day, receipt lines follow their transaction, and the rate of today is fetched for the
 * currencies of declared fixed costs. Without a connection the amounts stay unconverted (null),
 * out of the totals, until a later backfill finds the rates.
 */
export async function rebase(db: Db, base: string): Promise<{ converted: number; missing: number }> {
  const rows = db.prepare('SELECT id, date, amount_minor, currency FROM transactions').all() as {
    id: string;
    date: string;
    amount_minor: number;
    currency: string;
  }[];
  const byCurrency = new Map<string, string[]>();
  for (const r of rows) if (r.currency !== base) byCurrency.set(r.currency, [...(byCurrency.get(r.currency) ?? []), r.date]);
  for (const [currency, dates] of byCurrency) await prefetchRates(db, currency, base, dates);
  const fixedCurrencies = db.prepare(`SELECT DISTINCT currency FROM recurring_rules WHERE kind = 'fixed' AND currency IS NOT NULL`).all() as { currency: string }[];
  for (const { currency } of fixedCurrencies) await prefetchRates(db, currency, base, [todayIso()]);

  const withItems = new Set((db.prepare('SELECT DISTINCT transaction_id AS id FROM transaction_items').all() as { id: string }[]).map((r) => r.id));
  const update = db.prepare('UPDATE transactions SET base_amount_minor = ? WHERE id = ?');
  let missing = 0;
  transaction(db, () => {
    setSetting(db, 'baseCurrency', base);
    for (const r of rows) {
      const converted = convertMinor(db, Number(r.amount_minor), r.currency, base, r.date);
      if (converted === null) missing++;
      update.run(converted, r.id);
      if (withItems.has(r.id)) rebalanceItems(db, r.id);
    }
  });
  return { converted: rows.length - missing, missing };
}

/** Retries every transaction still missing its base amount (e.g. imported while offline). */
export async function backfillBaseAmounts(db: Db, base: string): Promise<number> {
  const rows = db
    .prepare('SELECT id, date, amount_minor, currency FROM transactions WHERE base_amount_minor IS NULL')
    .all() as { id: string; date: string; amount_minor: number; currency: string }[];
  const byCurrency = new Map<string, string[]>();
  for (const r of rows) byCurrency.set(r.currency, [...(byCurrency.get(r.currency) ?? []), r.date]);
  for (const [currency, dates] of byCurrency) await prefetchRates(db, currency, base, dates);
  const update = db.prepare('UPDATE transactions SET base_amount_minor = ? WHERE id = ?');
  let fixed = 0;
  for (const r of rows) {
    const converted = convertMinor(db, Number(r.amount_minor), r.currency, base, r.date);
    if (converted !== null) {
      update.run(converted, r.id);
      rebalanceItems(db, r.id);
      fixed++;
    }
  }
  return fixed;
}
