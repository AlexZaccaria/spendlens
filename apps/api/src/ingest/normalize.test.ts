import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Extraction } from './extraction.ts';
import { mergeExtractions, normalizeExtraction } from './normalize.ts';

const doc: Extraction['document'] = {
  kind: 'bank_statement',
  language: 'it',
  institution: 'Intesa Sanpaolo',
  account: 'Conto *1234',
  currency: 'EUR',
  summary: { it: 'Estratto conto di ottobre', en: 'October statement' },
};

const row = (over: Partial<Extraction['transactions'][number]>): Extraction['transactions'][number] => ({
  date: '2026-10-03',
  description: 'PAGAMENTO POS ESSELUNGA MILANO',
  title: { it: 'Spesa Esselunga', en: 'Esselunga groceries' },
  merchant: 'Esselunga',
  amount: -45.3,
  currency: 'EUR',
  categoryId: 'food.groceries',
  confidence: 0.92,
  note: null,
  reference: null,
  time: null,
  items: [],
  ...over,
});

const ctx = { importId: 'imp', source: 'import' as const, baseCurrency: 'EUR', ruleFor: () => null };

describe('normalizeExtraction', () => {
  it('converts amounts to minor units with the currency exponent', () => {
    const { items } = normalizeExtraction(
      { document: doc, transactions: [row({}), row({ amount: -1200, currency: 'jpy', description: 'Tokyo ramen' })], warnings: [] },
      ctx,
    );
    assert.equal(items[0]!.amountMinor, -4530);
    assert.equal(items[0]!.account, 'Conto *1234');
    assert.equal(items[1]!.amountMinor, -1200);
    assert.equal(items[1]!.currency, 'JPY');
  });

  it('skips unusable rows with a bilingual warning', () => {
    const { items, warnings } = normalizeExtraction(
      { document: doc, transactions: [row({ date: '2026-02-30' }), row({ amount: 0 })], warnings: [{ it: ' Attenzione ', en: '' }] },
      ctx,
    );
    assert.equal(items.length, 0);
    assert.equal(warnings.length, 3);
    assert.deepEqual(warnings[0], { it: 'Attenzione', en: 'Attenzione' });
    assert.ok(warnings[1]!.it.startsWith('Riga ignorata') && warnings[1]!.en.startsWith('Skipped'));
  });

  it('lets a user rule override the model and trusts it', () => {
    const { items } = normalizeExtraction(
      { document: doc, transactions: [row({ categoryId: 'shopping.online', confidence: 0.4 })], warnings: [] },
      { ...ctx, ruleFor: (m) => (m === 'Esselunga' ? 'food.groceries' : null) },
    );
    assert.equal(items[0]!.categoryId, 'food.groceries');
    assert.ok(items[0]!.confidence >= 0.95);
  });

  it('keeps a category that contradicts the sign but lowers the confidence', () => {
    const { items } = normalizeExtraction({ document: doc, transactions: [row({ amount: 45.3 })], warnings: [] }, ctx);
    assert.equal(items[0]!.categoryId, 'food.groceries');
    assert.equal(items[0]!.confidence, 0.5);
  });

  it('falls back to the document currency and fills a missing language', () => {
    const { items } = normalizeExtraction(
      { document: { ...doc, currency: 'CHF' }, transactions: [row({ currency: '€?', title: { it: '', en: 'Groceries' } })], warnings: [] },
      ctx,
    );
    assert.equal(items[0]!.currency, 'CHF');
    assert.deepEqual(items[0]!.title, { it: 'Groceries', en: 'Groceries' });
  });
});

describe('mergeExtractions', () => {
  it('concatenates rows, keeps the first metadata and de-duplicates warnings', () => {
    const w = { it: 'Data ambigua', en: 'Ambiguous date' };
    const merged = mergeExtractions([
      { document: { ...doc, account: null }, transactions: [row({})], warnings: [w] },
      { document: doc, transactions: [row({ date: '2026-10-04' })], warnings: [w] },
    ]);
    assert.equal(merged.transactions.length, 2);
    assert.equal(merged.document.account, 'Conto *1234');
    assert.equal(merged.warnings.length, 1);
  });
});

describe('receipt items', () => {
  const item = (amount: number, categoryId: string, it: string) => ({ description: it.toUpperCase(), title: { it, en: it }, quantity: null, amount, categoryId });

  it('keeps each line with its category and gives the lines the transaction sign', () => {
    const { items } = normalizeExtraction(
      { document: doc, transactions: [row({ amount: -20, items: [item(12.9, 'family.kids', 'Pannolini'), item(7.1, 'food.groceries', 'Pane')] })], warnings: [] },
      ctx,
    );
    assert.deepEqual(
      items[0]!.items.map((i) => [i.title.it, i.amountMinor, i.categoryId]),
      [['Pannolini', -1290, 'family.kids'], ['Pane', -710, 'food.groceries']],
    );
    assert.ok(items[0]!.confidence > 0.6);
  });

  it('sends a receipt whose lines are far from the total to review', () => {
    const { items } = normalizeExtraction(
      { document: doc, transactions: [row({ amount: -50, items: [item(-12.9, 'family.kids', 'Pannolini')] })], warnings: [] },
      ctx,
    );
    assert.ok(items[0]!.confidence <= 0.5);
  });
});

describe('document references', () => {
  it('reads the same reference and time however they are printed', async () => {
    const { normalizeReference, normalizeTime } = await import('./normalize.ts');
    for (const printed of ['DOC. N. 0412-0087', 'Documento n. 0412-0087', '0412 - 0087', 'doc n°0412-0087']) {
      assert.equal(normalizeReference(printed), '0412-0087', printed);
    }
    assert.equal(normalizeReference('TRANSFER-1234567'), 'TRANSFER-1234567');
    assert.equal(normalizeReference(''), null);
    assert.equal(normalizeReference('N.'), null);
    assert.equal(normalizeTime('18:07'), '18:07');
    assert.equal(normalizeTime('9.05'), '09:05');
    assert.equal(normalizeTime('18:07:33'), '18:07');
    assert.equal(normalizeTime('25:00'), null);
    assert.equal(normalizeTime('sera'), null);
  });
});
