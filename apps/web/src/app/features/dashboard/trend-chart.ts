import { Component, computed, inject, input, signal } from '@angular/core';
import { getCategory, type MonthKey, type Trend } from '@spendlens/contracts';
import type { EChartsCoreOption } from 'echarts/core';
import { I18n } from '../../core/i18n/i18n';
import { AppState } from '../../core/period';
import { Theme } from '../../core/theme';
import { Chart } from '../../ui/chart';

interface Series {
  readonly id: string;
  readonly name: string;
  readonly slot: number;
  readonly values: readonly number[];
}

interface AxisParam {
  readonly axisValueLabel: string;
  readonly seriesName: string;
  readonly value: number;
  readonly color: string;
}

/**
 * 12 months of spending stacked by category, income as a line on the same € axis (one axis, one
 * unit). Categories with a colour slot keep it; the rest fold into "Other" so no hue is ever
 * generated or reused.
 */
@Component({
  selector: 'app-trend-chart',
  imports: [Chart],
  host: { class: 'card flex flex-col p-5' },
  templateUrl: './trend-chart.html',
})
export class TrendChart {
  protected readonly i18n = inject(I18n);
  private readonly theme = inject(Theme);
  private readonly state = inject(AppState);
  protected readonly t = this.i18n.t;
  readonly trend = input.required<Trend>();
  readonly month = input.required<MonthKey>();
  protected readonly view = signal<'chart' | 'table'>('chart');

  protected readonly series = computed<Series[]>(() => {
    const lang = this.i18n.lang();
    const tr = this.trend();
    const slotted: Series[] = [];
    const other = tr.months.map(() => 0);
    for (const c of tr.categories) {
      const cat = getCategory(c.id);
      if (cat?.slot) slotted.push({ id: c.id, name: cat.label[lang], slot: cat.slot, values: c.values });
      else c.values.forEach((v, i) => (other[i]! += v));
    }
    slotted.sort((a, b) => a.slot - b.slot);
    return other.some((v) => v > 0) ? [...slotted, { id: 'other', name: this.t().common.other, slot: 0, values: other }] : slotted;
  });

  protected readonly ariaLabel = computed(() => {
    const tr = this.trend();
    const months = tr.months.map((m, i) => `${this.i18n.month(m, 'long')} ${this.money(tr.expense[i]!)}`);
    return `${this.t().dashboard.trend} — ${this.t().dashboard.expenses}: ${months.join(', ')}`;
  });

  protected money(minor: number): string {
    return this.i18n.money(minor, this.state.baseCurrency(), { whole: true });
  }

  protected readonly options = computed<EChartsCoreOption>(() => {
    const p = this.theme.palette();
    const tr = this.trend();
    const series = this.series();
    const currency = this.state.baseCurrency();
    const labels = tr.months.map((m) => this.i18n.month(m, 'short'));
    const current = tr.months.indexOf(this.month());
    const compact = (v: number) => this.i18n.money(v, currency, { compact: true });

    return {
      aria: { enabled: false },
      animationDuration: 400,
      grid: { left: 4, right: 8, top: 44, bottom: 4, containLabel: true },
      legend: {
        top: 0,
        left: 0,
        icon: 'roundRect',
        itemWidth: 10,
        itemHeight: 10,
        itemGap: 12,
        textStyle: { color: p.ink2, fontSize: 11, fontFamily: 'inherit' },
        inactiveColor: p.grid,
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'line', lineStyle: { color: p.baseline, width: 1 } },
        backgroundColor: p.surface,
        borderColor: p.grid,
        textStyle: { color: p.ink, fontFamily: 'inherit', fontSize: 12 },
        formatter: (params: AxisParam[]) => {
          const rows = params
            .filter((x) => x.value > 0)
            .reverse()
            .map(
              (x) =>
                `<div style="display:flex;gap:10px;align-items:center;justify-content:space-between"><span style="display:flex;gap:6px;align-items:center;color:${p.ink2}"><span style="width:10px;height:2px;background:${x.color};display:inline-block"></span>${x.seriesName}</span><b>${this.money(x.value)}</b></div>`,
            )
            .join('');
          const i = labels.indexOf(params[0]?.axisValueLabel ?? '');
          const head = i >= 0 ? `${this.i18n.month(tr.months[i]!, 'long')} · ${this.money(tr.expense[i]!)}` : '';
          return `<div style="font-weight:600;margin-bottom:6px;text-transform:capitalize">${head}</div>${rows}`;
        },
      },
      xAxis: {
        type: 'category',
        data: labels,
        axisLine: { lineStyle: { color: p.baseline } },
        axisTick: { show: false },
        axisLabel: {
          interval: 0,
          color: p.muted,
          fontSize: 11,
          fontFamily: 'inherit',
          formatter: (v: string, i: number) => (i === current ? `{b|${v}}` : v),
          rich: { b: { color: p.ink, fontWeight: 700, fontSize: 11 } },
        },
      },
      yAxis: {
        type: 'value',
        splitNumber: 4,
        axisLabel: { color: p.muted, fontSize: 11, fontFamily: 'inherit', formatter: compact },
        splitLine: { lineStyle: { color: p.grid, width: 1 } },
      },
      series: [
        ...series.map((s, idx) => ({
          type: 'bar',
          name: s.name,
          stack: 'spend',
          barMaxWidth: 24,
          data: s.values.map((v, i) => ({ value: v, itemStyle: { opacity: current < 0 || i === current ? 1 : 0.55 } })),
          itemStyle: {
            color: p.series[s.slot],
            borderColor: p.surface,
            borderWidth: 1,
            borderRadius: idx === series.length - 1 ? [4, 4, 0, 0] : 0,
          },
          emphasis: { focus: 'series' },
        })),
        {
          type: 'line',
          name: this.t().dashboard.income,
          data: tr.income,
          symbol: 'circle',
          symbolSize: 8,
          lineStyle: { color: p.ink, width: 2 },
          itemStyle: { color: p.ink, borderColor: p.surface, borderWidth: 2 },
          z: 10,
        },
      ],
    };
  });

  protected onPick(event: unknown): void {
    const index = (event as { dataIndex?: number }).dataIndex;
    const month = index === undefined ? undefined : this.trend().months[index];
    if (month) this.state.month.set(month);
  }
}
