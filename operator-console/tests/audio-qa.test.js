'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const crypto = require('node:crypto');
const A = require('../voice-audio'); const T = require('../audio-tools'); const P = require('../pacing'); const V = require('../speech-boundary'); const I = require('../audio-integrity');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dex-qa-'));
const R = 24000;
function speech({ lead = 0.4, body = 2, tail = 0.5, amp = 0.3, gap = null, noise = 0.002 } = {}) {
  let s = 1; const rnd = () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return (s / 2147483648) - 1; };
  const n = Math.round((lead + body + tail) * R), a = new Float32Array(n);
  for (let i = 0; i < n; i++) { const t = i / R; const inBody = t >= lead && t < lead + body && !(gap && t >= gap[0] && t < gap[1]); a[i] = (inBody ? amp * Math.sin(2 * Math.PI * 200 * t) * (0.7 + 0.3 * Math.sin(2 * Math.PI * 4 * t)) : 0) + noise * rnd(); }
  return { sampleRate: R, channels: [a] };
}
const wav = a => { const f = path.join(tmp(), 'a.wav'); fs.writeFileSync(f, A.encodeWav(a)); return f; };
const HAVE = T.available(); const ff = { skip: HAVE.ffmpeg ? false : 'ffmpeg missing' };

test('pacing: words per minute come from active speech only, not edge silence', () => {
  const m = P.measure('one two three four five six seven eight nine ten', speech({ lead: 1, body: 4, tail: 1 }));
  assert.equal(m.words, 10); assert.ok(Math.abs(m.active_s - 4) < 0.1, 'active ' + m.active_s); assert.ok(Math.abs(m.wpm - 150) <= 6, 'wpm ' + m.wpm);
});

test('pacing: tempo planning warns on strong stretching, blocks outside the tool range, and never defaults on', () => {
  assert.deepEqual(P.planTempo({ measured_wpm: 150, target_wpm: 150 }).warnings, []);
  const fast = P.planTempo({ measured_wpm: 150, target_wpm: 300 }); assert.equal(fast.tempo, 2); assert.equal(fast.blocked, false); assert.ok(fast.warnings.some(w => /excessive/.test(w)));
  assert.equal(P.planTempo({ measured_wpm: 100, target_wpm: 300 }).blocked, true);
  assert.ok(P.planTempo({ measured_wpm: 150, tempo: 1.35 }).warnings.some(w => /strong speed-up/.test(w)));
  assert.equal(P.resolveSetting({ mode: 'off' }, null), null); assert.equal(P.resolveSetting(undefined, undefined), null);
  assert.deepEqual(P.resolveSetting({ mode: 'wpm', target_wpm: 300 }, null), { mode: 'wpm', target_wpm: 300 });
  assert.deepEqual(P.resolveSetting({ mode: 'wpm', target_wpm: 300 }, { mode: 'off' }), null, 'a line can opt out of its actor preset');
  assert.equal(P.PRESETS.fast_monologue.target_wpm, 300); assert.equal(P.PRESETS.off.mode, 'off');
});

test('pacing: a real stretch is verified by measured duration and WPM, and the original is untouched', ff, async () => {
  const src = wav(speech({ lead: 0.2, body: 4, tail: 0.2 })); const before = fs.readFileSync(src); const dest = path.join(tmp(), 'p.wav');
  const text = Array.from({ length: 10 }, (_, i) => 'w' + i).join(' ');
  const r = await P.applyStretch(src, dest, { text, tempo: 1.25 });
  assert.equal(r.verified, true); assert.ok(Math.abs(r.duration_after - r.duration_before / 1.25) < 0.05);
  assert.ok(Math.abs(r.result.wpm / r.original.wpm - 1.25) < 0.08, `WPM ${r.original.wpm} → ${r.result.wpm}`); assert.ok(fs.readFileSync(src).equals(before));
  await assert.rejects(P.applyStretch(src, dest, { text, tempo: 3 }), /outside the supported/i);
});

test('boundaries: leading/trailing silence and a long gap are found; padding protects the speech', () => {
  const a = speech({ lead: 0.6, body: 3, tail: 0.8, gap: [1.4, 3.0] });
  const b = V.detectBoundaries(a);
  assert.equal(b.engine, 'energy-vad'); assert.equal(b.silero.available, false); assert.match(b.silero.reason, /not installed/);
  assert.ok(Math.abs(b.speech_start_s - 0.6) < 0.1 && Math.abs(b.speech_end_s - 3.6) < 0.1, `${b.speech_start_s}..${b.speech_end_s}`);
  assert.ok(b.long_gaps.length === 1 && b.long_gaps[0].duration_s > 1.2);
  assert.ok(b.suggested_trim.start_s <= b.speech_start_s - 0.07 && b.suggested_trim.end_s >= b.speech_end_s + 0.1, 'padding keeps the first and last speech');
  assert.match(b.note, /never altered/);
});

