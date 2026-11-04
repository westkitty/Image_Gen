'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { hostToolPaths, ON_HOST_DIR } = require('../host-tools');

const run = (tool, args, opts = {}) => spawnSync(path.join(ON_HOST_DIR, tool), args, {
  encoding: 'utf8',
  env: { ...process.env, DEX_ON_HOST_SSH_TARGET: 'westcat', DEX_REAL_SSH: '/usr/bin/false', DEX_REAL_SCP: '/usr/bin/false', ...opts.env },
  input: opts.input,
});

test('hostToolPaths applies only on the Big Mac, outside test isolation', () => {
  const base = { hostname: 'bigmac', sshTarget: 'westcat', isolated: false, env: { PATH: '/usr/bin' } };
  assert.equal(hostToolPaths({ ...base, hostname: 'macbook' }), null);
  assert.equal(hostToolPaths({ ...base, isolated: true }), null);
  assert.equal(hostToolPaths({ ...base, sshTarget: 'elsewhere' }), null);
  const got = hostToolPaths(base);
  assert.equal(got.processPath, '/usr/bin');
  assert.equal(got.scriptEnv.PATH, `${ON_HOST_DIR}:/usr/bin`);
  assert.equal(got.scriptEnv.DEX_ON_HOST_SSH_TARGET, 'westcat');
});

test('hostToolPaths puts the configured Pillow Python first for every child', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'host-tools-'));
  const python = path.join(dir, 'python');
  fs.writeFileSync(python, '#!/bin/sh\n', { mode: 0o755 });
  const env = { PATH: '/usr/bin', DEX_IMAGE_VALIDATION_PYTHON: python };
  const got = hostToolPaths({ hostname: 'BigMac', sshTarget: 'westcat', isolated: false, env });
  assert.equal(got.processPath, `${dir}:/usr/bin`);
  assert.equal(got.scriptEnv.PATH, `${ON_HOST_DIR}:${dir}:/usr/bin`);
  const missing = hostToolPaths({ hostname: 'bigmac', sshTarget: 'westcat', isolated: false, env: { PATH: '/usr/bin', DEX_IMAGE_VALIDATION_PYTHON: path.join(dir, 'nope') } });
  assert.equal(missing.processPath, '/usr/bin');
});

test('ssh to the target runs here, keeps options out, and returns the real exit code', () => {
  const ok = run('ssh', ['-o', 'ConnectTimeout=15', '-o', 'ControlPath=/tmp/%C', 'westcat', 'printf', '"%s"', '"$((1+2))"']);
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(ok.stdout, '3');
  assert.equal(run('ssh', ['westcat', 'exit 7']).status, 7);
});

test('ssh passes stdin through, for a command and for a bare script', () => {
  assert.equal(run('ssh', ['westcat', 'cat'], { input: 'bytes' }).stdout, 'bytes');
  assert.equal(run('ssh', ['westcat'], { input: 'echo from-script\n' }).stdout, 'from-script\n');
});

test('ssh to any other host, or a tunnel to the target, uses real ssh', () => {
  const env = { DEX_REAL_SSH: '/bin/echo' };
  assert.equal(run('ssh', ['other', 'hostname'], { env }).stdout, 'other hostname\n');
  assert.match(run('ssh', ['-N', '-L', '1:127.0.0.1:2', 'westcat'], { env }).stdout, /-N -L 1:127\.0\.0\.1:2 westcat/);
  assert.match(run('ssh', ['-S', '/tmp/s', '-O', 'check', 'westcat'], { env }).stdout, /-O check westcat/);
});

test('scp copies both directions for the target and defers everything else', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'host-tools-'));
  const a = path.join(dir, 'a b.png'), b = path.join(dir, 'b.png'), c = path.join(dir, 'c.png');
  fs.writeFileSync(a, 'image');
  assert.equal(run('scp', [a, `westcat:${b}`]).status, 0);
  assert.equal(run('scp', ['-q', '-o', 'ConnectTimeout=5', `westcat:${b}`, c]).status, 0);
  assert.equal(fs.readFileSync(c, 'utf8'), 'image');
  assert.notEqual(run('scp', [`westcat:${path.join(dir, 'missing')}`, c]).status, 0);
  assert.equal(run('scp', [a, 'other:/tmp/x'], { env: { DEX_REAL_SCP: '/bin/echo' } }).stdout, `${a} other:/tmp/x\n`);
});
