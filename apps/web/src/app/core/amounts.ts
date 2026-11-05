import type { Charged, Transaction, TransactionItem } from '@spendlens/contracts';
import type { I18n } from './i18n/i18n';

/**
 * The amount as charged — "15,20 US$" — when the purchase was in another currency than the base:
 * shown next to the converted amount wherever a single purchase or receipt line appears. Null in
 * the base currency, where the two are the same. Positive, like the spending figures it sits by.
 */
export function originalAmount(i18n: I18n, tx: Transaction, item: TransactionItem | null, base: string): string | null {
  if (tx.currency === base) return null;
  return i18n.money(Math.abs(item ? item.amountMinor : tx.amountMinor), tx.currency);
}

/**
 * A total as charged — "25.000,00 ₱" next to "349 €" — when every purchase in it was charged in one
 * currency other than the base. Null otherwise: a mix of currencies only adds up in the base one.
 */
export function chargedAmount(i18n: I18n, charged: Charged | null, base: string, options?: Parameters<I18n['money']>[2]): string | null {
  return charged && charged.currency !== base ? i18n.money(charged.amountMinor, charged.currency, options) : null;
}
