'use strict';
// The Create failure message must carry the engine's sanitized reason instead of 'Failed at gate "unknown"'.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../public/dexdiffusion/workstation-ui.js'), 'utf8');
const start = source.indexOf('P._failText = function');
const body = source.slice(start, source.indexOf('// ── Create: quantity', start));
const FS = require('../public/dexdiffusion/failure-stage.js');
function failText(job) {
  const P = {};
  vm.runInNewContext(body, { P, window: { DexFailureStage: FS.classify ? FS : (FS.DexFailureStage || FS) } });
  return P._failText(job);
}
test('model-read-denied failure shows the reason and next step', () => {
  const job = { firstFailedGate: 'model-read-denied', error: 'failed at gate model-read-denied: Big Mac engine cannot read the model file lustify.safetensors: Operation not permitted (check macOS file access for the engine worker)' };
  const t = failText(job);
  assert.match(t, /cannot read the model file lustify\.safetensors/);
  assert.doesNotMatch(t, /unknown/);
  assert.doesNotMatch(t, /\/Volumes/);
});
test('without a reason the legacy gate text is unchanged', () => {
  assert.match(failText({ firstFailedGate: 'scp', error: 'failed at gate scp' }), /Failed at gate "scp" — remote transfer failed\./);
  assert.match(failText({ error: 'failed at gate unknown' }), /Failed at gate "unknown"\./);
});
