import {
  FALLBACK_EXPENSE_CATEGORY,
  getCategory,
  rootOf,
  type LocalizedText,
  type Transaction,
  type TransactionItem,
  type TransactionPage,
  type TransactionPatch,
  type TransactionSource,
} from '@spendlens/contracts';
import type { transactionQuerySchema } from '@spendlens/contracts/schemas';
import type { z } from 'zod';
import { transaction, type Db } from '../db/database.ts';
import { toItem, toTransaction } from '../db/rows.ts';
import { merchantKey, newId, normalizeText, nowIso, sha256 } from '../lib/text.ts';
import { chargedColumns, chargedOf, type ChargedColumns } from './charged.ts';
import { upsertRule } from './rules.ts';
import { baseCurrency } from './settings.ts';

export type ParsedTransactionQuery = z.output<typeof transactionQuerySchema>;

export interface NewTransaction {
  readonly date: string;
  readonly rawDescription: string;
  readonly title: LocalizedText;
  readonly merchant: string | null;
  readonly amountMinor: number;
  readonly currency: string;
  readonly baseAmountMinor: number | null;
  readonly categoryId: string;
  readonly confidence: number;
  readonly needsReview: boolean;
  readonly account: string | null;
  readonly note: LocalizedText | null;
  /** Receipt or invoice number, statement transaction ID: with the date and amount, the payment's identity. */
  readonly reference?: string | null;
  /** HH:MM printed on a receipt. */
  readonly time?: string | null;
  readonly importId: string | null;
  readonly source: TransactionSource;
  /** Receipt lines, signed like the transaction; balanced to its amount on insert. */
  readonly items?: readonly NewItem[];
}

export interface NewItem {
  readonly description: string;
  readonly title: LocalizedText;
  readonly quantity: number | null;
  readonly amountMinor: number;
  readonly categoryId: string;
}

export interface InsertResult {
  readonly inserted: Transaction[];
  readonly duplicates: number;
}

function categoryColumns(categoryId: string): { category_id: string; root_category_id: string; kind: string } {
  const cat = getCategory(categoryId) ?? getCategory(FALLBACK_EXPENSE_CATEGORY)!;
  return { category_id: cat.id, root_category_id: rootOf(cat.id).id, kind: cat.kind };
}

/**
 * Inserts a batch, skipping rows already stored. The fingerprint is the date, amount, currency,
 * normalised original line and account, plus the occurrence number of that combination within
 * the batch — so re-importing an overlapping statement adds nothing, while two identical coffees
 * on the same day in one statement both survive. A row whose printed reference (receipt number,
 * transaction ID) is already stored for the same date and amount is skipped by a unique index,
 * whatever its wording.
 */
export function insertTransactions(db: Db, items: readonly NewTransaction[]): InsertResult {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO transactions (
      id, date, raw_description, title, merchant, merchant_key, amount_minor, currency, base_amount_minor,
      category_id, root_category_id, kind, confidence, needs_review, recurring, account, note, reference, ref_time,
      import_id, source, fingerprint, created_at, updated_at
    ) VALUES (
      :id, :date, :raw_description, :title, :merchant, :merchant_key, :amount_minor, :currency, :base_amount_minor,
      :category_id, :root_category_id, :kind, :confidence, :needs_review, 0, :account, :note, :reference, :ref_time,
      :import_id, :source, :fingerprint, :now, :now
    )`);
  const seen = new Map<string, number>();
  const insertedIds: string[] = [];
  transaction(db, () => {
    for (const item of items) {
      // Two receipts of one bar print the same line; their number or time tells them apart. Added
      // only when present, so the fingerprints of rows without a reference stay what they were.
      const identity = item.reference || item.time ? `|${item.reference ?? ''}|${item.time ?? ''}` : '';
      const base = [item.date, item.amountMinor, item.currency, normalizeText(item.rawDescription), item.account ?? ''].join('|') + identity;
      const occurrence = (seen.get(base) ?? 0) + 1;
      seen.set(base, occurrence);
      const id = newId();
      const result = insert.run({
        id,
        date: item.date,
        raw_description: item.rawDescription,
        title: JSON.stringify(item.title),
        merchant: item.merchant,
        merchant_key: merchantKey(item.merchant ?? item.rawDescription),
        amount_minor: item.amountMinor,
        currency: item.currency,
        base_amount_minor: item.baseAmountMinor,
        ...categoryColumns(item.categoryId),
        confidence: Math.min(1, Math.max(0, item.confidence)),
        needs_review: item.needsReview ? 1 : 0,
        account: item.account,
        note: item.note === null ? null : JSON.stringify(item.note),
        reference: item.reference ?? null,
        ref_time: item.time ?? null,
        import_id: item.importId,
        source: item.source,
        fingerprint: sha256(`${base}|#${occurrence}`),
        now: nowIso(),
      });
      if (Number(result.changes) === 1) {
        insertedIds.push(id);
        if (item.items?.length) writeItems(db, id, item.items, item.categoryId, item.amountMinor, item.baseAmountMinor);
      }
    }
  });
  return { inserted: getTransactions(db, insertedIds), duplicates: items.length - insertedIds.length };
}

