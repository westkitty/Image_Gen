'use strict';

// Scene renderer: timeline model → conformed derived sources (FX baked, lineage recorded) → streaming mixer → verified
// canonical scene master. The scene master IS the preview: the browser plays exactly the artifact the export reuses.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const D = require('./drama');
const F = require('./drama-fingerprint');
const FX = require('./fx-rack');
const TL = require('./drama-timeline');
const Mixer = require('./drama-mixer');
const Tools = require('./audio-tools');

const CONFORM_VERSION = 'conform.v1';
const slug = s => String(s || 'drama').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'drama';
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Active-speech RMS (dBFS) of a stereo f32 region: frames above -50 dBFS only, so pauses do not dilute the level.
function activeRmsDb(file, offsetFrames, frames) {
  const fd = fs.openSync(file, 'r'), win = 960, buf = Buffer.alloc(win * 8 * 50);
  let pos = offsetFrames, left = frames, sum = 0, n = 0;
  try {
    while (left > 0) {
      const take = Math.min(left, win * 50), got = fs.readSync(fd, buf, 0, take * 8, pos * 8); if (got <= 0) break;
      const fr = Math.floor(got / 8);
      for (let s = 0; s + win <= fr; s += win) {
        let e = 0; for (let i = 0; i < win; i++) { const v = (buf.readFloatLE((s + i) * 8) + buf.readFloatLE((s + i) * 8 + 4)) / 2; e += v * v; }
        e /= win; if (e > 3.2e-11 * 0 + Math.pow(10, -50 / 10)) { sum += e; n++; }
      }
      pos += fr; left -= fr; if (fr < take) break;
    }
  } finally { fs.closeSync(fd); }
  return n ? 10 * Math.log10(sum / n) : null;
}

