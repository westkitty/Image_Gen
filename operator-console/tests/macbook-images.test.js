'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { createMacbookImages, sweepImagesHeldOnMacbook } = require('../macbook-images.js');
const { createImageStore } = require('../image-store.js');
const { makePng, startServer } = require('./browser/helpers');

const PNG = makePng(64, 48);
const ID = '20261104-120000-macbook-a.png';

async function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-macbook-'));
  const macbook = path.join(dir, 'images_made'), bigmac = path.join(dir, 'images');
  fs.mkdirSync(macbook); fs.mkdirSync(bigmac);
  fs.writeFileSync(path.join(macbook, ID), PNG);
  // Its own process, as in real use: fetching a file blocks the Big Mac's event loop, so the two can never share one.
  const script = `const s = require(${JSON.stringify(path.resolve(__dirname, '../bin/macbook-image-service.js'))}).createImageService({ root: ${JSON.stringify(macbook)}, thumbnailDir: ${JSON.stringify(path.join(dir, 'thumbs'))} }); s.listen(0, '127.0.0.1', () => console.log(s.address().port));`;
  const service = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'inherit'] });
  const port = await new Promise(r => service.stdout.once('data', d => r(String(d).trim())));
  const baseUrl = 'http://127.0.0.1:' + port;
  const manifestFile = path.join(dir, 'macbook-images.json');
  const images = createMacbookImages({ baseUrl, manifestFile });
  await images.refresh();
  const store = createImageStore({ root: bigmac, runsRoot: path.join(dir, 'runs'), macbookImages: images });
  return { dir, macbook, bigmac, manifestFile, service, baseUrl, images, store, close: () => new Promise(r => { if (service.exitCode !== null) return r(); service.once('exit', r); service.kill(); }) };
}

const sweepOf = f => (records, extra) => sweepImagesHeldOnMacbook({ records, store: f.store, images: f.images, busy: false, now: Date.now() + 3600000, ...extra });

test('listing and describing a MacBook image never downloads it', async () => {
  const f = await fixture();
  try {
    assert.deepEqual(f.store.listCanonicalImages(), [ID]);
    assert.equal(f.store.hasImage(ID), true);
    const info = f.store.macbookInfo(ID);
    assert.equal(info.sha256, crypto.createHash('sha256').update(PNG).digest('hex'));
    assert.deepEqual([info.width, info.height, info.bytes], [64, 48, PNG.length]);
    assert.deepEqual(fs.readdirSync(f.bigmac), []);
    assert.equal(f.images.isReachable(), true);
  } finally { await f.close(); }
});

test('work that needs a file gets the image back under its own name, and the sweep removes it when idle', async () => {
  const f = await fixture();
  try {
    const img = f.store.resolveImage(ID);
    assert.equal(img.path, path.join(f.bigmac, ID), 'scripts accept this folder and read the id from the name');
    assert.deepEqual(fs.readFileSync(img.path), PNG);
    assert.equal(f.store.macbookInfo(ID), null);
    assert.deepEqual(sweepOf(f)([], { now: Date.now() }), { removed: 0, missing: 0 }, 'still in use');
    assert.deepEqual(sweepOf(f)([], { busy: true }), { removed: 0, missing: 0 }, 'a job is active');
    assert.equal(fs.existsSync(img.path), true);
    assert.deepEqual(sweepOf(f)([]), { removed: 1, missing: 0 });
    assert.deepEqual(fs.readdirSync(f.bigmac), []);
    assert.equal(f.store.hasImage(ID), true);
  } finally { await f.close(); }
});

test('a copy that does not match the published digest is refused', async () => {
  const f = await fixture();
  try {
    fs.writeFileSync(path.join(f.macbook, ID), makePng(32, 32));
    assert.equal(f.store.resolveImage(ID), null, 'the bytes no longer match the manifest it was listed from');
    assert.deepEqual(fs.readdirSync(f.bigmac), []);
  } finally { await f.close(); }
});

test('a file leaves the Big Mac only on the MacBook manifest\'s own evidence', async () => {
  const f = await fixture();
  const other = '20261104-120001-new.png', bytes = makePng(40, 40), here = path.join(f.bigmac, other), sweep = sweepOf(f);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const record = { image_id: other, state: 'CANONICAL_VERIFIED', expected_bytes: bytes.length, sha256 };
  try {
    fs.writeFileSync(here, bytes);
    assert.equal(f.store.resolveImage(other).path, here);

    // A receipt alone is not enough: the MacBook does not list this image yet.
    assert.deepEqual(sweep([record]), { removed: 0, missing: 0 });
    fs.writeFileSync(path.join(f.macbook, other), makePng(50, 50));
    await f.images.refresh();
    assert.deepEqual(sweep([record]), { removed: 0, missing: 0 }, 'the MacBook holds different bytes');
    fs.writeFileSync(path.join(f.macbook, other), bytes);
    await f.images.refresh();
    assert.deepEqual(sweep([{ ...record, state: 'PUBLICATION_PENDING' }]), { removed: 0, missing: 0 }, 'still waiting to be published');

    // A job that still owns the image keeps it, in any journal phase; an unreadable journal stops all removal.
    const journal = path.join(f.bigmac, '.pending-abc.json');
    fs.writeFileSync(journal, JSON.stringify({ phase: 'run-index-committed', cleanup_state: 'metadata-committed', image_ids: [other] }));
    assert.deepEqual(sweep([record]), { removed: 0, missing: 0 });
    fs.writeFileSync(journal, '{ broken');
    assert.deepEqual(sweep([record]), { removed: 0, missing: 0 });
    fs.unlinkSync(journal);
    assert.equal(fs.existsSync(here), true);

    assert.deepEqual(sweep([record]), { removed: 1, missing: 0 });
    assert.equal(fs.existsSync(here), false);
    assert.equal(f.store.hasImage(other), true);
    assert.ok(f.store.listCanonicalImages().includes(other));
  } finally { await f.close(); }
});

