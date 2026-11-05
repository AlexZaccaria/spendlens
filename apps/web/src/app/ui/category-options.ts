import { Component, computed, inject, input } from '@angular/core';
import { CATEGORIES, type CategoryKind } from '@spendlens/contracts';
import { I18n } from '../core/i18n/i18n';
import { slotVar } from '../core/palette';

/**
 * Turns a native <select> into the category picker: options grouped by root category, each with
 * its colour dot. Native semantics and keyboard support; styled through `appearance: base-select`
 * where supported. `selectedValue` marks the chosen option as the options render, which a
 * `[value]` binding on the select cannot do (it runs before the options exist).
 */
@Component({
  selector: 'select[appCategoryOptions]',
  host: { class: 'select' },
  template: `
    @if (placeholder()) {
      <option value="" [selected]="!selectedValue()">{{ placeholder() }}</option>
    }
    @for (group of groups(); track group.id) {
      <optgroup [label]="group.label">
        @if (allowRoots()) {
          <option [value]="group.id" [selected]="group.id === selectedValue()">
            <span class="size-2.5 shrink-0 rounded-full" [style.background]="group.color"></span>
            {{ group.label }} · {{ i18n.t().common.all.toLowerCase() }}
          </option>
        }
        @for (leaf of group.leaves; track leaf.id) {
          <option [value]="leaf.id" [selected]="leaf.id === selectedValue()">
            <span class="size-2.5 shrink-0 rounded-full" [style.background]="group.color"></span>
            {{ leaf.label }}
          </option>
        }
      </optgroup>
    }
  `,
})
export class CategoryOptions {
  protected readonly i18n = inject(I18n);
  readonly selectedValue = input<string | null | undefined>(null);
  readonly placeholder = input<string>('');
  /** Filters may pick a whole root category; a transaction is always filed under a leaf. */
  readonly allowRoots = input(false);
  readonly kinds = input<readonly CategoryKind[]>(['expense', 'income', 'transfer']);

  protected readonly groups = computed(() => {
    const lang = this.i18n.lang();
    const kinds = this.kinds();
    return CATEGORIES.filter((c) => c.parentId === null && kinds.includes(c.kind)).map((root) => ({
      id: root.id,
      label: root.label[lang],
      color: slotVar(root.slot),
      leaves: CATEGORIES.filter((c) => c.parentId === root.id).map((c) => ({ id: c.id, label: c.label[lang] })),
    }));
  });
}
