'use strict';
// Item-output mode of the media bridge: one Big Mac invocation, N independently delivered outputs
// (used by auditions, one-click production and durable chunk receipts). Fake ssh/scp, real stores.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path');
const A = require('../voice-audio'); const { harness, settle, sha } = require('./helpers/fake-bigmac');

const PRIV = 'ITEMMODE-CANARY-4471';
const mkProfile = h => h.profiles.create({ name: 'N', type: 'preset', preset_voice: 'af_heart' });
const plan = n => ({ items: Array.from({ length: n }, (_, i) => ({ text: `${PRIV} line ${i}`, seed: 10 + i })), voice: 'af_heart', language: 'en' });
const ctx = (extra) => Object.assign({ probe: { runtime_available: true, model_available: true }, saveText: false, operation: 'batch-test' }, extra);

test('item mode delivers every verified output separately, in order, without stitching', async () => {
  const h = harness(); const got = [];
  const r = h.bridge.startBatch('kokoro', plan(3), ctx({ mode: 'items', onItem: async it => { got.push({ index: it.index, sha256: it.sha256, bytes: fs.readFileSync(it.file).length, duration: it.duration }); } }));
  const d = await settle(h.voice, r.job_id);
  assert.equal(d.status, 'COMPLETE', JSON.stringify(d));
  assert.deepEqual(got.map(g => g.index), [0, 1, 2]);
  assert.ok(got.every(g => /^[a-f0-9]{64}$/.test(g.sha256) && g.bytes > 1000 && g.duration > 0));
  assert.equal(h.mediaStore.list('voice').length, 0, 'the bridge itself publishes nothing in item mode');
  assert.equal(h.state.requests.length, 1, 'one model load for all items'); assert.equal(h.arbiter.state().owner, null);
  assert.ok(h.calls.some(([c, a]) => c === 'ssh' && a.includes('rm -rf')), 'remote job dir cleanup attempted');
  assert.equal(h.jobStore.get(r.job_id).owned_resources[0].state, 'succeeded');
});

test('an item may be published as a canonical artifact and then appears on the job', async () => {
  const h = harness(); const ids = [];
  const r = h.bridge.startBatch('kokoro', plan(2), ctx({ mode: 'items', onItem: async it => {
    const rec = h.mediaStore.finalize(it.file, { kind: 'voice', base: 'item-' + it.index, job_id: it.job_id, worker: 'kokoro', duration: it.duration });
    ids.push(rec.artifact_id); return rec;
  } }));
  const d = await settle(h.voice, r.job_id);
  assert.equal(d.status, 'COMPLETE'); assert.deepEqual(h.jobStore.get(r.job_id).artifacts, ids);
  assert.equal(h.jobStore.get(r.job_id).artifact_validation.artifacts.length, 2);
});

test('remote failure at item 3/4 still delivers the verified items 1-2, then fails naming the item', async () => {
  const h = harness({ failItem: 2 }); const got = [];
  const r = h.bridge.startBatch('kokoro', plan(4), ctx({ mode: 'items', onItem: async it => { got.push(it.index); } }));
  const d = await settle(h.voice, r.job_id);
  assert.equal(d.status, 'FAILED'); assert.match(d.error, /chunk 3\/4/); assert.deepEqual(got, [0, 1]);
  assert.equal(h.arbiter.state().owner, null); assert.equal(h.jobStore.get(r.job_id).owned_resources[0].state, 'succeeded');
});

test('connection loss with no completion marker delivers nothing and never reports success', async () => {
  const h = harness({ lose: 2 }); const got = [];
  const r = h.bridge.startBatch('kokoro', plan(4), ctx({ mode: 'items', onItem: async it => { got.push(it.index); } }));
  const d = await settle(h.voice, r.job_id);
  assert.equal(d.status, 'FAILED'); assert.equal(d.gate, 'generation'); assert.deepEqual(got, []);
});

test('a throwing consumer fails the job at that item and stops delivery', async () => {
  const h = harness(); const got = [];
  const r = h.bridge.startBatch('kokoro', plan(3), ctx({ mode: 'items', onItem: async it => { got.push(it.index); if (it.index === 1) throw new Error('disk full'); } }));
  const d = await settle(h.voice, r.job_id);
  assert.equal(d.status, 'FAILED'); assert.equal(d.gate, 'canonicalization'); assert.match(d.error, /item 2\/3.*disk full/); assert.deepEqual(got, [0, 1]);
});

test('item mode keeps text out of durable job state, media registry and errors', async () => {
  const h = harness({ failItem: 1 });
  const r = h.bridge.startBatch('kokoro', plan(3), ctx({ mode: 'items', onItem: async () => {} }));
  const d = await settle(h.voice, r.job_id); h.jobStore.flush();
  assert.ok(!JSON.stringify(d).includes(PRIV));
  assert.ok(!fs.readFileSync(path.join(h.base, 'jobs.json'), 'utf8').includes(PRIV));
});

test('default (stitching) mode is unchanged', async () => {
  const h = harness(); const r = h.bridge.startBatch('kokoro', plan(3), ctx({ gapsMs: [100, 100], boundaries: ['sentence', 'sentence', 'end'] }));
  const d = await settle(h.voice, r.job_id);
  assert.equal(d.status, 'COMPLETE'); assert.equal(h.mediaStore.list('voice').length, 1);
  assert.equal(A.parseWav(fs.readFileSync(h.mediaStore.resolve(d.artifact.artifact_id).path)).channels.length, 1);
});
