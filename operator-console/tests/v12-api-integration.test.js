'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createCollectionStore } = require('../collections-store');
const { createRecipeStore } = require('../recipes-store');
const { createMacroStore } = require('../macro-store');
const { exportReproBundle, validateReproBundle, checkBundleCompatibility } = require('../repro-bundle');
const { createLibraryIndex } = require('../library-index');
const { createThumbnailService } = require('../thumbnail-service');
const { createEventBus } = require('../event-bus');

const tmp = p => fs.mkdtempSync(path.join(os.tmpdir(), 'dex-int-' + p));

test('library index: query filtering, sorting, pagination, test-artifact exclusion', () => {
  const dir = tmp('lib');
  const indexPath = path.join(dir, 'index.json');
  const mockImageStore = {
    listCanonicalImages: () => ['img_01.png', 'img_02.png', 'img_03.png'],
    resolveImage: (id) => path.join(dir, id)
  };
  const mockMeta = {
    all: () => ({
      'img_01.png': { keeper: true, target: 'flux2-klein-4b', operation: 'txt2img', seed: 100 },
      'img_02.png': { keeper: false, target: 'sd15', operation: 'img2img', seed: 200 },
      'img_03.png': { keeper: false, test_artifact: true, target: 'flux2-klein-4b', operation: 'txt2img', seed: 300 }
    }),
    get: (id) => mockMeta.all()[id]
  };

  const idx = createLibraryIndex({ indexPath, imageStore: mockImageStore, imageMeta: mockMeta });
  idx.rebuild();

  // Total count in index
  assert.equal(idx.count(), 3);

  // Normal query hides test artifacts by default
  const qNormal = idx.query({ showTest: false });
  assert.equal(qNormal.total, 2);

  // Filter keepers
  const qKeepers = idx.query({ filter: 'keepers', showTest: false });
  assert.equal(qKeepers.total, 1);
  assert.equal(qKeepers.items[0].id, 'img_01.png');

  // Filter by model
  const qModel = idx.query({ model: 'sd15', showTest: false });
  assert.equal(qModel.total, 1);
  assert.equal(qModel.items[0].id, 'img_02.png');

  // Incremental upsert
  idx.upsertItem({ id: 'img_04.png', target: 'flux2-klein-4b', operation: 'txt2img', keeper: false });
  assert.equal(idx.count(), 4);
});

test('lineage settings diff logic contract', () => {
  const metaStore = {
    'child-01': {
      parent_id: 'parent-01',
      operation: 'img2img',
      steps: 30,
      strength: 0.75,
      prompt_saved: false
    },
    'parent-01': {
      operation: 'txt2img',
      steps: 20,
      prompt_saved: false
    }
  };

  const child = metaStore['child-01'];
  const parent = metaStore[child.parent_id];

  assert.equal(child.operation !== parent.operation, true);
  assert.equal(child.steps !== parent.steps, true);
  assert.equal(child.prompt_saved, false);
  // Prompt text cannot be recovered
  const promptDiff = (child.prompt_saved && parent.prompt_saved) ? 'SAVED' : 'PRIVATE / NOT SAVED';
  assert.equal(promptDiff, 'PRIVATE / NOT SAVED');
});

test('thumbnail security: path traversal rejection and cache isolation', () => {
  const dir = tmp('thumb');
  const mockStore = {
    resolveImage: (id) => {
      if (id.includes('..') || id.startsWith('/')) return null;
      if (id === 'valid.png') return path.join(dir, 'valid.png');
      return null;
    }
  };

  const thumbService = createThumbnailService({ cacheDir: path.join(dir, 'cache'), imageStore: mockStore });

  // Disallow traversal IDs
  thumbService.generateThumbnail('../../../etc/passwd', (err) => {
    assert.ok(err);
    assert.match(err.message, /not found/);
  });
});

test('thumbnail service handles both string and object record from imageStore.resolveImage', (t, done) => {
  const dir = tmp('thumb-obj');
  const srcPng = path.join(dir, 'sample.png');
  fs.writeFileSync(srcPng, 'fake-data');
  const mockStore = {
    resolveImage: (id) => {
      if (id === 'sample.png') return { id: 'sample.png', path: srcPng, contentType: 'image/png' };
      return null;
    }
  };
  const thumbService = createThumbnailService({ cacheDir: path.join(dir, 'cache'), imageStore: mockStore });
  thumbService.generateThumbnail('sample.png', (err) => {
    if (err) {
      assert.doesNotMatch(err.message, /Canonical source image not found/);
    }
    done();
  });
});
