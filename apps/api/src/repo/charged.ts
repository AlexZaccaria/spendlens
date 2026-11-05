import type { Charged } from '@spendlens/contracts';

// A total in the base currency can also be shown as charged when all of its rows were charged in
// one foreign currency: 25 000 ₱ of rent next to its 349 €. Rows without a base amount (no
// exchange rate yet) stay out of both.

export type ChargedColumns = { currencies: number; currency: string | null; charged: number | null };

/** SQL columns of a group (`currencies`, `currency`, `charged`), read back with `chargedOf`. */
export function chargedColumns(amount: string, currency: string, baseAmount: string): string {
  const converted = (column: string): string => `CASE WHEN ${baseAmount} IS NOT NULL THEN ${column} END`;
  return `count(DISTINCT ${converted(currency)}) AS currencies, max(${converted(currency)}) AS currency, sum(${converted(amount)}) AS charged`;
}

/** The group's sum as charged, with the sign of the figure it goes with; null unless one foreign currency. */
export function chargedOf(row: ChargedColumns | undefined, base: string, sign: 1 | -1 = 1): Charged | null {
  if (!row || Number(row.currencies) !== 1 || !row.currency || row.currency === base) return null;
  return { amountMinor: sign * Number(row.charged), currency: row.currency };
}
