import { todayIso, type ImportEvent, type ImportRecord, type LocalizedText, type Transaction } from '@spendlens/contracts';
import { AiError, toAiError } from '../ai/errors.ts';
import { resolveProvider, type ContentPart, type LlmProvider, type StructuredResult } from '../ai/provider.ts';
import { getAiSettings } from '../ai/settings.ts';
import type { Db } from '../db/database.ts';
import { backfillBaseAmounts, convertMinor, prefetchRates } from '../lib/fx.ts';
import { sha256 } from '../lib/text.ts';
import { completeImport, createImport, failImport, findDoneImportBySha } from '../repo/imports.ts';
import { refreshRecurringFlags } from '../repo/recurring.ts';
import { categoryFromRules, listRules } from '../repo/rules.ts';
import { baseCurrency } from '../repo/settings.ts';
import { deleteTransaction, findCertainDuplicate, findProbableDuplicate, insertTransactions, type NewTransaction } from '../repo/transactions.ts';
import { chunkDocument } from './chunk.ts';
import { decodeInput, type DecodedFile, type ImportInput } from './decode.ts';
import { EXTRACTION_JSON_SCHEMA, extractionSchema, type Extraction } from './extraction.ts';
import { mergeExtractions, normalizeExtraction, REVIEW_THRESHOLD } from './normalize.ts';
import { buildUserPrompt, EXTRACTION_SYSTEM_PROMPT } from './prompt.ts';

export type { ImportInput } from './decode.ts';
export type Emit = (event: ImportEvent) => void | Promise<void>;

export interface RunImportOptions {
  /** Import even when an identical file was already imported. */
  readonly force?: boolean;
  /** Injected in tests; otherwise resolved from the stored settings. */
  readonly provider?: LlmProvider;
  readonly signal?: AbortSignal;
  readonly today?: string;
}

export interface RunImportSummary {
  readonly imported: number;
  readonly duplicates: number;
  readonly failed: number;
  readonly records: ImportRecord[];
}

/** Parts of a document processed at the same time. */
const CONCURRENCY = 2;
const MAX_RULES_IN_PROMPT = 60;
const MAX_PRODUCTS_IN_PROMPT = 120;

/** The most used receipt product names, so a new receipt reuses them ("Pannolini", not "Pannolini Pampers"). */
function knownProducts(db: Db): LocalizedText[] {
  const rows = db
    .prepare(
      `SELECT title FROM transaction_items WHERE adjustment = 0
       GROUP BY lower(json_extract(title, '$.it')) ORDER BY count(*) DESC LIMIT ?`,
    )
    .all(MAX_PRODUCTS_IN_PROMPT) as { title: string }[];
  return rows.flatMap((r) => {
    try {
      const t = JSON.parse(r.title) as LocalizedText;
      return t.it && t.en ? [t] : [];
    } catch {
      return [];
    }
  });
}

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return results;
}

const toBase64 = (bytes: Uint8Array): string => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');

interface Call {
  readonly parts: ContentPart[];
}

/** How the document reaches the model: native PDF / image when the provider reads them, text otherwise. */
function planCalls(decoded: DecodedFile, provider: LlmProvider, prompt: (documentText: string | null, part: number, parts: number) => string, filename: string): Call[] {
  if (decoded.kind === 'image') {
    if (!provider.capabilities.vision) throw new AiError('unsupported_image', 'The configured model cannot read images.');
    return [{ parts: [{ type: 'image', mime: decoded.mime, data: toBase64(decoded.bytes) }, { type: 'text', text: prompt(null, 1, 1) }] }];
  }
  if (decoded.kind === 'pdf' && provider.capabilities.nativePdf) {
    return [{ parts: [{ type: 'pdf', filename, data: toBase64(decoded.bytes) }, { type: 'text', text: prompt(null, 1, 1) }] }];
  }
  const text = decoded.text;
  if (decoded.kind === 'pdf' && text.trim() === '') {
    throw new AiError('pdf_no_text', 'This PDF has no text layer (a scan) and the configured model cannot read PDF files directly.');
  }
  const chunks = chunkDocument(text);
  return chunks.map((chunk, i) => ({ parts: [{ type: 'text', text: prompt(chunk, i + 1, chunks.length) }] }));
}

