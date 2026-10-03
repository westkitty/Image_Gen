'use strict';

// Audio-drama production core: script parsing, versioned project model, takes, cast binding,
// timeline planning and assembly. Pure of any network/Big Mac concern; rendering is orchestrated
// in drama-service.js through the voice service.
//
// Privacy: an UNSAVED project lives only in server memory. Saving is an explicit user act that
// writes the script/dialogue into the project file under the project state directory. Dialogue is
// never copied into generic job state either way (renders pass saveText:false).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const A = require('./voice-audio');

const SCHEMA = 'dexdiffusion.drama_project.v1';
const KINDS = ['dialogue', 'narration', 'direction'];
const DEFAULT_SETTINGS = { line_gap_s: 0.35, scene_gap_s: 1.0, narrator_name: 'NARRATOR', default_language: 'en' };

// ── Layer 1: deterministic parser ─────────────────────────────────────────
const HEADING_RES = [
  /^\s*(?:INT\.?\/EXT\.?|EXT\.?\/INT\.?|I\/E\.?|INT\.?|EXT\.?)\s+\S.*$/i,
  /^\s*#{1,3}\s+(\S.*?)\s*#*\s*$/,
  /^\s*={2,}\s*(\S.*?)\s*={2,}\s*$/,
  /^\s*(?:SCENE|ACT|CHAPTER)\s+(?:\d+|[IVXLC]+)\b[:.\- ]*.*$/i,
];
const STOP_NAMES = new Set(['NOTE', 'NOTES', 'TITLE', 'SETTING', 'TIME', 'LOCATION', 'SCENE', 'INT', 'EXT', 'CAST', 'AUTHOR', 'DATE', 'CHARACTERS']);
const DIALOGUE_RE = /^\s*([A-Za-z][A-Za-z0-9 _.'\-]{0,38}?)\s*(?:\(([^)]{1,60})\))?\s*:\s*(\S.*)$/;
const PAUSE_RE = /^\s*[\[(]\s*(?:pause|beat|silence)\s*(\d+(?:\.\d+)?)?\s*s?\s*[\])]\s*$/i;
const FULL_DIRECTION_RE = /^\s*[\[(][^\]):]{1,120}[\])]\s*$/;
const isAllCaps = s => /[A-Z]/.test(s) && s === s.toUpperCase();
const keyOf = s => String(s || '').trim().replace(/\s+/g, ' ').toUpperCase();
const headingTitle = line => {
  for (const re of HEADING_RES) { const m = re.exec(line); if (m) return (m[1] || line).trim().replace(/^#+\s*/, ''); }
  return null;
};
function speakerOk(name) {
  const n = name.trim();
  if (!n || STOP_NAMES.has(n.toUpperCase()) || n.split(/\s+/).length > 4) return false;
  if (/[!?,;]/.test(n)) return false;
  return true;
}
// Leading [direction] / (direction) groups → { direction, rest }.
function leadingDirections(text) {
  const dirs = []; let rest = text.trimStart(); let m;
  const re = /^[\[(]([^\])]{1,80})[\])]\s*/;
  while ((m = re.exec(rest))) { dirs.push(m[1].trim()); rest = rest.slice(m[0].length); }
  return { direction: dirs.join(', '), rest };
}

