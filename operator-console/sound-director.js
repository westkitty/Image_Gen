'use strict';

// Sound Director: sound cues written in the script ([SFX: ...], [MUSIC: ...], [AMBIENCE: ...]) are CUES, never speech. Each cue
// is resolved against the user's own local Media library (or a locally generated procedural effect); nothing is downloaded,
// searched online or invented. A bound cue becomes an anchored track, positioned at its place in the script, that follows the
// dialogue until the user drags it (which detaches it to an absolute time).
//
// Script cues default to OPTIONAL so existing scripts keep producing; mark a cue required and an unresolved one blocks a
// certified production, while optional ones only produce visible warnings.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const D = require('./drama');

const ROLES = ['music', 'ambience', 'sfx'];
const GAIN = { music: 0.3, ambience: 0.35, sfx: 0.6 };
const tid = () => 'tr-' + crypto.randomBytes(3).toString('hex');

function cueLines(project) { const out = []; for (const sc of project.scenes) for (const l of sc.lines) if (l.cue) out.push({ line: l, scene: sc }); return out; }
const settingsFor = (p, lineId) => (p.cue_settings && p.cue_settings[lineId]) || {};

function scriptCues(project) {
  return cueLines(project).map(({ line, scene }) => {
    const tr = (project.tracks || []).find(t => t.cue_line_id === line.id), st = settingsFor(project, line.id);
    const required = st.required !== undefined ? !!st.required : line.cue.params.required === true;
    return { id: 'cue:' + line.id, line_id: line.id, scene_id: scene.id, role: line.cue.role, description: line.cue.description, params: line.cue.params, required, status: tr ? 'resolved' : 'unresolved', track_id: tr ? tr.id : null, artifact_id: tr ? tr.artifact_id : null };
  });
}
function cueIssues(project) {
  const blocking = [], warnings = [];
  for (const c of scriptCues(project)) if (c.status === 'unresolved') {
    if (c.required) blocking.push({ code: 'cue-unresolved', scope: c.scene_id, cue_id: c.id, message: `a required ${c.role} cue has no audio asset yet` });
    else warnings.push({ code: 'optional-cue-unresolved', scope: c.scene_id, cue_id: c.id, detail: `an optional ${c.role} cue has no audio asset and will be skipped` });
  }
  return { blocking, warnings };
}
function setRequired(project, lineId, required) {
  if (!cueLines(project).some(x => x.line.id === lineId)) throw Object.assign(new Error('cue not found'), { status: 404 });
  project.cue_settings = project.cue_settings || {}; project.cue_settings[lineId] = Object.assign({}, project.cue_settings[lineId], { required: !!required });
  const tr = (project.tracks || []).find(t => t.cue_line_id === lineId); if (tr) tr.required = !!required;
  return project.cue_settings[lineId];
}

