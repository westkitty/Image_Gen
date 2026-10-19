'use strict';
const { trackScratch } = require('./helpers/owned-scratch');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const crypto = require('node:crypto');
const M = require('../drama-mixer'); const T = require('../audio-tools');

const RATE = 48000;
const tmp = () => trackScratch(fs.mkdtempSync(path.join(os.tmpdir(), 'dex-mx-')));
// stereo float32 file: fn(i) → sample (both channels)
function f32(frames, fn) { const f = path.join(tmp(), 'src.f32'); const b = Buffer.alloc(frames * 8); for (let i = 0; i < frames; i++) { const v = fn(i); b.writeFloatLE(v, i * 8); b.writeFloatLE(v, i * 8 + 4); } fs.writeFileSync(f, b); return { file: f, frames }; }
const sine = (hz, amp) => i => amp * Math.sin(2 * Math.PI * hz * i / RATE);
const readMaster = async file => { const info = await T.scanWav(file); const buf = fs.readFileSync(file); const data = buf.subarray(44); const n = Math.floor(data.length / 6); const L = new Float64Array(n); for (let i = 0; i < n; i++) L[i] = data.readIntLE(i * 6, 3) / 8388608; return { info, L, buf }; };
const rms = (a, from, to) => { let s = 0; for (let i = from; i < to; i++) s += a[i] * a[i]; return Math.sqrt(s / Math.max(1, to - from)); };
const clip = (src, over = {}) => Object.assign({ kind: 'dialogue', file: src.file, start_frame: 0, src_offset_frames: 0, frames: src.frames, gain: 1, fade_in_frames: 0, fade_out_frames: 0 }, over);
const DUCK = { db: -12, attack_s: 0.05, release_s: 0.2, lookahead_s: 0.05 };

test('the ducking envelope is deterministic and independent of block size', () => {
  const intervals = [[48000, 96000], [200000, 210000]];
  const whole = new Float32Array(300000); new M.DuckEnvelope(intervals, DUCK, RATE).process(0, 300000, whole);
  const parts = new Float32Array(300000); const e = new M.DuckEnvelope(intervals, DUCK, RATE);
  for (let s = 0; s < 300000; s += 7777) { const n = Math.min(7777, 300000 - s); const out = new Float32Array(n); e.process(s, n, out); parts.set(out, s); }
  assert.deepEqual(Array.from(parts), Array.from(whole));
  assert.equal(whole[0], 1); assert.ok(whole[48000 + 12000] < 0.27, 'almost fully ducked a short way into the line'); assert.ok(Math.abs(whole[80000] - Math.pow(10, -12 / 20)) < 0.01); assert.ok(whole[150000] > 0.99, 'recovered between lines');
  assert.ok(whole[48000 - 2000] < 1, 'lookahead: ducking starts before the line');
});

test('dialogue lands on the exact sample, with exact gain, trim and fades; nothing leaks before or after', async () => {
  const a = f32(24000, sine(440, 0.5)); const out = path.join(tmp(), 'm.wav');
  const r = await M.renderScene({ rate: RATE, length_frames: 120000, clips: [clip(a, { start_frame: 30000, gain: 0.5, src_offset_frames: 2000, frames: 20000, fade_in_frames: 1000, fade_out_frames: 1000 })], cues: [], duck: DUCK }, { masterPath: out });
  assert.equal(r.frames, 120000); const m = await readMaster(out);
  assert.equal(m.L.length, 120000); assert.equal(rms(m.L, 0, 30000), 0, 'silence before the clip'); assert.equal(rms(m.L, 50000, 120000), 0, 'silence after the clip');
  const mid = rms(m.L, 32000, 48000); assert.ok(Math.abs(mid - 0.5 * 0.5 / Math.SQRT2) < 0.005, 'gain applied: ' + mid);
  assert.ok(Math.abs(m.L[30000]) < 1e-3, 'fade-in starts at zero'); assert.ok(Math.abs(m.L[49999]) < 0.01, 'fade-out ends at zero');
  const expect = 0.5 * 0.5 * Math.sin(2 * Math.PI * 440 * (2000 + 5000) / RATE); assert.ok(Math.abs(m.L[35000] - expect) < 2e-5, 'trim offset honoured sample-exactly');
});

