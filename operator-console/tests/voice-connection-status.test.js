'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../media');
const B = require('../media-bridge');

const assets = id => Object.fromEntries(M.WORKER_PROBE_PATHS
  .filter(([key]) => key.startsWith(id + ':'))
  .map(([key]) => [key, true]));

test('unreachable Big Mac is not falsely reported as an uninstalled Qwen runtime', () => {
  const registry = M.createWorkerRegistry({ getEvidence: () => ({
    'qwen3-tts-base': { lastPass: { at: '2026-10-18T21:06:38Z', job_id: 'known-proof' } }
  }) });
  for (const id of ['kokoro', 'qwen3-tts-base', 'qwen3-tts-voice-design']) {
    const down = registry.get(id).probe({ reachable: false });
    assert.equal(down.state, 'BIG MAC UNREACHABLE');
    assert.equal(down.remote_reachable, false);
    assert.equal(down.enabled, false);
    assert.equal(down.proven, false);
  }
  const base = registry.get('qwen3-tts-base');
  const restored = base.probe({ ...assets('qwen3-tts-base'), reachable: true, wc2tbReadable: true });
  assert.equal(restored.remote_reachable, true);
  assert.equal(restored.state, 'PROVEN');
  assert.equal(restored.enabled, true);
  const driveBlocked = base.probe({ ...assets('qwen3-tts-base'), reachable: true, wc2tbReadable: false });
  assert.equal(driveBlocked.state, 'MODEL INACCESSIBLE (wc2tb)');
  assert.equal(driveBlocked.enabled, false);
  const missingVenv = base.probe({ ...assets('qwen3-tts-base'), reachable: true, 'qwen3-tts-base:runtime:python': false });
  assert.equal(missingVenv.state, 'RUNTIME MISSING');
});

test('single and batch voice requests fail as remote-unreachable before jobs or leases', () => {
  const registry = M.createWorkerRegistry();
  const probe = registry.get('qwen3-tts-base').probe({ reachable: false });
  const bridge = B.createMediaBridge({
    jobStore: { create() { throw Error('MUST NOT CREATE A JOB'); } },
    evidenceFile: '/nonexistent/dex-tests/evidence.json'
  });
  const one = bridge.start('qwen3-tts-base', { text: 'test' }, { probe });
  assert.equal(one.gate, 'remote-unreachable');
  assert.equal(one.status, 503);
  const batch = bridge.startBatch('qwen3-tts-base', { items: [] }, { probe });
  assert.equal(batch.gate, 'remote-unreachable');
  assert.equal(batch.status, 503);
});
