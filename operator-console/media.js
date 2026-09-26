'use strict';

// Media-neutral core for DexDiffusion (images, voice, music, future video).
//
//   createJobStore        durable generic job records + lifecycle + restart reconciliation
//   createResourceArbiter server-side Big Mac heavy-compute lease (capacity 1)
//   createWorkerRegistry  worker contract (probe/capabilities/prepare/execute/status/cancel/cleanup)
//   createMediaStore      canonical artifacts for non-image media (+ safe resolution)
//   createStaging         secure temporary source/reference imports
//
// Images keep their proven image-store.js; this layer adapts to it rather than
// replacing it. Nothing here downloads, installs or generates anything.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const MEDIA_KINDS = ['image', 'voice', 'music', 'video'];
const CANONICAL_ROOTS = {
  image: '/Users/andrew/images_made',
  voice: '/Users/andrew/audio_made/voice',
  music: '/Users/andrew/audio_made/music',
  video: '/Users/andrew/video_made',
};

function atomicWriteJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
  const fd = fs.openSync(tmp, 'w', 0o600);
  try { fs.writeSync(fd, JSON.stringify(data, null, 1) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}

// ---- Generic jobs ----------------------------------------------------------
const JOB_STATES = ['QUEUED', 'RUNNING', 'TRANSFERRING', 'COMPLETE', 'FAILED', 'INTERRUPTED', 'CANCELLED'];
const TERMINAL = new Set(['COMPLETE', 'FAILED', 'INTERRUPTED', 'CANCELLED']);
const TRANSITIONS = {
  QUEUED: ['RUNNING', 'FAILED', 'CANCELLED', 'INTERRUPTED'],
  RUNNING: ['TRANSFERRING', 'COMPLETE', 'FAILED', 'CANCELLED', 'INTERRUPTED'],
  TRANSFERRING: ['COMPLETE', 'FAILED', 'INTERRUPTED'],
};
const FAILURE_GATES = ['worker-unavailable', 'runtime-missing', 'model-missing', 'resource-wait', 'resource-interrupted',
  'reference-invalid', 'generation-failed', 'output-missing', 'output-invalid', 'transfer-failed', 'checksum-mismatch',
  'canonicalization-failed', 'cleanup-failed', 'server-restart'];
// Keys never written to durable job state (private text), whatever the caller passes.
const PRIVATE_KEYS = new Set(['prompt', 'negative_prompt', 'negativePrompt', 'extension_prompt', 'text', 'lyrics', 'description',
  'voice_description', 'reference_transcript', 'style_instruction', 'mask_data']);

function safeParams(params, persistText) {
  const out = {};
  for (const [k, v] of Object.entries(params || {})) {
    if (PRIVATE_KEYS.has(k)) { if (persistText && typeof v === 'string' && k !== 'mask_data') out[k] = v; else if (v) out[k] = '[REDACTED]'; continue; }
    if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) out[k] = v;
  }
  return out;
}

