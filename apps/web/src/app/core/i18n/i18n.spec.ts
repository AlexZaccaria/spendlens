import { TestBed } from '@angular/core/testing';
import { I18n } from './i18n';
import { en } from './en';
import { it as itDict } from './it';

// Intl puts a narrow no-break space in some locales: compare with plain spaces.
const plain = (s: string) => s.replace(/[  ]/g, ' ');

describe('I18n', () => {
  let i18n: I18n;

  beforeEach(() => {
    localStorage.clear();
    i18n = TestBed.inject(I18n);
  });

  it('formats minor units in the language of the UI', () => {
    i18n.lang.set('it');
    expect(plain(i18n.money(-4530, 'EUR'))).toBe('-45,30 €');
    expect(plain(i18n.money(123456, 'EUR', { whole: true }))).toBe('1235 €');
    i18n.lang.set('en');
    expect(i18n.money(-4530, 'EUR')).toBe('-€45.30');
    expect(i18n.money(123456, 'EUR', { whole: true })).toBe('€1,235');
  });

  it('respects the currency exponent (yen has no cents)', () => {
    i18n.lang.set('en');
    expect(i18n.money(1200, 'JPY')).toBe('JP¥1,200');
  });

  it('formats calendar days without shifting them across time zones', () => {
    i18n.lang.set('it');
    expect(i18n.date('2026-10-31', 'medium')).toBe('31 ott 2026');
    i18n.lang.set('en');
    expect(i18n.month('2026-10', 'long')).toBe('October 2026');
  });

  it('reads model-written text and category labels in the current language', () => {
    const title = { it: 'Spesa al supermercato', en: 'Supermarket groceries' };
    i18n.lang.set('it');
    expect(i18n.text(title)).toBe('Spesa al supermercato');
    expect(i18n.category('food.groceries')).toBe('Spesa');
    i18n.lang.set('en');
    expect(i18n.text(title)).toBe('Supermarket groceries');
    expect(i18n.category('utilities')).toBe('Utilities');
  });

  it('switches the dictionary and the document language together', () => {
    i18n.lang.set('en');
    TestBed.tick();
    expect(i18n.t().nav.transactions).toBe(en.nav.transactions);
    expect(document.documentElement.lang).toBe('en');
    i18n.lang.set('it');
    TestBed.tick();
    expect(i18n.t().nav.transactions).toBe(itDict.nav.transactions);
    expect(localStorage.getItem('spendlens.lang')).toBe('it');
  });
});
