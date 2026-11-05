import type { Rule } from '@spendlens/contracts';
import type { Db } from '../db/database.ts';
import { num, str } from '../db/rows.ts';
import { merchantKey, newId, nowIso } from '../lib/text.ts';

const toRule = (row: Record<string, unknown>): Rule => ({
  id: str(row['id']),
  pattern: str(row['pattern']),
  categoryId: str(row['category_id']),
  hits: num(row['hits']),
  createdAt: str(row['created_at']),
});

export function listRules(db: Db): Rule[] {
  return db.prepare('SELECT * FROM rules ORDER BY hits DESC, created_at DESC').all().map(toRule);
}

export function upsertRule(db: Db, pattern: string, categoryId: string): void {
  db.prepare(
    `INSERT INTO rules (id, pattern, category_id, hits, created_at) VALUES (?, ?, ?, 0, ?)
     ON CONFLICT (pattern) DO UPDATE SET category_id = excluded.category_id`,
  ).run(newId(), pattern, categoryId, nowIso());
}

export function deleteRule(db: Db, id: string): boolean {
  return Number(db.prepare('DELETE FROM rules WHERE id = ?').run(id).changes) === 1;
}

/** The category a rule forces for this merchant, counting the hit; null when no rule matches. */
export function categoryFromRules(db: Db, merchant: string | null): string | null {
  const key = merchantKey(merchant);
  if (!key) return null;
  const row = db.prepare('SELECT id, category_id FROM rules WHERE pattern = ?').get(key) as { id: string; category_id: string } | undefined;
  if (!row) return null;
  db.prepare('UPDATE rules SET hits = hits + 1 WHERE id = ?').run(row.id);
  return row.category_id;
}
