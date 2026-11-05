import { Component, input, output } from '@angular/core';
import type { EChartsCoreOption } from 'echarts/core';
import { NgxEchartsDirective } from 'ngx-echarts';

/** An ECharts surface: SVG renderer, auto-resize, an accessible name; the table view lives next to it. */
@Component({
  selector: 'app-chart',
  imports: [NgxEchartsDirective],
  host: { class: 'block' },
  template: `
    <div
      echarts
      role="img"
      [attr.aria-label]="label()"
      [options]="options()"
      [autoResize]="true"
      [initOpts]="{ renderer: 'svg' }"
      (chartClick)="pick.emit($event)"
      class="h-full w-full"
    ></div>
  `,
})
export class Chart {
  readonly options = input.required<EChartsCoreOption>();
  readonly label = input.required<string>();
  readonly pick = output<unknown>();
}
