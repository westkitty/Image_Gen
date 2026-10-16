'use strict';

// Programme assembly, mastering and delivery encoding. All file-backed and streamed: nothing here holds a programme in memory.
//
//   concatScenes   scene masters + exact gap frames → one pre-master (bit-exact copy; a streaming mix pass only when project-wide cues exist)
//   master         measured BS.1770 loudness → static gain to the delivery target, true-peak limiter only if the ceiling would be exceeded → re-measured
//   exportFormats  MP3 / M4B (scene chapters) / M4A encoded from the VERIFIED master (speech is never re-rendered per format)
//   concatStems    per-role stems laid out with the same gaps so they align with the master

const fs = require('fs');
const os = require('os');
const path = require('path');
const A = require('./voice-audio');
const Mixer = require('./drama-mixer');
const Tools = require('./audio-tools');

const PRESETS = {
  drama: { label: 'Drama', lufs: -18, tp: -1.5, compress: false },
  podcast: { label: 'Podcast', lufs: -16, tp: -1.5, compress: false },
  audiobook: { label: 'Audiobook', lufs: -20, tp: -3, compress: true },
  broadcast: { label: 'Broadcast (EBU R128)', lufs: -23, tp: -1, compress: false },
  archive: { label: 'Archive (no loudness change)', lufs: null, tp: null, compress: false },
};
function resolvePreset(cfg = {}) {
  const base = PRESETS[cfg.preset || 'drama']; if (!base) throw new Error('unknown mastering preset ' + cfg.preset);
  const lufs = cfg.target_lufs !== undefined ? cfg.target_lufs : base.lufs, tp = cfg.ceiling_dbtp !== undefined ? cfg.ceiling_dbtp : base.tp;
  if (lufs != null && !(lufs >= -40 && lufs <= -6)) throw new Error('target loudness must be between -40 and -6 LUFS');
  if (tp != null && !(tp >= -9 && tp <= 0)) throw new Error('true-peak ceiling must be between -9 and 0 dBTP');
  return { preset: cfg.preset || 'drama', label: base.label, lufs, tp, compress: cfg.compress !== undefined ? !!cfg.compress : base.compress };
}
const lin = db => Math.pow(10, db / 20);
const r2 = n => Math.round(n * 100) / 100;

