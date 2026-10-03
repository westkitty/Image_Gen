'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const W = require('../workstation');

const FIXTURE = fs.readFileSync(path.join(__dirname, 'fixtures', 'starsilk-batch.txt'), 'utf8');
const TITLES = [
  'Shard-God Tiger — The Great Unmaking', 'The Siege Wall', 'Codec — Systems Architect', 'A Drakken Terraforming',
  'Blood Ring', 'Kail — The Black-Hole Mouth', 'The Star Dive', 'The Starbinding', 'Torture — The Impossible Sword',
  'The Aureal Gate Heliocide',
];

// ---- Batch parser -----------------------------------------------------------
test('parser: exact ten-entry fixture, titles preserved, no warnings', () => {
  const r = W.parseNumberedPrompts(FIXTURE);
  assert.equal(r.ok, true, r.errors.join('; '));
  assert.equal(r.entries.length, 10);
  assert.deepEqual(r.entries.map(e => e.title), TITLES);
  assert.deepEqual(r.entries.map(e => e.number), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(r.warnings, []);
});

test('parser: multiline bodies, Unicode and punctuation survive; titles not in prompt', () => {
  const r = W.parseNumberedPrompts(FIXTURE);
  const first = r.entries[0].prompt;
  assert.ok(first.startsWith('A cinematic full-body portrait of Shard-God Tiger'));
  assert.equal(first.split('\n').length, 3);
  assert.ok(first.endsWith('no chaotic magic effects, no text.'));
  assert.ok(!first.includes('The Great Unmaking'));
  assert.ok(r.entries[8].prompt.includes('luminous data — abstract broken'));
  assert.ok(r.entries[8].prompt.includes("weapon's structure"));
  assert.ok(r.entries[1].prompt.includes('widescreen 16:9'));
  assert.ok(r.entries[9].prompt.endsWith('no chaotic spell effects, no text.'));
  // total body text is preserved exactly (no prompt text lost)
  for (const e of r.entries) assert.ok(FIXTURE.includes(e.prompt));
});

test('parser: 10 / 11 / 100 numbering, numbers inside prose, blank lines', () => {
  const text = '10. Ten\n\nbody ten has 3. items and 2024. numbers\nstill ten\n\n\n11. Eleven\n\nline one\n12. not a header (no blank line before)\n\n100. Hundred\n\nhundred body\n';
  const r = W.parseNumberedPrompts(text);
  assert.deepEqual(r.entries.map(e => e.number), [10, 11, 100]);
  assert.equal(r.entries[0].prompt, 'body ten has 3. items and 2024. numbers\nstill ten');
  assert.equal(r.entries[1].prompt, 'line one\n12. not a header (no blank line before)');
  assert.equal(r.entries[2].prompt, 'hundred body');
  assert.ok(r.warnings.some(w => /11 to 100/.test(w)));
});

test('parser: skipped numbering warns and keeps every entry', () => {
  const r = W.parseNumberedPrompts('1. A\n\na\n\n3. C\n\nc\n');
  assert.equal(r.ok, true);
  assert.equal(r.entries.length, 2);
  assert.ok(r.warnings.some(w => /jumps from 1 to 3/.test(w)));
});

test('parser: duplicate numbering warns and keeps distinguishable entries', () => {
  const r = W.parseNumberedPrompts('1. A\n\nfirst\n\n1. B\n\nsecond\n');
  assert.equal(r.entries.length, 2);
  assert.deepEqual(r.entries.map(e => [e.index, e.title, e.prompt]), [[0, 'A', 'first'], [1, 'B', 'second']]);
  assert.ok(r.warnings.some(w => /Duplicate number 1/.test(w)));
});

test('parser: empty and malformed input fail clearly', () => {
  assert.equal(W.parseNumberedPrompts('').ok, false);
  assert.match(W.parseNumberedPrompts('   \n\n').errors[0], /No numbered prompts/);
  const pre = W.parseNumberedPrompts('stray text\n\n1. A\n\nbody\n');
  assert.equal(pre.ok, false);
  assert.match(pre.errors[0], /before the first numbered entry/);
  const noBody = W.parseNumberedPrompts('1. A\n\n2. B\n\nbody\n');
  assert.equal(noBody.ok, false);
  assert.match(noBody.errors[0], /Entry 1 .* no prompt text/);
  const noTitle = W.parseNumberedPrompts('1.\n\nbody\n');
  assert.equal(noTitle.ok, false);
  assert.match(noTitle.errors.join(' '), /has no title/);
});

// ---- Seeds ------------------------------------------------------------------
test('seeds: fixed seed increments; random seeds are non-negative and per image', () => {
  assert.deepEqual(W.planSeeds(41, 3), [41, 42, 43]);
  assert.deepEqual(W.planSeeds('7', 1), [7]);
  let n = 100;
  const seq = W.planSeeds(-1, 3, { rand: () => (n += 11) });
  assert.deepEqual(seq, [111, 122, 133]);
  const cons = W.planSeeds('', 3, { consecutive: true, rand: () => 500 });
  assert.deepEqual(cons, [500, 501, 502]);
  for (const s of W.planSeeds(-1, 20)) assert.ok(Number.isInteger(s) && s >= 0);
  assert.throws(() => W.planSeeds(W.MAX_SEED, 2));
});

test('seed lab neighbours never go negative', () => {
  assert.deepEqual(W.neighborSeeds(10), [8, 9, 10, 11, 12]);
  assert.deepEqual(W.neighborSeeds(1), [0, 1, 2, 3]);
  assert.deepEqual(W.neighborSeeds(-1), []);
});

// ---- Recipes / privacy --------------------------------------------------------
test('recipes never persist prompt text when save_prompts is false', () => {
  const src = { name: 'r', target: 'sd15', width: 512, steps: 20, cfg: 7, prompt: 'secret', negPrompt: 'hidden', unknown: 'x' };
  const off = W.sanitizeRecipe(src, false);
  assert.equal(off.prompt, undefined);
  assert.equal(off.negPrompt, undefined);
  assert.equal(off.unknown, undefined);
  assert.equal(off.target, 'sd15');
  assert.ok(!JSON.stringify(off).includes('secret'));
  const on = W.sanitizeRecipe(src, true);
  assert.equal(on.prompt, 'secret');
});

// ---- Lineage / keepers -------------------------------------------------------
function tmpStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-meta-'));
  return { dir, store: W.createImageMetaStore(path.join(dir, 'image-meta.json')) };
}

