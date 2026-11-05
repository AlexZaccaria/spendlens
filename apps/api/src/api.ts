import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { aiReadiness, getAiSettings } from './ai/settings.ts';
import { isDemo, type AccountEnv } from './http/auth.ts';
import { HttpError } from './http/validate.ts';
import { baseCurrency } from './repo/settings.ts';
import { countTransactions, dataRange, NotFoundError } from './repo/transactions.ts';
import { aiRoutes } from './routes/ai.ts';
import { analyticsRoutes } from './routes/analytics.ts';
import { demoRoutes } from './routes/demo.ts';
import { importsRoutes } from './routes/imports.ts';
import { insightsRoutes } from './routes/insights.ts';
import { recurringRoutes } from './routes/recurring.ts';
import { settingsRoutes } from './routes/settings.ts';
import { ruleRoutes } from './routes/rules.ts';
import { transactionRoutes } from './routes/transactions.ts';

export const VERSION = '0.1.0';

/**
 * The API of one account, mounted at /api: every handler works on `c.var.db` and `c.var.account`.
 * Whoever mounts it sets them: the session middleware on the server (app.ts), the demo copy in the
 * browser build (browser/main.ts).
 */
export function accountRoutes() {
  return new Hono<AccountEnv>()
    .get('/meta', (c) => {
      const { db, account } = c.var;
      const ai = getAiSettings(db);
      return c.json({
        version: VERSION,
        baseCurrency: baseCurrency(db),
        dataRange: dataRange(db),
        txCount: countTransactions(db),
        ai: { ready: !isDemo(account) && aiReadiness(ai).length === 0, provider: ai.provider, model: ai.model },
      });
    })
    .route('/transactions', transactionRoutes())
    .route('/rules', ruleRoutes())
    .route('/imports', importsRoutes())
    .route('/ai', aiRoutes())
    .route('/insights', insightsRoutes())
    .route('/recurring', recurringRoutes())
    .route('/settings', settingsRoutes())
    .route('/demo', demoRoutes())
    .route('/', analyticsRoutes());
}

/** Errors as JSON `{ error: { code, message } }` under /api, a plain 404 elsewhere. */
export function handleErrors(app: Hono): Hono {
  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: { code: err.code, message: err.message } }, err.status);
    if (err instanceof HTTPException && err.status < 500) return c.json({ error: { code: 'invalid_request', message: err.message } }, err.status);
    if (err instanceof NotFoundError) return c.json({ error: { code: 'not_found', message: err.message } }, 404);
    console.error(err);
    return c.json({ error: { code: 'internal', message: 'Unexpected server error' } }, 500);
  });
  app.notFound((c) =>
    c.req.path.startsWith('/api/') ? c.json({ error: { code: 'not_found', message: `No route for ${c.req.method} ${c.req.path}` } }, 404) : c.text('Not found', 404),
  );
  return app;
}
