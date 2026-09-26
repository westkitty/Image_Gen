'use strict';

// DexDiffusion voice/music execution bridges (MacBook side).
//
//   request -> validate + resolve staged reference (server-side only)
//   -> durable generic job (private text redacted unless prompt saving is on)
//   -> Big Mac heavy-compute lease (shared arbiter, capacity 1)
//   -> ssh westcat: private job dir, request.json (0600), dexmedia_remote.py
//   -> in-band markers (never the SSH exit status)
//   -> scp WAV back -> sha256 verified -> mediaStore.finalize (canonical root)
//   -> remote job dir removed and verified gone -> lease released.
//
// Big Mac holds generated audio only inside the job dir until it is verified
// on the MacBook; model/runtime assets are never touched.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');
const { WORKER_PATHS } = require('./media');

const DRIVER_PATH = path.join(__dirname, 'bridges', 'dexmedia_remote.py');
const REMOTE_TMP_BASE = '$HOME/Library/Caches/DexDiffusion/tmp';
const KOKORO_VOICES = ['af_heart', 'af_bella', 'af_nicole', 'af_sarah', 'af_sky', 'am_adam', 'am_michael', 'am_echo', 'am_liam', 'bf_emma', 'bf_isabella', 'bm_george', 'bm_lewis'];
const LANGS = ['en', 'zh', 'ja', 'ko', 'de', 'fr', 'es', 'it', 'pt', 'ru'];
const MAX_TEXT = 2000;
const TIMEOUT_MS = { tts: 8 * 60 * 1000, 'ace-step': 25 * 60 * 1000, 'magenta-rt': 10 * 60 * 1000 };

// Execution specs for bridged workers (paths come from WORKER_PATHS).
const BRIDGES = {
  kokoro: { media_kind: 'voice', operation: 'speech', python: WORKER_PATHS.kokoro.runtime.python, model: path.dirname(WORKER_PATHS.kokoro.models.voices) },
  'qwen3-tts-base': { media_kind: 'voice', operation: 'clone', python: WORKER_PATHS['qwen3-tts-base'].runtime.python, model: path.dirname(WORKER_PATHS['qwen3-tts-base'].models.base) },
  'qwen3-tts-voice-design': { media_kind: 'voice', operation: 'design', python: WORKER_PATHS['qwen3-tts-voice-design'].runtime.python, model: path.dirname(WORKER_PATHS['qwen3-tts-voice-design'].models['voice-design']) },
  'ace-step': { media_kind: 'music', operation: 'song', python: WORKER_PATHS['ace-step'].runtime.python, aceSrc: path.dirname(path.dirname(path.dirname(WORKER_PATHS['ace-step'].runtime.python))) },
  'magenta-rt': { media_kind: 'music', operation: 'music', python: WORKER_PATHS['magenta-rt'].runtime.python, magentaData: path.dirname(path.dirname(WORKER_PATHS['magenta-rt'].models['mrt2-small'])) },
};

const str = v => (typeof v === 'string' ? v.trim() : '');
function intOrNull(v, lo, hi) { if (v === undefined || v === null || v === '') return null; const n = Number(v); return Number.isInteger(n) && n >= lo && n <= hi ? n : NaN; }

