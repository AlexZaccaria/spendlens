import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { Hono } from 'hono';
import { createApp } from '../app.ts';
import { openDatabase } from '../db/database.ts';
import { clientIp } from '../http/auth.ts';
import { getSetting, setSetting } from '../repo/settings.ts';
import { countTransactions, insertTransactions } from '../repo/transactions.ts';
import { hashPassword, verifyPassword } from './passwords.ts';
import { accountsOfKind, createSession, deleteSession, SANDBOX_TTL_MS, SESSION_TTL_MS, sessionAccount } from './store.ts';
import { Tenancy } from './tenancy.ts';

const dirs: string[] = [];
const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'spendlens-accounts-'));
  dirs.push(dir);
  return dir;
};
const opened: Tenancy[] = [];
const open = (dir = tempDir()): Tenancy => {
  const t = Tenancy.open(dir);
  opened.push(t);
  return t;
};
after(() => {
  for (const t of opened) t.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const row = (id: string) => ({
  date: '2026-10-01',
  rawDescription: `row ${id}`,
  title: { it: id, en: id },
  merchant: null,
  amountMinor: -1000,
  currency: 'EUR',
  baseAmountMinor: -1000,
  categoryId: 'food.groceries',
  confidence: 1,
  needsReview: false,
  account: null,
  note: null,
  importId: null,
  source: 'manual' as const,
});

describe('passwords', () => {
  it('verifies the right password only', async () => {
    const stored = await hashPassword('correct horse battery');
    assert.match(stored, /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    assert.equal(await verifyPassword('correct horse battery', stored), true);
    assert.equal(await verifyPassword('wrong', stored), false);
    assert.equal(await verifyPassword('anything', 'not a hash'), false);
  });
});

describe('tenancy', () => {
  it('gives each visitor a private copy of the demo that is deleted when it expires', () => {
    const t = open();
    const template = t.demoTemplate();
    const templateRows = countTransactions(t.db(template.id));
    assert.ok(templateRows > 100);

    const now = new Date();
    const a = t.createSandbox(now);
    const b = t.createSandbox(now);
    assert.equal(countTransactions(t.db(a.id)), templateRows);
    insertTransactions(t.db(a.id), [row('only-in-a')]);
    assert.equal(countTransactions(t.db(a.id)), templateRows + 1);
    assert.equal(countTransactions(t.db(b.id)), templateRows);
    assert.equal(countTransactions(t.db(template.id)), templateRows);

    t.sweep(new Date(now.getTime() + SANDBOX_TTL_MS + 1000));
    assert.equal(accountsOfKind(t.system, 'sandbox').length, 0);
    assert.equal(existsSync(join(dirs.at(-1)!, 'accounts', `${a.id}.db`)), false);
  });

  it('moves a single-database install: the data to the demo, the AI settings to an empty owner account', () => {
    const dir = tempDir();
    const legacy = openDatabase(join(dir, 'spendlens.db'));
    insertTransactions(legacy, [row('legacy')]);
    setSetting(legacy, 'ai', { provider: 'anthropic', authMode: 'oauth', oauthCredentialPath: 'C:/x/.credentials.json' });
    legacy.close();

    const t = open(dir);
    const demo = t.demoTemplate();
    assert.equal(countTransactions(t.db(demo.id)), 1);
    assert.equal(getSetting(t.db(demo.id), 'ai'), null);

    const [owner] = accountsOfKind(t.system, 'user');
    assert.ok(owner);
    assert.equal(countTransactions(t.db(owner.id)), 0);
    assert.deepEqual(getSetting(t.db(owner.id), 'ai'), { provider: 'anthropic', authMode: 'oauth', oauthCredentialPath: 'C:/x/.credentials.json' });
    assert.equal(existsSync(join(dir, 'spendlens.db')), false);
    assert.equal(existsSync(join(dir, 'spendlens.pre-accounts.db')), true);
  });
});

describe('sessions', () => {
  it('resolves a token until it expires, renews it while in use, and forgets it once deleted', () => {
    const t = open();
    const user = t.createUser({ email: 'A@Example.com', name: 'A', passwordHash: null });
    assert.equal(user.email, 'a@example.com');
    const start = Date.now();
    const idle = createSession(t.system, user.id, new Date(start + SESSION_TTL_MS));
    assert.equal(sessionAccount(t.system, idle, new Date(start))?.renewedUntil, null);
    assert.equal(sessionAccount(t.system, idle, new Date(start + SESSION_TTL_MS + 1000)), null);

    const used = createSession(t.system, user.id, new Date(start + SESSION_TTL_MS));
    const twoDaysLater = new Date(start + 2 * 86_400_000);
    assert.equal(sessionAccount(t.system, used, twoDaysLater)?.renewedUntil?.getTime(), twoDaysLater.getTime() + SESSION_TTL_MS);
    assert.ok(sessionAccount(t.system, used, new Date(start + SESSION_TTL_MS + 1000)));
    deleteSession(t.system, used);
    assert.equal(sessionAccount(t.system, used), null);
  });
});

describe('auth API', () => {
  const cookieOf = (res: Response): string => {
    const header = res.headers.get('set-cookie') ?? '';
    assert.match(header, /spendlens_session=[^;]+; .*HttpOnly/i);
    assert.match(header, /SameSite=Strict/i);
    return header.split(';')[0]!;
  };

  it('keeps every route but /api/auth behind a session, and each account on its own data', async () => {
    const t = open();
    t.createUser({ email: 'a@example.com', name: 'A', passwordHash: await hashPassword('password-of-a') });
    t.createUser({ email: 'b@example.com', name: 'B', passwordHash: await hashPassword('password-of-b') });
    const app = createApp(t);
    const json = (body: unknown, cookie?: string) => ({
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(cookie && { cookie }) },
      body: JSON.stringify(body),
    });

    assert.equal((await app.request('/api/meta')).status, 401);
    assert.deepEqual(await (await app.request('/api/auth/session')).json(), { account: null, registrationOpen: false, signInOpen: true });
    assert.equal((await app.request('/api/auth/register', { method: 'POST' })).status, 403);

    const wrong = await app.request('/api/auth/login', json({ email: 'a@example.com', password: 'nope' }));
    assert.equal(wrong.status, 401);
    const unknown = await app.request('/api/auth/login', json({ email: 'nobody@example.com', password: 'nope' }));
    assert.deepEqual(await unknown.json(), await wrong.json());

    const a = cookieOf(await app.request('/api/auth/login', json({ email: 'a@example.com', password: 'password-of-a' })));
    const b = cookieOf(await app.request('/api/auth/login', json({ email: 'B@example.com', password: 'password-of-b' })));
    const created = await app.request(
      '/api/transactions',
      json({ date: '2026-10-01', title: 'Only for A', amount: -12.5, currency: 'EUR', categoryId: 'food.groceries' }, a),
    );
    assert.equal(created.status, 201);
    const count = async (cookie: string) => ((await (await app.request('/api/meta', { headers: { cookie } })).json()) as { txCount: number }).txCount;
    assert.equal(await count(a), 1);
    assert.equal(await count(b), 0);

    await app.request('/api/auth/logout', json({}, a));
    assert.equal((await app.request('/api/meta', { headers: { cookie: a } })).status, 401);
  });

  it('opens a demo copy without AI in one call, and deletes it on logout', async () => {
    const t = open();
    const app = createApp(t);
    const res = await app.request('/api/auth/demo', { method: 'POST' });
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as { demo: boolean }).demo, true);
    const cookie = cookieOf(res);

    const meta = (await (await app.request('/api/meta', { headers: { cookie } })).json()) as { txCount: number; ai: { ready: boolean } };
    assert.ok(meta.txCount > 100);
    assert.equal(meta.ai.ready, false);
    assert.deepEqual(await (await app.request('/api/ai/health', { headers: { cookie } })).json(), { status: 'disabled', message: null });
    assert.equal((await app.request('/api/imports', { method: 'POST', headers: { cookie } })).status, 403);
    assert.equal((await app.request('/api/insights/2026-10', { method: 'POST', headers: { cookie } })).status, 403);
    const put = await app.request('/api/ai/settings', { method: 'PUT', headers: { cookie, 'content-type': 'application/json' }, body: '{"model":"x"}' });
    assert.equal(put.status, 403);

    assert.equal(accountsOfKind(t.system, 'sandbox').length, 1);
    await app.request('/api/auth/logout', { method: 'POST', headers: { cookie } });
    assert.equal(accountsOfKind(t.system, 'sandbox').length, 0);
  });

  it('lets a request still running finish when its demo is left meanwhile', async () => {
    const app = createApp(open());
    const cookie = cookieOf(await app.request('/api/auth/demo', { method: 'POST' }));
    // The request has its database and is reading its body when the visitor leaves (and the copy goes).
    const pending = app.request('/api/transactions', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ date: '2026-11-01', title: 'Late', amount: -10, currency: 'EUR', categoryId: 'food.groceries' }),
    });
    assert.equal((await app.request('/api/auth/logout', { method: 'POST', headers: { cookie } })).status, 200);
    assert.equal((await pending).status, 201);
  });
});

