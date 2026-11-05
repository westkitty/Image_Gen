'use strict';
// Edit model selection for img2img, inpaint, outpaint and the multi-pass scripts.
//
// The edit workers (bin/sdcpp-img2img.sh, bin/sdcpp-inpaint.sh) load REMOTE_MODEL from sdcpp.env unless they are given
// --model-path. That flag is server-resolved only: the client names a target id, never a path, and the path comes from
// the same TARGET_MODELS map the Create route and the Hires second pass use. Only single-file sd-cli checkpoints
// (SD 1.5 and the SDXL families) qualify: their whole model loads through `-m`. FLUX/SD3-style split models need extra
// encoder files the edit workers do not pass, and MFLUX (FLUX.2 Klein) edits through its own reference-edit route.

const APPROVED_CHECKPOINT = /^(\/Volumes\/wc2tb\/ImageGen\/checkpoints\/|\/Volumes\/wc2tb\/dex-imagegen\/models\/checkpoints\/|\$HOME\/sdcpp-staging\/models\/)[A-Za-z0-9._ /-]+\.safetensors$/;
const SINGLE_FILE_FAMILIES = new Set(['sd15', 'sdxl', 'sdxl_turbo', 'pony']);

// -> { ok: true, modelPath, family } | { ok: false, reason }
function editModelEligibility(spec, { targetModels = {}, familyOf = () => 'unknown' } = {}) {
  if (!spec || !spec.id) return { ok: false, reason: 'Unknown edit model.' };
  if ((spec.backend || 'sdcpp') === 'mflux') return { ok: false, reason: 'FLUX.2 Klein edits through Reference edit, not the sd-cli edit workers.' };
  if (String(spec.status || '').toLowerCase() === 'broken') return { ok: false, reason: 'Marked broken; not usable for editing.' };
  const family = familyOf(spec.aliasOf || spec.id);
  if (!SINGLE_FILE_FAMILIES.has(family)) return { ok: false, reason: 'Only single-file SD 1.5 / SDXL checkpoints load in the edit workers.' };
  const modelPath = targetModels[spec.aliasOf || spec.id] || spec.modelPath || null;
  if (!modelPath) return { ok: false, reason: 'No server-resolved checkpoint path for this target.' };
  if (!APPROVED_CHECKPOINT.test(modelPath) || modelPath.includes('..')) return { ok: false, reason: 'The checkpoint is not under an approved checkpoint root.' };
  return { ok: true, modelPath, family };
}

// requested: body.edit_model (a target id, or empty for the worker's configured model).
// -> { target, args } | { error, status }
function resolveEditModel(requested, { targets = {}, targetModels = {}, familyOf, workerTarget = null } = {}) {
  const id = typeof requested === 'string' ? requested.trim() : '';
  if (!id || id === workerTarget) return { target: workerTarget, args: [] };
  if (!/^[a-z0-9][a-z0-9._-]{0,120}$/i.test(id)) return { error: 'edit_model must be a model target id', status: 400 };
  const spec = targets[id];
  if (!spec) return { error: 'Unknown edit model: ' + id, status: 400 };
  const el = editModelEligibility(spec, { targetModels, familyOf });
  if (!el.ok) return { error: (spec.label || id) + ' cannot be used for editing: ' + el.reason, status: 409 };
  const canonical = spec.aliasOf || spec.id;
  // The configured worker model needs no override (it is what the worker loads anyway).
  if (canonical === workerTarget) return { target: workerTarget, args: [] };
  return { target: canonical, args: ['--model-path', el.modelPath] };
}

// Ids of every target the edit workers can load, for /api/capabilities.
function editModelIds(targets = {}, opts = {}) {
  return Object.values(targets).filter(t => editModelEligibility(t, opts).ok).map(t => t.id);
}

// img2img through the Big Mac local engine (the path Create uses) loads every installed target, including the FLUX
// models the edit workers cannot: FLUX.1 Schnell (sd-cli, with its own encoders) and FLUX.2 Klein (MFLUX). The engine
// resolves the model from its own registry by id, so only the id crosses; the edit workers stay as they are.
function engineEditEligibility(spec, { targetModels = {} } = {}) {
  if (!spec || !spec.id) return { ok: false, reason: 'Unknown edit model.' };
  const status = String(spec.status || '').toLowerCase();
  if (status === 'broken' || status === 'dormant') return { ok: false, reason: 'Marked ' + status + '; not usable for editing.' };
  if ((spec.backend || 'sdcpp') === 'mflux') return { ok: true, engine: 'mflux' };
  if (!(targetModels[spec.aliasOf || spec.id] || spec.modelPath)) return { ok: false, reason: 'No installed model file for this target.' };
  return { ok: true, engine: 'sdcpp' };
}

// Ids offered for img2img: the edit-worker set, plus every engine-loadable target when the engine bridge is on.
function img2imgModelIds(targets = {}, opts = {}) {
  return Object.values(targets).filter(t => editModelEligibility(t, opts).ok || (opts.engine && engineEditEligibility(t, opts).ok)).map(t => t.id);
}

// Which runner serves one img2img request: 'worker' (edit worker, the proven SD 1.5 / SDXL path without LoRAs),
// 'engine' (local engine: FLUX models, or any LoRA) or { error, status } when nothing can run it.
function img2imgRunner(spec, { hasLoras = false, engine = false, targetModels = {}, familyOf } = {}) {
  if (!engine || !spec) return 'worker';
  if (editModelEligibility(spec, { targetModels, familyOf }).ok && !hasLoras) return 'worker';
  const el = engineEditEligibility(spec, { targetModels });
  return el.ok ? 'engine' : { error: (spec.label || spec.id) + ' cannot be used for img2img: ' + el.reason, status: 409 };
}

module.exports = { img2imgRunner, APPROVED_CHECKPOINT, SINGLE_FILE_FAMILIES, editModelEligibility, resolveEditModel, editModelIds, engineEditEligibility, img2imgModelIds };
