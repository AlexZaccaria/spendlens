/**
 * The system database: who can sign in and the open sessions. The data of each account lives in
 * its own database file (see tenancy.ts), so nothing here holds a transaction or a setting.
 * Index i upgrades from user_version i to i+1. Append only.
 */
export const SYSTEM_MIGRATIONS: readonly string[] = [
  /* sql */ `
  CREATE TABLE accounts (
    id         TEXT PRIMARY KEY,
    -- user: signs in with email and password. demo: the template every demo visitor gets a copy of.
    -- sandbox: one visitor's copy of the demo, deleted when it expires.
    kind       TEXT NOT NULL CHECK (kind IN ('user', 'demo', 'sandbox')),
    email      TEXT UNIQUE COLLATE NOCASE,
    name       TEXT NOT NULL,
    password   TEXT,                             -- argon2id, PHC string; null: cannot sign in
    expires_at TEXT,
    created_at TEXT NOT NULL
  ) STRICT;
  CREATE INDEX accounts_expiry ON accounts (expires_at) WHERE expires_at IS NOT NULL;

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,                 -- SHA-256 of the cookie value: a leaked table opens nothing
    account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  ) STRICT;
  CREATE INDEX sessions_account ON sessions (account_id);
  `,
];
