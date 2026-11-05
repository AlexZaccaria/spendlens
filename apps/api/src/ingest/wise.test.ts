import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { chunkText, findHeaderRow } from './chunk.ts';
import { decodeInput } from './decode.ts';
import { buildUserPrompt, EXTRACTION_SYSTEM_PROMPT } from './prompt.ts';

const SAMPLE = resolve(import.meta.dirname, '../../../../samples/en-wise-statement-2026-10.csv');

describe('Wise statements', () => {
  it('states the Wise rules in the cached system prompt', () => {
    assert.match(EXTRACTION_SYSTEM_PROMPT, /Wise \(wise\.com\) statements/);
    assert.match(EXTRACTION_SYSTEM_PROMPT, /both are transfer\.internal/);
    assert.match(EXTRACTION_SYSTEM_PROMPT, /already includes any "Total fees": never add a separate fee row/);
  });

  it('keeps the Wise header in every part of a long export', async () => {
    const bytes = new Uint8Array(readFileSync(SAMPLE));
    const decoded = await decodeInput({ filename: 'en-wise-statement-2026-10.csv', mime: 'text/csv', bytes });
    assert.equal(decoded.kind, 'text');
    const text = decoded.kind === 'text' ? decoded.text : '';
    const lines = text.split('\n');
    assert.equal(findHeaderRow(lines), 0);
    // Repeat the rows to force several parts, then check every part starts with the header.
    const long = [lines[0], ...Array.from({ length: 40 }, () => lines.slice(1).filter(Boolean)).flat()].join('\n');
    const parts = chunkText(long, 4_000);
    assert.ok(parts.length > 1);
    for (const part of parts) assert.ok(part.startsWith('"TransferWise ID"'));

    const prompt = buildUserPrompt({
      today: '2026-11-05',
      baseCurrency: 'EUR',
      filename: 'en-wise-statement-2026-10.csv',
      format: 'csv',
      part: 1,
      parts: parts.length,
      rules: [],
      documentText: parts[0]!,
    });
    assert.match(prompt, /part 1 of \d+/);
    assert.match(prompt, /BALANCE-2210559031/);
  });
});
