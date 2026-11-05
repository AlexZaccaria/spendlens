/**
 * OpenAI adapter: Responses API with strict json_schema output. Images go in as `input_image`
 * data URLs and PDFs as `input_file`, so the model reads the original document.
 */

import OpenAI from 'openai';
import type { AiModel } from '@spendlens/contracts';
import { AiError } from '../errors.ts';
import { parseJsonAnswer, type ContentPart, type LlmProvider, type ProviderDeps, type StructuredRequest } from '../provider.ts';
import { effectiveApiKey, type AiSettings } from '../settings.ts';

type InputContent = OpenAI.Responses.ResponseInputContent;

/** Reasoning effort is only accepted by the reasoning model families. */
const REASONING_MODEL = /^(o\d|gpt-5)/i;

export function openAiClient(settings: AiSettings, deps: ProviderDeps, baseURL?: string): OpenAI {
  const { key } = effectiveApiKey(settings);
  if (!baseURL && key === '') throw new AiError('ai_not_configured', 'No OpenAI API key configured.');
  return new OpenAI({
    // Local OpenAI-compatible servers usually take no key, but the SDK requires a string.
    apiKey: key || 'not-needed',
    maxRetries: 3,
    timeout: 15 * 60_000,
    ...(baseURL && { baseURL }),
    ...(deps.fetch && { fetch: deps.fetch }),
  });
}

export function mapOpenAiError(err: unknown, vendor: string): AiError {
  if (err instanceof AiError) return err;
  if (err instanceof OpenAI.APIError) return new AiError('provider_error', `${vendor} API error ${err.status ?? ''}: ${err.message}`, { cause: err });
  return new AiError('provider_error', err instanceof Error ? err.message : String(err), { cause: err });
}

function toInput(part: ContentPart): InputContent {
  switch (part.type) {
    case 'text':
      return { type: 'input_text', text: part.text };
    case 'image':
      return { type: 'input_image', detail: 'auto', image_url: `data:${part.mime};base64,${part.data}` };
    case 'pdf':
      return { type: 'input_file', filename: part.filename, file_data: `data:application/pdf;base64,${part.data}` };
  }
}

export function openAiProvider(settings: AiSettings, deps: ProviderDeps = {}): LlmProvider {
  const model = settings.model.trim();
  return {
    id: 'openai',
    model,
    capabilities: { nativePdf: true, vision: true },
    async complete(request: StructuredRequest) {
      try {
        const client = openAiClient(settings, deps);
        const content = [...request.parts].sort((a, b) => Number(a.type === 'text') - Number(b.type === 'text')).map(toInput);
        const response = await client.responses.create(
          {
            model,
            instructions: request.system,
            input: [{ role: 'user', content }],
            max_output_tokens: request.maxOutputTokens ?? 64_000,
            text: { format: { type: 'json_schema', name: request.schemaName, schema: request.schema, strict: true } },
            ...(settings.effort && REASONING_MODEL.test(model) && { reasoning: { effort: settings.effort } }),
          },
          { ...(request.signal && { signal: request.signal }) },
        );
        if (response.status === 'incomplete') {
          const reason = response.incomplete_details?.reason;
          throw new AiError(reason === 'content_filter' ? 'refusal' : 'output_truncated', `The answer is incomplete (${reason ?? 'unknown'}).`);
        }
        const refusal = response.output
          .flatMap((item) => (item.type === 'message' ? item.content : []))
          .find((c) => c.type === 'refusal');
        if (refusal && refusal.type === 'refusal') throw new AiError('refusal', `The model declined the request: ${refusal.refusal}`);
        const usage = response.usage;
        return {
          json: parseJsonAnswer(response.output_text),
          model: response.model,
          inputTokens: usage?.input_tokens ?? 0,
          outputTokens: usage?.output_tokens ?? 0,
          cacheReadTokens: usage?.input_tokens_details?.cached_tokens ?? 0,
          cacheWriteTokens: 0,
        };
      } catch (err) {
        throw mapOpenAiError(err, 'OpenAI');
      }
    },
  };
}

export async function listOpenAiModels(settings: AiSettings, deps: ProviderDeps = {}): Promise<AiModel[]> {
  try {
    const client = openAiClient(settings, deps);
    const models: AiModel[] = [];
    for await (const m of client.models.list()) {
      // The catalogue mixes embeddings, audio and image models; keep the text generators.
      if (/^(gpt|o\d|chatgpt)/i.test(m.id) && !/(audio|realtime|transcribe|tts|image|search|embedding)/i.test(m.id)) {
        models.push({ id: m.id, label: m.id, contextWindow: null, efforts: null, latest: false });
      }
    }
    return models.sort((a, b) => b.id.localeCompare(a.id));
  } catch (err) {
    throw mapOpenAiError(err, 'OpenAI');
  }
}
