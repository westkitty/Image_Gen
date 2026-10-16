'use strict';
// Delivery: scene masters, mastered project master, MP3/M4B/M4A, stems, chapters, historical snapshots, preview/export parity.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path');
const D = require('../drama'); const T = require('../audio-tools');
const { rig } = require('./helpers/drama-rig');

const opts = { skip: T.available().ffmpeg ? false : 'ffmpeg not installed' };
const SCRIPT = `INT. WAREHOUSE - NIGHT
TIGER: I warned you about the lamp.
CODEC: I know that already.

EXT. ROOFTOP - DAWN
NARRATOR: And so it ended.
CODEC: Goodbye then.`;
const A = require('../voice-audio');
const pcm = file => { const b = fs.readFileSync(file); return b.subarray(A.wavHeaderInfo(b.subarray(0, 4096), b.length).dataOffset); };
const lines = p => D.renderableLines(p).map(x => x.line);

async function produced(extra = {}) {
  const r = await rig(); const p = await r.project(SCRIPT, extra.project);
  const fin = await r.finish(r.producer.produce(p.id, extra.opts || {})); assert.equal(fin.status, 'complete', JSON.stringify(fin.errors));
  return Object.assign(r, { p, fin });
}

test('a produced drama publishes WAV master, MP3 and a chaptered M4B, all decodable and the same length', opts, async () => {
  const r = await produced(); const pm = r.p.project_master;
  assert.deepEqual(Object.keys(pm.outputs).sort(), ['m4b', 'mp3']);
  const m = r.mediaStore.resolve(pm.artifact_id), mp3 = r.mediaStore.resolve(pm.outputs.mp3), m4b = r.mediaStore.resolve(pm.outputs.m4b);
  const pi = await T.probe(m.path); assert.equal(pi.codec, 'pcm_s24le'); assert.equal(pi.sample_rate, 48000); assert.equal(pi.channels, 2);
  for (const f of [mp3, m4b]) { await T.decodeCheck(f.path); assert.ok(Math.abs((await T.probe(f.path)).duration - pi.duration) < 0.3); }
  const ch = (await T.probe(m4b.path)).chapters; assert.deepEqual(ch.map(c => c.title), ['INT. WAREHOUSE - NIGHT', 'EXT. ROOFTOP - DAWN']);
  assert.ok(ch[1].start > ch[0].end - 0.01 && Math.abs(ch[1].start - pm.chapters[1].start_s) < 0.01, 'chapter start matches the scene start in the master');
  assert.equal(fs.readFileSync(m4b.path).toString('latin1', 8, 12), 'M4B ');
  assert.equal(m4b.mime, 'audio/mp4'); assert.ok(mp3.download_url);
});

test('mastering is measured and recorded; the master meets the drama target without hidden changes', opts, async () => {
  const r = await produced(); const mr = r.p.project_master.mastering;
  assert.equal(mr.applied, true); assert.equal(mr.preset, 'drama'); assert.ok(Math.abs(mr.after.integrated_lufs + 18) <= 0.5 || mr.limiter_engaged); assert.ok(mr.after.true_peak_dbtp <= -1.3);
  const measured = await T.measureLoudness(r.mediaStore.resolve(r.p.project_master.artifact_id).path); assert.ok(Math.abs(measured.integrated_lufs - mr.after.integrated_lufs) < 0.2, 'independent re-measure agrees');
});

test('scene preview and export agree: with mastering off, the master contains each scene master byte-for-byte at the chapter offset', opts, async () => {
  const r = await produced({ opts: { mastering: { preset: 'archive' } } }); const pm = r.p.project_master;
  const master = pcm(r.mediaStore.resolve(pm.artifact_id).path);
  for (const [i, sid] of r.p.scenes.map(s => s.id).entries()) {
    const sm = r.p.scene_masters[sid]; const sceneBytes = pcm(r.mediaStore.resolve(sm.artifact_id).path);
    const at = Math.round(pm.chapters[i].start_s * 48000) * 6;
    assert.ok(master.subarray(at, at + sceneBytes.length).equals(sceneBytes), `scene ${sid} is identical inside the master`);
  }
  assert.equal(pm.mastering.applied, false); assert.match(pm.mastering.reason, /archive/i);
});

