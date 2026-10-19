'use strict';

// Pure routing/argument builder for controlled generation, shared by the
// job runner and the request handler so both stay in lockstep (and testable).

function controlledScriptFor(spec) {
  return spec.backend === 'mflux' ? 'bin/mflux-controlled-generate.sh' : 'bin/sdcpp-controlled-generate.sh';
}

// MFLUX (FLUX.2 Klein) has no negative prompt, SDCPP CFG flag, scheduler or
// VAE switch; those are never forwarded to the MFLUX script.
// Native sd-cli --batch-count: one model load for N outputs (proved equivalent
// to N sequential runs at seeds S..S+N-1). SDCPP only; MFLUX stays sequential.
const NATIVE_BATCH_MAX = 16;
// Progressive results are the default: each image is validated, canonicalized and shown as soon as ITS run finishes.
// One sd-cli --batch-count process only produces its files together at the end, so it is used only when the caller asks for
// it explicitly (fast_batch) or the operator sets DEX_NATIVE_BATCH=1 (and never when DEX_NATIVE_BATCH=0).
function nativeBatchEligible(spec, quantity, env = process.env, fastBatch = false) {
  const wanted = fastBatch === true || env.DEX_NATIVE_BATCH === '1';
  return wanted && spec.backend !== 'mflux' && env.DEX_NATIVE_BATCH !== '0' && quantity >= 2 && quantity <= NATIVE_BATCH_MAX;
}

// ---- Sampling fields (P02): one canonical path from request to worker ----------------
// UI id -> sd-cli --sampling-method name, restricted to what the installed sd-cli (7f0e728)
// reports. The shell worker keeps an identical table between SAMPLER_TABLE markers (tested).
const SDCLI_SAMPLER = Object.freeze({
  euler: 'euler', euler_a: 'euler_a', heun: 'heun', dpm2: 'dpm2',
  dpmpp2s_a: 'dpm++2s_a', dpmpp2m: 'dpm++2m', dpmpp2mv2: 'dpm++2mv2',
  ipndm: 'ipndm', ipndm_v: 'ipndm_v', lcm: 'lcm',
  // sd.cpp-only methods (not A1111 stock samplers); each was executed live before being listed (P05).
  ddim_trailing: 'ddim_trailing', tcd: 'tcd', res_multistep: 'res_multistep', res_2s: 'res_2s', er_sde: 'er_sde',
  euler_cfg_pp: 'euler_cfg_pp', euler_a_cfg_pp: 'euler_a_cfg_pp',
});
// Samplers whose sd-cli help documents an --eta default (noise multiplier is meaningful); others reject --eta.
const ETA_SAMPLERS = Object.freeze(['euler_a', 'dpmpp2s_a', 'ddim_trailing', 'tcd', 'res_multistep', 'res_2s', 'er_sde']);
const RNG_SOURCES = Object.freeze(['cuda', 'cpu', 'std_default']);
const ETA_MAX = 2;
// Known A1111 sampler ids the installed sd-cli cannot run: rejected, never ignored.
const KNOWN_UNSUPPORTED_SAMPLERS = new Set(['dpm2_a', 'lms']);

function canonicalSampler(value) {
  const raw = String(value == null ? '' : value).trim().toLowerCase();
  if (!raw) return '';
  const compact = raw.replace(/\s+/g, '').replace(/\+\+/g, 'pp').replace(/-/g, '_');
  const alias = { eulera: 'euler_a', dpmpp2sa: 'dpmpp2s_a', dpmpp2s_a: 'dpmpp2s_a', dpmpp2sde: 'dpmpp2s_a' };
  return alias[compact] || compact;
}

function normalizeSamplingFields(body = {}) {
  const truthy = v => v === true || v === 'true' || v === 1 || v === '1';
  const clip = body.clip_skip;
  return {
    sampler: canonicalSampler(body.sampler),
    clip_skip: clip === undefined || clip === null || clip === '' ? '' : Number(clip),
    tiling: truthy(body.tiling),
    restore_faces: truthy(body.restore_faces),
    eta: body.eta === undefined || body.eta === null || body.eta === '' ? '' : Number(body.eta),
    rng: String(body.rng == null ? '' : body.rng).trim().toLowerCase(),
  };
}

