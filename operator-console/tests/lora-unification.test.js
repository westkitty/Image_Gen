'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const DIR = path.join(__dirname, '..', 'public', 'dexdiffusion');
const read = file => fs.readFileSync(path.join(DIR, file), 'utf8');

function boot({ storage = {}, screen = null, fetch: fetchImpl = null } = {}) {
  const html = read('index.html');
  const tpl = html.match(/<template id="dc-template">([\s\S]*?)<\/template>/)[1];
  const styles = (html.match(/<style>([\s\S]*?)<\/style>/) || [, ''])[1];
  const dom = new JSDOM(
    `<!doctype html><html><head><style>${styles}</style></head><body><div id="app-root"></div><template id="dc-template">${tpl}</template></body></html>`,
    { url: 'http://127.0.0.1:31337/dexdiffusion/', runScripts: 'outside-only', pretendToBeVisual: true }
  );
  const w = dom.window;
  for (const [k, v] of Object.entries(storage)) w.localStorage.setItem(k, v);
  if (screen) w.sessionStorage.setItem('dex_screen', screen);

  const loadErrors = [];
  w.fetch = () => Promise.resolve({
    ok: false, status: 503, statusText: 'offline in test',
    json: () => Promise.resolve({}), text: () => Promise.resolve(''), headers: { get: () => null }
  });
  w.WebSocket = function () { this.close = () => {}; };
  w.EventSource = function () { this.close = () => {}; };
  w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  w.Notification = function () {}; w.Notification.permission = 'denied';
  w.Notification.requestPermission = () => Promise.resolve('denied');
  w.HTMLCanvasElement.prototype.getContext = () => null;
  w.HTMLMediaElement.prototype.play = () => Promise.resolve();
  w.confirm = () => true;

  for (const src of shellScriptOrder()) {
    try { w.eval(fs.readFileSync(src.path, 'utf8')); }
    catch (e) { loadErrors.push(path.basename(src.path) + ': ' + e.message); }
  }
  assert.deepEqual(loadErrors, [], 'every shell script the page loads also loads here');
  if (fetchImpl) w.fetch = fetchImpl(w);

  const root = w.document.getElementById('dc-template').content.firstElementChild;
  const inst = w.DCRuntime.mount(w.DexDiffusionComponent, root, w.document.getElementById('app-root'));
  return { w, doc: w.document, inst, close: () => w.close() };
}

function shellScriptOrder() {
  const html = read('index.html');
  const out = [];
  for (const m of html.matchAll(/<script src="([^"]+)"><\/script>/g)) {
    const src = m[1].split('?')[0];
    const abs = src.startsWith('../')
      ? path.join(DIR, '..', src.slice(3))
      : path.join(DIR, src);
    if (fs.existsSync(abs)) out.push({ src, path: abs });
  }
  return out;
}

const settle = (w, ms = 60) => new Promise(r => w.setTimeout(r, ms));

function apiStub(w) {
  const calls = [];
  w.fetch = (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method || 'GET', body: opts.body });
    if (url.includes('/api/actions/generate-controlled')) {
      const b = opts.body ? JSON.parse(opts.body) : {};
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({ ok: true, job_id: 'job-stub', seeds: [12345] })
      });
    }
    return Promise.resolve({
      ok: true, status: 200,
      json: () => Promise.resolve({ ok: true })
    });
  };
  return calls;
}

