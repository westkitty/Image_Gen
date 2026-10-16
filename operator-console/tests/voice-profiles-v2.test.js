'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const A = require('../voice-audio'); const VP = require('../voice-profiles');

const tmp = p => fs.mkdtempSync(path.join(os.tmpdir(), 'dex-vp2-' + p));
const tone = (sec = 5, hz = 220, amp = 0.3) => { const rate = 24000, n = Math.round(sec * rate), a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = (i < 4000 ? 0.001 : amp) * Math.sin(2 * Math.PI * hz * i / rate); return { sampleRate: rate, channels: [a] }; };
const wavFile = a => { const f = path.join(tmp('w'), 's.wav'); fs.writeFileSync(f, A.encodeWav(a)); return f; };
const mk = (root = tmp('r')) => VP.createProfileStore({ root, ingest: async p => fs.readFileSync(p) });
const DESIGN = { identity: { age: 'middle-aged', gender_presentation: 'masculine', accent: 'Scottish', register: 'low baritone', timbre: 'gravelly', resonance: 'chest', texture: 'rough', breathiness: 'slight', personality: 'calm and dry', language: 'en' },
  performance: { pacing: 'measured', energy: 'low' }, pronunciation_notes: 'Say "Dexter" as DEK-ster.' };

test('composeDescription is deterministic, identity-only, and never contains scene direction', () => {
  const a = VP.composeDescription(DESIGN), b = VP.composeDescription(JSON.parse(JSON.stringify(DESIGN)));
  assert.equal(a, b); assert.match(a, /middle-aged/); assert.match(a, /Scottish/); assert.match(a, /gravelly/); assert.ok(a.length >= 40 && a.length <= 1000);
  assert.ok(!/DEK-ster|pacing|measured/i.test(a), 'pronunciation notes and performance prefs stay out of the enduring identity description');
  assert.equal(VP.composeDescription({ identity: {} }), '');
});

test('a designed voice built from a design spec stores the spec and composes its description', () => {
  const s = mk(); const p = s.create({ name: 'Tiger', type: 'designed', design: DESIGN });
  assert.equal(p.description, VP.composeDescription(DESIGN)); assert.equal(p.design.identity.accent, 'Scottish'); assert.equal(p.design.version, 1);
  assert.equal(p.identity_version, 1); assert.equal(p.approval.state, 'draft'); assert.equal(p.locked, false); assert.equal(p.origin.kind, 'designed');
  assert.equal(p.validation.state, 'valid');
  const u = s.update(p.id, { design: Object.assign({}, DESIGN, { identity: Object.assign({}, DESIGN.identity, { accent: 'Irish' }) }) });
  assert.match(u.description, /Irish/);
});

test('identity_version bumps only when voice identity changes (not name, notes, performance prefs or pronunciation)', () => {
  const s = mk(); const p = s.create({ name: 'Tiger', type: 'designed', design: DESIGN });
  const v1 = s.update(p.id, { name: 'Tiger Prime', notes: 'n', design: Object.assign({}, DESIGN, { performance: { pacing: 'fast' }, pronunciation_notes: 'other' }) });
  assert.equal(v1.identity_version, 1); assert.equal(v1.fingerprint, p.fingerprint);
  const v2 = s.update(p.id, { design: Object.assign({}, DESIGN, { identity: Object.assign({}, DESIGN.identity, { timbre: 'smooth' }) }) });
  assert.equal(v2.identity_version, 2); assert.notEqual(v2.fingerprint, p.fingerprint);
  assert.equal(mk(s.root).get(p.id).identity_version, 2, 'persisted');
});

test('approve → lock freezes identity edits; naming and notes stay editable; unlock is explicit', () => {
  const s = mk(); const p = s.create({ name: 'Tiger', type: 'designed', design: DESIGN });
  assert.throws(() => s.lock(p.id), e => e.gate === 'profile-not-approved');
  s.approve(p.id, { note: 'chosen after A/B', audition_id: 'au-aaaaaaaa' });
  assert.equal(s.get(p.id).approval.state, 'approved');
  s.lock(p.id); assert.equal(s.get(p.id).locked, true);
  assert.throws(() => s.update(p.id, { description: 'A totally different voice entirely.' }), e => e.gate === 'profile-locked' && e.status === 409);
  assert.throws(() => s.update(p.id, { design: Object.assign({}, DESIGN, { identity: { age: 'young' } }) }), e => e.gate === 'profile-locked');
  assert.equal(s.update(p.id, { name: 'Renamed', notes: 'ok' }).name, 'Renamed');
  s.unlock(p.id); assert.equal(s.get(p.id).locked, false); assert.equal(s.get(p.id).approval.state, 'draft', 'unlocking reopens approval');
  assert.match(s.update(p.id, { description: 'A brand new voice description here.' }).description, /brand new/);
});

