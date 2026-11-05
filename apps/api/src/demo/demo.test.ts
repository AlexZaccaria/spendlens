import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isCategoryId, monthRange, monthsEndingAt, LANGS } from '@spendlens/contracts';
import { openDatabase } from '../db/database.ts';
import { summary } from '../repo/analytics.ts';
import { listRecurring } from '../repo/recurring.ts';
import { insertTransactions, listTransactions } from '../repo/transactions.ts';
import { generateDemo } from './generator.ts';
import { removeDemo, resetData, seedDemo } from './seed.ts';

const TODAY = '2026-11-05';
const FULL_MONTHS = monthsEndingAt('2026-10', 12);

const query = (over: Record<string, unknown> = {}) =>
  ({ kind: 'all', sort: 'date', dir: 'desc', limit: 500, offset: 0, ...over }) as Parameters<typeof listTransactions>[1];

describe('demo generator', () => {
  it('is deterministic for a seed and a day, and changes with the seed', () => {
    assert.deepEqual(generateDemo({ today: TODAY }), generateDemo({ today: TODAY }));
    assert.notDeepEqual(generateDemo({ today: TODAY, seed: 1 }), generateDemo({ today: TODAY, seed: 2 }));
  });

  it('covers thirteen months up to today and nothing after it', () => {
    const rows = generateDemo({ today: TODAY });
    assert.equal(rows[0]!.date.slice(0, 7), '2025-11');
    assert.ok(rows.every((r) => r.date <= TODAY));
    assert.equal(rows.at(-1)!.date <= TODAY, true);
  });

  it('writes valid categories, a title in every language and base amounts for foreign currencies', () => {
    const rows = generateDemo({ today: TODAY });
    for (const r of rows) {
      assert.ok(isCategoryId(r.categoryId), r.categoryId);
      for (const lang of LANGS) assert.ok(r.title[lang].length > 0, `${r.rawDescription} has no ${lang} title`);
      assert.notEqual(r.baseAmountMinor, null);
    }
    const gbp = rows.filter((r) => r.currency === 'GBP');
    const usd = rows.filter((r) => r.currency === 'USD');
    assert.ok(gbp.length >= 5 && usd.length >= 1);
    // £8.26 at the fixed 1.17 rate.
    assert.equal(gbp.find((r) => r.amountMinor === -826)?.baseAmountMinor, -966);
  });

  it('leaves 8-12 uncertain rows for review', () => {
    const review = generateDemo({ today: TODAY }).filter((r) => r.needsReview);
    assert.ok(review.length >= 8 && review.length <= 12, `${review.length}`);
    assert.ok(review.every((r) => r.confidence >= 0.4 && r.confidence <= 0.6 && r.note !== null));
  });
});

describe('demo seeding', () => {
  it('spends 1.6k-3.2k a month and earns about a salary', () => {
    const db = openDatabase(':memory:');
    seedDemo(db, { today: TODAY });
    const totals = FULL_MONTHS.map((m) => summary(db, monthRange(m), 'EUR').totals);
    for (const [i, t] of totals.entries()) {
      assert.ok(t.expenseMinor >= 160_000 && t.expenseMinor <= 320_000, `${FULL_MONTHS[i]} spent ${t.expenseMinor / 100}`);
    }
    const incomes = totals.map((t) => t.incomeMinor).sort((a, b) => a - b);
    const median = incomes[Math.floor(incomes.length / 2)]!;
    assert.ok(median >= 305_000 && median <= 315_000, `median income ${median / 100}`);
  });

  it('makes rent, bills, subscriptions and the gym show up as recurring', () => {
    const db = openDatabase(':memory:');
    seedDemo(db, { today: TODAY });
    const active = new Set(listRecurring(db, TODAY).filter((r) => r.active).map((r) => r.merchant));
    for (const merchant of ['Mario Rossi', 'Netflix', 'Enel Energia', 'Fastweb', 'Iliad', 'Virgin Active']) {
      assert.ok(active.has(merchant), `${merchant} not recurring`);
    }
    assert.ok(listTransactions(db, query()).items.some((t) => t.recurring));
  });

  it('re-seeding replaces the demo rows and keeps everything else', () => {
    const db = openDatabase(':memory:');
    const first = seedDemo(db, { today: TODAY }).inserted;
    insertTransactions(db, [
      {
        date: '2026-11-01',
        rawDescription: 'Manual row',
        title: { it: 'Riga manuale', en: 'Manual row' },
        merchant: null,
        amountMinor: -500,
        currency: 'EUR',
        baseAmountMinor: -500,
        categoryId: 'other.misc',
        confidence: 1,
        needsReview: false,
        account: null,
        note: null,
        importId: null,
        source: 'manual',
      },
    ]);
    assert.equal(seedDemo(db, { today: TODAY }).inserted, first);
    assert.equal(listTransactions(db, query({ limit: 1 })).total, first + 1);
    assert.equal(removeDemo(db), first);
    assert.equal(listTransactions(db, query()).total, 1);
    resetData(db);
    assert.equal(listTransactions(db, query()).total, 0);
  });
});
