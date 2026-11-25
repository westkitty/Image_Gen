'use strict';
// The waveform must be the file's own samples: exact envelope, right moment, and no invented sound.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseWav, samples, strip, levelAt, isBright, WINDOW_S, BUCKETS, LEVELS } = require('../public/dexdiffusion/audio-wave.js');

const RATE = 22050, FRAMES = RATE * WINDOW_S;
// First strip: 0-2 s at 0.8, 2-4 s silence. Second, shorter: 4-6 s at 0.4.
const value = t => (t < 2 ? 0.8 : t < 4 ? 0 : 0.4) * Math.sin(2 * Math.PI * 440 * t);
const first = Float32Array.from({ length: FRAMES }, (_, i) => value(i / RATE));
const second = Float32Array.from({ length: RATE * 2 }, (_, i) => value(4 + i / RATE));
const a = strip(first, 1, FRAMES), b = strip(second, 1, FRAMES);

// A WAV file of the given kind holding `frames` frames of [left, right].
function wavFile({ bits = 16, float = false, extensible = false, junk = 0, frames }) {
  const block = 2 * bits / 8, fmt = extensible ? 40 : 16, data = Buffer.alloc(frames.length * block);
  frames.forEach((f, i) => f.forEach((v, c) => {
    const at = i * block + c * bits / 8;
    if (float) data.writeFloatLE(v, at);
    else if (bits === 8) data.writeUInt8(Math.round(v * 127) + 128, at);
    else data.writeIntLE(Math.round(v * (2 ** (bits - 1) - 1)), at, bits / 8);
  }));
  const chunk = (id, body) => { const h = Buffer.alloc(8); h.write(id, 0); h.writeUInt32LE(body.length, 4); return Buffer.concat([h, body, Buffer.alloc(body.length & 1)]); };
  const f = Buffer.alloc(fmt);
  f.writeUInt16LE(extensible ? 0xFFFE : float ? 3 : 1, 0); f.writeUInt16LE(2, 2); f.writeUInt32LE(48000, 4); f.writeUInt32LE(48000 * block, 8); f.writeUInt16LE(block, 12); f.writeUInt16LE(bits, 14);
  if (extensible) f.writeUInt16LE(float ? 3 : 1, 24);
  const body = Buffer.concat([chunk('fmt ', f), ...(junk ? [chunk('LIST', Buffer.alloc(junk))] : []), chunk('data', data)]), head = Buffer.alloc(12);
  head.write('RIFF', 0); head.writeUInt32LE(4 + body.length, 4); head.write('WAVE', 8);
  const file = Buffer.concat([head, body]);
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.length);
}

test('the envelope is the true minimum and maximum of every column', () => {
  for (const c of [0, 17, 300, 639, 640, 900, 1279]) {
    const part = first.subarray(Math.floor(c * FRAMES / BUCKETS), Math.ceil((c + 1) * FRAMES / BUCKETS));
    assert.ok(a.max[c] === Math.max(0, ...part) && a.min[c] === Math.min(0, ...part), 'column ' + c);
  }
  assert.ok(Math.abs(a.peak - 0.8) < 0.005 && Math.abs(b.peak - 0.4) < 0.005);
});

test('time runs left to right, and everything past the end of the file is flat', () => {
  assert.ok(Math.max(...a.max.subarray(300, 310)) > 0.78, 'the loud half is on the left');
  assert.equal(Math.max(...a.max.subarray(642)), 0); assert.equal(Math.min(...a.min.subarray(642)), 0);
  assert.ok(Math.max(...b.max.subarray(300, 310)) > 0.38); assert.equal(Math.max(...b.max.subarray(642)), 0, 'the file ends halfway through this strip');
});

test('the level follows the sound at the playhead and silence is zero', () => {
  assert.ok(levelAt(a, a.loud, 1) > 0.95); assert.equal(levelAt(a, a.loud, 3), 0);
  assert.ok(Math.abs(levelAt(b, a.loud, 5) - 0.5) < 0.04, 'measured against the loudest passage of the file');
  assert.equal(levelAt(null, 1, 1), 0); assert.equal(levelAt(strip(new Float32Array(FRAMES), 1, FRAMES), 0, 1), 0, 'a silent file never flickers');
  assert.equal(a.rms.length, LEVELS);
});

test('every PCM layout the studio can meet decodes to the same passage, and other files are refused', () => {
  const frames = Array.from({ length: 4800 }, (_, i) => [0.5 * Math.sin(i / 20), 0.25 * Math.sin(i / 20)]), bytes = [];
  for (const kind of [{ bits: 8 }, { bits: 16 }, { bits: 24 }, { bits: 32 }, { bits: 32, float: true }, { bits: 16, extensible: true }, { bits: 24, junk: 71 }]) {
    const file = wavFile({ ...kind, frames }), wav = parseWav(file), label = JSON.stringify(kind);
    assert.ok(wav && wav.channels === 2 && wav.rate === 48000, label);
    const part = samples(file.slice(wav.dataAt, wav.dataAt + wav.dataBytes), wav), s = strip(part.data, 2, 4800, part.scale);
    assert.ok(Math.abs(s.peak - 0.5) < 0.012, label + ' peak ' + s.peak);
    bytes.push(wav.dataBytes);
  }
  assert.deepEqual(bytes, [9600, 19200, 28800, 38400, 38400, 19200, 28800]);
  for (const bad of [new ArrayBuffer(10), wavFile({ frames }).slice(0, 30), Buffer.from('ID3'.padEnd(200, '.')).buffer.slice(0, 200)]) assert.equal(parseWav(bad), null);
});

test('a half-read frame at the end of a span is ignored', () => {
  const wav = { float: false, bits: 16, block: 4, channels: 2 };
  assert.equal(samples(new ArrayBuffer(4 * 10 + 3), wav).data.length, 20);
});

test('sound in the second channel only still shows', () => {
  const stereo = new Float32Array(FRAMES * 2);
  for (let i = 0; i < FRAMES; i++) stereo[2 * i + 1] = first[i];
  const s = strip(stereo, 2, FRAMES);
  assert.deepEqual([s.max[300], s.min[300]], [a.max[300], a.min[300]]);
});

test('bright text is whites and oranges, not muted greys, blues or reds', () => {
  for (const c of ['rgb(255, 255, 255)', 'rgb(238, 234, 248)', 'rgb(203, 213, 225)', 'rgb(245, 158, 11)', 'rgb(251, 146, 60)', 'rgb(249, 115, 22)']) assert.equal(isBright(c), true, c);
  for (const c of ['rgb(148, 163, 184)', 'rgb(100, 116, 139)', 'rgb(56, 189, 248)', 'rgb(239, 68, 68)', 'rgb(9, 13, 22)', 'rgba(255, 255, 255, 0.2)', '']) assert.equal(isBright(c), false, c);
});
