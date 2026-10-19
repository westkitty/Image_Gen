'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createDirectorPreferences } = require('../director-preferences');

test('director preferences persist across store recreation, clamp supported values and reset without profile approval state', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'director-prefs-'));
  const file = path.join(dir, 'preferences.json');
  const first = createDirectorPreferences(file);
  const saved = first.update({ favorite_presets: ['formal_dry', 'formal_dry', '../bad'], preferred_models: { 'vp-1234567890': 'voxcpm2' }, default_direction: 'quiet and deliberate', speed: 4, intensity: -3,
    acting_styles: [{ id: 'quiet', name: 'Quiet resolve', direction: 'quiet, steady, deliberate', speed: 0.8, intensity: 0.4 }], last_audition: { profile_id: 'vp-1234567890', direction: 'softly' } });
  assert.deepEqual(saved.favorite_presets, ['formal_dry']);
  assert.equal(saved.speed, 2); assert.equal(saved.intensity, 0);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  const restarted = createDirectorPreferences(file);
  assert.equal(restarted.get().default_direction, 'quiet and deliberate');
  assert.equal(restarted.get().preferred_models['vp-1234567890'], 'voxcpm2');
  assert.equal(restarted.get().acting_styles[0].name, 'Quiet resolve');
  assert.deepEqual(restarted.reset().favorite_presets, []);
  fs.rmSync(dir, { recursive: true, force: true });
});
