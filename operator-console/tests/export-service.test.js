'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const S = require('../export-service');

const CANARY = 'ZXQ-CANARY-prompt-9f3a1c';
const NEG_CANARY = 'ZXQ-NEGCANARY-77be02';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'export-svc-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function py(code, ...args) { return execFileSync('python3', ['-c', code, ...args], { encoding: 'utf8' }); }
function makeImage(file, withText) {
  py(`import sys
from PIL import Image, PngImagePlugin
im = Image.new('RGBA', (48, 32), (30, 120, 200, 255))
info = PngImagePlugin.PngInfo()
if sys.argv[2] == '1': info.add_text('parameters', sys.argv[3])
im.save(sys.argv[1], pnginfo=info)`, file, withText ? '1' : '0', withText || '');
}
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

function rec(id, file, meta) {
  return { id, path: file, width: 48, height: 32, meta: { steps: 20, cfg: 6.5, seed: 1234, sampler: 'euler_a', scheduler: 'karras', target: 'sdxl', ...meta } };
}
const src1 = path.join(tmp, 'a-001.png'), src2 = path.join(tmp, 'b-002.png');
makeImage(src1);                       // clean source
makeImage(src2, 'leaky ' + CANARY);    // hostile source: holds a prompt chunk that must NOT be carried into exports
const savedRec = () => rec('a-001.png', src1, { prompt: 'a cat, ' + CANARY, negative_prompt: NEG_CANARY, prompt_saved: true });
const hiddenRec = () => rec('b-002.png', src2, { prompt: CANARY, negative_prompt: NEG_CANARY, prompt_saved: false });
const absentRec = () => rec('c-003.png', src1, {});

const hasCanary = buf => buf.includes(Buffer.from(CANARY)) || buf.includes(Buffer.from(NEG_CANARY)) ||
  buf.includes(Buffer.from(CANARY, 'utf16le')) || buf.includes(Buffer.from(NEG_CANARY, 'utf16le')) ||
  Buffer.from(CANARY, 'utf16le').length && utf16be(CANARY, buf) || utf16be(NEG_CANARY, buf);
function utf16be(s, buf) { const b = Buffer.from(s, 'utf16le'); b.swap16(); return buf.includes(b); }

test('filename tokens', () => {
  const now = new Date(2026, 9, 2, 3, 4, 5);
  const r = savedRec();
  assert.equal(formatOf('[seed]-[steps]-[cfg]-[width]x[height]-[sampler]', r), '1234-20-6.5-48x32-euler_a');
  assert.equal(formatOf('[datetime<%Y-%m-%d_%H%M%S>]', r, { now }), '2026-10-02_030405');
  assert.equal(formatOf('[date]', r, { now }), '2026-10-02');
  assert.equal(formatOf('[datetime]', r, { now }), '20261002030405');
  assert.equal(formatOf('[basename]_[index]_[none]x', r, { index: 3 }), 'a-001_3_x');
  assert.equal(formatOf('[model_name]', r, { modelName: 'my model' }), 'my model');
  assert.equal(formatOf('[prompt_words]', r), 'a cat ZXQ CANARY prompt 9f3a1c');
  assert.equal(formatOf('[bogus]', r), 'a-001');                  // unknown token -> '' -> falls back to the id
  assert.equal(formatOf('', r), 'a-001');
});
function formatOf(p, r, o) { return S.formatFilename(p, r, o || {}); }

