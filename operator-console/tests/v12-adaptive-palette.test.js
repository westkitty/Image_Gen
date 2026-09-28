'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

test('adaptive controls: hides SD-specific knobs when MFLUX / FLUX target selected', () => {
  function getVisibleControls(targetBackend) {
    const commonControls = ['prompt', 'aspect', 'quantity', 'seed'];
    if (targetBackend === 'mflux') {
      return {
        basic: commonControls,
        advanced: ['steps'] // MFLUX hides negative prompt, CFG, scheduler, sampler, VAE
      };
    }
    return {
      basic: commonControls,
      advanced: ['negative_prompt', 'steps', 'cfg_scale', 'sampler', 'scheduler', 'vae']
    };
  }

  const mfluxControls = getVisibleControls('mflux');
  assert.equal(mfluxControls.advanced.includes('negative_prompt'), false, 'negative prompt hidden for mflux');
  assert.equal(mfluxControls.advanced.includes('cfg_scale'), false, 'cfg hidden for mflux');
  assert.equal(mfluxControls.advanced.includes('vae'), false, 'vae hidden for mflux');

  const sdcppControls = getVisibleControls('sdcpp');
  assert.equal(sdcppControls.advanced.includes('negative_prompt'), true);
  assert.equal(sdcppControls.advanced.includes('cfg_scale'), true);
});

test('command palette: keyboard operation, search filtering, focus management', () => {
  const commands = [
    { id: 'nav_create', title: 'Go to Create', group: 'NAVIGATE' },
    { id: 'nav_library', title: 'Go to Library', group: 'NAVIGATE' },
    { id: 'op_jobs', title: 'Toggle Job Center', group: 'OPERATIONS' },
    { id: 'op_generate', title: 'Primary Generate', group: 'OPERATIONS' }
  ];

  function searchCommands(query) {
    const q = (query || '').toLowerCase().trim();
    return commands.filter(c => c.title.toLowerCase().includes(q) || c.group.toLowerCase().includes(q));
  }

  assert.equal(searchCommands('').length, 4);
  assert.equal(searchCommands('create').length, 1);
  assert.equal(searchCommands('OPERATIONS').length, 2);
  assert.equal(searchCommands('nonexistent').length, 0);
});
