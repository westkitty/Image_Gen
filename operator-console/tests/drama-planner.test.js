'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../drama');
const R = require('../drama-reparse');
const P = require('../drama-planner');

const SCRIPT = `INT. WAREHOUSE - NIGHT

TIGER: I warned you about the lamp.
CODEC: I know that already.
TIGER: Then why did you come back here?

EXT. ROOFTOP - DAWN

NARRATOR: And so it ended.
CODEC: Goodbye then.`;

const designed = (id, desc = 'A calm, gravelly baritone narrator voice.') => ({ id, name: id, type: 'designed', language: 'en', description: desc, samples: [], preferred_engine: 'qwen3-tts-voice-design', validation: { state: 'valid' } });
const cloned = (id, sha = 'a'.repeat(64)) => ({ id, name: id, type: 'cloned', language: 'en', description: '', preferred_engine: 'qwen3-tts-base', validation: { state: 'valid' },
  samples: [{ id: 'sm-aaaaaaaaaa', sha256: sha, transcript: 'Hello there.', active: true, validation: { ok: true, errors: [], warnings: [] } }] });

function setup() {
  const store = { tiger: cloned('vp-tiger00001'), codec: designed('vp-codec00001'), narr: designed('vp-narr000001') };
  const profiles = { get: id => Object.values(store).find(p => p.id === id) || null };
  const mediaRecs = new Map();
  const media = { resolve: id => mediaRecs.get(id) || null };
  const p = D.newProject({ title: 't', source_script: SCRIPT, parsed: D.parseScript(SCRIPT) });
  D.bindActor(p, p.actors.find(a => a.speaker_key === 'TIGER').id, store.tiger.id);
  D.bindActor(p, p.actors.find(a => a.speaker_key === 'CODEC').id, store.codec.id);
  D.bindActor(p, p.actors.find(a => a.speaker_key === 'NARRATOR').id, store.narr.id);
  const ctx = { profiles, media };
  let n = 0;
  // Gives every renderable line a complete take that matches today's inputs.
  const render = (lines = D.renderableLines(p).map(x => x.line)) => {
    for (const line of lines) {
      const { fp } = P.lineFingerprint(p, line, ctx);
      const art = `art-${++n}.wav`; mediaRecs.set(art, { artifact_id: art, sha256: String(n).padStart(64, '0'), bytes: 4000, duration: 1.2 });
      const t = D.addTake(p, line.id, { status: 'complete', artifact_id: art, sha256: String(n).padStart(64, '0'), duration: 1.2, fingerprint: fp, seed: 5 });
      if (!line.active_take_id) line.active_take_id = t.id;
    }
  };
  const record = (plan) => { for (const s of plan.assembly) p.scene_masters[s.scene_id] = { assembly_fp: s.fingerprint.sha, artifact_id: 'master-' + s.scene_id + '.wav' }; for (const s of plan.assembly) mediaRecs.set('master-' + s.scene_id + '.wav', { artifact_id: 'master-' + s.scene_id + '.wav', sha256: 'f'.repeat(64), bytes: 9000 }); };
  const line = (re) => D.renderableLines(p).map(x => x.line).find(l => re.test(l.text));
  return { p, store, ctx, render, record, line, mediaRecs };
}
const ids = a => a.map(x => x.line_id);

test('a fresh cast project needs every line, reuses nothing, and is ready to produce', () => {
  const { p, ctx } = setup(); const plan = P.planProduction(p, ctx);
  assert.equal(plan.counts.lines, 5); assert.equal(plan.counts.new, 5); assert.equal(plan.counts.reuse, 0); assert.equal(plan.counts.stale, 0);
  assert.equal(plan.ready, true); assert.deepEqual(plan.blocking_errors, []);
  assert.ok(plan.assembly.every(s => s.action === 'blocked' || s.action === 'rebuild-after-speech'));
});

test('everything rendered: all reusable; first assembly rebuilds; once recorded nothing at all is required', () => {
  const { p, ctx, render, record } = setup(); render();
  let plan = P.planProduction(p, ctx);
  assert.equal(plan.counts.reuse, 5); assert.equal(plan.counts.new + plan.counts.stale, 0);
  assert.deepEqual(plan.assembly.map(s => s.action), ['rebuild', 'rebuild']); record(plan);
  plan = P.planProduction(p, ctx);
  assert.deepEqual(plan.assembly.map(s => s.action), ['reuse', 'reuse']); assert.equal(plan.work_required, false);
});

