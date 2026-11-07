'use strict';
// Exact Chat model allowlist (contract D.2): exact match only, size-based heavy class, loopback-only base URL.
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../chat-models');
const { DEFAULT_TAGS, GIB } = require('./fixtures/fake-ollama-ndjson');

test('the allowlist has approved tags with gemma3:4b as default', () => {
  assert.deepEqual(M.CHAT_MODELS.map(m => m.name), [
    'gemma3:4b',
    'qwen3.8:27b-mlx',
    'hermes-qwen3.8-27b-64k:latest',
    'dex-cydonia-heretic:24b-q4km',
    'dex-gemma4-heretic:12b-q4km',
    'dex-rocinante:12b-v1.1-q4km',
  ]);
  assert.equal(M.DEFAULT_CHAT_MODEL, 'gemma3:4b');
  assert.ok(Object.isFrozen(M.CHAT_MODELS) && M.CHAT_MODELS.every(Object.isFrozen));
});

test('describeAllowlist reports installed state and never lists extra or lookalike tags', () => {
  const tags = { models: [...DEFAULT_TAGS.filter(t => t.name !== 'qwen3.8:27b-mlx'), { name: 'llama3.2:latest', size: 2 * GIB }, { name: 'gemma3:4b-instruct', size: 3 * GIB }, { name: 'hermes-qwen3.8-27b-64k', size: 17 * GIB }] };
  assert.deepEqual(M.describeAllowlist(tags), [
    { name: 'gemma3:4b', label: 'gemma3:4b', class: 'light', installed: true },
    { name: 'qwen3.8:27b-mlx', label: 'qwen3.8:27b-mlx', class: 'heavy', installed: false },
    { name: 'hermes-qwen3.8-27b-64k:latest', label: 'hermes-qwen3.8-27b-64k:latest', class: 'heavy', installed: true },
    { name: 'dex-cydonia-heretic:24b-q4km', label: 'Cydonia 24B Heretic v4', class: 'heavy', installed: false },
    { name: 'dex-gemma4-heretic:12b-q4km', label: 'Gemma 4 12B Heretic', class: 'heavy', installed: false },
    { name: 'dex-rocinante:12b-v1.1-q4km', label: 'Rocinante 12B v1.1', class: 'heavy', installed: false },
  ]);
  assert.deepEqual(M.describeAllowlist(null).map(m => m.installed), [false, false, false, false, false, false]);
});

test('resolveChatModel: exact match, not-allowed vs not-installed, default when omitted', () => {
  const tags = { models: DEFAULT_TAGS };
  assert.deepEqual(M.resolveChatModel(undefined, tags), { ok: true, model: 'gemma3:4b', resource_class: 'light' });
  assert.deepEqual(M.resolveChatModel('qwen3.8:27b-mlx', tags), { ok: true, model: 'qwen3.8:27b-mlx', resource_class: 'heavy' });
  for (const bad of ['llama3.2', 'gemma3', 'gemma3:4b ', ' gemma3:4b', 'GEMMA3:4B', 'hermes-qwen3.8-27b-64k', 'gemma3:latest', 42, '']) {
    assert.deepEqual(M.resolveChatModel(bad, tags), { ok: false, status: 422, code: 'model-not-allowed' }, String(bad));
  }
  assert.deepEqual(M.resolveChatModel('gemma3:4b', { models: [] }), { ok: false, status: 422, code: 'model-not-installed' });
});

test('a light-declared tag of 8 GiB or more is classed heavy', () => {
  const tags = { models: [{ name: 'gemma3:4b', size: 8 * GIB }] };
  assert.equal(M.resolveChatModel('gemma3:4b', tags).resource_class, 'heavy');
  assert.equal(M.describeAllowlist(tags)[0].class, 'heavy');
});

test('only an http loopback base URL is accepted', () => {
  for (const ok of ['http://127.0.0.1:11436', 'http://[::1]:11436']) assert.equal(M.isLoopbackBaseUrl(ok), true, ok);
  for (const bad of ['http://localhost:11436', 'https://127.0.0.1:11436', 'http://10.0.0.5:11434', 'https://ollama.com', 'http://127.0.0.1.nip.io', 'not a url', '']) assert.equal(M.isLoopbackBaseUrl(bad), false, bad);
});
