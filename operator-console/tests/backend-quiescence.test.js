'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { backendQuiescence } = require('../backend-quiescence');
const { createPublicationOutbox } = require('../publication-outbox');

function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-quiet-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('ingress invalidates the seal, and draining excludes new requests', t => {
  const root = temp(t);
  const idlePath = path.join(root, 'idle');
  let evidence = true;
  const quiescence = backendQuiescence(root, () => evidence);
  quiescence.checkpoint();
  assert.equal(fs.readFileSync(idlePath, 'utf8'), process.pid + ' idle\n');
  const response = new EventEmitter();
  quiescence.middleware({ method: 'POST' }, response, () => assert.ok(!fs.existsSync(idlePath)));
  quiescence.checkpoint();
  assert.ok(!fs.existsSync(idlePath));
  response.emit('finish');
  evidence = false;
  quiescence.checkpoint();
  assert.ok(!fs.existsSync(idlePath));
  evidence = true;
  fs.writeFileSync(path.join(root, 'drain'), '');
  quiescence.checkpoint();
  assert.equal(fs.readFileSync(idlePath, 'utf8'), process.pid + ' drained\n');
  quiescence.middleware({ method: 'POST' }, {
    status(code) { assert.equal(code, 503); return this; },
    json(body) { assert.match(body.error, /draining/); },
  }, () => assert.fail('work entered drained backend'));
});

test('an unreadable publication record cannot attest to idleness', t => {
  const root = temp(t);
  const outbox = createPublicationOutbox(root);
  assert.equal(outbox.pendingStrict(), false);
  fs.writeFileSync(path.join(root, 'f'.repeat(64) + '.json'), '{');
  assert.throws(() => outbox.pendingStrict(), SyntaxError);
});

test('shared-disk reserve matches the worker formula and keeps the 16-image limit for large or unknown work', () => {
  const { sharedDiskReserveBytes } = require('../backend-quiescence');
  const MiB = 1024 ** 2;
  assert.equal(sharedDiskReserveBytes('controlled-generate', { quantity: 1 }), 1536 * MiB);
  assert.equal(sharedDiskReserveBytes('controlled-generate', { quantity: 4 }), 2304 * MiB);
  for (const [action, params] of [['controlled-generate', { quantity: 16 }], ['controlled-generate', { quantity: 100 }],
    ['controlled-generate', {}], ['controlled-generate', { quantity: '1' }], ['controlled-generate', { quantity: 0 }],
    ['upscale', { quantity: 1 }], ['xyz-plot', { quantity: 1 }], ['img2img', undefined]]) {
    assert.equal(sharedDiskReserveBytes(action, params), (5 * 1024 + 256) * MiB, action + ' ' + JSON.stringify(params));
  }
  const server = require('node:fs').readFileSync(require('node:path').join(__dirname, '../server.js'), 'utf8');
  assert.ok(server.includes("sharedDiskReserveBytes(action, requestParams)"));
  assert.ok(!server.includes('(5 * 1024 + 256) * 1024 ** 2'));
});