// Returns an error string, or null when every provided field can be honoured by this target.
function validateSamplingFields(spec, p = {}) {
  const mflux = spec && spec.backend === 'mflux';
  const label = (spec && spec.label) || (spec && spec.id) || 'this target';
  if (p.restore_faces) return 'Face restoration is not available in the generation pass; use the Enhance/Extras face restoration instead.';
  const clip = p.clip_skip;
  const hasClip = clip !== '' && clip !== undefined && clip !== null;
  if (hasClip && (!Number.isInteger(clip) || clip < 1 || clip > 12)) return 'Invalid clip_skip: use an integer 1-12';
  const hasEta = p.eta !== '' && p.eta !== undefined && p.eta !== null;
  if (hasEta && (!Number.isFinite(p.eta) || p.eta < 0 || p.eta > ETA_MAX)) return `Invalid eta: use a number from 0 to ${ETA_MAX}`;
  if (p.rng && !RNG_SOURCES.includes(p.rng)) return `Unknown noise RNG "${p.rng}": use ${RNG_SOURCES.join(', ')}`;
  if (mflux) {
    if (hasEta) return `${label} has no noise multiplier; eta is not supported`;
    if (p.rng) return `${label} does not expose a noise RNG choice`;
    if (p.sampler && p.sampler !== 'euler') return `${label} uses a fixed flow-match Euler sampler; sampler "${p.sampler}" is not supported`;
    if (hasClip && clip !== 1) return `${label} has no CLIP skip; clip_skip ${clip} is not supported`;
    if (p.tiling) return `${label} does not support VAE tiling`;
    return null;
  }
  if (p.sampler) {
    if (KNOWN_UNSUPPORTED_SAMPLERS.has(p.sampler)) return `Sampler "${p.sampler}" is not supported by the installed stable-diffusion.cpp`;
    if (!SDCLI_SAMPLER[p.sampler]) return `Unknown sampler "${p.sampler}"`;
    if (spec && spec.id === 'flux-fp8' && p.sampler !== 'euler') return 'FLUX.1 Schnell is fixed to the euler sampler';
  }
  if (hasEta) {
    if (spec && spec.id === 'flux-fp8') return 'FLUX.1 Schnell does not accept eta';
    const effective = p.sampler || canonicalSampler(spec && spec.defaultSampler) || 'euler_a';
    if (!ETA_SAMPLERS.includes(effective)) return `eta has no effect with the ${effective} sampler; it applies to ${ETA_SAMPLERS.join(', ')}`;
  }
  if (p.rng && spec && spec.id === 'flux-fp8') return 'FLUX.1 Schnell does not accept a noise RNG override';
  return null;
}

// ---- High-Res Refine (sd-cli --hires) -------------------------------------------------------------------------
// Upscalers sd-cli documents without a --hires-upscalers-dir model directory (help text, rev 7f0e728).
const HIRES_UPSCALERS = Object.freeze(['Latent', 'Latent (nearest)', 'Latent (nearest-exact)', 'Latent (antialiased)', 'Latent (bicubic)', 'Latent (bicubic antialiased)', 'Lanczos', 'Nearest']);
const HIRES_MAX_EDGE = 2048;

