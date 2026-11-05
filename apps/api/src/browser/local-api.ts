/**
 * The API in the browser, for the static demo: the routes and repositories of the server, on SQLite
 * compiled to WebAssembly. A visitor who enters the demo gets a copy of the snapshot, kept in the
 * browser between visits; leaving the demo deletes it, as the server does with its sandboxes. Only
 * the ECB exchange rates come from the network.
 *
 * The web app's static build sends its /api requests here (apps/web/src/app/core/backend.static.ts).
 */

import { setToday, type Session } from '@spendlens/contracts';
import { Hono } from 'hono';
import { SANDBOX_TTL_MS, type Account } from '../accounts/store.ts';
import { accountRoutes, handleErrors } from '../api.ts';
import { migrate, type Db } from '../db/database.ts';
import { MIGRATIONS } from '../db/migrations.ts';
import { sessionView, type AccountEnv } from '../http/auth.ts';
import { HttpError } from '../http/validate.ts';
import { SNAPSHOT_DAY_SETTING } from '../demo/snapshot.ts';
import { getSetting } from '../repo/settings.ts';
import { DatabaseSync, loadSqlite } from './sqlite.ts';
import type { SandboxStore } from './store.ts';

export interface LocalApiOptions {
  /** Identifies the snapshot: a stored copy of another snapshot is discarded. */
  readonly snapshotId: string;
  /** The demo snapshot, an SQLite file image; fetched when a visitor enters the demo. */
  readonly snapshot: () => Promise<Uint8Array>;
  readonly store: SandboxStore;
}

export interface LocalApi {
  /** The day the demo's data was captured, which the demo runs on; null outside the demo. */
  readonly today: string | null;
  fetch(request: Request): Promise<Response>;
}

class Sandbox {
  readonly account: Account;
  readonly file: DatabaseSync;
  /** The same connection, as the repositories see it: the shim covers the node:sqlite they use. */
  readonly db: Db;
  /** Rows written when the copy was last saved. */
  savedChanges = -1;

  constructor(image: Uint8Array, startedAt: string) {
    this.file = DatabaseSync.deserialize(image);
    this.db = this.file as unknown as Db;
    migrate(this.db, MIGRATIONS);
    this.account = {
      id: 'demo',
      kind: 'sandbox',
      email: null,
      name: 'Demo',
      createdAt: startedAt,
      expiresAt: new Date(Date.parse(startedAt) + SANDBOX_TTL_MS).toISOString(),
    };
    const day = getSetting<string>(this.db, SNAPSHOT_DAY_SETTING);
    if (day) setToday(day);
  }

  get today(): string | null {
    return getSetting<string>(this.db, SNAPSHOT_DAY_SETTING);
  }
}

export async function startLocalApi(options: LocalApiOptions): Promise<LocalApi> {
  await loadSqlite();
  let sandbox = await restore(options);
  let saving = Promise.resolve();

  const save = (current: Sandbox): Promise<void> => {
    current.savedChanges = current.file.totalChanges();
    const image = current.file.serialize();
    saving = saving.then(() => options.store.save({ snapshotId: options.snapshotId, startedAt: current.account.createdAt, image }));
    return saving;
  };

  const leave = (): void => {
    sandbox?.file.close();
    sandbox = null;
  };

  const auth = new Hono()
    .get('/session', (c) =>
      c.json({ account: sandbox ? sessionView(sandbox.account) : null, registrationOpen: false, signInOpen: false } satisfies Session),
    )
    .post('/login', () => {
      throw new HttpError(403, 'sign_in_unavailable', 'This online version has the demo only.');
    })
    .post('/demo', async (c) => {
      leave();
      const entered = new Sandbox(await options.snapshot(), new Date().toISOString());
      try {
        await save(entered);
      } catch {
        entered.file.close();
        throw new HttpError(503, 'storage_unavailable', 'This browser does not let the demo keep its data.');
      }
      sandbox = entered;
      return c.json(sessionView(entered.account));
    })
    .post('/logout', async (c) => {
      leave();
      await options.store.clear().catch(() => undefined);
      return c.json({ ok: true });
    })
    .post('/register', () => {
      throw new HttpError(403, 'registration_closed', 'Registration is closed.');
    });

  const api = new Hono<AccountEnv>()
    .use(async (c, next) => {
      if (!sandbox) throw new HttpError(401, 'unauthenticated', 'Enter the demo first.');
      c.set('account', sandbox.account);
      c.set('db', sandbox.db);
      await next();
    })
    .route('/', accountRoutes());

  const app = new Hono();
  app.route('/api/auth', auth);
  app.route('/api', api);
  handleErrors(app);

  return {
    today: sandbox?.today ?? null,
    async fetch(request) {
      const response = await app.fetch(request);
      // What a request changed is stored before the page sees the answer.
      if (sandbox && sandbox.file.totalChanges() !== sandbox.savedChanges) await save(sandbox);
      return response;
    },
  };
}

/** The copy of a previous visit, if it is still there, of this snapshot and not expired. */
async function restore(options: LocalApiOptions): Promise<Sandbox | null> {
  const stored = await options.store.load().catch(() => null);
  if (!stored) return null;
  if (stored.snapshotId !== options.snapshotId || Date.parse(stored.startedAt) + SANDBOX_TTL_MS <= Date.now()) {
    await options.store.clear().catch(() => undefined);
    return null;
  }
  const sandbox = new Sandbox(stored.image, stored.startedAt);
  sandbox.savedChanges = sandbox.file.totalChanges();
  return sandbox;
}
