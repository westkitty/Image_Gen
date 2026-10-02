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
  args.push('--save-prompts', params.save_prompts ? 'true' : 'false');
  return args;
}

module.exports = { controlledScriptFor, buildControlledArgs, nativeBatchEligible, NATIVE_BATCH_MAX };