function createJobStore(file, { now = () => Date.now() } = {}) {
  const jobs = new Map();
  let timer = null;
  function persist() { if (file) atomicWriteJson(file, { schema: 'dexdiffusion.jobs.v1', jobs: [...jobs.values()] }); }
  function schedule() { clearTimeout(timer); timer = setTimeout(() => { try { persist(); } catch (_) {} }, 50); if (timer.unref) timer.unref(); }
  function flush() { clearTimeout(timer); persist(); }

  // Restart reconciliation: nothing that was in flight is pretended to resume.
  function load() {
    if (!file) return;
    let data;
    try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return; }
    for (const j of (data && data.jobs) || []) {
      if (!TERMINAL.has(j.status)) {
        j.status = 'INTERRUPTED';
        j.first_failed_gate = j.first_failed_gate || 'server-restart';
        j.error = 'console restarted before this job finished; it was not re-run';
        j.completed_at = now();
        j.resource_lease = null;
        j.retry_requires_input = !j.privacy || !j.privacy.persist_text;
      }
      jobs.set(j.job_id, j);
    }
    persist();
  }

  function create({ job_id, media_kind, operation, worker_id, model_id = null, resource_class = 'light', params = {}, persist_text = false }) {
    if (!MEDIA_KINDS.includes(media_kind)) throw new Error('unknown media kind ' + media_kind);
    const id = job_id || crypto.randomUUID();
    const j = {
      job_id: id, media_kind, operation, worker_id, model_id, status: 'QUEUED', progress: null,
      created_at: now(), started_at: null, completed_at: null, resource_class, resource_lease: null,
      params: safeParams(params, persist_text), artifacts: [], first_failed_gate: null, error: null,
      privacy: { persist_text: !!persist_text },
    };
    jobs.set(id, j);
    schedule();
    return j;
  }
  function transition(id, status, patch = {}) {
    const j = jobs.get(id);
    if (!j) return { error: 'unknown job' };
    if (!JOB_STATES.includes(status)) return { error: 'unknown state ' + status };
    if (j.status !== status && !(TRANSITIONS[j.status] || []).includes(status)) return { error: `illegal transition ${j.status} -> ${status}` };
    j.status = status;
    if (status === 'RUNNING' && !j.started_at) j.started_at = now();
    if (TERMINAL.has(status)) { j.completed_at = now(); j.resource_lease = null; }
    for (const k of ['progress', 'artifacts', 'first_failed_gate', 'error', 'resource_lease', 'model_id']) if (patch[k] !== undefined) j[k] = patch[k];
    if (patch.error) j.error = String(patch.error).slice(0, 300);
    schedule();
    return j;
  }
  function get(id) { return jobs.get(id) || null; }
  function list({ media_kind, status, limit = 100 } = {}) {
    return [...jobs.values()].filter(j => (!media_kind || j.media_kind === media_kind) && (!status || j.status === status))
      .sort((a, b) => b.created_at - a.created_at).slice(0, limit);
  }
  load();
  return { create, transition, get, list, flush, file, _jobs: jobs };
}

// ---- Resource arbiter --------------------------------------------------------
// One exclusive group for heavyweight Big Mac inference (32 GB unified memory).
function createResourceArbiter({ group = 'bigmac-heavy-inference', capacity = 1, externalProbe = null, now = () => Date.now() } = {}) {
  const holders = new Map(); // jobId -> { since, label }
  const waiting = []; // { jobId, label, resolve, since }
  let external = { occupied: false, detail: null, checkedAt: null };

  function grantNext() {
    while (holders.size < capacity && waiting.length && !external.occupied) {
      const w = waiting.shift();
      holders.set(w.jobId, { since: now(), label: w.label });
      w.resolve({ granted: true, waitedMs: now() - w.since });
    }
  }
  function acquire(jobId, label = '') {
    if (holders.has(jobId)) return Promise.resolve({ granted: true, waitedMs: 0 });
    const existing = waiting.find(w => w.jobId === jobId);
    if (existing) return existing.promise;
    let resolve;
    const promise = new Promise(r => { resolve = r; });
    waiting.push({ jobId, label, resolve, since: now(), promise });
    grantNext();
    return promise;
  }
  function release(jobId) {
    const had = holders.delete(jobId);
    const i = waiting.findIndex(w => w.jobId === jobId);
    if (i >= 0) { waiting[i].resolve({ granted: false, cancelled: true }); waiting.splice(i, 1); }
    grantNext();
    return had;
  }
  function setExternal(state) {
    external = { occupied: !!(state && state.occupied), detail: (state && state.detail) || null, checkedAt: now() };
    grantNext();
  }
  async function refreshExternal() {
    if (!externalProbe) return external;
    try { setExternal(await externalProbe()); } catch (_) { /* probe failure never blocks work */ }
    return external;
  }
  function position(jobId) { const i = waiting.findIndex(w => w.jobId === jobId); return i < 0 ? null : i + 1; }
  function state() {
    const [owner] = [...holders.entries()];
    return {
      group, capacity,
      owner: owner ? { job_id: owner[0], label: owner[1].label, since: owner[1].since } : null,
      waiting: waiting.map((w, i) => ({ job_id: w.jobId, label: w.label, position: i + 1, since: w.since })),
      external,
      blocked_reason: external.occupied ? `external heavy workload on Big Mac: ${external.detail}`
        : owner ? `Waiting for Big Mac — ${owner[1].label || 'another job'} currently owns heavy compute` : null,
    };
  }
  return { acquire, release, state, position, setExternal, refreshExternal, holds: id => holders.has(id) };
}

