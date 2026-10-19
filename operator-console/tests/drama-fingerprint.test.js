'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../drama-fingerprint');
const Score = require('../performance-score');

const sample = (o = {}) => Object.assign({ id: 'sm-aaaaaaaaaa', sha256: 'a'.repeat(64), transcript: 'Hello there.', active: true }, o);
const profile = (o = {}) => Object.assign({ id: 'vp-1111111111', identity_version: 1, name: 'Tiger', type: 'designed', language: 'en', description: 'A gravelly baritone, calm and slow.', samples: [], preferred_engine: 'qwen3-tts-voice-design' }, o);
const cloned = (o = {}) => profile(Object.assign({ type: 'cloned', description: '', preferred_engine: 'qwen3-tts-base', samples: [sample()] }, o));
const preset = (o = {}) => profile(Object.assign({ type: 'preset', description: '', preset_voice: 'af_heart', default_speed: 1, preferred_engine: 'kokoro' }, o));
const line = (o = {}) => Object.assign({ id: 'ln-001', kind: 'dialogue', speaker: 'TIGER', speaker_key: 'TIGER', text: 'I warned you.', direction: '' }, o);
const actor = (o = {}) => Object.assign({ speaker_key: 'TIGER', voice_profile_id: 'vp-1111111111', pronunciation: [], default_direction: '' }, o);
const fp = (o = {}) => F.speechFingerprint(Object.assign({ line: line(), actor: actor(), profile: profile(), engineId: 'qwen3-tts-voice-design', language: 'en', direction: '' }, o));

test('canonical JSON is key-order independent and NFC-normalised', () => {
  assert.equal(F.canonical({ b: 1, a: [2, { d: 1, c: 2 }] }), F.canonical({ a: [2, { c: 2, d: 1 }], b: 1 }));
  assert.equal(F.canonical({ s: 'é' }), F.canonical({ s: 'é' }));
  assert.equal(F.canonical({ a: undefined, b: 1 }), F.canonical({ b: 1 }));
});

test('spoken text normalisation is documented: NFC, CRLF, whitespace runs collapse, ends trimmed', () => {
  assert.equal(F.normalizeSpokenText('  I  warned\r\n you.\t'), 'I warned you.');
  assert.equal(F.normalizeSpokenText('café'), 'café');
});

test('fingerprint is deterministic, versioned and exposes per-component hashes', () => {
  const a = fp(), b = fp();
  assert.equal(a.inputs_sha, b.inputs_sha);
  assert.match(a.inputs_sha, /^[a-f0-9]{64}$/);
  assert.equal(a.version, F.FP_VERSION);
  for (const k of ['text', 'speaker', 'voice', 'reference', 'engine', 'language', 'settings', 'delivery', 'performance', 'pronunciation', 'source']) assert.match(a.components[k], /^[a-f0-9]{64}$/, k);
});

test('whitespace-only and unrelated edits do not change the speech fingerprint', () => {
  const base = fp();
  assert.equal(fp({ line: line({ text: 'I   warned\nyou. ' }) }).inputs_sha, base.inputs_sha);
  assert.equal(fp({ line: line({ pause_after_s: 3, id: 'ln-009' }) }).inputs_sha, base.inputs_sha, 'pauses/ids are assembly concerns');
  assert.equal(fp({ profile: profile({ name: 'Renamed Tiger', notes: 'x' }) }).inputs_sha, base.inputs_sha, 'profile rename is not a voice change');
});

test('editing one word changes the speech fingerprint (text component only)', () => {
  const a = fp(), b = fp({ line: line({ text: 'I warned them.' }) });
  assert.notEqual(a.inputs_sha, b.inputs_sha);
  assert.deepEqual(F.diffComponents(a, b), ['text']);
});

