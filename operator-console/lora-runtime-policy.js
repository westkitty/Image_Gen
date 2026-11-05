'use strict';

const { FAMILIES, resolveTargetFamily } = require('./extra-networks');

// Server-owned, evidence-backed SDCPP LoRA routes. Keep the tuple narrow:
// adapter, checkpoint target, recipe, backend, and application mode were
// validated together. A new adapter or recipe stays unavailable until added
// with a real inference receipt.
// Staged community adapters (source-archive/lora-catalog.json, files verified by size, header,
// sha256 and architecture gate). They have NO inference receipt: every one is
// FILE_INSTALLED_UNTESTED and labelled so in the UI.
//  - FLUX.2 Klein 4B: plain (non-rsLoRA) adapters passed to `mflux-generate-flux2 --lora <path> <strength>`.
//  - SDXL 1.0: style adapters applied by sd.cpp (MTL0, at_runtime) on any SDXL-family checkpoint.
// One adapter per generation.
const STAGED_ROOT = '/Volumes/wc2tb/DexDiffusion/models/loras/';
function stagedAdapters() {
  let catalog = [];
  try { catalog = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, 'source-archive', 'lora-catalog.json'), 'utf8')); } catch (_) {}
  const out = {};
  for (const c of catalog) {
    if (c.staged_status !== 'OK') continue;
    const id = String(c.filename).replace(/\.safetensors$/i, '').toLowerCase();
    const base = { path: STAGED_ROOT + c.bucket + '/' + c.filename, untested: true, staged: true };
    if (c.bucket === 'klein_4b') out[id] = { ...base, targets: ['flux2-klein-4b'], family: 'flux2', backend: 'mflux', plain: true, strength: { min: 0.1, max: 3 } };
    else if (c.bucket === 'sdxl') out[id] = { ...base, targets: ['sdxl-base'], family: 'sdxl', style: true,
      production: { backend_override: 'MTL0', lora_apply_mode: 'at_runtime' },
      fallbacks: [{ backend_override: 'cpu', lora_apply_mode: 'immediately' }], strength: { min: 0, max: 2 } };
  }
  return out;
}
const ADAPTERS = Object.freeze({
  ...stagedAdapters(),
  'sdxl_lightning_4step_lora': {
    targets: ['sdxl-base'], family: 'sdxl',
    // sd.cpp: CFG 1 = prompt-conditioned without guidance (the distilled convention; CFG 0 would be unconditioned and ignore the prompt).
    recipe: { steps: 4, cfg_scale: 1, sampler: 'euler', scheduler: 'sgm_uniform' },
    production: { backend_override: 'MTL0', lora_apply_mode: 'at_runtime' },
    fallbacks: [{ backend_override: 'cpu', lora_apply_mode: 'immediately' }],
  },
  'hyper-sdxl-8steps-cfg-lora': {
    targets: ['sdxl-base'], family: 'sdxl',
    recipe: { steps: 8, cfg_scale: 6, sampler: 'ddim_trailing', scheduler: 'discrete' },
    production: { backend_override: 'MTL0', lora_apply_mode: 'at_runtime' },
    fallbacks: [{ backend_override: 'cpu', lora_apply_mode: 'immediately' }],
  },
  'lcm_sdxl': {
    targets: ['sdxl-base'], family: 'sdxl',
    recipe: { steps: 4, cfg_scale: 1.5, sampler: 'lcm', scheduler: 'lcm' },
    production: { backend_override: 'MTL0', lora_apply_mode: 'at_runtime' },
    fallbacks: [{ backend_override: 'cpu', lora_apply_mode: 'immediately' }],
  },
  'lcm_sd15': {
    targets: ['sd15'], family: 'sd15',
    recipe: { steps: 4, cfg_scale: 1.5, sampler: 'lcm', scheduler: 'lcm' },
    production: { backend_override: 'MTL0', lora_apply_mode: 'at_runtime' },
    fallbacks: [{ backend_override: 'cpu', lora_apply_mode: 'immediately' }],
  },
  'hyper-sd15-8steps-cfg-lora': {
    targets: ['sd15'], family: 'sd15',
    recipe: { steps: 8, cfg_scale: 6, sampler: 'ddim_trailing', scheduler: 'discrete' },
    production: { backend_override: 'MTL0', lora_apply_mode: 'at_runtime' },
    fallbacks: [{ backend_override: 'cpu', lora_apply_mode: 'immediately' }],
  },
  'pixelart_lora': {
    targets: ['flux2-klein-4b'], family: 'flux2', backend: 'mflux', rslora_alpha: 64, rslora_rank: 128,
    strength: { min: 0.25, max: 1.5 },
  },
});

// Acceleration adapters may also run on other checkpoints of the same
// architecture. Those routes are accepted with the exact verified recipe but
// stay labelled family-only: no inference receipt exists for that checkpoint.
// SDXL Turbo is already distilled, so it is deliberately not listed.
const FAMILY_TARGET_FAMILIES = Object.freeze({
  sdxl: Object.freeze([FAMILIES.SDXL, FAMILIES.PONY]),
  sd15: Object.freeze([FAMILIES.SD15]),
});
const FAMILY_ONLY_PROOF = 'family-compatible, not yet proven on this checkpoint';

function adapterId(name) {
  return String(name || '').replace(/\.(safetensors|ckpt|pt|bin)$/i, '').toLowerCase();
}

