import { httpResource } from '@angular/common/http';
import { computed, inject, linkedSignal, Service } from '@angular/core';
import { currentMonthKey, monthKeyOf, monthRange, now, shiftMonth, type AiHealth, type Meta, type MonthKey } from '@spendlens/contracts';
import { API, DataRevision } from './api';

/**
 * App-wide facts (`/api/meta`) and the month the dashboard looks at. The month starts at the
 * latest month that has data — a freshly imported statement of last month opens on last month —
 * and then follows the user's navigation.
 */
@Service()
export class AppState {
  private readonly revision = inject(DataRevision);

  readonly meta = httpResource<Meta>(() => ({ url: `${API}/meta`, params: { rev: this.revision.value() } }));

  readonly today = currentMonthKey();
  readonly latestDataMonth = computed<MonthKey>(() => {
    const to = this.meta.value()?.dataRange?.to;
    return to ? monthKeyOf(to) : this.today;
  });
  readonly earliestDataMonth = computed<MonthKey | null>(() => {
    const from = this.meta.value()?.dataRange?.from;
    return from ? monthKeyOf(from) : null;
  });

  /** In the first week of a month the previous one is the interesting one: open on it. */
  readonly month = linkedSignal<MonthKey>(() => {
    const latest = this.latestDataMonth();
    const early = latest === this.today && now().getDate() <= 7 && this.earliestDataMonth() !== latest;
    return early ? shiftMonth(latest, -1) : latest;
  });
  readonly range = computed(() => monthRange(this.month()));
  readonly baseCurrency = computed(() => this.meta.value()?.baseCurrency ?? 'EUR');
  readonly hasData = computed(() => (this.meta.value()?.txCount ?? 0) > 0);
  readonly aiReady = computed(() => this.meta.value()?.ai.ready ?? false);
  /** Whether the provider actually answers with the saved settings (the server caches the check). */
  readonly aiHealth = httpResource<AiHealth>(() => ({ url: `${API}/ai/health`, params: { rev: this.revision.value() } }));

  readonly canGoNext = computed(() => this.month() < (this.latestDataMonth() > this.today ? this.latestDataMonth() : this.today));
  readonly canGoPrevious = computed(() => {
    const first = this.earliestDataMonth();
    return first === null || this.month() > first;
  });

  shift(delta: number): void {
    this.month.update((m) => shiftMonth(m, delta));
  }
}
