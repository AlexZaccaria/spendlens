/** Amounts are stored as signed integers in the currency's minor unit (cents for EUR, yen for
 *  JPY): negative = money out, positive = money in. Floats never reach the database. */
export const DEFAULT_BASE_CURRENCY = 'EUR';

const exponentCache = new Map<string, number>();

export function isKnownCurrency(code: string): boolean {
  try {
    new Intl.NumberFormat('en', { style: 'currency', currency: code });
    return Intl.supportedValuesOf('currency').includes(code);
  } catch {
    return false;
  }
}

/** Number of minor-unit digits of a currency (2 for EUR, 0 for JPY, 3 for KWD). */
export function currencyExponent(code: string): number {
  let exp = exponentCache.get(code);
  if (exp === undefined) {
    exp = new Intl.NumberFormat('en', { style: 'currency', currency: code }).resolvedOptions().maximumFractionDigits ?? 2;
    exponentCache.set(code, exp);
  }
  return exp;
}

export function toMinor(amount: number, currency: string): number {
  return Math.round(amount * 10 ** currencyExponent(currency));
}

export function fromMinor(minor: number, currency: string): number {
  return minor / 10 ** currencyExponent(currency);
}
