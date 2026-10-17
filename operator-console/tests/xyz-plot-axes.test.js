'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const X = require('../public/dexdiffusion/xyz-plot.js');

test('Prompt order: permutations of fragments, reordered in place (A1111 apply_order)', () => {
  assert.deepEqual(X.parseValues('prompt_order', 'a, b, c').values.map(v => v.join('')), ['abc', 'acb', 'bac', 'bca', 'cab', 'cba']);
  assert.equal(X.applyPromptOrder('red cat, blue hat, green fox', ['green fox', 'red cat', 'blue hat']), 'green fox, red cat, blue hat');
  assert.equal(X.applyPromptOrder('x red, y blue tail', ['blue', 'red']), 'x blue, y red tail');
  assert.equal(X.applyPromptOrder('a cat', ['dog', 'cat']), null);
  const p = X.buildPlan({ prompt: 'a cat, a hat', negative_prompt: 'cat' }, { x: { type: 'prompt_order', values: 'a cat, a hat' } });
  assert.equal(p.ok, true); assert.equal(p.total, 2);
  assert.equal(p.cells[0].prompt, 'a cat, a hat'); assert.equal(p.cells[1].prompt, 'a hat, a cat');
  assert.equal(p.cells[1].negative_prompt, 'cat', 'only the positive prompt is reordered');
  assert.equal(p.cells[1].fullTitle, 'Prompt order: a hat, a cat');
  assert.doesNotMatch(p.cells[1].title, /hat/, 'queue title carries no prompt text');
  assert.deepEqual(p.axes[0].values, ['a cat, a hat', 'a hat, a cat']);
  assert.match(X.buildPlan({ prompt: 'a cat' }, { x: { type: 'prompt_order', values: 'cat, dog' } }).errors[0], /not found in the prompt/);
  assert.match(X.buildPlan({ prompt: 'a' }, { x: { type: 'prompt_order', values: 'a' } }).errors[0], /at least two/);
  assert.match(X.buildPlan({ prompt: 'a' }, { x: { type: 'prompt_order', values: 'a,b,c,d,e,f' } }).errors[0], /limit is 5/);
});

test('Size axis: WxH sets width and height; bad values and Width/Height clashes are refused', () => {
  const p = X.buildPlan({ prompt: 'x' }, { x: { type: 'size', values: '512x768, 640 x 640' } });
  assert.equal(p.ok, true);
  assert.deepEqual(p.cells[0].overrides, { width: 512, height: 768 });
  assert.deepEqual(p.cells[1].overrides, { width: 640, height: 640 });
  assert.equal(p.cells[1].title, 'Size: 640x640');
  assert.match(X.parseValues('size', '512').error, /not WxH/);
  assert.match(X.parseValues('size', '8x512').error, /outside 64–2048/);
  assert.match(X.buildPlan({ prompt: 'x' }, { x: { type: 'size', values: '512x512' }, y: { type: 'width', values: '512' } }).errors.join(), /Size cannot be combined/);
});

test('Hires steps / upscaler / Denoising need High-Res Refine on and a target that has it', () => {
  const ax = { x: { type: 'hires_steps', values: '10, 20' }, y: { type: 'denoising', values: '0.4, 0.6' }, z: { type: 'hires_upscaler', values: 'Latent, Lanczos' } };
  const on = X.buildPlan({ prompt: 'x', hires: true }, ax, { hiresRefine: true });
  assert.equal(on.ok, true); assert.equal(on.total, 8);
  assert.deepEqual(on.cells[0].overrides, { hires_steps: 10, hires_denoise: 0.4, hires_upscaler: 'Latent' });
  assert.equal(on.cells[7].fullTitle, 'Hires steps: 20 · Denoising: 0.6 · Hires upscaler: Lanczos');
  for (const base of [{ prompt: 'x' }, { prompt: 'x', hires: false }]) {
    const off = X.buildPlan(base, { x: { type: 'denoising', values: '0.4,0.6' } }, { hiresRefine: true });
    assert.match(off.errors[0], /High-Res Refine is off/);
  }
  assert.match(X.buildPlan({ prompt: 'x', hires: true }, { x: { type: 'hires_steps', values: '5,6' } }, { hiresRefine: false }).errors[0], /does not use hires steps/);
  assert.match(X.parseValues('denoising', '0.9-1.5 (+0.3)').error, /outside 0.05–0.95/);
  assert.deepEqual(X.parseValues('hires_steps', '0, 10').values, [0, 10]);
});

test('engine-absent axes are refused with the engine reason', () => {
  const v = X.buildPlan({ prompt: 'x' }, { x: { type: 'var_seed', values: '1,2' } });
  assert.equal(v.ok, false); assert.match(v.errors[0], /X axis Var\. seed is not available: the installed sd-cli has no variation seed/);
  assert.match(X.buildPlan({ prompt: 'x' }, { y: { type: 'var_strength', values: '0.1' } }).errors[0], /Var\. strength.*no variation strength/);
  assert.match(X.buildPlan({ prompt: 'x' }, { z: { type: 'checkpoint', values: 'a' } }).errors[0], /checkpoint swap per cell/);
  assert.match(X.buildPlan({ prompt: 'x' }, { x: { type: 'bogus', values: '1' } }).errors[0], /unknown type/);
});

