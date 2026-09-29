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
  assert.equal(evaluateCompatibility(FAMILIES.SD15, FAMILIES.SD15), 'Compatible');
  assert.equal(evaluateCompatibility(FAMILIES.SDXL, FAMILIES.SDXL), 'Compatible');

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
