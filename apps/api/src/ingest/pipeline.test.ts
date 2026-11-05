import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ImportEvent } from '@spendlens/contracts';

// No network in tests: exchange rates resolve to "unknown".
process.env['SPENDLENS_FX_API'] = 'http://127.0.0.1:9';

const { openDatabase } = await import('../db/database.ts');
const { insertTransactions, listTransactions } = await import('../repo/transactions.ts');
const { listImports } = await import('../repo/imports.ts');
const { upsertRule } = await import('../repo/rules.ts');
const { runImport } = await import('./pipeline.ts');
type Provider = import('../ai/provider.ts').LlmProvider;
type Request = import('../ai/provider.ts').StructuredRequest;
type Extraction = import('./extraction.ts').Extraction;

const extraction = (rows: Extraction['transactions']): Extraction => ({
  document: { kind: 'note', language: 'it', institution: null, account: null, currency: 'EUR', summary: { it: 'Note spese', en: 'Expense notes' } },
  transactions: rows,
  warnings: [],
});

const tx = (over: Partial<Extraction['transactions'][number]>): Extraction['transactions'][number] => ({
  date: '2026-11-04',
  description: 'pizza con Marco 23,50',
  title: { it: 'Pizza con Marco', en: 'Pizza with Marco' },
  merchant: null,
  amount: -23.5,
  currency: 'EUR',
  categoryId: 'food.restaurants',
  confidence: 0.9,
  note: null,
  reference: null,
  time: null,
  items: [],
  ...over,
});

function fakeProvider(answer: (req: Request) => Extraction): Provider & { calls: Request[] } {
  const calls: Request[] = [];
  return {
    id: 'anthropic',
    model: 'fake-model',
    capabilities: { nativePdf: true, vision: true },
    calls,
    async complete(req) {
      calls.push(req);
      return { json: answer(req), model: 'fake-model', inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0 };
    },
  };
}

const file = (text: string, filename = 'note.txt') => ({ filename, mime: 'text/plain', bytes: new TextEncoder().encode(text) });
const query = { kind: 'all', sort: 'date', dir: 'desc', limit: 100, offset: 0 } as Parameters<typeof listTransactions>[1];

