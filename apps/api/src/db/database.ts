import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS } from './migrations.ts';

export type Db = DatabaseSync;

/**
 * Where the databases live: `system.db` (accounts and sessions) and one file per account under
 * `accounts/`. `SPENDLENS_DATA_DIR` overrides it.
 */
export function dataDir(): string {
  return process.env['SPENDLENS_DATA_DIR'] ?? resolve(import.meta.dirname, '../../data');
}

/** Opens (and migrates) a database; `:memory:` gives a throwaway one (tests). */
export function openDatabase(path: string, migrations: readonly string[] = MIGRATIONS): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path, { enableForeignKeyConstraints: true });
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;');
  migrate(db, migrations);
  return db;
}

/** Forward-only migrations, tracked by `PRAGMA user_version`. */
export function migrate(db: Db, migrations: readonly string[]): void {
  const current = Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);
  for (let v = current; v < migrations.length; v++) {
    transaction(db, () => {
      db.exec(migrations[v]!);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
}

/** Runs `fn` in one SQLite transaction; any throw rolls the whole unit back. */
export function transaction<T>(db: Db, fn: () => T): T {
  if (db.isTransaction) return fn();
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
