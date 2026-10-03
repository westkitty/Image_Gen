'use strict';

// Engine adapter contract for DexDiffusion voice production.
//
// Orchestration asks: "render THIS line with THIS voice profile and THESE performance
// instructions". An engine descriptor says what the installed runtime can actually do;
// translating that to a Big Mac invocation stays in media-bridge.js / dexmedia_remote.py.
//
// Capability claims here are backed by evidence recorded next to each flag (runtime
// signature probe on Big Mac, 2026-10-02, or an explicit DexDiffusion policy). Nothing
// is claimed that was not observed. Future engines register another descriptor; the
// Voice/Drama UI reads capabilities and does not hard-code engine names.

const { KOKORO_VOICES, LANGS } = require('./media-bridge');

const PROBE = 'runtime probe on Big Mac (mlx-audio 0.5.6, inspect.signature on the installed model class)';
const ENGINES = {
  kokoro: {
    id: 'kokoro', worker: 'kokoro', label: 'Kokoro 82M', voice_types: ['preset'],
    capabilities: {
      cloning: false, voice_design: false, preset_voices: true, multi_sample_reference: false,
      delivery_instructions: false, speed_control: true, paralinguistic_tags: false,
      streaming: false, deterministic_seed: false, prompt_caching: false,
      languages: ['en'], sample_rate: 24000, reference_seconds: null, max_chunk_chars: 900,
    },
    evidence: {
      delivery_instructions: `none: Model.generate(text, voice, speed, lang_code, split_pattern) has no instruct parameter (${PROBE})`,
      speed_control: 'Model.generate accepts speed',
      streaming: 'generate() has no stream parameter (probe)',
      deterministic_seed: 'Kokoro synthesis is deterministic; no seed is used or needed',
      prompt_caching: 'no reusable voice-prompt API (probe); a preset voice is a static file',
    },
    voices: KOKORO_VOICES,
  },
  'qwen3-tts-base': {
    id: 'qwen3-tts-base', worker: 'qwen3-tts-base', label: 'Qwen3-TTS Base (voice clone)', voice_types: ['cloned'],
    capabilities: {
      cloning: true, voice_design: false, preset_voices: false,
      multi_sample_reference: false,           // one reference clip per generation; the profile picks the active sample
      delivery_instructions: false,            // Base ignores `instruct` (see evidence)
      speed_control: false, paralinguistic_tags: false,
      streaming: false,                        // runtime has stream=, the DexDiffusion bridge returns complete WAVs only
      deterministic_seed: true, prompt_caching: false,
      languages: LANGS, sample_rate: 24000, reference_seconds: { min: 3, recommended: [5, 20], max: 30 }, max_chunk_chars: 700,
    },
    evidence: {
      delivery_instructions: `Base path never forwards instruct: qwen3_tts.Model.generate routes Base to voice cloning from ref_audio+ref_text only (source read 2026-10-02); supports_tts_batch() rejects Base+instruct`,
      multi_sample_reference: 'ref_audio is a single clip (a list is only accepted for server batching of identical references)',
      prompt_caching: `speaker embedding extraction exists (extract_speaker_embedding) but generate() recomputes the in-context reference every call and exposes no precomputed-prompt parameter (${PROBE})`,
      reference_seconds: 'DexDiffusion policy: <3 s is unreliable, long references degrade ICL prefill (library applies a higher repetition penalty for long refs)',
      deterministic_seed: 'mx.random.seed is set per render',
    },
  },
  'qwen3-tts-voice-design': {
    id: 'qwen3-tts-voice-design', worker: 'qwen3-tts-voice-design', label: 'Qwen3-TTS VoiceDesign', voice_types: ['designed'],
    capabilities: {
      cloning: false, voice_design: true, preset_voices: false, multi_sample_reference: false,
      delivery_instructions: true,             // the voice description IS the instruction text; delivery is appended to it
      speed_control: false, paralinguistic_tags: false, streaming: false, deterministic_seed: true, prompt_caching: false,
      languages: LANGS, sample_rate: 24000, reference_seconds: null, max_chunk_chars: 700,
    },
    evidence: {
      delivery_instructions: 'generate_voice_design(instruct=…): "The voice characteristics are entirely defined by the instruction text" (installed docstring). Delivery direction is composed into that text; its audible effect is checked by the A/B proof recorded in OPERATIONAL_STATE.',
      prompt_caching: `no precomputed-prompt API (${PROBE})`,
    },
  },
};

const getEngine = id => ENGINES[id] || null;
const listEngines = () => Object.values(ENGINES).map(e => ({ id: e.id, label: e.label, voice_types: e.voice_types, capabilities: e.capabilities, evidence: e.evidence, voices: e.voices }));
const TYPE_ENGINES = { cloned: ['qwen3-tts-base'], designed: ['qwen3-tts-voice-design'], preset: ['kokoro'] };
const compatibleEngines = profile => TYPE_ENGINES[profile && profile.type] || [];

