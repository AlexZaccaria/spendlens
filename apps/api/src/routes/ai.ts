import { createHash } from 'node:crypto';
import type { AiHealth, AiModel } from '@spendlens/contracts';
import { aiSettingsUpdateSchema, credentialVisibilitySchema } from '@spendlens/contracts/schemas';
import { Hono } from 'hono';
import { z } from 'zod';
import { credentialAccount, credentialCandidates, importCredential } from '../ai/credentials.ts';
import { AiError, toAiError } from '../ai/errors.ts';
import { listModels } from '../ai/provider.ts';
import {
  aiReadiness,
  clearCredential,
  getAiSettings,
  hiddenCredentialPaths,
  setCredentialHidden,
  setOauthAccount,
  storeImportedCredential,
  toAiSettingsView,
  updateAiSettings,
  type AiSettings,
} from '../ai/settings.ts';
import type { Db } from '../db/database.ts';
import { HttpError, validate } from '../http/validate.ts';
import { assertAiAllowed, isDemo, type AccountEnv } from '../http/auth.ts';

/** The model list changes rarely; the settings page and the sidebar status ask for it often. */
const MODELS_TTL_MS = 10 * 60_000;
/** A failure is kept briefly, so a broken credential is not retried on every request. */
const ERROR_TTL_MS = 60_000;

/** Identifies the credential a model list was fetched with, without keeping the secret itself. */
function credentialKey(s: AiSettings): string {
  const material = JSON.stringify([s.provider, s.authMode, s.apiKey, s.oauthCredentialPath, s.oauthCredential, s.baseUrl]);
  return createHash('sha256').update(material).digest('hex');
}

/** Maps a provider failure to an HTTP error: configuration problems are the user's to fix (409). */
function httpError(err: unknown): HttpError {
  const e = toAiError(err);
  return new HttpError(e.code === 'ai_not_configured' ? 409 : 502, e.code, e.message);
}

export function aiRoutes() {
  let listing: { key: string; at: number; promise: Promise<AiModel[]>; failed: boolean } | null = null;

  /**
   * The provider's model list for the saved credential. It doubles as the connection check: it
   * proves the credential works and costs no tokens. Concurrent callers share one request.
   */
  function modelList(settings: AiSettings, refresh: boolean): Promise<AiModel[]> {
    const key = credentialKey(settings);
    if (!refresh && listing?.key === key && Date.now() - listing.at < (listing.failed ? ERROR_TTL_MS : MODELS_TTL_MS)) {
      return listing.promise;
    }
    const entry = { key, at: Date.now(), promise: listModels(settings), failed: false };
    entry.promise.catch(() => {
      entry.failed = true;
    });
    listing = entry;
    return entry.promise;
  }

  return new Hono<AccountEnv>()
    // The demo has no AI: it can read the (empty) settings and the status, and change nothing.
    .use(async (c, next) => {
      const readOnly = c.req.method === 'GET' && /\/(settings|health)$/.test(c.req.path);
      if (!readOnly) assertAiAllowed(c);
      await next();
    })
    .get('/settings', (c) => c.json(toAiSettingsView(getAiSettings(c.var.db))))

    .put('/settings', validate('json', aiSettingsUpdateSchema), (c) => {
      const patch = c.req.valid('json');
      if (patch.oauthCredentialPath) {
        const account = credentialAccount(patch.oauthCredentialPath);
        if (account === '') throw new HttpError(400, 'invalid_credentials_path', `No readable OAuth credential at "${patch.oauthCredentialPath}".`);
        updateAiSettings(c.var.db, patch);
        return c.json(toAiSettingsView(setOauthAccount(c.var.db, account)));
      }
      return c.json(toAiSettingsView(updateAiSettings(c.var.db, patch)));
    })

    .get('/credentials/candidates', (c) => c.json(credentialCandidates('anthropic', hiddenCredentialPaths(c.var.db))))

    // Removes a found file from the list (or puts it back). The file on disk is never touched.
    .patch('/credentials/candidates', validate('json', credentialVisibilitySchema), (c) => {
      const { path, hidden } = c.req.valid('json');
      setCredentialHidden(c.var.db, path, hidden);
      return c.json(credentialCandidates('anthropic', hiddenCredentialPaths(c.var.db)));
    })

    .post('/credentials', async (c) => {
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        throw new HttpError(400, 'invalid_request', 'The body must be the JSON content of a credentials file.');
      }
      try {
        const imported = importCredential('anthropic', body);
        return c.json(toAiSettingsView(storeImportedCredential(c.var.db, imported.credential, imported.account, imported.path)));
      } catch (err) {
        if (err instanceof AiError) throw new HttpError(400, 'invalid_credentials', err.message);
        throw err;
      }
    })

    .delete('/credentials', (c) => c.json(toAiSettingsView(clearCredential(c.var.db))))

    .get('/models', validate('query', z.object({ refresh: z.stringbool().optional() })), async (c) => {
      try {
        return c.json(await modelList(getAiSettings(c.var.db), c.req.valid('query').refresh ?? false));
      } catch (err) {
        throw httpError(err);
      }
    })

    // The sidebar status: green only when the provider answers with the saved credential.
    .get('/health', async (c) => {
      if (isDemo(c.var.account)) return c.json({ status: 'disabled', message: null } satisfies AiHealth);
      const settings = getAiSettings(c.var.db);
      const missing = aiReadiness(settings);
      if (missing.length > 0) return c.json({ status: 'missing', message: missing.join(', ') } satisfies AiHealth);
      try {
        await modelList(settings, false);
        return c.json({ status: 'ok', message: null } satisfies AiHealth);
      } catch (err) {
        return c.json({ status: 'error', message: toAiError(err).message } satisfies AiHealth);
      }
    });
}
