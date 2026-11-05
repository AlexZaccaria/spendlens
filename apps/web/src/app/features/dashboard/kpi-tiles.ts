import { Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Icon } from '../../ui/icon';
import type { Charged, Summary } from '@spendlens/contracts';
import { chargedAmount } from '../../core/amounts';
import { I18n } from '../../core/i18n/i18n';
import { Delta } from '../../ui/delta';

@Component({
  selector: 'app-kpi-tiles',
  imports: [Delta, RouterLink, Icon],
  host: { class: 'grid grid-cols-2 gap-4' },
  templateUrl: './kpi-tiles.html',
})
export class KpiTiles {
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;
  readonly summary = input.required<Summary>();
  protected readonly s = this.summary;

  protected readonly previousNet = computed(() => this.s().previous.incomeMinor - this.s().previous.expenseMinor);
  protected readonly rate = computed(() => {
    const { incomeMinor, netMinor } = this.s().totals;
    return incomeMinor > 0 ? netMinor / incomeMinor : null;
  });
  protected readonly clampedRate = computed(() => Math.min(1, Math.max(0, this.rate() ?? 0)));

  protected money(minor: number): string {
    return this.i18n.money(minor, this.s().baseCurrency, { whole: true });
  }

  /** A figure as charged, when all of it was in one foreign currency. */
  protected charged(charged: Charged | null): string | null {
    return chargedAmount(this.i18n, charged, this.s().baseCurrency, { whole: true });
  }
}
