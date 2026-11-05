export const TRANSACTION_SOURCES = ['import', 'manual', 'demo'] as const;
export type TransactionSource = (typeof TRANSACTION_SOURCES)[number];

export const TRANSACTION_KINDS = ['all', 'expense', 'income', 'transfer'] as const;
export type TransactionKind = (typeof TRANSACTION_KINDS)[number];

export const DOCUMENT_KINDS = [
  'bank_statement',
  'card_statement',
  'receipt',
  'invoice',
  'utility_bill',
  'payslip',
  'note',
  'spreadsheet',
  'other',
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const IMPORT_STAGES = ['reading', 'extracting', 'saving'] as const;
export type ImportStage = (typeof IMPORT_STAGES)[number];

export const AI_PROVIDERS = ['anthropic', 'openai', 'openai-compatible'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export const AUTH_MODES = ['key', 'oauth'] as const;
export type AuthMode = (typeof AUTH_MODES)[number];

/**
 * Currencies with an ECB daily reference rate (Frankfurter's list): the possible base currencies,
 * since every amount must convert into the base. Other currencies can still be spent in; their
 * amounts stay unconverted until a rate is known.
 */
export const ECB_CURRENCIES = [
  'EUR', 'USD', 'GBP', 'CHF', 'JPY', 'AUD', 'BRL', 'CAD', 'CNY', 'CZK', 'DKK', 'HKD', 'HUF', 'IDR', 'ILS',
  'INR', 'ISK', 'KRW', 'MXN', 'MYR', 'NOK', 'NZD', 'PHP', 'PLN', 'RON', 'SEK', 'SGD', 'THB', 'TRY', 'ZAR',
] as const;
export type EcbCurrency = (typeof ECB_CURRENCIES)[number];

/** Cadences of a fixed cost, in days: weekly, fortnightly, monthly, every two months, quarterly, yearly. */
export const RECURRING_CADENCES = [7, 14, 30, 61, 91, 365] as const;
export type RecurringCadence = (typeof RECURRING_CADENCES)[number];

export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type Effort = (typeof EFFORTS)[number];
