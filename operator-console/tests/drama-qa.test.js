'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const crypto = require('node:crypto');
const M = require('../media'); const A = require('../voice-audio'); const T = require('../audio-tools'); const { createQa } = require('../drama-qa');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dex-qa2-'));
const mstore = () => { const b = tmp(); const s = M.createMediaStore({ roots: { image: b + '/i', voice: b + '/v', music: b + '/m', video: b + '/vid', world: b + '/w' }, registryFile: b + '/media.json' }); s.ensureRoots(); return s; };
const speechAudio = (sec = 2, amp = 0.3) => { const n = Math.round(sec * 24000), a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = (i < 4000 || i > n - 4000 ? 0 : amp * Math.sin(2 * Math.PI * 200 * i / 24000)); return { sampleRate: 24000, channels: [a] }; };
const art = (ms, a) => { const f = path.join(tmp(), 's.wav'); fs.writeFileSync(f, A.encodeWav(a)); const r = ms.finalize(f, { kind: 'voice', base: 'x', duration: a.channels[0].length / 24000 }); return r; };
const UNAV = { available: false, reason: 'whisper.cpp (whisper-cli) is not installed' };

test('without a local recogniser the speech check is UNAVAILABLE and the report says so; integrity still runs', { skip: T.available().ffmpeg ? false : 'ffmpeg missing' }, async () => {
  const ms = mstore(); const a = art(ms, speechAudio()); const qa = createQa({ mediaStore: ms, detectAsr: () => UNAV });
  const r = await qa.run([{ line: { id: 'ln-001' }, take: { id: 'tk-1', artifact_id: a.artifact_id, sha256: a.sha256 }, expected: 'hello there', words: 2, inputsSha: 'x' }]);
  assert.equal(r.summary.asr.state, 'UNAVAILABLE'); assert.match(r.summary.asr.reason, /not installed/); assert.equal(r.lines[0].qa.asr.status, 'UNAVAILABLE'); assert.equal(r.lines[0].qa.integrity.ok, true);
  assert.deepEqual(r.summary.hard_failures, []); assert.equal(r.summary.checked, 1);
});

test('hard integrity failures are reported separately from ASR review; a failed take is never ASR-checked', { skip: T.available().ffmpeg ? false : 'ffmpeg missing' }, async () => {
  const ms = mstore(); const good = art(ms, speechAudio()), silent = art(ms, { sampleRate: 24000, channels: [new Float32Array(48000)] }); let asrCalls = 0;
  const qa = createQa({ mediaStore: ms, detectAsr: () => ({ available: true, bin: '/b', model: '/m.bin' }), asr: { checkLine: async () => { asrCalls++; return { status: 'REVIEW', wer: 0.4, missing: [{ text: 'x' }], repeated: [], pronunciation_suspects: [], incomplete: true }; } } });
  const r = await qa.run([{ line: { id: 'a' }, take: { id: 't1', artifact_id: good.artifact_id }, expected: 'e', words: 4, inputsSha: 's' }, { line: { id: 'b' }, take: { id: 't2', artifact_id: silent.artifact_id }, expected: 'e', words: 4, inputsSha: 's' }]);
  assert.deepEqual(r.summary.hard_failures.map(h => [h.line_id, h.codes]), [['b', ['silent-speech']]]); assert.equal(asrCalls, 1, 'the silent take was not sent to ASR');
  assert.equal(r.summary.asr.state, 'REVIEW'); assert.equal(r.summary.asr.review[0].line_id, 'a'); assert.equal(r.summary.asr.review[0].incomplete, true);
});

test('previous ASR results are reused only for the same speech inputs', { skip: T.available().ffmpeg ? false : 'ffmpeg missing' }, async () => {
  const ms = mstore(); const a = art(ms, speechAudio()); let calls = 0;
  const qa = createQa({ mediaStore: ms, detectAsr: () => ({ available: true, bin: '/b', model: '/m.bin' }), asr: { checkLine: async () => { calls++; return { status: 'PASS', wer: 0, missing: [], repeated: [], pronunciation_suspects: [] }; } } });
  const take = { id: 't', artifact_id: a.artifact_id }; const item = { line: { id: 'l' }, take, expected: 'x', words: 2, inputsSha: 'A' };
  const first = await qa.run([item]); take.qa = first.lines[0].qa;
  await qa.run([item]); assert.equal(calls, 1, 'cached for identical inputs');
  await qa.run([{ ...item, inputsSha: 'B' }]); assert.equal(calls, 2, 'the line changed, so it is checked again');
});

test('boundary suggestions and advisories surface in the summary but never as failures', { skip: T.available().ffmpeg ? false : 'ffmpeg missing' }, async () => {
  const ms = mstore(); const a = art(ms, speechAudio(4, 3)); const qa = createQa({ mediaStore: ms, detectAsr: () => UNAV });
  const r = await qa.run([{ line: { id: 'l' }, take: { id: 't', artifact_id: a.artifact_id }, expected: 'x', words: 9, inputsSha: 'x' }], { asr: false });
  assert.equal(r.summary.hard_failures.length, 0); assert.ok(r.summary.advisories.length >= 1); assert.match(r.summary.asr.reason, /not requested/); assert.equal(r.summary.asr.state, 'UNAVAILABLE');
});
