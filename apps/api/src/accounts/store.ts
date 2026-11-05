import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Db } from '../db/database.ts';

export type AccountKind = 'user' | 'demo' | 'sandbox';

export interface Account {
  readonly id: string;
  readonly kind: AccountKind;
  readonly email: string | null;
  readonly name: string;
  readonly expiresAt: string | null;
  readonly createdAt: string;
}

interface AccountRow {
  id: string;
  kind: AccountKind;
  email: string | null;
  name: string;
  password: string | null;
  expires_at: string | null;
  created_at: string;
}

const toAccount = (r: AccountRow): Account => ({
  id: r.id,
  kind: r.kind,
  email: r.email,
  name: r.name,
  expiresAt: r.expires_at,
  createdAt: r.created_at,
});

/** Sessions of a signed-in user last 30 days and are renewed while in use. */
export const SESSION_TTL_MS = 30 * 24 * 3_600_000;
/** A demo copy lasts a day. */
export const SANDBOX_TTL_MS = 24 * 3_600_000;
const RENEW_AFTER_MS = 24 * 3_600_000;

// --- Accounts ------------------------------------------------------------------------------------

export function createAccount(
  sys: Db,
  input: { kind: AccountKind; name: string; email?: string | null; passwordHash?: string | null; expiresAt?: string | null; id?: string },
): Account {
  const row: AccountRow = {
    id: input.id ?? randomUUID(),
    kind: input.kind,
    email: input.email?.trim().toLowerCase() || null,
    name: input.name,
    password: input.passwordHash ?? null,
    expires_at: input.expiresAt ?? null,
    created_at: new Date().toISOString(),
  };
  sys
    .prepare('INSERT INTO accounts (id, kind, email, name, password, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(row.id, row.kind, row.email, row.name, row.password, row.expires_at, row.created_at);
  return toAccount(row);
}

export function getAccount(sys: Db, id: string): Account | null {
  const row = sys.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as AccountRow | undefined;
  return row ? toAccount(row) : null;
}

/** The account a login form names, with its password hash (null when none was ever set). */
export function findLogin(sys: Db, email: string): { account: Account; passwordHash: string | null } | null {
  const row = sys.prepare(`SELECT * FROM accounts WHERE email = ? AND kind = 'user'`).get(email.trim()) as AccountRow | undefined;
  return row ? { account: toAccount(row), passwordHash: row.password } : null;
}

export function listAccounts(sys: Db): (Account & { hasPassword: boolean })[] {
  const rows = sys.prepare('SELECT * FROM accounts ORDER BY kind, created_at').all() as unknown as AccountRow[];
  return rows.map((r) => ({ ...toAccount(r), hasPassword: r.password !== null }));
}

export function accountsOfKind(sys: Db, kind: AccountKind): Account[] {
  const rows = sys.prepare('SELECT * FROM accounts WHERE kind = ? ORDER BY created_at').all(kind) as unknown as AccountRow[];
  return rows.map(toAccount);
}

export function setPasswordHash(sys: Db, id: string, passwordHash: string): void {
  sys.prepare('UPDATE accounts SET password = ? WHERE id = ?').run(passwordHash, id);
  // A new password signs every device out.
  sys.prepare('DELETE FROM sessions WHERE account_id = ?').run(id);
}

export function updateAccount(sys: Db, id: string, change: { email?: string; name?: string }): void {
  if (change.email !== undefined) sys.prepare('UPDATE accounts SET email = ? WHERE id = ?').run(change.email.trim().toLowerCase(), id);
  if (change.name !== undefined) sys.prepare('UPDATE accounts SET name = ? WHERE id = ?').run(change.name.trim(), id);
}

/** Removes the account row and, by cascade, its sessions. The data file is the tenancy's job. */
export function deleteAccountRow(sys: Db, id: string): void {
  sys.prepare('DELETE FROM accounts WHERE id = ?').run(id);
}

/** Sandboxes past their expiry, and the oldest ones beyond `keep` (a cap on disk use). */
export function sandboxesToRemove(sys: Db, now: Date, keep: number): string[] {
  const expired = sys.prepare(`SELECT id FROM accounts WHERE kind = 'sandbox' AND expires_at <= ?`).all(now.toISOString()) as { id: string }[];
  const surplus = sys
    .prepare(`SELECT id FROM accounts WHERE kind = 'sandbox' AND expires_at > ? ORDER BY created_at DESC LIMIT -1 OFFSET ?`)
    .all(now.toISOString(), keep) as { id: string }[];
  return [...expired, ...surplus].map((r) => r.id);
}

// --- Sessions ------------------------------------------------------------------------------------

const tokenHash = (token: string): string => createHash('sha256').update(token).digest('hex');

/** A new session; the returned token goes in the cookie and is never stored as such. */
export function createSession(sys: Db, accountId: string, expiresAt: Date): string {
  const token = randomBytes(32).toString('base64url');
  sys
    .prepare('INSERT INTO sessions (token_hash, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(tokenHash(token), accountId, new Date().toISOString(), expiresAt.toISOString());
  return token;
}

/**
 * The account behind a session token, or null when the token is unknown or expired. A user's
 * session in use for more than a day is extended to a full period again (`renewedUntil`).
 */
export function sessionAccount(sys: Db, token: string, now = new Date()): { account: Account; renewedUntil: Date | null } | null {
  const row = sys
    .prepare(
      `SELECT a.*, s.created_at AS session_created, s.expires_at AS session_expires
       FROM sessions s JOIN accounts a ON a.id = s.account_id
       WHERE s.token_hash = ? AND s.expires_at > ? AND (a.expires_at IS NULL OR a.expires_at > ?)`,
    )
    .get(tokenHash(token), now.toISOString(), now.toISOString()) as (AccountRow & { session_expires: string }) | undefined;
  if (!row) return null;
  let renewedUntil: Date | null = null;
  if (row.kind === 'user' && Date.parse(row.session_expires) - now.getTime() < SESSION_TTL_MS - RENEW_AFTER_MS) {
    renewedUntil = new Date(now.getTime() + SESSION_TTL_MS);
    sys.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').run(renewedUntil.toISOString(), tokenHash(token));
  }
  return { account: toAccount(row), renewedUntil };
}

export function deleteSession(sys: Db, token: string): void {
  sys.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token));
}

export function purgeExpiredSessions(sys: Db, now = new Date()): void {
  sys.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now.toISOString());
}