test('voice identity changes invalidate: description, sample, transcript, preset voice', () => {
  const base = fp();
  assert.notEqual(fp({ profile: profile({ description: 'A bright soprano.' }) }).inputs_sha, base.inputs_sha);
  const c = F.speechFingerprint({ line: line(), actor: actor(), profile: cloned(), engineId: 'qwen3-tts-base', language: 'en', direction: '' });
  const c2 = F.speechFingerprint({ line: line(), actor: actor(), profile: cloned({ samples: [sample({ id: 'sm-bbbbbbbbbb', sha256: 'b'.repeat(64) })] }), engineId: 'qwen3-tts-base', language: 'en', direction: '' });
  const c3 = F.speechFingerprint({ line: line(), actor: actor(), profile: cloned({ samples: [sample({ transcript: 'Hello, there.' })] }), engineId: 'qwen3-tts-base', language: 'en', direction: '' });
  assert.deepEqual(F.diffComponents(c, c2), ['reference']);
  assert.ok(F.diffComponents(c, c3).includes('reference'));
  const k = F.speechFingerprint({ line: line(), actor: actor(), profile: preset(), engineId: 'kokoro', language: 'en', direction: '' });
  const k2 = F.speechFingerprint({ line: line(), actor: actor(), profile: preset({ preset_voice: 'am_adam' }), engineId: 'kokoro', language: 'en', direction: '' });
  assert.notEqual(k.inputs_sha, k2.inputs_sha);
});

test('only the ACTIVE reference sample matters; an inactive sample edit does not invalidate', () => {
  const two = (extra) => cloned({ samples: [sample(), sample({ id: 'sm-cccccccccc', sha256: 'c'.repeat(64), active: false, transcript: extra })] });
  const a = F.speechFingerprint({ line: line(), actor: actor(), profile: two('one'), engineId: 'qwen3-tts-base', language: 'en', direction: '' });
  const b = F.speechFingerprint({ line: line(), actor: actor(), profile: two('two'), engineId: 'qwen3-tts-base', language: 'en', direction: '' });
  assert.equal(a.inputs_sha, b.inputs_sha);
});

test('engine and language changes invalidate', () => {
  const base = fp();
  assert.notEqual(fp({ engineId: 'qwen3-tts-base', profile: cloned() }).inputs_sha, base.inputs_sha);
  assert.notEqual(fp({ language: 'fr' }).inputs_sha, base.inputs_sha);
});

test('delivery direction only matters when the engine actually applies it', () => {
  const kBase = F.speechFingerprint({ line: line(), actor: actor(), profile: preset(), engineId: 'kokoro', language: 'en', direction: '' });
  const kDir = F.speechFingerprint({ line: line(), actor: actor(), profile: preset(), engineId: 'kokoro', language: 'en', direction: 'whispering' });
  assert.equal(kBase.inputs_sha, kDir.inputs_sha, 'Kokoro cannot honor direction, so it cannot change the audio');
  assert.equal(kDir.delivery.requested, 'whispering'); assert.equal(kDir.delivery.applied, false);
  const dBase = fp(), dDir = fp({ direction: 'whispering' });
  assert.notEqual(dBase.inputs_sha, dDir.inputs_sha, 'VoiceDesign appends the direction to the voice description');
  assert.equal(dDir.delivery.applied, true);
  const q = F.speechFingerprint({ line: line(), actor: actor(), profile: cloned(), engineId: 'qwen3-tts-base', language: 'en', direction: 'shouting' });
  assert.equal(q.delivery.applied, false, 'Qwen3 Base never forwards instruct');
});

test('performance score directions invalidate only the bound line and stale source is rejected', () => {
  const score = Score.createScore({ sourceText: 'I warned you.', profileId: 'vp-1111111111', identityVersion: 1, lineId: 'ln-001',
    phrases: [{ start: 2, end: 8, text: 'warned', delivery: 'quietly' }] });
  const base = fp();
  const directed = fp({ performanceScore: score });
  assert.notEqual(directed.inputs_sha, base.inputs_sha);
  assert.throws(() => fp({ line: line({ text: 'I told you.' }), performanceScore: score }), /stale/);
  assert.throws(() => fp({ profile: profile({ id: 'vp-other' }), performanceScore: score }), /different voice profile/);
  assert.throws(() => fp({ profile: profile({ identity_version: 2 }), performanceScore: score }), /stale voice identity/);
});

