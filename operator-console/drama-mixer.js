'use strict';

// Streaming scene mixer. Reads conformed float32 stereo 48 kHz sources by file offset, mixes one block at a time and
// writes a 24-bit stereo WAV (plus optional aligned stems) as it goes, so memory is bounded by the block size no matter
// how long the program is. One deterministic code path serves preview, scene masters and exports: block size never
// changes a single output byte.
//
//   dialogue  → fades, gain, exact-sample placement
//   cues      → music / ambience / sfx with trim, loop (5 ms seam ramps), fades, gain, optional dialogue ducking
//   ducking   → analytic: derived from the dialogue clip intervals (with look-ahead) and smoothed with attack/release
//
// Loudness/true-peak mastering is a separate, measured stage (drama-master.js); nothing here limits or normalises.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { sha256File } = require('./derived-store');

const BYTES_PER_FRAME = 8;               // float32 stereo (conformed sources)
const S24_FRAME = 6;                     // 24-bit stereo (already-mixed program, e.g. concatenated scene masters)
const SEAM = 240;                        // loop seam ramp (frames @ 48 kHz = 5 ms)

class DuckEnvelope {
  constructor(intervals, { db = -10, attack_s = 0.15, release_s = 0.6, lookahead_s = 0.15 } = {}, rate = 48000) {
    this.iv = intervals.slice().sort((a, b) => a[0] - b[0]); this.look = Math.round(lookahead_s * rate);
    this.duckGain = Math.pow(10, db / 20); this.aA = 1 - Math.exp(-1 / Math.max(1, attack_s * rate)); this.aR = 1 - Math.exp(-1 / Math.max(1, release_s * rate));
    this.g = 1; this.k = 0; this.next = 0;
  }
  process(startFrame, n, out) {
    if (startFrame !== this.next) throw new Error('DuckEnvelope must be processed sequentially');
    const iv = this.iv, look = this.look;
    for (let i = 0; i < n; i++) {
      const f = startFrame + i;
      while (this.k < iv.length && iv[this.k][1] <= f) this.k++;
      let active = false;
      for (let j = this.k; j < iv.length && iv[j][0] - look <= f; j++) if (iv[j][1] > f) { active = true; break; }
      const target = active ? this.duckGain : 1;
      this.g += (target - this.g) * (target < this.g ? this.aA : this.aR);
      out[i] = this.g;
    }
    this.next = startFrame + n;
  }
}

function wavHeader24(frames, rate, channels = 2) {
  const b = Buffer.alloc(44), bytes = frames * channels * 3;
  b.write('RIFF', 0, 'latin1'); b.writeUInt32LE(36 + bytes, 4); b.write('WAVE', 8, 'latin1'); b.write('fmt ', 12, 'latin1'); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(channels, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * channels * 3, 28); b.writeUInt16LE(channels * 3, 32); b.writeUInt16LE(24, 34); b.write('data', 36, 'latin1'); b.writeUInt32LE(bytes, 40);
  return b;
}
const MAX_FRAMES = Math.floor((0xffffffff - 44) / 6);       // classic WAV size limit (≈ 7.7 h of 48 kHz stereo 24-bit)

class WavWriter {
  constructor(file, rate) { this.file = file; this.rate = rate; this.fd = fs.openSync(file, 'w', 0o600); this.frames = 0; fs.writeSync(this.fd, wavHeader24(0, rate)); this.out = null; }
  write(left, right, n) {                                    // arrays of floats (interleaved stereo in `a`)
    if (!this.out || this.out.length < n * 6) this.out = Buffer.alloc(n * 6);
    const o = this.out; let p = 0;
    for (let i = 0; i < n * 2; i++) {
      let v = left[i]; v = v > 1 ? 1 : v < -1 ? -1 : v; const q = Math.round(v * 8388607);
      o[p++] = q & 255; o[p++] = (q >> 8) & 255; o[p++] = (q >> 16) & 255;
    }
    let w = 0; while (w < n * 6) w += fs.writeSync(this.fd, o, w, n * 6 - w);
    this.frames += n;
  }
  close() { fs.writeSync(this.fd, wavHeader24(this.frames, this.rate), 0, 44, 0); fs.fsyncSync(this.fd); fs.closeSync(this.fd); this.fd = null; }
  abort() { try { if (this.fd != null) fs.closeSync(this.fd); } catch (_) {} try { fs.unlinkSync(this.file); } catch (_) {} }
}

