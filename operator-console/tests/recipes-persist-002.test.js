'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRecipeStore, SCHEMA_VERSION } = require('../recipes-store');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-persist-002-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function recipePost(store) {
  // Bind the actual POST route in isolation; do not launch a production service.
  const source = fs.readFileSync(path.resolve(__dirname, '../server.js'), 'utf8');
  const start = source.indexOf("app.post('/api/recipes',");
  const end = source.indexOf("app.get('/api/recipes/:id',", start);
  assert.ok(start >= 0 && end > start, 'Recipes POST handler must exist');
  let handler;
  vm.runInNewContext(source.slice(start, end), {
    app: { post(url, fn) { assert.equal(url, '/api/recipes'); handler = fn; } },
    recipeStore: store,
  }, { filename: 'isolated-recipes-post.js' });
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

test('PERSIST-002 blocked parent path rejects creation without admitting an in-memory recipe', t => {
  const root = fixture(t), blocked = path.join(root, 'not-a-directory');
  fs.writeFileSync(blocked, 'occupied');
  const store = createRecipeStore(path.join(blocked, 'recipes.json'));
  assert.throws(() => store.create({ name: 'Synthetic recipe', parameters: { steps: 7 } }),
    err => err.recipeSaveFailed === true);
  assert.equal(store.count(), 0);
  assert.deepEqual(store.list(), []);
  assert.equal(fs.readFileSync(blocked, 'utf8'), 'occupied');
});

test('PERSIST-002 failed rename preserves prior bytes and memory; subsequent creation survives reload', t => {
  const root = fixture(t), file = path.join(root, 'recipes.json');
  const store = createRecipeStore(file);
  const first = store.create({ name: 'Existing recipe', category: 'voice', parameters: { steps: 9 } });
  const before = fs.readFileSync(file);
  assert.equal(JSON.parse(before.toString()).version, SCHEMA_VERSION);
  const originalRename = fs.renameSync;
  fs.renameSync = (from, to) => {
    if (to === file) throw Object.assign(new Error('synthetic rename refusal'), { code: 'EIO' });
    return originalRename(from, to);
  };
  try {
    assert.throws(() => store.create({ name: 'Must not persist', parameters: { steps: 10 } }),
      err => err.recipeSaveFailed === true);
  } finally {
    fs.renameSync = originalRename;
  }
  assert.deepEqual(fs.readFileSync(file), before, 'previously persisted bytes remain identical');
  assert.equal(store.count(), 1, 'failed create must not enter the live Map');
  assert.equal(store.get(first.id).name, 'Existing recipe');
  assert.equal(createRecipeStore(file).count(), 1);
  const second = store.create({ name: 'New recipe', parameters: { steps: 11 } });
  assert.notEqual(first.id, second.id);
  const reopened = createRecipeStore(file);
  assert.equal(reopened.count(), 2);
  assert.equal(reopened.get(first.id).name, 'Existing recipe');
  assert.equal(reopened.get(second.id).parameters.steps, 11);
});

test('PERSIST-002 POST returns generic 500 for storage failure, 400 for validation, and success on healthy create', t => {
  const root = fixture(t), blocked = path.join(root, 'not-a-directory');
  fs.writeFileSync(blocked, 'occupied');
  const failedStore = createRecipeStore(path.join(blocked, 'recipes.json'));
  const failed = request(recipePost(failedStore), { name: 'Not saved' });
  assert.equal(failed.statusCode, 500);
  assert.notEqual(failed.body.ok, true);
  assert.equal(failed.body.error, 'Recipe could not be saved');
  assert.doesNotMatch(JSON.stringify(failed.body), /not-a-directory|E(?:NOTDIR|IO)|\/tmp\//);
  assert.equal(failedStore.count(), 0);
  const goodStore = createRecipeStore(path.join(root, 'recipes.json'));
  const handler = recipePost(goodStore);
  const invalid = request(handler, { name: ' ' });
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.body.error, 'Recipe name is required');
  const valid = request(handler, { name: 'Valid recipe', category: 'music', parameters: { steps: 14 } });
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.body.ok, true);
  assert.equal(valid.body.recipe.category, 'music');
  assert.equal(createRecipeStore(path.join(root, 'recipes.json')).get(valid.body.recipe.id).name, 'Valid recipe');
});

test('PERSIST-002 preserves direct prompt opt-out/opt-in, healthy duplication and legacy import', t => {
  const root = fixture(t), file = path.join(root, 'recipes.json');
  const store = createRecipeStore(file);
  const out = store.create({ name: 'Private recipe', includePrompt: false, prompt: 'PRIVATE_DIRECT',
    parameters: { steps: 17, prompt: 'PRIVATE_PARAMETERS', negative_prompt: 'PRIVATE_NEGATIVE' } });
  assert.match(out.id, /^rcp_[a-z0-9-]+$/i);
  assert.equal(out.schemaVersion, SCHEMA_VERSION);
  assert.equal(out.promptSaved, false);
  assert.equal(out.savedPrompt, null);
  assert.equal(out.parameters.steps, 17);
  assert.equal(out.parameters.prompt, undefined);
  assert.equal(out.parameters.negative_prompt, undefined);
  const beforeOptIn = fs.readFileSync(file, 'utf8');
  assert.ok(!beforeOptIn.includes('PRIVATE_DIRECT'));
  assert.ok(!beforeOptIn.includes('PRIVATE_PARAMETERS'));
  assert.ok(!beforeOptIn.includes('PRIVATE_NEGATIVE'));
  const optedIn = store.create({ name: 'Explicit prompt', category: 'edit', includePrompt: true,
    prompt: 'OPTED_IN_TEXT', parameters: { steps: 8 }, tags: ['retained'] });
  assert.equal(optedIn.promptSaved, true);
  assert.equal(optedIn.savedPrompt, 'OPTED_IN_TEXT');
  assert.equal(optedIn.category, 'edit');
  const duplicate = store.duplicate(optedIn.id, 'Explicit copy');
  assert.equal(duplicate.name, 'Explicit copy');
  assert.equal(duplicate.promptSaved, true);
  assert.equal(duplicate.savedPrompt, 'OPTED_IN_TEXT');
  assert.deepEqual(duplicate.tags, ['retained']);
  const imported = store.importLegacyStyles([{ name: 'Legacy style',
    parameters: { steps: 24, prompt: 'IMPORT_PRIVATE_TOP_LEVEL' }, target: 'sd15' }]);
  assert.equal(imported.importedCount, 1);
  const reopened = createRecipeStore(file);
  assert.equal(reopened.count(), 4);
  assert.equal(reopened.get(out.id).promptSaved, false);
  assert.equal(reopened.get(optedIn.id).savedPrompt, 'OPTED_IN_TEXT');
  assert.equal(reopened.get(duplicate.id).savedPrompt, 'OPTED_IN_TEXT');
  assert.equal(reopened.list().find(r => r.name === 'Legacy style').parameters.prompt, undefined);
  const finalBytes = fs.readFileSync(file, 'utf8');
  assert.ok(finalBytes.includes('OPTED_IN_TEXT'));
  assert.ok(!finalBytes.includes('IMPORT_PRIVATE_TOP_LEVEL'));
  assert.equal(JSON.parse(finalBytes).version, SCHEMA_VERSION);
});
