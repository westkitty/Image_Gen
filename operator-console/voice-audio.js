'use strict';

// Pure-JS audio helpers for the voice-production layer (no ffmpeg, no native deps).
// Audio is held as { sampleRate, channels: [Float32Array, ...] } in [-1, 1].
//   parseWav / encodeWav   PCM8/16/24/32 + IEEE-float32 (incl. WAVE_FORMAT_EXTENSIBLE)
//   resample / toMono      linear-interpolation resampling and channel mixdown
//   analyze                duration, RMS/peak dBFS, clipping and silence ratios
//   normalize              peak or RMS targeting with a headroom ceiling
//   stitch                 trim edge silence, equal-power crossfade, boundary-typed gaps
//   mix                    place mono/stereo clips on a timeline with gain + fades (drama assembler)

function parseWav(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 44 || buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WAVE') throw new Error('not a RIFF/WAVE file');
  let p = 12, fmt = null, data = null;
  while (p + 8 <= buf.length) {
    const id = buf.toString('latin1', p, p + 4); let len = buf.readUInt32LE(p + 4);
    if (id === 'data') { len = Math.min(len, buf.length - p - 8); data = buf.slice(p + 8, p + 8 + len); break; }
    if (id === 'fmt ') {
      let tag = buf.readUInt16LE(p + 8); const channels = buf.readUInt16LE(p + 10), sampleRate = buf.readUInt32LE(p + 12), bits = buf.readUInt16LE(p + 22);
      if (tag === 0xfffe && len >= 40) tag = buf.readUInt16LE(p + 8 + 24);
      fmt = { tag, channels, sampleRate, bits };
    }
    p += 8 + len + (len % 2);
  }
  if (!fmt || !data) throw new Error('WAV has no fmt/data chunk');
  if (!(fmt.channels >= 1 && fmt.channels <= 8) || !(fmt.sampleRate >= 4000 && fmt.sampleRate <= 384000)) throw new Error('unsupported WAV header');
  const bytes = fmt.bits / 8, frames = Math.floor(data.length / (bytes * fmt.channels));
  if (frames <= 0) throw new Error('WAV has no audio frames');
  const channels = Array.from({ length: fmt.channels }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) for (let c = 0; c < fmt.channels; c++) {
    const o = (i * fmt.channels + c) * bytes; let v;
    if (fmt.tag === 3 && fmt.bits === 32) v = data.readFloatLE(o);
    else if (fmt.tag === 1 && fmt.bits === 16) v = data.readInt16LE(o) / 32768;
    else if (fmt.tag === 1 && fmt.bits === 24) v = data.readIntLE(o, 3) / 8388608;
    else if (fmt.tag === 1 && fmt.bits === 32) v = data.readInt32LE(o) / 2147483648;
    else if (fmt.tag === 1 && fmt.bits === 8) v = (data[o] - 128) / 128;
    else throw new Error(`unsupported WAV encoding (tag ${fmt.tag}, ${fmt.bits}-bit)`);
    channels[c][i] = v;
  }
  return { sampleRate: fmt.sampleRate, channels };
}

// Header-only WAV validation for files too large to decode in memory. Walks the chunk list inside `head`
// (the first bytes of the file) and checks the declared data chunk against the real file size.
function wavHeaderInfo(head, fileSize) {
  if (!Buffer.isBuffer(head) || head.length < 44 || head.toString('latin1', 0, 4) !== 'RIFF' || head.toString('latin1', 8, 12) !== 'WAVE') throw new Error('not a RIFF/WAVE file');
  let p = 12, fmt = null;
  while (p + 8 <= head.length) {
    const id = head.toString('latin1', p, p + 4), len = head.readUInt32LE(p + 4);
    if (id === 'fmt ' && p + 24 <= head.length) { let tag = head.readUInt16LE(p + 8); if (tag === 0xfffe && len >= 40) tag = head.readUInt16LE(p + 8 + 24); fmt = { tag, channels: head.readUInt16LE(p + 10), rate: head.readUInt32LE(p + 12), bits: head.readUInt16LE(p + 22) }; }
    if (id === 'data') {
      if (!fmt) throw new Error('WAV data chunk precedes its fmt chunk');
      const avail = fileSize - (p + 8), bytes = Math.min(len === 0xffffffff ? avail : len, avail), frameBytes = fmt.channels * fmt.bits / 8, frames = Math.floor(bytes / frameBytes);
      if (!(fmt.channels >= 1 && fmt.channels <= 8) || !(fmt.rate >= 4000 && fmt.rate <= 384000) || ![8, 16, 24, 32].includes(fmt.bits) || ![1, 3].includes(fmt.tag)) throw new Error('unsupported WAV header');
      if (frames <= 0) throw new Error('WAV has no audio frames');
      return { sampleRate: fmt.rate, channels: fmt.channels, bits: fmt.bits, tag: fmt.tag, frames, duration: frames / fmt.rate, dataOffset: p + 8, dataBytes: frames * frameBytes };
    }
    p += 8 + len + (len % 2);
  }
  throw new Error('WAV has no fmt/data chunk in its header');
}