test('swap helpers exchange axis configs and leave the input alone', () => {
  const a = { x: { type: 'steps', values: '1,2' }, y: { type: 'seed', values: '3' }, z: { type: 'width', values: '512' } };
  const xy = X.swapXY(a);
  assert.deepEqual([xy.x.type, xy.y.type, xy.z.type], ['seed', 'steps', 'width']);
  assert.deepEqual([X.swapYZ(a).y.type, X.swapYZ(a).z.type], ['width', 'seed']);
  assert.deepEqual([X.swapXZ(a).x.type, X.swapXZ(a).z.type], ['width', 'steps']);
  assert.equal(X.swapAxes(a, 'xy').x.values, '3');
  assert.equal(a.x.type, 'steps');
  const half = X.swapXZ({ x: { type: 'steps', values: '1' } });
  assert.equal(half.x, undefined); assert.equal(half.z.type, 'steps');
  assert.throws(() => X.swapAxes(a, 'xx'), /unknown pair/);
  const p = X.buildPlan({ prompt: 'x' }, { x: xy.x, y: xy.y });
  assert.deepEqual(p.dims, [1, 2, 1], 'the swapped plan is the transposed grid');
});

test('vary seeds: offsets follow A1111 cell() (x + y*xdim + z*xdim*ydim); default keeps fixed-seed behaviour', () => {
  const axes = { x: { type: 'steps', values: '10,20,30' }, y: { type: 'cfg_scale', values: '5,6' }, z: { type: 'sampler', values: 'a,b' } };
  const none = X.buildPlan({ prompt: 'x', seed: 100 }, axes);
  assert.ok(none.cells.every(c => c.seedOffset === 0 && c.overrides.seed === undefined));
  const all = X.buildPlan({ prompt: 'x', seed: 100 }, axes, null, { varySeeds: { x: true, y: true, z: true } });
  assert.deepEqual(all.cells.map(c => c.seedOffset), [...Array(12).keys()], 'full vary gives a distinct offset per cell');
  assert.deepEqual(all.cells.map(c => c.overrides.seed), [...Array(12).keys()].map(i => i === 0 ? undefined : 100 + i));
  const yOnly = X.buildPlan({ prompt: 'x', seed: 100 }, axes, null, { varySeeds: { y: true } });
  assert.deepEqual(yOnly.cells.slice(0, 6).map(c => c.seedOffset), [0, 0, 0, 1, 1, 1], 'xdim is 1 when X does not vary');
  const zy = X.buildPlan({ prompt: 'x', seed: 100 }, axes, null, { varySeeds: { y: true, z: true } });
  assert.equal(zy.cells[6].seedOffset, 2, 'z step = xdim(1) * ydim(2)');
  const zx = X.buildPlan({ prompt: 'x', seed: 100 }, axes, null, { varySeeds: { x: true, z: true } });
  assert.equal(zx.cells[6].seedOffset, 3, 'z step = xdim(3) * ydim(1)');
  // a Seed-axis value is applied first, then the offset; an unknown base seed leaves only seedOffset for the server
  const sa = X.buildPlan({ prompt: 'x' }, { x: { type: 'seed', values: '10, 20' }, y: { type: 'steps', values: '5,6' } }, null, { varySeeds: { x: true, y: true } });
  assert.deepEqual(sa.cells.map(c => c.overrides.seed), [10, 21, 12, 23]);
  const unk = X.buildPlan({ prompt: 'x' }, axes, null, { varySeeds: { x: true } });
  assert.equal(unk.cells[2].seedOffset, 2); assert.equal(unk.cells[2].overrides.seed, undefined);
  assert.match(X.buildPlan({ prompt: 'x', seed: 2147483647 }, axes, null, { varySeeds: { x: true } }).errors[0], /above 2147483647/);
});

