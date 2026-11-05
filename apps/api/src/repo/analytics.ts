import {
  addDays,
  daysBetween,
  monthKeyOf,
  monthRange,
  monthsEndingAt,
  shiftMonth,
  todayIso,
  type Charged,
  type DateRange,
  type LocalizedText,
  type MonthKey,
  type Summary,
  type Trend,
} from '@spendlens/contracts';
import type { Db } from '../db/database.ts';
import { chargedColumns, chargedOf, type ChargedColumns } from './charged.ts';
import { hydrate } from './transactions.ts';

// Spending is reported positive: an expense row is stored negative, so totals negate the sum.
// Rows with no base-currency amount yet (missing exchange rate) are left out and counted apart.

interface Totals {
  readonly expense: number;
  readonly income: number;
}

function totals(db: Db, range: DateRange): Totals & { txCount: number; reviewCount: number; unconverted: number } {
  const row = db
    .prepare(
      `SELECT
         coalesce(-sum(CASE WHEN kind = 'expense' THEN base_amount_minor END), 0) AS expense,
         coalesce(sum(CASE WHEN kind = 'income' THEN base_amount_minor END), 0) AS income,
         count(*) AS tx_count,
         coalesce(sum(needs_review), 0) AS review_count,
         coalesce(sum(base_amount_minor IS NULL), 0) AS unconverted
       FROM transactions WHERE date BETWEEN :from AND :to`,
    )
    .get({ ...range }) as Record<string, number>;
  return {
    expense: Number(row['expense']),
    income: Number(row['income']),
    txCount: Number(row['tx_count']),
    reviewCount: Number(row['review_count']),
    unconverted: Number(row['unconverted']),
  };
}

/** Spending, income and net of the period as charged (see charged.ts); net needs one currency across both. */
function chargedTotals(db: Db, range: DateRange, base: string): Summary['totals']['charged'] {
  const rows = db
    .prepare(
      `SELECT kind, ${chargedColumns('amount_minor', 'currency', 'base_amount_minor')}
       FROM transactions WHERE kind IN ('expense', 'income') AND date BETWEEN :from AND :to GROUP BY kind`,
    )
    .all({ ...range }) as (ChargedColumns & { kind: string })[];
  const expense = chargedOf(rows.find((r) => r.kind === 'expense'), base, -1);
  const income = chargedOf(rows.find((r) => r.kind === 'income'), base);
  const parts = rows.map((r) => chargedOf(r, base));
  const currency = parts[0]?.currency;
  const net = currency && parts.every((p) => p?.currency === currency) ? { amountMinor: parts.reduce((s, p) => s + p!.amountMinor, 0), currency } : null;
  return { expense, income, net };
}

/**
 * The period `range` is compared with. A whole past month → the previous month. The month in
 * progress → the same days of the previous month (1–5 Nov vs 1–5 Oct), since comparing five days
 * with thirty-one says nothing. Any other range → the same number of days just before it.
 */
export function previousRange(range: DateRange, today: string = todayIso()): DateRange {
  const month = monthKeyOf(range.from);
  const whole = monthRange(month);
  if (whole.from === range.from && whole.to === range.to) {
    const previous = monthRange(shiftMonth(month, -1));
    if (today < range.from || today >= range.to) return previous;
    const elapsed = daysBetween(range.from, today);
    const to = addDays(previous.from, elapsed);
    return { from: previous.from, to: to < previous.to ? to : previous.to };
  }
  const length = daysBetween(range.from, range.to) + 1;
  return { from: addDays(range.from, -length), to: addDays(range.from, -1) };
}

function monthlyExpense(db: Db, months: readonly MonthKey[]): Map<MonthKey, number> {
  const rows = db
    .prepare(
      `SELECT substr(date, 1, 7) AS month, -sum(base_amount_minor) AS expense
       FROM transactions WHERE kind = 'expense' AND date BETWEEN :from AND :to GROUP BY month`,
    )
    .all({ from: monthRange(months[0]!).from, to: monthRange(months.at(-1)!).to }) as { month: string; expense: number }[];
  return new Map(rows.map((r) => [r.month, Number(r.expense)]));
}

