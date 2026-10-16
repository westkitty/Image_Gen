'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const I = require('../public/dexdiffusion/inpaint-options.js');

const SCRIPT = path.join(__dirname, '..', 'bin', 'inpaint-region.py');
const py = code => { const r = spawnSync('python3', ['-c', code], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
const tool = (...args) => { const r = spawnSync('python3', [SCRIPT, ...args.map(String)], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
const px = (file, x, y) => JSON.parse(py(`from PIL import Image; import json; print(json.dumps(Image.open(${JSON.stringify(file)}).convert("RGB").getpixel((${x},${y}))))`));

test('options: defaults keep today\'s behaviour; area/padding/blur/content are validated', () => {
  assert.deepEqual(I.normalizeInpaintOptions({}).options, { area: 'whole', padding: 32, blur: 4, content: 'original' });
  assert.deepEqual(I.normalizeInpaintOptions({ inpaint_area: 'only_masked', inpaint_padding: 16, mask_blur: 8, masked_content: 'fill' }).options, { area: 'only_masked', padding: 16, blur: 8, content: 'fill' });
  assert.match(I.normalizeInpaintOptions({ inpaint_area: 'tiles' }).error, /inpaint_area must be/);
  assert.match(I.normalizeInpaintOptions({ masked_content: 'latent_noise' }).error, /not available/);
  assert.match(I.normalizeInpaintOptions({ masked_content: 'latent_nothing' }).error, /not available/);
  assert.match(I.normalizeInpaintOptions({ masked_content: 'sepia' }).error, /must be one of/);
  assert.match(I.normalizeInpaintOptions({ inpaint_area: 'only_masked', inpaint_padding: 300 }).error, /0-256/);
  assert.match(I.normalizeInpaintOptions({ mask_blur: 65 }).error, /0-64/);
  assert.match(I.normalizeInpaintOptions({ mask_blur: 2.5 }).error, /0-64/);
  assert.match(I.normalizeInpaintOptions({ inpaint_padding: 16 }).error, /only applies when inpaint_area is only_masked/);
});

test('cropRegion: A1111 get/expand_crop_region arithmetic (hand-checked cases)', () => {
  assert.deepEqual(I.cropRegion([100, 100, 200, 160], 32, 512, 512, 512, 512), [68, 48, 232, 212]);
  assert.deepEqual(I.cropRegion([10, 10, 60, 60], 32, 512, 512, 512, 512), [0, 0, 92, 92], 'clamped to the top-left corner, aspect already square');
  const tall = I.cropRegion([200, 50, 240, 400], 0, 512, 512, 512, 512);   // tall region -> widened, stays inside the image
  assert.equal(tall[2] - tall[0], 350); assert.ok(tall[0] >= 0 && tall[2] <= 512);
  for (const box of [I.cropRegion([0, 0, 512, 512], 32, 512, 256, 512, 512), I.cropRegion([300, 300, 500, 500], 64, 768, 512, 512, 512)]) {
    assert.ok(box[0] >= 0 && box[1] >= 0 && box[2] <= 512 && box[3] <= 512 && box[2] > box[0] && box[3] > box[1], JSON.stringify(box));
  }
});

test('cropRegion (JS) equals the Python implementation on many cases', () => {
  const cases = [];
  let seed = 7; const rnd = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  for (let i = 0; i < 60; i++) {
    const W = 256 + rnd(768), H = 256 + rnd(768);
    const x1 = rnd(W - 8), y1 = rnd(H - 8), x2 = x1 + 4 + rnd(W - x1 - 4), y2 = y1 + 4 + rnd(H - y1 - 4);
    cases.push([[x1, y1, x2, y2], rnd(129), [256, 384, 512, 640, 768][rnd(5)], [256, 384, 512, 640, 768][rnd(5)], W, H]);
  }
  const out = JSON.parse(py(`
import json, sys
sys.path.insert(0, ${JSON.stringify(path.dirname(SCRIPT))})
import importlib.util
spec = importlib.util.spec_from_file_location("ir", ${JSON.stringify(SCRIPT)}); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
print(json.dumps([list(m.crop_region(*c)) for c in json.loads(${JSON.stringify(JSON.stringify(cases))})]))`));
  cases.forEach((c, i) => assert.deepEqual(I.cropRegion(...c), out[i], JSON.stringify(c)));
});

test('region: crop + resize to the work size, mask crops with it, box reported; sources untouched', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-inp-'));
  try {
    const src = path.join(dir, 's.png'), mask = path.join(dir, 'm.png');
    py(`from PIL import Image; im=Image.new("RGB",(512,512),(10,20,30)); im.paste((255,0,0),(100,100,200,160)); im.save(${JSON.stringify(src)}); m=Image.new("L",(512,512),0); m.paste(255,(100,100,200,160)); m.save(${JSON.stringify(mask)})`);
    const before = fs.readFileSync(src);
    const res = JSON.parse(tool('region', src, mask, path.join(dir, 'ci.png'), path.join(dir, 'cm.png'), 32, 512, 512));
    assert.deepEqual(res.box, [68, 48, 232, 212]);
    assert.equal(py(`from PIL import Image; print(*Image.open(${JSON.stringify(path.join(dir, 'ci.png'))}).size, *Image.open(${JSON.stringify(path.join(dir, 'cm.png'))}).size)`), '512 512 512 512');
    // the red patch sits at the crop centre-ish; the mask is white there and black at a corner
    assert.deepEqual(px(path.join(dir, 'ci.png'), 256, 256), [255, 0, 0]);
    assert.deepEqual(px(path.join(dir, 'ci.png'), 5, 5), [10, 20, 30]);
    assert.deepEqual(px(path.join(dir, 'cm.png'), 256, 256).slice(0, 1), [255]);
    assert.deepEqual(px(path.join(dir, 'cm.png'), 5, 5).slice(0, 1), [0]);
    assert.ok(fs.readFileSync(src).equals(before));
    assert.notEqual(spawnSync('python3', [SCRIPT, 'region', src, path.join(dir, 'blank.png'), 'x', 'y', 0, 512, 512]).status, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('fill: masked area takes colours from the surroundings; unmasked pixels are unchanged', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-inp-'));
  try {
    const src = path.join(dir, 's.png'), mask = path.join(dir, 'm.png'), out = path.join(dir, 'o.png');
    py(`from PIL import Image; im=Image.new("RGB",(128,128),(0,0,255)); im.paste((255,0,0),(0,0,64,128)); im.paste((0,255,0),(48,48,80,80)); im.save(${JSON.stringify(src)}); m=Image.new("L",(128,128),0); m.paste(255,(48,48,80,80)); m.save(${JSON.stringify(mask)})`);
    tool('fill', src, mask, out);
    assert.deepEqual(px(out, 5, 5), [255, 0, 0], 'unmasked red');
    assert.deepEqual(px(out, 120, 120), [0, 0, 255], 'unmasked blue');
    const c = px(out, 64, 64);
    assert.notDeepEqual(c, [0, 255, 0], 'the original green content is gone');
    assert.ok(c[0] > 20 && c[2] > 20 && c[1] < 60, 'a red/blue blend diffused in: ' + JSON.stringify(c));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('pasteback: generated patch lands inside the mask at the box; everything outside is the original pixel-for-pixel', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-inp-'));
  try {
    const src = path.join(dir, 's.png'), mask = path.join(dir, 'm.png'), gen = path.join(dir, 'g.png');
    py(`from PIL import Image; Image.new("RGB",(256,256),(10,20,30)).save(${JSON.stringify(src)}); m=Image.new("L",(256,256),0); m.paste(255,(100,100,140,140)); m.save(${JSON.stringify(mask)}); Image.new("RGB",(512,512),(250,250,0)).save(${JSON.stringify(gen)})`);
    tool('pasteback', gen, src, mask, 60, 60, 190, 190, 0);
    assert.equal(py(`from PIL import Image; print(*Image.open(${JSON.stringify(gen)}).size)`), '256 256');
    assert.deepEqual(px(gen, 120, 120), [250, 250, 0], 'inside the mask: generated');
    assert.deepEqual(px(gen, 70, 70), [10, 20, 30], 'inside the box but outside the mask: original');
    assert.deepEqual(px(gen, 10, 10), [10, 20, 30], 'outside the box: original');
    // with blur the mask edge softens but far-away pixels are still exactly the original
    py(`from PIL import Image; Image.new("RGB",(512,512),(250,250,0)).save(${JSON.stringify(gen)})`);
    tool('pasteback', gen, src, mask, 60, 60, 190, 190, 6);
    const edge = px(gen, 98, 120);
    assert.ok(edge[0] > 10 && edge[0] < 250, 'blended edge ' + JSON.stringify(edge));
    assert.deepEqual(px(gen, 70, 70), [10, 20, 30]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
