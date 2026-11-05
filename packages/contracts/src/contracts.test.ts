import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CATEGORIES, LEAF_CATEGORY_IDS, rootOf } from './categories.ts';
import { fromMinor, toMinor } from './money.ts';
import { daysInMonth, monthRange, monthsEndingAt, now, setToday, shiftMonth, todayIso } from './period.ts';
import { categoryIdSchema, transactionCreateSchema } from './schemas.ts';

describe('money', () => {
  it('uses each currency’s minor unit', () => {
    assert.equal(toMinor(12.345, 'EUR'), 1235);
    assert.equal(toMinor(1200, 'JPY'), 1200);
    assert.equal(toMinor(1.2345, 'KWD'), 1235);
    assert.equal(fromMinor(-4530, 'EUR'), -45.3);
  });
});

describe('periods', () => {
  it('handles month arithmetic across years and leap days', () => {
    assert.equal(shiftMonth('2026-01', -1), '2025-12');
    assert.equal(shiftMonth('2025-12', 13), '2027-01');
    assert.equal(daysInMonth('2028-02'), 29);
    assert.deepEqual(monthRange('2026-02'), { from: '2026-02-01', to: '2026-02-28' });
    assert.deepEqual(monthsEndingAt('2026-02', 3), ['2025-12', '2026-01', '2026-02']);
  });

  it('moves the clock to another day and keeps the time of day running', () => {
    const real = new Date();
    setToday('2026-02-28');
    try {
      assert.equal(todayIso(), '2026-02-28');
      assert.ok(Math.abs(now().getHours() * 60 + now().getMinutes() - (real.getHours() * 60 + real.getMinutes())) <= 1);
    } finally {
      setToday(todayIso(real));
    }
    assert.equal(todayIso(), todayIso(real));
  });
});

describe('taxonomy', () => {
  it('labels every category in every language and files leaves under a root', () => {
    for (const c of CATEGORIES) {
      assert.ok(c.label.it && c.label.en, c.id);
      if (c.parentId) assert.equal(rootOf(c.id).id, c.parentId);
    }
    assert.ok(LEAF_CATEGORY_IDS.includes('food.groceries'));
    assert.ok(!LEAF_CATEGORY_IDS.includes('food'));
  });

  it('gives each colour slot to at most one root category', () => {
    const slots = CATEGORIES.filter((c) => c.parentId === null && c.slot !== null).map((c) => c.slot);
    assert.equal(new Set(slots).size, slots.length);
    assert.ok(slots.every((s) => s! >= 1 && s! <= 8));
  });

  it('validates category ids and manual entries', () => {
    assert.equal(categoryIdSchema.safeParse('food.restaurants').success, true);
    assert.equal(categoryIdSchema.safeParse('food.caviar').success, false);
    assert.equal(transactionCreateSchema.safeParse({ date: '2026-10-05', title: 'Pizza', amount: 0, currency: 'EUR', categoryId: 'food.restaurants' }).success, false);
  });
});
