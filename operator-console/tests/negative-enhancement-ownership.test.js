'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Load the actual component class without mounting a UI or starting services.
function fixture() {
  const requests = [], toasts = [];
  const context = {
    DCLogic: class {}, window: {}, AbortController, AbortSignal,
    fetch: (url, options) => new Promise((resolve, reject) => requests.push({ resolve, reject, options })),
    document: { querySelector: () => null }, setTimeout: () => 0,
    localStorage: { setItem() {} },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/dexdiffusion/component.js'), 'utf8'), context);
  const app = Object.create(context.window.DexDiffusionComponent.prototype);
  app.state = { target: 'sdxl-base', negPrompt: 'synthetic draft', backendUrl: '', enhancingNegPrompt: false, negEnhancementResult: null };
  app.setState = patch => Object.assign(app.state, patch);
  app.toast = message => toasts.push(message);
  return { app, requests, toasts };
}
const response = enhanced => ({ ok: true, json: async () => ({ enhanced }) });

for (const outcome of ['success', 'error-response', 'rejection']) {
  test(`superseded negative enhancement ${outcome} cannot alter a newer request`, async () => {
    const { app, requests, toasts } = fixture();
    const first = app.enhanceNegativePrompt();
    app.cancelNegEnhance();
    app.state.negPrompt = 'new synthetic draft';
    const second = app.enhanceNegativePrompt();
    const owner = app._enhanceNegAbort, snapshot = app._pendingNegEnhancement;
    const toastCount = toasts.length;
    if (outcome === 'rejection') requests[0].reject(new Error('cancelled old request'));
    else requests[0].resolve(outcome === 'success' ? response('obsolete') : { ok: false, status: 503, json: async () => ({ error: 'obsolete error' }) });
    await first;
    assert.equal(app.state.enhancingNegPrompt, true);
    assert.equal(app.state.negEnhancementResult, null);
    assert.equal(app._enhanceNegAbort, owner);
    assert.equal(app._pendingNegEnhancement, snapshot);
    assert.equal(toasts.length, toastCount, 'obsolete request emits no late toast');
    requests[1].resolve(response('current result'));
    await second;
    assert.equal(app.state.negEnhancementResult.enhanced, 'current result');
    assert.equal(app.state.enhancingNegPrompt, false);
    assert.equal(app._enhanceNegAbort, null);
    assert.equal(app._pendingNegEnhancement, null);
  });
}

test('cancellation invalidates a successful response whose body settles later', async () => {
  const { app, requests } = fixture();
  let finishBody;
  const pending = app.enhanceNegativePrompt();
  requests[0].resolve({ ok: true, json: () => new Promise(resolve => { finishBody = resolve; }) });
  await new Promise(setImmediate);
  app.cancelNegEnhance();
  finishBody({ enhanced: 'obsolete' });
  await pending;
  assert.equal(app.state.negEnhancementResult, null);
  assert.equal(app.state.enhancingNegPrompt, false);
  assert.equal(app._pendingNegEnhancement, null);
});

test('model switching invalidates the enhancement without disturbing a later request', async () => {
  const { app, requests } = fixture();
  app.state.modelTargets = [{ id: 'mflux-fixture', backend: 'mflux' }];
  app.applyTargetDefaults = () => {};
  app.loadAssets = () => {};
  const first = app.enhanceNegativePrompt();
  await app.onSelectTarget('mflux-fixture', { quiet: true, restoreOnly: true });
  app.state.target = 'sdxl-base';
  const second = app.enhanceNegativePrompt();
  requests[0].resolve(response('obsolete model result'));
  await first;
  assert.equal(app.state.enhancingNegPrompt, true);
  assert.equal(app.state.negEnhancementResult, null);
  requests[1].resolve(response('current model result'));
  await second;
  assert.equal(app.state.negEnhancementResult.enhanced, 'current model result');
});

test('current request failures release state and draft edits retain the stale warning', async () => {
  const { app, requests } = fixture();
  const failure = app.enhanceNegativePrompt();
  requests[0].reject(new Error('fixture disconnect'));
  await failure;
  assert.equal(app.state.enhancingNegPrompt, false);
  assert.equal(app._pendingNegEnhancement, null);
  const next = app.enhanceNegativePrompt();
  app.state.negPrompt = 'edited synthetic draft';
  requests[1].resolve(response('reviewed suggestion'));
  await next;
  assert.equal(app.state.negEnhancementResult.isStale, true);
  assert.equal(app.state.negPrompt, 'edited synthetic draft');
});