const num = (v, d, lo, hi) => { const n = v === undefined || v === '' || v === null ? d : Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
function bind(project, lineId, body, mediaStore) {
  const cl = cueLines(project).find(x => x.line.id === lineId); if (!cl) throw Object.assign(new Error('cue not found'), { status: 404 });
  const art = mediaStore.resolve(String((body && body.artifact_id) || ''));
  if (!art || !['music', 'voice'].includes(art.kind)) throw Object.assign(new Error('that asset is not in the library; choose an audio asset from your Media library'), { status: 400 });
  const c = cl.line.cue, role = c.role;
  let tr = project.tracks.find(t => t.cue_line_id === lineId);
  const isNew = !tr; if (isNew) { tr = { id: tid() }; project.tracks.push(tr); }
  const req = settingsFor(project, lineId).required !== undefined ? settingsFor(project, lineId).required : c.params.required === true;
  Object.assign(tr, {
    role, artifact_id: art.artifact_id, scene_id: cl.scene.id, cue_line_id: lineId, label: c.description,
    start_s: num(body.start_s, isNew ? 0 : tr.start_s || 0, -3600, 36000), trim_start_s: num(body.trim_start_s, tr.trim_start_s || 0, 0, 36000), trim_end_s: body.trim_end_s === undefined ? (tr.trim_end_s == null ? null : tr.trim_end_s) : (body.trim_end_s === null || body.trim_end_s === '' ? null : num(body.trim_end_s, null, 0, 36000)),
    gain: num(body.gain, tr.gain != null ? tr.gain : GAIN[role], 0, 2), fade_in_s: num(body.fade_in_s, tr.fade_in_s != null && !isNew ? tr.fade_in_s : (c.params.fade_in_s || 0), 0, 60), fade_out_s: num(body.fade_out_s, tr.fade_out_s != null && !isNew ? tr.fade_out_s : (c.params.fade_out_s || 0), 0, 60),
    loop: body.loop !== undefined ? !!body.loop : (!isNew ? !!tr.loop : c.params.loop === true), duck: body.duck !== undefined ? !!body.duck : (!isNew ? !!tr.duck : (c.params.duck !== undefined ? c.params.duck : role !== 'sfx')),
    length_s: body.length_s !== undefined ? (body.length_s === null || body.length_s === '' ? null : num(body.length_s, null, 0, 36000)) : (!isNew ? tr.length_s : (c.params.duration_s || null)), priority: num(body.priority, tr.priority || 0, -100, 100), required: !!req,
  });
  return tr;
}
function unbind(project, lineId) { const n = project.tracks.length; project.tracks = project.tracks.filter(t => t.cue_line_id !== lineId); return project.tracks.length < n; }

// Dragging a cue on the timeline detaches it from its script anchor: its start becomes an absolute scene time.
function detach(project, trackId, ctx) {
  const tr = project.tracks.find(t => t.id === trackId); if (!tr) throw Object.assign(new Error('track not found'), { status: 404 });
  if (!tr.cue_line_id) return tr;
  if (!ctx) throw new Error('detach needs the timeline context to compute the absolute time');
  const scene = project.scenes.find(s => s.id === tr.scene_id), tl = require('./drama-timeline').buildSceneTimeline(project, scene, ctx), c = tl.cues.find(x => x.id === trackId);
  if (c && c.resolved) tr.start_s = Math.round(c.start_frame / 48000 * 1000) / 1000;
  delete tr.cue_line_id; return tr;
}

// ── suggestions from the local library ─────────────────────────────────────────────────
const PROCEDURAL = [
  { recipe: 'room_tone', label: 'Room tone', words: ['room', 'tone', 'quiet', 'silence', 'interior', 'warehouse', 'hall', 'air'] },
  { recipe: 'rain', label: 'Rain', words: ['rain', 'storm', 'drizzle', 'downpour', 'roof', 'wet', 'weather'] },
  { recipe: 'static', label: 'Radio static', words: ['static', 'radio', 'comms', 'interference', 'noise', 'crackle'] },
  { recipe: 'hum', label: 'Mains hum', words: ['hum', 'machine', 'engine', 'generator', 'electric', 'power', 'lamp', 'fluorescent'] },
  { recipe: 'beep', label: 'Beep', words: ['beep', 'alarm', 'alert', 'signal', 'ping', 'monitor', 'chime'] },
  { recipe: 'tone', label: 'Pure tone', words: ['tone', 'whine', 'ring', 'drone'] },
];
const tokens = s => String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 3);
function suggest(project, lineId, mediaStore) {
  const cl = cueLines(project).find(x => x.line.id === lineId); if (!cl) throw Object.assign(new Error('cue not found'), { status: 404 });
  const want = new Set(tokens(cl.line.cue.description));
  const pool = [...mediaStore.list('music'), ...mediaStore.list('voice')].filter(a => !(a.meta && (a.meta.drama || /^drama-|clone-trial|audition|preview/.test(a.meta.operation || ''))));
  const scored = pool.map(a => ({ a, score: tokens(a.artifact_id).filter(t => want.has(t)).length })).sort((x, y) => y.score - x.score || y.a.created_at - x.a.created_at);
  const matches = scored.slice(0, 12).map(({ a, score }) => ({ artifact_id: a.artifact_id, kind: a.kind, duration: a.duration, score, url: a.safe_url }));
  const procedural = PROCEDURAL.filter(p => p.words.some(w => want.has(w))).map(p => ({ recipe: p.recipe, label: p.label }));
  if (!procedural.length) procedural.push({ recipe: cl.line.cue.role === 'ambience' ? 'room_tone' : 'tone', label: cl.line.cue.role === 'ambience' ? 'Room tone' : 'Pure tone' });
  return { cue_id: 'cue:' + lineId, role: cl.line.cue.role, matches, procedural, note: 'Suggestions come from your local library only; nothing is downloaded or invented. Procedural effects are generated on this Mac.' };
}

