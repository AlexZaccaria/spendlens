import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { AiError } from '../errors.ts';
import { DEFAULT_AI_SETTINGS, type AiSettings } from '../settings.ts';
import { anthropicProvider, CLAUDE_CODE_IDENTITY, listAnthropicModels } from './anthropic.ts';
import { importAnthropicCredential } from './anthropic-oauth.ts';

interface Captured {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
}

/** A Messages API stream answering `text` and stopping with `stopReason`. */
function sse(text: string, stopReason = 'end_turn'): Response {
  const events = [
    ['message_start', { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, stop_details: null, usage: { input_tokens: 10, output_tokens: 1, cache_read_input_tokens: 2000, cache_creation_input_tokens: 0 } } }],
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ['message_delta', { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null, stop_details: null }, usage: { output_tokens: 42 } }],
    ['message_stop', { type: 'message_stop' }],
  ] as const;
  const body = events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('');
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function recorder(respond: (url: string) => Response) {
  const captured: Captured[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    captured.push({ url, headers, body });
    return respond(url);
  }) as typeof fetch;
  return { captured, fetchImpl };
}

const dir = mkdtempSync(join(tmpdir(), 'spendlens-oauth-'));
after(() => rmSync(dir, { recursive: true, force: true }));

function credentialsFile(expiresAt: number): string {
  const path = join(dir, `${expiresAt}.credentials.json`);
  writeFileSync(path, JSON.stringify({ claudeAiOauth: { accessToken: 'tok-file', refreshToken: 'ref-1', expiresAt, subscriptionType: 'max' } }));
  return path;
}

const request = {
  system: 'Extract transactions.',
  parts: [
    { type: 'text' as const, text: 'Today is 2026-11-05.' },
    { type: 'pdf' as const, filename: 'bill.pdf', data: 'JVBERi0=' },
  ],
  schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false },
  schemaName: 'ping',
};

