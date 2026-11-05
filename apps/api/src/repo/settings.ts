import { DEFAULT_BASE_CURRENCY } from '@spendlens/contracts';
import type { Db } from '../db/database.ts';

export function getSetting<T>(db: Db, key: string): T | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as T) : null;
}

export function setSetting(db: Db, key: string, value: unknown): void {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(
    key,
    JSON.stringify(value),
  );
}

export function baseCurrency(db: Db): string {
  return getSetting<string>(db, 'baseCurrency') ?? DEFAULT_BASE_CURRENCY;
}
