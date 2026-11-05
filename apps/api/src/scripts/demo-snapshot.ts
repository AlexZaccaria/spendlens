// Copies the demo account (the template demo visitors get) into the static demo's snapshot,
// apps/api/demo/spendlens-demo.db.gz, together with the day it is taken, which the static demo
// then runs on. Commit the file: the static build (npm run build:static) ships it.
//   npm run demo:snapshot
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { gzipSync } from 'node:zlib';
import { accountsOfKind } from '../accounts/store.ts';
import { PERSONAL_SETTINGS, Tenancy } from '../accounts/tenancy.ts';
import { dataDir } from '../db/database.ts';
import { SNAPSHOT_DAY_SETTING, snapshotPath } from '../demo/snapshot.ts';

const tenancy = new Tenancy(dataDir());
const template = accountsOfKind(tenancy.system, 'demo')[0];
if (!template) {
  console.error('No demo account yet: start the API once (npm run dev) or run npm run seed.');
  process.exit(1);
}

const scratch = mkdtempSync(join(tmpdir(), 'spendlens-snapshot-'));
try {
  const file = join(scratch, 'demo.db');
  tenancy.db(template.id).exec(`VACUUM INTO '${file.replaceAll("'", "''")}'`);

  const copy = new DatabaseSync(file);
  const placeholders = PERSONAL_SETTINGS.map(() => '?').join(', ');
  copy.prepare(`DELETE FROM settings WHERE key IN (${placeholders})`).run(...PERSONAL_SETTINGS);
  const { day } = copy.prepare(`SELECT max(date) AS day FROM transactions WHERE source = 'demo'`).get() as { day: string | null };
  if (!day) throw new Error('The demo account has no demo rows: run npm run seed first.');
  copy.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(SNAPSHOT_DAY_SETTING, JSON.stringify(day));
  // An in-memory database cannot open a WAL file: back to a rollback journal, then compact.
  copy.exec('PRAGMA journal_mode = DELETE; VACUUM;');
  const rows = copy.prepare('SELECT count(*) AS n FROM transactions').get() as { n: number };
  copy.close();

  const image = readFileSync(file);
  const out = snapshotPath();
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, gzipSync(image, { level: 9 }));
  const kb = (bytes: number): string => `${Math.round(bytes / 1024)} kB`;
  console.log(`Snapshot of ${rows.n} transactions, dated ${day}: ${relative(process.cwd(), out)} (${kb(image.length)}, ${kb(readFileSync(out).length)} gzipped).`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