// --- Receipt items ------------------------------------------------------------------------------

const ADJUSTMENT_TITLE: LocalizedText = { it: 'Sconti e arrotondamenti', en: 'Discounts and rounding' };

/** Splits a base-currency total across lines in proportion to their amounts, exactly (no lost cents). */
export function distribute(baseTotal: number | null, amounts: readonly number[]): (number | null)[] {
  const total = amounts.reduce((a, b) => a + b, 0);
  if (baseTotal === null || total === 0) return amounts.map(() => null);
  const shares = amounts.map((a) => Math.round((a * baseTotal) / total));
  const drift = baseTotal - shares.reduce((a, b) => a + b, 0);
  if (drift !== 0) {
    const largest = amounts.reduce((best, a, i) => (Math.abs(a) > Math.abs(amounts[best]!) ? i : best), 0);
    shares[largest]! += drift;
  }
  return shares;
}

/** An item category must be a spending leaf; anything else falls back to the transaction's own. */
function itemCategory(categoryId: string, fallback: string): string {
  const cat = getCategory(categoryId);
  return cat && cat.parentId !== null && cat.kind === 'expense' ? cat.id : fallback;
}

/**
 * Stores the lines of a transaction so they add up to its amount: what the lines don't explain
 * (a receipt-level discount, rounding) becomes an adjustment line in the transaction's category.
 */