function encodeWav(audio) {
  const ch = audio.channels.length, frames = audio.channels[0].length, bytes = 2;
  const out = Buffer.alloc(44 + frames * ch * bytes);
  out.write('RIFF', 0, 'latin1'); out.writeUInt32LE(36 + frames * ch * bytes, 4); out.write('WAVE', 8, 'latin1'); out.write('fmt ', 12, 'latin1');
  out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(ch, 22); out.writeUInt32LE(audio.sampleRate, 24);
  out.writeUInt32LE(audio.sampleRate * ch * bytes, 28); out.writeUInt16LE(ch * bytes, 32); out.writeUInt16LE(16, 34); out.write('data', 36, 'latin1'); out.writeUInt32LE(frames * ch * bytes, 40);
  let o = 44;
  for (let i = 0; i < frames; i++) for (let c = 0; c < ch; c++) { const s = Math.max(-1, Math.min(1, audio.channels[c][i])); out.writeInt16LE(Math.round(s < 0 ? s * 32768 : s * 32767), o); o += 2; }
  return out;
}

const frames = a => (a.channels[0] ? a.channels[0].length : 0);
const duration = a => frames(a) / a.sampleRate;
function silence(sampleRate, seconds, channels = 1) { const n = Math.max(0, Math.round(seconds * sampleRate)); return { sampleRate, channels: Array.from({ length: channels }, () => new Float32Array(n)) }; }

function toMono(a) {
  if (a.channels.length === 1) return a;
  const n = frames(a), m = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (const c of a.channels) s += c[i]; m[i] = s / a.channels.length; }
  return { sampleRate: a.sampleRate, channels: [m] };
}
function resample(a, rate) {
  if (a.sampleRate === rate) return a;
  const ratio = a.sampleRate / rate, n = Math.max(1, Math.round(frames(a) / ratio));
  const channels = a.channels.map(src => {
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = i * ratio, i0 = Math.floor(x), f = x - i0; out[i] = src[Math.min(i0, src.length - 1)] * (1 - f) + src[Math.min(i0 + 1, src.length - 1)] * f; }
    return out;
  });
  return { sampleRate: rate, channels };
}
function conform(a, rate, channels) { // match another clip's format
  let r = resample(a, rate);
  if (channels === 1) return toMono(r);
  if (r.channels.length === 1) return { sampleRate: rate, channels: Array.from({ length: channels }, () => r.channels[0]) };
  return r;
}

const db = x => (x > 0 ? 20 * Math.log10(x) : -Infinity);
function analyze(a, { silenceDb = -50, frameMs = 20 } = {}) {
  const m = toMono(a).channels[0], n = m.length;
  let sum = 0, peak = 0, clip = 0;
  for (let i = 0; i < n; i++) { const v = Math.abs(m[i]); sum += v * v; if (v > peak) peak = v; if (v >= 0.999) clip++; }
  const win = Math.max(1, Math.round(a.sampleRate * frameMs / 1000)); let quiet = 0, total = 0;
  for (let s = 0; s < n; s += win) { let e = 0; const end = Math.min(n, s + win); for (let i = s; i < end; i++) e += m[i] * m[i]; total++; if (db(Math.sqrt(e / (end - s))) < silenceDb) quiet++; }
  return { duration: n / a.sampleRate, sampleRate: a.sampleRate, channels: a.channels.length, rms: Math.sqrt(sum / Math.max(1, n)), rmsDb: db(Math.sqrt(sum / Math.max(1, n))), peak, peakDb: db(peak), clipRatio: clip / Math.max(1, n), silenceRatio: quiet / Math.max(1, total) };
}

// Scale so the peak hits targetPeakDb (default -1 dBFS); never boosts near-silence by more than maxGainDb.
function normalize(a, { targetPeakDb = -1, maxGainDb = 24 } = {}) {
  let peak = 0; for (const c of a.channels) for (let i = 0; i < c.length; i++) { const v = Math.abs(c[i]); if (v > peak) peak = v; }
  if (peak < 1e-5) return a;
  const gain = Math.min(Math.pow(10, targetPeakDb / 20) / peak, Math.pow(10, maxGainDb / 20));
  return gain === 1 ? a : { sampleRate: a.sampleRate, channels: a.channels.map(c => c.map(v => v * gain)) };
}
function applyGain(a, g) { return g === 1 ? a : { sampleRate: a.sampleRate, channels: a.channels.map(c => c.map(v => v * g)) }; }

