'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { parseHy3dProgressLine } = require('../asset3d-bridge');
const { createWorldTransport } = require('../world-bridge');

test('Pinned hy3d shape stdout exposes real step counters without trusting stage percentages', () => {
  assert.deepEqual(parseHy3dProgressLine('generate[1/2] shape: mini  steps=30', 'textured', 'shape'), { phase: 'shape', label: 'Preparing mesh generation' });
  assert.deepEqual(parseHy3dProgressLine('  [ 34%] Denoising (12/30)', 'textured', 'shape'), { phase: 'shape', label: 'Mesh denoising step 12 of 30', done: 12, total: 30, scope: 'phase' });
  assert.equal(parseHy3dProgressLine(' [ 44%] Denoising (45/30)', 'mesh', 'shape'), null);
  assert.equal(parseHy3dProgressLine(' [ 44%] Denoising (3/0)', 'mesh', 'shape'), null);
  assert.deepEqual(parseHy3dProgressLine('generate[2/2] paint (rgb): res=512 steps=15', 'textured', 'shape'), { phase: 'paint', label: 'Generating texture' });
  assert.deepEqual(parseHy3dProgressLine(' [ 38%] Paint denoising', 'textured', 'paint'), { phase: 'paint', label: 'Generating texture · measured remaining time unavailable' });
});

test('No model paths or arbitrary stderr flow into progress records', () => {
  for (const line of ['Error: /Users/private/path', 'prompt=secret', 'The user text', 'WORLD_PANORAMA_FAIL']) {
    assert.equal(parseHy3dProgressLine(line, 'mesh', 'shape'), null);
  }
});

test('3D Asset local transfer reuses the confined World transport', () => {
  const source = fs.readFileSync(require.resolve('../asset3d-bridge'), 'utf8');
  assert.match(source, /createWorldTransport\(\{ sshTarget, workRoot: REMOTE_ROOT \}\)/);
  assert.match(source, /transport\.toWorker\(staged\.path, remoteInput/);
  assert.match(source, /transport\.local/);
  assert.equal(createWorldTransport({ sshTarget: 'westcat', hostname: 'bigmac' }).local, true);
});

test('Phase-scoped counts cannot masquerade as whole-job percentage in Job Center', () => {
  const { projectGenericProgress } = require('../operational-jobs');
  assert.equal(projectGenericProgress({ phase: 'shape', scope: 'phase', done: 12, total: 30 }), null);
  assert.deepEqual(projectGenericProgress({ phase: 'complete', done: 3, total: 4 }).step, 3);
});
