'use strict';
// Truthful edit model (2026-10-16): the edit workers always load sdcpp.env REMOTE_MODEL (SD1.5), whatever the secondary slot
// holds. Lineage recorded the slot (nine live SD1.5 edits were labelled sdxl-photonic) and Edit offered other checkpoints that
// were silently ignored. Edit now runs on, and records, the worker's model.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const E = require('../public/dexdiffusion/edit-core.js');
const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');

test('recall: Edit runs on the edit worker model even when the source came from another checkpoint', () => {
  const targets = [{ id: 'sd15', backend: 'sdcpp' }, { id: 'sdxl-photonic', backend: 'sdcpp', label: 'Photonic' }];
  const st = E.applyRecallToEdit({ imageId: 'a.png', recorded: true, params: { target: 'sdxl-photonic', seed: 1 } }, { targets, activeSecondary: 'sdxl-photonic', editWorker: 'sd15' });
  assert.equal(st.editModel, 'sd15');
  assert.ok(st.notes.some(n => /Edit runs on sd15 .*source was made with Photonic/.test(n)), JSON.stringify(st.notes));
  const legacy = E.applyRecallToEdit({ imageId: 'a.png', recorded: true, params: { target: 'sdxl-photonic' } }, { targets, activeSecondary: 'sdxl-photonic' });
  assert.equal(legacy.editModel, 'sdxl-photonic', 'without the worker fact the old behaviour is unchanged');
});

test('server: editWorkerTarget maps sdcpp.env REMOTE_MODEL to its target, and editGenRecord records it instead of the slot', () => {
  const start = source.indexOf('function editWorkerTarget(');
  const ctx = { path, readSdcppEnv: () => '/Volumes/wc2tb/ImageGen/checkpoints/sd15/v1-5-pruned-emaonly.safetensors',
    CONTROLLED_TARGETS: [{ id: 'sdxl-photonic', modelFile: 'photonic_fusion_sdxl_finale_v1.safetensors' }, { id: 'sd15', modelFile: 'v1-5-pruned-emaonly.safetensors' }, { id: 'sd15-alias', aliasOf: 'sd15', modelFile: 'v1-5-pruned-emaonly.safetensors' }],
    assetCache: { activeSecondaryModel: 'sdxl-photonic' }, EC: { canonicalSampler: s => s } };
  const fns = vm.runInNewContext(source.slice(start, source.indexOf('\n}\n', source.indexOf('function editGenRecord(')) + 3) + '\n({ editWorkerTarget, editGenRecord })', ctx);
  assert.equal(fns.editWorkerTarget(), 'sd15');
  assert.equal(fns.editGenRecord({}, { save_prompts: false, sampler: 'euler_a' }).edit_target, 'sd15');
  ctx.CONTROLLED_TARGETS = [{ id: 'sd15' }, { id: 'sd15-auto-v1-5-pruned-emaonly', aliasOf: 'sd15', modelFile: 'v1-5-pruned-emaonly.safetensors' }];
  assert.equal(fns.editWorkerTarget(), 'sd15', 'the real catalogue only names the file on the alias; the canonical id is reported');
});
