'use strict';

// Run from operator-console:  node --test tests/outpaint-scripts.test.js
// Needs python3 with Pillow (no numpy). The pixel tests use tiny images so the whole file runs in well under a minute.

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const SCRIPT = path.join(__dirname, '..', 'bin', 'outpaint-a1111.py');
const oa = require('../public/dexdiffusion/outpaint-scripts.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'outpaint-test-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function cli(args) {
  const r = spawnSync('python3', [SCRIPT, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  let json = null, error = null;
  try { json = JSON.parse(r.stdout); } catch (_) { /* not JSON */ }
  try { error = JSON.parse(r.stderr).error; } catch (_) { /* not JSON */ }
  return { status: r.status, json, error, stderr: r.stderr };
}

// Runs a python snippet with the script loaded as module `oa` and a JSON value on stdin; returns the JSON it prints.
function py(code, input = null) {
  const prelude = [
    'import importlib.util, json, sys',
    `spec = importlib.util.spec_from_file_location("oa", ${JSON.stringify(SCRIPT)})`,
    'oa = importlib.util.module_from_spec(spec); spec.loader.exec_module(oa)',
    'data = json.load(sys.stdin)',
  ].join('\n');
  const r = spawnSync('python3', ['-c', `${prelude}\n${code}`], { input: JSON.stringify(input), encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  assert.equal(r.status, 0, `python failed: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function rng(seed) { // mulberry32
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function makeImage(file, w, h, seed = 1) {
  py(`
from PIL import Image, ImageDraw
import random
w, h, seed, out = data
random.seed(seed)
im = Image.new("RGB", (w, h))
px = im.load()
for y in range(h):
    for x in range(w):
        px[x, y] = ((x * 255) // max(w - 1, 1), (y * 255) // max(h - 1, 1), (x * 7 + y * 3) % 256)
d = ImageDraw.Draw(im)
for _ in range(8):
    x, y = random.randrange(w), random.randrange(h)
    d.ellipse((x, y, x + random.randrange(4, 30), y + random.randrange(4, 30)), fill=tuple(random.randrange(256) for _ in range(3)))
im.save(out)
print("{}")
`, [w, h, seed, file]);
}

// ---------------------------------------------------------------------------------------------------------------
// JS == Python agreement

function randomCase(r) {
  const pick = a => a[Math.floor(r() * a.length)];
  const dirs = oa.DIRECTIONS.filter(() => r() < 0.5);
  if (!dirs.length) dirs.push(pick(oa.DIRECTIONS));
  const tile = pick([256, 384, 448, 512, 576, 640]);
  return {
    w: 40 + Math.floor(r() * 1000), h: 40 + Math.floor(r() * 1000),
    pixels: 8 * (1 + Math.floor(r() * 32)), mask_blur: Math.floor(r() * 65), directions: dirs,
    tile_w: tile, tile_h: pick([256, 384, 512, 640]), work_w: pick([256, 384, 512, 640, 768]), work_h: pick([256, 384, 512, 640, 768]),
  };
}

test('JS plan helpers equal the Python plans on 400 random cases (sizes, rectangles, tile grid, mk2 steps, errors)', () => {
  const r = rng(20261016);
  const cases = Array.from({ length: 400 }, () => randomCase(r));
  const expected = py(`
out = []
for c in data:
    row = {}
    try:
        row["poor"] = oa.poor_geometry(c["w"], c["h"], c["pixels"], c["directions"], c["mask_blur"], c["tile_w"], c["tile_h"])
    except oa.CliError as e:
        row["poor"] = {"error": str(e)}
    try:
        row["mk2"] = oa.mk2_steps(c["w"], c["h"], c["pixels"], c["directions"], c["mask_blur"], c["work_w"], c["work_h"])
    except oa.CliError as e:
        row["mk2"] = {"error": str(e)}
    out.append(row)
print(json.dumps(out))
`, cases);
  let errors = 0, tiled = 0, steps = 0;
  cases.forEach((c, i) => {
    const poor = oa.poorGeometry(c.w, c.h, { pixels: c.pixels, mask_blur: c.mask_blur, directions: c.directions, tile_w: c.tile_w, tile_h: c.tile_h });
    const mk2 = oa.mk2Steps(c.w, c.h, { pixels: c.pixels, mask_blur: c.mask_blur, directions: c.directions, work_w: c.work_w, work_h: c.work_h });
    assert.deepEqual(JSON.parse(JSON.stringify(poor)), expected[i].poor, `poor mismatch for ${JSON.stringify(c)}`);
    assert.deepEqual(JSON.parse(JSON.stringify(mk2)), expected[i].mk2, `mk2 mismatch for ${JSON.stringify(c)}`);
    if (poor.error) errors += 1; else tiled += poor.tiles.length;
    if (mk2.error) errors += 1; else steps += mk2.steps.length;
    if (!poor.error) {
      const size = oa.outputSize(c.w, c.h, c.pixels, c.directions);
      assert.deepEqual([size.width, size.height], [poor.target_w, poor.target_h]);
      assert.equal(size.width % 64, 0);
      // upstream pads the canvas to a multiple of 64 even on an axis nothing expands (PM:44-45), so the sum only holds on expanded axes
      if (c.directions.includes('left') || c.directions.includes('right')) assert.equal(poor.left + c.w + poor.right, poor.target_w);
      if (c.directions.includes('up') || c.directions.includes('down')) assert.equal(poor.up + c.h + poor.down, poor.target_h);
    }
    if (!mk2.error) {
      const size = oa.outputSize(c.w, c.h, c.pixels, c.directions, 'mk2');
      assert.deepEqual([mk2.final_w, mk2.final_h], [size.width, size.height]);
      assert.equal(mk2.final_w, c.w + mk2.left + mk2.right); // mk2 crops every step back to the grown size (MK2:254)
      assert.equal(mk2.final_h, c.h + mk2.up + mk2.down);
    }
  });
  assert.ok(tiled > 400 && steps > 400, `expected broad coverage, got tiles=${tiled} steps=${steps} errors=${errors}`);
});

test('the CLI plan commands print exactly the JS plan', () => {
  const r = rng(77);
  for (let i = 0; i < 6; i++) {
    const c = randomCase(r);
    const jsPoor = oa.poorGeometry(c.w, c.h, { pixels: c.pixels, mask_blur: c.mask_blur, directions: c.directions, tile_w: c.tile_w, tile_h: c.tile_h });
    const poor = cli(['poor-plan', '--size', `${c.w}x${c.h}`, '--pixels', c.pixels, '--mask-blur', c.mask_blur, '--directions', c.directions.join(','),
      '--tile-w', c.tile_w, '--tile-h', c.tile_h, '--geometry-only']);
    if (jsPoor.error) { assert.equal(poor.status, 2); assert.equal(poor.error, jsPoor.error); } else {
      assert.equal(poor.status, 0, poor.stderr);
      const { masked_content: content, ...rest } = poor.json;
      assert.equal(content, 'fill');
      assert.deepEqual(rest, JSON.parse(JSON.stringify(jsPoor)));
    }
    const jsMk2 = oa.mk2Steps(c.w, c.h, { pixels: c.pixels, mask_blur: c.mask_blur, directions: c.directions, work_w: c.work_w, work_h: c.work_h });
    const mk2 = cli(['mk2-plan', '--size', `${c.w}x${c.h}`, '--pixels', c.pixels, '--mask-blur', c.mask_blur, '--directions', c.directions.join(','),
      '--work-w', c.work_w, '--work-h', c.work_h]);
    if (jsMk2.error) { assert.equal(mk2.status, 2); assert.equal(mk2.error, jsMk2.error); } else {
      assert.equal(mk2.status, 0, mk2.stderr);
      assert.deepEqual(mk2.json, JSON.parse(JSON.stringify(jsMk2)));
    }
  }
});

test('hand-checked upstream arithmetic: 512x512 + 128px in all directions and left only', () => {
  const all = oa.poorGeometry(512, 512, { pixels: 128, mask_blur: 4 });
  assert.deepEqual([all.target_w, all.target_h, all.left, all.right, all.up, all.down], [768, 768, 128, 128, 128, 128]);
  assert.deepEqual(all.mask_rect, [136, 136, 632, 632]);
  assert.deepEqual(all.latent_rect, [130, 130, 638, 638]);
  assert.deepEqual([all.cols, all.rows, all.work_count], [2, 2, 4]);
  assert.deepEqual(all.tiles.map(t => [t.x, t.y]), [[0, 0], [256, 0], [0, 256], [256, 256]]);
  const left = oa.mk2Steps(512, 512, { pixels: 128, mask_blur: 8, directions: ['left'] });
  assert.equal(left.steps.length, 1);
  assert.deepEqual(left.steps[0].mask_rect, [136, 0, 640, 512]);
  assert.deepEqual(left.steps[0].crop, [0, 0, 512, 512]);
  assert.equal(left.steps[0].mask_blur_sigma_x, 32);
  assert.equal(left.steps[0].mask_blur_sigma_y, 0);
  // a request that is not a multiple of 64 grows to the next one and the extra goes to the sides proportionally (PM:44-56)
  const e = oa.expansion(500, 500, 100, ['left', 'right', 'up']);
  assert.deepEqual(e, { left: 102, right: 102, up: 140, down: 0, target_w: 704, target_h: 640 });
});

// ---------------------------------------------------------------------------------------------------------------
// validators

test('validators mirror the upstream slider ranges and defaults', () => {
  assert.deepEqual(oa.normalizePoorOptions({}).options, { directions: oa.DIRECTIONS, masked_content: 'fill', tile_w: 512, tile_h: 512, pixels: 128, mask_blur: 4 });
  const mk2 = oa.normalizeMk2Options({}).options;
  assert.deepEqual([mk2.pixels, mk2.mask_blur, mk2.noise_q, mk2.color_variation, mk2.seed], [128, 8, 1, 0.05, 0]);
  for (const bad of [{ pixels: 4 }, { pixels: 264 }, { pixels: 100 }, { mask_blur: 65 }, { mask_blur: 2.5 }, { mask_blur: -1 }, { directions: [] }, { directions: ['sideways'] }, { pixels: 'abc' }]) {
    assert.ok(oa.normalizePoorOptions(bad).error, `poor should reject ${JSON.stringify(bad)}`);
    assert.ok(oa.normalizeMk2Options(bad).error, `mk2 should reject ${JSON.stringify(bad)}`);
  }
  for (const bad of [{ noise_q: 4.01 }, { noise_q: -0.01 }, { noise_q: 0.005 }, { color_variation: 1.01 }, { color_variation: 0.333 }, { seed: -1 }, { seed: 1.5 }]) {
    assert.ok(oa.normalizeMk2Options(bad).error, `mk2 should reject ${JSON.stringify(bad)}`);
  }
  assert.equal(oa.normalizeMk2Options({ noise_q: 4, color_variation: 1, pixels: 256, mask_blur: 64 }).error, undefined);
  assert.equal(oa.normalizeMk2Options({ noise_q: '0.07', pixels: '16' }).options.noise_q, 0.07);
  assert.deepEqual(oa.normalizePoorOptions({ directions: 'down, left' }).options.directions, ['left', 'down']);
  assert.ok(oa.normalizePoorOptions({ pixels: 256, tile_w: 256 }).error, 'overlap must stay below the tile size');
  assert.ok(oa.normalizeMk2Options({ masked_content: 'fill' }).error, 'mk2 has no masked content setting');
});

test('latent masked-content modes are rejected with a reason in JS and in the CLI', () => {
  for (const mode of ['latent noise', 'latent nothing', 'latent_noise', 'latent_nothing']) {
    const js = oa.normalizePoorOptions({ masked_content: mode });
    assert.match(js.error, /not available.*sd-cli cannot initialise the masked latent/);
    const out = cli(['poor-plan', '--size', '512x512', '--pixels', '128', '--masked-content', mode, '--geometry-only']);
    assert.equal(out.status, 2);
    assert.match(out.error, /not available.*sd-cli cannot initialise the masked latent/);
  }
  const unknown = cli(['poor-plan', '--size', '512x512', '--masked-content', 'bogus', '--geometry-only']);
  assert.equal(unknown.status, 2);
  assert.match(unknown.error, /must be one of/);
  assert.equal(cli(['poor-plan', '--size', '512x512', '--masked-content', 'original', '--geometry-only']).status, 0);
  assert.equal(cli(['poor-plan', '--size', '512x512', '--pixels', '12', '--geometry-only']).status, 2);
  assert.equal(cli(['poor-plan', '--size', '512x512', '--directions', '', '--geometry-only']).status, 2);
});

// ---------------------------------------------------------------------------------------------------------------
// FFT, RNG, noise

test('FFT equals a naive DFT (forward and inverse, power-of-2, mixed radix and Bluestein sizes)', () => {
  const sizes = [[1, 1], [2, 2], [4, 4], [8, 6], [6, 5], [3, 7], [10, 4], [9, 9], [37, 2], [2, 41], [12, 14]];
  const res = py(`
import random
random.seed(11)
out = []
for h, w in data:
    plane = [[random.random() - 0.5 for _ in range(w)] for _ in range(h)]
    cplane = [[complex(random.random(), random.random()) for _ in range(w)] for _ in range(h)]
    worst = 0.0
    for inverse in (False, True):
        for p in (plane, cplane):
            fast, slow = oa.fft2(p, inverse), oa.naive_dft2(p, inverse)
            worst = max(worst, max(abs(a - b) for fr, sr in zip(fast, slow) for a, b in zip(fr, sr)))
    out.append({"size": [h, w], "err": worst})
print(json.dumps(out))
`, sizes);
  for (const r of res) assert.ok(r.err < 1e-10, `fft2 ${r.size} error ${r.err}`);
});

test('real-pair FFT shortcuts equal the per-plane shifted transforms; fft then ifft is the identity', () => {
  const res = py(`
import random
random.seed(3)
out = []
for h, w in data:
    planes = [[[random.random() for _ in range(w)] for _ in range(h)] for _ in range(3)]
    fast = oa.fft_real_planes(planes)
    slow = [oa.shifted_fft2(p) for p in planes]
    e1 = max(abs(a - b) for f, s in zip(fast, slow) for fr, sr in zip(f, s) for a, b in zip(fr, sr))
    back = oa.ifft_real_parts(fast)
    e2 = max(abs(a - b) for p, q in zip(planes, back) for pr, qr in zip(p, q) for a, b in zip(pr, qr))
    spec = [[[complex(random.random(), random.random()) for _ in range(w)] for _ in range(h)] for _ in range(3)]
    quick = oa.ifft_real_parts(spec)
    ref = [[[v.real for v in row] for row in oa.shifted_ifft2(s)] for s in spec]
    e3 = max(abs(a - b) for p, q in zip(quick, ref) for pr, qr in zip(p, q) for a, b in zip(pr, qr))
    out.append({"size": [h, w], "forward": e1, "roundtrip": e2, "inverse_real": e3})
print(json.dumps(out))
`, [[8, 8], [12, 10], [7, 9], [16, 6], [37, 4]]);
  for (const r of res) {
    assert.ok(r.forward < 1e-11, `forward ${JSON.stringify(r)}`);
    assert.ok(r.roundtrip < 1e-11, `roundtrip ${JSON.stringify(r)}`);
    assert.ok(r.inverse_real < 1e-11, `inverse ${JSON.stringify(r)}`);
  }
});

test('the PCG64 stream matches numpy.random.default_rng(seed).random() bit for bit', () => {
  // values recorded from numpy 2.5.3: default_rng(seed).random(3)
  const expected = {
    0: [0.6369616873214543, 0.2697867137638703, 0.04097352393619469],
    1: [0.5118216247002567, 0.9504636963259353, 0.14415961271963373],
  };
  const got = py('print(json.dumps({str(s): oa.Pcg64Random(s).doubles(3) for s in data}))', [0, 1]);
  assert.deepEqual(got['0'], expected[0]);
  assert.deepEqual(got['1'], expected[1]);
});

test('MK2 matched noise is deterministic for a fixed seed, changes with another, and keeps the original pixels', () => {
  const res = py(`
import random
random.seed(9)
h, w = 24, 40
src = [[[ (0.1 + 0.5 * x / w + 0.1 * c + 0.05 * random.random()) if x >= 16 else 0.0 for x in range(w)] for y in range(h)] for c in range(3)]
mask = [[1.0 if x < 16 + 4 else 0.0 for x in range(w)] for y in range(h)]
def run(seed):
    return oa.get_matched_noise(src, mask, 1.0, 0.05, seed)
a, b, c = run(0), run(0), run(7)
kept = max(abs(a[ch][y][x] - src[ch][y][x]) for ch in range(3) for y in range(h) for x in range(20, w))
rng_range = [min(v for ch in a for r in ch for v in r), max(v for ch in a for r in ch for v in r)]
print(json.dumps({"same": a == b, "other_differs": a != c, "kept": kept, "range": rng_range,
                  "noise_varies": len({round(a[0][y][x], 6) for y in range(h) for x in range(16)}) > 20}))
`);
  assert.equal(res.same, true);
  assert.equal(res.other_differs, true);
  assert.equal(res.kept, 0, 'unmasked pixels must be untouched');
  assert.ok(res.range[0] >= 0 && res.range[1] <= 1);
  assert.equal(res.noise_varies, true);
});

test('mk2-prepare is byte-for-byte reproducible and only reads its input', () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'mk2-'));
  const src = path.join(dir, 'src.png');
  makeImage(src, 64, 48);
  const before = sha(src);
  const run = out => cli(['mk2-prepare', '--source', src, '--direction', 'left', '--pixels', '64', '--directions', 'left', '--mask-blur', '8',
    '--noise-q', '1', '--color-variation', '0.05', '--seed', '5', '--work-w', '128', '--work-h', '128', '--out-dir', path.join(dir, out)]);
  const a = run('a'), b = run('b');
  assert.equal(a.status, 0, a.stderr);
  assert.equal(b.status, 0, b.stderr);
  for (const f of ['full.png', 'init.png', 'mask.png', 'mask_blurred.png', 'latent_mask.png', 'step.json']) {
    assert.equal(sha(path.join(dir, 'a', f)), sha(path.join(dir, 'b', f)), `${f} differs between identical runs`);
  }
  const c = run('c');
  assert.equal(c.status, 0);
  const d = cli(['mk2-prepare', '--source', src, '--direction', 'left', '--pixels', '64', '--directions', 'left', '--mask-blur', '8', '--seed', '6',
    '--work-w', '128', '--work-h', '128', '--out-dir', path.join(dir, 'd')]);
  assert.notEqual(sha(path.join(dir, 'a', 'full.png')), sha(path.join(dir, 'd', 'full.png')), 'a different seed must give different noise');
  assert.equal(sha(src), before, 'source untouched');
  assert.deepEqual(a.json.crop, [0, 0, 128, 64], 'height is padded to 64 on an axis that is not expanded (MK2:219)');
  assert.deepEqual([a.json.work_w, a.json.work_h], [128, 64]);
});

test('mk2 chain: prepare, identity inpaint, finish for every direction ends at the planned size with the original kept', () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'chain-'));
  const src = path.join(dir, 'src.png');
  makeImage(src, 100, 70, 4);
  const opts = { pixels: 24, mask_blur: 4, directions: ['left', 'right', 'up', 'down'], work_w: 128, work_h: 128 };
  const plan = oa.mk2Steps(100, 70, opts);
  assert.ok(!plan.error, plan.error);
  let current = src;
  plan.steps.forEach((st, i) => {
    const out = path.join(dir, `s${i}`);
    const prep = cli(['mk2-prepare', '--source', current, '--direction', st.direction, '--orig-size', '100x70', '--pixels', '24', '--directions', opts.directions.join(','),
      '--mask-blur', '4', '--work-w', '128', '--work-h', '128', '--seed', '2', '--out-dir', out]);
    assert.equal(prep.status, 0, prep.stderr);
    for (const k of ['index', 'direction', 'expand_pixels', 'src_w', 'src_h', 'res_w', 'res_h', 'canvas_w', 'canvas_h', 'paste', 'mask_rect', 'latent_rect', 'work_w', 'work_h', 'crop', 'mask_blur_sigma_x', 'mask_blur_sigma_y']) {
      assert.deepEqual(prep.json[k], st[k], `step ${i} field ${k}`);
    }
    const next = path.join(dir, `r${i}.png`);
    const fin = cli(['mk2-finish', '--full', path.join(out, 'full.png'), '--processed', path.join(out, 'init.png'), '--step', path.join(out, 'step.json'), '--out', next]);
    assert.equal(fin.status, 0, fin.stderr);
    assert.deepEqual(fin.json.size, [st.res_w, st.res_h]);
    current = next;
  });
  const final = py(`
from PIL import Image, ImageChops
cur = Image.open(data[0]).convert("RGB"); src = Image.open(data[1]).convert("RGB")
inset = data[3]  # the seam strip (mask_blur px next to every expanded side) is repainted by design
box = data[2]
inner = (box[0] + inset, box[1] + inset, box[2] - inset, box[3] - inset)
src_inner = src.crop((inset, inset, src.width - inset, src.height - inset))
print(json.dumps({"size": list(cur.size), "orig_equal": ImageChops.difference(cur.crop(inner), src_inner).getbbox() is None,
  "seam_repainted": ImageChops.difference(cur.crop(box), src).getbbox() is not None}))
`, [current, src, [plan.left, plan.up, plan.left + 100, plan.up + 70], 5]);
  assert.deepEqual(final.size, [plan.final_w, plan.final_h]);
  assert.equal(final.orig_equal, true, 'the original image must sit unchanged inside the canvas');
});

// ---------------------------------------------------------------------------------------------------------------
// poor man's outpainting pixels

test('poor man: identity processing then combine reproduces the expanded image exactly; inputs stay untouched', () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'poor-'));
  const src = path.join(dir, 'src.png');
  makeImage(src, 150, 120, 2);
  const before = sha(src);
  const plan = cli(['poor-plan', '--source', src, '--pixels', '32', '--directions', 'left,right,up,down', '--mask-blur', '4', '--masked-content', 'original',
    '--tile-w', '128', '--tile-h', '128', '--out-dir', path.join(dir, 'p')]);
  assert.equal(plan.status, 0, plan.stderr);
  assert.ok(plan.json.work_count >= 4);
  const resDir = path.join(dir, 'p', 'res');
  fs.mkdirSync(resDir);
  for (const t of plan.json.tiles) {
    if (!t.process) continue;
    for (const f of [t.init, t.mask, t.mask_blurred, t.latent_mask]) assert.ok(fs.existsSync(path.join(dir, 'p', f)), f);
    fs.copyFileSync(path.join(dir, 'p', t.init), path.join(resDir, t.result)); // "original" content: the init tile is a plain crop
  }
  const expandedHash = sha(path.join(dir, 'p', 'expanded.png'));
  const comb = cli(['poor-combine', '--plan', path.join(dir, 'p', 'plan.json'), '--expanded', path.join(dir, 'p', 'expanded.png'), '--results-dir', resDir, '--out', path.join(dir, 'combined.png')]);
  assert.equal(comb.status, 0, comb.stderr);
  const cmp = py(`
from PIL import Image, ImageChops
a = Image.open(data[0]).convert("RGB"); b = Image.open(data[1]).convert("RGB")
print(json.dumps({"sizes": [list(a.size), list(b.size)], "equal": a.size == b.size and ImageChops.difference(a, b).getbbox() is None}))
`, [path.join(dir, 'p', 'expanded.png'), path.join(dir, 'combined.png')]);
  assert.deepEqual(cmp.sizes[0], cmp.sizes[1]);
  assert.equal(cmp.equal, true, 'identity round-trip must reproduce the expanded image');
  assert.equal(sha(src), before, 'source untouched');
  assert.equal(sha(path.join(dir, 'p', 'expanded.png')), expandedHash, 'combine must not modify its inputs');
  // the original sits where PM:59 pastes it
  const inside = py(`
from PIL import Image, ImageChops
exp = Image.open(data[0]).convert("RGB"); src = Image.open(data[1]).convert("RGB")
l, u = data[2], data[3]
print(json.dumps(ImageChops.difference(exp.crop((l, u, l + src.width, u + src.height)), src).getbbox() is None))
`, [path.join(dir, 'p', 'expanded.png'), src, plan.json.left, plan.json.up]);
  assert.equal(inside, true);
  // a missing tile is an error unless the upstream black-tile fallback is requested
  fs.rmSync(path.join(resDir, plan.json.tiles.find(t => t.process).result));
  const missing = cli(['poor-combine', '--plan', path.join(dir, 'p', 'plan.json'), '--expanded', path.join(dir, 'p', 'expanded.png'), '--results-dir', resDir, '--out', path.join(dir, 'm.png')]);
  assert.equal(missing.status, 2);
  assert.match(missing.error, /missing result tile/);
  const lenient = cli(['poor-combine', '--plan', path.join(dir, 'p', 'plan.json'), '--expanded', path.join(dir, 'p', 'expanded.png'), '--results-dir', resDir, '--out', path.join(dir, 'm.png'), '--allow-missing']);
  assert.equal(lenient.status, 0);
});

test('poor man: tiles fully inside the original are skipped and left as in the expanded image', () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'skip-'));
  const src = path.join(dir, 'src.png');
  makeImage(src, 512, 192, 3);
  // expand left only by 64: the 128-wide tiles at x >= 64 lie wholly inside the original (up/down are 0, rows of height 192 fit)
  const plan = cli(['poor-plan', '--source', src, '--pixels', '64', '--directions', 'left', '--mask-blur', '4', '--masked-content', 'original',
    '--tile-w', '256', '--tile-h', '192', '--out-dir', path.join(dir, 'p')]);
  assert.equal(plan.status, 0, plan.stderr);
  const skipped = plan.json.tiles.filter(t => !t.process);
  assert.ok(skipped.length >= 1 && skipped.length < plan.json.tiles.length, JSON.stringify(plan.json.tiles));
  for (const t of skipped) assert.ok(t.x >= plan.json.left);
  // combine with the processed tiles replaced by an obviously different colour must leave skipped tiles' interior as the original
  const resDir = path.join(dir, 'p', 'res');
  fs.mkdirSync(resDir);
  py(`
from PIL import Image
import os
plan = json.load(open(data[0]))
for t in plan["tiles"]:
    if t["process"]:
        Image.new("RGB", (plan["tile_w"], plan["tile_h"]), (250, 0, 250)).save(os.path.join(data[1], t["result"]))
print("{}")
`, [path.join(dir, 'p', 'plan.json'), resDir]);
  const comb = cli(['poor-combine', '--plan', path.join(dir, 'p', 'plan.json'), '--expanded', path.join(dir, 'p', 'expanded.png'), '--results-dir', resDir, '--out', path.join(dir, 'c.png')]);
  assert.equal(comb.status, 0, comb.stderr);
  const px = py(`
from PIL import Image
c = Image.open(data[0]).convert("RGB"); e = Image.open(data[1]).convert("RGB")
t = data[2]
x = t["x"] + t["w"] - 1
print(json.dumps({"skipped_pixel_equal": c.getpixel((x, 10)) == e.getpixel((x, 10)), "left_is_processed": c.getpixel((2, 10))}))
`, [path.join(dir, 'c.png'), path.join(dir, 'p', 'expanded.png'), skipped[skipped.length - 1]]);
  assert.equal(px.skipped_pixel_equal, true);
  assert.deepEqual(px.left_is_processed, [250, 0, 250]);
});

test('poor man: fill mode paints the new area from the original and keeps the original pixels in the tiles', () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'fill-'));
  const src = path.join(dir, 'src.png');
  makeImage(src, 128, 128, 5);
  const plan = cli(['poor-plan', '--source', src, '--pixels', '64', '--directions', 'right', '--mask-blur', '4', '--masked-content', 'fill',
    '--tile-w', '192', '--tile-h', '128', '--out-dir', path.join(dir, 'p')]);
  assert.equal(plan.status, 0, plan.stderr);
  const t = plan.json.tiles[0];
  const r = py(`
from PIL import Image
init = Image.open(data[0]).convert("RGB"); exp = Image.open(data[1]).convert("RGB")
mask = Image.open(data[2]).convert("L"); latent = Image.open(data[3]).convert("L")
kept = [(x, y) for y in range(init.height) for x in range(init.width) if latent.getpixel((x, y)) == 0]
bad = sum(1 for p in kept if init.getpixel(p) != exp.getpixel(p))
new_area = [(x, y) for y in range(init.height) for x in range(init.width) if x >= 128 + 8 and mask.getpixel((x, y)) == 255]
black = sum(1 for p in new_area if init.getpixel(p) == (0, 0, 0))
print(json.dumps({"kept": len(kept), "bad": bad, "new_area": len(new_area), "still_black": black}))
`, [path.join(dir, 'p', t.init), path.join(dir, 'p', 'expanded.png'), path.join(dir, 'p', t.mask), path.join(dir, 'p', t.latent_mask)]);
  assert.ok(r.kept > 1000);
  assert.equal(r.bad, 0, 'fill must not alter kept pixels');
  assert.ok(r.new_area > 100);
  assert.ok(r.still_black < r.new_area * 0.05, `fill left ${r.still_black}/${r.new_area} new pixels black`);
});

test('mask blur emulation equals a brute-force separable Gaussian with reflect-101 borders', () => {
  const r = py(`
import math
def brute(w, h, rect, sx, sy):
    x0, y0, x1, y1 = rect
    m = [[0 if (x0 <= x <= x1 and y0 <= y <= y1) else 255 for x in range(w)] for y in range(h)]
    def refl(i, n):
        if n == 1: return 0
        p = 2 * (n - 1); i %= p
        return p - i if i >= n else i
    def ker(s):
        rad = int(2.5 * s + 0.5)
        k = [math.exp(-(i * i) / (2 * s * s)) for i in range(-rad, rad + 1)]
        t = sum(k); return [v / t for v in k]
    def rnd(v): return max(0, min(255, int(round(v))))
    if sx > 0:
        k = ker(sx); rad = len(k) // 2
        m = [[rnd(sum(k[j] * row[refl(x + j - rad, w)] for j in range(len(k)))) for x in range(w)] for row in m]
    if sy > 0:
        k = ker(sy); rad = len(k) // 2
        cols = [[rnd(sum(k[j] * m[refl(y + j - rad, h)][x] for j in range(len(k)))) for y in range(h)] for x in range(w)]
        m = [[cols[x][y] for x in range(w)] for y in range(h)]
    return m
out = []
for (w, h, rect, sx, sy) in data:
    img = oa.blur_rect_mask((w, h), tuple(rect), sx, sy)
    fast = [[img.getpixel((x, y)) for x in range(w)] for y in range(h)]
    slow = brute(w, h, rect, sx, sy)
    out.append(max(abs(a - b) for fr, sr in zip(fast, slow) for a, b in zip(fr, sr)))
print(json.dumps(out))
`, [[40, 30, [8, 6, 31, 22], 4, 4], [40, 30, [8, 0, 40, 30], 8, 0], [24, 24, [-5, -5, 10, 40], 3, 6], [30, 20, [40, 40, 50, 50], 5, 5], [32, 32, [4, 4, 27, 27], 0, 0]]);
  for (const diff of r) assert.ok(diff <= 1, `blur differs by ${diff}`);
});

test('the CLI refuses to write over its inputs', () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'guard-'));
  const src = path.join(dir, 'expanded.png');
  makeImage(src, 64, 64);
  const before = sha(src);
  const out = cli(['poor-plan', '--source', src, '--pixels', '8', '--directions', 'right', '--mask-blur', '0', '--masked-content', 'original', '--tile-w', '128', '--tile-h', '128', '--out-dir', dir]);
  assert.equal(out.status, 2);
  assert.match(out.error, /refusing to overwrite an input/);
  assert.equal(sha(src), before);
});
