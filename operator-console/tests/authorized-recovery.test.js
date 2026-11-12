'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

test('authorized on-demand recovery protects identity, jobs, listener and app data', () => {
  const recovery = read('scripts/recover-backend-authorized.sh');
  for (const literal of [
    '/Users/bigmac/Image_Gen', 'bigmac', 'main',
    'authorized-backend-recovery.lock', 'lockf -t 0',
    'trusted_listener', 'STOP: port 31337 belongs to an unverified process',
    'STOP: active image job', 'STOP: active compute reservation',
    'launchctl bootout', 'kill -TERM',
    'scripts/run-backend-service.sh',
    '127.0.0.1:31337',
    'SERVICE_READY pid=', 'canonical=', 'working=',
    'FALLBACK_BOOTSTRAP_REQUESTED'
  ]) assert.ok(recovery.includes(literal), literal);
  assert.ok(!/kill\s+-KILL|tccutil|sudo |chmod\s+777/.test(recovery));
  assert.ok(!recovery.includes('0.0.0.0:31337'));
});

test('MacBook images_made is the only canonical image destination in both modes', () => {
  const server = read('operator-console/server.js');
  const native = read('operator-console/bin/canonicalize-image.js');
  const engine = read('operator-console/bin/local-engine-generate.js');
  const runner = read('scripts/run-backend-service.sh');
  assert.ok(server.includes("canonicalImages: '/Users/andrew/images_made'"));
  assert.ok(server.includes("const crossHostPublicationEnabled = !!STORAGE_PATHS.dataRoot"));
  assert.ok(native.includes('const crossHostPublication = !!paths.dataRoot'));
  assert.ok(engine.includes('const crossHostPublication = !!paths.dataRoot'));
  assert.ok(runner.includes('IMAGE_STAGING="/Users/bigmac/DexDiffusion-PublicationStaging"'));
  assert.ok(runner.includes('export DEX_IMAGES_ROOT_OVERRIDE="$IMAGE_STAGING"'));
  assert.ok(runner.includes('publication staging is not on Big Mac internal storage'));
});
