'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const zlib = require('node:zlib'); const crypto = require('node:crypto');
const Z = require('../portable-archive');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dex-zip-'));
const sha = b => crypto.createHash('sha256').update(b).digest('hex');

const rawZip = require('./helpers/rawzip');
const save = (buf) => { const f = path.join(tmp(), 'a.zip'); fs.writeFileSync(f, buf); return f; };

test('round trip: stored and deflated entries, directory listing, CRC and size verified', async () => {
  const f = path.join(tmp(), 'out.zip'); const big = Buffer.alloc(300000, 'abc');
  const w = await Z.writeZip(f, [{ name: 'manifest.json', data: Buffer.from('{"a":1}') }, { name: 'audio/a.wav', data: big, store: true }, { name: 'notes/readme.txt', data: Buffer.from('hello hello hello hello') }]);
  assert.equal(w.entries.length, 3); assert.ok(w.bytes > 0);
  const z = Z.openZip(f);
  assert.deepEqual(z.entries.map(e => e.name), ['manifest.json', 'audio/a.wav', 'notes/readme.txt']);
  assert.equal(z.read('manifest.json').toString(), '{"a":1}'); assert.ok(z.read('audio/a.wav').equals(big));
  assert.ok(z.entries.find(e => e.name === 'notes/readme.txt').method === 8, 'text is deflated by default');
  assert.equal(z.entries.find(e => e.name === 'audio/a.wav').method, 0);
});

test('streaming writer packs files from disk with bounded memory and a verifiable checksum', async () => {
  const dir = tmp(); const src = path.join(dir, 'big.bin'); const MB = 1 << 20;
  const fd = fs.openSync(src, 'w'); const chunk = crypto.randomBytes(MB); for (let i = 0; i < 4; i++) fs.writeSync(fd, chunk); fs.ftruncateSync(fd, 192 * MB); fs.closeSync(fd);
  const out = path.join(dir, 'o.zip'); global.gc && global.gc(); const before = process.memoryUsage().rss;
  const w = await Z.writeZip(out, [{ name: 'big.bin', file: src, store: true }]);
  const growth = process.memoryUsage().rss - before;
  assert.ok(growth < 96 * MB, `a 192 MiB entry must not be buffered in memory (RSS grew ${(growth / MB).toFixed(0)} MiB)`);
  const z = Z.openZip(out); const dest = path.join(dir, 'x.bin'); await z.extractTo('big.bin', dest);
  assert.equal(await Z.sha256File(dest), await Z.sha256File(src)); assert.equal(w.entries[0].size, 192 * MB);
});

test('writer refuses unsafe names; reader refuses traversal, absolute, backslash, drive and NUL names', async () => {
  for (const bad of ['../evil', '/abs', 'a/../../b', 'a\\b', 'C:/x', 'a\0b', './x', '']) {
    await assert.rejects(Z.writeZip(path.join(tmp(), 'w.zip'), [{ name: bad, data: Buffer.from('x') }]), /unsafe/i, JSON.stringify(bad));
    if (bad) assert.throws(() => Z.openZip(save(rawZip([{ name: bad, data: 'x' }]))), /unsafe/i, 'reader: ' + JSON.stringify(bad));
  }
});

test('duplicate names (including case/Unicode variants) are rejected', () => {
  assert.throws(() => Z.openZip(save(rawZip([{ name: 'a.txt', data: '1' }, { name: 'A.TXT', data: '2' }]))), /duplicate/i);
  assert.throws(() => Z.openZip(save(rawZip([{ name: 'caf\u00e9', data: '1' }, { name: 'cafe\u0301', data: '2' }]))), /duplicate/i);
});

test('encrypted, unsupported-method, symlink, truncated and CRC-corrupt archives are rejected', () => {
  assert.throws(() => Z.openZip(save(rawZip([{ name: 'a', data: 'x' }], { flags: 1 }))), /encrypted/i);
  assert.throws(() => Z.openZip(save(rawZip([{ name: 'a', data: 'x' }], { method: 0 }).subarray(0, 40))), /not a valid zip|end of central/i);
  assert.throws(() => Z.openZip(save(rawZip([{ name: 'a', data: 'x' }], { truncateTail: 5 }))), /not a valid zip|end of central/i);
  assert.throws(() => Z.openZip(save(rawZip([{ name: 'ln', data: 'target', extAttr: 0xA1FF << 16 }]))), /symbolic|symlink/i);
  const z = Z.openZip(save(rawZip([{ name: 'a', data: 'hello world' }], { badCrc: true })));
  assert.throws(() => z.read('a'), /crc/i);
  const m = rawZip([{ name: 'a', data: 'x' }]); m.writeUInt16LE(99, 10 + 0); // central header method patch below
  const buf = rawZip([{ name: 'a', data: 'x' }]); const cdAt = buf.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])); buf.writeUInt16LE(14, cdAt + 10);
  assert.throws(() => Z.openZip(save(buf)), /compression method/i);
});

test('limits: entry count, declared total size, per-entry size and bomb ratio', () => {
  const many = rawZip(Array.from({ length: 12 }, (_, i) => ({ name: `f${i}.txt`, data: 'x' })));
  assert.throws(() => Z.openZip(save(many), { maxEntries: 10 }), /too many entries/i);
  const two = rawZip([{ name: 'a', data: 'x'.repeat(2000) }, { name: 'b', data: 'y'.repeat(2000) }]);
  assert.throws(() => Z.openZip(save(two), { maxTotalBytes: 3000 }), /total.*size|too large/i);
  assert.throws(() => Z.openZip(save(two), { maxEntryBytes: 1000 }), /too large/i);
  const bomb = rawZip([{ name: 'z', data: Buffer.alloc(8 << 20, 0) }], { method: 8 });
  assert.throws(() => Z.openZip(save(bomb), { maxRatio: 100 }), /compression ratio|bomb/i);
  const lie = rawZip([{ name: 'a', data: 'x'.repeat(100) }], { method: 8, sizeLie: -50 });
  const z = Z.openZip(save(lie)); assert.throws(() => z.read('a'), /size/i);
});

test('openZip never touches the filesystem outside the destination chosen by the caller', async () => {
  const z = Z.openZip(save(rawZip([{ name: 'ok/a.txt', data: 'fine' }])));
  const dir = tmp(); await z.extractTo('ok/a.txt', path.join(dir, 'a.txt')); assert.equal(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8'), 'fine');
  await assert.rejects(z.extractTo('nope.txt', path.join(dir, 'b.txt')), /not in archive/i);
});