// Read-only external heavy-load detection: an Ollama model loaded on Big Mac
// at >= minGb counts as heavy. Nothing is ever unloaded or killed.
function parseOllamaPs(text, minGb = 8) {
  const heavy = [];
  for (const line of String(text || '').split('\n').slice(1)) {
    const m = line.trim().match(/^(\S+)\s+\S+\s+([\d.]+)\s*(GB|MB)/);
    if (!m) continue;
    const gb = Number(m[2]) / (m[3] === 'MB' ? 1024 : 1);
    if (gb >= minGb) heavy.push(`ollama:${m[1]} (${gb.toFixed(1)} GB)`);
  }
  return { occupied: heavy.length > 0, detail: heavy.join(', ') || null };
}

// ---- Worker registry -----------------------------------------------------------
// Authoritative Big Mac install locations for voice/music/video workers (the
// layout written by the model-stack installer; see MODEL_STACK.md). The asset
// probe (capabilities.js) tests exactly these paths; a worker's runtime/model
// is "available" only when every listed path exists.
const GEN_MODELS = '/Volumes/wc2tb/generative-models';
const DEX_CACHE = '$HOME/Library/Caches/DexDiffusion';
const WORKER_PATHS = {
  'qwen3-tts': {
    runtime: { python: `${DEX_CACHE}/voice/venv/bin/python` },
    models: {
      base: `${GEN_MODELS}/voice/qwen3-tts-base/Qwen3-TTS-12Hz-1.7B-Base-bf16/config.json`,
      'voice-design': `${GEN_MODELS}/voice/qwen3-tts-voice-design/Qwen3-TTS-12Hz-1.7B-VoiceDesign-8bit/config.json`,
    },
  },
  'ace-step': {
    runtime: { python: `${DEX_CACHE}/music/ACE-Step-1.5/.venv/bin/python` },
    models: {
      turbo: `${GEN_MODELS}/music/ace-step/checkpoints/acestep-v15-turbo`,
      vae: `${GEN_MODELS}/music/ace-step/checkpoints/vae`,
      embedding: `${GEN_MODELS}/music/ace-step/checkpoints/Qwen3-Embedding-0.6B`,
      'lm-0.6b': `${GEN_MODELS}/music/ace-step/checkpoints/acestep-5Hz-lm-0.6B`,
    },
  },
  'magenta-rt': {
    runtime: { python: `${DEX_CACHE}/music/magenta-rt-venv/bin/python` },
    models: { 'mrt2-small': `${GEN_MODELS}/music/magenta-realtime/magenta-rt-v2/models/mrt2_small` },
  },
  'ltx-video': {
    runtime: { venv: `${DEX_CACHE}/ltx/venv` },
    models: { main: `${GEN_MODELS}/video/ltx` },
  },
};
// Flat [probeKey, path] list for the read-only Big Mac existence probe.
const WORKER_PROBE_PATHS = Object.entries(WORKER_PATHS).flatMap(([id, p]) => [
  ...Object.entries(p.runtime).map(([k, v]) => [`${id}:runtime:${k}`, v]),
  ...Object.entries(p.models).map(([k, v]) => [`${id}:model:${k}`, v]),
]);

