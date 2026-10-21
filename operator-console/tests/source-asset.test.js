'use strict';
// G3 / T-301, T-303, T-304, T-305 — canonical source-asset handoffs.
//
// Failing before this change:
//   * startAsset3d() and startWorld() fell back to `this.state.runs[0].imageFile`
//     when their picker was empty, so a 3D/World job could be started from a
//     different image than the one the user had selected.
//   * the 3D and World <select> elements rendered the newest run as the current
//     value even though nothing was chosen.
//   * Enhance and Edit accepted any string as a source id.
// These tests pin the resolver contract and the absence of the fallbacks.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const S = require('../public/dexdiffusion/source-asset.js');

const SRC = path.join(__dirname, '..', 'public', 'dexdiffusion');
const component = fs.readFileSync(path.join(SRC, 'component.js'), 'utf8');
const editUi = fs.readFileSync(path.join(SRC, 'edit-ui.js'), 'utf8');
const workstation = fs.readFileSync(path.join(SRC, 'workstation-ui.js'), 'utf8');
const html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');

const IMG = '20261020-101500-controlled-flux2-klein-4b-s51005.png';

test('T-301: a canonical image id is a single, unambiguously addressable file name', () => {
  assert.equal(S.isImageId(IMG), true);
  assert.equal(S.isImageId('image.webp'), true);
  assert.equal(S.isImageId('image.JPEG'), true);
  for (const bad of ['', ' ', '../secret.png', 'a/b.png', 'a\\b.png', 'C:\\x.png',
    'http://evil/x.png', 'image.png?x=1', 'dir/../image.png', 'image.png ', ' .png',
    'image.gif', 'image', null, undefined, 42, 'a'.repeat(256)]) {
    assert.equal(S.isImageId(bad), false, `must refuse ${JSON.stringify(bad)}`);
  }
});

test('T-301: a run file name may be used for Enhance only when it is a plain supported image', () => {
  assert.equal(S.isSafeImageName('run-01.png'), true);
  assert.equal(S.isSafeImageName('../../etc/passwd'), false);
  assert.equal(S.isSafeImageName('run-01.txt'), false);
  assert.equal(S.isSafeImageName('/abs/run-01.png'), false);
});

test('T-304: no source is invented — an empty picker never falls back to the newest run', () => {
  const runs = [{ id: 'r2', imageFile: 'newest.png' }, { id: 'r1', imageFile: 'older.png' }];
  const none = S.resolveSource({ runs });
  assert.equal(none.ok, false);
  assert.equal(none.code, 'no-source');
  assert.equal(none.message, 'Choose a source image first.');
  // The fallback exists only where it is explicitly asked for.
  const explicitNewest = S.resolveSource({ runs, allowNewest: true });
  assert.deepEqual({ ok: explicitNewest.ok, id: explicitNewest.id, source: explicitNewest.source },
    { ok: true, id: 'newest.png', source: 'newest' });
});

test('T-305: an explicit pick wins over the cross-module selection, and the selection is used when it is an image', () => {
  const sel = { kind: 'image', id: 'selected.png' };
  const runs = [{ imageFile: 'newest.png' }];
  const fromPick = S.resolveSource({ explicitId: 'picked.png', selection: sel, runs });
  assert.equal(fromPick.id, 'picked.png');
  assert.equal(fromPick.source, 'explicit');
  const fromSel = S.resolveSource({ explicitId: '', selection: sel, runs });
  assert.equal(fromSel.id, 'selected.png');
  assert.equal(fromSel.source, 'selection');
});

test('T-304: a non-image selection is refused, not coerced into an image source', () => {
  const r = S.resolveSource({ selection: { kind: 'audio', id: 'take.wav' } });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'wrong-kind');
  assert.match(r.message, /not an image/);
});

test('T-301: staged uploads are a different kind of asset and are never passed as a library image', () => {
  assert.equal(S.resolveSource({ explicitId: 'staged:abc123' }).code, 'staged');
  assert.equal(S.normalizeSelection({ kind: 'image', id: 'staged:abc123' }).code, 'staged');
  const r = S.resolveSource({ runs: [{ imageFile: 'staged:abc123' }], allowNewest: true });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'staged');
});

