/**
 * Splits a long document into model-sized parts on line boundaries. Every part of a table
 * repeats the table's preamble (account, period, currency lines) and its header row, so each
 * call sees which column is which.
 */

export const CHUNK_CHARS = 12_000;
/** A preamble longer than this is not repeated — only the header row is. */
const MAX_REPEATED_PREAMBLE = 1_500;
const SHEET_MARKER = /^### Sheet: /;

const DELIMITERS = [';', ',', '\t', '|'] as const;

function count(line: string, delimiter: string): number {
  let n = 0;
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === delimiter && !quoted) n++;
  }
  return n;
}

/**
 * Index of the header row of a delimited table among the first lines: the first line with at
 * least two delimiters, mostly non-numeric cells, followed by a line with as many delimiters.
 * -1 when the text is not a table.
 */
export function findHeaderRow(lines: readonly string[]): number {
  const limit = Math.min(lines.length - 1, 25);
  for (let i = 0; i < limit; i++) {
    const line = lines[i]!;
    for (const d of DELIMITERS) {
      const n = count(line, d);
      if (n < 2) continue;
      const cells = line.split(d).map((c) => c.trim().replace(/^"|"$/g, ''));
      const textual = cells.filter((c) => c !== '' && !/^[-+]?[\d.,\s€$£%/:-]+$/.test(c)).length;
      if (textual < cells.length * 0.6) continue;
      const next = lines[i + 1]!;
      if (Math.abs(count(next, d) - n) <= 1) return i;
    }
  }
  return -1;
}

/** Splits one table or text block into parts of at most `maxChars`. */
export function chunkText(text: string, maxChars: number = CHUNK_CHARS): string[] {
  if (text.length <= maxChars) return [text];
  const lines = text.split('\n');
  const headerIdx = findHeaderRow(lines);
  let head: string[] = [];
  let bodyStart = 0;
  if (headerIdx >= 0) {
    const preamble = lines.slice(0, headerIdx + 1);
    head = preamble.join('\n').length <= MAX_REPEATED_PREAMBLE ? preamble : [lines[headerIdx]!];
    bodyStart = headerIdx + 1;
  }
  const headText = head.join('\n');
  const budget = Math.max(1_000, maxChars - headText.length - 1);

  const parts: string[] = [];
  let current: string[] = [];
  let size = 0;
  const flush = () => {
    if (current.length === 0) return;
    parts.push(headText ? `${headText}\n${current.join('\n')}` : current.join('\n'));
    current = [];
    size = 0;
  };
  // Lines before a header that is not repeated (a long preamble) go into the first part.
  const body = headerIdx >= 0 && head.length === 1 ? [...lines.slice(0, headerIdx), ...lines.slice(bodyStart)] : lines.slice(bodyStart);
  for (const line of body) {
    // A single line longer than the budget (minified JSON, XML on one line) is cut hard.
    for (let offset = 0; offset < Math.max(line.length, 1); offset += budget) {
      const piece = line.slice(offset, offset + budget);
      if (size + piece.length + 1 > budget) flush();
      current.push(piece);
      size += piece.length + 1;
    }
  }
  flush();
  return parts;
}

/** Splits a decoded document: spreadsheets per sheet (each part keeps its sheet label), then by size. */
export function chunkDocument(text: string, maxChars: number = CHUNK_CHARS): string[] {
  if (!SHEET_MARKER.test(text)) return chunkText(text, maxChars);
  const sheets = text.split(/\n\n(?=### Sheet: )/);
  return sheets.flatMap((sheet) => {
    const [label, ...rest] = sheet.split('\n');
    return chunkText(rest.join('\n'), maxChars - label!.length - 1).map((part) => `${label}\n${part}`);
  });
}
