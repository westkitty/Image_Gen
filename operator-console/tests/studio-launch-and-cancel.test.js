'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createComponent({ storedVersion = null, search = '', storage = {}, session = {}, fetchImpl = () => Promise.reject(new Error('not used in this test')) } = {}) {
  const store = new Map(Object.entries(storage));
  if (storedVersion != null) store.set('dex_version', String(storedVersion));
  class DCLogic {
    constructor() { if (!this.state) this.state = {}; }
    setState(patch) {
      const next = typeof patch === 'function' ? patch(this.state) : patch;
      this.state = Object.assign({}, this.state, next);
    }
  }
  const sandbox = {
    window: { location: { search } }, DCLogic, console, URLSearchParams,
    DexClient: require('../public/dexdiffusion/client-helpers.js'),
    React: { createElement: (type, props, ...children) => ({ type, props: props || {}, children }) },
    localStorage: { getItem: key => store.get(key) || null, setItem: (key, value) => store.set(key, String(value)) },
    sessionStorage: { getItem: key => session[key] || null, setItem: (key, value) => { session[key] = String(value); } },
    fetch: fetchImpl,
    AbortSignal: { timeout: () => null }, setInterval: () => 0, clearInterval() {}, setTimeout: () => 0,
    navigator: { clipboard: { writeText() {} } }, document: {}, requestAnimationFrame: () => 0
  };
  vm.createContext(sandbox);
  const source = fs.readFileSync(path.join(__dirname, '../public/dexdiffusion/component.js'), 'utf8');
  vm.runInContext(source, sandbox);
  return { Component: sandbox.window.DexDiffusionComponent, store };
}

test('normal launch is V2 Create and migrates only the old shell preference', () => {
  const { Component, store } = createComponent({ storedVersion: 4, storage: { dex_saved_draft: '{"prompt":"kept"}', dex_save_prompts: 'false' }, session: { dex_screen: 'library' } });
  const c = new Component();
  assert.equal(c.state.version, 2);
  assert.equal(c.state.screens[2], 'create', 'migrating profiles land on Create instead of resuming an old shell route');
  assert.equal(store.get('dex_version'), '2');
  assert.equal(store.get('dex_saved_draft'), '{"prompt":"kept"}');
  assert.equal(store.get('dex_save_prompts'), 'false');
});

test('explicit debug mode retains legacy shell selection for development regression work', () => {
  const { Component, store } = createComponent({ storedVersion: 4, search: '?debug=1' });
  const c = new Component();
  assert.equal(c.state.version, 4);
  assert.equal(store.get('dex_version'), '4');
});

test('Generate clicked during an active image job does not clear polling or reset its status', async () => {
  const { Component } = createComponent();
  const c = new Component();
  c.state = { ...c.state, jobStatus: 'generating', activeJobId: 'owned-job', prompt: 'a prompt' };
  c._pollTimer = 41;
  let notices = 0;
  c.toast = () => { notices++; };
  await c.onGenerate();
  assert.equal(c.state.jobStatus, 'generating');
  assert.equal(c.state.activeJobId, 'owned-job');
  assert.equal(c._pollTimer, 41);
  assert.equal(notices, 1);
});

test('explicit Cancel sends one request for the exact active job ID and keeps a truthful stopping state', async () => {
  const requests = [];
  const { Component } = createComponent({ fetchImpl: async (url, options) => {
    requests.push({ url, options });
    return { ok: true, json: async () => ({ ok: true, status: 'CANCELLED', remote_stop: 'verified' }) };
  } });
  const c = new Component();
  c.state = { ...c.state, jobStatus: 'generating', activeJobId: 'exact-job-123', backendUrl: 'http://studio.test' };
  await Promise.all([c.onCancelGenerate(), c.onCancelGenerate()]);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'http://studio.test/api/jobs/exact-job-123/cancel');
  assert.equal(requests[0].options.method, 'POST');
  assert.equal(c.state.jobStatus, 'stopping');
  assert.equal(c.state.cancelRequested, true);
  assert.match(c.state.cancelMessage, /Stop verified/);
});

test('Create distinguishes a verified worker stop from a locally cancelled but unverified run', () => {
  const { Component } = createComponent();
  const c = new Component();
  c._onGenerateDone({ status: 'CANCELLED', remoteStop: 'stop_unverified' }, {}, '');
  assert.equal(c.state.jobStatus, 'cancel-unverified');
  assert.match(c.state.cancelMessage, /Could not verify/);
  c._onGenerateDone({ status: 'CANCELLED', remoteStop: 'cancelled_verified', remoteCancel: { ok: true } }, {}, '');
  assert.equal(c.state.jobStatus, 'cancelled');
  assert.match(c.state.cancelMessage, /verified/);
});

test('normal Studio shell exposes fourteen destinations and Swap is a non-executable honest placeholder', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/dexdiffusion/index.html'), 'utf8');
  const nav = html.match(/<nav class="studio-nav"[\s\S]*?<\/nav>/);
  assert.ok(nav, 'V2 Studio primary navigation exists');
  const labels = [...nav[0].matchAll(/data-category="([^"]+)"[^>]*>([^<]+)<\/button>/g)].map(m => [m[1], m[2].trim()]);
  assert.deepEqual(labels, [
    ['create','Create'], ['batch','Batch'], ['swap','Swap'], ['voice','Voice'], ['drama','Drama'], ['music','Music'],
    ['video','Video'], ['world','World'], ['3d','3D'], ['library','Library'], ['edit','Edit'], ['enhance','Enhance'], ['models','Models'], ['system','System']
  ]);
  assert.match(html, /id="swap-title"[\s\S]{0,100}>Swap</);
  assert.match(html, /A Swap operation has not been defined and approved/);
  assert.match(html, /studio-version-switch\{display:none!important\}/);
  assert.ok(html.includes('onClick="{{ onSaveStyle }}"'));
  assert.ok(html.includes('Save recipe ↗'));
  assert.match(html, /SDXL smoke · gated/);
  assert.match(html, /Flux smoke · gated/);
  assert.match(html, /Check stage · unavailable/);
  assert.match(html, /Latest sweep · unavailable/);
  assert.doesNotMatch(nav[0], /Batch \/ Sweep/);
});