// ── procedural generation (FFmpeg lavfi, fully local) ────────────────────────────────────
const RECIPES = {
  room_tone: (d, o) => `anoisesrc=color=brown:amplitude=0.06:seed=${o.seed}:sample_rate=48000:duration=${d},lowpass=f=420`,
  rain: (d, o) => `anoisesrc=color=pink:amplitude=0.14:seed=${o.seed}:sample_rate=48000:duration=${d},highpass=f=800,lowpass=f=9000,tremolo=f=11:d=0.25`,
  static: (d, o) => `anoisesrc=color=white:amplitude=0.09:seed=${o.seed}:sample_rate=48000:duration=${d},highpass=f=1500,lowpass=f=7000,tremolo=f=23:d=0.5`,
  hum: (d) => `aevalsrc='0.15*sin(2*PI*60*t)+0.06*sin(2*PI*120*t)+0.03*sin(2*PI*180*t)':s=48000:d=${d}`,
  beep: () => 'sine=f=1000:sample_rate=48000:duration=0.3,afade=t=in:d=0.01,afade=t=out:st=0.28:d=0.02',
  tone: (d, o) => `sine=f=${o.frequency}:sample_rate=48000:duration=${d},afade=t=in:d=0.02,afade=t=out:st=${Math.max(0, d - 0.02)}:d=0.02`,
  silence: (d) => `anullsrc=r=48000:cl=stereo:d=${d}`,
};
async function generateProcedural(body, { mediaStore, tools }) {
  const recipe = String((body && body.recipe) || ''); if (!RECIPES[recipe]) throw Object.assign(new Error('unknown recipe ' + JSON.stringify(recipe.slice(0, 30))), { status: 400 });
  const seconds = num(body.seconds, 5, 0.1, 600), freq = Math.round(num(body.frequency, 440, 20, 12000)), seed = Math.round(num(body.seed, 1, 0, 2147483647));
  const graph = RECIPES[recipe](recipe === 'beep' ? 0.3 : seconds, { seed, frequency: freq });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexproc-')), out = path.join(dir, 'p.wav');
  try {
    await tools.run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', graph, '-t', String(recipe === 'beep' ? 0.3 : seconds), '-ac', '2', '-ar', '48000', '-c:a', 'pcm_s16le', '-fflags', '+bitexact', '-flags:a', '+bitexact', out]);
    const rec = mediaStore.finalize(out, { kind: 'music', base: `proc-${recipe}`, worker: 'procedural-sfx', model: 'ffmpeg-lavfi', duration: recipe === 'beep' ? 0.3 : seconds, meta: { operation: 'procedural-sfx', recipe, params: { seconds, frequency: freq, seed } } });
    return rec;
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} }
}

module.exports = { ROLES, scriptCues, cueIssues, setRequired, bind, unbind, detach, suggest, generateProcedural, PROCEDURAL, RECIPES };
