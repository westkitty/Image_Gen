const express = require('express');
const { spawn, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = Number(process.env.OPERATOR_CONSOLE_PORT || 31337);
const HOST = '127.0.0.1';
const APP_VERSION = 'image-gen-console-2026-06-22-render-wrapper';

const WORKFLOW_ROOT = path.resolve(__dirname, '../sdcpp-workflow');
const RUNS_DIR = path.join(WORKFLOW_ROOT, 'runs');
const CONFIG_DIR = path.join(WORKFLOW_ROOT, 'config');
const STATE_DIR = path.join(WORKFLOW_ROOT, 'state');
const ASSETS_CACHE = path.join(STATE_DIR, 'assets-cache.json');
const IMAGE_EDIT_CACHE = path.join(STATE_DIR, 'image-edit-capabilities.json');
const UPSCALE_CACHE = path.join(STATE_DIR, 'upscale-capabilities.json');
const MODEL_STAGE_CACHE = path.join(STATE_DIR, 'model-stage-cache.json');
const SDXL_SMOKE_CACHE = path.join(STATE_DIR, 'sdxl-smoke-cache.json');
const SDXL_TURBO_SMOKE_CACHE = path.join(STATE_DIR, 'sdxl-turbo-smoke-cache.json');
const FLUX_SMOKE_CACHE = path.join(STATE_DIR, 'flux-smoke-cache.json');
const MODEL_STAGE_ROOT = '/Volumes/wc2tb/ImageGen';
const MODEL_INVENTORY_CACHE = path.join(STATE_DIR, 'model-inventory-cache.json');
const MODEL_STAGE_DOC = 'operator-console/docs/model-staging-sdxl-turbo-flux.md';
const GENERATION_JOB_SCHEMA = path.join(__dirname, 'schemas/generation-job.schema.json');
const MODEL_COMPATIBILITY_REGISTRY = path.join(__dirname, 'schemas/model-compatibility.json');
const WILDCARDS_DIR = path.join(__dirname, 'wildcards');
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || process.env.OLLAMA_HOST || 'http://127.0.0.1:11435';

let schedulerSelectionSupported = true;
let vaeSwitchingSupported = true;
let loraSupported = true;
let img2imgSupported = true; // proven: sdcpp-img2img.sh proof run 20260623-001649-img2img, sha256 match
let realEsrganSupported = true; // proven: endpoint proof run 20260623-005030-esrgan-upscale, 512→2048, 60.82s, sha256 f28e339f…, 0 text chunks
let inpaintSupported = true; // enabled: sdcpp-inpaint.sh implemented 2026-06-23

const MASK_UPLOADS_DIR = path.join(WORKFLOW_ROOT, 'mask-uploads');
if (!fs.existsSync(MASK_UPLOADS_DIR)) fs.mkdirSync(MASK_UPLOADS_DIR, { recursive: true });

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const ALLOWED_PRESETS = new Set(['smoke', 'thumbnail', 'fast', 'balanced', 'quality', 'quality_plus', 'Custom']);
const ALLOWED_MODES = new Set(['cli', 'server']);
const ALLOWED_APIS = new Set(['openai', 'sdapi', 'both', 'native']);
const ALLOWED_SEED_MODES = new Set(['same', 'increment', 'random']);
const ALLOWED_SAMPLERS = new Set([
  'euler_a', 'euler', 'heun', 'dpm2', 'dpm2_a', 'lms',
  'dpmpp2s_a', 'dpmpp2m', 'dpmpp2mv2', 'ipndm', 'ipndm_v', 'lcm'
]);
const ALLOWED_SCHEDULERS = new Set(['discrete', 'karras', 'exponential', 'ays', 'sgm_uniform', 'simple']);
const CONTROLLED_TARGET_IDS = new Set(['sd15', 'sdxl-base', 'sdxl-turbo', 'flux-fp8', 'sdxl-photonic', 'sdxl-homochi', 'sdxl-pony', 'sd15-homofidelis', 'sdxl-juggernaut', 'sdxl-realvisxl', 'sdxl-cyberrealistic', 'sdxl-epicrealism', 'sdxl-biglust', 'sdxl-lustify', 'sdxl-biglove']);
const CONTROLLED_TARGETS = [
  {
    id: 'sd15',
    label: 'SD1.5 standard',
    status: 'supported',
    mode: 'existing supported txt2img',
    route: '/api/actions/generate-controlled',
    caveat: 'Full generation path. Supports a curated set of parameters — not all Automatic1111 options are available.',
    proofDerived: false,
    fullParityClaim: false,
    defaultWidth: 512,
    defaultHeight: 512,
    defaultSteps: 20,
    defaultCfgScale: 7,
    defaultSampler: 'euler_a',
    maxWidth: 2048,
    maxHeight: 2048,
    minSteps: 1,
    maxSteps: 150
  },
  {
    id: 'sdxl-base',
    label: 'SDXL base',
    status: 'proofed',
    mode: 'proofed controlled generation',
    route: '/api/actions/generate-controlled',
    caveat: 'Supports a curated set of generation parameters — not all Automatic1111 options are available.',
    proofDerived: true,
    fullParityClaim: false,
    modelFile: 'sd_xl_base_1.0.safetensors',
    defaultWidth: 512,
    defaultHeight: 512,
    defaultSteps: 4,
    defaultCfgScale: 7,
    defaultSampler: 'euler_a',
    maxWidth: 1024,
    maxHeight: 1024,
    minSteps: 1,
    maxSteps: 8
  },
  {
    id: 'sdxl-turbo',
    label: 'SDXL Turbo',
    status: 'proofed',
    mode: 'proofed controlled generation',
    route: '/api/actions/generate-controlled',
    caveat: 'Supports a curated set of generation parameters — not all Automatic1111 options are available.',
    proofDerived: true,
    fullParityClaim: false,
    modelFile: 'sd_xl_turbo_1.0_fp16.safetensors',
    defaultWidth: 512,
    defaultHeight: 512,
    defaultSteps: 4,
    defaultCfgScale: 0,
    defaultSampler: 'euler_a',
    maxWidth: 1024,
    maxHeight: 1024,
    minSteps: 1,
    maxSteps: 4
  },
  {
    id: 'flux-fp8',
    label: 'Flux fp8',
    status: 'proofed',
    mode: 'proofed controlled generation',
    route: '/api/actions/generate-controlled',
    caveat: 'Supports a curated set of generation parameters — not all Automatic1111 options are available. Uses the fp8 runtime-proven Flux file.',
    proofDerived: true,
    fullParityClaim: false,
    modelFile: 'flux1-schnell-fp8.safetensors',
    defaultWidth: 512,
    defaultHeight: 512,
    defaultSteps: 4,
    defaultCfgScale: 3.5,
    defaultSampler: 'euler',
    maxWidth: 1024,
    maxHeight: 1024,
    minSteps: 1,
    maxSteps: 8
  },
  {
    id: 'sdxl-photonic',
    label: 'Photonic Fusion SDXL',
    status: 'staged',
    mode: 'migrated controlled generation',
    route: '/api/actions/generate-controlled',
    caveat: 'Migrated wc2tb SDXL checkpoint. Photonic has one direct smoke proof; not full A1111 parity.',
    modelFile: 'photonic_fusion_sdxl_finale_v1.safetensors',
    defaultWidth: 1024,
    defaultHeight: 1024,
    defaultSteps: 10,
    defaultCfgScale: 6.5,
    defaultSampler: 'dpm++2m',
    minSteps: 1,
    maxSteps: 150,
    maxWidth: 2048,
    maxHeight: 2048
  },
  {
    id: 'sdxl-homochi',
    label: 'Homochi XL v2',
    status: 'staged',
    mode: 'migrated controlled generation',
    route: '/api/actions/generate-controlled',
    caveat: 'Migrated wc2tb SDXL checkpoint; staged/selectable without individual smoke proof. Not full A1111 parity.',
    modelFile: 'homochi_xl_v2.safetensors',
    defaultWidth: 1024,
    defaultHeight: 1024,
    defaultSteps: 10,
    defaultCfgScale: 6.5,
    defaultSampler: 'dpm++2m',
    minSteps: 1,
    maxSteps: 150,
    maxWidth: 2048,
    maxHeight: 2048
  },
  {
    id: 'sdxl-pony',
    label: 'Pony Diffusion V6 XL',
    status: 'staged',
    mode: 'migrated controlled generation',
    route: '/api/actions/generate-controlled',
    caveat: 'Migrated wc2tb SDXL checkpoint; staged/selectable without individual smoke proof. Not full A1111 parity.',
    modelFile: 'pony_diffusion_v6_xl.safetensors',
    defaultWidth: 1024,
    defaultHeight: 1024,
    defaultSteps: 10,
    defaultCfgScale: 6.5,
    defaultSampler: 'dpm++2m',
    minSteps: 1,
    maxSteps: 150,
    maxWidth: 2048,
    maxHeight: 2048
  },
  {
    id: 'sd15-homofidelis',
    label: 'HomoFidelis v5',
    status: 'staged',
    mode: 'migrated controlled generation',
    route: '/api/actions/generate-controlled',
    caveat: 'Migrated wc2tb SD1.5 checkpoint; staged/selectable without individual smoke proof. Not full A1111 parity.',
    modelFile: 'homofidelis_v5.safetensors',
    defaultWidth: 512,
    defaultHeight: 512,
    defaultSteps: 20,
    defaultCfgScale: 7,
    defaultSampler: 'euler_a',
    minSteps: 1,
    maxSteps: 150,
    maxWidth: 1024,
    maxHeight: 1024
  },
  {
    id: 'sdxl-juggernaut',
    label: 'Juggernaut XL (Ragnarok / latest photoreal)',
    status: 'staged',
    mode: 'migrated controlled generation',
    route: '/api/actions/generate-controlled',
    caveat: 'SDXL Checkpoint (~6-7GB fp16). Excellent photorealism with strong male anatomy, versatile for athletic/muscular men and NSFW; widely praised for realistic bodies in gay male workflows. (Civitai search Juggernaut XL). Not full A1111 parity.',
    modelFile: 'juggernaut_xl_ragnarok.safetensors',
    defaultWidth: 832,
    defaultHeight: 1216,
    defaultSteps: 35,
    defaultCfgScale: 4,
    defaultSampler: 'dpm++2m',
    minSteps: 1,
    maxSteps: 150,
    maxWidth: 2048,
    maxHeight: 2048
  },
  {
    id: 'sdxl-realvisxl',
    label: 'RealVisXL V5.0 (Lightning or standard photoreal)',
    status: 'staged',
    mode: 'migrated controlled generation',
    route: '/api/actions/generate-controlled',
    caveat: 'SDXL Checkpoint. High photoreal quality, detailed realistic male bodies/skin, good for intimate homoerotic scenes with natural lighting and anatomy. (Search Civitai RealVisXL V5). Not full A1111 parity.',
    modelFile: 'realvisxl_v5_0.safetensors',
    defaultWidth: 1024,
    defaultHeight: 1024,
    defaultSteps: 30,
    defaultCfgScale: 4,
    defaultSampler: 'dpm++2m',
    minSteps: 1,
    maxSteps: 150,
    maxWidth: 2048,
    maxHeight: 2048
  },
  {
    id: 'sdxl-cyberrealistic',
    label: 'CyberRealistic XL (latest male-tuned photoreal)',
    status: 'staged',
    mode: 'migrated controlled generation',
    route: '/api/actions/generate-controlled',
    caveat: 'SDXL Checkpoint. Strong photoreal skin textures, musculature, and realistic male forms; effective for detailed adult male NSFW. (Search Civitai CyberRealistic XL). Not full A1111 parity.',
    modelFile: 'cyberrealistic_xl_v10.safetensors',
    defaultWidth: 832,
    defaultHeight: 1216,
    defaultSteps: 30,
    defaultCfgScale: 4,
    defaultSampler: 'dpm++2m',
    minSteps: 1,
    maxSteps: 150,
    maxWidth: 2048,
    maxHeight: 2048
  },
  {
    id: 'sdxl-epicrealism',
    label: 'epiCRealism XL (natural sin / photoreal male variants)',
    status: 'staged',
    mode: 'migrated controlled generation',
    route: '/api/actions/generate-controlled',
    caveat: 'SDXL Checkpoint (https://civitai.com/models/277058/epicrealism-xl or latest). Top photoreal benchmark with excellent anatomy adherence; pairs extremely well with male prompts/LoRAs for homoerotic realism. Not full A1111 parity.',
    modelFile: 'epicrealism_xl_pure_fix.safetensors',
    defaultWidth: 832,
    defaultHeight: 1216,
    defaultSteps: 30,
    defaultCfgScale: 5,
    defaultSampler: 'dpm++2m',
    minSteps: 1,
    maxSteps: 150,
    maxWidth: 2048,
    maxHeight: 2048
  },
  {
    id: 'sdxl-biglust',
    label: 'Big Lust v1.6 (bigASP + LUSTIFY / BigAspLustify)',
    status: 'staged',
    mode: 'migrated controlled generation',
    route: '/api/actions/generate-controlled',
    caveat: 'SDXL Checkpoint. Photoreal NSFW-focused merge of bigASP and LUSTIFY with solid male anatomy; community notes good results for masculine/homoerotic content. Not full A1111 parity.',
    modelFile: 'big_lust_v1_6.safetensors',
    defaultWidth: 1024,
    defaultHeight: 1024,
    defaultSteps: 30,
    defaultCfgScale: 5,
    defaultSampler: 'dpm++2m',
    minSteps: 1,
    maxSteps: 150,
    maxWidth: 2048,
    maxHeight: 2048
  },
  {
    id: 'sdxl-lustify',
    label: 'LUSTIFY! (core photoreal NSFW)',
    status: 'staged',
    mode: 'migrated controlled generation',
    route: '/api/actions/generate-controlled',
    caveat: 'SDXL Checkpoint. Photoreal NSFW merge with excellent male anatomy, skin details, and homoerotic capability (LUSTIFY series). Not full A1111 parity.',
    modelFile: 'lustify_v8_apex.safetensors',
    defaultWidth: 832,
    defaultHeight: 1216,
    defaultSteps: 30,
    defaultCfgScale: 5,
    defaultSampler: 'dpm++2m',
    minSteps: 1,
    maxSteps: 150,
    maxWidth: 2048,
    maxHeight: 2048
  },
  {
    id: 'sdxl-biglove',
    label: 'Big Love (photoreal male-leaning Lustify hybrid)',
    status: 'staged',
    mode: 'migrated controlled generation',
    route: '/api/actions/generate-controlled',
    caveat: 'SDXL Checkpoint. Photoreal male-leaning with NSFW focus (BigLove XL / Lustify hybrid). Not full A1111 parity.',
    modelFile: 'big_love_photo.safetensors',
    defaultWidth: 1024,
    defaultHeight: 1024,
    defaultSteps: 10,
    defaultCfgScale: 6,
    defaultSampler: 'dpm++2m',
    minSteps: 1,
    maxSteps: 150,
    maxWidth: 2048,
    maxHeight: 2048
  }
];
const CONTROLLED_TARGET_BY_ID = CONTROLLED_TARGETS.reduce((acc, target) => {
  acc[target.id] = target;
  return acc;
}, {});

// Set of filenames already covered by hardcoded CONTROLLED_TARGETS, for deduplication.
const KNOWN_MODEL_FILES = new Set(CONTROLLED_TARGETS.map(t => t.modelFile).filter(Boolean));

// Build synthetic target specs for any .safetensors checkpoint found in the assets cache
// that isn't already covered by CONTROLLED_TARGETS. Called per-request since the cache updates.
function buildDiscoveredTargets(assets) {
  if (!assets || !Array.isArray(assets.checkpoints)) return [];
  const discovered = [];
  for (const cp of assets.checkpoints) {
    const fullPath = cp.full_path || '';
    const filename = cp.filename || '';
    if (!filename.endsWith('.safetensors')) continue;
    if (!fullPath.startsWith(MODEL_STAGE_ROOT + '/')) continue;
    if (KNOWN_MODEL_FILES.has(filename)) continue;

    const isSDXL = fullPath.includes('/checkpoints/sdxl/');
    const isSD15 = fullPath.includes('/checkpoints/sd15/');
    if (!isSDXL && !isSD15) continue;

    const typePrefix = isSDXL ? 'sdxl' : 'sd15';
    const basename = filename.replace(/\.safetensors$/i, '')
      .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
    const id = `${typePrefix}-auto-${basename}`;
    if (CONTROLLED_TARGET_BY_ID[id]) continue;

    const label = filename.replace(/\.safetensors$/i, '').replace(/[-_]/g, ' ');
    discovered.push({
      id,
      label,
      status: 'discovered',
      mode: 'auto-discovered generation',
      route: '/api/actions/generate-controlled',
      caveat: `Auto-discovered ${typePrefix.toUpperCase()} checkpoint. No individual proof run; experimental.`,
      modelPath: fullPath,
      modelFile: filename,
      defaultWidth: isSDXL ? 1024 : 512,
      defaultHeight: isSDXL ? 1024 : 512,
      defaultSteps: isSDXL ? 10 : 20,
      defaultCfgScale: isSDXL ? 6.5 : 7,
      defaultSampler: isSDXL ? 'dpm++2m' : 'euler_a',
      minSteps: 1,
      maxSteps: 150,
      maxWidth: isSDXL ? 2048 : 1024,
      maxHeight: isSDXL ? 2048 : 1024
    });
  }
  return discovered;
}

const PRESET_DEFAULTS = {
  smoke: { steps: 1, cfg_scale: 7, sampler: 'euler_a', width: 512, height: 512 },
  thumbnail: { steps: 4, cfg_scale: 7, sampler: 'euler_a', width: 384, height: 384 },
  fast: { steps: 8, cfg_scale: 7, sampler: 'euler_a', width: 512, height: 512 },
  balanced: { steps: 16, cfg_scale: 7, sampler: 'euler_a', width: 512, height: 512 },
  quality: { steps: 20, cfg_scale: 7, sampler: 'euler_a', width: 512, height: 512 },
  quality_plus: { steps: 30, cfg_scale: 7, sampler: 'euler_a', width: 512, height: 512 }
};

const jobs = {}; // in-memory job state
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

function getBuildInfo() {
  let gitHead = 'unknown';
  try {
    gitHead = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch (_) {}
  return {
    name: 'Image_Gen Operator Console',
    version: APP_VERSION,
    gitHead,
    pid: process.pid,
    cwd: __dirname,
    bind: `http://${HOST}:${PORT}`,
    workflowRoot: WORKFLOW_ROOT,
    startedAt: new Date().toISOString()
  };
}

function expandWildcards(prompt, maxDepth = 6) {
  if (typeof prompt !== 'string') return prompt;
  const pattern = /__([a-zA-Z0-9_-]+)__/g;
  let result = prompt;
  for (let depth = 0; depth < maxDepth; depth++) {
    const before = result;
    result = result.replace(pattern, (match, name) => {
      const filePath = path.join(WILDCARDS_DIR, name + '.txt');
      if (!filePath.startsWith(WILDCARDS_DIR + path.sep) && filePath !== WILDCARDS_DIR) return match;
      try {
        const lines = fs.readFileSync(filePath, 'utf8')
          .split('\n')
          .map(l => l.trim())
          .filter(l => l && !l.startsWith('#'));
        return lines.length ? lines[Math.floor(Math.random() * lines.length)] : match;
      } catch { return match; }
    });
    if (result === before) break;
  }
  return result;
}

function validatePrompt(prompt) {
  return typeof prompt === 'string' && prompt.trim().length > 0 && prompt.length <= 4000;
}
function validatePromptLoras(prompt) {
  if (typeof prompt !== 'string') return { ok: true };
  const regex = /<lora:([^:>]+):([^>]+)>/g;
  let match;
  const assets = readJsonCache(ASSETS_CACHE);
  const discoveredLoras = (assets && assets.loras) ? assets.loras : [];

  const allowedNames = new Set();
  for (const lora of discoveredLoras) {
    if (lora.filename) {
      allowedNames.add(lora.filename);
      const base = lora.filename.replace(/\.(safetensors|ckpt|pt|bin)$/i, '');
      allowedNames.add(base);
    }
  }

  while ((match = regex.exec(prompt)) !== null) {
    const loraName = match[1];
    const loraWeight = match[2];

    const weightNum = Number(loraWeight);
    if (isNaN(weightNum)) {
      return { ok: false, error: `Invalid LoRA weight: "${loraWeight}"` };
    }

    if (!allowedNames.has(loraName)) {
      return { ok: false, error: `LoRA "${loraName}" is not in the discovered assets allowlist.` };
    }
  }
  return { ok: true };
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
  return /^(random|fixed|-1|\d+)$/.test(String(seed));
}
function validateSampler(sampler) {
  if (!sampler) return true;
  return typeof sampler === 'string' && /^[a-zA-Z0-9_\-]+$/.test(sampler) && ALLOWED_SAMPLERS.has(sampler);
}
function validateScheduler(scheduler) {
  if (!scheduler) return true;
  return typeof scheduler === 'string' && ALLOWED_SCHEDULERS.has(scheduler);
}
function validateVae(vae) {
  if (!vae || vae === 'auto' || vae === 'none') return true;
  const assets = readJsonCache(ASSETS_CACHE);
  if (!assets || !assets.vaes) return false;
  return assets.vaes.some(v => v.id === vae);
}
function resolveVaePath(vaeId) {
  if (!vaeId || vaeId === 'auto') return '';
  if (vaeId === 'none') return 'none';
  const assets = readJsonCache(ASSETS_CACHE);
  if (!assets || !assets.vaes) return '';
  const found = assets.vaes.find(v => v.id === vaeId);
  return found ? found.full_path : '';
}
function validateSavePrompts(value) {
  return value === undefined || value === null || typeof value === 'boolean';
}
function validateControlledTarget(target, allTargetById = CONTROLLED_TARGET_BY_ID) {
  return typeof target === 'string' && Boolean(allTargetById[target]);
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
    runId: null,
    progress: null
  };
  return id;
}

function estimateControlledRunSeconds(params) {
  const steps = Number(params.steps || 20);
  const width = Number(params.width || 512);
  const height = Number(params.height || 512);
  const pixelFactor = Math.max(1, (width * height) / (512 * 512));
  const stepFactor = Number.isFinite(steps) && steps > 0 ? steps : 20;
  return Math.max(20, Math.min(240, Math.round(stepFactor * pixelFactor * 5)));
}

function updateSequentialProgress(job, patch = {}) {
  job.progress = {
    totalRuns: 1,
    completedRuns: 0,
    currentRun: 1,
    currentRunPercent: 0,
    totalPercent: 0,
    runsLeft: 1,
    ...job.progress,
    ...patch
  };
  const totalRuns = job.progress.totalRuns || 1;
  const completedRuns = job.progress.completedRuns || 0;
  const currentRunPercent = Math.max(0, Math.min(100, Math.round(job.progress.currentRunPercent || 0)));
  job.progress.currentRunPercent = currentRunPercent;
  job.progress.runsLeft = Math.max(0, totalRuns - completedRuns);
  job.progress.totalPercent = Math.max(0, Math.min(100, Math.round(((completedRuns + currentRunPercent / 100) / totalRuns) * 100)));
}

function startEstimatedRunProgress(job, runIndex, quantity, estimatedSeconds) {
  const startedAt = Date.now();
  updateSequentialProgress(job, {
    totalRuns: quantity,
    completedRuns: runIndex,
    currentRun: runIndex + 1,
    currentRunPercent: 0,
    currentRunStartedAt: startedAt,
    estimatedSeconds
  });
  return setInterval(() => {
    if (!job || job.status !== 'running') return;
    const elapsedSeconds = (Date.now() - startedAt) / 1000;
    const estimate = Math.max(1, estimatedSeconds || 60);
    const pct = Math.min(95, Math.round((elapsedSeconds / estimate) * 100));
    updateSequentialProgress(job, { currentRunPercent: pct });
  }, 1200);
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
    const errOut = job.stderr;
    const combined = out + errOut;
    if (out.includes('==== PASS ====')) job.status = 'PASS';
    else if (out.includes('status: PARTIAL') || out.includes('==== PARTIAL ====')) job.status = 'PARTIAL';
    else if (combined.includes('==== FAIL ====')) job.status = 'FAIL';
    else job.status = code === 0 ? 'PASS' : 'FAIL';
    const gateMatch = combined.match(/First failed gate:\s*(.+?)(?=\n|$)/);
    if (gateMatch) {
      job.firstFailedGate = gateMatch[1].trim();
    } else {
      const failMatch = out.match(/FAIL:\s*(.+?)(?=\n|$)/);
      if (failMatch) job.firstFailedGate = failMatch[1].trim();
      else if (combined.includes('Unknown argument')) job.firstFailedGate = 'args';
    }
    const runMatch = out.match(/runs\/(20\d{6}-\d{6}-[a-zA-Z0-9_-]+)/);
    if (runMatch) job.runId = runMatch[1];
    const upscaledMatch = out.match(/UPSCALED_IMAGE:\s*(\S+)/);
    if (upscaledMatch) job.upscaledImage = upscaledMatch[1];
    const manifestMatch = out.match(/UPSCALE_MANIFEST:\s*(\S+)/);
    if (manifestMatch) job.upscaleManifest = manifestMatch[1];
    const controlledTargetMatch = out.match(/CONTROLLED_TARGET:\s*(\S+)/);
    if (controlledTargetMatch) job.controlledTarget = controlledTargetMatch[1];
    const controlledImageMatch = out.match(/CONTROLLED_OUTPUT_IMAGE:\s*(\S+)/);
    if (controlledImageMatch) job.controlledOutputImage = controlledImageMatch[1];
    const controlledManifestMatch = out.match(/CONTROLLED_MANIFEST:\s*(\S+)/);
    if (controlledManifestMatch) job.controlledManifest = controlledManifestMatch[1];
    const hiresRunIdMatch = out.match(/HIRES_RUN_ID:\s*(\S+)/);
    if (hiresRunIdMatch) job.hiresRunId = hiresRunIdMatch[1];
    const hiresBaseMatch = out.match(/HIRES_BASE_IMAGE:\s*(\S+)/);
    if (hiresBaseMatch) job.hiresBaseImage = hiresBaseMatch[1];
    const hiresFinalMatch = out.match(/HIRES_FINAL_IMAGE:\s*(\S+)/);
    if (hiresFinalMatch) job.hiresFinalImage = hiresFinalMatch[1];
    const hiresManifestMatch = out.match(/HIRES_MANIFEST:\s*(\S+)/);
    if (hiresManifestMatch) job.hiresManifest = hiresManifestMatch[1];
  });
}

