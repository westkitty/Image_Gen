'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const crypto = require('node:crypto');
const A = require('../voice-audio'); const { createChunkStore } = require('../chunk-store');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dex-ck-'));
const wav = (hz = 200, sec = 0.5) => { const n = Math.round(sec * 24000), a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = 0.3 * Math.sin(2 * Math.PI * hz * i / 24000); return A.encodeWav({ sampleRate: 24000, channels: [a] }); };
const src = buf => { const f = path.join(tmp(), 'c.wav'); fs.writeFileSync(f, buf); return f; };
const META = { line_id: 'ln-001', ordinal: 0, total: 2, boundary: 'sentence', gap_ms: 260, inputs_sha: 'a'.repeat(64), engine: 'kokoro', engine_revision: 'mlx-audio 0.5.6', profile_id: 'vp-1111111111', seed: 7 };

test('a stored chunk yields a checksum receipt with no text and a controlled reference', () => {
  const s = createChunkStore({ root: tmp(), persist: () => true });
  const fp = 'f'.repeat(64); const buf = wav();
  const r = s.put('dp-aaaaaaaa', fp, src(buf), META);
  assert.equal(r.status, 'complete'); assert.equal(r.sha256, crypto.createHash('sha256').update(buf).digest('hex')); assert.equal(r.bytes, buf.length);
  assert.ok(r.duration > 0.4 && r.sample_rate === 24000); assert.deepEqual([r.ordinal, r.total, r.boundary], [0, 2, 'sentence']);
  assert.match(r.ref, /^chunks\/dp-aaaaaaaa\/[a-f0-9]{64}\.wav$/); assert.equal(JSON.stringify(r).includes('text'), false);
  assert.ok(s.get('dp-aaaaaaaa', fp)); assert.ok(fs.readFileSync(s.pathOf('dp-aaaaaaaa', fp)).equals(buf));
});

test('get() validates the file against the receipt: missing, truncated or tampered chunks are invalid and reported', () => {
  const s = createChunkStore({ root: tmp(), persist: () => true }); const fp = '1'.repeat(64);
  s.put('dp-aaaaaaaa', fp, src(wav()), META);
  assert.ok(s.get('dp-aaaaaaaa', fp));
  const file = s.pathOf('dp-aaaaaaaa', fp);
  fs.appendFileSync(file, Buffer.from([1, 2, 3])); assert.equal(s.get('dp-aaaaaaaa', fp), null); assert.equal(s.lastInvalid('dp-aaaaaaaa', fp).reason, 'size-mismatch');
  fs.writeFileSync(file, wav(300)); const r = s.get('dp-aaaaaaaa', fp); assert.equal(r, null);
  fs.rmSync(file); assert.equal(s.get('dp-aaaaaaaa', fp), null); assert.equal(s.lastInvalid('dp-aaaaaaaa', fp).reason, 'file-missing');
});

test('silent or undecodable audio is refused instead of becoming a receipt', () => {
  const s = createChunkStore({ root: tmp(), persist: () => true });
  assert.throws(() => s.put('dp-aaaaaaaa', '2'.repeat(64), src(Buffer.from('nope')), META), /decod|WAV/i);
  const silent = A.encodeWav({ sampleRate: 24000, channels: [new Float32Array(12000)] });
  assert.throws(() => s.put('dp-aaaaaaaa', '3'.repeat(64), src(silent), META), /silent/i);
});

test('receipts persist for saved projects and are reloaded; unsaved projects keep them in memory only', () => {
  const root = tmp(); let saved = true;
  const s = createChunkStore({ root, persist: () => saved }); const fp = '4'.repeat(64);
  s.put('dp-aaaaaaaa', fp, src(wav()), META);
  assert.ok(fs.existsSync(path.join(root, 'dp-aaaaaaaa.receipts.json')));
  assert.ok(createChunkStore({ root, persist: () => true }).get('dp-aaaaaaaa', fp), 'a new process finds the validated chunk');
  saved = false; const fp2 = '5'.repeat(64); s.put('dp-bbbbbbbb', fp2, src(wav(250)), META);
  assert.ok(!fs.existsSync(path.join(root, 'dp-bbbbbbbb.receipts.json'))); assert.ok(s.get('dp-bbbbbbbb', fp2));
  assert.equal(createChunkStore({ root, persist: () => false }).get('dp-bbbbbbbb', fp2), null, 'unsaved receipts do not survive a restart');
  saved = true; s.flush('dp-bbbbbbbb'); assert.ok(fs.existsSync(path.join(root, 'dp-bbbbbbbb.receipts.json')), 'saving the project flushes its receipts');
});

test('orphan sweep removes only unreferenced chunk files of unknown projects older than the age limit', () => {
  const root = tmp(); let t = 1000; const s = createChunkStore({ root, persist: () => false, now: () => t });
  s.put('dp-aaaaaaaa', '6'.repeat(64), src(wav()), META); s.put('dp-cccccccc', '7'.repeat(64), src(wav(220)), META);
  t += 3 * 24 * 3600 * 1000;
  const r = s.sweepOrphans({ knownProjects: ['dp-aaaaaaaa'], maxAgeMs: 24 * 3600 * 1000 });
  assert.equal(r.removed, 1); assert.ok(s.get('dp-aaaaaaaa', '6'.repeat(64)), 'known project kept'); assert.equal(fs.existsSync(path.join(root, 'chunks', 'dp-cccccccc')), false);
});
