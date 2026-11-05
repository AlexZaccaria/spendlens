import { Component, computed, inject } from '@angular/core';
import { todayIso } from '@spendlens/contracts';
import { API_IN_BROWSER } from '../../core/backend';
import { I18n } from '../../core/i18n/i18n';
import { slotVar } from '../../core/palette';
import { Icon } from '../../ui/icon';

/** Who made it and where the code lives — the one place to change them. */
export const PROJECT = {
  author: 'Alex Zaccaria',
  profileUrl: 'https://github.com/AlexZaccaria',
  repoUrl: 'https://github.com/AlexZaccaria/spendlens',
} as const;

/**
 * The story of the project, for whoever opens the demo — often someone looking at the author's
 * work. Only reachable from the demo account (see the route guard).
 */
@Component({
  selector: 'app-about-page',
  imports: [Icon],
  templateUrl: './about-page.html',
})
export class AboutPage {
  private readonly i18n = inject(I18n);
  protected readonly a = computed(() => this.i18n.t().about);
  protected readonly project = PROJECT;
  protected readonly colors = [1, 2, 3, 4, 5, 6, 7, 8].map((slot) => slotVar(slot));
  /** The static demo explains how it runs, and on which day its data was captured. */
  protected readonly inBrowser = API_IN_BROWSER;
  protected readonly snapshotDay = computed(() => this.i18n.date(todayIso()));
}
