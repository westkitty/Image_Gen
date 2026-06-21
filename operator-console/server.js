const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = Number(process.env.OPERATOR_CONSOLE_PORT || 31337);
const HOST = '127.0.0.1';

const WORKFLOW_ROOT = path.resolve(__dirname, '../sdcpp-workflow');
const RUNS_DIR = path.join(WORKFLOW_ROOT, 'runs');
const CONFIG_DIR = path.join(WORKFLOW_ROOT, 'config');
const STATE_DIR = path.join(WORKFLOW_ROOT, 'state');
const ASSETS_CACHE = path.join(STATE_DIR, 'assets-cache.json');
const IMAGE_EDIT_CACHE = path.join(STATE_DIR, 'image-edit-capabilities.json');
const UPSCALE_CACHE = path.join(STATE_DIR, 'upscale-capabilities.json');

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const ALLOWED_PRESETS = new Set(['smoke', 'thumbnail', 'fast', 'balanced', 'quality', 'quality_plus', 'Custom']);
const ALLOWED_MODES = new Set(['cli', 'server']);
const ALLOWED_APIS = new Set(['openai', 'sdapi', 'both', 'native']);
const ALLOWED_SEED_MODES = new Set(['same', 'increment', 'random']);
const ALLOWED_SAMPLERS = new Set([
  'euler_a', 'euler', 'heun', 'dpm2', 'dpm2_a', 'lms',
  'dpmpp2s_a', 'dpmpp2m', 'dpmpp2mv2', 'ipndm', 'ipndm_v', 'lcm'
]);
const ALLOWED_SCHEDULERS = new Set(['discrete', 'karras', 'exponential', 'ays', 'sgm_uniform', 'simple', 'normal']);

const PRESET_DEFAULTS = {
  smoke: { steps: 1, cfg_scale: 7, sampler: 'euler_a', width: 512, height: 512 },
  thumbnail: { steps: 4, cfg_scale: 7, sampler: 'euler_a', width: 384, height: 384 },
  fast: { steps: 8, cfg_scale: 7, sampler: 'euler_a', width: 512, height: 512 },
  balanced: { steps: 16, cfg_scale: 7, sampler: 'euler_a', width: 512, height: 512 },
  quality: { steps: 20, cfg_scale: 7, sampler: 'euler_a', width: 512, height: 512 },
  quality_plus: { steps: 30, cfg_scale: 7, sampler: 'euler_a', width: 512, height: 512 }
};

const jobs = {};
const jobSensitives = {};

