// Regenerates the demo account's data, the template every demo visitor gets a copy of:
//   npm run seed [-- --months 13 --seed 20261105] [--insight] [--skip-data]
// --insight also writes the AI analysis of the last two months with the owner's AI settings, so the
// demo (which has no AI) shows one; --skip-data keeps the current rows and only writes the analyses.
import { parseArgs } from 'node:util';
import { currentMonthKey, getCategory, monthKeyOf, monthRange, shiftMonth } from '@spendlens/contracts';
import { accountsOfKind } from '../accounts/store.ts';
import { Tenancy } from '../accounts/tenancy.ts';
import { generateInsight } from '../ai/insights.ts';
import { resolveProvider } from '../ai/provider.ts';
import { getAiSettings } from '../ai/settings.ts';
import { DEFAULT_DEMO_MONTHS, DEFAULT_DEMO_SEED } from '../demo/generator.ts';
import { seedDemo } from '../demo/seed.ts';
import { summary } from '../repo/analytics.ts';
import { listRecurring } from '../repo/recurring.ts';
import { baseCurrency } from '../repo/settings.ts';
import { dataRange } from '../repo/transactions.ts';

const { values } = parseArgs({
  options: {
    months: { type: 'string', default: String(DEFAULT_DEMO_MONTHS) },
    seed: { type: 'string', default: String(DEFAULT_DEMO_SEED) },
    insight: { type: 'boolean', default: false },
    'skip-data': { type: 'boolean', default: false },
  },
});

const tenancy = Tenancy.open();
const db = tenancy.db(tenancy.demoTemplate().id);
try {
  if (!values['skip-data']) {
    const { inserted } = seedDemo(db, { months: Number(values.months), seed: Number(values.seed) });
    console.log(`Seeded ${inserted} demo transactions into the demo account.`);

    const euro = (minor: number): string => (minor / 100).toLocaleString('it-IT', { style: 'currency', currency: baseCurrency(db) });
    for (const month of [shiftMonth(currentMonthKey(), -1), currentMonthKey()]) {
      const s = summary(db, monthRange(month), baseCurrency(db));
      console.log(`\n${month}: spent ${euro(s.totals.expenseMinor)}, earned ${euro(s.totals.incomeMinor)}, ${s.totals.txCount} rows`);
      for (const c of s.categories) {
        console.log(`  ${(getCategory(c.id)?.label.en ?? c.id).padEnd(22)} ${String(c.txCount).padStart(3)} rows  ${euro(c.totalMinor).padStart(12)}`);
      }
    }
    console.log(`\nRecurring: ${listRecurring(db).filter((r) => r.active).map((r) => r.merchant).join(', ')}`);
  }

  if (values.insight) {
    const owner = accountsOfKind(tenancy.system, 'user')[0];
    if (!owner) throw new Error('No user account to borrow the AI settings from: npm run account -- create <email>');
    const provider = resolveProvider(getAiSettings(tenancy.db(owner.id)));
    const last = dataRange(db)?.to;
    if (!last) throw new Error('The demo account has no data.');
    // The dashboard opens on the last month with data, or the one before during its first week.
    for (const month of [shiftMonth(monthKeyOf(last), -1), monthKeyOf(last)]) {
      const insight = await generateInsight(db, month, provider);
      console.log(`Analysis of ${month}: ${insight.headline.en}`);
    }
  }
} finally {
  tenancy.close();
}
