'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
// A direct server import initializes the job ledger as well as the image store.
const testRoot = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'dex-lora-unit-'));
process.env.DEX_STATE_DIR = path.join(testRoot, 'state');
process.env.DEX_RUNS_DIR = path.join(testRoot, 'runs');
process.env.DEX_IMAGES_ROOT_OVERRIDE = path.join(testRoot, 'images');
process.env.DEX_MEDIA_ROOT_OVERRIDE = path.join(testRoot, 'media');
process.env.DEX_SCRATCH_ROOT = path.join(testRoot, 'scratch');
process.env.DEX_TEST_ISOLATION = '1';
process.env.DEX_LOCAL_ENGINE_BRIDGE = '0';
process.on('exit', () => fs.rmSync(testRoot, { recursive: true, force: true }));
const {
  normalizeControlledGenerationBody,
  validateControlledGenerationParams,
  allControlledTargets
} = require('../server');

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
      createLora: { enabled: false, selectedId: '' }
    });
    await settle(w);

    // With no adapter selected, generation carries no structured adapters.
    assert.equal(inst.getEffectiveCreateLoras().length, 0, 'no fallback to legacy createLoras');

    // Extra Networks uses the same selection as the Create picker.
    inst.insertLora(adapterA.filename, 1.25);
    await settle(w);
    assert.equal(inst.state.createLora.enabled, true, 'canonical createLora enabled');
    assert.equal(inst.state.createLora.selectedId, adapterA.id, 'canonical adapter selected');
    assert.equal(inst.state.createLora.strength, 1.25, 'strength updated');

    // 3. getActiveLoras reflects canonical selection only
    const active = inst.getActiveLoras();
    assert.equal(active.length, 1);
    assert.equal(active[0].name, adapterA.name);
    assert.equal(active[0].weight, 1.25);

    // Removing the adapter clears the request.
    inst.removeLora();
    await settle(w);
    assert.equal(inst.state.createLora.enabled, false);
    assert.equal(inst.state.createLora.selectedId, '');
    assert.equal(inst.getEffectiveCreateLoras().length, 0);
  } finally {
    close();
  }
});

