import { fromMinor, getCategory, monthRange, type Insight, type MonthKey } from '@spendlens/contracts';
import type { Db } from '../db/database.ts';
import { nowIso } from '../lib/text.ts';
import { insightAnswerSchema, INSIGHT_JSON_SCHEMA } from '../ingest/extraction.ts';
import { INSIGHT_SYSTEM_PROMPT } from '../ingest/prompt.ts';
import { summary, trend } from '../repo/analytics.ts';
import { listRecurring } from '../repo/recurring.ts';
import { baseCurrency } from '../repo/settings.ts';
import { AiError } from './errors.ts';
import type { LlmProvider } from './provider.ts';

export class NoDataError extends Error {}

const label = (id: string): string => {
  const c = getCategory(id);
  return c ? `${c.label.en} / ${c.label.it}` : id;
};

/** The month's aggregates as compact JSON for the model: figures only, already computed. */
export function insightInput(db: Db, month: MonthKey): Record<string, unknown> | null {
  const base = baseCurrency(db);
  const s = summary(db, monthRange(month), base);
  if (s.totals.txCount === 0) return null;
  const money = (minor: number) => Math.round(fromMinor(minor, base) * 100) / 100;
  const t = trend(db, month, 6);
  return {
    month,
    baseCurrency: base,
    spent: money(s.totals.expenseMinor),
    income: money(s.totals.incomeMinor),
    net: money(s.totals.netMinor),
    savingsRatePercent: s.totals.incomeMinor > 0 ? Math.round((s.totals.netMinor / s.totals.incomeMinor) * 100) : null,
    previousMonth: { spent: money(s.previous.expenseMinor), income: money(s.previous.incomeMinor) },
    averageMonthlySpendingLast6Months: s.averageExpenseMinor === null ? null : money(s.averageExpenseMinor),
    categories: s.categories.slice(0, 8).map((c) => ({
      category: label(c.id),
      spent: money(c.totalMinor),
      previousMonth: money(c.previousMinor),
      transactions: c.txCount,
      topSubcategories: c.children.slice(0, 3).map((x) => ({ category: label(x.id), spent: money(x.totalMinor) })),
    })),
    topMerchants: s.merchants.slice(0, 6).map((m) => ({ merchant: m.name, category: label(m.categoryId), spent: money(m.totalMinor), transactions: m.txCount })),
    largestExpenses: s.largest.slice(0, 3).map((x) => ({ title: x.title.en, date: x.date, amount: money(-(x.baseAmountMinor ?? 0)), category: label(x.categoryId) })),
    lastSixMonths: t.months.map((m, i) => ({ month: m, spent: money(t.expense[i] ?? 0), income: money(t.income[i] ?? 0) })),
    recurringCharges: listRecurring(db)
      .filter((r) => r.active)
      .slice(0, 8)
      .map((r) => ({ merchant: r.merchant, category: label(r.categoryId), perMonth: money(r.monthlyMinor) })),
    transactionsToReview: s.totals.reviewCount,
  };
}

export function getInsight(db: Db, month: MonthKey): Insight | null {
  const row = db.prepare('SELECT data FROM insights WHERE month = ?').get(month) as { data: string } | undefined;
  return row ? (JSON.parse(row.data) as Insight) : null;
}

export async function generateInsight(db: Db, month: MonthKey, provider: LlmProvider): Promise<Insight> {
  const input = insightInput(db, month);
  if (!input) throw new NoDataError(`No transactions in ${month}.`);
  const result = await provider.complete({
    system: INSIGHT_SYSTEM_PROMPT,
    parts: [{ type: 'text', text: `Figures of ${month}:\n${JSON.stringify(input, null, 1)}` }],
    schema: INSIGHT_JSON_SCHEMA,
    schemaName: 'monthly_insight',
    maxOutputTokens: 16_000,
  });
  const parsed = insightAnswerSchema.safeParse(result.json);
  if (!parsed.success) throw new AiError('invalid_output', 'The insight answer does not match the expected shape.');
  const insight: Insight = {
    month,
    generatedAt: nowIso(),
    provider: provider.id,
    model: result.model || provider.model,
    headline: parsed.data.headline,
    bullets: parsed.data.bullets.slice(0, 5),
  };
  db.prepare('INSERT INTO insights (month, data, created_at) VALUES (?, ?, ?) ON CONFLICT (month) DO UPDATE SET data = excluded.data, created_at = excluded.created_at').run(
    month,
    JSON.stringify(insight),
    insight.generatedAt,
  );
  return insight;
}