function parseScript(source, opts = {}) {
  const narrator = (opts.narrator || DEFAULT_SETTINGS.narrator_name).trim() || 'NARRATOR';
  const original = String(source == null ? '' : source).replace(/\r\n?/g, '\n');
  const raw = original.split('\n');
  const starts = []; let off = 0; for (const l of raw) { starts.push(off); off += l.length + 1; }
  // pass 1: which mixed-case "Name:" prefixes are real speakers
  const cand = new Map(); let anyCaps = false;
  raw.forEach(l => { const m = DIALOGUE_RE.exec(l); if (m && speakerOk(m[1]) && !headingTitle(l)) { const k = keyOf(m[1]); cand.set(k, (cand.get(k) || 0) + 1); if (isAllCaps(m[1].trim())) anyCaps = true; } });
  const accepted = name => { const k = keyOf(name); return isAllCaps(name.trim()) || (cand.get(k) || 0) >= 2 || !anyCaps; };

  const scenes = []; let scene = null; let lineNo = 0;
  const warnings = [];
  const newScene = title => { scene = { id: 'sc-' + String(scenes.length + 1).padStart(2, '0'), title: title || 'Scene ' + (scenes.length + 1), lines: [] }; scenes.push(scene); return scene; };
  const mk = (o) => ({ id: 'ln-' + String(++lineNo).padStart(3, '0'), speaker: o.speaker, speaker_key: keyOf(o.speaker), kind: o.kind, text: o.text, direction: o.direction || '', pause_before_s: o.pause_before_s == null ? null : o.pause_before_s, pause_after_s: null, render: o.kind !== 'direction', src: o.src, takes: [], active_take_id: null });
  const push = o => { if (!scene) newScene(null); scene.lines.push(mk(o)); return scene.lines[scene.lines.length - 1]; };
  let cur = null, nar = null, pendingPause = null;
  const flushNar = () => { if (nar) { push({ speaker: narrator, kind: 'narration', text: nar.text, src: { start: nar.s, end: nar.e }, pause_before_s: nar.pause }); nar = null; } };
  const endAll = () => { flushNar(); cur = null; };

  for (let i = 0; i < raw.length; i++) {
    const line = raw[i], t = line.trim(), s = starts[i], e = s + line.length;
    if (!t) { endAll(); continue; }
    const h = headingTitle(line);
    if (h) { endAll(); newScene(h); continue; }
    const pz = PAUSE_RE.exec(line);
    if (pz) { endAll(); pendingPause = pz[1] ? Number(pz[1]) : 0.6; continue; }
    if (FULL_DIRECTION_RE.test(line) && !DIALOGUE_RE.test(line)) { endAll(); push({ speaker: narrator, kind: 'direction', text: t.replace(/^[\[(]\s*|\s*[\])]$/g, ''), src: { start: s, end: e } }); continue; }
    const dm = DIALOGUE_RE.exec(line);
    if (dm && speakerOk(dm[1]) && accepted(dm[1])) {
      endAll();
      const ld = leadingDirections(dm[3]);
      const dir = [dm[2], ld.direction].filter(Boolean).join(', ');
      cur = push({ speaker: dm[1].trim(), kind: 'dialogue', text: ld.rest, direction: dir, src: { start: s + line.indexOf(dm[3]), end: e }, pause_before_s: pendingPause }); pendingPause = null;
      continue;
    }
    // Fountain-style cue: ALL-CAPS name on its own line, dialogue on the following lines
    if (isAllCaps(t) && t.length <= 30 && !/[.!?]$/.test(t) && speakerOk(t) && i + 1 < raw.length && raw[i + 1].trim() && !headingTitle(raw[i + 1]) && !(cur && starts[i] === (cur.src.end + 1))) {
      endAll();
      let j = i + 1, dir = '';
      const par = /^\s*[\[(]([^\])]{1,80})[\])]\s*$/.exec(raw[j]);
      if (par) { dir = par[1].trim(); j++; }
      const body = []; let bs = null, be = null;
      while (j < raw.length && raw[j].trim() && !headingTitle(raw[j])) { if (bs == null) bs = starts[j]; be = starts[j] + raw[j].length; body.push(raw[j].trim()); j++; }
      if (body.length) {
        const ld = leadingDirections(body.join(' '));
        push({ speaker: t, kind: 'dialogue', text: ld.rest, direction: [dir, ld.direction].filter(Boolean).join(', '), src: { start: bs, end: be }, pause_before_s: pendingPause }); pendingPause = null;
        i = j - 1; continue;
      }
    }
    if (cur) { cur.text += ' ' + t; cur.src.end = e; continue; }      // wrapped dialogue
    if (nar) { nar.text += ' ' + t; nar.e = e; continue; }            // wrapped narration
    nar = { text: t, s, e, pause: pendingPause }; pendingPause = null;
  }
  endAll();
  const speakers = new Map();
  for (const sc of scenes) for (const l of sc.lines) {
    if (l.kind === 'direction') continue;
    const k = l.speaker_key; if (!speakers.has(k)) speakers.set(k, { key: k, name: l.speaker, lines: 0, kinds: { dialogue: 0, narration: 0 } });
    const sp = speakers.get(k); sp.lines++; sp.kinds[l.kind]++;
  }
  if (!scenes.length) warnings.push('No lines were found. Use "NAME: text" lines, screenplay cues, or plain narration paragraphs.');
  else if (![...speakers.values()].some(s => s.kinds.dialogue)) warnings.push('No dialogue lines were detected (only narration). Use "NAME: text" if you expected speakers.');
  const firstHeading = scenes.length && headingTitle(raw.find(l => headingTitle(l)) || '') || null;
  return { source_length: original.length, title: firstHeading, scenes, speakers: [...speakers.values()], warnings };
}

