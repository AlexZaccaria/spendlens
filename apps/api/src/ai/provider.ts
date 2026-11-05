/**
 * The provider seam — the only way the app talks to a model.
 *
 * HARD RULE: vendor SDKs are imported ONLY inside ./providers/. Everything else (ingestion,
 * insights, routes) speaks this interface, so switching vendor is a settings change.
 *
 * Every call is a structured call: a stable system prompt, one user turn made of text, image
 * and PDF parts, and a JSON Schema the answer must satisfy. An unconfigured or unwired provider
 * fails loudly; there is never a silent fallback to another vendor or model.
 */

import type { AiModel, AiProvider } from '@spendlens/contracts';
import { AiError } from './errors.ts';
import { aiReadiness, type AiSettings } from './settings.ts';
import { anthropicProvider, listAnthropicModels } from './providers/anthropic.ts';
import { listOpenAiCompatibleModels, openAiCompatibleProvider } from './providers/openai-compatible.ts';
import { listOpenAiModels, openAiProvider } from './providers/openai.ts';

export type ImageMime = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

export type ContentPart =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image'; readonly mime: ImageMime; readonly data: string }
  | { readonly type: 'pdf'; readonly filename: string; readonly data: string };

export interface StructuredRequest {
  /** Stable instructions: identical across calls so the provider can cache them. */
  readonly system: string;
  /** The user turn: documents first, then the volatile instructions. */
  readonly parts: readonly ContentPart[];
  /** JSON Schema the answer must match (strict-mode compatible: every property required). */
  readonly schema: Record<string, unknown>;
  readonly schemaName: string;
  readonly maxOutputTokens?: number;
  readonly signal?: AbortSignal;
}

export interface StructuredResult {
  readonly json: unknown;
  /** The model that actually answered (a server-side fallback may differ from the requested one). */
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
}

export interface ProviderCapabilities {
  /** Reads PDF bytes itself (layout, tables, scans) instead of extracted text. */
  readonly nativePdf: boolean;
  readonly vision: boolean;
}

export interface LlmProvider {
  readonly id: AiProvider;
  readonly model: string;
  readonly capabilities: ProviderCapabilities;
  complete(request: StructuredRequest): Promise<StructuredResult>;
}

/** Injection point for tests (a fake `fetch` records what would go on the wire). */
export interface ProviderDeps {
  readonly fetch?: typeof fetch;
}

export function resolveProvider(settings: AiSettings, deps: ProviderDeps = {}): LlmProvider {
  const missing = aiReadiness(settings);
  if (missing.length > 0) throw new AiError('ai_not_configured', `AI provider not configured — missing: ${missing.join(', ')}.`);
  switch (settings.provider) {
    case 'anthropic':
      return anthropicProvider(settings, deps);
    case 'openai':
      return openAiProvider(settings, deps);
    case 'openai-compatible':
      return openAiCompatibleProvider(settings, deps);
    default:
      throw new AiError('ai_not_configured', `Unknown AI provider "${String((settings as AiSettings).provider)}".`);
  }
}

/** Models the configured credential can use, for the settings page picker. */
export async function listModels(settings: AiSettings, deps: ProviderDeps = {}): Promise<AiModel[]> {
  switch (settings.provider) {
    case 'anthropic':
      return listAnthropicModels(settings, deps);
    case 'openai':
      return listOpenAiModels(settings, deps);
    case 'openai-compatible':
      return listOpenAiCompatibleModels(settings, deps);
  }
}

/** Parses the model's JSON text; a malformed answer is a typed failure, not a crash. */
export function parseJsonAnswer(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // Some OpenAI-compatible servers wrap the JSON in a code fence despite response_format.
    const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed)?.[1];
    if (fenced) {
      try {
        return JSON.parse(fenced);
      } catch {
        /* fall through */
      }
    }
    throw new AiError('invalid_output', 'The model returned text that is not valid JSON.');
  }
}
