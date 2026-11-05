import { httpResource } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Icon } from '../../ui/icon';
import type { ImportError, ImportRecord } from '@spendlens/contracts';
import { API, Api, apiErrorMessage, DataRevision } from '../../core/api';
import { I18n } from '../../core/i18n/i18n';
import { ImportStream } from '../../core/import-stream';
import { Auth } from '../../core/auth';
import { AppState } from '../../core/period';
import { Toasts } from '../../core/toasts';

const ACCEPT = '.csv,.tsv,.txt,.xlsx,.xls,.ods,.numbers,.pdf,.ofx,.qfx,.qif,.xml,.json,.html,.md,.eml,image/jpeg,image/png,image/webp,image/gif';
const MAX_FILE_BYTES = 20 * 1024 * 1024;

@Component({
  selector: 'app-import-page',
  imports: [Icon, RouterLink],
  templateUrl: './import-page.html',
})
export class ImportPage {
  protected readonly i18n = inject(I18n);
  protected readonly state = inject(AppState);
  protected readonly auth = inject(Auth);
  protected readonly stream = inject(ImportStream);
  private readonly api = inject(Api);
  private readonly toasts = inject(Toasts);
  private readonly revision = inject(DataRevision);
  protected readonly t = this.i18n.t;
  protected readonly accept = ACCEPT;
  protected readonly Math = Math;

  protected readonly files = signal<readonly File[]>([]);
  protected readonly text = signal('');
  protected readonly force = signal(false);
  protected readonly dragging = signal(false);
  protected readonly confirmUndo = signal<string | null>(null);
  protected readonly openWarnings = signal<string | null>(null);

  protected readonly history = httpResource<ImportRecord[]>(() => ({ url: `${API}/imports`, params: { rev: this.revision.value() } }));
  protected readonly canStart = computed(() => !this.stream.running() && (this.files().length > 0 || this.text().trim() !== '') && this.state.aiReady());
  protected readonly progress = computed(() => {
    const files = this.stream.files();
    if (files.length === 0) return 0;
    const total = files.reduce((sum, f) => {
      if (f.status !== 'running') return sum + 1;
      const stage = f.stage === 'saving' ? 0.9 : f.stage === 'extracting' ? 0.15 + (f.chunks ? (f.chunk / f.chunks) * 0.7 : 0) : 0.05;
      return sum + stage;
    }, 0);
    return total / files.length;
  });

  protected add(list: FileList | null | undefined): void {
    if (!list) return;
    const incoming = [...list].filter((f) => {
      if (f.size > MAX_FILE_BYTES && !f.type.startsWith('image/')) {
        this.toasts.error(`${f.name}: ${this.t().import.errors['file_too_large']}`);
        return false;
      }
      return true;
    });
    this.files.update((current) => [...current, ...incoming.filter((f) => !current.some((c) => c.name === f.name && c.size === f.size))]);
  }

  protected onPick(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.add(input.files);
    input.value = '';
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    this.add(event.dataTransfer?.files);
  }

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(true);
  }

  protected remove(file: File): void {
    this.files.update((list) => list.filter((f) => f !== file));
  }

  protected async start(): Promise<void> {
    const files = this.files();
    const text = this.text();
    this.files.set([]);
    this.text.set('');
    await this.stream.start(files, text, this.force());
    const outcome = this.stream.outcome();
    if (outcome && outcome.imported > 0) this.toasts.success(this.t().import.done(outcome.imported, outcome.duplicates, outcome.failed));
  }

  protected async undo(record: ImportRecord): Promise<void> {
    try {
      await this.api.deleteImport(record.id);
      this.confirmUndo.set(null);
    } catch (err) {
      this.toasts.error(apiErrorMessage(err));
    }
  }

  protected errorText(error: ImportError | null): string {
    if (!error) return '';
    return this.t().import.errors[error.code] ?? error.message;
  }

  /** Server errors are stored as "code: message". */
  protected recordError(record: ImportRecord): string {
    const code = record.error?.split(':')[0] ?? '';
    return this.t().import.errors[code] ?? record.error ?? '';
  }

  protected fileIcon(name: string, type: string): string {
    if (type.startsWith('image/')) return 'image';
    if (/\.(xlsx?|ods|numbers|csv|tsv)$/i.test(name)) return 'file-spreadsheet';
    if (/\.pdf$/i.test(name)) return 'receipt';
    return 'file-text';
  }

  protected size(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
}
