
'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path'); const vm = require('node:vm');
function fixture() {
  function C() {}
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/dexdiffusion/workstation-ui.js'), 'utf8'), { window: { DexDiffusionComponent: C, DexClient: {} }, React: { createElement() {} }, document: {}, console });
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
