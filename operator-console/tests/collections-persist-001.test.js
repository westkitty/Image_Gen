'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createCollectionStore, SCHEMA_VERSION } = require('../collections-store');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-persist-001-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function collectionPost(store) {
  // Execute only the actual route registration, not the production server.
  const source = fs.readFileSync(path.resolve(__dirname, '../server.js'), 'utf8');
  const start = source.indexOf("app.post('/api/collections',");
  const end = source.indexOf("app.get('/api/collections/:id',", start);
  assert.ok(start >= 0 && end > start, 'Collections POST handler must exist');
  let handler;
  vm.runInNewContext(source.slice(start, end), {
    app: { post(url, fn) { assert.equal(url, '/api/collections'); handler = fn; } },
    collectionStore: store,
  }, { filename: 'isolated-collections-post.js' });
  assert.equal(typeof handler, 'function');
  return handler;
}

function request(handler, body) {
  const response = {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  handler({ body }, response);
  return response;
}

test('PERSIST-001 blocked filesystem save throws without admitting an in-memory collection', t => {
  const root = fixture(t), blocked = path.join(root, 'not-a-directory');
  fs.writeFileSync(blocked, 'occupied');
  const store = createCollectionStore(path.join(blocked, 'collections.json'));
  assert.throws(() => store.create({ name: 'Synthetic collection' }), err => err.collectionSaveFailed === true);
  assert.equal(store.count(), 0);
  assert.deepEqual(store.list(), []);
  assert.equal(fs.readFileSync(blocked, 'utf8'), 'occupied');
});

test('PERSIST-001 existing bytes and memory survive failed rename, healthy create stays reloadable', t => {
  const root = fixture(t), file = path.join(root, 'collections.json');
  const store = createCollectionStore(file);
  const first = store.create({ name: 'First', artifactIds: ['canonical-a.png', 'canonical-a.png'] });
  const before = fs.readFileSync(file, 'utf8');
  assert.equal(JSON.parse(before).version, SCHEMA_VERSION);
  assert.deepEqual(first.artifactIds, ['canonical-a.png']);
  const originalRename = fs.renameSync;
  fs.renameSync = (from, to) => {
    if (to === file) throw Object.assign(new Error('synthetic rename denial'), { code: 'EIO' });
    return originalRename(from, to);
  };
  try {
    assert.throws(() => store.create({ name: 'Must not persist' }), err => err.collectionSaveFailed === true);
  } finally {
    fs.renameSync = originalRename;
  }
  assert.equal(fs.readFileSync(file, 'utf8'), before, 'previous stored bytes must remain exact');
  assert.equal(store.count(), 1, 'failed create must not leave an in-memory ghost');
  assert.equal(store.get(first.id).name, 'First');
  assert.equal(createCollectionStore(file).count(), 1);
  const second = store.create({ name: 'Second', artifactIds: ['canonical-b.png'] });
  assert.notEqual(second.id, first.id);
  const reloaded = createCollectionStore(file);
  assert.equal(reloaded.count(), 2);
  assert.equal(reloaded.get(first.id).name, 'First');
  assert.equal(reloaded.get(second.id).name, 'Second');
  assert.deepEqual(reloaded.get(second.id).artifactIds, ['canonical-b.png']);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).version, SCHEMA_VERSION);
});

test('PERSIST-001 Collections POST reports storage failure, retains invalid-input 400 and successful create', t => {
  const root = fixture(t), blocked = path.join(root, 'not-a-directory');
  fs.writeFileSync(blocked, 'occupied');
  const failingStore = createCollectionStore(path.join(blocked, 'collections.json'));
  const failure = request(collectionPost(failingStore), { name: 'Not saved' });
  assert.equal(failure.statusCode, 500);
  assert.notEqual(failure.body.ok, true);
  assert.equal(failure.body.error, 'Collection could not be saved');
  assert.equal(failingStore.count(), 0);
  const healthyStore = createCollectionStore(path.join(root, 'collections.json'));
  const handler = collectionPost(healthyStore);
  const invalid = request(handler, { name: ' ' });
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.body.error, 'Collection name is required');
  const success = request(handler, { name: 'Valid collection', artifactIds: ['canonical-a.png'] });
  assert.equal(success.statusCode, 200);
  assert.equal(success.body.ok, true);
  assert.equal(createCollectionStore(path.join(root, 'collections.json')).get(success.body.collection.id).name, 'Valid collection');
});
