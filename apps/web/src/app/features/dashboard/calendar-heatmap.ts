import { Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { todayIso, type Summary } from '@spendlens/contracts';
import { I18n } from '../../core/i18n/i18n';
import { Theme } from '../../core/theme';

/** Day-by-day spending on the sequential blue ramp: one hue, darker = more. */
@Component({
  selector: 'app-calendar-heatmap',
  imports: [RouterLink],
  host: { class: 'card flex flex-col p-5' },
  templateUrl: './calendar-heatmap.html',
})
export class CalendarHeatmap {
  protected readonly i18n = inject(I18n);
  private readonly theme = inject(Theme);
  protected readonly t = this.i18n.t;
  readonly summary = input.required<Summary>();

  protected readonly weekdays = computed(() => {
    this.i18n.lang();
    return this.i18n.weekdayInitials();
  });
  protected readonly max = computed(() => Math.max(0, ...this.summary().daily.map((d) => d.expenseMinor)));

  /** Monday-first grid; empty leading cells align day 1 with its weekday. */
  protected readonly cells = computed(() => {
    const s = this.summary();
    const max = this.max() || 1;
    const first = new Date(`${s.range.from}T00:00:00Z`).getUTCDay();
    const lead = (first + 6) % 7;
    const today = todayIso();
    const days = s.daily.map((d) => {
      // Square-root scale: a single large payment (rent) shouldn't flatten every other day.
      const step = d.expenseMinor <= 0 ? 0 : Math.max(1, Math.min(6, Math.ceil(Math.sqrt(d.expenseMinor / max) * 6)));
      const amount = d.expenseMinor > 0 ? this.i18n.money(d.expenseMinor, s.baseCurrency) : this.t().dashboard.noSpending;
      return { date: d.date, day: Number(d.date.slice(8)), step, future: d.date > today, label: `${this.i18n.date(d.date, 'long')}: ${amount}` };
    });
    return [...Array.from({ length: lead }, () => null), ...days];
  });

  /** Light ramp: dark cells take white. Dark ramp runs the other way: bright cells take ink. */
  protected textColor(step: number): string {
    if (this.theme.resolved() === 'dark') return step >= 5 ? '#0b0b0b' : step >= 1 ? '#f0efec' : 'var(--ink-2)';
    return step >= 4 ? '#ffffff' : 'var(--ink-2)';
  }
}
