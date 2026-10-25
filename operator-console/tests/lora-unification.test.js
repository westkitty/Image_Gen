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
  const policy = require('../lora-runtime-policy.js');

  // Verify routesFor identifies production routes
  const sdxlRoutes = policy.routesFor('sdxl-base', 'lcm_sdxl.safetensors');
  assert.ok(sdxlRoutes.length > 0, 'verified production routes found for lcm_sdxl');
  assert.equal(sdxlRoutes[0].production, true);

  const mfluxRoutes = policy.routesFor('flux2-klein-4b', 'pixelart_lora.safetensors');
  assert.ok(mfluxRoutes.length > 0, 'verified production routes found for pixelart_lora');
  assert.equal(mfluxRoutes[0].rslora_equivalent, true);
});

test('P0: Single authoritative Create LoRA selection & Extra Networks unification', async () => {
  const { w, doc, inst, close } = boot();
  try {
    await settle(w);
    apiStub(w);
    const adapterA = {
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
      assets: { loras: [adapterA], vaes: [], embeddings: { count: 0, items: [] } },
      createLora: { enabled: false, selectedId: '' },
      createLoras: [{ name: 'legacy_stray_adapter', weight: 0.9 }]
    });
    await settle(w);

    // 1. getEffectiveCreateLoras has no fallback to createLoras when createLora is disabled/empty
    assert.equal(inst.getEffectiveCreateLoras().length, 0, 'no fallback to legacy createLoras');

    // 2. Extra Networks insertLora routes to canonical createLora and clears createLoras
    inst.insertLora(adapterA.filename, 1.25);
    await settle(w);
    assert.equal(inst.state.createLora.enabled, true, 'canonical createLora enabled');
    assert.equal(inst.state.createLora.selectedId, adapterA.id, 'canonical adapter selected');
    assert.equal(inst.state.createLora.strength, 1.25, 'strength updated');
    assert.equal(inst.state.createLoras.length, 0, 'legacy createLoras cleared');

    // 3. getActiveLoras reflects canonical selection only
    const active = inst.getActiveLoras();
    assert.equal(active.length, 1);
    assert.equal(active[0].name, adapterA.name);
    assert.equal(active[0].weight, 1.25);

    // 4. Extra Networks removeLora disables canonical adapter and clears createLoras
    inst.removeLora();
    await settle(w);
    assert.equal(inst.state.createLora.enabled, false);
    assert.equal(inst.state.createLora.selectedId, '');
    assert.equal(inst.getEffectiveCreateLoras().length, 0);
    assert.equal(inst.state.createLoras.length, 0);
  } finally {
    close();
  }
});

test('P0: applyFavoritePreset restores adapter to canonical selection and clears legacy state', async () => {
  const { w, doc, inst, close } = boot();
  try {
    await settle(w);
    apiStub(w);
    const adapterA = {
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
      assets: { loras: [adapterA], vaes: [], embeddings: { count: 0, items: [] } },
      createLora: { enabled: false, selectedId: '' },
      createLoras: [{ name: 'old_legacy', weight: 0.5 }],
      favoritePresets: [{
        id: 'fav-1',
        name: 'Fast LCM Recipe',
        target: 'sdxl-base',
        steps: 4,
        cfg: 1.5,
        sampler: 'lcm',
        scheduler: 'lcm',
        loras: [{ name: 'lcm_sdxl', weight: 0.75 }]
      }, {
        id: 'fav-2',
        name: 'Standard No-LoRA Recipe',
        target: 'sdxl-base',
        steps: 25,
        cfg: 7.0,
        sampler: 'euler_a',
        scheduler: 'discrete',
        loras: []
      }]
    });
    await settle(w);

    // Apply recipe with LoRA
    inst.applyFavoritePreset('fav-1');
    await settle(w);
    assert.equal(inst.state.createLora.enabled, true);
    assert.equal(inst.state.createLora.selectedId, adapterA.id);
    assert.equal(inst.state.createLora.strength, 0.75);
    assert.equal(inst.state.createLoras.length, 0, 'createLoras cleared on preset load');
    assert.equal(inst.state.steps, 4);

    // Apply recipe without LoRA
    inst.applyFavoritePreset('fav-2');
    await settle(w);
    assert.equal(inst.state.createLora.enabled, false);
    assert.equal(inst.state.createLora.selectedId, '');
    assert.equal(inst.getEffectiveCreateLoras().length, 0);
    assert.equal(inst.state.createLoras.length, 0, 'createLoras remains empty');
    assert.equal(inst.state.steps, 25);
  } finally {
    close();
  }
});

