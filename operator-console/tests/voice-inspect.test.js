'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../voice-audio');

// deterministic pseudo-noise so the estimate is reproducible
function lcg(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2147483648 - 1; }; }
function speechLike({ rate = 24000, sec = 3, amp = 0.3, noise = 0.003, gapSec = 0.5, clip = false } = {}) {
  const r = lcg(7), n = Math.round(sec * rate), a = new Float32Array(n), gap = Math.round(gapSec * rate);
  for (let i = 0; i < n; i++) {
    const inGap = i < gap || i >= n - gap;
    const tone = inGap ? 0 : amp * Math.sin(2 * Math.PI * 180 * i / rate) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 3 * i / rate));
    a[i] = Math.max(-1, Math.min(1, (tone + noise * r()) * (clip ? 8 : 1)));
  }
  return { sampleRate: rate, channels: [a] };
}

test('inspectSample reports duration, peak, RMS, clipping, silence, waveform', () => {
  const x = A.inspectSample(speechLike());
  assert.ok(Math.abs(x.duration - 3) < 0.01); assert.equal(x.sample_rate, 24000); assert.equal(x.channels, 1);
  assert.ok(x.peak_db < 0 && x.peak_db > -15); assert.ok(x.rms_db < x.peak_db);
  assert.equal(x.clip_percent, 0); assert.ok(x.silence_percent > 20 && x.silence_percent < 50, 'edge pauses are silence: ' + x.silence_percent);
  assert.equal(x.waveform.bins, 200); assert.equal(x.waveform.min.length, 200); assert.equal(x.waveform.max.length, 200);
  assert.ok(x.waveform.max.every(v => v >= -127 && v <= 127));
  assert.ok(Math.max(...x.waveform.max) > 20 && Math.max(...x.waveform.max.slice(0, 10)) < 10, 'envelope: quiet start, loud middle');
});

test('SNR is explicitly an estimate and lands near the synthetic truth', () => {
  const x = A.inspectSample(speechLike({ amp: 0.3, noise: 0.003 }));
  assert.equal(x.snr.estimate, true); assert.match(x.snr.method, /estimate/i);
  assert.ok(x.snr.db > 25 && x.snr.db < 55, 'clean clip: ' + x.snr.db);
  const noisy = A.inspectSample(speechLike({ amp: 0.1, noise: 0.05 }));
  assert.ok(noisy.snr.db < 15, 'noisy clip: ' + noisy.snr.db);
  assert.ok(A.inspectionWarnings(noisy).some(w => /signal-to-noise|noise/i.test(w) && /estimate/i.test(w)));
});

test('digital-silence floor gives no SNR number rather than an invented one', () => {
  const x = A.inspectSample(speechLike({ noise: 0 }));
  assert.equal(x.snr.db, null); assert.match(x.snr.note, /digital silence/i);
});

test('clipping, quietness, short length and heavy silence become actionable warnings', () => {
  const clipped = A.inspectSample(speechLike({ clip: true, amp: 0.3 }));
  assert.ok(clipped.clip_percent > 0.5); assert.ok(A.inspectionWarnings(clipped).some(w => /clip/i.test(w)));
  const quiet = A.inspectSample(speechLike({ amp: 0.004, noise: 0.0001 }));
  assert.ok(A.inspectionWarnings(quiet).some(w => /quiet/i.test(w)));
  const short = A.inspectSample(speechLike({ sec: 1.6, gapSec: 0.1 }));
  assert.ok(A.inspectionWarnings(short).some(w => /3 s|short/i.test(w)));
  const mostlySilent = A.inspectSample(speechLike({ sec: 6, gapSec: 2.4 }));
  assert.ok(A.inspectionWarnings(mostlySilent).some(w => /silence/i.test(w)));
  assert.deepEqual(A.inspectionWarnings(A.inspectSample(speechLike({ sec: 6, gapSec: 0.3 }))).filter(w => /clip|quiet|silence|short/i.test(w)), []);
});

test('heuristics are never presented as clone fidelity', () => {
  const x = A.inspectSample(speechLike());
  assert.equal('fidelity' in x, false); assert.equal('score' in x, false);
  assert.match(x.disclaimer, /not a measure of clone fidelity|human audition/i);
});
