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


test('FLUX.1 Schnell fixes CFG at 1, drops negative prompts, and stays on SDCPP', () => {
  const spec = { id: 'flux-fp8', backend: 'sdcpp', fixedCfgScale: 1, noNegativePrompt: true };
  const args = buildControlledArgs(spec, { target: 'flux-fp8', prompt: 'p', negative_prompt: 'n', cfg_scale: 3.5, steps: 4 }, { seedValue: 1 });
  assert.equal(controlledScriptFor(spec), 'bin/sdcpp-controlled-generate.sh');
  assert.equal(args[args.indexOf('--cfg') + 1], '1');
  assert.ok(!args.includes('--negative-prompt'));
});

// ---- P02: sampling-field contract (UI -> normalized request -> worker args) ----
const CA = require('../controlled-args');
const SDXL = { id: 'sdxl-photonic', backend: 'sdcpp', defaultSampler: 'dpm++2m' };
const KLEIN = { id: 'flux2-klein-4b', backend: 'mflux', defaultSampler: 'euler' };
const SCRIPT = fs.readFileSync(path.join(__dirname, '..', '..', 'sdcpp-workflow', 'bin', 'sdcpp-controlled-generate.sh'), 'utf8');

test('P02: normalizeSamplingFields keeps sampler, clip_skip, tiling and restore_faces (they were silently dropped)', () => {
  const p = CA.normalizeSamplingFields({ sampler: 'dpmpp2m', clip_skip: '2', tiling: true, restore_faces: false });
  assert.deepEqual(p, { sampler: 'dpmpp2m', clip_skip: 2, tiling: true, restore_faces: false });
  assert.deepEqual(CA.normalizeSamplingFields({}), { sampler: '', clip_skip: '', tiling: false, restore_faces: false });
});

test('P02: sampler spellings from the UI canonicalise to one id', () => {
  for (const s of ['dpm++2m', 'DPM++ 2M', 'dpmpp2m']) assert.equal(CA.canonicalSampler(s), 'dpmpp2m', s);
  assert.equal(CA.canonicalSampler('Euler a'), 'euler_a');
  assert.equal(CA.canonicalSampler('euler'), 'euler');
  assert.equal(CA.canonicalSampler(''), '');
});

test('P02: two different samplers produce two different, correct worker arguments', () => {
  const base = { target: 'sdxl-photonic', prompt: 'p', width: 1024, height: 1024, steps: 20, cfg_scale: 6, save_prompts: false };
  const a = CA.buildControlledArgs(SDXL, { ...base, sampler: 'euler_a' }, { seedValue: 1 });
  const b = CA.buildControlledArgs(SDXL, { ...base, sampler: 'dpmpp2m' }, { seedValue: 1 });
  assert.equal(a[a.indexOf('--sampler') + 1], 'euler_a');
  assert.equal(b[b.indexOf('--sampler') + 1], 'dpmpp2m');
  assert.notDeepEqual(a, b);
});

test('P02: clip_skip and tiling reach the SDCPP worker; unset values add nothing', () => {
  const base = { target: 'sdxl-photonic', prompt: 'p', width: 1024, height: 1024, steps: 20, save_prompts: false };
  const args = CA.buildControlledArgs(SDXL, { ...base, clip_skip: 2, tiling: true }, { seedValue: 1 });
  assert.equal(args[args.indexOf('--clip-skip') + 1], '2');
  assert.ok(args.includes('--tiling'));
  const none = CA.buildControlledArgs(SDXL, { ...base, sampler: '', clip_skip: '', tiling: false }, { seedValue: 1 });
  for (const f of ['--sampler', '--clip-skip', '--tiling']) assert.equal(none.includes(f), false, f);
});

test('P02: unsupported sampling settings are rejected before inference, never ignored', () => {
  assert.match(CA.validateSamplingFields(SDXL, { sampler: 'lms' }), /not supported by the installed stable-diffusion\.cpp/);
  assert.match(CA.validateSamplingFields(SDXL, { sampler: 'nonsense' }), /Unknown sampler/);
  assert.match(CA.validateSamplingFields(SDXL, { restore_faces: true }), /Face restoration/);
  assert.match(CA.validateSamplingFields(SDXL, { clip_skip: 99 }), /clip_skip/);
  assert.equal(CA.validateSamplingFields(SDXL, { sampler: 'dpmpp2m', clip_skip: 2, tiling: true }), null);
  assert.match(CA.validateSamplingFields(KLEIN, { sampler: 'dpmpp2m' }), /fixed flow-match Euler/);
  assert.match(CA.validateSamplingFields(KLEIN, { tiling: true }), /tiling/);
  assert.match(CA.validateSamplingFields(KLEIN, { clip_skip: 2 }), /clip_skip/);
  assert.equal(CA.validateSamplingFields(KLEIN, { sampler: 'euler', clip_skip: '', tiling: false }), null);
});

test('P02: MFLUX never receives sampling flags', () => {
  const args = CA.buildControlledArgs(KLEIN, { ...FULL_PARAMS, sampler: 'euler', clip_skip: '', tiling: false }, { seedValue: 1 });
  for (const f of ['--sampler', '--clip-skip', '--tiling']) assert.equal(args.includes(f), false, f);
});

test('P02: the shell worker accepts the flags and its sampler table matches the JS table', () => {
  for (const f of ['--sampler)', '--clip-skip)', '--tiling)']) assert.ok(SCRIPT.includes(f), f);
  const m = SCRIPT.match(/# SAMPLER_TABLE_BEGIN\n([\s\S]*?)# SAMPLER_TABLE_END/);
  assert.ok(m, 'sampler table markers present');
  const shell = Object.fromEntries([...m[1].matchAll(/^\s*([a-z0-9_]+)\)\s+ARG_SAMPLER_CLI="([^"]+)"/gm)].map(x => [x[1], x[2]]));
  assert.deepEqual(shell, CA.SDCLI_SAMPLER);
});

test('P02: sdxl-base spec default sampler matches the worker default (no silent behaviour change)', () => {
  const s = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const block = s.slice(s.indexOf("id: 'sdxl-base'"), s.indexOf("id: 'sdxl-base'") + 1800);
  assert.match(block, /defaultSampler: 'dpm\+\+2m'/);
});

// ---- P03: Generate UI contract ----
test('P03: UI sampler choices equal the sampler table the worker accepts', () => {
  const D = require('../public/dexdiffusion/client-helpers.js');
  assert.deepEqual(D.SAMPLER_CHOICES.map(c => c[0]).sort(), Object.keys(CA.SDCLI_SAMPLER).sort());
  for (const [id] of D.SAMPLER_CHOICES) assert.equal(D.canonicalSamplerId(id), id);
  assert.equal(D.canonicalSamplerId('dpm++2m'), 'dpmpp2m');
  assert.equal(D.canonicalSamplerId('Euler a'), 'euler_a');
});

test('P03: controlsFor exposes sampler/clipSkip/tiling for SDCPP only', () => {
  const D = require('../public/dexdiffusion/client-helpers.js');
  const sd = D.controlsFor({ backend: 'sdcpp' }), mf = D.controlsFor({ backend: 'mflux' });
  assert.deepEqual([sd.sampler, sd.clipSkip, sd.tiling], [true, true, true]);
  assert.deepEqual([mf.sampler, mf.clipSkip, mf.tiling], [false, false, false]);
  assert.equal(D.controlsFor({ backend: 'sdcpp', capabilities: { tiling: false } }).tiling, false);
});
