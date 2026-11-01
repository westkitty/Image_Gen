'use strict';
// PRODUCE ENTIRE DRAMA: planning, grouping, chunk receipts, resume, retry, cancel, privacy, no false completion.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path');
const D = require('../drama'); const A = require('../voice-audio'); const P = require('../drama-planner');
const { chunkFpOf } = require('../drama-producer');
const { rig } = require('./helpers/drama-rig');

test('phrase receipt fingerprints change only for the edited directed span', () => {
  const components = { text: 'same-source', voice: 'same-voice', engine: 'same-engine', performance: 'old-score' };
  const editedScore = Object.assign({}, components, { performance: 'new-score' });
  const phrase = (phraseId, start, end, text, direction) => ({ phraseId, sourceStart: start, sourceEnd: end, direction });
  const fp = (inputs, c, item) => chunkFpOf(inputs, null, 0, 3, item.text, item, c);
  const a = { ...phrase('beat-1', 0, 5, 'Wait.', 'urgent'), text: 'Wait.' };
  const b = { ...phrase('beat-2', 6, 20, 'I can explain.', 'reassuring'), text: 'I can explain.' };
  const aEdited = Object.assign({}, a, { direction: 'calm' });
  assert.notEqual(fp('old-line-fp', components, a), fp('new-line-fp', editedScore, aEdited));
  assert.equal(fp('old-line-fp', components, b), fp('new-line-fp', editedScore, b));
});

const CANARY = 'PRODUCERCANARY-5521';
const SCRIPT = `INT. WAREHOUSE - NIGHT
TIGER: I warned you about the lamp.
CODEC: I know that already.
TIGER: Then why did you come back here?

EXT. ROOFTOP - DAWN
NARRATOR: And so it ended.
CODEC: Goodbye then.`;
const lines = p => D.renderableLines(p).map(x => x.line);
const by = (p, re) => lines(p).find(l => re.test(l.text));
const itemCounts = r => r.state.requests.map(q => q.items.length);
const longText = n => Array.from({ length: n }, (_, i) => `Sentence number ${i + 1} is here, with a clause; and it keeps going for a while so the text gets long.`).join(' ');
const LONG_SCRIPT = `TIGER: ${longText(28)}\nCODEC: Short reply.\nNARRATOR: Third line follows.`;

// Recovery/privacy tests exercise verified chunk reuse, not loudness or format
// delivery. Use real archive mastering and WAV-only output to avoid slow,
// unrelated LUFS/true-peak scans of long synthetic tones in a bounded fixture.
// Dedicated drama-master and drama-export tests verify loudness and codecs.
const RECOVERY_OPTS = { mastering: { preset: 'archive' }, delivery: { formats: ['wav'] } };

test('one click produces every line, scene masters and a verified project master; job completes with the master', async () => {
  const r = await rig(); const p = await r.project(SCRIPT);
  const res = r.producer.produce(p.id); assert.equal(res.production.status, 'planning'); assert.ok(res.job_id);
  const fin = await r.finish(res);
  assert.equal(fin.status, 'complete', JSON.stringify(fin.errors));
  assert.ok(lines(p).every(l => l.takes.some(t => t.status === 'complete' && t.fingerprint && t.production_id === fin.id)));
  assert.equal(fin.lines.generated, 5); assert.equal(fin.lines.reused, 0); assert.equal(fin.scenes.length, 2);
  const job = r.jobStore.get(res.job_id); assert.equal(job.status, 'COMPLETE'); assert.equal(job.artifacts.length, 1);
  const master = r.mediaStore.resolve(job.artifacts[0]); assert.ok(master && master.kind === 'voice');
  assert.ok(A.duration(A.parseWav(fs.readFileSync(master.path))) > 3);
  assert.equal(p.project_master.artifact_id, master.artifact_id); assert.ok(p.scene_masters[p.scenes[0].id].artifact_id);
  assert.equal(r.arbiter.state().owner, null);
});

test('speech is grouped by voice: one Big Mac job (one model load) per speaker, never one per line', async () => {
  const r = await rig(); const p = await r.project(SCRIPT);
  await r.finish(r.producer.produce(p.id));
  assert.equal(r.state.requests.length, 3, 'TIGER, CODEC and NARRATOR → three model loads');
  assert.deepEqual(itemCounts(r).sort(), [1, 2, 2]);
});

