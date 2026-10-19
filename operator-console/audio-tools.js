'use strict';

// Thin, honest wrappers around the local FFmpeg/ffprobe. Everything here verifies its own result (probe after encode,
// decode check, measured duration after time-stretch) so a failed or partial operation can never be reported as success.
// File-backed and streaming: nothing here loads a whole program into memory.

const fs = require('fs');
const path = require('path');
const { execFile, execFileSync, spawn, spawnSync } = require('child_process');

let cached = null;
function available() {
  if (cached) return cached;
  const has = (cmd, args) => { try { const r = spawnSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: 10000 }); return r.status === 0 ? String(r.stdout || '') + String(r.stderr || '') : null; } catch (_) { return null; } };
  const v = has('ffmpeg', ['-version']), p = has('ffprobe', ['-version']), rb = has('rubberband', ['--version']);
  cached = { ffmpeg: !!v, ffprobe: !!p, version: v ? (/ffmpeg version (\S+)/.exec(v) || [])[1] || null : null,
    rubberband: !!rb, rubberband_version: rb ? (/(?:Rubber Band\s+)?(\d+\.\d+(?:\.\d+)?)/.exec(rb) || [])[1] || null : null };
  return cached;
}

function run(cmd, args, { timeout = 10 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' }, (err, stdout, stderr) => {
      if (err) { const e = new Error(`${cmd} failed: ${String(stderr || err.message).trim().split('\n').slice(-3).join(' | ').slice(0, 300)}`); e.stderr = stderr; e.code = err.code; return reject(e); }
      resolve({ stdout, stderr });
    });
  });
}

