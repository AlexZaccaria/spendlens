import { Component, inject, signal } from '@angular/core';
import { apiErrorCode, apiErrorMessage } from '../../core/api';
import { Auth } from '../../core/auth';
import { I18n } from '../../core/i18n/i18n';
import { Toasts } from '../../core/toasts';
import { Icon } from '../../ui/icon';

/** One click to a private copy of the demo: no form, no account. */
@Component({
  selector: 'app-demo-cta',
  imports: [Icon],
  host: { class: 'flex flex-col gap-2' },
  template: `
    <button type="button" class="btn-primary h-11 w-full text-[0.95rem]" [disabled]="busy()" (click)="start()">
      <svg [lucideIcon]="busy() ? 'loader-circle' : 'sparkles'" size="17" [class.animate-spin]="busy()"></svg>
      {{ busy() ? t().auth.startingDemo : t().auth.demo }}
      @if (!busy()) {
        <svg lucideIcon="arrow-right" size="16" class="ml-auto"></svg>
      }
    </button>
    <p class="text-center text-xs leading-relaxed text-muted">{{ t().auth.demoHint }}</p>
  `,
})
export class DemoCta {
  private readonly auth = inject(Auth);
  private readonly toasts = inject(Toasts);
  protected readonly t = inject(I18n).t;
  protected readonly busy = signal(false);

  protected async start(): Promise<void> {
    this.busy.set(true);
    try {
      await this.auth.startDemo();
    } catch (err) {
      const code = apiErrorCode(err);
      this.toasts.error(
        code === 'too_many_attempts' ? this.t().auth.tooManyAttempts : code === 'storage_unavailable' ? this.t().auth.storageUnavailable : apiErrorMessage(err),
      );
      this.busy.set(false);
    }
  }
}
