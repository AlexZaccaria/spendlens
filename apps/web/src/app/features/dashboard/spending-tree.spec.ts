import type { Transaction, TransactionItem } from '@spendlens/contracts';
import { buildSpendingTree, findPath, linesUnder, onlyLine } from './spending-tree';

let seq = 0;
const tx = (categoryId: string, euros: number, merchant: string | null, title = 'Spesa', items: TransactionItem[] = []): Transaction => ({
  id: `t${++seq}`,
  date: '2026-10-05',
  rawDescription: title.toUpperCase(),
  title: { it: title, en: `${title} (en)` },
  merchant,
  amountMinor: Math.round(euros * 100),
  currency: 'EUR',
  baseAmountMinor: Math.round(euros * 100),
  categoryId,
  confidence: 1,
  needsReview: false,
  recurring: false,
  account: null,
  note: null,
  reference: null,
  time: null,
  importId: null,
  source: 'demo',
  items,
  createdAt: '',
  updatedAt: '',
});

const item = (categoryId: string, euros: number, it: string, en = it, adjustment = false): TransactionItem => ({
  id: `i${++seq}`,
  position: seq,
  description: it.toUpperCase(),
  title: { it, en },
  quantity: null,
  amountMinor: Math.round(euros * 100),
  baseAmountMinor: Math.round(euros * 100),
  categoryId,
  adjustment,
});

const node = (tree: ReturnType<typeof buildSpendingTree>, id: string) => findPath(tree, id)!.at(-1)!;

describe('buildSpendingTree', () => {
  const rows = [
    tx('food.groceries', -40, 'Esselunga'),
    tx('food.groceries', -20, 'esselunga '),
    tx('food.groceries', -15, 'Lidl'),
    tx('family.kids', -60, 'Prenatal', 'Pannolini'),
    tx('food.restaurants', -30, null, 'Pizza con Marco'),
    tx('shopping.online', -50, 'Amazon'),
    tx('shopping.online', 20, 'Amazon', 'Reso'),
    tx('income.salary', 3000, 'Acme'),
    tx('transfer.savings', -500, null, 'Salvadanaio'),
  ];
  const tree = buildSpendingTree(rows, 'it', 'Tutte le spese');

  it('nests category → subcategory → merchant → purchase, largest first', () => {
    expect(tree.totalMinor).toBe(19_500);
    expect(tree.children.map((c) => c.id)).toEqual(['food', 'family', 'shopping']);
    const groceries = node(tree, 'food.groceries');
    expect(groceries.children.map((m) => [m.label, m.totalMinor, m.txCount])).toEqual([
      ['Esselunga', 6_000, 2],
      ['Lidl', 1_500, 1],
    ]);
    expect(groceries.children[0]!.children).toHaveLength(2);
  });

  it('goes down to the single purchase', () => {
    expect(onlyLine(node(tree, 'family.kids'))?.transaction?.title.it).toBe('Pannolini');
    expect(linesUnder(node(tree, 'food')).map((l) => l.totalMinor)).toEqual([4_000, 3_000, 2_000, 1_500]);
  });

  it('nets refunds into their group and leaves out income and transfers', () => {
    const online = node(tree, 'shopping.online');
    expect(online.totalMinor).toBe(3_000);
    expect(online.refundedMinor).toBe(2_000);
    expect(online.children[0]!.children.map((t) => t.totalMinor)).toEqual([5_000]);
    expect(findPath(tree, 'income')).toBeNull();
  });

  it('labels merchant-less spending with its title, in the current language', () => {
    expect(node(tree, 'food.restaurants').children[0]!.label).toBe('Pizza con Marco');
    const en = buildSpendingTree(rows, 'en', 'All spending');
    expect(node(en, 'food.restaurants').children[0]!.label).toBe('Pizza con Marco (en)');
  });
});

describe('itemised receipts', () => {
  const supermarket = tx('food.groceries', -40, 'Esselunga', 'Spesa da Esselunga', [
    item('family.kids', -11.92, 'Pannolini', 'Nappies'),
    item('food.groceries', -2.98, 'Latte', 'Milk'),
    item('shopping.home', -11.9, 'Detersivo lavatrice', 'Laundry detergent'),
    item('food.groceries', -14.7, 'Spesa varia'),
    item('food.groceries', 1.5, 'Sconti e arrotondamenti', 'Discounts and rounding', true),
  ]);
  const babyShop = tx('family.kids', -25, 'Prenatal', 'Prenatal', [item('family.kids', -25, 'Pannolini', 'Nappies')]);
  const tree = buildSpendingTree([supermarket, babyShop], 'it', 'Tutte le spese');

  it('files each receipt line under its own category', () => {
    expect(node(tree, 'family.kids').totalMinor).toBe(3_692);
    expect(node(tree, 'shopping.home').totalMinor).toBe(1_190);
    expect(node(tree, 'food.groceries').totalMinor).toBe(1_618);
    expect(tree.totalMinor).toBe(6_500);
  });

  it('adds the same product up across receipts and shops, one node per product', () => {
    const kids = node(tree, 'family.kids');
    expect(kids.children.map((g) => [g.label, g.groupKind, g.totalMinor, g.txCount])).toEqual([['Pannolini', 'product', 3_692, 2]]);
    // Under the product, each purchase is named by its shop.
    expect(kids.children[0]!.children.map((l) => l.label)).toEqual(['Prenatal', 'Esselunga']);
    expect(node(tree, 'food.groceries').children.map((g) => g.label)).toEqual(['Spesa varia', 'Latte']);
    expect(node(tree, 'food').txCount).toBe(1);
  });

  it('keeps non-itemised spending grouped by merchant', () => {
    const plain = buildSpendingTree([tx('food.groceries', -30, 'Lidl'), tx('food.groceries', -20, 'Lidl')], 'it', 'Tutte le spese');
    expect(node(plain, 'food.groceries').children.map((g) => [g.label, g.groupKind, g.txCount])).toEqual([['Lidl', 'merchant', 2]]);
  });
});
