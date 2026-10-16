'use strict';
// Incremental production through the drama service: fingerprints on takes, stale detection, selective re-render,
// current-vs-historical exports and safe reparse. Voice rendering is a fake; media storage is real.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const M = require('../media'); const A = require('../voice-audio'); const D = require('../drama'); const P = require('../drama-planner');
const { createDramaStore } = require('../drama'); const { createDramaService } = require('../drama-service');

const tmp = p => fs.mkdtempSync(path.join(os.tmpdir(), 'dex-inc-' + p));
const tone = (sec, hz) => { const n = Math.round(sec * 24000), a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = 0.4 * Math.sin(2 * Math.PI * hz * i / 24000); return { sampleRate: 24000, channels: [a] }; };
const SCRIPT = 'TIGER: I warned you.\nCODEC: [quietly] I know.\nNARRATOR: The rain fell.\nTIGER: Then why come back?';

function setup() {
  const base = tmp('x');
  const mediaStore = M.createMediaStore({ roots: { image: base + '/i', voice: base + '/v', music: base + '/m', video: base + '/vid', world: base + '/w' }, registryFile: base + '/media.json' }); mediaStore.ensureRoots();
  const store = createDramaStore({ root: base + '/drama' });
  const calls = [], jobs = new Map(); let n = 0;
  const pmap = {
    'vp-tiger': { id: 'vp-tiger', name: 'Tiger', type: 'preset', preset_voice: 'af_heart', language: 'en', validation: { state: 'valid' }, preferred_engine: 'kokoro' },
    'vp-codec': { id: 'vp-codec', name: 'Codec', type: 'preset', preset_voice: 'am_adam', language: 'en', validation: { state: 'valid' }, preferred_engine: 'kokoro' },
    'vp-narr': { id: 'vp-narr', name: 'Narrator', type: 'preset', preset_voice: 'bf_emma', language: 'en', validation: { state: 'valid' }, preferred_engine: 'kokoro' },
  };
  const profiles = { get: id => pmap[id] || null };
  const voice = {
    renderText(args) { calls.push(args); const id = 'job-' + (++n); jobs.set(id, args); return { job_id: id, engine: 'kokoro', seed: 100 + n, chunks: 1, delivery: { requested: args.direction || null, applied: false, note: null } }; },
    describe(id) { return jobs.has(id) ? { job_id: id, status: 'RUNNING', progress: {} } : null; },
    async waitJob(id) {
      const args = jobs.get(id); const f = path.join(tmp('w'), 'o.wav');
      fs.writeFileSync(f, A.encodeWav(tone(0.5 + (args.text.length % 5) * 0.1, 200 + args.text.length * 3 + n)));
      const rec = mediaStore.finalize(f, { kind: 'voice', base: 'test-' + id, job_id: id, worker: 'kokoro', duration: 0.6, meta: {} });
      return { job_id: id, status: 'COMPLETE', artifact: { artifact_id: rec.artifact_id, duration: rec.duration, sha256: rec.sha256 } };
    },
  };
  const svc = createDramaService({ store, voice, profiles, mediaStore });
  return { svc, calls, mediaStore, pmap, store };
}
const waitRun = async (svc, id) => { for (let i = 0; i < 400; i++) { const r = svc.runView(id); if (r.status !== 'running') return r; await new Promise(r2 => setTimeout(r2, 5)); } throw new Error('run did not finish'); };
async function project() {
  const s = setup(); const p = s.svc.need((await s.svc.createProject({ title: 'T', script: SCRIPT })).project.id);
  for (const a of p.actors) D.bindActor(p, a.id, 'vp-' + a.speaker_key.toLowerCase().slice(0, a.speaker_key === 'NARRATOR' ? 4 : 5));
  return Object.assign(s, { p });
}
const lineBy = (p, re) => D.renderableLines(p).map(x => x.line).find(l => re.test(l.text));

test('takes carry versioned speech fingerprints, a render key with the seed, and provenance', async () => {
  const { svc, p } = await project(); await waitRun(svc, svc.startRun(p.id, { scope: 'project' }).id);
  for (const { line } of D.renderableLines(p)) {
    const t = line.takes[0];
    assert.match(t.fingerprint.inputs_sha, /^[a-f0-9]{64}$/); assert.match(t.render_sha, /^[a-f0-9]{64}$/); assert.notEqual(t.render_sha, t.fingerprint.inputs_sha);
    assert.equal(t.fingerprint.engine, 'kokoro'); assert.equal(D.takeState(t, P.lineFingerprint(p, line, svc.planContext()).fp).label, 'COMPLETE');
    assert.equal('spoken_text' in t.fingerprint, false, 'no dialogue text is stored in the fingerprint record');
    assert.equal(JSON.stringify(t).includes('warned you'), false);
  }
});

