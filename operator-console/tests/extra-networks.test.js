'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  FAMILIES,
  inferAssetFamily,
  resolveTargetFamily,
  evaluateCompatibility,
  buildLoraCards,
  buildEmbeddingState,
  serializeActiveLoras,
  parseLorasFromPrompt
} = require('../extra-networks');

test('extra-networks: infers families correctly from filenames', () => {
  assert.equal(inferAssetFamily('lcm_sd15.safetensors'), FAMILIES.SD15);
  assert.equal(inferAssetFamily('sdxl_lightning_4step_lora.safetensors'), FAMILIES.SDXL);
  assert.equal(inferAssetFamily('wc_EmberPony.safetensors'), FAMILIES.PONY);
  assert.equal(inferAssetFamily('dg_CAMooseXL.safetensors'), FAMILIES.SDXL);
  assert.equal(inferAssetFamily('ltx-2-19b-distilled-lora-384.safetensors'), FAMILIES.LTX);
  assert.equal(inferAssetFamily('flux_1_vae_f16.ckpt'), FAMILIES.FLUX1);
});

test('extra-networks: evaluates family compatibility truthfully', () => {
  // Exact match
  assert.equal(evaluateCompatibility(FAMILIES.SD15, FAMILIES.SD15, 'lora'), 'Unproven');
  assert.equal(evaluateCompatibility(FAMILIES.SDXL, FAMILIES.SDXL, 'lora'), 'Unproven');
  assert.equal(evaluateCompatibility(FAMILIES.SD15, FAMILIES.SD15, 'vae'), 'Compatible');

  // Cross compatibility Pony <-> SDXL
  assert.equal(evaluateCompatibility(FAMILIES.PONY, FAMILIES.SDXL), 'Probably compatible');
  assert.equal(evaluateCompatibility(FAMILIES.SDXL, FAMILIES.PONY), 'Probably compatible');

  // Incompatible
  assert.equal(evaluateCompatibility(FAMILIES.SD15, FAMILIES.SDXL), 'Incompatible');
  assert.equal(evaluateCompatibility(FAMILIES.LTX, FAMILIES.SDXL), 'Incompatible');

  // MFLUX FLUX.2 LoRA is unproven
  assert.equal(evaluateCompatibility(FAMILIES.FLUX2, FAMILIES.FLUX2, 'lora'), 'Unproven');
  assert.equal(evaluateCompatibility(FAMILIES.SDXL, FAMILIES.FLUX2, 'lora'), 'Unproven');
});

test('extra-networks: enforces honest empty state when no embeddings exist', () => {
  const emptyState = buildEmbeddingState([], 'flux2-klein-4b');
  assert.equal(emptyState.count, 0);
  assert.equal(emptyState.empty_state_message, 'No Textual Inversion embeddings discovered');
  assert.deepEqual(emptyState.items, []);
});

test('extra-networks: serializes and parses LoRA tokens', () => {
  const active = [
    { filename: 'wc_EmberPony.safetensors', weight: 0.8 },
    { filename: 'Hyper-SDXL-8steps-lora.safetensors', weight: 1.0 }
  ];
  const serialized = serializeActiveLoras(active);
  assert.equal(serialized, '<lora:wc_EmberPony:0.80> <lora:Hyper-SDXL-8steps-lora:1.00>');

  const parsed = parseLorasFromPrompt(serialized);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].name, 'wc_EmberPony');
  assert.equal(parsed[0].weight, 0.8);
  assert.equal(parsed[1].name, 'Hyper-SDXL-8steps-lora');
  assert.equal(parsed[1].weight, 1.0);
});

test('extra-networks: curated LoRAs expose verified source and honest untested state', () => {
  const loras = buildLoraCards([
    { filename: 'pixelart_lora.safetensors', full_path: '/approved/pixelart_lora.safetensors' },
    { filename: 'sdxl_lightning_4step_lora.safetensors', full_path: '/approved/sdxl_lightning_4step_lora.safetensors',
      metal_inference_status: 'FUNCTIONAL_METAL', metal_target_ids: ['sdxl-base'], metal_backend: 'MTL0', metal_apply_mode: 'at_runtime',
      metal_performance_status: 'MEASURED', metal_performance_summary: 'Matched runtime measured; quality review pending' }
  ], 'flux2-klein-4b');
  const pixel = loras.find(l => l.name === 'pixelart_lora');
  assert.equal(pixel.family, FAMILIES.FLUX2);
  assert.equal(pixel.compatibility, 'Unproven');
  assert.equal(pixel.trigger_words[0], 'PXART4');
  assert.equal(pixel.rs_lora, true);
  assert.equal(pixel.proof_status, 'FILE_INSTALLED_UNTESTED');
  assert.equal(new URL(pixel.source_url).protocol, 'https:');
  const lightning = loras.find(l => l.name === 'sdxl_lightning_4step_lora');
  assert.equal(lightning.classification, 'acceleration');
  assert.equal(lightning.family, FAMILIES.SDXL);
  assert.equal(lightning.metal_inference_status, 'FUNCTIONAL_METAL');
  assert.equal(lightning.metal_target_ids[0], 'sdxl-base');
  assert.equal(lightning.metal_performance_status, 'MEASURED');
  assert.match(lightning.metal_performance_summary, /quality review pending/);
});
