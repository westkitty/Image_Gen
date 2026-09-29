'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const policyPath = path.join(__dirname, '..', 'dimension-policy.js');
function policy() {
  assert.ok(fs.existsSync(policyPath), 'dimension-policy.js must own backend-specific dimension rules');
  return require(policyPath);
}

test('MFLUX requires exact multiples of 16 and accepts independent non-square dimensions', () => {
  const { rulesForTarget, validateDimensions } = policy();
  const target = { id: 'flux2-klein-4b', label: 'FLUX.2 Klein 4B', backend: 'mflux', maxWidth: 2048, maxHeight: 2048 };
  const rules = rulesForTarget(target);
  assert.deepEqual(rules, { minWidth: 256, minHeight: 256, maxWidth: 2048, maxHeight: 2048, dimensionMultiple: 16 });
  assert.equal(validateDimensions(target, 768, 512), null);
  assert.equal(validateDimensions(target, 512, 768), null);
  assert.equal(validateDimensions(target, 520, 512), 'Width must be a multiple of 16 for FLUX.2 Klein 4B.');
});

test('SDCPP exposes its VAE multiple-of-8 contract and target-specific bounds', () => {
  const { rulesForTarget, validateDimensions } = policy();
  const target = { id: 'sd15', label: 'SD1.5', backend: 'sdcpp', maxWidth: 2048, maxHeight: 2048 };
  assert.deepEqual(rulesForTarget(target), { minWidth: 64, minHeight: 64, maxWidth: 2048, maxHeight: 2048, dimensionMultiple: 8 });
  assert.equal(validateDimensions(target, 768, 512), null);
  assert.equal(validateDimensions(target, 512, 768), null);
  assert.equal(validateDimensions(target, 770, 512), 'Width must be a multiple of 8 for SD1.5.');
  assert.equal(validateDimensions({ ...target, maxHeight: 1024 }, 512, 1032), 'Height must be between 64 and 1024 for SD1.5.');
});

test('server publishes the same dimension rules it enforces', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(src, /const \{ rulesForTarget, validateDimensions \} = require\('\.\/dimension-policy'\)/);
  assert.match(src, /\.\.\.rulesForTarget\(target\)/);
  assert.match(src, /const dimensionError = validateDimensions\(spec, params\.width, params\.height\)/);
});
