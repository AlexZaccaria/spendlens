/**
 * One database file per account. A request works on its account's file only, so the data of two
 * accounts cannot meet in a query: there is no account column to forget in a WHERE clause.
 *
 *   <data>/system.db           accounts and sessions
 *   <data>/accounts/<id>.db    the data of one account (transactions, imports, rules, settings)
 *
 * The demo is a template account nobody signs in to; each visitor gets a sandbox, a copy of the
 * template made with VACUUM INTO, deleted a day later.
 */

import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir, openDatabase, transaction, type Db } from '../db/database.ts';
import { seedDemo } from '../demo/seed.ts';
import { getSetting, setSetting } from '../repo/settings.ts';
import { SYSTEM_MIGRATIONS } from './schema.ts';
import {
  accountsOfKind,
  createAccount,
  deleteAccountRow,
  listAccounts,
  purgeExpiredSessions,
  SANDBOX_TTL_MS,
  sandboxesToRemove,
  type Account,
} from './store.ts';

/** Live sandboxes kept at most; beyond it the oldest go first. */
export const MAX_SANDBOXES = 100;
/** Login of the owner account created by the one-time migration, until renamed. */
export const OWNER_PLACEHOLDER_EMAIL = 'me@spendlens.local';

/** Settings that belong to a person, never copied into the demo: the AI credentials. */
export const PERSONAL_SETTINGS = ['ai', 'ai.hiddenCredentials'] as const;

export class Tenancy {
  readonly system: Db;
  private readonly dir: string;
  private readonly pool = new Map<string, Db>();
  private readonly inFlight = new Map<string, number>();
  private readonly pendingClose = new Map<string, Db>();


  constructor(dir: string) {
    this.dir = dir;
    this.system = openDatabase(join(dir, 'system.db'), SYSTEM_MIGRATIONS);
  }

  /** Opens the data directory, moves a single-database install over and prepares the demo. */
  static open(dir = dataDir()): Tenancy {
    const tenancy = new Tenancy(dir);
    tenancy.migrateLegacy(join(dir, 'spendlens.db'));
    tenancy.demoTemplate();
    tenancy.sweep();
    return tenancy;
  }

  private file(accountId: string): string {
    return join(this.dir, 'accounts', `${accountId}.db`);
  }

  /** The account's database, opened once and kept. */
  db(accountId: string): Db {
    let db = this.pool.get(accountId);
    if (!db) {
      db = openDatabase(this.file(accountId));
      this.pool.set(accountId, db);
    }
    return db;
  }

  /** The demo every visitor copies; on a fresh install it is created with generated data. */
  demoTemplate(): Account {
    const existing = accountsOfKind(this.system, 'demo')[0];
    if (existing) return existing;
    const account = createAccount(this.system, { kind: 'demo', name: 'Demo' });
    seedDemo(this.db(account.id));
    return account;
  }

  createUser(input: { email: string; name: string; passwordHash: string | null }): Account {
    const account = createAccount(this.system, { kind: 'user', ...input });
    this.db(account.id);
    return account;
  }

  /** A visitor's private copy of the demo, valid for a day. */
  createSandbox(now = new Date()): Account {
    const template = this.demoTemplate();
    const account = createAccount(this.system, { kind: 'sandbox', name: 'Demo', expiresAt: new Date(now.getTime() + SANDBOX_TTL_MS).toISOString() });
    this.copy(this.db(template.id), account.id);
    this.sweep(now, account.id);
    return account;
  }

  /**
   * Deletes the account and its sessions, then its data file. False when the file is still open in
   * another process (Windows refuses to delete it): that process removes it at its next sweep.
   */
  removeAccount(accountId: string): boolean {
    this.release(accountId);
    deleteAccountRow(this.system, accountId);
    return this.deleteFiles(`${accountId}.db`);
  }

  /** Removes expired sandboxes (and the oldest beyond the cap), expired sessions and orphan files. */
  sweep(now = new Date(), protectId?: string): void {
    for (const id of sandboxesToRemove(this.system, now, MAX_SANDBOXES)) if (id !== protectId) this.removeAccount(id);
    purgeExpiredSessions(this.system, now);
    this.collectOrphans();
  }

