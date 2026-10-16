'use strict';

// Versioned, deterministic fingerprints for audio-drama production.
//
// SPEECH fingerprint  -> decides whether a recorded take is still the right recording for a line.
// ASSEMBLY fingerprint -> decides whether a scene mix is still the right mix of its inputs.
//
// The two are deliberately independent: changing a sound effect or an FX chain never touches the
// speech fingerprint, so valid TTS is never regenerated for a remix-only change.
//
// A fingerprint is a hash over per-component hashes, so it can be diffed ("which component changed?")
// without storing any script text. Seed is NOT part of the eligibility key (`inputs_sha`): a second
// take of the same line with another seed is equally valid for the same inputs. It is part of the
// exact `render_sha` used for provenance/reproducibility.
//
// Bump FP_VERSION / ASSEMBLY_FP_VERSION / PIPELINE_VERSION / MIXER_VERSION only when the semantics of
// synthesis, chunking/stitching or mixing really change; that deliberately invalidates dependent artifacts.

const crypto = require('crypto');
const E = require('./voice-engines');

const FP_VERSION = 'dxsp1';
const ASSEMBLY_FP_VERSION = 'dxas1';
const PIPELINE_VERSION = 'speech.v1';   // chunking + stitching + speech level policy
const MIXER_VERSION = 'mix.v1';

const sha = s => crypto.createHash('sha256').update(s).digest('hex');
function canon(v) {
  if (v === null) return 'null';
  if (typeof v === 'string') return JSON.stringify(v.normalize('NFC'));
  if (typeof v === 'number') return Number.isFinite(v) ? String(Math.round(v * 1e9) / 1e9) : 'null';
  if (typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return '[' + v.map(x => (x === undefined ? 'null' : canon(x))).join(',') + ']';
  if (typeof v === 'object') return '{' + Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => JSON.stringify(k.normalize('NFC')) + ':' + canon(v[k])).join(',') + '}';
  return 'null';
}
const canonical = canon;
const hashOf = v => sha(canon(v));

// Documented normalisation of spoken text: Unicode NFC, CRLF/CR -> LF, every whitespace run
// (spaces, tabs, newlines) collapses to one space, ends trimmed. Nothing else is altered.
function normalizeSpokenText(s) { return String(s == null ? '' : s).normalize('NFC').replace(/\r\n?/g, '\n').replace(/\s+/g, ' ').trim(); }

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Whole-word respelling rules applied to the SPOKEN text only. The screenplay source is never altered.
function applyPronunciation(text, rules) {
  let out = String(text == null ? '' : text); const applied = [];
  for (const r of Array.isArray(rules) ? rules : []) {
    const from = r && String(r.from || '').trim(), to = r && String(r.to == null ? '' : r.to);
    if (!from || !to) continue;
    const re = new RegExp(`(?<![\\p{L}\\p{N}_])${esc(from)}(?![\\p{L}\\p{N}_])`, r.ignore_case ? 'giu' : 'gu');
    let count = 0;
    out = out.replace(re, () => { count++; return to; });
    if (count) applied.push({ from, to, count });
  }
  return { text: out, applied };
}

function activeSample(profile) { const s = (profile && profile.samples) || []; return s.find(x => x.active) || s[0] || null; }

// input: { line, actor, profile, engineId, language, direction, speed, revisionOverride }
function speechFingerprint(input) {
  const { line, actor, profile, engineId } = input;
  const eng = E.getEngine(engineId);
  const caps = eng ? eng.capabilities : {};
  const pr = applyPronunciation(normalizeSpokenText(line.text), actor && actor.pronunciation);
  const spoken = normalizeSpokenText(pr.text);
  const requestedDirection = String(input.direction == null ? (line.direction || (actor && actor.default_direction) || '') : input.direction).trim();
  const delivery = eng && profile ? E.resolveDelivery(engineId, profile, requestedDirection) : { requested: requestedDirection, applied: false, note: null };
  const sample = profile && profile.type === 'cloned' ? activeSample(profile) : null;
  const language = input.language || (profile && profile.language) || 'en';
  const speed = engineId === 'kokoro' ? Number(input.speed || (profile && profile.default_speed) || 1) : null;
  const revision = input.revisionOverride || (eng && eng.revision) || null;
  const components = {
    text: hashOf({ spoken }),
    speaker: hashOf({ speaker_key: (actor && actor.speaker_key) || line.speaker_key, profile_id: (profile && profile.id) || null }),
    voice: hashOf(profile ? { type: profile.type, description: profile.type === 'designed' ? normalizeSpokenText(profile.description) : null, preset_voice: profile.type === 'preset' ? profile.preset_voice || null : null } : null),
    reference: hashOf(sample ? { id: sample.id, sha256: sample.sha256, transcript: normalizeSpokenText(sample.transcript) } : null),
    engine: hashOf({ engine: engineId, worker: eng ? eng.worker : null, revision }),
    language: hashOf({ language }),
    settings: hashOf({ pipeline: PIPELINE_VERSION, max_chunk_chars: caps.max_chunk_chars || null, speed }),
    delivery: hashOf(delivery.applied ? { instruct: delivery.instruct } : null),
    pronunciation: hashOf(pr.applied.map(a => [a.from, a.to])),
    source: hashOf({ kind: line.kind, source_sha: line.source_sha || null }),
  };
  return {
    version: FP_VERSION, inputs_sha: sha(FP_VERSION + canon(components)), components,
    engine: engineId, revision, language, speed,
    delivery: { requested: requestedDirection || null, applied: !!delivery.applied },
    spoken_text: spoken, spoken_chars: spoken.length, pronunciation_applied: pr.applied,
  };
}
const renderFingerprint = (fp, seed) => sha(fp.inputs_sha + '|seed:' + (seed == null ? 'none' : String(seed)));

// Which components differ between two fingerprints (works for speech and assembly fingerprints).
function diffComponents(a, b) {
  const ac = (a && a.components) || {}, bc = (b && b.components) || {};
  return [...new Set([...Object.keys(ac), ...Object.keys(bc)])].filter(k => ac[k] !== bc[k]);
}

// scene: { scene_id, mixer_version, clips[], cues[], settings, mastering }. Clips must already be in timeline order.
function assemblyFingerprint(scene) {
  const components = {
    mixer: hashOf({ mixer: scene.mixer_version || MIXER_VERSION }),
    clips: hashOf(scene.clips || []),
    cues: hashOf(scene.cues || []),
    settings: hashOf(scene.settings || {}),
    mastering: hashOf(scene.mastering || {}),
  };
  return { version: ASSEMBLY_FP_VERSION, sha: sha(ASSEMBLY_FP_VERSION + canon(components)), components };
}

module.exports = { FP_VERSION, ASSEMBLY_FP_VERSION, PIPELINE_VERSION, MIXER_VERSION, canonical, hashOf, sha, normalizeSpokenText, applyPronunciation, speechFingerprint, renderFingerprint, diffComponents, assemblyFingerprint, activeSample };
