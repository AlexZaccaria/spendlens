import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { openDatabase } from '../db/database.ts';
import { setSetting } from '../repo/settings.ts';
import { getAiSettings, storeImportedCredential, updateAiSettings } from './settings.ts';

describe('AI settings', () => {
  it('keeps the API key and the model of each provider when switching back and forth', () => {
    const db = openDatabase(':memory:');
    updateAiSettings(db, { provider: 'anthropic', apiKey: 'sk-ant-1', model: 'claude-sonnet-5-5' });
    updateAiSettings(db, { provider: 'openai', apiKey: 'sk-oai-1', model: 'gpt-5.1' });

    const openai = getAiSettings(db);
    assert.equal(openai.apiKey, 'sk-oai-1');
    assert.equal(openai.model, 'gpt-5.1');

    const anthropic = updateAiSettings(db, { provider: 'anthropic' });
    assert.equal(anthropic.apiKey, 'sk-ant-1');
    assert.equal(anthropic.model, 'claude-sonnet-5-5');
  });

  it('remembers the Anthropic sign-in mode while another provider is active', () => {
    const db = openDatabase(':memory:');
    storeImportedCredential(db, '{"claudeAiOauth":{}}', 'Claude Max', '');
    assert.equal(updateAiSettings(db, { provider: 'openai' }).authMode, 'key');
    assert.equal(updateAiSettings(db, { provider: 'anthropic' }).authMode, 'oauth');
  });

  it('reads the earlier flat format as the values of the provider active at the time', () => {
    const db = openDatabase(':memory:');
    setSetting(db, 'ai', { provider: 'openai', authMode: 'key', apiKey: 'sk-old', model: 'gpt-old', effort: 'high' });

    const s = getAiSettings(db);
    assert.equal(s.apiKey, 'sk-old');
    assert.equal(s.model, 'gpt-old');
    assert.equal(s.effort, 'high');
    const anthropic = updateAiSettings(db, { provider: 'anthropic' });
    assert.equal(anthropic.apiKey, '');
    assert.equal(anthropic.model, 'claude-opus-5-5');
  });
});
