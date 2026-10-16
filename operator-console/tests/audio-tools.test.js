'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const A = require('../voice-audio'); const T = require('../audio-tools');

const HAVE = T.available();
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dex-at-'));
const tone = (sec, hz = 220, amp = 0.3, rate = 24000) => { const n = Math.round(sec * rate), a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = amp * Math.sin(2 * Math.PI * hz * i / rate); return { sampleRate: rate, channels: [a] }; };
const wav = (a, name = 'a.wav') => { const f = path.join(tmp(), name); fs.writeFileSync(f, A.encodeWav(a)); return f; };
const opts = { skip: HAVE.ffmpeg && HAVE.ffprobe ? false : 'ffmpeg/ffprobe not installed' };

test('probe reports container, codec, rate, channels and duration', opts, async () => {
  const p = await T.probe(wav(tone(2)));
  assert.equal(p.codec, 'pcm_s16le'); assert.equal(p.sample_rate, 24000); assert.equal(p.channels, 1); assert.ok(Math.abs(p.duration - 2) < 0.01); assert.match(p.format, /wav/);
  await assert.rejects(T.probe(path.join(tmp(), 'missing.wav')), /probe failed|No such/i);
});

test('conform to raw float stereo 48 kHz: exact frame count, optional filter chain applied', opts, async () => {
  const out = path.join(tmp(), 'c.f32');
  const r = await T.conformToF32(wav(tone(1.5)), out);
  assert.equal(r.sample_rate, 48000); assert.equal(r.channels, 2); assert.ok(Math.abs(r.frames - 72000) <= 2, 'frames ' + r.frames); assert.equal(fs.statSync(out).size, r.frames * 8);
  const hp = path.join(tmp(), 'h.f32'); const h = await T.conformToF32(wav(tone(1, 50, 0.5)), hp, { filters: 'highpass=f=2000' });
  const buf = fs.readFileSync(hp); const f = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4); let pk = 0; for (let i = 0; i < f.length; i += 2) pk = Math.max(pk, Math.abs(f[i]));
  assert.ok(pk < 0.05, 'a 2 kHz high-pass removes a 50 Hz tone: ' + pk); assert.ok(h.frames > 0);
});

test('loudness is measured with BS.1770 (integrated LUFS + true peak), not an RMS stand-in', opts, async () => {
  const quiet = await T.measureLoudness(wav(tone(3, 440, 0.05))), loud = await T.measureLoudness(wav(tone(3, 440, 0.4)));
  assert.ok(Number.isFinite(quiet.integrated_lufs) && Number.isFinite(loud.integrated_lufs));
  assert.ok(Math.abs((loud.integrated_lufs - quiet.integrated_lufs) - 20 * Math.log10(8)) < 0.5, 'eight times the amplitude is +18 dB: ' + (loud.integrated_lufs - quiet.integrated_lufs));
  assert.ok(loud.true_peak_dbtp > -9 && loud.true_peak_dbtp < -7, 'true peak of a 0.4 sine ≈ -7.96 dBTP: ' + loud.true_peak_dbtp);
});

test('streaming WAV scan reports peak, clipping, non-finite samples and silence without loading the file', opts, async () => {
  const a = tone(2, 220, 1.5); const s = await T.scanWav(wav(a));
  assert.ok(s.clipped_samples > 0 && s.peak >= 0.999); assert.equal(s.non_finite, 0);
  const sil = await T.scanWav(wav({ sampleRate: 24000, channels: [new Float32Array(24000)] })); assert.equal(sil.peak, 0); assert.equal(sil.silent, true);
  const f32 = path.join(tmp(), 'f.wav'); const buf = Buffer.alloc(44 + 16); buf.write('RIFF', 0); buf.writeUInt32LE(36 + 16, 4); buf.write('WAVE', 8); buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(3, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(24000, 24); buf.writeUInt32LE(96000, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(32, 34); buf.write('data', 36); buf.writeUInt32LE(16, 40);
  buf.writeFloatLE(0.1, 44); buf.writeFloatLE(NaN, 48); buf.writeFloatLE(Infinity, 52); buf.writeFloatLE(-0.2, 56); fs.writeFileSync(f32, buf);
  const n = await T.scanWav(f32); assert.equal(n.non_finite, 2);
});

test('waveform peaks come from a streamed decode, bounded in size', opts, async () => {
  const pk = await T.peaks(wav(tone(3, 220, 0.5)), { bins: 120 });
  assert.equal(pk.bins, 120); assert.equal(pk.min.length, 120); assert.ok(Math.max(...pk.max) > 55 && Math.min(...pk.min) < -55); assert.ok(Math.abs(pk.duration - 3) < 0.05);
});

test('MP3 and M4B encode; M4B carries chapters; every output decodes and matches the source duration', opts, async () => {
  const src = wav(tone(4, 220, 0.3)); const dir = tmp();
  const mp3 = await T.encode(src, path.join(dir, 'o.mp3'), { format: 'mp3', bitrate: '128k' });
  assert.equal(mp3.codec, 'mp3'); assert.ok(Math.abs(mp3.duration - 4) < 0.15);
  const chapters = [{ title: 'Act One', start: 0, end: 1.5 }, { title: 'Act Two', start: 1.5, end: 4 }];
  const m4b = await T.encode(src, path.join(dir, 'o.m4b'), { format: 'm4b', bitrate: '96k', chapters, metadata: { title: 'Test Drama' } });
  assert.equal(m4b.codec, 'aac'); assert.equal(m4b.chapters.length, 2); assert.deepEqual(m4b.chapters.map(c => c.title), ['Act One', 'Act Two']);
  assert.ok(Math.abs(m4b.chapters[1].start - 1.5) < 0.01 && Math.abs(m4b.chapters[1].end - 4) < 0.05);
  assert.equal(fs.readFileSync(path.join(dir, 'o.m4b')).toString('latin1', 4, 12), 'ftypM4B ', 'audiobook brand');
  await T.decodeCheck(path.join(dir, 'o.mp3')); await T.decodeCheck(path.join(dir, 'o.m4b'));
  const m4a = await T.encode(src, path.join(dir, 'o.m4a'), { format: 'm4a' }); assert.equal(m4a.chapters.length, 0);
});

test('a failed or truncated encode never reports success', opts, async () => {
  await assert.rejects(T.encode(path.join(tmp(), 'nope.wav'), path.join(tmp(), 'o.mp3'), { format: 'mp3' }), /encode failed|No such|probe failed/i);
  const bad = path.join(tmp(), 'bad.mp3'); fs.writeFileSync(bad, Buffer.from('ID3\x03\x00\x00\x00\x00\x00\x00garbage'));
  await assert.rejects(T.decodeCheck(bad), /decode|invalid|failed/i);
  await assert.rejects(T.encode(wav(tone(1)), path.join(tmp(), 'o.xyz'), { format: 'xyz' }), /unsupported format/i);
});

test('atempo pacing runs for real and the result is verified by measured duration', opts, async () => {
  const src = wav(tone(4)); const out = path.join(tmp(), 'p.wav');
  const r = await T.timeStretch(src, out, 1.25);
  assert.ok(Math.abs(r.duration - 3.2) < 0.05, 'duration ' + r.duration); assert.equal(r.tempo, 1.25);
  await assert.rejects(T.timeStretch(src, out, 3), /outside the supported/i);
});