test('re-running an unchanged project does no synthesis and reuses the master', async () => {
  const r = await rig(); const p = await r.project(SCRIPT);
  const first = await r.finish(r.producer.produce(p.id)); const masterId = p.project_master.artifact_id;
  const before = r.state.requests.length;
  const again = await r.finish(r.producer.produce(p.id));
  assert.equal(r.state.requests.length, before, 'zero Big Mac invocations'); assert.equal(again.status, 'complete'); assert.equal(again.noop, true);
  assert.equal(again.artifacts.master, masterId); assert.equal(again.lines.reused, 5); assert.equal(again.lines.generated, 0);
});

test('editing one word re-synthesises only that line and re-mixes only its scene', async () => {
  const r = await rig(); const p = await r.project(SCRIPT);
  await r.finish(r.producer.produce(p.id));
  const sceneBefore = { ...p.scene_masters }; const before = r.state.requests.length;
  D.setLine(p, by(p, /lamp/).id, { text: 'I warned you about the light.' });
  const fin = await r.finish(r.producer.produce(p.id));
  assert.equal(fin.status, 'complete'); assert.equal(r.state.requests.length - before, 1); assert.deepEqual(r.state.requests.at(-1).items.length, 1);
  assert.equal(fin.lines.generated, 1); assert.equal(fin.lines.reused, 4);
  assert.notEqual(p.scene_masters[p.scenes[0].id].artifact_id, sceneBefore[p.scenes[0].id].artifact_id, 'edited scene rebuilt');
  assert.equal(p.scene_masters[p.scenes[1].id].artifact_id, sceneBefore[p.scenes[1].id].artifact_id, 'untouched scene reused');
  assert.equal(by(p, /light/).takes.length, 2, 'the outdated recording is kept next to the new one'); assert.equal(lines(p).filter(l => l.takes.length === 2).length, 1, 'no other line gained a take');
});

test('a remix-only change (cue) causes no synthesis', async () => {
  const r = await rig(); const p = await r.project(SCRIPT);
  await r.finish(r.producer.produce(p.id)); const before = r.state.requests.length;
  const f = path.join(require('node:os').tmpdir(), 'dex-bed-' + Date.now() + '.wav'); fs.writeFileSync(f, A.encodeWav({ sampleRate: 24000, channels: [new Float32Array(48000).map((_, i) => 0.2 * Math.sin(i / 20))] }));
  const bed = r.mediaStore.finalize(f, { kind: 'music', base: 'bed' });
  r.drama.addTrack(p.id, { role: 'music', artifact_id: bed.artifact_id, scene_id: p.scenes[1].id });
  const fin = await r.finish(r.producer.produce(p.id));
  assert.equal(r.state.requests.length, before); assert.equal(fin.status, 'complete'); assert.deepEqual(fin.scenes.map(s => s.action), ['reuse', 'rebuild']);
});

test('blocked casting is refused up front with the named problems; no job is created', async () => {
  const r = await rig(); const p = await r.project(SCRIPT, { bind: false });
  assert.throws(() => r.producer.produce(p.id), e => e.gate === 'production-blocked' && e.status === 409 && e.plan.blocking_errors.some(b => b.code === 'cast-unresolved'));
  assert.equal(r.jobStore.list().length, 0);
});

test('a chunk failure mid-run keeps the verified chunks; a later run synthesises ONLY the missing ones', async () => {
  const r = await rig({ failItem: 1 }); const p = await r.project(LONG_SCRIPT);
  const first = await r.finish(r.producer.produce(p.id));
  assert.ok(['partial', 'failed'].includes(first.status), first.status);
  const tiger = lines(p)[0].id; const rc = r.chunkStore.receipts(p.id).filter(x => x.line_id === tiger);
  assert.ok(rc.length >= 2, 'verified chunks before each failure were kept: ' + rc.length); assert.ok(rc.every(x => /^[a-f0-9]{64}$/.test(x.sha256)));
  assert.notEqual(r.jobStore.get(first.job_id).status, 'COMPLETE'); assert.equal(p.project_master, undefined, 'no master from an incomplete drama');
  r.state.failItem = null; r.state.requests.length = 0;
  const second = await r.finish(r.producer.produce(p.id, RECOVERY_OPTS));
  assert.equal(second.status, 'complete', JSON.stringify(second.errors));
  const total = lines(p)[0].takes.find(t => t.status === 'complete').chunks;
  const sent = r.state.requests.reduce((n, q) => n + q.items.length, 0);
  assert.equal(second.chunks.cached, rc.length); assert.equal(sent, total - rc.length, 'exactly the missing chunks were rendered');
  assert.equal(second.lines.reused, 2, 'the finished CODEC and NARRATOR lines were reused');
});