function writeItems(db: Db, txId: string, items: readonly NewItem[], txCategory: string, amountMinor: number, baseAmountMinor: number | null): void {
  const fallback = getCategory(txCategory)?.kind === 'expense' ? txCategory : FALLBACK_EXPENSE_CATEGORY;
  const lines = items.map((i) => ({ ...i, categoryId: itemCategory(i.categoryId, fallback), adjustment: false }));
  const residual = amountMinor - lines.reduce((s, i) => s + i.amountMinor, 0);
  if (residual !== 0) {
    // A receipt-level discount belongs to the whole basket: each category gets its pro-rata share,
    // so the printed line prices stay as they are and no category absorbs the whole discount.
    const subtotals = new Map<string, number>();
    for (const l of lines) subtotals.set(l.categoryId, (subtotals.get(l.categoryId) ?? 0) + l.amountMinor);
    const categories = [...subtotals.keys()];
    const shares = categories.length ? distribute(residual, [...subtotals.values()]) : [];
    if (shares.some((s) => s === null)) shares.splice(0, shares.length, ...categories.map((_, i) => (i === 0 ? residual : 0)));
    categories.forEach((categoryId, i) => {
      const share = shares[i] ?? 0;
      if (share !== 0) lines.push({ description: '', title: ADJUSTMENT_TITLE, quantity: null, amountMinor: share, categoryId, adjustment: true });
    });
    if (categories.length === 0) lines.push({ description: '', title: ADJUSTMENT_TITLE, quantity: null, amountMinor: residual, categoryId: fallback, adjustment: true });
  }
  const bases = distribute(baseAmountMinor, lines.map((l) => l.amountMinor));
  const insert = db.prepare(
    `INSERT INTO transaction_items (id, transaction_id, position, description, title, quantity, amount_minor, base_amount_minor,
       category_id, root_category_id, adjustment)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  lines.forEach((l, i) =>
    insert.run(newId(), txId, i + 1, l.description, JSON.stringify(l.title), l.quantity, l.amountMinor, bases[i]!, l.categoryId, rootOf(l.categoryId).id, l.adjustment ? 1 : 0),
  );
}

/** Re-balances the lines after the transaction's amount changed (an edit or a late exchange rate). */
export function rebalanceItems(db: Db, txId: string): void {
  const tx = getTransaction(db, txId);
  if (!tx || tx.items.length === 0) return;
  const kept = tx.items.filter((i) => !i.adjustment);
  db.prepare('DELETE FROM transaction_items WHERE transaction_id = ?').run(txId);
  writeItems(db, txId, kept, tx.categoryId, tx.amountMinor, tx.baseAmountMinor);
}

export function updateItem(db: Db, txId: string, itemId: string, categoryId: string): Transaction {
  const cat = getCategory(categoryId);
  if (!cat || cat.kind !== 'expense' || cat.parentId === null) throw new NotFoundError(`Not a spending category: ${categoryId}`);
  const result = db
    .prepare('UPDATE transaction_items SET category_id = ?, root_category_id = ? WHERE id = ? AND transaction_id = ?')
    .run(cat.id, rootOf(cat.id).id, itemId, txId);
  if (Number(result.changes) !== 1) throw new NotFoundError(`Item ${itemId} not found`);
  db.prepare('UPDATE transactions SET updated_at = ? WHERE id = ?').run(nowIso(), txId);
  return getTransaction(db, txId)!;
}

function itemsByTransaction(db: Db, ids: readonly string[]): Map<string, TransactionItem[]> {
  const map = new Map<string, TransactionItem[]>();
  if (ids.length === 0) return map;
  const rows = db
    .prepare('SELECT * FROM transaction_items WHERE transaction_id IN (SELECT value FROM json_each(?)) ORDER BY transaction_id, position')
    .all(JSON.stringify(ids));
  for (const row of rows) {
    const txId = String(row['transaction_id']);
    map.set(txId, [...(map.get(txId) ?? []), toItem(row)]);
  }
  return map;
}

/** Row mapping with the items attached — the shape every endpoint returns. */
export function hydrate(db: Db, rows: readonly Record<string, unknown>[]): Transaction[] {
  const items = itemsByTransaction(db, rows.map((r) => String(r['id'])));
  return rows.map((r) => toTransaction(r, items.get(String(r['id'])) ?? []));
}

export function getTransaction(db: Db, id: string): Transaction | null {
  const row = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id);
  return row ? hydrate(db, [row])[0]! : null;
}

export function getTransactions(db: Db, ids: readonly string[]): Transaction[] {
  if (ids.length === 0) return [];
  const rows = db.prepare('SELECT * FROM transactions WHERE id IN (SELECT value FROM json_each(?)) ORDER BY date DESC').all(JSON.stringify(ids));
  return hydrate(db, rows);
}

/** Turns free text into an FTS5 query: every word must match, each as a prefix. */
export function ftsQuery(text: string): string | null {
  const words = text
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean);
  return words.length === 0 ? null : words.map((w) => `"${w}"*`).join(' ');
}

/** An itemised transaction belongs to a category through its items; any other through its own. */
const IN_CATEGORY = `(
  (NOT EXISTS (SELECT 1 FROM transaction_items i WHERE i.transaction_id = t.id) AND (t.category_id = :category OR t.root_category_id = :category))
  OR EXISTS (SELECT 1 FROM transaction_items i WHERE i.transaction_id = t.id AND (i.category_id = :category OR i.root_category_id = :category))
)`;

function whereClause(q: ParsedTransactionQuery, withCategory = true): { sql: string; params: Record<string, string | number> } {
  const parts: string[] = [];
  const params: Record<string, string | number> = {};
  if (q.from) (parts.push('t.date >= :from'), (params['from'] = q.from));
  if (q.to) (parts.push('t.date <= :to'), (params['to'] = q.to));
  if (q.category && withCategory) (parts.push(IN_CATEGORY), (params['category'] = q.category));
  if (q.review !== undefined) (parts.push('t.needs_review = :review'), (params['review'] = q.review ? 1 : 0));
  if (q.kind !== 'all') (parts.push('t.kind = :kind'), (params['kind'] = q.kind));
  if (q.importId) (parts.push('t.import_id = :importId'), (params['importId'] = q.importId));
  const match = q.q ? ftsQuery(q.q) : null;
  if (match) (parts.push('t.rowid IN (SELECT rowid FROM transactions_fts WHERE transactions_fts MATCH :match)'), (params['match'] = match));
  return { sql: parts.length ? `WHERE ${parts.join(' AND ')}` : '', params };
}

export function listTransactions(db: Db, q: ParsedTransactionQuery): TransactionPage {
  const { sql, params } = whereClause(q);
  const dir = q.dir === 'asc' ? 'ASC' : 'DESC';
  const order =
    q.sort === 'amount'
      ? `abs(coalesce(t.base_amount_minor, t.amount_minor)) ${dir}, t.date DESC`
      : `t.date ${dir}, t.created_at ${dir}, t.rowid ${dir}`;
  const rows = db
    .prepare(`SELECT t.* FROM transactions t ${sql} ORDER BY ${order} LIMIT :limit OFFSET :offset`)
    .all({ ...params, limit: q.limit, offset: q.offset });
  const total = Number((db.prepare(`SELECT count(*) AS n FROM transactions t ${sql}`).get(params) as { n: number }).n);
  const items = hydrate(db, rows);
  if (!q.category) {
    const sum = db
      .prepare(`SELECT coalesce(sum(t.base_amount_minor), 0) AS s, ${chargedColumns('t.amount_minor', 't.currency', 't.base_amount_minor')} FROM transactions t ${sql}`)
      .get(params) as { s: number } & ChargedColumns;
    return { items, total, sumBaseMinor: Number(sum.s), matchedBaseMinor: {}, sumCharged: chargedOf(sum, baseCurrency(db)) };
  }

  // With a category, only the matching part of an itemised receipt counts.
  const other = whereClause(q, false);
  const lineFilter = '(l.category_id = :category OR l.root_category_id = :category)';
  const sum = db
    .prepare(
      `SELECT coalesce(sum(l.base_amount_minor), 0) AS s, ${chargedColumns('l.amount_minor', 't.currency', 'l.base_amount_minor')}
       FROM spend_lines l JOIN transactions t ON t.id = l.transaction_id
       ${other.sql ? `${other.sql} AND` : 'WHERE'} ${lineFilter}`,
    )
    .get({ ...other.params, category: q.category }) as { s: number } & ChargedColumns;
  const matchedBaseMinor: Record<string, number> = {};
  for (const tx of items) {
    if (tx.items.length === 0) continue;
    const part = tx.items
      .filter((i) => i.categoryId === q.category || rootOf(i.categoryId).id === q.category)
      .reduce((s, i) => s + (i.baseAmountMinor ?? 0), 0);
    if (part !== tx.baseAmountMinor) matchedBaseMinor[tx.id] = part;
  }
  return { items, total, sumBaseMinor: Number(sum.s), matchedBaseMinor, sumCharged: chargedOf(sum, baseCurrency(db)) };
}

export class NotFoundError extends Error {}

export function updateTransaction(db: Db, id: string, patch: TransactionPatch): Transaction {
  return transaction(db, () => {
    const current = getTransaction(db, id);
    if (!current) throw new NotFoundError(`Transaction ${id} not found`);
    const sets: string[] = ['updated_at = :now'];
    const params: Record<string, string | number | null> = { id, now: nowIso() };

    if (patch.categoryId !== undefined) {
      const cols = categoryColumns(patch.categoryId);
      sets.push('category_id = :category_id', 'root_category_id = :root_category_id', 'kind = :kind', 'confidence = 1');
      Object.assign(params, cols);
      // A human picked the category: nothing left to review unless they say otherwise.
      if (patch.needsReview === undefined) sets.push('needs_review = 0');
    }
    if (patch.merchant !== undefined) {
      sets.push('merchant = :merchant', 'merchant_key = :merchant_key');
      params['merchant'] = patch.merchant;
      params['merchant_key'] = merchantKey(patch.merchant ?? current.rawDescription);
    }
    if (patch.title !== undefined) {
      sets.push('title = :title');
      params['title'] = JSON.stringify({ ...current.title, [patch.title.lang]: patch.title.text });
    }
    if (patch.note !== undefined) {
      sets.push('note = :note');
      params['note'] = patch.note === null ? null : JSON.stringify({ it: patch.note, en: patch.note });
    }
    if (patch.date !== undefined) (sets.push('date = :date'), (params['date'] = patch.date));
    if (patch.amountMinor !== undefined) {
      // Keep the converted amount proportional; a same-currency row stays identical.
      const ratio = current.baseAmountMinor !== null && current.amountMinor !== 0 ? current.baseAmountMinor / current.amountMinor : null;
      sets.push('amount_minor = :amount_minor', 'base_amount_minor = :base_amount_minor');
      params['amount_minor'] = patch.amountMinor;
      params['base_amount_minor'] = ratio === null ? null : Math.round(patch.amountMinor * ratio);
    }
    if (patch.needsReview !== undefined) (sets.push('needs_review = :needs_review'), (params['needs_review'] = patch.needsReview ? 1 : 0));

    db.prepare(`UPDATE transactions SET ${sets.join(', ')} WHERE id = :id`).run(params);
    if (patch.amountMinor !== undefined) rebalanceItems(db, id);

    if (patch.applyToMerchant && patch.categoryId !== undefined) {
      const updated = getTransaction(db, id)!;
      const key = merchantKey(updated.merchant ?? updated.rawDescription);
      if (key) {
        upsertRule(db, key, patch.categoryId);
        applyCategoryToMerchant(db, key, patch.categoryId);
      }
    }
    return getTransaction(db, id)!;
  });
}

/** Files every transaction of a merchant under a category; returns how many changed. */
export function applyCategoryToMerchant(db: Db, key: string, categoryId: string): number {
  const cols = categoryColumns(categoryId);
  const result = db
    .prepare(
      `UPDATE transactions SET category_id = :category_id, root_category_id = :root_category_id, kind = :kind,
         confidence = 1, needs_review = 0, updated_at = :now
       WHERE merchant_key = :key AND category_id <> :category_id`,
    )
    .run({ ...cols, key, now: nowIso() });
  return Number(result.changes);
}

export function bulkUpdateTransactions(db: Db, ids: readonly string[], change: { categoryId?: string | undefined; needsReview?: boolean | undefined }): number {
  const sets: string[] = ['updated_at = :now'];
  const params: Record<string, string | number> = { ids: JSON.stringify(ids), now: nowIso() };
  if (change.categoryId !== undefined) {
    Object.assign(params, categoryColumns(change.categoryId));
    sets.push('category_id = :category_id', 'root_category_id = :root_category_id', 'kind = :kind', 'confidence = 1');
    if (change.needsReview === undefined) sets.push('needs_review = 0');
  }
  if (change.needsReview !== undefined) (sets.push('needs_review = :needs_review'), (params['needs_review'] = change.needsReview ? 1 : 0));
  const result = db.prepare(`UPDATE transactions SET ${sets.join(', ')} WHERE id IN (SELECT value FROM json_each(:ids))`).run(params);
  return Number(result.changes);
}

export function deleteTransaction(db: Db, id: string): boolean {
  return Number(db.prepare('DELETE FROM transactions WHERE id = ?').run(id).changes) === 1;
}

/**
 * Rows of another source that look like the same payment: same amount and currency, dates at
 * most `days` apart and a matching merchant. A receipt photo and the card line of the same
 * purchase are the typical case — they carry different text, so the fingerprint cannot catch them.
 */
export function findProbableDuplicate(db: Db, tx: Transaction, days = 3): Transaction | null {
  const key = merchantKey(tx.merchant ?? tx.rawDescription);
  const rows = db
    .prepare(
      `SELECT * FROM transactions
       WHERE id <> :id AND amount_minor = :amount AND currency = :currency
         AND abs(julianday(date) - julianday(:date)) <= :days
         AND coalesce(import_id, '') <> coalesce(:importId, '')`,
    )
    .all({ id: tx.id, amount: tx.amountMinor, currency: tx.currency, date: tx.date, days, importId: tx.importId });
  for (const row of rows) {
    const other = toTransaction(row);
    const otherKey = merchantKey(other.merchant ?? other.rawDescription);
    if (!key || !otherKey || key === otherKey || key.includes(otherKey) || otherKey.includes(key)) return other;
  }
  return null;
}

/**
 * A row of another import that is certainly the same payment: same day, amount, currency,
 * merchant and account. The model rewrites the original line slightly differently on each run,
 * so overlapping statements can't rely on the text fingerprint alone. When both rows carry a
 * printed reference or time and they differ, they are two payments (two coffees at the same bar,
 * same price, same day), not one.
 */
export function findCertainDuplicate(db: Db, tx: Transaction): Transaction | null {
  const key = merchantKey(tx.merchant);
  if (!key) return null;
  const row = db
    .prepare(
      `SELECT * FROM transactions
       WHERE id <> :id AND date = :date AND amount_minor = :amount AND currency = :currency AND merchant_key = :key
         AND coalesce(account, '') = coalesce(:account, '') AND coalesce(import_id, '') <> coalesce(:importId, '')
         AND (:reference IS NULL OR reference IS NULL OR reference = :reference)
         AND (:time IS NULL OR ref_time IS NULL OR ref_time = :time)
       LIMIT 1`,
    )
    .get({
      id: tx.id,
      date: tx.date,
      amount: tx.amountMinor,
      currency: tx.currency,
      key,
      account: tx.account,
      importId: tx.importId,
      reference: tx.reference,
      time: tx.time,
    });
  return row ? toTransaction(row) : null;
}

export function dataRange(db: Db): { from: string; to: string } | null {
  const row = db.prepare('SELECT min(date) AS f, max(date) AS t FROM transactions').get() as { f: string | null; t: string | null };
  return row.f && row.t ? { from: row.f, to: row.t } : null;
}

export function countTransactions(db: Db): number {
  return Number((db.prepare('SELECT count(*) AS n FROM transactions').get() as { n: number }).n);
}
