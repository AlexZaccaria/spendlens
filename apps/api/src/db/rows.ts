import type { ImportRecord, LocalizedText, Transaction, TransactionItem } from '@spendlens/contracts';

// node:sqlite returns loosely typed rows; these mappers are the only place they are interpreted.

type Row = Record<string, unknown>;

const str = (v: unknown): string => (typeof v === 'string' ? v : String(v ?? ''));
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : str(v));
const num = (v: unknown): number => (typeof v === 'bigint' ? Number(v) : typeof v === 'number' ? v : Number(v ?? 0));
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : num(v));
const json = <T>(v: unknown, fallback: T): T => {
  if (typeof v !== 'string' || v === '') return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
};

export function toTransaction(row: Row, items: TransactionItem[] = []): Transaction {
  return {
    id: str(row['id']),
    date: str(row['date']),
    rawDescription: str(row['raw_description']),
    title: json<LocalizedText>(row['title'], { it: '', en: '' }),
    merchant: strOrNull(row['merchant']),
    amountMinor: num(row['amount_minor']),
    currency: str(row['currency']),
    baseAmountMinor: numOrNull(row['base_amount_minor']),
    categoryId: str(row['category_id']),
    confidence: num(row['confidence']),
    needsReview: num(row['needs_review']) === 1,
    recurring: num(row['recurring']) === 1,
    account: strOrNull(row['account']),
    note: json<LocalizedText | null>(row['note'], null),
    reference: strOrNull(row['reference']),
    time: strOrNull(row['ref_time']),
    importId: strOrNull(row['import_id']),
    source: str(row['source']) as Transaction['source'],
    items,
    createdAt: str(row['created_at']),
    updatedAt: str(row['updated_at']),
  };
}

export function toItem(row: Row): TransactionItem {
  return {
    id: str(row['id']),
    position: num(row['position']),
    description: str(row['description']),
    title: json<LocalizedText>(row['title'], { it: '', en: '' }),
    quantity: numOrNull(row['quantity']),
    amountMinor: num(row['amount_minor']),
    baseAmountMinor: numOrNull(row['base_amount_minor']),
    categoryId: str(row['category_id']),
    adjustment: num(row['adjustment']) === 1,
  };
}

export function toImportRecord(row: Row): ImportRecord {
  return {
    id: str(row['id']),
    filename: str(row['filename']),
    mime: str(row['mime']),
    sizeBytes: num(row['size_bytes']),
    status: str(row['status']) as ImportRecord['status'],
    documentKind: strOrNull(row['document_kind']) as ImportRecord['documentKind'],
    sourceLanguage: strOrNull(row['source_language']),
    institution: strOrNull(row['institution']),
    summary: json<LocalizedText | null>(row['summary'], null),
    warnings: json<LocalizedText[]>(row['warnings'], []),
    txCount: num(row['tx_count']),
    duplicateCount: num(row['duplicate_count']),
    provider: strOrNull(row['provider']),
    model: strOrNull(row['model']),
    inputTokens: num(row['input_tokens']),
    outputTokens: num(row['output_tokens']),
    error: strOrNull(row['error']),
    createdAt: str(row['created_at']),
  };
}

export { num, str, strOrNull };
