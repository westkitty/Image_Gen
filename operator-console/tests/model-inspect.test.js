'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const { createModelInspector, agreement, pathAllowed, familyFromArch } = require('../model-inspect');
const { inferAssetFamily, buildLoraCards, FAMILIES } = require('../extra-networks');

const SCRIPT = path.join(__dirname, '..', '..', 'sdcpp-workflow', 'bin', 'safetensors-inspect.py');

// Build a small valid safetensors file: tensors = { name: [dtype, shape] }, optional __metadata__.
function writeSafetensors(file, tensors, metadata, { truncate = false } = {}) {
  const header = {}; let off = 0;
  const size = { F16: 2, F32: 4, I64: 8 };
  for (const [name, [dtype, shape]] of Object.entries(tensors)) {
    const n = shape.reduce((a, b) => a * b, 1) * size[dtype];
    header[name] = { dtype, shape, data_offsets: [off, off + n] }; off += n;
  }
  if (metadata) header.__metadata__ = metadata;
  const hb = Buffer.from(JSON.stringify(header));
  const len = Buffer.alloc(8); len.writeBigUInt64LE(BigInt(hb.length));
  fs.writeFileSync(file, Buffer.concat([len, hb, Buffer.alloc(truncate ? Math.max(0, off - 4) : off)]));
}
const inspect = file => JSON.parse(spawnSync('python3', [SCRIPT, file], { encoding: 'utf8' }).stdout.trim());

test('header inspector recognises SD1.5, SDXL, FLUX, LoRA, embedding and VAE layouts', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'st-'));
  const f = n => path.join(dir, n);
  writeSafetensors(f('sd15.safetensors'), { 'cond_stage_model.transformer.text_model.a': ['F32', [2]], 'model.diffusion_model.x': ['F32', [2]], 'first_stage_model.y': ['F32', [2]] });
  writeSafetensors(f('sdxl.safetensors'), { 'conditioner.embedders.1.model.a': ['F16', [2]], 'conditioner.embedders.0.transformer.b': ['F16', [2]], 'model.diffusion_model.x': ['F16', [2]] });
  writeSafetensors(f('flux.safetensors'), { 'double_blocks.0.a': ['F16', [2]], 'single_blocks.0.a': ['F16', [2]] });
  writeSafetensors(f('lora15.safetensors'), { 'lora_unet_down_blocks_0.lora_down.weight': ['F16', [2]], 'lora_te_text_model.lora_up.weight': ['F16', [2]] },
    { ss_base_model_version: 'sd_v1', ss_tag_frequency: JSON.stringify({ ds: { fluffy: 40, cat: 10, rare: 1 } }) });
  writeSafetensors(f('loraxl.safetensors'), { 'lora_te1_text_model.lora_down.weight': ['F16', [2]], 'lora_te2_text_model.lora_up.weight': ['F16', [2]], 'lora_unet_a.lora_down.weight': ['F16', [2]] }, { ss_base_model_version: 'sdxl_base_v1-0' });
  writeSafetensors(f('emb15.safetensors'), { emb_params: ['F32', [4, 768]] });
  writeSafetensors(f('embxl.safetensors'), { clip_l: ['F32', [4, 768]], clip_g: ['F32', [4, 1280]] });
  writeSafetensors(f('vae.safetensors'), { 'first_stage_model.encoder.a': ['F32', [2]] });
  const got = Object.fromEntries(['sd15', 'sdxl', 'flux', 'lora15', 'loraxl', 'emb15', 'embxl', 'vae'].map(n => [n, inspect(f(n + '.safetensors'))]));
  assert.deepEqual([got.sd15.kind, got.sd15.arch, got.sd15.embedded_vae], ['checkpoint', 'sd15', true]);
  assert.deepEqual([got.sdxl.kind, got.sdxl.arch, got.sdxl.embedded_vae], ['checkpoint', 'sdxl', false]);
  assert.deepEqual([got.flux.kind, got.flux.arch], ['checkpoint', 'flux']);
  assert.deepEqual([got.lora15.kind, got.lora15.arch], ['lora', 'sd1x']);
  assert.deepEqual(got.lora15.trigger_candidates, ['fluffy', 'cat', 'rare']);
  assert.deepEqual([got.loraxl.kind, got.loraxl.arch], ['lora', 'sdxl']);
  assert.deepEqual([got.emb15.kind, got.emb15.arch], ['embedding', 'sd15']);
  assert.deepEqual([got.embxl.kind, got.embxl.arch], ['embedding', 'sdxl']);
  assert.equal(got.vae.kind, 'vae');
  assert.deepEqual(got.sdxl.dtypes, { F16: 3 });
  assert.equal(got.sd15.truncated, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('header inspector flags truncated files, junk headers and metadata/layout disagreement', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'st-'));
  writeSafetensors(path.join(dir, 't.safetensors'), { 'cond_stage_model.transformer.x': ['F32', [64]] }, null, { truncate: true });
  assert.equal(inspect(path.join(dir, 't.safetensors')).truncated, true);
  fs.writeFileSync(path.join(dir, 'junk.safetensors'), Buffer.from('not a safetensors file at all'));
  assert.match(inspect(path.join(dir, 'junk.safetensors')).error, /implausible header length/);
  writeSafetensors(path.join(dir, 'liar.safetensors'), { 'lora_te_text_model.lora_down.weight': ['F16', [2]], 'lora_unet_a.lora_up.weight': ['F16', [2]] }, { ss_base_model_version: 'sdxl_base_v1-0' });
  assert.equal(inspect(path.join(dir, 'liar.safetensors')).arch, 'sd1x');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('agreement: name vs header, SDXL-family cousins count as the same architecture', () => {
  assert.equal(agreement('sd_xl_base_1.0.safetensors', 'sdxl').state, 'match');
  assert.equal(agreement('ponyDiffusionV6XL.safetensors', 'sdxl').state, 'match');
  assert.equal(agreement('sdxl_lightning_4step.safetensors', 'sdxl').state, 'match');
  assert.equal(agreement('my_sd15_thing.safetensors', 'sdxl').state, 'mismatch');
  assert.equal(agreement('mystery.safetensors', 'sdxl').state, 'header-only');
  assert.equal(agreement('x.safetensors', 'weird').state, 'unknown');
});