function createSceneRenderer({ mediaStore, derived, tools = Tools, mixer = Mixer, workRoot = os.tmpdir(), now = () => Date.now() }) {
  async function conformed(parts, art, lineage, filters) {
    return derived.ensure(parts, { ext: 'f32', kind: filters ? 'fx-f32' : 'conform-f32', lineage }, async dest => { const r = await tools.conformToF32(art.path, dest, { filters }); return { frames: r.frames }; });
  }

  // timeline → mixer spec (files resolved, FX baked). Pure of side effects except the derived cache.
  async function prepare(tl, project) {
    const warnings = [], clips = [], cues = [], levelTarget = tl.mix.dialogue_leveling;
    for (const c of tl.clips) {
      const art = mediaStore.resolve(c.artifact_id); if (!art) throw Object.assign(new Error(`take audio is missing for a clip (${c.line_id})`), { gate: 'take-audio-missing' });
      const compiled = FX.compile(c.fx);
      let srcArt = art;
      if (c.tempo && c.tempo !== 1) {          // optional pacing: derived, verified time-stretch of the clean take (pitch preserved)
        const st = await derived.ensure(['pace.v1', c.source_sha256, c.tempo], { ext: 'wav', kind: 'pace-wav', lineage: { source_artifact_id: c.artifact_id, source_sha256: c.source_sha256, tempo: c.tempo, op: 'atempo' } }, async dest => { const r = await tools.timeStretch(art.path, dest, c.tempo); return { duration: r.duration }; });
        srcArt = { path: st.path };
      }
      const d = await conformed([CONFORM_VERSION, c.source_sha256, c.fx_identity, c.tempo || 1], srcArt, { source_artifact_id: c.artifact_id, source_sha256: c.source_sha256, fx_identity: c.fx_identity, tempo: c.tempo || 1, fx_chain: c.fx, filter: compiled.filter || null, conform: CONFORM_VERSION }, compiled.filter || null);
      const avail = Math.max(0, d.frames - c.src_offset_frames), frames = Math.min(c.frames, avail);
      let gain = TL.dbToLin(c.gain_db), leveling = null;
      if (typeof levelTarget === 'number') { const r = activeRmsDb(d.path, c.src_offset_frames, frames); if (r != null) { leveling = clamp(levelTarget - r, -6, 6); gain *= TL.dbToLin(leveling); } }
      clips.push({ kind: 'dialogue', line_id: c.line_id, file: d.path, start_frame: c.start_frame, src_offset_frames: c.src_offset_frames, frames, gain, fade_in_frames: c.fade_in_frames, fade_out_frames: c.fade_out_frames, leveling_db: leveling });
    }
    for (const c of tl.cues) {
      if (!c.resolved) {
        if (c.required) throw Object.assign(new Error(`required sound cue ${c.id} has no audio asset`), { gate: 'cue-unresolved', track_id: c.id });
        warnings.push({ code: 'optional-cue-missing', track_id: c.id }); continue;
      }
      const art = mediaStore.resolve(c.artifact_id);
      const d = await conformed([CONFORM_VERSION, c.source_sha256, 'clean'], art, { source_artifact_id: c.artifact_id, source_sha256: c.source_sha256, fx_identity: 'clean', conform: CONFORM_VERSION }, null);
      const avail = Math.max(0, d.frames - c.src_offset_frames);
      cues.push({ role: c.role, id: c.id, file: d.path, start_frame: c.start_frame, src_offset_frames: c.src_offset_frames, frames: c.loop ? c.frames : Math.min(c.frames, avail), loop: c.loop, loop_frames: Math.min(c.loop_region_frames || avail, avail), gain: c.gain, fade_in_frames: c.fade_in_frames, fade_out_frames: c.fade_out_frames, duck: c.duck });
    }
    return { spec: { rate: tl.rate, length_frames: tl.length_frames, clips, cues, duck: { db: tl.mix.duck_db, attack_s: tl.mix.duck_attack_s, release_s: tl.mix.duck_release_s, lookahead_s: tl.mix.duck_lookahead_s } }, warnings };
  }

  // Renders one scene to a canonical, verified master (and stems when asked). takeFor(line) must return the take for the master.
  async function renderScene(project, sceneId, { takeFor, stems = false, label = 'scene', meta = {}, onProgress = null }) {
    const scene = project.scenes.find(s => s.id === sceneId); if (!scene) throw Object.assign(new Error('scene not found'), { status: 404 });
    const media = mediaStore;
    const tl = TL.buildSceneTimeline(project, scene, { takeFor, media });
    if (tl.incomplete) throw Object.assign(new Error('the scene has lines without a usable take'), { gate: 'missing-takes' });
    if (!(tl.length_frames > 0)) throw Object.assign(new Error('the scene is empty'), { gate: 'empty' });
    const input = TL.sceneAssemblyInput(project, scene, { takeFor, media }), fp = F.assemblyFingerprint(input);
    const { spec, warnings } = await prepare(tl, project);
    const work = fs.mkdtempSync(path.join(workRoot, 'dexscene-'));
    try {
      const masterPath = path.join(work, 'scene.wav');
      const r = await mixer.renderScene(spec, { masterPath, stemsDir: stems ? path.join(work, 'stems') : null, stemPrefix: slug(scene.title) + '-' + scene.id, onProgress });
      const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
      const rec = mediaStore.finalize(masterPath, { kind: 'voice', base: `${stamp}-drama-${slug(project.title)}-${scene.id}-master`, worker: 'drama-mixer', model: 'drama-mixer', duration: r.duration_s,
        meta: Object.assign({ operation: 'drama-scene-master', sample_rate: r.sample_rate, channels: 2, bits: 24, drama: { project_id: project.id, scene_id: scene.id, assembly_fp: fp.sha, mixer: F.MIXER_VERSION, clips: tl.clips.length, cues: spec.cues.length, clipped_samples: r.clipped_samples, peak: +r.peak.toFixed(4) } }, meta) });
      const stemRecs = {};
      for (const [role, st] of Object.entries(r.stems || {})) stemRecs[role] = mediaStore.finalize(st.path, { kind: 'voice', base: `${stamp}-drama-${slug(project.title)}-${scene.id}-stem-${role}`, worker: 'drama-mixer', model: 'drama-mixer', duration: r.duration_s, meta: { operation: 'drama-stem', stem: role, drama: { project_id: project.id, scene_id: scene.id, assembly_fp: fp.sha } } });
      return { record: rec, stems: stemRecs, render: { frames: r.frames, duration_s: r.duration_s, peak: r.peak, clipped_samples: r.clipped_samples, sha256: r.sha256 }, assembly_fp: fp, timeline: { length_frames: tl.length_frames, lines: tl.lines, clips: tl.clips.length, cues: spec.cues.length }, warnings, levelling: spec.clips.map(c => ({ line_id: c.line_id, db: c.leveling_db })) };
    } finally { try { fs.rmSync(work, { recursive: true, force: true }); } catch (_) {} }
  }
  return { prepare, renderScene, CONFORM_VERSION };
}

module.exports = { createSceneRenderer, activeRmsDb, CONFORM_VERSION };
