import { Component, inject } from '@angular/core';
import { Icon } from './icon';
import { I18n } from '../core/i18n/i18n';
import { Toasts } from '../core/toasts';

@Component({
  selector: 'app-toast-host',
  imports: [Icon],
  template: `
    <div aria-live="polite" class="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 lg:bottom-6">
      @for (toast of toasts.items(); track toast.id) {
        <div
          class="pointer-events-auto flex max-w-md items-center gap-3 rounded-xl border border-line bg-ink py-2.5 pr-2 pl-3.5 text-sm text-page shadow-lg"
          [attr.role]="toast.tone === 'error' ? 'alert' : 'status'"
        >
          <svg
            [lucideIcon]="toast.tone === 'error' ? 'circle-x' : toast.tone === 'success' ? 'circle-check' : 'info'"
            size="16"
            [style.color]="toast.tone === 'error' ? 'var(--status-critical)' : toast.tone === 'success' ? 'var(--status-good)' : 'inherit'"
          ></svg>
          <span class="flex-1">{{ toast.message }}</span>
          @if (toast.action; as action) {
            <button type="button" class="cursor-pointer rounded-md px-2 py-1 font-medium underline-offset-2 hover:underline" (click)="action.run(); toasts.dismiss(toast.id)">
              {{ action.label }}
            </button>
          }
          <button type="button" class="inline-flex size-7 cursor-pointer items-center justify-center rounded-md opacity-70 hover:opacity-100" [attr.aria-label]="i18n.t().toast.dismiss" (click)="toasts.dismiss(toast.id)">
            <svg lucideIcon="x" size="14"></svg>
          </button>
        </div>
      }
    </div>
  `,
})
export class ToastHost {
  protected readonly toasts = inject(Toasts);
  protected readonly i18n = inject(I18n);
}