// Workers without an execution bridge: they report install state truthfully
// and refuse to run. Installed assets never make them enabled/proven.
function dormantWorker({ id, media_kind, label, activation }) {
  const paths = WORKER_PATHS[id];
  const all = (assets, kind) => {
    const keys = Object.keys(paths[kind]).map(k => `${id}:${kind === 'runtime' ? 'runtime' : 'model'}:${k}`);
    return keys.every(k => assets[k] === true);
  };
  return {
    id, media_kind, label, resource_class: 'heavy', dormant: true,
    probe(assets = {}) {
      const rt = all(assets, 'runtime'), md = all(assets, 'models');
      const variants = Object.fromEntries(Object.keys(paths.models).map(k => [k, assets[`${id}:model:${k}`] === true]));
      return { architecture_available: true, runtime_available: rt, model_available: md, model_variants: variants, enabled: false, proven: false,
        installed: rt && md,
        state: !rt ? 'RUNTIME MISSING' : !md ? 'MODEL MISSING' : 'INSTALLED — execution bridge disabled/unproven',
        runtimePath: Object.values(paths.runtime).join(', '), modelPath: Object.values(paths.models).join(', '), activation };
    },
    capabilities() { return { generate: false, cancel_supported: false }; },
    prepare(assets = {}) { const p = this.probe(assets); return p.installed ? { ok: false, gate: 'worker-unavailable', error: `${label}: installed but execution bridge not enabled/proven` } : { ok: false, gate: 'runtime-missing', error: `${label}: runtime/model not installed` }; },
    execute(assets = {}) { return this.prepare(assets); },
    status() { return null; }, cancel() { return { ok: false, reason: 'not running' }; }, cleanup() { return { ok: true }; },
  };
}

function createWorkerRegistry({ imageAdapters = {} } = {}) {
  const workers = [
    Object.assign({ id: 'mflux', media_kind: 'image', label: 'MFLUX (FLUX.2 Klein 4B)', resource_class: 'heavy', dormant: false }, imageAdapters.mflux),
    Object.assign({ id: 'sdcpp', media_kind: 'image', label: 'stable-diffusion.cpp 7f0e728', resource_class: 'heavy', dormant: false }, imageAdapters.sdcpp),
    dormantWorker({ id: 'qwen3-tts', media_kind: 'voice', label: 'Qwen3-TTS (Base + VoiceDesign)',
      activation: 'Runtime and models are installed by the model-stack installer at these paths. Next: add the voice execution bridge (script using the heavy lease + mediaStore.finalize), run one real DexDiffusion speech proof, then enable.' }),
    dormantWorker({ id: 'ace-step', media_kind: 'music', label: 'ACE-Step 1.5 (Turbo + 0.6B LM)',
      activation: 'Runtime and checkpoints are installed at these paths. Next: add the music execution bridge, run one real DexDiffusion song proof, then enable.' }),
    dormantWorker({ id: 'magenta-rt', media_kind: 'music', label: 'Magenta RealTime 2 (small)',
      activation: 'Runtime and mrt2_small are installed at these paths. Next: add a music execution bridge, run one real DexDiffusion proof, then enable.' }),
    dormantWorker({ id: 'ltx-video', media_kind: 'video', label: 'LTX Video',
      activation: 'Not installed (video is out of scope). Install runtime + model at these paths, add the video bridge, prove one clip, then enable.' }),
  ];
  const byId = Object.fromEntries(workers.map(w => [w.id, w]));
  function describe(assets) {
    return workers.map(w => ({ id: w.id, media_kind: w.media_kind, label: w.label, resource_class: w.resource_class, dormant: !!w.dormant,
      ...(w.probe ? w.probe(assets || {}) : {}), capabilities: w.capabilities ? w.capabilities() : {} }));
  }
  return { get: id => byId[id] || null, list: () => workers, describe };
}