async function renderScene(spec, { masterPath, stemsDir = null, stemPrefix = 'stem', blockFrames = 48000, onProgress = null } = {}) {
  const rate = spec.rate || 48000, L = Math.round(spec.length_frames);
  if (!(L > 0)) throw new Error('scene has no length to render');
  if (L > MAX_FRAMES) throw new Error('program is longer than a single WAV can hold; render it in parts');
  const sources = [...(spec.clips || []).map(c => Object.assign({ role: 'dialogue' }, c, { kind: 'dialogue', role: 'dialogue' })), ...(spec.cues || []).map(c => Object.assign({}, c, { kind: 'cue' }))];
  for (const s of sources) {
    let st; try { st = fs.statSync(s.file); } catch (_) { throw new Error(`cannot read a source file for the mix (missing: ${path.basename(String(s.file))})`); }
    s.bpf = s.fmt === 's24' ? S24_FRAME : BYTES_PER_FRAME; s.byteOffset = s.fmt === 's24' ? Math.round(s.data_offset || 0) : 0;
    s.fileFrames = Math.floor((st.size - s.byteOffset) / s.bpf); s.frames = Math.max(0, Math.round(s.frames)); s.start_frame = Math.round(s.start_frame); s.src_offset_frames = Math.round(s.src_offset_frames || 0);
    s.end = s.start_frame + s.frames; s.loopLen = s.loop ? Math.max(1, Math.round(s.loop_frames || (s.fileFrames - s.src_offset_frames))) : 0;
    s.fi = Math.round(s.fade_in_frames || 0); s.fo = Math.round(s.fade_out_frames || 0); s.gain = s.gain == null ? 1 : s.gain; s.fd = null;
  }
  sources.sort((a, b) => a.start_frame - b.start_frame);
  const env = new DuckEnvelope(spec.duck_intervals || (spec.clips || []).map(c => [Math.round(c.start_frame), Math.round(c.start_frame) + Math.round(c.frames)]), spec.duck || {}, rate);
  const master = new WavWriter(masterPath, rate), stems = new Map();
  const wantStem = role => { if (!stemsDir) return null; if (!stems.has(role)) { fs.mkdirSync(stemsDir, { recursive: true }); stems.set(role, new WavWriter(path.join(stemsDir, `${stemPrefix}-${role}.wav`), rate)); } return stems.get(role); };
  const roles = [...new Set(sources.map(s => (s.kind === 'dialogue' ? 'dialogue' : s.role || 'music')))];
  if (stemsDir) { wantStem('dialogue'); for (const r of roles) wantStem(r); }
  const scratch = Buffer.alloc(blockFrames * BYTES_PER_FRAME + 64);
  const mixBuf = new Float32Array(blockFrames * 2), duck = new Float32Array(blockFrames), zeros = new Float32Array(blockFrames * 2);
  const bus = {}; const busFor = role => bus[role] || (bus[role] = new Float32Array(blockFrames * 2));
  let peak = 0, clipped = 0;
  try {
    for (let b0 = 0; b0 < L; b0 += blockFrames) {
      const n = Math.min(blockFrames, L - b0), b1 = b0 + n;
      for (const k of Object.keys(bus)) bus[k].fill(0, 0, n * 2);
      env.process(b0, n, duck);
      for (const s of sources) {
        if (s.start_frame >= b1 || s.end <= b0) { if (s.fd != null && s.end <= b0) { fs.closeSync(s.fd); s.fd = null; } continue; }
        if (s.fd == null) s.fd = fs.openSync(s.file, 'r');
        const role = s.kind === 'dialogue' ? 'dialogue' : (s.role || 'music'), dst = busFor(role);
        const from = Math.max(b0, s.start_frame), to = Math.min(b1, s.end);
        let f = from;
        while (f < to) {
          const p = f - s.start_frame;                                       // position inside the clip
          let srcFrame, take;
          if (s.loopLen) { const q = p % s.loopLen; srcFrame = s.src_offset_frames + q; take = Math.min(to - f, s.loopLen - q); }
          else { srcFrame = s.src_offset_frames + p; take = to - f; }
          const avail = Math.max(0, Math.min(take, s.fileFrames - srcFrame));
          if (avail > 0) { let got = 0; while (got < avail * s.bpf) { const r = fs.readSync(s.fd, scratch, got, avail * s.bpf - got, s.byteOffset + srcFrame * s.bpf + got); if (r <= 0) break; got += r; } if (got < avail * s.bpf) scratch.fill(0, got, avail * s.bpf); }
          for (let i = 0; i < take; i++) {
            if (i >= avail) continue;                                       // beyond the file: silence
            const pos = p + i; let g = s.gain;
            if (s.fi && pos < s.fi) g *= pos / s.fi;
            if (s.fo && pos >= s.frames - s.fo) g *= (s.frames - pos) / s.fo;
            if (s.loopLen > 2 * SEAM) { const q = pos % s.loopLen; if (q < SEAM) g *= q / SEAM; else if (q > s.loopLen - SEAM) g *= (s.loopLen - q) / SEAM; }
            if (s.kind === 'cue' && s.duck) g *= duck[f - b0 + i];
            const o = (f - b0 + i) * 2;
            if (s.bpf === S24_FRAME) { const bo = i * 6; dst[o] += (scratch.readIntLE(bo, 3) / 8388607) * g; dst[o + 1] += (scratch.readIntLE(bo + 3, 3) / 8388607) * g; }
            else { const bo = i * 8; dst[o] += scratch.readFloatLE(bo) * g; dst[o + 1] += scratch.readFloatLE(bo + 4) * g; }
          }
          f += take;
        }
      }
      mixBuf.fill(0, 0, n * 2);
      for (const k of Object.keys(bus)) { const a = bus[k]; for (let i = 0; i < n * 2; i++) mixBuf[i] += a[i]; const w = wantStem(k); if (w) w.write(a, null, n); }
      for (let i = 0; i < n * 2; i++) { const a = Math.abs(mixBuf[i]); if (a > peak) peak = a; if (a > 1) clipped++; }
      master.write(mixBuf, null, n);
      if (stemsDir) for (const [role, w] of stems) if (!bus[role]) w.write(zeros, null, n);
      if (onProgress) onProgress(b1, L);
      await new Promise(r => setImmediate(r));
    }
    master.close(); for (const w of stems.values()) w.close();
  } catch (e) { master.abort(); for (const w of stems.values()) w.abort(); throw e; }
  finally { for (const s of sources) if (s.fd != null) try { fs.closeSync(s.fd); } catch (_) {} }
  const out = { frames: L, duration_s: L / rate, peak, clipped_samples: clipped, bytes: 44 + L * 6, sha256: await sha256File(masterPath), sample_rate: rate, channels: 2, bits: 24, stems: {} };
  for (const [role, w] of stems) out.stems[role] = { path: w.file, bytes: 44 + L * 6, sha256: await sha256File(w.file) };
  return out;
}

module.exports = { renderScene, DuckEnvelope, WavWriter, wavHeader24, MAX_FRAMES, SEAM };