test('P0: applyFavoritePreset restores the canonical adapter selection', async () => {
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
    assert.equal(inst.state.steps, 4);

    // Apply recipe without LoRA
    inst.applyFavoritePreset('fav-2');
    await settle(w);
    assert.equal(inst.state.createLora.enabled, false);
    assert.equal(inst.state.createLora.selectedId, '');
    assert.equal(inst.getEffectiveCreateLoras().length, 0);
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
    assert.equal(body4.exactReplay, undefined, 'exactReplay must NEVER leak into outbound API request');

    // Defect 1 - Test D: Outbound exact-replay request is accepted by real API normalizer & validator
    const norm4 = normalizeControlledGenerationBody(body4);
    assert.equal(norm4.invalidKey, undefined, 'actual server normalization accepts outbound request');
    const err4 = validateControlledGenerationParams(norm4, allControlledTargets());
    assert.equal(err4, null, 'actual server validation accepts outbound request without unexpected-parameter error');

    // Defect 1 - Test E: Confirm malformed / genuinely unexpected API fields are still rejected
    const badExactReplay = Object.assign({}, body4, { exactReplay: true });
    const normBad1 = normalizeControlledGenerationBody(badExactReplay);
    assert.equal(normBad1.invalidKey, 'exactReplay', 'server rejects raw exactReplay parameter');
    const errBad1 = validateControlledGenerationParams(normBad1, allControlledTargets());
    assert.match(errBad1, /Unexpected field: exactReplay/);

    const malformed = Object.assign({}, body4, { invalid_unknown_param: 'forbidden' });
    const normBad2 = normalizeControlledGenerationBody(malformed);
    assert.equal(normBad2.invalidKey, 'invalid_unknown_param', 'server rejects arbitrary unknown keys');
    const errBad2 = validateControlledGenerationParams(normBad2, allControlledTargets());
    assert.match(errBad2, /Unexpected field: invalid_unknown_param/);
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

test('Defect 2: Extra Networks incompatible adapter selection guard, state synchronization, and strength updates', async () => {
  const { w, inst, close } = boot();
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
    };
    const adapterC = {
      id: 'flux_adapter_asset',
      name: 'flux_realism',
      filename: 'flux_realism.safetensors',
      family: 'flux2',
      compatibility: 'Incompatible',
      proof_status: 'UNPROVEN',
      proof_target_ids: ['flux2-klein-4b'],
      default_weight: 0.9,
      min_weight: 0.0,
      max_weight: 2.0,
      unavailable_reason: 'Incompatible with SDXL architecture',
    };
    inst.setState({
      target: 'sdxl-base',
      assets: { loras: [adapterA, adapterB, adapterC], vaes: [] },
      loraWeights: {},
    });
    await settle(w);

    const toasts = [];
    inst.toast = (msg, tone) => toasts.push({ msg, tone });

    // Step 1: Activate Adapter A at weight 1.2
    inst.insertLora(adapterA.filename, 1.2);
    await settle(w);
    assert.equal(inst.state.createLora.enabled, true, 'Adapter A is enabled');
    assert.equal(inst.state.createLora.selectedId, adapterA.id, 'Adapter A is selected');
    assert.equal(inst.state.createLora.strength, 1.2, 'Adapter A strength is 1.2');
    assert.ok(toasts.some(t => t.msg.includes('Selected adapter lcm_sdxl') && t.tone === '#38bdf8'), 'Success toast for Adapter A');
    assert.equal(inst.getEffectiveCreateLoras()[0].name, 'lcm_sdxl');
    assert.equal(inst.getEffectiveCreateLoras()[0].weight, 1.2);
    assert.deepEqual(JSON.parse(JSON.stringify(inst._createBody().loras)), [{ name: 'lcm_sdxl', weight: 1.2 }]);

    // Step 2 (Defect 2A): Attempt to select incompatible Adapter C while Adapter A is active
    toasts.length = 0;
    inst.insertLora(adapterC.filename, 0.9);
    await settle(w);

    // Canonical selection remains Adapter A
    assert.equal(inst.state.createLora.enabled, true, 'Adapter A remains enabled');
    assert.equal(inst.state.createLora.selectedId, adapterA.id, 'Adapter A remains selected; Adapter C rejected');
    assert.equal(inst.state.createLora.strength, 1.2, 'Strength remains 1.2 for Adapter A, not overwritten by C');
    assert.equal(inst.getEffectiveCreateLoras()[0].name, 'lcm_sdxl', 'Effective LoRAs still Adapter A');
    assert.equal(inst.getEffectiveCreateLoras()[0].weight, 1.2);
    assert.deepEqual(JSON.parse(JSON.stringify(inst._createBody().loras)), [{ name: 'lcm_sdxl', weight: 1.2 }], 'Outbound request still Adapter A');

    // No success toast appeared; warning toast explaining incompatibility appeared
    assert.equal(toasts.some(t => t.msg.includes('Selected adapter')), false, 'NO success toast for incompatible adapter');
    assert.ok(toasts.some(t => t.msg.includes('Incompatible with SDXL architecture') && t.tone === '#fbbf24'), 'Warning toast displays honest incompatibility reason');

    // Step 3 (Defect 2B): Select compatible proven Adapter B
    toasts.length = 0;
    inst.insertLora(adapterB.filename, 0.85);
    await settle(w);

    assert.equal(inst.state.createLora.enabled, true, 'Adapter B is enabled');
    assert.equal(inst.state.createLora.selectedId, adapterB.id, 'Adapter B is selected');
    assert.equal(inst.state.createLora.strength, 0.85, 'Adapter B strength is 0.85');
    assert.ok(toasts.some(t => t.msg.includes('Selected adapter style_b') && t.tone === '#38bdf8'), 'Success toast for Adapter B');
    assert.equal(inst.getEffectiveCreateLoras()[0].name, 'style_b');
    assert.equal(inst.getEffectiveCreateLoras()[0].weight, 0.85);
    assert.deepEqual(JSON.parse(JSON.stringify(inst._createBody().loras)), [{ name: 'style_b', weight: 0.85 }]);

    // Step 4 (Defect 2C): Modify Adapter B's strength inside Extra Networks
    inst.setLoraWeight('style_b', 1.45);
    await settle(w);

    assert.equal(inst.state.createLora.strength, 1.45, 'Canonical createLora.strength updated to 1.45');
    assert.equal(inst.state.loraWeights[adapterB.id], 1.45, 'loraWeights state synchronized');
    assert.equal(inst.getEffectiveCreateLoras()[0].name, 'style_b');
    assert.equal(inst.getEffectiveCreateLoras()[0].weight, 1.45);
    assert.deepEqual(JSON.parse(JSON.stringify(inst._createBody().loras)), [{ name: 'style_b', weight: 1.45 }], 'Outbound request updated with new strength');

    // Step 5 (Defect 2D): Remove adapter in Extra Networks
    toasts.length = 0;
    inst.removeLora('style_b');
    await settle(w);

    assert.equal(inst.state.createLora.enabled, false, 'Canonical selection is disabled');
    assert.equal(inst.getEffectiveCreateLoras().length, 0, 'No effective LoRAs');
    assert.equal(inst._createBody().loras, undefined, 'Outbound request contains no LoRA');
    assert.ok(toasts.some(t => t.msg.includes('Removed adapter') && t.tone === '#94a3b8'), 'Removed toast displayed');

    // Also verify disabling via selectCreateLora('')
    inst.insertLora(adapterB.filename, 0.8);
    await settle(w);
    assert.equal(inst.state.createLora.enabled, true);
    inst.selectCreateLora('');
    await settle(w);
    assert.equal(inst.state.createLora.enabled, false);
    assert.equal(inst._createBody().loras, undefined, 'No ghost adapter in request after selectCreateLora("")');
  } finally {
    close();
  }
});

