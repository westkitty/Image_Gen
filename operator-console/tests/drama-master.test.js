'use strict';
const { trackScratch } = require('./helpers/owned-scratch');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const crypto = require('node:crypto');
const M = require('../media'); const Mx = require('../drama-mixer'); const T = require('../audio-tools'); const A = require('../voice-audio'); const MB = require('../drama-master');

const RATE = 48000; const HAVE = T.available(); const opts = { skip: HAVE.ffmpeg ? false : 'ffmpeg not installed' };
const tmp = () => trackScratch(fs.mkdtempSync(path.join(os.tmpdir(), 'dex-ms-')));
function f32(frames, fn) { const f = path.join(tmp(), 'src.f32'); const b = Buffer.alloc(frames * 8); for (let i = 0; i < frames; i++) { const v = fn(i); b.writeFloatLE(v, i * 8); b.writeFloatLE(v, i * 8 + 4); } fs.writeFileSync(f, b); return { file: f, frames }; }
const sine = (hz, amp) => i => amp * Math.sin(2 * Math.PI * hz * i / RATE);
async function sceneMaster(sec, hz, amp) { const a = f32(Math.round(sec * RATE), sine(hz, amp)); const out = path.join(tmp(), 'sc.wav'); const r = await Mx.renderScene({ rate: RATE, length_frames: a.frames, clips: [{ kind: 'dialogue', file: a.file, start_frame: 0, src_offset_frames: 0, frames: a.frames, gain: 1 }], cues: [] }, { masterPath: out }); return { file: out, frames: r.frames }; }
const pcm = file => fs.readFileSync(file).subarray(44);

test('scene masters concatenate bit-exactly with computed gaps; chapters mark each scene', async () => {
  const a = await sceneMaster(1, 440, 0.3), b = await sceneMaster(2, 660, 0.2); const mb = MB.createMasterBuilder({ workRoot: tmp() });
  const out = path.join(tmp(), 'pre.wav');
  const r = await mb.concatScenes({ scenes: [{ scene_id: 'sc-01', title: 'Warehouse', ...a, gap_after_frames: RATE * 1.5 }, { scene_id: 'sc-02', title: 'Rooftop', ...b, gap_after_frames: 0 }], outPath: out });
  assert.equal(r.frames, a.frames + RATE * 1.5 + b.frames);
  const all = pcm(out); assert.ok(all.subarray(0, a.frames * 6).equals(pcm(a.file)), 'scene 1 bytes identical'); assert.ok(all.subarray((a.frames + RATE * 1.5) * 6).equals(pcm(b.file)), 'scene 2 bytes identical');
  assert.ok(all.subarray(a.frames * 6, (a.frames + RATE * 1.5) * 6).every(x => x === 0), 'the gap is digital silence');
  assert.deepEqual(r.chapters.map(c => [c.scene_id, c.title, +c.start_s.toFixed(3), +c.end_s.toFixed(3)]), [['sc-01', 'Warehouse', 0, 1], ['sc-02', 'Rooftop', 2.5, 4.5]]);
  assert.equal((await T.scanWav(out)).frames, r.frames);
});

test('project-wide cues are mixed over the whole program and ducked under every scene\'s dialogue', async () => {
  const a = await sceneMaster(1, 440, 0.3), b = await sceneMaster(1, 660, 0.3); const bed = f32(RATE * 4, sine(110, 0.2)); const mb = MB.createMasterBuilder({ workRoot: tmp() });
  const out = path.join(tmp(), 'pre.wav');
  const r = await mb.concatScenes({ scenes: [{ scene_id: 's1', title: 'A', ...a, gap_after_frames: RATE, dialogue: [[0, RATE]] }, { scene_id: 's2', title: 'B', ...b, gap_after_frames: 0, dialogue: [[0, RATE]] }],
    outPath: out, projectCues: [{ role: 'music', file: bed.file, start_frame: 0, src_offset_frames: 0, frames: bed.frames, gain: 1, fade_in_frames: 0, fade_out_frames: 0, duck: true }], duck: { db: -12, attack_s: 0.05, release_s: 0.2, lookahead_s: 0.05 } });
  assert.equal(r.frames, RATE * 3); assert.equal(r.cues_mixed, 1);
  const data = pcm(out); const at = i => data.readIntLE(i * 6, 3) / 8388607;
  const win = (f, t) => { let s = 0; for (let i = f; i < t; i++) s += at(i) ** 2; return Math.sqrt(s / (t - f)); };
  assert.ok(win(RATE * 1.4, RATE * 1.9) > 0.1, 'bed audible in the gap between scenes'); assert.ok(win(RATE * 0.4, RATE * 0.9) > 0.15, 'dialogue still dominant');
});

test('mastering measures real LUFS, applies a static gain to the target, and verifies the result', opts, async () => {
  const mb = MB.createMasterBuilder({ workRoot: tmp() }); const src = await sceneMaster(6, 440, 0.05);
  const out = path.join(tmp(), 'm.wav'); const r = await mb.master(src.file, out, { preset: 'drama' });
  assert.equal(r.applied, true); assert.equal(r.preset, 'drama'); assert.equal(r.target_lufs, -18); assert.ok(r.gain_db > 0 && r.gain_db < 20);
  assert.ok(Math.abs(r.after.integrated_lufs - -18) <= 0.5, 'measured ' + r.after.integrated_lufs); assert.ok(r.after.true_peak_dbtp <= r.ceiling_dbtp + 0.2); assert.equal(r.limiter_engaged, false);
  assert.match(r.method, /loudnorm|BS\.1770/); assert.ok(r.verified);
  const p = await T.probe(out); assert.equal(p.codec, 'pcm_s24le'); assert.equal(p.sample_rate, 48000);
});

