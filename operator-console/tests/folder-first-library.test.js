'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');
const { createImageStore } = require('../image-store');
const { createLibraryIndex } = require('../library-index');
const { createThumbnailService } = require('../thumbnail-service');

const temp = prefix => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const fixtureDir = temp('dex-png-fixture-');
const fixturePng = path.join(fixtureDir, 'pixel.png');
execFileSync('python3', ['-c', 'from PIL import Image; import sys; Image.new("RGB", (2, 2), (30, 80, 120)).save(sys.argv[1])', fixturePng]);
const png = fs.readFileSync(fixturePng);

test('folder inventory is current, one-level, valid-image-only, and accepts ordinary names', () => {
  const root = temp('dex-folder-');
  const store = createImageStore({ root, runsRoot: path.join(root, 'runs') });
  assert.deepEqual(store.listCanonicalImages(), []);
  const name = 'manual image (1) ü.png';
  fs.writeFileSync(path.join(root, name), png);
  fs.mkdirSync(path.join(root, 'nested'));
  fs.writeFileSync(path.join(root, 'nested', 'hidden.png'), png);
  fs.writeFileSync(path.join(root, 'bad.jpg'), 'not an image');
  fs.writeFileSync(path.join(root, '.incoming-test.png'), png);
  assert.deepEqual(store.listCanonicalImages(), [name]);
  fs.unlinkSync(path.join(root, name));
  assert.deepEqual(store.listCanonicalImages(), []);
});

test('inventory rejects symlinks and pending publication ids without touching their targets', () => {
  const root = temp('dex-folder-safe-');
  const outside = path.join(temp('dex-outside-'), 'outside.png'); fs.writeFileSync(outside, png);
  const store = createImageStore({ root, runsRoot: path.join(root, 'runs') });
  fs.symlinkSync(outside, path.join(root, 'link.png'));
  fs.writeFileSync(path.join(root, 'safe.png'), png);
  fs.writeFileSync(path.join(root, '.pending-test.json'), JSON.stringify({ phase: 'prepared', image_ids: ['safe.png'] }));
  assert.deepEqual(store.listCanonicalImages(), []);
  assert.equal(fs.readFileSync(outside).equals(png), true);
});

test('folder rebuild shows record-free files with unknown provenance and drops removals', () => {
  const root = temp('dex-folder-index-');
  const imageStore = createImageStore({ root, runsRoot: path.join(root, 'runs') });
  const index = createLibraryIndex({ imageStore, imageMeta: { all: () => ({}), get: () => null } });
  fs.writeFileSync(path.join(root, 'manual.png'), png);
  assert.equal(index.rebuild().count, 1);
  const item = index.query().items[0];
  assert.equal(item.id, 'manual.png');
  assert.equal(item.operation, null);
  assert.equal(item.runId, null);
  assert.equal(item.status, null);
  fs.unlinkSync(path.join(root, 'manual.png'));
  index.rebuild();
  assert.equal(index.query().total, 0);
});

test('thumbnail cache key changes when canonical bytes are replaced under the same name', () => {
  const root = temp('dex-thumb-root-'); const cache = temp('dex-thumb-cache-');
  const file = path.join(root, 'same.png'); fs.writeFileSync(file, png);
  const store = { resolveImage: id => id === 'same.png' && fs.existsSync(file) ? { path: file } : null };
  const thumbs = createThumbnailService({ cacheDir: cache, imageStore: store });
  const first = thumbs.getCachePath('same.png');
  fs.writeFileSync(file, Buffer.concat([png, Buffer.from('changed')]));
  const second = thumbs.getCachePath('same.png');
  assert.notEqual(first, second);
});
