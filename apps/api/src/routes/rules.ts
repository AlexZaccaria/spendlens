import { Hono } from 'hono';
import type { Db } from '../db/database.ts';
import { HttpError } from '../http/validate.ts';
import { deleteRule, listRules } from '../repo/rules.ts';
import type { AccountEnv } from '../http/auth.ts';

export function ruleRoutes() {
  return new Hono<AccountEnv>()
    .get('/', (c) => c.json(listRules(c.var.db)))
    .delete('/:id', (c) => {
      if (!deleteRule(c.var.db, c.req.param('id'))) throw new HttpError(404, 'not_found', 'Rule not found');
      return c.body(null, 204);
    });
}