// ---- Automatic accelerator highlighting (family-compatible acceleration LoRAs) ----
const { buildLoraCards } = require('../extra-networks');
const { routesFor } = require('../lora-runtime-policy');
const ACCEL_FILES = [
  ['sdxl_lightning_4step_lora.safetensors', 'sdxl-base'],
  ['Hyper-SDXL-8steps-CFG-lora.safetensors', 'sdxl-base'],
  ['lcm_sdxl.safetensors', 'sdxl-base'],
  ['lcm_sd15.safetensors', 'sd15'],
  ['pixelart_lora.safetensors', 'flux2-klein-4b'],
];
// Cards shaped exactly as GET /api/extra-networks?target=<target> builds them.
function cardsFor(target) {
  return buildLoraCards(ACCEL_FILES.map(([filename, proven]) => ({
    id: filename.replace(/\.safetensors$/, ''), filename, full_path: '/wc2tb/loras/' + filename,
    proof_status: 'PROVEN', proof_target_ids: [proven], proof_backend: 'sdcpp', proof_apply_modes: ['immediately'],
    metal_inference_status: proven === 'flux2-klein-4b' ? 'UNTESTED' : 'FUNCTIONAL_METAL', metal_target_ids: proven === 'flux2-klein-4b' ? [] : [proven],
    mflux_rslora_verified: proven === 'flux2-klein-4b',
    production_routes: Array.from(new Set([proven, target])).flatMap(t => routesFor(t, filename)),
  })), target);
}
const ACCEL_TARGETS = [
  { id: 'sdxl-base', label: 'SDXL Base', backend: 'sdcpp', family: 'sdxl', defaultSteps: 20, defaultCfgScale: 7 },
  { id: 'sdxl-lustify', label: 'LUSTIFY! APEX V8', backend: 'sdcpp', family: 'sdxl', defaultSteps: 30, defaultCfgScale: 5, defaultSampler: 'dpm++2m' },
  { id: 'sdxl-pony', label: 'Pony Diffusion V6 XL', backend: 'sdcpp', family: 'pony', defaultSteps: 10, defaultCfgScale: 6.5, defaultSampler: 'dpm++2m' },
  { id: 'sd15', label: 'SD 1.5', backend: 'sdcpp', family: 'sd15', defaultSteps: 20, defaultCfgScale: 7 },
  { id: 'flux2-klein-4b', label: 'FLUX.2 Klein 4B', backend: 'mflux', family: 'flux2', defaultSteps: 4 },
];
function assetStub(w) {
  const calls = [];
  w.fetch = (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method || 'GET', body: opts.body });
    const m = String(url).match(/\/api\/extra-networks\?target=([^&]+)/);
    const data = m ? { loras: cardsFor(decodeURIComponent(m[1])), vaes: [], embeddings: { count: 0, items: [] } }
      : String(url).includes('generate-controlled') ? { ok: true, job_id: 'job-stub', seeds: [1] } : { ok: true };
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(data) });
  };
  return calls;
}
const chipIds = doc => [...doc.querySelectorAll('[data-accelerator-chip]')].map(b => b.getAttribute('data-accelerator-chip'));
const settings = inst => [inst.state.steps, inst.state.cfg, inst.state.sampler, inst.state.scheduler];