// ── Layer 2: optional LLM parse, validated against a strict schema ───────────────
const LLM_SYSTEM = `You convert a script into structured lines for an audio drama. Output ONLY JSON:
{"scenes":[{"title":"string","lines":[{"speaker":"string","kind":"dialogue|narration|direction","text":"string","direction":"string"}]}]}
Rules: copy each line's text EXACTLY as it appears in the script (verbatim substring, never reword, never summarize, never add words);
split narration from dialogue; "direction" is a short delivery cue such as "whispering" taken from the script (or ""); use speaker "NARRATOR" for narration;
keep the original order; do not invent lines.`;
const normWs = s => String(s).replace(/\s+/g, ' ').trim();
// Accepts only output whose every text is a verbatim (whitespace-normalised) substring of the original, in order.
function validateLlmParse(original, parsed, opts = {}) {
  const errors = [], rejected = [];
  if (!parsed || !Array.isArray(parsed.scenes) || !parsed.scenes.length) return { ok: false, errors: ['response has no scenes array'], rejected };
  const norm = normWs(original); let cursor = 0, n = 0, covered = 0;
  const narrator = opts.narrator || DEFAULT_SETTINGS.narrator_name;
  const scenes = [];
  parsed.scenes.forEach((sc, si) => {
    if (!sc || !Array.isArray(sc.lines)) { errors.push(`scene ${si + 1}: lines must be an array`); return; }
    const out = { id: 'sc-' + String(scenes.length + 1).padStart(2, '0'), title: String(sc.title || '').slice(0, 120) || 'Scene ' + (scenes.length + 1), lines: [] };
    for (const l of sc.lines) {
      const kind = KINDS.includes(l && l.kind) ? l.kind : null, text = l && typeof l.text === 'string' ? normWs(l.text) : '';
      if (!kind || !text || text.length > 4000 || typeof l.speaker !== 'string' || l.speaker.length > 60) { errors.push(`line ${n + 1}: invalid kind/speaker/text`); n++; continue; }
      const at = norm.indexOf(text, cursor);
      if (at < 0) { rejected.push({ index: n, speaker: l.speaker, text: text.slice(0, 80) }); n++; continue; }
      cursor = at + text.length; covered += text.length; n++;
      const speaker = kind === 'narration' || kind === 'direction' ? narrator : l.speaker.trim();
      out.lines.push({ id: 'ln-' + String(n).padStart(3, '0'), speaker, speaker_key: keyOf(speaker), kind, text, direction: typeof l.direction === 'string' ? l.direction.trim().slice(0, 120) : '', pause_before_s: null, pause_after_s: null, render: kind !== 'direction', src: null, takes: [], active_take_id: null });
    }
    if (out.lines.length) scenes.push(out);
  });
  const warnings = [];
  if (rejected.length) errors.push(`${rejected.length} line(s) were not verbatim text from your script and were rejected: the model may not rewrite dialogue`);
  if (!rejected.length && !errors.length && covered < norm.length * 0.5) warnings.push('The parse covers less than half of your script text; check for dropped passages.');
  if (errors.length) return { ok: false, errors, rejected };
  const speakers = new Map();
  for (const sc of scenes) for (const l of sc.lines) if (l.kind !== 'direction') { const sp = speakers.get(l.speaker_key) || { key: l.speaker_key, name: l.speaker, lines: 0, kinds: { dialogue: 0, narration: 0 } }; sp.lines++; sp.kinds[l.kind]++; speakers.set(l.speaker_key, sp); }
  return { ok: true, errors: [], rejected: [], parsed: { source_length: original.length, title: null, scenes, speakers: [...speakers.values()], warnings } };
}
async function parseWithLlm(source, { chat, narrator } = {}) {
  const text = String(source || '');
  if (text.length > 14000) return { ok: false, errors: ['script is too long for one LLM parse (14,000 characters); parse it deterministically or split it into acts'], rejected: [] };
  let reply;
  try { reply = await chat([{ role: 'system', content: LLM_SYSTEM }, { role: 'user', content: text }]); }
  catch (e) { return { ok: false, errors: ['local model unavailable: ' + e.message], rejected: [] }; }
  let json;
  try { const m = /\{[\s\S]*\}/.exec(String(reply)); json = JSON.parse(m ? m[0] : reply); } catch (_) { return { ok: false, errors: ['the model did not return valid JSON'], rejected: [] }; }
  return validateLlmParse(text, json, { narrator });
}

