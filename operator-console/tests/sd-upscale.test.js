'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const U = require('../public/dexdiffusion/sd-upscale.js');

const SCRIPT = path.join(__dirname, '..', 'bin', 'sd-upscale-tiles.py');
const PY = process.env.SD_UPSCALE_PYTHON || 'python3';
const run = (args) => {
  const r = spawnSync(PY, [SCRIPT, ...args], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
};
// Small Pillow helper: mk <path> <w> <h> <mode> (noise|RGB:r,g,b) ; px <path> -> sha256 of RGB bytes; get <path> x y -> r,g,b
const helper = (code, args) => {
  const r = spawnSync(PY, ['-c', code, ...args], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};
const MK = `import sys,os
from PIL import Image
p,w,h,m=sys.argv[1],int(sys.argv[2]),int(sys.argv[3]),sys.argv[4]
im=Image.frombytes('RGB',(w,h),os.urandom(w*h*3)) if m=='noise' else Image.new('RGB',(w,h),tuple(int(v) for v in m.split(',')))
im.save(p)`;
const PX = `import sys,hashlib
from PIL import Image
print(hashlib.sha256(Image.open(sys.argv[1]).convert('RGB').tobytes()).hexdigest())`;
const GET = `import sys
from PIL import Image
im=Image.open(sys.argv[1]).convert('RGB')
print(','.join(str(im.getpixel((int(sys.argv[i]),int(sys.argv[i+1])))[0]) for i in range(2,len(sys.argv),2)))`;
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sdup-'));
const opts = (o) => U.normalizeSdUpscale(o).options;

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }

test('validation mirrors upstream sliders and rejects out-of-range input', () => {
  const d = U.normalizeSdUpscale({}).options;
  assert.equal(d.overlap, 64); assert.equal(d.scale, 2);
  assert.ok(U.normalizeSdUpscale({ overlap: 256, scale: 4 }).options);
  assert.ok(U.normalizeSdUpscale({ overlap: 0, scale: 1.05 }).options);
  assert.match(U.normalizeSdUpscale({ overlap: 8 }).error, /overlap must be a multiple of 16/);
  assert.match(U.normalizeSdUpscale({ overlap: 272 }).error, /overlap/);
  assert.match(U.normalizeSdUpscale({ overlap: -16 }).error, /overlap/);
  assert.match(U.normalizeSdUpscale({ scale: 0.95 }).error, /scale must be/);
  assert.match(U.normalizeSdUpscale({ scale: 4.05 }).error, /scale must be/);
  assert.match(U.normalizeSdUpscale({ scale: 2.01 }).error, /scale must be/);
  assert.match(U.normalizeSdUpscale({ tileWidth: 500 }).error, /tileWidth/);
  assert.match(U.normalizeSdUpscale({ tileHeight: 32 }).error, /tileHeight/);
  assert.match(U.normalizeSdUpscale({ tileWidth: 64, overlap: 64 }).error, /smaller than the tile/);
  assert.match(U.normalizeSdUpscale({ upscaler: 'swinir' }).error, /upscaler must be/);
  assert.match(U.normalizeSdUpscale({ bogus: 1 }).error, /Unexpected sdUpscale field/);
  assert.match(U.normalizeSdUpscale([]).error, /object/);
  assert.match(U.normalizeSdUpscale({ steps: 0 }).error, /steps/);
  assert.match(U.plan(20, 600, opts({})).error, /larger than the tile overlap/);
});

test('JS plan equals Python plan on many random sizes', () => {
  const d = tmp();
  const r = rng(7);
  const samplers = ['lanczos', 'nearest', 'none'];
  const tiles = [64, 128, 256, 512, 768];
  for (let i = 0; i < 40; i++) {
    const w = 24 + Math.floor(r() * 500), h = 24 + Math.floor(r() * 500);
    const tw = tiles[Math.floor(r() * tiles.length)], th = tiles[Math.floor(r() * tiles.length)];
    const maxOv = Math.min(tw, th) - 16;
    const ov = Math.min(Math.floor(r() * 5) * 16, Math.floor(maxOv / 16) * 16);
    const scale = 1 + Math.floor(r() * 61) * 0.05;
    const up = samplers[Math.floor(r() * 3)];
    const o = U.normalizeSdUpscale({ overlap: ov, scale: Math.round(scale * 100) / 100, upscaler: up, tileWidth: tw, tileHeight: th }).options;
    if (!o) continue;
    const src = path.join(d, `s${i}.png`);
    helper(MK, [src, String(w), String(h), 'noise']);
    const js = U.plan(w, h, o);
    const out = path.join(d, `o${i}`);
    let pyOut;
    try { pyOut = JSON.parse(run(['plan', src, '--out-dir', out, '--tile-width', String(tw), '--tile-height', String(th), '--overlap', String(ov), '--scale', String(o.scale), '--upscale-resampler', up])); }
    catch (e) { assert.ok(js.error, `python failed but js planned: ${e.message}`); continue; }
    assert.ok(!js.error, js.error);
    assert.deepEqual(pyOut.image, [js.image.w, js.image.h], `size ${w}x${h} scale ${o.scale}`);
    assert.equal(pyOut.cols, js.cols); assert.equal(pyOut.rows, js.rows); assert.equal(pyOut.tile_count, js.tileCount);
    assert.deepEqual(pyOut.tiles.map((t) => t.box), js.tiles.map((t) => t.box));
    assert.deepEqual(pyOut.tiles.map((t) => t.row * 1000 + t.col), js.tiles.map((t) => t.row * 1000 + t.col));
    for (const t of pyOut.tiles) assert.ok(fs.existsSync(path.join(out, t.file)));
  }
});

test('seed rule: seed + index at batch 1; next batch starts at +1 (upstream quirk)', () => {
  assert.equal(U.seedOffset(5, 1), 5);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((k) => U.seedOffset(k, 2)), [0, 1, 1, 2, 2, 3]);
  const d = tmp(); const src = path.join(d, 's.png');
  helper(MK, [src, '300', '300', 'noise']);
  const p = JSON.parse(run(['plan', src, '--out-dir', path.join(d, 'o'), '--tile-width', '128', '--tile-height', '128', '--overlap', '32', '--scale', '1', '--seed', '1000', '--batch-size', '2']));
  assert.deepEqual(p.tiles.slice(0, 4).map((t) => t.seed), [1000, 1001, 1001, 1002]);
  assert.equal(p.batch_count, Math.ceil(p.tile_count / 2));
});

