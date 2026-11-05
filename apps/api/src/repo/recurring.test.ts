import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { openDatabase } from '../db/database.ts';
import { deleteRecurringRule, ignoreRecurring, listIgnored, listRecurring, nextOnSchedule, refreshRecurringFlags, saveFixed } from './recurring.ts';
import { insertTransactions, listTransactions, type NewTransaction } from './transactions.ts';

const charge = (date: string, merchant: string, euros: number, categoryId = 'subscriptions.streaming'): NewTransaction => ({
  date,
  rawDescription: `${merchant.toUpperCase()} ${date}`,
  title: { it: merchant, en: merchant },
  merchant,
  amountMinor: -Math.round(euros * 100),
  currency: 'EUR',
  baseAmountMinor: -Math.round(euros * 100),
  categoryId,
  confidence: 1,
  needsReview: false,
  account: null,
  note: null,
  importId: null,
  source: 'manual',
});

const netflix = ['2026-07-03', '2026-08-03', '2026-09-03', '2026-10-03'].map((d) => charge(d, 'Netflix', 13.99));
const all = { kind: 'all', sort: 'date', dir: 'desc', limit: 100, offset: 0 } as Parameters<typeof listTransactions>[1];

describe('fixed cost schedule', () => {
  it('keeps the day of the month, clamped to short months, and never goes back before the first charge given', () => {
    assert.equal(nextOnSchedule('2026-01-31', 30, '2026-02-10'), '2026-02-28');
    assert.equal(nextOnSchedule('2026-10-03', 30, '2026-11-05'), '2026-12-03');
    assert.equal(nextOnSchedule('2027-03-03', 30, '2026-11-05'), '2027-03-03', 'nothing before the first charge given');
    assert.equal(nextOnSchedule('2026-11-05', 30, '2026-11-05'), '2026-11-05');
    assert.equal(nextOnSchedule('2026-01-15', 91, '2026-11-05'), '2027-01-15');
    assert.equal(nextOnSchedule('2026-11-02', 7, '2026-11-05'), '2026-11-09');
    assert.equal(nextOnSchedule('2025-02-28', 365, '2026-11-05'), '2027-02-28');
  });
});

describe('declared and excluded fixed costs', () => {
  it('shows a declared charge at once, before any payment, and flags its payments once they come', () => {
    const db = openDatabase(':memory:');
    saveFixed(db, { merchant: 'Mario Rossi', amountMinor: 85_000, currency: 'EUR', categoryId: 'housing.rent', cadenceDays: 30, nextDate: '2026-11-03' });

    const [rent] = listRecurring(db, '2026-10-20');
    assert.equal(rent!.source, 'manual');
    assert.equal(rent!.merchant, 'Mario Rossi');
    assert.equal(rent!.nextDate, '2026-11-03');
    assert.equal(rent!.lastDate, null);
    assert.equal(rent!.occurrences, 0);
    assert.equal(rent!.monthlyMinor, 86_247);

    // The first payment, and an unrelated small charge from the same person.
    insertTransactions(db, [charge('2026-11-03', 'Mario Rossi', 850, 'housing.rent'), charge('2026-11-04', 'Mario Rossi', 20, 'gifts.gifts')]);
    refreshRecurringFlags(db, '2026-11-05');
    const [after] = listRecurring(db, '2026-11-05');
    assert.equal(after!.lastDate, '2026-11-03');
    assert.equal(after!.nextDate, '2026-12-03');
    assert.deepEqual(
      listTransactions(db, all).items.map((t) => [t.amountMinor, t.recurring]),
      [
        [-2000, false],
        [-85_000, true],
      ],
    );

    // Paid on the day it falls due: the next charge is the following one.
    insertTransactions(db, [charge('2026-12-03', 'Mario Rossi', 850, 'housing.rent')]);
    assert.equal(listRecurring(db, '2026-12-03')[0]!.nextDate, '2027-01-03');
  });

  it('replaces a detected charge with the declared one, and leaves out an excluded one until restored', () => {
    const db = openDatabase(':memory:');
    insertTransactions(db, netflix);
    assert.equal(listRecurring(db, '2026-10-20')[0]!.source, 'detected');

    saveFixed(db, { merchant: 'Netflix', amountMinor: 1599, currency: 'EUR', categoryId: 'subscriptions.streaming', cadenceDays: 30, nextDate: '2026-11-03' });
    const declared = listRecurring(db, '2026-10-20');
    assert.equal(declared.length, 1);
    assert.equal(declared[0]!.source, 'manual');
    assert.equal(declared[0]!.averageMinor, 1599);
    assert.equal(declared[0]!.occurrences, 4);

    ignoreRecurring(db, 'NETFLIX');
    assert.deepEqual(listRecurring(db, '2026-10-20'), []);
    refreshRecurringFlags(db, '2026-10-20');
    assert.equal(listTransactions(db, all).items.filter((t) => t.recurring).length, 0);

    const [excluded] = listIgnored(db);
    assert.equal(excluded!.merchant, 'NETFLIX');
    assert.equal(deleteRecurringRule(db, excluded!.id), true);
    assert.equal(listRecurring(db, '2026-10-20')[0]!.source, 'detected');
  });
});