test('processing order: costliest axis outermost, ties fall back to z,y,x; grid positions unchanged', () => {
  assert.deepEqual(X.processingOrder({}), { first: 'z', second: 'y', third: 'x' });
  assert.deepEqual(X.processingOrder({ x: 1 }), { first: 'x', second: 'z', third: 'y' });
  assert.deepEqual(X.processingOrder({ x: 1, y: 0.5 }), { first: 'x', second: 'y', third: 'z' });
  assert.deepEqual(X.processingOrder({ y: 1 }), { first: 'y', second: 'z', third: 'x' });
  assert.deepEqual(X.processingOrder({ y: 1, x: 0.7 }), { first: 'y', second: 'x', third: 'z' });
  assert.deepEqual(X.processingOrder({ z: 1, x: 0.5 }), { first: 'z', second: 'x', third: 'y' });
  assert.deepEqual(X.processingOrder({ x: 1, y: 1 }), { first: 'z', second: 'y', third: 'x' }, 'upstream: a tie at the top matches no branch');
  assert.deepEqual(X.cellOrder([2, 2, 2], { x: 1 }), [0, 2, 4, 6, 1, 3, 5, 7], 'x outermost, then z, y innermost');
  assert.deepEqual(X.cellOrder([2, 2, 2], {}), [0, 1, 2, 3, 4, 5, 6, 7], 'default is the plain index order');
  assert.deepEqual(X.cellOrder([3, 1, 2], { z: 1 }).slice().sort((a, b) => a - b), [0, 1, 2, 3, 4, 5], 'a permutation of the grid positions');
  const p = X.buildPlan({ prompt: 'x' }, { x: { type: 'steps', values: '1,2' }, y: { type: 'seed', values: '1,2' } });
  assert.deepEqual(p.order, [0, 1, 2, 3]); assert.deepEqual(p.processing, { first: 'z', second: 'y', third: 'x' });
  assert.deepEqual(p.cells.map(c => c.index), [0, 1, 2, 3]);
});

test('upstream parity: int [n] truncates like int(np.linspace), float (+s) follows np.arange and may pass the end', () => {
  assert.deepEqual(X.parseValues('steps', '1-10 [5]').values, [1, 3, 5, 7, 10]);
  assert.deepEqual(X.parseValues('steps', '1-2 [3]').values, [1, 1, 2], 'truncated, not rounded');
  assert.deepEqual(X.parseValues('cfg_scale', '1-2 (+0.3)').values, [1, 1.3, 1.6, 1.9, 2.2]);
  assert.deepEqual(X.parseValues('cfg_scale', '1-3').values, [1, 2, 3]);
  assert.deepEqual(X.parseValues('cfg_scale', '5-3 (-1)').values, [5, 4, 3], 'np.arange(5, 2, -1)');
  assert.deepEqual(X.parseValues('cfg_scale', '1-2 [3]').values, [1, 1.5, 2]);
});

test('upstream parity: leading + and spaces after a sign are accepted in ranges', () => {
  assert.deepEqual(X.parseValues('steps', '+2 - +4').values, [2, 3, 4]);
  assert.deepEqual(X.parseValues('cfg_scale', '+ 2 - + 4').values, [2, 3, 4]);
  assert.deepEqual(X.parseValues('cfg_scale', '2. - 4.').values, [2, 3, 4]);
  assert.deepEqual(X.parseValues('steps', '+5').values, [5]);
});

test('upstream parity: string axes keep empty entries (replace a word with nothing) and strip quoted values', () => {
  assert.deepEqual(X.parseValues('prompt_sr', 'cat, ,dog').values, ['cat', '', 'dog']);
  assert.deepEqual(X.parseValues('prompt_sr', 'cat, " padded "').values, ['cat', 'padded']);
  const p = X.buildPlan({ prompt: 'a cat here', negative_prompt: '' }, { x: { type: 'prompt_sr', values: 'cat, ,dog' } });
  assert.deepEqual(p.cells.map(c => c.prompt), ['a cat here', 'a  here', 'a dog here']);
  assert.match(X.buildPlan({ prompt: 'a cat' }, { x: { type: 'prompt_sr', values: ', dog' } }).errors.join(), /cannot be empty/);
  assert.match(X.parseValues('sampler', 'euler, ').error, /cannot be empty/);
  assert.match(X.parseValues('prompt_sr', '  ').error, /at least one value/);
  assert.deepEqual(X.csv('a,,b'), ['a', 'b'], 'numeric csv still drops empties');
});

test('upstream parity: Seed -1 becomes one concrete random seed per plot unless kept', () => {
  let n = 0;
  const random = () => [0.25, 0.5][n++ % 2];
  const p = X.buildPlan({ prompt: 'x' }, { x: { type: 'seed', values: '-1, 7, -1' } }, null, { random });
  assert.equal(p.ok, true);
  assert.deepEqual(p.cells.map(c => c.overrides.seed), [Math.floor(0.25 * 2147483648), 7, Math.floor(0.5 * 2147483648)]);
  assert.deepEqual(p.axes[0].values, p.cells.map(c => String(c.overrides.seed)), 'the plan, legend and cells agree');
  const kept = X.buildPlan({ prompt: 'x' }, { x: { type: 'seed', values: '-1, 7' } }, null, { keepRandomSeeds: true });
  assert.deepEqual(kept.cells.map(c => c.overrides.seed), [-1, 7]);
  const v = X.buildPlan({ prompt: 'x' }, { x: { type: 'seed', values: '-1, 7' } }, null, { keepRandomSeeds: true, varySeeds: { x: true } });
  assert.equal(v.cells[0].overrides.seed, -1, 'a kept -1 is never offset');
  assert.match(X.parseValues('seed', '-2').error, /outside -1–/);
});
