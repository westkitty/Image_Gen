'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { LEGACY_IMAGE_ROOT, resolveStoragePaths, assertDataRootMount, childStorageEnvironment } = require('../storage-paths');

test('storage paths retain the existing layout when DEX_DATA_ROOT is unset', () => {
  const workflow = path.resolve('/legacy/sdcpp-workflow');
  const p = resolveStoragePaths({}, workflow);
  assert.equal(p.dataRoot, null);
  assert.equal(p.workflowRoot, workflow);
  assert.equal(p.runsDir, path.join(workflow, 'runs'));
  assert.equal(p.stateDir, path.join(workflow, 'state'));
  assert.equal(p.imageRoot, LEGACY_IMAGE_ROOT);
  assert.equal(p.mediaRoots, undefined);
  assert.equal(p.maskUploadsDir, path.join(workflow, 'mask-uploads'));
});

test('DEX_DATA_ROOT relocates durable data while keeping executable workflow sources in place', () => {
  const p = resolveStoragePaths({ DEX_DATA_ROOT: '/Volumes/wc2tb/DexDiffusion' }, '/checkout/sdcpp-workflow');
  assert.equal(p.workflowRoot, '/checkout/sdcpp-workflow');
  assert.equal(p.runsDir, '/Volumes/wc2tb/DexDiffusion/runs');
  assert.equal(p.stateDir, '/Volumes/wc2tb/DexDiffusion/state');
  assert.equal(p.imageRoot, '/Volumes/wc2tb/DexDiffusion/images');
  assert.deepEqual(p.mediaRoots, {
    image: '/Volumes/wc2tb/DexDiffusion/images',
    voice: '/Volumes/wc2tb/DexDiffusion/audio/voice',
    music: '/Volumes/wc2tb/DexDiffusion/audio/music',
    video: '/Volumes/wc2tb/DexDiffusion/video',
    world: '/Volumes/wc2tb/DexDiffusion/worlds',
  });
  assert.equal(p.scratchRoot, '/Volumes/wc2tb/DexDiffusion/scratch');
  assert.equal(p.maskUploadsDir, '/Volumes/wc2tb/DexDiffusion/scratch/mask-uploads');
  assert.equal(p.logsDir, '/Volumes/wc2tb/DexDiffusion/logs');
});

test('specific legacy overrides take precedence over DEX_DATA_ROOT', () => {
  const p = resolveStoragePaths({
    DEX_DATA_ROOT: '/data', DEX_WORKFLOW_ROOT: '/workflow', DEX_RUNS_DIR: '/runs', DEX_STATE_DIR: '/state',
    DEX_IMAGES_ROOT_OVERRIDE: '/images', DEX_MEDIA_ROOT_OVERRIDE: '/media', DEX_SCRATCH_ROOT: '/scratch',
    DEX_MASK_UPLOADS_DIR: '/uploads', DEX_LOGS_DIR: '/logs',
  }, '/checkout/workflow');
  assert.deepEqual(p, {
    dataRoot: '/data', workflowRoot: '/workflow', runsDir: '/runs', stateDir: '/state', imageRoot: '/images',
    mediaRoots: { image: '/media/image', voice: '/media/voice', music: '/media/music', video: '/media/video', world: '/media/world' },
    scratchRoot: '/scratch', maskUploadsDir: '/uploads', logsDir: '/logs', dataRootMount: null,
  });
});

test('external-root binding rejects missing, mismatched and unmounted volumes', () => {
  const p = resolveStoragePaths({ DEX_DATA_ROOT: '/Volumes/wc2tb/DexDiffusion', DEX_DATA_ROOT_MOUNT: '/Volumes/wc2tb' });
  const mounted = {
    statSync: target => ({ dev: target === '/Volumes/wc2tb' ? 7 : 1 }),
    existsSync: target => target === '/Volumes/wc2tb',
    realpathSync: target => target,
  };
  assert.doesNotThrow(() => assertDataRootMount(p, mounted));
  assert.throws(() => assertDataRootMount(p, { ...mounted, statSync: () => { throw new Error('not found'); } }), /DEX_DATA_ROOT_MOUNT is unavailable/);
  assert.throws(() => assertDataRootMount(p, { ...mounted, statSync: () => ({ dev: 1 }) }), /not a mounted volume/);
  const outside = resolveStoragePaths({ DEX_DATA_ROOT: '/Users/bigmac/DexDiffusion', DEX_DATA_ROOT_MOUNT: '/Volumes/wc2tb' });
  assert.throws(() => assertDataRootMount(outside, mounted), /must be inside DEX_DATA_ROOT_MOUNT/);
  const same = resolveStoragePaths({ DEX_DATA_ROOT: '/Volumes/wc2tb', DEX_DATA_ROOT_MOUNT: '/Volumes/wc2tb' });
  assert.throws(() => assertDataRootMount(same, mounted), /must be inside DEX_DATA_ROOT_MOUNT/);
  const linked = resolveStoragePaths({ DEX_DATA_ROOT: '/Volumes/wc2tb/DexDiffusion', DEX_DATA_ROOT_MOUNT: '/Volumes/wc2tb' });
  const symlinked = { ...mounted, existsSync: target => target === '/Volumes/wc2tb' || target === linked.dataRoot,
    realpathSync: target => target === linked.dataRoot ? '/Users/bigmac/DexDiffusion' : target };
  assert.throws(() => assertDataRootMount(linked, symlinked), /does not resolve inside DEX_DATA_ROOT_MOUNT/);
});

test('workflow child processes receive the same canonical and temporary roots as the server', () => {
  const legacy = childStorageEnvironment(resolveStoragePaths({}, '/workflow'), {});
  assert.equal(legacy.DEX_IMAGES_ROOT_OVERRIDE, undefined);
  assert.equal(legacy.DEX_RUNS_DIR, undefined);
  assert.equal(legacy.DEX_STATE_DIR, undefined);
  const p = resolveStoragePaths({ DEX_DATA_ROOT: '/data' });
  const env = childStorageEnvironment(p, { EXISTING: 'kept' });
  assert.equal(env.EXISTING, 'kept');
  assert.equal(env.DEX_IMAGES_ROOT_OVERRIDE, p.imageRoot);
  assert.equal(env.DEX_RUNS_DIR, p.runsDir);
  assert.equal(env.DEX_STATE_DIR, p.stateDir);
  assert.equal(env.DEX_LOGS_DIR, p.logsDir);
  assert.equal(env.DEX_MASK_UPLOADS_DIR, p.maskUploadsDir);
  assert.equal(env.TMPDIR, p.scratchRoot);
  assert.equal(childStorageEnvironment(p, { TMPDIR: '/task-tmp' }).TMPDIR, '/task-tmp');
});