test('boundaries: a quiet, short word near the edge is KEPT inside the suggested trim and flagged, not silently cut', () => {
  const a = speech({ lead: 0.8, body: 2, tail: 0.3 }); for (let i = Math.round(0.2 * R); i < Math.round(0.3 * R); i++) a.channels[0][i] = 0.02 * Math.sin(i / 5);
  const b = V.detectBoundaries(a);
  assert.ok(b.low_confidence.length >= 1, JSON.stringify(b.segments)); assert.ok(b.suggested_trim.start_s <= b.low_confidence[0].start_s, 'the quiet early word is inside the trim'); assert.equal(b.suggested_trim.includes_low_confidence, true);
});

test('boundaries: pure silence or a flat tone yields no trim suggestion', () => {
  assert.equal(V.detectBoundaries({ sampleRate: R, channels: [new Float32Array(R * 2)] }).suggested_trim, null);
  assert.equal(V.detectBoundaries({ sampleRate: R, channels: [new Float32Array(R * 2).map((_, i) => 0.3 * Math.sin(i / 7))] }).suggested_trim, null);
});

test('integrity: a valid take passes; hard failures name what is wrong', ff, async () => {
  const f = wav(speech()); const buf = fs.readFileSync(f); const sha = crypto.createHash('sha256').update(buf).digest('hex');
  const ok = await I.checkTake({ take: { artifact_id: 'a.wav', sha256: sha }, record: { path: f, sha256: sha }, words: 5 }); assert.equal(ok.ok, true); assert.deepEqual(ok.hard, []);
  const bad = await I.checkTake({ take: { artifact_id: 'a.wav', sha256: 'f'.repeat(64) }, record: { path: f, sha256: sha } }); assert.equal(bad.ok, false); assert.equal(bad.hard[0].code, 'checksum-mismatch');
  assert.equal((await I.checkTake({ take: { artifact_id: 'a.wav' }, record: { path: path.join(tmp(), 'gone.wav') } })).hard[0].code, 'artifact-missing');
  assert.equal((await I.checkTake({ take: null, record: null })).hard[0].code, 'no-artifact');
  const junk = path.join(tmp(), 'j.wav'); fs.writeFileSync(junk, 'not audio at all, definitely not'); assert.equal((await I.checkTake({ take: { artifact_id: 'j' }, record: { path: junk } })).hard[0].code, 'undecodable');
});

test('integrity: a silent TAKE is a hard failure (no placeholder for failed speech) but silent pauses between takes are not take failures', ff, async () => {
  const silent = wav({ sampleRate: R, channels: [new Float32Array(R * 2)] });
  const r = await I.checkTake({ take: { artifact_id: 's.wav' }, record: { path: silent }, words: 4 }); assert.ok(r.hard.some(h => h.code === 'silent-speech'));
  const withPause = await I.checkTake({ take: { artifact_id: 'p.wav' }, record: { path: wav(speech({ lead: 0.2, body: 2.5, tail: 0.2, gap: [1.0, 2.0] })) }, words: 6 }); assert.equal(withPause.ok, true, 'silence inside a performed line is allowed');
});

test('integrity: clipping, very quiet audio and odd speech rate are ADVISORY, not hard', ff, async () => {
  const loud = await I.checkTake({ take: { artifact_id: 'l.wav' }, record: { path: wav(speech({ amp: 3 })) }, words: 5 }); assert.equal(loud.ok, true); assert.ok(loud.advisory.some(a => a.code === 'clipping'));
  const quiet = await I.checkTake({ take: { artifact_id: 'q.wav' }, record: { path: wav(speech({ amp: 0.004, noise: 0.0001 })) }, words: 5 }); assert.ok(quiet.advisory.some(a => a.code === 'very-quiet'));
  const rate = await I.checkTake({ take: { artifact_id: 'r.wav' }, record: { path: wav(speech({ body: 1, lead: 0, tail: 0 })) }, words: 40 }); assert.ok(rate.advisory.some(a => a.code === 'speech-rate'));
});

test('coverage accounting: a missing current take or an unmastered scene is a hard failure', () => {
  const D = require('../drama'); const script = 'INT. A\nTIGER: One.\nINT. B\nCODEC: Two.'; const p = D.newProject({ title: 't', source_script: script, parsed: D.parseScript(script) });
  const ren = D.renderableLines(p); const chosen = new Map([[ren[0].line.id, {}]]);
  const r = I.checkCoverage({ project: p, chosen, sceneMasters: { [p.scenes[0].id]: {} }, renderable: ren });
  assert.equal(r.ok, false); assert.deepEqual(r.hard.map(h => h.code).sort(), ['line-uncovered', 'scene-unmastered']); assert.equal(r.lines_covered, 1);
  const all = I.checkCoverage({ project: p, chosen: new Map(ren.map(x => [x.line.id, {}])), sceneMasters: Object.fromEntries(p.scenes.map(s => [s.id, {}])), renderable: ren }); assert.equal(all.ok, true);
});
