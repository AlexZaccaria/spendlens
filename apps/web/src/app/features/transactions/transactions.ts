import { httpResource } from '@angular/common/http';
import { Component, computed, effect, inject, input, linkedSignal, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Icon } from '../../ui/icon';
import {
  fromMinor,
  monthKeyOf,
  monthRange,
  shiftMonth,
  todayIso,
  TRANSACTION_KINDS,
  type Transaction,
  type TransactionKind,
  type TransactionPage,
} from '@spendlens/contracts';
import { chargedAmount } from '../../core/amounts';
import { API, Api, apiErrorMessage, DataRevision } from '../../core/api';
import { I18n } from '../../core/i18n/i18n';
import { AppState } from '../../core/period';
import { Toasts } from '../../core/toasts';
import { CategoryIcon } from '../../ui/category-icon';
import { CategoryOptions } from '../../ui/category-options';
import { TransactionEditor } from './transaction-editor';

const PAGE = 100;

type QueryValue = string | number | boolean | null | undefined;

/** Filters live in the URL (shareable, back-button friendly); the list reloads when they change. */
@Component({
  selector: 'app-transactions',
  imports: [Icon, RouterLink, CategoryIcon, CategoryOptions, TransactionEditor],
  templateUrl: './transactions.html',
})
export class Transactions {
  protected readonly i18n = inject(I18n);
  protected readonly state = inject(AppState);
  private readonly api = inject(Api);
  private readonly toasts = inject(Toasts);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly revision = inject(DataRevision);
  protected readonly t = this.i18n.t;
  protected readonly kinds = TRANSACTION_KINDS;

  // Query parameters, bound by the router (withComponentInputBinding).
  readonly q = input<string>();
  readonly category = input<string>();
  readonly from = input<string>();
  readonly to = input<string>();
  readonly kind = input<string>();
  readonly review = input<string>();
  readonly importId = input<string>();

  protected readonly limit = signal(PAGE);
  protected readonly search = linkedSignal(() => this.q() ?? '');
  protected readonly selected = signal<ReadonlySet<string>>(new Set());
  protected readonly editing = signal<Transaction | null | 'new' | undefined>(undefined);
  protected readonly kindValue = computed<TransactionKind>(() => ((TRANSACTION_KINDS as readonly string[]).includes(this.kind() ?? '') ? (this.kind() as TransactionKind) : 'all'));
  protected readonly reviewOnly = computed(() => this.review() === 'true');

  private readonly list = httpResource<TransactionPage>(() => ({
    url: `${API}/transactions`,
    params: clean({
      q: this.q(),
      category: this.category(),
      from: this.from(),
      to: this.to(),
      kind: this.kindValue(),
      review: this.reviewOnly() ? 'true' : undefined,
      importId: this.importId(),
      limit: this.limit(),
      rev: this.revision.value(),
    }),
  }));
  protected readonly page = linkedSignal<TransactionPage | undefined, TransactionPage | undefined>({
    source: () => this.list.value(),
    computation: (value, previous) => value ?? previous?.value,
  });
  protected readonly loading = this.list.isLoading;
  protected readonly rows = computed(() => this.page()?.items ?? []);
  protected readonly hasMore = computed(() => (this.page()?.total ?? 0) > this.rows().length);
  protected readonly allSelected = computed(() => this.rows().length > 0 && this.rows().every((r) => this.selected().has(r.id)));
  protected readonly hasFilters = computed(() => !!(this.q() || this.category() || this.from() || this.to() || this.reviewOnly() || this.importId() || this.kindValue() !== 'all'));

  /** The period selector: a whole month, everything, or a custom range set by a link. */
  protected readonly periodValue = computed(() => {
    const from = this.from();
    const to = this.to();
    if (!from && !to) return 'all';
    if (from && to) {
      const range = monthRange(monthKeyOf(from));
      if (range.from === from && range.to === to) return monthKeyOf(from);
    }
    return 'custom';
  });
  protected readonly months = computed(() => {
    const last = this.state.latestDataMonth();
    const first = this.state.earliestDataMonth() ?? last;
    const out: string[] = [];
    for (let m = last; m >= first && out.length < 60; m = shiftMonth(m, -1)) out.push(m);
    return out;
  });