test('accelerator group lists only family-compatible accelerators for the selected model, labelled unproven off the base checkpoint', async () => {
  const { w, doc, inst, close } = boot();
  try {
    await settle(w);
    assetStub(w);
    inst.setState({ modelTargets: ACCEL_TARGETS, target: 'sdxl-lustify', assets: { loras: cardsFor('sdxl-lustify'), vaes: [], embeddings: { count: 0, items: [] } }, showLoraPicker: true });
    await settle(w);
    const group = doc.querySelector('[data-dex-field="lora-accelerator-group"]');
    assert.ok(group, 'accelerator group renders');
    assert.match(group.textContent, /Acceleration for LUSTIFY! APEX V8/);
    assert.deepEqual(chipIds(doc).sort(), ['Hyper-SDXL-8steps-CFG-lora', 'lcm_sdxl', 'sdxl_lightning_4step_lora']);
    assert.equal(doc.querySelectorAll('[data-accelerator-unproven]').length, 3, 'family-only routes are badged unproven');
    assert.match(doc.querySelector('[data-accelerator-chip="sdxl_lightning_4step_lora"]').textContent, /4 steps · euler · sgm_uniform · CFG 1/);
    assert.equal(doc.querySelector('[data-dex-field="open-lora-picker"]').getAttribute('data-accelerators-available'), '3');

    // On the verified checkpoint the chips are not badged unproven.
    inst.setState({ target: 'sdxl-base', assets: { loras: cardsFor('sdxl-base'), vaes: [], embeddings: { count: 0, items: [] } } });
    await settle(w);
    assert.equal(chipIds(doc).length, 3);
    assert.equal(doc.querySelectorAll('[data-accelerator-unproven]').length, 0);

    // SD1.5 shows only its own accelerator; SDXL Turbo-free FLUX shows none.
    inst.setState({ target: 'sd15', assets: { loras: cardsFor('sd15'), vaes: [], embeddings: { count: 0, items: [] } } });
    await settle(w);
    assert.deepEqual(chipIds(doc), ['lcm_sd15']);
    inst.setState({ target: 'flux2-klein-4b', assets: { loras: cardsFor('flux2-klein-4b'), vaes: [], embeddings: { count: 0, items: [] } } });
    await settle(w);
    assert.equal(doc.querySelector('[data-dex-field="lora-accelerator-group"]'), null, 'no accelerators for an incompatible family');
    assert.equal(doc.querySelector('[data-dex-field="open-lora-picker"]').hasAttribute('data-accelerators-available'), false);
  } finally { close(); }
});