test('T-301: path traversal and URLs are refused with a typed reason', () => {
  for (const bad of ['../../etc/passwd', '/etc/passwd.png', 'http://x/y.png']) {
    const r = S.resolveSource({ explicitId: bad });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'not-canonical');
  }
});

test('T-301: the choice list keeps only canonical images, de-duplicated and in order', () => {
  const picks = S.choices([
    { id: 'r3', imageFile: 'c.png', model: 'm' },
    { id: 'r2', imageFile: 'c.png' },
    { id: 'r1', imageFile: 'not-an-image.txt' },
    { id: 'r0', imageFile: 'b.png' }
  ]);
  assert.deepEqual(picks.map(p => p.id), ['c.png', 'b.png']);
});

test('T-305: lineage keeps the canonical ids that were actually recorded and stops on a loop', () => {
  const rec = { id: 'child.png', parent: { id: 'parent.png', parent: { id: 'root.png' } } };
  const lin = S.lineage(rec);
  assert.deepEqual(lin.ids, ['child.png', 'parent.png', 'root.png']);
  assert.equal(lin.root, 'root.png');
  const loop = S.lineage({ id: 'a.png', parent: { id: 'b.png', parent: { id: 'a.png' } } });
  assert.equal(loop.ok, false);
  assert.equal(loop.code, 'cycle');
  assert.deepEqual(loop.ids, ['a.png', 'b.png']);
});

test('T-304: World and 3D resolve their source through the resolver and refuse an empty picker', () => {
  assert.match(component, /async startAsset3d\(mode\) \{[\s\S]{0,700}SA\.resolveSource\(\{ explicitId: this\.state\.asset3dSourceArtifact, selection: this\.state\.activeAssetSelection \}\)/);
  assert.match(component, /async startWorld\(mode, sourceArtifactId\) \{[\s\S]{0,700}SA\.resolveSource\(\{ explicitId: sourceArtifactId \|\| this\.state\.worldSourceArtifact, selection: this\.state\.activeAssetSelection \}\)/);
  assert.doesNotMatch(component, /runs\[0\] && runs\[0\]\.imageFile/, 'the newest-run fallback must be gone');
  assert.doesNotMatch(component, /const source = this\.state\.asset3dSourceArtifact \|\|/, 'no implicit 3D source');
  assert.match(component, /if \(!resolved\.ok\) \{ this\.toast\(resolved\.message, '#fbbf24'\); return; \}/);
});

test('T-304: the 3D and World pickers start empty and say so', () => {
  assert.match(component, /'Choose a source image…' : 'No canonical images loaded'/);
  assert.doesNotMatch(component, /worldSourceArtifact \|\| \(runs\[0\]/);
  assert.match(component, /data-source-rule': '3d'[\s\S]{0,220}newest result is never substituted/);
  assert.match(component, /data-source-rule': 'world'[\s\S]{0,220}no source is pre-selected/);
});

test('T-303: Enhance refuses a non-image / traversing source name before calling the API', () => {
  assert.match(component, /_resolveSource\(runId, file\) \{[\s\S]{0,900}SA\.isSafeImageName/);
  assert.match(workstation, /P\.sendToEnhance = async function \(id\) \{[\s\S]{0,420}SA\.isImageId\(String\(id/);
});

test('T-302: Edit refuses a malformed source id but keeps the staged-upload path', () => {
  assert.match(editUi, /P\.openImageInEdit = async function \(imageId, mode, opts\) \{[\s\S]{0,900}SA\.isImageId\(requested\)/);
  assert.match(editUi, /\^staged:/);
});

test('G3: the resolver loads before component.js in the shell', () => {
  const nav = html.indexOf('<script src="source-asset.js">');
  const comp = html.indexOf('<script src="component.js">');
  assert.ok(nav > 0, 'source-asset.js must be loaded');
  assert.ok(nav < comp, 'source-asset.js must load before component.js');
  const module = require('../public/dexdiffusion/source-asset.js');
  assert.equal(typeof module.resolveSource, 'function');
  assert.equal(typeof globalThis.DexSourceAsset.resolveSource, 'function', 'also exposed as window.DexSourceAsset');
});
