import type { BaseCurrencyResult } from '@spendlens/contracts';
import { baseCurrencyInputSchema } from '@spendlens/contracts/schemas';
import { Hono } from 'hono';
import type { AccountEnv } from '../http/auth.ts';
import { validate } from '../http/validate.ts';
import { rebase } from '../lib/fx.ts';
import { refreshRecurringFlags } from '../repo/recurring.ts';

export function settingsRoutes() {
  return new Hono<AccountEnv>()
    // The currency every total is in: the whole history is converted again, each transaction at
    // the rate of its own day. Amounts without a rate (offline) stay out of the totals for now.
    .put('/currency', validate('json', baseCurrencyInputSchema), async (c) => {
      const { currency } = c.req.valid('json');
      const result = await rebase(c.var.db, currency);
      refreshRecurringFlags(c.var.db);
      return c.json({ baseCurrency: currency, ...result } satisfies BaseCurrencyResult);
    });
}