test('nothing is removed while the MacBook is away, and a folder that empties counts as away', async () => {
  const f = await fixture();
  const other = '20261104-120001-new.png', bytes = makePng(40, 40), here = path.join(f.bigmac, other);
  try {
    fs.writeFileSync(here, bytes); fs.writeFileSync(path.join(f.macbook, other), bytes);
    await f.images.refresh();
    fs.unlinkSync(path.join(f.macbook, ID)); fs.unlinkSync(path.join(f.macbook, other));
    assert.equal(await f.images.refresh(), false);
    assert.equal(f.images.has(ID), true, 'what was known is kept');
    assert.deepEqual(sweepOf(f)([]), { removed: 0, missing: 0 });
    assert.equal(fs.existsSync(here), true);
  } finally { await f.close(); }
});

test('an acknowledged image in neither place is reported, and the list survives a restart', async () => {
  const f = await fixture();
  try {
    const gone = { image_id: '20261104-120009-gone.png', state: 'CANONICAL_VERIFIED', expected_bytes: 1, sha256: 'a'.repeat(64) };
    assert.deepEqual(sweepOf(f)([gone]), { removed: 0, missing: 1 });
    const restarted = createMacbookImages({ baseUrl: 'http://127.0.0.1:9', manifestFile: f.manifestFile });
    assert.equal(restarted.has(ID), true);
    assert.equal(restarted.isReachable(), false);
  } finally { await f.close(); }
});

test('the service is read-only and shares only regular image files', async () => {
  const f = await fixture();
  try {
    fs.writeFileSync(path.join(f.macbook, 'library-tags.json'), '{}');
    fs.writeFileSync(path.join(f.macbook, 'fake.png'), 'not an image');
    fs.writeFileSync(path.join(f.dir, 'secret.png'), PNG);
    fs.symlinkSync(path.join(f.dir, 'secret.png'), path.join(f.macbook, 'link.png'));
    const m = await (await fetch(f.baseUrl + '/manifest')).json();
    assert.deepEqual(Object.keys(m.images), [ID]);
    assert.equal((await fetch(f.baseUrl + '/images/' + ID, { method: 'POST' })).status, 405);
    for (const bad of ['library-tags.json', 'fake.png', 'link.png', '..%2Fsecret.png']) assert.equal((await fetch(f.baseUrl + '/images/' + bad)).status, 404, bad);
    assert.deepEqual(Buffer.from(await (await fetch(f.baseUrl + '/images/' + ID)).arrayBuffer()), PNG);
    assert.equal((await fetch(f.baseUrl + '/thumbnails/' + ID)).status, 200);
  } finally { await f.close(); }
});

test('the real server lists and streams MacBook images, and says when the MacBook is gone', async () => {
  const f = await fixture();
  const second = '20261104-120002-macbook-b.png';
  fs.writeFileSync(path.join(f.macbook, second), makePng(20, 20));
  process.env.DEX_MACBOOK_IMAGES_URL = f.baseUrl;
  const srv = await startServer();
  delete process.env.DEX_MACBOOK_IMAGES_URL;
  try {
    let list;
    for (let i = 0; i < 40; i++) { list = await (await fetch(srv.base + '/api/library/images')).json(); if (list.total === 2) break; await new Promise(r => setTimeout(r, 250)); }
    assert.deepEqual(list.items.map(x => x.id).sort(), [ID, second]);
    assert.equal(list.macbook, 'reachable');
    const row = list.items.find(x => x.id === ID);
    assert.equal(row.width, 64);
    assert.equal(row.path, '/Users/andrew/images_made/' + ID);
    assert.deepEqual(Buffer.from(await (await fetch(srv.base + '/api/images/' + ID)).arrayBuffer()), PNG);
    assert.equal((await fetch(srv.base + '/api/thumbnails/' + ID)).status, 200);
    assert.equal((await fetch(srv.base + '/api/images/' + ID + '/meta')).status, 200);
    assert.equal((await fetch(srv.base + '/api/images/' + ID + '/export')).status, 200, 'routes that need a real file still work');
    const bulk = await fetch(srv.base + '/api/images/export', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids: [ID], format: 'png', metadata: 'none' }) });
    assert.equal(bulk.status, 200, 'multi-image export');
    await f.close();
    for (let i = 0; i < 40; i++) { list = await (await fetch(srv.base + '/api/library/images')).json(); if (list.macbook === 'unreachable') break; await new Promise(r => setTimeout(r, 250)); }
    assert.equal(list.macbook, 'unreachable');
    assert.equal(list.total, 2, 'the list is kept while the MacBook is away');
    assert.equal((await fetch(srv.base + '/api/images/' + second)).status, 503);
    assert.equal((await fetch(srv.base + '/api/images/' + second + '/export')).status, 404);
  } finally { await srv.stop(); }
});