function readKeyValueFile(filePath) {
  const out = {};
  if (!fs.existsSync(filePath)) return out;
  const text = fs.readFileSync(filePath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const idx = trimmed.indexOf('=');
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    value = value.replace(/^['"]|['"]$/g, '');
    out[key] = value;
  }
  return out;
}

function getWorkflowConfig() {
  return {
    ...readKeyValueFile(path.join(CONFIG_DIR, 'sdcpp.env')),
    ...readKeyValueFile(path.join(STATE_DIR, 'current-ports.env'))
  };
}

function validatePrompt(prompt) {
  return typeof prompt === 'string' && prompt.trim().length > 0 && prompt.length <= 4000;
}
function validateNegativePrompt(text) {
  return text === undefined || text === null || text === '' || (typeof text === 'string' && text.length <= 2000);
}
function validateIntRange(value, min, max, optional = true) {
  if ((value === undefined || value === null || value === '') && optional) return true;
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max;
}
function validateFloatRange(value, min, max, optional = true) {
  if ((value === undefined || value === null || value === '') && optional) return true;
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max;
}
function validateSize(value) {
  if (value === undefined || value === null || value === '') return true;
  const n = Number(value);
  return Number.isInteger(n) && n >= 64 && n <= 2048 && n % 8 === 0;
}
function validateSeed(seed) {
  if (seed === undefined || seed === null || seed === '') return true;
  return /^(random|fixed|\d+)$/.test(String(seed));
}
function validateSampler(sampler) {
  if (!sampler) return true;
  return typeof sampler === 'string' && /^[a-zA-Z0-9_\-]+$/.test(sampler) && ALLOWED_SAMPLERS.has(sampler);
}
function validateScheduler(scheduler) {
  if (!scheduler) return true;
  return typeof scheduler === 'string' && ALLOWED_SCHEDULERS.has(scheduler);
}

function redactSensitiveText(text, values) {
  if (!text || !values || values.length === 0) return text;
  let redacted = text;
  for (const value of values) {
    if (!value) continue;
    const escaped = String(value).replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    redacted = redacted.replace(new RegExp(escaped, 'gi'), '[REDACTED]');
  }
  return redacted;
}

function getRedactedCommandSummary(scriptPath, args, sensitiveValues) {
  const redactedArgs = args.map((arg, idx) => {
    const prev = args[idx - 1];
    if (prev === '--prompt' || prev === '--negative') return '[REDACTED]';
    return redactSensitiveText(String(arg), sensitiveValues);
  });
  return `${scriptPath} ${redactedArgs.join(' ')}`;
}

function sanitizeRequestParams(params, savePrompts) {
  if (savePrompts) return params;
  const clean = { ...params };
  if (clean.prompt !== undefined) clean.prompt = '[REDACTED]';
  if (clean.negative_prompt !== undefined) clean.negative_prompt = '[REDACTED]';
  return clean;
}

function createJob(action, summary, requestParams = {}) {
  const id = crypto.randomUUID();
  jobs[id] = {
    id,
    commandAction: action,
    commandSummary: summary || action,
    requestParams,
    status: 'queued',
    stdout: '',
    stderr: '',
    createdAt: Date.now(),
    completedAt: null,
    exitCode: null,
    firstFailedGate: null,
    runId: null
  };
  return id;
}

function runAction(jobId, scriptPath, args, savePrompts = false) {
  const job = jobs[jobId];
  job.status = 'running';
  const env = { ...process.env, SDCPP_REDACT_PROMPTS: savePrompts ? '0' : '1' };
  const child = spawn(scriptPath, args, { cwd: WORKFLOW_ROOT, shell: false, env });
  const sensitives = jobSensitives[jobId] || [];

  child.stdout.on('data', data => {
    job.stdout += redactSensitiveText(data.toString(), sensitives);
  });
  child.stderr.on('data', data => {
    job.stderr += redactSensitiveText(data.toString(), sensitives);
  });
  child.on('error', err => {
    job.status = 'FAIL';
    job.stderr += `\n${err.message}`;
    job.completedAt = Date.now();
    job.firstFailedGate = 'spawn';
  });
  child.on('close', code => {
    job.exitCode = code;
    job.completedAt = Date.now();
    const out = job.stdout;
    if (out.includes('==== PASS ====')) job.status = 'PASS';
    else if (out.includes('status: PARTIAL') || out.includes('==== PARTIAL ====')) job.status = 'PARTIAL';
    else if (out.includes('==== FAIL ====')) job.status = 'FAIL';
    else job.status = code === 0 ? 'PASS' : 'FAIL';
    const failMatch = out.match(/FAIL:\s*(.+?)(?=\n|$)/);
    if (failMatch) job.firstFailedGate = failMatch[1].trim();
    else if ((out + job.stderr).includes('Unknown argument')) job.firstFailedGate = 'args';
    const runMatch = out.match(/runs\/(20\d{6}-\d{6}-[a-zA-Z0-9_-]+)/);
    if (runMatch) job.runId = runMatch[1];
    const upscaledMatch = out.match(/UPSCALED_IMAGE:\s*(\S+)/);
    if (upscaledMatch) job.upscaledImage = upscaledMatch[1];
    const manifestMatch = out.match(/UPSCALE_MANIFEST:\s*(\S+)/);
    if (manifestMatch) job.upscaleManifest = manifestMatch[1];
  });
}

function normalizeGenerationBody(body) {
  const params = {
    prompt: body.prompt,
    negative_prompt: body.negative_prompt || '',
    preset: body.preset || 'Custom',
    mode: body.mode || 'server',
    api: body.api || 'openai',
    model: body.model || 'sd15',
    vae: body.vae || 'auto',
    scheduler: body.scheduler || 'discrete',
    sampler: body.sampler || 'euler_a',
    steps: body.steps || '',
    cfg_scale: body.cfg_scale || body.cfg || '',
    width: body.width || '',
    height: body.height || '',
    seed: body.seed || '',
    restore_faces: !!body.restore_faces,
    tiling: !!body.tiling,
    clip_skip: body.clip_skip || '',
    save_prompts: !!body.save_prompts
  };
  return params;
}

function validateGenerationParams(params) {
  if (!validatePrompt(params.prompt)) return 'Invalid prompt';
  if (!validateNegativePrompt(params.negative_prompt)) return 'Invalid negative prompt';
  if (params.preset && !ALLOWED_PRESETS.has(params.preset)) return 'Invalid preset';
  if (params.mode && !ALLOWED_MODES.has(params.mode)) return 'Invalid mode';
  if (params.api && !ALLOWED_APIS.has(params.api)) return 'Invalid API';
  if (!validateIntRange(params.steps, 1, 150)) return 'Invalid steps';
  if (!validateFloatRange(params.cfg_scale, 1, 30)) return 'Invalid cfg_scale';
  if (!validateSize(params.width)) return 'Invalid width: use multiples of 8 between 64 and 2048';
  if (!validateSize(params.height)) return 'Invalid height: use multiples of 8 between 64 and 2048';
  if (!validateSampler(params.sampler)) return 'Invalid or unsupported sampler';
  if (!validateScheduler(params.scheduler)) return 'Invalid scheduler';
  if (!validateSeed(params.seed)) return 'Invalid seed';
  if (!validateIntRange(params.clip_skip, 1, 12)) return 'Invalid CLIP skip';
  return null;
}

function buildGenerateArgs(params, includeApi = false) {
  const args = ['--prompt', params.prompt];
  if (params.preset && params.preset !== 'Custom') args.push('--preset', params.preset);
  if (params.negative_prompt) args.push('--negative', params.negative_prompt);
  if (params.steps) args.push('--steps', String(params.steps));
  if (params.width) args.push('--width', String(params.width));
  if (params.height) args.push('--height', String(params.height));
  if (params.cfg_scale) args.push('--cfg', String(params.cfg_scale));
  if (params.sampler) args.push('--sampler', params.sampler);
  if (params.seed) args.push('--seed', String(params.seed));
  if (includeApi && params.api) args.push('--api', params.api);
  return args;
}

function safeRunId(id) {
  return /^[a-zA-Z0-9_-]+$/.test(id || '');
}
function parseUiRunCard(cardPath) {
  const metadata = {};
  if (!fs.existsSync(cardPath)) return metadata;
  const content = fs.readFileSync(cardPath, 'utf8');
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return metadata;
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    metadata[key] = value;
  }
  return metadata;
}
function listRunFiles(runPath) {
  const files = [];
  if (!fs.existsSync(runPath)) return files;
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.push(path.relative(runPath, full));
    }
  };
  walk(runPath);
  return files.sort();
}
function inferRunType(dirName) {
  if (dirName.includes('-verify')) return ['verify', 'Verify Backend'];
  if (dirName.includes('-batch')) return ['batch-generate', 'Batch Generate'];
  if (dirName.includes('-cli')) return ['cli-generate', 'CLI Generate'];
  if (dirName.includes('-server-gen')) return ['server-generate', 'Server Generate'];
  if (dirName.includes('-server-start')) return ['server-start', 'Server Start'];
  if (dirName.includes('-server-stop')) return ['server-stop', 'Server Stop'];
  if (dirName.includes('-seedtest')) return ['seed-test', 'Seed Test'];
  if (dirName.includes('-benchmark')) return ['benchmark', 'Benchmark'];
  return ['unknown', dirName];
}

