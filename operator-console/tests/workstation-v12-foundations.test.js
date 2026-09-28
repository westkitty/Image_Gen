'use strict';

// Tests for EventBus, Operational Jobs, Collections, Recipes, Macros, Repro Bundles, Timing, and Cancellation.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createEventBus, FORBIDDEN_CANARY_FIELDS } = require('../event-bus');
const { projectOperationalJob, FORBIDDEN_FIELDS } = require('../operational-jobs');
const { createTimingStore } = require('../timing-store');
const { createCollectionStore } = require('../collections-store');
const { createRecipeStore } = require('../recipes-store');
const { createMacroStore, validateMacroDefinition } = require('../macro-store');
const { exportReproBundle, validateReproBundle, checkBundleCompatibility } = require('../repro-bundle');
const { createCancellationManager } = require('../cancellation');
const { createLibraryIndex } = require('../library-index');

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), 'dex-unit-' + p));

test('event bus: monotonic IDs, allowlist filtering, bounded replay, privacy sanitization', () => {
  const bus = createEventBus({ maxReplay: 3, heartbeatMs: 0 });

  // Canaries in raw payload
  const ev1 = bus.publish('job.created', {
    id: 'job-1',
    worker: 'sdcpp',
    prompt: 'SUPER_SECRET_PROMPT',
    negative_prompt: 'SECRET_NEGATIVE',
    requestParams: { prompt: 'SECRET_PARAM' }
  });

  assert.equal(ev1.id, 1);
  assert.equal(ev1.event, 'job.created');
  assert.equal(ev1.data.worker, 'sdcpp');
  assert.equal(ev1.data.prompt, undefined, 'prompt stripped');
  assert.equal(ev1.data.negative_prompt, undefined, 'negative prompt stripped');
  assert.equal(ev1.data.requestParams, undefined, 'requestParams stripped');

  bus.publish('job.started', { id: 'job-1' });
  bus.publish('job.progress', { id: 'job-1', progress: { currentRunPercent: 50 } });
  assert.equal(bus.ringSize(), 3);

  // Exceed ring limit
  bus.publish('job.completed', { id: 'job-1' });
  assert.equal(bus.ringSize(), 3);
  assert.equal(bus.getReplaySince(0).length, 3);
  assert.equal(bus.getReplaySince(2).length, 2);

  // Illegal event class throws
  assert.throws(() => bus.publish('unauthorized.hack', {}), /not in the allowed event classes/);
  bus.close();
});

test('operational job projection: privacy safe, uppercase status, elapsed time calculation', () => {
  const now = Date.now();
  const proj = projectOperationalJob({
    id: 'test-job-99',
    mediaKind: 'image',
    operation: 'txt2img',
    status: 'running',
    startedAt: now - 5000,
    prompt: 'CANARY_PROMPT_UNSAFE',
    negative_prompt: 'CANARY_NEG',
    now
  });

  assert.equal(proj.id, 'test-job-99');
  assert.equal(proj.status, 'RUNNING');
  assert.equal(proj.prompt, undefined);
  assert.equal(proj.negative_prompt, undefined);
  assert.ok(proj.elapsedMs >= 5000);
  assert.equal(proj.schemaVersion, 'dexdiffusion.job.v1');
});

test('timing store: median estimation, bucket grouping, insufficient history degraded state', () => {
  const dir = tmp('timing');
  const file = path.join(dir, 'timing.json');
  const store = createTimingStore(file);

  // 0 or 1 samples: insufficient
  const est0 = store.getEstimate('flux', 'txt2img', { width: 512, height: 512 });
  assert.equal(est0.available, false);
  assert.match(est0.display, /insufficient history/);

  // Record 3 samples: 10s, 14s, 12s -> median 12s
  store.recordCompletedJob({ worker: 'flux', operation: 'txt2img', durationMs: 10000, workload: { width: 512, height: 512 } });
  store.recordCompletedJob({ worker: 'flux', operation: 'txt2img', durationMs: 14000, workload: { width: 512, height: 512 } });
  store.recordCompletedJob({ worker: 'flux', operation: 'txt2img', durationMs: 12000, workload: { width: 512, height: 512 } });

  const est3 = store.getEstimate('flux', 'txt2img', { width: 512, height: 512 });
  assert.equal(est3.available, true);
  assert.equal(est3.estimatedDurationMs, 12000);
  assert.equal(est3.display, '~12s');

  // Queue wait calculation
  const qWait = store.estimateQueueWait([
    { worker: 'flux', operation: 'txt2img', workload: { width: 512, height: 512 } }
  ]);
  assert.equal(qWait.available, true);
  assert.equal(qWait.totalMs, 12000);
});

