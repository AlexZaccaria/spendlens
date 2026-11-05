/**
 * OpenAI-compatible adapter: any server speaking Chat Completions (Ollama, LM Studio, vLLM,
 * llama.cpp, OpenRouter, an internal gateway). Structured output via `response_format`
 * json_schema; images as data URLs. PDFs are not read natively — the pipeline sends their text.
 */

import type OpenAI from 'openai';
import type { AiModel } from '@spendlens/contracts';
import { AiError } from '../errors.ts';
import { parseJsonAnswer, type ContentPart, type LlmProvider, type ProviderDeps, type StructuredRequest } from '../provider.ts';
import type { AiSettings } from '../settings.ts';
import { mapOpenAiError, openAiClient } from './openai.ts';

type ChatPart = OpenAI.Chat.Completions.ChatCompletionContentPart;

function baseUrlOf(settings: AiSettings): string {
  const url = settings.baseUrl.trim();
  if (url === '') throw new AiError('ai_not_configured', 'No base URL configured for the OpenAI-compatible provider.');
  return url;
}

function toPart(part: ContentPart): ChatPart {
  switch (part.type) {
    case 'text':
      return { type: 'text', text: part.text };
    case 'image':
      return { type: 'image_url', image_url: { url: `data:${part.mime};base64,${part.data}` } };
    case 'pdf':
      // The pipeline never sends PDF bytes to a provider without nativePdf.
      throw new AiError('unsupported_format', 'This provider cannot read PDF files directly.');
  }
}

export function openAiCompatibleProvider(settings: AiSettings, deps: ProviderDeps = {}): LlmProvider {
  const model = settings.model.trim();
  return {
    id: 'openai-compatible',
    model,
    capabilities: { nativePdf: false, vision: true },
    async complete(request: StructuredRequest) {
      try {
        const client = openAiClient(settings, deps, baseUrlOf(settings));
        const parts = [...request.parts].sort((a, b) => Number(a.type === 'text') - Number(b.type === 'text'));
        const onlyText = parts.every((p) => p.type === 'text');
        const completion = await client.chat.completions.create(
          {
            model,
            messages: [
              { role: 'system', content: request.system },
              // Plain string content when there is no image: some local servers reject part arrays.
              { role: 'user', content: onlyText ? parts.map((p) => (p.type === 'text' ? p.text : '')).join('\n\n') : parts.map(toPart) },
            ],
            max_tokens: request.maxOutputTokens ?? 32_000,
            response_format: { type: 'json_schema', json_schema: { name: request.schemaName, schema: request.schema, strict: true } },
          },
          { ...(request.signal && { signal: request.signal }) },
        );
        const choice = completion.choices[0];
        if (!choice) throw new AiError('invalid_output', 'The server returned no choices.');
        if (choice.message.refusal) throw new AiError('refusal', `The model declined the request: ${choice.message.refusal}`);
        if (choice.finish_reason === 'length') throw new AiError('output_truncated', 'The answer hit the output limit before it was complete.');
        if (choice.finish_reason === 'content_filter') throw new AiError('refusal', 'The answer was blocked by a content filter.');
        return {
          json: parseJsonAnswer(choice.message.content ?? ''),
          model: completion.model || model,
          inputTokens: completion.usage?.prompt_tokens ?? 0,
          outputTokens: completion.usage?.completion_tokens ?? 0,
          cacheReadTokens: completion.usage?.prompt_tokens_details?.cached_tokens ?? 0,
          cacheWriteTokens: 0,
        };
      } catch (err) {
        throw mapOpenAiError(err, 'OpenAI-compatible server');
      }
    },
  };
}

export async function listOpenAiCompatibleModels(settings: AiSettings, deps: ProviderDeps = {}): Promise<AiModel[]> {
  try {
    const client = openAiClient(settings, deps, baseUrlOf(settings));
    const models: AiModel[] = [];
    for await (const m of client.models.list()) models.push({ id: m.id, label: m.id, contextWindow: null, efforts: null, latest: false });
    return models.sort((a, b) => a.id.localeCompare(b.id));
  } catch (err) {
    throw mapOpenAiError(err, 'OpenAI-compatible server');
  }
}
