import { extname } from 'node:path';
import { extractText, getDocumentProxy } from 'unpdf';
import * as XLSX from 'xlsx';
import { AiError } from '../ai/errors.ts';
import type { ImageMime } from '../ai/provider.ts';

export interface ImportInput {
  readonly filename: string;
  readonly mime: string;
  readonly bytes: Uint8Array;
}

export type DecodedFile =
  /** Anything the model reads as text: CSV/TSV, OFX/QIF, XML (CAMT.053), JSON, notes, and spreadsheets converted to CSV. */
  | { readonly kind: 'text'; readonly format: string; readonly text: string }
  /** PDF bytes for providers that read PDFs natively, plus the extracted text for the others. */
  | { readonly kind: 'pdf'; readonly bytes: Uint8Array; readonly text: string }
  | { readonly kind: 'image'; readonly mime: ImageMime; readonly bytes: Uint8Array };

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
/** Anthropic's per-image limit; larger photos should be downscaled by the browser first. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** ~35 chunks of 12k characters: beyond this a single import would take dozens of model calls. */
export const MAX_TEXT_CHARS = 420_000;

const TEXT_EXTENSIONS = new Set(['.csv', '.tsv', '.txt', '.text', '.ofx', '.qfx', '.qif', '.xml', '.camt', '.json', '.html', '.htm', '.eml', '.md', '.mt940', '.sta', '.940']);
const SHEET_EXTENSIONS = new Set(['.xlsx', '.xlsm', '.xls', '.ods', '.numbers', '.fods']);

const startsWith = (b: Uint8Array, sig: readonly number[], offset = 0): boolean => sig.every((v, i) => b[offset + i] === v);
const ascii = (b: Uint8Array, from: number, to: number): string => String.fromCharCode(...b.subarray(from, to));

type Sniffed = 'pdf' | 'png' | 'jpeg' | 'gif' | 'webp' | 'heif' | 'bmp' | 'tiff' | 'zip' | 'cfb' | 'unknown';