describe('anthropic provider', () => {
  it('sends a Claude subscription token in the Claude Code shape', async () => {
    const { captured, fetchImpl } = recorder(() => sse('{"ok":true}'));
    const settings: AiSettings = { ...DEFAULT_AI_SETTINGS, authMode: 'oauth', oauthCredentialPath: credentialsFile(Date.now() + 3_600_000) };
    const result = await anthropicProvider(settings, { fetch: fetchImpl }).complete(request);

    assert.deepEqual(result.json, { ok: true });
    assert.equal(result.outputTokens, 42);
    assert.equal(result.cacheReadTokens, 2000);
    const call = captured[0]!;
    assert.ok(call.url.endsWith('/v1/messages?beta=true') || call.url.includes('/v1/messages'));
    assert.equal(call.headers.get('authorization'), 'Bearer tok-file');
    assert.equal(call.headers.get('x-api-key'), null);
    const betas = call.headers.get('anthropic-beta')!.split(',');
    for (const b of ['oauth-2025-04-20', 'claude-code-20250219', 'server-side-fallback-2026-07-01']) assert.ok(betas.includes(b), b);

    const system = call.body['system'] as { text: string; cache_control?: unknown }[];
    assert.equal(system[0]!.text, CLAUDE_CODE_IDENTITY);
    assert.equal(system[1]!.text, 'Extract transactions.');
    assert.deepEqual(system[1]!.cache_control, { type: 'ephemeral' });
    assert.equal(call.body['fallbacks'], 'default');
    assert.deepEqual((call.body['output_config'] as Record<string, unknown>)['format'], { type: 'json_schema', schema: request.schema });
    assert.equal((call.body['output_config'] as Record<string, unknown>)['effort'], 'medium');
    assert.equal(call.body['tool_choice'], undefined);
    // The document goes before the instructions.
    const content = (call.body['messages'] as { content: { type: string }[] }[])[0]!.content;
    assert.deepEqual(content.map((b) => b.type), ['document', 'text']);
  });

  it('uses an API key without the subscription shape, and no fallbacks on Haiku', async () => {
    const { captured, fetchImpl } = recorder(() => sse('{"ok":true}'));
    const settings: AiSettings = { ...DEFAULT_AI_SETTINGS, apiKey: 'sk-ant-test', model: 'claude-haiku-5-5', effort: null };
    await anthropicProvider(settings, { fetch: fetchImpl }).complete(request);
    const call = captured[0]!;
    assert.ok(!(call.headers.get('anthropic-beta') ?? '').includes('oauth'));
    assert.equal((call.body['system'] as unknown[]).length, 1);
    assert.equal(call.body['fallbacks'], undefined);
    assert.equal((call.body['output_config'] as Record<string, unknown>)['effort'], undefined);
  });

  it('refreshes an expiring file token and writes it back in the same shape', async () => {
    const path = credentialsFile(Date.now() + 60_000);
    const { captured, fetchImpl } = recorder((url) =>
      url.includes('/oauth/token') ? Response.json({ access_token: 'tok-new', refresh_token: 'ref-2', expires_in: 28_800 }) : sse('{"ok":true}'),
    );
    const settings: AiSettings = { ...DEFAULT_AI_SETTINGS, authMode: 'oauth', oauthCredentialPath: path };
    await anthropicProvider(settings, { fetch: fetchImpl }).complete(request);

    assert.equal(captured[0]!.body['grant_type'], 'refresh_token');
    assert.equal(captured[0]!.body['client_id'], '9d1c250a-e61b-44d9-88ed-5944d1962f5e');
    assert.equal(captured[1]!.headers.get('authorization'), 'Bearer tok-new');
    const written = JSON.parse(readFileSync(path, 'utf8')) as { claudeAiOauth: Record<string, unknown> };
    assert.equal(written.claudeAiOauth['accessToken'], 'tok-new');
    assert.equal(written.claudeAiOauth['refreshToken'], 'ref-2');
    assert.equal(written.claudeAiOauth['subscriptionType'], 'max');
  });

  it('turns refusals and truncation into typed errors', async () => {
    const settings: AiSettings = { ...DEFAULT_AI_SETTINGS, apiKey: 'sk-ant-test' };
    for (const [stop, code] of [['refusal', 'refusal'], ['max_tokens', 'output_truncated']] as const) {
      const { fetchImpl } = recorder(() => sse('{"ok":', stop));
      await assert.rejects(anthropicProvider(settings, { fetch: fetchImpl }).complete(request), (e: unknown) => e instanceof AiError && e.code === code);
    }
  });

  it('lists models newest first, marking the newest of each line and reading the effort levels', async () => {
    const level = (supported: boolean) => ({ supported });
    const model = (id: string, line: string | null, created: string, lifecycle: string, efforts: string[] | null) => ({
      type: 'model',
      id,
      display_name: `Claude ${id}`,
      created_at: created,
      line,
      lifecycle,
      max_input_tokens: 1_000_000,
      capabilities:
        efforts === null
          ? null
          : { effort: { supported: efforts.length > 0, ...Object.fromEntries(['low', 'medium', 'high', 'xhigh', 'max'].map((l) => [l, level(efforts.includes(l))])) } },
    });
    const data = [
      model('opus-old', 'opus', '2025-01-01T00:00:00Z', 'active', ['low', 'medium', 'high']),
      model('haiku-old', 'haiku', '2025-02-01T00:00:00Z', 'active', []),
      model('opus-new', 'opus', '2026-06-01T00:00:00Z', 'active', ['low', 'medium', 'high', 'xhigh', 'max']),
      model('sonnet-gone', 'sonnet', '2026-07-01T00:00:00Z', 'retired', null),
      model('sonnet-deprecated', 'sonnet', '2026-05-01T00:00:00Z', 'deprecated', null),
    ];
    const { fetchImpl } = recorder(() => Response.json({ data, has_more: false, first_id: 'opus-old', last_id: 'sonnet-deprecated' }));
    const models = await listAnthropicModels({ ...DEFAULT_AI_SETTINGS, apiKey: 'sk-ant-test' }, { fetch: fetchImpl });

    assert.deepEqual(
      models.map((m) => [m.id, m.latest]),
      [
        ['opus-new', true],
        ['sonnet-deprecated', false],
        ['haiku-old', true],
        ['opus-old', false],
      ],
    );
    assert.equal(models[0]!.label, 'opus-new');
    assert.deepEqual(models[0]!.efforts, ['low', 'medium', 'high', 'xhigh', 'max']);
    assert.deepEqual(models[2]!.efforts, []);
    assert.equal(models[1]!.efforts, null);
  });

  it('validates an imported credentials file without exposing the token', () => {
    const imported = importAnthropicCredential({ claudeAiOauth: { accessToken: 'not-on-disk', subscriptionType: 'pro' } });
    assert.equal(imported.account, 'Claude Pro');
    assert.equal(imported.path, '');
    assert.throws(() => importAnthropicCredential({ hello: 'world' }), AiError);
  });
});
