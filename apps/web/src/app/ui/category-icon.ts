import { Component, computed, inject, input } from '@angular/core';
import { Icon } from './icon';
import { getCategory, rootOf } from '@spendlens/contracts';
import { I18n } from '../core/i18n/i18n';
import { slotVar } from '../core/palette';

/** The category's icon on its root's colour — the colour follows the category, never its rank. */
@Component({
  selector: 'app-category-icon',
  imports: [Icon],
  host: {
    class: 'inline-flex shrink-0 items-center justify-center rounded-lg',
    '[style.background]': 'color()',
    '[style.color]': 'onColor()',
    '[style.width.px]': 'size()',
    '[style.height.px]': 'size()',
    '[attr.title]': 'label()',
  },
  template: `<svg [lucideIcon]="icon()" [size]="size() * 0.55" strokeWidth="2"></svg>`,
})
export class CategoryIcon {
  private readonly i18n = inject(I18n);
  readonly categoryId = input.required<string>();
  readonly size = input(28);

  protected readonly category = computed(() => getCategory(this.categoryId()));
  protected readonly icon = computed(() => this.category()?.icon ?? 'circle-question-mark');
  protected readonly color = computed(() => slotVar(rootOf(this.categoryId()).slot));
  /** Yellow (slot 4) takes near-black in light mode; every other fill takes white. */
  protected readonly onColor = computed(() => (rootOf(this.categoryId()).slot === 4 ? 'var(--on-yellow, #0b0b0b)' : '#ffffff'));
  protected readonly label = computed(() => this.i18n.category(this.categoryId()));
}
