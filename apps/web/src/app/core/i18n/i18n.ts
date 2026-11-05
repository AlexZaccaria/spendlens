import { DOCUMENT } from '@angular/common';
import { computed, effect, inject, Service, signal } from '@angular/core';
import { DEFAULT_LANG, getCategory, LANGS, pickLang, type Lang, type LocalizedText, type MonthKey } from '@spendlens/contracts';
import { en } from './en';
import { it, type Dict } from './it';

const DICTS: Record<Lang, Dict> = { it, en };
const LOCALES: Record<Lang, string> = { it: 'it-IT', en: 'en-GB' };
const STORAGE_KEY = 'spendlens.lang';

function initialLang(doc: Document): Lang {
  const saved = doc.defaultView?.localStorage.getItem(STORAGE_KEY);
  if (saved && (LANGS as readonly string[]).includes(saved)) return saved as Lang;
  const nav = doc.defaultView?.navigator.language.slice(0, 2);
  return nav === 'en' ? 'en' : DEFAULT_LANG;
}

/**
 * The UI language and every locale-aware formatter. Switching language re-renders the whole
 * app instantly — the AI already wrote titles and notes in both languages, so nothing is
 * re-requested.
 */
@Service()
export class I18n {
  private readonly doc = inject(DOCUMENT);

  readonly lang = signal<Lang>(initialLang(this.doc));
  readonly t = computed(() => DICTS[this.lang()]);
  readonly locale = computed(() => LOCALES[this.lang()]);

  private readonly formatters = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat>();

  constructor() {
    effect(() => {
      const lang = this.lang();
      this.doc.documentElement.lang = lang;
      this.doc.defaultView?.localStorage.setItem(STORAGE_KEY, lang);
    });
  }

  /** A model-written text in the current language. */
  text(value: LocalizedText | null | undefined): string {
    return value ? pickLang(value, this.lang()) : '';
  }

  category(id: string): string {
    const c = getCategory(id);
    return c ? c.label[this.lang()] : id;
  }

  private number(key: string, make: (locale: string) => Intl.NumberFormat): Intl.NumberFormat {
    const locale = this.locale();
    const cacheKey = `${locale}|${key}`;
    let f = this.formatters.get(cacheKey) as Intl.NumberFormat | undefined;
    if (!f) {
      f = make(locale);
      this.formatters.set(cacheKey, f);
    }
    return f;
  }

  /** Formats minor units: `money(-4530, 'EUR')` → "-45,30 €". */
  money(minor: number, currency: string, opts: { compact?: boolean; sign?: boolean; whole?: boolean } = {}): string {
    const digits = this.number(`digits|${currency}`, (l) => new Intl.NumberFormat(l, { style: 'currency', currency }));
    const exp = digits.resolvedOptions().maximumFractionDigits ?? 2;
    const major = minor / 10 ** exp;
    const key = `money|${currency}|${opts.compact ? 'c' : ''}${opts.sign ? 's' : ''}${opts.whole ? 'w' : ''}`;
    return this.number(key, (l) =>
      new Intl.NumberFormat(l, {
        style: 'currency',
        currency,
        notation: opts.compact ? 'compact' : 'standard',
        maximumFractionDigits: opts.compact ? 1 : opts.whole ? 0 : exp,
        minimumFractionDigits: opts.compact || opts.whole ? 0 : exp,
        signDisplay: opts.sign ? 'exceptZero' : 'auto',
      }),
    ).format(major);
  }

  percent(ratio: number, digits = 0): string {
    return this.number(`pct|${digits}`, (l) => new Intl.NumberFormat(l, { style: 'percent', maximumFractionDigits: digits })).format(ratio);
  }

  signedPercent(ratio: number): string {
    return this.number('spct', (l) => new Intl.NumberFormat(l, { style: 'percent', maximumFractionDigits: 0, signDisplay: 'exceptZero' })).format(ratio);
  }

  decimal(n: number): string {
    return this.number('dec', (l) => new Intl.NumberFormat(l, { maximumFractionDigits: 3 })).format(n);
  }

  integer(n: number): string {
    return this.number('int', (l) => new Intl.NumberFormat(l)).format(n);
  }

  private dateFormat(key: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
    const locale = this.locale();
    const cacheKey = `${locale}|date|${key}`;
    let f = this.formatters.get(cacheKey) as Intl.DateTimeFormat | undefined;
    if (!f) {
      f = new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' });
      this.formatters.set(cacheKey, f);
    }
    return f;
  }

  /** `2026-10-05` → "5 ott 2026" / "5 Oct 2026". Dates are calendar days, formatted in UTC. */
  date(iso: string, style: 'short' | 'medium' | 'long' | 'day' = 'medium'): string {
    const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
    const options: Record<typeof style, Intl.DateTimeFormatOptions> = {
      short: { day: 'numeric', month: 'short' },
      medium: { day: 'numeric', month: 'short', year: 'numeric' },
      long: { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' },
      day: { weekday: 'short', day: 'numeric' },
    };
    return this.dateFormat(style, options[style]).format(d);
  }

  /** `2026-10` → "ottobre 2026" (long) / "ott" (short) / "ott 26" (compact). */
  month(key: MonthKey, style: 'long' | 'short' | 'compact' | 'name' = 'long'): string {
    const d = new Date(`${key}-01T00:00:00Z`);
    const options: Record<typeof style, Intl.DateTimeFormatOptions> = {
      long: { month: 'long', year: 'numeric' },
      name: { month: 'long' },
      short: { month: 'short' },
      compact: { month: 'short', year: '2-digit' },
    };
    return this.dateFormat(`m-${style}`, options[style]).format(d);
  }

  weekdayInitials(): string[] {
    // 2024-01-01 was a Monday.
    return Array.from({ length: 7 }, (_, i) => this.dateFormat('wd', { weekday: 'narrow' }).format(new Date(Date.UTC(2024, 0, 1 + i))));
  }

  languageName(lang: string): string {
    try {
      return new Intl.DisplayNames([this.locale()], { type: 'language' }).of(lang) ?? lang;
    } catch {
      return lang;
    }
  }
}