function readJsonCache(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (_) { return null; }
}

const PNG_CHUNK_READ_LIMIT = 20 * 1024 * 1024; // 20 MB

function readPngTextChunks(filePath) {
  const chunks = {};
  if (!fs.existsSync(filePath)) return chunks;
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > PNG_CHUNK_READ_LIMIT) return chunks;
    const buf = fs.readFileSync(filePath);
    if (buf.length < 8 || buf.toString('binary', 0, 4) !== '\x89PNG') return chunks;
    let offset = 8;
    while (offset + 8 <= buf.length) {
      const length = buf.readUInt32BE(offset);
      const type = buf.toString('ascii', offset + 4, offset + 8);
      const data = buf.slice(offset + 8, offset + 8 + length);
      offset += 12 + length;
      if (type === 'tEXt') {
        const nul = data.indexOf(0);
        if (nul >= 0) {
          chunks[data.slice(0, nul).toString('latin1')] = data.slice(nul + 1).toString('latin1');
        }
      } else if (type === 'iTXt') {
        const nul = data.indexOf(0);
        if (nul >= 0) {
          const key = data.slice(0, nul).toString('latin1');
          const rest = data.slice(nul + 1);
          const nul2 = rest.indexOf(Buffer.from([0, 0]));
          if (nul2 >= 0) chunks[key] = rest.slice(nul2 + 2).toString('utf8');
        }
      } else if (type === 'IEND') break;
    }
  } catch (_) {}
  return chunks;
}