test('locked cloned profiles reject sample changes', async () => {
  const s = mk(); const c = s.create({ name: 'C', type: 'cloned' });
  const a = await s.addSample(c.id, { srcPath: wavFile(tone(6)), transcript: 'Hello there friend.' });
  s.approve(c.id, {}); s.lock(c.id);
  await assert.rejects(s.addSample(c.id, { srcPath: wavFile(tone(6)), transcript: 'x' }), e => e.gate === 'profile-locked');
  assert.throws(() => s.updateSample(c.id, a.sample.id, { transcript: 'changed' }), e => e.gate === 'profile-locked');
  assert.throws(() => s.removeSample(c.id, a.sample.id), e => e.gate === 'profile-locked');
  assert.equal(s.updateSample(c.id, a.sample.id, { name: 'renamed only' }).samples[0].name, 'renamed only');
});

test('samples carry full diagnostics: waveform, SNR estimate, clipping, plus a human review state', async () => {
  const s = mk(); const c = s.create({ name: 'C', type: 'cloned' });
  const r = await s.addSample(c.id, { srcPath: wavFile(tone(6)), transcript: 'Hello.' });
  const d = r.sample.diagnostics;
  assert.ok(d.peak_db <= 0 && d.rms_db < d.peak_db && d.clip_percent === 0); assert.equal(d.waveform.bins, 200); assert.equal(d.snr.estimate, true);
  assert.equal(r.sample.review.state, 'unreviewed');
  const p = s.reviewSample(c.id, r.sample.id, { state: 'approved', note: 'sounds clean' });
  assert.equal(p.samples[0].review.state, 'approved'); assert.equal(p.samples[0].review.note, 'sounds clean');
  assert.throws(() => s.reviewSample(c.id, r.sample.id, { state: 'bogus' }), /state/);
  assert.match(s.get(c.id).samples[0].diagnostics_disclaimer, /not a measure of clone fidelity/);
});

test('consent: real-person references need a recorded permission note; fictional needs nothing; unset never blocks', async () => {
  const s = mk(); const c = s.create({ name: 'C', type: 'cloned' });
  await s.addSample(c.id, { srcPath: wavFile(tone(6)), transcript: 'Hello there.' });
  assert.equal(s.get(c.id).consent.kind, 'unspecified');
  assert.equal(s.get(c.id).validation.engines['qwen3-tts-base'].ok, true, 'unset consent does not block fictional work');
  assert.equal(s.get(c.id).readiness.checks.find(x => x.id === 'consent').ok, false, 'but production readiness asks for it');
  assert.throws(() => s.setConsent(c.id, { kind: 'real-person' }), /permission note/);
  const p = s.setConsent(c.id, { kind: 'real-person', note: 'Written permission from the speaker, 2026-09-30', confirm: true });
  assert.equal(p.consent.kind, 'real-person'); assert.ok(p.consent.confirmed_at);
  assert.equal(p.readiness.checks.find(x => x.id === 'consent').ok, true);
  assert.equal(s.setConsent(c.id, { kind: 'fictional' }).consent.kind, 'fictional');
  assert.throws(() => s.setConsent(c.id, { kind: 'nonsense' }), /kind/);
});

test('every existing field of a legacy profile loads unchanged under the v2 reader', () => {
  const root = tmp('legacy'); const id = 'vp-0123456789';
  fs.mkdirSync(path.join(root, id, 'samples'), { recursive: true });
  fs.writeFileSync(path.join(root, id, 'profile.json'), JSON.stringify({ schema: 'dexdiffusion.voice_profile.v1', id, name: 'Old', type: 'designed', language: 'en', preferred_engine: 'qwen3-tts-voice-design', description: 'a gravelly old man with a slow drawl', samples: [], created_at: 1, updated_at: 2 }));
  const s = mk(root); const p = s.get(id);
  assert.equal(p.name, 'Old'); assert.equal(p.description, 'a gravelly old man with a slow drawl'); assert.equal(p.identity_version, 1);
  assert.equal(p.approval.state, 'draft'); assert.equal(p.locked, false); assert.equal(p.consent.kind, 'unspecified');
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, id, 'profile.json'), 'utf8')).schema, 'dexdiffusion.voice_profile.v1', 'reading never rewrites the file');
});

test('production readiness for a cloned voice lists each unmet check', async () => {
  const s = mk(); const c = s.create({ name: 'C', type: 'cloned' });
  await s.addSample(c.id, { srcPath: wavFile(tone(6)), transcript: 'Hello there.' });
  const r0 = VP.readiness(s.get(c.id)); assert.equal(r0.ready, false);
  assert.deepEqual(r0.checks.filter(x => !x.ok).map(x => x.id).sort(), ['approved', 'consent', 'sample-reviewed']);
  const promoted = s.setOrigin(c.id, { kind: 'promoted', design_profile_id: 'vp-1111111111' });
  assert.ok(VP.readiness(promoted).checks.some(x => x.id === 'trial' && !x.ok), 'a promoted clone additionally needs its multi-line trial');
});