// Trim leading/trailing digital near-silence, leaving `padMs` of context.
function trimSilence(a, { thresholdDb = -55, padMs = 12 } = {}) {
  const m = toMono(a).channels[0], th = Math.pow(10, thresholdDb / 20), pad = Math.round(a.sampleRate * padMs / 1000);
  let s = 0, e = m.length - 1;
  while (s < m.length && Math.abs(m[s]) < th) s++;
  while (e > s && Math.abs(m[e]) < th) e--;
  if (s >= e) return a;
  s = Math.max(0, s - pad); e = Math.min(m.length - 1, e + pad);
  return { sampleRate: a.sampleRate, channels: a.channels.map(c => c.slice(s, e + 1)) };
}
function concat(parts) {
  const rate = parts[0].sampleRate, ch = parts[0].channels.length, n = parts.reduce((s, p) => s + frames(p), 0);
  const out = Array.from({ length: ch }, () => new Float32Array(n)); let o = 0;
  for (const p of parts) { for (let c = 0; c < ch; c++) out[c].set(p.channels[c], o); o += frames(p); }
  return { sampleRate: rate, channels: out };
}
// Equal-power crossfade of `ms` between a's tail and b's head (shortened if clips are tiny).
function crossfade(a, b, ms) {
  const n = Math.min(Math.round(a.sampleRate * ms / 1000), frames(a) >> 1, frames(b) >> 1);
  if (n < 2) return concat([a, b]);
  const ch = a.channels.length, out = Array.from({ length: ch }, () => new Float32Array(frames(a) + frames(b) - n));
  for (let c = 0; c < ch; c++) {
    const A = a.channels[c], B = b.channels[c], O = out[c], la = A.length;
    O.set(A.subarray(0, la - n), 0);
    for (let i = 0; i < n; i++) { const t = (i + 0.5) / n; O[la - n + i] = A[la - n + i] * Math.cos(t * Math.PI / 2) + B[i] * Math.sin(t * Math.PI / 2); }
    O.set(B.subarray(n), la);
  }
  return { sampleRate: a.sampleRate, channels: out };
}

// Join TTS chunks into one clip. `gapsMs[i]` is the deliberate pause after chunk i
// (derived from the text boundary: paragraph/sentence/clause); 0 means join directly with a crossfade.
function stitch(chunks, { gapsMs = [], crossfadeMs = 25, trim = true, normalizeOutput = true } = {}) {
  if (!chunks.length) throw new Error('nothing to stitch');
  const rate = chunks[0].sampleRate;
  const parts = chunks.map(c => { let x = conform(c, rate, 1); if (trim) x = trimSilence(x); return x; });
  let acc = parts[0];
  for (let i = 1; i < parts.length; i++) {
    const gap = Number(gapsMs[i - 1]) || 0;
    acc = gap > 0 ? concat([acc, silence(rate, gap / 1000), parts[i]]) : crossfade(acc, parts[i], crossfadeMs);
  }
  return normalizeOutput ? normalize(acc) : acc;
}

// Timeline mix: items = [{ audio, startSec, gain=1, fadeInSec=0, fadeOutSec=0, trimStartSec=0, trimEndSec? }]
function mix(items, { sampleRate = 24000, channels = 2, normalizeOutput = true } = {}) {
  const placed = items.map(it => {
    let a = conform(it.audio, sampleRate, channels);
    if (it.trimStartSec || it.trimEndSec != null) { const s = Math.round((it.trimStartSec || 0) * sampleRate), e = it.trimEndSec != null ? Math.round(it.trimEndSec * sampleRate) : frames(a); a = { sampleRate, channels: a.channels.map(c => c.slice(Math.max(0, s), Math.max(s, Math.min(c.length, e)))) }; }
    const n = frames(a), fi = Math.round((it.fadeInSec || 0) * sampleRate), fo = Math.round((it.fadeOutSec || 0) * sampleRate), g = it.gain == null ? 1 : it.gain;
    const ch2 = a.channels.map(c => { const o = new Float32Array(n); for (let i = 0; i < n; i++) { let v = c[i] * g; if (fi && i < fi) v *= i / fi; if (fo && i >= n - fo) v *= (n - i) / fo; o[i] = v; } return o; });
    return { start: Math.round(it.startSec * sampleRate), channels: ch2, n };
  });
  const total = placed.reduce((m, p) => Math.max(m, p.start + p.n), 0);
  const out = Array.from({ length: channels }, () => new Float32Array(total));
  for (const p of placed) for (let c = 0; c < channels; c++) { const O = out[c], S = p.channels[c]; for (let i = 0; i < p.n; i++) O[p.start + i] += S[i]; }
  const res = { sampleRate, channels: out };
  return normalizeOutput ? normalize(res, { targetPeakDb: -1 }) : res;
}