// ── Project model ─────────────────────────────────────────────────────────
const sid = p => p + '-' + crypto.randomBytes(4).toString('hex');
function newProject({ title, source_script, parsed, settings }) {
  const p = {
    schema: SCHEMA, id: sid('dp'), title: String(title || parsed.title || 'Untitled drama').slice(0, 120), source_script: String(source_script || ''),
    saved: false, scenes: parsed.scenes.map(s => ({ id: s.id, title: s.title, lines: s.lines })), actors: [], tracks: [], exports: [],
    settings: Object.assign({}, DEFAULT_SETTINGS, settings || {}), parse_warnings: parsed.warnings || [], created_at: Date.now(), updated_at: Date.now(),
  };
  ensureActors(p);
  return p;
}
function allLines(p) { return p.scenes.flatMap(s => s.lines.map(l => ({ scene: s, line: l }))); }
function findLine(p, lineId) { for (const s of p.scenes) { const l = s.lines.find(x => x.id === lineId); if (l) return { scene: s, line: l }; } return null; }
function ensureActors(p) {
  const have = new Map(p.actors.map(a => [a.speaker_key, a]));
  for (const { line } of allLines(p)) {
    if (line.kind === 'direction' || have.has(line.speaker_key)) continue;
    const a = { id: sid('ac'), speaker: line.speaker, speaker_key: line.speaker_key, voice_profile_id: null, default_direction: '' };
    p.actors.push(a); have.set(a.speaker_key, a);
  }
  return p;
}
const actorFor = (p, key) => p.actors.find(a => a.speaker_key === key) || null;
function renderableLines(p, sceneId) { return allLines(p).filter(x => (!sceneId || x.scene.id === sceneId) && x.line.render !== false && x.line.kind !== 'direction' && String(x.line.text).trim()); }
// Rendering is blocked only for speakers that actually have renderable lines and no bound voice.
function unresolvedSpeakers(p, sceneId) {
  const out = new Map();
  for (const { line } of renderableLines(p, sceneId)) {
    const a = actorFor(p, line.speaker_key);
    if (!(line.profile_override || (a && a.voice_profile_id))) { const o = out.get(line.speaker_key) || { speaker: line.speaker, key: line.speaker_key, lines: 0 }; o.lines++; out.set(line.speaker_key, o); }
  }
  return [...out.values()];
}
function setLine(p, lineId, patch) {
  const f = findLine(p, lineId); if (!f) return null;
  const l = f.line, x = patch || {};
  if (x.speaker !== undefined) { const sp = String(x.speaker).trim().slice(0, 60); if (sp) { l.speaker = sp; l.speaker_key = keyOf(sp); } }
  if (KINDS.includes(x.kind)) { l.kind = x.kind; if (x.kind === 'direction') l.render = false; else if (x.render === undefined && l.render === false && x.kind !== undefined) l.render = true; }
  if (x.render !== undefined) l.render = !!x.render;
  if (x.direction !== undefined) l.direction = String(x.direction).slice(0, 160);
  for (const k of ['pause_before_s', 'pause_after_s']) if (x[k] !== undefined) l[k] = x[k] === null || x[k] === '' ? null : Math.max(0, Math.min(30, Number(x[k]) || 0));
  if (x.text !== undefined) { const t = String(x.text).slice(0, 8000); if (t !== l.text) { l.text = t; l.edited = true; } }
  if (x.engine_override !== undefined) l.engine_override = x.engine_override || null;
  if (x.profile_override !== undefined) l.profile_override = x.profile_override || null;
  ensureActors(p);
  return l;
}
function deleteLine(p, lineId) { const f = findLine(p, lineId); if (!f) return false; f.scene.lines = f.scene.lines.filter(l => l.id !== lineId); return true; }
function addLine(p, sceneId, { afterLineId, speaker, text, kind = 'dialogue' }) {
  const sc = p.scenes.find(s => s.id === sceneId); if (!sc) return null;
  const ids = allLines(p).map(x => Number(String(x.line.id).replace(/\D/g, '')) || 0);
  const sp = String(speaker || p.settings.narrator_name).trim();
  const l = { id: 'ln-' + String(Math.max(0, ...ids) + 1).padStart(3, '0'), speaker: sp, speaker_key: keyOf(sp), kind: KINDS.includes(kind) ? kind : 'dialogue', text: String(text || ''), direction: '', pause_before_s: null, pause_after_s: null, render: kind !== 'direction', src: null, takes: [], active_take_id: null, edited: true };
  const at = afterLineId ? sc.lines.findIndex(x => x.id === afterLineId) : sc.lines.length - 1;
  sc.lines.splice(at + 1, 0, l); ensureActors(p); return l;
}
function bindActor(p, actorId, profileId, defaultDirection) {
  const a = p.actors.find(x => x.id === actorId); if (!a) return null;
  if (profileId !== undefined) a.voice_profile_id = profileId || null;
  if (defaultDirection !== undefined) a.default_direction = String(defaultDirection).slice(0, 200);
  return a;
}
function lineStatus(line) {
  const t = line.takes || [];
  if (t.some(x => x.status === 'rendering')) return 'rendering';
  if (line.active_take_id && t.some(x => x.id === line.active_take_id && x.status === 'complete')) return 'generated';
  if (t.some(x => x.status === 'complete')) return 'generated';
  if (t.length && t[t.length - 1].status === 'failed') return 'failed';
  return 'empty';
}
function addTake(p, lineId, take) {
  const f = findLine(p, lineId); if (!f) return null;
  const t = Object.assign({ id: sid('tk'), line_id: lineId, status: 'rendering', created_at: Date.now(), artifact_id: null, duration: null, error: null }, take);
  f.line.takes.push(t); // new takes never replace earlier ones
  return t;
}
function completeTake(p, lineId, takeId, patch) {
  const f = findLine(p, lineId); if (!f) return null;
  const t = f.line.takes.find(x => x.id === takeId); if (!t) return null;
  Object.assign(t, patch);
  if (t.status === 'complete' && !f.line.active_take_id) f.line.active_take_id = t.id; // first good take becomes active; later takes wait for the user
  return t;
}
function selectTake(p, lineId, takeId) {
  const f = findLine(p, lineId); if (!f) return null;
  const t = f.line.takes.find(x => x.id === takeId && x.status === 'complete'); if (!t) return null;
  f.line.active_take_id = t.id; return t;
}

