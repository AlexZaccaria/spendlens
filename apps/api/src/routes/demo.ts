import { Hono } from 'hono';
import { z } from 'zod';
import type { Db } from '../db/database.ts';
import { DEFAULT_DEMO_MONTHS } from '../demo/generator.ts';
import { refreshRecurringFlags } from '../repo/recurring.ts';
import { HttpError } from '../http/validate.ts';
import { removeDemo, resetData, seedDemo } from '../demo/seed.ts';
import type { AccountEnv } from '../http/auth.ts';

const seedBody = z.object({ months: z.number().int().min(1).max(36).default(DEFAULT_DEMO_MONTHS) });

export function demoRoutes() {
  return new Hono<AccountEnv>()
    .post('/seed', async (c) => {
      // The body is optional: an empty POST seeds the default thirteen months.
      const text = await c.req.text();
      let json: unknown = {};
      try {
        json = text.trim() === '' ? {} : JSON.parse(text);
      } catch {
        throw new HttpError(400, 'invalid_request', 'Body must be JSON');
      }
      const body = seedBody.safeParse(json);
      if (!body.success) throw new HttpError(400, 'invalid_request', z.prettifyError(body.error));
      return c.json(seedDemo(c.var.db, { months: body.data.months }));
    })
    .delete('/', (c) => {
      const deleted = removeDemo(c.var.db);
      refreshRecurringFlags(c.var.db);
      return c.json({ deleted });
    })
    .post('/reset', (c) => {
      resetData(c.var.db);
      return c.json({ ok: true });
    });
}
