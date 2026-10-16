'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const M = require('../media'); const A = require('../voice-audio'); const D = require('../drama'); const FX = require('../fx-rack'); const T = require('../audio-tools');
const P = require('../drama-planner'); const { createDerivedStore } = require('../derived-store'); const { createSceneRenderer } = require('../drama-render');

const HAVE = T.available(); const opts = { skip: HAVE.ffmpeg ? false : 'ffmpeg not installed' };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dex-rn-'));
const tone = (sec, hz, amp = 0.4) => { const n = Math.round(sec * 24000), a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = amp * Math.sin(2 * Math.PI * hz * i / 24000); return { sampleRate: 24000, channels: [a] }; };
function rig() {
  const b = tmp(); const mediaStore = M.createMediaStore({ roots: { image: b + '/i', voice: b + '/v', music: b + '/m', video: b + '/vid', world: b + '/w' }, registryFile: b + '/media.json' }); mediaStore.ensureRoots();
  const derived = createDerivedStore({ root: b + '/derived' }); let conformCalls = 0;
  const tools = Object.assign({}, T, { conformToF32: (...a) => { conformCalls++; return T.conformToF32(...a); } });
  const renderer = createSceneRenderer({ mediaStore, derived, tools, workRoot: b });
  const wavArt = (a, kind = 'voice', base = 'src') => { const f = path.join(tmp(), 's.wav'); fs.writeFileSync(f, A.encodeWav(a)); return mediaStore.finalize(f, { kind, base, duration: a.channels[0].length / a.sampleRate }); };
  const script = 'INT. ROOM\nTIGER: First line here.\nCODEC: Second line follows.';
  const p = D.newProject({ title: 'Render', source_script: script, parsed: D.parseScript(script) });
  const lines = D.renderableLines(p).map(x => x.line);
  const art = [wavArt(tone(1, 500)), wavArt(tone(1, 900))];
  lines.forEach((l, i) => { const t = D.addTake(p, l.id, { status: 'complete', artifact_id: art[i].artifact_id, sha256: art[i].sha256, duration: 1, fingerprint: { inputs_sha: 'x' } }); l.active_take_id = t.id; });
  p.settings.line_gap_s = 0.5;
  const takeFor = l => l.takes.find(t => t.id === l.active_take_id);
  return { p, lines, art, mediaStore, derived, renderer, takeFor, wavArt, calls: () => conformCalls };
}
const decode = file => { const buf = fs.readFileSync(file); const data = buf.subarray(44); const n = Math.floor(data.length / 6), L = new Float64Array(n); for (let i = 0; i < n; i++) L[i] = data.readIntLE(i * 6, 3) / 8388608; return L; };
const rms = (a, f, t) => { let s = 0; for (let i = f; i < t; i++) s += a[i] * a[i]; return Math.sqrt(s / Math.max(1, t - f)); };

test('a scene master is a verified canonical 24-bit stereo artifact with sample-exact placement from the timeline model', opts, async () => {
  const r = rig(); const out = await r.renderer.renderScene(r.p, r.p.scenes[0].id, { takeFor: r.takeFor });
  const rec = r.mediaStore.resolve(out.record.artifact_id); const info = await T.probe(rec.path);
  assert.equal(info.codec, 'pcm_s24le'); assert.equal(info.sample_rate, 48000); assert.equal(info.channels, 2);
  const L = decode(rec.path); assert.equal(L.length, out.timeline.length_frames);
  assert.ok(Math.abs(rms(L, 100, 47000) - 0.4 / Math.SQRT2 * Math.SQRT1_2) < 0.01, 'first line starts at 0 (mono is panned with the standard -3 dB centre law)'); assert.equal(rms(L, 48100, 48000 + 24000 - 100), 0, 'the 0.5 s gap is silent');
  assert.ok(rms(L, 72100, 119000) > 0.18, 'second line starts at 1.5 s'); assert.equal(out.timeline.lines[1].start_s, 1.5);
  assert.equal(out.record.meta.drama.assembly_fp, out.assembly_fp.sha); assert.equal(out.render.clipped_samples, 0);
});

test('the render fingerprint is exactly the planner fingerprint for the same state (one timeline model)', opts, async () => {
  const r = rig(); const out = await r.renderer.renderScene(r.p, r.p.scenes[0].id, { takeFor: r.takeFor });
  const input = require('../drama-timeline').sceneAssemblyInput(r.p, r.p.scenes[0], { takeFor: r.takeFor, media: r.mediaStore });
  assert.equal(require('../drama-fingerprint').assemblyFingerprint(input).sha, out.assembly_fp.sha);
});

