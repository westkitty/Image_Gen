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
