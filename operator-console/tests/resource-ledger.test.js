'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createCollectionStore } = require('../collections-store');
const { createRecipeStore } = require('../recipes-store');
const { createMacroStore } = require('../macro-store');
const { createStylesStore } = require('../styles-store');

test('creative stores preserve corrupt ledgers and roll back failed writes', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-resource-ledger-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const domains = {
    collections: [createCollectionStore, {}],
    recipes: [createRecipeStore, { parameters: { seed: 42, prompt: 'private fixture' } }],
    macros: [createMacroStore, { steps: [{ type: 'generate' }] }],
    styles: [createStylesStore, { prompt: 'sketch' }],
  };
  const error = { code: 'resource-storage-unavailable' };
  for (const [name, [open, fields]] of Object.entries(domains)) {
    const file = path.join(root, name + '.json');
    const store = open(file);
    const saved = store.create({ name: 'Kept', ...fields });
    const prior = fs.readFileSync(file, 'utf8');
    fs.renameSync(file, file + '.backup');
    fs.mkdirSync(file);
    assert.throws(() => store.create({ name: 'Failed', ...fields }), error);
    assert.throws(() => store.update(saved.id, { name: 'Failed' }), error);
    assert.throws(() => store.remove(saved.id), error);
    assert.deepEqual(store.list().map(item => item.name), ['Kept']);
    assert.equal(fs.readFileSync(file + '.backup', 'utf8'), prior);
    fs.rmdirSync(file);
    fs.renameSync(file + '.backup', file);
    assert.equal(open(file).get(saved.id).name, 'Kept');
    if (name === 'recipes') assert.ok(!prior.includes('private fixture'));

    fs.writeFileSync(file, '{ damaged');
    const blocked = open(file);
    assert.throws(() => blocked.list(), error);
    assert.throws(() => blocked.create({ name: 'Failed', ...fields }), error);
    assert.equal(fs.readFileSync(file, 'utf8'), '{ damaged');
  }
});
