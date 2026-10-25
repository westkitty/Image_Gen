'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyEngineError } = require('../bin/local-engine-generate.js');

const MODEL = '/Volumes/wc2tb/models/checkpoints/lustifySDXLNSFW_v50.safetensors';
const PROMPT = 'a secret lighthouse at dusk';
const NEG = 'blurry hands';

test('Errno 1 before the model is read -> model-read-denied with basename only', () => {
  const state = { status: 'failed', model_read: false, error: `[Errno 1] Operation not permitted: '${MODEL}' (prompt: ${PROMPT})` };
  const r = classifyEngineError(state, MODEL, { prompt: PROMPT, negativePrompt: NEG });
  assert.equal(r.gate, 'model-read-denied');
  assert.equal(r.reason, 'Big Mac engine cannot read the model file lustifySDXLNSFW_v50.safetensors: Operation not permitted (check macOS file access for the engine worker)');
  assert.doesNotMatch(r.reason, /\/Volumes|\//);
  assert.ok(!r.reason.includes(PROMPT) && !r.reason.includes('lighthouse'));
});

test('Errno 13 naming the model file is denied even if model_read was set; string errors work too', () => {
  assert.equal(classifyEngineError({ error: `[Errno 13] Permission denied: '${MODEL}'`, model_read: true }, MODEL).gate, 'model-read-denied');
  assert.equal(classifyEngineError(`[Errno 1] Operation not permitted: '${MODEL}'`, MODEL).gate, 'model-read-denied');
  const noPath = classifyEngineError(`[Errno 1] Operation not permitted: '${MODEL}'`, null);
  assert.match(noPath.reason, /model file lustifySDXLNSFW_v50\.safetensors:/);
  assert.doesNotMatch(noPath.reason, /\/Volumes/);
});

test('Errno 1 after the model was read (not naming it) -> engine-failed', () => {
  const r = classifyEngineError({ error: "[Errno 1] Operation not permitted: '/private/var/tmp/run-1/out.png'", model_read: true }, MODEL);
  assert.equal(r.gate, 'engine-failed');
  assert.equal(r.reason, "[Errno 1] Operation not permitted: 'out.png'");
});

test('other failures -> engine-failed with every absolute path reduced to its basename and prompts redacted', () => {
  const r = classifyEngineError({ error: `sd-cli failed loading /Users/andrew/Image_Gen/sdcpp-workflow/runs/x/vae.safetensors and ~/cache/lora.gguf for "${PROMPT}" / "${NEG}" at 5.16s/it`, model_read: true }, MODEL, { prompt: PROMPT, negativePrompt: NEG });
  assert.equal(r.gate, 'engine-failed');
  assert.match(r.reason, /vae\.safetensors and lora\.gguf/);
  assert.match(r.reason, /5\.16s\/it/, 'non-path slashes survive');
  assert.doesNotMatch(r.reason, /\/Users|~\/|\/Volumes|lighthouse|blurry/);
});

test('long reasons are truncated to 200 characters; empty errors stay meaningful', () => {
  const r = classifyEngineError({ error: 'x'.repeat(500) }, MODEL);
  assert.equal(r.gate, 'engine-failed');
  assert.equal(r.reason.length, 200);
  assert.equal(classifyEngineError({}, MODEL).reason, 'unknown engine failure');
});
