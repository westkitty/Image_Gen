'use strict';

// Programmatic quality control over a drama's chosen takes. Deterministic integrity failures (HARD) are kept strictly apart from
// advisory listening aids (clipping, odd speech rate, speech-boundary suggestions) and from local ASR review (PASS / REVIEW /
// UNAVAILABLE), which is evidence for a human, never proof. A missing recogniser is reported as UNAVAILABLE and never as a pass.

const Integrity = require('./audio-integrity');
const Asr = require('./asr-adapter');
const Boundary = require('./speech-boundary');
const A = require('./voice-audio');
const fs = require('fs');

function createQa({ mediaStore, asr = Asr, integrity = Integrity, boundary = Boundary, detectAsr = () => Asr.detect(), now = () => Date.now() }) {
  const compactBoundary = b => (b ? { engine: b.engine, silero_available: b.silero && b.silero.available, speech_start_s: b.speech_start_s, speech_end_s: b.speech_end_s, leading_silence_s: b.leading_silence_s, trailing_silence_s: b.trailing_silence_s,
    long_gaps: b.long_gaps.length, low_confidence: b.low_confidence.length, suggested_trim: b.suggested_trim } : null);

  // expected: spoken text (private; used in memory only). Returns the QA record to attach to the take.
  async function checkTake({ take, expected, words = null, wantAsr = true, det = null, inputsSha = null }) {
    const record = take.artifact_id && mediaStore.resolve(take.artifact_id);
    const rec = { at: now(), integrity: null, boundaries: null, asr: null, inputs_sha: inputsSha };
    rec.integrity = await integrity.checkTake({ take, record, words });
    if (rec.integrity.ok) {
      try { rec.boundaries = compactBoundary(boundary.detectBoundaries(A.parseWav(fs.readFileSync(record.path)))); } catch (_) { rec.boundaries = null; }
      if (wantAsr) {
        const d = det || detectAsr();
        const prev = take.qa && take.qa.asr && take.qa.inputs_sha === inputsSha && take.qa.asr.status !== 'UNAVAILABLE' && take.qa.asr.status !== 'ERROR' ? take.qa.asr : null;
        rec.asr = prev || await asr.checkLine({ detect: d, wavPath: record.path, expected });
        if (prev) rec.asr = Object.assign({}, prev, { cached: true });
      }
    }
    return rec;
  }

  // items: [{ line, take, expected, words, inputsSha }]
  async function run(items, { asr: wantAsr = 'auto', onProgress = () => {} } = {}) {
    const det = wantAsr === false ? { available: false, reason: 'speech verification was not requested' } : detectAsr();
    const lines = []; let i = 0;
    for (const it of items) {
      onProgress({ done: i++, total: items.length });
      const qa = await checkTake({ take: it.take, expected: it.expected, words: it.words, wantAsr: wantAsr !== false, det, inputsSha: it.inputsSha });
      lines.push({ line_id: it.line.id, take_id: it.take.id, qa });
    }
    return { det, lines, summary: summarize(lines, det) };
  }
  function summarize(lines, det) {
    const hard = lines.filter(l => l.qa.integrity && !l.qa.integrity.ok);
    const counts = { PASS: 0, REVIEW: 0, UNAVAILABLE: 0, ERROR: 0 };
    for (const l of lines) if (l.qa.asr) counts[l.qa.asr.status] = (counts[l.qa.asr.status] || 0) + 1;
    let state;
    if (!det.available) state = 'UNAVAILABLE'; else if (counts.REVIEW) state = 'REVIEW'; else if (counts.ERROR && !counts.PASS) state = 'ERROR'; else if (counts.PASS) state = 'PASS'; else state = 'UNAVAILABLE';
    return {
      checked: lines.length, hard_failures: hard.map(l => ({ line_id: l.line_id, take_id: l.take_id, codes: l.qa.integrity.hard.map(h => h.code) })),
      advisories: lines.filter(l => l.qa.integrity && l.qa.integrity.advisory.length).map(l => ({ line_id: l.line_id, take_id: l.take_id, codes: l.qa.integrity.advisory.map(a => a.code) })),
      asr: { state, counts, engine: det.available ? 'whisper.cpp' : null, model: det.model ? require('path').basename(det.model) : null, reason: det.available ? null : det.reason, review: lines.filter(l => l.qa.asr && l.qa.asr.status === 'REVIEW').map(l => ({ line_id: l.line_id, take_id: l.take_id, wer: l.qa.asr.wer, incomplete: !!l.qa.asr.incomplete, missing: (l.qa.asr.missing || []).length, repeated: (l.qa.asr.repeated || []).length, pronunciation: (l.qa.asr.pronunciation_suspects || []).length })) },
      boundaries: { long_gaps: lines.filter(l => l.qa.boundaries && l.qa.boundaries.long_gaps).length, trim_suggestions: lines.filter(l => l.qa.boundaries && l.qa.boundaries.suggested_trim && (l.qa.boundaries.leading_silence_s > 0.4 || l.qa.boundaries.trailing_silence_s > 0.6)).length },
    };
  }
  return { checkTake, run, summarize };
}

module.exports = { createQa };