test('kokoro speed is a synthesis setting', () => {
  const a = F.speechFingerprint({ line: line(), actor: actor(), profile: preset(), engineId: 'kokoro', language: 'en', direction: '', speed: 1 });
  const b = F.speechFingerprint({ line: line(), actor: actor(), profile: preset(), engineId: 'kokoro', language: 'en', direction: '', speed: 1.2 });
  assert.notEqual(a.inputs_sha, b.inputs_sha);
});

test('pronunciation rules change the spoken text; unmatched rules do not', () => {
  const rules = [{ from: 'warned', to: 'worned' }];
  const base = fp();
  const withRule = fp({ actor: actor({ pronunciation: rules }) });
  assert.notEqual(withRule.inputs_sha, base.inputs_sha);
  assert.equal(withRule.spoken_text, 'I worned you.');
  assert.deepEqual(withRule.pronunciation_applied, [{ from: 'warned', to: 'worned', count: 1 }]);
  assert.equal(fp({ actor: actor({ pronunciation: [{ from: 'Zebra', to: 'Zeebra' }] }) }).inputs_sha, base.inputs_sha);
  assert.equal(F.applyPronunciation('Dexter and dexterity', [{ from: 'dexter', to: 'Dex-ter', ignore_case: true }]).text, 'Dex-ter and dexterity', 'whole words only');
});

test('seed is excluded from the eligibility key but included in the render key', () => {
  const a = fp();
  assert.equal(F.renderFingerprint(a, 5), F.renderFingerprint(a, 5));
  assert.notEqual(F.renderFingerprint(a, 5), F.renderFingerprint(a, 6));
  assert.notEqual(F.renderFingerprint(a, 5), a.inputs_sha);
});

test('speaker/casting identity: another speaker key or profile id invalidates', () => {
  const base = fp();
  assert.notEqual(fp({ line: line({ speaker_key: 'CODEC' }), actor: actor({ speaker_key: 'CODEC' }) }).inputs_sha, base.inputs_sha);
  assert.notEqual(fp({ profile: profile({ id: 'vp-2222222222' }) }).inputs_sha, base.inputs_sha);
});

test('runtime/engine revision participates in the fingerprint', () => {
  const base = fp();
  const bumped = fp({ revisionOverride: 'mlx-audio 0.6.0' });
  assert.notEqual(base.inputs_sha, bumped.inputs_sha);
});

test('assembly fingerprint reacts to FX/cue changes but never to speech-only identity', () => {
  const scene = (o = {}) => Object.assign({
    scene_id: 'sc-01', mixer_version: F.MIXER_VERSION,
    clips: [{ line_id: 'ln-001', take_id: 'tk-1', take_sha256: 'a'.repeat(64), order: 0, start_s: 0, gain_db: 0, trim_start_s: 0, trim_end_s: null, fade_in_s: 0, fade_out_s: 0, fx_sha: 'none' }],
    cues: [{ id: 'tr-1', artifact_sha256: 'b'.repeat(64), start_s: 1, gain: 0.3, fade_in_s: 0, fade_out_s: 0, loop: false, duck: true, trim_start_s: 0, trim_end_s: null, role: 'music' }],
    settings: { line_gap_s: 0.35, scene_gap_s: 1 }, mastering: { lufs: -18 },
  }, o);
  const base = F.assemblyFingerprint(scene());
  assert.equal(base.version, F.ASSEMBLY_FP_VERSION);
  assert.equal(F.assemblyFingerprint(scene()).sha, base.sha);
  const fx = scene(); fx.clips[0] = Object.assign({}, fx.clips[0], { fx_sha: 'radio' });
  assert.notEqual(F.assemblyFingerprint(fx).sha, base.sha);
  const cue = scene(); cue.cues[0] = Object.assign({}, cue.cues[0], { start_s: 2 });
  assert.notEqual(F.assemblyFingerprint(cue).sha, base.sha);
  const take = scene(); take.clips[0] = Object.assign({}, take.clips[0], { take_sha256: 'c'.repeat(64) });
  assert.notEqual(F.assemblyFingerprint(take).sha, base.sha);
  assert.deepEqual(F.diffComponents(F.assemblyFingerprint(fx), base), ['clips']);
  assert.deepEqual(F.diffComponents(F.assemblyFingerprint(cue), base), ['cues']);
});