describe('runImport', () => {
  it('streams the events, stores bilingual rows and records the import', async () => {
    const db = openDatabase(':memory:');
    const provider = fakeProvider(() =>
      extraction([tx({}), tx({ description: 'benzina 60', title: { it: 'Benzina', en: 'Fuel' }, amount: -60, categoryId: 'transport.fuel', confidence: 0.4 })]),
    );
    const events: ImportEvent[] = [];
    const summary = await runImport(db, [file('ieri pizza con Marco 23,50\nbenzina 60')], (e) => void events.push(e), { provider, today: '2026-11-05' });

    assert.deepEqual(
      events.map((e) => (e.type === 'stage' ? `${e.stage}:${e.chunk}/${e.chunks}` : e.type)),
      ['file-start', 'reading:0/1', 'extracting:0/1', 'extracting:1/1', 'saving:0/1', 'file-done', 'done'],
    );
    assert.deepEqual(events.at(-1), { type: 'done', imported: 2, duplicates: 0, failed: 0 });
    assert.equal(summary.records[0]!.txCount, 2);
    assert.deepEqual(summary.records[0]!.summary, { it: 'Note spese', en: 'Expense notes' });

    const rows = listTransactions(db, query).items;
    const fuel = rows.find((r) => r.categoryId === 'transport.fuel')!;
    assert.deepEqual(fuel.title, { it: 'Benzina', en: 'Fuel' });
    assert.equal(fuel.needsReview, true, 'low confidence goes to review');
    assert.equal(rows.find((r) => r.categoryId === 'food.restaurants')!.needsReview, false);

    // The volatile context is in the user turn, the system prompt is the cached constant.
    const prompt = provider.calls[0]!.parts.map((p) => (p.type === 'text' ? p.text : '')).join('');
    assert.ok(prompt.includes("Today's date: 2026-11-05"));
    assert.ok(prompt.includes('<document>\nieri pizza con Marco 23,50'));
    assert.ok(provider.calls[0]!.system.includes('BOTH Italian (it) and English (en)'));
  });

  it('refuses the same file twice unless forced, and reports duplicates rows', async () => {
    const db = openDatabase(':memory:');
    const provider = fakeProvider(() => extraction([tx({})]));
    await runImport(db, [file('pizza 23,50')], () => {}, { provider });
    const events: ImportEvent[] = [];
    await runImport(db, [file('pizza 23,50')], (e) => void events.push(e), { provider });
    const err = events.find((e) => e.type === 'file-error');
    assert.equal(err?.type === 'file-error' && err.error.code, 'already_imported');

    const forced: ImportEvent[] = [];
    await runImport(db, [file('pizza 23,50')], (e) => void forced.push(e), { provider, force: true });
    assert.deepEqual(forced.at(-1), { type: 'done', imported: 0, duplicates: 1, failed: 0 });
  });

  it('applies merchant rules and lists them in the prompt', async () => {
    const db = openDatabase(':memory:');
    upsertRule(db, 'amazon', 'shopping.electronics');
    const provider = fakeProvider(() => extraction([tx({ merchant: 'Amazon', categoryId: 'shopping.online', description: 'AMZN Mktp IT' })]));
    await runImport(db, [file('amazon 30')], () => {}, { provider });
    assert.equal(listTransactions(db, query).items[0]!.categoryId, 'shopping.electronics');
    assert.ok(provider.calls[0]!.parts.some((p) => p.type === 'text' && p.text.includes('- amazon → shopping.electronics')));
  });

  it('flags a receipt that repeats a payment already imported, with a bilingual note', async () => {
    const db = openDatabase(':memory:');
    insertTransactions(db, [
      {
        date: '2026-11-03',
        rawDescription: 'PAGAMENTO POS ESSELUNGA',
        title: { it: 'Spesa Esselunga', en: 'Esselunga groceries' },
        merchant: 'Esselunga',
        amountMinor: -4530,
        currency: 'EUR',
        baseAmountMinor: -4530,
        categoryId: 'food.groceries',
        confidence: 1,
        needsReview: false,
        account: null,
        note: null,
        importId: null,
        source: 'demo',
      },
    ]);
    const provider = fakeProvider(() =>
      extraction([tx({ date: '2026-11-04', merchant: 'Esselunga', description: 'ESSELUNGA SPA TOTALE 45,30', amount: -45.3, categoryId: 'food.groceries' })]),
    );
    await runImport(db, [file('scontrino esselunga 45,30')], () => {}, { provider });
    const receipt = listTransactions(db, query).items.find((r) => r.source === 'import')!;
    assert.equal(receipt.needsReview, true);
    assert.ok(receipt.note?.it.startsWith('Possibile duplicato di «Spesa Esselunga» del 2026-11-03'));
    assert.ok(receipt.note?.en.startsWith('Possible duplicate of “Esselunga groceries” on 2026-11-03'));
  });

  it('keeps going after a failing file and records the failure', async () => {
    const db = openDatabase(':memory:');
    let n = 0;
    const provider = fakeProvider(() => {
      if (n++ === 0) return { nonsense: true } as unknown as Extraction;
      return extraction([tx({})]);
    });
    const events: ImportEvent[] = [];
    await runImport(db, [file('one', 'a.txt'), file('two', 'b.txt')], (e) => void events.push(e), { provider });
    const err = events.find((e) => e.type === 'file-error');
    assert.equal(err?.type === 'file-error' && err.error.code, 'invalid_output');
    assert.deepEqual(events.at(-1), { type: 'done', imported: 1, duplicates: 0, failed: 1 });
    assert.deepEqual(listImports(db).map((r) => r.status).sort(), ['done', 'error']);
  });

  it('leaves foreign amounts unconverted and warns when no rate is available', async () => {
    const db = openDatabase(':memory:');
    const provider = fakeProvider(() => extraction([tx({ amount: -12, currency: 'USD' })]));
    const { records } = await runImport(db, [file('lunch 12 usd')], () => {}, { provider });
    const row = listTransactions(db, query).items[0]!;
    assert.equal(row.baseAmountMinor, null);
    assert.equal(row.needsReview, true);
    assert.ok(records[0]!.warnings.some((w) => w.en.includes('not yet converted to EUR')));
  });

  it('fails every file with ai_not_configured when no provider is set up', async () => {
    const db = openDatabase(':memory:');
    const saved = process.env['ANTHROPIC_API_KEY'];
    delete process.env['ANTHROPIC_API_KEY'];
    try {
      const events: ImportEvent[] = [];
      await runImport(db, [file('x')], (e) => void events.push(e));
      const err = events.find((e) => e.type === 'file-error');
      assert.equal(err?.type === 'file-error' && err.error.code, 'ai_not_configured');
    } finally {
      if (saved !== undefined) process.env['ANTHROPIC_API_KEY'] = saved;
    }
  });
});