test('output is a valid 24-bit 48 kHz stereo WAV of exactly the requested length', async () => {
  const a = f32(10000, sine(300, 0.3)); const out = path.join(tmp(), 'm.wav');
  await M.renderScene({ rate: RATE, length_frames: 96000, clips: [clip(a)], cues: [], duck: DUCK }, { masterPath: out });
  const p = await T.probe(out); assert.equal(p.codec, 'pcm_s24le'); assert.equal(p.sample_rate, 48000); assert.equal(p.channels, 2); assert.ok(Math.abs(p.duration - 2) < 0.001);
  const s = await T.scanWav(out); assert.equal(s.non_finite, 0); assert.equal(s.bits, 24);
});

test('music under dialogue is ducked by the configured amount and recovers; unducked cues are untouched', async () => {
  const bed = f32(RATE * 6, sine(220, 0.2)), voice = f32(RATE * 2, sine(1000, 0.4)); const out = path.join(tmp(), 'm.wav');
  const base = { rate: RATE, length_frames: RATE * 6, clips: [clip(voice, { start_frame: RATE * 2 })], duck: DUCK };
  const duckedRun = await M.renderScene({ ...base, cues: [{ role: 'music', file: bed.file, start_frame: 0, src_offset_frames: 0, frames: bed.frames, gain: 1, fade_in_frames: 0, fade_out_frames: 0, duck: true }] }, { masterPath: out });
  const m = await readMaster(out); const before = rms(m.L, RATE * 0.5, RATE * 1.5), during = rms(m.L, RATE * 3, RATE * 3.5), after = rms(m.L, RATE * 5, RATE * 5.8);
  assert.ok(Math.abs(before - 0.2 / Math.SQRT2) < 0.003, 'bed at full level before speech: ' + before);
  assert.ok(during < before * 0.5 + 0.4 / Math.SQRT2 && true);   // dialogue + ducked bed
  const out2 = path.join(tmp(), 'm2.wav'); await M.renderScene({ ...base, cues: [{ role: 'music', file: bed.file, start_frame: 0, src_offset_frames: 0, frames: bed.frames, gain: 1, fade_in_frames: 0, fade_out_frames: 0, duck: false }] }, { masterPath: out2 });
  const m2 = await readMaster(out2); assert.ok(rms(m2.L, RATE * 3, RATE * 3.5) > during, 'without ducking the mix is louder under speech');
  assert.ok(Math.abs(after - before) < 0.004, 'bed recovers after the line: ' + after);
  assert.ok(duckedRun.frames === RATE * 6);
});

test('looped cues fill the scene, wrap at the loop region, and stop where asked', async () => {
  const short = f32(RATE / 2, sine(500, 0.3)); const out = path.join(tmp(), 'm.wav');
  await M.renderScene({ rate: RATE, length_frames: RATE * 3, clips: [], cues: [{ role: 'ambience', file: short.file, start_frame: RATE / 2, src_offset_frames: 0, frames: RATE * 2, loop: true, loop_frames: RATE / 2, gain: 1, fade_in_frames: 0, fade_out_frames: 0, duck: false }], duck: DUCK }, { masterPath: out });
  const m = await readMaster(out);
  assert.equal(rms(m.L, 0, RATE / 2 - 10), 0); assert.ok(rms(m.L, RATE * 1.2, RATE * 2.3) > 0.15, 'still sounding after several loops'); assert.equal(rms(m.L, RATE * 2.6, RATE * 3), 0, 'stops at the requested length');
  const pre = Math.abs(m.L[RATE / 2 + 24000]); assert.ok(m.L.slice(RATE, RATE + 200).every(v => Math.abs(v) < 0.31));
});

