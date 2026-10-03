'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const D = require('../public/dexdiffusion/client-helpers.js');

const W = 16, H = 12;
function square(x0, y0, x1, y1) {
  const a = new Uint8ClampedArray(W * H);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) a[y * W + x] = 255;
  return a;
}
const painted = a => a.reduce((n, v) => n + (v > 0 ? 1 : 0), 0);

test('mask grow/shrink/blur/feather/invert preserve dimensions and behave', () => {
  const m = square(5, 4, 8, 7); // 4x4 = 16 px
  assert.equal(painted(m), 16);
  const g = D.maskDilate(m, W, H, 1);
  assert.equal(g.length, W * H);
  assert.equal(painted(g), 36, 'grow by 1 -> 6x6');
  assert.equal(painted(D.maskErode(g, W, H, 1)), 16, 'shrink undoes grow');
  assert.equal(painted(D.maskErode(m, W, H, 2)), 0);
  const b = D.maskBlur(m, W, H, 1);
  assert.equal(b.length, W * H);
  assert.ok(b[4 * W + 4] > 0 && b[4 * W + 4] < 255, 'blur softens edges');
  const f = D.maskFeather(m, W, H, 2);
  assert.equal(f[5 * W + 6], 255, 'feather keeps the painted core fully masked');
  assert.ok(painted(f) > 16);
  const inv = D.maskInvert(m);
  assert.equal(painted(inv), W * H - 16);
  assert.deepEqual(D.maskInvert(inv), m);
});

test('mask safety: blank rejected, full mask warned, partial ok', () => {
  assert.equal(D.maskVerdict(new Uint8ClampedArray(W * H)).kind, 'blank');
  const full = D.maskVerdict(new Uint8ClampedArray(W * H).fill(255));
  assert.equal(full.kind, 'full');
  assert.equal(full.message, 'The entire image is masked. This will regenerate nearly everything.');
  assert.equal(D.maskVerdict(square(0, 0, 3, 3)).kind, 'partial');
  assert.equal(D.FULL_MASK_COVERAGE, 0.98);
});

test('model-aware controls: MFLUX hides SD-only knobs; SDCPP descriptor wins', () => {
  const mflux = D.controlsFor({ id: 'flux2-klein-4b', capabilities: { backend: 'mflux', negativePrompt: false, cfg: false, scheduler: false, vae: false, hiresRefine: false, img2img: false } });
  assert.deepEqual([mflux.negativePrompt, mflux.cfg, mflux.scheduler, mflux.vae, mflux.hiresRefine], [false, false, false, false, false]);
  const sd = D.controlsFor({ id: 'sd15', capabilities: { backend: 'sdcpp', negativePrompt: true, cfg: true, scheduler: true, vae: true, hiresRefine: true, img2img: true, inpaint: true, outpaint: true, controlNet: false } });
  assert.equal(sd.hiresRefine, true);
  assert.equal(sd.controlNet, false, 'ControlNet is never offered without a proven asset');
  assert.equal(D.controlsFor({ backend: 'mflux' }).negativePrompt, false, 'legacy target without descriptor');
});

test('aspect presets are multiples of 64 within the target max', () => {
  assert.deepEqual(D.aspectDims('square', 1024, 1024), { width: 1024, height: 1024 });
  assert.deepEqual(D.aspectDims('landscape', 1024, 1024), { width: 1024, height: 768 });
  assert.deepEqual(D.aspectDims('portrait', 512, 2048), { width: 384, height: 512 });
});

test('dimension policy is backend-aware and preserves width and height independently', () => {
  const flux = { minWidth: 256, minHeight: 256, maxWidth: 2048, maxHeight: 2048, dimensionMultiple: 16, defaultWidth: 1024, defaultHeight: 1024 };
  assert.equal(D.dimensionIssue(flux, 768, 512), null);
  assert.match(D.dimensionIssue(flux, 520, 512), /Width must be a multiple of 16/);
  assert.deepEqual(D.dimensionsForTarget(flux, { width: 768, height: 512 }), { width: 768, height: 512 });
  assert.deepEqual(D.dimensionsForTarget({ ...flux, maxWidth: 512 }, { width: 768, height: 512 }), { width: 512, height: 512 });
  assert.deepEqual(D.dimensionsForTarget({ ...flux, maxHeight: 512 }, { width: 512, height: 768 }), { width: 512, height: 512 });
});

test('dimension info reports aspect ratio and megapixels without changing values', () => {
  assert.deepEqual(D.dimensionInfo(768, 512), { aspectRatio: '3:2', megapixels: '0.39' });
});

test('job results: structured list preferred, legacy single image still mapped', () => {
  const rs = [{ index: 0, status: 'DONE', imageId: 'a.png' }, { index: 1, status: 'DONE', imageId: 'b.png' }];
  assert.equal(D.jobResults({ results: rs }).length, 2);
  const legacy = D.jobResults({ controlledOutputImageUrl: '/api/images/x.png', runId: 'r' });
  assert.deepEqual(legacy.map(r => r.imageId), ['x.png']);
  assert.deepEqual(D.jobResults({}), []);
});

test('compare rows flag differing metadata only where present', () => {
  const rows = D.compareRows([{ width: 512, height: 512, meta: { seed: 1, target: 'sd15' } }, { width: 512, height: 512, meta: { seed: 2, target: 'sd15' } }]);
  const byKey = Object.fromEntries(rows.map(r => [r.key, r]));
  assert.equal(byKey.seed.differs, true);
  assert.equal(byKey.target.differs, false);
  assert.equal(byKey.width.differs, false);
  assert.equal(byKey.cfg, undefined);
});

test('privacy: persisted edit session never holds prompt text unless prompt saving is on', () => {
  const ws = { editSourceId: 'a.png', quantity: 3, batchText: '1. T\n\nsecret prompt', prompt: 'secret', compareIds: ['a.png'] };
  const off = D.persistableSession(ws, false);
  assert.ok(!JSON.stringify(off).includes('secret'));
  assert.equal(off.editSourceId, 'a.png');
  assert.equal(off.quantity, 3);
  assert.ok(D.persistableSession(ws, true).batchText.includes('secret'));
});

test('recipes are stored through the privacy-aware sanitizer in the UI', () => {
  const comp = fs.readFileSync(path.join(__dirname, '..', 'public', 'dexdiffusion', 'component.js'), 'utf8');
  // Presets are versioned (v2) and written through one privacy-aware migrate/sanitize function.
  assert.match(comp, /DexEdit\.migrateRecipe\(/);
  assert.match(comp, /this\.saveRecipe\('create'/);
  assert.match(comp, /renameFavoritePreset/);
  assert.doesNotMatch(comp, /params: this\.currentParams\(\)/, 'old preset format persisted prompts unconditionally');
});
