'use strict';
// DESCRIBE → AUDITION → COMPARE → APPROVE → LOCK → REUSE with the real bridge/stores and a fake Big Mac.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path');
const A = require('../voice-audio'); const VP = require('../voice-profiles'); const F = require('../drama-fingerprint');
const { createAuditionService } = require('../voice-auditions');
const { harness, settle, tone, writeWav } = require('./helpers/fake-bigmac');

const CANARY = 'AUDITION-CANARY-7781';
const DESIGN = { identity: { age: 'middle-aged', gender_presentation: 'masculine', accent: 'Scottish', register: 'low baritone', timbre: 'gravelly', personality: 'calm and dry' } };
function setup(opts) {
  const h = harness(opts);
  const auditions = createAuditionService({ dir: h.base + '/auditions', profiles: h.profiles, voice: h.voice, mediaStore: h.mediaStore, jobStore: h.jobStore });
  const profile = h.profiles.create({ name: 'Tiger', type: 'designed', design: DESIGN });
  return Object.assign(h, { auditions, profile });
}
const done = async (h, round) => { for (let i = 0; i < 400; i++) { const r = h.auditions.getRound(h.profile.id, round.id); if (r.status !== 'rendering') return r; await new Promise(r2 => setTimeout(r2, 5)); } throw new Error('audition did not finish'); };

test('voice.renderItems renders N independent outputs in ONE Big Mac job with per-item seeds', async () => {
  const h = setup(); const got = [];
  const r = h.voice.renderItems({ profileId: h.profile.id, items: [{ text: 'One.', seed: 11 }, { text: 'Two.', seed: 22 }], operation: 'audition', onItem: async it => { got.push(it.index); } });
  assert.ok(r.job_id, JSON.stringify(r)); const d = await settle(h.voice, r.job_id);
  assert.equal(d.status, 'COMPLETE'); assert.deepEqual(got, [0, 1]); assert.equal(h.state.requests.length, 1);
  assert.deepEqual(h.state.requests[0].items.map(i => i.seed), [11, 22]);
  assert.equal(h.voice.renderItems({ profileId: h.profile.id, items: [{ text: 'x'.repeat(701), seed: 1 }] }).status, 400);
  assert.equal(h.voice.renderItems({ profileId: h.profile.id, items: [] }).status, 400);
});

test('audition: several candidates with traceable seeds, playable clips, nothing auto-approved', async () => {
  const h = setup(); const r = h.auditions.start(h.profile.id, { text: CANARY + ' I will not ask twice.', count: 3 });
  assert.equal(r.status, 'rendering'); assert.equal(r.candidates.length, 3);
  const fin = await done(h, r);
  assert.equal(fin.status, 'complete');
  assert.equal(new Set(fin.candidates.map(c => c.seed)).size, 3, 'distinct traceable seeds');
  for (const c of fin.candidates) { assert.equal(c.status, 'complete'); assert.equal(c.clips.length, 1); assert.ok(c.clips[0].url && c.clips[0].duration > 0 && /^[a-f0-9]{64}$/.test(c.clips[0].sha256)); assert.equal(c.approved, false); assert.equal(c.favorite, false); }
  assert.equal(fin.engine, 'qwen3-tts-voice-design'); assert.match(fin.runtime, /mlx-audio/); assert.match(fin.description_sha, /^[a-f0-9]{64}$/);
  assert.equal(h.profiles.get(h.profile.id).approval.state, 'draft', 'the first successful output is not approved automatically');
  assert.equal(h.mediaStore.list('voice').every(m => m.meta.operation === 'audition' && m.meta.audition.profile_id === h.profile.id), true);
});

test('audition text is not persisted unless the user opts in; only its hash and length are kept', async () => {
  const h = setup(); const r = h.auditions.start(h.profile.id, { text: CANARY + ' secret scene line.', count: 2 }); await done(h, r); h.jobStore.flush();
  const dump = [fs.readFileSync(path.join(h.base, 'auditions', h.profile.id + '.json'), 'utf8'), fs.readFileSync(path.join(h.base, 'jobs.json'), 'utf8'), fs.readFileSync(path.join(h.base, 'media.json'), 'utf8')].join('\n');
  assert.ok(!dump.includes(CANARY));
  const keep = h.auditions.start(h.profile.id, { text: 'Kept on request please.', count: 1, keep_text: true }); await done(h, keep);
  assert.match(fs.readFileSync(path.join(h.base, 'auditions', h.profile.id + '.json'), 'utf8'), /Kept on request/);
});

