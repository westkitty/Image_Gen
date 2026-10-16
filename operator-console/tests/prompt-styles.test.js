'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const S = require('../public/dexdiffusion/prompt-styles.js');
const { createStylesStore } = require('../styles-store');

test('golden (A1111 apply_styles_to_prompt): placeholder, append, empty prompt, order', () => {
  assert.equal(S.applyTemplate('masterpiece, {prompt}, 8k', 'a fox'), 'masterpiece, a fox, 8k');
  assert.equal(S.applyTemplate('cinematic lighting', 'a fox'), 'a fox, cinematic lighting');
  assert.equal(S.applyTemplate('cinematic lighting', ''), 'cinematic lighting');
  assert.equal(S.applyTemplate('', 'a fox'), 'a fox');
  assert.equal(S.applyTemplate('{prompt} and {prompt}', 'x'), 'x and x', 'every placeholder is replaced');
  const out = S.applyStyles([{ prompt: 'A, {prompt}', negative_prompt: 'bad' }, { prompt: 'B', negative_prompt: 'worse' }], 'fox', 'blurry');
  assert.deepEqual(out, { prompt: 'A, fox, B', negative_prompt: 'blurry, bad, worse' });
});

test('extractTemplate reverses apply for both forms and leaves foreign text alone', () => {
  for (const [tpl, text] of [['masterpiece, {prompt}, 8k', 'a fox'], ['cinematic', 'a fox']]) {
    assert.equal(S.extractTemplate(tpl, S.applyTemplate(tpl, text)), text);
  }
  assert.equal(S.extractTemplate('cinematic', 'unrelated prompt'), 'unrelated prompt');
});

test('validateStyle enforces name, content and size', () => {
  assert.equal(S.validateStyle({ name: 'Cinematic', prompt: 'x' }), null);
  assert.equal(S.validateStyle({ name: 'Neg only', negative_prompt: 'blurry' }), null);
  assert.match(S.validateStyle({ name: '  ', prompt: 'x' }), /name is required/);
  assert.match(S.validateStyle({ name: 'x'.repeat(61), prompt: 'x' }), /at most 60/);
  assert.match(S.validateStyle({ name: 'a\u0007b', prompt: 'x' }), /control characters/);
  assert.match(S.validateStyle({ name: 'Empty' }), /needs a prompt or a negative/);
  assert.match(S.validateStyle({ name: 'Big', prompt: 'x'.repeat(4001) }), /at most 4000/);
  assert.match(S.validateStyle({ name: 'N', prompt: 5 }), /must be text/);
});

function tmpStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-styles-'));
  const file = path.join(dir, 'styles.json');
  return { dir, file, store: createStylesStore(file) };
}

test('store: create, list sorted, get, case-insensitive unique names', () => {
  const { dir, store } = tmpStore();
  try {
    const b = store.create({ name: 'Beta', prompt: 'b' });
    const a = store.create({ name: 'alpha', prompt: 'a', negative_prompt: 'n' });
    assert.deepEqual(store.list().map(s => s.name), ['alpha', 'Beta']);
    assert.match(a.id, /^sty_[0-9a-f]{12}$/);
    assert.equal(store.get(b.id).prompt, 'b');
    assert.throws(() => store.create({ name: 'ALPHA', prompt: 'x' }), /already exists/);
    assert.throws(() => store.create({ name: '', prompt: 'x' }), /name is required/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('store: rename and edit keep the id, reject clashes, report unknown ids; delete removes', () => {
  const { dir, store } = tmpStore();
  try {
    const a = store.create({ name: 'One', prompt: 'a' });
    const b = store.create({ name: 'Two', prompt: 'b' });
    const r = store.update(a.id, { name: 'Uno' });
    assert.equal(r.id, a.id); assert.equal(r.name, 'Uno'); assert.equal(r.prompt, 'a');
    assert.equal(store.update(a.id, { prompt: 'edited', negative_prompt: 'neg' }).prompt, 'edited');
    assert.throws(() => store.update(a.id, { name: 'two' }), /already exists/);
    assert.equal(store.update(a.id, { name: 'Uno' }).name, 'Uno', 'keeping its own name is not a clash');
    assert.equal(store.update('sty_missing', { name: 'x' }), null);
    assert.equal(store.remove(b.id), true);
    assert.equal(store.remove(b.id), false);
    assert.deepEqual(store.list().map(s => s.name), ['Uno']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('store: persists atomically across instances, versioned, and survives a corrupt file', () => {
  const { dir, file, store } = tmpStore();
  try {
    store.create({ name: 'Keep', prompt: 'k', negative_prompt: 'n' });
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(raw.schema, 'dexdiffusion.styles.v1');
    assert.equal(fs.readdirSync(dir).some(f => f.includes('.tmp.')), false, 'no temp file left behind');
    assert.deepEqual(createStylesStore(file).list().map(s => s.name), ['Keep']);
    fs.writeFileSync(file, '{not json');
    const fresh = createStylesStore(file);
    assert.deepEqual(fresh.list(), []);
    assert.equal(fresh.create({ name: 'After', prompt: 'x' }).name, 'After');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
