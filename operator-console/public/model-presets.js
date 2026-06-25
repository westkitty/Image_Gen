'use strict';

(function initModelPresets(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ImageGenModelPresets = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function buildModelPresets() {
  const EXTENSION_RE = /\.(safetensors|ckpt|pt|bin|gguf)$/i;
  const PRECISION_RE = /\.(fp16|bf16)$/i;
  const CUSTOM_PREFIX_RE = /^(dg|wc)[_\-\s]/i;

  const MODEL_PRESETS = [
    {
      id: 'lcm_sd15',
      label: 'LCM SD 1.5',
      match: ['lcm_sd15', 'lcm-sd15', 'lcm-lora-sdv1-5', 'lcm_lora_sdv1_5'],
      kind: 'lora',
      baseFamily: 'sd15',
      recommended: {
        steps: 4,
        minSteps: 2,
        maxSteps: 8,
        cfg: 1.5,
        minCfg: 0,
        maxCfg: 2,
        sampler: 'lcm',
        scheduler: 'simple',
        schedulerLabel: 'LCMScheduler',
        loraStrength: 1.0,
        notes: ['Negative prompts remain visible, but low CFG makes them weak.']
      }
    },
    {
      id: 'lcm_sdxl',
      label: 'LCM SDXL',
      match: ['lcm_sdxl', 'lcm-sdxl', 'lcm-lora-sdxl', 'lcm_lora_sdxl'],
      kind: 'lora',
      baseFamily: 'sdxl',
      recommended: {
        steps: 4,
        minSteps: 2,
        maxSteps: 8,
        cfg: 1.5,
        minCfg: 0,
        maxCfg: 2,
        sampler: 'lcm',
        scheduler: 'simple',
        schedulerLabel: 'LCMScheduler',
        loraStrength: 1.0,
        notes: ['Keep the LCM LoRA strength at 1.0 unless manually overridden.']
      }
    },
    {
      id: 'sdxl_lightning_4step_lora',
      label: 'SDXL Lightning 4-step',
      match: ['sdxl_lightning_4step_lora', 'sdxl-lightning-4step-lora', 'sdxl_lightning_4step'],
      kind: 'lora',
      baseFamily: 'sdxl',
      recommended: {
        steps: 4,
        exactSteps: true,
        cfg: 0,
        minCfg: 0,
        maxCfg: 1,
        sampler: 'euler',
        scheduler: 'sgm_uniform',
        schedulerLabel: 'SGM Uniform',
        loraStrength: 1.0
      }
    },
    {
      id: 'hyper_sd15_8steps_lora',
      label: 'Hyper-SD15 8-step',
      match: ['hyper-sd15-8steps-lora', 'hyper_sd15_8steps_lora'],
      kind: 'lora',
      baseFamily: 'sd15',
      recommended: {
        steps: 8,
        exactSteps: true,
        cfg: 0,
        minCfg: 0,
        maxCfg: 1,
        sampler: 'ddim',
        scheduler: 'trailing',
        schedulerLabel: 'trailing timestep spacing',
        loraStrength: 1.0
      }
    },
    {
      id: 'hyper_sdxl_8steps_lora',
      label: 'Hyper-SDXL 8-step',
      match: ['hyper-sdxl-8steps-lora', 'hyper_sdxl_8steps_lora'],
      kind: 'lora',
      baseFamily: 'sdxl',
      recommended: {
        steps: 8,
        exactSteps: true,
        cfg: 0,
        minCfg: 0,
        maxCfg: 1,
        sampler: 'ddim',
        scheduler: 'trailing',
        schedulerLabel: 'trailing timestep spacing',
        loraStrength: 1.0
      }
    },
    {
      id: 'z_image_turbo_zit',
      label: 'Z-Image Turbo ZIT',
      match: ['z-image-turbo-nsfw-photorealistic-zit', 'z_image_turbo_nsfw_photorealistic_zit', 'zit'],
      kind: 'checkpoint',
      baseFamily: 'zimage_turbo',
      recommended: {
        cfg: 0,
        steps: 8,
        resolution: { width: 1024, height: 1024 },
        notes: ['CFG disabled for Z-Image Turbo.', 'Negative prompt ignored by Turbo pipeline.']
      },
      compatibilityWarnings: ['This is a Z-Image Turbo checkpoint/model, not a standard Stable Diffusion LoRA.'],
      hardConstraints: ['Use a Z-Image backend; do not route this through SD/SDXL LoRA insertion.']
    },
    {
      id: 'ltx_2_19b_distilled_lora_384',
      label: 'LTX-2 distilled LoRA',
      match: ['ltx_2_19b_distilled_lora_384', 'ltx-2-19b-distilled-lora-384'],
      kind: 'video_lora',
      baseFamily: 'ltx2_video',
      recommended: {
        steps: 8,
        sampler: 'euler_ancestral',
        loraStrength: 1.0,
        notes: ['Video workflow only.']
      },
      compatibilityWarnings: ['LTX-2 distilled LoRA is for video workflows only.'],
      hardConstraints: ['Do not send this into SD/SDXL LoRA arrays.']
    }
  ];

  function stripKnownSuffixes(value) {
    let out = String(value || '').trim();
    let previous = '';
    while (out && out !== previous) {
      previous = out;
      out = out.replace(EXTENSION_RE, '').replace(PRECISION_RE, '');
    }
    return out;
  }

  function normalizePresetName(value) {
    return stripKnownSuffixes(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .replace(/_+/g, '_');
  }

  function isCustomOriginal(value) {
    return CUSTOM_PREFIX_RE.test(stripKnownSuffixes(value));
  }

  function clonePreset(preset) {
    return JSON.parse(JSON.stringify(preset));
  }

  function applyCfgPreservedVariant(preset, normalizedName) {
    if (!/^hyper_/.test(preset.id) || !/(^|_)cfg($|_)/.test(normalizedName)) return preset;
    const next = clonePreset(preset);
    next.id = `${preset.id}_cfg_preserved`;
    next.label = 'Hyper-SD CFG-preserved';
    next.recommended.cfg = 6;
    next.recommended.minCfg = 5;
    next.recommended.maxCfg = 8;
    return next;
  }

  function resolveModelPreset(name) {
    if (!name || isCustomOriginal(name)) return null;
    const normalizedName = normalizePresetName(name);
    const preset = MODEL_PRESETS.find(item => item.match.some(match => normalizePresetName(match) === normalizedName));
    return preset ? applyCfgPreservedVariant(clonePreset(preset), normalizedName) : null;
  }

  function inferBaseFamilyFromTarget(target) {
    const id = normalizePresetName(typeof target === 'string' ? target : (target && (target.id || target.label)) || '');
    if (!id) return 'unknown';
    if (id.startsWith('sd15') || id.includes('_sd15') || id.includes('sd_1_5')) return 'sd15';
    if (id.startsWith('sdxl') || id.includes('_sdxl') || id.includes('pony')) return 'sdxl';
    if (id.startsWith('flux') || id.includes('_flux')) return 'flux';
    if (id.startsWith('zimage') || id.startsWith('z_image')) return 'zimage_turbo';
    if (id.startsWith('ltx') || id.includes('_ltx')) return 'ltx2_video';
    return 'unknown';
  }

  function hasSupportedValue(values, value) {
    if (!value) return true;
    return Array.isArray(values) && values.includes(value);
  }

  function addChange(changes, skipped, field, value, label, manualFields, force) {
    if (!force && manualFields.has(field)) {
      skipped.push({ field, value, label, reason: 'Manual override preserved' });
      return;
    }
    changes.push({ field, value, label });
  }

  function computePresetChanges(preset, options = {}) {
    const manualFields = new Set(options.manualFields || []);
    const force = options.force === true;
    const supportedSamplers = options.supportedSamplers || [];
    const supportedSchedulers = options.supportedSchedulers || [];
    const rec = (preset && preset.recommended) || {};
    const changes = [];
    const skipped = [];
    const warnings = [];

    if (!preset) return { changes, skipped, warnings };
    if (rec.steps !== undefined) addChange(changes, skipped, 'steps', rec.steps, `steps ${rec.steps}`, manualFields, force);
    if (rec.cfg !== undefined) addChange(changes, skipped, 'cfg_scale', rec.cfg, `CFG ${rec.cfg}`, manualFields, force);
    if (rec.sampler && hasSupportedValue(supportedSamplers, rec.sampler)) {
      addChange(changes, skipped, 'sampler', rec.sampler, rec.sampler, manualFields, force);
    } else if (rec.sampler) {
      warnings.push(`Recommended sampler ${rec.sampler} is not exposed by this backend; sampler left unchanged.`);
    }
    if (rec.scheduler && hasSupportedValue(supportedSchedulers, rec.scheduler)) {
      addChange(changes, skipped, 'scheduler', rec.scheduler, rec.schedulerLabel || rec.scheduler, manualFields, force);
    } else if (rec.scheduler) {
      warnings.push(`Recommended scheduler ${rec.schedulerLabel || rec.scheduler} is not exposed by this backend; scheduler left unchanged.`);
    }
    if (rec.loraStrength !== undefined && preset.kind === 'lora') {
      addChange(changes, skipped, 'loraWeight', rec.loraStrength, `LoRA strength ${rec.loraStrength}`, manualFields, force);
    }
    if (rec.resolution && preset.kind === 'checkpoint') {
      addChange(changes, skipped, 'width', rec.resolution.width, `width ${rec.resolution.width}`, manualFields, force);
      addChange(changes, skipped, 'height', rec.resolution.height, `height ${rec.resolution.height}`, manualFields, force);
    }
    return { changes, skipped, warnings };
  }

  function buildPresetRecommendation(options = {}) {
    const preset = resolveModelPreset(options.modelName);
    const changes = computePresetChanges(preset, options);
    const warnings = changes.warnings.slice();
    const current = options.current || {};
    const targetFamily = inferBaseFamilyFromTarget(options.targetSpec || options.targetId || '');

    if (!preset) return { preset: null, changes: [], skipped: [], warnings: [], notes: [] };
    if (preset.kind === 'lora' && preset.baseFamily !== targetFamily) {
      warnings.push(`Base mismatch: ${preset.label} expects ${preset.baseFamily}, current target is ${targetFamily}.`);
    }
    if (preset.kind === 'checkpoint') {
      warnings.push(...(preset.compatibilityWarnings || []));
      warnings.push('Current image workflow has no Z-Image backend route; settings are advisory only.');
    }
    if (preset.kind === 'video_lora') {
      warnings.push(...(preset.compatibilityWarnings || []));
      warnings.push('Current still-image workflow has no LTX-2 video backend; settings are advisory only.');
    }
    const rec = preset.recommended || {};
    const effectiveCurrent = { ...current };
    changes.changes.forEach(change => {
      if (['steps', 'cfg_scale'].includes(change.field)) effectiveCurrent[change.field] = change.value;
    });
    const stepValue = Number(effectiveCurrent.steps);
    if (Number.isFinite(stepValue)) {
      if (rec.exactSteps && stepValue !== Number(rec.steps)) warnings.push(`${preset.label} is intended for exactly ${rec.steps} steps.`);
      if (rec.minSteps !== undefined && stepValue < rec.minSteps) warnings.push(`${preset.label} is intended for at least ${rec.minSteps} steps.`);
      if (rec.maxSteps !== undefined && stepValue > rec.maxSteps) warnings.push(`${preset.label} is intended for at most ${rec.maxSteps} steps.`);
    }
    const cfgValue = Number(effectiveCurrent.cfg_scale);
    if (Number.isFinite(cfgValue)) {
      if (rec.maxCfg !== undefined && cfgValue > rec.maxCfg) warnings.push(`${preset.label} is intended for CFG ${rec.minCfg ?? 0}-${rec.maxCfg}.`);
      if (rec.minCfg !== undefined && cfgValue < rec.minCfg) warnings.push(`${preset.label} is intended for CFG ${rec.minCfg}-${rec.maxCfg ?? rec.minCfg}.`);
    }
    return {
      preset,
      changes: changes.changes,
      skipped: changes.skipped,
      warnings,
      notes: rec.notes || []
    };
  }

  return {
    MODEL_PRESETS,
    normalizePresetName,
    isCustomOriginal,
    resolveModelPreset,
    inferBaseFamilyFromTarget,
    computePresetChanges,
    buildPresetRecommendation
  };
});
