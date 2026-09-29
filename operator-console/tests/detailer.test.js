'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  isVisionDetailerAvailable,
  detectRegions,
  getDefaultDetailerPrompt
} = require('../detailer');

const TEST_IMAGE = '/Users/andrew/images_made/20260928-174616-controlled-sdxl-photonic-s1391613307-controlled-sdxl-photonic.png';

test('detailer: binary is compiled and available', () => {
  assert(isVisionDetailerAvailable(), 'vision-detailer binary must exist');
});

test('detailer: provides delta-oriented default prompts', () => {
  const facePrompt = getDefaultDetailerPrompt('face');
  assert(facePrompt.includes('preserve identity, pose and expression'));
  assert(facePrompt.includes('improve facial anatomy'));

  const handPrompt = getDefaultDetailerPrompt('hand');
  assert(handPrompt.includes('preserve hand pose'));
  assert(handPrompt.includes('correct hand anatomy'));

  const personPrompt = getDefaultDetailerPrompt('person');
  assert(personPrompt.includes('preserve pose'));
});

test('detailer: executes face detection and generates valid mask PNG', async () => {
  if (!fs.existsSync(TEST_IMAGE)) {
    return; // skip if image absent
  }

  const tmpMask = path.join(__dirname, 'fixtures', `test-mask-${Date.now()}.png`);
  try {
    const res = await detectRegions(TEST_IMAGE, {
      mode: 'face',
      threshold: 0.3,
      padding: 0.2,
      outputMask: tmpMask
    });

    assert.equal(res.status, 'ok');
    assert.equal(res.mode, 'face');
    assert(res.detections_count >= 1, 'expected at least 1 face detection');
    assert.equal(res.detections[0].mode, 'face');
    assert.equal(res.detections[0].is_derived_roi, false);
    assert(res.detections[0].confidence > 0.3);

    // Verify mask file
    assert(fs.existsSync(tmpMask), 'mask file must be created');
    const stat = fs.statSync(tmpMask);
    assert(stat.size > 1000, `mask file must be non-empty (got ${stat.size} bytes)`);
  } finally {
    if (fs.existsSync(tmpMask)) fs.unlinkSync(tmpMask);
  }
});

test('detailer: executes hand detection and marks is_derived_roi: true', async () => {
  if (!fs.existsSync(TEST_IMAGE)) {
    return;
  }

  const res = await detectRegions(TEST_IMAGE, {
    mode: 'hand',
    threshold: 0.3
  });

  assert.equal(res.status, 'ok');
  assert.equal(res.mode, 'hand');
  if (res.detections_count > 0) {
    assert.equal(res.detections[0].is_derived_roi, true);
    assert.equal(res.detections[0].mode, 'hand_derived_roi');
  }
});

test('detailer: fails cleanly when image is missing', async () => {
  await assert.rejects(
    async () => {
      await detectRegions('/nonexistent/path/to/image.png');
    },
    /Source image not found/
  );
});