app.get('/api/capabilities', (req, res) => {
  const cfg = getWorkflowConfig();
  const remoteModel = cfg.REMOTE_MODEL || cfg.MODEL || 'v1-5-pruned-emaonly.safetensors';
  const localPort = cfg.LOCAL_TUNNEL_PORT || '17870';

  // Read cached discovery results
  const assets = readJsonCache(ASSETS_CACHE);
  const editCap = readJsonCache(IMAGE_EDIT_CACHE);
  const upscaleCap = readJsonCache(UPSCALE_CACHE);

  // Build models list from cache or fall back to configured model
  let models, vaes;
  if (assets) {
    models = assets.checkpoints.length > 0
      ? assets.checkpoints.map(c => ({ id: c.id, name: c.name || c.filename, filename: c.filename, status: c.status, kind: 'checkpoint', active: c.active || false, size_bytes: c.size_bytes }))
      : [{ id: 'sd15', name: 'SD 1.5 — configured remote model', filename: remoteModel, status: 'available', kind: 'checkpoint', active: true }];
    vaes = [{ id: 'auto', name: 'Automatic / baked VAE', status: 'limited', reason: 'Current SDCPP scripts do not expose a VAE switch.' },
            ...assets.vaes.map(v => ({ id: v.id, name: v.name || v.filename, filename: v.filename, status: 'available', kind: 'vae' }))];
  } else {
    models = [{ id: 'sd15', name: 'SD 1.5 — configured remote model', filename: remoteModel, status: 'available', kind: 'checkpoint', active: true }];
    vaes = [{ id: 'auto', name: 'Automatic / baked VAE', status: 'limited', reason: 'Current SDCPP scripts do not expose a VAE switch.' }];
  }

  // img2img / inpaint gates — probe cache informs the reason text, but supported stays false
  // until actual workflow scripts (sdcpp-img2img.sh, /api/actions/img2img) exist.
  const img2imgProbeReason = editCap && editCap.capabilities
    ? (editCap.capabilities.img2img.supported
        ? 'Remote CLI flags detected; workflow script (sdcpp-img2img.sh) not yet implemented.'
        : editCap.capabilities.img2img.reason)
    : 'Run POST /api/actions/probe-image-edit to check remote support.';
  const img2imgGate = { supported: false, reason: img2imgProbeReason };

  const inpaintProbeReason = editCap && editCap.capabilities
    ? (editCap.capabilities.inpaint.supported
        ? 'Remote CLI flags detected; inpaint workflow script not yet implemented.'
        : editCap.capabilities.inpaint.reason)
    : 'Run POST /api/actions/probe-image-edit to check remote support.';
  const inpaintGate = { supported: false, reason: inpaintProbeReason };

  // pillowUpscale — local Pillow resize upscale; script and endpoint exist, validated.
  const pillowUpscaleGate = {
    supported: true,
    route: '/api/actions/upscale',
    reason: 'Local Pillow resize upscale for existing run images. Not Real-ESRGAN; not AI upscale.'
  };

  // upscale — partial: Pillow local resize is available; Real-ESRGAN/A1111 Extras parity is not.
  const upscaleGate = {
    supported: 'partial',
    route: '/api/actions/upscale',
    reason: 'Local Pillow resize upscale available (2x/3x/4x, lanczos/bicubic/bilinear/nearest). Real-ESRGAN and A1111 Extras parity are not implemented.'
  };

  const hiresGate = {
    supported: false,
    reason: upscaleCap && upscaleCap.capabilities
      ? 'Upscale tools detected; Hires Fix two-pass workflow script not yet implemented.'
      : 'Run POST /api/actions/probe-upscale to detect available tools.'
  };

  const faceGate = {
    supported: false,
    reason: upscaleCap && upscaleCap.capabilities && upscaleCap.capabilities.faceRestore
      ? upscaleCap.capabilities.faceRestore.reason
      : 'Run POST /api/actions/probe-upscale to detect available tools.'
  };

  // LoRA / embeddings / hypernetworks: discoverable via asset cache
  const loraGate = assets && assets.loras && assets.loras.length > 0
    ? { supported: false, reason: `${assets.loras.length} LoRA(s) found on remote — injection bridge not yet implemented.` }
    : { supported: false, reason: assets ? 'No LoRA files found on remote (run discover-assets to refresh).' : 'No LoRA discovery/injection bridge exists yet.' };
  const embeddingGate = assets && assets.embeddings && assets.embeddings.length > 0
    ? { supported: false, reason: `${assets.embeddings.length} embedding(s) found — injection bridge not yet implemented.` }
    : { supported: false, reason: 'No embeddings discovery path exists yet.' };
  const hypernetGate = assets && assets.hypernetworks && assets.hypernetworks.length > 0
    ? { supported: false, reason: `${assets.hypernetworks.length} hypernetwork(s) found — injection bridge not yet implemented.` }
    : { supported: false, reason: 'No hypernetwork support exists in the current SDCPP scripts.' };

  const cacheAgeMinutes = assets ? Math.round((Date.now() / 1000 - assets.discovered_at) / 60) : null;

  res.json({
    app: { name: 'SDCPP Workbench', version: 'a1111-workbench-2026-06-21' },
    backend: { type: 'stable-diffusion.cpp workflow bridge', workflowRoot: WORKFLOW_ROOT, runsDir: RUNS_DIR, localTunnelPort: localPort },
    assetCache: { present: !!assets, cacheAgeMinutes, discoveredAt: assets ? assets.discovered_at_iso : null },
    models,
    vaes,
    networks: {
      loras: assets ? assets.loras : [],
      embeddings: assets ? assets.embeddings : [],
      hypernetworks: assets ? assets.hypernetworks : []
    },
    samplers: Array.from(ALLOWED_SAMPLERS).map(id => ({ id, name: id.replace(/_/g, ' '), supported: true })),
    schedulers: Array.from(ALLOWED_SCHEDULERS).map(id => ({ id, name: id.replace(/_/g, ' '), supported: id === 'discrete', reason: id === 'discrete' ? '' : 'UI visible; backend scripts do not currently pass scheduler.' })),
    presets: PRESET_DEFAULTS,
    featureGates: {
      txt2img: { supported: true, route: '/api/actions/generate-single' },
      batch: { supported: true, route: '/api/actions/generate-batch' },
      xyzPlot: { supported: 'partial', route: '/api/actions/xyz-plot', caveat: 'Script and endpoint exist (max 16 cells). Requires running server tunnel. Not yet end-to-end validated with real images.' },
      server: { supported: true },
      gallery: { supported: true },
      metadataReuse: { supported: true, route: '/api/runs/:runId/metadata', caveat: 'Prompt fields redacted when privacy is enabled.' },
      pngInfo: { supported: 'partial', route: '/api/runs/:runId/metadata', caveat: 'Run-image tEXt/iTXt chunks readable via metadata endpoint. Arbitrary PNG upload not supported.' },
      discoverAssets: { supported: true, route: '/api/actions/discover-assets' },
      probeImageEdit: { supported: true, route: '/api/actions/probe-image-edit' },
      probeUpscale: { supported: true, route: '/api/actions/probe-upscale' },
      pillowUpscale: pillowUpscaleGate,
      img2img: img2imgGate,
      inpaint: inpaintGate,
      outpaint: { supported: false, reason: 'Outpaint requires canvas-extend pre-processing not present in SDCPP CLI.' },
      upscale: upscaleGate,
      hiresFix: hiresGate,
      faceRestore: faceGate,
      lora: loraGate,
      textualInversion: embeddingGate,
      hypernetworks: hypernetGate
    }
  });
});