// ── Timeline planning + assembly ────────────────────────────────────────────
// takeDuration(take) → seconds. Returns ordered voice placements and scene spans.
function planTimeline(p, { sceneId, takeDuration }) {
  const items = [], scenes = []; let t = 0; const missing = [];
  const scs = p.scenes.filter(s => !sceneId || s.id === sceneId);
  scs.forEach((sc, si) => {
    const start = t; let prevAfter = null;
    for (const line of sc.lines) {
      if (line.render === false || line.kind === 'direction' || !String(line.text).trim()) continue;
      const take = (line.takes || []).find(x => x.id === line.active_take_id && x.status === 'complete');
      if (!take) { missing.push({ scene_id: sc.id, line_id: line.id, speaker: line.speaker }); continue; }
      const dur = takeDuration(take); if (!(dur > 0)) { missing.push({ scene_id: sc.id, line_id: line.id, speaker: line.speaker, reason: 'take audio missing' }); continue; }
      if (prevAfter != null) t += prevAfter;
      t += line.pause_before_s == null ? 0 : line.pause_before_s;
      items.push({ scene_id: sc.id, line_id: line.id, take_id: take.id, artifact_id: take.artifact_id, speaker: line.speaker, start_s: t, duration_s: dur });
      t += dur;
      prevAfter = line.pause_after_s == null ? p.settings.line_gap_s : line.pause_after_s;
    }
    scenes.push({ id: sc.id, title: sc.title, start_s: start, end_s: t });
    if (si < scs.length - 1) t += (prevAfter == null ? 0 : prevAfter) + p.settings.scene_gap_s;
  });
  return { items, scenes, total_s: t, missing };
}
// loadAudio(artifactId) → audio object. Optional tracks (music/ambience/sfx) are mixed with start/trim/gain/fades.
function assemble(p, { sceneId, takeDuration, loadAudio, loadTrackAudio }) {
  const plan = planTimeline(p, { sceneId, takeDuration });
  if (plan.missing.length) { const e = new Error(`${plan.missing.length} renderable line(s) have no generated take`); e.missing = plan.missing; e.gate = 'missing-takes'; throw e; }
  if (!plan.items.length) { const e = new Error('nothing to assemble: no renderable lines'); e.gate = 'empty'; throw e; }
  const sceneStart = Object.fromEntries(plan.scenes.map(s => [s.id, s.start_s]));
  const tracks = (p.tracks || []).filter(t => !sceneId || !t.scene_id || t.scene_id === sceneId);
  const rate = tracks.length ? 48000 : 24000, channels = tracks.length ? 2 : 1;
  const clips = plan.items.map(it => ({ audio: loadAudio(it.artifact_id), startSec: it.start_s }));
  const trackItems = [];
  for (const tr of tracks) {
    const base = tr.scene_id && sceneStart[tr.scene_id] != null ? sceneStart[tr.scene_id] : 0;
    const audio = loadTrackAudio(tr.artifact_id);
    if (!audio) continue;
    clips.push({ audio, startSec: base + (tr.start_s || 0), gain: tr.gain == null ? 0.35 : tr.gain, fadeInSec: tr.fade_in_s || 0, fadeOutSec: tr.fade_out_s || 0, trimStartSec: tr.trim_start_s || 0, trimEndSec: tr.trim_end_s == null ? undefined : tr.trim_end_s });
    trackItems.push({ id: tr.id, role: tr.role, artifact_id: tr.artifact_id, start_s: base + (tr.start_s || 0), gain: tr.gain == null ? 0.35 : tr.gain });
  }
  const mixed = A.mix(clips, { sampleRate: rate, channels });
  const manifest = {
    schema: 'dexdiffusion.drama_manifest.v1', project_id: p.id, title: p.title, scope: sceneId ? 'scene' : 'project', scene_id: sceneId || null,
    generated_at: new Date().toISOString(), sample_rate: rate, channels, duration_s: A.duration(mixed),
    settings: { line_gap_s: p.settings.line_gap_s, scene_gap_s: p.settings.scene_gap_s }, scenes: plan.scenes, items: plan.items, tracks: trackItems,
  };
  return { audio: mixed, manifest, plan };
}

