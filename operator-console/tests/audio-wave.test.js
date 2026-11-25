'use strict';
// The waveform must be the file's own samples: exact envelope, right moment, and no invented sound.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { analyse, columns, levelAt, isBright } = require('../public/dexdiffusion/audio-wave.js');

const RATE = 22050;
// 0-2 s at 0.8, 2-4 s silence, 4-6 s at 0.4
const signal = Float32Array.from({ length: RATE * 6 }, (_, i) => { const t = i / RATE; return (t < 2 ? 0.8 : t < 4 ? 0 : 0.4) * Math.sin(2 * Math.PI * 440 * t); });
const track = analyse([signal], RATE);

test('the envelope is the true minimum and maximum of every bucket', () => {
  const size = Math.round(RATE / track.perSecond);
  for (const b of [0, 17, 900, 1500, 3000]) {
    const part = signal.subarray(b * size, (b + 1) * size);
    assert.ok(track.max[b] === Math.max(0, ...part) && track.min[b] === Math.min(0, ...part), 'bucket ' + b);
  }
  assert.ok(Math.abs(track.peak - 0.8) < 0.005);
});

test('the playhead column shows the sound at that moment, in proportion', () => {
  const centre = t => { const c = columns(track, t, 800); let hi = 0, lo = 0; for (let x = 396; x < 404; x++) { hi = Math.max(hi, c.hi[x]); lo = Math.min(lo, c.lo[x]); } return [hi, lo]; };
  assert.ok(centre(1)[0] > 0.97 && centre(1)[1] < -0.97, 'loud passage reaches the file peak');
  assert.deepEqual(centre(3), [0, 0], 'silence is flat');
  assert.ok(Math.abs(centre(5)[0] - 0.5) < 0.02, 'half the amplitude draws half the height');
});

test('time runs left to right and everything outside the file is flat', () => {
  const c = columns(track, 2, 800);                 // window 0-4 s: sound on the left half, silence on the right
  assert.ok(c.hi[200] > 0.9); assert.equal(c.hi[600], 0);
  const start = columns(track, 0, 800);             // window -2-2 s
  assert.equal(start.hi[100], 0); assert.ok(start.hi[700] > 0.9);
  const end = columns(track, 6, 800);               // window 4-8 s
  assert.ok(end.hi[100] > 0.4); assert.equal(end.hi[700], 0);
});

test('the flicker level follows loudness at the playhead', () => {
  assert.ok(levelAt(track, 1) > 0.95); assert.equal(levelAt(track, 3), 0); assert.ok(Math.abs(levelAt(track, 5) - 0.5) < 0.05);
  assert.equal(levelAt(track, 99), 0);
});

test('every channel counts, and a silent file stays silent', () => {
  const right = analyse([new Float32Array(RATE), signal.subarray(0, RATE)], RATE);
  assert.ok(columns(right, 0.5, 100).hi[50] > 0.9, 'sound in the second channel only');
  const silent = analyse([new Float32Array(RATE)], RATE);
  assert.equal(levelAt(silent, 0.5), 0); assert.ok(columns(silent, 0.5, 100).hi.every(v => v === 0));
});

test('bright text is whites and oranges, not muted greys, blues or reds', () => {
  for (const c of ['rgb(255, 255, 255)', 'rgb(238, 234, 248)', 'rgb(203, 213, 225)', 'rgb(245, 158, 11)', 'rgb(251, 146, 60)', 'rgb(249, 115, 22)']) assert.equal(isBright(c), true, c);
  for (const c of ['rgb(148, 163, 184)', 'rgb(100, 116, 139)', 'rgb(56, 189, 248)', 'rgb(239, 68, 68)', 'rgb(9, 13, 22)', 'rgba(255, 255, 255, 0.2)', '']) assert.equal(isBright(c), false, c);
});
