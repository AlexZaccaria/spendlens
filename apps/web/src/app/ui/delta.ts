import { Component, computed, inject, input } from '@angular/core';
import { Icon } from './icon';
import { I18n } from '../core/i18n/i18n';

/**
 * Change against a reference, with direction × meaning: for spending, up is bad. Never colour
 * alone — the arrow and the signed figure carry it too.
 */
@Component({
  selector: 'app-delta',
  imports: [Icon],
  host: { class: 'inline-flex items-center gap-1 text-xs font-medium num' },
  template: `
    @if (visible()) {
      <span class="inline-flex items-center gap-0.5" [class.text-bad]="tone() === 'bad'" [class.text-good]="tone() === 'good'" [class.text-ink-2]="tone() === 'flat'">
        <svg [lucideIcon]="tone() === 'flat' ? 'minus' : up() ? 'arrow-up-right' : 'arrow-down-right'" size="14" strokeWidth="2.25"></svg>
        {{ figure() }}
      </span>
      @if (label()) {
        <span class="text-muted">{{ label() }}</span>
      }
    }
  `,
})
export class Delta {
  protected readonly i18n = inject(I18n);
  readonly current = input.required<number>();
  readonly reference = input.required<number | null>();
  readonly label = input<string>('');
  /** true when a higher value is good (income, savings). */
  readonly higherIsBetter = input(false);
  /** Show the difference in this currency instead of a percentage (for values that cross zero). */
  readonly currency = input<string | null>(null);

  private readonly diff = computed(() => this.current() - (this.reference() ?? 0));
  private readonly ratio = computed(() => {
    const ref = this.reference();
    return ref === null || ref === 0 ? null : this.diff() / Math.abs(ref);
  });

  protected readonly visible = computed(() => (this.currency() ? this.reference() !== null : this.ratio() !== null));
  protected readonly up = computed(() => this.diff() > 0);
  protected readonly tone = computed(() => {
    const flat = this.currency() ? Math.abs(this.diff()) < 100 : Math.abs(this.ratio() ?? 0) < 0.005;
    if (flat) return 'flat';
    return this.up() === this.higherIsBetter() ? 'good' : 'bad';
  });
  protected readonly figure = computed(() => {
    const currency = this.currency();
    return currency ? this.i18n.money(this.diff(), currency, { sign: true, whole: true }) : this.i18n.signedPercent(this.ratio() ?? 0);
  });
}
