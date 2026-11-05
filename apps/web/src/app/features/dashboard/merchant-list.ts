import { Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { getCategory, type Summary } from '@spendlens/contracts';
import { chargedAmount } from '../../core/amounts';
import { I18n } from '../../core/i18n/i18n';
import { slotVar } from '../../core/palette';
import { CategoryIcon } from '../../ui/category-icon';

@Component({
  selector: 'app-merchant-list',
  imports: [CategoryIcon, RouterLink],
  host: { class: 'card flex flex-col p-5' },
  templateUrl: './merchant-list.html',
})
export class MerchantList {
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;
  readonly summary = input.required<Summary>();

  protected readonly rows = computed(() => {
    const merchants = this.summary().merchants;
    const max = merchants[0]?.totalMinor || 1;
    return merchants.map((m) => ({ ...m, width: (m.totalMinor / max) * 100, color: slotVar(getCategory(m.categoryId)?.slot ?? null) }));
  });

  /** The total as charged, when all of it was in one foreign currency. */
  protected charged(row: Summary['merchants'][number]): string | null {
    return chargedAmount(this.i18n, row.charged, this.summary().baseCurrency, { whole: true });
  }
}