test('inferAssetFamily: "dev" must be a word, not a substring', () => {
  assert.equal(inferAssetFamily('flux1-dev.safetensors'), FAMILIES.FLUX1);
  assert.equal(inferAssetFamily('flux_dev_lora.safetensors'), FAMILIES.FLUX1);
  assert.notEqual(inferAssetFamily('developer_style_sdxl.safetensors'), FAMILIES.FLUX1);
  assert.notEqual(inferAssetFamily('devil_sd15.safetensors'), FAMILIES.FLUX1);
});

test('cards prefer the header family over the filename guess and say so', () => {
  const [c] = buildLoraCards([{ filename: 'devil_style.safetensors', header_family: 'sdxl', header_triggers: ['devil'] }], 'sdxl-base');
  assert.equal(c.family, 'sdxl'); assert.equal(c.compatibility, 'Compatible'); assert.equal(c.family_source, 'header');
  assert.deepEqual(c.trigger_words, ['devil']); assert.match(c.trigger_source, /candidates/);
  assert.equal(buildLoraCards([{ filename: 'plain_sd15_lora.safetensors' }], 'sd15')[0].family_source, 'filename');
  assert.equal(familyFromArch('sd1x'), 'sd15');
});

test('inspector caches by path+size, enforces the path allowlist and rejects size drift', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'st-'));
  let calls = 0;
  const run = async paths => { calls++; return paths.map(p => ({ path: p, bytes: 100, kind: 'checkpoint', arch: 'sdxl', dtypes: { F16: 1 }, truncated: false, embedded_vae: true })); };
  const insp = createModelInspector({ cacheFile: path.join(dir, 'h.json'), run });
  const good = { path: '/Volumes/wc2tb/ImageGen/checkpoints/sdxl/a.safetensors', size_bytes: 100, filename: 'sdxl_a.safetensors' };
  const evil = { path: '/etc/passwd', size_bytes: 1, filename: 'x' };
  const dotdot = { path: '/Volumes/wc2tb/ImageGen/../../etc/x', size_bytes: 1, filename: 'x' };
  let out = await insp.inspect([good, evil, dotdot]);
  assert.equal(out.length, 1); assert.equal(out[0].agreement.state, 'match'); assert.equal(calls, 1);
  await insp.inspect([good]); assert.equal(calls, 1, 'cached');
  await insp.inspect([good], { refresh: true }); assert.equal(calls, 2);
  out = await insp.inspect([{ ...good, size_bytes: 999 }]);
  assert.match(out[0].error, /differs from the catalog/);
  assert.equal(pathAllowed('/Users/bigmac/sdcpp-staging/models/a b.safetensors'), true);
  assert.equal(pathAllowed('/Users/bigmac/.ssh/id_rsa'), false);
  const again = createModelInspector({ cacheFile: path.join(dir, 'h.json'), run });
  assert.ok(again.cached(good.path, 100), 'cache survives a restart');
  fs.rmSync(dir, { recursive: true, force: true });
});