describe('receipt items through the pipeline', () => {
  it('stores the extracted lines and reuses the product names already known', async () => {
    const db = openDatabase(':memory:');
    const item = (it: string, en: string, amount: number, categoryId: string) => ({ description: it.toUpperCase(), title: { it, en }, quantity: null, amount, categoryId });
    const receipt = () =>
      extraction([
        tx({ description: 'ESSELUNGA', merchant: 'Esselunga', amount: -14.41, categoryId: 'family.kids', items: [item('Pannolini', 'Nappies', -11.92, 'family.kids'), item('Latte', 'Milk', -2.49, 'food.groceries')] }),
      ]);
    const first = fakeProvider(receipt);
    await runImport(db, [file('scontrino 1', 'a.txt')], () => undefined, { provider: first, today: '2026-11-05' });
    const [stored] = listTransactions(db, query).items;
    assert.deepEqual(stored!.items.map((i) => [i.title.en, i.categoryId]), [['Nappies', 'family.kids'], ['Milk', 'food.groceries']]);

    const second = fakeProvider(receipt);
    await runImport(db, [file('scontrino 2', 'b.txt')], () => undefined, { provider: second, today: '2026-11-05' });
    const prompt = second.calls[0]!.parts.map((p) => (p.type === 'text' ? p.text : '')).join('\n');
    assert.match(prompt, /Pannolini \/ Nappies/);
  });
});

describe('receipt identity', () => {
  const receipt = (over: Parameters<typeof tx>[0]) =>
    tx({ date: '2026-10-24', merchant: 'Esselunga', amount: -38.74, categoryId: 'food.groceries', reference: 'DOC. N. 0412-0087', time: '18:07', ...over });

  it('stores the same receipt once, whatever file it comes in and however the model words it', async () => {
    const db = openDatabase(':memory:');
    const photo = fakeProvider(() => extraction([receipt({ description: 'ESSELUNGA VIALE PAPINIANO TOTALE 38,74' })]));
    const scan = fakeProvider(() => extraction([receipt({ description: 'Esselunga spa - totale complessivo 38.74', merchant: 'Esselunga S.p.A.', reference: '0412 - 0087' })]));

    await runImport(db, [{ ...file('photo bytes'), filename: 'scontrino.jpg' }], () => undefined, { provider: photo });
    const events: ImportEvent[] = [];
    await runImport(db, [{ ...file('scan bytes'), filename: 'scontrino.pdf' }], (e) => void events.push(e), { provider: scan });

    assert.deepEqual(events.at(-1), { type: 'done', imported: 0, duplicates: 1, failed: 0 });
    const rows = listTransactions(db, query).items;
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.reference, '0412-0087');
    assert.equal(rows[0]!.time, '18:07');
  });

  it('keeps a forced re-import of the same receipt from counting it twice', async () => {
    const db = openDatabase(':memory:');
    const provider = fakeProvider(() => extraction([receipt({})]));
    await runImport(db, [file('same bytes')], () => undefined, { provider });
    await runImport(db, [file('same bytes')], () => undefined, { provider, force: true });
    assert.equal(listTransactions(db, query).items.length, 1);
  });

  it('tells two receipts apart when their numbers or times differ, even at the same shop, day and price', async () => {
    const db = openDatabase(':memory:');
    const coffee = (time: string, reference: string | null) =>
      fakeProvider(() => extraction([tx({ date: '2026-10-24', merchant: 'Bar Centrale', description: 'CAFFE 1,20', amount: -1.2, categoryId: 'food.restaurants', reference, time })]));
    await runImport(db, [file('morning')], () => undefined, { provider: coffee('08:12', null) });
    await runImport(db, [file('afternoon')], () => undefined, { provider: coffee('15:40', null) });
    await runImport(db, [file('evening')], () => undefined, { provider: coffee('15:40', 'N. 77') });
    // Same shop, day and price: two coffees by their times; the third repeats the afternoon one.
    assert.equal(listTransactions(db, query).items.length, 2);
  });
});
