'use strict';

// Speech-boundary detection. Silero VAD was evaluated: it needs the `silero_vad` Python package plus a torch runtime, which is not
// installed here and is not installed automatically, so this module uses a transparent energy detector with hysteresis and says
// so in every result. It only SUGGESTS trims: the clean audio is never modified, padding is adjustable, and low-confidence speech
// is kept inside the suggested bounds rather than silently removed.

const { execFileSync } = require('child_process');

let sileroCache = null;
function detectSilero() {
  if (sileroCache) return sileroCache;
  try { execFileSync('python3', ['-c', 'import silero_vad'], { stdio: 'ignore', timeout: 8000 }); sileroCache = { available: true, reason: null, note: 'silero_vad is importable, but this build does not call it; energy detection is used.' }; }
  catch (_) { sileroCache = { available: false, reason: 'the silero_vad Python package is not installed (not installed automatically); using the energy-based detector' }; }
  return sileroCache;
}

function frameDb(mono, rate, ms) {
  const win = Math.max(1, Math.round(rate * ms / 1000)), out = [];
  for (let s = 0; s < mono.length; s += win) { let e = 0; const end = Math.min(mono.length, s + win); for (let i = s; i < end; i++) e += mono[i] * mono[i]; const r = Math.sqrt(e / (end - s)); out.push(r > 0 ? 20 * Math.log10(r) : -120); }
  return out;
}
const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];

function detectBoundaries(audio, { frameMs = 10, minSpeechMs = 120, minSilenceMs = 250, padLeadMs = 80, padTailMs = 120, maxGapMs = 1200 } = {}) {
  const A = require('./voice-audio');
  const mono = A.toMono(audio).channels[0], rate = audio.sampleRate, dur = mono.length / rate;
  const db = frameDb(mono, rate, frameMs), sorted = db.slice().sort((a, b) => a - b);
  const noise = pct(sorted, 0.1), loud = pct(sorted, 0.9);
  const result = { engine: 'energy-vad', silero: detectSilero(), duration_s: +dur.toFixed(3), noise_floor_db: +noise.toFixed(1), speech_level_db: +loud.toFixed(1), segments: [], long_gaps: [], low_confidence: [], suggested_trim: null,
    speech_start_s: null, speech_end_s: null, leading_silence_s: dur, trailing_silence_s: 0, note: 'Suggestions only; the unprocessed take is never altered.' };
  if (!db.length || loud < -70 || loud - noise < 6) { result.note += ' No clear speech/silence contrast was found, so no trim is suggested.'; return result; }
  const on = Math.max(noise + 10, loud - 30, -60), off = on - 3;
  const segs = []; let cur = null;
  db.forEach((v, i) => { if (!cur && v >= on) cur = { a: i, b: i + 1, peak: v }; else if (cur) { if (v >= off) { cur.b = i + 1; cur.peak = Math.max(cur.peak, v); } else { segs.push(cur); cur = null; } } });
  if (cur) segs.push(cur);
  const merged = []; const gapFrames = Math.round(minSilenceMs / frameMs);
  for (const s of segs) { const last = merged[merged.length - 1]; if (last && s.a - last.b < gapFrames) { last.b = s.b; last.peak = Math.max(last.peak, s.peak); } else merged.push(Object.assign({}, s)); }
  const minFrames = Math.round(minSpeechMs / frameMs);
  for (const s of merged) {
    const conf = Math.max(0, Math.min(1, (s.peak - on) / 12)), seg = { start_s: +(s.a * frameMs / 1000).toFixed(3), end_s: +(Math.min(dur, s.b * frameMs / 1000)).toFixed(3), confidence: +conf.toFixed(2) };
    if (s.b - s.a < minFrames || conf < 0.35) { seg.low_confidence = true; result.low_confidence.push(seg); }
    result.segments.push(seg);
  }
  if (!result.segments.length) return result;
  const first = result.segments[0], last = result.segments[result.segments.length - 1];
  result.speech_start_s = first.start_s; result.speech_end_s = last.end_s; result.leading_silence_s = first.start_s; result.trailing_silence_s = +(dur - last.end_s).toFixed(3);
  for (let i = 1; i < result.segments.length; i++) { const g = result.segments[i].start_s - result.segments[i - 1].end_s; if (g * 1000 > maxGapMs) result.long_gaps.push({ start_s: result.segments[i - 1].end_s, end_s: result.segments[i].start_s, duration_s: +g.toFixed(3) }); }
  result.suggested_trim = { start_s: +Math.max(0, first.start_s - padLeadMs / 1000).toFixed(3), end_s: +Math.min(dur, last.end_s + padTailMs / 1000).toFixed(3), pad_lead_ms: padLeadMs, pad_tail_ms: padTailMs, includes_low_confidence: result.low_confidence.length > 0 };
  return result;
}

module.exports = { detectBoundaries, detectSilero };
