import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { SessionAccount } from '@spendlens/contracts';
import { sessionAccount, type Account } from '../accounts/store.ts';
import type { Tenancy } from '../accounts/tenancy.ts';
import type { Db } from '../db/database.ts';
import { HttpError } from './validate.ts';

/** What every route behind the session middleware gets: the account and its own database. */
export type AccountEnv = { Variables: { account: Account; db: Db; holdAccount: () => () => void } };

export const SESSION_COOKIE = 'spendlens_session';

const isHttps = (c: Context): boolean => new URL(c.req.url).protocol === 'https:' || c.req.header('x-forwarded-proto') === 'https';

/**
 * HttpOnly (no script reads it) and SameSite=Strict (no other site can send it along, which also
 * covers CSRF: the API answers JSON only to its own pages). Secure whenever served over HTTPS.
 */
export function setSessionCookie(c: Context, token: string, expires: Date): void {
  setCookie(c, SESSION_COOKIE, token, { httpOnly: true, sameSite: 'Strict', path: '/', secure: isHttps(c), expires });
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: isHttps(c) });
}

export const sessionToken = (c: Context): string | undefined => getCookie(c, SESSION_COOKIE);

/** The session cookie names the account; the handlers get that account's database and no other. */
export function requireAccount(tenancy: Tenancy): MiddlewareHandler<AccountEnv> {
  return async (c, next) => {
    const token = sessionToken(c);
    const session = token ? sessionAccount(tenancy.system, token) : null;
    if (!token || !session) throw new HttpError(401, 'unauthenticated', 'Sign in first.');
    if (session.renewedUntil) setSessionCookie(c, token, session.renewedUntil);
    const done = tenancy.hold(session.account.id);
    try {
      c.set('account', session.account);
      c.set('db', tenancy.db(session.account.id));
      c.set('holdAccount', () => tenancy.hold(session.account.id));
      await next();
    } finally {
      done();
    }
  };
}

export const isDemo = (account: Account): boolean => account.kind !== 'user';

/** The demo has no AI: no provider settings, no imports, no monthly analysis. */
export function assertAiAllowed(c: Context<AccountEnv>): void {
  if (isDemo(c.var.account)) throw new HttpError(403, 'demo_ai_disabled', 'AI features are not available in the demo.');
}

export function sessionView(account: Account): SessionAccount {
  return { name: account.name, email: account.email, demo: isDemo(account), expiresAt: account.expiresAt };
}

/**
 * The client address. Behind reverse proxies the peer is the nearest proxy, so TRUST_PROXY=N (the number
 * of trusted proxies, 1 for a single proxy) takes the Nth x-forwarded-for entry from the end; unset or
 * invalid, the header is ignored because a client could forge it. In-process test requests have no peer address.
 */
export function clientIp(c: Context): string {
  const hops = Number.parseInt(process.env['TRUST_PROXY'] ?? '', 10);
  if (Number.isInteger(hops) && hops >= 1) {
    const entries = (c.req.header('x-forwarded-for') ?? '').split(',').map((e) => e.trim()).filter(Boolean);
    const forwarded = entries[Math.max(0, entries.length - hops)];
    if (forwarded) return forwarded;
  }
  try {
    return getConnInfo(c).remote.address ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Fixed-window attempt counter per key, in memory: enough for one process. */
export class RateLimit {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();
  private readonly limit: number;
  private readonly windowMs: number;

  constructor(limit: number, windowMs: number) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  /** Counts one attempt; false once the key is over the limit for the current window. */
  take(key: string, now = Date.now()): boolean {
    if (this.windows.size > 10_000) {
      for (const [k, w] of this.windows) if (w.resetAt <= now) this.windows.delete(k);
    }
    const window = this.windows.get(key);
    if (!window || window.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    window.count++;
    return window.count <= this.limit;
  }
}
