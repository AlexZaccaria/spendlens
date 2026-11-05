import {
  FALLBACK_EXPENSE_CATEGORY,
  getCategory,
  isKnownCurrency,
  toMinor,
  type LocalizedText,
  type TransactionSource,
} from '@spendlens/contracts';
import type { NewItem } from '../repo/transactions.ts';
import type { ExtractedItem, ExtractedTransaction, Extraction } from './extraction.ts';

/** Below this confidence a row is flagged for the user to review. */
export const REVIEW_THRESHOLD = 0.6;
/** Confidence given to a row whose category contradicts its sign (e.g. "Groceries" money in). */
const INCONSISTENT_CONFIDENCE = 0.5;

export interface NormalizeContext {
  readonly importId: string | null;
  readonly source: TransactionSource;
  readonly baseCurrency: string;
  /** Category forced by a user rule for this merchant / line, or null. */
  readonly ruleFor: (merchant: string | null, description: string) => string | null;
}

/** A transaction ready for insertion except for its base-currency amount (needs exchange rates). */
export interface NormalizedTransaction {
  readonly date: string;
  readonly rawDescription: string;
  readonly title: LocalizedText;
  readonly merchant: string | null;
  readonly amountMinor: number;
  readonly currency: string;
  readonly categoryId: string;
  readonly confidence: number;
  readonly account: string | null;
  readonly note: LocalizedText | null;
  readonly reference: string | null;
  readonly time: string | null;
  readonly importId: string | null;
  readonly source: TransactionSource;
  /** Receipt lines (empty for statement lines); balanced to the amount when stored. */
  readonly items: NewItem[];
}

