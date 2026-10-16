'use strict';

// Optional LOCAL post-render speech check (whisper.cpp). Nothing is downloaded or installed here and no audio ever leaves the
// machine: if the binary or a local model file is missing the check reports UNAVAILABLE, never a pass.
//
// ASR disagreement is advisory evidence, not proof. compare() therefore returns PASS or REVIEW (never FAIL) with exact
// word positions so a human can listen at the right place; it reports probable missing words, repetitions, likely
// pronunciation anomalies and unusually incomplete renders.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, execFileSync } = require('child_process');

const LIMITATIONS = 'Speech recognition is probabilistic and may mishear names, accents or stylised delivery. A difference is a prompt to listen, not proof the line is wrong.';
const NUM = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];

function words(text) {
  return String(text == null ? '' : text).normalize('NFC').toLowerCase().replace(/\[[^\]]*\]|\([^)]*\)|<[^>]*>/g, ' ').replace(/[^\p{L}\p{N}']+/gu, ' ').replace(/(^|\s)'+|'+(\s|$)/g, ' ')
    .split(/\s+/).filter(Boolean).map(w => (/^\d+$/.test(w) && Number(w) <= 20 ? NUM[Number(w)] : w));
}
function lev(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]); for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

// Word-level alignment (expected = script, heard = ASR) with a minimum-edit backtrace.
function align(exp, got) {
  const n = exp.length, m = got.length, dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 0; i <= n; i++) dp[i][0] = i; for (let j = 0; j <= m; j++) dp[0][j] = j;
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (exp[i - 1] === got[j - 1] ? 0 : 1));
  const ops = []; let i = n, j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + (exp[i - 1] === got[j - 1] ? 0 : 1)) { ops.push(exp[i - 1] === got[j - 1] ? { t: 'eq', e: i - 1, g: j - 1 } : { t: 'sub', e: i - 1, g: j - 1 }); i--; j--; }
    else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) { ops.push({ t: 'del', e: i - 1 }); i--; }
    else { ops.push({ t: 'ins', g: j - 1 }); j--; }
  }
  return ops.reverse();
}

function compare(expectedText, heardText) {
  const exp = words(expectedText), got = words(heardText);
  const out = { status: 'PASS', expected_words: exp.length, heard_words: got.length, wer: 0, missing: [], repeated: [], extra: [], pronunciation_suspects: [], incomplete: false, limitations: LIMITATIONS };
  if (!exp.length && !got.length) return out;
  const ops = align(exp, got); let errors = 0, matched = 0;
  for (let k = 0; k < ops.length;) {
    const o = ops[k];
    if (o.t === 'eq') { matched++; k++; continue; }
    if (o.t === 'del') { let r = k; while (r < ops.length && ops[r].t === 'del') r++; const run = ops.slice(k, r); out.missing.push({ text: run.map(x => exp[x.e]).join(' '), at_word: run[0].e, words: run.length }); errors += run.length; k = r; continue; }
    if (o.t === 'ins') {
      let r = k; while (r < ops.length && ops[r].t === 'ins') r++; const run = ops.slice(k, r), text = run.map(x => got[x.g]).join(' ');
      const prevHeard = run[0].g > 0 ? got.slice(Math.max(0, run[0].g - run.length), run[0].g).join(' ') : '', nextHeard = got.slice(run[run.length - 1].g + 1, run[run.length - 1].g + 1 + run.length).join(' ');
      (prevHeard === text || nextHeard === text ? out.repeated : out.extra).push({ text, at_word: ops.slice(0, k).filter(x => x.e !== undefined).length }); errors += run.length; k = r; continue;
    }
    const e = exp[o.e], g = got[o.g]; errors++;
    if (lev(e, g) <= Math.max(2, Math.ceil(Math.max(e.length, g.length) / 2)) && Math.min(e.length, g.length) >= 3) out.pronunciation_suspects.push({ expected: e, heard: g, at_word: o.e });
    else { out.missing.push({ text: e, at_word: o.e, words: 1, heard_instead: g }); }
    k++;
  }
  out.wer = exp.length ? +(errors / exp.length).toFixed(3) : (got.length ? 1 : 0);
  const tail = ops.slice().reverse().findIndex(o => o.t !== 'del'); const tailMissing = tail < 0 ? ops.length : tail;
  out.incomplete = exp.length >= 4 && (tailMissing >= 3 || matched / exp.length < 0.6 || got.length < exp.length * 0.6);
  if (out.wer > 0.12 || out.incomplete || out.repeated.length) out.status = 'REVIEW';
  return out;
}

