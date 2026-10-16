'use strict';
// Portable voice bank: export/import with strict validation. Cached speaker state is never exported or trusted.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const crypto = require('node:crypto');
const A = require('../voice-audio'); const VP = require('../voice-profiles'); const Z = require('../portable-archive'); const Bank = require('../voice-bank');
const rawZip = require('./helpers/rawzip');

const tmp = p => fs.mkdtempSync(path.join(os.tmpdir(), 'dex-bank-' + p));
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const tone = (sec = 5, hz = 220) => { const rate = 24000, n = Math.round(sec * rate), a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = (i < 3000 ? 0.001 : 0.3) * Math.sin(2 * Math.PI * hz * i / rate); return { sampleRate: rate, channels: [a] }; };
const wavFile = a => { const f = path.join(tmp('w'), 's.wav'); fs.writeFileSync(f, A.encodeWav(a)); return f; };
const mk = () => VP.createProfileStore({ root: tmp('r'), ingest: async p => fs.readFileSync(p) });

async function populated() {
  const s = mk();
  const clone = s.create({ name: 'Tiger', type: 'cloned', language: 'en', notes: 'main character' });
  const sm = await s.addSample(clone.id, { srcPath: wavFile(tone(6)), transcript: 'Hello there, this is Tiger.' });
  s.reviewSample(clone.id, sm.sample.id, { state: 'approved' }); s.setConsent(clone.id, { kind: 'fictional', note: 'invented character' });
  const designed = s.create({ name: 'Narrator', type: 'designed', design: { identity: { age: 'older', accent: 'British', timbre: 'warm' } } });
  const preset = s.create({ name: 'Bright', type: 'preset', preset_voice: 'bf_emma' });
  return { s, clone: s.get(clone.id), designed: s.get(designed.id), preset: s.get(preset.id), sample: sm.sample };
}
const exportTo = async (s, ids, opts) => { const f = path.join(tmp('x'), 'bank.zip'); const r = await Bank.exportBank({ profiles: s, ids, outPath: f, ...opts }); return Object.assign(r, { file: f }); };

test('metadata-only export contains no audio and no transcripts', async () => {
  const { s, clone, designed, preset } = await populated();
  const r = await exportTo(s, [clone.id, designed.id, preset.id], { include_audio: false, include_transcripts: false });
  const z = Z.openZip(r.file); assert.deepEqual(z.entries.map(e => e.name), ['manifest.json']);
  const m = JSON.parse(z.read('manifest.json').toString());
  assert.equal(m.schema, 'dexdiffusion.voice_bank.v1'); assert.equal(m.profiles.length, 3); assert.equal(m.options.include_audio, false);
  const c = m.profiles.find(p => p.id === clone.id);
  assert.equal(c.samples[0].transcript, undefined); assert.equal(c.samples[0].file, undefined); assert.match(c.samples[0].sha256, /^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(m).includes('Hello there'), 'transcript text is not exported'); assert.ok(!JSON.stringify(m).includes(os.tmpdir()), 'no absolute local paths');
  assert.equal(c.consent.kind, 'fictional'); assert.deepEqual(c.required_engines, ['qwen3-tts-base']);
});

test('explicit audio + transcript export round-trips into a fresh store as a usable profile', async () => {
  const { s, clone, designed, preset, sample } = await populated();
  const r = await exportTo(s, [clone.id, designed.id, preset.id], { include_audio: true, include_transcripts: true });
  const fresh = mk();
  const report = await Bank.importBank({ profiles: fresh, zipPath: r.file, apply: true });
  assert.equal(report.ok, true, JSON.stringify(report.errors)); assert.equal(report.created.length, 3);
  const c2 = fresh.list().find(p => p.name === 'Tiger');
  assert.equal(c2.type, 'cloned'); assert.equal(c2.samples.length, 1); assert.equal(c2.samples[0].sha256, sample.sha256); assert.equal(c2.samples[0].transcript, 'Hello there, this is Tiger.');
  assert.equal(c2.validation.state, 'valid'); assert.equal(c2.consent.kind, 'fictional');
  assert.equal(c2.origin.kind, 'imported'); assert.equal(c2.origin.original_id, clone.id); assert.equal(c2.approval.state, 'draft', 'imported voices are not auto-approved');
  assert.equal(c2.locked, false);
  const d2 = fresh.list().find(p => p.name === 'Narrator'); assert.equal(d2.design.identity.accent, 'British'); assert.equal(d2.description, designed.description);
  assert.equal(fresh.list().find(p => p.name === 'Bright').preset_voice, 'bf_emma');
});