// Validate a generate request. Returns { error, gate } or { req, safe, refId }.
// `req` holds private text and lives only in memory; `safe` may persist.
function validateRequest(worker, body) {
  const b = body || {};
  const bad = (m, gate = 'invalid-request') => ({ error: m, gate });
  const seed = intOrNull(b.seed, 0, 2147483647);
  if (Number.isNaN(seed)) return bad('seed must be an integer 0-2147483647');
  const lang = str(b.language) || 'en';
  if (!LANGS.includes(lang)) return bad('unsupported language');
  if (worker === 'kokoro' || worker === 'qwen3-tts-base' || worker === 'qwen3-tts-voice-design') {
    const text = str(b.text);
    if (!text) return bad('Text to speak is required');
    if (text.length > MAX_TEXT) return bad(`Text is limited to ${MAX_TEXT} characters`);
    if (worker === 'kokoro') {
      const voice = str(b.voice) || 'af_heart';
      if (!KOKORO_VOICES.includes(voice)) return bad('unknown Kokoro voice');
      const speed = b.speed === undefined || b.speed === '' ? 1 : Number(b.speed);
      if (!(speed >= 0.5 && speed <= 2)) return bad('speed must be 0.5-2');
      return { req: { worker, text, voice, lang_code: voice[0], speed }, safe: { voice, speed, language: voice[0] } };
    }
    if (worker === 'qwen3-tts-base') {
      if (!str(b.staged_ref)) return bad('Voice Clone needs a staged reference audio clip', 'reference-invalid');
      const refText = str(b.ref_text);
      if (refText.length > MAX_TEXT) return bad('Reference transcript too long');
      return { req: { worker, text, ref_text: refText, lang_code: lang, seed }, safe: { language: lang, seed, reference: 'staged', has_transcript: !!refText }, refId: str(b.staged_ref) };
    }
    const instruct = str(b.instruct);
    if (!instruct) return bad('Voice Design needs a voice description');
    if (instruct.length > 1000) return bad('Voice description too long');
    return { req: { worker, text, instruct, lang_code: lang, seed }, safe: { language: lang, seed } };
  }
  if (worker === 'ace-step') {
    const parts = [str(b.prompt), str(b.style) && `style: ${str(b.style)}`, str(b.genre) && `genre: ${str(b.genre)}`,
      str(b.mood) && `mood: ${str(b.mood)}`, str(b.instruments) && `instrumentation: ${str(b.instruments)}`].filter(Boolean);
    const caption = parts.join(', ');
    if (!caption) return bad('Describe the song (description, style, genre, mood or instrumentation)');
    if (caption.length > 512) return bad('Song description is limited to 512 characters (ACE-Step caption)');
    const lyrics = str(b.lyrics);
    if (lyrics.length > 4096) return bad('Lyrics are limited to 4096 characters');
    const duration = b.duration === undefined || b.duration === '' ? 30 : Number(b.duration);
    if (!(duration >= 10 && duration <= 240)) return bad('ACE-Step duration must be 10-240 s');
    const influence = b.influence === undefined || b.influence === '' ? 0.5 : Number(b.influence);
    if (!(influence >= 0 && influence <= 1)) return bad('reference influence must be 0-1');
    const s = seed === null ? crypto.randomInt(0, 2147483647) : seed;
    return { req: { worker, caption, lyrics, instrumental: !!b.instrumental, vocal_language: lang, duration, seed: s, influence },
      safe: { duration, seed: s, instrumental: !!b.instrumental, language: lang, reference: str(b.staged_ref) ? 'staged' : null, influence: str(b.staged_ref) ? influence : null },
      refId: str(b.staged_ref) || null };
  }
  if (worker === 'magenta-rt') {
    const prompt = str(b.prompt);
    if (!prompt) return bad('Describe the music for Magenta');
    if (prompt.length > 512) return bad('Magenta prompt is limited to 512 characters');
    const duration = b.duration === undefined || b.duration === '' ? 8 : Number(b.duration);
    if (!(duration >= 2 && duration <= 60)) return bad('Magenta duration must be 2-60 s');
    return { req: { worker, prompt, duration }, safe: { duration } };
  }
  return bad('worker has no execution bridge', 'worker-unavailable');
}

