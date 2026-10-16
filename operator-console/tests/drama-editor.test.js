'use strict';
// Cast Bible, multitrack timeline edits, cues and previews through the drama service (fake Big Mac, real mixer).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path'); const os = require('node:os');
const D = require('../drama'); const T = require('../audio-tools'); const A = require('../voice-audio'); const FX = require('../fx-rack'); const P = require('../drama-planner'); const { createDramaStore } = require('../drama');
const { rig } = require('./helpers/drama-rig');

const opts = { skip: T.available().ffmpeg ? false : 'ffmpeg not installed' };
const SCRIPT = `INT. WAREHOUSE - NIGHT
TIGER: I warned you about the lamp.
CODEC: I know that already.

EXT. ROOFTOP - DAWN
NARRATOR: And so it ended.`;
const lines = p => D.renderableLines(p).map(x => x.line);
const actor = (p, k) => p.actors.find(a => a.speaker_key === k);
async function produced() { const r = await rig(); const p = await r.project(SCRIPT); const fin = await r.finish(r.producer.produce(p.id)); assert.equal(fin.status, 'complete', JSON.stringify(fin.errors)); return Object.assign(r, { p }); }
const bed = (r, hz = 220) => { const f = path.join(os.tmpdir(), 'dex-bed-' + Math.random().toString(16).slice(2) + '.wav'); fs.writeFileSync(f, A.encodeWav({ sampleRate: 24000, channels: [new Float32Array(48000 * 2).map((_, i) => 0.2 * Math.sin(2 * Math.PI * hz * i / 24000))] })); return r.mediaStore.finalize(f, { kind: 'music', base: 'bed', duration: 2 }); };

test('Cast Bible: validated fields, history, explicit roles, truthful permitted features', async () => {
  const r = await rig(); const p = await r.project(SCRIPT); const a = actor(p, 'TIGER');
  const out = r.drama.updateActor(p.id, a.id, { language: 'fr', notes: 'gruff', role: 'remote', pronunciation: [{ from: 'lamp', to: 'lamb', ignore_case: true }, { from: 'LAMP', to: 'x', ignore_case: true }], fx: 'radio', pacing: 'fast_monologue', default_direction: 'low' });
  assert.equal(out.language, 'fr'); assert.equal(out.role, 'remote'); assert.equal(out.pronunciation.length, 1, 'duplicate rules collapse'); assert.equal(out.fx.preset, 'radio'); assert.deepEqual(out.pacing, { mode: 'wpm', target_wpm: 300, preset: 'fast_monologue' });
  assert.equal(out.history.length, 1); assert.ok(out.history[0].changed.includes('pronunciation'));
  for (const bad of [{ language: 'klingon' }, { pronunciation: [{ from: '', to: 'x' }] }, { role: 'hero' }, { fx: { nodes: [{ type: 'rm' }] } }, { pacing: { mode: 'wpm', target_wpm: 5 } }, { pacing: { mode: 'tempo', tempo: 9 } }, { voice_profile_id: 'vp-0000000000' }]) assert.throws(() => r.drama.updateActor(p.id, a.id, bad), e => e.status === 400, JSON.stringify(bad));
  const v = r.drama.view(p).actors.find(x => x.id === a.id); assert.equal(v.permitted_features.engine, 'kokoro'); assert.equal(v.permitted_features.delivery_direction.ok, false); assert.match(v.permitted_features.delivery_direction.reason, /instruct/); assert.equal(v.permitted_features.cached_voice_prompt.ok, false);
  assert.equal(r.drama.updateActor(p.id, a.id, { fx: null }).fx, null);
});

test('importing an existing project invents no characters and the Cast Bible does not rewrite source dialogue', async () => {
  const r = await rig(); const p = await r.project(SCRIPT, { bind: false }); const text = lines(p).map(l => l.text);
  assert.deepEqual(p.actors.map(a => a.speaker_key).sort(), ['CODEC', 'NARRATOR', 'TIGER']); r.drama.updateActor(p.id, actor(p, 'TIGER').id, { notes: 'x', pronunciation: [{ from: 'lamp', to: 'lamb' }] });
  assert.deepEqual(lines(p).map(l => l.text), text); assert.equal(p.actors.length, 3);
});

test('pronunciation and language changes invalidate exactly that actor\'s speech', opts, async () => {
  const r = await produced(); const a = actor(r.p, 'TIGER');
  r.drama.updateActor(r.p.id, a.id, { pronunciation: [{ from: 'lamp', to: 'lamb' }] });
  const plan = P.planProduction(r.p, r.drama.planContext()); assert.deepEqual(plan.stale.map(s => s.speaker_key), ['TIGER']);
  assert.equal(P.planProduction(r.p, r.drama.planContext()).counts.reuse, 2);
});

