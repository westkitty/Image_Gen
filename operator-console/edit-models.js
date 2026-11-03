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

module.exports = { APPROVED_CHECKPOINT, SINGLE_FILE_FAMILIES, editModelEligibility, resolveEditModel, editModelIds };