  constructor() {
    // Debounced search: the URL (and the request) follow the input 300 ms after typing stops.
    effect((onCleanup) => {
      const text = this.search().trim();
      if (text === (this.q() ?? '')) return;
      const timer = setTimeout(() => this.setParams({ q: text || null }), 300);
      onCleanup(() => clearTimeout(timer));
    });
  }

  protected setParams(params: Record<string, QueryValue>): void {
    this.limit.set(PAGE);
    this.selected.set(new Set());
    void this.router.navigate([], { relativeTo: this.route, queryParams: params, queryParamsHandling: 'merge', replaceUrl: true });
  }

  protected setPeriod(value: string): void {
    if (value === 'all') this.setParams({ from: null, to: null });
    else if (value !== 'custom') this.setParams({ ...monthRange(value) });
  }

  protected clearFilters(): void {
    this.search.set('');
    void this.router.navigate([], { relativeTo: this.route, queryParams: {}, replaceUrl: true });
  }

  protected toggle(id: string): void {
    this.selected.update((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  protected clearSelection(): void {
    this.selected.set(new Set());
  }

  protected toggleAll(): void {
    this.selected.set(this.allSelected() ? new Set() : new Set(this.rows().map((r) => r.id)));
  }

  protected async bulk(change: { categoryId?: string; needsReview?: boolean }): Promise<void> {
    const ids = [...this.selected()];
    if (ids.length === 0) return;
    try {
      await this.api.bulkUpdate({ ids, ...change });
      this.selected.set(new Set());
    } catch (err) {
      this.toasts.error(apiErrorMessage(err));
    }
  }

  protected bulkCategory(event: Event): void {
    const select = event.target as HTMLSelectElement;
    if (select.value) void this.bulk({ categoryId: select.value });
    select.value = '';
  }

  /** Receipt lines shown to the user (the reconciling adjustment line is not a purchase). */
  protected itemCount(tx: Transaction): number {
    return tx.items.filter((i) => !i.adjustment).length;
  }

  /** The list's total as charged, when every row in it was in one foreign currency. */
  protected charged(page: TransactionPage): string | null {
    return chargedAmount(this.i18n, page.sumCharged, this.state.baseCurrency());
  }

  /** The amount in the base currency (what the totals use) and the original when it differs. */
  protected amounts(tx: Transaction): { main: string; original: string | null } {
    const base = this.state.baseCurrency();
    if (tx.currency === base) return { main: this.i18n.money(tx.amountMinor, base), original: null };
    const original = this.i18n.money(tx.amountMinor, tx.currency);
    return tx.baseAmountMinor === null
      ? { main: original, original: this.t().transactions.noRate }
      : { main: this.i18n.money(tx.baseAmountMinor, base), original };
  }

  protected exportCsv(): void {
    const lang = this.i18n.lang();
    const header = ['date', 'title', 'merchant', 'category', 'amount', 'currency', 'amount_base', 'original_text', 'note'];
    const quote = (v: string) => `"${v.replaceAll('"', '""')}"`;
    const lines = this.rows().map((tx) =>
      [
        tx.date,
        quote(tx.title[lang]),
        quote(tx.merchant ?? ''),
        quote(this.i18n.category(tx.categoryId)),
        String(fromMinor(tx.amountMinor, tx.currency)),
        tx.currency,
        tx.baseAmountMinor === null ? '' : String(fromMinor(tx.baseAmountMinor, this.state.baseCurrency())),
        quote(tx.rawDescription),
        quote(tx.note?.[lang] ?? ''),
      ].join(','),
    );
    const blob = new Blob(['﻿' + [header.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: `spendlens-${todayIso()}.csv` });
    a.click();
    URL.revokeObjectURL(url);
  }
}

function clean(params: Record<string, QueryValue>): Record<string, string | number | boolean> {
  return Object.fromEntries(Object.entries(params).filter((e): e is [string, string | number | boolean] => e[1] !== undefined && e[1] !== null && e[1] !== ''));
}