test('clip overrides are validated and non-destructive; a pinned alternate take affects only its own clip', opts, async () => {
  const r = await produced(); const [l1, l2] = lines(r.p); const sceneId = r.p.scenes[0].id;
  assert.throws(() => r.drama.setClip(r.p.id, l1.id, { trim_start_s: 1, trim_end_s: 0.5 }), /trim end/);
  const o = r.drama.setClip(r.p.id, l1.id, { gain_db: 99, trim_start_s: 0.1, fade_in_s: 0.05, fx_override: 'radio' }); assert.equal(o.gain_db, 24); assert.equal(o.fx_override.preset, 'radio');
  r.drama.setClip(r.p.id, l1.id, { reset: true }); assert.equal(r.p.timeline.clip_overrides[l1.id], undefined);
  // second take of line 1 (alternate); pin it
  await r.drama.renderTake(r.p.id, l1.id, {}); assert.equal(l1.takes.length, 2); const alt = l1.takes[1];
  const before = r.dstore.get(r.p.id); const fpBefore = P.planProduction(r.p, r.drama.planContext()).assembly[0].fingerprint.sha;
  r.drama.setClip(r.p.id, l1.id, { pinned_take_id: alt.id });
  const plan = P.planProduction(r.p, r.drama.planContext()); assert.equal(plan.lines.find(x => x.line_id === l1.id).take_id, alt.id); assert.equal(plan.lines.find(x => x.line_id === l2.id).take_id, l2.takes[0].id, 'the other clip is unchanged');
  assert.notEqual(plan.assembly[0].fingerprint.sha, fpBefore); assert.equal(plan.assembly[1].action, 'reuse', 'other scenes are untouched');
  assert.equal(l1.takes.length, 2, 'the original recording is kept');
  D.setLine(r.p, l1.id, { text: 'Entirely new words.' });
  assert.throws(() => r.drama.setClip(r.p.id, l1.id, { pinned_take_id: alt.id }), e => e.gate === 'pin-outdated' && e.status === 409);
});

test('markers and regions persist with the project; edit decisions survive reload', opts, async () => {
  const r = await produced(); const sc = r.p.scenes[0].id; r.drama.markers(r.p.id, 'add-marker', { scene_id: sc, t_s: 1.5, label: 'door' }); const rg = r.drama.markers(r.p.id, 'add-region', { scene_id: sc, start_s: 3, end_s: 1, label: 'loop me' });
  assert.deepEqual([rg.start_s, rg.end_s], [1, 3]); r.drama.setClip(r.p.id, lines(r.p)[0].id, { gain_db: -3 }); r.dstore.save(r.p.id);
  const again = createDramaStore({ root: r.base + '/drama' }).get(r.p.id);
  assert.equal(again.timeline.markers[0].label, 'door'); assert.equal(again.timeline.regions.length, 1); assert.equal(again.timeline.clip_overrides[lines(r.p)[0].id].gain_db, -3);
  assert.ok(r.drama.markers(r.p.id, 'remove', { id: rg.id })); assert.throws(() => r.drama.markers(r.p.id, 'add-marker', { scene_id: 'sc-99', t_s: 1 }), /scene not found/);
});

test('tracks accept MP3/M4A and carry loop, duck, priority and required; dragging a script-anchored cue detaches it', opts, async () => {
  const r = await produced(); const b = bed(r); const sc = r.p.scenes[0].id;
  const tr = r.drama.addTrack(r.p.id, { role: 'ambience', artifact_id: b.artifact_id, scene_id: sc, loop: true, priority: 3, required: false, label: 'rain' });
  assert.equal(tr.loop, true); assert.equal(tr.duck, true); assert.equal(tr.priority, 3); assert.equal(tr.required, false);
  const moved = r.drama.updateTrack(r.p.id, tr.id, { move_to_s: 2.5, gain: 0.2, duck: false }); assert.equal(moved.start_s, 2.5); assert.equal(moved.duck, false);
  assert.throws(() => r.drama.addTrack(r.p.id, { role: 'bogus', artifact_id: b.artifact_id }), /role/);
});

test('the timeline view lists dialogue lanes per speaker and cue lanes per role with states, positions and freshness', opts, async () => {
  const r = await produced(); const b = bed(r); r.drama.addTrack(r.p.id, { role: 'music', artifact_id: b.artifact_id, scene_id: r.p.scenes[0].id, start_s: 0.5 });
  const v = r.drama.timelineView(r.p.id, r.p.scenes[0].id);
  assert.deepEqual(v.lanes.map(l => l.id), ['dlg:TIGER', 'dlg:CODEC', 'music', 'ambience', 'sfx']);
  const tiger = v.lanes[0].clips[0]; assert.equal(tiger.start_s, 0); assert.ok(tiger.duration_s > 0.4); assert.equal(tiger.take_state.label, 'COMPLETE'); assert.ok(tiger.url);
  const m = v.lanes.find(l => l.id === 'music').clips[0]; assert.equal(m.start_s, 0.5); assert.equal(m.resolved, true); assert.equal(v.fresh, false, 'the new cue makes the earlier scene master stale'); assert.ok(v.length_s > 1);
  assert.equal(v.incomplete, false); assert.throws(() => r.drama.timelineView(r.p.id, 'sc-99'), /scene not found/);
});