app.post('/api/actions/verify', (req, res) => {
  const jobId = createJob('verify', 'bin/sdcpp-verify.sh');
  runAction(jobId, 'bin/sdcpp-verify.sh', []);
  res.json({ job_id: jobId, status: jobs[jobId].status });
});
app.post('/api/actions/server-status', (req, res) => {
  const jobId = createJob('server-status', 'bin/sdcpp-server-status.sh');
  runAction(jobId, 'bin/sdcpp-server-status.sh', []);
  res.json({ job_id: jobId, status: jobs[jobId].status });
});
app.get('/api/server-status', (req, res) => {
  const jobId = createJob('server-status', 'bin/sdcpp-server-status.sh');
  runAction(jobId, 'bin/sdcpp-server-status.sh', []);
  res.json({ job_id: jobId, status: jobs[jobId].status });
});
app.post('/api/actions/server-start', (req, res) => {
  const jobId = createJob('server-start', 'bin/sdcpp-server-start.sh');
  runAction(jobId, 'bin/sdcpp-server-start.sh', []);
  res.json({ job_id: jobId, status: jobs[jobId].status });
});
app.post('/api/actions/server-stop', (req, res) => {
  const jobId = createJob('server-stop', 'bin/sdcpp-server-stop.sh');
  runAction(jobId, 'bin/sdcpp-server-stop.sh', []);
  res.json({ job_id: jobId, status: jobs[jobId].status });
});

app.post('/api/actions/generate-single', (req, res) => {
  const params = normalizeGenerationBody(req.body || {});
  const err = validateGenerationParams(params);
  if (err) return res.status(400).json({ error: err });
  const script = params.mode === 'cli' ? 'bin/sdcpp-cli-generate.sh' : 'bin/sdcpp-server-generate.sh';
  const args = buildGenerateArgs(params, params.mode === 'server');
  const sensitives = [params.prompt, params.negative_prompt].filter(Boolean);
  const summary = getRedactedCommandSummary(script, args, sensitives);
  const jobId = createJob(params.mode === 'cli' ? 'cli-generate' : 'server-generate', summary, sanitizeRequestParams(params, params.save_prompts));
  jobSensitives[jobId] = sensitives;
  runAction(jobId, script, args, params.save_prompts);
  res.json({ job_id: jobId, status: jobs[jobId].status });
});

app.post('/api/actions/generate-batch', (req, res) => {
  const params = normalizeGenerationBody(req.body || {});
  const err = validateGenerationParams(params);
  if (err) return res.status(400).json({ error: err });
  const count = Number(req.body.count || 3);
  if (!Number.isInteger(count) || count < 1 || count > 24) return res.status(400).json({ error: 'Invalid count: 1-24' });
  const seedMode = req.body.seedMode || req.body.seed_mode || 'increment';
  if (!ALLOWED_SEED_MODES.has(seedMode)) return res.status(400).json({ error: 'Invalid seed mode' });
  const args = buildGenerateArgs(params, false);
  args.push('--mode', params.mode, '--count', String(count), '--seed-mode', seedMode);
  if (req.body.seedStart) args.push('--seed-start', String(req.body.seedStart));
  if (params.mode === 'server' && params.api) args.push('--api', params.api);
  const sensitives = [params.prompt, params.negative_prompt].filter(Boolean);
  const summary = getRedactedCommandSummary('bin/sdcpp-batch-generate.sh', args, sensitives);
  const jobId = createJob('batch-generate', summary, sanitizeRequestParams({ ...params, count, seedMode }, params.save_prompts));
  jobSensitives[jobId] = sensitives;
  runAction(jobId, 'bin/sdcpp-batch-generate.sh', args, params.save_prompts);
  res.json({ job_id: jobId, status: jobs[jobId].status });
});

app.post('/api/actions/unsupported', (req, res) => {
  const feature = String((req.body && req.body.feature) || 'feature');
  res.status(409).json({
    error: `${feature} is visible in the A1111 workbench UI but is not wired to the current SDCPP backend scripts yet.`,
    feature,
    next: 'Add a workflow script and bridge endpoint before enabling this action.'
  });
});

app.post('/api/actions/seed-test', (req, res) => {
  const jobId = createJob('seed-test', 'bin/sdcpp-seed-test.sh --preset smoke --seed 424242 --mode cli');
  runAction(jobId, 'bin/sdcpp-seed-test.sh', ['--preset', 'smoke', '--seed', '424242', '--mode', 'cli']);
  res.json({ job_id: jobId, status: jobs[jobId].status });
});
app.post('/api/actions/clean-old-runs', (req, res) => {
  const days = Number(req.body.days);
  if (!Number.isInteger(days) || days < 1) return res.status(400).json({ error: 'Invalid days' });
  const jobId = createJob('clean-old-runs', `bin/sdcpp-clean-old-runs.sh --delete --older-than-days ${days}`);
  runAction(jobId, 'bin/sdcpp-clean-old-runs.sh', ['--delete', '--older-than-days', String(days)]);
  res.json({ job_id: jobId, status: jobs[jobId].status });
});