test('lineage: parent reference, child lookup, ancestors, legacy image', () => {
  const { dir, store } = tmpStore();
  store.record('a.png', { operation: 'txt2img', runId: 'r1', seed: 5, prompt: 'SECRET' });
  store.record('b.png', { operation: 'img2img', parent: 'a.png', runId: 'r2' });
  store.record('c.png', { operation: 'inpaint', parent: 'b.png', runId: 'r3' });
  assert.equal(store.get('b.png').parent, 'a.png');
  assert.deepEqual(store.children('a.png'), ['b.png']);
  assert.deepEqual(store.ancestors('c.png'), ['b.png', 'a.png']);
  assert.equal(store.get('legacy.png'), null);
  assert.deepEqual(store.children('legacy.png'), []);
  const raw = fs.readFileSync(store.file, 'utf8');
  assert.ok(!raw.includes('SECRET'), 'lineage never stores prompts');
  // metadata only: nothing but the JSON file exists
  assert.deepEqual(fs.readdirSync(dir), ['image-meta.json']);
});

test('generation record: prompt text is stored only when prompt_saved is true; structured settings always', () => {
  const { store } = tmpStore();
  store.record('p.png', { operation: 'txt2img', target: 'sd15', sampler: 'euler_a', vae: 'auto', loras: [{ name: 'a', weight: 0.5 }], gen_schema: 1, prompt_saved: false, prompt: 'SECRET-OFF', negative_prompt: 'NEG-OFF' });
  const off = store.get('p.png');
  assert.equal(off.prompt, undefined); assert.equal(off.negative_prompt, undefined);
  assert.deepEqual([off.sampler, off.vae, off.loras, off.prompt_saved], ['euler_a', 'auto', [{ name: 'a', weight: 0.5 }], false]);
  store.record('q.png', { operation: 'txt2img', prompt_saved: true, prompt: 'visible', negative_prompt: 'n' });
  assert.deepEqual([store.get('q.png').prompt, store.get('q.png').negative_prompt], ['visible', 'n']);
});

test('keepers: add/remove is metadata only', () => {
  const { dir, store } = tmpStore();
  assert.equal(store.setKeeper('x.png', true), true);
  assert.deepEqual(store.keepers(), ['x.png']);
  assert.equal(store.setKeeper('x.png', false), false);
  assert.deepEqual(store.keepers(), []);
  assert.deepEqual(fs.readdirSync(dir), ['image-meta.json']);
});

// ---- Queue --------------------------------------------------------------------
function waitFor(fn, ms = 2000) {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => { const v = fn(); if (v) return resolve(v); if (Date.now() - t0 > ms) return reject(new Error('timeout')); setTimeout(tick, 5); };
    tick();
  });
}
const entries = n => Array.from({ length: n }, (_, i) => ({ number: i + 1, title: 'T' + (i + 1), prompt: 'P' + (i + 1) }));

