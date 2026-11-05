import { currentMonthKey, monthRange } from '@spendlens/contracts';
import { isoDateSchema, monthKeySchema } from '@spendlens/contracts/schemas';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Db } from '../db/database.ts';
import { validate } from '../http/validate.ts';
import { summary, trend } from '../repo/analytics.ts';
import { baseCurrency } from '../repo/settings.ts';
import type { AccountEnv } from '../http/auth.ts';

const periodQuery = z
  .object({ month: monthKeySchema.optional(), from: isoDateSchema.optional(), to: isoDateSchema.optional() })
  .refine((q) => (q.from === undefined) === (q.to === undefined), 'from and to go together')
  .refine((q) => !q.from || !q.to || q.from <= q.to, 'from must not be after to');

const trendQuery = z.object({
  month: monthKeySchema.optional(),
  count: z.coerce.number().int().min(1).max(36).default(12),
});

export function analyticsRoutes() {
  return new Hono<AccountEnv>()
    .get('/summary', validate('query', periodQuery), (c) => {
      const q = c.req.valid('query');
      const range = q.from && q.to ? { from: q.from, to: q.to } : monthRange(q.month ?? currentMonthKey());
      return c.json(summary(c.var.db, range, baseCurrency(c.var.db)));
    })
    .get('/trend', validate('query', trendQuery), (c) => {
      const q = c.req.valid('query');
      return c.json(trend(c.var.db, q.month ?? currentMonthKey(), q.count));
    });
}
