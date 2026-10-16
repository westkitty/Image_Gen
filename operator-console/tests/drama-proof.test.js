'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path'); const os = require('node:os');
const D = require('../drama'); const T = require('../audio-tools'); const A = require('../voice-audio'); const FX = require('../fx-rack'); const Proof = require('../drama-proof'); const P = require('../drama-planner');
const { rig } = require('./helpers/drama-rig');

const opts = { skip: T.available().ffmpeg ? false : 'ffmpeg not installed' };
const CANARY = 'PROOFCANARY-3317';
const SCRIPT = `INT. WAREHOUSE - NIGHT
TIGER: I warned you about the lamp ${CANARY}.
CODEC: I know that already.

EXT. ROOFTOP - DAWN
NARRATOR: And so it ended.
CODEC: Goodbye then.`;
const lines = p => D.renderableLines(p).map(x => x.line);

async function done(extra = {}) { const r = await rig(extra); const p = await r.project(SCRIPT); const fin = await r.finish(r.producer.produce(p.id)); assert.equal(fin.status, 'complete', JSON.stringify(fin.errors)); return Object.assign(r, { p, fin }); }

test('the proof report is complete, text-free, tied to the master checksum and honest about what was not run', opts, async () => {
  const r = await done(); const proof = r.proofs.get(r.fin.id);
  assert.equal(proof.schema, Proof.PROOF_SCHEMA); assert.equal(proof.project_id, r.p.id); assert.equal(proof.production_id, r.fin.id); assert.equal(proof.source.rev, 1); assert.equal(proof.source.sha256, r.p.source_sha256);
  assert.equal(proof.counts.lines, 4); assert.equal(proof.counts.scenes, 2); assert.equal(proof.counts.lines_rendered, 4); assert.equal(proof.counts.lines_reused, 0);
  assert.equal(proof.completeness.ok, true); assert.equal(proof.completeness.lines_covered, 4);
  const master = r.mediaStore.resolve(r.p.project_master.artifact_id); assert.equal(proof.master.sha256, master.sha256); assert.equal(proof.outputs[0].role, 'master'); assert.deepEqual(proof.outputs.slice(1).map(o => o.format).sort(), ['m4b', 'mp3']);
  assert.ok(proof.outputs.every(o => /^[a-f0-9]{64}$/.test(o.sha256))); assert.equal(proof.chapters.length, 2);
  assert.equal(proof.integrity.length_matches_plan, true); assert.equal(proof.integrity.finite, true); assert.equal(proof.integrity.decodable, true);
  assert.equal(proof.asr.state, 'UNAVAILABLE'); assert.match(proof.asr.reason, /no local recogniser/); assert.equal(proof.mastering.applied, true); assert.ok(Math.abs(proof.mastering.after.integrated_lufs + 18) <= 0.6 || proof.mastering.limiter_engaged);
  assert.equal(proof.human_acceptance.state, 'pending'); assert.equal(proof.provenance.local_only, true); assert.ok(proof.provenance.engines[0].startsWith('kokoro@mlx-audio')); assert.equal(proof.statements.length, 3);
  assert.equal(JSON.stringify(proof).includes(CANARY), false, 'the proof contains no screenplay text'); assert.equal(JSON.stringify(proof.snapshot).includes('lamp'), false);
  assert.ok(Proof.verifyProof(proof, r.mediaStore).ok);
});

test('tampering with the report or replacing the master is detected', opts, async () => {
  const r = await done(); const proof = r.proofs.get(r.fin.id);
  const forged = JSON.parse(JSON.stringify(proof)); forged.completeness.ok = false; assert.match(Proof.verifyProof(forged, r.mediaStore).problems[0], /altered/);
  const missing = JSON.parse(JSON.stringify(proof)); missing.master.artifact_id = 'gone.wav'; assert.equal(Proof.verifyProof(missing, r.mediaStore).ok, false);
  const wrong = JSON.parse(JSON.stringify(proof)); wrong.master.sha256 = 'f'.repeat(64); assert.ok(Proof.verifyProof(wrong, r.mediaStore).problems.some(p => /altered|checksum/.test(p)));
});

test('human listening acceptance is recorded separately and does not invalidate the software evidence', opts, async () => {
  const r = await done(); assert.equal(r.proofs.get(r.fin.id).human_acceptance.state, 'pending');
  const a = r.proofs.setAcceptance(r.fin.id, { state: 'approved', note: 'listened start to finish' }); assert.equal(a.human_acceptance.state, 'approved'); assert.ok(a.human_acceptance.at);
  assert.ok(Proof.verifyProof(a, r.mediaStore).ok); assert.throws(() => r.proofs.setAcceptance(r.fin.id, { state: 'great' }), /pending, approved or rejected/);
});

