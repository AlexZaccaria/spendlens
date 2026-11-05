/**
 * Entry of the browser bundle (scripts/build-browser.ts), loaded by the web app's static build. The
 * snapshot and the WebAssembly module sit next to the bundle.
 */

import { startLocalApi, type LocalApi } from './local-api.ts';
import { indexedDbStore } from './store.ts';

/** Content hash of the snapshot, set by the build. */
declare const SNAPSHOT_ID: string;

export function start(): Promise<LocalApi> {
  return startLocalApi({
    snapshotId: SNAPSHOT_ID,
    snapshot: () => fetchSnapshot(new URL(`spendlens-demo.db.gz?v=${SNAPSHOT_ID}`, import.meta.url)),
    store: indexedDbStore(),
  });
}

async function fetchSnapshot(url: URL): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Demo snapshot: HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  // Already inflated if the host served it with Content-Encoding: gzip.
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;
  const inflated = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(inflated).arrayBuffer());
}
