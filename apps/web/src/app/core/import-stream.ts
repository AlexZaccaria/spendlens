import { computed, inject, Service, signal } from '@angular/core';
import type { ImportError, ImportEvent, ImportRecord, ImportStage } from '@spendlens/contracts';
import { API, DataRevision } from './api';

export interface FileProgress {
  readonly index: number;
  readonly filename: string;
  readonly status: 'running' | 'done' | 'error';
  readonly stage: ImportStage | null;
  readonly chunk: number;
  readonly chunks: number;
  readonly record: ImportRecord | null;
  readonly error: ImportError | null;
}

export interface ImportOutcome {
  readonly imported: number;
  readonly duplicates: number;
  readonly failed: number;
}

const MAX_IMAGE_EDGE = 2400;
const DOWNSCALE_ABOVE_BYTES = 1_500_000;

/** Phone photos are often 4-12 MB: shrink them in the browser before upload (no server deps). */
async function prepareImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.size < DOWNSCALE_ABOVE_BYTES || file.type === 'image/gif') return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file; // undecodable here (e.g. HEIC): the server reports a clear error
  }
}

/** Splits a text/event-stream into `{event, data}` frames. */
function* parseFrames(buffer: string): Generator<{ event: string; data: string }> {
  for (const block of buffer.split(/\r?\n\r?\n/)) {
    let event = 'message';
    const data: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
    if (data.length) yield { event, data: data.join('\n') };
  }
}

/**
 * Runs an import: uploads files and pasted text in one multipart request and follows the
 * server-sent progress events. A root service, so an import keeps running while the user
 * browses the dashboard.
 */
@Service()
export class ImportStream {
  private readonly revision = inject(DataRevision);
  private controller: AbortController | null = null;

  readonly running = signal(false);
  readonly files = signal<readonly FileProgress[]>([]);
  readonly outcome = signal<ImportOutcome | null>(null);
  readonly error = signal<ImportError | null>(null);
  readonly importIds = computed(() => this.files().flatMap((f) => (f.record ? [f.record.id] : [])));

  async start(files: readonly File[], text: string, force: boolean): Promise<void> {
    await this.run(async () => {
      const body = new FormData();
      for (const f of await Promise.all(files.map(prepareImage))) body.append('files', f, f.name);
      if (text.trim()) body.append('text', text.trim());
      if (force) body.append('force', 'true');
      return { url: `${API}/imports`, body };
    });
  }

  /** Re-runs a stored import with the current model (it replaces the previous attempt). */
  async retry(importId: string): Promise<void> {
    await this.run(async () => ({ url: `${API}/imports/${importId}/retry`, body: null }));
  }

  private async run(request: () => Promise<{ url: string; body: FormData | null }>): Promise<void> {
    if (this.running()) return;
    this.running.set(true);
    this.files.set([]);
    this.outcome.set(null);
    this.error.set(null);
    this.controller = new AbortController();
    try {
      const { url, body } = await request();
      const res = await fetch(url, { method: 'POST', body, signal: this.controller.signal });
      if (!res.ok || !res.body) {
        const err = (await res.json().catch(() => null)) as { error?: ImportError } | null;
        this.error.set(err?.error ?? { code: 'unknown', message: res.statusText });
        return;
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const cut = buffer.lastIndexOf('\n\n');
        if (cut < 0) continue;
        for (const frame of parseFrames(buffer.slice(0, cut))) this.apply(JSON.parse(frame.data) as ImportEvent);
        buffer = buffer.slice(cut + 2);
      }
      for (const frame of parseFrames(buffer)) this.apply(JSON.parse(frame.data) as ImportEvent);
      if (!this.outcome()) this.error.set({ code: 'network', message: 'Stream ended early' });
    } catch (err) {
      if ((err as Error).name !== 'AbortError') this.error.set({ code: 'network', message: String(err) });
    } finally {
      this.running.set(false);
      this.controller = null;
      this.revision.bump();
    }
  }

  cancel(): void {
    this.controller?.abort();
  }

  reset(): void {
    if (this.running()) return;
    this.files.set([]);
    this.outcome.set(null);
    this.error.set(null);
  }

  private patch(index: number, change: Partial<FileProgress>): void {
    this.files.update((list) => list.map((f) => (f.index === index ? { ...f, ...change } : f)));
  }

  private apply(event: ImportEvent): void {
    switch (event.type) {
      case 'file-start':
        this.files.update((list) => [
          ...list.filter((f) => f.index !== event.file),
          { index: event.file, filename: event.filename, status: 'running', stage: 'reading', chunk: 0, chunks: 0, record: null, error: null },
        ]);
        break;
      case 'stage':
        this.patch(event.file, { stage: event.stage, chunk: event.chunk, chunks: event.chunks });
        break;
      case 'file-done':
        this.patch(event.file, { status: 'done', stage: null, record: event.record });
        this.revision.bump();
        break;
      case 'file-error': {
        const known = this.files().some((f) => f.index === event.file);
        if (!known) {
          this.files.update((list) => [
            ...list,
            { index: event.file, filename: event.filename, status: 'error', stage: null, chunk: 0, chunks: 0, record: null, error: event.error },
          ]);
        } else {
          this.patch(event.file, { status: 'error', stage: null, error: event.error });
        }
        break;
      }
      case 'done':
        this.outcome.set({ imported: event.imported, duplicates: event.duplicates, failed: event.failed });
        break;
    }
  }
}