test('local ASR disagreement becomes a REVIEW state in the proof with exact line references (never a failure)', opts, async () => {
  const fake = { checkLine: async ({ expected }) => ({ status: /lamp/.test(expected) ? 'REVIEW' : 'PASS', engine: 'whisper.cpp', model: 'ggml-fake.bin', wer: 0.3, missing: [{ text: 'lamp', at_word: 5 }], repeated: [], pronunciation_suspects: [], incomplete: false }) };
  const r = await rig({ detectAsr: () => ({ available: true, bin: '/b', model: '/m/ggml-fake.bin' }), asr: fake }); const p = await r.project(SCRIPT);
  const fin = await r.finish(r.producer.produce(p.id)); assert.equal(fin.status, 'complete', 'ASR review never blocks publication');
  const proof = r.proofs.get(fin.id); assert.equal(proof.asr.state, 'REVIEW'); assert.equal(proof.asr.model, 'ggml-fake.bin'); assert.equal(proof.asr.review.length, 1); assert.equal(proof.asr.review[0].line_id, lines(p)[0].id);
  assert.ok(lines(p)[0].takes[0].qa.asr.status === 'REVIEW', 'recorded on the take for the exact line and take');
});

test('a silent take is a hard integrity failure: nothing is published and the lines are named', opts, async () => {
  const r = await rig(); const p = await r.project('TIGER: Hello there.\nCODEC: Hi.'); await r.finish(r.producer.produce(p.id));
  const l = lines(p)[0], t = l.takes[0]; const silent = path.join(os.tmpdir(), 'dex-sil-' + Date.now() + '.wav'); fs.writeFileSync(silent, A.encodeWav({ sampleRate: 24000, channels: [new Float32Array(24000)] }));
  const rec = r.mediaStore.finalize(silent, { kind: 'voice', base: 'silent' }); t.artifact_id = rec.artifact_id; t.sha256 = rec.sha256;
  delete p.project_master; r.dstore.touch(p);
  const fin = await r.finish(r.producer.produce(p.id));
  assert.equal(fin.status, 'failed'); assert.equal(r.jobStore.get(fin.job_id).status, 'FAILED'); assert.ok(fin.errors.some(e => e.code === 'integrity' && e.line_id === l.id)); assert.equal(p.project_master, undefined);
});

test('a take whose audio changed on disk since it was rendered is caught before it can enter a master', opts, async () => {
  const r = await rig(); const p = await r.project('TIGER: Hello there.'); await r.finish(r.producer.produce(p.id));
  const t = lines(p)[0].takes[0]; t.sha256 = 'e'.repeat(64); delete p.project_master;
  const fin = await r.finish(r.producer.produce(p.id)); assert.equal(fin.status, 'failed'); assert.ok(fin.errors.some(e => /checksum-mismatch/.test(e.message)));
});

test("Director's Revision Report: dialogue, voice, FX and cue changes are derived from fingerprints; reuse and remix-only are separated", opts, async () => {
  const r = await done(); const before = r.proofs.get(r.fin.id).snapshot; const ctx = r.drama.planContext();
  D.setLine(r.p, lines(r.p)[0].id, { text: 'I warned you about the light.' });                         // dialogue edit
  r.p.actors.find(a => a.speaker_key === 'NARRATOR').fx = FX.presetChain('radio');                        // effect only (scene 2)
  const mid = Proof.buildSnapshot(r.p, ctx);
  const rep1 = Proof.compareSnapshots(before, mid);
  assert.equal(rep1.summary.dialogue_changed, 1); assert.ok(rep1.dialogue_changed[0].changed.includes('dialogue')); assert.equal(rep1.summary.stale_clips, 1); assert.equal(rep1.summary.needs_regeneration, 1);
  assert.equal(rep1.summary.reused, 3, 'every other take is reused as-is'); assert.equal(rep1.summary.voice_identity_changed, 0);
  assert.ok(rep1.remix_only.some(s => s.scene_id === r.p.scenes[1].id), 'the FX-only scene needs a remix, not new speech'); assert.equal(rep1.remix_only.some(s => s.scene_id === r.p.scenes[0].id), false, 'the edited scene needs speech first');
  assert.equal(rep1.effects_changed.length, 1); assert.match(rep1.method, /fingerprints/);
  const fin2 = await r.finish(r.producer.produce(r.p.id)); assert.equal(fin2.status, 'complete'); const after = r.proofs.get(fin2.id).snapshot;
  const rep2 = Proof.compareSnapshots(before, after); assert.equal(rep2.summary.needs_regeneration, 0); assert.equal(rep2.summary.dialogue_changed, 1); assert.equal(rep2.summary.reused, 3);
});

test('a voice change is reported as a voice-identity change on exactly that speaker\'s lines', opts, async () => {
  const r = await done(); const before = r.proofs.get(r.fin.id).snapshot; const tiger = r.p.actors.find(a => a.speaker_key === 'TIGER');
  const pid = tiger.voice_profile_id; r.profiles.update(pid, { preset_voice: 'am_michael' });
  const rep = Proof.compareSnapshots(before, Proof.buildSnapshot(r.p, r.drama.planContext()));
  assert.equal(rep.summary.voice_identity_changed, 1); assert.deepEqual(rep.voices_changed, ['TIGER']); assert.deepEqual(rep.voice_identity_changed[0].changed, ['voice identity']); assert.equal(rep.summary.dialogue_changed, 0);
});

test('mastering-only changes show up as such', opts, async () => {
  const r = await done(); const before = r.proofs.get(r.fin.id).snapshot; r.p.mastering = { preset: 'podcast' };
  const rep = Proof.compareSnapshots(before, Proof.buildSnapshot(r.p, r.drama.planContext())); assert.equal(rep.mastering_changed, true); assert.equal(rep.summary.needs_regeneration, 0); assert.equal(rep.summary.stale_clips, 0);
});