const MIN_SAMPLE_S = 3, MAX_SAMPLE_S = 30;
// Sample-quality diagnostics → human warnings (diag from voice-audio.analyze, duration in seconds).
function sampleWarnings(diag) {
  const w = [];
  if (diag.duration < MIN_SAMPLE_S) w.push(`only ${diag.duration.toFixed(1)} s long; clones are unreliable under ${MIN_SAMPLE_S} s`);
  if (diag.duration > MAX_SAMPLE_S) w.push(`${diag.duration.toFixed(0)} s is long; ${MAX_SAMPLE_S} s or less clones more reliably`);
  if (diag.clipRatio > 0.005) w.push(`clipping in ${(diag.clipRatio * 100).toFixed(1)}% of samples`);
  if (diag.rmsDb < -40) w.push(`very quiet (RMS ${diag.rmsDb.toFixed(0)} dBFS)`);
  if (diag.silenceRatio > 0.5) w.push(`${Math.round(diag.silenceRatio * 100)}% of the clip is near-silence`);
  return w;
}

// Does this profile satisfy this engine? errors block rendering, warnings do not.
function validateProfileForEngine(profile, engineId) {
  const e = getEngine(engineId), errors = [], warnings = [];
  if (!e) return { ok: false, errors: ['unknown engine ' + engineId], warnings };
  if (!compatibleEngines(profile).includes(engineId)) return { ok: false, errors: [`a ${profile.type} voice cannot be rendered by ${e.label}`], warnings };
  if (profile.type === 'cloned') {
    const act = (profile.samples || []).find(s => s.active) || (profile.samples || [])[0];
    if (!act) errors.push('add at least one reference sample');
    else {
      if (!String(act.transcript || '').trim()) errors.push(`the active sample "${act.name}" needs its exact transcript (Qwen3 Base clones from audio + transcript)`);
      if (!act.validation || act.validation.ok === false) errors.push(`the active sample "${act.name}" failed validation: ${((act.validation && act.validation.errors) || []).join('; ') || 'unreadable'}`);
      else for (const m of act.validation.warnings || []) warnings.push(`sample "${act.name}": ${m}`);
    }
    if ((profile.samples || []).length > 1) warnings.push(`${e.label} uses one reference per render (the active sample); other samples are kept for selection`);
  } else if (profile.type === 'designed') {
    if (String(profile.description || '').trim().length < 10) errors.push('describe the voice (at least a short sentence)');
  } else if (profile.type === 'preset') {
    if (!KOKORO_VOICES.includes(profile.preset_voice)) errors.push('choose a Kokoro voice');
  }
  if (profile.language && e.capabilities.languages && !e.capabilities.languages.includes(profile.language)) errors.push(`${e.label} does not support language "${profile.language}"`);
  return { ok: !errors.length, errors, warnings };
}

// Delivery direction → what the engine can honor. Never silently passed to an engine that ignores it.
function resolveDelivery(engineId, profile, direction) {
  const e = getEngine(engineId), dir = String(direction || '').trim();
  const eff = dir || String((profile && profile.default_direction) || '').trim();
  if (!eff) return { requested: '', applied: false, note: null };
  if (!e || !e.capabilities.delivery_instructions) return { requested: eff, applied: false, note: `${e ? e.label : engineId} cannot honor delivery directions ("${eff}" was NOT applied)` };
  const base = String(profile.description || '').trim().replace(/[.\s]+$/, '');
  return { requested: eff, applied: true, instruct: `${base}. Delivery: ${eff.replace(/[.\s]+$/, '')}.`, note: null };
}

// Everything the bridge needs for one engine invocation covering `texts` (one chunk each).
function buildRenderPlan(engineId, profile, { texts, direction, language, seed, speed, refPath }) {
  const e = getEngine(engineId); if (!e) throw new Error('unknown engine ' + engineId);
  const v = validateProfileForEngine(profile, engineId);
  if (!v.ok) { const err = new Error(v.errors.join('; ')); err.gate = 'profile-invalid'; throw err; }
  const lang = language || profile.language || 'en';
  const delivery = resolveDelivery(engineId, profile, direction);
  const body = { items: texts.map((text, i) => ({ text, seed: seed == null ? null : (Number(seed) + i) % 2147483647 })), language: lang };
  const notes = [];
  if (delivery.note) notes.push(delivery.note);
  if (engineId === 'kokoro') { body.voice = profile.preset_voice; body.speed = speed || profile.default_speed || 1; }
  if (engineId === 'qwen3-tts-base') {
    const act = (profile.samples || []).find(s => s.active) || profile.samples[0];
    body.ref_text = String(act.transcript || '').trim(); body.ref_path = refPath; body.seed = seed;
  }
  if (engineId === 'qwen3-tts-voice-design') { body.instruct = delivery.applied ? delivery.instruct : String(profile.description).trim(); body.seed = seed; }
  return { worker: e.worker, body, delivery, notes, warnings: v.warnings };
}

module.exports = { ENGINES, getEngine, listEngines, compatibleEngines, TYPE_ENGINES, validateProfileForEngine, sampleWarnings, resolveDelivery, buildRenderPlan, MIN_SAMPLE_S, MAX_SAMPLE_S };
