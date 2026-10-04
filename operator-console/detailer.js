'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

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

// Dependency injection is module-only: no request, environment or production debug switch
// can choose a worker. Tests use a real, narrowly owned child instead of stalling macOS.
function createDetector({ spawnWorker = spawn, binary = VISION_DETAILER_BIN, attempts = MAX_ATTEMPTS, defaultTimeoutMs = ATTEMPT_TIMEOUT_MS } = {}) {
  function runOnce(args, timeoutMs, signal) {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      let child, out = '', err = '', lastStage = 'spawn', settled = false, failure = null;
      let timer, reapTimer;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true; clearTimeout(timer); clearTimeout(reapTimer);
        if (signal) signal.removeEventListener('abort', cancel);
        fn(value);
      };
      const terminate = code => {
        if (failure || settled) return;
        failure = new DetailerError(code === 'cancelled' ? 'Apple Vision detection cancelled.' :
          `Apple Vision detector did not finish within ${timeoutMs} ms (stopped in stage '${lastStage}'). Retry when the detector is available.`,
          code, { stage: lastStage, elapsed_ms: Date.now() - started, worker_cleanup: 'pending' });
        try { child.kill('SIGKILL'); } catch (_) {}
        // Do not wait indefinitely for pipes/close if the owned worker cannot be reaped.
        reapTimer = setTimeout(() => { failure.worker_cleanup = 'unknown'; finish(reject, failure); }, 1000);
      };
      const cancel = () => terminate('cancelled');
      if (signal && signal.aborted) return finish(reject, new DetailerError('Apple Vision detection cancelled.', 'cancelled'));
      try { child = spawnWorker(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] }); }
      catch (e) { return finish(reject, new DetailerError(`Could not start the Vision detector: ${e.message}`, 'unavailable')); }
      timer = setTimeout(() => terminate('timeout'), timeoutMs);
      if (signal) signal.addEventListener('abort', cancel, { once: true });
      child.stdout.on('data', d => {
        out += d;
        if (out.length > 4e6) { terminate('bad_output'); }
      });
      child.stderr.on('data', d => {
        err += d;
        const m = err.match(/DEXDETAIL_STAGE=([\w-]+)/g);
        if (m) lastStage = m[m.length - 1].split('=')[1];
        if (err.length > 64000) err = err.slice(-32000);
      });
      child.on('error', e => finish(reject, new DetailerError(`Could not start the Vision detector: ${e.message}`, 'unavailable')));
      child.on('close', (code, sig) => {
        if (settled) return;
        if (failure) { failure.worker_cleanup = 'succeeded'; return finish(reject, failure); }
        if (code !== 0) {
          const line = err.split('\n').filter(l => l && !l.startsWith('DEXDETAIL_STAGE=')).pop() || `exit ${code ?? sig}`;
          return finish(reject, new DetailerError(`Vision detector failed: ${line.replace(/^Error:\s*/, '')}`, 'vision_failed', { stage: lastStage }));
        }
        try { finish(resolve, JSON.parse(out.trim())); }
        catch (_) { finish(reject, new DetailerError('Vision detector returned unreadable output', 'bad_output', { stage: lastStage })); }
      });
    });
  }
  return async function detect(imagePath, options = {}) {
    if (!fs.existsSync(imagePath)) throw new DetailerError(`Source image not found: ${imagePath}`, 'not_found');
    if (!fs.existsSync(binary)) throw new DetailerError('Native Apple Vision detailer binary not found.', 'unavailable');
    const ownedMask = options.outputMask ? options.outputMask + '.detector-' + require('crypto').randomBytes(6).toString('hex') + '.png' : null;
    const { args } = buildArgs(imagePath, { ...options, outputMask: ownedMask || undefined });
    const timeoutMs = Number(options.timeoutMs || defaultTimeoutMs);
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 120000) throw new DetailerError('Detector timeout must be 1..120000 ms', 'bad_option');
    let lastErr;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const result = await runOnce(args, timeoutMs, options.signal);
        if (ownedMask) {
          if (!fs.existsSync(ownedMask)) throw new DetailerError('Vision detector did not create its requested mask', 'bad_output');
          fs.renameSync(ownedMask, options.outputMask);
          if (result.mask) result.mask.path = options.outputMask;
        }
        result.attempts = attempt;
        return result;
      } catch (e) {
        lastErr = e;
        if (ownedMask) { try { fs.unlinkSync(ownedMask); } catch (_) {} }
        // Never retry cancellation, unreaped workers or corrupt output.
        if (!(e instanceof DetailerError) || e.code !== 'timeout' || e.worker_cleanup !== 'succeeded') break;
      }
    }
    if (lastErr && lastErr.code === 'timeout') lastErr.message += ` (tried ${attempts} times)`;
    throw lastErr;
  };
}
const detectRegions = createDetector();

/** Alias with the product name: detect → select → mask in one call. */
const detectDetailTargets = detectRegions;

function getDefaultDetailerPrompt(mode = 'face') {
  return DEFAULT_PROMPTS[mode] || DEFAULT_PROMPTS.face;
}

module.exports = {
  createDetector,
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
