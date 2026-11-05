import { CATEGORIES, DOCUMENT_KINDS, LEAF_CATEGORY_IDS } from '@spendlens/contracts';
import { z } from 'zod';

// What the model must return for every document chunk. Numeric ranges and string formats are
// stated in descriptions instead of JSON Schema keywords: strict structured-output modes accept
// only a subset of JSON Schema, and the values are validated again after parsing anyway.

const bilingual = (what: string) =>
  z
    .object({
      it: z.string().describe(`${what}, in Italian`),
      en: z.string().describe(`${what}, in English`),
    })
    .describe(`${what} — written in BOTH Italian and English`);

/** Receipt lines can only be spending: a product is never income or a transfer. */
const EXPENSE_LEAF_IDS = CATEGORIES.filter((c) => c.kind === 'expense' && c.parentId !== null).map((c) => c.id) as [string, ...string[]];

export const extractedItemSchema = z.object({
  description: z.string().describe('The line as printed on the receipt, verbatim'),
  title: bilingual('Generic product name without brand, size or pack count (e.g. Pannolini / Nappies), the same wording for the same product on every receipt'),
  quantity: z.number().nullable().describe('Quantity or weight as printed, else null'),
  amount: z.number().describe('Line total after its own discount, signed like the transaction (negative = money out)'),
  categoryId: z.enum(EXPENSE_LEAF_IDS).describe('The most specific spending category of this product'),
});

export const extractedTransactionSchema = z.object({
  date: z.string().describe('Transaction date as YYYY-MM-DD'),
  description: z.string().describe('The original line exactly as written in the document, in its original language'),
  title: bilingual('A short human-readable title (2-6 words) of what the money was for'),
  merchant: z.string().nullable().describe('Brand or counterparty name only — no city, store number, card digits or legal suffix; null when unknown'),
  amount: z.number().describe('Signed decimal amount: negative = money out (spending), positive = money in'),
  currency: z.string().describe('ISO 4217 code of the amount, e.g. EUR'),
  categoryId: z.enum(LEAF_CATEGORY_IDS as [string, ...string[]]).describe('The most specific matching category id'),
  confidence: z.number().describe('0 to 1: how sure you are about amount, sign, date and category together'),
  note: bilingual('A short remark worth showing the user (conversion, ambiguity, split bill)').nullable(),
  reference: z
    .string()
    .nullable()
    .describe('The identifier printed for this one payment, exactly as printed: a receipt or invoice number (e.g. "0412-0087"), a statement transaction ID; null when there is none'),
  time: z.string().nullable().describe('Time of the purchase as HH:MM when the document prints it (receipts), else null'),
  items: z.array(extractedItemSchema).describe('The purchased lines of an itemised receipt or invoice; empty for statement lines, notes and transfers'),
});

export const extractionSchema = z.object({
  document: z.object({
    kind: z.enum(DOCUMENT_KINDS),
    language: z.string().describe('ISO 639-1 code of the document language, e.g. it, en, de'),
    institution: z.string().nullable().describe('Bank, card issuer, shop or utility that produced the document'),
    account: z.string().nullable().describe('Account or card name/last digits as printed (never a full IBAN or card number)'),
    currency: z.string().nullable().describe('Main ISO 4217 currency of the document'),
    summary: bilingual('One sentence describing the document and the period it covers'),
  }),
  transactions: z.array(extractedTransactionSchema),
  warnings: z.array(bilingual('Something the user should check (skipped rows, unreadable parts, ambiguous dates)')),
});

export type Extraction = z.infer<typeof extractionSchema>;
export type ExtractedTransaction = z.infer<typeof extractedTransactionSchema>;
export type ExtractedItem = z.infer<typeof extractedItemSchema>;

function stripSchemaKey(schema: Record<string, unknown>): Record<string, unknown> {
  const { $schema: _ignored, ...rest } = schema;
  return rest;
}

/** JSON Schema of the extraction answer (every property required, no additional properties). */
export const EXTRACTION_JSON_SCHEMA = stripSchemaKey(z.toJSONSchema(extractionSchema, { target: 'draft-2020-12' }) as Record<string, unknown>);

// --- Monthly insight ---------------------------------------------------------------------------

export const insightAnswerSchema = z.object({
  headline: bilingual('One-line headline of the month'),
  bullets: z
    .array(
      z.object({
        tone: z.enum(['positive', 'negative', 'neutral']),
        text: bilingual('One specific observation with numbers'),
      }),
    )
    .describe('3 to 5 observations'),
});
export type InsightAnswer = z.infer<typeof insightAnswerSchema>;
export const INSIGHT_JSON_SCHEMA = stripSchemaKey(z.toJSONSchema(insightAnswerSchema, { target: 'draft-2020-12' }) as Record<string, unknown>);
