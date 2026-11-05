import { z } from 'zod';
import { isCategoryId, LEAF_CATEGORY_IDS } from './categories.ts';
import {
  AI_PROVIDERS,
  AUTH_MODES,
  DOCUMENT_KINDS,
  ECB_CURRENCIES,
  EFFORTS,
  IMPORT_STAGES,
  RECURRING_CADENCES,
  TRANSACTION_KINDS,
  TRANSACTION_SOURCES,
} from './constants.ts';
import { LANGS } from './i18n.ts';
import { isKnownCurrency } from './money.ts';

// Zod schemas: imported by the API (`@spendlens/contracts/schemas`) to validate requests and model
// output. The web app imports only the inferred types, so Zod stays out of the browser bundle.

export const langSchema = z.enum(LANGS);
export const localizedTextSchema = z.object({ it: z.string(), en: z.string() });
export const monthKeySchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'YYYY-MM expected');
export const isoDateSchema = z.iso.date();
export const currencySchema = z
  .string()
  .regex(/^[A-Z]{3}$/, 'ISO 4217 code expected')
  .refine(isKnownCurrency, { message: 'Unknown currency' });
export const leafCategoryIdSchema = z.enum(LEAF_CATEGORY_IDS);
export const categoryIdSchema = z.string().refine(isCategoryId, { message: 'Unknown category' });
const rangeSchema = z.object({ from: isoDateSchema, to: isoDateSchema });

/**
 * An amount as charged, in a currency other than the base, shown next to the converted figure.
 * On a total, only when every row of it was charged in that same currency; same sign as the figure.
 */
export const chargedSchema = z.object({ amountMinor: z.number().int(), currency: currencySchema });
export type Charged = z.infer<typeof chargedSchema>;

// --- Transactions ----------------------------------------------------------------------------

/**
 * One line of an itemised receipt or invoice. When a transaction has items, analytics file each
 * item under its own category (nappies bought at the supermarket count as Kids, not Groceries);
 * the items always add up to the transaction amount.
 */
export const transactionItemSchema = z.object({
  id: z.string(),
  position: z.number().int(),
  /** The line as printed on the receipt. */
  description: z.string(),
  title: localizedTextSchema,
  quantity: z.number().nullable(),
  /** Signed like the transaction: negative = money out. */
  amountMinor: z.number().int(),
  baseAmountMinor: z.number().int().nullable(),
  categoryId: categoryIdSchema,
  /** Discounts and rounding not attributed to a line, added so the items match the total. */
  adjustment: z.boolean(),
});
export type TransactionItem = z.infer<typeof transactionItemSchema>;

