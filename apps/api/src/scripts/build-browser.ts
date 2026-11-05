// Builds the API for the browser, for the static demo: one ES module with the routes and
// repositories, the SQLite WebAssembly binary and the demo snapshot, in apps/web/.local-api (the
// static build of the web app serves that folder at /local-api).
//   npm run build:browser [-- --out <dir>]
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { build, type Plugin } from 'esbuild';
import { snapshotPath } from '../demo/snapshot.ts';

const { values } = parseArgs({ options: { out: { type: 'string', default: resolve(import.meta.dirname, '../../../web/.local-api') } } });
const out = resolve(values.out);
const browser = resolve(import.meta.dirname, '../browser');

/** node:sqlite and node:crypto get browser implementations; what only the server has gets stand-ins. */
const SHIMS: Record<string, string> = { 'node:sqlite': 'sqlite.ts', 'node:crypto': 'crypto.ts' };
const SERVER_ONLY = ['node:fs', 'node:os', 'node:path', '@anthropic-ai/sdk', 'openai', 'unpdf', 'xlsx'];

const shims: Plugin = {
  name: 'browser-shims',
  setup(b) {
    const names = [...Object.keys(SHIMS), ...SERVER_ONLY].map((n) => n.replace(/[/.]/g, '\\$&'));
    b.onResolve({ filter: new RegExp(`^(${names.join('|')})$`) }, (args) => ({ path: join(browser, SHIMS[args.path] ?? 'server-only.ts') }));
  },
};

const snapshot = snapshotPath();
if (!existsSync(snapshot)) {
  console.error(`Missing ${relative(process.cwd(), snapshot)}: run npm run demo:snapshot first.`);
  process.exit(1);
}
const snapshotId = createHash('sha256').update(readFileSync(snapshot)).digest('hex').slice(0, 16);

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
await build({
  entryPoints: [join(browser, 'entry.ts')],
  outfile: join(out, 'spendlens-api.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  sourcemap: true,
  legalComments: 'linked',
  define: { SNAPSHOT_ID: JSON.stringify(snapshotId), 'process.env': '{}' },
  plugins: [shims],
  logLevel: 'warning',
});
copyFileSync(fileURLToPath(import.meta.resolve('@sqlite.org/sqlite-wasm/sqlite3.wasm')), join(out, 'sqlite3.wasm'));
copyFileSync(snapshot, join(out, 'spendlens-demo.db.gz'));
console.log(`Browser API built in ${relative(process.cwd(), out)} (snapshot ${snapshotId}).`);