test('bounded retry: a persistently failing chunk is retried a limited number of times, then reported; no false completion', async () => {
  const r = await rig({ failItem: 0 }); const p = await r.project('TIGER: One line only.');
  const fin = await r.finish(r.producer.produce(p.id));
  assert.equal(fin.status, 'failed'); assert.equal(r.state.requests.length, 3, 'max_attempts = 3');
  assert.equal(fin.chunks.failed, 1); assert.equal(fin.chunks.retries, 2); assert.ok(fin.errors.some(e => e.line_id === lines(p)[0].id));
  assert.equal(r.jobStore.get(fin.job_id).status, 'FAILED'); assert.equal(p.project_master, undefined); assert.equal(lines(p)[0].takes.length, 0);
  assert.equal(r.arbiter.state().owner, null);
});

test('connection loss never produces a completed production', async () => {
  const r = await rig({ lose: 1 }); const p = await r.project('TIGER: Hello.\nCODEC: Hi.');
  const fin = await r.finish(r.producer.produce(p.id));
  assert.notEqual(fin.status, 'complete'); assert.notEqual(r.jobStore.get(fin.job_id).status, 'COMPLETE'); assert.equal(p.project_master, undefined);
});

test('cancellation stops after the current Big Mac group, keeps finished chunks, and builds no master', async () => {
  const r = await rig({ delayMs: 15 }); const p = await r.project(SCRIPT);
  const res = r.producer.produce(p.id);
  for (let i = 0; i < 400 && !r.state.requests.length; i++) await new Promise(x => setTimeout(x, 5));
  const c = r.producer.cancel(res.production.id); assert.equal(c.ok, true);
  const fin = await r.finish(res);
  assert.equal(fin.status, 'cancelled'); assert.ok(r.state.requests.length < 3, 'later groups were never started'); assert.equal(p.project_master, undefined);
  assert.equal(r.jobStore.get(res.job_id).status, 'CANCELLED'); assert.equal(r.arbiter.state().owner, null);
  assert.ok(lines(p).some(l => l.takes.length), 'work already finished is kept');
  const resumed = await r.finish(r.producer.produce(p.id)); assert.equal(resumed.status, 'complete');
});

test('an invalid or tampered chunk receipt is detected and that chunk alone is regenerated', async () => {
  const r = await rig({ failItem: 1 }); const p = await r.project(LONG_SCRIPT);
  const first = await r.finish(r.producer.produce(p.id)); assert.notEqual(first.status, 'complete');
  const tiger = lines(p)[0].id; const rc = r.chunkStore.receipts(p.id).filter(x => x.line_id === tiger); assert.ok(rc.length >= 2);
  fs.appendFileSync(r.chunkStore.pathOf(p.id, rc[0].fingerprint), Buffer.from([9, 9, 9]));      // corrupt it
  r.state.failItem = null; r.state.requests.length = 0;
  const second = await r.finish(r.producer.produce(p.id, RECOVERY_OPTS));
  assert.equal(second.status, 'complete'); assert.equal(second.chunks.invalid, 1, 'the corrupt receipt was reported');
  assert.equal(second.chunks.cached, rc.length - 1); assert.ok(r.state.requests.reduce((n, q) => n + q.items.length, 0) >= 1);
});

test('privacy: unsaved script text never reaches jobs, media metadata, SSE-bound events, receipts or errors', async () => {
  const r = await rig({ failItem: 1 }); const p = await r.project(`TIGER: ${CANARY} ${longText(28)}\nCODEC: ${CANARY} reply.`);
  const seen = []; const orig = r.jobStore;
  const a = await r.finish(r.producer.produce(p.id)); r.state.failItem = null;
  const b = await r.finish(r.producer.produce(p.id, RECOVERY_OPTS)); r.jobStore.flush();
  const dump = [fs.readFileSync(path.join(r.base, 'jobs.json'), 'utf8'), fs.readFileSync(path.join(r.base, 'media.json'), 'utf8'), JSON.stringify(r.events), JSON.stringify(a), JSON.stringify(b), JSON.stringify(r.chunkStore.receipts(p.id))].join('\n');
  assert.ok(!dump.includes(CANARY), 'no script text leaked');
  for (const q of r.jobStore.list({ limit: 1000 })) assert.ok(!JSON.stringify(q).includes(CANARY));
  assert.ok(!fs.existsSync(path.join(r.base, 'drama-chunks', p.id + '.receipts.json')), 'unsaved project: receipts stay in memory');
});