function isFixedSeed(seed) {
  if (typeof seed === 'number') return seed >= 0;
  if (typeof seed === 'string') {
    const trimmed = seed.trim();
    return /^\d+$/.test(trimmed);
  }
  return false;
}

function runControlledSequential(jobId, spec, params, quantity) {
  const job = jobs[jobId];
  job.status = 'running';
  const env = { ...process.env, SDCPP_REDACT_PROMPTS: params.save_prompts ? '0' : '1' };
  const sensitives = jobSensitives[jobId] || [];
  const estimatedSeconds = estimateControlledRunSeconds(params);

  function runNext(runIndex) {
    const runNumber = runIndex + 1;
    job.stdout += `\n--- Sequential Run ${runNumber} of ${quantity} ---\n`;
    let progressTimer = startEstimatedRunProgress(job, runIndex, quantity, estimatedSeconds);

    const args = ['--target', params.target, '--prompt', params.prompt];
    if (spec.modelPath && !CONTROLLED_TARGET_BY_ID[params.target]) {
      args.push('--model-path', spec.modelPath);
    }
    if (params.negative_prompt) args.push('--negative-prompt', params.negative_prompt);
    if (params.width) args.push('--width', String(params.width));
    if (params.height) args.push('--height', String(params.height));
    if (params.steps) args.push('--steps', String(params.steps));
    if (params.cfg_scale !== undefined && params.cfg_scale !== null && params.cfg_scale !== '') {
      args.push('--cfg', String(params.cfg_scale));
    }

    let seedValue = params.seed;
    if (isFixedSeed(params.seed)) {
      seedValue = String(parseInt(params.seed, 10) + runIndex);
    }
    if (seedValue !== undefined && seedValue !== null && seedValue !== '') {
      args.push('--seed', seedValue);
    }

    if (params.api && spec.id === 'sd15') args.push('--api', params.api);
    if (params.scheduler) args.push('--scheduler', params.scheduler);
    if (params.vae && params.vae !== 'auto') {
      const vaePath = resolveVaePath(params.vae);
      if (vaePath) args.push('--vae', vaePath);
    }
    args.push('--save-prompts', params.save_prompts ? 'true' : 'false');

    const child = spawn('bin/sdcpp-controlled-generate.sh', args, { cwd: WORKFLOW_ROOT, shell: false, env });
    let runStdout = '';
    let runStderr = '';

    child.stdout.on('data', data => {
      const redacted = redactSensitiveText(data.toString(), sensitives);
      job.stdout += redacted;
      runStdout += redacted;
    });

    child.stderr.on('data', data => {
      const redacted = redactSensitiveText(data.toString(), sensitives);
      job.stderr += redacted;
      runStderr += redacted;
    });

    child.on('error', err => {
      clearInterval(progressTimer);
      job.status = 'FAIL';
      job.stderr += `\nSpawn error in run ${runNumber}: ${err.message}`;
      job.completedAt = Date.now();
      job.firstFailedGate = 'spawn';
      updateSequentialProgress(job, { currentRunPercent: 100 });
    });

    child.on('close', code => {
      clearInterval(progressTimer);
      job.exitCode = code;
      const combined = runStdout + runStderr;
      let runPassed = false;
      if (runStdout.includes('==== PASS ====')) runPassed = true;
      else if (runStdout.includes('status: PARTIAL') || runStdout.includes('==== PARTIAL ====')) runPassed = true;
      else if (combined.includes('==== FAIL ====')) runPassed = false;
      else runPassed = (code === 0);

      if (!runPassed) {
        job.status = 'FAIL';
        job.completedAt = Date.now();
        updateSequentialProgress(job, { currentRunPercent: 100 });

        const gateMatch = combined.match(/First failed gate:\s*(.+?)(?=\n|$)/);
        if (gateMatch) {
          job.firstFailedGate = gateMatch[1].trim();
        } else {
          const failMatch = runStdout.match(/FAIL:\s*(.+?)(?=\n|$)/);
          if (failMatch) job.firstFailedGate = failMatch[1].trim();
          else if (combined.includes('Unknown argument')) job.firstFailedGate = 'args';
        }
        return;
      }

      const runMatch = runStdout.match(/runs\/(20\d{6}-\d{6}-[a-zA-Z0-9_-]+)/);
      if (runMatch) job.runId = runMatch[1];
      const controlledTargetMatch = runStdout.match(/CONTROLLED_TARGET:\s*(\S+)/);
      if (controlledTargetMatch) job.controlledTarget = controlledTargetMatch[1];
      const controlledImageMatch = runStdout.match(/CONTROLLED_OUTPUT_IMAGE:\s*(\S+)/);
      if (controlledImageMatch) job.controlledOutputImage = controlledImageMatch[1];
      const controlledManifestMatch = runStdout.match(/CONTROLLED_MANIFEST:\s*(\S+)/);
      if (controlledManifestMatch) job.controlledManifest = controlledManifestMatch[1];
      updateSequentialProgress(job, { completedRuns: runNumber, currentRunPercent: 100 });

      if (runIndex < quantity - 1) {
        runNext(runIndex + 1);
      } else {
        const out = job.stdout;
        if (out.includes('status: PARTIAL') || out.includes('==== PARTIAL ====')) {
          job.status = 'PARTIAL';
        } else {
          job.status = 'PASS';
        }
        job.completedAt = Date.now();
        updateSequentialProgress(job, { completedRuns: quantity, currentRunPercent: 100 });
      }
    });
  }

  runNext(0);
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

function normalizeControlledGenerationBody(body) {
  const allowedKeys = new Set([
    'target',
    'model_target',
    'model',
    'preset',
    'mode',
    'api',
    'vae',
    'sampler',
    'scheduler',
    'clip_skip',
    'tiling',
    'restore_faces',
    'prompt',
    'negative_prompt',
    'negativePrompt',
    'width',
    'height',
    'steps',
    'cfg_scale',
    'cfg',
    'seed',
    'save_prompts',
    'quantity'
  ]);
  for (const key of Object.keys(body || {})) {
    if (!allowedKeys.has(key)) {
      return { invalidKey: key };
    }
  }
  const target = String(body.target || body.model_target || body.model || '').trim();
  const model = body.model !== undefined && body.model !== null ? String(body.model).trim() : '';
  if (model && target && model !== target) return { invalidKey: 'model' };
  const cfgValue = body.cfg_scale !== undefined && body.cfg_scale !== null && body.cfg_scale !== ''
    ? body.cfg_scale
    : (body.cfg !== undefined && body.cfg !== null && body.cfg !== '' ? body.cfg : '');
  const params = {
    target,
    prompt: body.prompt,
    negative_prompt: body.negative_prompt !== undefined && body.negative_prompt !== null
      ? body.negative_prompt
      : (body.negativePrompt !== undefined && body.negativePrompt !== null ? body.negativePrompt : ''),
    width: body.width !== undefined && body.width !== null && body.width !== '' ? body.width : '',
    height: body.height !== undefined && body.height !== null && body.height !== '' ? body.height : '',
    steps: body.steps !== undefined && body.steps !== null && body.steps !== '' ? body.steps : '',
    cfg_scale: cfgValue,
    seed: body.seed !== undefined && body.seed !== null && body.seed !== '' ? body.seed : '',
    api: body.api !== undefined && body.api !== null && body.api !== '' ? String(body.api) : 'openai',
    scheduler: body.scheduler !== undefined && body.scheduler !== null ? String(body.scheduler).trim() : 'discrete',
    vae: body.vae !== undefined && body.vae !== null ? String(body.vae).trim() : 'auto',
    save_prompts: !!body.save_prompts,
    quantity: body.quantity !== undefined && body.quantity !== null && body.quantity !== '' ? Number(body.quantity) : 1
  };
  return params;
}

function validateGenerationParams(params) {
  if (!validatePrompt(params.prompt)) return 'Invalid prompt';
  const loraErr = validatePromptLoras(params.prompt);
  if (!loraErr.ok) return loraErr.error;
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
  if (!validateVae(params.vae)) return 'Invalid VAE';
  if (!validateSeed(params.seed)) return 'Invalid seed';
  if (!validateIntRange(params.clip_skip, 1, 12)) return 'Invalid CLIP skip';
  return null;
}

function validateControlledGenerationParams(params, allTargetById = CONTROLLED_TARGET_BY_ID) {
  if (params && params.invalidKey) return `Unexpected field: ${params.invalidKey}`;
  if (!validateControlledTarget(params.target, allTargetById)) return 'Invalid target';
  if (params.api && !ALLOWED_APIS.has(params.api)) return 'Invalid API';
  if (!validatePrompt(params.prompt)) return 'Invalid prompt';
  const loraErr = validatePromptLoras(params.prompt);
  if (!loraErr.ok) return loraErr.error;
  if (!validateNegativePrompt(params.negative_prompt)) return 'Invalid negative prompt';
  if (!validateSize(params.width)) return 'Invalid width: use multiples of 8 between 64 and target max';
  if (!validateSize(params.height)) return 'Invalid height: use multiples of 8 between 64 and target max';
  if (!validateSeed(params.seed)) return 'Invalid seed';
  if (!validateScheduler(params.scheduler)) return 'Invalid scheduler';
  if (!validateVae(params.vae)) return 'Invalid VAE';
  if (!validateSavePrompts(params.save_prompts)) return 'Invalid save_prompts';

  const spec = allTargetById[params.target];
  const steps = params.steps === undefined || params.steps === null || params.steps === ''
    ? spec.defaultSteps
    : Number(params.steps);
  if (!validateIntRange(steps, spec.minSteps, spec.maxSteps, false)) return `Invalid steps for ${spec.label}`;

  const cfgScale = params.cfg_scale === undefined || params.cfg_scale === null || params.cfg_scale === ''
    ? spec.defaultCfgScale
    : Number(params.cfg_scale);
  if (!Number.isFinite(cfgScale)) return `Invalid cfg_scale for ${spec.label}`;
  if (cfgScale < 0 || cfgScale > 30) return `Invalid cfg_scale for ${spec.label}`;

  if (params.width !== undefined && params.width !== null && params.width !== '') {
    const width = Number(params.width);
    if (!Number.isInteger(width) || width < 64 || width > spec.maxWidth || width % 8 !== 0) {
      return `Invalid width for ${spec.label}`;
    }
  }
  if (params.height !== undefined && params.height !== null && params.height !== '') {
    const height = Number(params.height);
    if (!Number.isInteger(height) || height < 64 || height > spec.maxHeight || height % 8 !== 0) {
      return `Invalid height for ${spec.label}`;
    }
  }

  if (params.target === 'sdxl-turbo' && cfgScale !== 0) return 'SDXL Turbo requires cfg_scale 0';
  if (params.target === 'flux-fp8' && cfgScale !== 3.5) return 'Flux fp8 requires cfg_scale 3.5';
  if (params.quantity !== undefined && params.quantity !== null) {
    if (!Number.isInteger(params.quantity) || params.quantity < 1 || params.quantity > 100) {
      return 'Quantity must be an integer between 1 and 100';
    }
  }
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
  if (params.scheduler) args.push('--scheduler', params.scheduler);
  if (params.vae && params.vae !== 'auto') {
    const vaePath = resolveVaePath(params.vae);
    if (vaePath) args.push('--vae', vaePath);
  }
  if (params.seed) args.push('--seed', String(params.seed));
  if (includeApi && params.api) args.push('--api', params.api);
  return args;
}

function readSchemaFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    return { error: `Could not read schema file: ${err.message}` };
  }
}

