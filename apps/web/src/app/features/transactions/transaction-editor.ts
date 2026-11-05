import { afterNextRender, Component, computed, ElementRef, inject, input, linkedSignal, output, signal, viewChild } from '@angular/core';
import { form, FormField, required, submit, validate } from '@angular/forms/signals';
import { Icon } from '../../ui/icon';
import {
  currencyExponent,
  daysInMonth,
  ECB_CURRENCIES,
  getCategory,
  monthKeyOf,
  shiftMonth,
  todayIso,
  toMinor,
  type Transaction,
  type TransactionItem,
  type TransactionPatch,
} from '@spendlens/contracts';
import { Api, apiErrorMessage } from '../../core/api';
import { I18n } from '../../core/i18n/i18n';
import { AppState } from '../../core/period';
import { Toasts } from '../../core/toasts';
import { CategoryIcon } from '../../ui/category-icon';
import { CategoryOptions } from '../../ui/category-options';

interface EditorModel {
  title: string;
  merchant: string;
  categoryId: string;
  date: string;
  /** Always positive: `direction` gives the sign. */
  amount: number;
  direction: Direction;
  currency: string;
  note: string;
  needsReview: boolean;
  applyToMerchant: boolean;
  /** Also declare it among the fixed costs, monthly from this payment. */
  fixed: boolean;
}

type Direction = 'out' | 'in';

/** The same day of the next month (31 Jan → 28 Feb). */
function nextMonth(date: string): string {
  const month = shiftMonth(monthKeyOf(date), 1);
  return `${month}-${String(Math.min(Number(date.slice(8, 10)), daysInMonth(month))).padStart(2, '0')}`;
}


/** Edit (or create) one transaction in a modal <dialog>, with a Signal Form. */
@Component({
  selector: 'app-transaction-editor',
  imports: [FormField, Icon, CategoryOptions, CategoryIcon],
  templateUrl: './transaction-editor.html',
})
export class TransactionEditor {
  protected readonly i18n = inject(I18n);
  private readonly api = inject(Api);
  private readonly toasts = inject(Toasts);
  protected readonly state = inject(AppState);
  protected readonly t = this.i18n.t;
  protected readonly currencies = ECB_CURRENCIES;
  protected readonly directions: readonly Direction[] = ['out', 'in'];

  /** null = create a new transaction. */
  readonly transaction = input<Transaction | null>(null);
  readonly closed = output<void>();

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  protected readonly confirmDelete = signal(false);
  protected readonly busy = signal(false);
  protected readonly isNew = computed(() => this.transaction() === null);
  protected readonly langName = computed(() => this.t().lang[this.i18n.lang()]);

  private readonly initial = computed<EditorModel>(() => {
    const tx = this.transaction();
    if (!tx) {
      return {
        title: '',
        merchant: '',
        categoryId: 'food.groceries',
        date: todayIso(),
        amount: 0,
        direction: 'out',
        currency: this.state.baseCurrency(),
        note: '',
        needsReview: false,
        applyToMerchant: false,
        fixed: false,
      };
    }
    return {
      title: this.i18n.text(tx.title),
      merchant: tx.merchant ?? '',
      categoryId: tx.categoryId,
      date: tx.date,
      amount: Math.abs(tx.amountMinor) / 10 ** currencyExponent(tx.currency),
      direction: tx.amountMinor < 0 ? 'out' : 'in',
      currency: tx.currency,
      note: this.i18n.text(tx.note),
      needsReview: tx.needsReview,
      applyToMerchant: false,
      fixed: false,
    };
  });

  protected readonly model = linkedSignal<EditorModel>(() => this.initial());
  protected readonly editor = form(this.model, (p) => {
    required(p.title, { message: this.t().editor.required });
    required(p.date, { message: this.t().editor.required });
    required(p.categoryId, { message: this.t().editor.required });
    validate(p.amount, ({ value }) => (!(value() > 0) || !Number.isFinite(value()) ? { kind: 'positive', message: this.t().editor.positive } : null));
  });

  protected readonly merchantName = computed(() => this.model().merchant.trim() || this.transaction()?.merchant || '');
  protected readonly categoryChanged = computed(() => this.model().categoryId !== this.initial().categoryId);
  /** Money going out under a spending subcategory, not already among the fixed costs. */
  protected readonly canBeFixed = computed(() => {
    const category = getCategory(this.model().categoryId);
    return this.model().direction === 'out' && category?.kind === 'expense' && category.parentId !== null && !this.transaction()?.recurring;
  });