test('collections store: CRUD, multi-select artifact addition/removal, schema validation', () => {
  const dir = tmp('col');
  const file = path.join(dir, 'collections.json');
  const colStore = createCollectionStore(file);

  const col1 = colStore.create({ name: 'Cyberpunk Edits', tags: ['cyberpunk', 'v1'] });
  assert.ok(col1.id.startsWith('col_'));
  assert.equal(col1.name, 'Cyberpunk Edits');

  colStore.addArtifacts(col1.id, ['img_001.png', 'img_002.png']);
  let fetched = colStore.get(col1.id);
  assert.deepEqual(fetched.artifactIds, ['img_001.png', 'img_002.png']);

  colStore.removeArtifacts(col1.id, ['img_001.png']);
  fetched = colStore.get(col1.id);
  assert.deepEqual(fetched.artifactIds, ['img_002.png']);

  // Survival across reload
  const reloadStore = createCollectionStore(file);
  assert.equal(reloadStore.count(), 1);
  assert.equal(reloadStore.get(col1.id).name, 'Cyberpunk Edits');
});

test('recipes store: CRUD, privacy settings-only default, legacy import', () => {
  const dir = tmp('rcp');
  const file = path.join(dir, 'recipes.json');
  const rcpStore = createRecipeStore(file);

  const r1 = rcpStore.create({
    name: 'Portrait Quality',
    category: 'generation',
    target: 'flux2-klein-4b',
    parameters: { steps: 25, width: 768, height: 1024, prompt: 'SHOULD_BE_STRIPPED' }
  });

  assert.equal(r1.parameters.steps, 25);
  assert.equal(r1.parameters.prompt, undefined, 'prompts stripped from recipe parameters by default');
  assert.equal(r1.promptSaved, false);

  // Import legacy styles
  const imp = rcpStore.importLegacyStyles([
    { name: 'Cinematic', settings: { steps: 30 } }
  ]);
  assert.equal(imp.importedCount, 1);
  assert.equal(rcpStore.count(), 2);
});

test('macro store: declarative steps allowlist, validation against arbitrary shell injection', () => {
  const dir = tmp('mac');
  const file = path.join(dir, 'macros.json');
  const mStore = createMacroStore(file);

  // Valid macro
  const m1 = mStore.create({
    name: 'Generate and Refine',
    steps: [
      { type: 'generate', target: 'flux2-klein-4b' },
      { type: 'enhance', settings: { method: 'realesrgan', scale: 2 } },
      { type: 'mark_keeper' }
    ]
  });
  assert.equal(m1.steps.length, 3);

  // Invalid step type rejected
  assert.throws(() => {
    mStore.create({
      name: 'Unsafe Macro',
      steps: [{ type: 'arbitrary_bash_command' }]
    });
  }, /is invalid/);
});

test('repro bundles: versioned export/import, schema validation, compatibility checks', () => {
  const bundle = exportReproBundle({
    appVersion: 'dexdiffusion-v12',
    operation: 'txt2img',
    target: 'flux2-klein-4b',
    seed: 12345,
    steps: 20
  });

  assert.equal(bundle.schemaVersion, 'dexdiffusion.repro.v1');
  assert.equal(bundle.settings.seed, 12345);

  const val = validateReproBundle(bundle);
  assert.equal(val.valid, true);

  const comp = checkBundleCompatibility(bundle, [
    { id: 'flux2-klein-4b', status: 'available' }
  ]);
  assert.equal(comp.compatible, true);

  const compMissing = checkBundleCompatibility(bundle, [
    { id: 'sd15', status: 'available' }
  ]);
  assert.equal(compMissing.compatible, false);
  assert.match(compMissing.issues[0], /not installed or available/);
});

test('cancellation engine: queued immediate cancellation vs active termination contract', async () => {
  let releasedLeaseId = null;
  const mockArbiter = { release: (id) => { releasedLeaseId = id; } };
  const mockJobs = new Map();
  const mockJobStore = {
    get: (id) => mockJobs.get(id),
    transition: (id, st, patch) => {
      const cur = mockJobs.get(id) || {};
      mockJobs.set(id, { ...cur, status: st, ...patch });
    }
  };

  mockJobs.set('job-q', { id: 'job-q', status: 'QUEUED' });

  const cancelMgr = createCancellationManager({
    arbiter: mockArbiter,
    jobStore: mockJobStore
  });

  // Cancel queued job
  const resQueued = await cancelMgr.cancelJob('job-q');
  assert.equal(resQueued.ok, true);
  assert.equal(resQueued.status, 'CANCELLED');
  assert.equal(resQueued.immediate, true);
  assert.equal(mockJobs.get('job-q').status, 'CANCELLED');
  assert.equal(releasedLeaseId, 'job-q');

  // Cancel active job with lack of identity fails closed
  mockJobs.set('job-act', { id: 'job-act', status: 'RUNNING' });
  cancelMgr.registerActiveJob('job-act', { isRemote: true }); // Missing nonce/dir
  const resUnsafe = await cancelMgr.cancelJob('job-act');
  assert.equal(resUnsafe.ok, false);
  assert.equal(resUnsafe.gate, 'cancel-unsafe');
});
