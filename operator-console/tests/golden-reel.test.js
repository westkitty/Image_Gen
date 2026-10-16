'use strict';
// GOLDEN REEL regression fixture: "STATION NINE — THE LAST REPLY" (original, non-canon, two characters, ten lines, two scenes).
//
// EVIDENCE BOUNDARY — READ THIS: speech here comes from the shared FAKE Big Mac (tests/helpers/fake-bigmac.js): every "line" is a
// deterministic TONE, not speech. This test proves the production DEPENDENCY LOGIC (fingerprints, incremental planning, reuse, derived FX
// lineage, scene/project assembly, mastering, MP3/M4B export, chapters, proof/revision reports) against the REAL producer, mixer, FFmpeg and
// stores. It is NOT evidence that any speech model ran. Live speech proof is `scripts/golden-reel.js` against the real Big Mac.
const test = require('node:test'); const assert = require('node:assert/strict');
const D = require('../drama'); const P = require('../drama-planner'); const T = require('../audio-tools'); const SD = require('../sound-director');
const Proof = require('../drama-proof');
const { rig } = require('./helpers/drama-rig');

const opts = { skip: T.available().ffmpeg ? false : 'ffmpeg not installed' };
const SCRIPT = `INT. CONTROL ROOM - NIGHT

CONTROL: Station Nine, this is Control. Your emergency beacon arrived eleven minutes early. Do you copy?

NINE: I copy. The delay is wrong.

CONTROL: How wrong?

NINE: Your reply came before I asked the question.

CONTROL: Read back the last message.

INT. STATION NINE - NIGHT

NINE: It was my voice. It said, "Do not open the door."

CONTROL: There is no door at Station Nine.

NINE: There wasn't. Until you said that.

CONTROL: Then who is standing beside you?

NINE: You are. In about six seconds.
`;
const REVISED = SCRIPT.replace('"Do not open the door."', '"Never open the door."');
const dialogue = p => D.renderableLines(p).map(x => x.line);
const itemsSent = r => r.state.requests.reduce((n, q) => n + q.items.length, 0);
const speechInputs = (r, p) => Object.fromEntries(dialogue(p).map(l => { const fp = P.lineFingerprint(p, l, r.drama.planContext()).fp; return [l.id, fp && fp.inputs_sha]; }));
const snapshot = (r, p) => ({
  takes: Object.fromEntries(dialogue(p).map(l => { const t = P.planProduction(p, r.drama.planContext()).chosen.get(l.id); return [l.id, { take: t && t.id, sha: t && t.sha256, artifact: t && t.artifact_id, speech_fp: t && t.fingerprint && t.fingerprint.speech_sha }]; })),
  scene_masters: Object.fromEntries(p.scenes.map(s => [s.id, (p.scene_masters[s.id] || {}).artifact_id])),
  master: p.project_master && p.project_master.artifact_id, master_sha: p.project_master && p.project_master.sha256, assembly_fp: p.project_master && p.project_master.assembly_fp,
  requests: r.state.requests.length, items: itemsSent(r),
});

async function build() {
  const r = await rig({ base: undefined });
  const c = await r.drama.createProject({ title: 'STATION NINE — THE LAST REPLY [QA FIXTURE]', script: SCRIPT }); const p = r.dstore.get(c.project.id) || r.drama.need(c.project.id);
  const control = r.profiles.create({ name: 'QA FIXTURE · CONTROL (Kokoro am_michael)', type: 'preset', preset_voice: 'am_michael' });
  const nine = r.profiles.create({ name: 'QA FIXTURE · NINE (VoiceDesign, UNAPPROVED)', type: 'designed', design: { identity: { age: 'middle-aged', gender_presentation: 'male', register: 'low', timbre: 'dry, textured' } } });
  const act = k => p.actors.find(a => a.speaker_key === k);
  D.bindActor(p, act('CONTROL').id, control.id); D.bindActor(p, act('NINE').id, nine.id);
  r.drama.updateActor(p.id, act('NINE').id, { fx: 'radio' });
  // real local, procedural sound design — no downloads, nothing external
  const gen = async (recipe, seconds) => SD.generateProcedural({ recipe, seconds }, { mediaStore: r.mediaStore, tools: T });
  const hum = await gen('hum', 12), beep = await gen('beep', 0.3), tone = await gen('room_tone', 12);
  const [s1, s2] = p.scenes.map(s => s.id);
  r.drama.addTrack(p.id, { role: 'ambience', artifact_id: hum.artifact_id, scene_id: s1, loop: true, gain: 0.22, duck: true, required: true, fade_in_s: 1.2, fade_out_s: 1.5, label: 'low electrical ambience' });
  r.drama.addTrack(p.id, { role: 'sfx', artifact_id: beep.artifact_id, scene_id: s1, start_s: 0.35, gain: 0.3, duck: false, required: true, label: 'comms beep' });
  r.drama.addTrack(p.id, { role: 'ambience', artifact_id: tone.artifact_id, scene_id: s2, loop: true, gain: 0.2, duck: true, required: false, fade_in_s: 1.5, fade_out_s: 1.5, label: 'room-tone shift' });
  p.delivery = { formats: ['mp3', 'm4b'], stems: false }; p.mastering = { preset: 'drama' };
  return Object.assign(r, { p, control, nine, hum, beep, tone, s1, s2 });
}