  constructor() {
    afterNextRender(() => this.dialog().nativeElement.showModal());
  }

  /** Item categories as edited here (saved immediately, one request per change). */
  private readonly itemCategories = signal<ReadonlyMap<string, string>>(new Map());

  protected itemCategory(item: TransactionItem): string {
    return this.itemCategories().get(item.id) ?? item.categoryId;
  }

  protected async setItemCategory(item: TransactionItem, event: Event): Promise<void> {
    const tx = this.transaction();
    const categoryId = (event.target as HTMLSelectElement).value;
    if (!tx || !categoryId) return;
    this.itemCategories.update((m) => new Map(m).set(item.id, categoryId));
    try {
      await this.api.updateItem(tx.id, item.id, categoryId);
      this.toasts.success(this.t().editor.itemSaved);
    } catch (err) {
      this.toasts.error(apiErrorMessage(err));
    }
  }

  /** Moving to a spending or an income category turns the direction with it (a refund stays one). */
  protected setCategory(event: Event): void {
    const categoryId = (event.target as HTMLSelectElement).value;
    const before = getCategory(this.model().categoryId)?.kind;
    const kind = getCategory(categoryId)?.kind;
    this.editor.categoryId().value.set(categoryId);
    if (kind !== before && (kind === 'expense' || kind === 'income')) this.setDirection(kind === 'expense' ? 'out' : 'in');
  }

  protected setDirection(direction: Direction): void {
    this.model.update((m) => ({ ...m, direction }));
  }

  protected close(): void {
    this.dialog().nativeElement.close();
  }

  protected onClose(): void {
    this.closed.emit();
  }

  protected async save(event: Event): Promise<void> {
    event.preventDefault();
    await submit(this.editor, async () => {
      this.busy.set(true);
      try {
        const m = this.model();
        const tx = this.transaction();
        const fixed = m.fixed && this.canBeFixed();
        // A fixed cost is tied to its payments by merchant: without one, the title names it.
        const merchant = m.merchant.trim() || (fixed ? m.title.trim() : '');
        if (!tx) {
          await this.api.createTransaction({
            date: m.date,
            title: m.title.trim(),
            merchant: merchant || null,
            amount: signed(m),
            currency: m.currency,
            categoryId: m.categoryId,
            note: m.note.trim() || null,
          });
        } else {
          await this.api.updateTransaction(tx.id, this.patchFor(tx, { ...m, merchant }));
        }
        if (fixed) {
          await this.api.saveRecurring({ merchant, amount: m.amount, currency: m.currency, categoryId: m.categoryId, cadenceDays: 30, nextDate: nextMonth(m.date) });
        }
        this.toasts.success(fixed ? this.t().editor.savedFixed : this.t().editor.saved);
        this.close();
      } catch (err) {
        this.toasts.error(apiErrorMessage(err));
      } finally {
        this.busy.set(false);
      }
      return undefined;
    });
  }

  /** Only what changed; the title is edited in the current UI language. */
  private patchFor(tx: Transaction, m: EditorModel): TransactionPatch {
    const before = this.initial();
    const patch: TransactionPatch = {};
    if (m.title.trim() !== before.title) patch.title = { lang: this.i18n.lang(), text: m.title.trim() };
    if (m.merchant.trim() !== before.merchant) patch.merchant = m.merchant.trim() || null;
    if (m.categoryId !== before.categoryId) {
      patch.categoryId = m.categoryId;
      patch.applyToMerchant = m.applyToMerchant;
    }
    if (m.date !== before.date) patch.date = m.date;
    if (signed(m) !== signed(before)) patch.amountMinor = toMinor(signed(m), tx.currency);
    if (m.note.trim() !== before.note) patch.note = m.note.trim() || null;
    if (m.needsReview !== before.needsReview) patch.needsReview = m.needsReview;
    return patch;
  }

  protected async remove(): Promise<void> {
    const tx = this.transaction();
    if (!tx) return;
    this.busy.set(true);
    try {
      await this.api.deleteTransaction(tx.id);
      this.toasts.success(this.t().editor.deleted);
      this.close();
    } catch (err) {
      this.toasts.error(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}

const signed = (m: EditorModel): number => (m.direction === 'out' ? -m.amount : m.amount);