function categoryTotals(db: Db, range: DateRange): { root: string; leaf: string; total: number; count: number }[] {
  return (
    db
      .prepare(
        // Receipt items count in their own category: nappies bought at the supermarket are Kids.
        `SELECT root_category_id AS root, category_id AS leaf, -sum(base_amount_minor) AS total, count(DISTINCT transaction_id) AS count
         FROM spend_lines WHERE kind = 'expense' AND date BETWEEN :from AND :to AND base_amount_minor IS NOT NULL
         GROUP BY category_id`,
      )
      .all({ ...range }) as { root: string; leaf: string; total: number; count: number }[]
  ).map((r) => ({ ...r, total: Number(r.total), count: Number(r.count) }));
}

const PRODUCT_LIMIT = 10;

interface ProductRow {
  readonly key: string;
  readonly title: LocalizedText;
  readonly categoryId: string;
  readonly totalMinor: number;
  readonly charged: Charged | null;
  readonly purchases: number;
}

/**
 * Receipt items of a period added up by product name (case-insensitive, Italian title as the key):
 * the same product bought on many receipts and in many shops is one row. Adjustment lines (shared
 * discounts) are left out, so a product shows its printed prices. `limit` < 0 = no limit.
 */
function productTotals(db: Db, range: DateRange, limit: number, base: string): ProductRow[] {
  const rows = db
    .prepare(
      `SELECT lower(json_extract(i.title, '$.it')) AS key, max(i.title) AS title, max(i.category_id) AS category,
              -sum(i.base_amount_minor) AS total, count(DISTINCT i.transaction_id) AS purchases,
              ${chargedColumns('i.amount_minor', 't.currency', 'i.base_amount_minor')}
       FROM transaction_items i JOIN transactions t ON t.id = i.transaction_id
       WHERE i.adjustment = 0 AND t.kind = 'expense' AND t.date BETWEEN :from AND :to AND i.base_amount_minor IS NOT NULL
       GROUP BY key HAVING total > 0 ORDER BY total DESC LIMIT :limit`,
    )
    .all({ ...range, limit }) as ({ key: string; title: string; category: string; total: number; purchases: number } & ChargedColumns)[];
  return rows.map((r) => ({
    key: r.key,
    title: JSON.parse(r.title) as LocalizedText,
    categoryId: r.category,
    totalMinor: Number(r.total),
    charged: chargedOf(r, base, -1),
    purchases: Number(r.purchases),
  }));
}

