'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { resolveLoraRuntimePolicy, routesFor, ADAPTERS } = require('../lora-runtime-policy');
const SourceInfo = require('../source-info');
const { buildLoraCards } = require('../extra-networks');
const { buildControlledArgs } = require('../controlled-args');

const ARCHIVE = path.join(__dirname, '..', 'source-archive');
// The text archive (descriptions copied from third-party pages) is kept out of the public git repo; only lora-catalog.json is tracked.
const HAS_ARCHIVE = fs.existsSync(path.join(ARCHIVE, 'loras'));

test('archive: every catalog LoRA and every model card has an archived text file', { skip: !HAS_ARCHIVE }, () => {
  const cat = JSON.parse(fs.readFileSync(path.join(ARCHIVE, 'lora-catalog.json'), 'utf8'));
  assert.equal(cat.length, 20);
  for (const c of cat) {
    const j = JSON.parse(fs.readFileSync(path.join(ARCHIVE, 'loras', c.slug + '.json'), 'utf8'));
    assert.ok(j.civitai && j.civitai.description !== undefined && j.civitai.source.url.startsWith('https://civitai.com/models/'), c.slug);
  }
  const { MODEL_CARDS } = require('../model-registry');
  for (const card of MODEL_CARDS) assert.ok(fs.existsSync(path.join(ARCHIVE, 'models', card.id.replace(/[^a-z0-9._-]/gi, '_') + '.json')), card.id);
});

test('archive: no credential material is stored', { skip: !HAS_ARCHIVE }, () => {
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  for (const f of walk(ARCHIVE)) assert.ok(!/[?&]token=|Authorization|Bearer /i.test(fs.readFileSync(f, 'utf8')), f);
});

test('source-info: hover payload has source link, triggers and randomize data', { skip: !HAS_ARCHIVE }, () => {
  const lora = SourceInfo.getInfo('lora', 'klein_anatomy_male_klein4b');
  assert.ok(lora.source_url.startsWith('https://civitai.com/models/2364523'));
  assert.ok(lora.sources.some(s => s.label === 'Hugging Face'));
  assert.deepEqual(lora.trigger_words, ['circumcised penis', 'uncut penis']);
  assert.equal(lora.recommended_weight, 0.6);
  const model = SourceInfo.getInfo('model', 'flux2-klein-4b');
  assert.ok(model.source_url.startsWith('https://huggingface.co/'));
  assert.equal(SourceInfo.getInfo('model', 'nope'), null);
});

test('staged LoRAs: only gate-passed klein_4b and sdxl files are offered', () => {
  const names = SourceInfo.stagedLoraAssets().map(a => a.filename);
  assert.equal(names.length, 12);
  assert.ok(!names.some(n => /klein9|aesthetic|party_time|real_penis|^sdxl_gay_porn/.test(n)));
  for (const n of names) assert.ok(ADAPTERS[n.replace(/\.safetensors$/, '')], n);
});

test('policy: Klein 4B plain adapter routes through mflux with its strength; SDXL style only on SDXL', () => {
  const k = resolveLoraRuntimePolicy({ target: 'flux2-klein-4b', loras: [{ name: 'klein_anatomy_male_klein4b', weight: 0.6 }] });
  assert.equal(k.ok, true);
  assert.equal(k.route.mflux_lora_plain, true);
  assert.equal(resolveLoraRuntimePolicy({ target: 'flux2-klein-4b', loras: [{ name: 'klein_anatomy_male_klein4b', weight: 9 }] }).ok, false);
  assert.equal(resolveLoraRuntimePolicy({ target: 'sdxl-base', loras: [{ name: 'klein_anatomy_male_klein4b', weight: 0.6 }] }).ok, false);
  assert.equal(resolveLoraRuntimePolicy({ target: 'sdxl-juggernaut', loras: [{ name: 'sdxl_uncut_penis_sdxl', weight: 0.7 }] }).ok, true);
  assert.equal(resolveLoraRuntimePolicy({ target: 'flux2-klein-4b', loras: [{ name: 'sdxl_uncut_penis_sdxl', weight: 0.7 }] }).ok, false);
  assert.equal(resolveLoraRuntimePolicy({ target: 'flux2-klein-4b', loras: [{ name: 'a_klein4b', weight: 1 }, { name: 'b', weight: 1 }] }).ok, false);
  assert.ok(routesFor('flux2-klein-4b', 'klein_anatomy_male_klein4b.safetensors')[0].plain);
});

