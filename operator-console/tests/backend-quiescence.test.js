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