export const transactionSchema = z.object({
  id: z.string(),
  date: isoDateSchema,
  /** The line exactly as the source document wrote it, in its own language. */
  rawDescription: z.string(),
  /** Short readable title written by the AI in every UI language. */
  title: localizedTextSchema,
  merchant: z.string().nullable(),
  /** Signed, minor units of `currency`: negative = money out. */
  amountMinor: z.number().int(),
  currency: currencySchema,
  /** Same amount in the base currency; null while no exchange rate is known. */
  baseAmountMinor: z.number().int().nullable(),
  categoryId: categoryIdSchema,
  confidence: z.number().min(0).max(1),
  needsReview: z.boolean(),
  recurring: z.boolean(),
  account: z.string().nullable(),
  note: localizedTextSchema.nullable(),
  /** The identifier the document printed for this payment: receipt or invoice number, statement transaction ID. */
  reference: z.string().nullable(),
  /** Time of the purchase as HH:MM, when the document printed it (receipts). */
  time: z.string().nullable(),
  importId: z.string().nullable(),
  source: z.enum(TRANSACTION_SOURCES),
  /** Receipt lines; empty for a plain bank or card line. */
  items: z.array(transactionItemSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Transaction = z.infer<typeof transactionSchema>;

export const transactionQuerySchema = z.object({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  /** A root category matches all of its leaves. */
  category: z.string().optional(),
  q: z.string().trim().max(200).optional(),
  review: z.stringbool().optional(),
  kind: z.enum(TRANSACTION_KINDS).default('all'),
  importId: z.string().optional(),
  sort: z.enum(['date', 'amount']).default('date'),
  dir: z.enum(['asc', 'desc']).default('desc'),
  limit: z.coerce.number().int().min(1).max(5000).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});
export type TransactionQuery = z.input<typeof transactionQuerySchema>;

export const transactionPageSchema = z.object({
  items: z.array(transactionSchema),
  total: z.number().int(),
  /** Sum of `baseAmountMinor` over every row matching the query, not just this page. With a
   *  category filter it counts only the matching items of itemised transactions. */
  sumBaseMinor: z.number().int(),
  /** With a category filter: transaction id → the part of it in that category, for itemised
   *  transactions matched through some of their items only. */
  matchedBaseMinor: z.record(z.string(), z.number().int()),
  /** `sumBaseMinor` as charged, when every matching row was charged in one foreign currency. */
  sumCharged: chargedSchema.nullable(),
});
export type TransactionPage = z.infer<typeof transactionPageSchema>;

export const transactionPatchSchema = z
  .object({
    categoryId: z.string(),
    /** File every transaction of the same merchant under `categoryId` and remember it as a rule. */
    applyToMerchant: z.boolean(),
    merchant: z.string().trim().max(120).nullable(),
    title: z.object({ lang: langSchema, text: z.string().trim().min(1).max(200) }),
    note: z.string().trim().max(500).nullable(),
    date: isoDateSchema,
    amountMinor: z.number().int(),
    needsReview: z.boolean(),
  })
  .partial();
export type TransactionPatch = z.infer<typeof transactionPatchSchema>;

export const transactionCreateSchema = z.object({
  date: isoDateSchema,
  title: z.string().trim().min(1).max(200),
  merchant: z.string().trim().max(120).nullable().default(null),
  /** Decimal amount, signed: negative = expense. */
  amount: z.number().finite().refine((n) => n !== 0, 'Amount cannot be zero'),
  currency: currencySchema,
  categoryId: z.string(),
  note: z.string().trim().max(500).nullable().default(null),
});
export type TransactionCreate = z.input<typeof transactionCreateSchema>;

export const itemPatchSchema = z.object({ categoryId: categoryIdSchema });
export type ItemPatch = z.infer<typeof itemPatchSchema>;

export const bulkUpdateSchema = z.object({
  ids: z.array(z.string()).min(1).max(1000),
  categoryId: z.string().optional(),
  needsReview: z.boolean().optional(),
});
export type BulkUpdate = z.infer<typeof bulkUpdateSchema>;

// --- Analytics -------------------------------------------------------------------------------

export const categoryTotalSchema = z.object({
  id: z.string(),
  totalMinor: z.number().int(),
  txCount: z.number().int(),
});

export const summarySchema = z.object({
  range: rangeSchema,
  baseCurrency: currencySchema,
  totals: z.object({
    expenseMinor: z.number().int(),
    incomeMinor: z.number().int(),
    netMinor: z.number().int(),
    txCount: z.number().int(),
    reviewCount: z.number().int(),
    unconvertedCount: z.number().int(),
    /** Spending, income and net as charged, each when all of its rows share one foreign currency. */
    charged: z.object({ expense: chargedSchema.nullable(), income: chargedSchema.nullable(), net: chargedSchema.nullable() }),
  }),
  previous: z.object({ range: rangeSchema, expenseMinor: z.number().int(), incomeMinor: z.number().int() }),
  /** Mean monthly spending over the up-to-6 preceding months that have data. */
  averageExpenseMinor: z.number().int().nullable(),
  /** Root expense categories, largest first; spending is reported as a positive amount. */
  categories: z.array(
    categoryTotalSchema.extend({ previousMinor: z.number().int(), children: z.array(categoryTotalSchema) }),
  ),
  merchants: z.array(
    z.object({ name: z.string(), categoryId: z.string(), totalMinor: z.number().int(), charged: chargedSchema.nullable(), txCount: z.number().int() }),
  ),
  /** Receipt items added up by product across receipts and shops, largest first: "Nappies" bought
   *  ten times in three shops is one row. Printed line prices, before receipt-level discounts. */
  products: z.array(
    z.object({
      title: localizedTextSchema,
      categoryId: z.string(),
      totalMinor: z.number().int(),
      charged: chargedSchema.nullable(),
      previousMinor: z.number().int(),
      /** Receipts the product appears on. */
      purchases: z.number().int(),
    }),
  ),
  daily: z.array(z.object({ date: isoDateSchema, expenseMinor: z.number().int() })),
  largest: z.array(transactionSchema),
  /** Spending of the 12 months ending with the range's month, oldest first (sparkline). */
  monthly: z.array(z.object({ month: monthKeySchema, expenseMinor: z.number().int() })),
});
export type Summary = z.infer<typeof summarySchema>;

export const trendSchema = z.object({
  months: z.array(monthKeySchema),
  expense: z.array(z.number().int()),
  income: z.array(z.number().int()),
  categories: z.array(z.object({ id: z.string(), values: z.array(z.number().int()) })),
});
export type Trend = z.infer<typeof trendSchema>;

export const recurringItemSchema = z.object({
  /** The declaration's id, or `auto:<key>` for a detected pattern. */
  id: z.string(),
  /** Normalised merchant: what ties the item to its transactions. */
  key: z.string(),
  /** `detected` from the history, `manual` declared by the user. */
  source: z.enum(['detected', 'manual']),
  merchant: z.string(),
  categoryId: z.string(),
  /** Typical charge in the base currency, positive. */
  averageMinor: z.number().int(),
  /** The charge in its own currency when that is not the base (a subscription billed in USD). */
  original: chargedSchema.nullable(),
  cadenceDays: z.number().int(),
  occurrences: z.number().int(),
  /** Null for a declared charge with no payment in the history yet. */
  lastDate: isoDateSchema.nullable(),
  nextDate: isoDateSchema,
  /** The charge normalised to one month. */
  monthlyMinor: z.number().int(),
  active: z.boolean(),
});
export type RecurringItem = z.infer<typeof recurringItemSchema>;

/** A fixed cost the user declares: shown at once, without waiting for three payments. */
export const recurringInputSchema = z.object({
  merchant: z.string().trim().min(1).max(120),
  /** Expected charge in `currency`, positive. */
  amount: z.number().positive().max(1_000_000_000),
  currency: currencySchema,
  categoryId: categoryIdSchema,
  cadenceDays: z.literal([...RECURRING_CADENCES]),
  /** The next (or first) charge; the others follow from it. */
  nextDate: isoDateSchema,
});
export type RecurringInput = z.infer<typeof recurringInputSchema>;

/** The currency every amount is shown and added up in; changing it converts the whole history. */
export const baseCurrencyInputSchema = z.object({ currency: z.enum(ECB_CURRENCIES) });
export const baseCurrencyResultSchema = z.object({
  baseCurrency: z.enum(ECB_CURRENCIES),
  /** Transactions whose amount in the new base is known. */
  converted: z.number().int(),
  /** Transactions left without a rate (offline): converted later, kept out of the totals meanwhile. */
  missing: z.number().int(),
});
export type BaseCurrencyResult = z.infer<typeof baseCurrencyResultSchema>;

/** A detected pattern the user says is not a fixed cost. */
export const recurringIgnoreSchema = z.object({ merchant: z.string().trim().min(1).max(120) });
export const ignoredRecurringSchema = z.object({ id: z.string(), merchant: z.string() });
export type IgnoredRecurring = z.infer<typeof ignoredRecurringSchema>;

export const insightSchema = z.object({
  month: monthKeySchema,
  generatedAt: z.string(),
  provider: z.string(),
  model: z.string(),
  headline: localizedTextSchema,
  bullets: z.array(z.object({ tone: z.enum(['positive', 'negative', 'neutral']), text: localizedTextSchema })),
});
export type Insight = z.infer<typeof insightSchema>;

// --- Imports ---------------------------------------------------------------------------------

export const importRecordSchema = z.object({
  id: z.string(),
  filename: z.string(),
  mime: z.string(),
  sizeBytes: z.number().int(),
  status: z.enum(['processing', 'done', 'error']),
  documentKind: z.enum(DOCUMENT_KINDS).nullable(),
  /** ISO 639-1 language of the source document. */
  sourceLanguage: z.string().nullable(),
  institution: z.string().nullable(),
  summary: localizedTextSchema.nullable(),
  warnings: z.array(localizedTextSchema),
  txCount: z.number().int(),
  duplicateCount: z.number().int(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  error: z.string().nullable(),
  createdAt: z.string(),
});
export type ImportRecord = z.infer<typeof importRecordSchema>;

export const importErrorSchema = z.object({ code: z.string(), message: z.string() });
export type ImportError = z.infer<typeof importErrorSchema>;

/** Server-sent events of `POST /api/imports`, one stream for the whole batch. */
export const importEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('file-start'), file: z.number().int(), filename: z.string(), total: z.number().int() }),
  z.object({
    type: z.literal('stage'),
    file: z.number().int(),
    stage: z.enum(IMPORT_STAGES),
    chunk: z.number().int(),
    chunks: z.number().int(),
  }),
  z.object({ type: z.literal('file-done'), file: z.number().int(), record: importRecordSchema }),
  z.object({ type: z.literal('file-error'), file: z.number().int(), filename: z.string(), error: importErrorSchema }),
  z.object({ type: z.literal('done'), imported: z.number().int(), duplicates: z.number().int(), failed: z.number().int() }),
]);
export type ImportEvent = z.infer<typeof importEventSchema>;