export function sniff(b: Uint8Array): Sniffed {
  if (startsWith(b, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'pdf';
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (startsWith(b, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (ascii(b, 0, 6) === 'GIF87a' || ascii(b, 0, 6) === 'GIF89a') return 'gif';
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return 'webp';
  if (ascii(b, 4, 8) === 'ftyp' && /^(heic|heix|hevc|heim|heis|mif1|msf1|avif|avis)$/.test(ascii(b, 8, 12))) return 'heif';
  if (ascii(b, 0, 2) === 'BM') return 'bmp';
  if (startsWith(b, [0x49, 0x49, 0x2a, 0x00]) || startsWith(b, [0x4d, 0x4d, 0x00, 0x2a])) return 'tiff';
  if (startsWith(b, [0x50, 0x4b, 0x03, 0x04])) return 'zip';
  if (startsWith(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return 'cfb';
  return 'unknown';
}

/** BOM first, then strict UTF-8, then Windows-1252 — the encoding of most European bank exports. */
export function decodeText(bytes: Uint8Array): string {
  if (startsWith(bytes, [0xef, 0xbb, 0xbf])) return new TextDecoder('utf-8').decode(bytes.subarray(3));
  if (startsWith(bytes, [0xff, 0xfe])) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (startsWith(bytes, [0xfe, 0xff])) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/** A text file has (almost) no control characters other than whitespace. */
function looksBinary(text: string): boolean {
  const sample = text.slice(0, 4096);
  if (sample.length === 0) return false;
  let control = 0;
  for (const ch of sample) {
    const c = ch.charCodeAt(0);
    if (c === 0 || (c < 32 && c !== 9 && c !== 10 && c !== 13 && c !== 12)) control++;
  }
  return control / sample.length > 0.02;
}

/** HTML exports (some banks e-mail statements as HTML tables): keep the table structure, drop markup. */
function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(td|th)>/gi, ' | ')
    .replace(/<\/(tr|p|div|li|h\d)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

/** Every non-empty sheet as CSV, each introduced by a `### Sheet: <name>` line. */
export function spreadsheetToText(bytes: Uint8Array): string {
  let book: XLSX.WorkBook;
  try {
    book = XLSX.read(bytes, { type: 'array', cellDates: true, dense: true });
  } catch (err) {
    throw new AiError('unsupported_format', `The spreadsheet could not be read: ${err instanceof Error ? err.message : String(err)}`);
  }
  const blocks: string[] = [];
  for (const name of book.SheetNames) {
    const sheet = book.Sheets[name];
    if (!sheet) continue;
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false, strip: true }).trim();
    if (csv.replace(/[,\s]/g, '') === '') continue;
    blocks.push(`### Sheet: ${name}\n${csv}`);
  }
  return blocks.join('\n\n');
}

export async function pdfText(bytes: Uint8Array): Promise<string> {
  try {
    // pdf.js takes ownership of the buffer it is given: hand it a copy.
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(pdf, { mergePages: true });
    return text.replace(/[ \t]+\n/g, '\n').trim();
  } catch {
    return '';
  }
}

function textFile(format: string, text: string): DecodedFile {
  const clean = text.replace(/\r\n?/g, '\n').trim();
  if (clean === '') throw new AiError('unsupported_format', 'The file is empty.');
  if (clean.length > MAX_TEXT_CHARS) {
    throw new AiError('file_too_large', `The file holds ${clean.length.toLocaleString('en')} characters; the limit is ${MAX_TEXT_CHARS.toLocaleString('en')}. Split it by period.`);
  }
  return { kind: 'text', format, text: clean };
}

function image(mime: ImageMime, bytes: Uint8Array): DecodedFile {
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new AiError('file_too_large', 'Images are limited to 5 MB — use a smaller photo.');
  return { kind: 'image', mime, bytes };
}

export async function decodeInput(input: ImportInput): Promise<DecodedFile> {
  const { bytes } = input;
  if (bytes.byteLength === 0) throw new AiError('unsupported_format', 'The file is empty.');
  if (bytes.byteLength > MAX_FILE_BYTES) throw new AiError('file_too_large', 'Files are limited to 20 MB.');
  const ext = extname(input.filename).toLowerCase();

  switch (sniff(bytes)) {
    case 'pdf':
      return { kind: 'pdf', bytes, text: await pdfText(bytes) };
    case 'png':
      return image('image/png', bytes);
    case 'jpeg':
      return image('image/jpeg', bytes);
    case 'gif':
      return image('image/gif', bytes);
    case 'webp':
      return image('image/webp', bytes);
    case 'heif':
    case 'bmp':
    case 'tiff':
      throw new AiError('unsupported_image', 'Only JPEG, PNG, WebP and GIF images are supported — export the photo as JPEG.');
    case 'zip':
    case 'cfb':
      if (SHEET_EXTENSIONS.has(ext) || /spreadsheet|excel|opendocument\.spreadsheet|numbers/.test(input.mime) || ext === '') {
        return textFile('spreadsheet', spreadsheetToText(bytes));
      }
      throw new AiError('unsupported_format', `"${ext || input.mime}" files are not supported.`);
    case 'unknown': {
      const text = decodeText(bytes);
      if (looksBinary(text)) throw new AiError('unsupported_format', `"${ext || input.mime || 'This'}" file is not a readable document.`);
      if (ext === '.html' || ext === '.htm' || /<html[\s>]/i.test(text.slice(0, 2000))) return textFile('html', htmlToText(text));
      // A plain-text spreadsheet export (e.g. SpreadsheetML .xls) is still handled by SheetJS.
      if (SHEET_EXTENSIONS.has(ext) && /<\?xml|<Workbook/i.test(text.slice(0, 500))) return textFile('spreadsheet', spreadsheetToText(bytes));
      return textFile(TEXT_EXTENSIONS.has(ext) ? ext.slice(1) : 'text', text);
    }
  }
}
