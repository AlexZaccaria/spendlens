import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

// No network in tests: only the rates written below are known.
process.env['SPENDLENS_FX_API'] = 'http://127.0.0.1:9';

const { openDatabase } = await import('../db/database.ts');
const { baseCurrency } = await import('../repo/settings.ts');
const { getTransactions, insertTransactions } = await import('../repo/transactions.ts');
const { listRecurring, saveFixed } = await import('../repo/recurring.ts');
const { rebase } = await import('./fx.ts');
type NewTransaction = import('../repo/transactions.ts').NewTransaction;

const row = (over: Partial<NewTransaction>): NewTransaction => ({
  date: '2026-10-01',
  rawDescription: 'line',
  title: { it: 'Riga', en: 'Line' },
  merchant: 'Shop',
  amountMinor: -1000,
  currency: 'EUR',
  baseAmountMinor: -1000,
  categoryId: 'food.groceries',
  confidence: 1,
  needsReview: false,
  account: null,
  note: null,
  importId: null,
  source: 'manual',
  ...over,
});

describe('changing the base currency', () => {
  it('converts every transaction at the rate of its day, receipt lines included, and counts the ones without a rate', async () => {
    const db = openDatabase(':memory:');
    const rate = db.prepare('INSERT INTO fx_rates (date, base, quote, rate) VALUES (?, ?, ?, ?)');
    rate.run('2026-10-01', 'EUR', 'USD', 1.1);
    rate.run('2026-10-20', 'EUR', 'USD', 1.2);
    rate.run('2026-10-01', 'GBP', 'USD', 1.3);

    const { inserted } = insertTransactions(db, [
      row({ rawDescription: 'groceries 1 Oct', amountMinor: -10_000, baseAmountMinor: -10_000 }),
      row({
        rawDescription: 'receipt 20 Oct',
        date: '2026-10-20',
        amountMinor: -5_000,
        baseAmountMinor: -5_000,
        items: [
          { description: 'A', title: { it: 'A', en: 'A' }, quantity: null, amountMinor: -3_000, categoryId: 'food.groceries' },
          { description: 'B', title: { it: 'B', en: 'B' }, quantity: null, amountMinor: -2_000, categoryId: 'shopping.home' },
        ],
      }),
      row({ rawDescription: 'London', currency: 'GBP', amountMinor: -2_000, baseAmountMinor: null }),
      row({ rawDescription: 'Zurich', currency: 'CHF', amountMinor: -4_000, baseAmountMinor: null }),
      row({ rawDescription: 'New York', currency: 'USD', amountMinor: -700, baseAmountMinor: -650 }),
    ]);

    const result = await rebase(db, 'USD');
    assert.deepEqual(result, { converted: 4, missing: 1 });
    assert.equal(baseCurrency(db), 'USD');

    const after = new Map(getTransactions(db, inserted.map((t) => t.id)).map((t) => [t.rawDescription, t]));
    assert.equal(after.get('groceries 1 Oct')!.baseAmountMinor, -11_000);
    assert.equal(after.get('receipt 20 Oct')!.baseAmountMinor, -6_000);
    assert.deepEqual(after.get('receipt 20 Oct')!.items.map((i) => [i.amountMinor, i.baseAmountMinor]), [
      [-3_000, -3_600],
      [-2_000, -2_400],
    ]);
    assert.equal(after.get('London')!.baseAmountMinor, -2_600);
    assert.equal(after.get('Zurich')!.baseAmountMinor, null, 'no CHF rate: left out of the totals');
    assert.equal(after.get('New York')!.baseAmountMinor, -700, 'already in the base currency');
    // The original amounts never change.
    assert.equal(after.get('London')!.amountMinor, -2_000);
    assert.equal(after.get('London')!.currency, 'GBP');
  });

  it('shows a fixed cost declared in another currency as declared and in the base, at the latest rate', () => {
    const db = openDatabase(':memory:');
    db.prepare('INSERT INTO fx_rates (date, base, quote, rate) VALUES (?, ?, ?, ?)').run('2026-11-04', 'USD', 'EUR', 0.9);
    saveFixed(db, { merchant: 'GitHub', amountMinor: 1_000, currency: 'USD', categoryId: 'subscriptions.software', cadenceDays: 30, nextDate: '2026-11-15' });
    const [github] = listRecurring(db, '2026-11-05');
    assert.equal(github!.averageMinor, 900);
    assert.deepEqual(github!.original, { amountMinor: 1_000, currency: 'USD' });
  });
});
