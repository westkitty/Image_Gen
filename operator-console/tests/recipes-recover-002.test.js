'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRecipeStore, SCHEMA_VERSION } = require('../recipes-store');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-recover-002-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function assertRecoveryBlocked(store) {
  assert.throws(() => store.create({ name: 'Must not be saved' }), e => e.recipeSaveFailed === true);
  assert.equal(store.count(), 0);
  assert.deepEqual(store.list(), []);
}

function recipePost(store) {
  // Execute only the existing route declaration; never start production services.
  const source = fs.readFileSync(path.resolve(__dirname, '../server.js'), 'utf8');
  const begin = source.indexOf("app.post('/api/recipes',");
  const end = source.indexOf("app.get('/api/recipes/:id',", begin);
  assert.ok(begin >= 0 && end > begin);
  let handler;
  vm.runInNewContext(source.slice(begin, end), {
    app: { post(url, fn) { assert.equal(url, '/api/recipes'); handler = fn; } },
    recipeStore: store,
  }, { filename: 'isolated-recipes-recover-post.js' });
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

test('RECOVER-002 preserves corrupt bytes and blocks all Recipes mutators before touching memory', t => {
  const root = fixture(t), file = path.join(root, 'recipes.json');
  const original = Buffer.from('{BAD_RECIPES_BYTES', 'utf8');
  fs.writeFileSync(file, original);
  const store = createRecipeStore(file);
  const actions = [
    () => store.create({ name: 'New recipe' }),
    () => store.update('nonexistent-id', { name: 'Changed' }),
    () => store.remove('nonexistent-id'),
    () => store.duplicate('nonexistent-id', 'Copy'),
    () => store.importLegacyStyles([{ name: 'Incoming legacy', parameters: { steps: 5 } }]),
  ];
  for (const action of actions) {
    assert.throws(action, err => err.recipeSaveFailed === true);
    assert.deepEqual(fs.readFileSync(file), original);
    assert.equal(store.count(), 0);
  }
});

test('RECOVER-002 rejects incompatible schemas, malformed entries and duplicate recipe IDs', t => {
  const root = fixture(t);
  const examples = [
    Buffer.from([0xff, 0xfe, 0x7b]),
    Buffer.from(JSON.stringify({ version: 'dexdiffusion.recipe.v0', recipes: [] })),
    Buffer.from(JSON.stringify({ version: SCHEMA_VERSION, recipes: {} })),
    Buffer.from(JSON.stringify({ version: SCHEMA_VERSION, recipes: [{ name: 'No ID' }] })),
    Buffer.from(JSON.stringify({ version: SCHEMA_VERSION, recipes: [
      { id: 'good', name: 'Good' }, { name: 'Bad row after valid row' }
    ] })),
    Buffer.from(JSON.stringify({ version: SCHEMA_VERSION, recipes: [
      { id: 'twice', name: 'One' }, { id: 'twice', name: 'Two' }
    ] })),
  ];
  for (let i = 0; i < examples.length; i++) {
    const file = path.join(root, 'invalid-' + i + '.json');
    fs.writeFileSync(file, examples[i]);
    const store = createRecipeStore(file);
    assertRecoveryBlocked(store);
    assert.deepEqual(fs.readFileSync(file), examples[i]);
  }
});

test('RECOVER-002 blocks on read and metadata permission errors without losing existing bytes', t => {
  const root = fixture(t);
  for (const method of ['readFileSync', 'lstatSync']) {
    const file = path.join(root, method + '.json');
    const original = Buffer.from(JSON.stringify({ version: SCHEMA_VERSION, recipes: [] }));
    fs.writeFileSync(file, original);
    const prev = fs[method];
    fs[method] = function (...args) {
      if (args[0] === file) {
        const err = new Error('synthetic permission error');
        err.code = 'EACCES';
        throw err;
      }
      return prev.apply(this, args);
    };
    let store;
    try {
      store = createRecipeStore(file);
    } finally {
      fs[method] = prev;
    }
    assertRecoveryBlocked(store);
    assert.deepEqual(fs.readFileSync(file), original);
    // Retrying a mutation after an I/O error does not silently unlock recovery.
    assertRecoveryBlocked(store);
  }
});

test('RECOVER-002 preserves an existing dangling ledger symlink', t => {
  const root = fixture(t), file = path.join(root, 'recipes.json');
  const missing = path.join(root, 'missing-original.json');
  fs.symlinkSync(missing, file);
  const store = createRecipeStore(file);
  assertRecoveryBlocked(store);
  assert.equal(fs.lstatSync(file).isSymbolicLink(), true);
  assert.equal(fs.readlinkSync(file), missing);
  assert.equal(fs.existsSync(missing), false);
});

test('RECOVER-002 absent files, valid recipe reload, prompt policy, duplicate and import still work', t => {
  const root = fixture(t), file = path.join(root, 'new-dir', 'recipes.json');
  const store = createRecipeStore(file);
  assert.equal(store.count(), 0);
  const a = store.create({ name: 'Unsaved prompt excluded', category: 'music',
    parameters: { steps: 11, prompt: 'DIRECT_PRIVATE', negative_prompt: 'NEG_PRIVATE' },
    includePrompt: false, prompt: 'NOT_OPTED_IN' });
  assert.equal(a.promptSaved, false);
  assert.equal(a.savedPrompt, null);
  assert.equal(a.parameters.steps, 11);
  assert.equal(a.parameters.prompt, undefined);
  let bytes = fs.readFileSync(file, 'utf8');
  assert.ok(!bytes.includes('DIRECT_PRIVATE'));
  assert.ok(!bytes.includes('NEG_PRIVATE'));
  assert.ok(!bytes.includes('NOT_OPTED_IN'));
  const b = store.create({ name: 'Explicit prompt', includePrompt: true,
    prompt: 'OPTED_IN_PROMPT', parameters: { steps: 12 }, tags: ['safe'] });
  const copy = store.duplicate(b.id, 'Explicit copy');
  assert.equal(copy.savedPrompt, 'OPTED_IN_PROMPT');
  assert.equal(store.importLegacyStyles([{ name: 'Legacy recipe', parameters: { steps: 13 } }]).importedCount, 1);
  const reopened = createRecipeStore(file);
  assert.equal(reopened.count(), 4);
  assert.equal(reopened.get(a.id).name, 'Unsaved prompt excluded');
  assert.equal(reopened.get(b.id).savedPrompt, 'OPTED_IN_PROMPT');
  assert.equal(reopened.get(copy.id).savedPrompt, 'OPTED_IN_PROMPT');
  assert.equal(reopened.list().find(x => x.name === 'Legacy recipe').parameters.steps, 13);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).version, SCHEMA_VERSION);
  assert.equal(reopened.update(a.id, { name: 'Edited recipe' }).name, 'Edited recipe');
  assert.equal(reopened.remove(b.id), true);
  assert.equal(createRecipeStore(file).count(), 3);
  assert.equal(createRecipeStore().create({ name: 'In-memory recipe' }).name, 'In-memory recipe');
});

test('RECOVER-002 blocked POST is generic HTTP 500; healthy success and validation remain unchanged', t => {
  const root = fixture(t), file = path.join(root, 'recipes.json');
  const original = Buffer.from('{BROKEN_RECIPES', 'utf8');
  fs.writeFileSync(file, original);
  const blocked = request(recipePost(createRecipeStore(file)), { name: 'Cannot save' });
  assert.equal(blocked.statusCode, 500);
  assert.notEqual(blocked.body.ok, true);
  assert.equal(blocked.body.error, 'Recipe could not be saved');
  assert.doesNotMatch(JSON.stringify(blocked.body), /recipes\.json|BROKEN_RECIPES|\/tmp\//);
  assert.deepEqual(fs.readFileSync(file), original);
  const healthyPath = path.join(root, 'healthy', 'recipes.json');
  const post = recipePost(createRecipeStore(healthyPath));
  const invalid = request(post, { name: ' ' });
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.body.error, 'Recipe name is required');
  const success = request(post, { name: 'New healthy recipe', parameters: { steps: 20 } });
  assert.equal(success.statusCode, 200);
  assert.equal(success.body.ok, true);
  assert.equal(createRecipeStore(healthyPath).get(success.body.recipe.id).parameters.steps, 20);
});