test('with mastering on, the master equals the scene master times one recorded static gain (no hidden processing)', opts, async () => {
  const r = await produced({ opts: { mastering: { preset: 'drama' } } }); const pm = r.p.project_master; const g = Math.pow(10, pm.mastering.gain_db / 20);
  if (pm.mastering.limiter_engaged) return;
  const master = pcm(r.mediaStore.resolve(pm.artifact_id).path), sid = r.p.scenes[0].id; const sc = pcm(r.mediaStore.resolve(r.p.scene_masters[sid].artifact_id).path);
  const at = (i) => master.readIntLE(i * 6, 3) / 8388607, bt = (i) => sc.readIntLE(i * 6, 3) / 8388607; let worst = 0;
  for (let i = 0; i < Math.min(60000, sc.length / 6); i += 13) worst = Math.max(worst, Math.abs(at(i) - bt(i) * g));
  assert.ok(worst < 3e-5, 'static gain only: ' + worst);
});

test('stems (opt-in) are published, aligned to the master length, and carry the same mastering gain', opts, async () => {
  const r = await produced({ opts: { delivery: { stems: true, formats: ['mp3'] } } }); const pm = r.p.project_master;
  assert.ok(pm.stems.dialogue); const master = await T.scanWav(r.mediaStore.resolve(pm.artifact_id).path);
  for (const [role, id] of Object.entries(pm.stems)) { const s = await T.scanWav(r.mediaStore.resolve(id).path); assert.equal(s.frames, master.frames, role + ' length equals the master'); }
  assert.ok(pm.outputs.mp3 && !pm.outputs.m4b, 'only the requested formats are encoded');
});

test('changing mastering or formats re-masters without touching speech or scene masters', opts, async () => {
  const r = await produced(); const before = { reqs: r.state.requests.length, scene: { ...r.p.scene_masters } };
  const fin = await r.finish(r.producer.produce(r.p.id, { mastering: { preset: 'podcast' } }));
  assert.equal(fin.status, 'complete'); assert.equal(r.state.requests.length, before.reqs); assert.deepEqual(r.p.scene_masters, before.scene, 'scene masters reused as-is'); assert.equal(r.p.project_master.mastering.preset, 'podcast');
  assert.ok(fin.scenes.every(s => s.action === 'reuse'));
});

test('manual export: a scene master, a project export and a labelled historical snapshot', opts, async () => {
  const r = await produced(); const sc = await r.drama.assembleExport(r.p.id, { sceneId: r.p.scenes[0].id });
  assert.equal(sc.manifest.scope, 'scene'); assert.equal(sc.manifest.kind, 'current'); assert.ok(sc.manifest.items.length === 2 && sc.manifest.items.every(i => /^[a-f0-9]{64}$/.test(i.speech_inputs_sha)));
  const full = await r.drama.assembleExport(r.p.id); assert.equal(full.manifest.scope, 'project'); assert.equal(full.manifest.items.length, 4); assert.ok(full.manifest.chapters.length === 2);
  assert.ok(full.manifest.items.every((it, i, a) => i === 0 || it.start_s > a[i - 1].start_s), 'timeline order across scenes');
  const l = lines(r.p)[0]; D.setLine(r.p, l.id, { text: 'Edited after production.' });
  await assert.rejects(r.drama.assembleExport(r.p.id), e => e.gate === 'missing-takes' && e.missing.some(m => m.state === 'stale'));
  const before = r.p.project_master.artifact_id;
  const h = await r.drama.assembleExport(r.p.id, { historical: true }); assert.equal(h.manifest.kind, 'historical'); assert.equal(h.manifest.current, false); assert.equal(h.manifest.stale_lines.length, 1);
  assert.equal(r.p.project_master.artifact_id, before, 'a historical snapshot never replaces the current master'); assert.equal(r.p.exports[0].kind, 'historical');
});

test('a failed encode never reports success: the production fails and no master is recorded', opts, async () => {
  const r = await rig(); const p = await r.project('TIGER: Hello.');
  const orig = r.assembly.builder.exportFormats; r.assembly.builder.exportFormats = async () => { throw new Error('encode failed: simulated'); };
  const fin = await r.finish(r.producer.produce(p.id)); r.assembly.builder.exportFormats = orig;
  assert.equal(fin.status, 'failed'); assert.match(fin.errors[0].message, /encode failed/); assert.equal(p.project_master, undefined); assert.equal(r.jobStore.get(fin.job_id).status, 'FAILED');
});
