import { Component, input } from '@angular/core';
import type { Lang } from '@spendlens/contracts';

let nextId = 0;

/**
 * A language as a flag: Italy for Italian, the United Kingdom for English. Drawn as SVG because
 * Windows has no flag emoji. Decorative: the control around it carries the language name.
 */
@Component({
  selector: 'app-flag',
  host: {
    class: 'inline-flex shrink-0 overflow-hidden rounded-[3px] ring-1 ring-black/15 dark:ring-white/20',
    'aria-hidden': 'true',
  },
  template: `
    @switch (lang()) {
      @case ('it') {
        <svg viewBox="0 0 3 2" width="18" height="12">
          <rect width="1" height="2" fill="#009246" />
          <rect x="1" width="1" height="2" fill="#ffffff" />
          <rect x="2" width="1" height="2" fill="#ce2b37" />
        </svg>
      }
      @case ('en') {
        <svg viewBox="0 0 60 30" width="18" height="12" preserveAspectRatio="xMidYMid slice">
          <clipPath [attr.id]="clipId"><path d="M30,15h30v15zv15h-30zh-30v-15zv-15h30z" /></clipPath>
          <rect width="60" height="30" fill="#012169" />
          <path d="M0,0L60,30M60,0L0,30" stroke="#ffffff" stroke-width="6" />
          <path d="M0,0L60,30M60,0L0,30" stroke="#c8102e" stroke-width="4" [attr.clip-path]="'url(#' + clipId + ')'" />
          <path d="M30,0v30M0,15h60" stroke="#ffffff" stroke-width="10" />
          <path d="M30,0v30M0,15h60" stroke="#c8102e" stroke-width="6" />
        </svg>
      }
    }
  `,
})
export class Flag {
  readonly lang = input.required<Lang>();
  /** The counterchanged red diagonals need a clip path; its id must be unique in the page. */
  protected readonly clipId = `flag-clip-${nextId++}`;
}
