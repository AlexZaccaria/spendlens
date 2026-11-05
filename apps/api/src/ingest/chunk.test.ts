import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { chunkDocument, chunkText, findHeaderRow } from './chunk.ts';

const statement = (rows: number): string =>
  [
    'Intesa Sanpaolo - Estratto conto',
    'Conto: 1000/123456;Periodo: 01/10/2026 - 31/10/2026',
    'Data contabile;Data valuta;Descrizione;Dare;Avere',
    ...Array.from({ length: rows }, (_, i) => `0${(i % 9) + 1}/10/2026;0${(i % 9) + 1}/10/2026;PAGAMENTO POS ESSELUNGA MILANO CARTA *1234 OPERAZIONE ${i};${(i + 1) * 1.5};`),
  ].join('\n');

describe('chunking', () => {
  it('finds the header row after a preamble', () => {
    assert.equal(findHeaderRow(statement(5).split('\n')), 2);
    assert.equal(findHeaderRow(['ieri pizza 12 euro', 'benzina 60']), -1);
  });

  it('keeps short documents whole', () => {
    assert.deepEqual(chunkText('a\nb', 100), ['a\nb']);
  });

  it('repeats preamble and header in every part and loses no row', () => {
    const text = statement(400);
    const parts = chunkText(text, 4_000);
    assert.ok(parts.length > 3);
    for (const p of parts) {
      assert.ok(p.length <= 4_000, `part of ${p.length} chars`);
      assert.ok(p.startsWith('Intesa Sanpaolo - Estratto conto\nConto: 1000/123456'));
      assert.ok(p.includes('Data contabile;Data valuta;Descrizione;Dare;Avere'));
    }
    const rows = parts.flatMap((p) => p.split('\n').filter((l) => l.includes('OPERAZIONE')));
    assert.equal(rows.length, 400);
    assert.equal(new Set(rows).size, 400);
  });

  it('chunks spreadsheets sheet by sheet, keeping the sheet label', () => {
    const sheet = (name: string, n: number) => `### Sheet: ${name}\nFecha,Concepto,Importe\n${Array.from({ length: n }, (_, i) => `01/10/2026,Mercadona compra ${i},-${i}.50`).join('\n')}`;
    const parts = chunkDocument(`${sheet('Octubre', 300)}\n\n${sheet('Noviembre', 3)}`, 3_000);
    assert.ok(parts.every((p) => p.startsWith('### Sheet: ')));
    assert.ok(parts.filter((p) => p.startsWith('### Sheet: Octubre')).every((p) => p.includes('Fecha,Concepto,Importe')));
    assert.equal(parts.filter((p) => p.startsWith('### Sheet: Noviembre')).length, 1);
  });
});
