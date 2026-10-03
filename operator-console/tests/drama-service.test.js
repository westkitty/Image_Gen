'use strict';
// Drama orchestration against a fake voice service + a real media store.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const M = require('../media'); const A = require('../voice-audio'); const D = require('../drama');
const { createDramaStore } = require('../drama'); const { createDramaService } = require('../drama-service');

const tmp = p => fs.mkdtempSync(path.join(os.tmpdir(), 'dex-ds-' + p));
const tone = (sec, hz) => { const n = Math.round(sec * 24000), a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = 0.4 * Math.sin(2 * Math.PI * hz * i / 24000); return { sampleRate: 24000, channels: [a] }; };
const SCRIPT = 'TIGER: I warned you.\nCODEC: [quietly] I know.\nNARRATOR: The rain fell.\nTIGER: Then why come back?';

function setup({ failTexts = [] } = {}) {
  const base = tmp('x');
  const roots = { image: base + '/i', voice: base + '/v', music: base + '/m', video: base + '/vid' };
  const mediaStore = M.createMediaStore({ roots, registryFile: base + '/media.json' }); mediaStore.ensureRoots();
  const store = createDramaStore({ root: base + '/drama' });
  const calls = [], jobs = new Map(); let n = 0;
  const profiles = { get: id => (id ? { id, name: id, type: 'preset', validation: { state: 'valid' }, preferred_engine: 'kokoro' } : null) };
  const voice = {
    renderText(args) {
      calls.push(args);
      if (failTexts.includes(args.text)) { return { error: 'engine refused this line', gate: 'profile-invalid', status: 400 }; }
      const id = 'job-' + (++n); jobs.set(id, args); return { job_id: id, engine: 'kokoro', seed: 100 + n, chunks: 1, delivery: { requested: args.direction || null, applied: false, note: args.direction ? 'Kokoro cannot honor delivery directions ("' + args.direction + '" was NOT applied)' : null } };
    },
    describe(id) { return jobs.has(id) ? { job_id: id, status: 'RUNNING', label: 'Generating chunk 1/1', progress: { chunk: 1, total: 1 } } : null; },
    async waitJob(id) {
      const args = jobs.get(id); const f = path.join(tmp('w'), 'o.wav');
      fs.writeFileSync(f, A.encodeWav(tone(0.5 + (args.text.length % 5) * 0.1, 200 + args.text.length * 3)));
      const rec = mediaStore.finalize(f, { kind: 'voice', base: 'test-' + id, job_id: id, worker: 'kokoro', duration: 0.6, meta: { drama: args.meta } });
      return { job_id: id, status: 'COMPLETE', artifact: { artifact_id: rec.artifact_id, duration: rec.duration, sha256: rec.sha256 } };
    },
  };
  const svc = createDramaService({ store, voice, profiles, mediaStore });
  return { base, store, svc, calls, mediaStore };
}
const waitRun = async (svc, id) => { for (let i = 0; i < 400; i++) { const r = svc.runView(id); if (r.status !== 'running') return r; await new Promise(r2 => setTimeout(r2, 5)); } throw new Error('run did not finish'); };
const bindAll = (svc, p) => p.actors.forEach(a => D.bindActor(p, a.id, 'vp-' + a.speaker_key.toLowerCase()));

test('rendering is blocked only for unresolved speakers that have lines', async () => {
  const { svc } = setup(); const c = await svc.createProject({ title: 'T', script: SCRIPT });
  const p = svc.need(c.project.id);
  assert.throws(() => svc.startRun(p.id, { scope: 'project' }), e => e.gate === 'unresolved-speaker' && e.unresolved.length === 3 && /TIGER/.test(e.message));
  D.bindActor(p, p.actors.find(a => a.speaker_key === 'TIGER').id, 'vp-t');
  assert.throws(() => svc.startRun(p.id, { scope: 'project' }), e => e.unresolved.length === 2);
  const tiger = D.renderableLines(p).find(x => x.line.speaker_key === 'TIGER');
  const r = svc.startRun(p.id, { scope: 'line', lineId: tiger.line.id }); assert.ok(r.id, 'a bound speaker renders even while others are unresolved');
  await waitRun(svc, r.id);
});

test('project run: every line gets a take; resume skips generated lines; alternate adds a NEW take without replacing', async () => {
  const { svc, calls } = setup(); const p = svc.need((await svc.createProject({ title: 'T', script: SCRIPT })).project.id); bindAll(svc, p);
  const run = svc.startRun(p.id, { scope: 'project' });
  assert.equal(run.total, 4); const done = await waitRun(svc, run.id);
  assert.deepEqual([done.status, done.done, done.failed], ['complete', 4, 0]);
  assert.ok(calls.every(c => c.saveText === false), 'dialogue never persisted by job records');
  assert.ok(calls.some(c => c.direction === 'quietly'), 'line direction reaches the render');
  const again = svc.startRun(p.id, { scope: 'project', resume: true }); assert.equal(again.id, null); assert.equal(again.total, 0);
  const line = D.renderableLines(p)[0].line; const first = line.takes[0];
  const alt = svc.startRun(p.id, { scope: 'line', lineId: line.id, alternate: true }); await waitRun(svc, alt.id);
  assert.equal(line.takes.length, 2); assert.equal(line.takes[0].id, first.id); assert.equal(line.takes[0].artifact_id, first.artifact_id, 'first take untouched');
  assert.equal(line.active_take_id, first.id, 'alternate does not steal the active take');
  D.selectTake(p, line.id, line.takes[1].id); assert.equal(line.active_take_id, line.takes[1].id);
});