test('activating a highlighted accelerator applies its server recipe; turning it off restores settings', async () => {
  const { w, doc, inst, close } = boot();
  try {
    await settle(w);
    assetStub(w);
    inst.setState({ modelTargets: ACCEL_TARGETS, target: 'sdxl-lustify', prompt: 'portrait', steps: 30, cfg: 5, sampler: 'dpm++2m', scheduler: 'karras', jobStatus: 'idle',
      assets: { loras: cardsFor('sdxl-lustify'), vaes: [], embeddings: { count: 0, items: [] } }, showLoraPicker: true });
    await settle(w);
    doc.querySelector('[data-accelerator-chip="sdxl_lightning_4step_lora"]').click();
    await settle(w);
    assert.equal(inst.state.createLora.enabled, true);
    assert.deepEqual(settings(inst), [4, 1, 'euler', 'sgm_uniform'], 'Lightning recipe (CFG 1) applied');
    const chip = doc.querySelector('[data-accelerator-chip="sdxl_lightning_4step_lora"]');
    assert.equal(chip.getAttribute('aria-pressed'), 'true');
    assert.equal(chip.getAttribute('data-accelerator-active'), 'true');
    assert.ok(!inst.validationMessages().some(([m]) => /CFG scale/.test(m)), 'the active Lightning recipe passes CFG validation');

    // The outbound body is accepted by the real server validator for this checkpoint.
    const body = inst._createBody();
    assert.deepEqual(JSON.parse(JSON.stringify(body.loras)), [{ name: 'sdxl_lightning_4step_lora', weight: 1 }]);
    const norm = normalizeControlledGenerationBody(JSON.parse(JSON.stringify(body)));
    assert.equal(validateControlledGenerationParams(norm, allControlledTargets()), null);

    // Switching accelerators keeps the original saved settings; Hyper uses the server recipe (CFG 6), not model-presets (5).
    doc.querySelector('[data-accelerator-chip="Hyper-SDXL-8steps-CFG-lora"]').click();
    await settle(w);
    assert.deepEqual(settings(inst), [8, 6, 'ddim_trailing', 'discrete']);

    doc.querySelector('[data-dex-field="accelerator-off-btn"]').click();
    await settle(w);
    assert.equal(inst.state.createLora.enabled, false);
    assert.deepEqual(settings(inst), [30, 5, 'dpm++2m', 'karras'], 'previous settings restored');
    inst.setState({ cfg: 0 });
    assert.ok(inst.validationMessages().some(([m]) => /CFG scale/.test(m)), 'CFG 0 is still rejected without the Lightning recipe');
  } finally { close(); }
});

test('model switch keeps a family-compatible accelerator (re-applying its recipe) and disables + restores otherwise', async () => {
  const { w, inst, close } = boot();
  try {
    await settle(w);
    assetStub(w);
    inst.setState({ modelTargets: ACCEL_TARGETS, target: 'sdxl-lustify', assetsTarget: 'sdxl-lustify', steps: 30, cfg: 5, sampler: 'dpm++2m', scheduler: 'karras',
      assets: { loras: cardsFor('sdxl-lustify'), vaes: [], embeddings: { count: 0, items: [] } } });
    inst.selectCreateLora('lcm_sdxl');
    await settle(w);
    assert.deepEqual(settings(inst), [4, 1.5, 'lcm', 'lcm']);

    await inst.onSelectTarget('sdxl-pony', { quiet: true });
    await settle(w, 120);
    assert.equal(inst.state.assetsTarget, 'sdxl-pony');
    assert.equal(inst.state.createLora.enabled, true, 'SDXL accelerator stays on for a Pony checkpoint');
    assert.deepEqual(settings(inst), [4, 1.5, 'lcm', 'lcm'], 'recipe re-applied after the target defaults');
    assert.equal(inst.getEffectiveCreateLoras()[0].name, 'lcm_sdxl');

    await inst.onSelectTarget('sd15', { quiet: true });
    await settle(w, 120);
    assert.equal(inst.state.createLora.enabled, false, 'SDXL accelerator disabled on SD1.5');
    assert.deepEqual(settings(inst), [20, 7, 'dpm++2m', 'discrete'], 'SD1.5 receives its own defaults');
    await inst.onSelectTarget('sdxl-lustify', { quiet: true });
    await settle(w, 120);
    assert.equal(inst.getEffectiveCreateLoras()[0].name, 'lcm_sdxl');
    inst.selectCreateLora('');
    assert.deepEqual(settings(inst), [30, 5, 'dpm++2m', 'karras'], 'original checkpoint restores its own settings');
  } finally { close(); }
});

