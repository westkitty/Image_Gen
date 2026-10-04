'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { createWorldStore } = require('../world-project');
const { createMediaStore } = require('../media');

function temp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'dex-world-test-')); }

test('World Project creates, persists, reloads, and records lineage/stages', () => {
  const root = temp();
  const clock = (() => { let t = 1700000000000; return () => ++t; })();
  const store = createWorldStore({ root, now: clock });
  const p = store.create({ mode: 'quick3d', sourceArtifactId: 'source.png', sourceImage: { artifactId: 'source.png' }, parameters: { seed: 42 } });
  assert.equal(p.schema, 'dexdiffusion.world_project.v2');
  assert.equal(p.stages.source.status, 'READY');
  store.updateStage(p.id, 'reconstruct', { status: 'RUNNING', worker: 'sharp-reconstruct' });
  store.attachArtifact(p.id, 'finalPly', { artifact_id: 'scene.ply', parent: 'source.png' }, { stage: 'finalize' });
  store.updateStage(p.id, 'reconstruct', { status: 'READY', artifacts: ['scene.ply'] });
  store.updateStage(p.id, 'finalize', { status: 'READY', artifacts: ['scene.ply'] });
  store.setViewer(p.id, { opened: true, lastArtifactId: 'scene.ply' });
  const reloaded = createWorldStore({ root, now: clock });
  const saved = reloaded.get(p.id);
  assert.equal(saved.artifacts.finalPly.artifact_id, 'scene.ply');
  assert.equal(saved.stages.finalize.status, 'READY');
  assert.equal(saved.viewerState.lastArtifactId, 'scene.ply');
  assert.ok(saved.lineage.some(x => x.artifactId === 'scene.ply' && x.type === 'finalPly'));
});

test('World Project retains truthful failure and retry state', () => {
  const root = temp();
  const store = createWorldStore({ root });
  const p = store.create({ mode: 'quick3d', sourceArtifactId: 'source.png' });
  store.updateStage(p.id, 'reconstruct', { status: 'FAILED', error: 'Big Mac unavailable', failure: { gate: 'generation-failed' } });
  assert.equal(store.get(p.id).status, 'FAILED');
  assert.equal(store.get(p.id).failure.stage, 'reconstruct');
  store.retry(p.id, 'reconstruct');
  assert.equal(store.get(p.id).status, 'QUEUED');
  assert.equal(store.get(p.id).stages.reconstruct.status, 'NOT_STARTED');
  assert.equal(store.get(p.id).failure, null);
});

test('world media store accepts a validated PLY and rejects a fake output', () => {
  const root = temp();
  const roots = { image: path.join(root, 'image'), voice: path.join(root, 'voice'), music: path.join(root, 'music'), video: path.join(root, 'video'), world: path.join(root, 'world') };
  const store = createMediaStore({ roots, registryFile: path.join(root, 'media.json') });
  store.ensureRoots();
  const ply = path.join(root, 'scene.ply');
  const body = Buffer.from('ply\nformat ascii 1.0\nelement vertex 1\nproperty float x\nproperty float y\nproperty float z\nend_header\n0 0 0\n');
  fs.writeFileSync(ply, body);
  const rec = store.finalize(ply, { kind: 'world', base: 'scene', worker: 'sharp-reconstruct', model: 'ml-sharp' });
  assert.equal(rec.mime, 'application/vnd.ply');
  assert.equal(store.resolve(rec.artifact_id).bytes, body.length);
  const bad = path.join(root, 'bad.ply'); fs.writeFileSync(bad, 'not a ply');
  assert.throws(() => store.finalize(bad, { kind: 'world', base: 'bad' }), /output-invalid/);
  assert.equal(crypto.createHash('sha256').update(body).digest('hex'), rec.sha256);
});

test('World Project retry invalidates only descendants and preserves ancestors', () => {
  const root = temp();
  const store = createWorldStore({ root });
  const p = store.create({ mode: 'complete360', sourceArtifactId: 'source.png' });
  store.attachArtifact(p.id, 'panorama', { artifact_id: 'pano.png', parent: 'source.png' }, { stage: 'complete' });
  store.updateStage(p.id, 'complete', { status: 'READY' });
  store.attachArtifact(p.id, 'depthMaps', { artifact_id: 'depth.pgm', parent: 'pano.png' }, { stage: 'depth360' });
  store.updateStage(p.id, 'depth360', { status: 'READY' });
  store.retry(p.id, 'depth360');
  const saved = store.get(p.id);
  assert.equal(saved.stages.complete.status, 'READY');
  assert.equal(saved.artifacts.panorama.artifact_id, 'pano.png');
  assert.equal(saved.stages.depth360.status, 'NOT_STARTED');
  assert.deepEqual(saved.artifacts.depthMaps, []);
  assert.equal(saved.stages.fusion.status, 'NOT_STARTED');
  assert.ok(saved.manifest.invalidated.includes('fusion'));
});
