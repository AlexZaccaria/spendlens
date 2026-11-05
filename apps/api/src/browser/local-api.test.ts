import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { gunzipSync } from 'node:zlib';
import { todayIso, type Session, type TransactionPage } from '@spendlens/contracts';
import { Hono } from 'hono';
import { accountRoutes, handleErrors } from '../api.ts';
import { openDatabase } from '../db/database.ts';
import type { AccountEnv } from '../http/auth.ts';
import { snapshotPath } from '../demo/snapshot.ts';
import { startLocalApi, type LocalApi } from './local-api.ts';
import { memoryStore, type SandboxStore } from './store.ts';

// The static demo's API runs here on the Node build of the same SQLite WebAssembly module.
const image = gunzipSync(readFileSync(snapshotPath()));
const start = (store: SandboxStore, snapshotId = 'snapshot-1'): Promise<LocalApi> =>
  startLocalApi({ snapshotId, snapshot: async () => image, store });

const call = async <T>(api: LocalApi, method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> => {
  const init: RequestInit = body === undefined ? { method } : { method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } };
  const res = await api.fetch(new Request(`http://demo.test/api${path}`, init));
  return { status: res.status, body: (await res.json()) as T };
};

describe('API in the browser (static demo)', () => {
  it('enters the demo from the snapshot and serves it through the server routes', async () => {
    const api = await start(memoryStore());
    assert.equal(api.today, null);
    assert.equal((await call(api, 'GET', '/meta')).status, 401);
    const session = await call<Session>(api, 'GET', '/auth/session');
    assert.deepEqual([session.body.account, session.body.signInOpen, session.body.registrationOpen], [null, false, false]);
    assert.equal((await call(api, 'POST', '/auth/login', { email: 'a@b.c', password: 'x' })).status, 403);

    const demo = await call<{ demo: boolean }>(api, 'POST', '/auth/demo');
    assert.equal(demo.status, 200);
    assert.equal(demo.body.demo, true);

    const meta = await call<{ txCount: number; baseCurrency: string; ai: { ready: boolean } }>(api, 'GET', '/meta');
    const all = await call<TransactionPage>(api, 'GET', '/transactions?limit=1');
    assert.ok(meta.body.txCount > 0);
    assert.equal(all.body.total, meta.body.txCount);
    assert.equal(meta.body.ai.ready, false);
    // Full-text search runs on the WebAssembly build too (FTS5).
    const search = await call<TransactionPage>(api, 'GET', '/transactions?q=esselunga&limit=5');
    assert.ok(search.body.total > 0);
    assert.equal((await call(api, 'POST', '/insights/2026-10')).status, 403);
  });

  it('keeps the visitor’s changes across visits, on the snapshot’s day, until they leave', async () => {
    const store = memoryStore();
    const first = await start(store);
    await call(first, 'POST', '/auth/demo');
    const [tx] = (await call<TransactionPage>(first, 'GET', '/transactions?limit=1')).body.items;
    assert.equal((await call(first, 'PATCH', `/transactions/${tx!.id}`, { note: 'checked in the browser' })).status, 200);

    const second = await start(store);
    assert.match(second.today ?? '', /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(todayIso(), second.today);
    const again = await call<{ note: { it: string } | null }>(second, 'GET', `/transactions/${tx!.id}`);
    assert.equal(again.body.note?.it, 'checked in the browser');

    await call(second, 'POST', '/auth/logout');
    assert.equal(await store.load(), null);
    assert.equal((await call(second, 'GET', '/meta')).status, 401);
  });

  it('answers like the server on node:sqlite, byte for byte', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'spendlens-parity-'));
    after(() => rmSync(dir, { recursive: true, force: true }));
    writeFileSync(join(dir, 'demo.db'), image);
    const browser = await start(memoryStore());
    await call(browser, 'POST', '/auth/demo');
    const db = openDatabase(join(dir, 'demo.db'));
    const account = { id: 'demo', kind: 'sandbox', email: null, name: 'Demo', createdAt: '', expiresAt: null } as const;
    const routes = new Hono<AccountEnv>()
      .use(async (c, next) => {
        c.set('account', account);
        c.set('db', db);
        await next();
      })
      .route('/', accountRoutes());
    const server = handleErrors(new Hono().route('/api', routes));

    const month = todayIso().slice(0, 7);
    for (const path of [
      '/meta',
      `/summary?month=${month}`,
      `/trend?month=${month}&count=13`,
      '/transactions?limit=500&sort=amount',
      '/transactions?category=food&q=spesa&limit=50',
      '/recurring',
      '/recurring/merchants',
      '/imports',
      '/rules',
      `/insights/${month}`,
      '/ai/settings',
      '/ai/health',
    ]) {
      const expected = await (await server.request(`/api${path}`)).text();
      const actual = await (await browser.fetch(new Request(`http://demo.test/api${path}`))).text();
      assert.equal(actual, expected, path);
    }
    db.close();
  });

  it('drops a copy made from another snapshot', async () => {
    const store = memoryStore();
    await call(await start(store, 'old'), 'POST', '/auth/demo');
    const api = await start(store, 'new');
    assert.equal(api.today, null);
    assert.equal(await store.load(), null);
  });
});
