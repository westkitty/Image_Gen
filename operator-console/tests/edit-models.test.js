'use strict';
// Edit model selection: img2img / inpaint / outpaint / scripts can run on any single-file SD 1.5 or SDXL checkpoint, chosen
// per request by target id and resolved server-side to an approved --model-path. FLUX (split or MFLUX) is refused.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const EM = require('../edit-models');
const { resolveTargetFamily } = require('../extra-networks');

const TARGETS = {
  sd15: { id: 'sd15', backend: 'sdcpp', label: 'SD1.5' },
  'sd15-auto-v1-5-pruned-emaonly': { id: 'sd15-auto-v1-5-pruned-emaonly', backend: 'sdcpp', aliasOf: 'sd15' },
  'sdxl-photonic': { id: 'sdxl-photonic', backend: 'sdcpp', label: 'Photonic' },
  'sdxl-pony': { id: 'sdxl-pony', backend: 'sdcpp' },
  'sdxl-juggernaut': { id: 'sdxl-juggernaut', backend: 'sdcpp', status: 'broken' },
  'flux-fp8': { id: 'flux-fp8', backend: 'sdcpp' },
  'flux2-klein-4b': { id: 'flux2-klein-4b', backend: 'mflux' },
  'sdxl-evil': { id: 'sdxl-evil', backend: 'sdcpp' },
};
const MODELS = {
  sd15: '/Volumes/wc2tb/ImageGen/checkpoints/sd15/v1-5-pruned-emaonly.safetensors',
  'sdxl-photonic': '$HOME/sdcpp-staging/models/photonic_fusion_sdxl_finale_v1.safetensors',
  'sdxl-pony': '/Volumes/wc2tb/dex-imagegen/models/checkpoints/ponyDiffusionV6XL_v6StartWithThisOne.safetensors',
  'sdxl-juggernaut': '/Volumes/wc2tb/dex-imagegen/models/checkpoints/juggernautXL_ragnarok.safetensors',
  'flux-fp8': '$HOME/sdcpp-staging/models/flux1-schnell-fp8.safetensors',
  'sdxl-evil': '/tmp/../etc/x.safetensors',
};
const opts = { targets: TARGETS, targetModels: MODELS, familyOf: resolveTargetFamily, workerTarget: 'sd15' };

test('empty or worker edit_model keeps the configured worker model with no override', () => {
  assert.deepEqual(EM.resolveEditModel('', opts), { target: 'sd15', args: [] });
  assert.deepEqual(EM.resolveEditModel(undefined, opts), { target: 'sd15', args: [] });
  assert.deepEqual(EM.resolveEditModel('sd15', opts), { target: 'sd15', args: [] });
  assert.deepEqual(EM.resolveEditModel('sd15-auto-v1-5-pruned-emaonly', opts), { target: 'sd15', args: [] }, 'an alias of the worker model needs no override');
});

test('SDXL-family checkpoints resolve to a server-owned --model-path', () => {
  assert.deepEqual(EM.resolveEditModel('sdxl-photonic', opts), { target: 'sdxl-photonic', args: ['--model-path', MODELS['sdxl-photonic']] });
  assert.deepEqual(EM.resolveEditModel('sdxl-pony', opts), { target: 'sdxl-pony', args: ['--model-path', MODELS['sdxl-pony']] });
});

test('FLUX, broken, unknown, malformed and unapproved paths are refused', () => {
  assert.match(EM.resolveEditModel('flux2-klein-4b', opts).error, /Reference edit/);
  assert.match(EM.resolveEditModel('flux-fp8', opts).error, /single-file/);
  assert.match(EM.resolveEditModel('sdxl-juggernaut', opts).error, /broken/);
  assert.equal(EM.resolveEditModel('nope', opts).status, 400);
  assert.equal(EM.resolveEditModel('../../x', opts).status, 400);
  assert.match(EM.resolveEditModel('sdxl-evil', opts).error, /approved checkpoint root/);
});

test('editModelIds lists exactly the loadable targets', () => {
  assert.deepEqual(EM.editModelIds(TARGETS, { targetModels: MODELS, familyOf: resolveTargetFamily }).sort(),
    ['sd15', 'sd15-auto-v1-5-pruned-emaonly', 'sdxl-photonic', 'sdxl-pony'].sort());
});

test('the approved-root pattern matches the edit workers\' own --model-path check', () => {
  for (const script of ['sdcpp-img2img.sh', 'sdcpp-inpaint.sh']) {
    const src = fs.readFileSync(path.join(__dirname, '../../sdcpp-workflow/bin', script), 'utf8');
    assert.match(src, /--model-path\) ARG_MODEL_PATH="\$\{2:\?\}"/, script + ' parses --model-path');
    const re = /grep -Eq '([^']+)'/.exec(src.slice(src.indexOf('ARG_MODEL_PATH:-')));
    assert.ok(re, script + ' validates --model-path');
    const shellRe = new RegExp(re[1]);
    for (const p of Object.values(MODELS).filter(x => !x.includes('..'))) assert.equal(shellRe.test(p), EM.APPROVED_CHECKPOINT.test(p), script + ' ' + p);
    execFileSync('bash', ['-n', path.join(__dirname, '../../sdcpp-workflow/bin', script)]);
  }
});

test('server: every edit route resolves edit_model before running and passes its args to the worker', () => {
  const src = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  assert.equal((src.match(/const editModel = resolveEditModelFor\(body\);/g) || []).length, 3, 'img2img, inpaint and outpaint');
  assert.equal((src.match(/args\.push\(\.\.\.editModel\.args\);/g) || []).length, 4, 'three routes plus the request preview');
  assert.match(src, /editModels: EditModels\.editModelIds\(/);
  assert.match(src, /body\.__editTarget \|\| editWorkerTarget\(\)/, 'lineage names the model that ran');
  const chains = fs.readFileSync(path.join(__dirname, '../script-chains.js'), 'utf8');
  assert.match(chains, /D\.resolveEditModelFor\(body\)/);
  assert.match(chains, /args\.push\(\.\.\.p\.modelArgs\)/);
});
