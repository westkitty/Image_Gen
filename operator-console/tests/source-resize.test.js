'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const S = require('../public/dexdiffusion/source-resize.js');

const SCRIPT = path.join(__dirname, '..', 'bin', 'resize-source.py');

test('normalizeResize: no resize requested leaves the legacy path untouched', () => {
  assert.deepEqual(S.normalizeResize({}), { spec: null, background_color: '#ffffff' });
  assert.deepEqual(S.normalizeResize({ resize_mode: '' }).spec, null);
  assert.match(S.normalizeResize({ resize_width: 512, resize_height: 512 }).error, /need a resize_mode/);
});

test('normalizeResize: modes, resize-to XOR resize-by, limits, colour', () => {
  assert.deepEqual(S.normalizeResize({ resize_mode: 'crop', resize_width: 512, resize_height: 768 }).spec, { mode: 'crop', width: 512, height: 768, background_color: '#ffffff' });
  assert.deepEqual(S.normalizeResize({ resize_mode: 'fill', resize_by: '1.5', background_color: '#00ff00' }).spec, { mode: 'fill', by: 1.5, background_color: '#00ff00' });
  assert.match(S.normalizeResize({ resize_mode: 'latent', resize_by: 2 }).error, /latent upscale is not available/);
  assert.match(S.normalizeResize({ resize_mode: 'resize' }).error, /target size/);
  assert.match(S.normalizeResize({ resize_mode: 'resize', resize_width: 512, resize_height: 512, resize_by: 2 }).error, /not both/);
  assert.match(S.normalizeResize({ resize_mode: 'resize', resize_width: 512 }).error, /together/);
  assert.match(S.normalizeResize({ resize_mode: 'resize', resize_width: 500, resize_height: 512 }).error, /multiple of 8/);
  assert.match(S.normalizeResize({ resize_mode: 'resize', resize_width: 4096, resize_height: 512 }).error, /between 64 and 2048/);
  assert.match(S.normalizeResize({ resize_mode: 'resize', resize_by: 9 }).error, /between 0\.25 and 4/);
  assert.match(S.normalizeResize({ resize_mode: 'resize', resize_by: 2, background_color: 'red' }).error, /#rrggbb/);
});

test('targetSize: explicit size passes through; resize-by truncates then rounds down to a multiple of 8', () => {
  assert.deepEqual(S.targetSize({ mode: 'crop', width: 512, height: 768 }, 100, 100), { width: 512, height: 768 });
  assert.deepEqual(S.targetSize({ mode: 'resize', by: 1.5 }, 512, 512), { width: 768, height: 768 });
  assert.deepEqual(S.targetSize({ mode: 'resize', by: 1.33 }, 500, 333), { width: 664, height: 440 }, '665→664, 442→440');
  assert.deepEqual(S.targetSize({ mode: 'resize', by: 0.25 }, 128, 128), { width: 64, height: 64 }, 'never below 64');
});

test('exactSteps: sd.cpp runs floor(steps*strength)+1 steps (live-verified), so the CLI value is chosen to run exactly the requested steps', () => {
  assert.equal(S.executedSteps(8, 0.5), 5, 'live run: --steps 8 at 0.5 showed 5/5');
  assert.equal(S.executedSteps(16, 0.5), 9, 'live run: --steps 16 at 0.5 showed 9/9');
  for (const strength of [0.05, 0.1, 0.25, 0.33, 0.5, 0.55, 0.75, 0.8, 0.99]) {
    for (const steps of [1, 2, 4, 8, 15, 20, 30]) {
      const n = S.exactSteps(steps, strength);
      assert.equal(S.executedSteps(n, strength), steps, `steps ${steps} @ ${strength} -> ${n}`);
      if (n > 1) assert.ok(S.executedSteps(n - 1, strength) < steps, 'smallest such value');
    }
  }
  assert.equal(S.exactSteps(8, 0.5), 14);
  assert.equal(S.exactSteps(0, 0.5), null);
  assert.equal(S.exactSteps(8, 0), null);
  assert.equal(S.exactSteps(8, 1), null, 'strength 1 is not an img2img strength');
});

function py(code) {
  const r = spawnSync('python3', ['-c', code], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}
function run(dir, srcName, mode, w, h, bg = '#ffffff') {
  const out = path.join(dir, 'out-' + mode + '.png');
  const r = spawnSync('python3', [SCRIPT, path.join(dir, srcName), out, mode, String(w), String(h), bg], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return { out, size: r.stdout.trim() };
}
const px = (file, x, y) => JSON.parse(py(`from PIL import Image; import json; print(json.dumps(Image.open(${JSON.stringify(file)}).convert("RGB").getpixel((${x},${y}))))`));

test('resize-source.py: resize stretches, crop covers and centre-crops, fill fits and stretches edge pixels into the bands', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-resize-'));
  try {
    // 64x32 source: left half red, right half blue; top row green on the left half.
    py(`from PIL import Image; im=Image.new("RGB",(64,32),(255,0,0)); im.paste((0,0,255),(32,0,64,32)); im.putpixel((0,0),(0,255,0)); im.save(${JSON.stringify(path.join(dir, 'src.png'))})`);
    const r = run(dir, 'src.png', 'resize', 96, 96);
    assert.equal(r.size, '96 96');
    assert.deepEqual(px(r.out, 5, 48), [255, 0, 0]); assert.deepEqual(px(r.out, 90, 48), [0, 0, 255]);

    const c = run(dir, 'src.png', 'crop', 32, 32);       // cover: scaled to 64x32 -> centre 32x32 crop = middle: half red | half blue
    assert.equal(c.size, '32 32');
    assert.deepEqual(px(c.out, 2, 16), [255, 0, 0]); assert.deepEqual(px(c.out, 29, 16), [0, 0, 255]);

    const f = run(dir, 'src.png', 'fill', 64, 64);       // fit: 64x32 centred (rows 16..47); bands above/below replicate the edge rows
    assert.equal(f.size, '64 64');
    assert.deepEqual(px(f.out, 10, 32), [255, 0, 0]);    // image area
    assert.deepEqual(px(f.out, 50, 5), [0, 0, 255]);     // top band: right half edge colour
    assert.deepEqual(px(f.out, 50, 60), [0, 0, 255]);    // bottom band
    const topLeft = px(f.out, 1, 5);                     // top band, left side replicates the green/red edge row, never the fill colour
    assert.ok(topLeft[0] > 0 || topLeft[1] > 0, JSON.stringify(topLeft));
    assert.notDeepEqual(px(f.out, 10, 5), [0, 0, 0], 'band is not left black');

    py(`from PIL import Image; im=Image.new("RGB",(32,64),(0,255,0)); im.save(${JSON.stringify(path.join(dir, 'tall.png'))})`);
    const f2 = run(dir, 'tall.png', 'fill', 64, 64);     // taller than wide: side bands
    assert.equal(f2.size, '64 64');
    assert.deepEqual(px(f2.out, 2, 32), [0, 255, 0]); assert.deepEqual(px(f2.out, 62, 32), [0, 255, 0]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('resize-source.py: transparency is flattened onto the chosen colour; the source file is never modified', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-resize-'));
  try {
    const src = path.join(dir, 'a.png');
    py(`from PIL import Image; im=Image.new("RGBA",(16,16),(0,0,0,0)); im.paste((255,0,0,255),(0,0,8,16)); im.save(${JSON.stringify(src)})`);
    const before = fs.readFileSync(src);
    const w = run(dir, 'a.png', 'resize', 16, 16, '#ffffff');
    assert.deepEqual(px(w.out, 12, 8), [255, 255, 255]); assert.deepEqual(px(w.out, 2, 8), [255, 0, 0]);
    const g = run(dir, 'a.png', 'resize', 16, 16, '#00ff00');
    assert.deepEqual(px(g.out, 12, 8), [0, 255, 0]);
    assert.ok(before.equals(fs.readFileSync(src)), 'source bytes unchanged');
    assert.notEqual(spawnSync('python3', [SCRIPT, src, path.join(dir, 'x.png'), 'zoom', '16', '16', '#ffffff']).status, 0, 'unknown mode rejected');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