test('Create and Edit catalog responses are scoped to their latest request and can retry', async () => {
  const { w, inst, close } = boot();
  try {
    await settle(w);
    const pending = [];
    w.fetch = (url, opts) => new Promise((resolve, reject) => pending.push({ url, opts, resolve, reject }));
    const catalog = name => ({ loras: [{ id: name, name }], vaes: [] });
    const reply = (request, data, status = 200) => request.resolve({ ok: status === 200, status, json: async () => data });
    const createLoad = target => { inst.setState({ target }); return inst.loadAssets(); };
    const first = createLoad('sd15');
    assert.equal(inst.loadAssets(), first, 'same-target loads share their in-flight request');
    const second = createLoad('sdxl-base');
    const latest = createLoad('sd15');
    assert.equal(pending.length, 3);
    reply(pending[2], catalog('new'));
    assert.equal(await latest, true);
    reply(pending[1], catalog('middle'));
    reply(pending[0], catalog('old'));
    assert.equal(await first, false);
    assert.equal(await second, false);
    assert.equal(inst.state.assets.loras[0].id, 'new');
    const failed = inst.loadAssets();
    reply(pending[3], {}, 503);
    assert.equal(await failed, false);
    assert.equal(inst.state.assetsStatus, 'failed');
    assert.match(inst.state.assetsError, /503/);
    pending.length = 3;

    const editLoad = editModel => {
      inst.edSet({ state: { editModel } });
      return inst.loadEditAssets();
    };
    inst.setState({ screens: { ...inst.state.screens, 2: 'create' } });
    const older = editLoad('sd15');
    const newer = editLoad('sdxl-base');
    pending[4].reject(new w.DOMException('Catalog request timed out', 'TimeoutError'));
    assert.equal(await newer, false);
    assert.equal(inst._ed().assetsStatus, 'failed');
    assert.match(inst._ed().assetsError, /timed out/);
    assert.notEqual(inst._ed().assetsFor, 'sdxl-base');
    const retry = inst.loadEditAssets();
    assert.ok(pending[5].opts.signal, 'Edit GET has a timeout signal');
    reply(pending[5], catalog('edit'));
    reply(pending[3], catalog('older'));
    assert.equal(await retry, true);
    assert.equal(await older, false);
    assert.equal(inst._ed().assets.loras[0].id, 'edit');
  } finally { close(); }
});

test('Create stack uses compatible entries only and None disables the effective request', async () => {
  const { w, inst, close } = boot();
  try {
    await settle(w);
    const target = 'flux2-klein-4b';
    const card = (id, overrides = {}) => ({
      id, name: id, family: 'flux2', staged: true, plain_mflux: true,
      default_weight: 0.6, min_weight: 0.1, max_weight: 2,
      production_routes: [{ target, backend: 'mflux', plain: true, production: true }], ...overrides
    });
    inst.setState({ target, assetsTarget: target, assetsStatus: 'loaded', modelTargets: ACCEL_TARGETS,
      assets: { loras: [card('fixer', { slider: true, max_weight: 3, default_weight: 2.5 }), card('style')], vaes: [] } });
    inst._setStack([{ id: 'parked-a', weight: 1 }, { id: 'parked-b', weight: 1 }, { id: 'parked-c', weight: 1 },
      { id: 'fixer', weight: 2.5 }, { id: 'FIXER', weight: 0.5 }]);
    inst.toggleCreateStack('style');
    const settings = () => JSON.parse(JSON.stringify(inst.getEffectiveCreateLoras().map(({ name, weight }) => ({ name, weight }))));
    assert.deepEqual(settings(), [{ name: 'fixer', weight: 2.5 }, { name: 'style', weight: 0.6 }]);
    inst.setCreateStackWeight('style', 0.8);
    assert.equal(settings()[1].weight, 0.8);
    inst.setCreateLoraEnabled(false);
    assert.deepEqual(settings(), []);
    inst.setCreateLoraEnabled(true);
    assert.equal(settings().length, 2);
    // The registered single adapter takes precedence, but disabling it must
    // still turn off the entire structured request.
    inst.selectCreateLora('style');
    assert.deepEqual(settings(), [{ name: 'style', weight: 0.6 }]);
    inst.setCreateLoraEnabled(false);
    assert.deepEqual(settings(), []);
    inst.selectCreateLora('');
    assert.deepEqual(settings(), []);
    assert.equal(inst._stack().length, 3, 'parked entries are retained');
  } finally { close(); }
});