function commandPreview(script, args, sensitives) {
  return {
    script,
    argv: [script, ...args],
    command: getRedactedCommandSummary(script, args, sensitives),
    redacted: sensitives && sensitives.length > 0
  };
}

function buildTxt2imgPreview(body) {
  const discoveredTargets = buildDiscoveredTargets(readJsonCache(ASSETS_CACHE));
  const allTargetById = discoveredTargets.length
    ? { ...CONTROLLED_TARGET_BY_ID, ...Object.fromEntries(discoveredTargets.map(t => [t.id, t])) }
    : CONTROLLED_TARGET_BY_ID;
  const previewBody = { ...(body || {}) };
  delete previewBody.job_type;
  delete previewBody.type;
  delete previewBody.debug_command_preview;
  delete previewBody.debug_json_preview;
  const params = normalizeControlledGenerationBody(previewBody);
  const err = validateControlledGenerationParams(params, allTargetById);
  if (err) return { ok: false, status: 400, error: err };
  const spec = allTargetById[params.target];
  const args = ['--target', params.target, '--prompt', params.prompt];
  if (spec.modelPath && !CONTROLLED_TARGET_BY_ID[params.target]) args.push('--model-path', spec.modelPath);
  if (params.negative_prompt) args.push('--negative-prompt', params.negative_prompt);
  if (params.width) args.push('--width', String(params.width));
  if (params.height) args.push('--height', String(params.height));
  if (params.steps) args.push('--steps', String(params.steps));
  if (params.cfg_scale !== undefined && params.cfg_scale !== null && params.cfg_scale !== '') args.push('--cfg', String(params.cfg_scale));
  if (params.seed !== undefined && params.seed !== null && params.seed !== '') args.push('--seed', String(params.seed));
  if (params.api && spec.id === 'sd15') args.push('--api', params.api);
  if (params.scheduler) args.push('--scheduler', params.scheduler);
  if (params.vae && params.vae !== 'auto') {
    const vaePath = resolveVaePath(params.vae);
    if (vaePath) args.push('--vae', vaePath);
  }
  args.push('--save-prompts', params.save_prompts ? 'true' : 'false');
  const sensitives = [params.prompt, params.negative_prompt].filter(Boolean);
  return {
    ok: true,
    job_type: 'txt2img',
    normalized: { ...params, target: spec.id },
    compatibility: compatibilityForTarget(spec.id),
    preview: commandPreview('bin/sdcpp-controlled-generate.sh', args, sensitives)
  };
}

function buildImageEditPreview(kind, body) {
  const gateEnabled = kind === 'inpaint' ? inpaintSupported : img2imgSupported;
  if (!gateEnabled) {
    return { ok: false, status: 409, error: `${kind} is not currently supported.` };
  }
  const params = normalizeGenerationBody(body || {});
  const err = validateGenerationParams(params);
  if (err) return { ok: false, status: 400, error: err };
  const strength = body && body.strength !== undefined ? Number(body.strength) : 0.75;
  if (!Number.isFinite(strength) || strength < 0.01 || strength > 0.99) {
    return { ok: false, status: 400, error: 'strength must be a number between 0.01 and 0.99' };
  }
  const initImage = body && body.run_id && body.init_image_file
    ? path.resolve(RUNS_DIR, String(body.run_id), String(body.init_image_file))
    : '<selected-run-image>';
  const args = ['--init-img', initImage];
  if (kind === 'inpaint') args.push('--mask', '<mask-upload-created-on-submit>');
  args.push('--strength', String(strength), '--prompt', params.prompt);
  if (params.negative_prompt) args.push('--negative', params.negative_prompt);
  if (params.steps) args.push('--steps', String(params.steps));
  if (params.width) args.push('--width', String(params.width));
  if (params.height) args.push('--height', String(params.height));
  if (params.cfg_scale) args.push('--cfg-scale', String(params.cfg_scale));
  if (params.sampler) args.push('--sampler', params.sampler);
  if (params.scheduler) args.push('--scheduler', params.scheduler);
  if (params.seed) args.push('--seed', String(params.seed));
  if (params.vae && params.vae !== 'auto') {
    const vaePath = resolveVaePath(params.vae);
    if (vaePath) args.push('--vae', vaePath);
  }
  const sensitives = [params.prompt, params.negative_prompt].filter(Boolean);
  return {
    ok: true,
    job_type: kind,
    normalized: { ...params, strength, run_id: body.run_id || null, init_image_file: body.init_image_file || null },
    compatibility: compatibilityForTarget(params.model || 'sd15'),
    preview: commandPreview(kind === 'inpaint' ? 'bin/sdcpp-inpaint.sh' : 'bin/sdcpp-img2img.sh', args, sensitives)
  };
}

