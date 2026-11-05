/** mulberry32: a tiny seeded PRNG. Same seed, same sequence — the demo data is reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  private readonly next: () => number;

  constructor(seed: number) {
    this.next = mulberry32(seed);
  }

  float(): number {
    return this.next();
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Integer in [min, max]. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Amount in [min, max] rounded to `step` (cents by default). */
  amount(min: number, max: number, step = 0.01): number {
    const raw = min + this.next() * (max - min);
    return Math.round(Math.round(raw / step) * step * 100) / 100;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)]!;
  }

  /** Picks by weight: `[[item, weight], ...]`. */
  weighted<T>(items: readonly (readonly [T, number])[]): T {
    const total = items.reduce((s, [, w]) => s + w, 0);
    let r = this.next() * total;
    for (const [item, w] of items) {
      r -= w;
      if (r < 0) return item;
    }
    return items.at(-1)![0];
  }
}
