import type { DocumentKind, ImportRecord, LocalizedText } from '@spendlens/contracts';
import type { Db } from '../db/database.ts';
import { toImportRecord } from '../db/rows.ts';
import { newId, nowIso } from '../lib/text.ts';

export interface NewImport {
  readonly filename: string;
  readonly mime: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly content: Uint8Array;
}

export function createImport(db: Db, input: NewImport): ImportRecord {
  const id = newId();
  db.prepare(
    `INSERT INTO imports (id, filename, mime, size_bytes, sha256, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'processing', ?)`,
  ).run(id, input.filename, input.mime, input.sizeBytes, input.sha256, nowIso());
  db.prepare('INSERT INTO import_files (import_id, content) VALUES (?, ?)').run(id, input.content);
  return getImport(db, id)!;
}

export interface ImportCompletion {
  readonly documentKind: DocumentKind | null;
  readonly sourceLanguage: string | null;
  readonly institution: string | null;
  readonly summary: LocalizedText | null;
  readonly warnings: readonly LocalizedText[];
  readonly txCount: number;
  readonly duplicateCount: number;
  readonly provider: string;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export function completeImport(db: Db, id: string, c: ImportCompletion): ImportRecord {
  db.prepare(
    `UPDATE imports SET status = 'done', document_kind = :documentKind, source_language = :sourceLanguage,
       institution = :institution, summary = :summary, warnings = :warnings, tx_count = :txCount,
       duplicate_count = :duplicateCount, provider = :provider, model = :model, input_tokens = :inputTokens,
       output_tokens = :outputTokens, error = NULL
     WHERE id = :id`,
  ).run({
    id,
    documentKind: c.documentKind,
    sourceLanguage: c.sourceLanguage,
    institution: c.institution,
    summary: c.summary === null ? null : JSON.stringify(c.summary),
    warnings: JSON.stringify(c.warnings),
    txCount: c.txCount,
    duplicateCount: c.duplicateCount,
    provider: c.provider,
    model: c.model,
    inputTokens: c.inputTokens,
    outputTokens: c.outputTokens,
  });
  return getImport(db, id)!;
}

export function failImport(db: Db, id: string, error: string): ImportRecord {
  db.prepare(`UPDATE imports SET status = 'error', error = ? WHERE id = ?`).run(error, id);
  return getImport(db, id)!;
}

export function getImport(db: Db, id: string): ImportRecord | null {
  const row = db.prepare('SELECT * FROM imports WHERE id = ?').get(id);
  return row ? toImportRecord(row) : null;
}

export function getImportContent(db: Db, id: string): Uint8Array | null {
  const row = db.prepare('SELECT content FROM import_files WHERE import_id = ?').get(id) as { content: Uint8Array } | undefined;
  return row?.content ?? null;
}

export function findDoneImportBySha(db: Db, sha256: string): ImportRecord | null {
  const row = db.prepare(`SELECT * FROM imports WHERE sha256 = ? AND status = 'done' ORDER BY created_at DESC LIMIT 1`).get(sha256);
  return row ? toImportRecord(row) : null;
}

export function listImports(db: Db): ImportRecord[] {
  return db.prepare('SELECT * FROM imports ORDER BY created_at DESC').all().map(toImportRecord);
}

/** Deleting an import removes every transaction it created (ON DELETE CASCADE): a one-click undo. */
export function deleteImport(db: Db, id: string): boolean {
  return Number(db.prepare('DELETE FROM imports WHERE id = ?').run(id).changes) === 1;
}
