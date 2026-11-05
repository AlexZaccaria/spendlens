import { getCategory, todayIso, toMinor, type RecurringInput } from '@spendlens/contracts';
import { recurringIgnoreSchema, recurringInputSchema } from '@spendlens/contracts/schemas';
import { Hono, type Context } from 'hono';
import type { AccountEnv } from '../http/auth.ts';
import { HttpError, validate } from '../http/validate.ts';
import { prefetchRates } from '../lib/fx.ts';
import {
  deleteRecurringRule,
  ignoreRecurring,
  InvalidMerchantError,
  knownMerchants,
  listIgnored,
  listRecurring,
  refreshRecurringFlags,
  saveFixed,
} from '../repo/recurring.ts';
import { baseCurrency } from '../repo/settings.ts';

/** Every change answers with the updated list, and re-flags the transactions it covers. */
const changed = (c: Context<AccountEnv>) => {
  refreshRecurringFlags(c.var.db);
  return c.json(listRecurring(c.var.db));
};

/** The amount as declared, in its own currency; today's rate is fetched so the base amount is known. */
async function fixedFrom(c: Context<AccountEnv>, input: RecurringInput) {
  if (getCategory(input.categoryId)?.kind !== 'expense' || getCategory(input.categoryId)?.parentId === null) {
    throw new HttpError(400, 'invalid_request', 'A fixed cost goes under a spending subcategory.');
  }
  await prefetchRates(c.var.db, input.currency, baseCurrency(c.var.db), [todayIso()]);
  return { ...input, amountMinor: toMinor(input.amount, input.currency) };
}

const merchantError = (err: unknown): never => {
  if (err instanceof InvalidMerchantError) throw new HttpError(400, 'invalid_request', err.message);
  throw err;
};

export function recurringRoutes() {
  return new Hono<AccountEnv>()
    // Declared charges first, then the ones detected from the history.
    .get('/', (c) => c.json(listRecurring(c.var.db)))

    .get('/ignored', (c) => c.json(listIgnored(c.var.db)))

    .get('/merchants', (c) => c.json(knownMerchants(c.var.db)))

    .post('/', validate('json', recurringInputSchema), async (c) => {
      const input = await fixedFrom(c, c.req.valid('json'));
      try {
        saveFixed(c.var.db, input);
      } catch (err) {
        merchantError(err);
      }
      return changed(c);
    })

    .put('/:id', validate('json', recurringInputSchema), async (c) => {
      const input = await fixedFrom(c, c.req.valid('json'));
      try {
        saveFixed(c.var.db, input, c.req.param('id'));
      } catch (err) {
        merchantError(err);
      }
      return changed(c);
    })

    // "Not a fixed cost": detection leaves this merchant out until the exclusion is removed.
    .post('/ignore', validate('json', recurringIgnoreSchema), (c) => {
      try {
        ignoreRecurring(c.var.db, c.req.valid('json').merchant);
      } catch (err) {
        merchantError(err);
      }
      return changed(c);
    })

    .delete('/:id', (c) => {
      if (!deleteRecurringRule(c.var.db, c.req.param('id'))) throw new HttpError(404, 'not_found', 'No such fixed cost.');
      return changed(c);
    });
}
