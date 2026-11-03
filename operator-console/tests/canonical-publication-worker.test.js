'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { run } = require('../bin/canonical-publication-worker');
const { createPublicationOutbox } = require('../publication-outbox');

const bytes = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), Buffer.from('fixture image bytes')]);
function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-pub-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const destination = path.join(root, 'canonical'), receipts = path.join(root, 'receipts');
  const id = '20261102-132126-fixture.png', sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  let ackCount = 0;
  const transport = async (method, url, body) => {
    if (method === 'GET' && url.startsWith('/api/publications/pending')) return { bytes: Buffer.from(JSON.stringify({ items: [{ image_id: id, expected_bytes: bytes.length, sha256, state: 'PUBLICATION_PENDING' }] })) };
    if (method === 'GET' && url.endsWith('/content')) {
      if (options.offline || options.dropContent) throw new Error(options.offline ? 'offline' : 'connection dropped');
      return { bytes: options.badDigest ? Buffer.from('tampered') : bytes };
    }
    if (method === 'POST' && url.endsWith('/ack')) { ackCount++; if (options.loseAck && ackCount === 1) throw new Error('ack lost'); return { bytes: Buffer.from('{}') }; }
    if (method === 'POST' && url.endsWith('/failure')) return { bytes: Buffer.from('{}') };
    throw new Error(`unexpected transport ${method} ${url}`);
  };
  return { root, destination, receipts, id, sha256, transport, get ackCount() { return ackCount; } };
}

test('successful transfer commits exact bytes, durable receipt, then acknowledgment', async t => {
  const f = fixture(t); const result = await run({ destination: f.destination, receipts: f.receipts, transport: f.transport });
  assert.equal(result[0].state, 'CANONICAL_VERIFIED');
  assert.deepEqual(fs.readFileSync(path.join(f.destination, f.id)), bytes);
  const receipt = JSON.parse(fs.readFileSync(fs.readdirSync(f.receipts).map(n => path.join(f.receipts,n))[0]));
  assert.equal(receipt.sha256, f.sha256); assert.equal(receipt.bytes, bytes.length); assert.equal(f.ackCount, 1);
});

for (const [name, opts] of [['MacBook offline', { offline: true }], ['connection drops during transfer', { dropContent: true }], ['digest mismatch', { badDigest: true }]]) {
  test(`${name} leaves no canonical success and is retryable`, async t => {
    const f = fixture(t, opts); const result = await run({ destination: f.destination, receipts: f.receipts, transport: f.transport });
    assert.equal(result[0].state, 'PUBLICATION_FAILED_RETRYABLE'); assert.equal(fs.existsSync(path.join(f.destination, f.id)), false); assert.equal(f.ackCount, 0);
  });
}

test('existing filename with different bytes is preserved as a conflict', async t => {
  const f = fixture(t); fs.mkdirSync(f.destination, { recursive: true }); const target = path.join(f.destination, f.id); fs.writeFileSync(target, 'owner data');
  const result = await run({ destination: f.destination, receipts: f.receipts, transport: f.transport });
  assert.equal(result[0].state, 'PUBLICATION_FAILED_RETRYABLE'); assert.equal(fs.readFileSync(target, 'utf8'), 'owner data'); assert.equal(f.ackCount, 0);
});

test('lost acknowledgment retries from canonical bytes and local receipt', async t => {
  const f = fixture(t, { loseAck: true }); const first = await run({ destination: f.destination, receipts: f.receipts, transport: f.transport });
  assert.equal(first[0].state, 'PUBLICATION_FAILED_RETRYABLE'); assert.deepEqual(fs.readFileSync(path.join(f.destination, f.id)), bytes);
  const second = await run({ destination: f.destination, receipts: f.receipts, transport: f.transport });
  assert.equal(second[0].state, 'CANONICAL_VERIFIED'); assert.equal(f.ackCount, 2);
});