test('scene run + partial failure: failed lines are reported and only they are retried', async () => {
  const { svc } = setup({ failTexts: ['I know.'] }); const p = svc.need((await svc.createProject({ title: 'T', script: SCRIPT })).project.id); bindAll(svc, p);
  const r = await waitRun(svc, svc.startRun(p.id, { scope: 'scene', sceneId: p.scenes[0].id }).id);
  assert.deepEqual([r.status, r.done, r.failed], ['partial', 3, 1]); assert.match(r.errors[0].error, /engine refused/);
  const bad = D.renderableLines(p).find(x => x.line.text === 'I know.').line; assert.equal(D.lineStatus(bad), 'failed'); assert.equal(bad.takes.length, 1);
  const retry = svc.startRun(p.id, { scope: 'scene', sceneId: p.scenes[0].id, resume: true });
  assert.equal(retry.total, 1, 'only the failed line is retried (resume)');
  await waitRun(svc, retry.id);
});

test('assemble: refuses incomplete projects; exports one playable canonical WAV with manifest + history', async () => {
  const { svc, mediaStore } = setup(); const p = svc.need((await svc.createProject({ title: 'My Drama', script: SCRIPT })).project.id); bindAll(svc, p);
  assert.throws(() => svc.assembleExport(p.id), e => e.gate === 'missing-takes' && e.missing.length === 4);
  await waitRun(svc, svc.startRun(p.id, { scope: 'project' }).id);
  const r = svc.assembleExport(p.id);
  const rec = mediaStore.resolve(r.artifact.artifact_id); assert.ok(rec && rec.kind === 'voice');
  const a = A.parseWav(fs.readFileSync(rec.path)); const d = A.analyze(a);
  assert.ok(d.duration > 4 * 0.5 && d.rms > 0.01); assert.equal(r.manifest.items.length, 4); assert.equal(r.manifest.scope, 'project');
  assert.deepEqual(r.manifest.items.map(i => i.speaker), ['TIGER', 'CODEC', 'NARRATOR', 'TIGER']);
  assert.ok(r.manifest.items.every((it, i, arr) => i === 0 || it.start_s > arr[i - 1].start_s), 'timeline order');
  assert.equal(p.exports.length, 1); assert.ok(!JSON.stringify(r.manifest).includes('warned you'), 'manifest carries no dialogue text');
  const sc = svc.assembleExport(p.id, { sceneId: p.scenes[0].id }); assert.equal(sc.manifest.scope, 'scene');
});

test('tracks: music bed from the library is mixed in and recorded in the manifest', async () => {
  const { svc, mediaStore } = setup(); const p = svc.need((await svc.createProject({ title: 'T', script: SCRIPT })).project.id); bindAll(svc, p);
  await waitRun(svc, svc.startRun(p.id, { scope: 'project' }).id);
  const f = path.join(tmp('mu'), 'bed.wav'); fs.writeFileSync(f, A.encodeWav({ sampleRate: 48000, channels: [tone(3, 110).channels[0], tone(3, 110).channels[0]] }));
  const rec = mediaStore.finalize(f, { kind: 'music', base: 'bed' });
  assert.throws(() => svc.addTrack(p.id, { role: 'bogus', artifact_id: rec.artifact_id }), /role/); assert.throws(() => svc.addTrack(p.id, { role: 'music', artifact_id: 'nope.wav' }), /WAV artifact/);
  const t = svc.addTrack(p.id, { role: 'music', artifact_id: rec.artifact_id, start_s: 0.2, gain: 0.25, fade_out_s: 0.5 });
  const r = svc.assembleExport(p.id); assert.equal(r.manifest.tracks.length, 1); assert.equal(r.manifest.channels, 2); assert.equal(r.manifest.sample_rate, 48000);
  assert.equal(svc.removeTrack(p.id, t.id), true);
});

test('saved project survives restart; unfinished renders never come back as complete', async () => {
  const { svc, store, base } = setup(); const p = svc.need((await svc.createProject({ title: 'T', script: SCRIPT })).project.id); bindAll(svc, p);
  await waitRun(svc, svc.startRun(p.id, { scope: 'project' }).id);
  const l = D.renderableLines(p)[0].line; D.addTake(p, l.id, { status: 'rendering', job_id: 'j-x' });   // in flight when the "console" dies
  store.save(p.id);
  const store2 = createDramaStore({ root: base + '/drama' }); const q = store2.get(p.id);
  assert.ok(q.saved); const ql = D.renderableLines(q)[0].line;
  assert.equal(ql.takes.filter(t => t.status === 'complete').length, 1); assert.equal(ql.takes[1].status, 'failed'); assert.match(ql.takes[1].error, /interrupted/);
  assert.equal(D.lineStatus(ql), 'generated', 'the real complete take still counts; the interrupted one does not');
});

test('LLM parse path is wired and cannot rewrite dialogue', async () => {
  const base = tmp('l'); const store = createDramaStore({ root: base });
  const svc = createDramaService({ store, voice: {}, profiles: {}, mediaStore: {}, llmChat: async () => JSON.stringify({ scenes: [{ lines: [{ speaker: 'TIGER', kind: 'dialogue', text: 'I TOLD you so.' }] }] }) });
  const r = await svc.createProject({ title: 'x', script: 'TIGER: I warned you.', mode: 'llm' });
  assert.equal(r.ok, false); assert.match(r.errors.join(' '), /not verbatim/);
  const none = await createDramaService({ store, voice: {}, profiles: {}, mediaStore: {} }).createProject({ title: 'x', script: 'a: b', mode: 'llm' });
  assert.match(none.errors[0], /no local model/);
});
