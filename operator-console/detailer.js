'use strict';

const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');

const VISION_DETAILER_BIN = path.join(__dirname, 'bin', 'vision-detailer');

// A healthy run is well under 2 s (cold ≈ 0.7–1.3 s). 30 s was observed once under heavy swap pressure, so the budget is
// bounded per attempt and one retry is allowed: a stalled Vision call is killed and reported with the stage it stopped in.
const ATTEMPT_TIMEOUT_MS = Number(process.env.DEXDETAIL_TIMEOUT_MS) > 0 ? Number(process.env.DEXDETAIL_TIMEOUT_MS) : 20000;
const MAX_ATTEMPTS = 2;

const MODES = ['face', 'hand', 'person'];
const DEFAULT_PROMPTS = {
  face: 'preserve identity, pose and expression; improve facial anatomy, eyes, mouth and skin detail',
  hand: 'preserve hand pose and interaction; correct hand anatomy and finger structure',
  person: 'preserve pose and scene composition; improve anatomy and clothing detail'
};

class DetailerError extends Error {
  constructor(message, code, extra = {}) {
    super(message);
    this.name = 'DetailerError';
    this.code = code;          // not_found | unavailable | bad_option | timeout | vision_failed | bad_output
    this.status = code === 'not_found' ? 404 : code === 'bad_option' ? 400 : code === 'timeout' ? 504 : 500;
    Object.assign(this, extra);
  }
}

function isVisionDetailerAvailable() {
  return fs.existsSync(VISION_DETAILER_BIN);
}

// option name → [CLI flag, min, max, default]
const NUMERIC = {
  threshold: ['--threshold', 0, 1],
  padding: ['--padding', 0, 3],
  feather: ['--feather', 0, 200],
  maxTargets: ['--max-targets', 1, 50],
  minArea: ['--min-area', 0, 1],
  maxArea: ['--max-area', 0, 1],
  offsetX: ['--offset-x', -2048, 2048],
  offsetY: ['--offset-y', -2048, 2048],
  dilate: ['--dilate', -256, 256]
};

/** Validate caller options and turn them into CLI args. Unset options are omitted so the binary's defaults apply. */
function buildArgs(imagePath, options = {}) {
  const mode = String(options.mode || 'face').toLowerCase();
  if (!MODES.includes(mode)) throw new DetailerError(`mode must be one of ${MODES.join(', ')} (got '${options.mode}')`, 'bad_option');
  const args = ['--image', imagePath, '--mode', mode];
  for (const [key, [flag, lo, hi]] of Object.entries(NUMERIC)) {
    const raw = options[key];
    if (raw === undefined || raw === null || raw === '') continue;
    const v = Number(raw);
    if (!Number.isFinite(v) || v < lo || v > hi) throw new DetailerError(`${key} must be a number between ${lo} and ${hi} (got '${raw}')`, 'bad_option');
    args.push(flag, String(v));
  }
  if (options.targetSelection !== undefined && options.targetSelection !== null && options.targetSelection !== '') {
    const sel = String(options.targetSelection).toLowerCase();
    if (!['largest', 'all'].includes(sel)) throw new DetailerError(`targetSelection must be 'largest' or 'all' (got '${options.targetSelection}')`, 'bad_option');
    args.push('--target-selection', sel);
  }
  if (options.personQuality) {
    const q = String(options.personQuality).toLowerCase();
    if (!['fast', 'balanced', 'accurate'].includes(q)) throw new DetailerError(`personQuality must be fast, balanced or accurate`, 'bad_option');
    args.push('--person-quality', q);
  }
  if (options.maskFormat) {
    const f = String(options.maskFormat).toLowerCase();
    if (!['alpha', 'gray'].includes(f)) throw new DetailerError(`maskFormat must be alpha or gray`, 'bad_option');
    args.push('--mask-format', f);
  }
  if (options.outputMask) args.push('--output-mask', options.outputMask);
  return { mode, args };
}

/**
 * Root cause of the stalls seen so far (OBSERVED 2026-10-02): Vision's first use of a network on the Apple Neural Engine
 * compiles it through `aned`/ANECompilerService; a runaway ANECompilerService (≈100 % CPU for >1 h) blocked every such call
 * inside _ANEClient doLoadModel. The detector therefore pins Vision to the CPU. This reports the condition if it still stalls.
 */