test('GOLDEN REEL (stand-in speech): the script parses to the exact contract and nothing is invented', opts, async () => {
  const r = await build(); const p = r.p; const dlg = dialogue(p);
  assert.equal(p.scenes.length, 2); assert.equal(dlg.length, 10); assert.deepEqual([...new Set(dlg.map(l => l.speaker_key))].sort(), ['CONTROL', 'NINE']);
  assert.equal(p.actors.some(a => /NARRATOR/i.test(a.speaker_key)), false, 'no narrator'); assert.equal(p.source_coverage.ok, true);
  assert.deepEqual(p.scenes.map(s => s.title), ['INT. CONTROL ROOM - NIGHT', 'INT. STATION NINE - NIGHT']);
  assert.deepEqual(dlg.map(l => l.speaker_key), ['CONTROL', 'NINE', 'CONTROL', 'NINE', 'CONTROL', 'NINE', 'CONTROL', 'NINE', 'CONTROL', 'NINE'], 'source order preserved');
  assert.equal(dlg[5].text, 'It was my voice. It said, "Do not open the door."');
  const plan = P.planProduction(p, r.drama.planContext());
  assert.deepEqual({ lines: plan.counts.lines, new: plan.counts.new, reuse: plan.counts.reuse, stale: plan.counts.stale }, { lines: 10, new: 10, reuse: 0, stale: 0 });
  assert.equal(plan.review_items.some(i => i.code === 'voice-not-production-ready'), true, 'the unapproved designed fixture voice is flagged for human review, not silently accepted');
});