// Shell payload executed by `ssh westcat bash -s`. Private text travels only
// inside the base64 request (stdin), never in argv.
function buildPayload({ dir, request, driverSource, python, magentaData }) {
  const b64 = s => Buffer.from(s).toString('base64');
  const q = s => `'${String(s).replace(/'/g, `'\\''`)}'`;
  const lines = [
    'set -u', 'umask 077',
    `D=${q(dir)}`,
    'case "$D" in "$HOME/Library/Caches/DexDiffusion/tmp/dexmedia."*) ;; *) echo "DEXMEDIA_FAIL=cleanup"; echo "DEXMEDIA_ERROR=bad job dir"; exit 0 ;; esac',
    'mkdir -p "$D/out"',
    `printf %s ${q(b64(driverSource))} | base64 -d > "$D/driver.py"`,
    `printf %s ${q(b64(JSON.stringify(request)))} | base64 -d > "$D/request.json"`,
    'chmod 600 "$D/request.json"',
  ];
  let env = '';
  if (magentaData) {
    lines.push('mkdir -p "$D/mhome/magenta-rt-v2"',
      `ln -sfn ${q(magentaData + '/resources')} "$D/mhome/magenta-rt-v2/resources"`,
      `ln -sfn ${q(magentaData + '/models')} "$D/mhome/magenta-rt-v2/models"`);
    env = 'MAGENTA_HOME="$D/mhome" ';
  }
  lines.push(`PY=${python.replace(/^\$HOME/, '"$HOME"')}`,
    '[ -x "$PY" ] || { echo "DEXMEDIA_FAIL=runtime-missing"; echo "DEXMEDIA_ERROR=worker python missing"; exit 0; }',
    `${env}"$PY" "$D/driver.py" "$D/request.json" 2>&1`,
    'rm -f "$D/request.json"',
    'echo "DEXMEDIA_DONE"');
  return lines.join('\n') + '\n';
}

function parseMarkers(text) {
  const m = {};
  for (const line of String(text || '').split('\n')) {
    const r = /^DEXMEDIA_([A-Z0-9_]+)(?:=(.*))?$/.exec(line.trim());
    if (r) m[r[1]] = r[2] === undefined ? true : r[2];
  }
  return m;
}

function sha256File(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }

function sshRun(target, script, timeoutMs) {
  return new Promise(resolve => {
    const child = spawn('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', target, 'bash -s'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    const t = setTimeout(() => { try { child.kill('SIGTERM'); } catch (_) {} }, timeoutMs);
    child.stdout.on('data', d => { out += d; if (out.length > 8e6) out = out.slice(-4e6); });
    child.stderr.on('data', () => {});
    child.on('close', () => { clearTimeout(t); resolve(out); });
    child.on('error', () => { clearTimeout(t); resolve(out); });
    child.stdin.end(script);
  });
}
function execP(cmd, args, timeoutMs = 120000) {
  return new Promise(resolve => execFile(cmd, args, { timeout: timeoutMs, encoding: 'utf8' }, (err, stdout) => resolve({ ok: !err, stdout: String(stdout || '') })));
}

// Stage an arbitrary staged audio reference as PCM WAV (mlx-audio / ACE-Step
// read WAV reliably) in a private local temp file.
async function referenceToWav(staged) {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dexref-')), 'ref.wav');
  const r = await execP('ffmpeg', ['-v', 'error', '-y', '-i', staged.path, '-ac', '1', '-ar', '24000', '-c:a', 'pcm_s16le', out]);
  if (!r.ok || !fs.existsSync(out) || fs.statSync(out).size < 1024) return null;
  return out;
}

// exec/sshRun/toWav are injectable for tests; production uses ssh/scp/ffmpeg.
function createMediaBridge({ jobStore, arbiter, mediaStore, staging, sshTarget = 'westcat', evidenceFile, log = () => {}, onRemoteOutput = null,
  exec = execP, sshRunFn = sshRun, toWav = referenceToWav }) {
  const evidence = {
    read() { try { return JSON.parse(fs.readFileSync(evidenceFile, 'utf8')); } catch (_) { return {}; } },
    pass(worker, rec) {
      const d = this.read(); d[worker] = { lastPass: rec }; fs.mkdirSync(path.dirname(evidenceFile), { recursive: true });
      const tmp = evidenceFile + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(d, null, 1)); fs.renameSync(tmp, evidenceFile);
    },
  };

  async function run(jobId, worker, spec, v, private_) {
    const fail = (gate, error) => { jobStore.transition(jobId, 'FAILED', { first_failed_gate: gate, error }); return { ok: false, gate }; };
    let remoteDir = null, localRef = null, localOut = null;
    try {
      // 1. lease (capacity 1, shared with image jobs)
      const lease = await arbiter.acquire(jobId, `${worker} ${spec.operation}`);
      if (!lease.granted) return fail('resource', 'heavy-compute lease was not granted');
      const g = jobStore.get(jobId);
      if (!g || g.status !== 'QUEUED') return { ok: false, gate: 'interrupted' };
      jobStore.transition(jobId, 'RUNNING', { resource_lease: arbiter.state().group });

      // 2. private remote job dir
      const mk = await exec('ssh', ['-o', 'BatchMode=yes', sshTarget,
        `mkdir -p "$HOME/Library/Caches/DexDiffusion/tmp" && d=$(mktemp -d "$HOME/Library/Caches/DexDiffusion/tmp/dexmedia.XXXXXX") && chmod 700 "$d" && echo "DEXMEDIA_DIR=$d"`]);
      remoteDir = parseMarkers(mk.stdout).DIR;
      if (!remoteDir) return fail('worker-unavailable', 'could not create a Big Mac job directory');

      // 3. reference audio (server-resolved staged file only)
      const request = { ...private_, out_dir: `${remoteDir}/out`, model: spec.model, ace_src: spec.aceSrc };
      if (worker === 'kokoro') request.voice_path = `${spec.model}/voices/${private_.voice}.safetensors`;
      if (v.refId) {
        const st = staging.get(v.refId);
        if (!st || st.kind !== 'audio') return fail('reference-invalid', 'staged reference audio not found or expired');
        localRef = await toWav(st);
        if (!localRef) return fail('reference-invalid', 'reference audio could not be converted to WAV');
        const up = await exec('scp', ['-q', localRef, `${sshTarget}:${remoteDir}/ref.wav`]);
        const chk = await exec('ssh', ['-o', 'BatchMode=yes', sshTarget, `test -s "${remoteDir}/ref.wav" && echo DEXMEDIA_REF_OK`]);
        if (!up.ok && !parseMarkers(chk.stdout).REF_OK) return fail('transfer', 'reference upload failed');
        if (!parseMarkers(chk.stdout).REF_OK) return fail('transfer', 'reference upload missing on Big Mac');
        request.ref_audio = `${remoteDir}/ref.wav`;
      }

      // 4. generate
      const payload = buildPayload({ dir: remoteDir, request, driverSource: fs.readFileSync(DRIVER_PATH, 'utf8'), python: spec.python, magentaData: spec.magentaData });
      const out = await sshRunFn(sshTarget, payload, TIMEOUT_MS[worker] || TIMEOUT_MS.tts);
      if (onRemoteOutput) onRemoteOutput(out); // test/diagnostic hook only; never persisted
      const mk2 = parseMarkers(out);
      if (!mk2.DONE && !mk2.FAIL && !mk2.PASS) return fail('generation', 'Big Mac generation did not report completion (timeout or connection loss)');
      if (mk2.FAIL) return fail(String(mk2.FAIL), `${worker}: ${mk2.ERROR || 'generation failed'}`);
      if (!mk2.PASS || !mk2.OUTPUT || !/^[a-f0-9]{64}$/.test(mk2.SHA256 || '')) return fail('output-missing', 'no validated output reported');
      if (!String(mk2.OUTPUT).startsWith(remoteDir + '/')) return fail('output-invalid', 'output outside the job directory');

      // 5. transfer + checksum
      jobStore.transition(jobId, 'TRANSFERRING');
      localOut = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dexmedia-')), 'out.wav');
      await exec('scp', ['-q', `${sshTarget}:${mk2.OUTPUT}`, localOut], 300000);
      if (!fs.existsSync(localOut) || fs.statSync(localOut).size === 0) return fail('transfer', 'WAV transfer from Big Mac failed');
      const sha = sha256File(localOut);
      if (sha !== mk2.SHA256) return fail('checksum', 'transferred WAV checksum does not match Big Mac');

      // 6. canonicalize (atomic, never overwrite)
      let rec;
      try {
        const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
        rec = mediaStore.finalize(localOut, {
          kind: spec.media_kind, base: `${stamp}-${worker}-${spec.operation}`, job_id: jobId, worker, model: worker,
          seed: v.safe.seed ?? null, duration: Number(mk2.DURATION) || null,
          meta: { operation: spec.operation, sample_rate: Number(mk2.SAMPLE_RATE) || null, channels: Number(mk2.CHANNELS) || null, reference_used: !!v.refId, ...v.safe },
        });
      } catch (e) { return fail('canonicalization', String(e.message).slice(0, 200)); }
      if (rec.sha256 !== sha) return fail('checksum', 'canonical file checksum mismatch');
      jobStore.transition(jobId, 'COMPLETE', { artifacts: [rec.artifact_id] });
      evidence.pass(worker, { at: new Date().toISOString(), job_id: jobId, artifact_id: rec.artifact_id, sha256: sha });
      return { ok: true, artifact: rec };
    } catch (e) {
      const g = jobStore.get(jobId);
      if (g && !['COMPLETE', 'FAILED', 'INTERRUPTED', 'CANCELLED'].includes(g.status)) return fail('generation', String(e.message).slice(0, 200));
      return { ok: false };
    } finally {
      for (const f of [localRef, localOut]) if (f) try { fs.rmSync(path.dirname(f), { recursive: true, force: true }); } catch (_) {}
      if (remoteDir) {
        const rm = await exec('ssh', ['-o', 'BatchMode=yes', sshTarget, `case "${remoteDir}" in "$HOME/Library/Caches/DexDiffusion/tmp/dexmedia."*) rm -rf "${remoteDir}"; test -e "${remoteDir}" && echo DEXMEDIA_STILL_THERE || echo DEXMEDIA_CLEANED ;; esac`]);
        const cm = parseMarkers(rm.stdout);
        if (!cm.CLEANED) {
          // Canonical output (if any) is kept; the cleanup problem is recorded truthfully.
          const g = jobStore.get(jobId);
          if (g) { g.cleanup_error = 'Big Mac job directory could not be verified removed'; jobStore.transition(jobId, g.status, {}); }
          log(`media-bridge: cleanup of ${remoteDir} not verified`);
        }
      }
      arbiter.release(jobId);
    }
  }

  // Validate, create the durable job and start the run. Validation and
  // capability gating happen BEFORE any lease is requested.
  function start(worker, body, { probe, saveText }) {
    const spec = BRIDGES[worker];
    if (!spec) return { error: 'worker has no execution bridge', gate: 'worker-unavailable', status: 409 };
    if (!probe.runtime_available) return { error: 'Runtime not installed', gate: 'runtime-missing', status: 409 };
    if (!probe.model_available) return { error: 'Model not installed', gate: 'model-missing', status: 409 };
    const v = validateRequest(worker, body);
    if (v.error) return { error: v.error, gate: v.gate, status: 400 };
    if (v.refId && !staging.get(v.refId)) return { error: 'staged reference audio not found or expired', gate: 'reference-invalid', status: 400 };
    const job = jobStore.create({ media_kind: spec.media_kind, operation: spec.operation, worker_id: worker, model_id: worker,
      resource_class: 'heavy', params: { ...v.safe, ...privateOnly(v.req) }, persist_text: !!saveText });
    run(job.job_id, worker, spec, v, v.req).catch(() => {});
    return { job_id: job.job_id, status: 'QUEUED' };
  }
  // Remove DexDiffusion-owned remote job dirs left behind by an interrupted
  // run (e.g. console restart). Only $HOME/Library/Caches/DexDiffusion/tmp/
  // dexmedia.* older than maxAgeMin is touched; never models or runtimes.
  async function sweepRemoteOrphans(maxAgeMin = 60) {
    const n = Math.max(0, Math.floor(Number(maxAgeMin) || 0));
    const r = await exec('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', sshTarget,
      `T="$HOME/Library/Caches/DexDiffusion/tmp"; [ -d "$T" ] || { echo DEXMEDIA_SWEPT=0; exit 0; }; ` +
      `c=0; for d in $(find "$T" -maxdepth 1 -type d -name 'dexmedia.*' -mmin +${n}); do rm -rf "$d"; c=$((c+1)); done; echo DEXMEDIA_SWEPT=$c; ` +
      `echo DEXMEDIA_REMAINING=$(find "$T" -maxdepth 1 -type d -name 'dexmedia.*' | wc -l | tr -d ' ')`]);
    const m = parseMarkers(r.stdout);
    return { swept: m.SWEPT === undefined ? null : Number(m.SWEPT), remaining: m.REMAINING === undefined ? null : Number(m.REMAINING) };
  }
  return { start, evidence, sweepRemoteOrphans, BRIDGES };
}

// Private text keys, passed to jobStore.create so its PRIVATE_KEYS policy
// redacts them unless prompt saving is on.
function privateOnly(req) {
  const map = { text: 'text', ref_text: 'reference_transcript', instruct: 'voice_description', prompt: 'prompt', caption: 'description', lyrics: 'lyrics' };
  const out = {};
  for (const [k, dest] of Object.entries(map)) if (typeof req[k] === 'string' && req[k]) out[dest] = req[k];
  return out;
}

module.exports = { createMediaBridge, validateRequest, buildPayload, parseMarkers, BRIDGES, KOKORO_VOICES, LANGS, DRIVER_PATH, privateOnly };
