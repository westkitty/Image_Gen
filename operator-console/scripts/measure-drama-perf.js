#!/usr/bin/env node
'use strict';
// Measures the streaming Drama assembly pipeline on a synthetic long programme: scene mixes → exact concat → loudness master → MP3 + chaptered M4B.
// Nothing here touches Big Mac, the network, the media library or any project; everything lives in one temp directory that is removed afterwards.
//
//   node scripts/measure-drama-perf.js [--minutes 60] [--scenes 12] [--keep]
//
// Peak RSS is sampled for the whole process TREE (this process + ffmpeg children). Intermediates are deleted as soon as the next stage no longer
// needs them so the run needs roughly 2 × the 24-bit master size in free disk; the script refuses to start without that headroom.
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const { execFileSync } = require('node:child_process');
const M = require('../drama-mixer'); const MB = require('../drama-master'); const T = require('../audio-tools');

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? Number(process.argv[i + 1]) : true); };
const MINUTES = Number(arg('minutes', 60)), SCENES = Number(arg('scenes', 12)), KEEP = arg('keep', false) === true;
const RATE = 48000, DUCK = { db: -12, attack_s: 0.05, release_s: 0.2, lookahead_s: 0.05 };
const mib = n => (n / 1048576).toFixed(0) + ' MiB';
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-perf-'));
const sceneFrames = Math.round(MINUTES * 60 * RATE / SCENES);
const masterBytes = MINUTES * 60 * RATE * 6;
const free = (() => { const s = fs.statfsSync(work); return s.bavail * s.bsize; })();
if (free < masterBytes * 2.6) { console.error(`refusing to run: ${mib(free)} free, need about ${mib(masterBytes * 2.6)} (two copies of the ${mib(masterBytes)} master plus encodes)`); fs.rmSync(work, { recursive: true, force: true }); process.exit(3); }

// process-tree RSS sampler
let peak = 0, peakMain = 0, sampler = null;
function sample() {
  try {
    const rows = execFileSync('ps', ['-axo', 'pid=,ppid=,rss='], { encoding: 'utf8' }).trim().split('\n').map(l => l.trim().split(/\s+/).map(Number));
    const kids = new Map(); for (const [pid, ppid, rss] of rows) { if (!kids.has(ppid)) kids.set(ppid, []); kids.get(ppid).push([pid, rss]); }
    let total = 0; const stack = [process.pid]; const rssOf = new Map(rows.map(r => [r[0], r[2]]));
    while (stack.length) { const p = stack.pop(); total += (rssOf.get(p) || 0) * 1024; for (const [c] of kids.get(p) || []) stack.push(c); }
    if (total > peak) peak = total;
  } catch (_) {}
  const main = process.memoryUsage().rss; if (main > peakMain) peakMain = main;
}

function writeF32(file, frames, fn) { const b = Buffer.alloc(frames * 8); for (let i = 0; i < frames; i++) { const v = fn(i); b.writeFloatLE(v, i * 8); b.writeFloatLE(v, i * 8 + 4); } fs.writeFileSync(file, b); return { file, frames }; }

