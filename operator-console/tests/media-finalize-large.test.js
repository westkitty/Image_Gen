'use strict';
const { trackScratch } = require('./helpers/owned-scratch');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const crypto = require('node:crypto');
const M = require('../media'); const A = require('../voice-audio'); const Mx = require('../drama-mixer'); const T = require('../audio-tools');

const tmp = () => trackScratch(fs.mkdtempSync(path.join(os.tmpdir(), 'dex-fl-')));
const store = () => { const b = tmp(); const s = M.createMediaStore({ roots: { image: b + '/i', voice: b + '/v', music: b + '/m', video: b + '/vid', world: b + '/w' }, registryFile: b + '/media.json' }); s.ensureRoots(); return s; };
function bigWav(frames) { const f = path.join(tmp(), 'big.wav'); const fd = fs.openSync(f, 'w'); fs.writeSync(fd, Mx.wavHeader24(frames, 48000)); const blk = Buffer.alloc(6 * 4800); for (let i = 0; i < 4800; i++) blk.writeIntLE(Math.round(Math.sin(i / 7) * 3e6), i * 6, 3); fs.writeSync(fd, blk); fs.ftruncateSync(fd, 44 + frames * 6); fs.closeSync(fd); return f; }

test('a very large WAV is finalized with header validation and a streamed checksum (no whole-file read)', () => {
  const frames = 48000 * 60 * 20;                          // 20 minutes ≈ 345 MB
  const f = bigWav(frames); const s = store(); global.gc && global.gc(); const before = process.memoryUsage().rss;
  const rec = s.finalize(f, { kind: 'voice', base: 'big-master', duration: frames / 48000 });
  const growth = process.memoryUsage().rss - before;
  assert.ok(growth < 120 * 1024 * 1024, `RSS grew ${(growth / 1048576).toFixed(0)} MiB finalizing 345 MB`); assert.equal(rec.bytes, 44 + frames * 6);
  const h = crypto.createHash('sha256'); const fd = fs.openSync(f, 'r'); const b = Buffer.alloc(1 << 20); let n; let pos = 0; while ((n = fs.readSync(fd, b, 0, b.length, pos)) > 0) { h.update(b.subarray(0, n)); pos += n; } fs.closeSync(fd);
  assert.equal(rec.sha256, h.digest('hex')); assert.equal(s.resolve(rec.artifact_id).bytes, rec.bytes);
});

test('large-file validation still rejects a corrupt or non-WAV header', () => {
  const f = bigWav(48000 * 60 * 12); const fd = fs.openSync(f, 'r+'); fs.writeSync(fd, Buffer.from('JUNK'), 0, 4, 0); fs.closeSync(fd);
  assert.throws(() => store().finalize(f, { kind: 'voice', base: 'bad' }), /output-invalid/);
  const g = bigWav(48000 * 60 * 12); const fd2 = fs.openSync(g, 'r+'); fs.writeSync(fd2, Buffer.alloc(4), 0, 4, 40); fs.closeSync(fd2);   // data chunk length 0
  assert.throws(() => store().finalize(g, { kind: 'voice', base: 'empty-data' }), /output-invalid/);
});

test('small WAVs still get the full decode check', () => {
  const s = store(); const f = path.join(tmp(), 'x.wav'); fs.writeFileSync(f, Buffer.concat([Buffer.from('RIFF\x24\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00', 'latin1'), Buffer.alloc(40)]));
  assert.throws(() => s.finalize(f, { kind: 'voice', base: 'trunc' }), /output-invalid/);
  const ok = path.join(tmp(), 'ok.wav'); fs.writeFileSync(ok, A.encodeWav({ sampleRate: 24000, channels: [new Float32Array(2400).fill(0.2)] }));
  assert.ok(s.finalize(ok, { kind: 'voice', base: 'ok' }).canonical);
});

const HAVE = T.available().ffmpeg;
test('MP3, M4A and M4B are first-class voice artifacts with correct MIME and type sniffing', { skip: HAVE ? false : 'ffmpeg missing' }, async () => {
  const s = store(); const src = path.join(tmp(), 's.wav'); fs.writeFileSync(src, A.encodeWav({ sampleRate: 24000, channels: [new Float32Array(48000).map((_, i) => 0.3 * Math.sin(i / 9))] }));
  const dir = tmp();
  for (const [fmt, mime] of [['mp3', 'audio/mpeg'], ['m4a', 'audio/mp4'], ['m4b', 'audio/mp4']]) {
    await T.encode(src, path.join(dir, 'o.' + fmt), { format: fmt });
    const rec = s.finalize(path.join(dir, 'o.' + fmt), { kind: 'voice', base: 'enc-' + fmt }); assert.equal(rec.mime, mime, fmt); assert.match(rec.artifact_id, new RegExp('\\.' + fmt + '$'));
    assert.ok(s.resolve(rec.artifact_id));
  }
  const bad = path.join(dir, 'liar.m4b'); fs.writeFileSync(bad, Buffer.from('this is not an mp4 file at all, sorry'.repeat(5)));
  assert.throws(() => s.finalize(bad, { kind: 'voice', base: 'liar' }), /output-invalid/);
});
