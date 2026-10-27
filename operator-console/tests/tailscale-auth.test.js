'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const {
  createTailscaleAuthGate,
  isAuthorizedTailscaleUser,
  isTailscaleHost,
} = require('../tailscale-auth');

async function boot(gate) {
  const app = express();
  app.use(express.json());
  app.use(gate);
  app.get('/test', (req, res) => res.json({ ok: true, user: req.headers['tailscale-user-login'] || null }));
  app.post('/test', (req, res) => res.json({ ok: true, received: req.body }));

  const server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const call = (method, path, headers = {}, body = null) => new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: server.address().port,
      path,
      method,
      headers,
    }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: data ? JSON.parse(data) : null,
      }));
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });

  return { call, close: () => server.close() };
}

test('isAuthorizedTailscaleUser validates authorized logins', () => {
  assert.equal(isAuthorizedTailscaleUser('westkitty@github'), true);
  assert.equal(isAuthorizedTailscaleUser('westkitty@gmail.com'), true);
  assert.equal(isAuthorizedTailscaleUser('westkitty'), true);
  assert.equal(isAuthorizedTailscaleUser('WESTKITTY@GITHUB'), true);

  assert.equal(isAuthorizedTailscaleUser('bcroc@github'), false);
  assert.equal(isAuthorizedTailscaleUser('bcroc@gmail.com'), false);
  assert.equal(isAuthorizedTailscaleUser('bcroc'), false);
  assert.equal(isAuthorizedTailscaleUser('attacker@evil.com'), false);
  assert.equal(isAuthorizedTailscaleUser('westkittyfake@gmail.com'), false);
  assert.equal(isAuthorizedTailscaleUser(''), false);
  assert.equal(isAuthorizedTailscaleUser(null), false);
});

test('isTailscaleHost identifies ts.net hosts', () => {
  assert.equal(isTailscaleHost('bigmac.tailafb7e8.ts.net:11443'), true);
  assert.equal(isTailscaleHost('bigmac.tailafb7e8.ts.net'), true);
  assert.equal(isTailscaleHost('macbook-air.tailafb7e8.ts.net:8443'), true);
  assert.equal(isTailscaleHost('other.ts.net'), true);
  assert.equal(isTailscaleHost('127.0.0.1:31337'), false);
  assert.equal(isTailscaleHost('localhost:31337'), false);
  assert.equal(isTailscaleHost(''), false);
});

test('tailscaleAuthGate allows loopback requests without tailscale headers', async () => {
  const gate = createTailscaleAuthGate();
  const server = await boot(gate);
  try {
    const res = await server.call('GET', '/test', { Host: '127.0.0.1:31337' });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
  } finally {
    server.close();
  }
});

test('tailscaleAuthGate allows authorized westkitty tailnet user', async () => {
  const gate = createTailscaleAuthGate();
  const server = await boot(gate);
  try {
    const res = await server.call('GET', '/test', {
      Host: 'bigmac.tailafb7e8.ts.net:11443',
      'Tailscale-User-Login': 'westkitty@github',
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.user, 'westkitty@github');
  } finally {
    server.close();
  }
});

test('tailscaleAuthGate blocks unauthorized bcroc tailnet user with 403', async () => {
  const gate = createTailscaleAuthGate();
  const server = await boot(gate);
  try {
    const res = await server.call('GET', '/test', {
      Host: 'bigmac.tailafb7e8.ts.net:11443',
      'Tailscale-User-Login': 'bcroc@github',
    });
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'unauthorized-tailnet-user');
  } finally {
    server.close();
  }
});

test('tailscaleAuthGate blocks Tailscale host request without login header', async () => {
  const gate = createTailscaleAuthGate();
  const server = await boot(gate);
  try {
    const res = await server.call('GET', '/test', {
      Host: 'bigmac.tailafb7e8.ts.net:11443',
    });
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'unauthorized-tailnet-user');
  } finally {
    server.close();
  }
});

test('tailscaleAuthGate blocks unauthorized login even on loopback host', async () => {
  const gate = createTailscaleAuthGate();
  const server = await boot(gate);
  try {
    const res = await server.call('GET', '/test', {
      Host: '127.0.0.1:31337',
      'Tailscale-User-Login': 'bcroc@github',
    });
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'unauthorized-tailnet-user');
  } finally {
    server.close();
  }
});

test('DEX_AUTHORIZED_TAILSCALE_USERS environment variable customizes permitted logins', async () => {
  const orig = process.env.DEX_AUTHORIZED_TAILSCALE_USERS;
  try {
    process.env.DEX_AUTHORIZED_TAILSCALE_USERS = 'customuser,admin@example.com';
    const gate = createTailscaleAuthGate();
    const server = await boot(gate);
    try {
      const resAllowed = await server.call('GET', '/test', {
        Host: 'bigmac.tailafb7e8.ts.net:11443',
        'Tailscale-User-Login': 'customuser@tailnet',
      });
      assert.equal(resAllowed.status, 200);

      const resDenied = await server.call('GET', '/test', {
        Host: 'bigmac.tailafb7e8.ts.net:11443',
        'Tailscale-User-Login': 'westkitty@github',
      });
      assert.equal(resDenied.status, 403);
    } finally {
      server.close();
    }
  } finally {
    if (orig !== undefined) process.env.DEX_AUTHORIZED_TAILSCALE_USERS = orig;
    else delete process.env.DEX_AUTHORIZED_TAILSCALE_USERS;
  }
});