// ---- Media store ---------------------------------------------------------------
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.flac': 'audio/flac', '.mp4': 'video/mp4', '.webm': 'video/webm' };
const KIND_EXT = { image: ['.png', '.jpg', '.jpeg', '.webp'], voice: ['.wav', '.mp3', '.m4a', '.flac'], music: ['.wav', '.mp3', '.m4a', '.flac'], video: ['.mp4', '.webm'] };
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,160}\.[a-z0-9]{2,5}$/;

function sniff(buf) {
  const b = buf;
  if (b.length >= 8 && b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: '.png', kind: 'image' };
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: 'image/jpeg', ext: '.jpg', kind: 'image' };
  if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return { mime: 'image/webp', ext: '.webp', kind: 'image' };
  if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WAVE') return { mime: 'audio/wav', ext: '.wav', kind: 'audio' };
  if (b.length >= 3 && (b.toString('latin1', 0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0))) return { mime: 'audio/mpeg', ext: '.mp3', kind: 'audio' };
  if (b.length >= 12 && b.toString('latin1', 4, 8) === 'ftyp' && /^(M4A |mp42|isom|M4B )/.test(b.toString('latin1', 8, 12))) return { mime: 'audio/mp4', ext: '.m4a', kind: 'audio' };
  if (b.length >= 4 && b.toString('latin1', 0, 4) === 'fLaC') return { mime: 'audio/flac', ext: '.flac', kind: 'audio' };
  return null;
}

// Image dimensions from headers (PNG IHDR, JPEG SOFn, WebP VP8/VP8L/VP8X).
function imageDims(b, mime) {
  try {
    if (mime === 'image/png') return b.toString('latin1', 12, 16) === 'IHDR' ? { width: b.readUInt32BE(16), height: b.readUInt32BE(20) } : null;
    if (mime === 'image/jpeg') {
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) { i++; continue; }
        const marker = b[i + 1];
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
        i += 2 + b.readUInt16BE(i + 2);
      }
      return null;
    }
    if (mime === 'image/webp') {
      const c = b.toString('latin1', 12, 16);
      if (c === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
      if (c === 'VP8L') { const v = b.readUInt32LE(21); return { width: (v & 0x3fff) + 1, height: ((v >> 14) & 0x3fff) + 1 }; }
      if (c === 'VP8X') return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
    }
  } catch (_) {}
  return null;
}

// WAV duration from the fmt/data chunks.
function wavInfo(b) {
  try { return wavInfoUnsafe(b); } catch (_) { return null; } // malformed/truncated headers -> rejected
}
function wavInfoUnsafe(b) {
  let i = 12, byteRate = 0, dataLen = 0;
  while (i + 8 <= b.length) {
    const id = b.toString('latin1', i, i + 4), len = b.readUInt32LE(i + 4);
    if (id === 'fmt ') byteRate = b.readUInt32LE(i + 16);
    if (id === 'data') { dataLen = Math.min(len, b.length - i - 8); break; }
    i += 8 + len + (len % 2);
  }
  return byteRate > 0 && dataLen > 0 ? { duration: dataLen / byteRate } : null;
}

function probeDuration(file) {
  try {
    const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], { timeout: 10000 }).toString().trim();
    const d = Number(out);
    return Number.isFinite(d) && d > 0 ? d : null;
  } catch (_) { return null; }
}

function contained(root, id) {
  if (typeof id !== 'string' || !SAFE_ID.test(id) || id.includes('..') || id.includes('\0') || id.startsWith('.')) return null;
  const full = path.resolve(root, id);
  if (path.dirname(full) !== path.resolve(root)) return null;
  let st;
  try { st = fs.lstatSync(full); } catch (_) { return null; }
  if (!st.isFile() || st.isSymbolicLink()) return null;
  return full;
}

