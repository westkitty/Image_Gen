'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const Asr = require('../asr-adapter'); const A = require('../voice-audio'); const T = require('../audio-tools');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dex-asr-'));

test('detect() finds nothing without whisper.cpp and says so; it never downloads or installs anything', () => {
  const d = Asr.detect({ env: {}, which: () => null, exists: () => false, home: '/nonexistent' });
  assert.equal(d.available, false); assert.match(d.reason, /whisper/i); assert.equal(d.bin, null);
});

test('detect() needs BOTH a binary and a local model file; an explicit env path wins', () => {
  const only = Asr.detect({ env: {}, which: n => (n === 'whisper-cli' ? '/opt/bin/whisper-cli' : null), exists: () => false, home: '/h' });
  assert.equal(only.available, false); assert.match(only.reason, /model/i); assert.equal(only.bin, '/opt/bin/whisper-cli');
  const ok = Asr.detect({ env: { DEX_WHISPER_BIN: '/x/whisper-cli', DEX_WHISPER_MODEL: '/x/ggml-base.en.bin' }, which: () => null, exists: p => p.startsWith('/x/'), home: '/h' });
  assert.equal(ok.available, true); assert.equal(ok.model, '/x/ggml-base.en.bin'); assert.equal(ok.local_only, true);
});

test('compare: identical speech passes; harmless punctuation/case/number-word differences do not trigger review', () => {
  const c = Asr.compare('Hello there, Tiger! I warned you.', 'hello there tiger i warned you');
  assert.equal(c.status, 'PASS'); assert.equal(c.wer, 0); assert.deepEqual(c.missing, []); assert.deepEqual(c.repeated, []);
});

test('compare: probable missing words, repetitions, substitutions and truncated renders are reported with exact positions', () => {
  const exp = 'I warned you about the lamp and you did not listen to me at all';
  const miss = Asr.compare(exp, 'I warned you about the lamp and you did not listen');
  assert.equal(miss.status, 'REVIEW'); assert.ok(miss.incomplete, 'the ending is missing'); assert.match(miss.missing.map(m => m.text).join(' '), /to me at all/);
  const rep = Asr.compare('Stay quiet we are not alone', 'Stay quiet quiet we are not alone');
  assert.deepEqual(rep.repeated.map(r => r.text), ['quiet']); assert.equal(rep.status, 'REVIEW');
  const sub = Asr.compare('The colonel arrived at midnight', 'The kernel arrived at midnight');
  assert.deepEqual(sub.pronunciation_suspects.map(s => [s.expected, s.heard]), [['colonel', 'kernel']]);
  const mid = Asr.compare('one two three four five six seven eight', 'one two three seven eight');
  assert.match(mid.missing[0].text, /four five six/); assert.equal(mid.missing[0].at_word, 3);
});

test('compare: ASR disagreement is advisory evidence, never proof, and the report says so', () => {
  const c = Asr.compare('A completely different sentence entirely', 'Something else was said here');
  assert.equal(c.status, 'REVIEW'); assert.notEqual(c.status, 'FAIL'); assert.match(c.limitations, /probabilistic|not proof/i);
  assert.equal(Asr.compare('', '').status, 'PASS');
});

test('transcribe() runs a local whisper.cpp binary on a 16 kHz copy and parses its JSON; only local processes are spawned', { skip: T.available().ffmpeg ? false : 'ffmpeg missing' }, async () => {
  const dir = tmp(); const bin = path.join(dir, 'whisper-cli'), model = path.join(dir, 'ggml-tiny.bin');
  fs.writeFileSync(model, 'x'); fs.writeFileSync(bin, `#!/bin/sh\n# fake whisper.cpp: -of <prefix> -oj → <prefix>.json\nwhile [ $# -gt 0 ]; do case "$1" in -of) OF="$2"; shift;; esac; shift; done\nprintf '%s' '{"transcription":[{"text":" Hello there","offsets":{"from":0,"to":900}},{"text":" friend.","offsets":{"from":900,"to":1500}}]}' > "$OF.json"\n`, { mode: 0o755 });
  const wav = path.join(dir, 'a.wav'); fs.writeFileSync(wav, A.encodeWav({ sampleRate: 24000, channels: [new Float32Array(24000).map((_, i) => 0.3 * Math.sin(i / 8))] }));
  const det = Asr.detect({ env: { DEX_WHISPER_BIN: bin, DEX_WHISPER_MODEL: model }, which: () => null, exists: fs.existsSync, home: dir });
  const r = await Asr.transcribe(wav, det); assert.equal(r.text, 'Hello there friend.'); assert.equal(r.segments.length, 2); assert.equal(r.engine, 'whisper.cpp');
  await assert.rejects(Asr.transcribe(wav, { available: false, reason: 'no model' }), /unavailable/i);
});

test('checkLine() returns UNAVAILABLE (never a pass) when the local recogniser is absent', async () => {
  const r = await Asr.checkLine({ detect: { available: false, reason: 'whisper.cpp is not installed' }, wavPath: '/nope.wav', expected: 'hello' });
  assert.equal(r.status, 'UNAVAILABLE'); assert.match(r.reason, /not installed/); assert.equal(r.wer, undefined);
});

test('checkLine() compares real transcription output with the script and records engine + model', async () => {
  const det = { available: true, bin: '/b', model: '/m/ggml-base.bin', reason: null, local_only: true };
  const r = await Asr.checkLine({ detect: det, wavPath: '/a.wav', expected: 'I warned you about the lamp', transcribe: async () => ({ text: 'I warned you about the', segments: [], engine: 'whisper.cpp', model: 'ggml-base.bin' }) });
  assert.equal(r.status, 'REVIEW'); assert.equal(r.engine, 'whisper.cpp'); assert.equal(r.model, 'ggml-base.bin'); assert.equal(r.missing[0].text, 'lamp'); assert.equal(r.incomplete, false, 'one missing word is a review item, not an incomplete render');
  const t = await Asr.checkLine({ detect: det, wavPath: '/a.wav', expected: 'x', transcribe: async () => { throw new Error('whisper crashed'); } });
  assert.equal(t.status, 'ERROR'); assert.match(t.reason, /crashed/);
});