export function summary(db: Db, range: DateRange, baseCurrency: string, today: string = todayIso()): Summary {
  const current = totals(db, range);
  const prevRange = previousRange(range, today);
  const prev = totals(db, prevRange);

  // Mean of the up-to-6 months before this one that actually have spending.
  const startMonth = monthKeyOf(range.from);
  const history = monthsEndingAt(shiftMonth(startMonth, -1), 6);
  const historyTotals = [...monthlyExpense(db, history).values()].filter((v) => v > 0);
  const averageExpenseMinor = historyTotals.length ? Math.round(historyTotals.reduce((a, b) => a + b, 0) / historyTotals.length) : null;

  const prevByRoot = new Map<string, number>();
  for (const r of categoryTotals(db, prevRange)) prevByRoot.set(r.root, (prevByRoot.get(r.root) ?? 0) + r.total);

  const roots = new Map<string, Summary['categories'][number]>();
  for (const r of categoryTotals(db, range)) {
    const root = roots.get(r.root) ?? { id: r.root, totalMinor: 0, txCount: 0, previousMinor: prevByRoot.get(r.root) ?? 0, children: [] };
    root.totalMinor += r.total;
    root.txCount += r.count;
    root.children.push({ id: r.leaf, totalMinor: r.total, txCount: r.count });
    roots.set(r.root, root);
  }
  const categories = [...roots.values()]
    .filter((c) => c.totalMinor > 0)
    .map((c) => ({ ...c, children: c.children.filter((x) => x.totalMinor > 0).sort((a, b) => b.totalMinor - a.totalMinor) }))
    .sort((a, b) => b.totalMinor - a.totalMinor);

  const merchants = (
    db
      .prepare(
        // A payment typed in by hand without a merchant goes by what was typed ("Aircon cleaning");
        // an imported one without a merchant only has its bank line, and stays out.
        `SELECT max(coalesce(merchant, raw_description)) AS name, max(category_id) AS category, -sum(base_amount_minor) AS total, count(*) AS count,
                ${chargedColumns('amount_minor', 'currency', 'base_amount_minor')}
         FROM transactions
         WHERE kind = 'expense' AND date BETWEEN :from AND :to AND merchant_key IS NOT NULL AND (merchant IS NOT NULL OR source = 'manual')
         GROUP BY merchant_key HAVING total > 0 ORDER BY total DESC LIMIT 8`,
      )
      .all({ ...range }) as ({ name: string; category: string; total: number; count: number } & ChargedColumns)[]
  ).map((m) => ({ name: m.name, categoryId: m.category, totalMinor: Number(m.total), charged: chargedOf(m, baseCurrency, -1), txCount: Number(m.count) }));

  const previousProducts = new Map(productTotals(db, prevRange, -1, baseCurrency).map((p) => [p.key, p.totalMinor]));
  const products = productTotals(db, range, PRODUCT_LIMIT, baseCurrency).map(({ key, ...p }) => ({ ...p, previousMinor: previousProducts.get(key) ?? 0 }));

  const dailyRows = db
    .prepare(
      `SELECT date, -sum(base_amount_minor) AS expense FROM transactions
       WHERE kind = 'expense' AND date BETWEEN :from AND :to GROUP BY date`,
    )
    .all({ ...range }) as { date: string; expense: number }[];
  const dailyMap = new Map(dailyRows.map((d) => [d.date, Number(d.expense)]));
  const daily: Summary['daily'] = [];
  for (let d = range.from; d <= range.to; d = addDays(d, 1)) daily.push({ date: d, expenseMinor: dailyMap.get(d) ?? 0 });

  const largest = hydrate(
    db,
    db
      .prepare(
        `SELECT * FROM transactions WHERE kind = 'expense' AND date BETWEEN :from AND :to AND base_amount_minor < 0
         ORDER BY base_amount_minor ASC LIMIT 5`,
      )
      .all({ ...range }),
  );

  const sparkMonths = monthsEndingAt(monthKeyOf(range.to), 12);
  const spark = monthlyExpense(db, sparkMonths);

  return {
    range,
    baseCurrency,
    totals: {
      expenseMinor: current.expense,
      incomeMinor: current.income,
      netMinor: current.income - current.expense,
      txCount: current.txCount,
      reviewCount: current.reviewCount,
      unconvertedCount: current.unconverted,
      charged: chargedTotals(db, range, baseCurrency),
    },
    previous: { range: prevRange, expenseMinor: prev.expense, incomeMinor: prev.income },
    averageExpenseMinor,
    categories,
    merchants,
    products,
    daily,
    largest,
    monthly: sparkMonths.map((month) => ({ month, expenseMinor: Math.max(0, spark.get(month) ?? 0) })),
  };
}

/** Monthly spending and income for the `count` months ending with `last`, split by root category. */
export function trend(db: Db, last: MonthKey, count: number): Trend {
  const months = monthsEndingAt(last, count);
  const rows = db
    .prepare(
      `SELECT substr(date, 1, 7) AS month, kind, root_category_id AS root, sum(base_amount_minor) AS total
       FROM spend_lines WHERE kind IN ('expense', 'income') AND date BETWEEN :from AND :to
       GROUP BY month, kind, root`,
    )
    .all({ from: monthRange(months[0]!).from, to: monthRange(last).to }) as { month: string; kind: string; root: string; total: number }[];

  const index = new Map(months.map((m, i) => [m, i]));
  const expense = months.map(() => 0);
  const income = months.map(() => 0);
  const byRoot = new Map<string, number[]>();
  for (const r of rows) {
    const i = index.get(r.month);
    if (i === undefined) continue;
    const total = Number(r.total);
    if (r.kind === 'income') {
      income[i]! += total;
      continue;
    }
    expense[i]! += -total;
    const values = byRoot.get(r.root) ?? months.map(() => 0);
    values[i]! += -total;
    byRoot.set(r.root, values);
  }
  const categories = [...byRoot.entries()]
    .map(([id, values]) => ({ id, values: values.map((v) => Math.max(0, v)) }))
    .filter((c) => c.values.some((v) => v > 0))
    .sort((a, b) => b.values.reduce((x, y) => x + y, 0) - a.values.reduce((x, y) => x + y, 0));
  return { months, expense: expense.map((v) => Math.max(0, v)), income, categories };
}