// --- Rules -----------------------------------------------------------------------------------

export const ruleSchema = z.object({
  id: z.string(),
  /** Normalised merchant key the rule matches. */
  pattern: z.string(),
  categoryId: z.string(),
  hits: z.number().int(),
  createdAt: z.string(),
});
export type Rule = z.infer<typeof ruleSchema>;

// --- AI provider settings ----------------------------------------------------------------------

/** What the browser sees: secrets never leave the server, only whether they are set. */
export const aiSettingsViewSchema = z.object({
  provider: z.enum(AI_PROVIDERS),
  authMode: z.enum(AUTH_MODES),
  apiKeySet: z.boolean(),
  /** `env` when the key comes from ANTHROPIC_API_KEY / OPENAI_API_KEY instead of the settings. */
  apiKeySource: z.enum(['settings', 'env']).nullable(),
  /** A credentials file re-read on every call (Claude Code's `.credentials.json` keeps it fresh). */
  oauthCredentialPath: z.string(),
  /** A credentials file uploaded once: a snapshot, refreshed in memory only. */
  oauthCredentialImported: z.boolean(),
  oauthAccount: z.string(),
  baseUrl: z.string(),
  model: z.string(),
  effort: z.enum(EFFORTS).nullable(),
  ready: z.boolean(),
  missing: z.array(z.string()),
});
export type AiSettingsView = z.infer<typeof aiSettingsViewSchema>;