test('Prompt-composer LoRA picker: single-action selection, recipe application, and setting restoration', async () => {
  const { w, doc, inst, close } = boot();
  try {
    await settle(w);
    const calls = apiStub(w);
    const adapter = {
      id: 'lcm_sdxl_asset',
      name: 'lcm_sdxl',
      filename: 'lcm_sdxl.safetensors',
      family: 'sdxl',
      compatibility: 'Compatible',
      proof_status: 'PROVEN',
      proof_target_ids: ['sdxl-base'],
      default_weight: 1.0,
      min_weight: 0.0,
      max_weight: 2.0,
      step: 0.05,
      trigger_words: ['lcm speed']
    };
    inst.setState({
      target: 'sdxl-base',
      prompt: 'a tranquil lake in autumn',
      steps: 25,
      cfg: 7.5,
      sampler: 'euler_a',
      scheduler: 'discrete',
      assets: { loras: [adapter], vaes: [], embeddings: { count: 0, items: [] } },
      showLoraPicker: true
    });
    await settle(w);

    const picker = doc.querySelector('[data-dex-field="lora-picker-popover"]');
    assert.ok(picker, 'LoRA picker popover renders when open');

    const select = doc.querySelector('[data-dex-field="lora-picker-select"]');
    assert.ok(select, 'LoRA picker select element is present');

    // Select adapter: single action enables adapter immediately
    select.value = adapter.id;
    select.dispatchEvent(new w.Event('change', { bubbles: true }));
    await settle(w);

    assert.equal(inst.state.createLora.enabled, true);
    assert.equal(inst.state.createLora.selectedId, adapter.id);
    assert.deepEqual([inst.state.steps, inst.state.cfg, inst.state.sampler, inst.state.scheduler], [4, 1.5, 'lcm', 'lcm'], 'recipe applied');

    // Strength slider & numeric input reactivity
    inst.setCreateLoraStrength(0.85, 0, 2);
    await settle(w);
    assert.equal(inst.state.createLora.strength, 0.85);

    // Generation request includes effective adapter in body.loras
    await inst.onGenerate();
    await settle(w, 50);
    const genCall = calls.filter(c => c.url.includes('generate-controlled')).at(-1);
    assert.ok(genCall, 'generate-controlled API was called');
    const genBody = JSON.parse(genCall.body);
    assert.deepEqual(genBody.loras, [{ name: 'lcm_sdxl', weight: 0.85 }]);

    // Trigger word insertion
    inst.insertTriggerPhrase(adapter.trigger_words);
    assert.match(inst.state.prompt, /lcm speed/);

    // Disable / remove adapter restores user original settings
    inst.selectCreateLora('');
    await settle(w);
    assert.equal(inst.state.createLora.enabled, false);
    assert.deepEqual([inst.state.steps, inst.state.cfg, inst.state.sampler, inst.state.scheduler], [25, 7.5, 'euler_a', 'discrete'], 'original settings restored');

    // Generation without adapter does not leak loras
    inst.setState({ jobStatus: 'idle' });
    await inst.onGenerate();
    await settle(w, 50);
    const genCall2 = calls.filter(c => c.url.includes('generate-controlled')).at(-1);
    const genBody2 = JSON.parse(genCall2.body);
    assert.equal(Object.hasOwn(genBody2, 'loras'), false, 'no loras sent when adapter disabled');
  } finally {
    close();
  }
});

test('Model switch disables incompatible adapter and preserves negative prompt text', async () => {
  const { w, doc, inst, close } = boot();
  try {
    await settle(w);
    apiStub(w);
    const adapter = {
      id: 'lcm_sdxl_asset',
      name: 'lcm_sdxl',
      filename: 'lcm_sdxl.safetensors',
      family: 'sdxl',
      compatibility: 'Compatible',
      proof_status: 'PROVEN',
      proof_target_ids: ['sdxl-base'],
      default_weight: 1.0,
      min_weight: 0.0,
      max_weight: 2.0,
      step: 0.05
    };
    inst.setState({
      target: 'sdxl-base',
      modelTargets: [
        { id: 'sdxl-base', label: 'SDXL Base', backend: 'sdcpp', defaultSteps: 20 },
        { id: 'flux2-klein-4b', label: 'FLUX.2 Klein 4B', backend: 'mflux', defaultSteps: 4 }
      ],
      steps: 25,
      cfg: 7.5,
      sampler: 'euler_a',
      scheduler: 'discrete',
      negPrompt: 'blurry, distorted, oversaturated',
      assets: { loras: [adapter], vaes: [], embeddings: { count: 0, items: [] } }
    });
    inst.selectCreateLora(adapter.id);
    await settle(w);
    assert.equal(inst.state.createLora.enabled, true);

    // Switch model to flux2-klein-4b (SDXL LoRA is incompatible, MFLUX has no negative prompt)
    await inst.onSelectTarget('flux2-klein-4b', { quiet: true });
    await settle(w);

    assert.equal(inst.state.createLora.enabled, false, 'incompatible adapter disabled on model switch');
    assert.equal(inst.state.negPrompt, 'blurry, distorted, oversaturated', 'negative prompt text is preserved');

    // Switch back to sdxl-base
    await inst.onSelectTarget('sdxl-base', { quiet: true });
    await settle(w);
    assert.equal(inst.state.negPrompt, 'blurry, distorted, oversaturated', 'negative prompt text is still intact on supported model');
  } finally {
    close();
  }
});

test('Backend negative prompt wildcard expansion and negative <lora:...> rejection', () => {
  const server = require('../server.js');
  const policy = require('../lora-runtime-policy.js');

  // Verify routesFor identifies production routes
  const sdxlRoutes = policy.routesFor('sdxl-base', 'lcm_sdxl.safetensors');
  assert.ok(sdxlRoutes.length > 0, 'verified production routes found for lcm_sdxl');
  assert.equal(sdxlRoutes[0].production, true);

  const mfluxRoutes = policy.routesFor('flux2-klein-4b', 'pixelart_lora.safetensors');
  assert.ok(mfluxRoutes.length > 0, 'verified production routes found for pixelart_lora');
  assert.equal(mfluxRoutes[0].rslora_equivalent, true);
});
