/**
 * The node:crypto calls of the bundled modules, for the browser build: SHA-256, synchronous as in
 * Node (@noble/hashes), and random UUIDs (Web Crypto). Session tokens and passwords stay on the
 * server.
 */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { unavailable } from './server-only.ts';

export function createHash(algorithm: string) {
  if (algorithm !== 'sha256') throw new Error(`Hash ${algorithm} is not in the browser build`);
  const hash = sha256.create();
  return {
    update(data: string | Uint8Array) {
      hash.update(typeof data === 'string' ? utf8ToBytes(data) : data);
      return this;
    },
    digest(encoding: 'hex'): string {
      if (encoding !== 'hex') throw new Error(`Digest encoding ${encoding} is not in the browser build`);
      return bytesToHex(hash.digest());
    },
  };
}

export const randomUUID = (): string => crypto.randomUUID();
export const randomBytes = unavailable('crypto.randomBytes');
