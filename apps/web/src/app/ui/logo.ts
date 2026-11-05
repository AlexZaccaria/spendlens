import { Component, inject } from '@angular/core';
import { I18n } from '../core/i18n/i18n';

@Component({
  selector: 'app-logo',
  host: { class: 'flex items-center gap-2.5' },
  template: `
    <svg viewBox="0 0 32 32" class="size-8 shrink-0" aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="var(--ink)" />
      <circle cx="14" cy="14" r="7.5" fill="none" stroke="var(--page)" stroke-width="2.5" />
      <path d="M14 6.5 A7.5 7.5 0 0 1 21.5 14 L14 14 Z" fill="var(--series-2)" />
      <path d="M19.5 19.5 L25 25" stroke="var(--page)" stroke-width="2.5" stroke-linecap="round" />
    </svg>
    <span class="leading-tight">
      <span class="block text-[0.95rem] font-semibold tracking-tight">{{ i18n.t().app.name }}</span>
      <span class="hidden text-[0.7rem] text-muted sm:block">{{ i18n.t().app.tagline }}</span>
    </span>
  `,
})
export class Logo {
  protected readonly i18n = inject(I18n);
}