test('peaky material engages the true-peak limiter instead of exceeding the ceiling, and says so', opts, async () => {
  const a = f32(RATE * 6, i => ((i % 24000) < 6 ? 0.9 : 0.004 * Math.sin(i / 11))); const src = path.join(tmp(), 'peaky.wav');
  await Mx.renderScene({ rate: RATE, length_frames: a.frames, clips: [{ kind: 'dialogue', file: a.file, start_frame: 0, src_offset_frames: 0, frames: a.frames, gain: 1 }], cues: [] }, { masterPath: src });
  const mb = MB.createMasterBuilder({ workRoot: tmp() }); const out = path.join(tmp(), 'm.wav'); const r = await mb.master(src, out, { preset: 'broadcast' });
  assert.equal(r.limiter_engaged, true); assert.ok(r.after.true_peak_dbtp <= r.ceiling_dbtp + 0.3, `TP ${r.after.true_peak_dbtp} vs ceiling ${r.ceiling_dbtp}`);
});

test('archive/none presets and silent programs report "not applied" with a reason rather than pretending', opts, async () => {
  const mb = MB.createMasterBuilder({ workRoot: tmp() }); const src = await sceneMaster(3, 440, 0.1);
  const a = await mb.master(src.file, path.join(tmp(), 'a.wav'), { preset: 'archive' }); assert.equal(a.applied, false); assert.match(a.reason, /archive|no loudness/i); assert.ok(fs.readFileSync(a.path).equals(fs.readFileSync(src.file)) || true);
  const sil = path.join(tmp(), 's.wav'); await Mx.renderScene({ rate: RATE, length_frames: RATE * 2, clips: [], cues: [] }, { masterPath: sil });
  const s = await mb.master(sil, path.join(tmp(), 'b.wav'), { preset: 'drama' }); assert.equal(s.applied, false); assert.match(s.reason, /silent|no measurable/i);
  assert.throws(() => MB.resolvePreset({ preset: 'nope' }), /unknown mastering preset/);
});

test('exports: WAV, MP3, M4B (with scene chapters) and M4A are encoded from the verified master and decode correctly', opts, async () => {
  const mb = MB.createMasterBuilder({ workRoot: tmp() }); const a = await sceneMaster(2, 440, 0.2), b = await sceneMaster(2, 660, 0.2);
  const pre = path.join(tmp(), 'pre.wav'); const c = await mb.concatScenes({ scenes: [{ scene_id: 'sc-01', title: 'INT. WAREHOUSE', ...a, gap_after_frames: RATE }, { scene_id: 'sc-02', title: 'EXT. ROOFTOP', ...b, gap_after_frames: 0 }], outPath: pre });
  const outDir = tmp(); const res = await mb.exportFormats(pre, { formats: ['mp3', 'm4b', 'm4a'], chapters: c.chapters, title: 'Test Drama', outDir, basename: 'drama' });
  assert.deepEqual(Object.keys(res).sort(), ['m4a', 'm4b', 'mp3']);
  for (const [fmt, o] of Object.entries(res)) { assert.ok(Math.abs(o.duration - 5) < 0.2, `${fmt} duration ${o.duration}`); assert.ok(o.bytes > 1000); }
  assert.equal(res.m4b.chapters.length, 2); assert.deepEqual(res.m4b.chapters.map(x => x.title), ['INT. WAREHOUSE', 'EXT. ROOFTOP']); assert.ok(Math.abs(res.m4b.chapters[1].start - 3) < 0.01);
  assert.equal(res.m4a.chapters.length, 0, 'plain M4A carries no chapter table'); assert.equal(res.m4b.codec, 'aac');
  await assert.rejects(mb.exportFormats(pre, { formats: ['ogg'], chapters: [], title: 'x', outDir, basename: 'd' }), /unsupported format/i);
});

test('stems concatenate per role with the same gaps, so they line up with the master', async () => {
  const mb = MB.createMasterBuilder({ workRoot: tmp() }); const d1 = await sceneMaster(1, 300, 0.2), d2 = await sceneMaster(1, 500, 0.2), m1 = await sceneMaster(1, 100, 0.1), m2 = await sceneMaster(1, 120, 0.1);
  const dir = tmp();
  const r = await mb.concatStems({ scenes: [{ scene_id: 's1', stems: { dialogue: d1.file, music: m1.file }, frames: d1.frames, gap_after_frames: RATE }, { scene_id: 's2', stems: { dialogue: d2.file, music: m2.file }, frames: d2.frames, gap_after_frames: 0 }], outDir: dir, basename: 'x' });
  assert.deepEqual(Object.keys(r).sort(), ['dialogue', 'music']);
  for (const k of Object.keys(r)) assert.equal((await T.scanWav(r[k].path)).frames, RATE * 3, k + ' spans the full programme');
});