function compatibilityForTarget(targetId) {
  const registry = readSchemaFile(MODEL_COMPATIBILITY_REGISTRY);
  const target = String(targetId || '').toLowerCase();
  let family = 'sd15';
  if (target.includes('flux')) family = 'flux';
  else if (target.includes('turbo')) family = 'sdxl-turbo';
  else if (target.includes('sdxl') || target.includes('xl')) family = 'sdxl';
  return {
    family,
    ...(registry.model_families && registry.model_families[family] ? registry.model_families[family] : {}),
    parity_categories: registry.parity_categories || {}
  };
}

function buildGenerationPreview(body) {
  const jobType = String((body && (body.job_type || body.type)) || 'txt2img');
  if (jobType === 'txt2img') return buildTxt2imgPreview(body);
  if (jobType === 'img2img' || jobType === 'inpaint') return buildImageEditPreview(jobType, body || {});
  return { ok: false, status: 400, error: `Unsupported preview job_type: ${jobType}` };
}

function validateMaskDataUrl(maskData, tempPrefix = 'validate-mask') {
  if (!maskData) return { ok: false, status: 400, error: 'mask_data is required (base64 PNG data URL)' };
  const maskStripped = String(maskData).replace(/^data:image\/png;base64,/, '');
  if (maskStripped.length < 50) return { ok: false, status: 400, error: 'mask_data appears to be empty or invalid' };
  let maskBuf;
  try {
    maskBuf = Buffer.from(maskStripped, 'base64');
    if (maskBuf.length < 8 || maskBuf[0] !== 0x89 || maskBuf[1] !== 0x50 || maskBuf[2] !== 0x4e || maskBuf[3] !== 0x47) {
      return { ok: false, status: 400, error: 'mask_data must be a valid PNG image' };
    }
  } catch (e) {
    return { ok: false, status: 400, error: 'Failed to decode mask_data: ' + e.message };
  }

  const rawPath = path.join(MASK_UPLOADS_DIR, `${tempPrefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.png`);
  fs.writeFileSync(rawPath, maskBuf);
  const MASK_CHECK_PY = [
    'import sys',
    'from PIL import Image',
    'img = Image.open(sys.argv[1]).convert("RGBA")',
    '_, _, _, a = img.split()',
    'mask = a.point([0] + [255]*255)',
    'print("painted" if mask.getbbox() else "blank")'
  ].join('\n');
  try {
    const result = execFileSync('python3', ['-c', MASK_CHECK_PY, rawPath], { timeout: 15000 }).toString().trim();
    try { fs.unlinkSync(rawPath); } catch (_) {}
    if (result === 'blank') return { ok: false, status: 400, error: 'Mask has no painted pixels. Paint over the region to inpaint first.' };
  } catch (e) {
    try { fs.unlinkSync(rawPath); } catch (_) {}
    return { ok: false, status: 400, error: 'Could not inspect mask alpha channel: ' + e.message };
  }
  return { ok: true, bytes: maskBuf.length };
}

function validateInpaintBody(body) {
  body = body || {};
  const runId = typeof body.run_id === 'string' ? body.run_id.trim() : '';
  const initImageFile = typeof body.init_image_file === 'string' ? body.init_image_file.trim() : '';
  if (!runId) return { ok: false, status: 400, error: 'run_id is required' };
  if (!initImageFile) return { ok: false, status: 400, error: 'init_image_file is required' };
  if (!/^20\d{6}-\d{6}-[a-zA-Z0-9_-]+$/.test(runId)) return { ok: false, status: 400, error: 'Invalid run_id format' };
  if (!/^[a-zA-Z0-9_\-.]+$/.test(initImageFile) || initImageFile.includes('..') || initImageFile.includes('/')) {
    return { ok: false, status: 400, error: 'init_image_file must be a safe filename (no path separators or traversal)' };
  }
  if (!initImageFile.toLowerCase().endsWith('.png')) return { ok: false, status: 400, error: 'init_image_file must be a .png file' };
  const initImgPath = path.resolve(RUNS_DIR, runId, initImageFile);
  const relCheck = path.relative(RUNS_DIR, initImgPath);
  if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) return { ok: false, status: 403, error: 'Init image path resolves outside runs directory' };
  if (!fs.existsSync(initImgPath)) return { ok: false, status: 404, error: `Init image not found: ${runId}/${initImageFile}` };
  const strength = body.strength !== undefined ? Number(body.strength) : 0.75;
  if (!Number.isFinite(strength) || strength < 0.01 || strength > 0.99) {
    return { ok: false, status: 400, error: 'strength must be a number between 0.01 and 0.99' };
  }
  const maskCheck = validateMaskDataUrl(body.mask_data, 'validate-inpaint-mask');
  if (!maskCheck.ok) return maskCheck;
  const params = normalizeGenerationBody(body);
  const genErr = validateGenerationParams(params);
  if (genErr) return { ok: false, status: 400, error: genErr };
  return { ok: true, params: { ...params, run_id: runId, init_image_file: initImageFile, strength, mask_bytes: maskCheck.bytes } };
}

function normalizeHiresFixBody(body) {
  body = body || {};

  if (!validatePrompt(body.prompt)) return { ok: false, status: 400, error: 'Invalid prompt' };
  const loraErr = validatePromptLoras(body.prompt);
  if (!loraErr.ok) return { ok: false, status: 400, error: loraErr.error };
  const prompt = String(body.prompt).trim();
  if (!validateNegativePrompt(body.negative_prompt)) return { ok: false, status: 400, error: 'Invalid negative prompt' };
  const negativePrompt = body.negative_prompt ? String(body.negative_prompt) : '';

  const mode = body.mode !== undefined ? String(body.mode) : 'cli';
  if (mode !== 'cli') return { ok: false, status: 400, error: 'Only mode=cli is supported for hires-fix' };

  if (body.api !== undefined && body.api !== null && body.api !== '') {
    return { ok: false, status: 400, error: 'api param is not accepted for hires-fix (CLI mode only)' };
  }

  const preset = body.preset !== undefined ? String(body.preset) : 'fast';
  if (!PRESET_DEFAULTS[preset] && preset !== 'Custom') {
    return { ok: false, status: 400, error: `Unknown preset: ${preset}` };
  }

  const scale = body.scale !== undefined ? Number(body.scale) : 2;
  if (!ALLOWED_UPSCALE_SCALES.has(scale)) return { ok: false, status: 400, error: 'scale must be 2, 3, or 4' };

  const resample = body.resample !== undefined ? String(body.resample) : 'lanczos';
  if (!ALLOWED_UPSCALE_RESAMPLES.has(resample)) {
    return { ok: false, status: 400, error: 'resample must be: nearest, bilinear, bicubic, lanczos' };
  }

  if (!validateIntRange(body.steps, 1, 150)) return { ok: false, status: 400, error: 'Invalid steps' };
  const cfgVal = body.cfg_scale !== undefined ? body.cfg_scale : body.cfg;
  if (!validateFloatRange(cfgVal, 1, 30)) return { ok: false, status: 400, error: 'Invalid cfg_scale' };
  if (!validateSize(body.width)) return { ok: false, status: 400, error: 'Invalid width: use multiples of 8 between 64 and 2048' };
  if (!validateSize(body.height)) return { ok: false, status: 400, error: 'Invalid height: use multiples of 8 between 64 and 2048' };
  if (!validateSampler(body.sampler)) return { ok: false, status: 400, error: 'Invalid or unsupported sampler' };
  if (!validateSeed(body.seed)) return { ok: false, status: 400, error: 'Invalid seed' };

  const savePrompts = !!body.save_prompts;
  const params = { prompt, negative_prompt: negativePrompt, preset, mode, scale, resample, save_prompts: savePrompts };
  const args = ['--preset', preset, '--prompt', prompt, '--scale', String(scale), '--resample', resample];
  if (negativePrompt) args.push('--negative', negativePrompt);
  if (body.steps) { params.steps = Number(body.steps); args.push('--steps', String(Number(body.steps))); }
  if (body.width) { params.width = Number(body.width); args.push('--width', String(Number(body.width))); }
  if (body.height) { params.height = Number(body.height); args.push('--height', String(Number(body.height))); }
  if (cfgVal !== undefined && cfgVal !== null && cfgVal !== '') {
    params.cfg_scale = Number(cfgVal);
    args.push('--cfg-scale', String(Number(cfgVal)));
  }
  if (body.sampler) { params.sampler = String(body.sampler); args.push('--sampler', String(body.sampler)); }
  if (body.seed !== undefined && body.seed !== null && String(body.seed) !== '') {
    params.seed = String(body.seed);
    args.push('--seed', String(body.seed));
  }

  return {
    ok: true,
    params,
    args,
    sensitives: savePrompts ? [] : [prompt, negativePrompt].filter(Boolean),
    savePrompts
  };
}

function hiresFixValidationResponse(normalized) {
  const p = normalized.params;
  const save = normalized.savePrompts;
  const out = {
    ok: true,
    preset: p.preset,
    mode: p.mode,
    scale: p.scale,
    resample: p.resample,
    seed: p.seed || '',
    prompt_saved: save,
    prompt: save ? p.prompt : '[REDACTED]',
    negative_prompt: save ? p.negative_prompt : '[REDACTED]'
  };
  ['steps', 'width', 'height', 'sampler'].forEach(key => {
    if (p[key] !== undefined) out[key] = p[key];
  });
  return out;
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
  if (dirName.includes('-controlled-sdxl-turbo')) return ['controlled-sdxl-turbo', 'Controlled SDXL Turbo'];
  if (dirName.includes('-controlled-sdxl-base')) return ['controlled-sdxl-base', 'Controlled SDXL base'];
  if (dirName.includes('-controlled-flux-fp8')) return ['controlled-flux-fp8', 'Controlled Flux fp8'];
  if (dirName.includes('-controlled-sd15')) return ['controlled-sd15', 'Controlled SD1.5'];
  if (dirName.includes('-controlled-')) return ['controlled', 'Controlled Generation'];
  if (dirName.includes('-sdxl-turbo-smoke')) return ['sdxl-turbo-smoke', 'SDXL Turbo Smoke'];
  if (dirName.includes('-flux-smoke')) return ['flux-smoke', 'Flux Smoke'];
  if (dirName.includes('-sdxl-smoke')) return ['sdxl-smoke', 'SDXL Smoke'];
  if (dirName.includes('-verify')) return ['verify', 'Verify Backend'];
  if (dirName.includes('-hires-fix')) return ['hires-fix', 'Hires Fix'];
  if (dirName.includes('-batch')) return ['batch-generate', 'Batch Generate'];
  if (dirName.includes('-cli')) return ['cli-generate', 'CLI Generate'];
  if (dirName.includes('-server-gen')) return ['server-generate', 'Server Generate'];
  if (dirName.includes('-server-start')) return ['server-start', 'Server Start'];
  if (dirName.includes('-server-stop')) return ['server-stop', 'Server Stop'];
  if (dirName.includes('-seedtest')) return ['seed-test', 'Seed Test'];
  if (dirName.includes('-benchmark')) return ['benchmark', 'Benchmark'];
  return ['unknown', dirName];
}

// Map run_type to filter category for client-side filtering
function runTypeFilterCategory(runType) {
  if (!runType) return 'other';
  if (runType.startsWith('controlled-')) return 'controlled';
  if (runType.endsWith('-smoke') || runType.includes('-smoke')) return 'smoke';
  if (runType === 'hires-fix') return 'hires-fix';
  if (runType === 'upscale' || runType === 'pillow-upscale') return 'upscale';
  if (runType === 'img2img') return 'img2img';
  if (runType === 'inpaint') return 'inpaint';
  return 'other';
}

function readJsonCache(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (_) { return null; }
}