test('saved project: receipts persist, so a fresh producer (restart) resumes without re-rendering verified chunks', async () => {
  const r = await rig({ failItem: 1 }); const p = await r.project(LONG_SCRIPT); r.dstore.save(p.id);
  const a = await r.finish(r.producer.produce(p.id)); assert.notEqual(a.status, 'complete');
  assert.ok(fs.existsSync(path.join(r.base, 'drama-chunks', p.id + '.receipts.json')));
  const { createChunkStore } = require('../chunk-store'); const reborn = createChunkStore({ root: r.base + '/drama-chunks', persist: () => true });
  assert.ok(reborn.receipts(p.id).length >= 1); const rc = reborn.receipts(p.id)[0]; assert.ok(reborn.get(p.id, rc.fingerprint));
  assert.ok(fs.readFileSync(path.join(r.base, 'drama-chunks', p.id + '.receipts.json'), 'utf8').indexOf(CANARY) < 0);
});

test('one production per project at a time; manual renders are refused while it runs', async () => {
  const r = await rig({ delayMs: 20 }); const p = await r.project(SCRIPT);
  const res = r.producer.produce(p.id);
  assert.throws(() => r.producer.produce(p.id), e => e.status === 409 && e.gate === 'production-running');
  assert.throws(() => r.drama.startRun(p.id, { scope: 'project' }), e => e.status === 409);
  await r.finish(res);
});

test('the heavy lease is never held by two groups at once (no unexpected second inference worker)', async () => {
  const r = await rig({ delayMs: 5 }); const p = await r.project(SCRIPT);
  let maxOwners = 0; const t = setInterval(() => { const s = r.arbiter.state(); maxOwners = Math.max(maxOwners, s.owner ? 1 : 0); }, 1);
  await r.finish(r.producer.produce(p.id)); clearInterval(t);
  assert.equal(maxOwners <= 1, true); assert.ok(r.calls.filter(([c, a]) => c === 'ssh' && a.includes('mktemp -d')).length === r.state.requests.length);
});

test('progress is truthful: phases advance, labels carry indexes only, percentages come from counts', async () => {
  const r = await rig(); const p = await r.project(SCRIPT);
  const seen = []; r.jobStore.get; const res = r.producer.produce(p.id);
  const timer = setInterval(() => { const j = r.jobStore.get(res.job_id); if (j && j.progress) seen.push(JSON.parse(JSON.stringify(j.progress))); }, 1);
  const fin = await r.finish(res); clearInterval(timer);
  assert.ok(seen.some(x => x.phase === 'rendering' && /Scene \d\/\d · line \d+\/\d+/.test(x.label)), JSON.stringify(seen.slice(-3)));
  assert.ok(seen.every(x => x.label == null || !/TIGER|CODEC|NARRATOR|lamp|warned/i.test(x.label)));
  const phases = []; for (const x of r.events.filter(e => e.type === 'phase')) phases.push(x.phase);
  assert.deepEqual([...new Set(phases)].slice(0, 2), ['planning', 'rendering']); assert.equal(fin.status, 'complete');
  const done = r.jobStore.get(res.job_id).progress; assert.equal(done.phase, 'complete');
});

test('editing a line while production runs marks the result superseded; the stale take never becomes current', async () => {
  const r = await rig({ delayMs: 25 }); const p = await r.project(SCRIPT);
  const res = r.producer.produce(p.id);
  for (let i = 0; i < 400 && !r.state.requests.length; i++) await new Promise(x => setTimeout(x, 5));
  const target = by(p, /already/); D.setLine(p, target.id, { text: 'I knew that long ago.' });
  const fin = await r.finish(res);
  assert.equal(fin.superseded, true);
  const plan = P.planProduction(p, r.drama.planContext());
  assert.ok(plan.lines.find(l => l.line_id === target.id).state !== 'reuse', 'the edited line is not served by the stale take');
});
