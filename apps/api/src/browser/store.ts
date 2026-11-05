/// <reference lib="dom" />

/** The visitor's copy of the demo, kept between visits: the browser build's "disk". */
export interface StoredSandbox {
  /** The snapshot the copy started from: a new deploy with another snapshot discards the copy. */
  readonly snapshotId: string;
  readonly startedAt: string;
  /** The database, as an SQLite file image. */
  readonly image: Uint8Array;
}

export interface SandboxStore {
  load(): Promise<StoredSandbox | null>;
  save(sandbox: StoredSandbox): Promise<void>;
  clear(): Promise<void>;
}

/** One IndexedDB record per browser profile and site. */
export function indexedDbStore(name = 'spendlens-demo'): SandboxStore {
  const STORE = 'sandbox';
  const KEY = 'current';
  let connection: Promise<IDBDatabase> | null = null;
  const open = (): Promise<IDBDatabase> =>
    (connection ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }));
  const run = async <T>(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = op(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = tx.onabort = () => reject(tx.error ?? request.error);
    });
  };
  return {
    load: async () => ((await run('readonly', (s) => s.get(KEY))) as StoredSandbox | undefined) ?? null,
    save: async (sandbox) => void (await run('readwrite', (s) => s.put(sandbox, KEY))),
    clear: async () => void (await run('readwrite', (s) => s.delete(KEY))),
  };
}

/** For tests: the copy lives as long as the store object. */
export function memoryStore(): SandboxStore {
  let current: StoredSandbox | null = null;
  return {
    load: async () => current,
    save: async (sandbox) => void (current = sandbox),
    clear: async () => void (current = null),
  };
}
