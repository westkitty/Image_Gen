'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const T = require('../public/dexdiffusion/transform-options.js');
const { makePng } = require('./browser/helpers');
const PY = path.join(__dirname, '..', '..', 'sdcpp-workflow', 'bin', 'transform-image.py');
const dims = { width: 512, height: 256 };

test('normalize: swaps dimensions across a 90° rotation and tracks the result size', () => {
  const r = T.normalize([{ op: 'rotate', degrees: 90 }, { op: 'crop', x: 0, y: 0, w: 100, h: 200 }], dims);
  assert.deepEqual(r.result, { width: 100, height: 200 });
  assert.equal(T.normalize([{ op: 'rotate', degrees: 180 }], dims).result.width, 512);
});
test('normalize: rejects bad angles, axes, boxes, counts and unknown operations with specific messages', () => {
  const e = ops => T.normalize(ops, dims).error;
  assert.match(e([{ op: 'rotate', degrees: 45 }]), /90, 180 or 270/);
  assert.match(e([{ op: 'flip', axis: 'x' }]), /h or v/);
  assert.match(e([{ op: 'crop', x: 500, y: 0, w: 100, h: 100 }]), /outside the 512×256 image/);
  assert.match(e([{ op: 'crop', x: 0, y: 0, w: 4, h: 100 }]), /outside/);
  assert.match(e([]), /operations are required/); assert.match(e(new Array(7).fill({ op: 'flip', axis: 'h' })), /operations are required/);
  assert.match(e([{ op: 'blur' }]), /Unknown operation/); assert.match(e('rotate'), /operations are required/);
});
test('cropPreset: largest centred box with the requested ratio, even sizes, inside the image', () => {
  assert.deepEqual(T.cropPreset(512, 256, 1, 1), { op: 'crop', x: 128, y: 0, w: 256, h: 256 });
  const c = T.cropPreset(512, 512, 16, 9); assert.equal(c.w, 512); assert.equal(c.h, 288); assert.equal(c.y, 112);
  for (const [w, h, rw, rh] of [[333, 777, 4, 3], [1000, 1000, 16, 9], [64, 64, 1, 1]]) { const p = T.cropPreset(w, h, rw, rh); assert.ok(p.x >= 0 && p.y >= 0 && p.x + p.w <= w && p.y + p.h <= h); assert.equal(T.normalize([p], { width: w, height: h }).error, undefined); }
});
test('transform-image.py: rotates clockwise, never overwrites the source, refuses an existing output and bad boxes', t => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-tf-')); t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const src = path.join(d, 's.png'), out = path.join(d, 'o.png'); fs.writeFileSync(src, makePng(40, 20));
  const before = fs.readFileSync(src);
  const ok = spawnSync('python3', [PY, src, out, JSON.stringify([{ op: 'rotate', degrees: 90 }])], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr); assert.deepEqual(JSON.parse(ok.stdout), { width: 20, height: 40, ops: 1 });
  assert.ok(fs.readFileSync(src).equals(before), 'source bytes unchanged');
  const again = spawnSync('python3', [PY, src, out, JSON.stringify([{ op: 'flip', axis: 'h' }])], { encoding: 'utf8' });
  assert.equal(again.status, 1); assert.match(again.stderr, /already exists/);
  const same = spawnSync('python3', [PY, src, src, JSON.stringify([{ op: 'flip', axis: 'h' }])], { encoding: 'utf8' });
  assert.equal(same.status, 1); assert.match(same.stderr, /differ from the source/);
  const bad = spawnSync('python3', [PY, src, path.join(d, 'b.png'), JSON.stringify([{ op: 'crop', x: 30, y: 0, w: 16, h: 16 }])], { encoding: 'utf8' });
  assert.equal(bad.status, 1); assert.match(bad.stderr, /outside the 40x20 image/);
  assert.deepEqual(fs.readdirSync(d).sort(), ['o.png', 's.png']);
});
