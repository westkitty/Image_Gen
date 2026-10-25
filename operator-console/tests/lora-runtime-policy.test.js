'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { resolveLoraRuntimePolicy, routesFor } = require('../lora-runtime-policy');

test('Pixel Art rsLoRA has a narrow MFLUX route with user strength kept separate', () => {
  const result = resolveLoraRuntimePolicy({ target: 'flux2-klein-4b', loras: [{ name: 'pixelart_lora', weight: 0.5 }] });
  assert.deepEqual(result, { ok: true, route: { mflux_lora_id: 'pixelart_lora', mflux_lora_strength: 0.5 } });
  assert.deepEqual(routesFor('flux2-klein-4b', 'pixelart_lora.safetensors'), [
    { target: 'flux2-klein-4b', backend: 'mflux', rslora_equivalent: true, production: true },
  ]);
});

test('Pixel Art refuses unsupported targets and strengths outside its verified range', () => {
  assert.match(resolveLoraRuntimePolicy({ target: 'sd15', loras: [{ name: 'pixelart_lora', weight: 1 }] }).error, /verified only with flux2-klein-4b/);
  for (const weight of [0.249, 1.501, NaN]) {
    const result = resolveLoraRuntimePolicy({ target: 'flux2-klein-4b', loras: [{ name: 'pixelart_lora', weight }] });
    assert.equal(result.ok, false);
    assert.match(result.error, /strength must be 0.25–1.50/);
  }
});

test('an unknown MFLUX LoRA id fails closed', () => {
  const result = resolveLoraRuntimePolicy({ target: 'flux2-klein-4b', loras: [{ name: 'attacker-path/any.safetensors', weight: 1 }] });
  assert.equal(result.ok, false);
  assert.match(result.error, /no verified production route/);
});

const RECIPES = {
  sdxl_lightning_4step_lora: { steps: 4, cfg_scale: 0, sampler: 'euler', scheduler: 'sgm_uniform' },
  'Hyper-SDXL-8steps-CFG-lora': { steps: 8, cfg_scale: 6, sampler: 'ddim_trailing', scheduler: 'discrete' },
  lcm_sdxl: { steps: 4, cfg_scale: 1.5, sampler: 'lcm', scheduler: 'lcm' },
};

test('SDXL acceleration adapters are accepted family-only on SDXL and Pony checkpoints with the exact recipe', () => {
  for (const target of ['sdxl-lustify', 'sdxl-pony']) {
    for (const [name, recipe] of Object.entries(RECIPES)) {
      const ok = resolveLoraRuntimePolicy({ target, loras: [{ name, weight: 1 }], ...recipe });
      assert.deepEqual(ok, { ok: true, route: { backend_override: 'MTL0', lora_apply_mode: 'at_runtime' }, family_only: true }, `${name} on ${target}`);
      const wrong = resolveLoraRuntimePolicy({ target, loras: [{ name, weight: 1 }], ...recipe, steps: recipe.steps + 10 });
      assert.equal(wrong.ok, false);
      assert.match(wrong.error, /requires its verified/);
    }
  }
  // The explicitly verified checkpoint is not labelled family-only.
  assert.equal(resolveLoraRuntimePolicy({ target: 'sdxl-base', loras: [{ name: 'lcm_sdxl' }], ...RECIPES.lcm_sdxl }).family_only, undefined);
});

test('acceleration adapters are refused across families, on SDXL Turbo, and on FLUX', () => {
  const cases = [
    ['sd15', 'lcm_sdxl', RECIPES.lcm_sdxl],
    ['sd15-homofidelis', 'sdxl_lightning_4step_lora', RECIPES.sdxl_lightning_4step_lora],
    ['sdxl-turbo', 'lcm_sdxl', RECIPES.lcm_sdxl],
    ['flux2-klein-4b', 'Hyper-SDXL-8steps-CFG-lora', RECIPES['Hyper-SDXL-8steps-CFG-lora']],
    ['flux-fp8', 'lcm_sdxl', RECIPES.lcm_sdxl],
    ['sdxl-lustify', 'lcm_sd15', RECIPES.lcm_sdxl],
    ['sdxl-pony', 'Hyper-SD15-8steps-CFG-lora', RECIPES['Hyper-SDXL-8steps-CFG-lora']],
  ];
  for (const [target, name, recipe] of cases) {
    const result = resolveLoraRuntimePolicy({ target, loras: [{ name }], ...recipe });
    assert.equal(result.ok, false, `${name} on ${target}`);
    assert.match(result.error, /verified only with .*accepted only on/);
  }
  // SD1.5 adapters work family-only on other SD1.5 checkpoints.
  assert.equal(resolveLoraRuntimePolicy({ target: 'sd15-homofidelis', loras: [{ name: 'lcm_sd15' }], ...RECIPES.lcm_sdxl }).family_only, true);
  // Pixel Art (style, MFLUX) has no family widening.
  assert.deepEqual(routesFor('flux2-klein-4b-other', 'pixelart_lora'), []);
});

test('routesFor labels verified and family-only routes honestly', () => {
  const verified = routesFor('sdxl-base', 'lcm_sdxl.safetensors');
  assert.ok(verified.length >= 2);
  assert.ok(verified.every(r => r.verified === true && !r.family_only));
  const family = routesFor('sdxl-lustify', 'sdxl_lightning_4step_lora.safetensors');
  assert.ok(family.length >= 2);
  assert.deepEqual(family[0], {
    target: 'sdxl-lustify', backend_override: 'MTL0', lora_apply_mode: 'at_runtime', production: true,
    recipe: RECIPES.sdxl_lightning_4step_lora, verified: false, family_only: true, family: 'sdxl',
    verified_targets: ['sdxl-base'], proof: 'family-compatible, not yet proven on this checkpoint',
  });
  assert.deepEqual(routesFor('sdxl-turbo', 'lcm_sdxl'), []);
  assert.deepEqual(routesFor('sd15', 'lcm_sdxl'), []);
});

test('auto-discovered checkpoints take their family from the architecture prefix, never from words in the filename', () => {
  const sdxl = { name: 'lcm_sdxl', weight: 1 }, sd15 = { name: 'lcm_sd15', weight: 1 };
  const lcm = { steps: 4, cfg_scale: 1.5, sampler: 'lcm', scheduler: 'lcm' };
  // an SD1.5 file whose name contains "pony" must not accept SDXL accelerators
  assert.equal(resolveLoraRuntimePolicy({ ...lcm, target: 'sd15-auto-sweetPonyMix.safetensors', loras: [sdxl] }).ok, false);
  // an SDXL file whose name contains "sd15" must not accept SD1.5 accelerators
  assert.equal(resolveLoraRuntimePolicy({ ...lcm, target: 'sdxl-auto-fromSd15Merge.safetensors', loras: [sd15] }).ok, false);
  // the correct pairings still work
  assert.equal(resolveLoraRuntimePolicy({ ...lcm, target: 'sd15-auto-sweetPonyMix.safetensors', loras: [sd15] }).ok, true);
  assert.equal(resolveLoraRuntimePolicy({ ...lcm, target: 'sdxl-auto-fromSd15Merge.safetensors', loras: [sdxl] }).ok, true);
});
