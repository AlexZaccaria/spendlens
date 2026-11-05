import { httpResource } from '@angular/common/http';
import { Component, computed, inject, linkedSignal, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Icon } from '../../ui/icon';
import type { Insight, RecurringItem, Summary, TransactionPage, Trend } from '@spendlens/contracts';
import { API, Api, apiErrorMessage, DataRevision } from '../../core/api';
import { I18n } from '../../core/i18n/i18n';
import { Auth } from '../../core/auth';
import { AppState } from '../../core/period';
import { Toasts } from '../../core/toasts';
import { PeriodNav } from '../../ui/period-nav';
import { CalendarHeatmap } from './calendar-heatmap';
import { HeroCard } from './hero-card';
import { InsightsCard } from './insights-card';
import { KpiTiles } from './kpi-tiles';
import { LargestList } from './largest-list';
import { MerchantList } from './merchant-list';
import { ProductList } from './product-list';
import { RecurringList } from './recurring-list';
import { SpendingExplorer } from './spending-explorer';
import { TrendChart } from './trend-chart';

/** Keeps the last loaded value while a new month loads, so the frame never flashes empty. */
function held<T>(source: () => T | undefined) {
  return linkedSignal<T | undefined, T | undefined>({ source, computation: (value, previous) => value ?? previous?.value });
}

@Component({
  selector: 'app-dashboard',
  imports: [
    RouterLink,
    Icon,
    PeriodNav,
    HeroCard,
    KpiTiles,
    SpendingExplorer,
    InsightsCard,
    TrendChart,
    RecurringList,
    MerchantList,
    ProductList,
    CalendarHeatmap,
    LargestList,
  ],
  templateUrl: './dashboard.html',
})
export class Dashboard {
  protected readonly i18n = inject(I18n);
  protected readonly state = inject(AppState);
  protected readonly auth = inject(Auth);
  private readonly api = inject(Api);
  private readonly toasts = inject(Toasts);
  private readonly revision = inject(DataRevision);
  protected readonly t = this.i18n.t;

  private readonly summaryRes = httpResource<Summary>(() => ({
    url: `${API}/summary`,
    params: { month: this.state.month(), rev: this.revision.value() },
  }));
  private readonly trendRes = httpResource<Trend>(() => ({
    url: `${API}/trend`,
    params: { month: this.state.month(), count: 12, rev: this.revision.value() },
  }));
  private readonly recurringRes = httpResource<RecurringItem[]>(() => ({ url: `${API}/recurring`, params: { rev: this.revision.value() } }));
  private readonly insightRes = httpResource<Insight | null>(() => ({ url: `${API}/insights/${this.state.month()}`, params: { rev: this.revision.value() } }));

  /** Every expense of the month: the drill-down tree goes down to the single transaction. */
  private readonly expensesRes = httpResource<TransactionPage>(() => ({
    url: `${API}/transactions`,
    params: { ...this.state.range(), kind: 'expense', sort: 'amount', limit: 5000, rev: this.revision.value() },
  }));

  protected readonly summary = held(() => this.summaryRes.value());
  protected readonly expenses = held(() => this.expensesRes.value()?.items);
  protected readonly trend = held(() => this.trendRes.value());
  protected readonly recurring = computed(() => this.recurringRes.value() ?? []);
  protected readonly insight = computed(() => (this.insightRes.hasValue() ? this.insightRes.value() : null));
  protected readonly loading = computed(() => this.summaryRes.isLoading() || this.trendRes.isLoading());
  protected readonly error = computed(() => this.summaryRes.error());
  protected readonly generating = signal(false);

  protected readonly firstLoad = computed(() => this.state.meta.value() === undefined);
  protected readonly empty = computed(() => this.state.meta.value() !== undefined && !this.state.hasData());
  protected readonly seeding = signal(false);

  protected readonly subtitle = computed(() => {
    const s = this.summary();
    if (!s) return '';
    return `${this.t().dashboard.transactionsCount(s.totals.txCount)} · ${this.i18n.date(s.range.from, 'short')} – ${this.i18n.date(s.range.to, 'medium')}`;
  });

  protected async generateInsight(): Promise<void> {
    this.generating.set(true);
    try {
      await this.api.generateInsight(this.state.month());
    } catch (err) {
      this.toasts.error(apiErrorMessage(err));
    } finally {
      this.generating.set(false);
    }
  }

  protected async loadDemo(): Promise<void> {
    this.seeding.set(true);
    try {
      const { inserted } = await this.api.seedDemo();
      this.toasts.success(this.t().settings.demoLoaded(inserted));
    } catch (err) {
      this.toasts.error(apiErrorMessage(err));
    } finally {
      this.seeding.set(false);
    }
  }

  protected retry(): void {
    this.summaryRes.reload();
    this.trendRes.reload();
  }
}
