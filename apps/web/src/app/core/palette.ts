// Chart colours for each theme. Charts render to SVG through ECharts and need concrete values, so
// the palette lives here; styles.css carries the same steps as CSS variables for the HTML marks.
// Keep both in sync. Steps come from the validated reference palette (CVD-safe adjacent order).

export interface Palette {
  readonly surface: string;
  readonly surface2: string;
  readonly ink: string;
  readonly ink2: string;
  readonly muted: string;
  readonly grid: string;
  readonly baseline: string;
  /** Categorical slots 1-8; index 0 is the neutral "other". */
  readonly series: readonly string[];
  /** Sequential ramp, near-zero first. */
  readonly seq: readonly string[];
  /** Text colour inside each series fill, same index as `series`. */
  readonly onSeries: readonly string[];
}

export const PALETTES: Record<'light' | 'dark', Palette> = {
  light: {
    surface: '#fcfcfb',
    surface2: '#f3f2ee',
    ink: '#0b0b0b',
    ink2: '#52514e',
    muted: '#6f6e69',
    grid: '#e1e0d9',
    baseline: '#c3c2b7',
    series: ['#a9a8a1', '#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'],
    seq: ['#f0efec', '#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95'],
    onSeries: ['#0b0b0b', '#ffffff', '#ffffff', '#ffffff', '#0b0b0b', '#ffffff', '#ffffff', '#ffffff', '#ffffff'],
  },
  dark: {
    surface: '#1a1a19',
    surface2: '#232321',
    ink: '#f0efec',
    ink2: '#c3c2b7',
    muted: '#9a9993',
    grid: '#2c2c2a',
    baseline: '#383835',
    series: ['#5c5b57', '#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
    seq: ['#262624', '#104281', '#184f95', '#256abf', '#3987e5', '#6da7ec', '#9ec5f4'],
    onSeries: ['#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff'],
  },
};

/** CSS variable of a categorical slot, for HTML marks (dots, bars, swatches). */
export const slotVar = (slot: number | null): string => (slot ? `var(--series-${slot})` : 'var(--series-other)');
