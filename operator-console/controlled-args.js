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
function nativeBatchEligible(spec, quantity, env = process.env) {
  return spec.backend !== 'mflux' && env.DEX_NATIVE_BATCH !== '0' && quantity >= 2 && quantity <= NATIVE_BATCH_MAX;
}

// ---- Sampling fields (P02): one canonical path from request to worker ----------------
// UI id -> sd-cli --sampling-method name, restricted to what the installed sd-cli (7f0e728)
// reports. The shell worker keeps an identical table between SAMPLER_TABLE markers (tested).
const SDCLI_SAMPLER = Object.freeze({
  euler: 'euler', euler_a: 'euler_a', heun: 'heun', dpm2: 'dpm2',
  dpmpp2s_a: 'dpm++2s_a', dpmpp2m: 'dpm++2m', dpmpp2mv2: 'dpm++2mv2',
  ipndm: 'ipndm', ipndm_v: 'ipndm_v', lcm: 'lcm',
});
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
  if (mflux) {
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
  if (!mflux && params.hires_scale) {
    args.push('--hires-scale', String(params.hires_scale), '--hires-steps', String(params.hires_steps || 0),
      '--hires-denoise', String(params.hires_denoise || 0.5), '--hires-upscaler', params.hires_upscaler || 'Latent');
  }
  if (!mflux) {
    if (params.sampler) args.push('--sampler', String(params.sampler));
    if (params.clip_skip !== undefined && params.clip_skip !== null && params.clip_skip !== '') args.push('--clip-skip', String(params.clip_skip));
    if (params.tiling) args.push('--tiling');
  }
  args.push('--save-prompts', params.save_prompts ? 'true' : 'false');
  return args;
}

module.exports = {
  controlledScriptFor, buildControlledArgs, nativeBatchEligible, NATIVE_BATCH_MAX,
  SDCLI_SAMPLER, canonicalSampler, normalizeSamplingFields, validateSamplingFields,
};
