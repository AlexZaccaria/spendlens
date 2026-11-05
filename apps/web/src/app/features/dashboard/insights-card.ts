import { Component, inject, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Icon } from '../../ui/icon';
import type { Insight } from '@spendlens/contracts';
import { I18n } from '../../core/i18n/i18n';

/** The model's reading of the month, stored in both languages: switching language is instant. */
@Component({
  selector: 'app-insights-card',
  imports: [Icon, RouterLink],
  host: { class: 'card relative flex flex-col overflow-hidden p-5' },
  templateUrl: './insights-card.html',
})
export class InsightsCard {
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;
  readonly insight = input<Insight | null | undefined>(null);
  readonly aiReady = input(false);
  /** The demo has no AI: no generate button, no link to the settings. */
  readonly demo = input(false);
  readonly generating = input(false);
  readonly hasSpending = input(true);
  readonly generate = output<void>();
}