describe('client address', () => {
  const app = new Hono().get('/', (c) => c.text(clientIp(c)));
  const ip = async (forwardedFor: string): Promise<string> => (await app.request('/', { headers: { 'x-forwarded-for': forwardedFor } })).text();
  const withTrustProxy = async (value: string | undefined, check: () => Promise<void>): Promise<void> => {
    const before = process.env['TRUST_PROXY'];
    if (value === undefined) delete process.env['TRUST_PROXY'];
    else process.env['TRUST_PROXY'] = value;
    try {
      await check();
    } finally {
      if (before === undefined) delete process.env['TRUST_PROXY'];
      else process.env['TRUST_PROXY'] = before;
    }
  };

  it('ignores X-Forwarded-For unless told how many proxies to trust', () =>
    withTrustProxy(undefined, async () => {
      assert.equal(await ip('203.0.113.7'), 'unknown');
    }));

  it('takes the entry the trusted proxies added, whatever the client wrote before it', () =>
    withTrustProxy('1', async () => {
      assert.equal(await ip('203.0.113.7'), '203.0.113.7');
      assert.equal(await ip('6.6.6.6, 203.0.113.7'), '203.0.113.7');
    }).then(() =>
      withTrustProxy('2', async () => {
        assert.equal(await ip('6.6.6.6, 203.0.113.7, 198.51.100.1'), '203.0.113.7');
      }),
    ));
});
