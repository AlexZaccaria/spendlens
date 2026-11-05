import { httpResource } from '@angular/common/http';
import { Component, computed, inject, input, signal } from '@angular/core';
import type { RecurringItem } from '@spendlens/contracts';
import { API } from '../../core/api';
import { I18n } from '../../core/i18n/i18n';
import { AppState } from '../../core/period';
import { CategoryIcon } from '../../ui/category-icon';
import { Icon } from '../../ui/icon';
import { RecurringEditor } from './recurring-editor';

const VISIBLE = 6;

/**
 * Rent, bills and subscriptions — the month's fixed floor: found by cadence analysis, or declared
 * by the user. A row opens the editor: edit a declared charge, settle a detected one.
 */
@Component({
  selector: 'app-recurring-list',
  imports: [CategoryIcon, Icon, RecurringEditor],
  host: { class: 'card flex flex-col p-5' },
  templateUrl: './recurring-list.html',
})
export class RecurringList {
  protected readonly i18n = inject(I18n);
  private readonly state = inject(AppState);
  protected readonly t = this.i18n.t;
  readonly items = input.required<readonly RecurringItem[]>();
  protected readonly visible = VISIBLE;
  protected readonly expanded = signal(false);
  /** undefined: closed; null: a new declaration; an item: that item. */
  protected readonly editing = signal<RecurringItem | null | undefined>(undefined);
  /** Suggestions for the form, fetched when it opens. */
  protected readonly merchants = httpResource<string[]>(() => (this.editing() !== undefined ? `${API}/recurring/merchants` : undefined));

  protected readonly shown = computed(() => (this.expanded() ? this.items() : this.items().slice(0, VISIBLE)));
  protected readonly monthly = computed(() => this.items().filter((i) => i.active).reduce((sum, i) => sum + i.monthlyMinor, 0));

  protected money(minor: number, whole = true): string {
    return this.i18n.money(minor, this.state.baseCurrency(), { whole });
  }
}
