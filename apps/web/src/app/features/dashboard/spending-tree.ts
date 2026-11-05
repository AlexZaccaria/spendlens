import { getCategory, rootOf, type Charged, type Lang, type Transaction, type TransactionItem } from '@spendlens/contracts';

export type SpendLevel = 'all' | 'category' | 'subcategory' | 'group' | 'line';

/**
 * One node of the month's spending: all → category → subcategory → group → line. A group is a
 * product when the spending comes from itemised receipts — every receipt's nappies add up into one
 * "Nappies" node, whatever the shop — and a merchant otherwise. A line is one purchase: a
 * transaction, or one item of a receipt. Amounts are net spending in base-currency minor units
 * (positive = money spent); refunds and shared discounts lower a group's total (`refundedMinor`).
 */
export interface SpendNode {
  readonly id: string;
  readonly level: SpendLevel;
  readonly label: string;
  /** Category whose colour and icon the node wears (the leaf for groups and lines). */
  readonly categoryId: string;
  /** For a group: a product of itemised receipts, or a merchant. */
  readonly groupKind: 'product' | 'merchant' | null;
  readonly totalMinor: number;
  /** The same total as charged, when every line under the node was in one currency (the base too). */
  readonly charged: Charged | null;
  readonly refundedMinor: number;
  /** Distinct transactions under the node (a receipt split across categories counts once in each). */
  readonly txCount: number;
  readonly children: readonly SpendNode[];
  /** For a line: the transaction it belongs to, and the receipt item when it is one. */
  readonly transaction: Transaction | null;
  readonly item: TransactionItem | null;
}

interface Draft {
  id: string;
  level: SpendLevel;
  label: string;
  categoryId: string;
  groupKind: SpendNode['groupKind'];
  totalMinor: number;
  chargedMinor: number;
  currencies: Set<string>;
  refundedMinor: number;
  txIds: Set<string>;
  children: Map<string, Draft>;
  transaction: Transaction | null;
  item: TransactionItem | null;
}

const draft = (id: string, level: SpendLevel, label: string, categoryId: string, groupKind: SpendNode['groupKind'] = null): Draft => ({
  id,
  level,
  label,
  categoryId,
  groupKind,
  totalMinor: 0,
  chargedMinor: 0,
  currencies: new Set(),
  refundedMinor: 0,
  txIds: new Set(),
  children: new Map(),
  transaction: null,
  item: null,
});

const child = (parent: Draft, key: string, make: () => Draft): Draft => {
  let node = parent.children.get(key);
  if (!node) {
    node = make();
    parent.children.set(key, node);
  }
  return node;
};

function finish(node: Draft): SpendNode {
  const children = [...node.children.values()]
    .map(finish)
    .filter((c) => c.totalMinor > 0)
    .sort((a, b) => b.totalMinor - a.totalMinor);
  const { txIds, chargedMinor, currencies, ...rest } = node;
  const charged = currencies.size === 1 ? { amountMinor: chargedMinor, currency: [...currencies][0]! } : null;
  return { ...rest, charged, txCount: txIds.size, children };
}

interface Line {
  readonly id: string;
  readonly categoryId: string;
  readonly title: string;
  readonly spent: number;
  /** `spent` in the transaction's own currency. */
  readonly spentCharged: number;
  readonly item: TransactionItem | null;
}

/** What one transaction contributes: its items when itemised, itself otherwise. */
function linesOf(tx: Transaction, lang: Lang): Line[] {
  const title = tx.title[lang] || tx.rawDescription;
  if (tx.items.length === 0) {
    return tx.baseAmountMinor === null ? [] : [{ id: `tx:${tx.id}`, categoryId: tx.categoryId, title, spent: -tx.baseAmountMinor, spentCharged: -tx.amountMinor, item: null }];
  }
  return tx.items
    .filter((i) => i.baseAmountMinor !== null)
    .map((i) => ({ id: `item:${i.id}`, categoryId: i.categoryId, title: i.title[lang] || i.description, spent: -i.baseAmountMinor!, spentCharged: -i.amountMinor, item: i }));
}

/** Groups the month's expense transactions into the drill-down tree. */
export function buildSpendingTree(transactions: readonly Transaction[], lang: Lang, rootLabel: string): SpendNode {
  const root = draft('all', 'all', rootLabel, '');
  for (const tx of transactions) {
    if (getCategory(tx.categoryId)?.kind !== 'expense') continue;
    const merchant = tx.merchant?.trim() || null;
    for (const line of linesOf(tx, lang)) {
      const cat = rootOf(line.categoryId);
      const leaf = getCategory(line.categoryId)!;
      // Receipt items group by product across shops and receipts; other spending by merchant. A
      // shared-discount line stays with the merchant: it is not a product.
      const product = line.item !== null && !line.item.adjustment;
      const groupKey = product ? `p:${line.title.toLowerCase()}` : merchant ? `m:${merchant.toLowerCase()}` : `t:${line.title.toLowerCase()}`;
      const groupLabel = product ? line.title : (merchant ?? line.title);
      // Under a product the purchases are told apart by shop; under a merchant by what was bought.
      const lineLabel = product ? (merchant ?? line.title) : line.title;

      const catNode = child(root, cat.id, () => draft(cat.id, 'category', cat.label[lang], cat.id));
      const leafNode = child(catNode, leaf.id, () => draft(leaf.id, 'subcategory', leaf.label[lang], leaf.id));
      const groupNode = child(leafNode, groupKey, () => draft(`${leaf.id}|${groupKey}`, 'group', groupLabel, leaf.id, product ? 'product' : 'merchant'));
      const lineNode = child(groupNode, line.id, () => ({ ...draft(line.id, 'line', lineLabel, leaf.id), transaction: tx, item: line.item }));

      for (const node of [root, catNode, leafNode, groupNode, lineNode]) {
        node.totalMinor += line.spent;
        node.chargedMinor += line.spentCharged;
        node.currencies.add(tx.currency);
        node.txIds.add(tx.id);
        if (line.spent < 0) node.refundedMinor += -line.spent;
      }
    }
  }
  return finish(root);
}

/** The node with this id and the chain of nodes leading to it (root first), or null. */
export function findPath(root: SpendNode, id: string): SpendNode[] | null {
  if (root.id === id) return [root];
  for (const c of root.children) {
    const path = findPath(c, id);
    if (path) return [root, ...path];
  }
  return null;
}

/** The single line under a node, when there is exactly one (opening it beats drilling). */
export function onlyLine(node: SpendNode): SpendNode | null {
  if (node.level === 'line') return node;
  return node.children.length === 1 ? onlyLine(node.children[0]!) : null;
}

/** Every line under a node, largest first. */
export function linesUnder(node: SpendNode): SpendNode[] {
  if (node.level === 'line') return [node];
  return node.children.flatMap(linesUnder).sort((a, b) => b.totalMinor - a.totalMinor);
}
