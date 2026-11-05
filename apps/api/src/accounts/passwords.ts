/**
 * Password hashing with argon2id from node:crypto (Node 24.7+), stored as a PHC string:
 * `$argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>`. The parameters are OWASP's minimum for argon2id
 * and travel with each hash, so they can be raised later without invalidating old passwords.
 */

import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const hash = promisify(argon2);

const PARAMS = { memory: 19_456, passes: 2, parallelism: 1, tagLength: 32 } as const;
const SALT_BYTES = 16;

export const MIN_PASSWORD_LENGTH = 10;

const b64 = (buf: Buffer): string => buf.toString('base64').replace(/=+$/, '');

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const tag = await hash('argon2id', { message: password, nonce: salt, ...PARAMS });
  return `$argon2id$v=19$m=${PARAMS.memory},t=${PARAMS.passes},p=${PARAMS.parallelism}$${b64(salt)}$${b64(tag)}`;
}

/** Constant-time comparison; a malformed stored value never matches. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const m = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/.exec(stored);
  if (!m) return false;
  const expected = Buffer.from(m[5]!, 'base64');
  const tag = await hash('argon2id', {
    message: password,
    nonce: Buffer.from(m[4]!, 'base64'),
    memory: Number(m[1]),
    passes: Number(m[2]),
    parallelism: Number(m[3]),
    tagLength: expected.length,
  });
  return timingSafeEqual(tag, expected);
}

/**
 * Spends the same time as a real check when the email is unknown, so the response time does not
 * tell which addresses have an account.
 */
let decoy: Promise<string> | null = null;
export async function verifyAgainstDecoy(password: string): Promise<false> {
  decoy ??= hashPassword(randomBytes(16).toString('hex'));
  await verifyPassword(password, await decoy);
  return false;
}