// ── Reference-sample inspection (DexSpeak-style) ─────────────────────────────────────────
// Objective measurements to help a human decide whether a clip is a good clone reference. These are signal
// diagnostics only: none of them measures how faithfully a model will reproduce a voice.
function frameRmsDb(mono, rate, ms = 20) {
  const win = Math.max(1, Math.round(rate * ms / 1000)), out = [];
  for (let s = 0; s < mono.length; s += win) { let e = 0; const end = Math.min(mono.length, s + win); for (let i = s; i < end; i++) e += mono[i] * mono[i]; out.push(db(Math.sqrt(e / (end - s)))); }
  return out;
}
function inspectSample(a, { bins = 200 } = {}) {
  const base = analyze(a), mono = toMono(a).channels[0], n = mono.length;
  const wmin = new Array(bins).fill(0), wmax = new Array(bins).fill(0);
  for (let b = 0; b < bins; b++) {
    const s = Math.floor(b * n / bins), e = Math.max(s + 1, Math.floor((b + 1) * n / bins)); let lo = 0, hi = 0;
    for (let i = s; i < e && i < n; i++) { if (mono[i] < lo) lo = mono[i]; if (mono[i] > hi) hi = mono[i]; }
    wmin[b] = Math.round(Math.max(-1, lo) * 127); wmax[b] = Math.round(Math.min(1, hi) * 127);
  }
  const frames = frameRmsDb(mono, a.sampleRate).map(x => (Number.isFinite(x) ? x : -120)).sort((x, y) => x - y);
  const med = arr => arr.length ? arr[Math.floor(arr.length / 2)] : null;
  const noise = med(frames.slice(0, Math.max(1, Math.floor(frames.length * 0.1)))), speech = med(frames.slice(Math.floor(frames.length * 0.7)));
  const snr = { estimate: true, method: 'estimate: median RMS of the loudest 30% of 20 ms frames minus the median RMS of the quietest 10%', db: null, noise_floor_db: noise == null ? null : +noise.toFixed(1), speech_level_db: speech == null ? null : +speech.toFixed(1), note: null };
  if (noise == null || noise < -85) snr.note = 'the quietest passages are digital silence, so a noise floor cannot be estimated';
  else if (speech - noise < 3) snr.note = 'no pauses or level variation to separate speech from background, so a noise floor cannot be estimated';
  else snr.db = +(speech - noise).toFixed(1);
  let dc = 0; for (let i = 0; i < n; i++) dc += mono[i]; dc /= Math.max(1, n);
  return {
    duration: +base.duration.toFixed(3), sample_rate: a.sampleRate, channels: a.channels.length,
    peak_db: Number.isFinite(base.peakDb) ? +base.peakDb.toFixed(1) : -120, rms_db: Number.isFinite(base.rmsDb) ? +base.rmsDb.toFixed(1) : -120,
    clip_percent: +(base.clipRatio * 100).toFixed(3), silence_percent: +(base.silenceRatio * 100).toFixed(1), dc_offset: +dc.toFixed(5), snr,
    waveform: { bins, min: wmin, max: wmax },
    disclaimer: 'Signal diagnostics only. These numbers are not a measure of clone fidelity; audition the cloned voice and decide by listening (human audition approval).',
  };
}
function inspectionWarnings(x, { minSeconds = 3, maxSeconds = 30 } = {}) {
  const w = [];
  if (x.duration < minSeconds) w.push(`only ${x.duration.toFixed(1)} s long; clones are unreliable under ${minSeconds} s (short)`);
  if (x.duration > maxSeconds) w.push(`${x.duration.toFixed(0)} s is long; ${maxSeconds} s or less clones more reliably`);
  if (x.clip_percent > 0.5) w.push(`clipping in ${x.clip_percent.toFixed(1)}% of samples; re-record or lower the input level`);
  if (x.rms_db < -40) w.push(`very quiet (RMS ${x.rms_db.toFixed(0)} dBFS); the voice may be dominated by noise`);
  if (x.silence_percent > 50) w.push(`${Math.round(x.silence_percent)}% of the clip is silence; trim it to the speech`);
  if (x.snr && x.snr.db != null && x.snr.db < 15) w.push(`estimated signal-to-noise ratio is only ${x.snr.db.toFixed(0)} dB (estimate); background noise may be cloned too`);
  if (Math.abs(x.dc_offset) > 0.02) w.push('noticeable DC offset; the recording chain may be faulty');
  return w;
}

module.exports = { wavHeaderInfo, inspectSample, inspectionWarnings, frameRmsDb, parseWav, encodeWav, frames, duration, silence, toMono, resample, conform, analyze, normalize, applyGain, trimSilence, concat, crossfade, stitch, mix };
