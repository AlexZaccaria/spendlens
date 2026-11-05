/**
 * Anthropic OAuth credentials — the Claude subscription path, as in Solexma.
 *
 * Two shapes, in precedence order:
 *   - a credentials FILE (Claude Code's `.credentials.json`): the path is stored and the file is
 *     re-read on every call, so the token Claude Code keeps refreshed is always the one used; when
 *     it is about to expire and a refresh token is present, we refresh it ourselves and write it
 *     back exactly as Claude Code would;
 *   - an imported SNAPSHOT of such a file: refreshed in memory only, so it eventually goes stale.
 *
 * Tokens never leave this module except as the bearer of the outgoing request.
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { CredentialCandidate } from '@spendlens/contracts';
import { AiError } from '../errors.ts';
import type { AiSettings } from '../settings.ts';

// Verbatim from Claude Code: the public OAuth client and token endpoint.
const OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const OAUTH_TOKEN_URL = 'https://platform.claude.com/v1/oauth/token';
/** Refresh a little before the real expiry so a call never races the boundary. */
const EXPIRY_SKEW_MS = 5 * 60 * 1000;

type Rec = Record<string, unknown>;
const isRec = (x: unknown): x is Rec => typeof x === 'object' && x !== null && !Array.isArray(x);
const str = (x: unknown): string => (typeof x === 'string' ? x : '');

/** The object holding the token, whichever nesting the file uses. */
function oauthObject(raw: Rec): Rec {
  if (isRec(raw['claudeAiOauth'])) return raw['claudeAiOauth']; // Claude Code / claude.ai
  if (isRec(raw['oauth'])) return raw['oauth'];
  return raw; // `ant` CLI file or a bare token object
}

const accessTokenOf = (o: Rec): string => str(o['accessToken']) || str(o['access_token']);
const refreshTokenOf = (o: Rec): string => str(o['refreshToken']) || str(o['refresh_token']);

/** `expiresAt` is ms in the Claude Code shape and seconds in the `ant` shape. */
function expiresAtMs(o: Rec): number | null {
  const raw = o['expiresAt'] ?? o['expires_at'];
  return typeof raw === 'number' ? (raw > 1e12 ? raw : raw * 1000) : null;
}

interface ParsedCredential {
  readonly parsed: Rec;
  readonly token: string;
  readonly refreshToken: string;
  readonly expiresAtMs: number | null;
}

function parseCredential(blob: string): ParsedCredential | null {
  try {
    const parsed: unknown = JSON.parse(blob);
    if (!isRec(parsed)) return null;
    const o = oauthObject(parsed);
    const token = accessTokenOf(o);
    return token ? { parsed, token, refreshToken: refreshTokenOf(o), expiresAtMs: expiresAtMs(o) } : null;
  } catch {
    return null;
  }
}

interface Refreshed {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly expiresAtMs: number | null;
}

async function refreshToken(refresh: string, fetchImpl: typeof fetch): Promise<Refreshed | null> {
  if (refresh === '') return null;
  try {
    const res = await fetchImpl(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: refresh, client_id: OAUTH_CLIENT_ID }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const j: unknown = await res.json();
    if (!isRec(j) || !str(j['access_token'])) return null;
    const expiresIn = typeof j['expires_in'] === 'number' ? j['expires_in'] : null;
    return {
      accessToken: str(j['access_token']),
      refreshToken: str(j['refresh_token']) || null,
      expiresAtMs: expiresIn !== null ? Date.now() + expiresIn * 1000 : null,
    };
  } catch {
    return null;
  }
}

/** Writes the refreshed token back with the key casing the file already uses. */
function applyRefresh(parsed: Rec, r: Refreshed): string {
  const o = oauthObject(parsed);
  const camel = 'accessToken' in o || 'expiresAt' in o || !('access_token' in o);
  if (camel) {
    o['accessToken'] = r.accessToken;
    if (r.refreshToken !== null) o['refreshToken'] = r.refreshToken;
    if (r.expiresAtMs !== null) o['expiresAt'] = r.expiresAtMs;
  } else {
    o['access_token'] = r.accessToken;
    if (r.refreshToken !== null) o['refresh_token'] = r.refreshToken;
    if (r.expiresAtMs !== null) o['expires_at'] = Math.floor(r.expiresAtMs / 1000);
  }
  return JSON.stringify(parsed, null, 2);
}

const isStale = (c: ParsedCredential): boolean => c.expiresAtMs !== null && c.expiresAtMs < Date.now() + EXPIRY_SKEW_MS;
const isExpired = (c: ParsedCredential): boolean => c.expiresAtMs !== null && c.expiresAtMs < Date.now();