test('identity processing round-trips pixel-exactly and leaves inputs untouched', () => {
  const d = tmp();
  const r = rng(11);
  for (let i = 0; i < 12; i++) {
    const tw = [128, 192, 256][i % 3], th = [128, 256, 192][i % 3], ov = [0, 16, 32, 64][i % 4];
    if (ov === 0) continue; // overlap 0: upstream crashes in combine_grid (empty mask); not exercised
    const w = tw + Math.floor(r() * 400), h = th + Math.floor(r() * 400);
    const src = path.join(d, `s${i}.png`);
    helper(MK, [src, String(w), String(h), 'noise']);
    const before = sha(src);
    const out = path.join(d, `o${i}`);
    run(['plan', src, '--out-dir', out, '--tile-width', String(tw), '--tile-height', String(th), '--overlap', String(ov), '--scale', '1', '--upscale-resampler', 'none']);
    assert.equal(sha(src), before, 'source modified');
    const tilesBefore = fs.readdirSync(out).filter((f) => f.startsWith('tile_')).map((f) => sha(path.join(out, f)));
    const res = path.join(d, `r${i}.png`);
    run(['combine', '--plan', path.join(out, 'plan.json'), '--tiles-dir', out, '--out', res]);
    const tilesAfter = fs.readdirSync(out).filter((f) => f.startsWith('tile_')).map((f) => sha(path.join(out, f)));
    assert.deepEqual(tilesAfter, tilesBefore, 'tiles modified');
    assert.equal(sha(src), before);
    // Identical content blends to itself: Pillow's masked paste of (a*m + a*(255-m) + 128) div 255 == a.
    assert.equal(helper(PX, [res]), helper(PX, [src]), `round trip ${w}x${h} tile ${tw}x${th} ov ${ov}`);
  }
});

