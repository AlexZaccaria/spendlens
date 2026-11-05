import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { streamSSE } from 'hono/streaming';
import type { Context } from 'hono';
import { aiReadiness, getAiSettings } from '../ai/settings.ts';
import type { Db } from '../db/database.ts';
import { HttpError } from '../http/validate.ts';
import { runImport, type ImportInput } from '../ingest/pipeline.ts';
import { deleteImport, getImport, getImportContent, listImports } from '../repo/imports.ts';
import { refreshRecurringFlags } from '../repo/recurring.ts';
import { assertAiAllowed, type AccountEnv } from '../http/auth.ts';

/** Total request size: a handful of statements and photos. Single files are capped at 20 MB. */
const MAX_REQUEST_BYTES = 100 * 1024 * 1024;

function assertAiReady(db: Db): void {
  const missing = aiReadiness(getAiSettings(db));
  if (missing.length > 0) throw new HttpError(409, 'ai_not_configured', `AI provider not configured — missing: ${missing.join(', ')}.`);
}

/** Streams the import as Server-Sent Events: `event: <type>` + `data: <ImportEvent JSON>`. */
function streamImport(c: Context, db: Db, inputs: ImportInput[], force: boolean) {
  return streamSSE(c, async (stream) => {
    const abort = new AbortController();
    stream.onAbort(() => abort.abort());
    await runImport(db, inputs, (event) => stream.writeSSE({ event: event.type, data: JSON.stringify(event) }), { force, signal: abort.signal });
  });
}

export function importsRoutes() {
  return new Hono<AccountEnv>()
    .get('/', (c) => c.json(listImports(c.var.db)))

    .post(
      '/',
      bodyLimit({
        maxSize: MAX_REQUEST_BYTES,
        onError: (c) => c.json({ error: { code: 'file_too_large', message: 'The upload exceeds 100 MB.' } }, 413),
      }),
      async (c) => {
        assertAiAllowed(c);
        let form: FormData;
        try {
          form = await c.req.formData();
        } catch {
          throw new HttpError(400, 'invalid_request', 'Send multipart/form-data with "files" and/or "text".');
        }
        const inputs: ImportInput[] = [];
        for (const entry of form.getAll('files')) {
          if (typeof entry === 'string') continue;
          inputs.push({ filename: entry.name || 'upload', mime: entry.type, bytes: new Uint8Array(await entry.arrayBuffer()) });
        }
        const text = form.get('text');
        if (typeof text === 'string' && text.trim() !== '') {
          inputs.push({ filename: 'note.txt', mime: 'text/plain', bytes: new TextEncoder().encode(text.trim()) });
        }
        if (inputs.length === 0) throw new HttpError(400, 'invalid_request', 'Nothing to import: attach files or paste some text.');
        assertAiReady(c.var.db);
        return streamImport(c, c.var.db, inputs, form.get('force') === 'true');
      },
    )

    .delete('/:id', (c) => {
      if (!deleteImport(c.var.db, c.req.param('id'))) throw new HttpError(404, 'not_found', 'Import not found');
      refreshRecurringFlags(c.var.db);
      return c.body(null, 204);
    })

    .post('/:id/retry', (c) => {
      assertAiAllowed(c);
      const id = c.req.param('id');
      const record = getImport(c.var.db, id);
      const content = record ? getImportContent(c.var.db, id) : null;
      if (!record || !content) throw new HttpError(404, 'not_found', 'Import not found');
      assertAiReady(c.var.db);
      // The retry replaces the previous attempt (and whatever it imported).
      const input: ImportInput = { filename: record.filename, mime: record.mime, bytes: new Uint8Array(content) };
      deleteImport(c.var.db, id);
      return streamImport(c, c.var.db, [input], true);
    });
}
