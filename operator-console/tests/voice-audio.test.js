'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../voice-audio');

const sine = (rate, sec, hz, amp = 0.5, phase = 0) => { const n = Math.round(rate * sec), a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = amp * Math.sin(phase + 2 * Math.PI * hz * i / rate); return { sampleRate: rate, channels: [a] }; };
const maxStep = a => { let m = 0; const c = a.channels[0]; for (let i = 1; i < c.length; i++) m = Math.max(m, Math.abs(c[i] - c[i - 1])); return m; };

test('WAV encode/parse round-trips PCM16 within quantisation error', () => {
  const a = sine(24000, 0.25, 440);
  const b = A.parseWav(A.encodeWav(a));
  assert.equal(b.sampleRate, 24000); assert.equal(b.channels.length, 1); assert.equal(b.channels[0].length, a.channels[0].length);
  let err = 0; for (let i = 0; i < a.channels[0].length; i++) err = Math.max(err, Math.abs(a.channels[0][i] - b.channels[0][i]));
  assert.ok(err < 2 / 32768 + 1e-6);
});

test('parser rejects junk and unsupported encodings', () => {
  assert.throws(() => A.parseWav(Buffer.from('not a wav at all, definitely not')));
  const w = A.encodeWav(sine(8000, 0.05, 100)); w.writeUInt16LE(2, 20); // ADPCM tag
  assert.throws(() => A.parseWav(w), /unsupported/);
});

test('analyze reports RMS/peak/clipping/silence', () => {
  const loud = A.analyze(sine(24000, 1, 220, 1.0));
  assert.ok(loud.clipRatio > 0 && loud.peakDb > -0.1);
  const quiet = A.analyze({ sampleRate: 24000, channels: [new Float32Array(24000)] });
  assert.equal(quiet.silenceRatio, 1);
  const half = A.analyze(sine(24000, 1, 220, 0.5)); assert.ok(Math.abs(half.rmsDb - (-9.03)) < 0.3);
});

test('resample keeps duration and pitch content roughly; mono mixdown averages channels', () => {
  const a = sine(48000, 0.5, 1000), r = A.resample(a, 24000);
  assert.equal(r.sampleRate, 24000); assert.ok(Math.abs(A.duration(r) - 0.5) < 0.001);
  const st = { sampleRate: 100, channels: [Float32Array.from([1, 1]), Float32Array.from([-1, 0.5])] };
  assert.deepEqual([...A.toMono(st).channels[0]], [0, 0.75]);
});

test('stitch: equal-power crossfade is click-free; deliberate gaps are exact; tails are trimmed', () => {
  const a = sine(24000, 0.5, 220, 0.6), b = sine(24000, 0.5, 330, 0.6, 1.3);
  const hard = A.concat([a, b]);
  const joined = A.stitch([a, b], { gapsMs: [0], crossfadeMs: 25, trim: false, normalizeOutput: false });
  const natural = Math.max(maxStep(a), maxStep(b));
  assert.ok(maxStep(joined) <= natural * 2.5, `crossfade step ${maxStep(joined)} vs natural ${natural}`);
  assert.ok(maxStep(hard) > 0.4 && maxStep(hard) > maxStep(joined) * 4, 'a hard cut at a phase jump would click');
  assert.ok(Math.abs(A.duration(joined) - (1.0 - 0.025)) < 0.002);
  const gapped = A.stitch([a, b], { gapsMs: [260], trim: false, normalizeOutput: false });
  assert.ok(Math.abs(A.duration(gapped) - 1.26) < 0.002);
  const padded = { sampleRate: 24000, channels: [Float32Array.from([...new Float32Array(2400), ...a.channels[0], ...new Float32Array(2400)])] };
  const trimmed = A.stitch([padded], { trim: true, normalizeOutput: false });
  assert.ok(A.duration(trimmed) < A.duration(padded) - 0.15);
});

test('normalize peaks at -1 dBFS without amplifying silence', () => {
  const n = A.normalize(sine(24000, 0.2, 200, 0.1));
  assert.ok(Math.abs(A.analyze(n).peakDb + 1) < 0.1);
  const z = { sampleRate: 24000, channels: [new Float32Array(100)] };
  assert.equal(A.normalize(z), z);
});

test('mix places clips on a timeline with gain, fades and trim', () => {
  const a = sine(24000, 1, 220, 0.4), b = sine(24000, 1, 440, 0.4);
  const out = A.mix([{ audio: a, startSec: 0 }, { audio: b, startSec: 0.5, gain: 0.5, fadeInSec: 0.1, trimStartSec: 0.2 }], { sampleRate: 24000, channels: 2 });
  assert.equal(out.channels.length, 2); assert.ok(Math.abs(A.duration(out) - 1.3) < 0.002);
  assert.ok(A.analyze(out).peak <= 0.9 + 1e-6);
});