function recipeMatches(expected, params) {
  return Object.entries(expected).every(([key, value]) => {
    const actual = key === 'steps' ? Number(params.steps) : Number(params[key]);
    return key === 'sampler' || key === 'scheduler'
      ? String(params[key] || '').toLowerCase() === value
      : actual === value;
  });
}

// 'verified' (explicit receipt-backed target), 'family' (same-architecture
// acceleration adapter, unproven on this checkpoint) or null (no route).
function targetSupport(spec, target) {
  if (!spec || spec.disabled) return null;
  if (spec.targets.includes(target)) return 'verified';
  if (spec.backend === 'mflux' || (!spec.recipe && !spec.style)) return null;
  const allowed = FAMILY_TARGET_FAMILIES[spec.family];
  return allowed && allowed.includes(resolveTargetFamily(target)) ? 'family' : null;
}

function resolveLoraRuntimePolicy(params) {
  const loras = Array.isArray(params && params.loras) ? params.loras : [];
  if (!loras.length) return { ok: true, route: null };
  if (loras.length !== 1) return { ok: false, error: 'Only one verified LoRA is supported per generation.' };
  const id = adapterId(loras[0].name);
  const spec = ADAPTERS[id];
  if (!spec) return { ok: false, error: `LoRA "${loras[0].name}" has no verified production route.` };
  if (spec.disabled) return { ok: false, error: `${loras[0].name} is unavailable: ${spec.disabled}` };
  const support = targetSupport(spec, params.target);
  if (!support) {
    const family = FAMILY_TARGET_FAMILIES[spec.family] && spec.backend !== 'mflux' ? ` and accepted only on ${FAMILY_TARGET_FAMILIES[spec.family].join('/')}-family checkpoints` : '';
    return { ok: false, error: `${loras[0].name} is verified only with ${spec.targets.join(', ')}${family}.` };
  }
  const familyOnly = support === 'family' ? { family_only: true } : {};
  if (spec.backend === 'mflux') {
    const strength = Number(loras[0].weight);
    if (!Number.isFinite(strength) || strength < spec.strength.min || strength > spec.strength.max) {
      return { ok: false, error: `${loras[0].name} strength must be ${spec.strength.min.toFixed(2)}–${spec.strength.max.toFixed(2)}.` };
    }
    return { ok: true, route: { mflux_lora_id: id, mflux_lora_strength: strength, ...(spec.plain ? { mflux_lora_plain: true, untested: true } : {}) } };
  }
  if (spec.recipe && !recipeMatches(spec.recipe, params)) {
    return { ok: false, error: `${loras[0].name} requires its verified ${spec.recipe.steps}-step ${spec.recipe.sampler}/${spec.recipe.scheduler}, CFG ${spec.recipe.cfg_scale} recipe.` };
  }

  const requestedBackend = String(params.backend_override || '').toLowerCase();
  const backend = requestedBackend === 'metal' || requestedBackend === 'mtl0' ? 'mtl0' : requestedBackend;
  const requestedMode = String(params.lora_apply_mode || '');
  if (!backend && !requestedMode) return { ok: true, route: spec.production, ...familyOnly };

  const candidates = [spec.production, ...(spec.fallbacks || [])];
  const selected = candidates.find(candidate =>
    (!backend || candidate.backend_override.toLowerCase() === backend) &&
    (!requestedMode || candidate.lora_apply_mode === requestedMode));
  if (selected) return { ok: true, route: selected, explicit: true, ...familyOnly };

  // Preserve diagnostic CPU/MTL0 override use only for proven combinations;
  // fail closed for the previously failing Metal modes.
  if (backend === 'mtl0' && requestedMode === 'auto') return { ok: false, error: 'Metal LoRA auto mode fails on unsupported ADD; use the verified at_runtime route.' };
  if (backend === 'mtl0' && requestedMode === 'immediately') return { ok: false, error: 'Metal LoRA immediately mode is not verified; Lightning stalled during adapter loading.' };
  if (backend === 'mtl0' && requestedMode === 'at_runtime' && id !== 'sdxl_lightning_4step_lora' && (spec.family === 'sdxl' || spec.family === 'sd15')) {
    return { ok: true, route: { backend_override: 'MTL0', lora_apply_mode: 'at_runtime' }, diagnostic: true, ...familyOnly };
  }
  return { ok: false, error: 'The requested LoRA backend/application-mode combination has no verified route.' };
}

function routesFor(target, name) {
  const id = adapterId(name), spec = ADAPTERS[id];
  const support = targetSupport(spec, target);
  if (!support) return [];
  if (spec.backend === 'mflux') return [{ target, backend: 'mflux', production: true, ...(spec.plain ? { plain: true, untested: true } : { rslora_equivalent: true }) }];
  const proof = support === 'verified'
    ? { verified: true }
    : { verified: false, family_only: true, family: spec.family, verified_targets: [...spec.targets], proof: FAMILY_ONLY_PROOF };
  return [
    { target, ...spec.production, production: true, recipe: { ...spec.recipe }, ...proof, ...(spec.untested ? { untested: true } : {}) },
    ...(spec.fallbacks || []).map(route => ({ target, ...route, production: false, recipe: { ...spec.recipe }, ...proof })),
  ];
}

module.exports = { ADAPTERS, FAMILY_ONLY_PROOF, adapterId, targetSupport, resolveLoraRuntimePolicy, routesFor };
