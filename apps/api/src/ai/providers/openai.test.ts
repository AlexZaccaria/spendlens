import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AiError } from '../errors.ts';
import { DEFAULT_AI_SETTINGS, type AiSettings } from '../settings.ts';
import { openAiCompatibleProvider } from './openai-compatible.ts';
import { openAiProvider } from './openai.ts';

function recorder(respond: () => Response) {
  const bodies: Record<string, unknown>[] = [];
  const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
    bodies.push(typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {});
    return respond();
  }) as typeof fetch;
  return { bodies, fetchImpl };
}

const request = {
  system: 'Extract.',
  parts: [
    { type: 'text' as const, text: 'Do it.' },
    { type: 'image' as const, mime: 'image/png' as const, data: 'iVBORw0=' },
  ],
  schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false },
  schemaName: 'ping',
};

describe('openai providers', () => {
  it('OpenAI: Responses API with a strict json_schema and the image first', async () => {
    const { bodies, fetchImpl } = recorder(() =>
      Response.json({
        id: 'resp_1',
        object: 'response',
        model: 'gpt-5.5',
        status: 'completed',
        output: [{ type: 'message', id: 'm', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: '{"ok":true}', annotations: [] }] }],
        usage: { input_tokens: 20, output_tokens: 5, total_tokens: 25, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } },
      }),
    );
    const settings: AiSettings = { ...DEFAULT_AI_SETTINGS, provider: 'openai', apiKey: 'sk-test', model: 'gpt-5.5', effort: 'low' };
    const result = await openAiProvider(settings, { fetch: fetchImpl }).complete(request);
    assert.deepEqual(result.json, { ok: true });
    const body = bodies[0]!;
    assert.equal(body['instructions'], 'Extract.');
    assert.deepEqual((body['text'] as Record<string, unknown>)['format'], { type: 'json_schema', name: 'ping', schema: request.schema, strict: true });
    assert.deepEqual(body['reasoning'], { effort: 'low' });
    const content = (body['input'] as { content: { type: string }[] }[])[0]!.content;
    assert.deepEqual(content.map((c) => c.type), ['input_image', 'input_text']);
  });

  it('OpenAI-compatible: Chat Completions with response_format, and no native PDF', async () => {
    const { bodies, fetchImpl } = recorder(() =>
      Response.json({
        id: 'c',
        object: 'chat.completion',
        created: 0,
        model: 'qwen3',
        choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '```json\n{"ok":true}\n```', refusal: null } }],
        usage: { prompt_tokens: 30, completion_tokens: 6, total_tokens: 36 },
      }),
    );
    const settings: AiSettings = { ...DEFAULT_AI_SETTINGS, provider: 'openai-compatible', baseUrl: 'http://localhost:11434/v1', model: 'qwen3' };
    const provider = openAiCompatibleProvider(settings, { fetch: fetchImpl });
    assert.equal(provider.capabilities.nativePdf, false);
    const result = await provider.complete(request);
    assert.deepEqual(result.json, { ok: true });
    assert.equal(result.inputTokens, 30);
    const body = bodies[0]!;
    assert.deepEqual(body['response_format'], { type: 'json_schema', json_schema: { name: 'ping', schema: request.schema, strict: true } });

    await assert.rejects(
      provider.complete({ ...request, parts: [{ type: 'pdf', filename: 'a.pdf', data: 'x' }] }),
      (e: unknown) => e instanceof AiError && e.code === 'unsupported_format',
    );
  });
});
