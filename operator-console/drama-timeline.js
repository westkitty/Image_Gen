'use strict';

// The ONE authoritative timeline model for scene assembly. Preview, scene masters, stems and exports are all produced
// from the object built here, so the browser never owns an "unrelated" mix, and the assembly fingerprint is derived
// from exactly the same facts the mixer consumes (take checksums, placement, trims, fades, gains, FX identity, cues,
// ducking/mix settings, mixer version) and from nothing about speech identity.

const F = require('./drama-fingerprint');
const D = require('./drama');
const FX = require('./fx-rack');
const Pacing = require('./pacing');
const F2 = require('./drama-fingerprint');

const RATE = 48000;
const num = (v, d = 0) => (v !== null && v !== '' && v !== undefined && Number.isFinite(Number(v)) ? Number(v) : d);
const frames = s => Math.max(0, Math.round(s * RATE));
const DEFAULT_MIX = { duck_db: -10, duck_attack_s: 0.15, duck_release_s: 0.6, duck_lookahead_s: 0.15, dialogue_leveling: null };
const mixSettings = project => Object.assign({}, DEFAULT_MIX, project.mix || {});

function actorFx(project, speakerKey) { const a = D.actorFor(project, speakerKey); return (a && a.fx) || null; }
function fxIdentity(fx) { return FX.identity(fx); }
const dbToLin = db => Math.pow(10, db / 20);

const measureCache = new Map();
// Measured WPM of this take (cached by checksum + text): used only when pacing is enabled for the line.
function measureTake(line, take, art) {
  const k = (art.sha256 || art.artifact_id) + '|' + F2.sha(F2.normalizeSpokenText(line.text));
  if (measureCache.has(k)) return measureCache.get(k);
  let m = take.measure && take.measure.wpm ? take.measure : null;
  if (!m) { try { m = Pacing.measureFile(line.text, art.path); } catch (_) { m = null; } }
  measureCache.set(k, m); return m;
}

