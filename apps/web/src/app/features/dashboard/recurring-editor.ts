import { afterNextRender, Component, computed, ElementRef, inject, input, linkedSignal, output, signal, viewChild } from '@angular/core';
import { form, FormField, required, submit, validate } from '@angular/forms/signals';
import { currencyExponent, ECB_CURRENCIES, RECURRING_CADENCES, todayIso, type RecurringInput, type RecurringItem } from '@spendlens/contracts';
import { Api, apiErrorMessage } from '../../core/api';
import { I18n } from '../../core/i18n/i18n';
import { AppState } from '../../core/period';
import { Toasts } from '../../core/toasts';
import { CategoryIcon } from '../../ui/category-icon';
import { CategoryOptions } from '../../ui/category-options';
import { Icon } from '../../ui/icon';

interface FixedModel {
  merchant: string;
  amount: number;
  currency: string;
  categoryId: string;
  cadenceDays: string;
  nextDate: string;
}

/**
 * Adds a fixed cost, edits a declared one, or settles a detected one: saved as the user's own
 * declaration, or ruled out as "not a fixed cost".
 */
@Component({
  selector: 'app-recurring-editor',
  imports: [CategoryIcon, CategoryOptions, FormField, Icon],
  templateUrl: './recurring-editor.html',
})
export class RecurringEditor {
  protected readonly i18n = inject(I18n);
  private readonly api = inject(Api);
  protected readonly state = inject(AppState);
  private readonly toasts = inject(Toasts);
  protected readonly t = this.i18n.t;
  protected readonly cadences = RECURRING_CADENCES;
  protected readonly currencies = ECB_CURRENCIES;

  /** null = a new declaration. */
  readonly item = input<RecurringItem | null>(null);
  /** Merchants already in the transactions, suggested while typing. */
  readonly merchants = input<readonly string[]>([]);
  readonly closed = output<void>();

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  protected readonly busy = signal(false);
  protected readonly confirmDelete = signal(false);
  protected readonly detected = computed(() => this.item()?.source === 'detected');
  protected readonly declared = computed(() => this.item()?.source === 'manual');

  protected readonly model = linkedSignal<FixedModel>(() => {
    const item = this.item();
    const base = this.state.baseCurrency();
    if (!item) return { merchant: '', amount: 0, currency: base, categoryId: '', cadenceDays: '30', nextDate: todayIso() };
    // A charge billed in another currency is edited as billed.
    const [minor, currency] = item.original ? [item.original.amountMinor, item.original.currency] : [item.averageMinor, base];
    return {
      merchant: item.merchant,
      amount: minor / 10 ** currencyExponent(currency),
      currency,
      categoryId: item.categoryId,
      cadenceDays: String(item.cadenceDays),
      nextDate: item.nextDate,
    };
  });
  protected readonly fixed = form(this.model, (p) => {
    required(p.merchant, { message: this.t().dashboard.fixed.required });
    required(p.categoryId, { message: this.t().dashboard.fixed.required });
    required(p.nextDate, { message: this.t().dashboard.fixed.required });
    validate(p.amount, ({ value }) => (value() > 0 && Number.isFinite(value()) ? null : { kind: 'positive', message: this.t().dashboard.fixed.positive }));
  });

  constructor() {
    afterNextRender(() => this.dialog().nativeElement.showModal());
  }

  protected title(): string {
    const f = this.t().dashboard.fixed;
    return this.detected() ? f.detectedTitle : this.declared() ? f.editTitle : f.newTitle;
  }

  protected setCategory(event: Event): void {
    const categoryId = (event.target as HTMLSelectElement).value;
    this.model.update((m) => ({ ...m, categoryId }));
  }

  protected async save(event: Event): Promise<void> {
    event.preventDefault();
    await submit(this.fixed, async () => {
      const m = this.model();
      await this.run(async () => {
        await this.api.saveRecurring(
          {
            merchant: m.merchant.trim(),
            amount: m.amount,
            currency: m.currency,
            categoryId: m.categoryId,
            cadenceDays: Number(m.cadenceDays) as RecurringInput['cadenceDays'],
            nextDate: m.nextDate,
          },
          this.declared() ? this.item()!.id : undefined,
        );
        this.toasts.success(this.t().dashboard.fixed.saved);
      });
    });
  }

  /** "Not a fixed cost", undoable from the toast. */
  protected async notFixed(): Promise<void> {
    const merchant = this.item()!.merchant;
    await this.run(async () => {
      await this.api.ignoreRecurring(merchant);
      this.toasts.success(this.t().dashboard.fixed.excluded(merchant), {
        label: this.t().common.cancel,
        run: () => void this.restore(merchant),
      });
    });
  }

  protected async remove(): Promise<void> {
    await this.run(() => this.api.deleteRecurring(this.item()!.id));
  }

  close(): void {
    this.dialog().nativeElement.close();
  }

  protected onClose(): void {
    this.closed.emit();
  }

  private async restore(merchant: string): Promise<void> {
    try {
      const rule = (await this.api.ignoredRecurring()).find((r) => r.merchant === merchant);
      if (rule) await this.api.deleteRecurring(rule.id);
    } catch (err) {
      this.toasts.error(apiErrorMessage(err));
    }
  }

  /** One request at a time; the dialog closes when it succeeds and stays open on an error. */
  private async run(work: () => Promise<unknown>): Promise<void> {
    this.busy.set(true);
    try {
      await work();
      this.close();
    } catch (err) {
      this.toasts.error(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
