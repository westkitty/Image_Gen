'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createCollectionStore, SCHEMA_VERSION } = require('../collections-store');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-recover-001-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function assertRecoveryBlocked(store) {
  assert.throws(() => store.create({ name: 'Must not be saved' }), e => e.collectionSaveFailed === true);
  assert.equal(store.count(), 0);
  assert.deepEqual(store.list(), []);
}

function collectionPost(store) {
  // Evaluate the real POST registration only, never launch the console service.
  const source = fs.readFileSync(path.resolve(__dirname, '../server.js'), 'utf8');
  const begin = source.indexOf("app.post('/api/collections',");
  const end = source.indexOf("app.get('/api/collections/:id',", begin);
  assert.ok(begin >= 0 && end > begin);
  let handler;
  vm.runInNewContext(source.slice(begin, end), {
    app: { post(url, fn) { assert.equal(url, '/api/collections'); handler = fn; } },
    collectionStore: store,
  }, { filename: 'isolated-collections-recover-post.js' });
  assert.equal(typeof handler, 'function');
  return handler;
}

function request(handler, body) {
  const res = {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  handler({ body }, res);
  return res;
}

test('RECOVER-001 preserves malformed ledger bytes and rejects every mutation before touching memory', t => {
  const root = fixture(t), file = path.join(root, 'collections.json');
  const original = Buffer.from('{BAD_COLLECTIONS_BYTES', 'utf8');
  fs.writeFileSync(file, original);
  const store = createCollectionStore(file);
  const calls = [
    () => store.create({ name: 'New collection' }),
    () => store.update('missing-id', { name: 'Changed' }),
    () => store.addArtifacts('missing-id', ['canonical-a.png']),
    () => store.removeArtifacts('missing-id', ['canonical-a.png']),
    () => store.remove('missing-id'),
  ];
  for (const call of calls) {
    assert.throws(call, err => err.collectionSaveFailed === true);
    assert.deepEqual(fs.readFileSync(file), original);
    assert.equal(store.count(), 0);
  }
});

test('RECOVER-001 rejects incompatible versions, structures, damaged rows and duplicate IDs', t => {
  const root = fixture(t);
  const examples = [
    Buffer.from([0xff, 0xfe, 0x7b]),
    Buffer.from(JSON.stringify({ version: 'dexdiffusion.collections.v0', collections: [] })),
    Buffer.from(JSON.stringify({ version: SCHEMA_VERSION, collections: {} })),
    Buffer.from(JSON.stringify({ version: SCHEMA_VERSION, collections: [{ name: 'Missing ID' }] })),
    Buffer.from(JSON.stringify({ version: SCHEMA_VERSION, collections: [
      { id: 'duplicate', name: 'First' }, { id: 'duplicate', name: 'Second' }
    ] })),
  ];
  for (let i = 0; i < examples.length; i++) {
    const file = path.join(root, 'invalid-' + i + '.json');
    fs.writeFileSync(file, examples[i]);
    const store = createCollectionStore(file);
    assertRecoveryBlocked(store);
    assert.deepEqual(fs.readFileSync(file), examples[i], 'original invalid bytes preserved');
  }
});

test('RECOVER-001 rejects simulated unreadable and inaccessible existing ledgers', t => {
  const root = fixture(t);
  for (const method of ['readFileSync', 'lstatSync']) {
    const file = path.join(root, method + '.json');
    const original = Buffer.from(JSON.stringify({ version: SCHEMA_VERSION, collections: [] }));
    fs.writeFileSync(file, original);
    const previous = fs[method];
    fs[method] = function (...args) {
      if (args[0] === file) {
        const err = new Error('simulated permission denial');
        err.code = 'EACCES';
        throw err;
      }
      return previous.apply(this, args);
    };
    let store;
    try {
      store = createCollectionStore(file);
    } finally {
      fs[method] = previous;
    }
    assertRecoveryBlocked(store);
    assert.deepEqual(fs.readFileSync(file), original);
    // Removing the simulated failure does not silently unlock this store.
    assertRecoveryBlocked(store);
  }
});

test('RECOVER-001 preserves an existing dangling symlink rather than replacing it', t => {
  const root = fixture(t), file = path.join(root, 'collections.json');
  const missingTarget = path.join(root, 'missing-target.json');
  fs.symlinkSync(missingTarget, file);
  const store = createCollectionStore(file);
  assertRecoveryBlocked(store);
  assert.ok(fs.lstatSync(file).isSymbolicLink());
  assert.equal(fs.readlinkSync(file), missingTarget);
  assert.equal(fs.existsSync(missingTarget), false);
});

test('RECOVER-001 genuinely absent files and valid ledgers keep healthy CRUD and reload behavior', t => {
  const root = fixture(t), file = path.join(root, 'new-parent', 'collections.json');
  const store = createCollectionStore(file);
  assert.equal(store.count(), 0);
  const created = store.create({ name: 'Valid', tags: ['retained'], artifactIds: ['canonical-a.png'] });
  assert.match(created.id, /^col_/);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).version, SCHEMA_VERSION);
  const reopened = createCollectionStore(file);
  assert.equal(reopened.get(created.id).name, 'Valid');
  assert.equal(reopened.update(created.id, { name: 'Updated' }).name, 'Updated');
  assert.deepEqual(reopened.addArtifacts(created.id, ['canonical-b.png']).artifactIds,
    ['canonical-a.png', 'canonical-b.png']);
  assert.deepEqual(reopened.removeArtifacts(created.id, ['canonical-a.png']).artifactIds, ['canonical-b.png']);
  assert.equal(createCollectionStore(file).get(created.id).name, 'Updated');
  assert.equal(reopened.remove(created.id), true);
  assert.equal(createCollectionStore(file).count(), 0);
  const inMemoryOnly = createCollectionStore();
  assert.equal(inMemoryOnly.create({ name: 'Transient' }).name, 'Transient');
});

test('RECOVER-001 POST stays generic 500 when blocked; healthy 200 and input-validation 400 remain', t => {
  const root = fixture(t), brokenFile = path.join(root, 'collections.json');
  const original = Buffer.from('{RECOVERY_REQUIRED', 'utf8');
  fs.writeFileSync(brokenFile, original);
  const blockedStore = createCollectionStore(brokenFile);
  const failed = request(collectionPost(blockedStore), { name: 'Cannot save' });
  assert.equal(failed.statusCode, 500);
  assert.notEqual(failed.body.ok, true);
  assert.equal(failed.body.error, 'Collection could not be saved');
  assert.doesNotMatch(JSON.stringify(failed.body), /collections\.json|RECOVERY_REQUIRED|\/tmp\//);
  assert.deepEqual(fs.readFileSync(brokenFile), original);
  const validFile = path.join(root, 'healthy', 'collections.json');
  const healthyPost = collectionPost(createCollectionStore(validFile));
  const invalid = request(healthyPost, { name: ' ' });
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.body.error, 'Collection name is required');
  const success = request(healthyPost, { name: 'Created', artifactIds: ['canonical-c.png'] });
  assert.equal(success.statusCode, 200);
  assert.equal(success.body.ok, true);
  assert.equal(createCollectionStore(validFile).get(success.body.collection.id).name, 'Created');
});
