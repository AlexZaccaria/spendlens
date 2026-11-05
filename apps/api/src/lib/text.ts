import { createHash, randomUUID } from 'node:crypto';
import { now } from '@spendlens/contracts';

export const newId = (): string => randomUUID();
export const nowIso = (): string => now().toISOString();

const LEGAL_SUFFIXES = /\b(s\.?p\.?a|s\.?r\.?l|s\.?n\.?c|gmbh|ag|kg|ltd|limited|inc|llc|plc|sa|sas|bv|nv)\b\.?/g;

/** Strip accents, case, punctuation and legal-entity suffixes so that "ESSELUNGA S.p.A.",
 *  "Esselunga" and "esselunga spa" group together. */
export function normalizeText(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(LEGAL_SUFFIXES, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Grouping key of a merchant; digits are dropped so store numbers and dates don't split it. */
export function merchantKey(merchant: string | null | undefined): string | null {
  if (!merchant) return null;
  const key = normalizeText(merchant).replace(/\b\d+\b/g, ' ').replace(/\s+/g, ' ').trim();
  return key === '' ? null : key;
}

export function sha256(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}