export const aiSettingsUpdateSchema = z
  .object({
    provider: z.enum(AI_PROVIDERS),
    authMode: z.enum(AUTH_MODES),
    /** Write-only: an empty string leaves the stored key unchanged, null removes it. */
    apiKey: z.string().trim().nullable(),
    oauthCredentialPath: z.string().trim(),
    baseUrl: z.string().trim(),
    model: z.string().trim(),
    effort: z.enum(EFFORTS).nullable(),
  })
  .partial();
export type AiSettingsUpdate = z.infer<typeof aiSettingsUpdateSchema>;

export const credentialCandidateSchema = z.object({
  path: z.string(),
  account: z.string(),
  expiresAt: z.string().nullable(),
  /** Removed from the app's list by the user; the file itself is untouched. */
  hidden: z.boolean(),
});
export type CredentialCandidate = z.infer<typeof credentialCandidateSchema>;

export const credentialVisibilitySchema = z.object({ path: z.string().min(1), hidden: z.boolean() });
export type CredentialVisibility = z.infer<typeof credentialVisibilitySchema>;

export const aiModelSchema = z.object({
  id: z.string(),
  label: z.string(),
  contextWindow: z.number().int().nullable(),
  /** Effort levels the model accepts; null when the provider does not say. */
  efforts: z.array(z.enum(EFFORTS)).nullable(),
  /** The newest model of its line (Opus, Sonnet, Haiku…), listed first in the picker. */
  latest: z.boolean(),
});
export type AiModel = z.infer<typeof aiModelSchema>;

/**
 * Whether the saved configuration works: `ok` when the provider answered with the credential (its
 * model list, which costs no tokens), `missing` when something is still to fill in.
 */
export const aiHealthSchema = z.object({
  /** `disabled`: the demo, which has no AI. */
  status: z.enum(['ok', 'error', 'missing', 'disabled']),
  /** The provider's error, or what is missing. */
  message: z.string().nullable(),
});
export type AiHealth = z.infer<typeof aiHealthSchema>;

// --- Accounts --------------------------------------------------------------------------------

export const loginSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(256),
});
export type Login = z.infer<typeof loginSchema>;

export const sessionAccountSchema = z.object({
  name: z.string(),
  email: z.string().nullable(),
  /** A visitor's copy of the demo: no AI, deleted at `expiresAt`. */
  demo: z.boolean(),
  expiresAt: z.string().nullable(),
});
export type SessionAccount = z.infer<typeof sessionAccountSchema>;

export const sessionSchema = z.object({
  account: sessionAccountSchema.nullable(),
  registrationOpen: z.boolean(),
  /** False in the static demo (the API running in the browser): there is only the demo to enter. */
  signInOpen: z.boolean(),
});
export type Session = z.infer<typeof sessionSchema>;

// --- App -------------------------------------------------------------------------------------

export const metaSchema = z.object({
  version: z.string(),
  baseCurrency: currencySchema,
  /** First and last transaction date, null on an empty database. */
  dataRange: rangeSchema.nullable(),
  txCount: z.number().int(),
  ai: z.object({ ready: z.boolean(), provider: z.enum(AI_PROVIDERS), model: z.string() }),
});
export type Meta = z.infer<typeof metaSchema>;

export const apiErrorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });
export type ApiError = z.infer<typeof apiErrorSchema>;