test('short-scene audition: several lines per candidate with the same seed so the character stays consistent', async () => {
  const h = setup(); const r = h.auditions.start(h.profile.id, { lines: ['First line here.', 'Second line follows.', 'And a third.'], count: 2, source: 'scene' });
  const fin = await done(h, r);
  assert.equal(fin.candidates.length, 2); assert.ok(fin.candidates.every(c => c.clips.length === 3));
  const seeds = h.state.requests[0].items.map(i => i.seed); assert.deepEqual(seeds.slice(0, 3), [seeds[0], seeds[0], seeds[0]]); assert.notEqual(seeds[0], seeds[3]);
  assert.equal(fin.source, 'scene');
});

test('favorite / reject / note are recorded; approving requires a complete candidate of the CURRENT identity', async () => {
  const h = setup(); const r = h.auditions.start(h.profile.id, { text: 'Compare these readings.', count: 3 }); const fin = await done(h, r);
  const [a, b, c] = fin.candidates;
  h.auditions.mark(h.profile.id, r.id, a.id, { favorite: true, note: 'warm' }); h.auditions.mark(h.profile.id, r.id, b.id, { rejected: true });
  const g = h.auditions.getRound(h.profile.id, r.id);
  assert.deepEqual([g.candidates[0].favorite, g.candidates[0].note, g.candidates[1].rejected], [true, 'warm', true]);
  assert.throws(() => h.auditions.approve(h.profile.id, r.id, b.id), e => e.gate === 'candidate-rejected');
  const ap = h.auditions.approve(h.profile.id, r.id, c.id, { note: 'this one' });
  assert.equal(ap.candidate.approved, true); assert.equal(h.profiles.get(h.profile.id).approval.state, 'approved'); assert.equal(h.profiles.get(h.profile.id).approval.audition_id, c.id);
  assert.equal(h.auditions.getRound(h.profile.id, r.id).candidates.filter(x => x.approved).length, 1);
  // identity change after the audition → the earlier audition no longer represents the voice
  const r2 = h.auditions.start(h.profile.id, { text: 'Another.', count: 1 }); const f2 = await done(h, r2);
  h.profiles.update(h.profile.id, { design: Object.assign({}, DESIGN, { identity: Object.assign({}, DESIGN.identity, { accent: 'Irish' }) }) });
  assert.throws(() => h.auditions.approve(h.profile.id, r2.id, f2.candidates[0].id), e => e.gate === 'audition-outdated' && e.status === 409);
});

test('an interrupted audition round is reported as interrupted after restart, never complete', async () => {
  const h = setup({ delayMs: 50 }); const r = h.auditions.start(h.profile.id, { text: 'Slow render.', count: 2 });
  const again = createAuditionService({ dir: h.base + '/auditions', profiles: h.profiles, voice: h.voice, mediaStore: h.mediaStore, jobStore: h.jobStore });
  const g = again.getRound(h.profile.id, r.id);
  assert.equal(g.status, 'interrupted'); assert.ok(g.candidates.every(c => c.status !== 'complete'));
  await done(h, r);
});

