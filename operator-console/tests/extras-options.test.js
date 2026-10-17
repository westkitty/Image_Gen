'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const X = require('../public/dexdiffusion/extras-options.js');

const SCRIPT = path.join(__dirname, '..', '..', 'sdcpp-workflow', 'bin', 'extras-resize.py');
const py = (args) => spawnSync('python3', [SCRIPT, ...args], { encoding: 'utf8' });

test('normalizeExtras: defaults, bounds and unknown fields', () => {
  assert.equal(X.normalizeExtras({}).options.upscaler, 'lanczos');
  assert.match(X.normalizeExtras({ bogus: 1 }).error, /Unexpected extras field/);
  assert.match(X.normalizeExtras({ scale: 0.5 }).error, /scale must be/);
  assert.match(X.normalizeExtras({ mode: 'to', width: 10, height: 512 }).error, /width must be/);
  assert.match(X.normalizeExtras({ upscaler: 'esrgan' }).error, /upscaler must be/);
  assert.match(X.normalizeExtras({ visibility: 2 }).error, /visibility/);
  assert.match(X.normalizeExtras({ upscaler: 'none' }).error, /performs no upscale/, 'A1111: Upscaler 1 None is a no-op, so it is refused rather than half-applied');
  assert.match(X.normalizeExtras({ upscaler: 'none', upscaler2: 'lanczos', visibility: 0.5 }).error, /performs no upscale/, 'a None/Lanczos blend would mix two image sizes');
  assert.match(X.normalizeExtras({ max_side: -8 }).error, /max_side/);
});

test('face restoration is refused with the real reason, never faked', () => {
  for (const f of ['gfpgan', 'codeformer']) assert.match(X.normalizeExtras({ [f]: 0.5 }).error, /not available/);
  assert.ok(X.normalizeExtras({ gfpgan: 0 }).options);
});

test('plan: scale-by, scale-to covering size, crop, output limit', () => {
  const by = X.normalizeExtras({ scale: 2.5 }).options;
  assert.deepEqual(X.plan(400, 200, by).out, { w: 1000, h: 496 }, 'upscaler.py: dest = int((dim*scale)//8*8)');
  const to = X.normalizeExtras({ mode: 'to', width: 1024, height: 1024, crop: false }).options;
  assert.deepEqual(X.plan(512, 256, to).out, { w: 2048, h: 1024 }, 'without crop the covering size is kept');
  const crop = X.normalizeExtras({ mode: 'to', width: 1024, height: 1024, crop: true }).options;
  assert.deepEqual(X.plan(512, 256, crop).out, { w: 1024, h: 1024 });
  assert.match(X.validateForSource(2048, 2048, by), /4096px limit/);
  assert.equal(X.validateForSource(512, 512, by), null);
});

test('extras-resize.py honours the JS plan, blends upscalers and crops', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extras-'));
  const src = path.join(dir, 'in.png');
  const mk = spawnSync('python3', ['-c', `from PIL import Image\nim=Image.new('RGB',(64,32),(10,20,30))\nfor x in range(32):\n    for y in range(32): im.putpixel((x,y),(250,0,0))\nim.save(${JSON.stringify(src)})`]);
  assert.equal(mk.status, 0, String(mk.stderr));
  const cases = [
    { scale: 3 },
    { mode: 'to', width: 160, height: 160, crop: true },
    { mode: 'to', width: 160, height: 160, crop: false },
    { scale: 2, upscaler2: 'nearest', visibility: 0.5 },
  ];
  for (const c of cases) {
    const o = X.normalizeExtras(c).options, out = path.join(dir, 'o.png');
    const r = py([src, out, JSON.stringify(o)]);
    assert.equal(r.status, 0, r.stderr);
    const res = JSON.parse(r.stdout);
    const p = X.plan(64, 32, o);
    assert.deepEqual(res.out, [p.out.w, p.out.h], JSON.stringify(c));
  }
  // visibility 1 == the second upscaler alone; visibility 0 == the first alone
  const px = (opts) => { const out = path.join(dir, 'p.png'); py([src, out, JSON.stringify(X.normalizeExtras(opts).options)]); return spawnSync('python3', ['-c', `from PIL import Image;im=Image.open(${JSON.stringify(out)});print(im.getpixel((31,16)))`], { encoding: 'utf8' }).stdout.trim(); };
  assert.equal(px({ scale: 2, upscaler: 'bilinear', upscaler2: 'nearest', visibility: 1 }), px({ scale: 2, upscaler: 'nearest' }));
  assert.equal(px({ scale: 2, upscaler: 'bilinear', upscaler2: 'nearest', visibility: 0 }), px({ scale: 2, upscaler: 'bilinear' }));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('upstream parity (82a973c0 postprocessing_upscale.py / upscaler.py): //8 sizes, max side length, JS == Python', () => {
  const two = X.normalizeExtras({ scale: 2 }).options;
  assert.deepEqual(X.plan(1001, 703, two).stage, { w: 2000, h: 1400 }, 'audit example: round() gave 2002x1406');
  const lim = X.normalizeExtras({ scale: 2, max_side: 1200 }).options;
  const p = X.plan(1000, 500, lim);
  assert.deepEqual(p.limited, { w: 1200, h: 600 }); assert.equal(p.crop, false); assert.deepEqual(p.out, { w: 1200, h: 600 });
  assert.deepEqual(X.limitSize(500, 1000, 700), { w: 350, h: 700 }, 'portrait limits the height');
  assert.equal(X.plan(1000, 500, X.normalizeExtras({ scale: 2, max_side: 4000 }).options).limited, null, 'under the limit nothing changes');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extras-par-'));
  const src = path.join(dir, 'in.png');
  assert.equal(spawnSync('python3', ['-c', `from PIL import Image; Image.new('RGB',(101,71),(1,2,3)).save(${JSON.stringify(src)})`]).status, 0);
  for (const c of [{ scale: 2 }, { scale: 1.37 }, { scale: 3, max_side: 200 }, { mode: 'to', width: 160, height: 96, crop: true }, { scale: 1.5, upscaler: 'nearest', upscaler2: 'lanczos', visibility: 0.3 }]) {
    const o = X.normalizeExtras(c).options, out = path.join(dir, 'o.png');
    const r = py([src, out, JSON.stringify(o)]);
    assert.equal(r.status, 0, r.stderr);
    const plan = X.plan(101, 71, o);
    assert.deepEqual(JSON.parse(r.stdout).out, [plan.out.w, plan.out.h], JSON.stringify(c));
  }
});
