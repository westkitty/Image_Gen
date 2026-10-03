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

// root: durable directory. ingest(srcPath) → Buffer of a PCM WAV (production: ffmpeg → mono 24 kHz).
function createProfileStore({ root, ingest, now = () => Date.now() }) {
  const base = path.resolve(root);
  fs.mkdirSync(base, { recursive: true, mode: 0o700 });
  const dirOf = id => { if (!ID_RE.test(String(id))) return null; return path.join(base, id); };
  const fileOf = id => { const d = dirOf(id); return d && path.join(d, 'profile.json'); };

  function readRaw(id) { const f = fileOf(id); if (!f) return null; try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return null; } }
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
  function save(p) { p.updated_at = now(); revalidate(p); atomicWrite(fileOf(p.id), p); return p; }
  function view(p) { return p && Object.assign({}, p, { samples: (p.samples || []).map(s => Object.assign({}, s, { audio_url: `/api/voice/profiles/${p.id}/samples/${s.id}/audio` })) }); }

  function create(input) {
    const i = input || {};
    const type = TYPES.includes(i.type) ? i.type : null;
    if (!type) throw Object.assign(new Error('type must be cloned, designed or preset'), { status: 400 });
    const name = clip(i.name, 80).trim();
    if (!name) throw Object.assign(new Error('name is required'), { status: 400 });
    if (i.preset_voice && !KOKORO_VOICES.includes(i.preset_voice)) throw Object.assign(new Error('unknown Kokoro voice'), { status: 400 });
    const p = {
      schema: SCHEMA, id: 'vp-' + crypto.randomBytes(5).toString('hex'), name, type, language: clip(i.language || 'en', 8),
      preferred_engine: null, description: clip(i.description, 1000), preset_voice: type === 'preset' ? (i.preset_voice || 'af_heart') : null,
      default_direction: clip(i.default_direction, 200), default_speed: type === 'preset' ? Math.max(0.5, Math.min(2, Number(i.default_speed) || 1)) : null,
      notes: clip(i.notes, 1000), samples: [], created_at: now(), updated_at: now(),
    };
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
    if (x.name !== undefined) { const n = clip(x.name, 80).trim(); if (!n) throw Object.assign(new Error('name cannot be empty'), { status: 400 }); p.name = n; }
    for (const [k, n] of [['description', 1000], ['default_direction', 200], ['notes', 1000], ['language', 8]]) if (x[k] !== undefined) p[k] = clip(x[k], n);
    if (x.preset_voice !== undefined) { if (!KOKORO_VOICES.includes(x.preset_voice)) throw Object.assign(new Error('unknown Kokoro voice'), { status: 400 }); p.preset_voice = x.preset_voice; }
    if (x.default_speed !== undefined && p.type === 'preset') p.default_speed = Math.max(0.5, Math.min(2, Number(x.default_speed) || 1));
    if (x.preferred_engine !== undefined) { if (!E.compatibleEngines(p).includes(x.preferred_engine)) throw Object.assign(new Error('engine is not compatible with this voice type'), { status: 400 }); p.preferred_engine = x.preferred_engine; }
    return view(save(p));
  }
  function remove(id) {
    const d = dirOf(id); if (!d || !fs.existsSync(d)) return false;
    fs.rmSync(d, { recursive: true, force: true }); return true;
  }

  // ---- samples --------------------------------------------------------
  function diagnose(wavBuf) {
    let a;
    try { a = A.parseWav(wavBuf); } catch (e) { return { ok: false, errors: ['not a readable WAV: ' + e.message], warnings: [], diagnostics: null }; }
    const d = A.analyze(a);
    const errors = [];
    if (d.duration < 0.5) errors.push('shorter than 0.5 s');
    if (d.duration > 60) errors.push('longer than 60 s (trim it first)');
    if (d.silenceRatio > 0.97) errors.push('contains no usable speech (all silence)');
    return { ok: !errors.length, errors, warnings: E.sampleWarnings(d), diagnostics: { duration: +d.duration.toFixed(3), sample_rate: d.sampleRate, channels: d.channels, rms_db: +d.rmsDb.toFixed(1), peak_db: +d.peakDb.toFixed(1), clip_ratio: +d.clipRatio.toFixed(5), silence_ratio: +d.silenceRatio.toFixed(3) } };
  }
  // srcPath: a file (typically the staged upload). It is re-encoded; the staged copy stays temporary.
  async function addSample(id, { srcPath, wav, name, transcript }) {
    const p = readRaw(id); if (!p) return null;
    if (p.type !== 'cloned') throw Object.assign(new Error('only cloned voices take reference samples'), { status: 400 });
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
      transcript: clip(transcript, 4000), active: p.samples.length === 0, validation: { ok: v.ok, errors: v.errors, warnings: v.warnings }, diagnostics: v.diagnostics, created_at: now() };
    p.samples.push(s);
    return { profile: view(save(p)), sample: s };
  }
  function updateSample(id, sid, patch) {
    const p = readRaw(id); if (!p) return null;
    const s = p.samples.find(x => x.id === sid); if (!s) return null;
    const x = patch || {};
    if (x.name !== undefined) s.name = clip(x.name, 80);
    if (x.transcript !== undefined) s.transcript = clip(x.transcript, 4000);
    if (x.active === true) for (const o of p.samples) o.active = o.id === sid;
    return view(save(p));
  }
  function removeSample(id, sid) {
    const p = readRaw(id); if (!p) return null;
    const s = p.samples.find(x => x.id === sid); if (!s) return null;
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
  return { root: base, create, get, list, update, remove, addSample, updateSample, removeSample, samplePath, activeSample, diagnose, SCHEMA, MAX_SAMPLES };
}

module.exports = { createProfileStore, SCHEMA, TYPES, MAX_SAMPLES };
