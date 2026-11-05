import { monthKeySchema } from '@spendlens/contracts/schemas';
import { Hono } from 'hono';
import { z } from 'zod';
import { toAiError } from '../ai/errors.ts';
import { generateInsight, getInsight, NoDataError } from '../ai/insights.ts';
import { resolveProvider } from '../ai/provider.ts';
import { getAiSettings } from '../ai/settings.ts';
import type { Db } from '../db/database.ts';
import { HttpError, validate } from '../http/validate.ts';
import { assertAiAllowed, type AccountEnv } from '../http/auth.ts';

const params = z.object({ month: monthKeySchema });

export function insightsRoutes() {
  return new Hono<AccountEnv>()
    .get('/:month', validate('param', params), (c) => {
      // null (not a 404) when nothing was generated yet: an empty state, not a missing resource.
      return c.json(getInsight(c.var.db, c.req.valid('param').month));
    })
    .post('/:month', validate('param', params), async (c) => {
      assertAiAllowed(c);
      const { month } = c.req.valid('param');
      try {
        return c.json(await generateInsight(c.var.db, month, resolveProvider(getAiSettings(c.var.db))));
      } catch (err) {
        if (err instanceof NoDataError) throw new HttpError(422, 'no_data', err.message);
        const e = toAiError(err);
        throw new HttpError(e.code === 'ai_not_configured' ? 409 : 502, e.code, e.message);
      }
    });
}
