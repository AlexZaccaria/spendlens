import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { openDatabase } from '../db/database.ts';
import { summary, trend } from './analytics.ts';
import { distribute, insertTransactions, listTransactions, updateItem, updateTransaction, type NewTransaction } from './transactions.ts';

const receipt = (over: Partial<NewTransaction> = {}): NewTransaction => ({
  date: '2026-10-09',
  rawDescription: 'ESSELUNGA VIALE PAPINIANO',
  title: { it: 'Spesa da Esselunga', en: 'Esselunga groceries' },
  merchant: 'Esselunga',
  amountMinor: -4000,
  currency: 'EUR',
  baseAmountMinor: -4000,
  categoryId: 'food.groceries',
  confidence: 0.95,
  needsReview: false,
  account: null,
  note: null,
  importId: null,
  source: 'import',
  items: [
    { description: 'PAMPERS BABY DRY 4 X46', title: { it: 'Pannolini', en: 'Nappies' }, quantity: 1, amountMinor: -1290, categoryId: 'family.kids' },
    { description: 'LATTE PS GRANAROLO 1L', title: { it: 'Latte', en: 'Milk' }, quantity: 2, amountMinor: -320, categoryId: 'food.groceries' },
    { description: 'DASH PODS X30', title: { it: 'Detersivo lavatrice', en: 'Laundry detergent' }, quantity: 1, amountMinor: -1590, categoryId: 'shopping.home' },
    { description: 'BANANE', title: { it: 'Banane', en: 'Bananas' }, quantity: 1.2, amountMinor: -950, categoryId: 'food.groceries' },
  ],
  ...over,
});

const query = (over: Record<string, unknown> = {}) =>
  ({ kind: 'all', sort: 'date', dir: 'desc', limit: 100, offset: 0, ...over }) as Parameters<typeof listTransactions>[1];

describe('receipt items', () => {
  it('stores the lines and spreads a receipt-level discount over the categories pro rata', () => {
    const db = openDatabase(':memory:');
    const [tx] = insertTransactions(db, [receipt()]).inserted;
    const adjustments = tx!.items.filter((i) => i.adjustment);
    assert.equal(tx!.items.length - adjustments.length, 4, 'the printed lines are kept as they are');
    assert.deepEqual(
      adjustments.map((a) => [a.categoryId, a.amountMinor]),
      [['family.kids', 47], ['food.groceries', 46], ['shopping.home', 57]],
      'a 1.50 discount on the total, shared by category',
    );
    assert.equal(tx!.items.reduce((s, i) => s + i.amountMinor, 0), -4000);
  });

  it('files each line under its own category in the analytics', () => {
    const db = openDatabase(':memory:');
    insertTransactions(db, [receipt()]);
    const s = summary(db, { from: '2026-10-01', to: '2026-10-31' }, 'EUR', '2026-11-05');
    const byRoot = Object.fromEntries(s.categories.map((c) => [c.id, c.totalMinor]));
    assert.deepEqual(byRoot, { food: 1224, shopping: 1533, family: 1243 });
    assert.equal(s.totals.expenseMinor, 4000, 'the month total does not change');
    assert.equal(trend(db, '2026-10', 1).categories.find((c) => c.id === 'family')!.values[0], 1243);
  });

  it('finds the receipt by category and by item, counting only the matching part', () => {
    const db = openDatabase(':memory:');
    const [tx] = insertTransactions(db, [receipt()]).inserted;
    const kids = listTransactions(db, query({ category: 'family.kids' }));
    assert.equal(kids.total, 1);
    assert.equal(kids.sumBaseMinor, -1243);
    assert.equal(kids.matchedBaseMinor[tx!.id], -1243);
    assert.equal(listTransactions(db, query({ q: 'pannolini' })).total, 1);
    assert.equal(listTransactions(db, query({ q: 'nappies' })).total, 1);
  });

  it('re-files a single line and rebalances when the amount is corrected', () => {
    const db = openDatabase(':memory:');
    const [tx] = insertTransactions(db, [receipt()]).inserted;
    const milk = tx!.items[1]!;
    assert.equal(updateItem(db, tx!.id, milk.id, 'food.specialty').items[1]!.categoryId, 'food.specialty');
    // The four lines add up to 41.50: with that total no adjustment is left.
    const exact = updateTransaction(db, tx!.id, { amountMinor: -4150 });
    assert.equal(exact.items.filter((i) => i.adjustment).length, 0);
    const fixed = updateTransaction(db, tx!.id, { amountMinor: -4200 });
    assert.equal(fixed.items.reduce((s, i) => s + i.amountMinor, 0), -4200);
    assert.equal(fixed.items.filter((i) => i.adjustment).reduce((s, i) => s + i.amountMinor, 0), -50);
  });

  it('converts foreign-currency lines in proportion, without losing a cent', () => {
    assert.deepEqual(distribute(-1000, [-333, -333, -334]), [-333, -333, -334]);
    const shares = distribute(-1181, [-826, -500, -340]);
    assert.equal(shares.reduce((s, v) => s! + v!, 0), -1181);
    assert.deepEqual(distribute(null, [-1, -2]), [null, null]);
    const db = openDatabase(':memory:');
    const [tx] = insertTransactions(db, [receipt({ currency: 'GBP', amountMinor: -1666, baseAmountMinor: -1972, items: [
      { description: 'NAPPIES', title: { it: 'Pannolini', en: 'Nappies' }, quantity: null, amountMinor: -826, categoryId: 'family.kids' },
      { description: 'MILK', title: { it: 'Latte', en: 'Milk' }, quantity: null, amountMinor: -840, categoryId: 'food.groceries' },
    ] })]).inserted;
    assert.equal(tx!.items.reduce((s, i) => s + i.baseAmountMinor!, 0), -1972);
  });
});

describe('product totals in the summary', () => {
  it('adds the same product up across receipts and shops, with the previous month', () => {
    const db = openDatabase(':memory:');
    const shops = ['Esselunga', 'Coop', 'Carrefour', 'Prenatal', 'Amazon'];
    const nappies = (date: string, shop: string, euros: number): NewTransaction =>
      receipt({
        date,
        merchant: shop,
        rawDescription: `${shop} ${date}`,
        amountMinor: -(euros * 100 + 300),
        baseAmountMinor: -(euros * 100 + 300),
        items: [
          { description: 'PAMPERS', title: { it: 'Pannolini', en: 'Nappies' }, quantity: 1, amountMinor: -euros * 100, categoryId: 'family.kids' },
          { description: 'LATTE', title: { it: 'Latte', en: 'Milk' }, quantity: 2, amountMinor: -300, categoryId: 'food.groceries' },
        ],
      });
    insertTransactions(db, [
      ...Array.from({ length: 10 }, (_, i) => nappies(`2026-10-${String(i + 2).padStart(2, '0')}`, shops[i % shops.length]!, 1000)),
      nappies('2026-09-15', 'Esselunga', 200),
    ]);
    const s = summary(db, { from: '2026-10-01', to: '2026-10-31' }, 'EUR', '2026-11-05');
    assert.deepEqual(s.products[0], {
      title: { it: 'Pannolini', en: 'Nappies' },
      categoryId: 'family.kids',
      totalMinor: 1_000_000,
      charged: null,
      previousMinor: 20_000,
      purchases: 10,
    });
    assert.deepEqual(s.products.map((p) => [p.title.it, p.totalMinor]), [['Pannolini', 1_000_000], ['Latte', 3_000]]);
  });
});
