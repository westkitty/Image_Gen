'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { classify, STAGES } = require('../public/dexdiffusion/failure-stage.js');
const cases = [
  ['model-size', 'PREFLIGHT'], ['tunnel-down', 'PREFLIGHT'], ['scp-init-img', 'UPLOAD'], ['generator-exit', 'SAMPLING'], ['timeout', 'SAMPLING'],
  ['png-redact', 'IMAGE_ENCODING'], ['remote-png', 'REMOTE_OUTPUT_VALIDATION'], ['img2img-remote-png', 'REMOTE_OUTPUT_VALIDATION'], ['output-content', 'REMOTE_OUTPUT_VALIDATION'],
  ['scp', 'TRANSFER'], ['img2img-scp', 'TRANSFER'], ['server-png-copy', 'TRANSFER'],
  ['checksum-mismatch', 'CHECKSUM_VERIFICATION'], ['canonical-collision', 'CANONICALIZATION'], ['image-meta-write', 'METADATA_FINALIZATION'], ['result-publication', 'RESULT_PUBLICATION'], ['remote-cleanup', 'CLEANUP'],
];
for (const [gate, stage] of cases) test(`gate ${gate} -> ${stage}`, () => { const c = classify(gate); assert.equal(c.stage, stage); assert.ok(STAGES.includes(c.stage)); assert.match(c.text, /^Failed while/); });
test('every post-sampling stage warns that a rendered image may be recoverable and that saved images were not changed', () => {
  for (const g of ['remote-png', 'scp', 'checksum-mismatch', 'canonical-collision', 'image-meta-write', 'result-publication', 'remote-cleanup']) assert.match(classify(g).text, /may still be recoverable; nothing already saved was changed/);
  for (const g of ['model-size', 'generator-exit', 'scp-init-img']) assert.doesNotMatch(classify(g).text, /recoverable/);
});
test('cancellation is not a failure stage', () => { assert.equal(classify('user-cancelled').stage, null); });
test('unknown gates stay unclassified instead of being blamed on a stage (no invented VAE cause)', () => { const c = classify('mystery-gate'); assert.equal(c.stage, null); assert.match(c.text, /mystery-gate/); });
test('when there is no gate, the log decides, and a VAE stage is never inferred from progress alone', () => {
  assert.equal(classify('', '=== Copying PNG to MacBook ===').stage, 'TRANSFER');
  assert.equal(classify('', '=== Verifying remote PNG ===').stage, 'REMOTE_OUTPUT_VALIDATION');
  assert.equal(classify('', 'sampling step 20/20 100%').stage, null);
});
