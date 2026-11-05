import { Component, computed, input } from '@angular/core';

export interface SparkPoint {
  readonly label: string;
  readonly value: number;
}

/** 12-point trend: history in the de-emphasis tone, the current period as the accent dot. */
@Component({
  selector: 'app-sparkline',
  host: { class: 'block' },
  template: `
    <svg [attr.viewBox]="'0 0 ' + width + ' ' + height" class="h-full w-full overflow-visible" preserveAspectRatio="none" role="img" [attr.aria-label]="ariaLabel()">
      <path [attr.d]="area()" fill="var(--ink)" fill-opacity="0.06" />
      <path [attr.d]="line()" fill="none" stroke="var(--muted)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" />
      @if (last(); as p) {
        <circle [attr.cx]="p.x" [attr.cy]="p.y" r="4" fill="var(--ink)" stroke="var(--surface)" stroke-width="2" vector-effect="non-scaling-stroke" />
      }
      @for (p of points(); track $index) {
        <circle [attr.cx]="p.x" [attr.cy]="p.y" r="9" fill="transparent">
          <title>{{ p.label }}</title>
        </circle>
      }
    </svg>
  `,
})
export class Sparkline {
  readonly data = input.required<readonly SparkPoint[]>();
  readonly ariaLabel = input('');
  protected readonly width = 240;
  protected readonly height = 56;

  protected readonly points = computed(() => {
    const data = this.data();
    const max = Math.max(1, ...data.map((d) => d.value));
    const step = data.length > 1 ? this.width / (data.length - 1) : 0;
    return data.map((d, i) => ({ x: i * step, y: this.height - 4 - (d.value / max) * (this.height - 8), label: d.label }));
  });
  protected readonly line = computed(() => this.points().map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '));
  protected readonly area = computed(() => {
    const pts = this.points();
    return pts.length ? `${this.line()} L${pts.at(-1)!.x},${this.height} L0,${this.height} Z` : '';
  });
  protected readonly last = computed(() => this.points().at(-1));
}
