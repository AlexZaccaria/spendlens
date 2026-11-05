/**
 * Credential discovery and import — the vendor-agnostic seam over per-provider OAuth files.
 * Only Anthropic has a credentials-file path today; the others authenticate with an API key.
 */

import type { AiProvider, CredentialCandidate } from '@spendlens/contracts';
import { AiError } from './errors.ts';
import { accountForPath, importAnthropicCredential, listCredentialCandidates, type ImportedCredential } from './providers/anthropic-oauth.ts';

/** Credential files found on this host; `hidden` marks the ones the user removed from the list. */
export function credentialCandidates(provider: AiProvider, hidden: ReadonlySet<string>): CredentialCandidate[] {
  if (provider !== 'anthropic') return [];
  return listCredentialCandidates().map((c) => ({ ...c, hidden: hidden.has(c.path) }));
}

export function importCredential(provider: AiProvider, raw: unknown): ImportedCredential {
  if (provider !== 'anthropic') {
    throw new AiError('ai_not_configured', `Credential files are not supported for the "${provider}" provider — use an API key.`);
  }
  return importAnthropicCredential(raw);
}

export function credentialAccount(path: string): string {
  return accountForPath(path);
}