function parseExtraction(result: StructuredResult): Extraction {
  const parsed = extractionSchema.safeParse(result.json);
  if (!parsed.success) throw new AiError('invalid_output', `The model's answer does not match the expected shape: ${parsed.error.issues[0]?.message ?? 'invalid'}.`);
  return parsed.data;
}

function duplicateNote(other: Transaction): LocalizedText {
  return {
    it: `Possibile duplicato di «${other.title.it}» del ${other.date}`,
    en: `Possible duplicate of “${other.title.en}” on ${other.date}`,
  };
}

function joinNotes(a: LocalizedText | null, b: LocalizedText): LocalizedText {
  return a ? { it: `${a.it} · ${b.it}`, en: `${a.en} · ${b.en}` } : b;
}

async function importOne(
  db: Db,
  input: ImportInput,
  file: number,
  provider: LlmProvider,
  emit: Emit,
  options: RunImportOptions,
): Promise<{ record: ImportRecord; inserted: number; duplicates: number }> {
  const hash = sha256(input.bytes);
  if (!options.force) {
    const previous = findDoneImportBySha(db, hash);
    if (previous) throw new AiError('already_imported', `This file was already imported on ${previous.createdAt.slice(0, 10)}.`);
  }

  await emit({ type: 'stage', file, stage: 'reading', chunk: 0, chunks: 1 });
  const decoded = await decodeInput(input);
  const record = createImport(db, { filename: input.filename, mime: input.mime || 'application/octet-stream', sizeBytes: input.bytes.byteLength, sha256: hash, content: input.bytes });

  try {
    const base = baseCurrency(db);
    const today = options.today ?? todayIso();
    const rules = listRules(db).slice(0, MAX_RULES_IN_PROMPT);
    const products = knownProducts(db);
    const format = decoded.kind === 'text' ? decoded.format : decoded.kind;
    const prompt = (documentText: string | null, part: number, parts: number) =>
      buildUserPrompt({ today, baseCurrency: base, filename: input.filename, format, part, parts, rules, products, documentText });
    const calls = planCalls(decoded, provider, prompt, input.filename);

    let done = 0;
    await emit({ type: 'stage', file, stage: 'extracting', chunk: 0, chunks: calls.length });
    const results = await mapLimit(calls, CONCURRENCY, async (call) => {
      const result = await provider.complete({
        system: EXTRACTION_SYSTEM_PROMPT,
        parts: call.parts,
        schema: EXTRACTION_JSON_SCHEMA,
        schemaName: 'transactions',
        ...(options.signal && { signal: options.signal }),
      });
      const extraction = parseExtraction(result);
      await emit({ type: 'stage', file, stage: 'extracting', chunk: ++done, chunks: calls.length });
      return { result, extraction };
    });

    await emit({ type: 'stage', file, stage: 'saving', chunk: 0, chunks: 1 });
    const merged = mergeExtractions(results.map((r) => r.extraction));
    const { items, warnings } = normalizeExtraction(merged, {
      importId: record.id,
      source: 'import',
      baseCurrency: base,
      ruleFor: (merchant, description) => categoryFromRules(db, merchant ?? description),
    });

    const datesByCurrency = new Map<string, string[]>();
    for (const t of items) if (t.currency !== base) datesByCurrency.set(t.currency, [...(datesByCurrency.get(t.currency) ?? []), t.date]);
    for (const [currency, dates] of datesByCurrency) await prefetchRates(db, currency, base, dates);

    const rows: NewTransaction[] = items.map((t) => {
      const baseAmountMinor = convertMinor(db, t.amountMinor, t.currency, base, t.date);
      return { ...t, baseAmountMinor, needsReview: t.confidence < REVIEW_THRESHOLD || baseAmountMinor === null };
    });
    const unconverted = rows.filter((r) => r.baseAmountMinor === null).length;
    if (unconverted > 0) {
      warnings.push({
        it: `${unconverted} importi in valuta estera non ancora convertiti in ${base}: tasso di cambio non disponibile.`,
        en: `${unconverted} foreign-currency amounts not yet converted to ${base}: exchange rate unavailable.`,
      });
    }

    const insert = insertTransactions(db, rows);
    const flag = db.prepare('UPDATE transactions SET needs_review = 1, note = ? WHERE id = ?');
    const kept: Transaction[] = [];
    let duplicates = insert.duplicates;
    for (const tx of insert.inserted) {
      // Overlapping statements: the same payment already imported from another file is dropped;
      // a looser match (e.g. a receipt vs. the card line) is kept and sent to review.
      if (findCertainDuplicate(db, tx)) {
        deleteTransaction(db, tx.id);
        duplicates++;
        continue;
      }
      kept.push(tx);
      const other = findProbableDuplicate(db, tx);
      if (other) flag.run(JSON.stringify(joinNotes(tx.note, duplicateNote(other))), tx.id);
    }
    const inserted = kept;

    const last = results.at(-1)!.result;
    const completed = completeImport(db, record.id, {
      documentKind: merged.document.kind,
      sourceLanguage: merged.document.language.trim().toLowerCase().slice(0, 8) || null,
      institution: merged.document.institution?.trim() || null,
      summary: merged.document.summary,
      warnings,
      txCount: inserted.length,
      duplicateCount: duplicates,
      provider: provider.id,
      model: last.model || provider.model,
      inputTokens: results.reduce((s, r) => s + r.result.inputTokens, 0),
      outputTokens: results.reduce((s, r) => s + r.result.outputTokens, 0),
    });
    return { record: completed, inserted: inserted.length, duplicates };
  } catch (err) {
    const e = toAiError(err);
    failImport(db, record.id, `${e.code}: ${e.message}`);
    throw e;
  }
}