// Phase 1 — asset discovery
app.post('/api/actions/discover-assets', (req, res) => {
  const jobId = createJob('discover-assets', 'bin/sdcpp-discover-assets.sh');
  runAction(jobId, 'bin/sdcpp-discover-assets.sh', []);
  res.json({ job_id: jobId, status: jobs[jobId].status });
});
app.get('/api/assets', (req, res) => {
  const cache = readJsonCache(ASSETS_CACHE);
  if (!cache) return res.json({ stale: true, cacheAgeMinutes: null, checkpoints: [], vaes: [], loras: [], embeddings: [], hypernetworks: [] });
  const ageMinutes = Math.round((Date.now() / 1000 - cache.discovered_at) / 60);
  res.json({ stale: false, cacheAgeMinutes: ageMinutes, ...cache });
});

// Phase 4 — image-edit capability probe
app.post('/api/actions/probe-image-edit', (req, res) => {
  const jobId = createJob('probe-image-edit', 'bin/sdcpp-image-edit-capabilities.sh');
  runAction(jobId, 'bin/sdcpp-image-edit-capabilities.sh', []);
  res.json({ job_id: jobId, status: jobs[jobId].status });
});

// Phase 5 — upscale capability probe
app.post('/api/actions/probe-upscale', (req, res) => {
  const jobId = createJob('probe-upscale', 'bin/sdcpp-upscale-capabilities.sh');
  runAction(jobId, 'bin/sdcpp-upscale-capabilities.sh', []);
  res.json({ job_id: jobId, status: jobs[jobId].status });
});

const ALLOWED_UPSCALE_SCALES = new Set([2, 3, 4]);
const ALLOWED_UPSCALE_RESAMPLES = new Set(['nearest', 'bilinear', 'bicubic', 'lanczos']);

// Pillow upscale endpoint — local only, no SSH, no prompt fields
app.post('/api/actions/upscale', (req, res) => {
  const body = req.body || {};

  // Accept either { path } or { runId, image }
  let upscalePath = null;
  if (body.path) {
    upscalePath = String(body.path);
  } else if (body.runId && body.image) {
    const runId = String(body.runId);
    const image = String(body.image);
    upscalePath = `${runId}/${image}`;
  } else {
    return res.status(400).json({ error: 'Provide either { path } or { runId, image }' });
  }

  // Validate the combined path: no absolute, no traversal, safe chars
  if (upscalePath.startsWith('/') || path.isAbsolute(upscalePath)) {
    return res.status(400).json({ error: 'Absolute paths are not accepted' });
  }
  if (upscalePath.includes('..')) {
    return res.status(400).json({ error: 'Path traversal is not allowed' });
  }
  if (!/^[a-zA-Z0-9_\-\/\.]+$/.test(upscalePath)) {
    return res.status(400).json({ error: 'Path contains invalid characters' });
  }

  // Containment check: resolved path must stay inside RUNS_DIR
  const fullPath = path.resolve(RUNS_DIR, upscalePath);
  const relPath = path.relative(RUNS_DIR, fullPath);
  if (relPath.startsWith('..') || path.isAbsolute(relPath)) {
    return res.status(403).json({ error: 'Path resolves outside runs directory' });
  }

  const scale = body.scale !== undefined ? Number(body.scale) : 2;
  if (!ALLOWED_UPSCALE_SCALES.has(scale)) {
    return res.status(400).json({ error: 'scale must be 2, 3, or 4' });
  }

  const resample = body.resample !== undefined ? String(body.resample) : 'lanczos';
  if (!ALLOWED_UPSCALE_RESAMPLES.has(resample)) {
    return res.status(400).json({ error: 'resample must be: nearest, bilinear, bicubic, lanczos' });
  }

  const overwrite = !!body.overwrite;

  const args = ['--path', upscalePath, '--scale', String(scale), '--resample', resample];
  if (overwrite) args.push('--overwrite');

  const safeParams = { path: upscalePath, scale, resample };
  const summary = `bin/sdcpp-upscale.sh --path ${upscalePath} --scale ${scale} --resample ${resample}`;
  const jobId = createJob('upscale', summary, safeParams);
  runAction(jobId, 'bin/sdcpp-upscale.sh', args);

  res.json({ job_id: jobId, status: jobs[jobId].status });
});

const ALLOWED_XYZ_AXIS_TYPES = new Set(['steps', 'cfg', 'sampler', 'seed', 'width', 'height']);

