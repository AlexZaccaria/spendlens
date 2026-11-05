import type { AiProvider, AiSettingsUpdate, AiSettingsView, AuthMode, Effort } from '@spendlens/contracts';
import type { Db } from '../db/database.ts';
import { getSetting, setSetting } from '../repo/settings.ts';

/**
 * The inference configuration as stored. Same shape as Solexma's InferenceConfig: one vendor, one
 * way to authenticate (an API key, or an OAuth credentials file), one model. `apiKey` and
 * `oauthCredential` are secrets — written by the browser, never sent back to it.
 */
export interface AiSettings {
  readonly provider: AiProvider;
  readonly authMode: AuthMode;
  readonly apiKey: string;
  /** Path of a credentials file, re-read at every call (Claude Code keeps it refreshed). */
  readonly oauthCredentialPath: string;
  /** An uploaded credentials file: a snapshot, refreshed in memory only. */
  readonly oauthCredential: string;
  readonly oauthAccount: string;
  /** Endpoint of an OpenAI-compatible server (Ollama, LM Studio, vLLM, OpenRouter, a gateway). */
  readonly baseUrl: string;
  readonly model: string;
  readonly effort: Effort | null;
}

/** Model names churn; this is only the starting point of the settings page. */
export const DEFAULT_MODELS: Record<AiProvider, string> = {
  anthropic: 'claude-opus-5-5',
  openai: '',
  'openai-compatible': '',
};

export const DEFAULT_AI_SETTINGS: AiSettings = {
  provider: 'anthropic',
  authMode: 'key',
  apiKey: '',
  oauthCredentialPath: '',
  oauthCredential: '',
  oauthAccount: '',
  baseUrl: '',
  model: DEFAULT_MODELS.anthropic,
  effort: 'medium',
};

const ENV_KEYS: Record<AiProvider, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  'openai-compatible': 'OPENAI_COMPATIBLE_API_KEY',
};

/**
 * As stored: the API key and the model are kept per provider, so switching vendor and back (every
 * change on the settings page is saved at once) loses neither. The rest of the app sees the flat
 * `AiSettings` of the active provider.
 */
interface StoredAiSettings extends Omit<AiSettings, 'apiKey' | 'model'> {
  readonly apiKeys: Partial<Record<AiProvider, string>>;
  readonly models: Partial<Record<AiProvider, string>>;
}

type StoredRecord = Partial<StoredAiSettings> & { apiKey?: string; model?: string };

function readStored(db: Db): StoredAiSettings {
  const { apiKey, model, apiKeys, models, ...rest } = getSetting<StoredRecord>(db, 'ai') ?? {};
  const { apiKey: _key, model: _model, ...defaults } = DEFAULT_AI_SETTINGS;
  const base = { ...defaults, ...rest };
  // Earlier versions kept one key and one model, belonging to the provider active at the time.
  return {
    ...base,
    apiKeys: apiKeys ?? (apiKey ? { [base.provider]: apiKey } : {}),
    models: models ?? (model !== undefined ? { [base.provider]: model } : {}),
  };
}

function flatten(stored: StoredAiSettings, provider: AiProvider = stored.provider): AiSettings {
  const { apiKeys, models, ...rest } = stored;
  return {
    ...rest,
    provider,
    // OAuth is an Anthropic-only path; the stored choice is kept for when Anthropic is picked again.
    authMode: provider === 'anthropic' ? rest.authMode : 'key',
    apiKey: apiKeys[provider] ?? '',
    model: models[provider] ?? DEFAULT_MODELS[provider],
  };
}

function writeAiSettings(db: Db, next: AiSettings): AiSettings {
  const stored = readStored(db);
  const { apiKey, model, ...rest } = next;
  const record: StoredAiSettings = {
    ...rest,
    authMode: next.provider === 'anthropic' ? next.authMode : stored.authMode,
    apiKeys: { ...stored.apiKeys, [next.provider]: apiKey },
    models: { ...stored.models, [next.provider]: model },
  };
  setSetting(db, 'ai', record);
  return next;
}

