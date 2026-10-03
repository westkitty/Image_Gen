'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../public/dexdiffusion/edit-core.js');

// ── resources ───────────────────────────────────────────────────────────
test('LoRA tags are parsed, stripped and re-serialized structurally', () => {
  const p = 'a cat <lora:style_a:0.8> on a mat <lora:detail:1.25>';
  assert.deepEqual(E.parseLoraTags(p).map(t => [t.name, t.weight]), [['style_a', 0.8], ['detail', 1.25]]);
  assert.equal(E.stripLoraTags(p), 'a cat on a mat');
  const r = E.resolveResources({ prompt: p });
  assert.equal(r.prompt, 'a cat on a mat');
  assert.equal(r.backendPrompt, 'a cat on a mat <lora:style_a:0.8> <lora:detail:1.25>');
});

test('structured loras win over prompt tags, weight 0 survives, filenames are normalised', () => {
  const r = E.resolveResources({ prompt: 'x <lora:a:0.5>', loras: [{ name: 'a.safetensors', weight: 0 }, { name: 'b' }] });
  assert.deepEqual(r.loras, [{ name: 'a', weight: 0 }, { name: 'b', weight: 1 }]);
  assert.equal(r.backendPrompt, 'x <lora:a:0> <lora:b:1>');
  assert.equal(E.resolveResources({ prompt: '', loras: [] }).backendPrompt, '');
});

test('lora compatibility is reported, never silently applied', () => {
  const cat = [{ name: 'pony_x', filename: 'pony_x.safetensors', family: 'pony' }, { name: 'sd15_y', filename: 'sd15_y.safetensors', family: 'sd15' }];
  const res = E.checkLoraCompat([{ name: 'sd15_y', weight: 1 }, { name: 'nope', weight: 1 }, { name: 'pony_x', weight: 1 }], cat, 'sdxl');
  assert.deepEqual(res.map(r => r.state), ['incompatible', 'unknown', 'ok']);
});

// ── recall: exact per-image parameters ──────────────────────────────────
const VIEW_A = { id: 'img-a.png', width: 768, height: 512, runId: 'run-a', meta: { operation: 'txt2img', target: 'sdxl-base', seed: 111, steps: 31, cfg: 5.5, sampler: 'dpmpp2m', scheduler: 'karras', vae: 'vae-x.safetensors', preset: 'quality', loras: [{ name: 'style_a', weight: 0.7 }], gen_schema: 1, prompt_saved: false } };
const TARGETS = [{ id: 'sdxl-base', label: 'SDXL base', backend: 'sdcpp' }, { id: 'flux2-klein-4b', label: 'FLUX.2', backend: 'mflux' }];

test('buildRecall carries every recorded value of THIS image', () => {
  const r = E.buildRecall(VIEW_A);
  assert.equal(r.schema, E.RECALL_SCHEMA);
  assert.equal(r.imageId, 'img-a.png');
  assert.deepEqual({ ...r.params, loras: undefined }, { target: 'sdxl-base', seed: 111, width: 768, height: 512, steps: 31, cfg: 5.5, sampler: 'dpmpp2m', scheduler: 'karras', vae: 'vae-x.safetensors', preset: 'quality', loras: undefined });
  assert.deepEqual(r.params.loras, [{ name: 'style_a', weight: 0.7 }]);
  assert.deepEqual(r.missing, ['strength']);
  assert.equal(r.recorded, true);
});

test('privacy off: prompt unavailable is explicit, never substituted', () => {
  const r = E.buildRecall(VIEW_A);
  assert.equal(r.prompt.available, false);
  assert.match(r.prompt.reason, /Source prompt unavailable — prompt saving was off/);
});

test('privacy on: stored prompt is recalled', () => {
  const r = E.buildRecall({ ...VIEW_A, meta: { ...VIEW_A.meta, prompt: 'a red fox', negative_prompt: 'blurry', prompt_saved: true } });
  assert.deepEqual([r.prompt.available, r.prompt.text, r.prompt.negative], [true, 'a red fox', 'blurry']);
});

test('Edit state is built from the image recall, never from the Create form', () => {
  const recall = E.buildRecall(VIEW_A);
  // The function has no access to Create state by construction; verify the output is the source's.
  const st = E.applyRecallToEdit(recall, { op: 'inpaint', targets: TARGETS });
  assert.equal(st.sourceImageId, 'img-a.png');
  assert.equal(st.op, 'inpaint');
  assert.equal(st.editModel, 'sdxl-base');
  assert.equal(st.params.seed, 111); assert.equal(st.params.steps, 31); assert.equal(st.params.cfg, 5.5);
  assert.equal(st.params.sampler, 'dpmpp2m'); assert.equal(st.params.scheduler, 'karras'); assert.equal(st.params.vae, 'vae-x.safetensors');
  assert.deepEqual(st.loras, [{ name: 'style_a', weight: 0.7 }]);
  assert.equal(st.prompt, '');
  assert.equal(st.promptStatus.available, false);
  assert.match(st.promptStatus.message, /prompt saving was off/);
});