async function probe(file) {
  let out;
  try { out = (await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', '-show_chapters', file], { timeout: 60000 })).stdout; }
  catch (e) { throw new Error('probe failed: ' + e.message.replace(/^ffprobe failed: /, '')); }
  const j = JSON.parse(out || '{}'), s = (j.streams || []).find(x => x.codec_type === 'audio') || {}, f = j.format || {};
  return {
    format: f.format_name || null, duration: Number(f.duration) || Number(s.duration) || 0, size: Number(f.size) || 0, bit_rate: Number(f.bit_rate) || 0,
    codec: s.codec_name || null, sample_rate: Number(s.sample_rate) || 0, channels: Number(s.channels) || 0, tags: f.tags || {},
    chapters: (j.chapters || []).map(c => ({ title: (c.tags && c.tags.title) || '', start: Number(c.start_time), end: Number(c.end_time) })),
  };
}

// Raw little-endian float32 stereo @ 48 kHz (the mixer's working format). filters: optional -af chain applied first.
async function conformToF32(src, dest, { filters = null, rate = 48000 } = {}) {
  const args = ['-v', 'error', '-y', '-i', src, '-vn'];
  if (filters) args.push('-af', filters);
  args.push('-ac', '2', '-ar', String(rate), '-f', 'f32le', dest + '.partial');
  await run('ffmpeg', args);
  fs.renameSync(dest + '.partial', dest);
  const size = fs.statSync(dest).size;
  if (size < 8) throw new Error('conform produced no audio');
  return { frames: size / 8, sample_rate: rate, channels: 2 };
}

async function filterToWav(src, dest, filters) {
  if (!filters || typeof filters !== 'string') throw new Error('a concrete FFmpeg filter chain is required');
  const tmp = dest + '.partial.wav';
  try {
    await run('ffmpeg', ['-v', 'error', '-y', '-i', src, '-vn', '-af', filters, '-c:a', 'pcm_s24le', tmp]);
    const out = await probe(tmp);
    if (!(out.duration > 0) || !out.channels || !out.sample_rate) throw new Error('FX filter produced an invalid WAV');
    fs.renameSync(tmp, dest); return { duration: out.duration, sample_rate: out.sample_rate, channels: out.channels };
  } finally { try { fs.rmSync(tmp, { force: true }); } catch (_) {} }
}

// Formant-preserving pitch change using the local Rubber Band CLI. The source is converted to a
// temporary WAV first, and only the newly derived output is written.
async function formantPitch(src, dest, semitones) {
  const n = Number(semitones);
  if (!Number.isFinite(n) || n < -12 || n > 12) throw new Error('formant-preserving pitch must be between -12 and +12 semitones');
  if (!available().rubberband) throw new Error('formant-preserving pitch is unavailable: Rubber Band CLI was not detected');
  const before = await probe(src), normalized = dest + '.input.wav', partial = dest + '.partial.wav';
  try {
    await run('ffmpeg', ['-v', 'error', '-y', '-i', src, '-vn', '-c:a', 'pcm_s24le', normalized]);
    await run('rubberband', ['--fine', '--formant', '--pitch', String(n), normalized, partial]);
    const after = await probe(partial), scan = await scanWav(partial);
    if (!(after.duration > 0) || !Number.isFinite(scan.peak) || scan.non_finite || scan.silent) throw new Error('formant-preserving pitch produced invalid or silent audio');
    if (Math.abs(after.duration - before.duration) > Math.max(0.08, before.duration * 0.03)) throw new Error('formant-preserving pitch changed duration beyond tolerance');
    fs.renameSync(partial, dest);
    return { duration: after.duration, sample_rate: after.sample_rate, channels: after.channels,
      method: `Rubber Band ${available().rubberband_version || 'unknown'} R3 --formant --pitch ${n}`, formant_preserved: true };
  } finally { for (const file of [normalized, partial]) try { fs.rmSync(file, { force: true }); } catch (_) {} }
}

async function measureLoudness(file, { target = -16, truePeak = -1.5 } = {}) {
  const { stderr } = await run('ffmpeg', ['-hide_banner', '-nostats', '-v', 'info', '-i', file, '-vn', '-af', `loudnorm=I=${target}:TP=${truePeak}:LRA=11:print_format=json`, '-f', 'null', '-']);
  const m = /\{[^{}]*"input_i"[^{}]*\}/s.exec(stderr);
  if (!m) throw new Error('loudness measurement produced no result');
  const j = JSON.parse(m[0]), num = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };
  return { integrated_lufs: num(j.input_i), true_peak_dbtp: num(j.input_tp), lra: num(j.input_lra), threshold: num(j.input_thresh), method: 'ffmpeg loudnorm (ITU-R BS.1770-4 / EBU R128 measurement pass)' };
}

// Streaming WAV statistics: bounded memory for any length. Handles PCM 8/16/24/32 and IEEE float32.
function scanWav(file) {
  return new Promise((resolve, reject) => {
    const fd = fs.openSync(file, 'r');
    try {
      const head = Buffer.alloc(Math.min(65536, fs.fstatSync(fd).size)); fs.readSync(fd, head, 0, head.length, 0);
      if (head.toString('latin1', 0, 4) !== 'RIFF' || head.toString('latin1', 8, 12) !== 'WAVE') throw new Error('not a RIFF/WAVE file');
      let p = 12, fmt = null, dataAt = null, dataLen = 0;
      while (p + 8 <= head.length) {
        const id = head.toString('latin1', p, p + 4), len = head.readUInt32LE(p + 4);
        if (id === 'fmt ') { let tag = head.readUInt16LE(p + 8); if (tag === 0xfffe && len >= 40) tag = head.readUInt16LE(p + 8 + 24); fmt = { tag, channels: head.readUInt16LE(p + 10), rate: head.readUInt32LE(p + 12), bits: head.readUInt16LE(p + 22) }; }
        if (id === 'data') { dataAt = p + 8; dataLen = len; break; }
        p += 8 + len + (len % 2);
      }
      if (!fmt || dataAt == null) throw new Error('WAV has no fmt/data chunk');
      const total = fs.fstatSync(fd).size; if (dataLen === 0xffffffff || dataAt + dataLen > total) dataLen = total - dataAt;
      const bytes = fmt.bits / 8, frameBytes = bytes * fmt.channels, frames = Math.floor(dataLen / frameBytes);
      const stats = { frames, duration: frames / fmt.rate, sample_rate: fmt.rate, channels: fmt.channels, bits: fmt.bits, format: fmt.tag === 3 ? 'float' : 'pcm', peak: 0, clipped_samples: 0, non_finite: 0, sumsq: 0, sum: 0, samples: 0 };
      const CH = 1 << 20, buf = Buffer.alloc(CH - (CH % frameBytes));
      let pos = dataAt, left = frames * frameBytes;
      const readSample = (b, o) => {
        if (fmt.tag === 3 && fmt.bits === 32) return b.readFloatLE(o);
        if (fmt.tag === 1 && fmt.bits === 16) return b.readInt16LE(o) / 32768;
        if (fmt.tag === 1 && fmt.bits === 24) return b.readIntLE(o, 3) / 8388608;
        if (fmt.tag === 1 && fmt.bits === 32) return b.readInt32LE(o) / 2147483648;
        if (fmt.tag === 1 && fmt.bits === 8) return (b[o] - 128) / 128;
        throw new Error(`unsupported WAV encoding (tag ${fmt.tag}, ${fmt.bits}-bit)`);
      };
      while (left > 0) {
        const n = fs.readSync(fd, buf, 0, Math.min(buf.length, left), pos); if (n <= 0) break; pos += n; left -= n;
        for (let o = 0; o + bytes <= n; o += bytes) {
          const v = readSample(buf, o);
          if (!Number.isFinite(v)) { stats.non_finite++; continue; }
          const a = Math.abs(v); if (a > stats.peak) stats.peak = a; if (a >= 0.999) stats.clipped_samples++;
          stats.sumsq += v * v; stats.sum += v; stats.samples++;
        }
      }
      const db = x => (x > 0 ? 20 * Math.log10(x) : -Infinity);
      resolve({ frames, duration: stats.duration, sample_rate: fmt.rate, channels: fmt.channels, bits: fmt.bits, format: stats.format, peak: stats.peak, peak_db: db(stats.peak), rms_db: db(Math.sqrt(stats.sumsq / Math.max(1, stats.samples))),
        clipped_samples: stats.clipped_samples, clip_percent: stats.samples ? stats.clipped_samples / stats.samples * 100 : 0, non_finite: stats.non_finite, dc: stats.samples ? stats.sum / stats.samples : 0, silent: stats.peak < 1e-5 });
    } catch (e) { reject(e); } finally { fs.closeSync(fd); }
  });
}

// Waveform peaks (int8 min/max per bin) from a streamed 8 kHz mono decode: no full-program decode in memory.
async function peaks(file, { bins = 800 } = {}) {
  const info = await probe(file), total = Math.max(1, Math.round(info.duration * 8000));
  const min = new Array(bins).fill(0), max = new Array(bins).fill(0);
  await new Promise((resolve, reject) => {
    const cp = spawn('ffmpeg', ['-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '8000', '-f', 'f32le', '-'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let idx = 0, carry = Buffer.alloc(0), err = '';
    cp.stderr.on('data', d => { err += d; });
    cp.stdout.on('data', chunk => {
      const buf = carry.length ? Buffer.concat([carry, chunk]) : chunk, n = Math.floor(buf.length / 4);
      for (let i = 0; i < n; i++, idx++) {
        const v = buf.readFloatLE(i * 4), b = Math.min(bins - 1, Math.floor(idx * bins / total)), q = Math.round(Math.max(-1, Math.min(1, v)) * 127);
        if (q < min[b]) min[b] = q; if (q > max[b]) max[b] = q;
      }
      carry = buf.subarray(n * 4);
    });
    cp.on('error', reject);
    cp.on('close', code => (code === 0 ? resolve() : reject(new Error('peak extraction failed: ' + err.trim().slice(-200)))));
  });
  return { bins, min, max, duration: info.duration };
}

const esc = s => String(s).replace(/[=;#\\\n]/g, m => (m === '\n' ? '\\\n' : '\\' + m));
function chapterMetadata(chapters, meta = {}) {
  let out = ';FFMETADATA1\n';
  for (const [k, v] of Object.entries(meta)) if (v) out += `${k}=${esc(v)}\n`;
  for (const c of chapters || []) out += `[CHAPTER]\nTIMEBASE=1/1000\nSTART=${Math.round(c.start * 1000)}\nEND=${Math.round(c.end * 1000)}\ntitle=${esc(c.title)}\n`;
  return out;
}
const FORMATS = {
  mp3: { codec: ['-c:a', 'libmp3lame'], mux: ['-f', 'mp3'], br: '192k' },
  m4a: { codec: ['-c:a', 'aac'], mux: ['-f', 'ipod'], br: '128k' },
  m4b: { codec: ['-c:a', 'aac'], mux: ['-f', 'ipod'], br: '96k' },
  flac: { codec: ['-c:a', 'flac'], mux: ['-f', 'flac'], br: null },
};
async function encode(src, dest, { format, bitrate = null, chapters = [], metadata = {} } = {}) {
  const f = FORMATS[format]; if (!f) throw new Error('unsupported format ' + format);
  const srcInfo = await probe(src);
  const tmp = dest.replace(/(\.[A-Za-z0-9]+)$/, '.partial$1'), metaFile = dest + '.meta.txt';   // keep the extension: the ipod muxer picks the M4B/M4A brand from it
  const args = ['-v', 'error', '-y', '-i', src];
  const wantMeta = (chapters && chapters.length) || Object.keys(metadata).length;
  if (wantMeta) { fs.writeFileSync(metaFile, chapterMetadata(chapters, metadata)); args.push('-i', metaFile, '-map_metadata', '1', '-map_chapters', '1'); }
  args.push('-map', '0:a:0', '-vn', ...f.codec);
  if (f.br || bitrate) args.push('-b:a', bitrate || f.br);
  if (format === 'm4a' || format === 'm4b') args.push('-movflags', '+faststart');
  args.push(...f.mux, tmp);
  try {
    try { await run('ffmpeg', args); } catch (e) { throw new Error('encode failed: ' + e.message.replace(/^ffmpeg failed: /, '')); }
    if (format === 'm4b') setMp4Brand(tmp, 'M4B ');
    const info = await probe(tmp);
    if (!(info.duration > 0) || Math.abs(info.duration - srcInfo.duration) > Math.max(0.25, srcInfo.duration * 0.005)) throw new Error(`encode failed: output duration ${info.duration.toFixed(2)} s does not match the source ${srcInfo.duration.toFixed(2)} s`);
    await decodeCheck(tmp);
    if ((chapters || []).length && info.chapters.length !== chapters.length) throw new Error(`encode failed: expected ${chapters.length} chapters, found ${info.chapters.length}`);
    fs.renameSync(tmp, dest);
    return Object.assign(await probe(dest), { source_duration: srcInfo.duration, bytes: fs.statSync(dest).size });
  } finally { for (const x of [tmp, metaFile]) try { fs.unlinkSync(x); } catch (_) {} }
}

// FFmpeg's ipod muxer always writes the M4A brand; an audiobook is the same container with the M4B brand.
function setMp4Brand(file, brand) {
  const fd = fs.openSync(file, 'r+');
  try {
    const head = Buffer.alloc(128); fs.readSync(fd, head, 0, 128, 0);
    if (head.toString('latin1', 4, 8) !== 'ftyp') throw new Error('not an MP4 container');
    const size = head.readUInt32BE(0); if (size < 16 || size > 128) throw new Error('unexpected ftyp box');
    head.write(brand, 8, 'latin1');
    for (let o = 16; o + 4 <= size; o += 4) if (head.toString('latin1', o, o + 4) === 'M4A ') head.write(brand, o, 'latin1');
    fs.writeSync(fd, head, 0, size, 0);
  } finally { fs.closeSync(fd); }
}

async function decodeCheck(file) {
  let r;
  try { r = await run('ffmpeg', ['-v', 'error', '-i', file, '-f', 'null', '-']); } catch (e) { throw new Error('decode failed: ' + e.message.replace(/^ffmpeg failed: /, '')); }
  if (String(r.stderr || '').trim()) throw new Error('decode failed: ' + r.stderr.trim().split('\n')[0].slice(0, 200));
  return true;
}

// Pitch-preserving tempo change (atempo). Verified by measuring the result, never assumed.
const TEMPO_MIN = 0.5, TEMPO_MAX = 2.0;
async function timeStretch(src, dest, tempo) {
  if (!(tempo >= TEMPO_MIN && tempo <= TEMPO_MAX)) throw new Error(`tempo ${tempo} is outside the supported ${TEMPO_MIN}-${TEMPO_MAX} range`);
  const before = await probe(src), tmp = dest + '.partial.wav';
  try {
    try { await run('ffmpeg', ['-v', 'error', '-y', '-i', src, '-vn', '-af', `atempo=${tempo}`, '-c:a', 'pcm_s16le', '-f', 'wav', tmp]); } catch (e) { throw new Error('time-stretch failed: ' + e.message); }
    const after = await probe(tmp), expect = before.duration / tempo;
    if (Math.abs(after.duration - expect) > Math.max(0.03, expect * 0.01)) throw new Error(`time-stretch failed: expected ${expect.toFixed(2)} s, measured ${after.duration.toFixed(2)} s`);
    fs.renameSync(tmp, dest);
    return { tempo, duration: after.duration, source_duration: before.duration, sample_rate: after.sample_rate, channels: after.channels };
  } finally { try { fs.unlinkSync(tmp); } catch (_) {} }
}

module.exports = { available, run, probe, conformToF32, filterToWav, formantPitch, measureLoudness, scanWav, peaks, encode, decodeCheck, timeStretch, chapterMetadata, TEMPO_MIN, TEMPO_MAX, FORMATS };
