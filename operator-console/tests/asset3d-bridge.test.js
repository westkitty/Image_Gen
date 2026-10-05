'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'asset3d-bridge.js'), 'utf8');

test('3D bridge preserves the shared job, lease, staging, checksum, and cleanup gates', () => {
  assert.match(source, /arbiter\.acquire\(jobId/);
  assert.match(source, /staging\.stage/);
  assert.match(source, /DEX_3D_PASS/);
  assert.match(source, /transferred GLB checksum does not match/);
  assert.match(source, /mediaStore\.finalize/);
  assert.match(source, /staging\.remove\(staged\.id\)/);
  assert.match(source, /rm -rf --/);
  assert.match(source, /const MODES = new Set\(\['mesh', 'textured'\]\)/);
  assert.match(source, /status: 'DISABLED'/);
});
