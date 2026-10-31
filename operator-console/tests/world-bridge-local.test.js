'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createWorldBridge, createWorldTransport, worldCompilerPython } = require('../world-bridge');

test('World transport runs locally only when the actual worker host is local', () => {
  assert.equal(createWorldTransport({ sshTarget: 'westcat', hostname: 'bigmac' }).local, true);
  assert.equal(createWorldTransport({ sshTarget: 'westcat', hostname: 'MacBook-Air.local' }).local, false);
  assert.equal(createWorldTransport({ sshTarget: 'another-mac', hostname: 'bigmac' }).local, false);
  assert.equal(createWorldTransport({ sshTarget: 'local', hostname: 'MacBook-Air.local' }).local, true);
});

test('World compiler chooses a configured runtime before the shell Python', () => {
  assert.equal(worldCompilerPython({ DEX_WORLD_COMPILER_PYTHON: '/world/python', DEX_IMAGE_VALIDATION_PYTHON: '/image/python' }), '/world/python');
  assert.equal(worldCompilerPython({ DEX_IMAGE_VALIDATION_PYTHON: '/image/python' }), '/image/python');
  assert.equal(worldCompilerPython({}), 'python3');
});

test('Local World transport runs commands and copies worker files without SSH, escaping its root, or overwriting', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-world-local-test-'));
  try {
    const workRoot = path.join(root, 'worker-owned');
    fs.mkdirSync(workRoot);
    const transport = createWorldTransport({ sshTarget: 'local', hostname: 'test-mac', workRoot });
    const result = await transport.run('printf "LOCAL_WORLD_PASS\\n"');
    assert.match(result.stdout, /LOCAL_WORLD_PASS/);
    const source = path.join(root, 'source with spaces.png');
    const destination = path.join(workRoot, 'uploaded.png');
    const downloaded = path.join(root, 'downloaded.png');
    const bytes = Buffer.from('fixture-image-bytes-no-production-upload');
    fs.writeFileSync(source, bytes);
    await transport.toWorker(source, destination);
    await transport.fromWorker(destination, downloaded);
    assert.deepEqual(fs.readFileSync(destination), bytes);
    assert.deepEqual(fs.readFileSync(downloaded), bytes);
    await assert.rejects(transport.toWorker(source, destination), { code: 'EEXIST' });
    await assert.rejects(transport.fromWorker(destination, downloaded), { code: 'EEXIST' });
    await assert.rejects(transport.toWorker(source, path.join(root, 'outside.png')), /escapes/);
    await assert.rejects(transport.fromWorker(path.join(workRoot, '..', 'outside.png'), path.join(root, 'leak.png')), /escapes/);
    assert.equal(fs.existsSync(path.join(root, 'outside.png')), false);
    assert.equal(fs.existsSync(path.join(root, 'leak.png')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('World worker status on a local host is an actual local asset probe, not an SSH failure', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-world-worker-status-'));
  try {
    const bridge = createWorldBridge({
      jobStore: {}, arbiter: {}, staging: {}, mediaStore: {}, worldStore: {}, imageStore: {},
      stateDir: root, sshTarget: 'local'
    });
    const status = await bridge.workers();
    assert.equal(status.assets.reachable, true, status.assets.error);
    assert.match(status.assets.identity, /@/);
    assert.equal(typeof status.assets.sharp, 'boolean');
    assert.equal(typeof status.assets.panorama, 'boolean');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Configured World Python executes the real anchor CLI on an isolated image fixture', { skip: !process.env.DEX_WORLD_COMPILER_PYTHON && !process.env.DEX_IMAGE_VALIDATION_PYTHON }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-world-compiler-check-'));
  try {
    const python = worldCompilerPython();
    const image = path.join(root, 'input.png');
    const output = path.join(root, 'anchor.png');
    const mask = path.join(root, 'mask.png');
    const manifest = path.join(root, 'anchor.json');
    const mk = spawnSync(python, ['-c', 'from PIL import Image; import sys; Image.new("RGB",(64,64),(12,34,56)).save(sys.argv[1])', image], { encoding: 'utf8', timeout: 10000 });
    assert.equal(mk.status, 0, mk.stderr);
    const run = spawnSync(python, [path.join(__dirname, '..', 'world-compiler.py'), 'anchor', '--source', image, '--output', output, '--mask', mask, '--manifest', manifest, '--width', '128', '--height', '64'], { encoding: 'utf8', timeout: 20000 });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(fs.existsSync(output), true);
    assert.equal(fs.existsSync(mask), true);
    assert.equal(JSON.parse(fs.readFileSync(manifest, 'utf8')).erpDimensions.width, 128);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
