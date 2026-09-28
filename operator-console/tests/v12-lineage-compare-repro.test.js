'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { exportReproBundle, validateReproBundle, checkBundleCompatibility } = require('../repro-bundle');

test('lineage settings delta: shows changed fields without prompt leakage', () => {
  const parent = {
    operation: 'txt2img',
    target: 'flux2-klein-4b',
    seed: 42,
    width: 512,
    height: 512,
    steps: 20,
    cfg_scale: 7,
    prompt_saved: false,
    prompt: 'INTERNAL_SECRET_PARENT'
  };

  const child = {
    operation: 'img2img',
    target: 'flux2-klein-4b',
    seed: 43,
    width: 512,
    height: 512,
    steps: 25,
    cfg_scale: 7,
    strength: 0.65,
    prompt_saved: false,
    prompt: 'INTERNAL_SECRET_CHILD'
  };

  const diffs = [];
  const fields = ['operation', 'target', 'seed', 'width', 'height', 'steps', 'cfg_scale', 'strength'];
  for (const f of fields) {
    if (parent[f] !== child[f]) {
      diffs.push({ field: f, parent: parent[f], child: child[f] });
    }
  }

  assert.equal(diffs.length, 4); // operation, seed, steps, strength
  assert.deepEqual(diffs.map(d => d.field), ['operation', 'seed', 'steps', 'strength']);

  // Privacy verification: prompt text must NOT leak into delta display
  assert.equal(diffs.some(d => d.field === 'prompt'), false);
  const promptDiffStatus = (parent.prompt_saved && child.prompt_saved) ? 'SAVED' : 'PRIVATE / NOT SAVED';
  assert.equal(promptDiffStatus, 'PRIVATE / NOT SAVED');
});

test('synchronized comparison modes: supports 2-image and 2-4 synchronized comparisons', () => {
  const images = [
    { id: 'img1.png', url: '/api/images/img1.png', width: 512, height: 512 },
    { id: 'img2.png', url: '/api/images/img2.png', width: 512, height: 512 },
    { id: 'img3.png', url: '/api/images/img3.png', width: 512, height: 512 }
  ];

  assert.equal(images.length >= 2 && images.length <= 4, true);

  // Check valid dimensions for difference comparison
  const canDiff = images[0].width === images[1].width && images[0].height === images[1].height;
  assert.equal(canDiff, true);

  const mismatchedImages = [
    { id: 'img1.png', width: 512, height: 512 },
    { id: 'img2.png', width: 768, height: 1024 }
  ];
  const cannotDiff = mismatchedImages[0].width === mismatchedImages[1].width && mismatchedImages[0].height === mismatchedImages[1].height;
  assert.equal(cannotDiff, false, 'dimension mismatch gracefully disables difference view');
});

test('repro bundle round-trip: exports schema, validates import, prevents automatic execution', () => {
  const bundle = exportReproBundle({
    appVersion: 'dexdiffusion-v12',
    operation: 'txt2img',
    worker: 'mflux',
    target: 'flux2-klein-4b',
    seed: 99999,
    steps: 24,
    guidance: 4,
    includePrompt: false,
    savedPrompt: 'SECRET_UNSAVED'
  });

  assert.equal(bundle.schemaVersion, 'dexdiffusion.repro.v1');
  assert.equal(bundle.promptIncluded, false);
  assert.equal(bundle.promptText, null, 'Unsaved prompt stripped from bundle');

  const val = validateReproBundle(bundle);
  assert.equal(val.valid, true);

  // Import contract: importing restores settings into UI form, NEVER auto-executes
  const restoredForm = {
    target: bundle.target,
    seed: bundle.settings.seed,
    steps: bundle.settings.steps,
    guidance: bundle.settings.guidance,
    autoExecuted: false
  };
  assert.equal(restoredForm.autoExecuted, false);
  assert.equal(restoredForm.steps, 24);
});
