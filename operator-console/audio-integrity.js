'use strict';

// Deterministic audio integrity checks, separated from advisory listening/ASR concerns.
//   HARD failures   = the artifact is wrong (missing, wrong checksum, undecodable, empty, non-finite, silent speech, wrong association)
//   ADVISORY issues = the artifact is valid but a human may want to listen (clipping, very quiet, long internal silence, odd speech rate)
// Silent dramatic pauses are timeline gaps, not takes, so they never trip these checks; only a *take* that should contain speech must.

const fs = require('fs');
const crypto = require('crypto');
const Tools = require('./audio-tools');

const sha256 = file => new Promise((res, rej) => { const h = crypto.createHash('sha256'); fs.createReadStream(file).on('data', d => h.update(d)).on('end', () => res(h.digest('hex'))).on('error', rej); });

async function checkTake({ take, record, words = null, tools = Tools, expectRate = null }) {
  const hard = [], advisory = [];
  const fail = (code, message) => hard.push({ code, message });
  if (!take || !take.artifact_id) { fail('no-artifact', 'the take has no audio artifact'); return { ok: false, hard, advisory }; }
  if (!record || !record.path || !fs.existsSync(record.path)) { fail('artifact-missing', 'the take audio file is not in the media store'); return { ok: false, hard, advisory }; }
  let actual; try { actual = await sha256(record.path); } catch (e) { fail('unreadable', e.message); return { ok: false, hard, advisory }; }
  if (take.sha256 && take.sha256 !== actual) fail('checksum-mismatch', 'the take audio no longer matches the checksum recorded when it was rendered');
  if (record.sha256 && record.sha256 !== actual) fail('registry-mismatch', 'the media registry checksum does not match the file');
  let scan; try { scan = await tools.scanWav(record.path); } catch (e) { fail('undecodable', 'the audio could not be read: ' + e.message); return { ok: false, hard, advisory }; }
  if (!(scan.frames > 0)) fail('empty', 'the audio contains no samples');
  if (scan.non_finite) fail('non-finite', `${scan.non_finite} non-finite samples`);
  if (expectRate && scan.sample_rate !== expectRate) fail('format', `sample rate ${scan.sample_rate} Hz (expected ${expectRate})`);
  if (scan.silent) fail('silent-speech', 'a take that should contain speech is silent (a placeholder must never stand in for failed speech)');
  else if (scan.frames && scan.duration < 0.15) fail('too-short', `only ${scan.duration.toFixed(2)} s of audio`);
  if (!scan.silent) {
    if (scan.clip_percent > 0.1) advisory.push({ code: 'clipping', message: `${scan.clip_percent.toFixed(2)}% of samples are at full scale` });
    if (scan.rms_db < -42) advisory.push({ code: 'very-quiet', message: `very quiet (RMS ${scan.rms_db.toFixed(0)} dBFS)` });
    if (words && scan.duration > 0) { const wps = words / scan.duration; if (words >= 4 && (wps > 7 || wps < 0.7)) advisory.push({ code: 'speech-rate', message: `${(wps * 60).toFixed(0)} words per minute is unusual; listen to confirm` }); }
  }
  return { ok: hard.length === 0, hard, advisory, scan: { duration: scan.duration, sample_rate: scan.sample_rate, channels: scan.channels, peak_db: scan.peak_db, rms_db: scan.rms_db, clip_percent: scan.clip_percent }, sha256: actual };
}

// Source/scene accounting for a finished production: every renderable line is covered by exactly one current take, every scene has a master.
function checkCoverage({ project, chosen, sceneMasters, renderable }) {
  const hard = [], lines = renderable.map(x => x.line), covered = lines.filter(l => chosen.has(l.id));
  for (const l of lines) if (!chosen.has(l.id)) hard.push({ code: 'line-uncovered', line_id: l.id, message: 'a renderable line has no current take in the master' });
  const scenesWithLines = project.scenes.filter(s => renderable.some(x => x.scene.id === s.id));
  for (const s of scenesWithLines) if (!sceneMasters[s.id]) hard.push({ code: 'scene-unmastered', scene_id: s.id, message: 'a scene with speech has no scene master' });
  return { ok: !hard.length, hard, advisory: [], lines_total: lines.length, lines_covered: covered.length, scenes_total: scenesWithLines.length, scenes_mastered: scenesWithLines.filter(s => sceneMasters[s.id]).length };
}

module.exports = { checkTake, checkCoverage };