test('cards: staged LoRAs carry triggers, weight bounds, untested flag and a usable route', () => {
  const assets = SourceInfo.stagedLoraAssets().map(a => Object.assign({}, a, { production_routes: routesFor('flux2-klein-4b', a.filename) }));
  const cards = buildLoraCards(assets, 'flux2-klein-4b');
  const c = cards.find(x => x.name === 'klein_anatomy_male_klein4b');
  assert.equal(c.compatibility, 'Compatible');
  assert.equal(c.plain_mflux, true);
  assert.equal(c.untested, true);
  assert.equal(c.default_weight, 0.6);
  assert.ok(c.trigger_words.includes('uncut penis'));
  assert.equal(c.source_url.startsWith('https://civitai.com/'), true);
  const sd = buildLoraCards(assets, 'flux2-klein-4b').find(x => x.name === 'sdxl_uncut_penis_sdxl');
  assert.notEqual(sd.compatibility, 'Compatible');
});

test('args: the plain mflux adapter is forwarded to the generator, nothing else changes', () => {
  assert.equal(typeof buildControlledArgs, 'function');
  const spec = { id: 'flux2-klein-4b', backend: 'mflux' };
  const base = { target: 'flux2-klein-4b', prompt: 'x', width: 1024, height: 1024, steps: 4, seed: 1, cfg_scale: 1, save_prompts: false };
  const withLora = buildControlledArgs(spec, Object.assign({}, base, { mflux_lora_id: 'klein_anatomy_male_klein4b', mflux_lora_strength: 0.6, mflux_lora_plain: true }));
  const i = withLora.indexOf('--lora-id');
  assert.ok(i >= 0 && withLora[i + 1] === 'klein_anatomy_male_klein4b' && withLora[i + 3] === '0.6');
  assert.ok(!buildControlledArgs(spec, base).includes('--lora-id'));
});

test('stacks: staged adapters combine (max 4, weight sum 1.8, slider not counted); nothing else does', () => {
  const k = (n, w) => ({ name: n, weight: w });
  const run = (target, loras) => resolveLoraRuntimePolicy({ target, loras });
  const ok = run('flux2-klein-4b', [k('klein_anatomy_fixer_klein4b', 2.5), k('klein_anatomy_male_klein4b', 0.6), k('klein_fixes_nsfw_klein4b', 0.5)]);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.route.mflux_loras.map(l => l.id), ['klein_anatomy_fixer_klein4b', 'klein_anatomy_male_klein4b', 'klein_fixes_nsfw_klein4b']);
  assert.match(run('flux2-klein-4b', [k('klein_anatomy_male_klein4b', 1), k('klein_fixes_nsfw_klein4b', 1)]).error, /1\.8/);
  assert.match(run('flux2-klein-4b', [k('klein_anatomy_male_klein4b', .3), k('klein_anatomy_male_klein4b', .3)]).error, /more than once/);
  assert.equal(run('flux2-klein-4b', [k('klein_anatomy_male_klein4b', .1), k('klein_fixes_nsfw_klein4b', .1), k('klein_ultimate_blowjob_klein4b', .1), k('klein_anatomy_fixer_klein4b', 2), k('klein_anatomy_male_klein4b', .1)]).ok, false);
  assert.equal(run('flux2-klein-4b', [k('klein_anatomy_male_klein4b', .3), k('pixelart_lora', .5)]).ok, false);
  assert.equal(run('flux2-klein-4b', [k('klein_anatomy_male_klein4b', .3), k('sdxl_uncut_penis_sdxl', .3)]).ok, false);
  assert.equal(run('sdxl-juggernaut', [k('sdxl_uncut_penis_sdxl', .7), k('sdxl_better_male_face_sdxl', .5)]).route.lora_apply_mode, 'at_runtime');
  assert.equal(run('sdxl-base', [k('sdxl_uncut_penis_sdxl', .7), k('sdxl_lightning_4step_lora', 1)]).ok, false);
  assert.equal(run('sdxl-base', [k('klein_anatomy_male_klein4b', .3), k('klein_fixes_nsfw_klein4b', .3)]).ok, false);
});

test('args: a stack is forwarded as paired lists; one adapter keeps the single-adapter flags', () => {
  const spec = { id: 'flux2-klein-4b', backend: 'mflux' };
  const base = { target: 'flux2-klein-4b', prompt: 'x', width: 1024, height: 1024, steps: 4, seed: 1, cfg_scale: 1, save_prompts: false, mflux_lora_plain: true };
  const a = buildControlledArgs(spec, Object.assign({}, base, { mflux_loras: [{ id: 'a', strength: 0.5 }, { id: 'b', strength: 0.25 }] }));
  assert.equal(a[a.indexOf('--lora-ids') + 1], 'a,b');
  assert.equal(a[a.indexOf('--lora-strengths') + 1], '0.5,0.25');
  assert.ok(!a.includes('--lora-id'));
});
