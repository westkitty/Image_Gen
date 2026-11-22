'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createMacroStore, SCHEMA_VERSION } = require('../macro-store');

const sample = name => ({ name, steps: [{ type: 'wait_input', label: 'Continue' }] });

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-persist-003-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function macroPost(store) {
  // Evaluate only the actual registration, never launch the operator server.
  const source = fs.readFileSync(path.resolve(__dirname, '../server.js'), 'utf8');
  const begin = source.indexOf("app.post('/api/macros',");
  const end = source.indexOf("app.get('/api/macros/:id',", begin);
  assert.ok(begin >= 0 && end > begin, 'Macro POST registration must exist');
  let handler;
  vm.runInNewContext(source.slice(begin, end), {
    app: { post(url, fn) { assert.equal(url, '/api/macros'); handler = fn; } },
    macroStore: store,
  }, { filename: 'isolated-macros-post.js' });
  assert.equal(typeof handler, 'function');
  return handler;
}

function request(handler, body) {
  const response = {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
  handler({ body }, response);
  return response;
}

test('PERSIST-003 original blocked-parent contract rejects save and leaves no in-memory macro', t => {
  const root = fixture(t), blocked = path.join(root, 'not-a-directory');
  fs.writeFileSync(blocked, 'occupied');
  const store = createMacroStore(path.join(blocked, 'macros.json'));
  assert.throws(() => store.create(sample('Synthetic macro')), e => e.macroSaveFailed === true);
  assert.equal(store.count(), 0);
  assert.deepEqual(store.list(), []);
  assert.equal(fs.readFileSync(blocked, 'utf8'), 'occupied');
});

test('PERSIST-003 failed rename preserves earlier bytes and state, subsequent write reloads', t => {
  const root = fixture(t), file = path.join(root, 'macros.json');
  const store = createMacroStore(file);
  const first = store.create(sample('Already stored'));
  const original = fs.readFileSync(file);
  assert.equal(JSON.parse(original.toString()).version, SCHEMA_VERSION);
  const rename = fs.renameSync;
  fs.renameSync = (from, to) => {
    if (to === file) throw Object.assign(new Error('synthetic rename failed'), { code: 'EIO' });
    return rename(from, to);
  };
  try {
    assert.throws(() => store.create(sample('Unacknowledged write')), e => e.macroSaveFailed === true);
  } finally {
    fs.renameSync = rename;
  }
  assert.deepEqual(fs.readFileSync(file), original);
  assert.equal(store.count(), 1);
  assert.equal(store.get(first.id).name, 'Already stored');
  assert.equal(createMacroStore(file).count(), 1);
  const second = store.create(sample('Committed later'));
  assert.notEqual(first.id, second.id);
  const reopened = createMacroStore(file);
  assert.equal(reopened.count(), 2);
  assert.equal(reopened.get(first.id).name, 'Already stored');
  assert.equal(reopened.get(second.id).name, 'Committed later');
});

test('PERSIST-003 POST returns generic 500 on failed storage, retains 400 validation and healthy success', t => {
  const root = fixture(t), occupied = path.join(root, 'occupied');
  fs.writeFileSync(occupied, 'not a directory');
  const badStore = createMacroStore(path.join(occupied, 'macros.json'));
  const failed = request(macroPost(badStore), sample('Unwritten macro'));
  assert.equal(failed.statusCode, 500);
  assert.notEqual(failed.body.ok, true);
  assert.equal(failed.body.error, 'Macro could not be saved');
  assert.doesNotMatch(JSON.stringify(failed.body), /occupied|ENOTDIR|\/tmp\//);
  assert.equal(badStore.count(), 0);
  const file = path.join(root, 'valid', 'macros.json');
  const post = macroPost(createMacroStore(file));
  const invalid = request(post, { name: ' ', steps: [{ type: 'wait_input' }] });
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.body.error, 'Macro name is required');
  const valid = request(post, sample('Saved macro'));
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.body.ok, true);
  assert.equal(createMacroStore(file).get(valid.body.macro.id).name, 'Saved macro');
});

test('PERSIST-003 healthy creates retain schema, step sanitization and existing explicit prompt policy', t => {
  const root = fixture(t), file = path.join(root, 'macros.json');
  const store = createMacroStore(file);
  const plain = store.create({ name: 'No saved prompt', steps: [{ type: 'generate', settings: {
    command: 'forbidden-command', exec: 'forbidden-exec', script: 'forbidden-script', cfg: 4.5
  } }] });
  assert.match(plain.id, /^mac_/);
  assert.equal(plain.schemaVersion, SCHEMA_VERSION);
  assert.equal(plain.promptSaved, false);
  assert.equal(plain.savedPrompt, null);
  assert.equal(plain.steps[0].settings.cfg, 4.5);
  for (const field of ['command', 'exec', 'script']) {
    assert.equal(plain.steps[0].settings[field], undefined);
  }
  const explicit = store.create({ ...sample('With explicit prompt'), savedPrompt: 'OPTED_IN_TEXT' });
  assert.equal(explicit.promptSaved, true);
  assert.equal(explicit.savedPrompt, 'OPTED_IN_TEXT');
  const reopened = createMacroStore(file);
  assert.equal(reopened.count(), 2);
  assert.equal(reopened.get(plain.id).savedPrompt, null);
  assert.equal(reopened.get(explicit.id).savedPrompt, 'OPTED_IN_TEXT');
  const bytes = fs.readFileSync(file, 'utf8');
  assert.ok(!bytes.includes('forbidden-command'));
  assert.ok(!bytes.includes('forbidden-script'));
  assert.ok(bytes.includes('OPTED_IN_TEXT'));
  assert.equal(JSON.parse(bytes).version, SCHEMA_VERSION);
});

test('PERSIST-003 existing validation and update/remove operations stay functional', t => {
  const root = fixture(t), file = path.join(root, 'macros.json');
  const store = createMacroStore(file);
  for (const input of [
    { name: '', steps: [{ type: 'wait_input' }] },
    { name: 'Empty steps', steps: [] },
    { name: 'Forbidden step', steps: [{ type: 'shell' }] },
  ]) assert.throws(() => store.create(input));
  assert.equal(store.count(), 0);
  assert.equal(fs.existsSync(file), false);
  const m = store.create(sample('Original'));
  assert.equal(store.update(m.id, { name: 'Updated' }).name, 'Updated');
  assert.equal(createMacroStore(file).get(m.id).name, 'Updated');
  assert.equal(store.remove(m.id), true);
  assert.equal(createMacroStore(file).count(), 0);
  assert.equal(createMacroStore().create(sample('Memory only')).name, 'Memory only');
});