function createMediaStore({ roots = CANONICAL_ROOTS, registryFile, now = () => Date.now() } = {}) {
  let registry = null;
  function read() {
    if (registry) return registry;
    try { registry = JSON.parse(fs.readFileSync(registryFile, 'utf8')); } catch (_) { registry = null; }
    if (!registry || typeof registry.artifacts !== 'object') registry = { schema: 'dexdiffusion.media.v1', artifacts: {} };
    return registry;
  }
  function ensureRoots() { for (const k of MEDIA_KINDS) fs.mkdirSync(roots[k], { recursive: true }); }
  // Finalize a validated incoming file: stage in root as .incoming-*, link to a
  // free name (never overwrite), record sha256/size/mime. Non-image kinds only;
  // images keep image-store.js.
  function finalize(src, { kind, base, job_id = null, worker = null, model = null, seed = null, parent = null, duration = null, meta = {} }) {
    if (kind === 'image') throw new Error('images are finalized by image-store.js');
    if (!KIND_EXT[kind]) throw new Error('unknown media kind');
    const ext = path.extname(src).toLowerCase();
    if (!KIND_EXT[kind].includes(ext)) throw new Error('output-invalid: extension not allowed for ' + kind);
    const head = fs.readFileSync(src).slice(0, 64);
    const s = sniff(head);
    if (!s || s.kind !== 'audio' || s.ext !== (ext === '.jpeg' ? '.jpg' : ext)) throw new Error('output-invalid: content does not match ' + ext);
    const root = path.resolve(roots[kind]);
    fs.mkdirSync(root, { recursive: true });
    const incoming = path.join(root, `.incoming-${crypto.randomBytes(6).toString('hex')}${ext}`);
    fs.copyFileSync(src, incoming, fs.constants.COPYFILE_EXCL);
    try {
      const bytes = fs.readFileSync(incoming);
      const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
      const stem = String(base || 'media').replace(/[^A-Za-z0-9_-]+/g, '-').slice(0, 80) || 'media';
      for (let i = 1; i < 1000; i++) {
        const id = `${stem}${i > 1 ? '-' + i : ''}${ext}`;
        try { fs.linkSync(incoming, path.join(root, id)); } catch (e) { if (e.code === 'EEXIST') continue; throw e; }
        const rec = { artifact_id: id, kind, canonical_path: path.join(root, id), safe_url: '/api/media/' + encodeURIComponent(id), mime: MIME[ext], sha256,
          bytes: bytes.length, duration, created_at: now(), job_id, worker, model, seed, parent, keeper: false, meta };
        read().artifacts[id] = rec;
        atomicWriteJson(registryFile, registry);
        return rec;
      }
      throw new Error('canonicalization-failed: no free name');
    } finally { try { fs.unlinkSync(incoming); } catch (_) {} }
  }
  // Resolve a registered non-image artifact strictly inside its kind root.
  function resolve(id) {
    const rec = read().artifacts[id];
    if (!rec) return null;
    const full = contained(roots[rec.kind], id);
    return full ? { ...rec, path: full } : null;
  }
  function list(kind) { return Object.values(read().artifacts).filter(r => !kind || r.kind === kind).sort((a, b) => b.created_at - a.created_at); }
  function setKeeper(id, keeper) { const r = read().artifacts[id]; if (!r) return null; r.keeper = !!keeper; atomicWriteJson(registryFile, registry); return r.keeper; }
  return { roots, ensureRoots, finalize, resolve, list, setKeeper, _reset() { registry = null; } };
}

// ---- Secure staging (temporary source/reference material) ----------------------
const STAGING_LIMITS = { imageBytes: 25 * 1024 * 1024, audioBytes: 40 * 1024 * 1024, maxPixels: 4096 * 4096, maxSide: 4096, maxAudioSeconds: 600, ttlMs: 24 * 3600 * 1000 };

