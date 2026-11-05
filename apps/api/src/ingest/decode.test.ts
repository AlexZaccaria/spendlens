import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import * as XLSX from 'xlsx';
import { AiError } from '../ai/errors.ts';
import { decodeInput, decodeText, sniff } from './decode.ts';

const input = (filename: string, bytes: Uint8Array, mime = '') => ({ filename, mime, bytes });

describe('decodeText', () => {
  it('honours a UTF-8 BOM', () => {
    assert.equal(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x43, 0x61, 0x66, 0xc3, 0xa8])), 'Cafè');
  });

  it('falls back to Windows-1252 when the bytes are not UTF-8 (Italian/German bank exports)', () => {
    // "Caffè;Müller;12,50 €" in Windows-1252: è = E8, ü = FC, € = 80
    const bytes = new Uint8Array([0x43, 0x61, 0x66, 0x66, 0xe8, 0x3b, 0x4d, 0xfc, 0x6c, 0x6c, 0x65, 0x72, 0x3b, 0x31, 0x32, 0x2c, 0x35, 0x30, 0x20, 0x80]);
    assert.equal(decodeText(bytes), 'Caffè;Müller;12,50 €');
  });

  it('reads UTF-16LE with BOM', () => {
    const body = Buffer.from('Datum;Betrag', 'utf16le');
    assert.equal(decodeText(new Uint8Array([0xff, 0xfe, ...body])), 'Datum;Betrag');
  });
});

describe('decodeInput', () => {
  it('converts every non-empty sheet of a workbook to labelled CSV', async () => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Fecha', 'Concepto', 'Importe'], ['03/10/2026', 'Mercadona', -45.3]]), 'Octubre');
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([[]]), 'Vacía');
    const bytes = new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
    assert.equal(sniff(bytes), 'zip');
    const decoded = await decodeInput(input('gastos.xlsx', bytes));
    assert.equal(decoded.kind, 'text');
    assert.ok(decoded.kind === 'text' && decoded.text.startsWith('### Sheet: Octubre\nFecha,Concepto,Importe'));
    assert.ok(decoded.kind === 'text' && decoded.text.includes('Mercadona,-45.3'));
    assert.ok(decoded.kind === 'text' && !decoded.text.includes('Vacía'));
  });

  it('keeps PDF bytes and extracts their text', async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage();
    page.drawText('Bolletta Enel Energia - Totale da pagare 87,40 EUR', { x: 40, y: 700, size: 12, font: await pdf.embedFont(StandardFonts.Helvetica) });
    const bytes = await pdf.save();
    const decoded = await decodeInput(input('bolletta.pdf', bytes, 'application/pdf'));
    assert.equal(decoded.kind, 'pdf');
    assert.ok(decoded.kind === 'pdf' && decoded.text.includes('Totale da pagare 87,40'));
  });

  it('recognises images by content, not by name', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const decoded = await decodeInput(input('scontrino.jpg', png));
    assert.ok(decoded.kind === 'image' && decoded.mime === 'image/png');
  });

  it('rejects HEIC photos and binary junk with typed errors', async () => {
    const heic = new Uint8Array([0, 0, 0, 0x18, ...Buffer.from('ftypheic'), 0, 0, 0, 0]);
    await assert.rejects(decodeInput(input('IMG_0001.HEIC', heic)), (e: unknown) => e instanceof AiError && e.code === 'unsupported_image');
    const junk = new Uint8Array(512).map((_, i) => (i * 7) % 32);
    await assert.rejects(decodeInput(input('data.bin', junk)), (e: unknown) => e instanceof AiError && e.code === 'unsupported_format');
  });

  it('flattens HTML statements to text, keeping table cells apart', async () => {
    const html = '<html><body><table><tr><td>03/10</td><td>ESSELUNGA</td><td>-45,30</td></tr></table></body></html>';
    const decoded = await decodeInput(input('estratto.html', new TextEncoder().encode(html)));
    assert.ok(decoded.kind === 'text' && decoded.text.includes('03/10 | ESSELUNGA | -45,30'));
  });
});
