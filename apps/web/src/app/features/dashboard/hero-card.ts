import { Component, computed, inject, input } from '@angular/core';
import { monthKeyOf, todayIso, type Summary } from '@spendlens/contracts';
import { chargedAmount } from '../../core/amounts';
import { I18n } from '../../core/i18n/i18n';
import { Delta } from '../../ui/delta';
import { Sparkline } from '../../ui/sparkline';

/** The one number the dashboard leads with: what this month cost, and how that compares. */
@Component({
  selector: 'app-hero-card',
  imports: [Delta, Sparkline],
  host: { class: 'card flex flex-col p-6' },
  template: `
    <h2 class="card-title first-letter:uppercase">{{ t().dashboard.spentIn(i18n.month(month(), 'long')) }}</h2>
    <p class="mt-2 text-5xl font-semibold tracking-tight sm:text-6xl">{{ i18n.money(s().totals.expenseMinor, s().baseCurrency, { whole: true }) }}</p>
    @if (charged(); as c) {
      <p class="num mt-1 text-sm text-ink-2">{{ c }}</p>
    }
    <div class="mt-3 flex flex-col gap-1">
      <app-delta [current]="s().totals.expenseMinor" [reference]="s().previous.expenseMinor || null" [label]="previousLabel()" />
      @if (!inProgress()) {
        <app-delta [current]="s().totals.expenseMinor" [reference]="s().averageExpenseMinor" [label]="t().dashboard.vsAverage" />
      }
    </div>
    <app-sparkline class="mt-auto h-14 pt-5" [data]="spark()" [ariaLabel]="sparkLabel()" />
    <div class="mt-1.5 flex justify-between text-[0.7rem] text-muted capitalize">
      <span>{{ i18n.month(s().monthly[0]!.month, 'compact') }}</span>
      <span>{{ i18n.month(month(), 'compact') }}</span>
    </div>
    @if (s().totals.unconvertedCount > 0) {
      <p class="mt-3 text-xs text-muted">{{ t().dashboard.unconverted(s().totals.unconvertedCount) }}</p>
    }
  `,
})
export class HeroCard {
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;
  readonly summary = input.required<Summary>();
  protected readonly s = this.summary;

  protected readonly month = computed(() => monthKeyOf(this.s().range.from));
  protected readonly charged = computed(() => chargedAmount(this.i18n, this.s().totals.charged.expense, this.s().baseCurrency, { whole: true }));
  /** The month in progress is compared with the same days of the previous month. */
  protected readonly inProgress = computed(() => {
    const today = todayIso();
    return today >= this.s().range.from && today < this.s().range.to;
  });
  protected readonly previousLabel = computed(() => {
    const prev = this.s().previous.range;
    const what = this.inProgress() ? `${Number(prev.from.slice(8))}–${this.i18n.date(prev.to, 'short')}` : this.i18n.month(monthKeyOf(prev.from), 'name');
    return this.t().dashboard.vsPrevious(what);
  });
  protected readonly spark = computed(() =>
    this.s().monthly.map((m) => ({
      value: m.expenseMinor,
      label: `${this.i18n.month(m.month, 'long')}: ${this.i18n.money(m.expenseMinor, this.s().baseCurrency, { whole: true })}`,
    })),
  );
  protected readonly sparkLabel = computed(() => this.spark().map((p) => p.label).join('; '));
}
