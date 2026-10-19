'use strict';
const { trackScratch } = require('./helpers/owned-scratch');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const crypto = require('node:crypto');
const { createDerivedStore } = require('../derived-store');
const tmp = () => trackScratch(fs.mkdtempSync(path.join(os.tmpdir(), 'dex-ds-')));

test('derived versions are built once, recorded with lineage and a checksum, and reused', async () => {
  const s = createDerivedStore({ root: tmp() }); let builds = 0;
  const parts = ['fx', 'a'.repeat(64), 'radio'];
  const mk = async dest => { builds++; fs.writeFileSync(dest, Buffer.from('derived-audio')); return { frames: 12 }; };
  const a = await s.ensure(parts, { ext: 'f32', kind: 'fx-f32', lineage: { source_artifact_id: 'take.wav', source_sha256: 'a'.repeat(64), fx_identity: 'radio' } }, mk);
  const b = await s.ensure(parts, { ext: 'f32', kind: 'fx-f32' }, mk);
  assert.equal(builds, 1); assert.equal(a.cached, false); assert.equal(b.cached, true);
  assert.equal(a.sha256, crypto.createHash('sha256').update('derived-audio').digest('hex')); assert.equal(a.lineage.source_sha256, 'a'.repeat(64)); assert.equal(a.frames, 12);
  assert.ok(fs.readFileSync(a.path).equals(Buffer.from('derived-audio')));
});

test('concurrent requests for one key share a single build', async () => {
  const s = createDerivedStore({ root: tmp() }); let builds = 0;
  const mk = async dest => { builds++; await new Promise(r => setTimeout(r, 20)); fs.writeFileSync(dest, 'x'); };
  await Promise.all([1, 2, 3].map(() => s.ensure(['k'], { ext: 'wav', kind: 't' }, mk))); assert.equal(builds, 1);
});

test('a missing or truncated derived file is detected and rebuilt; a failed build leaves nothing behind', async () => {
  const s = createDerivedStore({ root: tmp() }); const mk = async dest => fs.writeFileSync(dest, 'data');
  const e = await s.ensure(['x'], { ext: 'f32', kind: 't' }, mk); fs.writeFileSync(e.path, 'dat');
  assert.equal(s.get(e.key), null); const again = await s.ensure(['x'], { ext: 'f32', kind: 't' }, mk); assert.equal(again.cached, false);
  await assert.rejects(s.ensure(['bad'], { ext: 'f32', kind: 't' }, async () => { throw new Error('ffmpeg exploded'); }), /exploded/);
  await assert.rejects(s.ensure(['empty'], { ext: 'f32', kind: 't' }, async dest => fs.writeFileSync(dest, '')), /empty/);
  assert.deepEqual(fs.readdirSync(s.root).filter(f => f.endsWith('.building')), []);
});

test('the ledger survives a restart and the cache can be cleared without touching sources', async () => {
  const root = tmp(); const s = createDerivedStore({ root }); await s.ensure(['y'], { ext: 'wav', kind: 't' }, async d => fs.writeFileSync(d, 'abc'));
  const s2 = createDerivedStore({ root }); assert.equal(s2.entries().length, 1); assert.ok(s2.get(s2.entries()[0].key));
  assert.equal(s2.clear().removed, 1); assert.equal(s2.entries().length, 0);
  assert.throws(() => s.pathOf('../../etc', 'wav'), /invalid/);
});
