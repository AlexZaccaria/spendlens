import { Component, computed, input, isDevMode, numberAttribute } from '@angular/core';
import { ICONS } from '../core/icons';

/**
 * A Lucide icon drawn from its node data: `<svg lucideIcon="house" size="16"></svg>`.
 * Decorative by default (aria-hidden); the surrounding control carries the accessible name.
 */
@Component({
  selector: 'svg[lucideIcon]',
  host: {
    xmlns: 'http://www.w3.org/2000/svg',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
    focusable: 'false',
    class: 'shrink-0',
    '[attr.width]': 'size()',
    '[attr.height]': 'size()',
    '[attr.stroke-width]': 'strokeWidth()',
  },
  templateUrl: './icon.html',
})
export class Icon {
  readonly lucideIcon = input.required<string>();
  readonly size = input(24, { transform: numberAttribute });
  readonly strokeWidth = input(2, { transform: numberAttribute });

  protected readonly node = computed(() => {
    const node = ICONS[this.lucideIcon()];
    if (!node && isDevMode()) console.warn(`Unknown icon "${this.lucideIcon()}" — add it to core/icons.ts`);
    return (node ?? []) as readonly (readonly [string, Record<string, string | number | undefined>])[];
  });
}
