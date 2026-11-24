'use strict';

// Preloaded only by the HTTP contract that drives its own fake Ollama listener.
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const path = require('node:path');
const { promisify } = require('node:util');
const isolation = require('../../test-isolation');

const env = process.env;
const fake = new URL(env.OLLAMA_BASE_URL);
assert.equal(fake.hostname, '127.0.0.1');
assert.match(fake.href, /^http:\/\/127\.0\.0\.1:\d+\/$/);
assert.ok(Number(fake.port) > 1024 && !['11434', '11435', '11436'].includes(fake.port), 'expected a private fake Ollama port');
assert.ok(isolation.enabled(), 'the console test guard must stay enabled');
assert.match(path.basename(env.DEX_FAKE_OLLAMA_ROOT), /^dex-ollama-legacy-/);
for (const [name, dir] of [
  ['DEX_STATE_DIR', 'state'],
  ['DEX_IMAGES_ROOT_OVERRIDE', 'images'],
  ['DEX_MEDIA_ROOT_OVERRIDE', 'media'],
  ['DEX_SCRATCH_ROOT', 'scratch'],
]) assert.equal(env[name], path.join(env.DEX_FAKE_OLLAMA_ROOT, dir));

isolation.install();

// Return a probe observation without creating a child process.
const guardedExecFile = childProcess.execFile;
childProcess.execFile = function (file, args, ...rest) {
  const command = Array.isArray(args) && args.at(-1);
  const callback = rest.at(-1);
  if ((file === 'ssh' || file === '/bin/sh') &&
      typeof command === 'string' && command.startsWith('ollama ps 2>/dev/null;') &&
      typeof callback === 'function') {
    process.nextTick(callback, null, 'NAME ID SIZE PROCESSOR UNTIL\nPROBE_DONE:0\n', '');
    return;
  }
  return guardedExecFile.call(this, file, args, ...rest);
};
childProcess.execFile[promisify.custom] = guardedExecFile[promisify.custom];

// Keep the guarded fetch implementation and restrict the child's HTTP egress to its fake listener.
const guardedFetch = globalThis.fetch;
globalThis.fetch = (input, init = {}) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url);
  if (url.origin !== fake.origin) return Promise.reject(new Error('Only the owned fake Ollama listener is permitted'));
  return guardedFetch(input, { ...init, redirect: 'error' });
};

// Exercise only the three loopback fixture routes. Other requests still use the normal guard.
const fixtureRoutes = new Set(['/api/ollama/chat', '/api/ollama/enhance', '/api/ollama/chat/stream']);
const guardedMiddleware = isolation.middleware;
isolation.middleware = (req, res, next) => {
  if (req.method === 'POST' && req.socket.remoteAddress === '127.0.0.1' && fixtureRoutes.has(req.path)) {
    return isolation._als.run({ method: req.method, path: req.path }, next);
  }
  return guardedMiddleware(req, res, next);
};
