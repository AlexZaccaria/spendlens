import { sameInAllLangs, toMinor } from '@spendlens/contracts';
import { bulkUpdateSchema, itemPatchSchema, transactionCreateSchema, transactionPatchSchema, transactionQuerySchema } from '@spendlens/contracts/schemas';
import { Hono } from 'hono';
import type { Db } from '../db/database.ts';
import { HttpError, validate } from '../http/validate.ts';
import { convertMinor, prefetchRates } from '../lib/fx.ts';
import { refreshRecurringFlags } from '../repo/recurring.ts';
import { baseCurrency } from '../repo/settings.ts';
import type { AccountEnv } from '../http/auth.ts';
import {
  bulkUpdateTransactions,
  deleteTransaction,
  getTransaction,
  insertTransactions,
  listTransactions,
  updateItem,
  updateTransaction,
} from '../repo/transactions.ts';

export function transactionRoutes() {
  return new Hono<AccountEnv>()
    .get('/', validate('query', transactionQuerySchema), (c) => c.json(listTransactions(c.var.db, c.req.valid('query'))))

    .get('/:id', (c) => {
      const tx = getTransaction(c.var.db, c.req.param('id'));
      if (!tx) throw new HttpError(404, 'not_found', 'Transaction not found');
      return c.json(tx);
    })

    .post('/', validate('json', transactionCreateSchema), async (c) => {
      const input = c.req.valid('json');
      const base = baseCurrency(c.var.db);
      const amountMinor = toMinor(input.amount, input.currency);
      await prefetchRates(c.var.db, input.currency, base, [input.date]);
      const { inserted } = insertTransactions(c.var.db, [
        {
          date: input.date,
          rawDescription: input.title,
          title: sameInAllLangs(input.title),
          merchant: input.merchant,
          amountMinor,
          currency: input.currency,
          baseAmountMinor: convertMinor(c.var.db, amountMinor, input.currency, base, input.date),
          categoryId: input.categoryId,
          confidence: 1,
          needsReview: false,
          account: null,
          note: input.note === null ? null : sameInAllLangs(input.note),
          importId: null,
          source: 'manual',
        },
      ]);
      if (inserted.length === 0) throw new HttpError(409, 'duplicate', 'An identical transaction already exists');
      refreshRecurringFlags(c.var.db);
      return c.json(inserted[0]!, 201);
    })

    .patch('/:id', validate('json', transactionPatchSchema), (c) => {
      const updated = updateTransaction(c.var.db, c.req.param('id'), c.req.valid('json'));
      refreshRecurringFlags(c.var.db);
      return c.json(updated);
    })

    /** Re-file one line of an itemised receipt. */
    .patch('/:id/items/:itemId', validate('json', itemPatchSchema), (c) => c.json(updateItem(c.var.db, c.req.param('id'), c.req.param('itemId'), c.req.valid('json').categoryId)))

    .post('/bulk', validate('json', bulkUpdateSchema), (c) => {
      const { ids, ...change } = c.req.valid('json');
      const updated = bulkUpdateTransactions(c.var.db, ids, change);
      return c.json({ updated });
    })

    .delete('/:id', (c) => {
      if (!deleteTransaction(c.var.db, c.req.param('id'))) throw new HttpError(404, 'not_found', 'Transaction not found');
      refreshRecurringFlags(c.var.db);
      return c.body(null, 204);
    });
}