function createStaging({ root, limits = STAGING_LIMITS, now = () => Date.now() } = {}) {
  const dir = path.resolve(root);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const ID = /^stg-[a-f0-9]{24}$/;
  function metaPath(id) { return path.join(dir, id + '.json'); }
  function stage(buf, { accept = ['image', 'audio'] } = {}) {
    if (!Buffer.isBuffer(buf) || buf.length < 16) return { error: 'reference-invalid: empty or truncated file' };
    const s = sniff(buf);
    if (!s) return { error: 'reference-invalid: unsupported or unrecognised file type (allowed: PNG, JPEG, WebP, WAV, MP3, M4A, FLAC)' };
    if (!accept.includes(s.kind)) return { error: `reference-invalid: ${s.kind} is not accepted here` };
    const cap = s.kind === 'image' ? limits.imageBytes : limits.audioBytes;
    if (buf.length > cap) return { error: `reference-invalid: file too large (${buf.length} bytes > ${cap})` };
    const info = { kind: s.kind, mime: s.mime, bytes: buf.length };
    if (s.kind === 'image') {
      const d = imageDims(buf, s.mime);
      if (!d || !d.width || !d.height) return { error: 'reference-invalid: image header unreadable' };
      if (d.width > limits.maxSide || d.height > limits.maxSide || d.width * d.height > limits.maxPixels) return { error: `reference-invalid: image ${d.width}×${d.height} exceeds ${limits.maxSide}px limit` };
      Object.assign(info, d);
    }
    const id = 'stg-' + crypto.randomBytes(12).toString('hex');
    const file = path.join(dir, id + s.ext);
    fs.writeFileSync(file, buf, { flag: 'wx', mode: 0o600 });
    if (s.kind === 'audio') {
      const d = s.mime === 'audio/wav' ? (wavInfo(buf) || {}).duration : probeDuration(file);
      if (!d) { fs.unlinkSync(file); return { error: 'reference-invalid: audio could not be decoded' }; }
      if (d > limits.maxAudioSeconds) { fs.unlinkSync(file); return { error: `reference-invalid: audio is ${Math.round(d)} s (max ${limits.maxAudioSeconds} s)` }; }
      info.duration = Math.round(d * 100) / 100;
    }
    const rec = { id, file: path.basename(file), ...info, created_at: now(), expires_at: now() + limits.ttlMs };
    fs.writeFileSync(metaPath(id), JSON.stringify(rec), { mode: 0o600 });
    return rec;
  }
  function get(id) {
    if (typeof id !== 'string' || !ID.test(id)) return null;
    let rec;
    try { rec = JSON.parse(fs.readFileSync(metaPath(id), 'utf8')); } catch (_) { return null; }
    const full = contained(dir, rec.file);
    if (!full || rec.expires_at < now()) return null;
    return { ...rec, path: full };
  }
  function remove(id) {
    const r = get(id) || (ID.test(String(id)) ? { path: null } : null);
    if (!r) return false;
    if (r.path) try { fs.unlinkSync(r.path); } catch (_) {}
    try { fs.unlinkSync(metaPath(id)); } catch (_) {}
    return true;
  }
  // Remove expired or orphaned staging files. Returns the number removed.
  function sweep() {
    let n = 0;
    for (const f of fs.readdirSync(dir)) {
      const id = f.replace(/\.[a-z0-9]+$/, '');
      if (!ID.test(id)) continue;
      let rec = null;
      try { rec = JSON.parse(fs.readFileSync(metaPath(id), 'utf8')); } catch (_) {}
      if (!rec || rec.expires_at < now()) { try { fs.unlinkSync(path.join(dir, f)); n++; } catch (_) {} }
    }
    return n;
  }
  function stats() { const files = fs.readdirSync(dir).filter(f => /^stg-/.test(f) && !f.endsWith('.json')); return { root: dir, files: files.length }; }
  return { root: dir, stage, get, remove, sweep, stats, limits };
}

module.exports = {
  MEDIA_KINDS, CANONICAL_ROOTS, JOB_STATES, FAILURE_GATES, PRIVATE_KEYS, safeParams,
  createJobStore, createResourceArbiter, parseOllamaPs, createWorkerRegistry, WORKER_PATHS, WORKER_PROBE_PATHS, createMediaStore, createStaging,
  sniff, imageDims, wavInfo, atomicWriteJson, STAGING_LIMITS,
};