// Phase 3 — X/Y/Z plot
app.post('/api/actions/xyz-plot', (req, res) => {
  const body = req.body || {};
  const params = normalizeGenerationBody(body);
  const err = validateGenerationParams(params);
  if (err) return res.status(400).json({ error: err });

  const xType = String(body.x_type || '').trim();
  const xValues = String(body.x_values || '').trim();
  const yType = String(body.y_type || '').trim();
  const yValues = String(body.y_values || '').trim();

  if (!ALLOWED_XYZ_AXIS_TYPES.has(xType)) return res.status(400).json({ error: `Invalid x_type. Allowed: ${[...ALLOWED_XYZ_AXIS_TYPES].join(', ')}` });
  if (!xValues) return res.status(400).json({ error: 'x_values is required' });
  if (yType && !ALLOWED_XYZ_AXIS_TYPES.has(yType)) return res.status(400).json({ error: `Invalid y_type. Allowed: ${[...ALLOWED_XYZ_AXIS_TYPES].join(', ')}` });
  if (yType && !yValues) return res.status(400).json({ error: 'y_values required when y_type is set' });
  if (!yType && yValues) return res.status(400).json({ error: 'y_type required when y_values is set' });

  const xCount = xValues.split(',').filter(v => v.trim()).length;
  const yCount = yValues ? yValues.split(',').filter(v => v.trim()).length : 1;
  if (xCount * yCount > 16) return res.status(400).json({ error: `Total cells (${xCount * yCount}) exceeds limit of 16` });

  const args = ['--prompt', params.prompt, '--x-type', xType, '--x-values', xValues];
  if (params.negative_prompt) args.push('--negative', params.negative_prompt);
  if (params.preset && params.preset !== 'Custom') args.push('--preset', params.preset);
  if (params.steps) args.push('--steps', String(params.steps));
  if (params.width) args.push('--width', String(params.width));
  if (params.height) args.push('--height', String(params.height));
  if (params.cfg_scale) args.push('--cfg', String(params.cfg_scale));
  if (params.sampler) args.push('--sampler', params.sampler);
  if (params.seed) args.push('--seed', String(params.seed));
  if (params.api) args.push('--api', params.api === 'openai' || params.api === 'sdapi' ? params.api : 'openai');
  if (yType) { args.push('--y-type', yType, '--y-values', yValues); }

  const sensitives = [params.prompt, params.negative_prompt].filter(Boolean);
  const summary = getRedactedCommandSummary('bin/sdcpp-xyz-plot.sh', args, sensitives);
  const jobId = createJob('xyz-plot', summary, sanitizeRequestParams({ ...params, x_type: xType, x_values: xValues, y_type: yType, y_values: yValues }, params.save_prompts));
  jobSensitives[jobId] = sensitives;
  runAction(jobId, 'bin/sdcpp-xyz-plot.sh', args, params.save_prompts);
  res.json({ job_id: jobId, status: jobs[jobId].status });
});

app.get('/api/jobs/:jobId', (req, res) => {
  const job = jobs[req.params.jobId];
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json({
    id: job.id,
    commandAction: job.commandAction,
    commandSummary: job.commandSummary,
    requestParams: job.requestParams,
    status: job.status,
    createdAt: job.createdAt,
    completedAt: job.completedAt,
    exitCode: job.exitCode,
    firstFailedGate: job.firstFailedGate,
    runId: job.runId,
    upscaledImage: job.upscaledImage || null,
    upscaleManifest: job.upscaleManifest || null
  });
});
app.get('/api/jobs/:jobId/log', (req, res) => {
  const job = jobs[req.params.jobId];
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json({ id: job.id, stdout: job.stdout, stderr: job.stderr });
});