(async () => {
  const stages = []; const stage = async (name, fn) => { const t0 = Date.now(), p0 = peak; const r = await fn(); stages.push({ name, s: (Date.now() - t0) / 1000, peak_rss_after: peak }); return r; };
  sampler = setInterval(sample, 250); sample();
  try {
    if (!T.available().ffmpeg) throw new Error('ffmpeg is required for the mastering/encode stages');
    // 3 s of "speech-like" tone (amplitude-modulated), re-used for every line; a 10 s looped bed
    const line = writeF32(path.join(work, 'line.f32'), 3 * RATE, i => 0.35 * Math.sin(2 * Math.PI * 220 * i / RATE) * (0.55 + 0.45 * Math.sin(2 * Math.PI * 4 * i / RATE)));
    const bed = writeF32(path.join(work, 'bed.f32'), 10 * RATE, i => 0.12 * Math.sin(2 * Math.PI * 110 * i / RATE));
    const sceneFiles = [];
    await stage(`mix ${SCENES} scenes`, async () => {
      for (let s = 0; s < SCENES; s++) {
        const clips = []; for (let at = RATE; at + line.frames < sceneFrames; at += 7 * RATE) clips.push({ kind: 'dialogue', file: line.file, start_frame: at, src_offset_frames: 0, frames: line.frames, gain: 1, fade_in_frames: 240, fade_out_frames: 240 });
        const cues = [{ role: 'music', file: bed.file, start_frame: 0, src_offset_frames: 0, frames: sceneFrames, loop: true, loop_frames: bed.frames, gain: 1, fade_in_frames: 2 * RATE, fade_out_frames: 2 * RATE, duck: true }];
        const out = path.join(work, `scene-${String(s).padStart(2, '0')}.wav`);
        const r = await M.renderScene({ rate: RATE, length_frames: sceneFrames, clips, cues, duck: DUCK }, { masterPath: out });
        sceneFiles.push({ scene_id: 'sc' + s, title: 'Scene ' + (s + 1), file: out, frames: r.frames, gap_after_frames: Math.round(0.8 * RATE), dialogue: [] });
      }
    });
    const builder = MB.createMasterBuilder({ workRoot: work });
    const concatPath = path.join(work, 'concat.wav');
    const cc = await stage('exact concat (bit-exact copy + gaps)', () => builder.concatScenes({ scenes: sceneFiles, outPath: concatPath }));
    for (const s of sceneFiles) fs.unlinkSync(s.file);
    const masterPath = path.join(work, 'master.wav');
    const rep = await stage('loudness master (measure → static gain → limiter if needed → re-measure)', () => builder.master(concatPath, masterPath, { preset: 'drama' }));
    fs.unlinkSync(concatPath);
    const outDir = path.join(work, 'out');
    const ex = await stage('export MP3 + chaptered M4B', () => builder.exportFormats(masterPath, { formats: ['mp3', 'm4b'], chapters: cc.chapters, title: 'Perf fixture', outDir }));
    const sizes = { master_wav: fs.statSync(masterPath).size, mp3: fs.statSync(path.join(outDir, 'drama.mp3')).size, m4b: fs.statSync(path.join(outDir, 'drama.m4b')).size };
    const probe = await T.probe(path.join(outDir, 'drama.m4b'));
    sample();
    const result = {
      measured_at: new Date().toISOString(), node: process.version, platform: `${os.platform()} ${os.arch()}`, ffmpeg: T.available().ffmpeg_version || undefined,
      programme: { minutes: MINUTES, scenes: SCENES, frames: cc.frames, duration_s: cc.frames / RATE, master_wav_bytes: sizes.master_wav },
      stages: stages.map(s => ({ stage: s.name, seconds: Math.round(s.s * 10) / 10 })), total_seconds: Math.round(stages.reduce((a, s) => a + s.s, 0) * 10) / 10,
      peak_rss_process_tree: mib(peak), peak_rss_node_only: mib(peakMain), peak_rss_bytes: peak,
      master: { applied: rep.applied, verified: rep.verified, before_lufs: rep.before && rep.before.integrated_lufs, after_lufs: rep.after && rep.after.integrated_lufs, after_true_peak_dbtp: rep.after && rep.after.true_peak_dbtp, limiter_engaged: rep.limiter_engaged },
      outputs: { sizes, m4b_chapters: (probe && probe.chapters && probe.chapters.length) || undefined, m4b_duration_s: probe && probe.duration },
      in_memory_equivalent: { float32_stereo_whole_programme: mib(cc.frames * 8), note: 'what a naive "decode everything then mix" implementation would need before any copy' },
    };
    console.log(JSON.stringify(result, null, 2));
  } finally {
    clearInterval(sampler);
    if (!KEEP) fs.rmSync(work, { recursive: true, force: true }); else console.error('kept ' + work);
  }
})().catch(e => { console.error('FAILED:', e && e.stack || e); process.exit(1); });
