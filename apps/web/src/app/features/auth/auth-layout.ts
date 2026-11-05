import { Component, computed, inject } from '@angular/core';
import { getCategory } from '@spendlens/contracts';
import { I18n } from '../../core/i18n/i18n';
import { slotVar } from '../../core/palette';
import { Icon } from '../../ui/icon';
import { Logo } from '../../ui/logo';
import { Preferences } from '../../ui/preferences';

/** A month of the demo, as shares of the spending: the idea of the app in one bar. */
const PREVIEW: readonly { id: string; share: number }[] = [
  { id: 'housing', share: 39 },
  { id: 'food', share: 25 },
  { id: 'utilities', share: 7 },
  { id: 'leisure', share: 6 },
  { id: 'shopping', share: 6 },
  { id: 'transport', share: 5 },
  { id: 'other', share: 12 },
];

/** The page around the login and sign-up forms: the product on the left (wide screens), the form on the right. */
@Component({
  selector: 'app-auth-layout',
  imports: [Icon, Logo, Preferences],
  host: { class: 'grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]' },
  templateUrl: './auth-layout.html',
})
export class AuthLayout {
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;

  protected readonly preview = computed(() => {
    this.i18n.lang();
    return PREVIEW.map((p) => ({ ...p, label: this.i18n.category(p.id), color: slotVar(getCategory(p.id)?.slot ?? null) }));
  });
  protected readonly previewLabel = computed(() => this.preview().map((p) => `${p.label} ${p.share}%`).join(', '));
}
