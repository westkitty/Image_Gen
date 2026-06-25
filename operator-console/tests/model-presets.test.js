'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const presets = require('../public/model-presets.js');

test('normalizes model and LoRA names across separators and suffixes', () => {
  assert.equal(presets.normalizePresetName('lcm_sd15.safetensors'), 'lcm_sd15');
  assert.equal(presets.normalizePresetName('LCM-SD15.ckpt'), 'lcm_sd15');
  assert.equal(
    presets.normalizePresetName('Z-Image-Turbo-NSFW-Photorealistic-ZIT.fp16.safetensors'),
    'z_image_turbo_nsfw_photorealistic_zit'
  );
});

test('matches known acceleration LoRA and checkpoint presets', () => {
  const cases = [
    ['lcm_sd15', 'lcm_sd15'],
    ['lcm-sd15', 'lcm_sd15'],
    ['lcm_sd15.safetensors', 'lcm_sd15'],
    ['sdxl_lightning_4step_lora', 'sdxl_lightning_4step_lora'],
    ['Hyper-SD15-8steps-lora', 'hyper_sd15_8steps_lora'],
    ['Hyper-SDXL-8steps-lora', 'hyper_sdxl_8steps_lora'],
    ['Z-Image-Turbo-NSFW-Photorealistic-ZIT.fp16', 'z_image_turbo_zit'],
    ['ltx_2_19b_distilled_lora_384', 'ltx_2_19b_distilled_lora_384'],
    ['ltx-2-19b-distilled-lora-384.safetensors', 'ltx_2_19b_distilled_lora_384']
  ];
  for (const [input, id] of cases) {
    assert.equal(presets.resolveModelPreset(input).id, id);
  }
});

test('returns no recommended preset for custom original LoRAs', () => {
  assert.equal(presets.resolveModelPreset('dg_CAIMoosePony'), null);
  assert.equal(presets.resolveModelPreset('dg_CAIMooseXL.safetensors'), null);
  assert.equal(presets.resolveModelPreset('wc_EmberPony'), null);
});

test('flags base-family mismatch without blocking a valid LoRA preset', () => {
  const result = presets.buildPresetRecommendation({
    modelName: 'lcm_sd15',
    targetId: 'sdxl-base',
    current: { steps: 20, cfg_scale: 7 },
    supportedSamplers: ['lcm'],
    supportedSchedulers: ['simple']
  });
  assert.equal(result.preset.id, 'lcm_sd15');
  assert.match(result.warnings.join(' '), /Base mismatch/);
});

test('preserves manual overrides unless forced', () => {
  const preset = presets.resolveModelPreset('sdxl_lightning_4step_lora');
  const result = presets.computePresetChanges(preset, {
    manualFields: ['steps', 'cfg_scale'],
    supportedSamplers: ['euler'],
    supportedSchedulers: ['sgm_uniform']
  });
  assert.deepEqual(result.changes.map(change => change.field), ['sampler', 'scheduler', 'loraWeight']);
  assert.deepEqual(result.skipped.map(change => change.field), ['steps', 'cfg_scale']);

  const forced = presets.computePresetChanges(preset, {
    force: true,
    manualFields: ['steps', 'cfg_scale'],
    supportedSamplers: ['euler'],
    supportedSchedulers: ['sgm_uniform']
  });
  assert.ok(forced.changes.some(change => change.field === 'steps' && change.value === 4));
  assert.ok(forced.changes.some(change => change.field === 'cfg_scale' && change.value === 0));
});

test('reports unsupported scheduler and sampler without emitting invalid settings', () => {
  const preset = presets.resolveModelPreset('Hyper-SDXL-8steps-lora');
  const result = presets.computePresetChanges(preset, {
    supportedSamplers: ['euler', 'lcm'],
    supportedSchedulers: ['simple', 'sgm_uniform']
  });
  assert.ok(!result.changes.some(change => change.field === 'sampler'));
  assert.ok(!result.changes.some(change => change.field === 'scheduler'));
  assert.match(result.warnings.join(' '), /DDIM|ddim/);
  assert.match(result.warnings.join(' '), /trailing/);
});

test('checkpoint and video entries produce routing warnings instead of LoRA changes', () => {
  const zImage = presets.buildPresetRecommendation({
    modelName: 'Z-Image-Turbo-NSFW-Photorealistic-ZIT.fp16',
    targetId: 'sdxl-base',
    current: { steps: 20, cfg_scale: 7 }
  });
  assert.equal(zImage.preset.kind, 'checkpoint');
  assert.equal(zImage.changes.some(change => change.field === 'loraWeight'), false);
  assert.match(zImage.warnings.join(' '), /not a standard Stable Diffusion LoRA/);

  const ltx = presets.buildPresetRecommendation({
    modelName: 'ltx_2_19b_distilled_lora_384',
    targetId: 'sd15',
    current: { steps: 20, cfg_scale: 7 }
  });
  assert.equal(ltx.preset.kind, 'video_lora');
  assert.match(ltx.warnings.join(' '), /video workflows only/);
});
