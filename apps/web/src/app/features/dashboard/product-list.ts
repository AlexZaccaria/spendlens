import { Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { getCategory, rootOf, type Summary } from '@spendlens/contracts';
import { chargedAmount } from '../../core/amounts';
import { I18n } from '../../core/i18n/i18n';
import { slotVar } from '../../core/palette';
import { CategoryIcon } from '../../ui/category-icon';
import { Delta } from '../../ui/delta';
import { Icon } from '../../ui/icon';

/**
 * What the money buys, at a glance: receipt products added up across every receipt and shop of the
 * month — ten 1,000 € packs of nappies on ten receipts are one 10,000 € row at the top.
 */
@Component({
  selector: 'app-product-list',
  imports: [CategoryIcon, Delta, Icon, RouterLink],
  host: { class: 'card flex flex-col p-5' },
  templateUrl: './product-list.html',
})
export class ProductList {
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;
  readonly summary = input.required<Summary>();

  protected readonly rows = computed(() => {
    const lang = this.i18n.lang();
    const products = this.summary().products;
    const max = products[0]?.totalMinor || 1;
    return products.map((p) => ({
      ...p,
      key: p.title.it.toLowerCase(),
      label: p.title[lang],
      width: (p.totalMinor / max) * 100,
      color: slotVar(getCategory(p.categoryId) ? rootOf(p.categoryId).slot : null),
    }));
  });

  /** The total as charged, when all of it was in one foreign currency. */
  protected charged(row: Summary['products'][number]): string | null {
    return chargedAmount(this.i18n, row.charged, this.summary().baseCurrency, { whole: row.charged !== null && Math.abs(row.charged.amountMinor) >= 10000 });
  }
}
