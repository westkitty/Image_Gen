const express = require('express');
const { spawn, execFile, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { controlledScriptFor, buildControlledArgs, nativeBatchEligible } = require('./controlled-args');
const W = require('./workstation');
const EC = require('./public/dexdiffusion/edit-core.js');
const M = require('./media');
const { createMediaBridge, KOKORO_VOICES } = require('./media-bridge');
const { createImageStore } = require('./image-store');
const { validateImage } = require('./image-validation');
const { artifactReceipt, TERMINAL } = require('./job-contract');
const { createWorldStore } = require('./world-project');
const { createWorldBridge } = require('./world-bridge');
const { createAsset3dBridge } = require('./asset3d-bridge');
const { createSystemInfo } = require('./system-info');
const { createEvidenceStore, targetModelMap, probeAssets, targetRuntime, targetVerification } = require('./capabilities');
const { rulesForTarget, validateDimensions } = require('./dimension-policy');
const { enhancePrompt: runPromptEnhance, extractProtectedLiterals } = require('./prompt-enhancement');
const { PROFILES, resolvePromptProfile } = require('./prompt-profiles');
const { getWildcardCatalog, expandWildcards: expandWildcardsUtil } = require('./wildcards');
const { buildLoraCards, buildVaeCards, buildEmbeddingState, serializeActiveLoras, parseLorasFromPrompt, inferAssetFamily } = require('./extra-networks');
const { MODEL_CARDS, getModelCards, getModelCardById, checkModelSwitchWarnings } = require('./model-registry');
const { isVisionDetailerAvailable, detectRegions, getDefaultDetailerPrompt, ATTEMPT_TIMEOUT_MS } = require('./detailer');
const { createEventBus } = require('./event-bus');
const { projectOperationalJob } = require('./operational-jobs');
const { createTimingStore } = require('./timing-store');
const { createCollectionStore } = require('./collections-store');
const { createRecipeStore } = require('./recipes-store');
const { createMacroStore } = require('./macro-store');
const { exportReproBundle, validateReproBundle, checkBundleCompatibility } = require('./repro-bundle');
const { createThumbnailService } = require('./thumbnail-service');
const { createCancellationManager } = require('./cancellation');
const { createLibraryIndex } = require('./library-index');

const app = express();
const PORT = Number(process.env.OPERATOR_CONSOLE_PORT || 31337);
const HOST = '127.0.0.1';
const APP_VERSION = 'image-gen-console-2026-06-22-render-wrapper';

const WORKFLOW_ROOT = path.resolve(__dirname, '../sdcpp-workflow');
const RUNS_DIR = path.join(WORKFLOW_ROOT, 'runs');
const imageStore = createImageStore();
imageStore.ensureRoot();
const CONFIG_DIR = path.join(WORKFLOW_ROOT, 'config');
const STATE_DIR = path.join(WORKFLOW_ROOT, 'state');
const ASSETS_CACHE = path.join(STATE_DIR, 'assets-cache.json');
// Lineage + Keepers, keyed by canonical image id (metadata only, never prompts).
const imageMeta = W.createImageMetaStore(path.join(STATE_DIR, 'image-meta.json'));
// Media-neutral core (media.js): durable generic jobs, heavy-compute lease,
// worker registry, non-image media store and secure temporary staging.
const jobStore = M.createJobStore(path.join(STATE_DIR, 'jobs.json'));
const mediaStore = M.createMediaStore({ registryFile: path.join(STATE_DIR, 'media-artifacts.json') });
try { mediaStore.ensureRoots(); } catch (_) {}
const worldStore = createWorldStore({ root: path.join(STATE_DIR, 'world-projects') });
const staging = M.createStaging({ root: path.join(STATE_DIR, 'staging') });
setInterval(() => { try { staging.sweep(); } catch (_) {} }, 30 * 60 * 1000).unref();

// V12 Workstation Services
const eventBus = createEventBus();
const timingStore = createTimingStore(path.join(STATE_DIR, 'timing-stats.json'));
const collectionStore = createCollectionStore(path.join(STATE_DIR, 'collections.json'));
const recipeStore = createRecipeStore(path.join(STATE_DIR, 'recipes.json'));
const macroStore = createMacroStore(path.join(STATE_DIR, 'macros.json'));
const thumbnailService = createThumbnailService({ cacheDir: path.join(STATE_DIR, 'thumbnails'), imageStore });
const libraryIndex = createLibraryIndex({ indexPath: path.join(STATE_DIR, 'library-index.json'), imageStore, imageMeta, runsDir: RUNS_DIR });
const HEAVY_ACTIONS = new Set(['controlled-generate', 'img2img', 'inpaint', 'outpaint', 'upscale-esrgan', 'hires-fix', 'xyz-plot', 'batch-generate', 'cli-generate', 'server-generate', 'seed-test']);
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
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || process.env.OLLAMA_HOST || 'http://127.0.0.1:11436';
const JOB_TIMEOUT_MS = Math.max(60000, Number(process.env.SDCPP_JOB_TIMEOUT_MS || 12 * 60 * 1000));

let schedulerSelectionSupported = true;
let vaeSwitchingSupported = true;
let loraSupported = true;
let img2imgSupported = true; // proven: sdcpp-img2img.sh proof run 20260623-001649-img2img, sha256 match
let realEsrganSupported = true; // proven: endpoint proof run 20260623-005030-esrgan-upscale, 512→2048, 60.82s, sha256 f28e339f…, 0 text chunks
let inpaintSupported = true; // enabled: sdcpp-inpaint.sh implemented 2026-06-23

const MASK_UPLOADS_DIR = path.join(WORKFLOW_ROOT, 'mask-uploads');
const FULL_MASK_COVERAGE = 0.98; // painted fraction treated as "entire image masked"
const LARGE_REQUEST_IMAGES = 12; // preflight asks for explicit confirmation above this
if (!fs.existsSync(MASK_UPLOADS_DIR)) fs.mkdirSync(MASK_UPLOADS_DIR, { recursive: true });

app.use(express.json({ limit: '5mb' }));
app.get('/', (req, res) => {
  res.redirect(302, '/dexdiffusion/');
});
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
const CONTROLLED_TARGET_IDS = new Set(['sd15', 'sdxl-base', 'sdxl-turbo', 'flux-fp8', 'flux2-klein-4b', 'sdxl-photonic', 'sdxl-homochi', 'sdxl-pony', 'sd15-homofidelis', 'sdxl-juggernaut', 'sdxl-realvisxl', 'sdxl-cyberrealistic', 'sdxl-epicrealism', 'sdxl-biglust', 'sdxl-lustify', 'sdxl-biglove', 'sdxl-biglove-photo1', 'sdxl-biglove-photo45']);
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
    label: 'SDXL base 1.0',
    status: 'supported',
    mode: 'controlled generation',
    route: '/api/actions/generate-controlled',
    caveat: 'stabilityai/stable-diffusion-xl-base-1.0 (CreativeML OpenRAIL++-M) via stable-diffusion.cpp on Metal; embedded VAE. Native 1024x1024. Not full A1111 parity.',
    proofDerived: false,
    fullParityClaim: false,
    modelFile: 'sd_xl_base_1.0.safetensors',
    defaultWidth: 1024,
    defaultHeight: 1024,
    defaultSteps: 20,
    defaultCfgScale: 7,
    defaultSampler: 'euler_a',
    maxWidth: 1536,
    maxHeight: 1536,
    minSteps: 1,
    maxSteps: 50
  },
  {
    id: 'sdxl-turbo',
    label: 'SDXL Turbo',
    status: 'supported',
    mode: 'controlled generation',
    route: '/api/actions/generate-controlled',
    caveat: 'stabilityai/sdxl-turbo (non-commercial research licence) via stable-diffusion.cpp. Distilled: 1-4 steps, CFG fixed at 1 (no negative prompt), native 512x512.',
    proofDerived: false,
    fullParityClaim: false,
    modelFile: 'sd_xl_turbo_1.0_fp16.safetensors',
    defaultWidth: 512,
    defaultHeight: 512,
    defaultSteps: 4,
    defaultCfgScale: 1,
    fixedCfgScale: 1,
    noNegativePrompt: true,
    defaultSampler: 'euler_a',
    maxWidth: 1024,
    maxHeight: 1024,
    minSteps: 1,
    maxSteps: 4
  },
  {
    id: 'flux-fp8',
    label: 'FLUX.1 Schnell FP8 (Q8_0 runtime)',
    status: 'proofed',
    mode: 'proofed controlled generation',
    route: '/api/actions/generate-controlled',
    caveat: 'Supports a curated set of generation parameters — not all Automatic1111 options are available. Uses the exact installed FLUX.1 Schnell FP8 full checkpoint; individual live proof is required. The backend uses Q8_0 runtime weights to fit the FP8 source on the 32 GB Big Mac.',
    proofDerived: true,
    fullParityClaim: false,
    modelFile: 'flux1-schnell-fp8.safetensors',
    noNegativePrompt: true,
    fixedCfgScale: 1,
    defaultWidth: 512,
    defaultHeight: 512,
    defaultSteps: 4,
    defaultCfgScale: 1,
    defaultSampler: 'euler',
    maxWidth: 1024,
    maxHeight: 1024,
    minSteps: 1,
    maxSteps: 8
  },
  {
    id: 'flux2-klein-4b',
    label: 'FLUX.2 Klein 4B (MFLUX)',
    status: 'proofed',
    mode: 'MLX-native remote generation',
    backend: 'mflux',
    primary: true,
    route: '/api/actions/generate-controlled',
    caveat: 'MFLUX/MLX path on Big Mac. Distilled FLUX.2 uses guidance 1.0 and does not support negative prompts; not A1111 parity.',
    proofDerived: true,
    fullParityClaim: false,
    defaultWidth: 1024,
    defaultHeight: 1024,
    defaultSteps: 4,
    defaultCfgScale: 1,
    defaultSampler: 'euler',
    maxWidth: 2048,
    maxHeight: 2048,
    minSteps: 1,
    maxSteps: 8
  },
  {
    id: 'sdxl-photonic',
    label: 'Photonic Fusion SDXL',
    status: 'staged',
    mode: 'migrated controlled generation',
    route: '/api/actions/generate-controlled',
    caveat: 'Civitai 683210 v1449179 (Finale, SDXL 1.0 fp16) on wc2tb; uses the checkpoint\'s embedded VAE. Author settings: 30-40 steps, CFG 5-6.5, Karras, 768x1024; clip-skip 2 (Pony merge; Pony score tags work). Not full A1111 parity.',
    modelFile: 'photonic_fusion_sdxl_finale_v1.safetensors',
    defaultWidth: 768,
    defaultHeight: 1024,
    defaultSteps: 30,
    defaultCfgScale: 6,
    defaultSampler: 'dpm++2m',
    defaultScheduler: 'karras',
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
    caveat: 'Migrated wc2tb SDXL checkpoint; individual runtime status is derived from completed jobs. Not full A1111 parity.',
    modelFile: 'homochiXLMaleFocused_20.safetensors',
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
    caveat: 'Migrated wc2tb SDXL checkpoint; individual runtime status is derived from completed jobs. Not full A1111 parity.',
    modelFile: 'ponyDiffusionV6XL_v6StartWithThisOne.safetensors',
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
    caveat: 'Migrated wc2tb SD1.5 checkpoint; individual runtime status is derived from completed jobs. Not full A1111 parity.',
    modelFile: 'homofidelis_v50.safetensors',
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
    label: 'Juggernaut XL Ragnarok',
    status: 'staged',
    mode: 'migrated controlled generation',
    route: '/api/actions/generate-controlled',
    caveat: 'SDXL Checkpoint (~6-7GB fp16). Excellent photorealism with strong male anatomy, versatile for athletic/muscular men and NSFW; widely praised for realistic bodies in gay male workflows. (Civitai search Juggernaut XL). Not full A1111 parity.',
    modelFile: 'juggernautXL_ragnarok.safetensors',
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
    label: 'RealVisXL V5.0 (BakedVAE, FP16)',
    status: 'staged',
    mode: 'migrated controlled generation',
    route: '/api/actions/generate-controlled',
    caveat: 'SDXL Checkpoint. High photoreal quality, detailed realistic male bodies/skin, good for intimate homoerotic scenes with natural lighting and anatomy. (Search Civitai RealVisXL V5). Not full A1111 parity.',
    modelFile: 'realvisxlV50_v50Bakedvae_full_fp16.safetensors',
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
    label: 'CyberRealistic XL V10',
    status: 'staged',
    mode: 'migrated controlled generation',
    route: '/api/actions/generate-controlled',
    caveat: 'SDXL Checkpoint. Strong photoreal skin textures, musculature, and realistic male forms; effective for detailed adult male NSFW. (Search Civitai CyberRealistic XL). Not full A1111 parity.',
    modelFile: 'cyberrealisticXL_v100_pruned_fp16.safetensors',
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
    label: 'epiCRealism XL Pure_fix',
    status: 'staged',
    mode: 'migrated controlled generation',
    route: '/api/actions/generate-controlled',
    caveat: 'SDXL Checkpoint (https://civitai.com/models/277058/epicrealism-xl or latest). Top photoreal benchmark with excellent anatomy adherence; pairs extremely well with male prompts/LoRAs for homoerotic realism. Not full A1111 parity.',
    modelFile: 'epicrealismXL_pureFix.safetensors',
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
    modelFile: 'bigLust_v16.safetensors',
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
    label: 'LUSTIFY! APEX V8',
    status: 'staged',
    mode: 'migrated controlled generation',
    route: '/api/actions/generate-controlled',
    caveat: 'SDXL Checkpoint. Photoreal NSFW merge with excellent male anatomy, skin details, and homoerotic capability (LUSTIFY series). Not full A1111 parity.',
    modelFile: 'lustifyNSFWCheckpoint_apexV8.safetensors',
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
    label: 'Big Love Photo6',
    status: 'staged',
    mode: 'migrated controlled generation',
    route: '/api/actions/generate-controlled',
    caveat: 'SDXL Checkpoint. Photoreal male-leaning with NSFW focus (BigLove XL / Lustify hybrid). Not full A1111 parity.',
    modelFile: 'bigLove_photo6.safetensors',
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
// These installed, pinned variants are distinct models, never aliases of Photo6.
for (const [id, version, filename] of [
  ['sdxl-biglove-photo1', 'Photo1', 'bigLove_photo1.safetensors'],
  ['sdxl-biglove-photo45', 'Photo4.5', 'bigLove_photo45.safetensors'],
]) {
  CONTROLLED_TARGETS.push({ ...CONTROLLED_TARGETS.find(t => t.id === 'sdxl-biglove'),
    id, label: 'Big Love ' + version, modelFile: filename,
    caveat: 'Exact installed Big Love ' + version + ' checkpoint; embedded VAE. Individual runtime proof is required.' });
}
CONTROLLED_TARGETS.push({ ...CONTROLLED_TARGETS.find(t => t.id === 'sd15'),
  id: 'sd15-auto-v1-5-pruned-emaonly', label: 'Stable Diffusion 1.5 (same-checkpoint alias)',
  aliasOf: 'sd15', modelFile: 'v1-5-pruned-emaonly.safetensors',
  modelPath: '/Volumes/wc2tb/ImageGen/checkpoints/sd15/v1-5-pruned-emaonly.safetensors',
  caveat: 'Alias of sd15 using the exact same canonical checkpoint; no duplicate weights.' });
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
      modelPath: filename === 'v1-5-pruned-emaonly.safetensors' ? '/Volumes/wc2tb/ImageGen/checkpoints/sd15/v1-5-pruned-emaonly.safetensors' : fullPath,
      aliasOf: filename === 'v1-5-pruned-emaonly.safetensors' ? 'sd15' : undefined,
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
  return expandWildcardsUtil(prompt, { maxDepth, wildcardsDir: WILDCARDS_DIR });
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
// Structured resources (LoRAs) are the source of truth in requests; they are
// serialized to <lora:name:weight> prompt tags only here at the backend boundary.
function validateStructuredLoras(loras) {
  if (loras === undefined || loras === null) return null;
  if (!Array.isArray(loras) || loras.length > 8) return 'loras must be an array of at most 8 entries';
  for (const l of loras) {
    if (!l || typeof l.name !== 'string' || !/^[A-Za-z0-9._ -]{1,120}$/.test(l.name)) return 'Invalid LoRA name';
    if (l.weight !== undefined && l.weight !== null && !Number.isFinite(Number(l.weight))) return 'Invalid LoRA weight';
  }
  return null;
}
// Edit routes: rewrite body.prompt to include serialized LoRA tags and keep the
// structured list on body.__loras (server-owned; any client value is overwritten).
function resolveEditResources(body) {
  const err = validateStructuredLoras(body.loras);
  if (err) return err;
  const rr = EC.resolveResources({ prompt: typeof body.prompt === 'string' ? body.prompt : '', loras: body.loras });
  if (typeof body.prompt === 'string') body.prompt = rr.backendPrompt;
  body.__loras = rr.loras;
  delete body.loras;
  return null;
}
// Effective generation record kept per canonical output (privacy-gated text).
function editGenRecord(body, params, extra = {}) {
  const save = !!params.save_prompts;
  const active = assetCache && assetCache.activeSecondaryModel || null;
  return {
    gen_schema: 1,
    loras: body.__loras || [],
    sampler: EC.canonicalSampler(params.sampler),
    vae: params.vae || 'auto',
    scheduler: params.scheduler,
    cfg: params.cfg_scale !== '' && params.cfg_scale != null ? Number(params.cfg_scale) : undefined,
    steps: params.steps !== '' && params.steps != null ? Number(params.steps) : undefined,
    edit_target: active,
    prompt_saved: save,
    prompt: save ? EC.stripLoraTags(params.prompt) : undefined,
    negative_prompt: save ? params.negative_prompt : undefined,
    ...extra,
  };
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

// Central output authority: after any generation job, move every generated
// image out of the run dirs it touched into the canonical image root, and
// point the job's image fields at the canonical files.
const JOB_IMAGE_FIELDS = ['controlledOutputImage', 'hiresBaseImage', 'hiresFinalImage', 'upscaledImage'];
function resolveRunImageForRead(runId, rel) {
  const hit = imageStore.resolveRunImage(path.join(RUNS_DIR, runId), rel);
  return hit ? hit.path : null;
}
// Script-reported image path -> canonical image record (after finalizeRun).
// Scripts report absolute paths, workflow-relative ("runs/<id>/…") or
// runs-relative ("<id>/…", e.g. HIRES_FINAL_IMAGE) paths.
function canonicalForReportedPath(value) {
  if (!value) return null;
  if (path.dirname(path.resolve(value)) === imageStore.root) return imageStore.resolveImage(path.basename(value));
  const abs = path.isAbsolute(value) ? value
    : (/^20\d{6}-\d{6}-/.test(value) ? path.resolve(RUNS_DIR, value) : path.resolve(WORKFLOW_ROOT, value));
  const rel = path.relative(RUNS_DIR, abs);
  const [runId, ...rest] = rel.split(path.sep);
  if (runId && rest.length && !rel.startsWith('..')) return imageStore.resolveRunImage(path.join(RUNS_DIR, runId), rest.join('/'));
  return null;
}

// PNG width/height from the IHDR chunk (no decoding).
function pngSize(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const b = Buffer.alloc(24);
    if (fs.readSync(fd, b, 0, 24, 0) < 24 || b.toString('latin1', 12, 16) !== 'IHDR') return null;
    return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  } catch (_) { return null; } finally { if (fd !== undefined) fs.closeSync(fd); }
}

// canonical image id -> { runId, runFile } from the run dirs' canonical-images.json.
let imageSourceCache = { at: 0, map: new Map() };
function imageSourceMap() {
  if (Date.now() - imageSourceCache.at < 5000) return imageSourceCache.map;
  const map = new Map();
  try {
    for (const d of fs.readdirSync(RUNS_DIR, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      for (const e of imageStore.readRunIndex(path.join(RUNS_DIR, d.name))) map.set(e.image_id, { runId: d.name, runFile: e.run_file });
    }
  } catch (_) {}
  imageSourceCache = { at: Date.now(), map };
  return map;
}

// Accept a canonical image id as an edit source (the UI never handles run ids).
// Rewrites body.run_id/init_image_file for the existing validated handlers and
// returns the source image id for lineage.
// Imported (staged) image -> temporary PNG working copy in mask-uploads/ (the
// edit scripts accept that area). Never enters images_made.
function stagedToWorkingPng(stagedId) {
  const st = staging.get(stagedId);
  if (!st || st.kind !== 'image') return { error: 'Imported source not found or expired.' };
  const out = path.join(MASK_UPLOADS_DIR, `import-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.png`);
  try {
    execFileSync('python3', ['-c', 'import sys\nfrom PIL import Image\nim=Image.open(sys.argv[1]); im.load(); im.convert("RGB").save(sys.argv[2])\nprint(im.size[0], im.size[1])', st.path, out], { timeout: 30000 });
  } catch (_) { try { fs.unlinkSync(out); } catch (__) {} return { error: 'reference-invalid: imported image could not be decoded' }; }
  return { path: out, dims: pngSize(out) };
}

function cleanupRejectedSource(res, source) {
  if (!source.temp) return;
  res.once('finish', () => {
    if (res.statusCode >= 400) { try { fs.unlinkSync(source.temp); } catch (_) {} }
  });
}

function resolveImageSource(body) {
  if (typeof body.staged_id === 'string' && body.staged_id) {
    const w = stagedToWorkingPng(body.staged_id);
    if (w.error) return { error: w.error };
    body.__initPath = w.path;
    if (w.dims && (body.width === undefined || body.width === '' || body.width === null)) { body.width = w.dims.width; body.height = w.dims.height; }
    return { imageId: null, staged: true, path: w.path, dims: w.dims, temp: w.path };
  }
  if (typeof body.image_id === 'string' && body.image_id) {
    const img = imageStore.resolveImage(body.image_id);
    if (!img) return { error: 'Source image not found in the canonical image store.' };
    const src = imageSourceMap().get(body.image_id);
    if (!src) {
      body.run_id = '20000101-000000-canonical';
      body.init_image_file = path.basename(img.path);
      body.__initPath = img.path;
      const dims = pngSize(img.path);
      if (dims && (body.width === undefined || body.width === '' || body.width === null)) { body.width = dims.width; body.height = dims.height; }
      return { imageId: body.image_id, path: img.path, dims };
    }
    body.run_id = src.runId;
    body.init_image_file = path.basename(src.runFile);
    const dims = pngSize(img.path);
    if (dims && (body.width === undefined || body.width === '' || body.width === null)) { body.width = dims.width; body.height = dims.height; }
    return { imageId: body.image_id, path: img.path, dims };
  }
  if (typeof body.run_id === 'string' && typeof body.init_image_file === 'string') {
    const hit = imageStore.resolveRunImage(path.join(RUNS_DIR, body.run_id), body.init_image_file);
    return { imageId: hit ? hit.id : null, path: hit ? hit.path : null };
  }
  return { imageId: null };
}

// After a non-controlled edit job (img2img, inpaint, outpaint, upscale) finishes,
// expose its canonical outputs as job.results and record lineage.
function recordEditResults(job, stdoutText) {
  if (!job.lineageOp) return;
  const runIds = [...new Set([...String(stdoutText || '').matchAll(/runs\/(20\d{6}-\d{6}-[a-zA-Z0-9_-]+)/g)].map(m => m[1]))];
  job.results = job.results || [];
  for (const runId of runIds) {
    for (const e of imageStore.readRunIndex(path.join(RUNS_DIR, runId))) {
      if (job.results.some(r => r.imageId === e.image_id) || e.image_id === job.sourceImageId) continue;
      const img = imageStore.resolveImage(e.image_id);
      if (!img) continue;
      const dims = pngSize(img.path) || {};
      const rp = job.requestParams || {};
      const seed = /^\d+$/.test(String(rp.seed || '')) ? Number(rp.seed) : null;
      const gr = job.genRecord || {};
      const editTarget = gr.edit_target || 'sd15';
      job.results.push({ index: job.results.length, status: 'DONE', imageId: e.image_id, imageUrl: imageStore.imageUrl(e.image_id), runId, seed, target: editTarget, width: dims.width, height: dims.height, operation: job.lineageOp });
      try {
        imageMeta.record(e.image_id, {
          operation: job.lineageOp,
          parent: job.sourceImageId,
          detailed_from: rp.detailed_from || (job.lineageOp === 'detailer' ? job.sourceImageId : undefined),
          runId,
          target: editTarget,
          seed,
          width: dims.width,
          height: dims.height,
          steps: rp.steps,
          cfg: rp.cfg_scale,
          strength: rp.strength,
          ...gr,
        });
      } catch (err) { job.stderr += `\nimage-meta: ${err.message}`; }
    }
  }
}

// Img2Img source preparation into the temporary mask-uploads area.
const SOURCE_PREP_MODES = new Set(['crop-square', 'crop-portrait', 'crop-landscape', 'fit-square', 'resize-512']);
const SOURCE_PREP_PY = [
  'import sys',
  'from PIL import Image, ImageFilter',
  'src, out, mode = sys.argv[1], sys.argv[2], sys.argv[3]',
  'im = Image.open(src).convert("RGB"); w, h = im.size',
  'def r64(v): return max(64, int(round(v / 64.0)) * 64)',
  'def crop(aw, ah):',
  '    tw, th = (w, int(w * ah / aw)) if w * ah / aw <= h else (int(h * aw / ah), h)',
  '    x, y = (w - tw) // 2, (h - th) // 2',
  '    c = im.crop((x, y, x + tw, y + th)); return c.resize((r64(tw), r64(th)), Image.LANCZOS)',
  'if mode == "crop-square": o = crop(1, 1)',
  'elif mode == "crop-portrait": o = crop(3, 4)',
  'elif mode == "crop-landscape": o = crop(4, 3)',
  'elif mode == "fit-square":',
  '    s = r64(max(w, h)); bg = im.resize((s, s)).filter(ImageFilter.GaussianBlur(radius=s // 16))',
  '    k = s / float(max(w, h)); fw, fh = int(w * k), int(h * k); bg.paste(im.resize((fw, fh), Image.LANCZOS), ((s - fw) // 2, (s - fh) // 2)); o = bg',
  'else:',
  '    k = 512.0 / max(w, h); o = im.resize((r64(w * k), r64(h * k)), Image.LANCZOS)',
  'o.save(out); print(o.size[0], o.size[1])',
].join('\n');
function prepareSource(srcPath, mode) {
  if (!SOURCE_PREP_MODES.has(mode)) return { error: 'Unknown source_prep mode' };
  const out = path.join(MASK_UPLOADS_DIR, `prep-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.png`);
  try {
    const [w, h] = execFileSync('python3', ['-c', SOURCE_PREP_PY, srcPath, out, mode], { timeout: 30000 }).toString().trim().split(' ').map(Number);
    return { path: out, width: w, height: h };
  } catch (_) {
    try { fs.unlinkSync(out); } catch (__) {}
    return { error: 'Could not prepare the source image.' };
  }
}

// Outpaint: blend the untouched source back over this job's own new output.
// Runs after canonicalization (the script adopts its PNG itself), editing the
// single canonical copy through an owned atomic transform before lineage is recorded.
function compositeOutpaint(job, stdoutText) {
  const c = job.outpaintComposite;
  const m = String(stdoutText || '').match(/runs\/(20\d{6}-\d{6}-[a-zA-Z0-9_-]+)/);
  if (!m) return;
  const runDir = path.join(RUNS_DIR, m[1]);
  const files = imageStore.readRunIndex(runDir).map(e => imageStore.resolveImage(e.image_id)).filter(Boolean).map(i => i.path);
  for (const f of files) {
    try { imageStore.replacePublishedImage(runDir, path.basename(f), staged => execFileSync('python3', ['-c', OUTPAINT_COMPOSITE_PY, staged, c.src, c.mask, String(c.left), String(c.top), String(c.blur || 0), c.fit ? 'fit' : 'offset'], { timeout: 30000 })); job.stdout += `\n${job.lineageOp}: source composited outside the mask\n`; }
    catch (err) { job.stderr += `\nmask-composite: ${err.message}`; job.status = 'FAIL'; job.firstFailedGate = 'canonicalization-failed'; }
  }
}

function cleanupJobTempFiles(job) {
  for (const f of job.tempFiles || []) { try { fs.unlinkSync(f); } catch (_) {} }
}

function finalizeJobImages(job, stdoutText) {
  const runIds = [...new Set([...String(stdoutText || '').matchAll(/runs\/(20\d{6}-\d{6}-[a-zA-Z0-9_-]+)/g)].map(m => m[1]))];
  for (const runId of runIds) {
    const runDir = path.join(RUNS_DIR, runId);
    if (!fs.existsSync(runDir)) continue;
    try {
      imageStore.finalizeRun(runDir);
    } catch (err) {
      job.stderr += `\nimage-store: ${err.message}`;
      job.status = 'FAIL'; job.firstFailedGate = 'canonicalization-failed';
    }
  }
  for (const field of JOB_IMAGE_FIELDS) {
    const value = job[field];
    if (!value) continue;
    const canonical = canonicalForReportedPath(value);
    if (canonical) {
      try { validateImage(canonical.path); } catch (err) { job.status = 'FAIL'; job.firstFailedGate = 'output-invalid'; job.stderr += '\n' + err.message; continue; }
      job[field] = canonical.path;
      job[field + 'Url'] = imageStore.imageUrl(canonical.id);
    }
  }
}

// ---- Capability truth: runtime evidence + Big Mac asset probe ------------------
function readSdcppEnv(key, fallback) {
  try {
    const m = fs.readFileSync(path.join(WORKFLOW_ROOT, 'config', 'sdcpp.env'), 'utf8').match(new RegExp('^' + key + "=['\"]?([^'\"\\n]+)", 'm'));
    return m ? m[1] : fallback;
  } catch (_) { return fallback; }
}
const SSH_TARGET_NAME = readSdcppEnv('SSH_TARGET', 'westcat');
const TARGET_MODELS = targetModelMap(path.join(WORKFLOW_ROOT, 'bin', 'sdcpp-controlled-generate.sh'),
  readSdcppEnv('REMOTE_MODEL', '/Volumes/wc2tb/ImageGen/checkpoints/sd15/v1-5-pruned-emaonly.safetensors'));
const evidenceStore = createEvidenceStore(path.join(STATE_DIR, 'capability-evidence.json'));
let assetCache = null;
async function refreshAssets() {
  const targetModels = { ...TARGET_MODELS };
  for (const target of Object.values(allControlledTargets())) if (target.modelPath) targetModels[target.id] = target.modelPath;
  const probed = await probeAssets({ sshTarget: SSH_TARGET_NAME, targetModels });
  assetCache = { ...probed, checkedAt: new Date().toISOString() };
  return assetCache;
}
function modelStateView(assets = assetCache) {
  const primary = CONTROLLED_TARGET_BY_ID['flux2-klein-4b'];
  return {
    primaryModel: { id: primary.id, role: 'protected-primary', backend: primary.backend },
    activeSecondaryModel: assets && assets.activeSecondaryModel || null,
    secondaryModelState: assets && assets.secondaryModelState || 'inactive',
    sourcePath: assets && assets.secondarySourcePath || null,
    activePath: assets && assets.secondaryActivePath || null,
    modelIdentity: assets && assets.secondaryModelIdentity || null,
    lastSwitchResult: assets && assets.secondaryLastSwitchResult || null,
  };
}
refreshAssets().catch(() => {});
setInterval(() => refreshAssets().catch(() => {}), 5 * 60 * 1000).unref();
function recordJobEvidence(job) {
  try { syncGenericTerminal(job); } catch (err) { job.stderr += `\ngeneric-job: ${err.message}`; }
  try {
    const tid = job.controlledTarget || (job.requestParams && job.requestParams.target);
    const spec = tid && CONTROLLED_TARGET_BY_ID[tid];
    evidenceStore.record(job, spec ? (spec.backend || 'sdcpp') : 'sdcpp');
  } catch (err) {
    job.stderr += `\ncapability-evidence: ${err.message}`;
  }
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
  try {
    const tid = requestParams && requestParams.target;
    const spec = tid && CONTROLLED_TARGET_BY_ID[tid];
    jobStore.create({
      job_id: id, media_kind: 'image', operation: action,
      worker_id: action === 'upscale' ? 'local' : (spec && spec.backend === 'mflux') ? 'mflux' : 'sdcpp',
      model_id: tid || null, resource_class: HEAVY_ACTIONS.has(action) ? 'heavy' : 'light',
      artifact_required: HEAVY_ACTIONS.has(action) || action === 'upscale',
      params: requestParams, persist_text: !!(requestParams && requestParams.save_prompts),
    });
  } catch (_) {}
  try {
    eventBus.publish('job.created', { id, action, status: 'queued', createdAt: jobs[id].createdAt });
  } catch (_) {}
  return id;
}

// ---- Heavy-compute lease (server-enforced) ----------------------------------
// Heavy Big Mac jobs wait (status 'queued') until they own the lease; it is
// released when the job reaches any terminal state (see recordJobEvidence and
// the sweep below, which also covers failure paths).
const arbiter = M.createResourceArbiter({
  externalProbe: () => new Promise(resolve => {
    require('child_process').execFile('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=6', SSH_TARGET_NAME, 'ollama ps 2>/dev/null; printf "\nPROBE_DONE\n"'],
      { timeout: 12000, encoding: 'utf8' }, (err, out) => resolve(String(out || '').includes('PROBE_DONE') ? M.parseOllamaPs(out.split('PROBE_DONE')[0]) : { occupied: false, detail: null }));
  }),
});
const cancelManager = createCancellationManager({
  arbiter,
  jobStore,
  eventBus,
  onLocalTerminate: async (active) => {
    if (active.pid) {
      try { process.kill(active.pid, 'SIGTERM'); } catch (_) {}
    }
  }
});
setInterval(() => { arbiter.refreshExternal().catch(() => {}); }, 60 * 1000).unref();
setInterval(() => {
  const st = arbiter.state();
  if (!st.owner) return;
  // Image jobs live in `jobs`; voice/music jobs only in the durable job store.
  const img = jobs[st.owner.job_id], gen = jobStore.get(st.owner.job_id);
  const imageActive = img && ['queued', 'running'].includes(img.status);
  const mediaActive = !img && gen && ['QUEUED', 'RUNNING', 'TRANSFERRING'].includes(gen.status);
  if (!imageActive && !mediaActive) arbiter.release(st.owner.job_id);
}, 5000).unref();
function leaseLabel(job) {
  const t = job.requestParams && job.requestParams.target;
  return (t ? t + ' ' : '') + job.commandAction;
}
// Run `start` now for light jobs, or once the heavy lease is granted.
function withLease(jobId, start) {
  const job = jobs[jobId];
  if (!job || !HEAVY_ACTIONS.has(job.commandAction)) { start(); return; }
  if (arbiter.holds(jobId)) { start(); return; }
  job.waitingForLease = true;
  arbiter.acquire(jobId, leaseLabel(job)).then(r => {
    job.waitingForLease = false;
    if (!r.granted || job.status !== 'queued') return;
    jobStore.transition(jobId, 'RUNNING', { resource_lease: arbiter.state().group });
    try {
      job.startedAt = Date.now();
      eventBus.publish('job.started', { id: jobId, status: 'running' });
      eventBus.publish('resource.changed', { resources: arbiter.state() });
    } catch (_) {}
    start();
  });
}
function syncGenericTerminal(job) {
  const map = { PASS: 'COMPLETE', PARTIAL: 'COMPLETE', FAIL: 'FAILED', CANCELLED: 'CANCELLED' };
  let st = map[job.status];
  if (!st) return;
  const g = jobStore.get(job.id);
  if (!g || TERMINAL.has(g.status)) { arbiter.release(job.id); return; }
  const fromResults = (job.results || []).filter(r => r.imageId).map(r => r.imageId);
  const fromFields = JOB_IMAGE_FIELDS.map(field => job[field + 'Url']).filter(Boolean).map(url => decodeURIComponent(url.split('/').pop()));
  // Legacy Hi-Res/CLI/plot callers need receipts too; their images may be
  // reported through final-output fields or this job's canonical run index.
  let fromRuns = [];
  if (!fromResults.length && !fromFields.length && g.artifact_required) {
    const runs = [...new Set([job.runId, ...[...String(job.stdout || '').matchAll(/runs\/(20\d{6}-\d{6}-[a-zA-Z0-9_-]+)/g)].map(m => m[1])].filter(Boolean))];
    fromRuns = runs.flatMap(run => imageStore.readRunIndex(path.join(RUNS_DIR, run)).map(entry => entry.image_id));
  }
  const ids = [...new Set([...fromResults, ...fromFields, ...fromRuns])];
  const arts = ids;
  let receipt = null;
  if (st === 'COMPLETE') {
    try {
      if (g.artifact_required && !ids.length) throw new Error('completed generation has no canonical artifact');
      if (ids.length) receipt = artifactReceipt(ids.map(artifact_id => {
        const image = imageStore.resolveImage(artifact_id);
        if (!image) throw new Error('canonical artifact missing: ' + artifact_id);
        return { artifact_id, ...validateImage(image.path), canonical: true, validated: true };
      }));
    } catch (e) {
      job.status = 'FAIL'; job.firstFailedGate = job.firstFailedGate || 'output-invalid';
      job.stderr = (job.stderr || '') + '\n' + e.message; st = 'FAILED';
    }
  }
  if (g.status === 'QUEUED') jobStore.transition(job.id, 'RUNNING');
  const result = jobStore.transition(job.id, st, {
    artifacts: st === 'COMPLETE' ? ids : [], artifact_validation: receipt,
    first_failed_gate: job.firstFailedGate || null, error: st === 'FAILED' ? `failed at gate ${job.firstFailedGate || 'unknown'}` : null,
  });
  if (result && result.error && !TERMINAL.has(result.status)) {
    job.status = 'FAIL'; job.firstFailedGate = job.firstFailedGate || 'job-contract-rejected';
    jobStore.transition(job.id, 'FAILED', { first_failed_gate: job.firstFailedGate, error: result.error });
  }
  arbiter.release(job.id);
  try {
    const eventName = st === 'COMPLETE' ? 'job.completed' : st === 'FAILED' ? 'job.failed' : st === 'CANCELLED' ? 'job.cancelled' : 'job.interrupted';
    eventBus.publish(eventName, { id: job.id, status: st, firstFailedGate: job.firstFailedGate || null, artifactIds: arts });
    if (st === 'COMPLETE' && timingStore && job.startedAt) {
      const dur = (job.completedAt || Date.now()) - job.startedAt;
      const worker = job.commandAction === 'upscale' ? 'local' : (job.requestParams && job.requestParams.target) || 'sdcpp';
      timingStore.recordCompletedJob({ worker, operation: job.commandAction, durationMs: dur });
    }
    // Update library index with new canonical artifacts
    if (st === 'COMPLETE' && libraryIndex) {
      for (const aId of arts) {
        libraryIndex.upsertItem({ id: aId, target: (job.requestParams && job.requestParams.target) || null, operation: job.commandAction });
      }
      eventBus.publish('library.changed', { count: arts.length });
    }
  } catch (_) {}
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
  try {
    eventBus.publish('job.progress', { id: job.id, progress: job.progress });
  } catch (_) {}
}

function startRunProgress(job, runIndex, quantity) {
  updateSequentialProgress(job, {
    totalRuns: quantity, completedRuns: runIndex, currentRun: runIndex + 1,
    currentRunPercent: 0, currentRunStartedAt: Date.now()
  });
  // No time-derived percentages. Sampling progress comes from the backend log.
  return null;
}

function terminateChildTree(child) {
  if (!child || !child.pid) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch (_) {
    try { child.kill('SIGTERM'); } catch (_) {}
  }
  setTimeout(() => {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch (_) {
      try { child.kill('SIGKILL'); } catch (_) {}
    }
  }, 5000).unref();
}

function markJobTimedOut(job, child, timeoutMs, label) {
  if (!job || job.status !== 'running') return;
  job.status = 'FAIL';
  job.completedAt = Date.now();
  job.exitCode = null;
  job.firstFailedGate = 'timeout';
  job.stderr += `\nTimed out after ${Math.round(timeoutMs / 1000)}s waiting for ${label || job.commandAction || 'job'} to finish.`;
  terminateChildTree(child);
}

function runAction(jobId, scriptPath, args, savePrompts = false) {
  withLease(jobId, () => runActionNow(jobId, scriptPath, args, savePrompts));
}
function runActionNow(jobId, scriptPath, args, savePrompts = false) {
  const job = jobs[jobId];
  job.status = 'running';
  job.startedRunningAt = Date.now();
  if (jobStore.get(jobId) && jobStore.get(jobId).status === 'QUEUED') jobStore.transition(jobId, 'RUNNING');
  const env = { ...process.env, SDCPP_REDACT_PROMPTS: savePrompts ? '0' : '1' };
  const child = spawn(scriptPath, args, { cwd: WORKFLOW_ROOT, shell: false, env, detached: true });
  const sensitives = jobSensitives[jobId] || [];
  const timeoutTimer = setTimeout(() => markJobTimedOut(job, child, JOB_TIMEOUT_MS, scriptPath), JOB_TIMEOUT_MS);
  timeoutTimer.unref();

  child.stdout.on('data', data => {
    job.stdout += redactSensitiveText(data.toString(), sensitives);
  });
  child.stderr.on('data', data => {
    job.stderr += redactSensitiveText(data.toString(), sensitives);
  });
  child.on('error', err => {
    clearTimeout(timeoutTimer);
    job.status = 'FAIL';
    job.stderr += `\n${err.message}`;
    job.completedAt = Date.now();
    job.firstFailedGate = 'spawn';
  });
  child.on('close', code => {
    clearTimeout(timeoutTimer);
    if (job.firstFailedGate === 'timeout') { finalizeJobImages(job, job.stdout); cleanupJobTempFiles(job); recordJobEvidence(job); return; }
    job.exitCode = code;
    job.completedAt = Date.now();
    const out = job.stdout;
    const errOut = job.stderr;
    const combined = out + errOut;
    if (code !== 0 || combined.includes('SDCPP_REMOTE_CLEANUP: FAIL')) job.status = 'FAIL';
    else if (out.includes('==== PASS ====')) job.status = 'PASS';
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
    finalizeJobImages(job, out);
    if (job.outpaintComposite && job.status === 'PASS') compositeOutpaint(job, out);
    if (job.status === 'PASS' || job.status === 'PARTIAL') recordEditResults(job, out);
    cleanupJobTempFiles(job);
    recordJobEvidence(job);
  });
}

function runGateFrom(combined, runStdout) {
  const gateMatch = combined.match(/First failed gate:\s*(.+?)(?=\n|$)/);
  if (gateMatch) return gateMatch[1].trim();
  const failMatch = runStdout.match(/FAIL:\s*(.+?)(?=\n|$)/);
  if (failMatch) return failMatch[1].trim();
  if (combined.includes('Unknown argument')) return 'args';
  return null;
}

// Controlled generation for quantity N. Each image becomes one entry in
// job.results (canonical id/url, run, resolved seed, target, size, status).
// SDCPP quantity 2-16 uses ONE native sd-cli --batch-count run (one model load);
// otherwise, or if the native command cannot be built, runs are sequential.
// The legacy single-image job fields keep pointing at the latest output.
function runControlledSequential(jobId, spec, params, quantity, opts = {}) {
  withLease(jobId, () => runControlledSequentialNow(jobId, spec, params, quantity, opts));
}
function runControlledSequentialNow(jobId, spec, params, quantity, opts = {}) {
  const job = jobs[jobId];
  job.status = 'running';
  if (jobStore.get(jobId) && jobStore.get(jobId).status === 'QUEUED') jobStore.transition(jobId, 'RUNNING');
  job.results = job.results || [];
  const env = { ...process.env, SDCPP_REDACT_PROMPTS: params.save_prompts ? '0' : '1' };
  const sensitives = jobSensitives[jobId] || [];
  const native = opts.native !== undefined ? opts.native : nativeBatchEligible(spec, quantity);
  const seeds = opts.seeds || W.planSeeds(params.seed, quantity, { consecutive: native });
  job.seeds = seeds;
  job.nativeBatch = native;
  if (native) job.capabilityId = 'quantity-native-batch';
  else if (params.hires_scale) job.capabilityId = 'hires-refine';
  const runsTotal = native ? 1 : quantity;
  const controlledScript = controlledScriptFor(spec);
  const finish = () => {
    job.completedAt = Date.now();
    recordJobEvidence(job);
    if (opts.onDone) { try { opts.onDone(job); } catch (_) {} }
  };

  function pushResults(runStdout, runIndex) {
    const runMatch = runStdout.match(/runs\/(20\d{6}-\d{6}-[a-zA-Z0-9_-]+)/);
    const runId = runMatch ? runMatch[1] : null;
    const reported = native
      ? [...runStdout.matchAll(/CONTROLLED_BATCH_IMAGE:\s*(\S+)/g)].map(m => m[1])
      : [(runStdout.match(/CONTROLLED_OUTPUT_IMAGE:\s*(\S+)/) || [])[1]].filter(Boolean);
    reported.forEach((p, k) => {
      const c = canonicalForReportedPath(p);
      const seed = native ? seeds[k] : seeds[runIndex];
      const dims = (c && pngSize(c.path)) || {};
      const item = {
        index: job.results.length, status: c ? 'DONE' : 'FAILED', seed, target: spec.id, runId,
        width: dims.width || Number(params.width) || spec.defaultWidth, height: dims.height || Number(params.height) || spec.defaultHeight,
        imageId: c ? c.id : null, imageUrl: c ? imageStore.imageUrl(c.id) : null,
        operation: params.operation || 'txt2img', parentImageId: params.parent_image_id || null,
      };
      if (!c) item.error = 'output was not canonicalized';
      job.results.push(item);
      if (c) {
        try {
          imageMeta.record(c.id, {
            operation: item.operation, parent: params.parent_image_id || undefined,
            detailed_from: params.detailed_from || undefined,
            runId, target: spec.id, seed,
            width: item.width, height: item.height, steps: params.steps || spec.defaultSteps,
            cfg: spec.backend === 'mflux' ? undefined : params.cfg_scale, scheduler: spec.backend === 'mflux' ? undefined : params.scheduler,
            queueId: opts.queueId, batchNumber: opts.batchNumber,
            // Effective per-image generation record (exact recall source).
            gen_schema: 1,
            sampler: spec.backend === 'mflux' ? undefined : EC.canonicalSampler(params.sampler || spec.defaultSampler),
            vae: spec.backend === 'mflux' ? undefined : (params.vae || 'auto'),
            preset: params.preset || undefined,
            loras: spec.backend === 'mflux' ? [] : (params.loras || []),
            prompt_saved: !!params.save_prompts,
            prompt: params.save_prompts ? EC.stripLoraTags(params.prompt) : undefined,
            negative_prompt: params.save_prompts && !(spec.backend === 'mflux' || spec.noNegativePrompt) ? params.negative_prompt : undefined,
          });
        } catch (err) { job.stderr += `\nimage-meta: ${err.message}`; }
      }
    });
  }

  function runNext(runIndex) {
    const runNumber = runIndex + 1;
    job.stdout += native ? `\n--- Native batch run: ${quantity} images, seeds ${seeds[0]}..${seeds[quantity - 1]} ---\n` : `\n--- Sequential Run ${runNumber} of ${quantity} ---\n`;
    const progressTimer = startRunProgress(job, runIndex, runsTotal);
    const args = buildControlledArgs(spec, params, {
      seedValue: native ? seeds[0] : seeds[runIndex],
      isDiscovered: !CONTROLLED_TARGET_BY_ID[params.target],
      resolveVaePath,
      batchCount: native ? quantity : 1,
    });

    const child = spawn(controlledScript, args, { cwd: WORKFLOW_ROOT, shell: false, env, detached: true });
    job.activeChildPid = child.pid;
    let runStdout = '';
    let runStderr = '';
    // Cold checkpoint loading is not included in the warm generation estimate.
    const runTimeoutMs = JOB_TIMEOUT_MS;
    const timeoutTimer = setTimeout(() => {
      clearInterval(progressTimer);
      markJobTimedOut(job, child, runTimeoutMs, `controlled generation run ${runNumber}`);
      updateSequentialProgress(job, { currentRunPercent: 100 });
    }, runTimeoutMs);
    timeoutTimer.unref();

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
      clearTimeout(timeoutTimer);
      clearInterval(progressTimer);
      job.status = 'FAIL';
      job.stderr += `\nSpawn error in run ${runNumber}: ${err.message}`;
      job.firstFailedGate = 'spawn';
      updateSequentialProgress(job, { currentRunPercent: 100 });
      finish();
    });

    child.on('close', code => {
      clearTimeout(timeoutTimer);
      clearInterval(progressTimer);
      job.activeChildPid = null;
      if (job.firstFailedGate === 'timeout') { finalizeJobImages(job, runStdout); finish(); return; }
      job.exitCode = code;
      const combined = runStdout + runStderr;
      let runPassed;
      if (code !== 0 || combined.includes('SDCPP_REMOTE_CLEANUP: FAIL')) runPassed = false;
      else if (runStdout.includes('==== PASS ====')) runPassed = true;
      else if (runStdout.includes('status: PARTIAL') || runStdout.includes('==== PARTIAL ====')) runPassed = true;
      else if (combined.includes('==== FAIL ====')) runPassed = false;
      else runPassed = (code === 0);

      if (!runPassed) {
        const gate = runGateFrom(combined, runStdout);
        finalizeJobImages(job, runStdout);
        // Native command could not be built (nothing generated): fall back to sequential.
        if (native && (gate === 'command' || gate === 'sd-cli-help')) {
          job.stdout += `\n[native batch unavailable (${gate}); falling back to sequential runs]\n`;
          job.nativeFallback = true;
          delete job.capabilityId;
          runControlledSequential(jobId, spec, params, quantity, { ...opts, native: false, seeds: W.planSeeds(params.seed, quantity) });
          return;
        }
        job.status = 'FAIL';
        job.firstFailedGate = job.firstFailedGate || gate;
        const failed = native ? seeds.length : 1;
        for (let k = 0; k < failed; k++) job.results.push({ index: job.results.length, status: 'FAILED', seed: native ? seeds[k] : seeds[runIndex], target: spec.id, error: gate || 'failed' });
        updateSequentialProgress(job, { currentRunPercent: 100 });
        finish();
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
      finalizeJobImages(job, runStdout);
      if (job.status === 'FAIL') { finish(); return; }
      pushResults(runStdout, runIndex);
      updateSequentialProgress(job, { completedRuns: runNumber, currentRunPercent: 100 });

      if (!native && runIndex < quantity - 1) {
        runNext(runIndex + 1);
      } else {
        const out = job.stdout;
        job.status = (out.includes('status: PARTIAL') || out.includes('==== PARTIAL ====')) ? 'PARTIAL' : 'PASS';
        if (job.results.some(r => r.status !== 'DONE')) job.status = 'PARTIAL';
        updateSequentialProgress(job, { completedRuns: runsTotal, currentRunPercent: 100 });
        finish();
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
    'quantity',
    'hires_scale',
    'hires_steps',
    'hires_denoise',
    'hires_upscaler',
    'parent_image_id',
    'operation',
    'loras'
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
    quantity: body.quantity !== undefined && body.quantity !== null && body.quantity !== '' ? Number(body.quantity) : 1,
    hires_scale: body.hires_scale !== undefined && body.hires_scale !== null && body.hires_scale !== '' ? Number(body.hires_scale) : null,
    hires_steps: body.hires_steps !== undefined && body.hires_steps !== null && body.hires_steps !== '' ? Number(body.hires_steps) : 0,
    hires_denoise: body.hires_denoise !== undefined && body.hires_denoise !== null && body.hires_denoise !== '' ? Number(body.hires_denoise) : 0.5,
    hires_upscaler: body.hires_upscaler ? String(body.hires_upscaler) : 'Latent',
    parent_image_id: typeof body.parent_image_id === 'string' && body.parent_image_id ? body.parent_image_id : null,
    operation: body.operation ? String(body.operation) : 'txt2img',
    preset: typeof body.preset === 'string' && /^[A-Za-z0-9_-]{1,24}$/.test(body.preset) ? body.preset : '',
    loras: body.loras
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
  if (!validateSeed(params.seed)) return 'Invalid seed';
  if (!validateScheduler(params.scheduler)) return 'Invalid scheduler';
  if (!validateVae(params.vae)) return 'Invalid VAE';
  if (!validateSavePrompts(params.save_prompts)) return 'Invalid save_prompts';

  const spec = allTargetById[params.target];
  if (params.width === undefined || params.width === null || params.width === '') params.width = spec.defaultWidth;
  if (params.height === undefined || params.height === null || params.height === '') params.height = spec.defaultHeight;
  const dimensionError = validateDimensions(spec, params.width, params.height);
  if (dimensionError) return dimensionError;
  const steps = params.steps === undefined || params.steps === null || params.steps === ''
    ? spec.defaultSteps
    : Number(params.steps);
  if (!validateIntRange(steps, spec.minSteps, spec.maxSteps, false)) return `Invalid steps for ${spec.label}`;

  const cfgScale = params.cfg_scale === undefined || params.cfg_scale === null || params.cfg_scale === ''
    ? spec.defaultCfgScale
    : Number(params.cfg_scale);
  if (!Number.isFinite(cfgScale)) return `Invalid cfg_scale for ${spec.label}`;
  if (cfgScale < 0 || cfgScale > 30) return `Invalid cfg_scale for ${spec.label}`;

  if (params.target === 'flux-fp8' && cfgScale !== 1) return 'FLUX.1 Schnell requires cfg_scale 1';
  if (params.quantity !== undefined && params.quantity !== null) {
    if (!Number.isInteger(params.quantity) || params.quantity < 1 || params.quantity > 100) {
      return 'Quantity must be an integer between 1 and 100';
    }
  }
  if (params.hires_scale !== null && params.hires_scale !== undefined) {
    if ((spec.backend || 'sdcpp') === 'mflux') return 'High-Res Refine is an SDCPP feature; MFLUX targets do not support it';
    if (!(params.hires_scale >= 1.1 && params.hires_scale <= 2)) return 'hires_scale must be between 1.1 and 2.0';
    if (!Number.isInteger(params.hires_steps) || params.hires_steps < 0 || params.hires_steps > 150) return 'hires_steps must be an integer 0-150';
    if (!(params.hires_denoise >= 0.05 && params.hires_denoise <= 0.95)) return 'hires_denoise must be between 0.05 and 0.95';
    if (!['Latent', 'Lanczos', 'Nearest'].includes(params.hires_upscaler)) return 'hires_upscaler must be Latent, Lanczos or Nearest';
    const w = Number(params.width || spec.defaultWidth), h = Number(params.height || spec.defaultHeight);
    if (w * params.hires_scale > 2048 || h * params.hires_scale > 2048) return 'High-Res Refine output would exceed 2048 px';
  }
  if (!['txt2img', 'variation', 'seed-lab', 'prompt-ab', 'batch'].includes(params.operation)) return 'Invalid operation';
  if (params.parent_image_id && !imageStore.resolveImage(params.parent_image_id)) return 'parent_image_id is not a canonical image';
  if (W.isFixedSeedValue(params.seed) && parseInt(params.seed, 10) + (params.quantity || 1) - 1 > W.MAX_SEED) return 'seed + quantity exceeds the maximum seed';
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
  let initImgPath = path.resolve(RUNS_DIR, runId, initImageFile);
  const relCheck = path.relative(RUNS_DIR, initImgPath);
  if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) return { ok: false, status: 403, error: 'Init image path resolves outside runs directory' };
  if (!fs.existsSync(initImgPath)) initImgPath = resolveRunImageForRead(runId, initImageFile) || initImgPath;
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
  const args = ['--preset', preset === 'Custom' ? 'fast' : preset, '--prompt', prompt, '--scale', String(scale), '--resample', resample];
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
  for (const name of imageStore.listRunImageNames(runPath)) {
    if (!files.includes(name)) files.push(name);
  }
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

// Model-aware control truth for one target. The UI reads this instead of
// branching on model names. Only claims what the backend actually consumes.
function targetCapabilities(target) {
  const mflux = (target.backend || 'sdcpp') === 'mflux';
  const sd15 = target.id === 'sd15';
  return {
    backend: mflux ? 'mflux' : 'sdcpp',
    negativePrompt: !mflux && !target.noNegativePrompt, cfg: !mflux && target.fixedCfgScale === undefined, scheduler: !mflux, sampler: false, vae: !mflux, lora: !mflux,
    img2img: sd15, inpaint: sd15, outpaint: sd15, controlNet: false, hiresRefine: !mflux,
    nativeBatch: !mflux, maxQuantity: 100,
  };
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
    backend: target.backend || 'sdcpp',
    aliasOf: target.aliasOf || null,
    modelPath: TARGET_MODELS[target.id] || target.modelPath || null,
    modelFile: target.modelFile || null,
    registrationStatus: target.status,
    ...targetVerification(target, assetCache, TARGET_MODELS, evidenceStore.read()),
    primary: target.primary === true,
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
    defaultScheduler: target.defaultScheduler,
    maxWidth: target.maxWidth,
    maxHeight: target.maxHeight,
    ...rulesForTarget(target),
    minSteps: target.minSteps,
    maxSteps: target.maxSteps,
    capabilities: targetCapabilities(target)
  }));

  res.json({
    app: { name: 'SDCPP Workbench', version: 'a1111-workbench-2026-06-22' },
    backend: { type: 'stable-diffusion.cpp workflow bridge', workflowRoot: WORKFLOW_ROOT, runsDir: RUNS_DIR, localTunnelPort: localPort },
    assetCache: { present: !!assets, cacheAgeMinutes, discoveredAt: assets ? assets.discovered_at_iso : null },
    modelStage,
    modelInventory,
    modelState: modelStateView(),
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
      outpaint: inpaintSupported
        ? { supported: true, route: '/api/actions/outpaint', caveat: 'Canvas extension + generated mask through the SDCPP inpaint path (SD1.5).' }
        : { supported: false, reason: 'Needs the SDCPP inpaint backend.' },
      hiresRefine: { supported: true, route: '/api/actions/generate-controlled', caveat: 'Native sd-cli --hires diffusion second pass (SDCPP targets only). Distinct from Lanczos resize and Real-ESRGAN.' },
      nativeBatch: { supported: true, caveat: 'SDCPP quantity 2-16 runs as one sd-cli --batch-count invocation (seeds S..S+N-1); MFLUX is sequential.' },
      controlNet: { supported: false, state: 'ENGINE SUPPORTED — MODEL ASSET MISSING', reason: 'sd-cli 7f0e728 supports --control-net/--control-image/--canny, but no SD1.5 ControlNet model exists on Big Mac.', unlock_requires: 'Stage an SD1.5 ControlNet (e.g. control_v11p_sd15_canny .safetensors, ~1.4 GB) under /Volumes/wc2tb/ImageGen/controlnet, then prove it.' },
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
function execWorkflow(file, args = [], timeout = 30000) {
  return new Promise((resolve, reject) => execFile(file, args, { cwd: WORKFLOW_ROOT, timeout, encoding: 'utf8' },
    (error, stdout, stderr) => error ? reject(Object.assign(error, { stdout, stderr })) : resolve({ stdout, stderr })));
}

app.get('/api/models/secondary', async (req, res) => {
  try {
    const assets = await refreshAssets();
    res.json(modelStateView(assets));
  } catch (error) {
    res.status(503).json({ error: error.message });
  }
});

app.post('/api/models/secondary/activate', async (req, res) => {
  const targetId = String(req.body && req.body.target || '');
  const spec = allControlledTargets()[targetId];
  if (!spec) return res.status(400).json({ error: 'Unknown model target' });
  if ((spec.backend || 'sdcpp') === 'mflux' || targetId === 'flux2-klein-4b') return res.status(400).json({ error: 'The protected FLUX primary is not a secondary model' });
  const source = TARGET_MODELS[targetId] || spec.modelPath;
  if (!source) return res.status(409).json({ error: 'No approved checkpoint path exists for this target' });
  const lease = arbiter.state();
  if (lease.owner || lease.waiting.length || lease.external.occupied) return res.status(409).json({ error: 'Model switch is busy while heavy compute is active', modelState: modelStateView() });
  const switchId = `model-switch-${crypto.randomUUID()}`;
  const granted = await arbiter.acquire(switchId, `model switch to ${targetId}`);
  if (!granted.granted) return res.status(409).json({ error: 'Model switch is busy' });
  try {
    // Targeted only: this script closes the workflow control socket/tmux
    // session and explicitly leaves unrelated services alone.
    await execWorkflow(path.join(WORKFLOW_ROOT, 'bin', 'sdcpp-server-stop.sh'), [], 30000);
    const result = await execWorkflow(path.join(WORKFLOW_ROOT, 'bin', 'sdcpp-secondary-slot.sh'), ['activate', targetId, source], 30000);
    const state = JSON.parse(result.stdout.trim());
    const assets = await refreshAssets();
    res.json({ ok: true, ...state, modelState: modelStateView(assets) });
  } catch (error) {
    let state = null;
    try { state = JSON.parse(String(error.stdout || '').trim()); } catch (_) {}
    res.status(500).json({ error: (state && state.lastSwitchResult && state.lastSwitchResult.error) || error.message, modelState: state || modelStateView() });
  } finally {
    arbiter.release(switchId);
  }
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

app.get('/api/prompt/profiles', (req, res) => {
  res.json({ profiles: PROFILES });
});

app.post('/api/prompt/resolve-profile', (req, res) => {
  const p = resolvePromptProfile(req.body || {});
  res.json({ profile: p });
});

app.get('/api/wildcards', (req, res) => {
  try {
    res.json({ wildcards: getWildcardCatalog(WILDCARDS_DIR) });
  } catch (err) {
    res.status(500).json({ error: err.message, wildcards: [] });
  }
});

app.post('/api/wildcards/expand', (req, res) => {
  try {
    const prompt = (req.body && req.body.prompt) || '';
    if (typeof prompt !== 'string') return res.status(400).json({ error: 'prompt must be a string' });
    const expanded = expandWildcards(prompt);
    res.json({ original: prompt, expanded });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/models', (req, res) => {
  const targets = liveModelTargets();
  res.json({ models: getModelCards(req.query, targets) });
});

app.get('/api/models/:id', (req, res) => {
  const targets = liveModelTargets();
  const card = getModelCardById(req.params.id, targets);
  if (!card) return res.status(404).json({ error: 'Model not found' });
  res.json({ model: card });
});

app.post('/api/models/check-switch', (req, res) => {
  const body = req.body || {};
  const fromModelId = body.fromModelId || body.fromTarget;
  const toModelId = body.toModelId || body.toTarget;
  let activeResources = { ...(body.activeResources || {}) };

  if (!activeResources.negativePrompt && (body.negative_prompt || body.negativePrompt)) {
    activeResources.negativePrompt = body.negative_prompt || body.negativePrompt;
  }
  if (!activeResources.loras && body.prompt) {
    const loraMatches = String(body.prompt).matchAll(/<lora:([^:>]+)(?::([^>]*))?>/g);
    const parsedLoras = [];
    for (const m of loraMatches) {
      parsedLoras.push({ name: m[1], weight: m[2] ? parseFloat(m[2]) : 1.0 });
    }
    if (parsedLoras.length > 0) activeResources.loras = parsedLoras;
  }

  // Ensure active LoRAs have family resolved from asset cache if missing
  if (Array.isArray(activeResources.loras)) {
    const assets = readJsonCache(ASSETS_CACHE) || {};
    const assetLoras = assets.loras || [];
    activeResources.loras = activeResources.loras.map(l => {
      const name = typeof l === 'string' ? l : (l && l.name);
      const weight = typeof l === 'object' && l && l.weight != null ? l.weight : 1.0;
      let family = typeof l === 'object' && l ? l.family : null;
      if (!family && name) {
        const found = assetLoras.find(al => {
          const fn = (al.filename || '').replace(/\.[^.]+$/, '');
          return fn.toLowerCase() === name.toLowerCase() || (al.name && al.name.toLowerCase() === name.toLowerCase());
        });
        if (found) {
          family = inferAssetFamily(found.filename || found.path);
        } else {
          family = inferAssetFamily(name);
        }
      }
      return { name, weight, family };
    });
  }

  const targets = Object.values(allControlledTargets());
  const warnings = checkModelSwitchWarnings(fromModelId, toModelId, activeResources, targets);
  res.json({ allowed: warnings.length === 0, warnings });
});

app.get('/api/extra-networks', (req, res) => {
  const targetId = req.query.target || 'flux2-klein-4b';
  const assets = readJsonCache(ASSETS_CACHE) || {};
  const loras = buildLoraCards(assets.loras || [], targetId);
  const vaes = buildVaeCards(assets.vaes || [], targetId);
  const embeddings = buildEmbeddingState(assets.embeddings || [], targetId);
  res.json({ loras, vaes, embeddings });
});

app.get('/api/detailer/status', (req, res) => {
  res.json({
    available: isVisionDetailerAvailable(),
    backend: 'apple-vision',
    supported_modes: ['face', 'hand', 'person'],
    timeout_ms: ATTEMPT_TIMEOUT_MS,
    default_prompts: {
      face: getDefaultDetailerPrompt('face'),
      hand: getDefaultDetailerPrompt('hand'),
      person: getDefaultDetailerPrompt('person')
    }
  });
});

// Detail-target options accepted from the client (all optional; the native detector applies its own defaults).
function detailerOptionsFrom(body) {
  const o = {};
  const b = body || {};
  for (const k of ['threshold', 'padding', 'feather', 'maxTargets', 'targetSelection', 'minArea', 'maxArea', 'offsetX', 'offsetY', 'dilate', 'personQuality']) {
    if (b[k] !== undefined && b[k] !== null && b[k] !== '') o[k] = b[k];
  }
  // snake_case aliases
  const alias = { max_targets: 'maxTargets', target_selection: 'targetSelection', min_area: 'minArea', max_area: 'maxArea', offset_x: 'offsetX', offset_y: 'offsetY', person_quality: 'personQuality' };
  for (const [from, to] of Object.entries(alias)) if (o[to] === undefined && b[from] !== undefined && b[from] !== null && b[from] !== '') o[to] = b[from];
  o.mode = b.mode || 'face';
  return o;
}
function detectorRequestSignal(res) {
  const controller = new AbortController();
  res.once('close', () => { if (!res.writableEnded) controller.abort(); });
  return controller.signal;
}
function detailerFail(res, err) {
  const status = (err && err.status) || 500;
  return res.status(status).json({ error: err.message, code: err.code || 'detailer_failed', stage: err.stage || undefined });
}
function detailerSummary(result) {
  return { backend: result.backend, mode: result.mode, selection: result.selection, candidates: result.candidates, filtered: result.filtered, detections: result.detections, detections_count: result.detections_count, mask: result.mask ? { coverage: result.mask.coverage, width: result.mask.width, height: result.mask.height, format: result.mask.format } : undefined, timings_ms: result.timings_ms, attempts: result.attempts };
}
function noDetailerTargetsMessage(mode, result) {
  const what = { face: 'face', hand: 'hand', person: 'person' }[mode] || mode;
  if (result && result.candidates > 0 && result.filtered === 0) return `${result.candidates} ${what} candidate(s) were found but all were excluded by the size limits. Widen the minimum/maximum size and try again.`;
  return `No ${what} was found in this image (nothing met the detection threshold and size limits). Lower the confidence threshold, widen the size limits, or try another target type.`;
}

app.post('/api/detailer/detect', async (req, res) => {
  const { image_id } = req.body || {};
  if (!image_id) return res.status(400).json({ error: 'image_id is required' });
  const resolved = imageStore.resolveImage(image_id);
  if (!resolved || !fs.existsSync(resolved.path)) {
    return res.status(404).json({ error: 'Source image not found' });
  }
  try {
    const result = await detectRegions(resolved.path, { ...detailerOptionsFrom(req.body), signal: detectorRequestSignal(res) });
    res.json({ status: 'ok', ...detailerSummary(result), image_width: result.image_width, image_height: result.image_height });
  } catch (err) {
    detailerFail(res, err);
  }
});

app.post('/api/detailer/mask-preview', async (req, res) => {
  const { image_id } = req.body || {};
  if (!image_id) return res.status(400).json({ error: 'image_id is required' });
  const resolved = imageStore.resolveImage(image_id);
  if (!resolved || !fs.existsSync(resolved.path)) {
    return res.status(404).json({ error: 'Source image not found' });
  }
  const maskName = `mask-preview-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
  const maskPath = path.join(RUNS_DIR, maskName);
  try {
    const result = await detectRegions(resolved.path, { ...detailerOptionsFrom(req.body), outputMask: maskPath, signal: detectorRequestSignal(res) });
    const empty = !result.detections || result.detections.length === 0;
    const maskBase64 = !empty && fs.existsSync(maskPath) ? `data:image/png;base64,${fs.readFileSync(maskPath).toString('base64')}` : null;
    res.json({ status: 'ok', mask_preview: maskBase64, empty, message: empty ? noDetailerTargetsMessage(result.mode, result) : undefined, image_width: result.image_width, image_height: result.image_height, ...detailerSummary(result) });
  } catch (err) {
    detailerFail(res, err);
  } finally {
    try { if (fs.existsSync(maskPath)) fs.unlinkSync(maskPath); } catch (_) {}
  }
});

app.post('/api/detailer/run', async (req, res) => {
  const body = req.body || {};
  const { image_id, imageId, mode, strength } = body;
  const targetImageId = image_id || imageId;
  if (!targetImageId) return res.status(400).json({ error: 'image_id is required' });
  const resolved = imageStore.resolveImage(targetImageId);
  if (!resolved || !fs.existsSync(resolved.path)) {
    return res.status(404).json({ error: 'Source image not found' });
  }

  const maskName = `mask-detailer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
  const maskPath = path.join(MASK_UPLOADS_DIR, maskName);
  const opts = detailerOptionsFrom(body);
  if (opts.padding === undefined) opts.padding = 0.25;
  if (opts.feather === undefined) opts.feather = 16;
  try {
    const result = await detectRegions(resolved.path, { ...opts, outputMask: maskPath, signal: detectorRequestSignal(res) });
    if (!result.detections || result.detections.length === 0) {
      return res.status(422).json({ error: noDetailerTargetsMessage(opts.mode, result), code: 'no_targets', detections: [] });
    }
    const maskBase64 = `data:image/png;base64,${fs.readFileSync(maskPath).toString('base64')}`;

    // Inpaint request: the mask is alpha-painted over ONLY the selected target(s); everything else is kept.
    // No `confirm_full_mask` — a mask that covers ~the whole image must still hit the normal 409 gate.
    req.body = {
      ...body,
      image_id: resolved.id,
      mask_data: maskBase64,
      operation: 'detailer',
      detailed_from: resolved.id,
      parent_image_id: resolved.id,
      mode: 'cli',
      detailer_mode: opts.mode,
      prompt: (typeof body.prompt === 'string' && body.prompt.trim()) ? body.prompt : getDefaultDetailerPrompt(opts.mode),
      strength: strength !== undefined ? Number(strength) : 0.4
    };
    delete req.body.confirm_full_mask;
    if (body.confirm_full_mask === true) req.body.confirm_full_mask = true;   // only if the user explicitly confirmed it
    return handleInpaint(req, res);
  } catch (err) {
    if (err && err.code) return detailerFail(res, err);
    return res.status(500).json({ error: 'Detailer failed: ' + err.message });
  } finally {
    try { if (fs.existsSync(maskPath)) fs.unlinkSync(maskPath); } catch (_) {}
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

  const result = await runPromptEnhance({
    prompt,
    negativePrompt: req.body.negative_prompt || req.body.negativePrompt || '',
    mode: req.body.mode || 'balanced',
    target: req.body.target || 'flux2-klein-4b',
    generatorId: req.body.generatorId || '',
    modality: req.body.modality || 'image',
    operation: req.body.operation || 'txt2img',
    ollamaRequester: ollamaRequest,
    ollamaModel: model,
    savePrompts: !!req.body.save_prompts
  });

  if (!result.ok) {
    return res.status(500).json({
      error: result.error,
      model,
      prompt,
      enhanced_prompt: prompt,
      profile: result.profile
    });
  }

  res.json({
    ok: true,
    model,
    prompt: result.enhanced_prompt,
    enhanced_prompt: result.enhanced_prompt,
    original_prompt: result.original_prompt,
    negative_prompt: result.negative_prompt,
    setting_suggestions: result.setting_suggestions,
    notes: result.notes,
    profile: result.profile,
    mode: result.mode
  });
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

function liveModelTargets() {
  const evidence = evidenceStore.read();
  return Object.values(allControlledTargets()).map(target => ({ ...target,
    registrationStatus: target.status, ...targetVerification(target, assetCache, TARGET_MODELS, evidence) }));
}

function allControlledTargets() {
  const discoveredTargets = buildDiscoveredTargets(readJsonCache(ASSETS_CACHE));
  return discoveredTargets.length
    ? { ...CONTROLLED_TARGET_BY_ID, ...Object.fromEntries(discoveredTargets.map(t => [t.id, t])) }
    : CONTROLLED_TARGET_BY_ID;
}

// Validated params -> running controlled job. Shared by the Create API and the
// numbered Batch queue so both use the one generation path.
function startControlledJob(params, allTargetById, opts = {}) {
  const spec = allTargetById[params.target];
  const controlledScript = controlledScriptFor(spec);
  const args = buildControlledArgs(spec, params, {
    seedValue: params.seed,
    isDiscovered: !CONTROLLED_TARGET_BY_ID[params.target],
    resolveVaePath,
  });
  const sensitives = [params.prompt, params.negative_prompt].filter(Boolean);
  const summary = getRedactedCommandSummary(controlledScript, args, sensitives) + (params.quantity > 1 ? ` (quantity: ${params.quantity})` : '');
  const jobId = createJob('controlled-generate', summary, sanitizeRequestParams({ ...params, target: spec.id }, params.save_prompts));
  jobSensitives[jobId] = sensitives;
  runControlledSequential(jobId, spec, params, params.quantity, opts);
  return { jobId, spec };
}

app.post('/api/actions/generate-controlled', (req, res) => {
  const allTargetById = allControlledTargets();
  const params = normalizeControlledGenerationBody(req.body || {});
  const loraShapeErr = params.invalidKey ? null : validateStructuredLoras(params.loras);
  if (loraShapeErr) return res.status(400).json({ error: loraShapeErr });
  if (!params.invalidKey) {
    params.prompt = expandWildcards(params.prompt);
    const rr = EC.resolveResources({ prompt: params.prompt, loras: params.loras });
    params.prompt = rr.backendPrompt;
    params.loras = rr.loras;
  }
  const err = validateControlledGenerationParams(params, allTargetById);
  if (err) return res.status(400).json({ error: err });

  const { jobId, spec } = startControlledJob(params, allTargetById);

  res.json({
    job_id: jobId,
    status: jobs[jobId].status,
    controlledTarget: spec.id,
    controlledOutputImage: null,
    controlledManifest: null,
    firstFailedGate: null,
    quantity: params.quantity,
    seeds: jobs[jobId].seeds,
    nativeBatch: !!jobs[jobId].nativeBatch
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
  const body = { ...(req.body || {}) };
  let upscaleSource = { imageId: null };
  if (body.image_id) {
    upscaleSource = resolveImageSource(body);
    if (upscaleSource.error) return res.status(404).json({ error: upscaleSource.error, gate: 'source' });
    body.runId = body.run_id;
    body.image = imageSourceMap().get(body.image_id).runFile;
  } else if (body.runId && body.image) {
    const hit = imageStore.resolveRunImage(path.join(RUNS_DIR, String(body.runId)), String(body.image));
    upscaleSource = { imageId: hit ? hit.id : null };
  }

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
  jobs[jobId].sourceImageId = upscaleSource.imageId || null;
  jobs[jobId].lineageOp = 'lanczos';
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

  const body = { ...(req.body || {}) };
  const resErr = resolveEditResources(body);
  if (resErr) return res.status(400).json({ error: resErr, gate: 'resources' });
  const srcInfo = resolveImageSource(body);
  cleanupRejectedSource(res, srcInfo);
  if (srcInfo.error) return res.status(404).json({ error: srcInfo.error, gate: 'source' });
  if (srcInfo.staged) { body.run_id = '20000101-000000-import'; body.init_image_file = 'import.png'; }

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

  let initImgPath = path.resolve(RUNS_DIR, runId, initImageFile);
  const relCheck = path.relative(RUNS_DIR, initImgPath);
  if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) {
    return res.status(403).json({ error: 'Init image path resolves outside runs directory' });
  }
  if (body.__initPath) initImgPath = body.__initPath;
  if (!fs.existsSync(initImgPath)) initImgPath = resolveRunImageForRead(runId, initImageFile) || initImgPath;
  if (!fs.existsSync(initImgPath)) {
    return res.status(404).json({ error: `Init image not found: ${runId}/${initImageFile}` });
  }

  const strength = body.strength !== undefined ? Number(body.strength) : 0.75;
  if (!Number.isFinite(strength) || strength < 0.01 || strength > 0.99) {
    return res.status(400).json({ error: 'strength must be a number between 0.01 and 0.99' });
  }

  // Optional source preparation: a temporary working copy (never the canonical file).
  let prepPath = null;
  if (body.source_prep && body.source_prep !== 'none') {
    const prep = prepareSource(initImgPath, String(body.source_prep));
    if (prep.error) return res.status(400).json({ error: prep.error });
    prepPath = prep.path;
    initImgPath = prep.path;
    body.width = prep.width; body.height = prep.height;
  }

  const params = normalizeGenerationBody(body);
  const genErr = validateGenerationParams(params);
  if (genErr) { if (prepPath) try { fs.unlinkSync(prepPath); } catch (_) {} return res.status(400).json({ error: genErr }); }

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
  jobs[jobId].sourceImageId = srcInfo.imageId || null;
  jobs[jobId].genRecord = editGenRecord(body, params, { strength });
  jobs[jobId].lineageOp = 'img2img';
  jobs[jobId].tempFiles = [prepPath, srcInfo.temp].filter(Boolean);
  runAction(jobId, 'bin/sdcpp-img2img.sh', args, params.save_prompts);

  res.json({ job_id: jobId, status: jobs[jobId].status });
});

// Inpaint — gated behind inpaintSupported; init image and mask must be within workflow dir.
// mask_data must be a base64-encoded PNG data URL; converted to L-mode grayscale and saved to mask-uploads/.
function handleInpaint(req, res) {
  if (!inpaintSupported) {
    return res.status(409).json({
      error: 'Inpaint is not currently supported.',
      gate: 'inpaint',
      supported: false,
      unlock_requires: 'Implement sdcpp-inpaint.sh and set inpaintSupported=true in server.js.'
    });
  }

  const body = { ...(req.body || {}) };
  const resErr = resolveEditResources(body);
  if (resErr) return res.status(400).json({ error: resErr, gate: 'resources' });
  const srcInfo = resolveImageSource(body);
  cleanupRejectedSource(res, srcInfo);
  if (srcInfo.error) return res.status(404).json({ error: srcInfo.error, gate: 'source' });
  if (srcInfo.staged) { body.run_id = '20000101-000000-import'; body.init_image_file = 'import.png'; }

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

  let initImgPath = path.resolve(RUNS_DIR, runId, initImageFile);
  const relCheck = path.relative(RUNS_DIR, initImgPath);
  if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) {
    return res.status(403).json({ error: 'Init image path resolves outside runs directory' });
  }
  if (body.__initPath) initImgPath = body.__initPath;
  if (!fs.existsSync(initImgPath)) initImgPath = resolveRunImageForRead(runId, initImageFile) || initImgPath;
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
    'mask = a',  // Preserve feathered alpha as grayscale; 0=keep, 255=inpaint.
    'if mask.getbbox():',
    '    mask.save(sys.argv[2])',
    '    print("ok %.5f %d %d" % ((sum(mask.histogram()) - mask.histogram()[0]) / float(mask.size[0] * mask.size[1]), mask.size[0], mask.size[1]))',
    'else:',
    '    print("blank")',
  ].join('\n');

  let maskConvResult = 'ok';
  try {
    maskConvResult = execFileSync('python3', ['-c', MASK_PY, maskRawPath, maskPath],
      { timeout: 15000 }).toString().trim();
    try { fs.unlinkSync(maskRawPath); } catch (_) {}
  } catch (e) {
    // Never let a failed conversion silently turn erased RGB pixels into a full mask.
    for (const f of [maskRawPath, maskPath, srcInfo.temp].filter(Boolean)) { try { fs.unlinkSync(f); } catch (_) {} }
    return res.status(400).json({ error: 'Could not convert mask alpha channel: ' + e.message, gate: 'mask-conversion' });
  }

  if (maskConvResult === 'blank') {
    return res.status(400).json({ error: 'Mask has no painted pixels. Paint over the region to inpaint first.', gate: 'mask-empty' });
  }
  const coverage = Number((maskConvResult.split(' ')[1]) || 0);
  if (coverage >= FULL_MASK_COVERAGE && body.confirm_full_mask !== true) {
    try { fs.unlinkSync(maskPath); } catch (_) {}
    return res.status(409).json({ error: 'The entire image is masked. This will regenerate nearly everything.', gate: 'mask-full', coverage, needs_confirmation: true });
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
    { ...params, run_id: runId, init_image_file: initImageFile, strength, detailed_from: body.detailed_from }, params.save_prompts
  ));
  jobSensitives[jobId] = sensitives;
  jobs[jobId].sourceImageId = srcInfo.imageId || null;
  jobs[jobId].genRecord = editGenRecord(body, params, { strength });
  jobs[jobId].lineageOp = (body.operation === 'detailer' || body.detailed_from) ? 'detailer' : 'inpaint';
  jobs[jobId].tempFiles = [maskPath, srcInfo.temp].filter(Boolean);
  jobs[jobId].outpaintComposite = { src: initImgPath, mask: maskPath, left: 0, top: 0, blur: 4, fit: true };
  runAction(jobId, 'bin/sdcpp-inpaint.sh', args, params.save_prompts);

  res.json({ job_id: jobId, status: jobs[jobId].status });
}
app.post('/api/actions/inpaint', handleInpaint);

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

  const body = { ...(req.body || {}) };
  const srcInfo = resolveImageSource(body);
  if (srcInfo.error) return res.status(404).json({ error: srcInfo.error, gate: 'source' });
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

  let initImgPath = path.resolve(RUNS_DIR, runId, initImageFile);
  const relCheck = path.relative(RUNS_DIR, initImgPath);
  if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) {
    return res.status(403).json({ error: 'Init image path resolves outside runs directory' });
  }
  if (body.__initPath) initImgPath = body.__initPath;
  if (!fs.existsSync(initImgPath)) initImgPath = resolveRunImageForRead(runId, initImageFile) || initImgPath;
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
  jobs[jobId].sourceImageId = srcInfo.imageId || null;
  jobs[jobId].lineageOp = 'esrgan';
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

// ---- Outpaint: expanded canvas + generated mask through the existing inpaint script.
// Seam strategy: new regions start from a blurred stretch of the source; the mask ramps linearly from 0 to 255 across an
// overlap band inside the source; after generation the untouched source is
// composited back with the same ramp (OUTPAINT_COMPOSITE_PY), so the interior
// is exact and the boundary is a graded blend instead of a hard edge.
const OUTPAINT_PREP_PY = [
  'import sys',
  'from PIL import Image, ImageFilter',
  'src, out_img, out_mask = sys.argv[1], sys.argv[2], sys.argv[3]',
  'l, t, W, H, ov = [int(x) for x in sys.argv[4:9]]',
  'im = Image.open(src).convert("RGB")',
  'w, h = im.size',
  // Background: extend only the outermost 8 px band of each extended side (continues
  // wall/table tones without copying objects), blur it, then place the source.
  'r = W - l - w; b = H - t - h; e = 8',
  'bg = im.resize((W, H), Image.BICUBIC).filter(ImageFilter.GaussianBlur(radius=max(8, min(W, H) // 12)))',
  'if l: bg.paste(im.crop((0, 0, e, h)).resize((l, h)), (0, t))',
  'if r: bg.paste(im.crop((w - e, 0, w, h)).resize((r, h)), (l + w, t))',
  'if t: bg.paste(im.crop((0, 0, w, e)).resize((w, t)), (l, 0))',
  'if b: bg.paste(im.crop((0, h - e, w, h)).resize((w, b)), (l, t + h))',
  'bg = bg.filter(ImageFilter.GaussianBlur(radius=6))',
  'bg.paste(im, (l, t))',
  'bg.save(out_img)',
  // Mask: 255 outside the source; inside, 0 except a linear ramp toward extended sides.
  'm = Image.new("L", (W, H), 255)',
  'inner = Image.new("L", (w, h), 0); px = inner.load()',
  'for y in range(h):',
  '    for x in range(w):',
  '        d = min([ov] + ([x] if l else []) + ([w - 1 - x] if r else []) + ([y] if t else []) + ([h - 1 - y] if b else []))',
  '        px[x, y] = int(255 * (1 - d / float(ov))) if d < ov else 0',
  'm.paste(inner, (l, t))',
  'm.save(out_mask)',
  'print("ok", W, H)',
].join('\n');

// After generation (outpaint and inpaint): restore the source wherever the mask
// did not ask for change, graded where the mask is soft. sd-cli re-encodes the
// whole image, so without this unmasked pixels drift (VAE round-trip).
const OUTPAINT_COMPOSITE_PY = [
  'import sys',
  'from PIL import Image, ImageFilter',
  'gen, src, mask = sys.argv[1], sys.argv[2], sys.argv[3]',
  'l, t = int(sys.argv[4]), int(sys.argv[5])',
  'o = Image.open(gen).convert("RGB"); s = Image.open(src).convert("RGB"); m = Image.open(mask).convert("L")',
  'if m.size != o.size: m = m.resize(o.size, Image.BILINEAR)',
  // Inpaint only ("fit"): the source is the whole canvas; outpaint keeps the source at its offset.
  'if len(sys.argv) > 7 and sys.argv[7] == "fit" and s.size != o.size: s = s.resize(o.size, Image.LANCZOS)',
  // Optional softening for hard (binary) masks so the restored edge blends.
  'blur = int(sys.argv[6]) if len(sys.argv) > 6 else 0',
  'if blur: m = m.filter(ImageFilter.GaussianBlur(radius=blur))',
  'keep = m.crop((l, t, l + s.width, t + s.height)).point(lambda v: 255 - v)',
  'o.paste(s, (l, t), keep)',
  'o.save(gen)',
  'print("composited")',
].join('\n');

function planOutpaint(dims, ext) {
  const round8 = v => Math.ceil(Math.max(0, Math.min(512, Math.round(Number(v) || 0))) / 8) * 8;
  const e = { left: round8(ext.left), right: round8(ext.right), top: round8(ext.top), bottom: round8(ext.bottom) };
  if (!(e.left + e.right + e.top + e.bottom)) return { error: 'Choose at least one side to extend.' };
  let W = dims.width + e.left + e.right;
  let H = dims.height + e.top + e.bottom;
  // SD1.5 wants multiples of 64: pad on an extended side.
  const padW = (64 - (W % 64)) % 64, padH = (64 - (H % 64)) % 64;
  if (padW) { if (e.right || !e.left) e.right += padW; else e.left += padW; W += padW; }
  if (padH) { if (e.bottom || !e.top) e.bottom += padH; else e.top += padH; H += padH; }
  if (W > 2048 || H > 2048) return { error: `Outpaint canvas ${W}x${H} exceeds 2048 px.` };
  return { ...e, width: W, height: H };
}

app.post('/api/actions/outpaint', (req, res) => {
  if (!inpaintSupported) return res.status(409).json({ error: 'Outpaint needs the inpaint backend, which is not available.', gate: 'inpaint' });
  const body = { ...(req.body || {}) };
  if (!body.image_id && !body.staged_id) return res.status(400).json({ error: 'image_id or staged_id is required' });
  const src = resolveImageSource(body.staged_id ? { staged_id: body.staged_id } : { image_id: body.image_id });
  cleanupRejectedSource(res, src);
  // Extension Prompt: describes only the NEW area; used instead of the main prompt when given.
  const usedExtensionPrompt = typeof body.extension_prompt === 'string' && !!body.extension_prompt.trim();
  if (usedExtensionPrompt) body.prompt = body.extension_prompt.trim();
  const resErr = resolveEditResources(body);
  if (resErr) return res.status(400).json({ error: resErr, gate: 'resources' });
  if (src.error) return res.status(404).json({ error: src.error, gate: 'source' });
  if (!src.dims) return res.status(400).json({ error: 'Outpaint source must be a PNG image.' });
  const plan = planOutpaint(src.dims, body);
  if (plan.error) return res.status(400).json({ error: plan.error });
  const strength = body.strength !== undefined ? Number(body.strength) : 0.85;
  if (!Number.isFinite(strength) || strength < 0.5 || strength > 0.99) return res.status(400).json({ error: 'strength must be between 0.5 and 0.99 for outpaint' });
  const params = normalizeGenerationBody({ ...body, width: plan.width, height: plan.height });
  const genErr = validateGenerationParams(params);
  if (genErr) return res.status(400).json({ error: genErr });

  const tag = `outpaint-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const prepPath = path.join(MASK_UPLOADS_DIR, `${tag}-canvas.png`);
  const maskPath = path.join(MASK_UPLOADS_DIR, `${tag}-mask.png`);
  try {
    execFileSync('python3', ['-c', OUTPAINT_PREP_PY, src.path, prepPath, maskPath, String(plan.left), String(plan.top), String(plan.width), String(plan.height), '48'], { timeout: 30000 });
  } catch (e) {
    for (const f of [prepPath, maskPath]) { try { fs.unlinkSync(f); } catch (_) {} }
    return res.status(500).json({ error: 'Could not prepare the outpaint canvas.', gate: 'outpaint-prep' });
  }
  const args = ['--init-img', prepPath, '--mask', maskPath, '--strength', String(strength), '--prompt', params.prompt,
    '--width', String(plan.width), '--height', String(plan.height)];
  if (params.negative_prompt) args.push('--negative', params.negative_prompt);
  if (params.steps) args.push('--steps', String(params.steps));
  if (params.cfg_scale) args.push('--cfg-scale', String(params.cfg_scale));
  if (params.sampler) args.push('--sampler', params.sampler);
  if (params.scheduler) args.push('--scheduler', params.scheduler);
  if (params.seed) args.push('--seed', String(params.seed));
  const sensitives = [params.prompt, params.negative_prompt].filter(Boolean);
  const summary = getRedactedCommandSummary('bin/sdcpp-inpaint.sh', args, sensitives) + ` (outpaint L${plan.left} R${plan.right} T${plan.top} B${plan.bottom})`;
  const jobId = createJob('outpaint', summary, sanitizeRequestParams({ ...params, image_id: body.image_id, strength, extend: { left: plan.left, right: plan.right, top: plan.top, bottom: plan.bottom } }, params.save_prompts));
  jobSensitives[jobId] = sensitives;
  Object.assign(jobs[jobId], { sourceImageId: body.image_id || null, lineageOp: 'outpaint', genRecord: editGenRecord(body, params, { strength, prompt_scope: usedExtensionPrompt ? 'extension' : undefined }), tempFiles: [prepPath, maskPath, src.temp].filter(Boolean), outpaintComposite: { src: src.path, mask: maskPath, left: plan.left, top: plan.top } });
  runAction(jobId, 'bin/sdcpp-inpaint.sh', args, params.save_prompts);
  res.json({ job_id: jobId, status: jobs[jobId].status, canvas: { width: plan.width, height: plan.height }, extend: { left: plan.left, right: plan.right, top: plan.top, bottom: plan.bottom } });
});

// ---- Image lineage + Keepers (metadata only; images are never copied) --------
function imageView(id) {
  const img = imageStore.resolveImage(id);
  if (!img) return null;
  const meta = imageMeta.get(id) || {};
  const src = imageSourceMap().get(id) || null;
  const dims = pngSize(img.path) || {};
  return {
    id, url: imageStore.imageUrl(id), path: img.path, width: dims.width, height: dims.height,
    runId: meta.runId || (src && src.runId) || null, keeper: !!meta.keeper, meta,
    parent: meta.parent && imageStore.resolveImage(meta.parent) ? meta.parent : null,
    children: imageMeta.children(id).filter(c => imageStore.resolveImage(c)),
    ancestors: imageMeta.ancestors(id).filter(c => imageStore.resolveImage(c)),
  };
}
app.get('/api/images/:id/meta', (req, res) => {
  const v = imageView(req.params.id);
  if (!v) return res.status(404).json({ error: 'Image not found' });
  res.json({ ...v, recall: EC.buildRecall(v) });
});
app.post('/api/images/:id/keeper', (req, res) => {
  if (!imageStore.resolveImage(req.params.id)) return res.status(404).json({ error: 'Image not found' });
  const keeper = imageMeta.setKeeper(req.params.id, !!(req.body && req.body.keeper));
  res.json({ id: req.params.id, keeper });
});
// Metadata-only flag for known test/regression artifacts: the file is never
// moved, copied or deleted; flagged images are hidden from default Library views.
app.post('/api/images/:id/test-artifact', (req, res) => {
  if (!imageStore.resolveImage(req.params.id)) return res.status(404).json({ error: 'Image not found' });
  const on = !!(req.body && req.body.test_artifact);
  const note = on ? String((req.body && req.body.note) || 'test artifact').slice(0, 200) : '';
  const cur = imageMeta.get(req.params.id) || {};
  imageMeta.record(req.params.id, { test_artifact: on ? true : undefined, note: note || undefined });
  if (!on && cur.test_artifact) { const all = imageMeta.all(); delete all[req.params.id].test_artifact; delete all[req.params.id].note; imageMeta.record(req.params.id, {}); }
  res.json({ id: req.params.id, test_artifact: on, note });
});
app.get('/api/library/images', (req, res) => {
  const filter = String(req.query.filter || 'all');
  const all = imageMeta.all();
  // "All" also covers legacy images that only have a run record (no lineage yet).
  const pool = filter === 'all' ? [...new Set([...Object.keys(all), ...imageSourceMap().keys()])] : Object.keys(all);
  let ids = pool.filter(id => imageStore.resolveImage(id));
  // Known test/regression artifacts stay on disk but are hidden unless asked for.
  if (req.query.show_test !== '1') ids = ids.filter(id => !(all[id] && all[id].test_artifact));
  if (filter === 'keepers') ids = ids.filter(id => all[id].keeper);
  else if (filter !== 'all') ids = ids.filter(id => all[id].operation === filter || all[id].target === filter);
  // Canonical ids start with the run timestamp, so id order is creation order.
  ids.sort((a, b) => b.localeCompare(a));
  res.json({ filter, total: ids.length, items: ids.slice(0, 200).map(imageView) });
});

// ---- Numbered Batch: parse preview + backend-owned queue ----------------------
app.post('/api/batch/parse', (req, res) => {
  const r = W.parseNumberedPrompts((req.body && req.body.text) || '');
  // Preview never echoes prompt bodies beyond what the client already holds.
  res.json({ ok: r.ok, count: r.entries.length, warnings: r.warnings, errors: r.errors,
    entries: r.entries.map(e => ({ index: e.index, number: e.number, title: e.title, chars: e.prompt.length, preview: e.prompt.slice(0, 160) })) });
});

// Durable queue state (runtime, gitignored). Prompts and settings.private are
// persisted only for queues created with save_prompts=true.
const queueRunner = W.createQueueRunner({
  file: path.join(STATE_DIR, 'queues.json'),
  runItem: (it, prompt, settings, q) => new Promise(resolve => {
    const priv = settings.private || {};
    const params = normalizeControlledGenerationBody({ ...settings.body, negative_prompt: priv.negative_prompt || '', prompt, operation: 'batch' });
    params.prompt = expandWildcards(params.prompt);
    const allTargetById = allControlledTargets();
    const err = validateControlledGenerationParams(params, allTargetById);
    if (err) return resolve({ ok: false, error: err, gate: 'validation' });
    const { jobId } = startControlledJob(params, allTargetById, {
      queueId: q.id, batchNumber: it.number,
      onDone: job => resolve({
        ok: job.status === 'PASS' || job.status === 'PARTIAL', jobId, results: job.results, seeds: job.seeds,
        gate: job.firstFailedGate, error: job.status === 'PASS' || job.status === 'PARTIAL' ? null : `failed at gate ${job.firstFailedGate || 'unknown'}`,
      }),
    });
    it.jobId = jobId;
    it.seeds = jobs[jobId].seeds || [];
  }),
});

app.post('/api/queues', (req, res) => {
  const body = req.body || {};
  const parsed = W.parseNumberedPrompts(body.text || '');
  if (!parsed.ok) return res.status(400).json({ error: parsed.errors[0] || 'No prompts parsed', errors: parsed.errors, warnings: parsed.warnings });
  const settings = { ...(body.settings || {}) };
  delete settings.prompt;
  const probe = normalizeControlledGenerationBody({ ...settings, prompt: 'x' });
  const err = validateControlledGenerationParams(probe, allControlledTargets());
  if (err) return res.status(400).json({ error: err });
  const total = parsed.entries.length * (probe.quantity || 1);
  if (total > LARGE_REQUEST_IMAGES && body.confirm_large !== true) {
    return res.status(409).json({ error: `This queue requests ${total} images (${parsed.entries.length} prompts × ${probe.quantity || 1}). Confirm to continue.`, needs_confirmation: true, total });
  }
  const negative = settings.negative_prompt || settings.negativePrompt || '';
  delete settings.negative_prompt; delete settings.negativePrompt;
  const view = queueRunner.create({
    entries: parsed.entries,
    settings: { target: probe.target, quantity: probe.quantity, width: probe.width, height: probe.height, steps: probe.steps, seed: probe.seed, save_prompts: probe.save_prompts, body: settings, private: { negative_prompt: negative } },
  });
  res.json(queueRunner.get(view.id));
});
app.get('/api/queues', (req, res) => res.json({ queues: queueRunner.list().map(q => ({ id: q.id, status: q.status, total: q.total, complete: q.complete, failed: q.failed, queued: q.queued, interrupted: q.interrupted, restored: q.restored, promptsMissing: q.promptsMissing, createdAt: q.createdAt, updatedAt: q.updatedAt })) }));
function queueWithProgress(v) {
  if (!v) return v;
  for (const it of v.items) {
    const j = it.jobId && jobs[it.jobId];
    if (it.status === 'RUNNING' && j) it.progress = DexProgress(j);
  }
  return v;
}
function DexProgress(job) {
  const stage = EC.deriveStage(job, sdLogTailForJob(job));
  return { percent: stage.percent, estimated: false, label: stage.label };
}
app.get('/api/queues/:id', (req, res) => {
  const v = queueWithProgress(queueRunner.get(req.params.id));
  if (!v) return res.status(404).json({ error: 'Queue not found (queues live in memory and do not survive a console restart).' });
  res.json(v);
});
app.post('/api/queues/:id/:action', (req, res) => {
  const { id, action } = req.params;
  const fns = { 'stop-after-current': queueRunner.stopAfterCurrent, resume: queueRunner.resume, 'retry-failed': queueRunner.retryFailed };
  if (!fns[action]) return res.status(404).json({ error: 'Unknown queue action' });
  // A restored queue without saved prompts can be resumed by re-pasting the same numbered text.
  let prompts;
  if (req.body && typeof req.body.text === 'string' && req.body.text.trim()) {
    const cur = queueRunner.get(id);
    if (!cur) return res.status(404).json({ error: 'Queue not found' });
    const parsed = W.parseNumberedPrompts(req.body.text);
    const byIndex = [...cur.items].sort((a, b) => a.queueIndex - b.queueIndex);
    if (!parsed.ok || parsed.entries.length !== byIndex.length || parsed.entries.some((e, i) => e.number !== byIndex[i].number || e.title !== byIndex[i].title)) {
      return res.status(409).json({ error: 'That text does not match this queue (same numbers and titles are required).' });
    }
    prompts = parsed.entries.map((e, i) => ({ queueIndex: byIndex[i].queueIndex, prompt: e.prompt }));
  }
  const v = fns[action](id, prompts);
  if (!v) return res.status(404).json({ error: 'Queue not found' });
  if (v.error) return res.status(409).json(v);
  res.json(v);
});
app.post('/api/queues/:id/items/:qi/:action', (req, res) => {
  const { id, action } = req.params;
  const qi = Number(req.params.qi);
  let v;
  if (action === 'remove') v = queueRunner.removeItem(id, qi);
  else if (action === 'up' || action === 'down') v = queueRunner.moveItem(id, qi, action);
  else return res.status(404).json({ error: 'Unknown item action' });
  if (!v) return res.status(404).json({ error: 'Queue not found' });
  if (v.error) return res.status(409).json(v);
  res.json(v);
});

// ---- Secure staging: temporary source/reference imports ----------------------
// Raw body upload; type decided by magic bytes, never by name or client path.
app.post('/api/staging', express.raw({ type: () => true, limit: '41mb' }), (req, res) => {
  const accept = String(req.query.accept || 'image,audio').split(',').filter(k => k === 'image' || k === 'audio');
  const r = staging.stage(req.body, { accept });
  if (r.error) return res.status(400).json({ error: r.error, gate: 'reference-invalid' });
  const { path: _p, file: _f, ...pub } = r;
  res.json({ ...pub, url: '/api/staging/' + r.id });
});
app.get('/api/staging/:id', (req, res) => {
  const st = staging.get(req.params.id);
  if (!st) return res.status(404).json({ error: 'Not found' });
  res.set('Cache-Control', 'no-store');
  res.type(st.mime).sendFile(st.path);
});
app.delete('/api/staging/:id', (req, res) => res.json({ removed: staging.remove(req.params.id) }));

// ---- Canonical media (artifact-id lookup only) ---------------------------------
app.post('/api/media/:id/keeper', (req, res) => {
  const k = mediaStore.setKeeper(req.params.id, !!(req.body && req.body.keeper));
  if (k === null) return res.status(404).json({ error: 'Not found' });
  res.json({ id: req.params.id, keeper: k });
});
app.get('/api/media/:id', (req, res) => {
  const id = req.params.id;
  const img = imageStore.resolveImage(id);
  if (img) return res.type(img.contentType).sendFile(img.path);
  const rec = mediaStore.resolve(id);
  if (!rec) return res.status(404).json({ error: 'Not found' });
  res.set('X-Content-Type-Options', 'nosniff');
  res.type(rec.mime).sendFile(rec.path);
});
app.get('/api/media/:id/download', (req, res) => {
  const rec = mediaStore.resolve(req.params.id);
  if (!rec) return res.status(404).json({ error: 'Not found' });
  res.set('Cache-Control', 'no-store');
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Content-Disposition', `attachment; filename="${rec.artifact_id}"`);
  res.type(rec.mime).sendFile(rec.path);
});

// ---- Unified Media Library ---------------------------------------------------------
// Images come from the canonical image store (+ lineage/keeper metadata);
// voice/music/video from the generic media registry. No duplicate image records.
app.get('/api/library', (req, res) => {
  const kind = String(req.query.kind || 'all');
  const showTest = req.query.show_test === '1';
  const meta = imageMeta.all();
  let items = [];
  if (kind === 'all' || kind === 'image' || kind === 'keepers') {
    const ids = [...new Set([...Object.keys(meta), ...imageSourceMap().keys()])].filter(id => imageStore.resolveImage(id))
      .filter(id => showTest || !(meta[id] && meta[id].test_artifact))
      .filter(id => kind !== 'keepers' || (meta[id] && meta[id].keeper));
    ids.sort((a, b) => b.localeCompare(a));
    items = ids.slice(0, 200).map(id => ({ artifact_id: id, kind: 'image', url: imageStore.imageUrl(id), keeper: !!(meta[id] && meta[id].keeper),
      operation: meta[id] && meta[id].operation, model: meta[id] && meta[id].target, seed: meta[id] && meta[id].seed, parent: meta[id] && meta[id].parent,
      width: meta[id] && meta[id].width, height: meta[id] && meta[id].height, test_artifact: !!(meta[id] && meta[id].test_artifact) }));
  }
  if (kind !== 'image') {
    const recs = mediaStore.list(kind === 'all' || kind === 'keepers' ? null : kind).filter(r => kind !== 'keepers' || r.keeper);
    // Only operational metadata is exposed; no generation text is stored in media records.
    items = items.concat(recs.map(r => ({ artifact_id: r.artifact_id, kind: r.kind, url: r.safe_url, download_url: r.download_url, mime: r.mime, duration: r.duration, keeper: r.keeper, model: r.model, seed: r.seed,
      worker: r.worker, bytes: r.bytes, created_at: r.created_at, job_id: r.job_id, operation: r.meta && r.meta.operation, reference_used: !!(r.meta && r.meta.reference_used) })));
  }
  const counts = { image: imageSourceMap().size, voice: mediaStore.list('voice').length, music: mediaStore.list('music').length, video: mediaStore.list('video').length };
  res.json({ kind, total: items.length, counts, items });
});

// ---- Workers / resources / generic jobs ----------------------------------------------
const MEDIA_EVIDENCE_FILE = path.join(STATE_DIR, 'media-evidence.json');
function readMediaEvidence() { try { return JSON.parse(fs.readFileSync(MEDIA_EVIDENCE_FILE, 'utf8')); } catch (_) { return {}; } }
const workerRegistry = M.createWorkerRegistry({
  getEvidence: readMediaEvidence,
  imageAdapters: {
    mflux: {
      probe: a => ({ architecture_available: true, runtime_available: a.mfluxRuntime !== false, model_available: a.mfluxModel !== false, enabled: true, proven: true, state: a.mfluxRuntime === false || a.mfluxModel === false ? 'MODEL/RUNTIME MISSING' : 'PROVEN' }),
      capabilities: () => ({ generate: true, cancel_supported: false, cancel_reason: 'Tailscale SSH does not reliably propagate termination to the remote MFLUX process; not proven safe.' }),
    },
    sdcpp: {
      probe: a => ({ architecture_available: true, runtime_available: a.sdCli !== false, model_available: a.sd15Model !== false, enabled: true, proven: true, state: a.sdCli === false ? 'RUNTIME MISSING' : 'PROVEN' }),
      capabilities: () => ({ generate: true, img2img: true, inpaint: true, outpaint: true, hiresRefine: true, nativeBatch: true, controlNet: false, controlNet_state: 'ENGINE SUPPORTED — MODEL ASSET MISSING', cancel_supported: false, cancel_reason: 'Remote sd-cli termination via Tailscale SSH not proven safe; use Stop After Current.' }),
    },
  },
});
function workerAssets() {
  const a = assetCache || {};
  return { ...a, ...(a.dormant || {}) };
}
const mediaBridge = createMediaBridge({ jobStore, arbiter, mediaStore, staging, sshTarget: SSH_TARGET_NAME, evidenceFile: MEDIA_EVIDENCE_FILE, log: m => console.log(m) });
// Orphaned remote job dirs (interrupted by a console restart) are removed once
// they are older than 60 min, i.e. after any still-running remote generator
// has finished writing. Runs at startup and hourly.
setTimeout(() => mediaBridge.sweepRemoteOrphans(60).catch(() => {}), 15000).unref();
setInterval(() => mediaBridge.sweepRemoteOrphans(60).catch(() => {}), 60 * 60 * 1000).unref();
// Persistent voice profiles, long-form speech and audio-drama production (voice-routes.js).
const voiceModule = require('./voice-routes').registerVoiceRoutes(app, {
  stateDir: STATE_DIR, jobStore, mediaStore, staging, mediaBridge, log: m => console.log(m),
  probeFor: id => workerRegistry.get(id).probe(workerAssets()),
  // Optional local intelligent parse: strict-schema JSON from the managed Ollama tunnel (never rewrites dialogue; see drama.js).
  llmChat: async messages => {
    const { model, error } = await resolveOllamaModel();
    if (error) throw new Error(error);
    const r = await ollamaRequest('/api/chat', { model, stream: false, format: 'json', keep_alive: 0, options: { temperature: 0 }, messages }, 180000);
    if (!r.ok) throw new Error(r.error || 'ollama request failed');
    return r.json && r.json.message && r.json.message.content || '';
  },
});
app.get('/api/workers', (req, res) => res.json({ workers: workerRegistry.describe(workerAssets()), options: { kokoro_voices: KOKORO_VOICES, languages: require('./media-bridge').LANGS } }));
app.get('/api/resources', (req, res) => res.json(arbiter.state()));
app.get('/api/generic-jobs/:id', (req, res) => {
  const g = jobStore.get(req.params.id);
  if (!g) return res.status(404).json({ error: 'Job not found' });
  const rs = arbiter.state();
  const artifacts = g.artifacts.map(id => { const r = mediaStore.resolve(id); return r ? { artifact_id: id, url: r.safe_url, kind: r.kind, duration: r.duration, sha256: r.sha256, bytes: r.bytes, seed: r.seed } : { artifact_id: id }; });
  res.json({ ...g, artifacts_detail: artifacts, waiting: g.status === 'QUEUED' ? { position: arbiter.position(g.job_id), blocked_reason: rs.blocked_reason } : null });
});
app.get('/api/generic-jobs', (req, res) => res.json({ jobs: jobStore.list({ media_kind: req.query.kind || undefined, status: req.query.status || undefined, limit: 100 }) }));

// ---- Local WorldGen ----------------------------------------------------------
// World projects keep durable lineage/stage truth; the bridge owns only the
// heavy remote execution and never promotes SSH exit status to success.
const worldBridge = createWorldBridge({ jobStore, arbiter, staging, mediaStore, worldStore, imageStore, stateDir: STATE_DIR, sshTarget: SSH_TARGET_NAME, log: m => console.log(m) });
const asset3dBridge = createAsset3dBridge({ jobStore, arbiter, staging, mediaStore, imageStore, stateDir: STATE_DIR, sshTarget: SSH_TARGET_NAME, log: m => console.log(m) });
app.get('/api/3d/workers', async (req, res) => {
  try { res.json(await asset3dBridge.workers()); } catch (error) { res.status(503).json({ error: '3D worker probe failed', detail: String(error.message).slice(0, 180) }); }
});
app.post('/api/3d/jobs', (req, res) => {
  const body = req.body || {};
  const result = asset3dBridge.start(String(body.mode || ''), { sourceArtifactId: body.sourceArtifactId || body.imageId || body.image });
  if (result.error) return res.status(result.status || 400).json(result);
  res.status(202).json(result);
});
app.post('/api/3d/open-in-blender', (req, res) => {
  const result = asset3dBridge.openInBlender(req.body && req.body.artifact_id);
  if (result.error) return res.status(result.status || 400).json(result);
  res.json(result);
});
app.get('/api/world/workers', async (req, res) => {
  try { res.json(await worldBridge.workers()); } catch (error) { res.status(503).json({ error: 'world worker probe failed', detail: String(error.message).slice(0, 180) }); }
});
app.get('/api/world/projects', (req, res) => res.json({ projects: worldStore.list() }));
app.get('/api/world/projects/:id', (req, res) => {
  const p = worldStore.get(req.params.id);
  if (!p) return res.status(404).json({ error: 'World project not found' });
  const artifacts = {};
  for (const [slot, value] of Object.entries(p.artifacts || {})) {
    const ids = Array.isArray(value) ? value : value ? [value] : [];
    artifacts[slot] = ids.map(id => { const r = mediaStore.resolve(typeof id === 'string' ? id : id.artifact_id); return r ? { artifact_id: r.artifact_id, url: r.safe_url, mime: r.mime, bytes: r.bytes, sha256: r.sha256 } : id; });
  }
  const first = slot => Array.isArray(artifacts[slot]) ? artifacts[slot][0] : artifacts[slot];
  const viewerArtifact = first('finalPly') || first('runtimeSplat') || first('coarseGeometry') || first('perViewSplats');
  res.json({ ...p, artifacts, viewerArtifact: viewerArtifact || null });
});
app.patch('/api/world/projects/:id', (req, res) => {
  const p = worldStore.get(req.params.id);
  if (!p) return res.status(404).json({ error: 'World project not found' });
  if (req.body && req.body.viewerState && typeof req.body.viewerState === 'object') worldStore.setViewer(p.id, req.body.viewerState);
  res.json(worldStore.get(p.id));
});
app.post('/api/world/projects', (req, res) => {
  const body = req.body || {};
  const result = worldBridge.start(String(body.mode || 'quick3d'), { sourceArtifactId: body.sourceArtifactId || body.imageId || body.image, parameters: body.parameters || {}, saveText: body.save_prompts === true });
  if (result.error) return res.status(result.status || 400).json(result);
  res.status(202).json(result);
});
app.post('/api/world/projects/:id/retry', (req, res) => {
  const p = worldStore.get(req.params.id);
  if (!p) return res.status(404).json({ error: 'World project not found' });
  const result = worldBridge.start(p.mode, { sourceArtifactId: p.sourceArtifactId, parameters: p.parameters });
  if (result.error) return res.status(result.status || 400).json(result);
  res.status(202).json({ ...result, retriedFrom: p.id });
});

// Voice / Music / Video generation: capability-gated BEFORE any lease is taken.
// Dormant workers fail immediately and truthfully; nothing is installed or downloaded.
app.post('/api/media/generate', (req, res) => {
  const body = req.body || {};
  const kind = String(body.media_kind || '');
  const w = workerRegistry.get(String(body.worker || ''));
  if (!['voice', 'music', 'video'].includes(kind)) return res.status(400).json({ error: 'media_kind must be voice, music or video', gate: 'worker-unavailable' });
  if (!w || w.media_kind !== kind) return res.status(400).json({ error: 'Unknown worker for ' + kind, gate: 'worker-unavailable' });
  const probe = w.probe(workerAssets());
  if (w.bridged) {
    // Real execution: validation + install gating happen before any lease.
    const r = mediaBridge.start(w.id, body, { probe, saveText: body.save_prompts === true });
    if (r.error) return res.status(r.status || 400).json({ error: r.error, gate: r.gate, worker: w.id });
    return res.json({ job_id: r.job_id, status: r.status, worker: w.id });
  }
  const job = jobStore.create({ media_kind: kind, operation: String(body.operation || 'generate').slice(0, 40), worker_id: w.id, resource_class: 'heavy', params: body, persist_text: body.save_prompts === true });
  const gate = !probe.runtime_available ? 'runtime-missing' : !probe.model_available ? 'model-missing' : 'worker-unavailable';
  if (!probe.enabled) {
    // Truthful: installed assets without an execution bridge are not "missing".
    const msg = gate === 'worker-unavailable' ? 'Installed but execution bridge not enabled/proven' : gate === 'model-missing' ? 'Model not installed' : 'Runtime/model not installed';
    jobStore.transition(job.job_id, 'FAILED', { first_failed_gate: gate, error: `${w.label}: ${msg}` });
    return res.status(409).json({ error: msg, gate, worker: w.id, job_id: job.job_id, state: probe.state });
  }
  jobStore.transition(job.job_id, 'FAILED', { first_failed_gate: 'worker-unavailable', error: 'no execution bridge for this worker yet' });
  res.status(409).json({ error: 'Worker has no execution bridge yet', gate: 'worker-unavailable', job_id: job.job_id });
});

// ---- Active jobs (reload recovery) ------------------------------------------
app.get('/api/jobs', (req, res) => {
  const active = Object.values(jobs).filter(j => j.status === 'queued' || j.status === 'running');
  res.json({ jobs: active.map(j => ({ id: j.id, commandAction: j.commandAction, status: j.status, createdAt: j.createdAt, progress: j.progress || null })) });
});

// ---- Preflight (cheap, read-only) ---------------------------------------------
async function freeBytes(dir) {
  try { const st = await fs.promises.statfs(dir); return st.bavail * st.bsize; } catch (_) { return null; }
}
app.post('/api/preflight', async (req, res) => {
  const body = req.body || {};
  const prompts = Math.max(1, Number(body.prompts) || 1);
  const quantity = Math.max(1, Number(body.quantity) || 1);
  const total = prompts * quantity;
  const target = CONTROLLED_TARGET_BY_ID[body.target] || allControlledTargets()[body.target];
  const rows = [];
  rows.push({ check: 'Local backend', state: 'PASS', detail: 'operator console responding' });
  if (!target) rows.push({ check: 'Target', state: 'FAIL', detail: 'unknown target' });
  const assets = assetCache && Date.now() - Date.parse(assetCache.checkedAt) < 60000 ? assetCache : await refreshAssets();
  rows.push({ check: 'Big Mac', state: assets.reachable ? 'PASS' : 'FAIL', detail: assets.reachable ? 'reachable over ssh westcat' : 'Big Mac unreachable (ssh westcat)' });
  if (target) {
    const rt = targetRuntime(target, assets, TARGET_MODELS);
    rows.push({ check: 'Target runtime/model', state: rt === 'available' ? 'PASS' : rt === 'unknown' ? 'WARN' : 'FAIL', detail: `${target.label}: ${rt}` });
  }
  let writable = true;
  try { fs.accessSync(imageStore.root, fs.constants.W_OK); } catch (_) { writable = false; }
  rows.push({ check: 'Image store', state: writable ? 'PASS' : 'FAIL', detail: imageStore.root + (writable ? ' writable' : ' NOT writable') });
  const free = await freeBytes(imageStore.root);
  const needed = total * 3 * 1024 * 1024;
  rows.push({ check: 'Free space', state: free == null ? 'WARN' : free > needed + 2e9 ? 'PASS' : 'FAIL', detail: free == null ? 'unknown' : `${(free / 1e9).toFixed(1)} GB free` });
  const ok = rows.every(r => r.state !== 'FAIL');
  res.json({ ok, prompts, quantity, total, needsConfirmation: total > LARGE_REQUEST_IMAGES, summary: `${prompts} prompt${prompts > 1 ? 's' : ''} × ${quantity} = ${total} image${total > 1 ? 's' : ''}`, rows });
});

// Read-only diagnosis: missing history stays missing; no automatic reconciliation writes.
function canonicalIntegrity() {
  let refs = [];
  try { const data = JSON.parse(fs.readFileSync(path.join(STATE_DIR, 'image-meta.json'), 'utf8')); refs = Object.keys(data.images || {}).map(image_id => ({image_id, metadata_path:'image-meta.json'})); } catch (_) {}
  return imageStore.inspectIntegrity({ runsRoot: RUNS_DIR, references: refs });
}
app.get('/api/storage/integrity', (req, res) => {
  try { res.json(canonicalIntegrity()); } catch (e) { res.status(500).json({error:e.message,code:'storage-inspection-failed'}); }
});
app.get('/api/cleanup/ownership', (req, res) => {
  res.json({ resources: mediaBridge.inspectCleanup(), pending_publications: canonicalIntegrity().pending_publications || [], scope: 'exact-project-owned-resources' });
});
app.post('/api/cleanup/reconcile', async (req, res) => {
  try {
    const { job_id, resource_id } = req.body || {};
    if (typeof job_id !== 'string' || typeof resource_id !== 'string') return res.status(400).json({error:'job_id and resource_id required'});
    res.json(await mediaBridge.reconcileCleanup(job_id, resource_id));
  } catch (e) { res.status(409).json({ error:e.message, code:'cleanup-reconcile-rejected' }); }
});
// ---- Doctor: read-only health check (never generates) ------------------------
app.get('/api/doctor', async (req, res) => {
  const rows = [];
  const add = (check, state, detail) => rows.push({ check, state, detail });
  add('Operator console', 'PASS', `responding (pid ${process.pid})`);
  add('Loopback bind', HOST === '127.0.0.1' ? 'PASS' : 'FAIL', `${HOST}:${PORT}`);
  const cleanup = mediaBridge.inspectCleanup();
  add('Owned temporary cleanup', cleanup.some(r => r.state !== 'succeeded') ? 'WARN' : 'PASS', `${cleanup.length} tracked resources · read-only /api/cleanup/ownership`);
  try {
    const inventory = canonicalIntegrity();
    const classification = inventory.classification || {};
    const current = Number.isInteger(classification.current_problems)
      ? classification.current_problems
      : ['missing','broken','digest-mismatch','pending','unknown'].reduce((n,k)=>n+(inventory.counts[k]||0),0);
    const historical = classification.historical_missing_references || 0;
    add('Canonical storage integrity', current ? 'WARN' : 'PASS',
      `current problems ${current} · valid ${inventory.counts.valid || 0} · historical missing references ${historical} · read-only /api/storage/integrity`);
  } catch(e) { add('Canonical storage integrity','WARN',e.message); }
  try { fs.accessSync(imageStore.root, fs.constants.R_OK | fs.constants.W_OK); add('Canonical image root', 'PASS', imageStore.root + ' readable/writable'); }
  catch (_) { add('Canonical image root', 'FAIL', imageStore.root + ' not accessible'); }
  const a = await refreshAssets();
  if (!a.reachable) add('Big Mac', 'FAIL', 'unreachable via ssh ' + SSH_TARGET_NAME);
  else {
    add('Big Mac', 'PASS', 'reachable via ssh ' + SSH_TARGET_NAME);
    add('Big Mac identity', a.identity === 'bigmac@bigmac' ? 'PASS' : 'WARN', a.identity || 'unknown');
    add('wc2tb mounted', a.wc2tb ? 'PASS' : 'FAIL', '/Volumes/wc2tb' + (a.wc2tb ? '' : ' not mounted'));
    add('MFLUX runtime', a.mfluxRuntime ? 'PASS' : 'FAIL', 'internal venv');
    add('MFLUX model (FLUX.2 Klein 4B 4-bit)', a.mfluxModel ? 'PASS' : 'FAIL', '$HOME/Library/Caches/DexDiffusion/mflux/flux2-klein-4b-4bit');
    add('SDCPP sd-cli', a.sdCli ? 'PASS' : 'FAIL', 'stable-diffusion.cpp 7f0e728');
    add('SD1.5 model', a.sd15Model ? 'PASS' : 'FAIL', '/Volumes/wc2tb/ImageGen/checkpoints/sd15/v1-5-pruned-emaonly.safetensors');
    add('Real-ESRGAN model', a.esrganModel ? 'PASS' : 'FAIL', 'RealESRGAN_x4plus.pth');
    const missing = Object.entries(a.models || {}).filter(([, v]) => v === false).length;
    add('Configured SDCPP targets', missing ? 'WARN' : 'PASS', missing ? `${missing} configured model file(s) absent (targets report model-missing)` : 'all present');
  }
  try {
    const si = await getSystemInfo({ targets: liveModelTargets(), build: { ...getBuildInfo(), sshTarget: SSH_TARGET_NAME } });
    const ts = si.network && si.network.tailscale;
    if (!ts || !ts.available) add('Tailscale Serve', 'WARN', (ts && ts.reason) || 'unknown');
    else if (!ts.serveConfigured) add('Tailscale Serve', 'WARN', ts.reason || 'not configured');
    else {
      add('Tailscale Serve', 'PASS', `${ts.url} (${ts.scope})`);
      add('DexDiffusion Funnel absent', ts.funnel ? 'FAIL' : 'PASS', ts.funnel ? 'Funnel is ENABLED for DexDiffusion' : 'tailnet-only');
    }
  } catch (_) { add('Tailscale Serve', 'WARN', 'probe failed'); }
  // Media-neutral workstation checks (read-only).
  try { const n = jobStore.list({ limit: 100000 }).length; add('Generic job store', 'PASS', `${n} durable job records (${path.basename(jobStore.file)})`); }
  catch (_) { add('Generic job store', 'FAIL', 'unreadable'); }
  for (const k of M.MEDIA_KINDS) {
    const root = mediaStore.roots[k];
    try { fs.accessSync(root, fs.constants.W_OK); add(`Media root · ${k}`, 'PASS', root); } catch (_) { add(`Media root · ${k}`, k === 'video' ? 'WARN' : 'FAIL', root + ' not writable'); }
  }
  try { const st = staging.stats(); fs.accessSync(st.root, fs.constants.W_OK); add('Reference staging', 'PASS', `${st.files} staged file(s), 24 h expiry`); } catch (_) { add('Reference staging', 'FAIL', 'staging dir not writable'); }
  const rs = arbiter.state();
  add('Heavy-compute lease', 'PASS', `${rs.group} capacity ${rs.capacity}; owner ${rs.owner ? rs.owner.label : 'none'}; waiting ${rs.waiting.length}`);
  add('External heavy load (Big Mac)', rs.external.occupied ? 'WARN' : 'PASS', rs.external.occupied ? rs.external.detail : (rs.external.checkedAt ? 'none detected (ollama ps)' : 'not yet checked'));
  for (const w of workerRegistry.describe(workerAssets())) {
    if (w.bridged) add(`Worker · ${w.label} (${w.media_kind})`, w.proven ? 'PASS' : w.enabled ? 'WARN' : 'FAIL',
      `${w.state}; enabled ${w.enabled}; proven ${w.proven}${w.lastPass ? ' (last proof ' + String(w.lastPass.at).slice(0, 16) + ')' : ''}`);
    else if (w.dormant) add(`Worker · ${w.label} (${w.media_kind})`, 'WARN', w.installed
      ? `AVAILABLE / INSTALLED — execution bridge disabled/unproven (enabled ${w.enabled}, proven ${w.proven})`
      : `${w.state}; enabled ${w.enabled}; proven ${w.proven} — not installed`);
    else add(`Worker · ${w.label}`, w.runtime_available && w.model_available ? 'PASS' : 'FAIL', w.state);
  }
  add('Unified Media Library', 'PASS', `images ${imageSourceMap().size}, voice ${mediaStore.list('voice').length}, music ${mediaStore.list('music').length}, video ${mediaStore.list('video').length}`);
  const worst = rows.some(r => r.state === 'FAIL') ? 'FAIL' : rows.some(r => r.state === 'WARN') ? 'WARN' : 'PASS';
  res.json({ overall: worst, checkedAt: new Date().toISOString(), rows });
});

// ---- V12 Workstation Operational Projection Helper --------------------------
function getOperationalJobSnapshot() {
  const activeJobs = [];
  const queuedJobs = [];
  const recentJobs = [];

  // 1. Gather all jobs from in-memory and durable jobStore
  const allDurable = jobStore ? jobStore.list({ limit: 100 }) : [];
  const seenIds = new Set();

  // In-memory active image jobs
  for (const [id, j] of Object.entries(jobs)) {
    seenIds.add(id);
    const est = timingStore ? timingStore.getEstimate(j.commandAction === 'upscale' ? 'local' : (j.requestParams && j.requestParams.target) || 'sdcpp', j.commandAction) : null;
    const proj = projectOperationalJob({
      id: j.id,
      mediaKind: 'image',
      operation: j.commandAction,
      label: j.commandSummary || j.commandAction,
      worker: (j.requestParams && j.requestParams.target) || 'sdcpp',
      target: (j.requestParams && j.requestParams.target) || null,
      status: j.status,
      progress: j.progress,
      createdAt: j.createdAt,
      startedAt: j.startedAt || j.createdAt,
      completedAt: j.completedAt,
      queuePosition: j.waitingForLease ? arbiter.position(j.id) : null,
      resourceClass: HEAVY_ACTIONS.has(j.commandAction) ? 'heavy' : 'light',
      resourceState: j.waitingForLease ? 'WAITING_LEASE' : (j.status === 'running' ? 'RUNNING' : 'QUEUED'),
      canCancel: ['queued', 'running'].includes(j.status),
      firstFailedGate: j.firstFailedGate,
      artifactIds: (j.results || []).filter(r => r.imageId).map(r => r.imageId),
      estimatedDurationMs: est && est.available ? est.estimatedDurationMs : null
    });

    if (['queued'].includes(j.status)) queuedJobs.push(proj);
    else if (['running'].includes(j.status)) activeJobs.push(proj);
    else recentJobs.push(proj);
  }

  // Durable media & past image jobs
  for (const g of allDurable) {
    if (seenIds.has(g.job_id)) continue;
    seenIds.add(g.job_id);
    const proj = projectOperationalJob({
      id: g.job_id,
      mediaKind: g.media_kind,
      operation: g.operation,
      label: g.operation,
      worker: g.worker_id,
      target: g.model_id,
      status: g.status,
      createdAt: g.created_at,
      startedAt: g.started_at,
      completedAt: g.completed_at,
      queuePosition: g.status === 'QUEUED' ? arbiter.position(g.job_id) : null,
      resourceClass: g.resource_class,
      resourceState: g.status === 'QUEUED' ? 'WAITING_LEASE' : g.status,
      canCancel: ['QUEUED', 'RUNNING', 'TRANSFERRING'].includes(g.status),
      firstFailedGate: g.first_failed_gate,
      artifactIds: g.artifacts || []
    });

    if (g.status === 'QUEUED') queuedJobs.push(proj);
    else if (['RUNNING', 'TRANSFERRING'].includes(g.status)) activeJobs.push(proj);
    else recentJobs.push(proj);
  }

  return {
    active: activeJobs,
    queue: queuedJobs,
    recent: recentJobs.slice(0, 30),
    resources: arbiter.state(),
    timing: {
      queueWait: timingStore ? timingStore.estimateQueueWait(queuedJobs, activeJobs[0] || null) : null
    }
  };
}

// ---- F01: Server-Sent Events Control Plane -----------------------------------
app.get('/api/events', (req, res) => {
  eventBus.handleSseConnection(req, res, getOperationalJobSnapshot);
});

// ---- F02: Global Operational Snapshot & Job Center Data -----------------------
app.get('/api/operations/snapshot', (req, res) => {
  res.json(getOperationalJobSnapshot());
});

// ---- F14: Safe Job Cancellation Route ----------------------------------------
app.post('/api/jobs/:id/cancel', async (req, res) => {
  const jobId = req.params.id;
  const reason = (req.body && req.body.reason) || 'Cancelled by user';

  // Check in-memory image job
  const job = jobs[jobId];
  if (job && (job.status === 'queued' || job.status === 'running')) {
    job.status = 'CANCELLED';
    job.completedAt = Date.now();
    job.firstFailedGate = 'user-cancelled';
    job.stderr += '\nJob cancelled by user request.';
    if (job.activeChildPid) {
      try { process.kill(job.activeChildPid, 'SIGTERM'); } catch (_) {}
    }
  }

  const result = await cancelManager.cancelJob(jobId, { reason });
  res.json(result);
});

// ---- F04: Indexed Library Endpoints ------------------------------------------
app.get('/api/library/v2/items', (req, res) => {
  const filter = req.query.filter || 'all';
  const collectionId = req.query.collection_id || null;
  const operation = req.query.operation || null;
  const model = req.query.model || null;
  const showTest = req.query.show_test === '1';
  const search = req.query.search || '';
  const sort = req.query.sort || 'newest';
  const offset = parseInt(req.query.offset, 10) || 0;
  const limit = Math.min(100, parseInt(req.query.limit, 10) || 50);

  const results = libraryIndex.query({
    filter,
    collectionId,
    operation,
    model,
    showTest,
    search,
    sort,
    offset,
    limit
  });

  // Attach thumbnail URLs to returned items
  const itemsWithUrls = results.items.map(it => {
    return {
      ...it,
      imageUrl: imageStore.imageUrl(it.id),
      thumbnailUrl: thumbnailService.hasThumbnail(it.id) ? `/api/thumbnails/${encodeURIComponent(it.id)}` : imageStore.imageUrl(it.id)
    };
  });

  res.json({
    ...results,
    items: itemsWithUrls
  });
});

app.post('/api/library/rebuild', (req, res) => {
  const r = libraryIndex.rebuild();
  eventBus.publish('library.changed', { action: 'rebuild', count: r.count });
  res.json(r);
});

// ---- F04: Thumbnail Route ----------------------------------------------------
app.get('/api/thumbnails/:id', (req, res) => {
  const imageId = req.params.id;
  // Security: verify image belongs to imageStore
  const canonical = imageStore.resolveImage(imageId);
  if (!canonical) return res.status(404).send('Image not found in canonical store');

  if (thumbnailService.hasThumbnail(imageId)) {
    return res.sendFile(thumbnailService.getThumbnailFile(imageId));
  }

  // Generate on demand if available
  thumbnailService.generateThumbnail(imageId, (err, thumbPath) => {
    if (!err && thumbPath && fs.existsSync(thumbPath)) {
      return res.sendFile(thumbPath);
    }
    // Fallback: send full canonical original
    res.sendFile(canonical.path || canonical);
  });
});

// ---- F05: Collections Endpoints ----------------------------------------------
app.get('/api/collections', (req, res) => {
  res.json({ collections: collectionStore.list() });
});

app.post('/api/collections', (req, res) => {
  try {
    const col = collectionStore.create(req.body || {});
    res.json({ ok: true, collection: col });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/collections/:id', (req, res) => {
  const col = collectionStore.get(req.params.id);
  if (!col) return res.status(404).json({ error: 'Collection not found' });
  res.json({ collection: col });
});

app.put('/api/collections/:id', (req, res) => {
  try {
    const col = collectionStore.update(req.params.id, req.body || {});
    if (!col) return res.status(404).json({ error: 'Collection not found' });
    res.json({ ok: true, collection: col });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/collections/:id', (req, res) => {
  const ok = collectionStore.remove(req.params.id);
  res.json({ ok });
});

app.post('/api/collections/:id/artifacts', (req, res) => {
  const ids = req.body && req.body.artifactIds;
  const col = collectionStore.addArtifacts(req.params.id, ids || []);
  if (!col) return res.status(404).json({ error: 'Collection not found' });
  res.json({ ok: true, collection: col });
});

app.delete('/api/collections/:id/artifacts', (req, res) => {
  const ids = req.body && req.body.artifactIds;
  const col = collectionStore.removeArtifacts(req.params.id, ids || []);
  if (!col) return res.status(404).json({ error: 'Collection not found' });
  res.json({ ok: true, collection: col });
});

// ---- F13: Unified Recipes Endpoints ------------------------------------------
app.get('/api/recipes', (req, res) => {
  const category = req.query.category || null;
  const search = req.query.search || '';
  res.json({ recipes: recipeStore.list({ category, search }) });
});

app.post('/api/recipes', (req, res) => {
  try {
    const r = recipeStore.create(req.body || {});
    res.json({ ok: true, recipe: r });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/recipes/:id', (req, res) => {
  const r = recipeStore.get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Recipe not found' });
  res.json({ recipe: r });
});

app.put('/api/recipes/:id', (req, res) => {
  try {
    const r = recipeStore.update(req.params.id, req.body || {});
    if (!r) return res.status(404).json({ error: 'Recipe not found' });
    res.json({ ok: true, recipe: r });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/recipes/:id', (req, res) => {
  const ok = recipeStore.remove(req.params.id);
  res.json({ ok });
});

app.post('/api/recipes/:id/duplicate', (req, res) => {
  const r = recipeStore.duplicate(req.params.id, req.body && req.body.name);
  if (!r) return res.status(404).json({ error: 'Recipe not found' });
  res.json({ ok: true, recipe: r });
});

app.post('/api/recipes/import-legacy', (req, res) => {
  const styles = req.body && req.body.styles;
  const result = recipeStore.importLegacyStyles(styles || []);
  res.json({ ok: true, ...result });
});

// ---- F11: Declarative Macros Endpoints ----------------------------------------
app.get('/api/macros', (req, res) => {
  res.json({ macros: macroStore.list() });
});

app.post('/api/macros', (req, res) => {
  try {
    const m = macroStore.create(req.body || {});
    res.json({ ok: true, macro: m });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/macros/:id', (req, res) => {
  const m = macroStore.get(req.params.id);
  if (!m) return res.status(404).json({ error: 'Macro not found' });
  res.json({ macro: m });
});

app.delete('/api/macros/:id', (req, res) => {
  const ok = macroStore.remove(req.params.id);
  res.json({ ok });
});

// ---- F12: Reproducibility Bundles Endpoints -----------------------------------
app.post('/api/repro/export', (req, res) => {
  const bundle = exportReproBundle(req.body || {});
  res.json({ ok: true, bundle });
});

app.post('/api/repro/validate', (req, res) => {
  const bundle = req.body && req.body.bundle;
  const validation = validateReproBundle(bundle);
  if (!validation.valid) return res.status(400).json(validation);
  const compat = checkBundleCompatibility(bundle, CONTROLLED_TARGETS);
  res.json({ valid: true, compatibility: compat, preview: bundle });
});

// ---- F09: Lineage Settings Diff Endpoint -------------------------------------
app.get('/api/lineage/:id/diff', (req, res) => {
  const childId = req.params.id;
  const childMeta = imageMeta.get(childId);
  if (!childMeta) return res.status(404).json({ error: 'Child image metadata not found' });

  const parentId = childMeta.parent_id;
  if (!parentId) {
    return res.json({ childId, parentId: null, hasParent: false, changes: [], isRoot: true });
  }

  const parentMeta = imageMeta.get(parentId) || {};
  const diffs = [];

  const compareKeys = [
    ['operation', 'Operation'],
    ['target', 'Model / Target'],
    ['seed', 'Seed'],
    ['width', 'Width'],
    ['height', 'Height'],
    ['steps', 'Steps'],
    ['cfg_scale', 'Guidance / CFG'],
    ['sampler', 'Sampler'],
    ['scheduler', 'Scheduler'],
    ['strength', 'Denoise Strength']
  ];

  for (const [key, label] of compareKeys) {
    const parentVal = parentMeta[key] !== undefined ? parentMeta[key] : null;
    const childVal = childMeta[key] !== undefined ? childMeta[key] : null;
    if (parentVal !== childVal) {
      diffs.push({ field: key, label, parent: parentVal, child: childVal });
    }
  }

  // Prompt diff handling under strict privacy contract
  let promptStatus = 'PRIVATE / NOT SAVED';
  let parentPrompt = null;
  let childPrompt = null;

  if (childMeta.prompt_saved && parentMeta.prompt_saved) {
    promptStatus = 'SAVED';
    parentPrompt = parentMeta.prompt || null;
    childPrompt = childMeta.prompt || null;
  } else if (childMeta.prompt_saved) {
    promptStatus = 'PARENT_PRIVATE';
  } else {
    promptStatus = 'PRIVATE / NOT SAVED';
  }

  res.json({
    childId,
    parentId,
    hasParent: true,
    promptStatus,
    parentPrompt,
    childPrompt,
    changes: diffs
  });
});

// Tail of the actual sd-cli log for Create and Edit sampling progress.
// Create refreshes its run directory for each sequential image.
function sdLogTailForJob(job) {
  if (!job || job.status !== 'running' || !['img2img', 'inpaint', 'outpaint', 'controlled-generate'].includes(job.commandAction)) return '';
  const controlled = job.commandAction === 'controlled-generate';
  try {
    if (controlled || !job._runDir) {
      const suffix = controlled ? '-controlled-' + job.requestParams.target : job.commandAction === 'img2img' ? '-img2img' : '-inpaint';
      const since = (controlled && job.progress && job.progress.currentRunStartedAt || job.startedRunningAt || job.createdAt) - 3000;
      const hit = fs.readdirSync(RUNS_DIR).filter(n => n.endsWith(suffix) && /^20\d{6}-\d{6}-/.test(n))
        .map(n => ({ n, t: fs.statSync(path.join(RUNS_DIR, n)).birthtimeMs })).filter(x => x.t >= since).sort((a, b) => b.t - a.t)[0];
      if (hit) job._runDir = path.join(RUNS_DIR, hit.n);
    }
    if (!job._runDir) return '';
    const f = path.join(job._runDir, controlled ? 'remote-command.log' : 'remote-stdout.log');
    const st = fs.statSync(f), n = Math.min(st.size, 24000);
    const fd = fs.openSync(f, 'r');
    try { const b = Buffer.alloc(n); fs.readSync(fd, b, 0, n, st.size - n); return b.toString('utf8'); } finally { fs.closeSync(fd); }
  } catch (_) { return ''; }
}

app.get('/api/jobs/:jobId', (req, res) => {
  const job = jobs[req.params.jobId];
  if (!job) {
    // After a console restart the in-memory job is gone; the durable generic record tells the truth.
    const g = jobStore.get(req.params.jobId);
    if (!g) return res.status(404).json({ error: 'Job not found' });
    const legacy = { COMPLETE: 'PASS', FAILED: 'FAIL', INTERRUPTED: 'INTERRUPTED', CANCELLED: 'CANCELLED' }[g.status] || g.status.toLowerCase();
    return res.json({ id: g.job_id, commandAction: g.operation, status: legacy, generic: g, firstFailedGate: g.first_failed_gate,
      results: g.artifacts.map((a, i) => {
        const seedMatch = String(a).match(/-s(\d+)-/);
        const seed = seedMatch ? Number(seedMatch[1]) : (g.params && g.params.seed >= 0 ? g.params.seed : null);
        return {
          index: i,
          status: 'DONE',
          imageId: a,
          imageUrl: g.media_kind === 'image' ? imageStore.imageUrl(a) : '/api/media/' + encodeURIComponent(a),
          seed,
          target: g.model_id || (g.params && g.params.target) || null
        };
      }),
      restored: true });
  }
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
    controlledOutputImageUrl: job.controlledOutputImageUrl || null,
    controlledManifest: job.controlledManifest || null,
    hiresRunId: job.hiresRunId || null,
    hiresBaseImage: job.hiresBaseImage || null,
    hiresBaseImageUrl: job.hiresBaseImageUrl || null,
    hiresFinalImage: job.hiresFinalImage || null,
    hiresFinalImageUrl: job.hiresFinalImageUrl || null,
    hiresManifest: job.hiresManifest || null,
    upscaledImageUrl: job.upscaledImageUrl || null,
    results: job.results || [],
    images: (() => {
      const items = (job.results || []).filter(r => r.imageId).map((r, idx) => ({
        image_id: r.imageId,
        url: r.imageUrl || imageStore.imageUrl(r.imageId),
        thumbnail_url: r.imageUrl || imageStore.imageUrl(r.imageId),
        seed: r.seed,
        index: r.index !== undefined ? r.index : idx,
        run_id: r.runId,
        target: r.target,
        width: r.width,
        height: r.height,
        status: r.status,
        operation: r.operation
      }));
      if (items.length === 0 && (job.controlledOutputImage || job.controlledOutputImageUrl)) {
        const imgId = job.controlledOutputImage || (job.controlledOutputImageUrl && decodeURIComponent(job.controlledOutputImageUrl.split('/').pop()));
        if (imgId) {
          items.push({
            image_id: imgId,
            url: job.controlledOutputImageUrl || imageStore.imageUrl(imgId),
            thumbnail_url: job.controlledOutputImageUrl || imageStore.imageUrl(imgId),
            seed: (job.seeds && job.seeds[0]) || (job.requestParams && job.requestParams.seed),
            index: 0,
            run_id: job.runId,
            target: job.controlledTarget,
            status: job.status === 'PASS' || job.status === 'DONE' ? 'DONE' : job.status,
            operation: (job.requestParams && job.requestParams.operation) || 'txt2img'
          });
        }
      }
      return items;
    })(),
    seeds: job.seeds || null,
    nativeBatch: !!job.nativeBatch,
    nativeFallback: !!job.nativeFallback,
    sourceImageId: job.sourceImageId || null,
    progressEstimated: false,
    resource: job.status === 'queued' && job.waitingForLease ? { waiting: true, position: arbiter.position(job.id), blocked_reason: arbiter.state().blocked_reason } : null,
    generic: jobStore.get(job.id),
    // Truthful stage: step N/M only when sd-cli actually reported it; otherwise stage text without a percentage.
    stage: EC.deriveStage({ status: job.status, firstFailedGate: job.firstFailedGate, stdout: job.stdout, stderr: job.stderr,
      resource: job.status === 'queued' && job.waitingForLease ? { waiting: true, position: arbiter.position(job.id), blocked_reason: arbiter.state().blocked_reason } : null }, sdLogTailForJob(job))
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

// Read-only operational metadata (access URLs, primary engine, storage,
// launcher, legacy status). See system-info.js; never includes secrets.
const getSystemInfo = createSystemInfo({ getAssets: () => assetCache, getEvidence: () => evidenceStore.read() });
app.get('/api/system-info', async (req, res) => {
  try {
    if (req.query.refresh === '1') await refreshAssets();
    res.json(await getSystemInfo({ targets: liveModelTargets(), build: { ...getBuildInfo(), sshTarget: SSH_TARGET_NAME } }));
  } catch (err) {
    res.status(500).json({ error: 'system-info unavailable' });
  }
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
      pngInfo = readPngTextChunks(fs.existsSync(pngFull) ? pngFull : (resolveRunImageForRead(runId, primaryRaw) || pngFull));
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
    imageCount += imageStore.listRunImageNames(runPath).length;
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
  if (!fs.existsSync(fullPath)) {
    // Generated images live in the canonical root; the run dir keeps only a reference.
    const [runId, ...rest] = relPath.split(path.sep);
    const hit = safeRunId(runId) && rest.length ? imageStore.resolveRunImage(path.join(RUNS_DIR, runId), rest.join('/')) : null;
    if (hit) return res.redirect(302, hit.url);
    return res.status(404).send('File not found');
  }
  res.sendFile(fullPath);
});

// Canonical generated images. Only plain filenames inside the fixed root are served.
app.get('/api/images/:id', (req, res) => {
  const img = imageStore.resolveImage(req.params.id);
  if (!img) return res.status(404).send('Image not found');
  res.set('X-Content-Type-Options', 'nosniff');
  res.type(img.contentType);
  res.sendFile(img.path);
});

app.listen(PORT, HOST, () => {
  const build = getBuildInfo();
  console.log(`SDCPP Workbench listening on ${build.bind} (${build.version}, HEAD ${build.gitHead}, pid ${build.pid})`);
});