  /** Files of accounts deleted elsewhere (the command line) while this process had them open. */
  private collectOrphans(): void {
    const live = new Set(listAccounts(this.system).map((a) => a.id));
    for (const id of [...this.pool.keys()]) if (!live.has(id)) this.release(id);
    let files: string[] = [];
    try {
      files = readdirSync(join(this.dir, 'accounts'));
    } catch {
      return; // no accounts directory yet
    }
    for (const name of files) {
      const id = name.replace(/\.db(-wal|-shm)?$/, '');
      if (name.endsWith('.db') && !live.has(id)) this.deleteFiles(name);
    }
  }

  /**
   * Marks the account's database as in use by a request; the returned function ends that use. A
   * release while requests are in flight closes the handle only when the last one ends.
   */
  hold(accountId: string): () => void {
    this.inFlight.set(accountId, (this.inFlight.get(accountId) ?? 0) + 1);
    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      const left = (this.inFlight.get(accountId) ?? 1) - 1;
      if (left > 0) {
        this.inFlight.set(accountId, left);
        return;
      }
      this.inFlight.delete(accountId);
      this.pendingClose.get(accountId)?.close();
      this.pendingClose.delete(accountId);
    };
  }

  private release(accountId: string): void {
    const db = this.pool.get(accountId);
    this.pool.delete(accountId);
    if (!db) return;
    if (this.inFlight.has(accountId)) this.pendingClose.set(accountId, db);
    else db.close();
  }

  private deleteFiles(dbName: string): boolean {
    try {
      for (const suffix of ['', '-wal', '-shm']) rmSync(join(this.dir, 'accounts', dbName + suffix), { force: true });
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EPERM' || (err as NodeJS.ErrnoException).code === 'EBUSY') return false;
      throw err;
    }
  }

  /** A consistent copy of a live database into a new account's file. */
  private copy(source: Db, accountId: string): void {
    mkdirSync(join(this.dir, 'accounts'), { recursive: true });
    source.exec(`VACUUM INTO '${this.file(accountId).replaceAll("'", "''")}'`);
  }

  /**
   * One-time move from the single-database layout (`spendlens.db`): the existing data becomes the
   * demo template, without the AI settings, and the owner gets a new, empty account that keeps
   * those AI settings. The original file stays next to it, renamed, as a backup.
   */
  migrateLegacy(legacyPath: string): void {
    if (!existsSync(legacyPath) || listAccounts(this.system).length > 0) return;
    const legacy = openDatabase(legacyPath);
    const personal = PERSONAL_SETTINGS.map((key) => [key, getSetting<unknown>(legacy, key)] as const);

    const demo = createAccount(this.system, { kind: 'demo', name: 'Demo' });
    this.copy(legacy, demo.id);
    legacy.close();
    const demoDb = this.db(demo.id);
    transaction(demoDb, () => {
      for (const key of PERSONAL_SETTINGS) demoDb.prepare('DELETE FROM settings WHERE key = ?').run(key);
    });

    const owner = this.createUser({
      email: process.env['SPENDLENS_OWNER_EMAIL'] ?? OWNER_PLACEHOLDER_EMAIL,
      name: process.env['SPENDLENS_OWNER_NAME'] ?? 'Personale',
      passwordHash: null,
    });
    const ownerDb = this.db(owner.id);
    for (const [key, value] of personal) if (value !== null) setSetting(ownerDb, key, value);

    try {
      renameSync(legacyPath, legacyPath.replace(/\.db$/, '.pre-accounts.db'));
    } catch (err) {
      console.warn(`Could not rename ${legacyPath} (the data is already copied): ${String(err)}`);
    }
    console.log(
      `Moved the existing data to the demo account. Your account ${owner.email} is empty and has no password yet: ` +
        `npm run account -- password ${owner.email}`,
    );
  }

  close(): void {
    for (const db of this.pool.values()) db.close();
    this.pool.clear();
    for (const db of this.pendingClose.values()) db.close();
    this.pendingClose.clear();
    this.system.close();
  }
}
