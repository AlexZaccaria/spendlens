import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { openDatabase } from '../db/database.ts';
import { previousRange, summary, trend } from './analytics.ts';
import { listRecurring, refreshRecurringFlags } from './recurring.ts';
import { findCertainDuplicate, findProbableDuplicate, insertTransactions, listTransactions, updateTransaction, type NewTransaction } from './transactions.ts';
import { categoryFromRules } from './rules.ts';

const tx = (over: Partial<NewTransaction>): NewTransaction => ({
  date: '2026-10-05',
  rawDescription: 'PAGAMENTO POS ESSELUNGA MILANO',
  title: { it: 'Spesa Esselunga', en: 'Esselunga groceries' },
  merchant: 'Esselunga',
  amountMinor: -4530,
  currency: 'EUR',
  baseAmountMinor: -4530,
  categoryId: 'food.groceries',
  confidence: 0.95,
  needsReview: false,
  account: 'Conto',
  note: null,
  importId: null,
  source: 'demo',
  ...over,
});

const query = (over: Record<string, unknown> = {}) =>
  ({ kind: 'all', sort: 'date', dir: 'desc', limit: 100, offset: 0, ...over }) as Parameters<typeof listTransactions>[1];

describe('transactions repository', () => {
  it('skips re-imported rows but keeps identical rows within one batch', () => {
    const db = openDatabase(':memory:');
    const coffee = tx({ rawDescription: 'BAR CENTRALE', merchant: 'Bar Centrale', amountMinor: -120, baseAmountMinor: -120, categoryId: 'food.cafes' });
    assert.equal(insertTransactions(db, [coffee, coffee]).inserted.length, 2);
    const again = insertTransactions(db, [coffee, coffee, tx({})]);
    assert.equal(again.inserted.length, 1);
    assert.equal(again.duplicates, 2);
  });

  it('searches every language of the title, ignoring accents', () => {
    const db = openDatabase(':memory:');
    insertTransactions(db, [tx({ title: { it: 'Caffè al bar', en: 'Coffee at the bar' }, rawDescription: 'BAR X' })]);
    assert.equal(listTransactions(db, query({ q: 'caffe' })).total, 1);
    assert.equal(listTransactions(db, query({ q: 'coff' })).total, 1);
    assert.equal(listTransactions(db, query({ q: 'tea' })).total, 0);
  });

  it('learns a merchant rule from a correction and applies it to the history', () => {
    const db = openDatabase(':memory:');
    const { inserted } = insertTransactions(db, [
      tx({ merchant: 'Amazon', rawDescription: 'AMZN Mktp IT', categoryId: 'shopping.online' }),
      tx({ merchant: 'Amazon', rawDescription: 'AMZN Mktp IT 2', date: '2026-10-07', categoryId: 'shopping.online' }),
    ]);
    updateTransaction(db, inserted[0]!.id, { categoryId: 'shopping.electronics', applyToMerchant: true });
    assert.equal(listTransactions(db, query({ category: 'shopping.electronics' })).total, 2);
    assert.equal(categoryFromRules(db, 'AMAZON'), 'shopping.electronics');
  });

  it('recognises the same payment re-extracted from an overlapping statement', () => {
    const db = openDatabase(':memory:');
    db.exec(`INSERT INTO imports (id, filename, mime, size_bytes, sha256, status, created_at) VALUES
      ('sept-oct', 'a.csv', 'text/csv', 1, 'a', 'done', '2026-11-01'), ('oct', 'b.csv', 'text/csv', 1, 'b', 'done', '2026-11-02')`);
    insertTransactions(db, [tx({ importId: 'sept-oct' })]);
    const { inserted } = insertTransactions(db, [tx({ importId: 'oct', rawDescription: 'POS ESSELUNGA VIALE PAPINIANO' })]);
    assert.equal(inserted.length, 1, 'different text: the fingerprint lets it through');
    assert.ok(findCertainDuplicate(db, inserted[0]!));
    // A different account is a different payment.
    const other = insertTransactions(db, [tx({ importId: 'oct', account: 'Carta', rawDescription: 'ESSELUNGA 2' })]).inserted[0]!;
    assert.equal(findCertainDuplicate(db, other), null);
  });

  it('flags a receipt that duplicates a card payment', () => {
    const db = openDatabase(':memory:');
    insertTransactions(db, [tx({ importId: null })]);
    const { inserted } = insertTransactions(db, [tx({ rawDescription: 'Scontrino Esselunga', date: '2026-10-06', source: 'manual' })]);
    // Same source (no import) is ignored on purpose; give the receipt its own import id.
    assert.equal(findProbableDuplicate(db, { ...inserted[0]!, importId: 'receipt-import' })?.merchant, 'Esselunga');
  });
});

