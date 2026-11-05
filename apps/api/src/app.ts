import { Hono } from 'hono';
import { logger } from 'hono/logger';
import type { Tenancy } from './accounts/tenancy.ts';
import { accountRoutes, handleErrors } from './api.ts';
import { requireAccount, type AccountEnv } from './http/auth.ts';
import { authRoutes } from './routes/auth.ts';

export function createApp(tenancy: Tenancy, options: { log?: boolean } = {}) {
  const app = new Hono();
  if (options.log) app.use('/api/*', logger());
  app.route('/api/auth', authRoutes(tenancy));
  // Everything else runs for a signed-in account, on that account's database.
  app.route('/api', new Hono<AccountEnv>().use(requireAccount(tenancy)).route('/', accountRoutes()));
  return handleErrors(app);
}
