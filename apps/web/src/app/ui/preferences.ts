import { Component, inject } from '@angular/core';
import { LANGS, type Lang } from '@spendlens/contracts';
import { I18n } from '../core/i18n/i18n';
import { Theme, type ThemeMode } from '../core/theme';
import { Flag } from './flag';
import { Icon } from './icon';

const SEGMENT =
  'flex min-w-9 flex-1 cursor-pointer items-center justify-center rounded-md px-1.5 text-muted transition-colors hover:text-ink ' +
  'aria-checked:bg-surface aria-checked:text-ink aria-checked:shadow-sm dark:aria-checked:bg-surface-3';

/**
 * Theme and language: two segmented controls on a filled track, the chosen segment is the raised
 * thumb. The host is `display: contents`, so the two controls sit in the parent's grid or flex row:
 * stretched in the sidebar, compact in the mobile header and on the login page.
 */
@Component({
  selector: 'app-preferences',
  imports: [Flag, Icon],
  host: { class: 'contents' },
  templateUrl: './preferences.html',
})
export class Preferences {
  protected readonly i18n = inject(I18n);
  protected readonly theme = inject(Theme);
  protected readonly t = this.i18n.t;
  protected readonly segment = SEGMENT;
  protected readonly langs: readonly Lang[] = LANGS;
  protected readonly themes: readonly { value: ThemeMode; icon: string }[] = [
    { value: 'light', icon: 'sun' },
    { value: 'dark', icon: 'moon' },
  ];
}