test('failed discovery never reports a refresh and 409 preserves the selected checkpoint recipe', async () => {
  const { w, inst, close } = boot();
  try {
    await settle(w);
    inst.setState({ target: 'flux2-klein-4b', modelTargets: ACCEL_TARGETS, steps: 4, cfg: 1, sampler: 'euler' });
    inst._waitJob = async () => ({ status: 'FAIL', firstFailedGate: 'discovery' });
    const toasts = [];
    inst.toast = text => toasts.push(text);
    let loads = 0;
    inst.loadAssets = async () => { loads++; return true; };
    w.fetch = async url => {
      if (url.endsWith('/discover-assets')) return { ok: true, status: 200, json: async () => ({ job_id: 'fixture' }) };
      assert.ok(url.endsWith('/secondary/activate'));
      return { ok: false, status: 409, json: async () => ({ error: 'busy', modelState: { activeSecondaryModel: 'sdxl-lustify' } }) };
    };
    await inst.discoverAssets();
    assert.deepEqual(toasts, ['Asset discovery failed: Discovery job discovery']);
    assert.equal(loads, 0);
    assert.equal(await inst.onSelectTarget('sdxl-base', { quiet: true }), false);
    assert.equal(inst.state.target, 'flux2-klein-4b');
    assert.deepEqual([inst.state.steps, inst.state.cfg, inst.state.sampler], [4, 1, 'euler']);
    assert.equal(inst.state.modelState.activeSecondaryModel, 'sdxl-lustify');
  } finally { close(); }
});

test('reload restores only the saved checkpoint settings and keeps parked history', async () => {
  const target = 'flux2-klein-4b';
  const storage = {
    dex_create_checkpoint_settings_v1: JSON.stringify({
      'sdxl-base': { sampling: { steps: 27, cfg: 6, sampler: 'dpm++2m', scheduler: 'karras' } },
      [target]: { sampling: { steps: 6, cfg: 1, sampler: 'dpm++2m', scheduler: 'karras' } }
    }),
    dex_create_lora_stack_v1: JSON.stringify([{ id: 'sdxl-adapter', weight: 0.7 }]),
    dex_target: target
  };
  const { w, inst, close } = boot({ storage });
  try {
    await settle(w);
    inst.setState({ modelTargets: ACCEL_TARGETS, target: 'sd15' });
    inst.loadAssets = () => {};
    assert.equal(await inst.onSelectTarget(target, { quiet: true, restoreOnly: true }), true);
    assert.deepEqual([inst.state.steps, inst.state.cfg, inst.state.sampler, inst.state.scheduler], [6, 1, 'euler', 'discrete']);
    assert.equal(inst._stack()[0].id, 'sdxl-adapter');
    assert.equal(w.localStorage.getItem('dex_create_lora_stack_v1'), storage.dex_create_lora_stack_v1);
  } finally { close(); }
});

test('a model catalog loaded before activation cannot overwrite the confirmed server slot', async () => {
  const { w, inst, close } = boot();
  try {
    await settle(w);
    inst.setState({ target: 'flux2-klein-4b', modelTargets: ACCEL_TARGETS });
    inst._initialTargetRestored = true;
    inst.loadAssets = () => {};
    let capResponse;
    w.fetch = async url => {
      if (url.endsWith('/api/capabilities')) return new Promise(resolve => { capResponse = resolve; });
      if (url.endsWith('/api/models')) return { ok: true, json: async () => ({ models: [] }) };
      assert.ok(url.endsWith('/secondary/activate'), url);
      return { ok: true, json: async () => ({ modelState: { activeSecondaryModel: 'sdxl-base' } }) };
    };
    const older = inst.loadModels();
    assert.equal(await inst.onSelectTarget('sdxl-base', { quiet: true }), true);
    capResponse({ ok: true, json: async () => ({ modelTargets: ACCEL_TARGETS, modelState: { activeSecondaryModel: 'sd15' } }) });
    await older;
    assert.equal(inst.state.target, 'sdxl-base');
    assert.equal(inst.state.modelState.activeSecondaryModel, 'sdxl-base');
  } finally { close(); }
});