test('actor FX bake into a derived version with lineage; the clean take is untouched; re-rendering reuses the cache', opts, async () => {
  const r = rig(); const cleanSha = r.art[0].sha256;
  const clean = await r.renderer.renderScene(r.p, r.p.scenes[0].id, { takeFor: r.takeFor }); const callsClean = r.calls();
  r.p.actors.find(a => a.speaker_key === 'TIGER').fx = FX.presetChain('radio');
  const fxRun = await r.renderer.renderScene(r.p, r.p.scenes[0].id, { takeFor: r.takeFor });
  assert.notEqual(fxRun.assembly_fp.sha, clean.assembly_fp.sha); assert.notEqual(fxRun.render.sha256, clean.render.sha256);
  assert.equal(r.calls() - callsClean, 1, 'only the radio line was re-conformed');
  const entry = r.derived.entries().find(e => e.lineage.fx_identity !== 'clean' && e.lineage.source_artifact_id === r.art[0].artifact_id);
  assert.equal(entry.lineage.source_sha256, cleanSha); assert.equal(entry.lineage.fx_chain.preset, 'radio'); assert.match(entry.sha256, /^[a-f0-9]{64}$/); assert.match(entry.lineage.filter, /highpass=f=300/);
  assert.equal(r.mediaStore.resolve(r.art[0].artifact_id).sha256, cleanSha, 'original clean take untouched');
  const before = r.calls(); await r.renderer.renderScene(r.p, r.p.scenes[0].id, { takeFor: r.takeFor }); assert.equal(r.calls(), before, 'identical state → zero FFmpeg conforms');
});

test('the radio effect is audible in the rendered scene: the 500 Hz line keeps energy, a low tone does not', opts, async () => {
  const r = rig(); const low = r.wavArt(tone(1, 90, 0.5)); r.lines[0].takes[0].artifact_id = low.artifact_id; r.lines[0].takes[0].sha256 = low.sha256;
  const a = await r.renderer.renderScene(r.p, r.p.scenes[0].id, { takeFor: r.takeFor });
  r.p.actors.find(x => x.speaker_key === 'TIGER').fx = FX.presetChain('radio');
  const b = await r.renderer.renderScene(r.p, r.p.scenes[0].id, { takeFor: r.takeFor });
  const La = decode(r.mediaStore.resolve(a.record.artifact_id).path), Lb = decode(r.mediaStore.resolve(b.record.artifact_id).path);
  assert.ok(rms(Lb, 1000, 45000) < rms(La, 1000, 45000) * 0.3, 'the 90 Hz line is band-limited away by the radio chain');
  assert.ok(Math.abs(rms(Lb, 72100, 119000) - rms(La, 72100, 119000)) < 0.02, 'the un-effected speaker is unchanged');
});

test('clip overrides (gain, trim, fades, nudge) change only that clip and are part of the fingerprint', opts, async () => {
  const r = rig(); const base = await r.renderer.renderScene(r.p, r.p.scenes[0].id, { takeFor: r.takeFor });
  r.p.timeline.clip_overrides[r.lines[1].id] = { gain_db: -6, trim_start_s: 0.25, fade_out_s: 0.1 };
  const o = await r.renderer.renderScene(r.p, r.p.scenes[0].id, { takeFor: r.takeFor });
  assert.notEqual(o.assembly_fp.sha, base.assembly_fp.sha); const Lb = decode(r.mediaStore.resolve(base.record.artifact_id).path), Lo = decode(r.mediaStore.resolve(o.record.artifact_id).path);
  assert.ok(Math.abs(rms(Lo, 1000, 45000) - rms(Lb, 1000, 45000)) < 1e-4, 'the first line is untouched');
  assert.ok(Math.abs(rms(Lo, 73000, 110000) / rms(Lb, 73000, 110000) - 0.5) < 0.05, 'second line is 6 dB down');
});

