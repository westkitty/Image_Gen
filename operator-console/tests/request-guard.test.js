'use strict';
// Host / Origin / X-Dex-Request / content-type guard for Chat routes (contract E.5, C-17).
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { createRequestGuard, defaultPolicy } = require('../request-guard');

async function boot() {
  const app = express(); app.use(express.json());
  const guard = createRequestGuard(defaultPolicy(31337));
  app.get('/x', guard, (req, res) => res.json({ ok: true }));
  app.post('/x', guard, (req, res) => res.json({ ok: true }));
  app.delete('/x', guard, (req, res) => res.status(204).end());
  const server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  // Raw http.request so the Host header can be spoofed.
  const call = (method, headers, body) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.address().port, path: '/x', method, headers }, res => {
      let data = ''; res.on('data', c => { data += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data ? JSON.parse(data) : null }));
    });
    req.on('error', reject); if (body) req.write(body); req.end();
  });
  return { call, close: () => server.close() };
}
const good = { Host: '127.0.0.1:31337', Origin: 'http://127.0.0.1:31337', 'X-Dex-Request': '1', 'Content-Type': 'application/json' };

test('allowed loopback and tailnet requests pass with no CORS headers', async () => {
  const g = await boot(); try {
    for (const [host, origin] of [['127.0.0.1:31337', 'http://127.0.0.1:31337'], ['localhost:31337', 'http://localhost:31337'], ['macbook-air.tailafb7e8.ts.net', 'https://macbook-air.tailafb7e8.ts.net'], ['macbook-air.tailafb7e8.ts.net:8443', 'https://macbook-air.tailafb7e8.ts.net:8443']]) {
      const r = await g.call('POST', Object.assign({}, good, { Host: host, Origin: origin }), '{}');
      assert.equal(r.status, 200, host);
      assert.ok(!Object.keys(r.headers).some(h => h.startsWith('access-control-')));
    }
    assert.equal((await g.call('GET', { Host: '127.0.0.1:31337' })).status, 200);
    assert.equal((await g.call('DELETE', { Host: '127.0.0.1:31337', Origin: 'http://127.0.0.1:31337', 'X-Dex-Request': '1' })).status, 204);
  } finally { g.close(); }
});

test('foreign Host (DNS rebinding) is refused, including for GET', async () => {
  const g = await boot(); try {
    for (const host of ['evil.example:31337', '127.0.0.1:8080', '127.0.0.1', 'macbook-air.tailafb7e8.ts.net.evil.example']) {
      assert.deepEqual(await g.call('GET', { Host: host }).then(r => [r.status, r.body]), [403, { error: 'host-not-allowed' }], host);
    }
  } finally { g.close(); }
});

test('state-changing requests need an allowed Origin, X-Dex-Request: 1 and JSON', async () => {
  const g = await boot(); try {
    const without = k => Object.fromEntries(Object.entries(good).filter(([h]) => h !== k));
    assert.deepEqual((await g.call('POST', without('Origin'), '{}')).body, { error: 'origin-not-allowed' });
    assert.deepEqual((await g.call('POST', Object.assign({}, good, { Origin: 'https://evil.example' }), '{}')).body, { error: 'origin-not-allowed' });
    assert.deepEqual((await g.call('POST', Object.assign({}, good, { Origin: 'null' }), '{}')).body, { error: 'origin-not-allowed' });
    assert.deepEqual((await g.call('POST', without('X-Dex-Request'), '{}')).body, { error: 'request-header-required' });
    assert.deepEqual((await g.call('POST', Object.assign({}, good, { 'X-Dex-Request': 'true' }), '{}')).body, { error: 'request-header-required' });
    const plain = await g.call('POST', Object.assign({}, good, { 'Content-Type': 'text/plain' }), '{}');
    assert.deepEqual([plain.status, plain.body], [415, { error: 'content-type-not-allowed' }]);
    assert.equal((await g.call('POST', Object.assign({}, good, { 'Content-Type': 'application/json; charset=utf-8' }), '{}')).status, 200);
    assert.equal((await g.call('DELETE', { Host: '127.0.0.1:31337', 'X-Dex-Request': '1' })).status, 403);
  } finally { g.close(); }
});
