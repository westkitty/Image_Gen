'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { controlledScriptFor, buildControlledArgs } = require('../controlled-args');

const MFLUX = { id: 'flux2-klein-4b', backend: 'mflux' };
const SDCPP_IDS = ['sd15', 'sdxl-base', 'sdxl-turbo', 'flux-fp8', 'sdxl-juggernaut'];

const FULL_PARAMS = {
  target: 'flux2-klein-4b',
  prompt: 'a red cube',
  negative_prompt: 'blurry',
  width: 1024,
  height: 1024,
  steps: 4,
  cfg_scale: 7,
  scheduler: 'karras',
  vae: 'some-vae',
  save_prompts: false,
};

test('flux2-klein-4b routes to the MFLUX script; SDCPP targets do not', () => {
  assert.equal(controlledScriptFor(MFLUX), 'bin/mflux-controlled-generate.sh');
  for (const id of SDCPP_IDS) {
    assert.equal(controlledScriptFor({ id }), 'bin/sdcpp-controlled-generate.sh', id);
  }
});

test('server registry: only flux2-klein-4b declares the mflux backend', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const mfluxIds = [...src.matchAll(/id: '([^']+)',[^}]*?backend: 'mflux'/g)].map(m => m[1]);
  assert.deepEqual(mfluxIds, ['flux2-klein-4b']);
});

test('MFLUX args never carry SDCPP-only flags', () => {
  const args = buildControlledArgs(MFLUX, FULL_PARAMS, { seedValue: 424242, resolveVaePath: () => '/x/vae' });
  for (const flag of ['--negative-prompt', '--cfg', '--scheduler', '--vae', '--model-path', '--api']) {
    assert.ok(!args.includes(flag), `${flag} leaked into MFLUX args`);
  }
  assert.deepEqual(args, [
    '--target', 'flux2-klein-4b', '--prompt', 'a red cube',
    '--width', '1024', '--height', '1024', '--steps', '4',
    '--seed', '424242', '--save-prompts', 'false',
  ]);
});

test('custom portrait and landscape dimensions survive the controlled argument path unchanged', () => {
  const landscape = buildControlledArgs(MFLUX, { ...FULL_PARAMS, width: 768, height: 512 }, { seedValue: 7 });
  const portrait = buildControlledArgs(MFLUX, { ...FULL_PARAMS, width: 512, height: 768 }, { seedValue: 8 });
  assert.deepEqual(landscape.slice(landscape.indexOf('--width'), landscape.indexOf('--steps')), ['--width', '768', '--height', '512']);
  assert.deepEqual(portrait.slice(portrait.indexOf('--width'), portrait.indexOf('--steps')), ['--width', '512', '--height', '768']);
});

test('SDCPP args keep negative prompt, CFG, scheduler and VAE', () => {
  const args = buildControlledArgs({ id: 'sdxl-base' }, { ...FULL_PARAMS, target: 'sdxl-base' }, {
    seedValue: 1, resolveVaePath: () => '/x/vae',
  });
  for (const flag of ['--negative-prompt', '--cfg', '--scheduler', '--vae']) {
    assert.ok(args.includes(flag), `${flag} missing from SDCPP args`);
  }
});

test('SDXL Turbo always sends cfg 1 and never a negative prompt (sd.cpp cfg 0 = unconditioned)', () => {
  const { buildControlledArgs } = require('../controlled-args');
  const spec = { id: 'sdxl-turbo', backend: 'sdcpp', fixedCfgScale: 1, noNegativePrompt: true };
  const args = buildControlledArgs(spec, { target: 'sdxl-turbo', prompt: 'p', negative_prompt: 'n', cfg_scale: 7, steps: 4 }, { seedValue: 1 });
  assert.equal(args[args.indexOf('--cfg') + 1], '1');
  assert.ok(!args.includes('--negative-prompt'));
});
