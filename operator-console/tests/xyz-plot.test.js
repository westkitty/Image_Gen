'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const X = require('../public/dexdiffusion/xyz-plot.js');

test('csv: quotes keep commas, empties dropped', () => {
  assert.deepEqual(X.csv('a, b ,,"c, d", "e"'), ['a', 'b', 'c, d', 'e']);
  assert.deepEqual(X.csv('"say ""hi"""'), ['say "hi"']);
});

test('parseValues: ints, A1111 ranges, floats, bounds', () => {
  assert.deepEqual(X.parseValues('steps', '10, 20').values, [10, 20]);
  assert.deepEqual(X.parseValues('steps', '1-5').values, [1, 2, 3, 4, 5]);
  assert.deepEqual(X.parseValues('steps', '10-30 (+10)').values, [10, 20, 30]);
  assert.deepEqual(X.parseValues('steps', '30-10 (-10)').values, [30, 20, 10]);
  assert.deepEqual(X.parseValues('steps', '10-30 [3]').values, [10, 20, 30]);
  assert.deepEqual(X.parseValues('cfg_scale', '4-7 (+1.5)'.replace('1.5', '1')).values, [4, 5, 6, 7]);
  assert.deepEqual(X.parseValues('cfg_scale', '1-2 [3]').values, [1, 1.5, 2]);
  assert.deepEqual(X.parseValues('cfg_scale', '5.5, 7').values, [5.5, 7]);
  assert.match(X.parseValues('steps', '10, x').error, /not a whole number/);
  assert.match(X.parseValues('steps', '500').error, /outside 1–150/);
  assert.match(X.parseValues('steps', '5-1 (+1)').error, /wrong way/);
  assert.match(X.parseValues('steps', ' ').error, /at least one value/);
  assert.match(X.parseValues('nope', '1').error, /Unknown axis/);
  assert.deepEqual(X.parseValues('sampler', 'euler_a, "dpm++ 2m"').values, ['euler_a', 'dpm++ 2m']);
});

test('buildPlan: z-major order, labels and overrides', () => {
  const p = X.buildPlan({ prompt: 'a cat', negative_prompt: '' }, { x: { type: 'steps', values: '10,20' }, y: { type: 'cfg_scale', values: '5,7' }, z: { type: 'seed', values: '1,2' } });
  assert.equal(p.ok, true); assert.equal(p.total, 8); assert.deepEqual(p.dims, [2, 2, 2]);
  assert.deepEqual(p.cells[0].overrides, { steps: 10, cfg_scale: 5, seed: 1 });
  assert.deepEqual(p.cells[1].overrides, { steps: 20, cfg_scale: 5, seed: 1 }, 'x varies fastest');
  assert.deepEqual(p.cells[4].overrides, { steps: 10, cfg_scale: 5, seed: 2 }, 'z varies slowest');
  assert.equal(p.cells[7].title, 'Steps: 20 · CFG scale: 7 · Seed: 2');
});

test('Prompt S/R follows A1111: first value is the search term; missing term is an error', () => {
  const ok = X.buildPlan({ prompt: 'a red cat', negative_prompt: 'red tint' }, { x: { type: 'prompt_sr', values: 'red, blue, "dark green"' } });
  assert.deepEqual(ok.cells.map(c => c.prompt), ['a red cat', 'a blue cat', 'a dark green cat']);
  assert.equal(ok.cells[1].negative_prompt, 'blue tint', 'plain S/R also replaces in the negative prompt');
  const only = X.buildPlan({ prompt: 'a red cat', negative_prompt: 'red tint' }, { x: { type: 'negative_sr', values: 'red, blue' } });
  assert.equal(only.cells[1].prompt, 'a red cat'); assert.equal(only.cells[1].negative_prompt, 'blue tint');
  const miss = X.buildPlan({ prompt: 'a cat', negative_prompt: '' }, { x: { type: 'prompt_sr', values: 'dog, cat' } });
  assert.equal(miss.ok, false); assert.match(miss.errors[0], /"dog" was not found/);
});

test('gating: axes the target ignores are refused; duplicates, limits and empties are errors', () => {
  const flux = { cfg: false, sampler: false, negativePrompt: false };
  assert.match(X.buildPlan({ prompt: 'x' }, { x: { type: 'cfg_scale', values: '5,6' } }, flux).errors[0], /every cell would be identical/);
  assert.match(X.buildPlan({ prompt: 'x' }, { x: { type: 'steps', values: '5' }, y: { type: 'steps', values: '6' } }).errors.join(), /different type/);
  assert.match(X.buildPlan({ prompt: 'x' }, {}).errors[0], /at least one axis/);
  assert.match(X.buildPlan({ prompt: 'x' }, { x: { type: 'seed', values: '1-70' } }).errors[0], /limit is 64/);
  assert.equal(X.buildPlan({ prompt: 'x' }, { x: { type: 'steps', values: '5,6' } }, { cfg: true }).ok, true);
});

test('queue titles never carry Prompt S/R text (they are persisted); the preview title still does', () => {
  const p = X.buildPlan({ prompt: 'a red cat', negative_prompt: '' }, { x: { type: 'prompt_sr', values: 'red, secret words' }, y: { type: 'steps', values: '10' } });
  assert.equal(p.cells[1].title, 'Prompt S/R #2 · Steps: 10');
  assert.equal(p.cells[1].fullTitle, 'Prompt S/R: secret words · Steps: 10');
  assert.doesNotMatch(JSON.stringify(p.cells.map(c => c.title)), /secret/);
});
