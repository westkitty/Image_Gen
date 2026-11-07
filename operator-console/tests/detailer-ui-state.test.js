
'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path'); const vm = require('node:vm');
function fixture() {
  function C() {}
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/dexdiffusion/workstation-ui.js'), 'utf8'), { window: { DexDiffusionComponent: C, DexClient: {} }, AbortController, React: { createElement() {} }, document: {}, console });
  const a = new C(); a.ws = { detailer: { open: true, imageId: 'a.png', mode: 'face' } };
  a._ws = () => a.ws; a.wsSet = p => Object.assign(a.ws, p); a.toast = () => {};
  return a;
}
test('a delayed Detailer mask cannot attach to changed options, image or a closed dialog', async () => {
  for (const patch of [{ mode: 'hand' }, { imageId: 'b.png' }, { open: false }]) {
    const a = fixture(); let resolve; a._api = () => new Promise(r => { resolve = r; });
    const pending = a.previewDetailerMask(); Object.assign(a.ws.detailer, patch, { maskPreview: null });
    resolve({ ok: true, data: { mask_preview: 'FACE-MASK', detections: [{ class: 'face' }] } });
    await pending; assert.equal(a.ws.detailer.maskPreview, null); assert.equal(a.ws.detailer.loading, false);
  }
});

test('a delayed inpaint submission cannot attach to a replacement Detailer dialog', async () => {
  const a = fixture(); a.ws.detailer.maskPreview = 'mask';
  let resolve; a._api = () => new Promise(r => { resolve = r; });
  a._waitJob = async () => { throw new Error('must not poll into replacement dialog'); }; a.loadRuns = () => {};
  const pending = a.runDetailer();
  a.ws.detailer = { open: true, imageId: 'b.png', mode: 'hand', note: 'new dialog' };
  resolve({ ok: true, data: { job_id: 'old-job' } }); await pending;
  assert.equal(a.ws.detailer.jobId, undefined); assert.equal(a.ws.detailer.note, 'new dialog');
});


test('Detailer timeout is terminal, preserves selection/options, and late failed preview cannot overwrite retry', async () => {
  const a = fixture(); a.ws.detailer.mode = 'hand'; a.ws.detailer.threshold = 0.6;
  a._api = async () => ({ ok: false, data: { code: 'timeout', error: 'Detector timed out' } });
  await a.previewDetailerMask();
  assert.equal(a.ws.detailer.loading, false); assert.equal(a.ws.detailer.maskPreview, null);
  assert.match(a.ws.detailer.note, /timed out/); assert.equal(a.ws.detailer.imageId, 'a.png');
  assert.equal(a.ws.detailer.threshold, 0.6);
  let old; a._api = () => new Promise(r => { old = r; });
  const pending = a.previewDetailerMask();
  a._api = async () => ({ ok: true, data: { mask_preview: 'HEALTHY', detections: [{ class: 'hand' }] } });
  await a.previewDetailerMask();
  old({ ok: true, data: { mask_preview: 'STALE', detections: [] } }); await pending;
  assert.equal(a.ws.detailer.maskPreview, 'HEALTHY'); assert.equal(a.ws.detailer.loading, false);
});

test('open-vocabulary Detailer payload keeps target, selected instance, neighbor expansion and manual mask edits', () => {
  const a=fixture(); const d=a.ws.detailer; Object.assign(d,{detector:'owlv2-base-patch16-ensemble',target:'silver necklace',selectedInstances:['owlv2-2'],repairExpansion:48,editModel:'sdxl-biglust',manualCorrections:[{operation:'erase',box:[.1,.2,.3,.4]}]});
  const p=a.detailerPayload(d);
  assert.equal(p.detector,'owlv2-base-patch16-ensemble');assert.equal(p.target,'silver necklace');assert.deepEqual(p.selectedInstances,['owlv2-2']);assert.equal(p.repairExpansion,48);assert.equal(p.edit_model,'sdxl-biglust');assert.equal(p.manualCorrections[0].operation,'erase');
});

test('Detailer preset application chooses the right local provider and preserves target/repair settings', () => {
  const a=fixture();a.ws.detailer.presets=[{id:'underwear-hips',name:'Underwear + hips',target:'male underwear',confidence:.4,mask:{padding:.1,feather:3,expansion:0},repairExpansion:42,prompt:'preserve fabric',strength:.5}];
  a.applyDetailerPreset('underwear-hips');const d=a.ws.detailer;
  assert.equal(d.detector,'owlv2-base-patch16-ensemble');assert.equal(d.target,'male underwear');assert.equal(d.repairExpansion,42);assert.equal(d.prompt,'preserve fabric');
});

test('manual mask drag creates a normalized, operation-tagged correction without losing detection options', () => {
  const a=fixture();a.ws.detailer.maskEditMode='erase';
  const target={getBoundingClientRect:()=>({left:10,top:20,width:100,height:200}),setPointerCapture(){}};
  a.beginDetailerMaskEdit({currentTarget:target,clientX:20,clientY:40,pointerId:1});
  a.finishDetailerMaskEdit({currentTarget:target,clientX:60,clientY:120});
  const c=a.ws.detailer.manualCorrections[0];assert.equal(c.operation,'erase');assert.deepEqual(Array.from(c.box),[.1,.1,.5,.5]);assert.equal(a.ws.detailer.imageId,'a.png');
});

test('manual mask edits support undo, redo and reset without corrupting normalized coordinates', () => {
  const a=fixture();
  const target={getBoundingClientRect:()=>({left:20,top:30,width:200,height:100})};
  a.ws.detailer.maskEditMode='add';
  a.paintDetailerMaskAt({currentTarget:target,clientX:120,clientY:80});
  const c=a.ws.detailer.manualCorrections[0];
  assert.equal(c.operation,'add');assert.deepEqual(Array.from(c.box),[.46,.46,.54,.54]);
  a.undoDetailerMaskEdit();assert.equal(a.ws.detailer.manualCorrections.length,0);assert.equal(a.ws.detailer.manualCorrectionRedo.length,1);
  a.redoDetailerMaskEdit();assert.deepEqual(Array.from(a.ws.detailer.manualCorrections[0].box),[.46,.46,.54,.54]);
  a.resetDetailerMaskEdits();assert.equal(a.ws.detailer.manualCorrections.length,0);assert.equal(a.ws.detailer.manualCorrectionRedo.length,0);
});