describe('analytics', () => {
  it('reports spending positive, splits by category and compares with the previous month', () => {
    const db = openDatabase(':memory:');
    insertTransactions(db, [
      tx({}),
      tx({ rawDescription: 'Affitto ottobre', merchant: 'Mario Rossi', categoryId: 'housing.rent', amountMinor: -80000, baseAmountMinor: -80000, date: '2026-10-01' }),
      tx({ rawDescription: 'Stipendio', merchant: 'ACME', categoryId: 'income.salary', amountMinor: 250000, baseAmountMinor: 250000, date: '2026-10-27' }),
      tx({ rawDescription: 'Giroconto', merchant: null, categoryId: 'transfer.internal', amountMinor: -50000, baseAmountMinor: -50000 }),
      tx({ date: '2026-09-10', amountMinor: -1000, baseAmountMinor: -1000 }),
    ]);
    const s = summary(db, { from: '2026-10-01', to: '2026-10-31' }, 'EUR');
    assert.equal(s.totals.expenseMinor, 84530);
    assert.equal(s.totals.incomeMinor, 250000);
    assert.equal(s.categories[0]!.id, 'housing');
    assert.equal(s.categories.find((c) => c.id === 'food')!.previousMinor, 1000);
    assert.equal(s.daily.length, 31);
    assert.equal(s.previous.range.from, '2026-09-01');

    const t = trend(db, '2026-10', 3);
    assert.deepEqual(t.months, ['2026-08', '2026-09', '2026-10']);
    assert.deepEqual(t.expense, [0, 1000, 84530]);
  });

  it('adds up what was charged when every row of a total is in one foreign currency', () => {
    const db = openDatabase(':memory:');
    const peso = (over: Partial<NewTransaction>): NewTransaction => tx({ currency: 'PHP', date: '2026-11-03', ...over });
    const pecorino = { description: 'PECORINO', title: { it: 'Pecorino', en: 'Pecorino cheese' }, quantity: 1, amountMinor: -78_300, categoryId: 'food.groceries' };
    insertTransactions(db, [
      peso({ rawDescription: 'Rent', merchant: null, categoryId: 'housing.rent', amountMinor: -2_500_000, baseAmountMinor: -34_928 }),
      peso({ rawDescription: 'ROBINSONS', merchant: 'Robinsons Supermarket', amountMinor: -78_300, baseAmountMinor: -1_094, items: [pecorino] }),
      peso({ rawDescription: 'Salary', merchant: 'ACME', categoryId: 'income.salary', amountMinor: 5_000_000, baseAmountMinor: 69_856 }),
    ]);
    const november = { from: '2026-11-01', to: '2026-11-30' };
    const s = summary(db, november, 'EUR', '2026-11-05');
    assert.deepEqual(s.totals.charged, {
      expense: { amountMinor: 2_578_300, currency: 'PHP' },
      income: { amountMinor: 5_000_000, currency: 'PHP' },
      net: { amountMinor: 2_421_700, currency: 'PHP' },
    });
    assert.deepEqual(s.products[0]!.charged, { amountMinor: 78_300, currency: 'PHP' });
    assert.deepEqual(s.merchants.find((m) => m.name === 'Robinsons Supermarket')!.charged, { amountMinor: 78_300, currency: 'PHP' });
    assert.deepEqual(listTransactions(db, query({ kind: 'expense' })).sumCharged, { amountMinor: -2_578_300, currency: 'PHP' });

    // A row in euros: the totals it belongs to have no single currency as charged any more.
    insertTransactions(db, [tx({ date: '2026-11-04' })]);
    const mixed = summary(db, november, 'EUR', '2026-11-05');
    assert.equal(mixed.totals.charged.expense, null);
    assert.equal(mixed.totals.charged.net, null);
    assert.deepEqual(mixed.totals.charged.income, { amountMinor: 5_000_000, currency: 'PHP' });
    assert.equal(summary(db, november, 'PHP', '2026-11-05').totals.charged.income, null, 'nothing to add in the base currency');
  });

  it('compares the month in progress with the same days of the previous month', () => {
    assert.deepEqual(previousRange({ from: '2026-11-01', to: '2026-11-30' }, '2026-11-05'), { from: '2026-10-01', to: '2026-10-05' });
    assert.deepEqual(previousRange({ from: '2026-03-01', to: '2026-03-31' }, '2026-03-31'), { from: '2026-02-01', to: '2026-02-28' });
    assert.deepEqual(previousRange({ from: '2026-10-01', to: '2026-10-31' }, '2026-11-05'), { from: '2026-09-01', to: '2026-09-30' });
    assert.deepEqual(previousRange({ from: '2026-10-10', to: '2026-10-12' }, '2026-11-05'), { from: '2026-10-07', to: '2026-10-09' });
  });

  it('detects a monthly subscription and flags its rows', () => {
    const db = openDatabase(':memory:');
    insertTransactions(
      db,
      ['2026-07-03', '2026-08-03', '2026-09-03', '2026-10-03'].map((date) =>
        tx({ date, rawDescription: `NETFLIX.COM ${date}`, merchant: 'Netflix', categoryId: 'subscriptions.streaming', amountMinor: -1399, baseAmountMinor: -1399 }),
      ),
    );
    const items = listRecurring(db, '2026-10-20');
    assert.equal(items.length, 1);
    assert.equal(items[0]!.cadenceDays, 30);
    assert.equal(items[0]!.nextDate, '2026-11-03');
    assert.ok(items[0]!.active);
    refreshRecurringFlags(db, '2026-10-20');
    assert.equal(listTransactions(db, query()).items.filter((t) => t.recurring).length, 4);
  });
});