test('filename traversal, control chars, truncation', () => {
  const r = savedRec();
  for (const p of ['../../etc/passwd', '..\\..\\x', '/abs/path', 'a/../b', 'x\u0000y\u001fz\n', '....//....//', 'CON', '.hidden', 'a:b*c?d"e<f>g|h']) {
    const n = S.formatFilename(p, r, {});
    assert.ok(!/[\/\\\u0000-\u001f:*?"<>|]/.test(n), JSON.stringify([p, n]));
    assert.ok(!n.includes('..') && !n.startsWith('.') && n.length > 0, JSON.stringify([p, n]));
  }
  const long = S.formatFilename('x'.repeat(256) + '[prompt]', r, {});
  assert.ok(Buffer.byteLength(long) <= S.LIMITS.maxFilenameBytes);
  const multi = S.formatFilename('é'.repeat(200), r, {});
  assert.ok(Buffer.byteLength(multi) <= S.LIMITS.maxFilenameBytes && !multi.includes('�'));
  const hostile = rec('d.png', src1, { prompt: '../../../evil/\u0000name', prompt_saved: true });
  const n = S.formatFilename('[prompt]', hostile, {});
  assert.ok(!/[\/\\\u0000]/.test(n) && !n.includes('..'), n);
});

test('prompt tokens are empty when prompts are not saved or not allowed', () => {
  for (const r of [hiddenRec(), absentRec()]) {
    const n = S.formatFilename('[prompt]-[prompt_words]-[prompt_spaces]-[prompt_hash]-[negative_prompt_hash]-[seed]', r, {});
    assert.equal(n, '1234');
    assert.ok(!n.includes('ZXQ'), n);
  }
  assert.equal(S.formatFilename('[prompt]', hiddenRec(), {}), 'b-002');
  assert.equal(S.formatFilename('[prompt]', savedRec(), { savePrompts: false }), 'a-001');
  assert.ok(S.formatFilename('[prompt]', savedRec(), {}).includes('ZXQ'));
});

test('sidecar: settings only without prompts, full infotext with', () => {
  const full = S.sidecarText(savedRec(), {});
  assert.ok(full.includes(CANARY) && full.includes('Negative prompt: ' + NEG_CANARY) && full.includes('Steps: 20'));
  for (const [r, o] of [[hiddenRec(), {}], [absentRec(), {}], [savedRec(), { savePrompts: false }]]) {
    const t = S.sidecarText(r, o);
    assert.ok(!hasCanary(Buffer.from(t)), t);
    assert.match(t, /Steps: 20, Sampler: Euler a/);
  }
});

test('encodeImage: png/jpeg/webp decode, quality, lossless, metadata readback; source untouched', async () => {
  const before = sha(src1);
  const info = 'a prompt ü, nothing\nNegative prompt: bad\nSteps: 20, Seed: 1';
  for (const format of ['png', 'jpeg', 'webp']) {
    const buf = await S.encodeImage(src1, { format, quality: 80, metadata: 'infotext', infotext: info });
    const f = path.join(tmp, 'out.' + format); fs.writeFileSync(f, buf);
    const out = JSON.parse(py(`import sys, json
from PIL import Image
im = Image.open(sys.argv[1]); im.load()
uc = im.getexif().get_ifd(0x8769).get(0x9286)
if isinstance(uc, bytes) and uc[:8] == b'UNICODE\\x00': uc = uc[8:].decode('utf-16-be')
print(json.dumps({'fmt': im.format, 'size': im.size, 'param': im.info.get('parameters'), 'uc': uc}))`, f));
    assert.equal(out.fmt, format.toUpperCase());
    assert.deepEqual(out.size, [48, 32]);
    if (format === 'png') assert.equal(out.param, info); else assert.equal(out.uc, info);
  }
  const none = await S.encodeImage(src2, { format: 'png', metadata: 'none', infotext: 'should not appear' });
  assert.ok(!none.includes(Buffer.from('should not appear')) && !none.includes(Buffer.from(CANARY)), 'source chunk must be stripped');
  const lo = await S.encodeImage(src1, { format: 'jpeg', quality: 5 }), hi = await S.encodeImage(src1, { format: 'jpeg', quality: 100 });
  assert.ok(lo.length < hi.length);
  const ll = await S.encodeImage(src1, { format: 'webp', lossless: true });
  assert.equal(ll.subarray(8, 12).toString(), 'WEBP');
  await assert.rejects(S.encodeImage(src1, { format: 'gif' }), /Unsupported/);
  await assert.rejects(S.encodeImage(path.join(tmp, 'missing.png'), { format: 'png' }), /failed/);
  assert.equal(sha(src1), before);
});

test('encoder refuses to write over its source', () => {
  const enc = path.join(__dirname, '..', 'bin', 'encode-image.py');
  const copy = path.join(tmp, 'copy.png'); fs.copyFileSync(src1, copy);
  const h = sha(copy);
  assert.throws(() => execFileSync('python3', [enc, '--src', copy, '--format', 'png', '--out', copy], { stdio: 'pipe' }));
  assert.equal(sha(copy), h);
});

test('buildZip: valid archive (unzip -t + python zipfile), names, duplicates, bad names', () => {
  const big = Buffer.from('hello zip '.repeat(500));
  const zip = S.buildZip([{ name: 'a.txt', data: big }, { name: 'b/é.bin', data: crypto.randomBytes(300), store: true }, { name: 'empty.txt', data: '' }]);
  const f = path.join(tmp, 't.zip'); fs.writeFileSync(f, zip);
  const t = execFileSync('/usr/bin/unzip', ['-t', f], { encoding: 'utf8' });
  assert.match(t, /No errors detected/);
  const names = JSON.parse(py(`import sys, zipfile, json
z = zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None
print(json.dumps([z.namelist(), z.read('a.txt').decode()[:10], z.comment.decode()]))`, f));
  assert.deepEqual(names[0], ['a.txt', 'b/é.bin', 'empty.txt']);
  assert.equal(names[1], 'hello zip ');
  assert.ok(zip.length < big.length, 'text entry was deflated');
  assert.throws(() => S.buildZip([{ name: '../x', data: 'a' }]), /Unsafe/);
  assert.throws(() => S.buildZip([{ name: '/x', data: 'a' }]), /Unsafe/);
  assert.throws(() => S.buildZip([{ name: 'a\\b', data: 'a' }]), /Unsafe/);
  assert.throws(() => S.buildZip([{ name: 'A.txt', data: 'a' }, { name: 'a.txt', data: 'b' }]), /Duplicate/);
});

test('exportImages: single image, sidecar zip, collisions, privacy over every output byte', async () => {
  const one = await S.exportImages([savedRec()], { format: 'jpeg', quality: 70, pattern: '[seed]-[steps]' });
  assert.equal(one.filename, '1234-20.jpg'); assert.equal(one.contentType, 'image/jpeg');
  assert.equal(one.buffer[0], 0xff);

  const privacyRecs = [hiddenRec(), absentRec(), { ...hiddenRec(), id: 'e-004.png' }];
  for (const format of ['png', 'jpeg', 'webp']) {
    for (const [records, opts] of [
      [privacyRecs, {}],
      [[savedRec(), hiddenRec()], { savePrompts: false }],
    ]) {
      const pattern = '[prompt]-[prompt_words]-[prompt_hash]-[seed]';
      const z = await S.exportImages(records, { format, metadata: 'infotext', sidecar: true, pattern, ...opts });
      assert.equal(z.contentType, 'application/zip'); assert.match(z.filename, /^[\w.-]+\.zip$/);
      assert.ok(!hasCanary(z.buffer), 'canary in zip bytes (' + format + ')');
      assert.equal(z.promptsIncluded, false);
      // decode every member: stored images and deflated sidecars must be clean too
      const f = path.join(tmp, 'p-' + format + '.zip'); fs.writeFileSync(f, z.buffer);
      const dir = path.join(tmp, 'x-' + format + '-' + crypto.randomBytes(3).toString('hex')); fs.mkdirSync(dir);
      execFileSync('/usr/bin/unzip', ['-q', f, '-d', dir]);
      const files = fs.readdirSync(dir);
      assert.equal(files.length, records.length * 2);
      for (const n of files) assert.ok(!hasCanary(fs.readFileSync(path.join(dir, n))) && !n.includes('ZXQ'), n);
      assert.equal(new Set(files.map(s => s.toLowerCase())).size, files.length, 'unique names');
    }
    const single = await S.exportImages([hiddenRec()], { format, metadata: 'infotext', pattern: '[prompt]' });
    assert.ok(!hasCanary(single.buffer) && !single.filename.includes('ZXQ'));
    assert.equal(single.filename, 'b-002' + S.FORMATS[format].ext);
  }
  // positive control: prompts allowed -> they DO appear (proves the canary check can fail) and flag is set
  const pos = await S.exportImages([savedRec()], { format: 'png', metadata: 'infotext' });
  assert.ok(hasCanary(pos.buffer) && pos.promptsIncluded);
  const posZip = await S.exportImages([savedRec()], { format: 'png', sidecar: true });
  assert.ok(posZip.buffer.length > 0 && posZip.filename.endsWith('.zip'));
  // metadata none: no prompt even when allowed
  const none = await S.exportImages([savedRec()], { format: 'webp', metadata: 'none' });
  assert.ok(!hasCanary(none.buffer));
});

test('exportImages: limits and hostile record ids', async () => {
  await assert.rejects(S.exportImages([], {}), /No images/);
  await assert.rejects(S.exportImages(new Array(S.LIMITS.maxImages + 1).fill(savedRec()), {}), /At most/);
  const r = rec('../../evil\u0000.png', src1, { prompt_saved: false });
  const out = await S.exportImages([r, r], { format: 'png' });
  const f = path.join(tmp, 'h.zip'); fs.writeFileSync(f, out.buffer);
  const listing = execFileSync('/usr/bin/unzip', ['-Z1', f], { encoding: 'utf8' }).trim().split('\n');
  assert.equal(listing.length, 2);
  for (const n of listing) assert.ok(!n.includes('..') && !n.includes('/') && !n.startsWith('.'), n);
});

test('canonical sources are never modified by any export', async () => {
  const h1 = sha(src1), h2 = sha(src2), m1 = fs.statSync(src1).mtimeMs;
  await S.exportImages([savedRec(), hiddenRec()], { format: 'jpeg', sidecar: true, metadata: 'infotext' });
  await S.exportImages([savedRec()], { format: 'png', metadata: 'infotext' });
  assert.equal(sha(src1), h1); assert.equal(sha(src2), h2); assert.equal(fs.statSync(src1).mtimeMs, m1);
  assert.deepEqual(fs.readdirSync(tmp).filter(n => n.endsWith('.tmp')), []);
});