app.get('/api/runs', (req, res) => {
  if (!fs.existsSync(RUNS_DIR)) return res.json({ runs: [] });
  const dirs = fs.readdirSync(RUNS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort((a, b) => b.localeCompare(a));
  const runs = dirs.map(dirName => {
    const runPath = path.join(RUNS_DIR, dirName);
    const [type, title] = inferRunType(dirName);
    const parsed = parseUiRunCard(path.join(runPath, 'ui-run-card.md'));
    const files = listRunFiles(runPath);
    const images = files.filter(f => f.toLowerCase().endsWith('.png'));
    return {
      id: dirName,
      type: parsed.run_type || type,
      status: parsed.status || 'UNKNOWN',
      title: parsed.title || title,
      prompt: parsed.prompt || null,
      negative_prompt: parsed.negative_prompt || null,
      primaryImage: parsed.primary_image || images[0] || null,
      images,
      createdAt: dirName.slice(0, 15),
      metadata: parsed
    };
  });
  res.json({ runs });
});
app.get('/api/runs/:runId', (req, res) => {
  const runId = req.params.runId;
  if (!safeRunId(runId)) return res.status(400).json({ error: 'Invalid runId' });
  const runPath = path.join(RUNS_DIR, runId);
  if (!fs.existsSync(runPath)) return res.status(404).json({ error: 'Run not found' });
  const metadata = parseUiRunCard(path.join(runPath, 'ui-run-card.md'));
  metadata.id = runId;
  const files = listRunFiles(runPath);
  const manifestFiles = ['batch-manifest.json', metadata.manifest_json].filter(Boolean);
  let manifest = null;
  for (const file of manifestFiles) {
    const candidate = path.join(runPath, file);
    if (fs.existsSync(candidate)) {
      try { manifest = JSON.parse(fs.readFileSync(candidate, 'utf8')); break; } catch (_) {}
    }
  }
  res.json({ metadata, manifest, files, images: files.filter(f => f.toLowerCase().endsWith('.png')) });
});
app.get('/api/runs/:runId/files', (req, res) => {
  const runId = req.params.runId;
  if (!safeRunId(runId)) return res.status(400).json({ error: 'Invalid runId' });
  const runPath = path.join(RUNS_DIR, runId);
  if (!fs.existsSync(runPath)) return res.status(404).json({ error: 'Run not found' });
  res.json({ files: listRunFiles(runPath) });
});

// Phase 2 — rich run metadata (local read, no SSH)
app.get('/api/runs/:runId/metadata', (req, res) => {
  const runId = req.params.runId;
  if (!safeRunId(runId)) return res.status(400).json({ error: 'Invalid runId' });
  const runPath = path.join(RUNS_DIR, runId);
  if (!fs.existsSync(runPath)) return res.status(404).json({ error: 'Run not found' });

  const runCard = parseUiRunCard(path.join(runPath, 'ui-run-card.md'));
  const files = listRunFiles(runPath);
  const images = files.filter(f => f.toLowerCase().endsWith('.png'));

  // Load manifest (batch or xyz)
  let manifest = null;
  for (const candidate of ['batch-manifest.json', 'xyz-manifest.json']) {
    const p = path.join(runPath, candidate);
    if (fs.existsSync(p)) { try { manifest = JSON.parse(fs.readFileSync(p, 'utf8')); break; } catch (_) {} }
  }

  // Load run-metadata.json (CLI runs)
  let runMeta = null;
  const runMetaPath = path.join(runPath, 'run-metadata.json');
  if (fs.existsSync(runMetaPath)) { try { runMeta = JSON.parse(fs.readFileSync(runMetaPath, 'utf8')); } catch (_) {} }

  // PNG text chunks from primary image — path must resolve inside runPath
  let pngInfo = {};
  const primaryRaw = runCard.primary_image || images[0];
  if (primaryRaw) {
    const pngFull = path.resolve(runPath, primaryRaw);
    const pngRel = path.relative(runPath, pngFull);
    if (!pngRel.startsWith('..') && !path.isAbsolute(pngRel)) {
      pngInfo = readPngTextChunks(pngFull);
    }
  }

  // metrics.tsv
  const metricsRows = [];
  const metricsPath = path.join(runPath, 'metrics.tsv');
  if (fs.existsSync(metricsPath)) {
    const lines = fs.readFileSync(metricsPath, 'utf8').split(/\r?\n/).filter(Boolean);
    if (lines.length >= 2) {
      const header = lines[0].split('\t');
      for (const line of lines.slice(1)) {
        const cols = line.split('\t');
        if (cols.length === header.length) metricsRows.push(Object.fromEntries(header.map((h, i) => [h, cols[i]])));
      }
    }
  }

  res.json({
    run_id: runId,
    run_dir: runPath,
    run_card: runCard,
    manifest,
    run_meta: runMeta,
    png_info: pngInfo,
    metrics: metricsRows,
    files,
    images,
    retrieved_at: new Date().toISOString()
  });
});
// Run index — fast paginated listing with upscale status; no raw prompts from redacted runs
const RUN_INDEX_MAX = 500;
const RUN_INDEX_TTL_MS = 8000;
let runIndexCache = null;
let runIndexCacheAt = 0;

function buildRunIndex() {
  if (!fs.existsSync(RUNS_DIR)) return [];
  const dirs = fs.readdirSync(RUNS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort((a, b) => b.localeCompare(a))
    .slice(0, RUN_INDEX_MAX);
  return dirs.map(dirName => {
    const runPath = path.join(RUNS_DIR, dirName);
    const [type, title] = inferRunType(dirName);
    let status = 'UNKNOWN', runTitle = title, primaryImage = null, runType = type;
    let imageCount = 0, hasUpscaled = false, hasManifest = false, hasMetadata = false;
    try {
      const parsed = parseUiRunCard(path.join(runPath, 'ui-run-card.md'));
      status = parsed.status || status;
      runTitle = parsed.title || title;
      primaryImage = parsed.primary_image || null;
      if (parsed.run_type) runType = parsed.run_type;
    } catch (_) {}
    try {
      const entries = fs.readdirSync(runPath, { withFileTypes: true });
      for (const e of entries) {
        if (e.isFile() && /\.(png|PNG)$/.test(e.name)) imageCount++;
        if (e.isDirectory() && e.name === 'upscaled') hasUpscaled = true;
        if (e.isFile() && (e.name === 'batch-manifest.json' || e.name === 'xyz-manifest.json' || e.name === 'upscale-manifest.json')) hasManifest = true;
        if (e.isFile() && e.name === 'run-metadata.json') hasMetadata = true;
      }
    } catch (_) {}
    return {
      id: dirName,
      type: runType,
      status,
      title: runTitle,
      primaryImage,
      imageCount,
      hasUpscaled,
      hasManifest,
      hasMetadata,
      createdAt: dirName.slice(0, 15)
    };
  });
}

app.get('/api/run-index', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, RUN_INDEX_MAX);
  const now = Date.now();
  if (!runIndexCache || now - runIndexCacheAt > RUN_INDEX_TTL_MS) {
    runIndexCache = buildRunIndex();
    runIndexCacheAt = now;
  }
  res.json({ runs: runIndexCache.slice(0, limit), total: runIndexCache.length, cachedAt: new Date(runIndexCacheAt).toISOString() });
});

app.get('/api/run-file', (req, res) => {
  const queryPath = req.query.path;
  if (!queryPath) return res.status(400).send('Missing path');
  const fullPath = path.resolve(RUNS_DIR, queryPath);
  const relPath = path.relative(RUNS_DIR, fullPath);
  if (relPath.startsWith('..') || path.isAbsolute(relPath)) return res.status(403).send('Forbidden');
  const allowedExts = ['.png', '.md', '.json', '.tsv', '.txt', '.log'];
  if (!allowedExts.includes(path.extname(fullPath).toLowerCase())) return res.status(403).send('Forbidden extension');
  if (!fs.existsSync(fullPath)) return res.status(404).send('File not found');
  res.sendFile(fullPath);
});

app.listen(PORT, HOST, () => {
  console.log(`SDCPP Workbench listening on http://${HOST}:${PORT}`);
});