test('queue: ordered execution, failure isolation, completed items preserved, Retry Failed', async () => {
  const order = [];
  let failOnce = true;
  const runner = W.createQueueRunner({
    runItem: async (it, prompt) => {
      order.push(prompt);
      if (it.number === 2 && failOnce) { failOnce = false; return { ok: false, error: 'boom', gate: 'remote-png' }; }
      return { ok: true, results: [{ imageId: 'img' + it.number }], seeds: [it.number] };
    },
  });
  const q = runner.create({ entries: entries(3), settings: { target: 'sd15' } });
  assert.equal(q.items[0].prompt, undefined, 'queue view never exposes prompt text');
  const done = await waitFor(() => { const v = runner.get(q.id); return v.status === 'DONE' && v; });
  assert.deepEqual(order, ['P1', 'P2', 'P3']);
  assert.deepEqual(done.items.map(i => i.status), ['DONE', 'FAILED', 'DONE']);
  assert.equal(done.items[1].gate, 'remote-png');
  assert.equal(done.complete, 2);
  runner.retryFailed(q.id);
  const again = await waitFor(() => { const v = runner.get(q.id); return v.status === 'DONE' && v.items[1].status === 'DONE' && v; });
  assert.deepEqual(order, ['P1', 'P2', 'P3', 'P2'], 'retry reruns only the failed item');
  assert.equal(again.items[0].attempts, 1);
});

test('queue: Stop After Current, remove and reorder QUEUED items', async () => {
  let release;
  const order = [];
  const runner = W.createQueueRunner({
    runItem: (it, prompt) => { order.push(prompt); return new Promise(r => { release = () => r({ ok: true }); }); },
  });
  const q = runner.create({ entries: entries(4) });
  await waitFor(() => release);
  assert.equal(runner.moveItem(q.id, 0, 'down').error, 'Only QUEUED items can be reordered.');
  runner.moveItem(q.id, 3, 'up'); // [1, 2, 4, 3]
  assert.deepEqual(runner.removeItem(q.id, 1).items.map(i => i.status), ['RUNNING', 'SKIPPED', 'QUEUED', 'QUEUED']);
  runner.stopAfterCurrent(q.id);
  release();
  const stopped = await waitFor(() => { const v = runner.get(q.id); return v.status === 'STOPPED' && v; });
  assert.deepEqual(order, ['P1']);
  assert.deepEqual(stopped.items.map(i => [i.number, i.status]), [[1, 'DONE'], [2, 'SKIPPED'], [4, 'QUEUED'], [3, 'QUEUED']]);
  release = null;
  runner.resume(q.id);
  await waitFor(() => release); release(); release = null;
  await waitFor(() => release); release();
  await waitFor(() => runner.get(q.id).status === 'DONE');
  assert.deepEqual(order, ['P1', 'P4', 'P3']);
});

// ---- Durable queue state ------------------------------------------------------
test('queue persistence: atomic file, no prompts when prompt saving is off, restart reconciliation', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-q-'));
  const file = path.join(dir, 'queues.json');
  let release;
  const order = [];
  const runItem = (it, prompt) => { order.push(prompt); return new Promise(r => { release = () => r({ ok: true, results: [{ imageId: 'i' + it.number }], seeds: [it.number] }); }); };
  const r1 = W.createQueueRunner({ file, runItem });
  const q = r1.create({ entries: entries(3).map(e => ({ ...e, prompt: 'CANARY-' + e.prompt })), settings: { target: 'sd15', save_prompts: false, private: { negative_prompt: 'CANARY-NEG' } } });
  await waitFor(() => release); release(); release = null;
  await waitFor(() => r1.get(q.id).items[1].status === 'RUNNING');
  const raw = fs.readFileSync(file, 'utf8');
  assert.ok(!raw.includes('CANARY'), 'no prompt or negative prompt in durable queue state');
  assert.deepEqual(fs.readdirSync(dir), ['queues.json'], 'no temp files left');
  // Simulated console restart while item 2 is RUNNING
  const order2 = [];
  const r2 = W.createQueueRunner({ file, runItem: async (it, prompt) => { order2.push(prompt); return { ok: true, results: [] }; } });
  const v = r2.get(q.id);
  assert.equal(v.restored, true);
  assert.equal(v.status, 'STOPPED');
  assert.deepEqual(v.items.map(i => i.status), ['DONE', 'INTERRUPTED', 'QUEUED']);
  assert.equal(v.items[1].gate, 'server-restart');
  assert.deepEqual(v.items[0].results, [{ imageId: 'i1' }]);
  assert.equal(v.promptsMissing, true);
  assert.equal(r2.resume(q.id).promptsMissing, true, 'cannot resume without the prompt text');
  r2.retryFailed(q.id, [{ queueIndex: 1, prompt: 'P2' }, { queueIndex: 2, prompt: 'P3' }]);
  await waitFor(() => r2.get(q.id).status === 'DONE');
  assert.deepEqual(order2, ['P2', 'P3'], 'completed item 1 never reruns');
});

test('queue persistence keeps prompts only when prompt saving is on', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-q-'));
  const file = path.join(dir, 'queues.json');
  const r = W.createQueueRunner({ file, runItem: () => new Promise(() => {}) });
  r.create({ entries: entries(1), settings: { save_prompts: true, private: { negative_prompt: 'NEG' } } });
  const raw = fs.readFileSync(file, 'utf8');
  assert.ok(raw.includes('"prompt": "P1"') && raw.includes('NEG'));
});
