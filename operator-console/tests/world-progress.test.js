'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { newProject, createWorldStore } = require('../world-project');
const { deriveWorldProgress } = require('../world-progress');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('World progress counts verified milestones only; it never invents a percentage', () => {
  const p = newProject({ mode: 'complete360', sourceArtifactId: 'source.png' });
  assert.equal(deriveWorldProgress(p).done, 0);
  assert.equal(deriveWorldProgress(p).total, 9);
  p.stages.camera.status = 'READY';
  assert.equal(deriveWorldProgress(p).done, 0, 'group needs every verified stage');
  p.stages.erpReference.status = 'READY';
  p.stages.complete.status = 'RUNNING';
  const running = deriveWorldProgress(p);
  assert.equal(running.done, 1);
  assert.equal(running.segments[1].status, 'RUNNING');
  assert.equal('percent' in running, false);
  p.stages.complete.status = 'READY';
  p.stages.reconstruct.status = 'BLOCKED';
  p.status = 'PARTIAL';
  const partial = deriveWorldProgress(p);
  assert.equal(partial.done, 2);
  assert.equal(partial.segments.find(s => s.id === 'reconstruct').status, 'BLOCKED');
  assert.equal(partial.result, 'PARTIAL');
});

test('Quick 3D progress persists across reload while missing work remains NOT_STARTED', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-progress-world-'));
  try {
    const store = createWorldStore({ root });
    const p = store.create({ mode: 'quick3d', sourceArtifactId: 'source.png' });
    store.updateStage(p.id, 'reconstruct', { status: 'RUNNING' });
    const rows = store.list();
    assert.equal(rows[0].progress.done, 1);
    assert.equal(rows[0].progress.total, 4);
    assert.equal(rows[0].progress.segments[1].status, 'RUNNING');
    assert.equal(rows[0].stages, undefined, 'list stays lean');
    const after = createWorldStore({ root }).list()[0].progress;
    assert.deepEqual(after.segments, rows[0].progress.segments);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('A failed or retried milestone never counts as READY', () => {
  const p = newProject({ mode: 'quick3d', sourceArtifactId: 'src.png' });
  p.stages.reconstruct.status = 'FAILED'; p.status = 'FAILED';
  assert.equal(deriveWorldProgress(p).segments[1].status, 'FAILED');
  assert.equal(deriveWorldProgress(p).done, 1);
  p.stages.finalize.status = 'RUNNING';
  assert.equal(deriveWorldProgress(p).segments[2].status, 'UNVERIFIED', 'an orphan RUNNING stage does not imply work continues after failure');
  p.stages.reconstruct.status = 'NOT_STARTED';
  p.stages.finalize.status = 'NOT_STARTED'; p.status = 'QUEUED';
  assert.equal(deriveWorldProgress(p).segments[1].status, 'NOT_STARTED');
  assert.equal(deriveWorldProgress(p).done, 1);
});