const numOrNull = v => (v === undefined || v === null || v === '' ? null : Number(v));
function normalizeHiresFields(body = {}) {
  return { hires_width: numOrNull(body.hires_width), hires_height: numOrNull(body.hires_height) };
}
// Active when a scale or an explicit target size is present.
function hiresRequested(p = {}) {
  return (p.hires_scale !== null && p.hires_scale !== undefined) || (p.hires_width !== null && p.hires_width !== undefined) || (p.hires_height !== null && p.hires_height !== undefined);
}
// Returns an error string or null. Scale mode XOR resize-to mode; both validated against the base size and the 2048 px cap.
function validateHiresFields(spec, p = {}) {
  if (!hiresRequested(p)) return null;
  if (spec && spec.backend === 'mflux') return 'High-Res Refine is an SDCPP feature; MFLUX targets do not support it';
  const hasScale = p.hires_scale !== null && p.hires_scale !== undefined;
  const hasW = p.hires_width !== null && p.hires_width !== undefined, hasH = p.hires_height !== null && p.hires_height !== undefined;
  if (hasScale && (hasW || hasH)) return 'Use either hires_scale or hires_width/hires_height, not both';
  const baseW = Number(p.width || (spec && spec.defaultWidth)), baseH = Number(p.height || (spec && spec.defaultHeight));
  if (hasScale) {
    if (!(p.hires_scale >= 1.1 && p.hires_scale <= 2)) return 'hires_scale must be between 1.1 and 2.0';
    if (baseW * p.hires_scale > HIRES_MAX_EDGE || baseH * p.hires_scale > HIRES_MAX_EDGE) return 'High-Res Refine output would exceed 2048 px';
  } else {
    if (!(hasW && hasH)) return 'hires_width and hires_height must be given together';
    for (const [name, v, base] of [['hires_width', p.hires_width, baseW], ['hires_height', p.hires_height, baseH]]) {
      if (!Number.isInteger(v) || v < 64 || v > HIRES_MAX_EDGE || v % 8) return `${name} must be a multiple of 8 between 64 and 2048`;
      if (v < base) return `${name} (${v}) must be at least the base size (${base})`;
    }
  }
  if (!Number.isInteger(p.hires_steps) || p.hires_steps < 0 || p.hires_steps > 150) return 'hires_steps must be an integer 0-150';
  if (!(p.hires_denoise >= 0.05 && p.hires_denoise <= 0.95)) return 'hires_denoise must be between 0.05 and 0.95';
  if (!HIRES_UPSCALERS.includes(p.hires_upscaler)) return 'hires_upscaler must be one of: ' + HIRES_UPSCALERS.join(', ');
  return null;
}

function buildControlledArgs(spec, params, { seedValue, isDiscovered = false, resolveVaePath = () => null, batchCount = 1 } = {}) {
  const mflux = spec.backend === 'mflux';
  const args = ['--target', params.target, '--prompt', params.prompt];
  if (spec.modelPath && (isDiscovered || spec.aliasOf)) args.push('--model-path', spec.modelPath);
  if (params.negative_prompt && !mflux && !spec.noNegativePrompt) args.push('--negative-prompt', params.negative_prompt);
  if (params.width) args.push('--width', String(params.width));
  if (params.height) args.push('--height', String(params.height));
  if (params.steps) args.push('--steps', String(params.steps));
  if (!mflux && spec.fixedCfgScale !== undefined) {
    args.push('--cfg', String(spec.fixedCfgScale));
  } else if (!mflux && params.cfg_scale !== undefined && params.cfg_scale !== null && params.cfg_scale !== '') {
    args.push('--cfg', String(params.cfg_scale));
  }
  if (seedValue !== undefined && seedValue !== null && seedValue !== '') args.push('--seed', String(seedValue));
  if (params.api && spec.id === 'sd15') args.push('--api', params.api);
  if (params.scheduler && !mflux) args.push('--scheduler', params.scheduler);
  if (!mflux && params.vae && params.vae !== 'auto') {
    const vaePath = resolveVaePath(params.vae);
    if (vaePath) args.push('--vae', vaePath);
  }
  if (!mflux && batchCount > 1) args.push('--batch-count', String(batchCount));
  if (!mflux && hiresRequested(params)) {
    if (params.hires_width !== null && params.hires_width !== undefined) args.push('--hires-width', String(params.hires_width), '--hires-height', String(params.hires_height));
    else args.push('--hires-scale', String(params.hires_scale));
    args.push('--hires-steps', String(params.hires_steps || 0), '--hires-denoise', String(params.hires_denoise || 0.5), '--hires-upscaler', params.hires_upscaler || 'Latent');
  }
  if (!mflux) {
    if (params.sampler) args.push('--sampler', String(params.sampler));
    if (params.clip_skip !== undefined && params.clip_skip !== null && params.clip_skip !== '') args.push('--clip-skip', String(params.clip_skip));
    if (params.tiling) args.push('--tiling');
    if (params.eta !== undefined && params.eta !== null && params.eta !== '') args.push('--eta', String(params.eta));
    if (params.rng) args.push('--rng', String(params.rng));
  }
  args.push('--save-prompts', params.save_prompts ? 'true' : 'false');
  return args;
}

module.exports = {
  controlledScriptFor, buildControlledArgs, nativeBatchEligible, NATIVE_BATCH_MAX,
  HIRES_UPSCALERS, normalizeHiresFields, validateHiresFields, hiresRequested,
  SDCLI_SAMPLER, ETA_SAMPLERS, RNG_SOURCES, ETA_MAX, canonicalSampler, normalizeSamplingFields, validateSamplingFields,
};