export interface NormalizeResult {
  readonly items: NormalizedTransaction[];
  readonly warnings: LocalizedText[];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function validDate(date: string): boolean {
  if (!ISO_DATE.test(date)) return false;
  const d = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date;
}

function text(t: LocalizedText | null | undefined): LocalizedText | null {
  if (!t) return null;
  const it = t.it.trim();
  const en = t.en.trim();
  if (!it && !en) return null;
  return { it: it || en, en: en || it };
}

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

function currencyOf(raw: string, fallback: string): string {
  const code = raw.trim().toUpperCase();
  return isKnownCurrency(code) ? code : fallback;
}

/** Does the category agree with the direction of the money? Transfers go both ways. */
function signConsistent(categoryId: string, amount: number): boolean {
  const kind = getCategory(categoryId)?.kind ?? 'expense';
  if (kind === 'transfer') return true;
  return kind === 'income' ? amount > 0 : amount < 0;
}

function normalizeOne(tx: ExtractedTransaction, doc: Extraction['document'], ctx: NormalizeContext): NormalizedTransaction | LocalizedText {
  const description = tx.description.trim();
  const label = description || tx.title.en || tx.title.it;
  if (!validDate(tx.date.trim())) {
    return { it: `Riga ignorata per data non valida (${tx.date}): ${label}`, en: `Skipped a line with an invalid date (${tx.date}): ${label}` };
  }
  if (!Number.isFinite(tx.amount) || tx.amount === 0) {
    return { it: `Riga ignorata per importo mancante: ${label}`, en: `Skipped a line without an amount: ${label}` };
  }
  const currency = currencyOf(tx.currency, doc.currency && isKnownCurrency(doc.currency.toUpperCase()) ? doc.currency.toUpperCase() : ctx.baseCurrency);
  const merchant = tx.merchant?.trim() || null;
  const title = text(tx.title) ?? { it: label, en: label };

  let categoryId = getCategory(tx.categoryId)?.parentId ? tx.categoryId : tx.amount > 0 ? 'income.other' : FALLBACK_EXPENSE_CATEGORY;
  let confidence = clamp01(tx.confidence);
  const ruled = ctx.ruleFor(merchant, description);
  if (ruled && getCategory(ruled)) {
    categoryId = ruled;
    confidence = Math.max(confidence, 0.95);
  } else if (!signConsistent(categoryId, tx.amount)) {
    // Kept as the model chose (a refund filed under its shop is plausible) but sent to review.
    confidence = Math.min(confidence, INCONSISTENT_CONFIDENCE);
  }

  const amountMinor = toMinor(tx.amount, currency);
  const items = normalizeItems(tx.items ?? [], amountMinor, currency);
  // Lines far from the total (a misread receipt) are kept but sent to review; small gaps are
  // discounts or rounding, reconciled with an adjustment line when the items are stored.
  const gap = items.length ? Math.abs(items.reduce((s, i) => s + i.amountMinor, 0) - amountMinor) : 0;
  if (gap > Math.abs(amountMinor) * ITEMS_TOLERANCE) confidence = Math.min(confidence, INCONSISTENT_CONFIDENCE);

  return {
    date: tx.date.trim(),
    rawDescription: description || title.en,
    title,
    merchant,
    amountMinor,
    currency,
    categoryId,
    confidence,
    account: doc.account?.trim() || null,
    note: text(tx.note),
    reference: normalizeReference(tx.reference),
    time: normalizeTime(tx.time),
    importId: ctx.importId,
    source: ctx.source,
    items,
  };
}

/**
 * "Doc. N. 0412 - 0087" and "0412-0087" are the same reference: a printed label is dropped, case
 * and spaces do not count. Too short or too long to identify anything → null.
 */
export function normalizeReference(raw: string | null | undefined): string | null {
  const value = (raw ?? '')
    .replace(/^\s*(doc(umento)?|scontrino|ricevuta|fattura|receipt|invoice|beleg|bon|ticket|factura|id|ref)\b[\s.:#-]*/i, '')
    .replace(/^(n(r|o|um)?\b|n(?=[º°]))[\s.:º°#-]*/i, '')
    .replace(/\s+/g, '')
    .toUpperCase();
  return value.length >= 2 && value.length <= 64 && /[0-9A-Z]/.test(value) ? value : null;
}

/** "18:07", "18.07", "9:05:33" → "18:07", "18:07", "09:05"; anything else → null. */
export function normalizeTime(raw: string | null | undefined): string | null {
  const m = /^\s*(\d{1,2})[:.](\d{2})/.exec(raw ?? '');
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  return hours < 24 && minutes < 60 ? `${String(hours).padStart(2, '0')}:${m[2]}` : null;
}

/** Share of the total the receipt lines may miss before the row goes to review. */
const ITEMS_TOLERANCE = 0.1;

/** Receipt lines in minor units, with the transaction's sign even when the model printed them positive. */
function normalizeItems(items: readonly ExtractedItem[], amountMinor: number, currency: string): NewItem[] {
  const lines = items
    .filter((i) => Number.isFinite(i.amount) && i.amount !== 0)
    .map((i) => {
      const label = i.description.trim() || i.title.en || i.title.it;
      return {
        description: i.description.trim(),
        title: text(i.title) ?? { it: label, en: label },
        quantity: i.quantity !== null && Number.isFinite(i.quantity) ? i.quantity : null,
        amountMinor: toMinor(i.amount, currency),
        categoryId: i.categoryId,
      };
    });
  const sum = lines.reduce((s, i) => s + i.amountMinor, 0);
  return Math.sign(sum) === -Math.sign(amountMinor) ? lines.map((l) => ({ ...l, amountMinor: -l.amountMinor })) : lines;
}

export function normalizeExtraction(extraction: Extraction, ctx: NormalizeContext): NormalizeResult {
  const items: NormalizedTransaction[] = [];
  const warnings: LocalizedText[] = [];
  for (const w of extraction.warnings) {
    const t = text(w);
    if (t) warnings.push(t);
  }
  for (const tx of extraction.transactions) {
    const result = normalizeOne(tx, extraction.document, ctx);
    if ('amountMinor' in result) items.push(result);
    else warnings.push(result);
  }
  return { items, warnings };
}

/** Joins the answers for the parts of one document: first non-empty metadata wins, warnings deduplicated. */
export function mergeExtractions(parts: readonly Extraction[]): Extraction {
  const first = parts[0]!;
  const pick = <K extends keyof Extraction['document']>(key: K): Extraction['document'][K] =>
    parts.map((p) => p.document[key]).find((v) => v !== null && v !== '') ?? first.document[key];
  const seen = new Set<string>();
  const warnings = parts
    .flatMap((p) => p.warnings)
    .filter((w) => {
      const key = w.en.trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return {
    document: {
      kind: first.document.kind,
      language: pick('language'),
      institution: pick('institution'),
      account: pick('account'),
      currency: pick('currency'),
      summary: first.document.summary,
    },
    transactions: parts.flatMap((p) => p.transactions),
    warnings,
  };
}
