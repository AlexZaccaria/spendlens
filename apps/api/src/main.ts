import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Tenancy } from './accounts/tenancy.ts';
import { createApp } from './app.ts';

const port = Number(process.env['PORT'] ?? 4300);
const host = process.env['HOST'] ?? '127.0.0.1';
const tenancy = Tenancy.open();
const app = createApp(tenancy, { log: process.env['NODE_ENV'] !== 'test' });

// Expired demo copies and sessions are deleted every hour.
const sweeper = setInterval(() => tenancy.sweep(), 3_600_000);
sweeper.unref();

// In production the API also serves the built Angular app, so one process runs everything.
const webRoot = resolve(import.meta.dirname, '../../web/dist/web/browser');
if (existsSync(webRoot)) {
  const indexHtml = readFileSync(resolve(webRoot, 'index.html'), 'utf8');
  app.use('/*', serveStatic({ root: webRoot }));
  app.get('*', (c) => (c.req.path.startsWith('/api/') ? c.notFound() : c.html(indexHtml)));
}

const server = serve({ fetch: app.fetch, port, hostname: host }, (info) => {
  console.log(`Spendlens API on http://${info.address}:${info.port}${existsSync(webRoot) ? ' (serving the web app)' : ''}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    clearInterval(sweeper);
    server.close();
    tenancy.close();
    process.exit(0);
  });
}
