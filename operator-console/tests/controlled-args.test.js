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
  assert.deepEqual(p, { sampler: 'dpmpp2m', clip_skip: 2, tiling: true, restore_faces: false, eta: '', rng: '' });
  assert.deepEqual(CA.normalizeSamplingFields({}), { sampler: '', clip_skip: '', tiling: false, restore_faces: false, eta: '', rng: '' });
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

// ---- P05: eta, noise RNG and the wider sampler inventory ----
test('P05: eta and rng are normalised, validated against the effective sampler, and forwarded', () => {
  const n = CA.normalizeSamplingFields({ eta: '0.5', rng: 'CPU' });
  assert.equal(n.eta, 0.5); assert.equal(n.rng, 'cpu');
  assert.equal(CA.normalizeSamplingFields({ eta: '' }).eta, '');
  const photonic = { id: 'sdxl-photonic', backend: 'sdcpp', defaultSampler: 'dpm++2m' };
  const sd15 = { id: 'sd15', backend: 'sdcpp', defaultSampler: 'euler_a' };
  assert.equal(CA.validateSamplingFields(sd15, { eta: 0.5 }), null, 'default euler_a honours eta');
  assert.equal(CA.validateSamplingFields(photonic, { sampler: 'er_sde', eta: 1 }), null);
  assert.match(CA.validateSamplingFields(photonic, { eta: 0.5 }), /eta has no effect with the dpmpp2m sampler/);
  assert.match(CA.validateSamplingFields(photonic, { sampler: 'heun', eta: 0.5 }), /eta has no effect with the heun/);
  assert.match(CA.validateSamplingFields(sd15, { eta: 3 }), /Invalid eta/);
  assert.match(CA.validateSamplingFields(sd15, { eta: -1 }), /Invalid eta/);
  assert.match(CA.validateSamplingFields(sd15, { eta: NaN }), /Invalid eta/);
  assert.match(CA.validateSamplingFields(sd15, { rng: 'gpu' }), /Unknown noise RNG/);
  assert.equal(CA.validateSamplingFields(sd15, { rng: 'cpu' }), null);
  assert.match(CA.validateSamplingFields(KLEIN, { eta: 0.5 }), /no noise multiplier/);
  assert.match(CA.validateSamplingFields(KLEIN, { rng: 'cpu' }), /noise RNG/);
  assert.match(CA.validateSamplingFields({ id: 'flux-fp8', backend: 'sdcpp', defaultSampler: 'euler' }, { eta: 1, sampler: 'euler_a' }), /Schnell/);
  const base = { target: 'sd15', prompt: 'p', width: 512, height: 512, steps: 10, save_prompts: false };
  const args = CA.buildControlledArgs(sd15, { ...base, eta: 0.25, rng: 'cpu' }, { seedValue: 1 });
  assert.equal(args[args.indexOf('--eta') + 1], '0.25'); assert.equal(args[args.indexOf('--rng') + 1], 'cpu');
  for (const f of ['--eta', '--rng']) assert.equal(CA.buildControlledArgs(sd15, { ...base, eta: '', rng: '' }, { seedValue: 1 }).includes(f), false, f);
  for (const f of ['--eta', '--rng']) assert.equal(CA.buildControlledArgs(KLEIN, { ...FULL_PARAMS, eta: 1, rng: 'cpu' }, { seedValue: 1 }).includes(f), false, 'MFLUX never gets ' + f);
});

test('P05: eta-capable samplers match what sd-cli documents; the shell worker accepts eta/rng', () => {
  assert.deepEqual([...CA.ETA_SAMPLERS].sort(), ['ddim_trailing', 'dpmpp2s_a', 'er_sde', 'euler_a', 'res_2s', 'res_multistep', 'tcd']);
  for (const id of CA.ETA_SAMPLERS) assert.ok(CA.SDCLI_SAMPLER[id], id + ' is a runnable sampler');
  for (const f of ['--eta)', '--rng)']) assert.ok(SCRIPT.includes(f), f);
  assert.match(SCRIPT, /--rng must be cuda\|cpu\|std_default/);
  const D = require('../public/dexdiffusion/client-helpers.js');
  assert.deepEqual([...D.ETA_SAMPLERS].sort(), [...CA.ETA_SAMPLERS].sort());
  assert.deepEqual(D.RNG_CHOICES.map(c => c[0]).filter(Boolean).sort(), [...CA.RNG_SOURCES].filter(x => x !== 'cuda').sort());
  assert.equal(D.controlsFor({ backend: 'sdcpp' }).eta, true); assert.equal(D.controlsFor({ backend: 'mflux' }).rng, false);
});

test('P05: the UI scheduler choices are all accepted by the server', () => {
  const D = require('../public/dexdiffusion/client-helpers.js');
  const s = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const m = s.match(/const ALLOWED_SCHEDULERS = new Set\(\[([^\]]+)\]\)/);
  const allowed = m[1].split(',').map(x => x.trim().replace(/'/g, ''));
  for (const [id] of D.SCHEDULER_CHOICES) assert.ok(allowed.includes(id), id);
});