function createMasterBuilder({ tools = Tools, mixer = Mixer, workRoot = os.tmpdir() } = {}) {
  const need24 = file => {
    const fd = fs.openSync(file, 'r');
    try {
      const head = Buffer.alloc(Math.min(65536, fs.fstatSync(fd).size)); fs.readSync(fd, head, 0, head.length, 0);
      const h = A.wavHeaderInfo(head, fs.statSync(file).size);
      if (h.tag !== 1 || h.bits !== 24 || h.channels !== 2 || h.sampleRate !== 48000) throw new Error('scene masters must be 24-bit stereo 48 kHz PCM');
      return h;
    } finally { fs.closeSync(fd); }
  };
  function copyBytes(srcFile, offset, bytes, outFd) {
    const fd = fs.openSync(srcFile, 'r'), buf = Buffer.alloc(1 << 20);
    try { let pos = offset, left = bytes; while (left > 0) { const n = fs.readSync(fd, buf, 0, Math.min(buf.length, left), pos); if (n <= 0) throw new Error('scene master ended early'); let w = 0; while (w < n) w += fs.writeSync(outFd, buf, w, n - w); pos += n; left -= n; } } finally { fs.closeSync(fd); }
  }
  function writeSilence(outFd, frames) { const buf = Buffer.alloc(6 * 48000); let left = frames; while (left > 0) { const n = Math.min(left, 48000); let w = 0; while (w < n * 6) w += fs.writeSync(outFd, buf, w, n * 6 - w); left -= n; } }

  async function concatScenes({ scenes, outPath, projectCues = [], duck = {} }) {
    if (!scenes.length) throw new Error('nothing to assemble');
    const heads = scenes.map(s => need24(s.file));
    const raw = projectCues.length ? outPath + '.concat.wav' : outPath;
    const fd = fs.openSync(raw, 'w', 0o600); let t = 0; const chapters = [], intervals = [];
    try {
      fs.writeSync(fd, Mixer.wavHeader24(0, 48000));
      scenes.forEach((s, i) => {
        const frames = s.frames != null ? s.frames : heads[i].frames; if (frames > heads[i].frames) throw new Error(`scene ${s.scene_id}: declared length exceeds its master`);
        copyBytes(s.file, heads[i].dataOffset, frames * 6, fd);
        chapters.push({ scene_id: s.scene_id, title: s.title || s.scene_id, start_s: t / 48000, end_s: (t + frames) / 48000 });
        for (const [a, b] of s.dialogue || []) intervals.push([t + a, t + b]);
        t += frames;
        const gap = Math.max(0, Math.round(s.gap_after_frames || 0)); if (gap && i < scenes.length - 1) { writeSilence(fd, gap); t += gap; }
      });
      fs.writeSync(fd, Mixer.wavHeader24(t, 48000), 0, 44, 0); fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    if (!projectCues.length) return { frames: t, chapters, path: outPath, cues_mixed: 0 };
    try {
      const r = await mixer.renderScene({ rate: 48000, length_frames: t, clips: [{ kind: 'dialogue', fmt: 's24', file: raw, data_offset: 44, start_frame: 0, src_offset_frames: 0, frames: t, gain: 1 }], duck_intervals: intervals,
        cues: projectCues, duck }, { masterPath: outPath });
      return { frames: r.frames, chapters, path: outPath, cues_mixed: projectCues.length, peak: r.peak, clipped_samples: r.clipped_samples };
    } finally { try { fs.unlinkSync(raw); } catch (_) {} }
  }

  // Measured, verified mastering. Never reports "applied" unless the result was re-measured.
  async function master(inPath, outPath, cfg = {}) {
    const c = resolvePreset(cfg), report = { preset: c.preset, label: c.label, target_lufs: c.lufs, ceiling_dbtp: c.tp, compress: c.compress, applied: false, limiter_engaged: false, gain_db: 0, method: 'ffmpeg loudnorm measurement (ITU-R BS.1770-4 / EBU R128) + static gain' };
    let before; try { before = await tools.measureLoudness(inPath); } catch (e) { before = null; report.measure_error = e.message; }
    report.before = before;
    const passthrough = reason => { fs.copyFileSync(inPath, outPath); return Object.assign(report, { applied: false, reason, path: outPath, after: before, verified: true }); };
    if (c.lufs == null) return passthrough('archive preset: loudness is left exactly as mixed (no loudness change applied)');
    if (!before || before.integrated_lufs == null) return passthrough('the programme is silent or too short to measure loudness, so no mastering gain was applied');
    let work = inPath, tmpC = null, lufs = before.integrated_lufs, tp = before.true_peak_dbtp;
    try {
      if (c.compress) {
        tmpC = outPath + '.comp.wav';
        await tools.run('ffmpeg', ['-v', 'error', '-y', '-i', inPath, '-af', 'acompressor=threshold=0.063:ratio=2:attack=20:release=250:makeup=1', '-c:a', 'pcm_s24le', '-fflags', '+bitexact', '-flags:a', '+bitexact', tmpC]);
        const m = await tools.measureLoudness(tmpC); work = tmpC; lufs = m.integrated_lufs; tp = m.true_peak_dbtp; report.compression = 'gentle 2:1 compressor applied before gain';
      }
      const gain = Math.max(-20, Math.min(20, c.lufs - lufs)); report.gain_db = r2(gain); report.gain_clamped = Math.abs(c.lufs - lufs) > 20;
      let engaged = tp + gain > c.tp, margin = 0.5, after, tries = 0;
      for (;;) {
        const af = [`volume=${r2(gain)}dB`]; if (engaged) af.push(`alimiter=limit=${lin(c.tp - margin).toFixed(4)}:attack=5:release=60:level=disabled`);
        await tools.run('ffmpeg', ['-v', 'error', '-y', '-i', work, '-af', af.join(','), '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s24le', '-fflags', '+bitexact', '-flags:a', '+bitexact', outPath + '.partial.wav']);
        after = await tools.measureLoudness(outPath + '.partial.wav');
        if (after.true_peak_dbtp <= c.tp + 0.2) break;                 // inter-sample overshoot: engage/tighten the limiter and measure again
        if (++tries >= 3) throw new Error(`mastering could not hold the ${c.tp} dBTP ceiling (measured ${after.true_peak_dbtp})`);
        engaged = true; margin += 1;
      }
      report.limiter_engaged = engaged;
      fs.renameSync(outPath + '.partial.wav', outPath);
      report.after = after; report.applied = true; report.path = outPath;
      report.verified = after.true_peak_dbtp <= c.tp + 0.3 && (report.limiter_engaged || report.gain_clamped || Math.abs(after.integrated_lufs - c.lufs) <= 0.5);
      if (!report.verified) throw new Error(`mastering verification failed: ${after.integrated_lufs} LUFS / ${after.true_peak_dbtp} dBTP against ${c.lufs} / ${c.tp}`);
      return report;
    } finally { if (tmpC) try { fs.unlinkSync(tmpC); } catch (_) {} try { fs.unlinkSync(outPath + '.partial.wav'); } catch (_) {} }
  }

  async function exportFormats(masterPath, { formats, chapters = [], title = 'Audio drama', outDir, basename = 'drama', artist = null }) {
    fs.mkdirSync(outDir, { recursive: true }); const out = {};
    for (const fmt of formats) {
      if (!Tools.FORMATS[fmt]) throw new Error('unsupported format ' + fmt);
      const dest = path.join(outDir, `${basename}.${fmt}`);
      const info = await tools.encode(masterPath, dest, { format: fmt, chapters: fmt === 'm4b' ? chapters.map(c => ({ title: c.title, start: c.start_s, end: c.end_s })) : [], metadata: Object.assign({ title }, artist ? { artist } : {}) });
      out[fmt] = { path: dest, duration: info.duration, bytes: info.bytes, codec: info.codec, chapters: info.chapters, sample_rate: info.sample_rate, channels: info.channels };
    }
    return out;
  }

  async function concatStems({ scenes, outDir, basename = 'stem' }) {
    fs.mkdirSync(outDir, { recursive: true });
    const roles = [...new Set(scenes.flatMap(s => Object.keys(s.stems || {})))], out = {};
    for (const role of roles) {
      const dest = path.join(outDir, `${basename}-${role}.wav`), fd = fs.openSync(dest, 'w', 0o600); let t = 0;
      try {
        fs.writeSync(fd, Mixer.wavHeader24(0, 48000));
        scenes.forEach((s, i) => {
          const f = s.stems && s.stems[role];
          if (f) { const h = need24(f); copyBytes(f, h.dataOffset, s.frames * 6, fd); } else writeSilence(fd, s.frames);
          t += s.frames; const gap = Math.max(0, Math.round(s.gap_after_frames || 0)); if (gap && i < scenes.length - 1) { writeSilence(fd, gap); t += gap; }
        });
        fs.writeSync(fd, Mixer.wavHeader24(t, 48000), 0, 44, 0); fs.fsyncSync(fd);
      } finally { fs.closeSync(fd); }
      out[role] = { path: dest, frames: t };
    }
    return out;
  }
  return { concatScenes, master, exportFormats, concatStems };
}

module.exports = { createMasterBuilder, resolvePreset, PRESETS };