function summarizeModelStage(cache, smokeCache) {
  const empty = {
    present: false,
    stale: true,
    checked_at: null,
    model_volume: 'wc2tb',
    model_volume_path: '/Volumes/wc2tb',
    model_volume_mounted: false,
    model_volume_free_space: '',
    external_root: MODEL_STAGE_ROOT,
    sdxlTurboStaged: false,
    sdxlTurboStagedState: 'missing',
    sdxlTurboSmokeProven: false,
    fluxStaged: false,
    fluxStagedState: 'missing',
    fluxSmokeProven: false,
    sdxlStaged: false,
    sdxlStagedState: 'missing',
    sdxlSmokeProven: false,
    invalidCandidateCount: 0,
    invalidCandidates: [],
    metalSupportObserved: false,
    supportProven: false,
    recommended_next_step: 'Run POST /api/actions/check-model-stage after staging model files on BigMac wc2tb.'
  };
  if (!cache) return empty;
  const turboCandidates = cache.sdxl_turbo_candidates || [];
  const fluxModels = cache.flux_model_candidates || [];
  const fluxVaes = cache.flux_vae_candidates || [];
  const fluxClip = cache.flux_clip_l_candidates || [];
  const fluxT5 = cache.flux_t5xxl_candidates || [];
  const invalidCandidates = cache.invalid_candidates || [];
  const help = cache.stable_diffusion_cpp_help_summary || {};
  const smokeProven = !!(cache.runtime_smoke_proven || (smokeCache && smokeCache.runtime_smoke_proven) || (smokeCache && smokeCache.png_valid));
  const turboSmokeProven = !!(cache.sdxl_turbo_smoke_proven || (smokeCache && smokeCache.sdxl_turbo_smoke_proven));
  const fluxSmokeProven = !!(cache.flux_smoke_proven || (smokeCache && smokeCache.flux_smoke_proven));
  const turboState = cache.sdxl_turbo_staged_state || (turboCandidates.length > 0 ? 'true' : 'missing');
  const sdxlState = cache.sdxl_staged_state || ((cache.sdxl_candidates || []).length > 0 ? 'true' : 'missing');
  const fluxState = cache.flux_staged_state || (
    fluxModels.length > 0 && fluxVaes.length > 0 &&
    ((fluxClip.length > 0 && fluxT5.length > 0) || !!help.flux_without_clip_l_observed || !!help.flux_without_t5xxl_observed)
      ? 'true'
      : (fluxModels.length > 0 || fluxVaes.length > 0 || fluxClip.length > 0 || fluxT5.length > 0 ? 'partial' : 'missing')
  );
  return {
    present: true,
    stale: false,
    checked_at: cache.checked_at || null,
    external_root: cache.external_root || MODEL_STAGE_ROOT,
    route_ok: !!cache.route_ok,
    model_volume: cache.model_volume || 'wc2tb',
    model_volume_path: cache.model_volume_path || '/Volumes/wc2tb',
    model_volume_mounted: !!(cache.model_volume_mounted ?? cache.wc1tb_mounted),
    model_volume_free_space: cache.model_volume_free_space || cache.free_space || '',
    write_test: cache.write_test || 'unknown',
    sdxlTurboStaged: turboState === 'true',
    sdxlTurboStagedState: turboState,
    sdxlTurboRecommended: cache.sdxl_turbo_recommended_candidate || null,
    sdxlTurboSmokeProven: turboSmokeProven,
    sdxlStaged: sdxlState === 'true',
    sdxlStagedState: sdxlState,
    fluxStaged: fluxState === 'true',
    fluxStagedState: fluxState,
    fluxSmokeProven,
    fluxModelCandidates: fluxModels,
    fluxVaeCandidates: fluxVaes,
    fluxClipLCandidates: fluxClip,
    fluxT5xxlCandidates: fluxT5,
    fluxGgufCandidates: cache.flux_gguf_candidates || [],
    invalidCandidateCount: cache.invalid_candidate_count || invalidCandidates.length,
    invalidCandidates,
    metalSupportObserved: !!cache.metal_support_observed,
    supportProven: smokeProven,
    sdxlSmokeProven: smokeProven,
    recommended_next_step: cache.recommended_next_step || empty.recommended_next_step
  };
}

function summarizeModelInventory(cache) {
  const empty = {
    present: false,
    stale: true,
    checked_at: null,
    model_volume: 'wc2tb',
    model_volume_path: '/Volumes/wc2tb',
    model_volume_mounted: false,
    model_volume_free_space: '',
    external_root: MODEL_STAGE_ROOT,
    total_candidates: 0,
    high_confidence_candidates: 0,
    moved_count: 0,
    duplicate_count: 0,
    duplicate_skip_count: 0,
    collision_count: 0,
    skipped_count: 0,
    manual_review_count: 0,
    remaining_high_confidence_outside_root: 0,
    still_actionable_high_confidence_count: 0,
    remaining_high_confidence_preview: [],
    still_actionable_high_confidence_preview: [],
    manual_review_preview: [],
    duplicate_skip_preview: [],
    missing_source_skip_count: 0,
    missing_source_preview: [],
    inventory_path: null,
    plan_path: null,
    result_path: null,
    recommended_next_step: 'Run POST /api/actions/inventory-models to scan /Volumes/wc2tb and produce a move plan.'
  };
  if (!cache) return empty;
  return {
    present: true,
    stale: false,
    checked_at: cache.checked_at || null,
    model_volume: cache.model_volume || 'wc2tb',
    model_volume_path: cache.model_volume_path || '/Volumes/wc2tb',
    model_volume_mounted: !!cache.model_volume_mounted,
    model_volume_free_space: cache.model_volume_free_space || '',
    external_root: cache.external_root || MODEL_STAGE_ROOT,
    total_candidates: cache.total_candidates || 0,
    high_confidence_candidates: cache.high_confidence_candidates || 0,
    moved_count: cache.moved_count || 0,
    duplicate_count: cache.duplicate_count || 0,
    duplicate_skip_count: cache.duplicate_skip_count || cache.duplicate_count || 0,
    collision_count: cache.collision_count || 0,
    skipped_count: cache.skipped_count || 0,
    manual_review_count: cache.manual_review_count || 0,
    remaining_high_confidence_outside_root: cache.remaining_high_confidence_outside_root || 0,
    remaining_high_confidence_preview: cache.remaining_high_confidence_preview || [],
    still_actionable_high_confidence_count: cache.still_actionable_high_confidence_count || cache.remaining_high_confidence_outside_root || 0,
    still_actionable_high_confidence_preview: cache.still_actionable_high_confidence_preview || cache.remaining_high_confidence_preview || [],
    manual_review_preview: cache.manual_review_preview || [],
    duplicate_skip_preview: cache.duplicate_skip_preview || [],
    missing_source_skip_count: cache.missing_source_skip_count || 0,
    missing_source_preview: cache.missing_source_preview || [],
    inventory_path: cache.inventory_path || null,
    plan_path: cache.plan_path || null,
    result_path: cache.result_path || null,
    recommended_next_step: cache.recommended_next_step || empty.recommended_next_step
  };
}