test('design → clone promotion needs an approved candidate and the EXACT transcript; the clone keeps full provenance', async () => {
  const h = setup(); const TEXT = 'This is a long enough reference line for the clone, spoken clearly and calmly.';
  const r = h.auditions.start(h.profile.id, { text: TEXT, count: 2 }); const fin = await done(h, r);
  await assert.rejects(h.auditions.promote(h.profile.id, r.id, fin.candidates[0].id, { transcript: TEXT }), e => e.gate === 'candidate-not-approved');
  h.auditions.approve(h.profile.id, r.id, fin.candidates[0].id);
  await assert.rejects(h.auditions.promote(h.profile.id, r.id, fin.candidates[0].id, { transcript: 'something else entirely' }), e => e.gate === 'transcript-mismatch');
  const out = await h.auditions.promote(h.profile.id, r.id, fin.candidates[0].id, { transcript: '  ' + TEXT.replace(/ /g, '  ') + ' ', name: 'Tiger (clone)' });
  const c = out.profile;
  assert.equal(c.type, 'cloned'); assert.equal(c.origin.kind, 'promoted'); assert.equal(c.origin.design_profile_id, h.profile.id); assert.equal(c.origin.audition_id, fin.candidates[0].id);
  assert.equal(c.origin.model, 'qwen3-tts-voice-design'); assert.equal(c.origin.seed, fin.candidates[0].seed); assert.match(c.origin.reference_sha256, /^[a-f0-9]{64}$/);
  assert.equal(c.samples.length, 1); assert.equal(c.samples[0].sha256, c.origin.reference_sha256); assert.equal(c.samples[0].transcript.replace(/\s+/g, ' ').trim(), TEXT);
  assert.equal(c.samples[0].review.state, 'approved'); assert.equal(c.consent.kind, 'fictional');
  assert.match(c.origin.design_description, /Scottish/);
  assert.equal(c.trial.passed, false); assert.equal(VP.readiness(c).ready, false, 'a promoted clone is not production-ready until trialled');
  assert.deepEqual(h.profiles.get(h.profile.id).promoted_clone_ids, [c.id]);
});

test('promotion refuses a reference that is too short to clone from', async () => {
  const h = setup(); const r = h.auditions.start(h.profile.id, { text: 'Hi.', count: 1 }); const fin = await done(h, r);
  h.auditions.approve(h.profile.id, r.id, fin.candidates[0].id);
  await assert.rejects(h.auditions.promote(h.profile.id, r.id, fin.candidates[0].id, { transcript: 'Hi.' }), e => e.gate === 'reference-too-short');
});

test('clone trial renders several lines in one job; it only passes by explicit human acceptance', async () => {
  const h = setup(); const TEXT = 'This is a long enough reference line for the clone, spoken clearly and calmly.';
  const r = h.auditions.start(h.profile.id, { text: TEXT, count: 1 }); const fin = await done(h, r); h.auditions.approve(h.profile.id, r.id, fin.candidates[0].id);
  const clone = (await h.auditions.promote(h.profile.id, r.id, fin.candidates[0].id, { transcript: TEXT })).profile;
  assert.throws(() => h.auditions.startTrial(clone.id, { lines: ['Only one.', 'Two.'] }), /at least 3/);
  const t = h.auditions.startTrial(clone.id, { lines: ['Line number one.', 'Line number two is here.', 'And line three follows.'] });
  const fin2 = await h.auditions.waitTrial(clone.id, t.id);
  assert.equal(fin2.status, 'complete'); assert.equal(fin2.clips.length, 3); assert.ok(fin2.clips.every(c => c.checks.decodable && c.checks.not_silent));
  assert.equal(h.profiles.get(clone.id).trial.passed, false, 'programmatic checks never pass a voice by themselves');
  assert.equal(h.state.requests.at(-1).items.length, 3); assert.equal(h.state.requests.at(-1).ref_text.length > 10, true);
  const acc = h.auditions.acceptTrial(clone.id, t.id, { note: 'sounds like the design across lines' });
  assert.equal(acc.profile.trial.passed, true);
  h.profiles.approve(clone.id, {}); h.profiles.setConsent(clone.id, { kind: 'fictional' });
  assert.equal(VP.readiness(h.profiles.get(clone.id)).ready, true);
});

test('preview renders a short scratch clip, labelled as a preview, never a take', async () => {
  const h = setup(); const long = 'A sentence of reasonable length that goes on. '.repeat(30);
  const r = h.voice.preview({ profileId: h.profile.id, text: long });
  assert.ok(r.truncated && r.chars <= 240); const d = await settle(h.voice, r.job_id);
  assert.equal(d.status, 'COMPLETE'); assert.equal(d.artifact.meta.preview, true); assert.equal(d.artifact.meta.operation, 'preview');
});
