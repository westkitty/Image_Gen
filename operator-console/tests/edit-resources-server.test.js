'use strict';
// Structured resources reach the backend only through server-side serialization.
// Spawns the console on a private port; nothing here contacts Big Mac or starts a job.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./browser/helpers');

let srv;
test.before(async () => { srv = await startServer(31921); });
test.after(() => srv && srv.stop());

const post = (route, body) => fetch(srv.base + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(async r => ({ status: r.status, data: await r.json() }));

test('controlled generate: structured loras are serialized then validated against the discovered allowlist', async () => {
  const r = await post('/api/actions/generate-controlled', { target: 'sd15', prompt: 'a cat', loras: [{ name: 'definitely_not_installed', weight: 0.5 }], width: 512, height: 512, steps: 4, seed: 1 });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /LoRA "definitely_not_installed" is not in the discovered assets allowlist/);
});

test('malformed structured loras are rejected before anything runs', async () => {
  for (const loras of ['nope', [{ weight: 1 }], [{ name: '../x', weight: 1 }], [{ name: 'a', weight: 'x' }], Array.from({ length: 9 }, (_, i) => ({ name: 'l' + i, weight: 1 }))]) {
    const r = await post('/api/actions/generate-controlled', { target: 'sd15', prompt: 'a cat', loras });
    assert.equal(r.status, 400, JSON.stringify(loras));
    assert.match(r.data.error, /lora/i);
  }
});

test('edit routes validate the structured resource list before touching the source', async () => {
  for (const route of ['img2img', 'inpaint', 'outpaint']) {
    const r = await post('/api/actions/' + route, { image_id: 'nonexistent.png', prompt: 'x', loras: [{ name: '../evil', weight: 1 }], mask_data: 'x', left: 64 });
    assert.equal(r.status, 400, route);
    assert.equal(r.data.gate, 'resources');
    assert.match(r.data.error, /LoRA name/);
  }
});

test('image meta route returns the recall record shape', async () => {
  const r = await fetch(srv.base + '/api/images/does-not-exist.png/meta');
  assert.equal(r.status, 404);
});