test('dry run validates and reports without creating anything', async () => {
  const { s, clone } = await populated(); const r = await exportTo(s, [clone.id], { include_audio: true, include_transcripts: true });
  const fresh = mk(); const rep = await Bank.importBank({ profiles: fresh, zipPath: r.file, apply: false });
  assert.equal(rep.ok, true); assert.equal(rep.applied, false); assert.equal(rep.profiles[0].action, 'create'); assert.equal(fresh.list().length, 0);
});

test('duplicate profile ids are renamed (or skipped) and reported; originals are untouched', async () => {
  const { s, clone } = await populated(); const r = await exportTo(s, [clone.id], { include_audio: true, include_transcripts: true });
  const rep = await Bank.importBank({ profiles: s, zipPath: r.file, apply: true });
  assert.equal(rep.created.length, 1); assert.notEqual(rep.created[0].id, clone.id); assert.equal(rep.profiles[0].action, 'rename'); assert.equal(rep.created[0].original_id, clone.id);
  assert.equal(s.get(clone.id).name, 'Tiger');
  const skip = await Bank.importBank({ profiles: s, zipPath: r.file, apply: true, on_conflict: 'skip' });
  assert.equal(skip.created.length, 0); assert.equal(skip.profiles[0].action, 'skip');
});

const manifestOf = (profiles, extra) => JSON.stringify(Object.assign({ schema: 'dexdiffusion.voice_bank.v1', created_at: 1, options: { include_audio: true, include_transcripts: true }, profiles }, extra));
const prof = (o) => Object.assign({ id: 'vp-aaaaaaaaaa', name: 'X', type: 'cloned', language: 'en', required_engines: ['qwen3-tts-base'], samples: [] }, o);
const importRaw = async (entries, opts = {}) => { const f = path.join(tmp('h'), 'b.zip'); fs.writeFileSync(f, rawZip(entries)); return Bank.importBank({ profiles: mk(), zipPath: f, apply: true, ...opts }); };

test('hostile archives are refused before anything is parsed: traversal, absolute names, bombs', async () => {
  for (const bad of ['../manifest.json', '/etc/manifest.json', 'a/../../x']) {
    const rep = await importRaw([{ name: 'manifest.json', data: manifestOf([]) }, { name: bad, data: 'x' }]);
    assert.equal(rep.ok, false); assert.match(rep.errors[0], /unsafe/i, bad);
  }
});

test('manifest problems: missing, wrong schema, unsupported version, oversize, not JSON', async () => {
  assert.match((await importRaw([{ name: 'other.txt', data: 'x' }])).errors[0], /manifest\.json/);
  assert.match((await importRaw([{ name: 'manifest.json', data: '{not json' }])).errors[0], /valid JSON/);
  assert.match((await importRaw([{ name: 'manifest.json', data: JSON.stringify({ schema: 'someone.else.v1', profiles: [] }) }])).errors[0], /schema/);
  assert.match((await importRaw([{ name: 'manifest.json', data: JSON.stringify({ schema: 'dexdiffusion.voice_bank.v9', profiles: [] }) }])).errors[0], /version|schema/);
});

test('per-profile validation: bad ids, bad types, duplicate ids inside the bank', async () => {
  const rep = await importRaw([{ name: 'manifest.json', data: manifestOf([prof({ id: '../evil' }), prof({ id: 'vp-bbbbbbbbbb', type: 'weird' }), prof({ id: 'vp-cccccccccc', type: 'preset', preset_voice: 'af_heart', required_engines: ['kokoro'] }), prof({ id: 'vp-cccccccccc', type: 'preset', preset_voice: 'af_heart', required_engines: ['kokoro'] })]) }]);
  assert.equal(rep.created.length, 1, 'only the valid, unique profile is created');
  assert.ok(rep.profiles.some(p => /invalid profile id/i.test(p.problems.join())));
  assert.ok(rep.profiles.some(p => /type/i.test(p.problems.join())));
  assert.ok(rep.profiles.some(p => /duplicate/i.test(p.problems.join())));
});