test('session snapshot supplies sensitive text only for the same image', () => {
  const recall = E.buildRecall(VIEW_A);
  const snap = E.snapshotFromRequest({ prompt: 'secret <lora:style_a:0.7>', negative_prompt: 'neg', loras: [] }, 'img-a.png', 111);
  const withSnap = E.applyRecallToEdit(recall, { snapshot: snap, targets: TARGETS });
  assert.equal(withSnap.prompt, 'secret');
  assert.equal(withSnap.promptStatus.session, true);
  const other = E.applyRecallToEdit(recall, { snapshot: { ...snap, imageId: 'other.png' }, targets: TARGETS });
  assert.equal(other.prompt, '');
  assert.equal(other.promptStatus.available, false);
});

test('a source made by a model that cannot edit routes to the active SDCPP model with a note', () => {
  const recall = E.buildRecall({ id: 'f.png', width: 512, height: 512, meta: { target: 'flux2-klein-4b', seed: 1, steps: 4 } });
  const st = E.applyRecallToEdit(recall, { targets: TARGETS, activeSecondary: 'sd15' });
  assert.equal(st.sourceModel, 'flux2-klein-4b');
  assert.equal(st.editModel, 'sd15');
  assert.ok(st.notes.some(n => /cannot run image edits/.test(n)));
});

test('legacy image with no record fails visibly in notes, not silently', () => {
  const st = E.applyRecallToEdit(E.buildRecall({ id: 'old.png', width: 64, height: 64, meta: {} }), { targets: TARGETS });
  assert.equal(st.recalledFrom.recorded, false);
  assert.ok(st.notes[0].includes('no recorded generation settings'));
});

test('each output of a run resolves to its own seed', () => {
  const a = E.buildRecall({ id: 'a.png', meta: { target: 'sd15', seed: 1, steps: 20 } });
  const b = E.buildRecall({ id: 'b.png', meta: { target: 'sd15', seed: 2, steps: 20 } });
  assert.notEqual(E.applyRecallToEdit(a).params.seed, E.applyRecallToEdit(b).params.seed);
});

// ── mask / viewport geometry ────────────────────────────────────────────
for (const [name, w, h] of [['square', 512, 512], ['landscape', 1024, 512], ['portrait', 512, 1024], ['odd', 777, 333]]) {
  test(`fit view shows the whole ${name} image and maps corners exactly`, () => {
    const v = { imgW: w, imgH: h, boxW: 600, boxH: 400, zoom: 1, panX: 0, panY: 0 };
    const tl = E.imageToScreen(v, 0, 0), br = E.imageToScreen(v, w, h);
    assert.ok(tl.x >= -1e-9 && tl.y >= -1e-9 && br.x <= 600 + 1e-9 && br.y <= 400 + 1e-9, 'entire image inside the box');
    const back = E.screenToImage(v, br.x, br.y);
    assert.ok(Math.abs(back.x - w) < 1e-6 && Math.abs(back.y - h) < 1e-6);
  });
}

test('a stroke near the corner keeps its image pixel through zoom and pan', () => {
  let v = { imgW: 512, imgH: 1024, boxW: 400, boxH: 400, zoom: 1, panX: 0, panY: 0 };
  const px = { x: 5, y: 1019 };                   // near bottom-left corner
  const s0 = E.imageToScreen(v, px.x, px.y);
  assert.ok(Math.abs(E.screenToImage(v, s0.x, s0.y).x - 5) < 1e-6);
  v = E.zoomAt(v, 4, s0.x, s0.y);                 // zoom at that very point
  const s1 = E.imageToScreen(v, px.x, px.y);
  const back = E.screenToImage(v, s1.x, s1.y);
  assert.ok(Math.abs(back.x - 5) < 1e-6 && Math.abs(back.y - 1019) < 1e-6, 'screen↔image round trip after zoom');
  const panned = E.clampPan({ ...v, panX: 99999, panY: -99999 });
  const s2 = E.imageToScreen(panned, px.x, px.y);
  const back2 = E.screenToImage(panned, s2.x, s2.y);
  assert.ok(Math.abs(back2.x - 5) < 1e-6 && Math.abs(back2.y - 1019) < 1e-6, 'meaning of a mask pixel is independent of pan');
});

test('browser resize changes the screen scale but not the image coordinate of a stroke', () => {
  const a = { imgW: 640, imgH: 480, boxW: 320, boxH: 240, zoom: 1, panX: 0, panY: 0 };
  const b = { ...a, boxW: 960, boxH: 720 };
  const sa = E.imageToScreen(a, 100, 50), sb = E.imageToScreen(b, 100, 50);
  assert.notEqual(sa.x, sb.x);
  assert.deepEqual([E.screenToImage(a, sa.x, sa.y), E.screenToImage(b, sb.x, sb.y)].map(p => [Math.round(p.x), Math.round(p.y)]), [[100, 50], [100, 50]]);
});

test('100% zoom is one image pixel per CSS pixel; zoom never goes below fit', () => {
  const v = { imgW: 2048, imgH: 1024, boxW: 512, boxH: 512, zoom: 1, panX: 0, panY: 0 };
  assert.ok(Math.abs(E.viewScale(E.zoomTo100(v)) - 1) < 1e-9);
  assert.equal(E.zoomAt(v, 0.01, 10, 10).zoom, 1);
});

