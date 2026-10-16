'use strict';

// Optional pacing master. Dramatic dialogue is normally left exactly as performed; pacing exists for deliberately fast
// delivery (e.g. a ~300 WPM monologue) and is per actor / per line, never global. The clean take is untouched: the stretch is
// a derived, lineage-tracked version made with FFmpeg's pitch-preserving atempo, and every result is verified by measurement.

const fs = require('fs');
const A = require('./voice-audio');
const Tools = require('./audio-tools');
const { words } = require('./asr-adapter');

const PRESETS = {
  off: { label: 'Off (as performed)', mode: 'off' },
  fast_monologue: { label: 'Fast monologue (~300 WPM)', mode: 'wpm', target_wpm: 300 },
  brisk: { label: 'Brisk (~190 WPM)', mode: 'wpm', target_wpm: 190 },
};
const TEMPO_WARN_HIGH = 1.3, TEMPO_WARN_LOW = 0.85, TEMPO_BAD_HIGH = 1.6;

// Seconds of actual speech: first to last frame above -45 dBFS (edge silence and trailing room are not "speaking time").
function activeSeconds(audio) {
  const mono = A.toMono(audio).channels[0], win = Math.max(1, Math.round(audio.sampleRate * 0.01)), th = Math.pow(10, -45 / 20);
  let first = -1, last = -1;
  for (let s = 0; s + win <= mono.length; s += win) { let e = 0; for (let i = s; i < s + win; i++) e += mono[i] * mono[i]; if (Math.sqrt(e / win) >= th) { if (first < 0) first = s; last = s + win; } }
  return first < 0 ? 0 : (last - first) / audio.sampleRate;
}
const countWords = text => words(text).length;
function measure(text, audio) {
  const w = countWords(text), active = activeSeconds(audio);
  return { words: w, active_s: +active.toFixed(3), wpm: active > 0 ? Math.round(w / active * 60) : null };
}
function measureFile(text, file) { return measure(text, A.parseWav(fs.readFileSync(file))); }

// What tempo does this setting imply for a take with the measured WPM? Returns { tempo, warnings, blocked }.
function planTempo({ measured_wpm, target_wpm, tempo }) {
  let t = tempo != null ? Number(tempo) : (target_wpm && measured_wpm ? Number(target_wpm) / measured_wpm : 1);
  const warnings = [];
  if (!Number.isFinite(t) || t <= 0) return { tempo: 1, warnings: ['no usable tempo could be derived'], blocked: true };
  t = Math.round(t * 1000) / 1000;
  const blocked = t < Tools.TEMPO_MIN || t > Tools.TEMPO_MAX;
  if (blocked) warnings.push(`tempo ${t} is outside the supported ${Tools.TEMPO_MIN}-${Tools.TEMPO_MAX} range`);
  else if (t > TEMPO_BAD_HIGH) warnings.push(`excessive stretching (×${t}): speech will sound artificial; re-render the line with a faster delivery instead`);
  else if (t > TEMPO_WARN_HIGH) warnings.push(`strong speed-up (×${t}): artifacts are likely; audition before using`);
  else if (t < TEMPO_WARN_LOW) warnings.push(`strong slow-down (×${t}): audition before using`);
  return { tempo: t, warnings, blocked };
}
// Setting (actor preset/target or per-line override) → { mode, tempo?, target_wpm? } or null for "as performed".
function resolveSetting(actorPacing, lineOverride) {
  const s = lineOverride && lineOverride.mode ? lineOverride : actorPacing;
  if (!s || !s.mode || s.mode === 'off') return null;
  if (s.mode === 'tempo' && Number(s.tempo) > 0) return { mode: 'tempo', tempo: Number(s.tempo) };
  if (s.mode === 'wpm' && Number(s.target_wpm) > 0) return { mode: 'wpm', target_wpm: Number(s.target_wpm) };
  return null;
}

// Real stretch + verification. Returns the original/result measurements so the comparison is evidence, not a promise.
async function applyStretch(srcFile, destFile, { text, tempo, tools = Tools }) {
  const before = measureFile(text, srcFile);
  const stretched = await tools.timeStretch(srcFile, destFile, tempo);
  const after = measureFile(text, destFile);
  return { tempo, original: before, result: after, duration_before: stretched.source_duration, duration_after: stretched.duration, verified: Math.abs(stretched.duration - stretched.source_duration / tempo) <= Math.max(0.03, stretched.duration * 0.01) };
}

module.exports = { PRESETS, activeSeconds, countWords, measure, measureFile, planTempo, resolveSetting, applyStretch, TEMPO_WARN_HIGH, TEMPO_BAD_HIGH };
