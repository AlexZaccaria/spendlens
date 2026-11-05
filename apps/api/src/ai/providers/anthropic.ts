/**
 * Anthropic adapter (Claude). Thin: authentication, request shaping, response parsing.
 *
 * - API key → the SDK's `apiKey`. OAuth (Claude subscription) → `authToken` plus the oauth and
 *   claude-code betas, and the Claude Code identity as the FIRST system block — the subscription
 *   credential is accepted on /v1/messages only in that shape. The real instructions follow as the
 *   second block, marked for prompt caching.
 * - Structured output through `output_config.format` (json_schema). Forced tool use is not used:
 *   it returns a 400 on the current models.
 * - Server-side refusal fallbacks (`fallbacks: "default"`) on the models that support them.
 */

import Anthropic from '@anthropic-ai/sdk';
import { EFFORTS, type AiModel, type Effort } from '@spendlens/contracts';
import { AiError } from '../errors.ts';
import type { ContentPart, LlmProvider, ProviderDeps, StructuredRequest, StructuredResult } from '../provider.ts';
import { effectiveApiKey, type AiSettings } from '../settings.ts';
import { resolveOAuthToken } from './anthropic-oauth.ts';

export const CLAUDE_CODE_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude.";
export const OAUTH_BETAS = ['oauth-2025-04-20', 'claude-code-20250219'] as const;
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
/** Models with a server-defined default fallback; Haiku has none (a list there is a 400). */
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5', 'claude-fable-5-1']);
const DEFAULT_MAX_TOKENS = 64_000;

type BetaContentBlock = Anthropic.Beta.Messages.BetaContentBlockParam;

interface Auth {
  readonly oauth: boolean;
  readonly client: Anthropic;
}

async function authenticate(settings: AiSettings, deps: ProviderDeps): Promise<Auth> {
  const common = { maxRetries: 3, timeout: 15 * 60_000, ...(deps.fetch && { fetch: deps.fetch }) };
  if (settings.authMode === 'oauth') {
    const token = await resolveOAuthToken(settings, deps.fetch ?? fetch);
    return { oauth: true, client: new Anthropic({ ...common, apiKey: null, authToken: token }) };
  }
  const { key } = effectiveApiKey(settings);
  if (key === '') throw new AiError('ai_not_configured', 'No Anthropic API key configured.');
  return { oauth: false, client: new Anthropic({ ...common, apiKey: key, authToken: null }) };
}

function toBlock(part: ContentPart): BetaContentBlock {
  switch (part.type) {
    case 'text':
      return { type: 'text', text: part.text };
    case 'image':
      return { type: 'image', source: { type: 'base64', media_type: part.mime, data: part.data } };
    case 'pdf':
      return { type: 'document', title: part.filename, source: { type: 'base64', media_type: 'application/pdf', data: part.data } };
  }
}

function mapError(err: unknown): AiError {
  if (err instanceof AiError) return err;
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new AiError('provider_error', `Anthropic rejected the credential (${err.status}): ${err.message}`, { cause: err });
  }
  if (err instanceof Anthropic.RateLimitError) return new AiError('provider_error', `Anthropic rate limit reached: ${err.message}`, { cause: err });
  if (err instanceof Anthropic.APIError) return new AiError('provider_error', `Anthropic API error ${err.status ?? ''}: ${err.message}`, { cause: err });
  return new AiError('provider_error', err instanceof Error ? err.message : String(err), { cause: err });
}

export function anthropicProvider(settings: AiSettings, deps: ProviderDeps = {}): LlmProvider {
  const model = settings.model.trim();
  return {
    id: 'anthropic',
    model,
    capabilities: { nativePdf: true, vision: true },
    async complete(request: StructuredRequest): Promise<StructuredResult> {
      try {
        const { oauth, client } = await authenticate(settings, deps);
        const fallback = FALLBACK_MODELS.has(model);
        const betas = [...(oauth ? OAUTH_BETAS : []), ...(fallback ? [FALLBACK_BETA] : [])];
        const instructions = { type: 'text' as const, text: request.system, cache_control: { type: 'ephemeral' as const } };
        // Documents and images first, the instructions about them after.
        const content = [...request.parts].sort((a, b) => Number(a.type === 'text') - Number(b.type === 'text')).map(toBlock);

        const stream = client.beta.messages.stream(
          {
            model,
            max_tokens: request.maxOutputTokens ?? DEFAULT_MAX_TOKENS,
            system: oauth ? [{ type: 'text', text: CLAUDE_CODE_IDENTITY }, instructions] : [instructions],
            messages: [{ role: 'user', content }],
            output_config: {
              format: { type: 'json_schema', schema: request.schema },
              ...(settings.effort && { effort: settings.effort }),
            },
            ...(betas.length > 0 && { betas }),
            ...(fallback && { fallbacks: 'default' as const }),
          },
          { ...(request.signal && { signal: request.signal }) },
        );
        const message = await stream.finalMessage();

        if (message.stop_reason === 'refusal') {
          const category = message.stop_details?.category ?? 'unspecified';
          throw new AiError('refusal', `The model declined the request (category: ${category}).`);
        }
        if (message.stop_reason === 'max_tokens') {
          throw new AiError('output_truncated', 'The answer hit the output limit before it was complete.');
        }
        const text = message.content
          .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('');
        if (text.trim() === '') throw new AiError('invalid_output', 'The model returned no text.');
        let json: unknown;
        try {
          json = JSON.parse(text);
        } catch {
          throw new AiError('invalid_output', 'The model returned text that is not valid JSON.');
        }
        const usage = message.usage;
        return {
          json,
          model: message.model,
          inputTokens: usage.input_tokens + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0),
          outputTokens: usage.output_tokens,
          cacheReadTokens: usage.cache_read_input_tokens ?? 0,
          cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
        };
      } catch (err) {
        throw mapError(err);
      }
    },
  };
}

/** Effort levels from the Models API capabilities; null when the entry carries none. */
function effortsOf(capabilities: Anthropic.ModelCapabilities | null | undefined): Effort[] | null {
  const effort = capabilities?.effort;
  if (!effort) return null;
  if (!effort.supported) return [];
  return EFFORTS.filter((level) => effort[level]?.supported === true);
}

/** Callable models, newest first; the newest active model of each line is marked `latest`. */
export async function listAnthropicModels(settings: AiSettings, deps: ProviderDeps = {}): Promise<AiModel[]> {
  try {
    const { oauth, client } = await authenticate(settings, deps);
    const infos: Anthropic.ModelInfo[] = [];
    const pages = client.models.list({ limit: 100 }, oauth ? { headers: { 'anthropic-beta': OAUTH_BETAS[0] } } : {});
    for await (const m of pages) if (m.lifecycle !== 'retired') infos.push(m);
    infos.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    const lines = new Set<string>();
    return infos.map((m) => {
      const line = m.line ?? null;
      const latest = line !== null && m.lifecycle !== 'deprecated' && !lines.has(line);
      if (latest) lines.add(line);
      return {
        id: m.id,
        // Every model here is a Claude: the prefix only takes room in the picker.
        label: m.display_name.replace(/^Claude /, ''),
        contextWindow: m.max_input_tokens ?? null,
        efforts: effortsOf(m.capabilities),
        latest,
      };
    });
  } catch (err) {
    throw mapError(err);
  }
}