export function getAiSettings(db: Db): AiSettings {
  return flatten(readStored(db));
}

/** The key a call will use: the stored one, else the provider's environment variable. */
export function effectiveApiKey(s: AiSettings): { key: string; source: 'settings' | 'env' | null } {
  if (s.apiKey.trim() !== '') return { key: s.apiKey.trim(), source: 'settings' };
  const env = process.env[ENV_KEYS[s.provider]]?.trim() ?? '';
  return env !== '' ? { key: env, source: 'env' } : { key: '', source: null };
}

/** What is still missing before a model can be called (empty = ready). */
export function aiReadiness(s: AiSettings): string[] {
  const missing: string[] = [];
  const oauth = s.provider === 'anthropic' && s.authMode === 'oauth';
  if (oauth) {
    if (s.oauthCredentialPath.trim() === '' && s.oauthCredential.trim() === '') missing.push('credentials');
  } else if (s.provider === 'openai-compatible') {
    if (s.baseUrl.trim() === '') missing.push('baseUrl');
  } else if (effectiveApiKey(s).key === '') {
    missing.push('apiKey');
  }
  if (s.model.trim() === '') missing.push('model');
  return missing;
}

export function toAiSettingsView(s: AiSettings): AiSettingsView {
  const key = effectiveApiKey(s);
  const missing = aiReadiness(s);
  return {
    provider: s.provider,
    authMode: s.authMode,
    apiKeySet: key.key !== '',
    apiKeySource: key.source,
    oauthCredentialPath: s.oauthCredentialPath,
    oauthCredentialImported: s.oauthCredential.trim() !== '',
    oauthAccount: s.oauthAccount,
    baseUrl: s.baseUrl,
    model: s.model,
    effort: s.effort,
    ready: missing.length === 0,
    missing,
  };
}

/** Applies a partial change; the key and model fields belong to the provider the patch ends on. */
export function updateAiSettings(db: Db, patch: AiSettingsUpdate): AiSettings {
  const base = flatten(readStored(db), patch.provider);
  const next: AiSettings = {
    ...base,
    ...(patch.authMode !== undefined && base.provider === 'anthropic' && { authMode: patch.authMode }),
    // Write-only secret: "" keeps the stored key, null clears it.
    apiKey: patch.apiKey === null ? '' : patch.apiKey ? patch.apiKey : base.apiKey,
    ...(patch.oauthCredentialPath !== undefined && { oauthCredentialPath: patch.oauthCredentialPath }),
    ...(patch.baseUrl !== undefined && { baseUrl: patch.baseUrl }),
    ...(patch.model !== undefined && { model: patch.model }),
    ...(patch.effort !== undefined && { effort: patch.effort }),
  };
  return writeAiSettings(db, next);
}

/** Stores an uploaded credentials file (and, when found on this host, its path for live refresh). */
export function storeImportedCredential(db: Db, credential: string, account: string, path: string): AiSettings {
  return writeAiSettings(db, {
    ...flatten(readStored(db), 'anthropic'),
    authMode: 'oauth',
    oauthCredential: credential,
    oauthAccount: account,
    oauthCredentialPath: path,
  });
}

/** Display label of the OAuth account (derived from the credentials file; not a secret). */
export function setOauthAccount(db: Db, account: string): AiSettings {
  return writeAiSettings(db, { ...getAiSettings(db), oauthAccount: account });
}

/** Credential files removed from the settings page list. Only the list entry goes: the file stays. */
export function hiddenCredentialPaths(db: Db): Set<string> {
  return new Set(getSetting<string[]>(db, 'ai.hiddenCredentials') ?? []);
}

export function setCredentialHidden(db: Db, path: string, hidden: boolean): void {
  const paths = hiddenCredentialPaths(db);
  if (hidden) paths.add(path);
  else paths.delete(path);
  setSetting(db, 'ai.hiddenCredentials', [...paths]);
}

export function clearCredential(db: Db): AiSettings {
  return writeAiSettings(db, { ...getAiSettings(db), oauthCredential: '', oauthCredentialPath: '', oauthAccount: '' });
}