function buildModelGate(kind, stage) {
  const root = stage.external_root || MODEL_STAGE_ROOT;
  const base = {
    supported: false,
    expected_external_root: root,
    docs: MODEL_STAGE_DOC
  };
  if (kind === 'sdxlTurbo') {
    if (stage.sdxlTurboSmokeProven && stage.sdxlTurboStaged && stage.metalSupportObserved) {
      return { ...base, staged: true, supported: true, reason: 'SDXL Turbo staged and bounded smoke proof passed.' };
    }
    if (stage.sdxlTurboStaged) {
      return { ...base, staged: true, supported: false, reason: 'SDXL Turbo model staged; bounded smoke proof still required.', unlock_requires: 'Run POST /api/actions/sdxl-turbo-smoke after probing BigMac sd-cli flags.' };
    }
    return { ...base, staged: false, supported: false, reason: 'SDXL Turbo model missing on BigMac wc2tb; ignore the 0B q6p/q8p placeholder.', unlock_requires: `Stage ${root}/checkpoints/sdxl-turbo/sd_xl_turbo_1.0_fp16.safetensors, then run model-stage check.` };
  }
  if (kind === 'flux') {
    if (stage.fluxSmokeProven && stage.fluxStaged && stage.metalSupportObserved) {
      return { ...base, staged: true, supported: true, reason: 'Flux staged and bounded smoke proof passed.' };
    }
    if (stage.fluxStagedState === 'true') {
      return { ...base, staged: true, supported: false, reason: 'Flux component set staged; bounded smoke proof still required.', unlock_requires: 'Run POST /api/actions/flux-smoke after probing BigMac sd-cli flags.' };
    }
    if (stage.fluxStagedState === 'partial') {
      return { ...base, staged: 'partial', supported: false, reason: 'Flux model and VAE staged, but CLIP-L/T5XXL are missing unless the BigMac CLI proves an embedded path.', unlock_requires: `Stage Flux Schnell files under ${root}/flux/flux1-schnell and ${root}/flux/shared, then run model-stage check.` };
    }
    return { ...base, staged: false, supported: false, reason: 'Flux model/component files missing on BigMac wc2tb.', unlock_requires: `Stage Flux Schnell files under ${root}/flux/flux1-schnell and ${root}/flux/shared, then run model-stage check.` };
  }
  if (stage.sdxlStaged && stage.sdxlSmokeProven) {
    return { ...base, staged: true, supported: true, reason: 'SDXL base staged and bounded smoke proof passed.' };
  }
  if (stage.sdxlStaged) {
    return { ...base, staged: true, supported: false, reason: 'SDXL base staged; bounded smoke proof still required.', unlock_requires: 'Run POST /api/actions/sdxl-smoke to prove the staged SDXL base checkpoint.' };
  }
  return { ...base, staged: false, reason: 'SDXL checkpoint missing on BigMac wc2tb.', unlock_requires: `Stage an SDXL checkpoint under ${root}/checkpoints/sdxl, then run model-stage check.` };
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
  const modelStage = summarizeModelStage(readJsonCache(MODEL_STAGE_CACHE), readJsonCache(SDXL_SMOKE_CACHE));
  const modelInventory = summarizeModelInventory(readJsonCache(MODEL_INVENTORY_CACHE));

  // Build models list from cache or fall back to configured model
  let models, vaes;
  if (assets) {
    models = assets.checkpoints.length > 0
      ? assets.checkpoints.map(c => ({ id: c.id, name: c.name || c.filename, filename: c.filename, status: c.status, kind: 'checkpoint', active: c.active || false, size_bytes: c.size_bytes }))
      : [{ id: 'sd15', name: 'SD 1.5 — configured remote model', filename: remoteModel, status: 'available', kind: 'checkpoint', active: true }];
    vaes = [
      { id: 'auto', name: 'Auto (Default)', status: vaeSwitchingSupported ? 'active' : 'limited', reason: vaeSwitchingSupported ? '' : 'Current SDCPP scripts do not expose a VAE switch.' },
      { id: 'none', name: 'None (Built-in)', status: vaeSwitchingSupported ? 'available' : 'limited', reason: vaeSwitchingSupported ? '' : 'VAE switching is not yet proofed/supported.', kind: 'vae' },
      ...assets.vaes.map(v => ({
        id: v.id,
        name: v.name || v.filename,
        filename: v.filename,
        status: vaeSwitchingSupported ? 'available' : 'limited',
        reason: vaeSwitchingSupported ? '' : 'VAE switching is not yet proofed/supported.',
        kind: 'vae'
      }))
    ];
  } else {
    models = [{ id: 'sd15', name: 'SD 1.5 — configured remote model', filename: remoteModel, status: 'available', kind: 'checkpoint', active: true }];
    vaes = [
      { id: 'auto', name: 'Auto (Default)', status: vaeSwitchingSupported ? 'active' : 'limited', reason: vaeSwitchingSupported ? '' : 'Current SDCPP scripts do not expose a VAE switch.' },
      { id: 'none', name: 'None (Built-in)', status: vaeSwitchingSupported ? 'available' : 'limited', reason: vaeSwitchingSupported ? '' : 'VAE switching is not yet proofed/supported.', kind: 'vae' }
    ];
  }

  // img2img / inpaint gates — probe cache informs the reason text.
  // img2imgSupported stays false until a real proof run completes (see pending task).
  const img2imgProbeReason = editCap && editCap.capabilities
    ? (editCap.capabilities.img2img.supported
        ? 'CLI flags confirmed; awaiting proof run before enabling (set img2imgSupported=true in server.js).'
        : editCap.capabilities.img2img.reason)
    : 'Run POST /api/actions/probe-image-edit to check remote support.';
  const img2imgGate = img2imgSupported
    ? { supported: true, route: '/api/actions/img2img' }
    : { supported: false, reason: img2imgProbeReason, unlock_requires: 'Run one img2img proof job via sdcpp-img2img.sh, verify output PNG, then set img2imgSupported=true.' };

  const inpaintProbeReason = editCap && editCap.capabilities
    ? (editCap.capabilities.inpaint.supported
        ? 'Remote CLI flags detected; inpaint workflow script not yet implemented.'
        : editCap.capabilities.inpaint.reason)
    : 'Run POST /api/actions/probe-image-edit to check remote support.';
  const inpaintGate = inpaintSupported
    ? { supported: true, route: '/api/actions/inpaint' }
    : { supported: false, reason: inpaintProbeReason, unlock_requires: 'Requires img2img support first, plus mask-editor UI.' };

  // pillowUpscale — local Pillow resize upscale; script and endpoint exist, validated.
  const pillowUpscaleGate = {
    supported: true,
    route: '/api/actions/upscale',
    reason: 'Local Pillow resize upscale for existing run images. Not Real-ESRGAN; not AI upscale.'
  };

  // realEsrgan — sd-cli --mode upscale on BigMac; direct CLI proof passed (512→2048, M4 Metal, 60s).
  // Gate remains false until endpoint proof run completes.
  const realEsrganGate = realEsrganSupported
    ? { supported: true, route: '/api/actions/upscale-esrgan', caveat: '4× scale per repeat (RealESRGAN_x4plus). Not A1111 Extras parity.' }
    : { supported: false, reason: 'Direct CLI proof passed (512→2048, 60s, M4 Metal). Gate opens after endpoint proof.', unlock_requires: 'Run one upscale-esrgan job, verify output PNG, then set realEsrganSupported=true in server.js.' };

  // upscale — Pillow resize available; Real-ESRGAN implemented separately via realEsrgan gate.
  const upscaleGate = {
    supported: 'partial',
    route: '/api/actions/upscale',
    reason: 'Local Pillow resize upscale available (2x/3x/4x, lanczos/bicubic/bilinear/nearest). Real-ESRGAN available separately — see realEsrgan gate.'
  };

  const hiresGate = {
    supported: true,
    route: '/api/actions/hires-fix',
    reason: 'Two-pass txt2img → local Pillow upscale. NOT full A1111 latent Hires Fix — no denoising second pass.'
  };

  const faceGate = {
    supported: false,
    reason: upscaleCap && upscaleCap.capabilities && upscaleCap.capabilities.faceRestore
      ? upscaleCap.capabilities.faceRestore.reason
      : 'Run POST /api/actions/probe-upscale to detect available tools.',
    unlock_requires: 'Install GFPGAN or CodeFormer on BigMac, then write sdcpp-face-restore.sh.'
  };

  // LoRA / embeddings / hypernetworks: discoverable via asset cache
  const loraGate = loraSupported
    ? { supported: true, route: '/api/actions/generate-single' }
    : (assets && assets.loras && assets.loras.length > 0
        ? { supported: false, reason: `${assets.loras.length} LoRA(s) found on remote — injection bridge not yet implemented.`, unlock_requires: 'Write sdcpp-cli-generate.sh --lora flag support and wire to UI.' }
        : { supported: false, reason: assets ? 'No LoRA files found on remote (run discover-assets to refresh).' : 'No LoRA discovery/injection bridge exists yet.', unlock_requires: 'Stage LoRA .safetensors on BigMac, then run discover-assets.' });
  const embeddingGate = assets && assets.embeddings && assets.embeddings.length > 0
    ? { supported: false, reason: `${assets.embeddings.length} embedding(s) found — injection bridge not yet implemented.` }
    : { supported: false, reason: 'No embeddings discovery path exists yet.' };
  const hypernetGate = assets && assets.hypernetworks && assets.hypernetworks.length > 0
    ? { supported: false, reason: `${assets.hypernetworks.length} hypernetwork(s) found — injection bridge not yet implemented.` }
    : { supported: false, reason: 'No hypernetwork support exists in the current SDCPP scripts.' };

  const cacheAgeMinutes = assets ? Math.round((Date.now() / 1000 - assets.discovered_at) / 60) : null;
  const discoveredTargets = buildDiscoveredTargets(assets);
  const modelTargets = [...CONTROLLED_TARGETS, ...discoveredTargets].map(target => ({
    id: target.id,
    label: target.label,
    status: target.status,
    mode: target.mode,
    caveat: target.caveat,
    route: target.route,
    proofDerived: target.proofDerived,
    fullParityClaim: target.fullParityClaim,
    defaultWidth: target.defaultWidth,
    defaultHeight: target.defaultHeight,
    defaultSteps: target.defaultSteps,
    defaultCfgScale: target.defaultCfgScale,
    defaultSampler: target.defaultSampler,
    maxWidth: target.maxWidth,
    maxHeight: target.maxHeight,
    minSteps: target.minSteps,
    maxSteps: target.maxSteps
  }));

  res.json({
    app: { name: 'SDCPP Workbench', version: 'a1111-workbench-2026-06-22' },
    backend: { type: 'stable-diffusion.cpp workflow bridge', workflowRoot: WORKFLOW_ROOT, runsDir: RUNS_DIR, localTunnelPort: localPort },
    assetCache: { present: !!assets, cacheAgeMinutes, discoveredAt: assets ? assets.discovered_at_iso : null },
    modelStage,
    modelInventory,
    modelTargets,
    models,
    vaes,
    networks: {
      loras: assets ? assets.loras.map(({ full_path: _, ...rest }) => rest) : [],
      embeddings: assets ? assets.embeddings.map(({ full_path: _, ...rest }) => rest) : [],
      hypernetworks: assets ? assets.hypernetworks.map(({ full_path: _, ...rest }) => rest) : []
    },
    samplers: Array.from(ALLOWED_SAMPLERS).map(id => ({ id, name: id.replace(/_/g, ' '), supported: true })),
    schedulers: Array.from(ALLOWED_SCHEDULERS).map(id => {
      const isDiscrete = id === 'discrete';
      const ok = isDiscrete || schedulerSelectionSupported;
      return {
        id,
        name: id.replace(/_/g, ' '),
        supported: ok,
        reason: ok ? '' : 'Verify with a non-default scheduler first.'
      };
    }).concat([
      { id: 'normal', name: 'normal', supported: false, reason: 'Not supported by the remote sd-cli binary.' }
    ]),
    presets: PRESET_DEFAULTS,
    featureGates: {
      txt2img: { supported: true, route: '/api/actions/generate-single' },
      batch: { supported: true, route: '/api/actions/generate-batch' },
      xyzPlot: { supported: true, route: '/api/actions/xyz-plot' },
      schedulerSelection: { supported: schedulerSelectionSupported, reason: schedulerSelectionSupported ? '' : 'Verify with a non-default scheduler first.' },
      vae: { supported: vaeSwitchingSupported, reason: vaeSwitchingSupported ? '' : 'Verify with a custom VAE first.' },
      server: { supported: true },
      gallery: { supported: true },
      metadataReuse: { supported: true, route: '/api/runs/:runId/metadata', caveat: 'Prompt fields redacted when privacy is enabled.' },
      pngInfo: { supported: 'partial', route: '/api/runs/:runId/metadata', caveat: 'Run-image tEXt/iTXt chunks readable via metadata endpoint. Arbitrary PNG upload not supported.' },
      generationSchema: { supported: true, route: '/api/generation-schema' },
      compatibilityMatrix: { supported: true, route: '/api/model-compatibility' },
      commandPreview: { supported: true, route: '/api/preview/generation' },
      jsonPreview: { supported: true, route: '/api/preview/generation' },
      discoverAssets: { supported: true, route: '/api/actions/discover-assets' },
      probeImageEdit: { supported: true, route: '/api/actions/probe-image-edit' },
      probeUpscale: { supported: true, route: '/api/actions/probe-upscale' },
      pillowUpscale: pillowUpscaleGate,
      realEsrgan: realEsrganGate,
      sdxlTurbo: buildModelGate('sdxlTurbo', modelStage),
      flux: buildModelGate('flux', modelStage),
      sdxl: buildModelGate('sdxl', modelStage),
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

app.get('/api/generation-schema', (req, res) => {
  res.json(readSchemaFile(GENERATION_JOB_SCHEMA));
});

app.get('/api/model-compatibility', (req, res) => {
  res.json(readSchemaFile(MODEL_COMPATIBILITY_REGISTRY));
});

async function ollamaRequest(route, body = null, timeoutMs = 90000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const options = { signal: controller.signal };
    if (body) {
      options.method = 'POST';
      options.headers = { 'Content-Type': 'application/json' };
      options.body = JSON.stringify(body);
    }
    const response = await fetch(new URL(route, OLLAMA_BASE_URL), options);
    const text = await response.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (_) { json = { raw: text }; }
    if (!response.ok) {
      const message = json && json.error ? json.error : (json && json.raw ? json.raw : text);
      return { ok: false, status: response.status, error: message || response.statusText };
    }
    return { ok: true, json };
  } catch (err) {
    return { ok: false, status: 502, error: err.name === 'AbortError' ? 'Ollama request timed out' : err.message };
  } finally {
    clearTimeout(timer);
  }
}

async function resolveOllamaModel(requestedModel) {
  const tags = await ollamaRequest('/api/tags', null, 10000);
  if (!tags.ok) return { model: '', error: 'Ollama unreachable' };
  const models = tags.json && Array.isArray(tags.json.models) ? tags.json.models : [];
  const names = models.map(m => m.name);
  const explicit = typeof requestedModel === 'string' ? requestedModel.trim() : '';
  if (explicit) {
    if (!names.includes(explicit)) return { model: '', error: `Model "${explicit}" is not installed. Run: ollama pull ${explicit}` };
    return { model: explicit, error: null };
  }
  if (!names.length) return { model: '', error: 'No Ollama models installed. Run: ollama pull llama3.2' };
  return { model: names[0], error: null };
}

app.get('/api/wildcards', (req, res) => {
  try {
    const files = fs.readdirSync(WILDCARDS_DIR)
      .filter(f => f.endsWith('.txt'))
      .map(f => {
        const name = f.replace(/\.txt$/, '');
        const lines = fs.readFileSync(path.join(WILDCARDS_DIR, f), 'utf8')
          .split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
        return { name, count: lines.length, preview: lines.slice(0, 3) };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    res.json({ wildcards: files });
  } catch {
    res.json({ wildcards: [] });
  }
});

app.get('/api/ollama/status', async (req, res) => {
  const result = await ollamaRequest('/api/tags', null, 10000);
  if (!result.ok) return res.status(result.status).json({ error: result.error, baseUrl: OLLAMA_BASE_URL });
  const models = result.json && Array.isArray(result.json.models) ? result.json.models : [];
  res.json({ baseUrl: OLLAMA_BASE_URL, models: models.map(model => ({ name: model.name, modified_at: model.modified_at, size: model.size })) });
});

app.post('/api/ollama/enhance', async (req, res) => {
  const prompt = typeof req.body.prompt === 'string' ? req.body.prompt.trim() : '';
  if (!prompt) return res.status(400).json({ error: 'Prompt is required' });
  if (prompt.length > 12000) return res.status(400).json({ error: 'Prompt is too long' });
  const { model, error: modelErr } = await resolveOllamaModel(req.body.model);
  if (modelErr) return res.status(503).json({ error: modelErr });
  const instruction = [
    'Enhance this image-generation prompt.',
    'Return only the improved prompt.',
    'Preserve the user intent, subject, style, and any explicit constraints.',
    'Do not add safety commentary, markdown, labels, or explanations.',
    '',
    prompt
  ].join('\n');
  const result = await ollamaRequest('/api/generate', { model, prompt: instruction, stream: false }, 120000);
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  const enhanced = result.json && typeof result.json.response === 'string' ? result.json.response.trim() : '';
  res.json({ model, prompt: enhanced || prompt });
});

app.post('/api/ollama/chat', async (req, res) => {
  const message = typeof req.body.message === 'string' ? req.body.message.trim() : '';
  if (!message) return res.status(400).json({ error: 'Message is required' });
  if (message.length > 12000) return res.status(400).json({ error: 'Message is too long' });
  const { model, error: modelErr } = await resolveOllamaModel(req.body.model);
  if (modelErr) return res.status(503).json({ error: modelErr });
  const result = await ollamaRequest('/api/chat', {
    model,
    stream: false,
    messages: [{ role: 'user', content: message }]
  }, 120000);
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  const reply = result.json && result.json.message && typeof result.json.message.content === 'string'
    ? result.json.message.content.trim()
    : '';
  res.json({ model, reply });
});

app.post('/api/preview/generation', (req, res) => {
  const preview = buildGenerationPreview(req.body || {});
  if (!preview.ok) return res.status(preview.status || 400).json({ error: preview.error });
  res.json(preview);
});

app.post('/api/actions/generate-single', (req, res) => {
  const params = normalizeGenerationBody(req.body || {});
  params.prompt = expandWildcards(params.prompt);
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
  params.prompt = expandWildcards(params.prompt);
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

app.post('/api/actions/generate-controlled', (req, res) => {
  const discoveredTargets = buildDiscoveredTargets(readJsonCache(ASSETS_CACHE));
  const allTargetById = discoveredTargets.length
    ? { ...CONTROLLED_TARGET_BY_ID, ...Object.fromEntries(discoveredTargets.map(t => [t.id, t])) }
    : CONTROLLED_TARGET_BY_ID;

  const params = normalizeControlledGenerationBody(req.body || {});
  params.prompt = expandWildcards(params.prompt);
  const err = validateControlledGenerationParams(params, allTargetById);
  if (err) return res.status(400).json({ error: err });

  const spec = allTargetById[params.target];
  const args = ['--target', params.target, '--prompt', params.prompt];
  // Discovered targets supply a model path; the script's *) catch-all handles them.
  if (spec.modelPath && !CONTROLLED_TARGET_BY_ID[params.target]) {
    args.push('--model-path', spec.modelPath);
  }
  if (params.negative_prompt) args.push('--negative-prompt', params.negative_prompt);
  if (params.width) args.push('--width', String(params.width));
  if (params.height) args.push('--height', String(params.height));
  if (params.steps) args.push('--steps', String(params.steps));
  if (params.cfg_scale !== undefined && params.cfg_scale !== null && params.cfg_scale !== '') {
    args.push('--cfg', String(params.cfg_scale));
  }
  if (params.seed !== undefined && params.seed !== null && params.seed !== '') {
    args.push('--seed', String(params.seed));
  }
  if (params.api && spec.id === 'sd15') args.push('--api', params.api);
  if (params.scheduler) args.push('--scheduler', params.scheduler);
  if (params.vae && params.vae !== 'auto') {
    const vaePath = resolveVaePath(params.vae);
    if (vaePath) args.push('--vae', vaePath);
  }
  args.push('--save-prompts', params.save_prompts ? 'true' : 'false');

  const sensitives = [params.prompt, params.negative_prompt].filter(Boolean);
  const summary = getRedactedCommandSummary('bin/sdcpp-controlled-generate.sh', args, sensitives) + (params.quantity > 1 ? ` (quantity: ${params.quantity})` : '');
  const jobId = createJob('controlled-generate', summary, sanitizeRequestParams({ ...params, target: spec.id }, params.save_prompts));
  jobSensitives[jobId] = sensitives;

  runControlledSequential(jobId, spec, params, params.quantity);

  res.json({
    job_id: jobId,
    status: jobs[jobId].status,
    controlledTarget: spec.id,
    controlledOutputImage: null,
    controlledManifest: null,
    firstFailedGate: null
  });
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

app.get('/api/model-stage', (req, res) => {
  const cache = readJsonCache(MODEL_STAGE_CACHE);
  const smokeCache = {
    ...readJsonCache(SDXL_SMOKE_CACHE),
    ...readJsonCache(SDXL_TURBO_SMOKE_CACHE),
    ...readJsonCache(FLUX_SMOKE_CACHE)
  };
  if (!cache) return res.json({ stale: true, missing: true, summary: summarizeModelStage(null, smokeCache) });
  res.json({ stale: false, missing: false, summary: summarizeModelStage(cache, smokeCache), ...cache });
});

app.post('/api/actions/check-model-stage', (req, res) => {
  const jobId = createJob('check-model-stage', 'bin/sdcpp-model-stage-check.sh');
  runAction(jobId, 'bin/sdcpp-model-stage-check.sh', []);
  res.json({ job_id: jobId, status: jobs[jobId].status });
});

app.post('/api/actions/sdxl-smoke', (req, res) => {
  const jobId = createJob('sdxl-smoke', 'bin/sdcpp-sdxl-smoke.sh');
  runAction(jobId, 'bin/sdcpp-sdxl-smoke.sh', []);
  res.json({ job_id: jobId, status: jobs[jobId].status });
});

app.post('/api/actions/sdxl-turbo-smoke', (req, res) => {
  const jobId = createJob('sdxl-turbo-smoke', 'bin/sdcpp-sdxl-turbo-smoke.sh');
  runAction(jobId, 'bin/sdcpp-sdxl-turbo-smoke.sh', []);
  res.json({ job_id: jobId, status: jobs[jobId].status });
});

app.post('/api/actions/flux-smoke', (req, res) => {
  const jobId = createJob('flux-smoke', 'bin/sdcpp-flux-smoke.sh');
  runAction(jobId, 'bin/sdcpp-flux-smoke.sh', []);
  res.json({ job_id: jobId, status: jobs[jobId].status });
});

app.get('/api/model-inventory', (req, res) => {
  const cache = readJsonCache(MODEL_INVENTORY_CACHE);
  if (!cache) return res.json({ stale: true, missing: true, summary: summarizeModelInventory(null) });
  res.json({ stale: false, missing: false, summary: summarizeModelInventory(cache), ...cache });
});

app.post('/api/actions/inventory-models', (req, res) => {
  const jobId = createJob('inventory-models', 'bin/sdcpp-model-inventory-wc2tb.sh');
  runAction(jobId, 'bin/sdcpp-model-inventory-wc2tb.sh', []);
  res.json({ job_id: jobId, status: jobs[jobId].status });
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

// Hires Fix — two-pass txt2img → local Pillow upscale
app.post('/api/actions/hires-fix', (req, res) => {
  const normalized = normalizeHiresFixBody(req.body || {});
  if (!normalized.ok) return res.status(normalized.status).json({ error: normalized.error });

  const p = normalized.params;
  const summary = `bin/sdcpp-hires-fix.sh --preset ${p.preset} --scale ${p.scale}x ${p.resample}`;
  const jobId = createJob('hires-fix', summary, sanitizeRequestParams(p, normalized.savePrompts));
  const sensitives = normalized.sensitives;
  if (sensitives.length) jobSensitives[jobId] = sensitives;
  runAction(jobId, 'bin/sdcpp-hires-fix.sh', normalized.args, normalized.savePrompts);

  res.json({ job_id: jobId, status: jobs[jobId].status });
});

app.post('/api/validate/hires-fix', (req, res) => {
  const normalized = normalizeHiresFixBody(req.body || {});
  if (!normalized.ok) return res.status(normalized.status).json({ error: normalized.error });
  res.json(hiresFixValidationResponse(normalized));
});

app.post('/api/validate/inpaint', (req, res) => {
  const validated = validateInpaintBody(req.body || {});
  if (!validated.ok) return res.status(validated.status).json({ error: validated.error });
  res.json({
    ok: true,
    run_id: validated.params.run_id,
    init_image_file: validated.params.init_image_file,
    strength: validated.params.strength,
    width: validated.params.width,
    height: validated.params.height,
    steps: validated.params.steps,
    cfg_scale: validated.params.cfg_scale,
    sampler: validated.params.sampler,
    scheduler: validated.params.scheduler,
    seed: validated.params.seed || '',
    vae: validated.params.vae,
    mask_bytes: validated.params.mask_bytes,
    prompt_saved: validated.params.save_prompts === true,
    prompt: validated.params.save_prompts === true ? validated.params.prompt : '[REDACTED]',
    negative_prompt: validated.params.save_prompts === true ? validated.params.negative_prompt : '[REDACTED]'
  });
});

// img2img — gated behind img2imgSupported; init image must be within runs/
app.post('/api/actions/img2img', (req, res) => {
  if (!img2imgSupported) {
    return res.status(409).json({
      error: 'img2img is not currently supported.',
      gate: 'img2img',
      supported: false,
      unlock_requires: 'Run POST /api/actions/probe-image-edit and confirm FLAG_INIT_IMG=yes; set img2imgSupported=true in server.js after a real proof run.'
    });
  }

  const body = req.body || {};

  const runId = typeof body.run_id === 'string' ? body.run_id.trim() : '';
  const initImageFile = typeof body.init_image_file === 'string' ? body.init_image_file.trim() : '';

  if (!runId) return res.status(400).json({ error: 'run_id is required' });
  if (!initImageFile) return res.status(400).json({ error: 'init_image_file is required' });

  if (!/^20\d{6}-\d{6}-[a-zA-Z0-9_-]+$/.test(runId)) {
    return res.status(400).json({ error: 'Invalid run_id format' });
  }
  if (!/^[a-zA-Z0-9_\-.]+$/.test(initImageFile) || initImageFile.includes('..') || initImageFile.includes('/')) {
    return res.status(400).json({ error: 'init_image_file must be a safe filename (no path separators or traversal)' });
  }
  if (!initImageFile.toLowerCase().endsWith('.png')) {
    return res.status(400).json({ error: 'init_image_file must be a .png file' });
  }

  const initImgPath = path.resolve(RUNS_DIR, runId, initImageFile);
  const relCheck = path.relative(RUNS_DIR, initImgPath);
  if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) {
    return res.status(403).json({ error: 'Init image path resolves outside runs directory' });
  }
  if (!fs.existsSync(initImgPath)) {
    return res.status(404).json({ error: `Init image not found: ${runId}/${initImageFile}` });
  }

  const strength = body.strength !== undefined ? Number(body.strength) : 0.75;
  if (!Number.isFinite(strength) || strength < 0.01 || strength > 0.99) {
    return res.status(400).json({ error: 'strength must be a number between 0.01 and 0.99' });
  }

  const params = normalizeGenerationBody(body);
  const genErr = validateGenerationParams(params);
  if (genErr) return res.status(400).json({ error: genErr });

  const args = ['--init-img', initImgPath, '--strength', String(strength), '--prompt', params.prompt];
  if (params.negative_prompt) args.push('--negative', params.negative_prompt);
  if (params.steps) args.push('--steps', String(params.steps));
  if (params.width) args.push('--width', String(params.width));
  if (params.height) args.push('--height', String(params.height));
  if (params.cfg_scale) args.push('--cfg-scale', String(params.cfg_scale));
  if (params.sampler) args.push('--sampler', params.sampler);
  if (params.scheduler) args.push('--scheduler', params.scheduler);
  if (params.seed) args.push('--seed', String(params.seed));
  if (params.vae && params.vae !== 'auto') {
    const vaePath = resolveVaePath(params.vae);
    if (vaePath) args.push('--vae', vaePath);
  }

  const sensitives = [params.prompt, params.negative_prompt].filter(Boolean);
  const summary = getRedactedCommandSummary('bin/sdcpp-img2img.sh', args, sensitives);
  const jobId = createJob('img2img', summary, sanitizeRequestParams(
    { ...params, run_id: runId, init_image_file: initImageFile, strength }, params.save_prompts
  ));
  jobSensitives[jobId] = sensitives;
  runAction(jobId, 'bin/sdcpp-img2img.sh', args, params.save_prompts);

  res.json({ job_id: jobId, status: jobs[jobId].status });
});

// Inpaint — gated behind inpaintSupported; init image and mask must be within workflow dir.
// mask_data must be a base64-encoded PNG data URL; converted to L-mode grayscale and saved to mask-uploads/.
app.post('/api/actions/inpaint', (req, res) => {
  if (!inpaintSupported) {
    return res.status(409).json({
      error: 'Inpaint is not currently supported.',
      gate: 'inpaint',
      supported: false,
      unlock_requires: 'Implement sdcpp-inpaint.sh and set inpaintSupported=true in server.js.'
    });
  }

  const body = req.body || {};

  const runId = typeof body.run_id === 'string' ? body.run_id.trim() : '';
  const initImageFile = typeof body.init_image_file === 'string' ? body.init_image_file.trim() : '';
  const maskData = typeof body.mask_data === 'string' ? body.mask_data : '';

  if (!runId) return res.status(400).json({ error: 'run_id is required' });
  if (!initImageFile) return res.status(400).json({ error: 'init_image_file is required' });
  if (!maskData) return res.status(400).json({ error: 'mask_data is required (base64 PNG data URL)' });

  if (!/^20\d{6}-\d{6}-[a-zA-Z0-9_-]+$/.test(runId)) {
    return res.status(400).json({ error: 'Invalid run_id format' });
  }
  if (!/^[a-zA-Z0-9_\-.]+$/.test(initImageFile) || initImageFile.includes('..') || initImageFile.includes('/')) {
    return res.status(400).json({ error: 'init_image_file must be a safe filename (no path separators or traversal)' });
  }
  if (!initImageFile.toLowerCase().endsWith('.png')) {
    return res.status(400).json({ error: 'init_image_file must be a .png file' });
  }

  const initImgPath = path.resolve(RUNS_DIR, runId, initImageFile);
  const relCheck = path.relative(RUNS_DIR, initImgPath);
  if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) {
    return res.status(403).json({ error: 'Init image path resolves outside runs directory' });
  }
  if (!fs.existsSync(initImgPath)) {
    return res.status(404).json({ error: `Init image not found: ${runId}/${initImageFile}` });
  }

  const strength = body.strength !== undefined ? Number(body.strength) : 0.75;
  if (!Number.isFinite(strength) || strength < 0.01 || strength > 0.99) {
    return res.status(400).json({ error: 'strength must be a number between 0.01 and 0.99' });
  }

  // Decode and save mask
  const maskStripped = maskData.replace(/^data:image\/png;base64,/, '');
  if (maskStripped.length < 50) {
    return res.status(400).json({ error: 'mask_data appears to be empty or invalid' });
  }
  let maskBuf;
  try {
    maskBuf = Buffer.from(maskStripped, 'base64');
    // Verify PNG magic bytes
    if (maskBuf.length < 8 || maskBuf[0] !== 0x89 || maskBuf[1] !== 0x50 || maskBuf[2] !== 0x4e || maskBuf[3] !== 0x47) {
      return res.status(400).json({ error: 'mask_data must be a valid PNG image' });
    }
  } catch (e) {
    return res.status(400).json({ error: 'Failed to decode mask_data: ' + e.message });
  }

  const maskTs = Date.now();
  const maskRawPath = path.join(MASK_UPLOADS_DIR, `mask-${maskTs}-raw.png`);
  const maskPath = path.join(MASK_UPLOADS_DIR, `mask-${maskTs}.png`);
  fs.writeFileSync(maskRawPath, maskBuf);

  // Convert canvas RGBA PNG → grayscale L (white=painted=inpaint, black=transparent=keep).
  // Uses alpha channel — NOT RGB luminance — so erased-white pixels (255,255,255,0) become black.
  // Also detects blank masks (no painted pixels) and rejects early.
  const MASK_PY = [
    'import sys',
    'from PIL import Image',
    'img = Image.open(sys.argv[1]).convert("RGBA")',
    '_, _, _, a = img.split()',
    'mask = a.point([0] + [255]*255)',  // 0→black(keep), 1..255→white(inpaint)
    'if mask.getbbox():',
    '    mask.save(sys.argv[2])',
    '    print("ok")',
    'else:',
    '    print("blank")',
  ].join('\n');

  let maskConvResult = 'ok';
  try {
    maskConvResult = execFileSync('python3', ['-c', MASK_PY, maskRawPath, maskPath],
      { timeout: 15000 }).toString().trim();
    try { fs.unlinkSync(maskRawPath); } catch (_) {}
  } catch (_) {
    // PIL unavailable or image unreadable — fall back to raw RGBA PNG (sd-cli handles RGBA)
    try { fs.renameSync(maskRawPath, maskPath); } catch (_) {}
  }

  if (maskConvResult === 'blank') {
    return res.status(400).json({ error: 'Mask has no painted pixels. Paint over the region to inpaint first.' });
  }

  const params = normalizeGenerationBody(body);
  const genErr = validateGenerationParams(params);
  if (genErr) { try { fs.unlinkSync(maskPath); } catch (_) {} return res.status(400).json({ error: genErr }); }

  const args = [
    '--init-img', initImgPath,
    '--mask', maskPath,
    '--strength', String(strength),
    '--prompt', params.prompt
  ];
  if (params.negative_prompt) args.push('--negative', params.negative_prompt);
  if (params.steps) args.push('--steps', String(params.steps));
  if (params.width) args.push('--width', String(params.width));
  if (params.height) args.push('--height', String(params.height));
  if (params.cfg_scale) args.push('--cfg-scale', String(params.cfg_scale));
  if (params.sampler) args.push('--sampler', params.sampler);
  if (params.scheduler) args.push('--scheduler', params.scheduler);
  if (params.seed) args.push('--seed', String(params.seed));
  if (params.vae && params.vae !== 'auto') {
    const vaePath = resolveVaePath(params.vae);
    if (vaePath) args.push('--vae', vaePath);
  }

  const sensitives = [params.prompt, params.negative_prompt].filter(Boolean);
  const summary = getRedactedCommandSummary('bin/sdcpp-inpaint.sh', args, sensitives);
  const jobId = createJob('inpaint', summary, sanitizeRequestParams(
    { ...params, run_id: runId, init_image_file: initImageFile, strength }, params.save_prompts
  ));
  jobSensitives[jobId] = sensitives;
  runAction(jobId, 'bin/sdcpp-inpaint.sh', args, params.save_prompts);

  res.json({ job_id: jobId, status: jobs[jobId].status });
});

// Real-ESRGAN upscale — gated behind realEsrganSupported; init image must be within runs/
// Model path is never accepted from client; resolved server-side via REMOTE_ESRGAN_MODEL in sdcpp.env.
app.post('/api/actions/upscale-esrgan', (req, res) => {
  if (!realEsrganSupported) {
    return res.status(409).json({
      error: 'Real-ESRGAN upscale is not currently enabled.',
      gate: 'realEsrgan',
      supported: false,
      unlock_requires: 'Verify RealESRGAN_x4plus.pth on BigMac via probe-upscale; run one endpoint proof job; set realEsrganSupported=true in server.js.'
    });
  }

  const body = req.body || {};
  const runId = typeof body.run_id === 'string' ? body.run_id.trim() : '';
  const initImageFile = typeof body.init_image_file === 'string' ? body.init_image_file.trim() : '';

  if (!runId) return res.status(400).json({ error: 'run_id is required' });
  if (!initImageFile) return res.status(400).json({ error: 'init_image_file is required' });

  if (!/^20\d{6}-\d{6}-[a-zA-Z0-9_-]+$/.test(runId)) {
    return res.status(400).json({ error: 'Invalid run_id format' });
  }
  if (!/^[a-zA-Z0-9_\-.]+$/.test(initImageFile) || initImageFile.includes('..') || initImageFile.includes('/')) {
    return res.status(400).json({ error: 'init_image_file must be a safe filename (no path separators or traversal)' });
  }
  if (!initImageFile.toLowerCase().endsWith('.png')) {
    return res.status(400).json({ error: 'init_image_file must be a .png file' });
  }

  const initImgPath = path.resolve(RUNS_DIR, runId, initImageFile);
  const relCheck = path.relative(RUNS_DIR, initImgPath);
  if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) {
    return res.status(403).json({ error: 'Init image path resolves outside runs directory' });
  }
  if (!fs.existsSync(initImgPath)) {
    return res.status(404).json({ error: `Init image not found: ${runId}/${initImageFile}` });
  }

  const tileSize = body.tile_size !== undefined ? parseInt(body.tile_size, 10) : 128;
  if (!Number.isInteger(tileSize) || tileSize < 32 || tileSize > 512) {
    return res.status(400).json({ error: 'tile_size must be an integer between 32 and 512' });
  }

  const repeats = body.repeats !== undefined ? parseInt(body.repeats, 10) : 1;
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > 4) {
    return res.status(400).json({ error: 'repeats must be an integer between 1 and 4' });
  }

  const args = ['--init-img', initImgPath, '--tile-size', String(tileSize), '--repeats', String(repeats)];
  const summary = `bin/sdcpp-esrgan-upscale.sh --init-img ${runId}/${initImageFile} --tile-size ${tileSize} --repeats ${repeats}`;
  const jobId = createJob('upscale-esrgan', summary, { run_id: runId, init_image_file: initImageFile, tile_size: tileSize, repeats });
  runAction(jobId, 'bin/sdcpp-esrgan-upscale.sh', args);

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
    progress: job.progress || null,
    createdAt: job.createdAt,
    completedAt: job.completedAt,
    exitCode: job.exitCode,
    firstFailedGate: job.firstFailedGate,
    runId: job.runId,
    upscaledImage: job.upscaledImage || null,
    upscaleManifest: job.upscaleManifest || null,
    controlledTarget: job.controlledTarget || null,
    controlledOutputImage: job.controlledOutputImage || null,
    controlledManifest: job.controlledManifest || null,
    hiresRunId: job.hiresRunId || null,
    hiresBaseImage: job.hiresBaseImage || null,
    hiresFinalImage: job.hiresFinalImage || null,
    hiresManifest: job.hiresManifest || null
  });
});
app.get('/api/jobs/:jobId/log', (req, res) => {
  const job = jobs[req.params.jobId];
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json({ id: job.id, stdout: job.stdout, stderr: job.stderr });
});

app.get('/api/version', (req, res) => {
  res.json(getBuildInfo());
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
  const manifestCandidates = [
    metadata.manifest_json, 'controlled-manifest.json', 'batch-manifest.json',
    'xyz-manifest.json', 'upscale-manifest.json', 'hires-fix-manifest.json',
    'sdxl-smoke-manifest.json', 'sdxl-turbo-smoke-manifest.json', 'flux-smoke-manifest.json'
  ].filter(Boolean);
  let manifest = null;
  for (const file of manifestCandidates) {
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

// ---- Replay object for "Reuse in Create" -----------------------------------------
const REPLAY_TARGET_ALLOWLIST = new Set(['sd15', 'sdxl-base', 'sdxl-turbo', 'flux-fp8', 'sdxl-photonic', 'sdxl-homochi', 'sdxl-pony', 'sd15-homofidelis']);

function buildReplayObject(runType, manifests) {
  if (!runType || !runType.startsWith('controlled-')) return { available: false };
  const cm = manifests.controlled;
  if (!cm) return { available: false };
  const target = cm.controlledTarget;
  if (!target || !REPLAY_TARGET_ALLOWLIST.has(target)) return { available: false };
  const width = Number.isInteger(cm.width) && cm.width > 0 ? cm.width : null;
  const height = Number.isInteger(cm.height) && cm.height > 0 ? cm.height : null;
  const steps = Number.isInteger(cm.steps) && cm.steps > 0 ? cm.steps : null;
  const cfgScale = typeof cm.cfg_scale === 'number' && isFinite(cm.cfg_scale) ? cm.cfg_scale : null;
  if (!width || !height || !steps || cfgScale == null) return { available: false };
  let seed = null;
  if (cm.seed_label) {
    const m = cm.seed_label.match(/^(\d+)/);
    if (m) seed = parseInt(m[1], 10);
  }
  const promptRedacted = cm.prompt_redacted === true || cm.prompt === '[REDACTED]' || !cm.prompt;
  const promptVal = !promptRedacted && cm.prompt && cm.prompt !== '[REDACTED]' ? cm.prompt : null;
  const negVal = !promptRedacted && cm.negative_prompt && cm.negative_prompt !== '[REDACTED]' ? cm.negative_prompt : null;
  return {
    available: true,
    target,
    width,
    height,
    steps,
    cfg_scale: cfgScale,
    seed,
    prompt_saved: !promptRedacted,
    prompt: promptVal,
    negative_prompt: negVal,
    privacy_note: promptRedacted ? 'Prompt was redacted for this run. Enter a new prompt to reuse these settings.' : null,
    flux_caveat: target === 'flux-fp8' ? 'Flux replay uses the runtime-proven fp8 path only.' : null
  };
}

// Phase 2 — rich run metadata (local read, no SSH)
app.get('/api/runs/:runId/metadata', (req, res) => {
  const runId = req.params.runId;
  if (!safeRunId(runId)) return res.status(400).json({ error: 'Invalid runId' });
  const runPath = path.join(RUNS_DIR, runId);
  if (!fs.existsSync(runPath)) return res.status(404).json({ error: 'Run not found' });

  const runCard = parseUiRunCard(path.join(runPath, 'ui-run-card.md'));
  const files = listRunFiles(runPath);
  const images = files.filter(f => f.toLowerCase().endsWith('.png'));

  // Load all known manifest types
  const MANIFEST_LOOKUP = [
    ['controlled', ['controlled-manifest.json', 'controlled-generation-manifest.json']],
    ['hires_fix', ['hires-fix-manifest.json']],
    ['upscale', ['upscale-manifest.json']],
    ['batch', ['batch-manifest.json']],
    ['xyz', ['xyz-manifest.json']],
    ['smoke_sdxl', ['sdxl-smoke-manifest.json']],
    ['smoke_sdxl_turbo', ['sdxl-turbo-smoke-manifest.json']],
    ['smoke_flux', ['flux-smoke-manifest.json']]
  ];
  const manifests = {};
  for (const [key, candidates] of MANIFEST_LOOKUP) {
    for (const filename of candidates) {
      const p = path.join(runPath, filename);
      if (fs.existsSync(p)) {
        try { manifests[key] = JSON.parse(fs.readFileSync(p, 'utf8')); break; } catch (_) {}
      }
    }
  }
  // Primary manifest for backward compat — prefer controlled, then others
  const manifest = manifests.controlled || manifests.hires_fix || manifests.upscale ||
                   manifests.batch || manifests.xyz ||
                   manifests.smoke_sdxl || manifests.smoke_sdxl_turbo || manifests.smoke_flux || null;

  // first_failed_gate — from controlled manifest, then run card
  const firstFailedGate =
    (manifests.controlled && manifests.controlled.first_failed_gate != null ? manifests.controlled.first_failed_gate : undefined) ??
    (runCard.first_failed_gate || null);

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

  // Derive filter category and controlled target label
  // Prefer run_type from run card; fall back to directory-name inference so
  // incomplete/UNKNOWN runs (no ui-run-card.md) are consistent with run-index.
  const runType = runCard.run_type || inferRunType(path.basename(runPath))[0] || null;
  const filterCategory = runTypeFilterCategory(runType);
  const CONTROLLED_TARGET_LABELS = {
    'controlled-sd15': 'SD1.5',
    'controlled-sdxl-base': 'SDXL base',
    'controlled-sdxl-turbo': 'SDXL Turbo',
    'controlled-flux-fp8': 'Flux fp8'
  };
  const controlledTargetLabel = CONTROLLED_TARGET_LABELS[runType] ||
    (manifests.controlled && manifests.controlled.controlledTargetLabel) || null;
  const controlledTargetCaveat = (manifests.controlled && manifests.controlled.controlledTargetCaveat) || null;
  const promptPrivate = manifests.controlled
    ? manifests.controlled.prompt_redacted === true
    : (runCard.prompt === '[REDACTED]' || !runCard.prompt);
  const replay = buildReplayObject(runType, manifests);

  res.json({
    run_id: runId,
    run_dir: runPath,
    run_type: runType,
    status: runCard.status || 'UNKNOWN',
    created_at: runCard.created_at || null,
    run_card: runCard,
    manifests,
    manifest,
    run_meta: runMeta,
    png_info: pngInfo,
    metrics: metricsRows,
    files,
    images,
    primary_image: runCard.primary_image || images[0] || null,
    first_failed_gate: firstFailedGate,
    filter_category: filterCategory,
    controlled_target_label: controlledTargetLabel,
    controlled_target_caveat: controlledTargetCaveat,
    prompt_private: promptPrivate,
    replay,
    retrieved_at: new Date().toISOString()
  });
});
// Run index — fast paginated listing with upscale status; no raw prompts from redacted runs
const RUN_INDEX_MAX = 500;
const RUN_INDEX_TTL_MS = 8000;
const RUN_INDEX_DEFAULT_LIMIT = 50;
const RUN_INDEX_MAX_LIMIT = 200;
const ALLOWED_INDEX_FILTERS = new Set([
  'all', 'controlled', 'controlled-sd15', 'controlled-sdxl-base', 'controlled-sdxl-turbo',
  'controlled-flux-fp8', 'hires-fix', 'upscale', 'smoke', 'failed'
]);
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
        if (e.isFile() && (e.name === 'batch-manifest.json' || e.name === 'xyz-manifest.json' || e.name === 'upscale-manifest.json' || e.name === 'hires-fix-manifest.json')) hasManifest = true;
        if (e.isFile() && e.name === 'run-metadata.json') hasMetadata = true;
        // Hires Fix stores images in base/ and upscaled/ subdirs — count one level deep
        if (e.isDirectory() && (e.name === 'base' || e.name === 'upscaled')) {
          try {
            const subEntries = fs.readdirSync(path.join(runPath, e.name), { withFileTypes: true });
            for (const se of subEntries) {
              if (se.isFile() && /\.(png|PNG)$/.test(se.name)) imageCount++;
            }
          } catch (_) {}
        }
      }
    } catch (_) {}
    const CONTROLLED_TARGET_LABELS_IDX = {
      'controlled-sd15': 'SD1.5',
      'controlled-sdxl-base': 'SDXL base',
      'controlled-sdxl-turbo': 'SDXL Turbo',
      'controlled-flux-fp8': 'Flux fp8'
    };
    const filterCategory = runTypeFilterCategory(runType);
    const controlledTargetLabel = CONTROLLED_TARGET_LABELS_IDX[runType] || null;
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
      filterCategory,
      controlledTargetLabel,
      createdAt: dirName.slice(0, 15)
    };
  });
}

app.get('/api/run-index', (req, res) => {
  // Validate filter first
  const filter = req.query.filter || 'all';
  if (!ALLOWED_INDEX_FILTERS.has(filter)) {
    return res.status(400).json({ error: `Unknown filter '${filter}'. Allowed: ${[...ALLOWED_INDEX_FILTERS].join(', ')}` });
  }

  // Parse and clamp limit / offset
  const rawLimit = parseInt(req.query.limit, 10);
  const limit = (Number.isInteger(rawLimit) && rawLimit > 0) ? Math.min(rawLimit, RUN_INDEX_MAX_LIMIT) : RUN_INDEX_DEFAULT_LIMIT;
  const rawOffset = parseInt(req.query.offset, 10);
  const offset = (Number.isInteger(rawOffset) && rawOffset >= 0) ? rawOffset : 0;

  // Rebuild cache if stale
  const now = Date.now();
  if (!runIndexCache || now - runIndexCacheAt > RUN_INDEX_TTL_MS) {
    runIndexCache = buildRunIndex();
    runIndexCacheAt = now;
  }

  // Apply server-side filter
  let filtered = runIndexCache;
  if (filter !== 'all') {
    filtered = runIndexCache.filter(r => {
      if (filter === 'failed') return r.status === 'FAIL';
      if (filter === 'controlled') return r.filterCategory === 'controlled';
      if (filter === 'smoke') return r.filterCategory === 'smoke';
      if (filter === 'hires-fix') return r.filterCategory === 'hires-fix';
      if (filter === 'upscale') return r.filterCategory === 'upscale';
      if (filter === 'img2img') return r.filterCategory === 'img2img';
      if (filter === 'inpaint') return r.filterCategory === 'inpaint';
      // specific controlled target types
      return r.type === filter;
    });
  }

  const total = filtered.length;
  const items = filtered.slice(offset, offset + limit);
  const nextOffset = offset + items.length;
  const hasMore = nextOffset < total;

  res.json({ items, total, limit, offset, nextOffset, hasMore, cachedAt: new Date(runIndexCacheAt).toISOString() });
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
  const build = getBuildInfo();
  console.log(`SDCPP Workbench listening on ${build.bind} (${build.version}, HEAD ${build.gitHead}, pid ${build.pid})`);
});