test('previewScene reuses a fresh master, rebuilds when anything audible changes, and refuses scenes that still need speech', opts, async () => {
  const r = await produced(); const sc = r.p.scenes[0].id;
  const first = await r.drama.previewScene(r.p.id, sc); assert.equal(first.reused, true, 'production already built it');
  r.drama.updateActor(r.p.id, actor(r.p, 'CODEC').id, { fx: 'intercom' });
  const second = await r.drama.previewScene(r.p.id, sc); assert.equal(second.reused, false); assert.notEqual(second.artifact.artifact_id, first.artifact.artifact_id);
  const again = await r.drama.previewScene(r.p.id, sc); assert.equal(again.reused, true); assert.equal(again.artifact.artifact_id, second.artifact.artifact_id);
  D.setLine(r.p, lines(r.p)[0].id, { text: 'Brand new line.' });
  await assert.rejects(r.drama.previewScene(r.p.id, sc), e => e.gate === 'scene-not-ready' && e.lines.some(l => l.state === 'stale'));
  await assert.rejects(r.drama.previewScene(r.p.id, 'sc-99'), /not found/);
});

test('the character radio effect is part of the preview AND the exported master (one pipeline)', opts, async () => {
  const r = await produced(); r.drama.updateActor(r.p.id, actor(r.p, 'TIGER').id, { fx: 'radio' });
  const prev = await r.drama.previewScene(r.p.id, r.p.scenes[0].id);
  const fin = await r.finish(r.producer.produce(r.p.id, { mastering: { preset: 'archive' } })); assert.equal(fin.status, 'complete');
  const scene = r.p.scene_masters[r.p.scenes[0].id]; assert.equal(scene.artifact_id, prev.artifact.artifact_id, 'production reused the very scene master that was previewed');
  const derived = r.derived.entries().filter(e => e.lineage.fx_identity && e.lineage.fx_identity !== 'clean'); assert.ok(derived.length >= 1 && derived.every(e => e.lineage.fx_chain.preset === 'radio'));
});

test('splitTrack: halves tile the original cue exactly, never loop/unanchored, and invalid splits are refused', opts, async () => {
  const r = await produced(); const b = bed(r); const sc = r.p.scenes[0].id;
  const tr = r.drama.addTrack(r.p.id, { role: 'sfx', artifact_id: b.artifact_id, scene_id: sc, start_s: 0.2, label: 'thud', fade_out_s: 0.3 });
  const tl = r.drama.timelineView(r.p.id, sc); const cue = tl.lanes.flatMap(l => l.clips).find(c => c.track_id === tr.id); assert.ok(cue && cue.duration_s > 0.5, 'the cue is on the timeline ');
  const at = Math.round((cue.start_s + cue.duration_s / 2) * 1000) / 1000;
  for (const bad of [cue.start_s + 0.01, cue.start_s + cue.duration_s - 0.01, cue.start_s - 1, NaN]) assert.throws(() => r.drama.splitTrack(r.p.id, tr.id, bad), /split inside the cue/, 'splits within 50 ms of an edge are refused: ' + bad);
  const [a, c] = r.drama.splitTrack(r.p.id, tr.id, at);
  assert.equal(a.id, tr.id); assert.notEqual(c.id, a.id); assert.equal(a.artifact_id, c.artifact_id);
  assert.equal(a.trim_end_s, c.trim_start_s, 'the second half starts exactly where the first one is cut');
  assert.equal(c.start_s, at); assert.equal(a.fade_out_s, 0); assert.equal(c.fade_in_s, 0);
  const after = r.drama.timelineView(r.p.id, sc).lanes.flatMap(l => l.clips).filter(x => x.track_id === a.id || x.track_id === c.id).sort((x, y) => x.start_s - y.start_s);
  assert.equal(after.length, 2); assert.ok(Math.abs(after[0].start_s + after[0].duration_s - after[1].start_s) < 0.002, 'no gap or overlap at the cut');
  assert.ok(Math.abs(after[0].duration_s + after[1].duration_s - cue.duration_s) < 0.002, 'total length is unchanged');
  const lp = r.drama.addTrack(r.p.id, { role: 'ambience', artifact_id: b.artifact_id, scene_id: sc, loop: true });
  assert.throws(() => r.drama.splitTrack(r.p.id, lp.id, 1), /looping/); assert.throws(() => r.drama.splitTrack(r.p.id, 'nope', 1), /track not found/);
});