// takeFor(line) → take|null; media.resolve(artifactId) → { sha256, duration, path }|null
function buildSceneTimeline(project, scene, { takeFor, media }) {
  const mix = mixSettings(project);
  const clips = [], lines = [];
  let t = 0, prevAfter = null, dialogueEnd = 0, order = 0, incomplete = false, lastEnd = 0;
  const cueTimes = {};
  for (const line of scene.lines) {
    if (line.cue) cueTimes[line.id] = lastEnd;
    if (line.render === false || line.kind === 'direction' || !String(line.text).trim()) continue;
    const take = takeFor(line);
    const art = take && take.artifact_id && media.resolve(take.artifact_id);
    if (!take || !art) { incomplete = true; continue; }
    const ov = (project.timeline && project.timeline.clip_overrides && project.timeline.clip_overrides[line.id]) || {};
    const fx = ov.fx_override !== undefined ? ov.fx_override : actorFx(project, line.speaker_key);
    const compiled = FX.compile(fx), rawDur = num(art.duration, take.duration || 0);
    // optional pacing (OFF unless the actor or this line asks for it): a pitch-preserving derived stretch, never applied to the clean take
    let tempo = 1, pacing = null;
    const ps = Pacing.resolveSetting((D.actorFor(project, line.speaker_key) || {}).pacing, ov.pacing);
    if (ps) {
      const m = measureTake(line, take, art), plan = Pacing.planTempo({ measured_wpm: m && m.wpm, target_wpm: ps.target_wpm, tempo: ps.tempo });
      pacing = { mode: ps.mode, target_wpm: ps.target_wpm || null, requested_tempo: ps.tempo || null, measured_wpm: m ? m.wpm : null, tempo: plan.blocked ? 1 : plan.tempo, warnings: plan.warnings, blocked: plan.blocked };
      if (!plan.blocked) tempo = plan.tempo;
    }
    const dur = rawDur / tempo;
    if (prevAfter != null) t += prevAfter;
    t += line.pause_before_s == null ? 0 : num(line.pause_before_s);
    const trimStart = Math.max(0, num(ov.trim_start_s)), trimEnd = ov.trim_end_s == null ? null : Math.max(trimStart, num(ov.trim_end_s));       // trims are in output (post-pacing) seconds
    const playable = (trimEnd == null ? dur : Math.min(trimEnd, dur)) - trimStart;
    const startS = t + num(ov.start_offset_s);
    const clipLen = Math.max(0, playable) + (trimEnd == null ? compiled.tail_s : 0);
    clips.push({
      order: order++, kind: 'dialogue', line_id: line.id, speaker_key: line.speaker_key, take_id: take.id, artifact_id: take.artifact_id, source_sha256: art.sha256 || take.sha256 || null,
      start_frame: frames(Math.max(0, startS)), src_offset_frames: frames(trimStart), frames: frames(clipLen),
      gain_db: num(ov.gain_db), fade_in_frames: frames(num(ov.fade_in_s)), fade_out_frames: frames(num(ov.fade_out_s)),
      fx: compiled.empty ? null : FX.validate(fx).chain, fx_identity: fxIdentity(fx), pinned: !!ov.pinned_take_id, tempo, pacing,
    });
    lines.push({ line_id: line.id, start_s: startS, end_s: startS + Math.max(0, playable) }); lastEnd = startS + Math.max(0, playable);
    t += dur; dialogueEnd = Math.max(dialogueEnd, startS + Math.max(0, playable) + (trimEnd == null ? compiled.tail_s : 0));
    prevAfter = line.pause_after_s == null ? num(project.settings.line_gap_s, 0.35) : num(line.pause_after_s);
  }
  const dialogueFrames = frames(Math.max(t, dialogueEnd));
  const cues = [];
  for (const tr of (project.tracks || []).filter(x => x.scene_id === scene.id)) {
    const art = tr.artifact_id && media.resolve(tr.artifact_id);
    const base = { id: tr.id, role: tr.role, artifact_id: tr.artifact_id || null, required: tr.required !== false, priority: num(tr.priority), loop: !!tr.loop, duck: tr.duck === undefined ? tr.role === 'music' || tr.role === 'ambience' : !!tr.duck };
    if (!art) { cues.push(Object.assign(base, { resolved: false, source_sha256: null })); continue; }
    const dur = num(art.duration, 0), trimStart = Math.max(0, num(tr.trim_start_s)), trimEnd = tr.trim_end_s == null ? null : Math.max(trimStart, num(tr.trim_end_s));
    const region = (trimEnd == null ? dur : Math.min(trimEnd, dur)) - trimStart;
    cues.push(Object.assign(base, {
      resolved: true, source_sha256: art.sha256 || null, start_frame: frames(Math.max(0, (tr.cue_line_id && cueTimes[tr.cue_line_id] != null ? cueTimes[tr.cue_line_id] : 0) + num(tr.start_s))), src_offset_frames: frames(trimStart), loop_region_frames: frames(Math.max(0, region)),
      length_request_s: tr.length_s == null || tr.length_s === '' ? null : num(tr.length_s), region_s: Math.max(0, region),
      gain: tr.gain == null ? (tr.role === 'music' ? 0.3 : 0.5) : num(tr.gain), fade_in_frames: frames(num(tr.fade_in_s)), fade_out_frames: frames(num(tr.fade_out_s)),
    }));
  }
  // scene length: dialogue + any cue that plays once; looped cues run to the dialogue end (or their explicit length)
  let length = dialogueFrames;
  for (const c of cues) if (c.resolved && !c.loop) length = Math.max(length, c.start_frame + frames(c.length_request_s != null ? c.length_request_s : c.region_s));
  for (const c of cues) {
    if (!c.resolved) continue;
    const want = c.loop ? (c.length_request_s != null ? frames(c.length_request_s) : Math.max(0, length - c.start_frame)) : frames(c.length_request_s != null ? Math.min(c.length_request_s, c.region_s) : c.region_s);
    c.frames = Math.max(0, want);
    c.end_frame = c.start_frame + c.frames;
    if (c.loop) length = Math.max(length, c.end_frame);
  }
  return { scene_id: scene.id, rate: RATE, length_frames: length, length_s: length / RATE, clips, cues, lines, incomplete, mix };
}

// What the assembly fingerprint hashes: the timeline minus anything that is not part of the sound.
function sceneAssemblyInput(project, scene, ctx) {
  const tl = buildSceneTimeline(project, scene, ctx);
  if (tl.incomplete) return null;
  return {
    scene_id: scene.id, mixer_version: F.MIXER_VERSION, length_frames: tl.length_frames,
    clips: tl.clips.map(c => ({ line_id: c.line_id, order: c.order, take_id: c.take_id, take_sha256: c.source_sha256, start_frame: c.start_frame, src_offset_frames: c.src_offset_frames, frames: c.frames, gain_db: c.gain_db, fade_in_frames: c.fade_in_frames, fade_out_frames: c.fade_out_frames, fx: c.fx_identity, tempo: c.tempo })),
    cues: tl.cues.map(c => ({ id: c.id, role: c.role, resolved: c.resolved, artifact_sha256: c.source_sha256, start_frame: c.start_frame, src_offset_frames: c.src_offset_frames, frames: c.frames, loop: c.loop, loop_region_frames: c.loop_region_frames, gain: c.gain, fade_in_frames: c.fade_in_frames, fade_out_frames: c.fade_out_frames, duck: c.duck, priority: c.priority })),
    settings: { mix: tl.mix }, mastering: {},
  };
}

module.exports = { RATE, DEFAULT_MIX, mixSettings, buildSceneTimeline, sceneAssemblyInput, fxIdentity, actorFx, dbToLin };