// ── stage / progress ────────────────────────────────────────────────────
const SD_LOG = '[INFO ] stable-diffusion.cpp:3456 - sampling using Euler A method\n  |=====>   | 7/16 - 5.16s/it\r  |======>  | 8/16 - 5.17s/it\r';
test('sd-cli sampling steps give a real determinate percentage', () => {
  const p = E.parseSdProgress(SD_LOG);
  assert.deepEqual([p.phase, p.step, p.total, p.percent], ['sampling', 8, 16, 50]);
});
test('weight loading MB/s lines are NOT mistaken for sampling progress', () => {
  const p = E.parseSdProgress('  |#####    | 100/108 - 451.25MB/s\n');
  assert.equal(p.percent, null);
});
test('stage ladder: waiting → uploading → sampling → transferring → complete/failed', () => {
  assert.equal(E.deriveStage({ status: 'queued', resource: { waiting: true, position: 1, blocked_reason: 'sd15 owns it' } }).key, 'waiting-bigmac');
  assert.equal(E.deriveStage({ status: 'queued' }).key, 'queued');
  assert.equal(E.deriveStage({ status: 'running', stderr: '=== Pre-flight verification ===' }).key, 'preflight');
  assert.equal(E.deriveStage({ status: 'running', stderr: '=== Uploading init image to BigMac ===' }).key, 'uploading');
  const gen = { status: 'running', stderr: '=== Generating img2img on BigMac (strength=0.5) ===' };
  assert.equal(E.deriveStage(gen).determinate, false, 'no log yet → indeterminate, no invented percent');
  const s = E.deriveStage(gen, SD_LOG);
  assert.deepEqual([s.key, s.percent, s.determinate], ['sampling', 50, true]);
  assert.equal(E.deriveStage({ status: 'running', stderr: '=== Copying PNG to MacBook ===' }).key, 'transferring');
  assert.equal(E.deriveStage({ status: 'PASS' }).percent, 100);
  const f = E.deriveStage({ status: 'FAIL', firstFailedGate: 'remote-png' });
  assert.deepEqual([f.key, f.gate], ['failed', 'remote-png']);
});

// ── model selector ──────────────────────────────────────────────────────
const MT = [
  { id: 'flux2-klein-4b', label: 'FLUX.2 Klein 4B', backend: 'mflux', status: 'proofed', primary: true },
  { id: 'sdxl-base', label: 'SDXL base 1.0', backend: 'sdcpp', status: 'PROVEN' },
  { id: 'sdxl-pony', label: 'Pony', backend: 'sdcpp', status: 'PROVEN', family: 'pony' },
  { id: 'sd15', label: 'SD1.5', backend: 'sdcpp', status: 'proofed' },
  { id: 'sdxl-x', label: 'Missing XL', backend: 'sdcpp', runtime: 'model-missing' },
];
test('model selector groups by family, filters and searches', () => {
  const all = E.groupModels(MT, [], { activeId: 'sd15' });
  assert.deepEqual(all.groups.map(g => g.family), ['flux', 'sdxl', 'pony', 'sd15']);
  assert.equal(all.total, 5);
  assert.ok(all.groups.find(g => g.family === 'sd15').items[0].active);
  assert.equal(E.groupModels(MT, [], { family: 'sdxl' }).shown, 2);
  assert.equal(E.groupModels(MT, [], { readyOnly: true }).shown, 4);
  assert.deepEqual(E.groupModels(MT, [], { query: 'pony' }).groups.map(g => g.family), ['pony']);
  assert.equal(E.groupModels(MT, [], {}).groups[0].items[0].readiness.label, 'Proven');
});

// ── presets ─────────────────────────────────────────────────────────────
test('legacy recipes migrate to v2 with mode create; prompts only when saving is on', () => {
  const legacy = { id: '1', name: 'Old', target: 'sd15', steps: 20, cfg: 7, prompt: 'secret', negPrompt: 'n' };
  const off = E.migrateRecipe(legacy, false);
  assert.deepEqual([off.v, off.mode, off.prompt, off.promptSaved], [2, 'create', undefined, false]);
  const on = E.migrateRecipe(legacy, true);
  assert.deepEqual([on.prompt, on.negPrompt, on.promptSaved], ['secret', 'n', true]);
});
test('edit-mode recipes carry resources and outpaint settings but never a source image', () => {
  const r = E.migrateRecipe({ name: 'Out', mode: 'outpaint', target: 'sd15', strength: 0.8, loras: [{ name: 'a', weight: 0.5 }], outpaint: { right: 128, left: 0 }, imageId: 'img.png', sourceId: 'x' }, false);
  assert.deepEqual(r.loras, [{ name: 'a', weight: 0.5 }]);
  assert.deepEqual(r.outpaint, { right: 128, left: 0 });
  assert.equal(r.imageId, undefined); assert.equal(r.sourceId, undefined);
  assert.equal(E.recipesForMode([r, { mode: 'inpaint' }, { name: 'legacy' }], 'create').length, 1);
});