test('sample integrity: checksum mismatch, missing file, invalid audio, path escape are all rejected per profile', async () => {
  const wav = A.encodeWav(tone(6));
  const good = { id: 'sm-aaaaaaaaaa', name: 's', file: 'samples/vp-aaaaaaaaaa/sm-aaaaaaaaaa.wav', sha256: sha(wav), bytes: wav.length, transcript: 'Hello.', active: true };
  const ok = await importRaw([{ name: 'manifest.json', data: manifestOf([prof({ samples: [good] })]) }, { name: good.file, data: wav }]);
  assert.equal(ok.ok, true, JSON.stringify(ok)); assert.equal(ok.created.length, 1);
  const badSha = await importRaw([{ name: 'manifest.json', data: manifestOf([prof({ samples: [Object.assign({}, good, { sha256: 'f'.repeat(64) })] })]) }, { name: good.file, data: wav }]);
  assert.equal(badSha.created.length, 0); assert.match(badSha.profiles[0].problems.join(), /checksum/i);
  const missing = await importRaw([{ name: 'manifest.json', data: manifestOf([prof({ samples: [good] })]) }]);
  assert.equal(missing.created.length, 1); assert.match(missing.profiles[0].warnings.join(), /missing sample/i); assert.equal(missing.created[0].validation, 'invalid');
  const junk = Buffer.from('not a wav at all'.repeat(100));
  const bad = await importRaw([{ name: 'manifest.json', data: manifestOf([prof({ samples: [Object.assign({}, good, { sha256: sha(junk), bytes: junk.length })] })]) }, { name: good.file, data: junk }]);
  assert.equal(bad.created.length, 0); assert.match(bad.profiles[0].problems.join(), /wav|audio/i);
  for (const file of ['../../etc/passwd', '/etc/passwd', 'samples/../../x.wav', 'other/dir/x.wav']) {
    const esc = await importRaw([{ name: 'manifest.json', data: manifestOf([prof({ samples: [Object.assign({}, good, { file })] })]) }, { name: good.file, data: wav }]);
    assert.equal(esc.created.length, 0, file); assert.match(esc.profiles[0].problems.join(), /sample path/i, file);
  }
});

test('placeholder or cached speaker embeddings are ignored and reported, never imported as voice state', async () => {
  const rep = await importRaw([{ name: 'manifest.json', data: manifestOf([prof({ type: 'preset', preset_voice: 'af_heart', required_engines: ['kokoro'], speaker_embedding: [0.1, 0.2], cached_prompt: 'abc', samples: [] })]) }]);
  assert.equal(rep.created.length, 1); assert.match(rep.profiles[0].warnings.join(), /cached|embedding/i);
  const store = mk(); const f = path.join(tmp('h2'), 'b.zip'); fs.writeFileSync(f, rawZip([{ name: 'manifest.json', data: manifestOf([prof({ type: 'preset', preset_voice: 'af_heart', required_engines: ['kokoro'], speaker_embedding: [1] })]) }]));
  await Bank.importBank({ profiles: store, zipPath: f, apply: true });
  assert.ok(!JSON.stringify(fs.readFileSync(path.join(store.root, store.list()[0].id, 'profile.json'), 'utf8')).includes('speaker_embedding'));
});

test('engine compatibility is reported against the locally known engines', async () => {
  const rep = await importRaw([{ name: 'manifest.json', data: manifestOf([prof({ type: 'preset', preset_voice: 'af_heart', required_engines: ['kokoro', 'chatterbox-turbo'] })]) }], { apply: false });
  assert.match(rep.profiles[0].warnings.join(), /chatterbox-turbo.*not available|unknown engine/i);
});

test('consent and permission metadata travels with the voice; real-person without a note stays invalid', async () => {
  const rep = await importRaw([{ name: 'manifest.json', data: manifestOf([prof({ type: 'designed', description: 'a warm older narrator voice', required_engines: ['qwen3-tts-voice-design'], consent: { kind: 'real-person', note: '' } })]) }]);
  assert.equal(rep.created.length, 1);
});
