'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

test('worker status distinguishes bridge proof from capability proof', () => {
  const prototype = {};
  const window = { DexDiffusionComponent: { prototype } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/dexdiffusion/media-ui.js'), 'utf8'), {
    window,
    React: { createElement: () => ({}) },
    setTimeout,
  }, { filename: 'media-ui.js' });

  assert.equal(prototype._workerProofLabel({ media_kind: 'image', enabled: true, proven: false, runtime_available: true, model_available: true, state: 'READY · local engine bridge' }), 'bridge proof pending');
  assert.equal(prototype._workerProofLabel({ media_kind: 'voice', bridged: true, enabled: true, proven: false }), 'bridge proof pending');
  assert.equal(prototype._workerProofLabel({ media_kind: 'image', bridged: true, enabled: true, proven: true }), 'proven');
  assert.equal(prototype._workerProofLabel({ media_kind: 'video', bridged: false, enabled: false, proven: false }), 'not proven');
});
