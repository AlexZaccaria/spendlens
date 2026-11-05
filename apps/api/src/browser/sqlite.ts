/**
 * node:sqlite's DatabaseSync, the part the repositories use, on SQLite compiled to WebAssembly
 * (@sqlite.org/sqlite-wasm). The browser build aliases `node:sqlite` to this module, so the same
 * repository code runs on both. Same rules as Node's: `run`, `get` and `all` take positional values
 * or one object of named ones, where `{ id }` binds `:id`, `$id` or `@id`.
 *
 * Databases live in memory: `deserialize` opens a file image, `serialize` returns one.
 */

import init, { type Database, type PreparedStatement, type Sqlite3Static, type SqlValue } from '@sqlite.org/sqlite-wasm';

let sqlite3: Sqlite3Static | undefined;

/** Loads the WebAssembly module (once): databases can be opened after it resolves. */
export async function loadSqlite(): Promise<void> {
  sqlite3 ??= await init();
}

function api(): Sqlite3Static {
  if (!sqlite3) throw new Error('SQLite is not loaded: await loadSqlite() first');
  return sqlite3;
}

export type SqlParam = null | number | bigint | string | Uint8Array;
type Row = Record<string, SqlValue>;

/** Compiled statements kept per connection, by SQL text (least recently used goes first). */
const STATEMENT_CACHE = 200;

export class DatabaseSync {
  private readonly db: Database;
  private readonly statements = new Map<string, PreparedStatement>();

  constructor(path = ':memory:', options: { enableForeignKeyConstraints?: boolean } = {}) {
    if (path !== ':memory:') throw new Error('The browser build keeps its databases in memory');
    this.db = new (api().oo1.DB)(':memory:', 'c');
    if (options.enableForeignKeyConstraints ?? true) this.db.exec('PRAGMA foreign_keys = ON');
  }

  /** An in-memory database holding a copy of `image`, an SQLite file. */
  static deserialize(image: Uint8Array, options: { enableForeignKeyConstraints?: boolean } = {}): DatabaseSync {
    const db = new DatabaseSync(':memory:', options);
    const { capi, wasm } = api();
    // SQLite takes the buffer over and frees it on close (or right away, if the image is rejected).
    const buffer = wasm.allocFromTypedArray(plain(image));
    const flags = capi.SQLITE_DESERIALIZE_FREEONCLOSE | capi.SQLITE_DESERIALIZE_RESIZEABLE;
    db.db.checkRc(capi.sqlite3_deserialize(db.db, 'main', buffer, image.byteLength, image.byteLength, flags));
    return db;
  }

  /** The database as an SQLite file image. */
  serialize(): Uint8Array {
    return api().capi.sqlite3_js_db_export(this.db);
  }

  /** Rows written (inserted, updated, deleted) since the connection opened. */
  totalChanges(): number {
    return api().capi.sqlite3_total_changes(this.db);
  }

  get isOpen(): boolean {
    return this.db.isOpen();
  }

  get isTransaction(): boolean {
    return api().capi.sqlite3_get_autocommit(this.db) === 0;
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  prepare(sql: string): StatementSync {
    return new StatementSync(this, sql);
  }

  close(): void {
    for (const stmt of this.statements.values()) stmt.finalize();
    this.statements.clear();
    this.db.close();
  }

  /** The compiled form of `sql`, shared by every StatementSync with the same text. */
  compiled(sql: string): PreparedStatement {
    let stmt = this.statements.get(sql);
    if (stmt) this.statements.delete(sql);
    else stmt = this.db.prepare(sql);
    this.statements.set(sql, stmt);
    if (this.statements.size > STATEMENT_CACHE) {
      const [oldest, evicted] = this.statements.entries().next().value!;
      this.statements.delete(oldest);
      evicted.finalize();
    }
    return stmt;
  }

  /** Rows changed by the last statement and the last rowid inserted. */
  lastChange(): { changes: number; lastInsertRowid: number } {
    const { capi } = api();
    return { changes: capi.sqlite3_changes(this.db), lastInsertRowid: Number(capi.sqlite3_last_insert_rowid(this.db)) };
  }
}

export class StatementSync {
  private readonly db: DatabaseSync;
  private readonly sql: string;

  constructor(db: DatabaseSync, sql: string) {
    this.db = db;
    this.sql = sql;
    db.compiled(sql); // a syntax error surfaces here, as with Node
  }

  run(...params: unknown[]): { changes: number; lastInsertRowid: number } {
    this.execute(params, (stmt) => {
      while (stmt.step());
    });
    return this.db.lastChange();
  }

  get(...params: unknown[]): Row | undefined {
    return this.execute(params, (stmt) => (stmt.step() ? stmt.get({}) : undefined));
  }

  all(...params: unknown[]): Row[] {
    return this.execute(params, (stmt) => {
      const rows: Row[] = [];
      while (stmt.step()) rows.push(stmt.get({}));
      return rows;
    });
  }

  private execute<T>(params: unknown[], read: (stmt: PreparedStatement) => T): T {
    const stmt = this.db.compiled(this.sql);
    try {
      bind(stmt, params);
      return read(stmt);
    } finally {
      stmt.reset(true);
    }
  }
}

function bind(stmt: PreparedStatement, params: unknown[]): void {
  const [first] = params;
  if (params.length === 1 && isNamed(first)) {
    for (const [name, value] of Object.entries(first)) {
      const index = /^[:$@]/.test(name) ? stmt.getParamIndex(name) : [':', '$', '@'].map((p) => stmt.getParamIndex(p + name)).find((i) => i);
      if (!index) throw new Error(`Unknown named parameter '${name}'`);
      stmt.bind(index, bindable(value, name));
    }
    return;
  }
  params.forEach((value, i) => stmt.bind(i + 1, bindable(value, i + 1)));
}

const isNamed = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !ArrayBuffer.isView(value) && !(value instanceof ArrayBuffer);

function bindable(value: unknown, param: string | number): SqlParam {
  if (value === null || typeof value === 'number' || typeof value === 'bigint' || typeof value === 'string') return value;
  if (value instanceof Uint8Array) return plain(value);
  throw new TypeError(`Provided value cannot be bound to SQLite parameter ${param}.`);
}

/** sqlite-wasm takes Uint8Array itself, not a subclass such as Node's Buffer. */
const plain = (bytes: Uint8Array): Uint8Array =>
  bytes.constructor === Uint8Array ? bytes : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
