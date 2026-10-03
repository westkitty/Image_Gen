'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const zlib = require('zlib');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  isVisionDetailerAvailable,
  detectRegions,
  detectDetailTargets,
  buildArgs,
  DetailerError,
  getDefaultDetailerPrompt
} = require('../detailer');

const TEST_IMAGE = '/Users/andrew/images_made/20260928-174616-controlled-sdxl-photonic-s1391613307-controlled-sdxl-photonic.png';

test('detailer: binary is compiled and available', () => {
  assert(isVisionDetailerAvailable(), 'vision-detailer binary must exist');
});

test('detailer: provides delta-oriented default prompts', () => {
  const facePrompt = getDefaultDetailerPrompt('face');
  assert(facePrompt.includes('preserve identity, pose and expression'));
  assert(facePrompt.includes('improve facial anatomy'));

  const handPrompt = getDefaultDetailerPrompt('hand');
  assert(handPrompt.includes('preserve hand pose'));
  assert(handPrompt.includes('correct hand anatomy'));

  const personPrompt = getDefaultDetailerPrompt('person');
  assert(personPrompt.includes('preserve pose'));
});

test('detailer: executes face detection and generates valid mask PNG', async () => {
  if (!fs.existsSync(TEST_IMAGE)) {
    return; // skip if image absent
  }

  const tmpMask = path.join(__dirname, 'fixtures', `test-mask-${Date.now()}.png`);
  try {
    const res = await detectRegions(TEST_IMAGE, {
      mode: 'face',
      threshold: 0.3,
      padding: 0.2,
      outputMask: tmpMask
    });

    assert.equal(res.status, 'ok');
    assert.equal(res.mode, 'face');
    assert(res.detections_count >= 1, 'expected at least 1 face detection');
    assert.equal(res.detections[0].mode, 'face');
    assert.equal(res.detections[0].is_derived_roi, false);
    assert(res.detections[0].confidence > 0.3);

    // Verify mask file
    assert(fs.existsSync(tmpMask), 'mask file must be created');
    const stat = fs.statSync(tmpMask);
    assert(stat.size > 1000, `mask file must be non-empty (got ${stat.size} bytes)`);
  } finally {
    if (fs.existsSync(tmpMask)) fs.unlinkSync(tmpMask);
  }
});

test('detailer: executes hand detection and marks is_derived_roi: true', async () => {
  if (!fs.existsSync(TEST_IMAGE)) {
    return;
  }

  const res = await detectRegions(TEST_IMAGE, {
    mode: 'hand',
    threshold: 0.3
  });

  assert.equal(res.status, 'ok');
  assert.equal(res.mode, 'hand');
  if (res.detections_count > 0) {
    assert.equal(res.detections[0].is_derived_roi, true);
    assert.equal(res.detections[0].mode, 'hand_derived_roi');
  }
});

test('detailer: fails cleanly when image is missing', async () => {
  await assert.rejects(
    async () => {
      await detectRegions('/nonexistent/path/to/image.png');
    },
    /Source image not found/
  );
});

// ── mask contract, empty results, bounds, determinism, bounded failure ───────────────────────────────────────────
function tmpFile(name) { return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dexdetail-')), name); }

function crc32(buf) {
  let c, crc = ~0;
  for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (~crc) >>> 0;
}
function flatPng(w, h, v = 128) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w, v)]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
// reads a mask PNG with PIL → { size:[w,h], mode, bbox:[x0,y0,x1,y1]|null, max, cornerAlpha }
function inspectMask(file) {
  const py = [
    'import sys, json', 'from PIL import Image',
    'im = Image.open(sys.argv[1]); a = im.convert("RGBA").split()[3]',
    'bb = a.getbbox()', 'print(json.dumps({"size": list(im.size), "mode": im.mode, "bbox": list(bb) if bb else None, "max": a.getextrema()[1], "corner": a.getpixel((0, 0))}))'
  ].join('\n');
  return JSON.parse(execFileSync('python3', ['-c', py, file]).toString());
}