// ── Persistence (explicit save only) ───────────────────────────────────────────
function atomicWrite(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
  const fd = fs.openSync(tmp, 'w', 0o600);
  try { fs.writeSync(fd, JSON.stringify(obj, null, 1) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}
// Migrate older schema revisions in place (v0 had no actors/tracks/exports/settings).
function migrate(p) {
  if (!p || typeof p !== 'object') return null;
  p.schema = SCHEMA;
  p.settings = Object.assign({}, DEFAULT_SETTINGS, p.settings || {});
  p.actors = Array.isArray(p.actors) ? p.actors : []; p.tracks = Array.isArray(p.tracks) ? p.tracks : []; p.exports = Array.isArray(p.exports) ? p.exports : [];
  p.scenes = Array.isArray(p.scenes) ? p.scenes : [];
  for (const sc of p.scenes) for (const l of sc.lines || []) {
    l.takes = Array.isArray(l.takes) ? l.takes : []; if (l.render === undefined) l.render = l.kind !== 'direction'; if (!l.speaker_key) l.speaker_key = keyOf(l.speaker);
    for (const t of l.takes) if (t.status === 'rendering') { t.status = 'failed'; t.error = 'interrupted: the console restarted before this take finished (it was not completed)'; }
  }
  ensureActors(p);
  return p;
}
function createDramaStore({ root, now = () => Date.now() }) {
  const dir = path.resolve(root);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const projects = new Map();
  const file = id => path.join(dir, id + '.json');
  const ID = /^dp-[a-f0-9]{8}$/;
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!/^dp-[a-f0-9]{8}\.json$/.test(f)) continue;
      try { const p = migrate(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))); if (p) { p.saved = true; projects.set(p.id, p); } } catch (_) {}
    }
  } catch (_) {}
  const persist = p => { if (p.saved) { p.updated_at = now(); atomicWrite(file(p.id), p); } else p.updated_at = now(); };
  return {
    root: dir,
    create(input) { const p = newProject(input); projects.set(p.id, p); return p; },
    get: id => projects.get(id) || null,
    list: () => [...projects.values()].map(p => ({ id: p.id, title: p.title, saved: !!p.saved, scenes: p.scenes.length, lines: allLines(p).length, updated_at: p.updated_at })).sort((a, b) => b.updated_at - a.updated_at),
    save(id) { const p = projects.get(id); if (!p) return null; p.saved = true; persist(p); return p; },
    // Keep working on a saved project without keeping it on disk: removes the file; memory copy stays until restart.
    unsave(id) { const p = projects.get(id); if (!p) return null; p.saved = false; try { fs.unlinkSync(file(id)); } catch (_) {} return p; },
    remove(id) { const had = projects.delete(id); try { fs.unlinkSync(file(id)); } catch (_) {} return had; },
    touch(p) { persist(p); return p; },
    valid: id => ID.test(String(id)),
    _reload() { projects.clear(); for (const f of fs.readdirSync(dir)) if (/^dp-[a-f0-9]{8}\.json$/.test(f)) { const p = migrate(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))); p.saved = true; projects.set(p.id, p); } },
  };
}

module.exports = {
  SCHEMA, KINDS, DEFAULT_SETTINGS, parseScript, validateLlmParse, parseWithLlm, LLM_SYSTEM, newProject, allLines, findLine, ensureActors, actorFor, renderableLines, unresolvedSpeakers,
  setLine, deleteLine, addLine, bindActor, lineStatus, addTake, completeTake, selectTake, planTimeline, assemble, createDramaStore, migrate, keyOf,
};