function neuralEngineDiagnostic() {
  return new Promise(resolve => {
    const hard = setTimeout(() => resolve(''), 1500);          // the diagnostic itself must never delay the error
    const done = v => { clearTimeout(hard); resolve(v); };
    execFile('/bin/ps', ['-axo', 'pid=,etime=,%cpu=,command='], { timeout: 3000 }, (err, out) => {
      if (err) return done('');
      const hot = String(out).split('\n').map(l => l.trim()).find(l => /ANECompilerService/.test(l) && Number(l.split(/\s+/)[2]) > 50);
      if (!hot) return done('');
      const [pid, etime] = hot.split(/\s+/);
      done(` macOS's ANECompilerService (pid ${pid}) has been using a full CPU core for ${etime} and is blocking the Neural Engine; ending it (it restarts on demand) clears this.`);
    });
  });
}

function runOnce(args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(VISION_DETAILER_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    let lastStage = 'spawn';
    let settled = false;
    let timedOut = false;
    const finish = (fn, val) => { if (settled) return; settled = true; clearTimeout(timer); fn(val); };
    const timer = setTimeout(async () => {
      timedOut = true;
      try { child.kill('SIGKILL'); } catch (_) {}
      const hint = await neuralEngineDiagnostic();
      finish(reject, new DetailerError(
        `Apple Vision detector did not finish within ${Math.round(timeoutMs / 1000)} s (stopped in stage '${lastStage}').` +
        (hint || ' The Mac is probably under heavy memory/CPU pressure — close heavy apps and retry.'),
        'timeout', { stage: lastStage, elapsed_ms: Date.now() - started }));
    }, timeoutMs);
    child.stdout.on('data', d => { out += d; if (out.length > 4e6) { try { child.kill('SIGKILL'); } catch (_) {} } });
    child.stderr.on('data', d => {
      err += d;
      const m = String(d).match(/DEXDETAIL_STAGE=([\w-]+)/g);
      if (m) lastStage = m[m.length - 1].split('=')[1];
      if (err.length > 64000) err = err.slice(-32000);
    });
    child.on('error', e => !timedOut && finish(reject, new DetailerError(`Could not start the Vision detector: ${e.message}`, 'unavailable')));
    child.on('close', (code, signal) => {
      if (settled || timedOut) return;
      if (code !== 0) {
        const line = err.split('\n').filter(l => l && !l.startsWith('DEXDETAIL_STAGE=')).pop() || `exit ${code ?? signal}`;
        return finish(reject, new DetailerError(`Vision detector failed: ${line.replace(/^Error:\s*/, '')}`, 'vision_failed', { stage: lastStage }));
      }
      try { finish(resolve, JSON.parse(out.trim())); }
      catch (e) { finish(reject, new DetailerError('Vision detector returned unreadable output', 'bad_output', { stage: lastStage })); }
    });
  });
}

/**
 * Run the native detector. Resolves to the detector's normalised result:
 *   { status, mode, detections[], detections_count, candidates, filtered, mask?, timings_ms, attempts }
 * An empty detection list is a valid result (the caller decides what to tell the user).
 */
async function detectRegions(imagePath, options = {}) {
  if (!fs.existsSync(imagePath)) throw new DetailerError(`Source image not found: ${imagePath}`, 'not_found');
  if (!isVisionDetailerAvailable()) throw new DetailerError('Native Apple Vision detailer binary not found; compile bin/vision-detailer.swift with swiftc -O.', 'unavailable');
  const { args } = buildArgs(imagePath, options);
  const timeoutMs = options.timeoutMs || ATTEMPT_TIMEOUT_MS;
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await runOnce(args, timeoutMs);
      res.attempts = attempt;
      return res;
    } catch (e) {
      lastErr = e;
      if (!(e instanceof DetailerError) || e.code !== 'timeout') break;   // only a stall is worth retrying
    }
  }
  if (lastErr && lastErr.code === 'timeout') lastErr.message += ` (tried ${MAX_ATTEMPTS} times)`;
  throw lastErr;
}

/** Alias with the product name: detect → select → mask in one call. */
const detectDetailTargets = detectRegions;

function getDefaultDetailerPrompt(mode = 'face') {
  return DEFAULT_PROMPTS[mode] || DEFAULT_PROMPTS.face;
}

module.exports = {
  VISION_DETAILER_BIN,
  ATTEMPT_TIMEOUT_MS,
  MODES,
  DetailerError,
  isVisionDetailerAvailable,
  buildArgs,
  detectRegions,
  detectDetailTargets,
  getDefaultDetailerPrompt,
  DEFAULT_PROMPTS
};