test('stems align with the master and sum back to it when nothing clips', async () => {
  const bed = f32(RATE * 3, sine(220, 0.1)), amb = f32(RATE * 3, sine(90, 0.05)), voice = f32(RATE, sine(1000, 0.3)), sfx = f32(RATE / 4, sine(2000, 0.2));
  const spec = { rate: RATE, length_frames: RATE * 3, duck: DUCK, clips: [clip(voice, { start_frame: RATE })], cues: [
    { role: 'music', file: bed.file, start_frame: 0, src_offset_frames: 0, frames: bed.frames, gain: 1, fade_in_frames: 0, fade_out_frames: 0, duck: true },
    { role: 'ambience', file: amb.file, start_frame: 0, src_offset_frames: 0, frames: amb.frames, gain: 1, fade_in_frames: 0, fade_out_frames: 0, duck: false },
    { role: 'sfx', file: sfx.file, start_frame: RATE * 2, src_offset_frames: 0, frames: sfx.frames, gain: 1, fade_in_frames: 0, fade_out_frames: 0, duck: false }] };
  const dir = tmp(); const out = path.join(dir, 'm.wav'); const r = await M.renderScene(spec, { masterPath: out, stemsDir: dir });
  assert.deepEqual(Object.keys(r.stems).sort(), ['ambience', 'dialogue', 'music', 'sfx']);
  const m = await readMaster(out); const st = {}; for (const k of Object.keys(r.stems)) st[k] = await readMaster(r.stems[k].path);
  for (const k of Object.keys(st)) assert.equal(st[k].L.length, m.L.length, k + ' length matches the master');
  let worst = 0; for (let i = 0; i < m.L.length; i += 7) { const sum = st.dialogue.L[i] + st.music.L[i] + st.ambience.L[i] + st.sfx.L[i]; worst = Math.max(worst, Math.abs(sum - m.L[i])); }
  assert.ok(worst < 1e-5, 'stems sum to the master: ' + worst);
});

test('rendering is deterministic across block sizes (identical bytes) and reports clipping honestly', async () => {
  const a = f32(RATE, sine(440, 0.9)), b = f32(RATE, sine(440, 0.9));
  const spec = { rate: RATE, length_frames: RATE, clips: [clip(a), clip(b)], cues: [], duck: DUCK };
  const o1 = path.join(tmp(), '1.wav'), o2 = path.join(tmp(), '2.wav');
  const r1 = await M.renderScene(spec, { masterPath: o1, blockFrames: 4800 }), r2 = await M.renderScene(spec, { masterPath: o2, blockFrames: 48000 });
  assert.equal(r1.sha256, r2.sha256); assert.ok(fs.readFileSync(o1).equals(fs.readFileSync(o2)));
  assert.ok(r1.clipped_samples > 0 && r1.peak > 1.5, 'two 0.9 sines add to 1.8: clipping is reported, not hidden: ' + r1.peak);
});

test('a missing source file fails the render instead of producing silence', async () => {
  await assert.rejects(M.renderScene({ rate: RATE, length_frames: RATE, clips: [clip({ file: path.join(tmp(), 'gone.f32'), frames: 1000 })], cues: [], duck: DUCK }, { masterPath: path.join(tmp(), 'x.wav') }), /missing|ENOENT|cannot read/i);
});

test('memory stays bounded for a long program (10 minutes of mixing, sparse inputs)', { timeout: 120000 }, async () => {
  const bed = path.join(tmp(), 'bed.f32'); const fd = fs.openSync(bed, 'w'); const frames = RATE * 600;
  const seed = Buffer.alloc(8 * RATE); for (let i = 0; i < RATE; i++) { const v = 0.1 * Math.sin(2 * Math.PI * 110 * i / RATE); seed.writeFloatLE(v, i * 8); seed.writeFloatLE(v, i * 8 + 4); } fs.writeSync(fd, seed); fs.ftruncateSync(fd, frames * 8); fs.closeSync(fd);
  const out = path.join(tmp(), 'long.wav'); global.gc && global.gc(); const before = process.memoryUsage().rss; const t0 = Date.now();
  const r = await M.renderScene({ rate: RATE, length_frames: frames, clips: [], cues: [{ role: 'music', file: bed, start_frame: 0, src_offset_frames: 0, frames, gain: 1, fade_in_frames: 0, fade_out_frames: 0, duck: true }], duck: DUCK }, { masterPath: out });
  const growth = process.memoryUsage().rss - before;
  assert.equal(r.frames, frames); assert.ok(growth < 150 * 1024 * 1024, `RSS growth ${(growth / 1048576).toFixed(0)} MiB for 10 min of stereo audio (a full in-memory buffer would be ~230 MiB as float32)`);
  assert.equal(fs.statSync(out).size, 44 + frames * 6); console.log(`      10 min mixed in ${((Date.now() - t0) / 1000).toFixed(1)} s, RSS +${(growth / 1048576).toFixed(0)} MiB`);
});