test('crash before finalization leaves no destination; subsequent run resumes', async t => {
  const f = fixture(t, { dropContent: true }); await run({ destination: f.destination, receipts: f.receipts, transport: f.transport });
  assert.equal(fs.existsSync(path.join(f.destination, f.id)), false);
  const resumed = await run({ destination: f.destination, receipts: f.receipts, transport: fixture(t).transport });
  assert.equal(resumed[0].state, 'CANONICAL_VERIFIED');
});

test('finalized but unacknowledged artifact is acknowledged after process restart', async t => {
  const f = fixture(t, { loseAck: true }); await run({ destination: f.destination, receipts: f.receipts, transport: f.transport });
  const resumed = await run({ destination: f.destination, receipts: f.receipts, transport: f.transport });
  assert.equal(resumed[0].state, 'CANONICAL_VERIFIED'); assert.ok(fs.readdirSync(f.receipts).length === 1);
});

test('two workers for one artifact converge without replacing bytes', async t => {
  const f = fixture(t); const opts = { destination: f.destination, receipts: f.receipts, transport: f.transport };
  const results = await Promise.all([run(opts), run(opts)]);
  assert.ok(results.every(r => r[0].state === 'CANONICAL_VERIFIED'));
  assert.deepEqual(fs.readFileSync(path.join(f.destination, f.id)), bytes);
});

test('invalid artifact path and symlink destination are rejected', async t => {
  const f = fixture(t); fs.mkdirSync(f.destination, { recursive: true }); const target = path.join(f.destination, f.id), elsewhere = path.join(f.root, 'elsewhere'); fs.writeFileSync(elsewhere, 'protected'); fs.symlinkSync(elsewhere, target);
  const badPath = { ...f.transport, bytes: f.transport.bytes };
  const result = await run({ destination: f.destination, receipts: f.receipts, transport: async (method, url, body) => {
    if (method === 'GET' && url.startsWith('/api/publications/pending')) return { bytes: Buffer.from(JSON.stringify({ items: [{ image_id: '../escape.png', expected_bytes: bytes.length, sha256: f.sha256 }] })) };
    return badPath(method, url, body);
  } });
  assert.equal(result[0].state, 'PUBLICATION_BLOCKED'); assert.equal(fs.readFileSync(elsewhere, 'utf8'), 'protected');
  const symlinkResult = await run({ destination: f.destination, receipts: f.receipts, transport: f.transport });
  assert.equal(symlinkResult[0].state, 'PUBLICATION_FAILED_RETRYABLE'); assert.equal(fs.readFileSync(elsewhere, 'utf8'), 'protected');
});

test('durable Big Mac outbox preserves source bytes and records immutable identity', t => {
  const f = fixture(t), source = path.join(f.root, 'remote.png'), state = path.join(f.root, 'state'); fs.writeFileSync(source, bytes);
  const outbox = createPublicationOutbox(state), record = outbox.create({ image_id: f.id, run_id: 'run', run_file: 'source.png', bytes: bytes.length, sha256: f.sha256 }, source);
  assert.equal(record.state, 'PUBLICATION_PENDING'); assert.deepEqual(fs.readFileSync(source), bytes); assert.equal(outbox.read(f.id).sha256, f.sha256);
});

test('transfer failure keeps the durable Big Mac source and pending outbox record', async t => {
  const f = fixture(t, { offline: true }), source = path.join(f.root, 'remote.png'), state = path.join(f.root, 'state');
  fs.writeFileSync(source, bytes); const outbox = createPublicationOutbox(state);
  outbox.create({ image_id: f.id, run_id: 'run', run_file: 'source.png', bytes: bytes.length, sha256: f.sha256 }, source);
  const result = await run({ destination: f.destination, receipts: f.receipts, transport: f.transport });
  assert.equal(result[0].state, 'PUBLICATION_FAILED_RETRYABLE');
  assert.deepEqual(fs.readFileSync(source), bytes); assert.equal(outbox.read(f.id).state, 'PUBLICATION_PENDING');
});