test('detailer: options are validated before the native binary runs', () => {
  assert.throws(() => buildArgs('/x.png', { mode: 'tail' }), err => err instanceof DetailerError && err.code === 'bad_option' && err.status === 400);
  assert.throws(() => buildArgs('/x.png', { threshold: 7 }), /threshold must be/);
  assert.throws(() => buildArgs('/x.png', { feather: 'wide' }), /feather must be/);
  assert.throws(() => buildArgs('/x.png', { targetSelection: 'some' }), /targetSelection/);
  const { args } = buildArgs('/x.png', { mode: 'FACE', maxTargets: 3, dilate: -4, targetSelection: 'all' });
  assert.deepEqual(args.slice(0, 4), ['--image', '/x.png', '--mode', 'face']);
  assert(args.includes('--max-targets') && args.includes('--dilate') && args.includes('--target-selection'));
});

test('detailer: no target is a valid empty result and an all-transparent alpha mask', async () => {
  const img = tmpFile('flat.png'), mask = tmpFile('mask.png');
  fs.writeFileSync(img, flatPng(256, 192));
  for (const mode of ['face', 'hand', 'person']) {
    const res = await detectRegions(img, { mode, outputMask: mask });
    assert.equal(res.status, 'ok');
    assert.equal(res.detections_count, 0, `${mode}: a flat image has no ${mode}`);
    assert.equal(res.mask.coverage, 0);
    const m = inspectMask(mask);
    assert.deepEqual(m.size, [256, 192]);
    assert.equal(m.bbox, null, `${mode}: empty detection must paint nothing`);
  }
});

test('detailer: mask is source-sized, alpha-painted, bounded by the padded target and leaves the rest untouched', async () => {
  if (!fs.existsSync(TEST_IMAGE)) return;
  const mask = tmpFile('mask.png');
  const res = await detectRegions(TEST_IMAGE, { mode: 'face', outputMask: mask, feather: 8, padding: 0.2 });
  assert(res.detections_count >= 1);
  const m = inspectMask(mask);
  assert.deepEqual(m.size, [res.image_width, res.image_height], 'mask must have the source pixel size');
  assert.equal(m.corner, 0, 'pixels outside the target keep alpha 0');
  assert(m.max > 200, 'target core is painted');
  const [px, py, pw, ph] = res.detections[0].padded_pixels;
  const margin = Math.ceil(res.feather_px * 3) + 2;
  const [x0, y0, x1, y1] = m.bbox;
  assert(x0 >= px - margin && y0 >= py - margin && x1 <= px + pw + margin && y1 <= py + ph + margin, `mask bbox ${m.bbox} escapes padded ROI ${[px, py, pw, ph]}`);
  assert(res.mask.coverage > 0 && res.mask.coverage < 0.2, `face mask covers ${res.mask.coverage}`);
});

test('detailer: selection is deterministic (same detections, same mask bytes)', async () => {
  if (!fs.existsSync(TEST_IMAGE)) return;
  const a = tmpFile('a.png'), b = tmpFile('b.png');
  const strip = r => { const c = JSON.parse(JSON.stringify(r)); delete c.timings_ms; delete c.attempts; delete c.mask.path; return JSON.stringify(c); };
  const r1 = await detectDetailTargets(TEST_IMAGE, { mode: 'face', targetSelection: 'all', outputMask: a });
  const r2 = await detectDetailTargets(TEST_IMAGE, { mode: 'face', targetSelection: 'all', outputMask: b });
  assert.equal(strip(r1), strip(r2));
  assert(fs.readFileSync(a).equals(fs.readFileSync(b)));
});

test('detailer: a stalled detector is killed within the budget and the error names the stage', async () => {
  if (!fs.existsSync(TEST_IMAGE)) return;
  const t0 = Date.now();
  await assert.rejects(
    detectRegions(TEST_IMAGE, { mode: 'face', timeoutMs: 1 }),
    err => err instanceof DetailerError && err.code === 'timeout' && err.status === 504 && /did not finish/.test(err.message) && /tried 2 times/.test(err.message) && typeof err.stage === 'string'
  );
  assert(Date.now() - t0 < 5000, 'bounded');
});

test('detailer: unreadable image fails with an actionable message, not a hang', async () => {
  const bad = tmpFile('bad.png');
  fs.writeFileSync(bad, 'not an image');
  await assert.rejects(detectRegions(bad, { mode: 'face' }), err => err instanceof DetailerError && err.code === 'vision_failed' && /failed to load image/.test(err.message));
});