test('overlap blend weights match combine_grid: mask = trunc(i*255/overlap), out = (a*m + b*(255-m) + 128) div 255', () => {
  const d = tmp();
  const ov = 64, tw = 128, th = 128;
  const div255 = (v) => { const t = v + 128; return (t + (t >> 8)) >> 8; };
  const mix = (top, bottom, m) => div255(top * m + bottom * (255 - m)); // paste(src=top over dst=bottom, mask=m)
  // Horizontal: 192x128 image -> 2 cols x 1 row (x = 0 and 64). Tile 1 value A over tile 0 value B.
  const src = path.join(d, 'h.png'); helper(MK, [src, '192', '128', 'noise']);
  const out = path.join(d, 'oh');
  const p = JSON.parse(run(['plan', src, '--out-dir', out, '--tile-width', '128', '--tile-height', '128', '--overlap', '64', '--scale', '1', '--upscale-resampler', 'none']));
  assert.equal(p.cols, 2); assert.equal(p.rows, 1);
  const proc = path.join(d, 'ph'); fs.mkdirSync(proc);
  helper(MK, [path.join(proc, 'tile_000.png'), '128', '128', '200,200,200']);
  helper(MK, [path.join(proc, 'tile_001.png'), '128', '128', '40,40,40']);
  const res = path.join(d, 'rh.png');
  run(['combine', '--plan', path.join(out, 'plan.json'), '--tiles-dir', proc, '--out', res]);
  const xs = [0, 63, 64, 65, 96, 127, 128, 191];
  const got = helper(GET, [res, ...xs.flatMap((x) => [String(x), '10'])]).split(',').map(Number);
  const want = xs.map((x) => {
    if (x < 64) return 200;
    if (x < 128) return mix(40, 200, Math.trunc(((x - 64) * 255) / ov));
    return 40;
  });
  assert.deepEqual(got, want);
  assert.equal(want[2], 200); // first overlap column has weight 0 => pure previous tile
  assert.equal(want[3], mix(40, 200, 3)); // i=1 -> trunc(255/64)=3

  // Vertical: 128x192 -> 1 col x 2 rows (y = 0 and 64), mask_h ramps along y.
  const srcv = path.join(d, 'v.png'); helper(MK, [srcv, '128', '192', 'noise']);
  const outv = path.join(d, 'ov');
  run(['plan', srcv, '--out-dir', outv, '--tile-width', '128', '--tile-height', '128', '--overlap', '64', '--scale', '1', '--upscale-resampler', 'none']);
  const procv = path.join(d, 'pv'); fs.mkdirSync(procv);
  helper(MK, [path.join(procv, 'tile_000.png'), '128', '128', '10,10,10']);
  helper(MK, [path.join(procv, 'tile_001.png'), '128', '128', '250,250,250']);
  const resv = path.join(d, 'rv.png');
  run(['combine', '--plan', path.join(outv, 'plan.json'), '--tiles-dir', procv, '--out', resv]);
  const ys = [0, 63, 64, 65, 100, 127, 128, 191];
  const gotv = helper(GET, [resv, ...ys.flatMap((y) => ['5', String(y)])]).split(',').map(Number);
  const wantv = ys.map((y) => {
    if (y < 64) return 10;
    if (y < 128) return mix(250, 10, Math.trunc(((y - 64) * 255) / ov));
    return 250;
  });
  assert.deepEqual(gotv, wantv);
  void th; void tw;
});

test('estimateCost and upscaledSize', () => {
  const o = opts({ scale: 2, tileWidth: 512, tileHeight: 512, overlap: 64, steps: 20 });
  assert.deepEqual(U.upscaledSize(512, 512, o), { w: 1024, h: 1024 });
  assert.deepEqual(U.upscaledSize(513, 700, opts({ scale: 1.5 })), { w: 768, h: 1048 }); // int(dim*scale)//8*8
  const c = U.estimateCost(512, 512, o);
  assert.equal(c.tileCount, 9); assert.equal(c.totalSteps, 180); assert.equal(c.finalWidth, 1024);
  assert.deepEqual(U.upscaledSize(300, 200, opts({ upscaler: 'none', scale: 3 })), { w: 300, h: 200 });
});
