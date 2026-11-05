import { todayIso } from '@spendlens/contracts';
import { transaction, type Db } from '../db/database.ts';
import { refreshRecurringFlags } from '../repo/recurring.ts';
import { insertTransactions } from '../repo/transactions.ts';
import { generateDemo, type DemoOptions } from './generator.ts';

/** Replaces the demo rows with a fresh generation; imported and manual rows are left alone. */
export function seedDemo(db: Db, options: DemoOptions = {}): { inserted: number } {
  const rows = generateDemo(options);
  removeDemo(db);
  const { inserted } = insertTransactions(db, rows);
  refreshRecurringFlags(db, options.today ?? todayIso());
  return { inserted: inserted.length };
}

export function removeDemo(db: Db): number {
  // Monthly analyses quote the figures of the data they were written from.
  db.exec('DELETE FROM insights');
  return Number(db.prepare(`DELETE FROM transactions WHERE source = 'demo'`).run().changes);
}

/** Empties the user data — transactions, imports with their files, rules, insights. Settings
 *  (AI provider, base currency) and the exchange-rate cache survive. */
export function resetData(db: Db): void {
  transaction(db, () => {
    db.exec('DELETE FROM transactions; DELETE FROM imports; DELETE FROM rules; DELETE FROM insights;');
  });
}