test('GOLDEN REEL (stand-in speech): State A original → State B one dialogue change → State C effects-only change', opts, async () => {
  const r = await build(); const p = r.p; const nineLines = () => dialogue(p).filter(l => l.speaker_key === 'NINE');
  // ── STATE A ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const A = await r.finish(r.producer.produce(p.id), 60000); assert.equal(A.status, 'complete', JSON.stringify(A.errors));
  const a = snapshot(r, p);
  assert.equal(a.requests, 2, 'one model load per voice group (CONTROL, NINE)'); assert.equal(a.items, 10, 'exactly ten lines synthesised');
  assert.deepEqual(r.state.requests.map(q => q.items.length).sort(), [5, 5]); assert.deepEqual([...new Set(r.state.requests.map(q => q.worker))].sort(), ['kokoro', 'qwen3-tts-voice-design']);
  assert.equal(Object.values(a.takes).filter(t => t.sha).length, 10, 'every line has a hash-verified take'); assert.equal(new Set(Object.values(a.takes).map(t => t.sha)).size, 10);
  // outputs: real files, measured
  const pm = p.project_master, master = r.mediaStore.resolve(pm.artifact_id), mp3 = r.mediaStore.resolve(pm.outputs.mp3), m4b = r.mediaStore.resolve(pm.outputs.m4b);
  const pi = await T.probe(master.path); assert.equal(pi.codec, 'pcm_s24le'); assert.equal(pi.sample_rate, 48000); assert.equal(pi.channels, 2); assert.ok(pi.duration > 8);
  for (const f of [mp3, m4b]) { await T.decodeCheck(f.path); assert.ok(Math.abs((await T.probe(f.path)).duration - pi.duration) < 0.3); }
  assert.deepEqual((await T.probe(m4b.path)).chapters.map(c => c.title), ['INT. CONTROL ROOM - NIGHT', 'INT. STATION NINE - NIGHT'], 'two scene chapters');
  const ch = (await T.probe(m4b.path)).chapters; assert.ok(ch[0].start < 0.05 && ch[1].start > 3 && Math.abs(ch[1].end - pi.duration) < 0.3, 'chapter boundaries follow the scenes');
  const meas = await T.measureLoudness(master.path); assert.ok(Math.abs(meas.integrated_lufs - -18) < 1.0, 'measured loudness within 1 LU of the −18 LUFS drama target: ' + meas.integrated_lufs); assert.ok(meas.true_peak_dbtp <= -1.4, 'true peak under the ceiling: ' + meas.true_peak_dbtp);
  const wav = await T.scanWav(master.path); assert.ok(wav.peak > 0.02, 'not an all-silence programme');
  // actor-specific processing: only NINE has derived (processed) audio; clean takes stay untouched
  const derivedA = r.derived.entries().filter(e => e.lineage && e.lineage.fx_identity && e.lineage.fx_identity !== 'clean');
  const nineShas = new Set(nineLines().map(l => a.takes[l.id].sha)), ctlShas = new Set(dialogue(p).filter(l => l.speaker_key === 'CONTROL').map(l => a.takes[l.id].sha));
  assert.ok(derivedA.length >= 5, 'five NINE lines were processed'); assert.ok(derivedA.every(e => e.lineage.fx_chain.preset === 'radio' && nineShas.has(e.lineage.source_sha256)), 'derived audio is NINE-only and cites its dry source');
  assert.ok(![...ctlShas].some(s => derivedA.some(e => e.lineage.source_sha256 === s)), 'CONTROL stays clean');
  // cues: required cues resolved, placed, and the proof binds to the master checksum
  const tl = r.drama.timelineView(p.id, r.s1); const cues = tl.lanes.flatMap(l => l.clips).filter(c => c.track_id); assert.equal(cues.length, 2); assert.ok(cues.every(c => c.resolved));
  assert.ok(cues.some(c => c.loop), 'ambience loops'); const beepClip = cues.find(c => !c.loop); assert.ok(Math.abs(beepClip.start_s - 0.35) < 0.01, 'beep near the start');
  const proofA = r.proofs.get(A.id); assert.equal(proofA.master.sha256, pm.sha256); assert.equal(proofA.human_acceptance.state, 'pending'); assert.ok(Proof.verifyProof(proofA, r.mediaStore).ok);
  const stateA = { master: pm.artifact_id, scenes: { ...a.scene_masters }, outputs: { ...pm.outputs }, shas: Object.fromEntries(Object.entries(a.takes).map(([k, v]) => [k, v.sha])) };

  // ── STATE B: change ONE NINE line ─────────────────────────────────────────────────────────────────────────────────────────────────────
  const ids = dialogue(p).map(l => l.id);
  const prev = await r.drama.reparse(p.id, { script: REVISED }); assert.equal(prev.ok, true); assert.equal(prev.applied, false); assert.equal(p.source_script, SCRIPT, 'the preview changed nothing'); assert.equal(JSON.stringify(prev).includes('Never open'), true);
  const applied = await r.drama.reparse(p.id, { script: REVISED, apply: true }); assert.equal(applied.applied, true); assert.deepEqual(dialogue(p).map(l => l.id), ids, 'line identities survive the edit');
  const planB = P.planProduction(p, r.drama.planContext());
  assert.equal(planB.counts.stale + planB.counts.new, 1, 'exactly one line needs speech'); assert.equal(planB.counts.reuse, 9, 'nine lines stay reusable');
  const changed = dialogue(p).find(l => /Never open/.test(l.text)); assert.equal(changed.speaker_key, 'NINE'); assert.equal((planB.stale.concat(planB.required)).map(x => x.line_id)[0], changed.id);
  const beforeB = r.state.requests.length, itemsBeforeB = itemsSent(r);
  const B = await r.finish(r.producer.produce(p.id), 60000); assert.equal(B.status, 'complete', JSON.stringify(B.errors));
  const b = snapshot(r, p);
  assert.equal(b.requests - beforeB, 1, 'one model load'); assert.equal(b.items - itemsBeforeB, 1, 'ONE line synthesised'); assert.equal(r.state.requests[r.state.requests.length - 1].worker, 'qwen3-tts-voice-design');
  assert.equal(B.lines.generated, 1); assert.equal(B.lines.reused, 9);
  for (const l of dialogue(p)) { if (l.id === changed.id) continue; assert.equal(b.takes[l.id].sha, stateA.shas[l.id], 'unchanged line keeps its exact take: ' + l.id); }
  assert.notEqual(b.takes[changed.id].sha, stateA.shas[changed.id]); assert.ok(changed.takes.length >= 1);
  assert.equal(b.scene_masters[r.s1], stateA.scenes[r.s1], 'scene 1 master reused — nothing in scene 1 changed'); assert.notEqual(b.scene_masters[r.s2], stateA.scenes[r.s2], 'scene 2 rebuilt'); assert.notEqual(b.master, stateA.master, 'project master updated');
  assert.ok(r.mediaStore.resolve(stateA.master), 'State A master still exists, recoverable');
  const rev = Proof.compareSnapshots(r.proofs.get(A.id).snapshot, r.proofs.get(B.id).snapshot); assert.ok(JSON.stringify(rev).includes(changed.id), 'the revision report names the changed line');
  const stateB = { master: p.project_master.artifact_id, sha: p.project_master.sha256, assembly_fp: p.project_master.assembly_fp, shas: Object.fromEntries(Object.entries(b.takes).map(([k, v]) => [k, v.sha])), scenes: { ...b.scene_masters } };

  const speechB = speechInputs(r, p); assert.ok(Object.values(speechB).every(Boolean), 'every line has a speech input fingerprint');
  // ── STATE C: effects-only change (NINE: Radio/Comms → Intercom) — ZERO speech synthesis ─────────────────────────────────────────────────
  const nineActor = p.actors.find(x => x.speaker_key === 'NINE'); r.drama.updateActor(p.id, nineActor.id, { fx: 'intercom' });
  const planC = P.planProduction(p, r.drama.planContext()); assert.equal(planC.counts.new + planC.counts.stale, 0, 'no speech is invalidated by an effects change'); assert.equal(planC.counts.reuse, 10);
  const beforeC = r.state.requests.length, derivedBefore = r.derived.entries().length;
  const C = await r.finish(r.producer.produce(p.id), 60000); assert.equal(C.status, 'complete', JSON.stringify(C.errors));
  assert.equal(r.state.requests.length, beforeC, 'ZERO Big Mac invocations'); assert.equal(C.lines.generated, 0); assert.equal(C.lines.reused, 10);
  const c = snapshot(r, p);
  for (const l of dialogue(p)) assert.equal(c.takes[l.id].sha, stateB.shas[l.id], 'clean take unchanged: ' + l.id);
  assert.deepEqual(speechInputs(r, p), speechB, 'speech input fingerprints are unchanged by an effects-only edit');
  const derivedNew = r.derived.entries().filter(e => e.lineage && e.lineage.fx_chain && e.lineage.fx_chain.preset === 'intercom');
  assert.ok(r.derived.entries().length > derivedBefore && derivedNew.length >= 5, 'new processed lineage for NINE');
  assert.ok(derivedNew.every(e => new Set(nineLines().map(l => c.takes[l.id].sha)).has(e.lineage.source_sha256)), 'every new processed version cites its unchanged dry take');
  assert.notEqual(c.assembly_fp, stateB.assembly_fp, 'assembly fingerprint changed'); assert.notEqual(c.master_sha, stateB.sha, 'the output audio really changed');
  assert.notEqual(c.scene_masters[r.s1], stateB.scenes[r.s1], 'NINE speaks in scene 1 too: its mix is rebuilt'); assert.notEqual(c.scene_masters[r.s2], stateB.scenes[r.s2], 'and scene 2');
  // history remains distinguishable and recoverable
  for (const id of [stateA.master, stateB.master, p.project_master.artifact_id]) assert.ok(r.mediaStore.resolve(id), 'master artifact exists: ' + id);
  assert.equal(new Set([stateA.master, stateB.master, p.project_master.artifact_id]).size, 3, 'three distinct masters');
});
