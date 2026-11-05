import { DOCUMENT } from '@angular/common';
import { computed, DestroyRef, effect, inject, Service, signal } from '@angular/core';
import { PALETTES } from './palette';

export type ThemeMode = 'light' | 'dark';
const STORAGE_KEY = 'spendlens.theme';

/**
 * Light or dark. Until the user picks one, the OS setting decides and is followed live. Dark mode
 * is its own set of validated steps, not an inversion.
 */
@Service()
export class Theme {
  private readonly doc = inject(DOCUMENT);
  private readonly storage = this.doc.defaultView?.localStorage;
  private readonly media = this.doc.defaultView?.matchMedia('(prefers-color-scheme: dark)');
  private readonly systemDark = signal(this.media?.matches ?? false);
  private readonly choice = signal<ThemeMode | null>(readChoice(this.storage?.getItem(STORAGE_KEY)));

  readonly resolved = computed<ThemeMode>(() => this.choice() ?? (this.systemDark() ? 'dark' : 'light'));

  constructor() {
    const onChange = (e: MediaQueryListEvent) => this.systemDark.set(e.matches);
    this.media?.addEventListener('change', onChange);
    inject(DestroyRef).onDestroy(() => this.media?.removeEventListener('change', onChange));

    effect(() => {
      this.doc.documentElement.dataset['theme'] = this.resolved();
    });
  }

  set(mode: ThemeMode): void {
    this.choice.set(mode);
    this.storage?.setItem(STORAGE_KEY, mode);
  }

  /** Concrete colours of the active theme, for charts. */
  readonly palette = computed(() => PALETTES[this.resolved()]);
}

/** A stored "system" (earlier versions offered it) counts as no choice. */
function readChoice(stored: string | null | undefined): ThemeMode | null {
  return stored === 'light' || stored === 'dark' ? stored : null;
}