/** The bearer token for the configured OAuth credential, refreshed when about to expire. */
export async function resolveOAuthToken(settings: AiSettings, fetchImpl: typeof fetch = fetch): Promise<string> {
  const path = settings.oauthCredentialPath.trim();
  if (path !== '') {
    let blob: string;
    try {
      blob = readFileSync(path, 'utf8');
    } catch {
      throw new AiError('ai_not_configured', `Cannot read the credentials file at "${path}".`);
    }
    const cred = parseCredential(blob);
    if (!cred) throw new AiError('ai_not_configured', `The credentials file at "${path}" holds no OAuth access token.`);
    if (!isStale(cred)) return cred.token;
    const refreshed = await refreshToken(cred.refreshToken, fetchImpl);
    if (refreshed) {
      try {
        writeFileSync(path, applyRefresh(cred.parsed, refreshed));
      } catch {
        // best effort: the fresh token in hand still works for this call
      }
      return refreshed.accessToken;
    }
    if (isExpired(cred)) throw new AiError('ai_not_configured', `The token in "${path}" expired and could not be refreshed — sign in again.`);
    return cred.token;
  }
  if (settings.oauthCredential.trim() !== '') {
    const cred = parseCredential(settings.oauthCredential);
    if (!cred) throw new AiError('ai_not_configured', 'The imported credential holds no access token — import it again.');
    if (!isStale(cred)) return cred.token;
    const refreshed = await refreshToken(cred.refreshToken, fetchImpl);
    if (refreshed) return refreshed.accessToken;
    if (isExpired(cred)) throw new AiError('ai_not_configured', 'The imported credential expired and could not be refreshed — import a fresh file.');
    return cred.token;
  }
  throw new AiError('ai_not_configured', 'No OAuth credential configured — pick a credentials file or import one.');
}

// --- Discovery and import ---------------------------------------------------------------------

/** Standard locations of Anthropic OAuth credential files on this host. */
export function credentialCandidatePaths(): string[] {
  const home = homedir();
  const files = new Set<string>();
  const cfg = process.env['CLAUDE_CONFIG_DIR'];
  if (cfg) files.add(join(cfg, '.credentials.json'));
  for (const dir of ['.claude', '.claude-personal', '.claude-work']) files.add(join(home, dir, '.credentials.json'));
  files.add(join(home, '.config', 'claude', '.credentials.json'));
  const appdata = process.env['APPDATA'];
  if (appdata) {
    try {
      const dir = join(appdata, 'Anthropic', 'credentials');
      for (const f of readdirSync(dir)) if (f.endsWith('.json')) files.add(join(dir, f));
    } catch {
      // no `ant` credentials directory
    }
  }
  return [...files];
}

/** A display label: the subscription and the profile directory, never the token. */
function accountLabel(raw: Rec, path: string | null): string {
  const o = oauthObject(raw);
  const pick = (k: string): string => str(o[k]) || str(raw[k]);
  const org = pick('organization_name');
  const email = pick('account_email');
  const sub = pick('subscriptionType') || pick('subscription_type');
  const primary = org || email || (sub ? `Claude ${sub.charAt(0).toUpperCase()}${sub.slice(1)}` : 'Anthropic OAuth');
  if (!path) return primary;
  const where = basename(path) === '.credentials.json' ? basename(dirname(path)) : basename(path, '.json');
  return `${primary} · ${where}`;
}

export function listCredentialCandidates(): Omit<CredentialCandidate, 'hidden'>[] {
  const out: Omit<CredentialCandidate, 'hidden'>[] = [];
  for (const path of credentialCandidatePaths()) {
    try {
      const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
      if (!isRec(raw)) continue;
      const o = oauthObject(raw);
      if (!accessTokenOf(o)) continue;
      const exp = expiresAtMs(o);
      out.push({ path, account: accountLabel(raw, path), expiresAt: exp === null ? null : new Date(exp).toISOString() });
    } catch {
      // missing or unreadable: not a candidate
    }
  }
  return out;
}

export interface ImportedCredential {
  readonly credential: string;
  readonly account: string;
  /** Where the same token lives on this host ("" when not found): lets later calls re-read it. */
  readonly path: string;
}

/** Validates an uploaded credentials file (Claude Code, `ant`, or a bare token object). */
export function importAnthropicCredential(raw: unknown): ImportedCredential {
  if (!isRec(raw)) throw new AiError('ai_not_configured', 'Not a JSON object.');
  const token = accessTokenOf(oauthObject(raw));
  if (!token) {
    throw new AiError('ai_not_configured', 'No OAuth access token found — expected a Claude Code .credentials.json or an `ant` credentials file.');
  }
  let path = '';
  for (const candidate of credentialCandidatePaths()) {
    try {
      const onDisk: unknown = JSON.parse(readFileSync(candidate, 'utf8'));
      if (isRec(onDisk) && accessTokenOf(oauthObject(onDisk)) === token) {
        path = candidate;
        break;
      }
    } catch {
      // keep scanning
    }
  }
  return { credential: JSON.stringify(raw), account: accountLabel(raw, path || null), path };
}

/** Label for a configured credential file path (settings page, test result). */
export function accountForPath(path: string): string {
  try {
    const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return isRec(raw) ? accountLabel(raw, path) : '';
  } catch {
    return '';
  }
}