test('editing one word invalidates exactly that line; the rest is reused and only its scene remixes', () => {
  const { p, ctx, render, record, line } = setup(); render(); record(P.planProduction(p, ctx));
  const l = line(/lamp/); D.setLine(p, l.id, { text: 'I warned you about the light.' });
  const plan = P.planProduction(p, ctx);
  assert.deepEqual(ids(plan.stale), [l.id]); assert.equal(plan.counts.reuse, 4);
  assert.equal(plan.lines.find(x => x.line_id === l.id).state, 'stale');
  assert.deepEqual(plan.assembly.map(s => s.action), ['rebuild-after-speech', 'reuse']);
  assert.equal(l.takes.length, 1, 'the old recording is never deleted');
  assert.equal(D.takeState(l.takes[0], P.lineFingerprint(p, l, ctx).fp).label, 'OUTDATED');
});

test('changing one voice sample invalidates only that speaker', () => {
  const { p, ctx, render, store } = setup(); render();
  store.tiger.samples[0].sha256 = 'b'.repeat(64);
  const plan = P.planProduction(p, ctx);
  const tigerLines = D.renderableLines(p).filter(x => x.line.speaker_key === 'TIGER').map(x => x.line.id);
  assert.deepEqual(ids(plan.stale).sort(), tigerLines.sort()); assert.equal(plan.counts.reuse, 3);
});

test('a profile rename or an unrelated pause edit never invalidates speech', () => {
  const { p, ctx, render, store, line } = setup(); render();
  store.tiger.name = 'Renamed'; D.setLine(p, line(/lamp/).id, { pause_after_s: 4 });
  assert.equal(P.planProduction(p, ctx).counts.reuse, 5);
});

test('changing an actor FX chain remixes the affected scenes without any new speech', () => {
  const { p, ctx, render, record } = setup(); render(); record(P.planProduction(p, ctx));
  p.actors.find(a => a.speaker_key === 'TIGER').fx = require('../fx-rack').presetChain('radio');
  const plan = P.planProduction(p, ctx);
  assert.equal(plan.counts.new + plan.counts.stale, 0);
  assert.deepEqual(plan.assembly.map(s => s.action), ['rebuild', 'reuse'], 'only the scene where TIGER speaks remixes');
  assert.equal(plan.work_required, true);
});

test('changing a music cue remixes only its scene', () => {
  const { p, ctx, render, record, mediaRecs } = setup(); render();
  mediaRecs.set('m.wav', { artifact_id: 'm.wav', sha256: 'c'.repeat(64), bytes: 1000, duration: 10 });
  p.tracks.push({ id: 'tr-1', role: 'music', artifact_id: 'm.wav', scene_id: p.scenes[1].id, start_s: 0, gain: 0.3 });
  record(P.planProduction(p, ctx));
  p.tracks[0].start_s = 2;
  const plan = P.planProduction(p, ctx);
  assert.deepEqual(plan.assembly.map(s => s.action), ['reuse', 'rebuild']); assert.equal(plan.counts.new + plan.counts.stale, 0);
});

test('reordered dialogue cannot inherit the wrong take and stale takes never enter a master', () => {
  const { p, ctx, render, record, line } = setup(); render(); record(P.planProduction(p, ctx));
  const tiger = line(/lamp/), codec = line(/already/);
  const swapped = SCRIPT.replace('TIGER: I warned you about the lamp.\nCODEC: I know that already.', 'CODEC: I know that already.\nTIGER: I warned you about the lamp.');
  R.reparse(p, swapped, D.parseScript(swapped), { apply: true });
  const plan = P.planProduction(p, ctx);
  assert.equal(plan.counts.reuse, 5, 'recordings followed their text'); assert.equal(plan.counts.new + plan.counts.stale, 0);
  assert.equal(plan.assembly[0].action, 'rebuild', 'the new line order changes the scene mix');
  assert.equal(plan.lines.find(x => x.line_id === tiger.id).take_id, tiger.takes[0].id);
  assert.equal(plan.lines.find(x => x.line_id === codec.id).take_id, codec.takes[0].id);
  const edited = line(/lamp/); D.setLine(p, edited.id, { text: 'Different words now.' });
  const p2 = P.planProduction(p, ctx);
  assert.ok(p2.lines.find(x => x.line_id === edited.id).take_id == null, 'an outdated take is not selected for the master');
});

test('unassigned or invalid voices block with named speakers; unrelated lines stay plannable', () => {
  const { p, ctx, store } = setup();
  p.actors.find(a => a.speaker_key === 'CODEC').voice_profile_id = null;
  store.tiger.validation = { state: 'invalid' }; store.tiger.samples = [];
  const plan = P.planProduction(p, ctx);
  assert.equal(plan.ready, false);
  assert.deepEqual(plan.cast_problems.map(c => [c.key, c.reason]).sort(), [['CODEC', 'unassigned'], ['TIGER', 'profile-invalid']]);
  assert.ok(plan.blocking_errors.some(e => e.code === 'cast-unresolved'));
  assert.equal(plan.lines.filter(l => l.state === 'blocked').length, 4);
});