test('editing one word re-renders ONLY that line; the old take is kept and labelled OUTDATED', async () => {
  const { svc, p, calls } = await project(); await waitRun(svc, svc.startRun(p.id, { scope: 'project' }).id);
  calls.length = 0; const l = lineBy(p, /warned/); const old = l.takes[0].id; D.setLine(p, l.id, { text: 'I warned them.' });
  const v = svc.view(p); assert.equal(v.plan.counts.stale, 1); assert.equal(v.scenes[0].lines.find(x => x.id === l.id).takes[0].state.label, 'OUTDATED');
  await waitRun(svc, svc.startRun(p.id, { scope: 'project', resume: true }).id);
  assert.equal(calls.length, 1); assert.equal(calls[0].text, 'I warned them.');
  assert.equal(l.takes.length, 2); assert.equal(l.takes[0].id, old, 'old take preserved'); assert.equal(svc.view(p).plan.counts.stale, 0);
});

test('changing one voice re-renders only that speaker', async () => {
  const { svc, p, calls, pmap } = await project(); await waitRun(svc, svc.startRun(p.id, { scope: 'project' }).id);
  calls.length = 0; pmap['vp-tiger'].preset_voice = 'am_michael';
  await waitRun(svc, svc.startRun(p.id, { scope: 'project' }).id);
  assert.equal(calls.length, 2); assert.ok(calls.every(c => c.profileId === 'vp-tiger'));
});

test('a remix-only change (music cue) triggers no speech rendering at all', async () => {
  const { svc, p, calls, mediaStore } = await project(); await waitRun(svc, svc.startRun(p.id, { scope: 'project' }).id);
  const f = path.join(tmp('mu'), 'bed.wav'); fs.writeFileSync(f, A.encodeWav(tone(2, 110)));
  const rec = mediaStore.finalize(f, { kind: 'music', base: 'bed' });
  svc.addTrack(p.id, { role: 'music', artifact_id: rec.artifact_id }); calls.length = 0;
  const run = svc.startRun(p.id, { scope: 'project' }); assert.equal(run.total, 0); assert.equal(calls.length, 0);
});

test('assemble refuses stale recordings; historical export is explicitly labelled and never current', async () => {
  const { svc, p } = await project(); await waitRun(svc, svc.startRun(p.id, { scope: 'project' }).id);
  const l = lineBy(p, /warned/); D.setLine(p, l.id, { text: 'Changed after recording.' });
  assert.throws(() => svc.assembleExport(p.id), e => e.gate === 'missing-takes' && e.missing.some(m => m.line_id === l.id && m.state === 'stale'));
  const h = svc.assembleExport(p.id, { historical: true });
  assert.equal(h.manifest.kind, 'historical'); assert.equal(h.manifest.current, false); assert.equal(h.manifest.stale_lines.length, 1);
  assert.equal(p.exports[0].kind, 'historical'); assert.match(h.artifact.artifact_id, /historical/);
});

test('current export manifest ties each clip to take fingerprints and the source revision', async () => {
  const { svc, p } = await project(); await waitRun(svc, svc.startRun(p.id, { scope: 'project' }).id);
  const r = svc.assembleExport(p.id);
  assert.equal(r.manifest.kind, 'current'); assert.equal(r.manifest.current, true); assert.equal(r.manifest.source_rev, 1); assert.equal(r.manifest.source_sha256, p.source_sha256);
  for (const it of r.manifest.items) { assert.match(it.speech_inputs_sha, /^[a-f0-9]{64}$/); assert.match(it.take_sha256, /^[a-f0-9]{64}$/); }
  assert.equal(JSON.stringify(r.manifest).includes('warned you'), false);
});

test('legacy takes are refused in a current master until explicitly adopted', async () => {
  const { svc, p } = await project(); await waitRun(svc, svc.startRun(p.id, { scope: 'project' }).id);
  const l = lineBy(p, /warned/); delete l.takes[0].fingerprint; l.takes[0].legacy = true;
  assert.throws(() => svc.assembleExport(p.id), e => e.gate === 'missing-takes');
  svc.adoptLegacyTake(p.id, l.id, l.takes[0].id); assert.ok(svc.assembleExport(p.id).artifact);
});

test('approve / unapprove is a separate human decision and survives selection', async () => {
  const { svc, p } = await project(); await waitRun(svc, svc.startRun(p.id, { scope: 'project' }).id);
  const l = lineBy(p, /warned/); const t = l.takes[0];
  svc.approveTake(p.id, l.id, t.id, true); assert.equal(svc.view(p).scenes[0].lines[0].takes[0].state.label, 'APPROVED');
  svc.approveTake(p.id, l.id, t.id, false); assert.equal(svc.view(p).scenes[0].lines[0].takes[0].state.label, 'COMPLETE');
});

test('reparse through the service previews first and preserves recordings on apply', async () => {
  const { svc, p } = await project(); await waitRun(svc, svc.startRun(p.id, { scope: 'project' }).id);
  const ids = D.allLines(p).map(x => x.line.id); const edited = SCRIPT.replace('I warned you.', 'I warned everyone.');
  const prev = await svc.reparse(p.id, { script: edited });
  assert.equal(prev.ok, true); assert.equal(prev.applied, false); assert.equal(p.source_script, SCRIPT);
  const done = await svc.reparse(p.id, { script: edited, apply: true });
  assert.equal(done.applied, true); assert.deepEqual(D.allLines(p).map(x => x.line.id), ids);
  assert.equal(svc.view(p).plan.counts.stale, 1); assert.equal(svc.view(p).plan.counts.reuse, 3);
});
