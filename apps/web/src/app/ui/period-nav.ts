import { Component, inject } from '@angular/core';
import { Icon } from './icon';
import { I18n } from '../core/i18n/i18n';
import { AppState } from '../core/period';

/** Month switcher: previous / next and a native month picker behind the label. */
@Component({
  selector: 'app-period-nav',
  imports: [Icon],
  host: { class: 'inline-flex items-center gap-1 rounded-xl border border-line bg-surface p-1' },
  template: `
    <button type="button" class="icon-btn size-8" [attr.aria-label]="t().period.previous" [disabled]="!state.canGoPrevious()" (click)="state.shift(-1)">
      <svg lucideIcon="chevron-left" size="18"></svg>
    </button>
    <label class="relative flex h-8 min-w-36 cursor-pointer items-center justify-center gap-2 rounded-lg px-2 text-sm font-semibold capitalize hover:bg-surface-2">
      <svg lucideIcon="calendar" size="15" class="text-muted"></svg>
      {{ i18n.month(state.month()) }}
      <input
        type="month"
        class="absolute inset-0 cursor-pointer opacity-0"
        [attr.aria-label]="t().period.pick"
        [value]="state.month()"
        [max]="state.today"
        (change)="pick($event)"
        (click)="openPicker($event)"
      />
    </label>
    <button type="button" class="icon-btn size-8" [attr.aria-label]="t().period.next" [disabled]="!state.canGoNext()" (click)="state.shift(1)">
      <svg lucideIcon="chevron-right" size="18"></svg>
    </button>
  `,
})
export class PeriodNav {
  protected readonly i18n = inject(I18n);
  protected readonly state = inject(AppState);
  protected readonly t = this.i18n.t;

  protected pick(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    if (/^\d{4}-\d{2}$/.test(value)) this.state.month.set(value);
  }

  protected openPicker(event: Event): void {
    try {
      (event.target as HTMLInputElement).showPicker();
    } catch {
      // not supported: the native control still opens on interaction
    }
  }
}