test('P0: Generate Again LoRA leakage prevention (ON -> generate -> OFF -> Generate Again)', async () => {
  const { w, doc, inst, close } = boot();
  try {
    await settle(w);
    const calls = apiStub(w);
    const adapterA = {
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
    const adapterB = {
      id: 'style_b_asset',
      name: 'style_b',
      filename: 'style_b.safetensors',
      family: 'sdxl',
      compatibility: 'Compatible',
      proof_status: 'PROVEN',
      proof_target_ids: ['sdxl-base'],
      default_weight: 0.8,
      min_weight: 0.0,
      max_weight: 2.0,
      step: 0.05
    };
    inst.setState({
      target: 'sdxl-base',
      prompt: 'a majestic mountain sunrise',
      steps: 20,
      cfg: 7.0,
      sampler: 'euler_a',
      scheduler: 'discrete',
      assets: { loras: [adapterA, adapterB], vaes: [], embeddings: { count: 0, items: [] } }
    });

    // Step 1: Select Adapter A and generate
    inst.selectCreateLora(adapterA.id);
    await settle(w);
    await inst.onGenerate();
    await settle(w, 50);

    const call1 = calls.filter(c => c.url.includes('generate-controlled')).at(-1);
    assert.ok(call1);
    const body1 = JSON.parse(call1.body);
    assert.deepEqual(body1.loras, [{ name: 'lcm_sdxl', weight: 1.0 }]);

    // ws.lastBody now contains loras from the first run
    const lastBody = inst._ws().lastBody;
    assert.ok(lastBody && Array.isArray(lastBody.loras) && lastBody.loras.length === 1);

    // Step 2: Turn LoRA OFF in Create
    inst.selectCreateLora('');
    await settle(w);
    assert.equal(inst.state.createLora.enabled, false);
    assert.equal(inst.getEffectiveCreateLoras().length, 0);

    // Step 3: Trigger "Generate Again" with previous lastBody
    inst.setState({ jobStatus: 'idle' });
    await inst.onGenerate(Object.assign({}, lastBody, { prompt: 'a majestic mountain sunrise' }));
    await settle(w, 50);

    const call2 = calls.filter(c => c.url.includes('generate-controlled')).at(-1);
    const body2 = JSON.parse(call2.body);
    assert.equal(Object.hasOwn(body2, 'loras'), false, 'Adapter A must NOT leak into Generate Again when LoRA is OFF');

    // Step 4: Select Adapter B, trigger "Generate Again" with stale lastBody (which has no loras or old loras)
    inst.selectCreateLora(adapterB.id);
    await settle(w);
    inst.setState({ jobStatus: 'idle' });
    await inst.onGenerate(Object.assign({}, lastBody, { prompt: 'a majestic mountain sunrise' }));
    await settle(w, 50);

    const call3 = calls.filter(c => c.url.includes('generate-controlled')).at(-1);
    const body3 = JSON.parse(call3.body);
    assert.deepEqual(body3.loras, [{ name: 'style_b', weight: 0.8 }], 'Adapter B is used, overriding stale lastBody');

    // Step 5: Exact replay preserves historical adapter when explicitly flagged
    inst.setState({ jobStatus: 'idle' });
    await inst.onGenerate(Object.assign({}, lastBody, { exactReplay: true }));
    await settle(w, 50);

    const call4 = calls.filter(c => c.url.includes('generate-controlled')).at(-1);
    const body4 = JSON.parse(call4.body);
    assert.deepEqual(body4.loras, [{ name: 'lcm_sdxl', weight: 1.0 }], 'exactReplay preserves historical loras');
  } finally {
    close();
  }
});

test('P1: Reset recipe button restores recommended recipe settings and default strength', async () => {
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
      assets: { loras: [adapter], vaes: [], embeddings: { count: 0, items: [] } }
    });
    inst.selectCreateLora(adapter.id);
    await settle(w);

    // Recommended recipe for lcm_sdxl is 4 steps, cfg 1.5, sampler lcm, scheduler lcm, default weight 1.0
    assert.equal(inst.state.createLora.strength, 1.0);
    assert.equal(inst.state.steps, 4);
    assert.equal(inst.state.cfg, 1.5);

    // User deviates from recommended settings
    inst.setCreateLoraStrength(0.45, 0, 2);
    inst.setState({ steps: 30, cfg: 8.5, sampler: 'euler_a', scheduler: 'discrete' });
    await settle(w);
    assert.equal(inst.state.createLora.strength, 0.45);
    assert.equal(inst.state.steps, 30);

    // Call resetCreateLoraRecipe
    const resetOk = inst.resetCreateLoraRecipe();
    assert.equal(resetOk, true, 'resetCreateLoraRecipe returned true');
    await settle(w);

    // Verify restored settings
    assert.equal(inst.state.createLora.strength, 1.0, 'strength restored to default');
    assert.equal(inst.state.steps, 4, 'steps restored to recommended');
    assert.equal(inst.state.cfg, 1.5, 'cfg restored to recommended');
    assert.equal(inst.state.sampler, 'lcm', 'sampler restored to recommended');
    assert.equal(inst.state.scheduler, 'lcm', 'scheduler restored to recommended');
  } finally {
    close();
  }
});