/**
 * Imports a batch of files, one after the other, streaming progress through `emit`. A failing
 * file does not stop the batch. Recurring flags are refreshed once at the end.
 */
export async function runImport(db: Db, inputs: readonly ImportInput[], emit: Emit, options: RunImportOptions = {}): Promise<RunImportSummary> {
  let provider: LlmProvider | null = options.provider ?? null;
  let providerError: AiError | null = null;
  if (!provider) {
    try {
      provider = resolveProvider(getAiSettings(db));
    } catch (err) {
      providerError = toAiError(err);
    }
  }

  let imported = 0;
  let duplicates = 0;
  let failed = 0;
  const records: ImportRecord[] = [];
  for (const [file, input] of inputs.entries()) {
    await emit({ type: 'file-start', file, filename: input.filename, total: inputs.length });
    try {
      if (options.signal?.aborted) throw new AiError('provider_error', 'The import was cancelled.');
      if (!provider) throw providerError ?? new AiError('ai_not_configured', 'AI provider not configured.');
      const result = await importOne(db, input, file, provider, emit, options);
      imported += result.inserted;
      duplicates += result.duplicates;
      records.push(result.record);
      await emit({ type: 'file-done', file, record: result.record });
    } catch (err) {
      const e = toAiError(err);
      failed++;
      await emit({ type: 'file-error', file, filename: input.filename, error: { code: e.code, message: e.message } });
    }
  }
  // Amounts left without a rate by an earlier import made offline get another chance.
  await backfillBaseAmounts(db, baseCurrency(db));
  if (imported > 0) refreshRecurringFlags(db);
  await emit({ type: 'done', imported, duplicates, failed });
  return { imported, duplicates, failed, records };
}
