import { Component, inject, input } from '@angular/core';
import type { Transaction } from '@spendlens/contracts';
import { originalAmount } from '../../core/amounts';
import { I18n } from '../../core/i18n/i18n';
import { AppState } from '../../core/period';
import { CategoryIcon } from '../../ui/category-icon';

@Component({
  selector: 'app-largest-list',
  imports: [CategoryIcon],
  host: { class: 'card flex flex-col p-5' },
  templateUrl: './largest-list.html',
})
export class LargestList {
  protected readonly i18n = inject(I18n);
  protected readonly state = inject(AppState);
  protected readonly t = this.i18n.t;
  readonly items = input.required<readonly Transaction[]>();

  protected original(tx: Transaction): string | null {
    return originalAmount(this.i18n, tx, null, this.state.baseCurrency());
  }
}
