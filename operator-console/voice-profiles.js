'use strict';

// Persistent voice profiles ("actors"): project-owned durable state on the MacBook.
//
//   <root>/<profile-id>/profile.json          schema dexdiffusion.voice_profile.v1 (atomic writes)
//   <root>/<profile-id>/samples/<sample>.wav  approved reference samples (normalised PCM16 mono 24 kHz)
//
// Reference audio never leaves the MacBook except as a per-render copy inside a Big Mac job
// directory that is removed afterwards. Nothing here touches the Big Mac model directory and
// temporary staging is never promoted by accident: a sample enters a profile only through
// addSample(), which re-encodes and validates it.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const A = require('./voice-audio');
const E = require('./voice-engines');
const { KOKORO_VOICES } = require('./media-bridge');

const SCHEMA = 'dexdiffusion.voice_profile.v1';
const TYPES = ['cloned', 'designed', 'preset'];
const MAX_SAMPLES = 8, MAX_SAMPLE_BYTES = 12 * 1024 * 1024;
const ID_RE = /^vp-[a-f0-9]{10}$/, SID_RE = /^sm-[a-f0-9]{10}$/;

// JSON objects are pretty-printed; Buffers (WAV samples) and strings are written byte-for-byte.
function atomicWrite(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
  const fd = fs.openSync(tmp, 'w', 0o600);
  try { fs.writeSync(fd, Buffer.isBuffer(data) || typeof data === 'string' ? data : JSON.stringify(data, null, 1) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}
const clip = (v, n) => String(v == null ? '' : v).slice(0, n);

// ── Character voice design ────────────────────────────────────────────────────────────
// A design spec separates ENDURING voice identity (who the character sounds like) from performance defaults and
// pronunciation notes, which never enter the identity description. Scene-specific acting direction is not part of a
// design at all: it is supplied per line at render time.
const IDENTITY_KEYS = ['age', 'gender_presentation', 'accent', 'linguistic_style', 'register', 'timbre', 'resonance', 'texture', 'breathiness', 'personality', 'language'];
const PERFORMANCE_KEYS = ['pacing', 'energy', 'default_direction'];
function cleanDesign(d, prev) {
  const src = d && typeof d === 'object' ? d : {};
  const pick = (o, keys, n) => Object.fromEntries(keys.map(k => [k, clip(o && o[k], n).trim()]).filter(([, v]) => v));
  return {
    version: 1,
    identity: pick(src.identity, IDENTITY_KEYS, 80), performance: pick(src.performance, PERFORMANCE_KEYS, 160),
    pronunciation_notes: clip(src.pronunciation_notes, 500), fx_preset: clip(src.fx_preset, 40) || null,
    manual_description: src.manual_description === undefined ? !!(prev && prev.manual_description) : !!src.manual_description,
  };
}
function composeDescription(design) {
  const i = (design && design.identity) || {}, bits = [];
  const who = [i.age, i.gender_presentation].filter(Boolean).join(' ');
  if (who) bits.push(`A ${who} voice${i.accent ? ' with ' + (/^(a|an)\s/i.test(i.accent) ? i.accent : 'a ' + i.accent + ' accent') : ''}.`);
  else if (i.accent) bits.push(`A voice with a ${i.accent} accent.`);
  if (i.linguistic_style) bits.push(`Speaks ${i.linguistic_style}.`);
  const qual = [i.register && `${i.register} register`, i.timbre && `${i.timbre} timbre`, i.resonance && `${i.resonance} resonance`, i.texture && `${i.texture} texture`, i.breathiness && `${i.breathiness} breathiness`].filter(Boolean);
  if (qual.length) bits.push(qual.join(', ').replace(/^./, c => c.toUpperCase()) + '.');
  if (i.personality) bits.push(`${i.personality.replace(/^./, c => c.toUpperCase())}.`.replace(/\.\.$/, '.'));
  return bits.join(' ').slice(0, 1000);
}
const CONSENT_KINDS = ['unspecified', 'fictional', 'own-voice', 'licensed', 'real-person'];
const REVIEW_STATES = ['unreviewed', 'approved', 'rejected'];
const lockedError = what => Object.assign(new Error(`this voice is locked (${what} cannot change); unlock it first`), { status: 409, gate: 'profile-locked' });
// Defaults applied on READ so legacy files load unchanged (the file is only rewritten by an explicit save).
function withDefaults(p) {
  if (!p) return p;
  if (p.identity_version == null) p.identity_version = 1;
  if (!p.approval) p.approval = { state: 'draft', at: null, note: '', audition_id: null };
  if (p.locked == null) p.locked = false;
  if (!p.consent) p.consent = { kind: 'unspecified', note: '', confirmed_at: null };
  if (!p.origin) p.origin = { kind: 'manual' };
  if (!p.trial) p.trial = { passed: false, runs: [] };
  if (p.design === undefined) p.design = null;
  for (const sm of p.samples || []) if (!sm.review) sm.review = { state: 'unreviewed', note: '', at: null };
  return p;
}
const ORIGIN_KINDS = ['manual', 'designed', 'promoted', 'imported'];
function cleanOrigin(o, fallback) {
  const src = o && typeof o === 'object' ? o : {};
  const kind = ORIGIN_KINDS.includes(src.kind) ? src.kind : fallback;
  const out = { kind };
  for (const k of ['design_profile_id', 'audition_id', 'design_description', 'model', 'runtime', 'engine', 'language', 'reference_sha256', 'imported_from', 'original_id', 'bank_id']) if (src[k] !== undefined && src[k] !== null) out[k] = clip(src[k], 1000);
  if (src.seed !== undefined && src.seed !== null) out.seed = Number(src.seed);
  if (src.design_identity_version !== undefined) out.design_identity_version = Number(src.design_identity_version);
  if (src.approved_at !== undefined) out.approved_at = Number(src.approved_at);
  return out;
}
function readiness(p) {
  const checks = [];
  const add = (id, ok, message) => checks.push({ id, ok: !!ok, message });
  const eng = p.compatible_engines && p.compatible_engines[0];
  add('valid', p.validation && p.validation.state !== 'invalid', 'passes engine validation');
  if (p.type === 'preset') return { ready: checks.every(c => c.ok), checks };
  add('approved', p.approval && p.approval.state === 'approved', 'a human approved this voice');
  if (p.type === 'cloned') {
    const act = (p.samples || []).find(x => x.active);
    add('sample-reviewed', act && act.review && act.review.state === 'approved', 'the active reference sample was reviewed by ear');
    add('consent', p.consent && p.consent.kind !== 'unspecified', 'consent/permission category is recorded');
    if (p.origin && p.origin.kind === 'promoted') add('trial', p.trial && p.trial.passed, 'the clone was trialled across several dialogue lines and accepted');
    else add('trial', true, 'not a promoted clone');
  }
  return { ready: checks.every(c => c.ok), checks, engine: eng || null };
}


// root: durable directory. ingest(srcPath) → Buffer of a PCM WAV (production: ffmpeg → mono 24 kHz).
function createProfileStore({ root, ingest, now = () => Date.now() }) {
  const base = path.resolve(root);
  fs.mkdirSync(base, { recursive: true, mode: 0o700 });
  const dirOf = id => { if (!ID_RE.test(String(id))) return null; return path.join(base, id); };
  const fileOf = id => { const d = dirOf(id); return d && path.join(d, 'profile.json'); };

  function readRaw(id) { const f = fileOf(id); if (!f) return null; try { return withDefaults(JSON.parse(fs.readFileSync(f, 'utf8'))); } catch (_) { return null; } }
  function fingerprint(p) { // identifies the exact sample set + settings a render used (cache key for a future prompt cache)
    const act = (p.samples || []).find(s => s.active);
    return crypto.createHash('sha256').update(JSON.stringify([p.type, p.description || '', p.preset_voice || '', act ? [act.id, act.sha256, act.transcript] : null])).digest('hex').slice(0, 16);
  }
  function revalidate(p) {
    const engines = E.compatibleEngines(p);
    p.compatible_engines = engines;
    p.validation = { engines: {} };
    let state = 'valid';
    for (const eng of engines) {
      const r = E.validateProfileForEngine(p, eng);
      p.validation.engines[eng] = r;
      if (!r.ok) state = 'invalid'; else if (r.warnings.length && state === 'valid') state = 'warnings';
    }
    p.validation.state = engines.length ? state : 'invalid';
    p.fingerprint = fingerprint(p);
    return p;
  }
  function save(p) {
    p.updated_at = now(); const prev = p.fingerprint; revalidate(p);
    if (prev && prev !== p.fingerprint) p.identity_version = (p.identity_version || 1) + 1;
    atomicWrite(fileOf(p.id), p); return p;
  }
  function assertEditable(p, what) { if (p.locked) throw lockedError(what); }
  function view(p) { return p && Object.assign({}, p, { readiness: readiness(p), samples: (p.samples || []).map(s => Object.assign({}, s, { audio_url: `/api/voice/profiles/${p.id}/samples/${s.id}/audio`, diagnostics_disclaimer: 'Signal diagnostics only; not a measure of clone fidelity. Audition by ear.' })) }); }

  function create(input) {
    const i = input || {};
    const type = TYPES.includes(i.type) ? i.type : null;
    if (!type) throw Object.assign(new Error('type must be cloned, designed or preset'), { status: 400 });
    const name = clip(i.name, 80).trim();
    if (!name) throw Object.assign(new Error('name is required'), { status: 400 });
    if (i.preset_voice && !KOKORO_VOICES.includes(i.preset_voice)) throw Object.assign(new Error('unknown Kokoro voice'), { status: 400 });
    const p = {
      schema: SCHEMA, id: i.id && ID_RE.test(String(i.id)) && !fs.existsSync(dirOf(i.id)) ? i.id : 'vp-' + crypto.randomBytes(5).toString('hex'), name, type, language: clip(i.language || 'en', 8),
      preferred_engine: null, description: clip(i.description, 1000), preset_voice: type === 'preset' ? (i.preset_voice || 'af_heart') : null,
      default_direction: clip(i.default_direction, 200), default_speed: type === 'preset' ? Math.max(0.5, Math.min(2, Number(i.default_speed) || 1)) : null,
      notes: clip(i.notes, 1000), samples: [], created_at: now(), updated_at: now(),
      identity_version: 1, approval: { state: 'draft', at: null, note: '', audition_id: null }, locked: false,
      consent: { kind: CONSENT_KINDS.includes(i.consent && i.consent.kind) ? i.consent.kind : 'unspecified', note: clip(i.consent && i.consent.note, 500), confirmed_at: Number.isFinite(i.consent && i.consent.confirmed_at) ? i.consent.confirmed_at : null },
      origin: cleanOrigin(i.origin, type === 'designed' && i.design ? 'designed' : 'manual'), trial: { passed: false, runs: [] }, design: null,
    };
    if (i.design && type === 'designed') { p.design = cleanDesign(i.design); if (!p.design.manual_description) p.description = composeDescription(p.design) || p.description; }
    p.preferred_engine = E.compatibleEngines(p).includes(i.preferred_engine) ? i.preferred_engine : E.compatibleEngines(p)[0];
    fs.mkdirSync(path.join(dirOf(p.id), 'samples'), { recursive: true, mode: 0o700 });
    return view(save(p));
  }
  function get(id) { const p = readRaw(id); return p ? view(revalidate(p)) : null; }
  function list() {
    let ids = []; try { ids = fs.readdirSync(base).filter(n => ID_RE.test(n)); } catch (_) {}
    return ids.map(get).filter(Boolean).sort((a, b) => b.updated_at - a.updated_at);
  }
  function update(id, patch) {
    const p = readRaw(id); if (!p) return null;
    const x = patch || {};
    const identityTouch = x.description !== undefined || x.preset_voice !== undefined || x.design !== undefined || x.language !== undefined || x.preferred_engine !== undefined;
    if (identityTouch && p.locked) {
      const changes = (x.description !== undefined && clip(x.description, 1000) !== p.description) || (x.preset_voice !== undefined && x.preset_voice !== p.preset_voice) || (x.design !== undefined && JSON.stringify(cleanDesign(x.design, p.design).identity) !== JSON.stringify(((p.design || {}).identity) || {})) || (x.language !== undefined && clip(x.language, 8) !== p.language);
      if (changes) throw lockedError('its identity');
    }
    if (x.name !== undefined) { const n = clip(x.name, 80).trim(); if (!n) throw Object.assign(new Error('name cannot be empty'), { status: 400 }); p.name = n; }
    for (const [k, n] of [['description', 1000], ['default_direction', 200], ['notes', 1000], ['language', 8]]) if (x[k] !== undefined) p[k] = clip(x[k], n);
    if (x.description !== undefined && p.design) p.design.manual_description = true;
    if (x.design !== undefined && p.type === 'designed') {
      const d = cleanDesign(x.design, p.design); if (x.description === undefined && !d.manual_description) { const c = composeDescription(d); if (c) p.description = c; }
      p.design = d;
    }
    if (x.preset_voice !== undefined) { if (!KOKORO_VOICES.includes(x.preset_voice)) throw Object.assign(new Error('unknown Kokoro voice'), { status: 400 }); p.preset_voice = x.preset_voice; }
    if (x.default_speed !== undefined && p.type === 'preset') p.default_speed = Math.max(0.5, Math.min(2, Number(x.default_speed) || 1));
    if (x.preferred_engine !== undefined) { if (!E.compatibleEngines(p).includes(x.preferred_engine)) throw Object.assign(new Error('engine is not compatible with this voice type'), { status: 400 }); p.preferred_engine = x.preferred_engine; }
    return view(save(p));
  }
  // ---- lifecycle: APPROVE → LOCK → REUSE ----------------------------------------------------------
  function approve(id, { note, audition_id } = {}) {
    const p = readRaw(id); if (!p) return null;
    p.approval = { state: 'approved', at: now(), note: clip(note, 500), audition_id: audition_id ? clip(audition_id, 40) : null, identity_version: p.identity_version };
    return view(save(p));
  }
  function lock(id) {
    const p = readRaw(id); if (!p) return null;
    if (!p.approval || p.approval.state !== 'approved') throw Object.assign(new Error('approve the voice before locking it'), { status: 409, gate: 'profile-not-approved' });
    p.locked = true; p.locked_at = now(); return view(save(p));
  }
  function unlock(id) {
    const p = readRaw(id); if (!p) return null;
    p.locked = false; p.locked_at = null; p.approval = { state: 'draft', at: null, note: '', audition_id: null }; return view(save(p));
  }
  function setConsent(id, { kind, note, confirm } = {}) {
    const p = readRaw(id); if (!p) return null;
    if (!CONSENT_KINDS.includes(kind) || kind === 'unspecified') throw Object.assign(new Error('consent kind must be one of: ' + CONSENT_KINDS.slice(1).join(', ')), { status: 400 });
    if (kind === 'real-person' && (clip(note, 500).trim().length < 10 || confirm !== true)) throw Object.assign(new Error('a real-person voice needs a permission note (who allowed what, and when) and explicit confirmation'), { status: 400, gate: 'consent-required' });
    p.consent = { kind, note: clip(note, 500), confirmed_at: now() }; return view(save(p));
  }
  function linkClone(designId, cloneId) { const p = readRaw(designId); if (!p) return null; p.promoted_clone_ids = [...new Set([...(p.promoted_clone_ids || []), cloneId])]; return view(save(p)); }
  function setTrial(id, trial) { const p = readRaw(id); if (!p) return null; p.trial = Object.assign({ passed: false, runs: [] }, trial); return view(save(p)); }
  function setOrigin(id, origin) { const p = readRaw(id); if (!p) return null; p.origin = cleanOrigin(origin, 'manual'); return view(save(p)); }
  function remove(id) {
    const d = dirOf(id); if (!d || !fs.existsSync(d)) return false;
    fs.rmSync(d, { recursive: true, force: true }); return true;
  }

  // ---- samples --------------------------------------------------------
  function diagnose(wavBuf) {
    let a;
    try { a = A.parseWav(wavBuf); } catch (e) { return { ok: false, errors: ['not a readable WAV: ' + e.message], warnings: [], diagnostics: null }; }
    const d = A.analyze(a), insp = A.inspectSample(a);
    const errors = [];
    if (d.duration < 0.5) errors.push('shorter than 0.5 s');
    if (d.duration > 60) errors.push('longer than 60 s (trim it first)');
    if (d.silenceRatio > 0.97) errors.push('contains no usable speech (all silence)');
    const warnings = E.sampleWarnings(d);
    for (const w of A.inspectionWarnings(insp)) if (/signal-to-noise|DC offset/.test(w)) warnings.push(w);
    return { ok: !errors.length, errors, warnings, diagnostics: Object.assign({ rms_db: +d.rmsDb.toFixed(1), clip_ratio: +d.clipRatio.toFixed(5), silence_ratio: +d.silenceRatio.toFixed(3) }, insp, { duration: +d.duration.toFixed(3) }) };
  }
  // srcPath: a file (typically the staged upload). It is re-encoded; the staged copy stays temporary.
  async function addSample(id, { srcPath, wav, name, transcript }) {
    const p = readRaw(id); if (!p) return null;
    if (p.type !== 'cloned') throw Object.assign(new Error('only cloned voices take reference samples'), { status: 400 });
    assertEditable(p, 'its reference samples');
    if (p.samples.length >= MAX_SAMPLES) throw Object.assign(new Error(`a profile holds at most ${MAX_SAMPLES} samples`), { status: 400 });
    const buf = wav || await ingest(srcPath);
    if (!buf || buf.length > MAX_SAMPLE_BYTES) throw Object.assign(new Error('sample could not be converted to a valid WAV (or is too large)'), { status: 400 });
    const v = diagnose(buf);
    if (!v.ok) throw Object.assign(new Error('sample rejected: ' + v.errors.join('; ')), { status: 400 });
    const sid = 'sm-' + crypto.randomBytes(5).toString('hex');
    const file = `${sid}.wav`;
    fs.mkdirSync(path.join(dirOf(id), 'samples'), { recursive: true, mode: 0o700 });
    atomicWrite(path.join(dirOf(id), 'samples', file), buf);
    const s = { id: sid, name: clip(name || `Sample ${p.samples.length + 1}`, 80), file, bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex'),
      transcript: clip(transcript, 4000), active: p.samples.length === 0, review: { state: 'unreviewed', note: '', at: null }, validation: { ok: v.ok, errors: v.errors, warnings: v.warnings }, diagnostics: v.diagnostics, created_at: now() };
    p.samples.push(s);
    return { profile: view(save(p)), sample: s };
  }
  function updateSample(id, sid, patch) {
    const p = readRaw(id); if (!p) return null;
    const s = p.samples.find(x => x.id === sid); if (!s) return null;
    const x = patch || {};
    if ((x.transcript !== undefined && clip(x.transcript, 4000) !== s.transcript) || x.active === true && !s.active) assertEditable(p, 'its reference samples');
    if (x.name !== undefined) s.name = clip(x.name, 80);
    if (x.transcript !== undefined) s.transcript = clip(x.transcript, 4000);
    if (x.active === true) for (const o of p.samples) o.active = o.id === sid;
    return view(save(p));
  }
  function reviewSample(id, sid, { state, note } = {}) {
    const p = readRaw(id); if (!p) return null;
    const s = p.samples.find(x => x.id === sid); if (!s) return null;
    if (!REVIEW_STATES.includes(state)) throw Object.assign(new Error('review state must be one of: ' + REVIEW_STATES.join(', ')), { status: 400 });
    s.review = { state, note: clip(note, 500), at: now() };
    return view(save(p));
  }
  function removeSample(id, sid) {
    const p = readRaw(id); if (!p) return null;
    const s = p.samples.find(x => x.id === sid); if (!s) return null;
    assertEditable(p, 'its reference samples');
    p.samples = p.samples.filter(x => x.id !== sid);
    try { fs.unlinkSync(path.join(dirOf(id), 'samples', s.file)); } catch (_) {}
    if (p.samples.length && !p.samples.some(x => x.active)) p.samples[0].active = true;
    return view(save(p));
  }
  function samplePath(id, sid) {
    const p = readRaw(id); if (!p || !SID_RE.test(String(sid))) return null;
    const s = p.samples.find(x => x.id === sid); if (!s) return null;
    const full = path.join(dirOf(id), 'samples', s.file);
    return fs.existsSync(full) ? full : null;
  }
  function activeSample(id) {
    const p = readRaw(id); if (!p) return null;
    const s = p.samples.find(x => x.active) || p.samples[0]; return s ? { sample: s, path: samplePath(id, s.id) } : null;
  }
  return { root: base, create, get, list, update, remove, addSample, updateSample, reviewSample, removeSample, samplePath, activeSample, diagnose, approve, lock, unlock, setConsent, setTrial, setOrigin, linkClone, SCHEMA, MAX_SAMPLES };
}

module.exports = { createProfileStore, composeDescription, readiness, SCHEMA, TYPES, MAX_SAMPLES, CONSENT_KINDS, REVIEW_STATES };