test('P1: Negative enhancement protection against target switch, draft edits, and Undo', async () => {
  const { w, doc, inst, close } = boot();
  try {
    await settle(w);
    let delayedResolve = null;
    let enhanceCallCount = 0;
    w.fetch = (url, opts = {}) => {
      if (String(url).includes('/api/ollama/enhance')) {
        enhanceCallCount++;
        return new Promise(r => {
          delayedResolve = () => r({
            ok: true, status: 200,
            json: () => Promise.resolve({ ok: true, enhanced: 'blurry, pixelated, bad anatomy, deformed' })
          });
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
    };

    inst.setState({
      target: 'sdxl-base',
      negPrompt: 'low quality, blurry',
      ollamaOnline: true,
      ollamaModel: 'hermes3:latest'
    });
    await settle(w);

    // 1. Target switch invalidation
    const p1 = inst.enhanceNegativePrompt();
    await settle(w, 20);
    assert.equal(inst.state.enhancingNegPrompt, true, 'enhance in flight');

    // User switches target model while in flight
    inst.setState({ target: 'flux2-klein-4b' });
    delayedResolve();
    await p1;
    await settle(w, 20);

    assert.equal(inst.state.enhancingNegPrompt, false);
    assert.equal(inst.state.negEnhancementResult, null, 'enhancement result discarded when target switched');
    assert.equal(inst.state.negPrompt, 'low quality, blurry', 'draft prompt unchanged');

    // 2. Draft edit marks result as stale with warning
    inst.setState({ target: 'sdxl-base', negPrompt: 'initial draft' });
    await settle(w);
    const p2 = inst.enhanceNegativePrompt();
    await settle(w, 20);

    // User edits draft while in flight
    inst.setState({ negPrompt: 'user updated draft while enhancing' });
    delayedResolve();
    await p2;
    await settle(w, 20);

    assert.equal(inst.state.enhancingNegPrompt, false);
    assert.ok(inst.state.negEnhancementResult, 'result is returned');
    assert.equal(inst.state.negEnhancementResult.isStale, true, 'isStale flag set');
    assert.match(inst.state.negEnhancementResult.staleWarning, /Draft edited while enhancing/);

    // 3. Apply enhancement saves previous prompt for reliable Undo
    inst.applyNegEnhancement();
    await settle(w);
    assert.equal(inst.state.negPrompt, 'blurry, pixelated, bad anatomy, deformed');
    assert.equal(inst.state.previousNegPrompt, 'user updated draft while enhancing', 'previous prompt preserved for undo');

    // 4. Undo restores previous draft
    inst.undoNegEnhancement();
    await settle(w);
    assert.equal(inst.state.negPrompt, 'user updated draft while enhancing', 'prompt restored');
    assert.equal(inst.state.previousNegPrompt, null);
  } finally {
    close();
  }
});

test('P1: Duplicate negative-prompt textarea in index.html is eliminated', () => {
  const html = read('index.html');
  assert.equal(html.includes('data-dex-field="negative-prompt-adv"'), false, 'no duplicate negative-prompt-adv in index.html');
  const count = (html.match(/data-dex-field="negative-prompt"/g) || []).length;
  assert.equal(count, 1, 'exactly one negative prompt textarea in template');
});