test('legacy takes without fingerprints are never reused silently: review item, regenerate or adopt', () => {
  const { p, ctx, mediaRecs, line } = setup();
  mediaRecs.set('old.wav', { artifact_id: 'old.wav', sha256: '1'.repeat(64), bytes: 4000 });
  const l = line(/lamp/); const t = D.addTake(p, l.id, { status: 'complete', artifact_id: 'old.wav', legacy: true }); l.active_take_id = t.id;
  const plan = P.planProduction(p, ctx);
  assert.equal(plan.lines.find(x => x.line_id === l.id).state, 'stale');
  assert.ok(plan.review_items.some(r => r.code === 'legacy-take-unverified' && r.line_id === l.id));
  assert.equal(D.takeState(t, P.lineFingerprint(p, l, ctx).fp).label, 'REVIEW_REQUIRED');
  P.adoptLegacyTake(p, l.id, t.id, ctx);
  assert.equal(P.planProduction(p, ctx).lines.find(x => x.line_id === l.id).state, 'reuse');
  assert.equal(t.adopted_legacy, true);
});

test('a current take whose audio asset vanished is reported and regenerated, never assumed present', () => {
  const { p, ctx, render, mediaRecs, line } = setup(); render();
  const l = line(/lamp/); mediaRecs.delete(l.takes[0].artifact_id);
  const plan = P.planProduction(p, ctx);
  assert.ok(plan.asset_problems.some(a => a.code === 'take-audio-missing' && a.line_id === l.id));
  assert.equal(plan.lines.find(x => x.line_id === l.id).state, 'new');
});

test('a take that is currently rendering is not duplicated', () => {
  const { p, ctx, render, line } = setup(); render();
  const l = line(/lamp/); D.setLine(p, l.id, { text: 'Brand new words.' });
  const { fp } = P.lineFingerprint(p, l, ctx); D.addTake(p, l.id, { status: 'rendering', fingerprint: fp });
  const plan = P.planProduction(p, ctx);
  assert.equal(plan.lines.find(x => x.line_id === l.id).state, 'in-flight'); assert.equal(plan.counts.new, 0);
});

test('chunk reconstruction is proven for every line that needs speech; a bad chunker blocks', () => {
  const { p, ctx } = setup();
  assert.equal(P.planProduction(p, ctx).chunk_proofs.every(c => c.ok), true);
  const bad = Object.assign({}, ctx, { chunker: (text) => [{ index: 0, total: 1, text: text.slice(1), start: 1, end: text.length, boundary: 'end', gapAfterMs: 0 }] });
  const plan = P.planProduction(p, bad);
  assert.equal(plan.ready, false); assert.ok(plan.blocking_errors.some(e => e.code === 'chunk-reconstruction'));
});

test('approval is orthogonal: an approved take that goes stale needs review, not silent reuse', () => {
  const { p, ctx, render, line } = setup(); render();
  const l = line(/lamp/); l.takes[0].approved = true;
  assert.equal(D.takeState(l.takes[0], P.lineFingerprint(p, l, ctx).fp).label, 'APPROVED');
  D.setLine(p, l.id, { text: 'Changed after approval.' });
  const st = D.takeState(l.takes[0], P.lineFingerprint(p, l, ctx).fp);
  assert.equal(st.label, 'REVIEW_REQUIRED'); assert.equal(st.freshness, 'outdated'); assert.equal(st.approval, 'approved');
});

test('take lifecycle labels cover queued/rendering/failed/interrupted/complete', () => {
  const fp = { inputs_sha: 'x' };
  assert.equal(D.takeState({ status: 'queued' }, fp).label, 'QUEUED');
  assert.equal(D.takeState({ status: 'rendering' }, fp).label, 'RENDERING');
  assert.equal(D.takeState({ status: 'failed', error: 'x' }, fp).label, 'FAILED');
  assert.equal(D.takeState({ status: 'failed', interrupted: true }, fp).label, 'INTERRUPTED');
  assert.equal(D.takeState({ status: 'complete', fingerprint: { inputs_sha: 'x' } }, fp).label, 'COMPLETE');
  assert.equal(D.takeState({ status: 'complete', fingerprint: { inputs_sha: 'y' } }, fp).label, 'OUTDATED');
  assert.equal(D.takeState(null, fp).label, 'MISSING');
});

test('a voice that is not production-ready is a review item, never a silent pass or a hard block', () => {
  const { p, ctx, store } = setup();
  store.tiger.readiness = { ready: false, checks: [{ id: 'trial', ok: false, message: 'trialled' }, { id: 'consent', ok: true }] };
  const plan = P.planProduction(p, ctx);
  assert.equal(plan.ready, true);
  const r = plan.review_items.filter(x => x.code === 'voice-not-production-ready');
  assert.equal(r.length, 1); assert.equal(r[0].profile_id, store.tiger.id); assert.deepEqual(r[0].failing, ['trial']);
});