// ── detection (read-only) ─────────────────────────────────────────────────────────────
function detect({ env = process.env, which = defaultWhich, exists = fs.existsSync, readdir = d => { try { return fs.readdirSync(d); } catch (_) { return []; } }, home = os.homedir() } = {}) {
  const bin = (env.DEX_WHISPER_BIN && exists(env.DEX_WHISPER_BIN) ? env.DEX_WHISPER_BIN : null) || which('whisper-cli') || which('whisper-cpp');
  let model = env.DEX_WHISPER_MODEL && exists(env.DEX_WHISPER_MODEL) ? env.DEX_WHISPER_MODEL : null;
  if (!model) for (const d of [path.join(home, '.cache', 'whisper.cpp'), path.join(home, 'whisper.cpp', 'models'), path.join(home, 'Library', 'Application Support', 'whisper.cpp'), '/opt/homebrew/share/whisper-cpp', '/usr/local/share/whisper-cpp']) {
    const f = readdir(d).filter(n => /^ggml-.*\.bin$/.test(n) && !/silero|vad/i.test(n)).sort()[0]; if (f) { model = path.join(d, f); break; }
  }
  if (!bin) return { available: false, bin: null, model, reason: 'whisper.cpp (whisper-cli) is not installed; set DEX_WHISPER_BIN or install it. Nothing is downloaded automatically.', local_only: true };
  if (!model) return { available: false, bin, model: null, reason: 'whisper.cpp is installed but no local ggml model file was found; set DEX_WHISPER_MODEL to one you have approved.', local_only: true };
  return { available: true, bin, model, reason: null, local_only: true };
}
function defaultWhich(name) { try { return execFileSync('which', [name], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || null; } catch (_) { return null; } }

// ── transcription (local process only) ──────────────────────────────────────────────
async function transcribe(wavPath, det, { timeoutMs = 5 * 60 * 1000 } = {}) {
  if (!det || !det.available) throw new Error('local speech recognition is unavailable: ' + (det && det.reason || 'unknown'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexasr-')), wav16 = path.join(dir, 'in16.wav'), prefix = path.join(dir, 'out');
  const run = (cmd, args) => new Promise((res, rej) => execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (e, so, se) => (e ? rej(new Error(`${path.basename(cmd)} failed: ${String(se || e.message).trim().slice(-200)}`)) : res(so))));
  try {
    await run('ffmpeg', ['-v', 'error', '-y', '-i', wavPath, '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav16]);
    await run(det.bin, ['-m', det.model, '-f', wav16, '-of', prefix, '-oj', '-np']);
    const j = JSON.parse(fs.readFileSync(prefix + '.json', 'utf8')), segs = (j.transcription || []).map(s => ({ text: String(s.text || '').trim(), start: ((s.offsets || {}).from || 0) / 1000, end: ((s.offsets || {}).to || 0) / 1000 }));
    return { text: segs.map(s => s.text).join(' ').replace(/\s+/g, ' ').trim(), segments: segs, engine: 'whisper.cpp', model: path.basename(det.model) };
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} }
}

async function checkLine({ detect: det, wavPath, expected, transcribe: tr = transcribe }) {
  if (!det || !det.available) return { status: 'UNAVAILABLE', reason: det && det.reason || 'local speech recognition is not available' };
  try {
    const heard = await tr(wavPath, det);
    return Object.assign({ engine: heard.engine, model: heard.model, checked_at: Date.now() }, compare(expected, heard.text));
  } catch (e) { return { status: 'ERROR', reason: String(e.message).slice(0, 200) }; }
}

module.exports = { detect, transcribe, compare, checkLine, words, LIMITATIONS };
