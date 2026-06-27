'use strict';
// Unit tests for the DexDiffusion component's pure logic. The component is a
// browser module (class Component extends DCLogic, uses React/localStorage/fetch),
// so we load it inside a vm sandbox with minimal stubs and exercise the pure
// helpers — the bug-prone mapping/status code from earlier sessions.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadComponent() {
  const file = path.join(__dirname, '..', 'public', 'dexdiffusion', 'component.js');
  const code = fs.readFileSync(file, 'utf8');
  class DCLogic {
    constructor() { if (!this.state) this.state = {}; }
    setState(patch) {
      const next = typeof patch === 'function' ? patch(this.state) : patch;
      this.state = Object.assign({}, this.state, next);
    }
  }
  const sandbox = {
    window: {}, DCLogic, console,
    React: { createElement: (type, props, ...children) => ({ __vnode: true, type, props: props || {}, children }) },
    localStorage: { getItem: () => null, setItem() {} },
    fetch: () => Promise.reject(new Error('no network in tests')),
    AbortSignal: { timeout: () => null },
    setInterval: () => 0, clearInterval() {}, setTimeout: () => 0,
    navigator: { clipboard: { writeText() {} } },
    document: {}, requestAnimationFrame: () => 0,
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox.window.DexDiffusionComponent;
}

const Component = loadComponent();
const make = () => new Component();

test('job status helpers: terminal vs running', () => {
  const c = make();
  assert.equal(c._jobTerminal('PASS'), true);
  assert.equal(c._jobTerminal('PARTIAL'), true);
  assert.equal(c._jobTerminal('FAIL'), true);
  assert.equal(c._jobTerminal('running'), false);
  assert.equal(c._jobTerminal('queued'), false);
  assert.equal(c._jobTerminal(null), false);
});

test('job status helpers: success detection', () => {
  const c = make();
  assert.equal(c._jobOk('PASS'), true);
  assert.equal(c._jobOk('PARTIAL'), true);
  assert.equal(c._jobOk('FAIL'), false);
  assert.equal(c._jobOk('running'), false);
});

test('sampler label maps to backend id', () => {
  const c = make();
  assert.equal(c._mapSampler('euler_a'), 'euler_a');
  assert.equal(c._mapSampler('dpm++ 2m'), 'dpmpp2m');
  assert.equal(c._mapSampler('dpm++ sde'), 'dpmpp2s_a');
  assert.equal(c._mapSampler('heun'), 'heun');
});

test('run-file URL tolerates bare filename and absolute path', () => {
  const c = make();
  c.state.backendUrl = 'http://x';
  assert.equal(c._imgUrl('run1', 'out.png'), 'http://x/api/run-file?path=run1/out.png');
  assert.equal(c._imgUrl('run1', '/abs/dir/out.png'), 'http://x/api/run-file?path=run1/out.png');
  assert.equal(c._imgUrl(null, 'out.png'), null);
  assert.equal(c._imgUrl('run1', null), null);
});

test('run-index item maps to card shape (real API keys)', () => {
  const c = make();
  c.state.backendUrl = 'http://x';
  const card = c._mapRunItem({ id: 'r1', type: 'controlled-sd15', controlledTargetLabel: 'SD1.5', status: 'PASS', primaryImage: 'a.png', imageCount: 2, createdAt: 't' });
  assert.equal(card.id, 'r1');
  assert.equal(card.model, 'SD1.5');
  assert.equal(card.imageFile, 'a.png');           // sourced from primaryImage (not image/outputImage)
  assert.equal(card.badge, 'PASS');
  assert.ok(card.thumb.includes('run-file?path=r1/a.png'));
  const failCard = c._mapRunItem({ id: 'r2', status: 'FAIL', primaryImage: null });
  assert.equal(failCard.badge, 'FAIL');
  assert.ok(failCard.thumb.startsWith('linear-gradient'));
});

test('applyTargetDefaults applies capability defaults, scaled by preset', () => {
  const c = make();
  c.state.modelTargets = [{ id: 'sdxl-turbo', defaultSteps: 4, defaultCfgScale: 0, defaultWidth: 768, defaultHeight: 768, defaultSampler: 'euler', minSteps: 1, maxSteps: 8 }];
  c.state.preset = 'balanced';
  c.applyTargetDefaults('sdxl-turbo');
  assert.equal(c.state.steps, 4);
  assert.equal(c.state.width, 768);
  assert.equal(c.state.sampler, 'euler');
  c.applyTargetDefaults('sdxl-turbo', 'fast');     // half steps, clamped to >= minSteps
  assert.equal(c.state.steps, 2);
  c.applyTargetDefaults('sdxl-turbo', 'quality');  // double steps, clamped to <= maxSteps
  assert.equal(c.state.steps, 8);
});

test('_resolveSource picks explicit file, else primary, else error', () => {
  const c = make();
  c.state.runs = [{ id: 'r1', imageFile: 'primary.png' }];
  c.state.runFiles = { r1: ['primary.png', 'other.png'] };
  assert.deepEqual(c._resolveSource('r1', 'other.png'), { run: c.state.runs[0], imageFile: 'other.png' });
  assert.deepEqual(c._resolveSource('r1', ''), { run: c.state.runs[0], imageFile: 'primary.png' });
  assert.deepEqual(c._resolveSource('last', ''), { run: c.state.runs[0], imageFile: 'primary.png' });
  c.state.runs = [];
  assert.ok(c._resolveSource('nope', '').error);
});

test('onSelectPreset normalizes prototype display labels', () => {
  const c = make();
  c.state.modelTargets = [];
  c.onSelectPreset('Fast (SD1.5)');
  assert.equal(c.state.preset, 'fast');
  c.onSelectPreset('Custom');
  assert.equal(c.state.preset, 'balanced');
});