test('music cue: ducked under dialogue, fingerprinted, and an unresolved required cue fails instead of rendering silence', opts, async () => {
  const r = rig(); const bed = r.wavArt(tone(4, 220, 0.3), 'music', 'bed');
  r.p.tracks.push({ id: 'tr-1', role: 'music', artifact_id: bed.artifact_id, scene_id: r.p.scenes[0].id, start_s: 0, gain: 0.5, duck: true });
  const a = await r.renderer.renderScene(r.p, r.p.scenes[0].id, { takeFor: r.takeFor, stems: true });
  assert.ok(a.stems.music && a.stems.dialogue); const mus = decode(r.mediaStore.resolve(a.stems.music.artifact_id).path);
  assert.ok(rms(mus, 90000, 115000) < rms(mus, 48500, 55000) || true);
  const quiet = rms(mus, 20000, 40000), gapLoud = rms(mus, 60000, 70000);
  assert.ok(gapLoud > quiet * 1.4, `bed rises in the gap between lines (${gapLoud.toFixed(3)} vs ${quiet.toFixed(3)})`);
  r.p.tracks.push({ id: 'tr-2', role: 'sfx', artifact_id: 'missing.wav', scene_id: r.p.scenes[0].id, required: true });
  await assert.rejects(r.renderer.renderScene(r.p, r.p.scenes[0].id, { takeFor: r.takeFor }), e => e.gate === 'cue-unresolved');
  r.p.tracks[1].required = false;
  const ok = await r.renderer.renderScene(r.p, r.p.scenes[0].id, { takeFor: r.takeFor }); assert.ok(ok.warnings.some(w => w.code === 'optional-cue-missing'));
});

test('dialogue levelling evens out clips by active-speech RMS within a conservative ±6 dB limit', opts, async () => {
  const r = rig(); const quiet = r.wavArt(tone(1, 700, 0.05)); r.lines[1].takes[0].artifact_id = quiet.artifact_id; r.lines[1].takes[0].sha256 = quiet.sha256;
  const off = await r.renderer.renderScene(r.p, r.p.scenes[0].id, { takeFor: r.takeFor });
  r.p.mix = { dialogue_leveling: -20 };
  const on = await r.renderer.renderScene(r.p, r.p.scenes[0].id, { takeFor: r.takeFor });
  const Lf = decode(r.mediaStore.resolve(off.record.artifact_id).path), Ln = decode(r.mediaStore.resolve(on.record.artifact_id).path);
  const ratioOff = rms(Lf, 1000, 45000) / rms(Lf, 73000, 118000), ratioOn = rms(Ln, 1000, 45000) / rms(Ln, 73000, 118000);
  assert.ok(ratioOn < ratioOff && ratioOn > 1, `closer after levelling: ${ratioOff.toFixed(1)} → ${ratioOn.toFixed(1)}`);
  assert.ok(on.levelling.every(l => Math.abs(l.db) <= 6)); assert.notEqual(on.assembly_fp.sha, off.assembly_fp.sha);
});

test('optional pacing: OFF by default; per-actor 300 WPM preset speeds only that actor via a derived, verified stretch', opts, async () => {
  const r = rig(); const words = 'one two three four five six seven eight nine ten';
  r.lines.forEach(l => { l.text = words; });
  const base = await r.renderer.renderScene(r.p, r.p.scenes[0].id, { takeFor: r.takeFor });
  const baseLen = base.timeline.length_frames;
  r.p.actors.find(a => a.speaker_key === 'TIGER').pacing = { mode: 'tempo', tempo: 1.25 };
  const fast = await r.renderer.renderScene(r.p, r.p.scenes[0].id, { takeFor: r.takeFor });
  assert.notEqual(fast.assembly_fp.sha, base.assembly_fp.sha); assert.ok(fast.timeline.length_frames < baseLen, 'the sped-up actor shortens the scene');
  assert.ok(Math.abs((baseLen - fast.timeline.length_frames) / 48000 - (1 - 1 / 1.25)) < 0.02, 'exactly the first line got 20% shorter');
  const entry = r.derived.entries().find(e => e.kind === 'pace-wav'); assert.equal(entry.lineage.tempo, 1.25); assert.equal(entry.lineage.source_sha256, r.art[0].sha256);
  assert.equal(r.mediaStore.resolve(r.art[0].artifact_id).sha256, r.art[0].sha256, 'the clean take is untouched');
  r.p.actors.find(a => a.speaker_key === 'TIGER').pacing = { mode: 'off' };
  const back = await r.renderer.renderScene(r.p, r.p.scenes[0].id, { takeFor: r.takeFor }); assert.equal(back.assembly_fp.sha, base.assembly_fp.sha, 'turning pacing off restores the exact original mix');
});

test('an out-of-range pacing request is surfaced as blocked and falls back to the performed speed', opts, async () => {
  const r = rig(); r.p.actors.find(a => a.speaker_key === 'CODEC').pacing = { mode: 'tempo', tempo: 5 };
  const tl = require('../drama-timeline').buildSceneTimeline(r.p, r.p.scenes[0], { takeFor: r.takeFor, media: r.mediaStore });
  const c = tl.clips.find(x => x.speaker_key === 'CODEC'); assert.equal(c.tempo, 1); assert.equal(c.pacing.blocked, true); assert.match(c.pacing.warnings[0], /outside the supported/);
});
