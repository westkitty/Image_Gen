'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { createAuditionService } = require('../voice-auditions');
const Asr = require('../asr-adapter');
const F = require('../drama-fingerprint');

test('clone evaluation is bounded to 18 synthetic-only non-seeded takes and records blinded labels', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clone-evaluation-'));
  const fictional = { id: 'vp-1234567890', type: 'cloned', consent: { kind: 'fictional' }, fingerprint: 'fp' };
  const real = { id: 'vp-1234567891', type: 'cloned', consent: { kind: 'real-person' }, fingerprint: 'fp' };
  const profiles = { get: id => id === fictional.id ? fictional : id === real.id ? real : null };
  let request;
  const voice = { renderItems: opts => { request = opts; return { job_id: 'job-1', engine: 'voxcpm2', revision: '2.0.3', seeds: Array(18).fill(null), delivery: { applied: true }, warnings: [] }; }, waitJob: async () => ({ error: 'fixture did not render' }) };
  const mediaStore = { resolve: () => null };
  const svc = createAuditionService({ dir, profiles, voice, mediaStore, jobStore: {} });
  const scripts = ['One short line.', 'A second short line.', 'A third short line.'];
  const directions = ['neutral', 'quiet anger', 'warm reassurance'];
  assert.throws(() => svc.startEvaluation(real.id, { scripts, directions }), e => e.gate === 'synthetic-only');
  const result = svc.startEvaluation(fictional.id, { scripts, directions });
  assert.equal(result.take_count, 18);
  assert.equal(request.items.length, 18);
  assert.ok(request.items.every(x => x.seed === undefined));
  assert.deepEqual([...new Set(request.items.map(x => x.direction))], directions);
  assert.equal(result.exact_settings.seed_supported, false);
  assert.equal(result.exact_settings.seed, null);
  const stored = svc.getEvaluation(fictional.id, result.id);
  assert.equal(stored.clips.length, 0);
  await new Promise(resolve => setImmediate(resolve));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('saved synthetic evaluation word-integrity QA verifies script hashes and persists local ASR provenance', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clone-evaluation-qa-'));
  const profile = { id: 'vp-1234567890', type: 'cloned', consent: { kind: 'fictional' } }, scripts = ['One short line.', 'A second short line.', 'A third short line.'];
  const profiles = { get: id => id === profile.id ? profile : null }, files = new Map(); let request;
  const voice = { renderItems: opts => { request = opts; return { job_id: 'job-qa', engine: 'voxcpm2', revision: '2.0.3', delivery: { applied: false }, warnings: [] }; }, waitJob: async () => { await new Promise(resolve => setTimeout(resolve, 20)); return {}; } };
  const mediaStore = { finalize: (_src, meta) => { const id = `clip-${meta.meta.take}.wav`, file = path.join(dir, id); fs.writeFileSync(file, 'test audio'); const rec = { artifact_id: id, path: file, safe_url: '/api/media/' + id, download_url: '/api/media/' + id + '/download', sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') }; files.set(id, rec); return rec; }, resolve: id => files.get(typeof id === 'string' ? id : id.artifact_id) || null };
  const asr = { transcribe: async () => ({ engine: 'whisper.cpp', model: 'ggml-tiny.en.bin', text: scripts[0] }), compare: Asr.compare };
  const svc = createAuditionService({ dir, profiles, voice, mediaStore, jobStore: {}, detectAsr: () => ({ available: true, bin: '/whisper-cli', model: '/ggml-tiny.en.bin' }), asr, now: () => 1234 });
  const ev = svc.startEvaluation(profile.id, { scripts, directions: ['neutral', 'anger', 'warm'] });
  for (let i = 0; i < 18; i++) { await request.onItem({ index: i, file: '/unused', job_id: 'job-qa', worker: 'voxcpm2', duration: 1 }); }
  await new Promise(resolve => setTimeout(resolve, 25));
  await assert.rejects(svc.checkEvaluationWords(profile.id, ev.id, ['wrong', ...scripts.slice(1)]), e => e.gate === 'script-mismatch');
  // Attach an index to the injected recognizer so the fixture remains explicit about line mapping.
  let call = 0; asr.transcribe = async () => ({ engine: 'whisper.cpp', model: 'ggml-tiny.en.bin', text: scripts[Math.floor(call++ / 6)] });
  const checked = await svc.checkEvaluationWords(profile.id, ev.id, scripts);
  assert.equal(checked.word_integrity.status, 'MEASURED'); assert.equal(checked.word_integrity.clips_measured, 18);
  assert.equal(checked.clips[0].word_integrity.status, 'PASS'); assert.equal(checked.clips[0].word_integrity.measured, true);
  assert.equal(checked.clips[0].word_integrity.transcription, scripts[0]); assert.equal(checked.clips[0].word_integrity.local_only, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('word-integrity service exposes an unavailable runtime without claiming a measurement', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clone-evaluation-unavailable-'));
  const profile = { id: 'vp-1234567890', type: 'cloned', consent: { kind: 'fictional' } }, scripts = ['One short line.', 'A second short line.', 'A third short line.'];
  fs.writeFileSync(path.join(dir, profile.id + '.json'), JSON.stringify({ schema: 'dexdiffusion.voice_auditions.v1', profile_id: profile.id, rounds: [], trials: [], evaluations: [{ id: 'ev-existing', status: 'complete', design: { scripts: scripts.map(t => F.sha(F.normalizeSpokenText(t))) }, clips: Array.from({ length: 18 }, (_, i) => ({ index: i, script_index: Math.floor(i / 6), artifact_id: 'clip-' + i, sha256: 'sha-' + i })) }] }));
  const svc = createAuditionService({ dir, profiles: { get: () => profile }, voice: { renderItems: () => ({ error: 'not used' }) }, mediaStore: { resolve: () => null }, jobStore: {}, detectAsr: () => ({ available: false, reason: 'model missing' }) });
  const checked = await svc.checkEvaluationWords(profile.id, 'ev-existing', scripts);
  assert.equal(checked.word_integrity.status, 'UNAVAILABLE'); assert.equal(checked.word_integrity.measured, false); assert.equal(checked.clips[0].word_integrity.reason, 'model missing');
  fs.rmSync(dir, { recursive: true, force: true });
});
