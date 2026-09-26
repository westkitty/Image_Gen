// DexDiffusion workstation layer: result staging, Seed Lab, prompt A/B, numbered
// Batch queue, image-first Edit (img2img, mask editor, outpaint), Enhance,
// Library lineage/Keepers/compare, Doctor and reload recovery.
//
// It extends the DexDiffusion component (component.js) rather than replacing
// it: all generation goes through the existing API routes, images are referred
// to by canonical image id, and prompt text never reaches localStorage unless
// prompt saving is on. Workstation state lives in `this.ws` (kept across screen
// navigation) and re-renders through setState({ _wsTick }).
(function () {
  'use strict';
  const C = window.DexDiffusionComponent;
  if (!C) return;
  const P = C.prototype;
  const h = (...a) => React.createElement(...a);
  const D = window.DexClient;
  const LARGE_TOTAL = 12;
  const SESSION_KEY = 'dex_ws_session';

  const css = {
    panel: { border: '1px solid rgba(148,163,184,.14)', background: 'rgba(6,10,16,.64)', borderRadius: 9, padding: 11, marginBottom: 12 },
    title: { fontSize: 12, fontWeight: 800, color: '#cbd5e1', letterSpacing: '.06em', textTransform: 'uppercase' },
    label: { fontSize: 10, color: '#7f8ca8', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 4, fontWeight: 700 },
    input: { width: '100%', border: '1px solid rgba(148,163,184,.16)', background: 'rgba(5,10,18,.72)', color: '#e2e8f0', borderRadius: 7, padding: '8px 9px', outline: 'none', fontSize: 13, fontFamily: "'DM Sans',sans-serif", minHeight: 36 },
    row: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' },
    muted: { fontSize: 11, color: '#8193a8', lineHeight: 1.45 },
    mono: { fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, color: '#94a3b8', overflowWrap: 'anywhere' },
  };
  const tone = { ok: '#65d66e', warn: '#fbbf24', bad: '#f87171', info: '#38bdf8', off: '#94a3b8' };
  const stateTone = s => ({ INTERRUPTED: tone.warn, PASS: tone.ok, DONE: tone.ok, WARN: tone.warn, RUNNING: tone.info, QUEUED: tone.off, FAIL: tone.bad, FAILED: tone.bad, SKIPPED: tone.off, STOPPED: tone.warn }[s] || tone.off);

  function btn(label, onClick, color, extra) {
    const c = color || '#38bdf8';
    return h('button', Object.assign({ onClick, type: 'button',
      style: { border: '1px solid ' + c + '66', background: c + '16', color: c, borderRadius: 7, padding: '7px 10px', minHeight: 34, fontSize: 12, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", fontWeight: 700 } }, extra || {}), label);
  }
  function chip(text, color) {
    return h('span', { style: { border: '1px solid ' + color + '55', color, background: color + '12', borderRadius: 6, padding: '2px 7px', fontSize: 10, fontWeight: 700, letterSpacing: '.04em' } }, text);
  }
  function numInput(value, onChange, attrs) {
    return h('input', Object.assign({ type: 'number', inputMode: 'numeric', value: String(value), onChange: e => onChange(e.target.value), style: Object.assign({}, css.input, { width: 90 }) }, attrs || {}));
  }
  function thumb(url, active, onClick, caption, badge) {
    return h('button', { type: 'button', onClick, title: caption,
      style: { position: 'relative', padding: 0, border: '2px solid ' + (active ? '#38bdf8' : 'rgba(148,163,184,.16)'), borderRadius: 8, overflow: 'hidden', cursor: 'pointer', background: '#0a0e14', width: '100%', aspectRatio: '1 / 1' } },
      url ? h('img', { src: url, alt: caption || '', loading: 'lazy', style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' } }) : h('div', { style: { color: tone.bad, fontSize: 11, padding: 8 } }, 'no image'),
      badge ? h('div', { style: { position: 'absolute', left: 0, right: 0, bottom: 0, background: 'rgba(4,8,14,.78)', color: '#dbe4ee', fontSize: 10, padding: '3px 5px', textAlign: 'left', fontFamily: "'IBM Plex Mono',monospace" } }, badge) : null);
  }

  // ── State plumbing ──────────────────────────────────────────────
  P._ws = function () {
    if (this.ws) return this.ws;
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(SESSION_KEY) || '{}') || {}; } catch (_) {}
    this.ws = {
      quantity: saved.quantity || 1, hires: false, hiresScale: 2, hiresSteps: 0, hiresDenoise: 0.45, hiresUpscaler: 'Latent',
      results: [], activeIndex: 0, lastBody: null,
      seedLab: { open: false, mode: 'neighbors', count: 4 }, ab: { open: false, promptB: '', status: 'idle', pair: [] },
      batchText: typeof saved.batchText === 'string' ? saved.batchText : '', parse: null, expanded: {}, batchQty: 1, preflight: null, confirmLarge: false,
      queueId: saved.queueId || null, queue: null,
      editSourceId: saved.editSourceId || null, editOriginalId: saved.editOriginalId || null, editSource: null, editResults: [], editStatus: 'idle', prep: 'none',
      brush: saved.brush || { mode: 'paint', size: 40 }, maskZoom: 1, maskInfo: null,
      out: { left: 0, right: 128, top: 0, bottom: 0, strength: 0.85 }, outStatus: 'idle',
      enhSourceId: saved.enhSourceId || null, enhSource: null, enhResults: [], enhStatus: 'idle', lanczosScale: 2,
      lib: { filter: 'all', items: [], total: 0, selectedId: null, selected: null, loading: false },
      compareIds: Array.isArray(saved.compareIds) ? saved.compareIds.slice(0, 4) : [], compareItems: [], compareZoom: 1,
      doctor: null, doctorBusy: false, activeJobId: saved.activeJobId || null, recovered: false,
    };
    return this.ws;
  };
  P.wsSet = function (patch) {
    const ws = this._ws();
    Object.assign(ws, typeof patch === 'function' ? patch(ws) : patch);
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(D.persistableSession(ws, this.state.savePrompts))); } catch (_) {}
    this.setState({ _wsTick: (this.state._wsTick || 0) + 1 });
  };
  P._targetSpec = function (id) { return (this.state.modelTargets || []).find(t => t.id === (id || this.state.target)) || null; };
  P._controls = function () { return D.controlsFor(this._targetSpec()); };
  P._gate = function (k) { const g = ((this.state.capabilityData || {}).featureGates || {})[k]; return !!(g && g.supported === true); };
  P._api = async function (route, body, method) {
    const r = await fetch(this.state.backendUrl + route, body === undefined && !method ? undefined : {
      method: method || 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    const data = await r.json().catch(() => ({ error: r.statusText }));
    return { ok: r.ok, status: r.status, data };
  };
  // Poll one job to a terminal state (independent of the Create poller).
  P._waitJob = function (jobId, onTick) {
    return new Promise(resolve => {
      const t = setInterval(async () => {
        try {
          const r = await fetch(this.state.backendUrl + '/api/jobs/' + jobId, { signal: AbortSignal.timeout(4000) });
          if (r.status === 404) { clearInterval(t); resolve({ id: jobId, status: 'LOST', firstFailedGate: 'job-lost (console restarted?)' }); return; }
          if (!r.ok) return;
          const job = await r.json();
          if (onTick) onTick(job);
          if (this._jobTerminal(job.status)) { clearInterval(t); resolve(job); }
        } catch (_) {}
      }, 1000);
    });
  };
  P._imageMeta = async function (id) {
    if (!id) return null;
    const r = await this._api('/api/images/' + encodeURIComponent(id) + '/meta', undefined);
    return r.ok ? r.data : null;
  };
  P._failText = function (job) {
    const g = job.firstFailedGate || 'unknown';
    const hints = {
      'remote-png': 'the generation produced no valid PNG on Big Mac', scp: 'remote transfer failed', 'png-type': 'the transferred file is not a valid PNG',
      'model-present': 'the selected model is missing on Big Mac', timeout: 'the job timed out', 'mask-empty': 'the mask is empty', 'mask-full': 'the whole image is masked',
      'tunnel-down': 'the SD1.5 server tunnel is down', route: 'Big Mac is unreachable', 'init-img': 'the source image could not be used', source: 'the source image could not be found',
    };
    return 'Failed at gate "' + g + '"' + (hints[g] ? ' — ' + hints[g] : '') + '.';
  };

  // ── Create: quantity, results, variations ───────────────────────
  P._createBody = function (over) {
    const s = this.state, ws = this._ws(), ctl = this._controls();
    const seed = Number(s.seed);
    const body = {
      target: s.target || 'sd15', prompt: String(s.prompt || '').trim(),
      steps: +s.steps, width: +s.width, height: +s.height,
      seed: Number.isInteger(seed) && seed >= 0 ? seed : -1,
      quantity: Math.max(1, Math.min(100, parseInt(ws.quantity, 10) || 1)),
      save_prompts: !!s.savePrompts,
    };
    if (ctl.negativePrompt) body.negative_prompt = s.negPrompt || '';
    if (ctl.cfg) body.cfg_scale = +s.cfg;
    if (ctl.scheduler) body.scheduler = s.scheduler || 'discrete';
    if (ctl.vae) body.vae = s.selectedVae === 'default' ? 'auto' : s.selectedVae;
    if (ctl.hiresRefine && ws.hires) Object.assign(body, { hires_scale: +ws.hiresScale, hires_steps: parseInt(ws.hiresSteps, 10) || 0, hires_denoise: +ws.hiresDenoise, hires_upscaler: ws.hiresUpscaler });
    return Object.assign(body, over || {});
  };

  P.onGenerate = async function (over, opts) {
    const o = opts || {};
    if (this.state.jobStatus === 'generating' && !o.force) {
      this.toast('A generation is already running — its results will appear here.', '#fbbf24');
      return;
    }
    const body = this._createBody(over);
    if (!body.prompt) { this.toast('Enter a prompt first', '#fbbf24'); return; }
    if (body.quantity >= 4) {
      const pf = await this._api('/api/preflight', { target: body.target, prompts: 1, quantity: body.quantity });
      const bad = pf.ok ? pf.data.rows.filter(r => r.state === 'FAIL') : [];
      if (bad.length) { this.toast('Preflight: ' + bad.map(r => r.detail).join('; '), '#ef4444'); return; }
      if (pf.ok && pf.data.needsConfirmation && !window.confirm('Generate ' + pf.data.summary + '?')) return;
    }
    this.wsSet({ lastBody: body, results: [], activeIndex: 0 });
    this.setState({ jobStatus: 'generating', progress: 0, currentImageSrc: null, errorMsg: '', lastGenerationParams: Object.assign({}, body, { preset: this.state.preset }) });
    const r = await this._api('/api/actions/generate-controlled', body);
    if (!r.ok) {
      this.setState({ jobStatus: 'error', errorMsg: r.data.error || 'rejected' });
      this.toast(r.data.error || 'Generate failed', '#ef4444');
      return;
    }
    this.wsSet({ activeJobId: r.data.job_id, results: (r.data.seeds || []).map((seed, i) => ({ index: i, status: 'QUEUED', seed, target: body.target })) });
    this._followCreateJob(r.data.job_id, body);
  };

  P._followCreateJob = function (jobId, body) {
    this._startPoll(jobId, job => this._onCreateDone(job, body));
  };
  P._onCreateDone = function (job, body) {
    const results = D.jobResults(job);
    const first = results.find(x => x.status === 'DONE');
    const base = this.state.backendUrl;
    this.wsSet({ results, activeIndex: first ? results.indexOf(first) : 0, activeJobId: null });
    if (this._jobOk(job.status) && first) {
      this.setState({ jobStatus: 'complete', progress: 100, currentImageSrc: base + first.imageUrl, lastSeed: first.seed,
        lastGenerationParams: Object.assign({}, this.state.lastGenerationParams || body || {}, { runId: first.runId, status: job.status }) });
      this.toast(results.length > 1 ? results.filter(x => x.status === 'DONE').length + ' / ' + results.length + ' images done' : 'Done · seed ' + first.seed, '#65d66e');
      setTimeout(() => this.loadRuns(), 1200);
    } else {
      this.setState({ jobStatus: 'error', progress: 0, errorMsg: this._failText(job) });
      this.toast('Generation failed · ' + (job.firstFailedGate || job.status), '#ef4444');
    }
  };

  P.selectResult = function (i) {
    const ws = this._ws(), r = ws.results[i];
    if (!r || !r.imageUrl) return;
    // Keep the staging pane where it is while the main image swaps.
    const anchor = document.querySelector('[data-results-anchor]');
    let pane = anchor && anchor.parentElement;
    while (pane && pane !== document.body && !/(auto|scroll)/.test(getComputedStyle(pane).overflowY)) pane = pane.parentElement;
    const top = pane ? pane.scrollTop : 0;
    const img = new Image();
    img.onload = img.onerror = () => {
      this.wsSet({ activeIndex: i });
      this.setState({ currentImageSrc: this.state.backendUrl + r.imageUrl, lastSeed: r.seed });
      if (pane) requestAnimationFrame(() => requestAnimationFrame(() => { pane.scrollTop = top; }));
    };
    img.src = this.state.backendUrl + r.imageUrl;
  };
  P._activeResult = function () { const ws = this._ws(); return ws.results[ws.activeIndex] || null; };

  // Universal image actions (subset shown depends on proven capability gates).
  P.imageActions = function (img, opts) {
    if (!img || !img.imageId) return [];
    const o = opts || {};
    const id = img.imageId, base = this.state.backendUrl;
    const out = [];
    const add = (label, fn, color) => out.push(btn(label, fn, color));
    // Variations and seed exploration only make sense for text-to-image outputs.
    const generated = !img.operation || ['txt2img', 'variation', 'seed-lab', 'prompt-ab', 'batch'].includes(img.operation);
    add('Open', () => window.open(base + '/api/images/' + encodeURIComponent(id), '_blank'), '#94a3b8');
    if (generated && !o.noVariation) add('Variation', () => this.generateVariation(img), '#65d66e');
    if (generated && img.seed != null && img.target) add('Explore Seeds', () => this.openSeedLab(img), '#65d66e');
    if (this._gate('img2img')) add('Img2Img', () => this.sendToEdit(id, 'img2img'), '#a78bfa');
    if (this._gate('inpaint')) add('Inpaint', () => this.sendToEdit(id, 'inpaint'), '#a78bfa');
    if (this._gate('outpaint')) add('Outpaint', () => this.sendToEdit(id, 'outpaint'), '#a78bfa');
    add('Enhance', () => this.sendToEnhance(id), '#f59e0b');
    add(this._ws().compareIds.includes(id) ? 'In compare ✓' : 'Compare', () => this.toggleCompare(id), '#38bdf8');
    if (generated && img.seed != null) add('Reuse Seed', () => { this.setState({ seed: String(img.seed) }); this.toast('Seed ' + img.seed + ' set', '#38bdf8'); }, '#94a3b8');
    add('Reuse Settings', () => this.reuseSettings(id), '#94a3b8');
    add(img.keeper ? '★ Keeper' : '☆ Keeper', () => this.toggleKeeper(id, !img.keeper, img), '#fbbf24');
    add('Lineage', () => this.showInLibrary(id), '#94a3b8');
    add('Copy path', async () => { const m = await this._imageMeta(id); this.copyText('Canonical path', m ? m.path : id); }, '#94a3b8');
    return out;
  };

  P.generateVariation = function (img) {
    const meta = img || {};
    const over = { seed: -1, quantity: 1, operation: 'variation', parent_image_id: meta.imageId || undefined };
    if (meta.target && (this.state.modelTargets || []).some(t => t.id === meta.target)) over.target = meta.target;
    this.setScreen('create');
    this.onGenerate(over);
  };
  P.openSeedLab = function (img) {
    const ws = this._ws();
    if (img && img.seed != null) this.setState({ seed: String(img.seed) });
    this.wsSet({ seedLab: Object.assign({}, ws.seedLab, { open: true, base: img ? img.seed : null, parent: img ? img.imageId : null }) });
    this.setScreen('create');
  };
  P.runSeedLab = function () {
    const ws = this._ws(), lab = ws.seedLab;
    if (lab.mode === 'neighbors') {
      const base = lab.base != null ? lab.base : parseInt(this.state.seed, 10);
      const seeds = (window.DexWorkstationSeeds || neighborSeeds)(base, 2);
      if (!seeds.length) { this.toast('Pick a result or enter a fixed seed first', '#fbbf24'); return; }
      this.onGenerate({ seed: seeds[0], quantity: seeds.length, operation: 'seed-lab', parent_image_id: lab.parent || undefined });
    } else {
      const n = Math.max(1, Math.min(16, parseInt(lab.count, 10) || 4));
      this.onGenerate({ seed: -1, quantity: n, operation: 'seed-lab', parent_image_id: lab.parent || undefined });
    }
  };
  function neighborSeeds(seed, radius) {
    const s = parseInt(seed, 10), out = [];
    if (!Number.isInteger(s) || s < 0) return out;
    for (let d = -radius; d <= radius; d++) if (s + d >= 0) out.push(s + d);
    return out;
  }

  P.runPromptAB = async function () {
    const ws = this._ws();
    const a = String(this.state.prompt || '').trim(), b = String(ws.ab.promptB || '').trim();
    if (!a || !b) { this.toast('Enter both Prompt A (main prompt) and Prompt B', '#fbbf24'); return; }
    const active = this._activeResult();
    let seed = active && active.seed != null ? active.seed : parseInt(this.state.seed, 10);
    if (!Number.isInteger(seed) || seed < 0) seed = Math.floor(Math.random() * 2000000000) + 1;
    const common = this._createBody({ seed, quantity: 1, operation: 'prompt-ab' });
    delete common.prompt;
    this.wsSet({ ab: Object.assign({}, ws.ab, { status: 'running', pair: [], seed }) });
    const pair = [];
    for (const [label, prompt] of [['A', a], ['B', b]]) {
      const r = await this._api('/api/actions/generate-controlled', Object.assign({}, common, { prompt }));
      if (!r.ok) { this.toast('A/B ' + label + ': ' + (r.data.error || 'rejected'), '#ef4444'); break; }
      const job = await this._waitJob(r.data.job_id);
      const res = D.jobResults(job)[0] || { status: 'FAILED' };
      pair.push(Object.assign({ label }, res));
      this.wsSet({ ab: Object.assign({}, this._ws().ab, { pair: pair.slice() }) });
    }
    const held = Object.assign({}, common);
    delete held.save_prompts; delete held.operation; delete held.quantity;
    if ('negative_prompt' in held) held.negative_prompt = held.negative_prompt ? '(same text)' : '(none)';
    this.wsSet({ ab: Object.assign({}, this._ws().ab, { status: 'done', pair, held }) });
    setTimeout(() => this.loadRuns(), 1200);
  };

  P.reuseSettings = async function (id) {
    const m = await this._imageMeta(id);
    if (!m) return;
    const meta = m.meta || {};
    const patch = {};
    if (meta.target && (this.state.modelTargets || []).some(t => t.id === meta.target)) patch.target = meta.target;
    if (m.width) patch.width = m.width;
    if (m.height) patch.height = m.height;
    if (meta.steps) patch.steps = meta.steps;
    if (meta.cfg != null) patch.cfg = meta.cfg;
    if (meta.scheduler) patch.scheduler = meta.scheduler;
    if (meta.seed != null) patch.seed = String(meta.seed);
    this.setState(patch);
    this.setScreen('create');
    this.toast('Settings loaded' + (meta.seed != null ? ' · seed ' + meta.seed : '') + ' (prompt text is not stored with images)', '#38bdf8');
  };
  P.toggleKeeper = async function (id, keeper, img) {
    const r = await this._api('/api/images/' + encodeURIComponent(id) + '/keeper', { keeper });
    if (!r.ok) { this.toast(r.data.error || 'Keeper failed', '#ef4444'); return; }
    if (img) img.keeper = r.data.keeper;
    const ws = this._ws();
    for (const list of [ws.results, ws.editResults, ws.enhResults, ws.lib.items]) for (const it of list || []) if ((it.imageId || it.id) === id) it.keeper = r.data.keeper;
    if (ws.lib.selected && ws.lib.selected.id === id) ws.lib.selected.keeper = r.data.keeper;
    this.wsSet({});
    this.toast(r.data.keeper ? 'Marked Keeper' : 'Keeper removed', '#fbbf24');
  };
  P.toggleCompare = function (id) {
    const ws = this._ws();
    let ids = ws.compareIds.includes(id) ? ws.compareIds.filter(x => x !== id) : ws.compareIds.concat([id]);
    if (ids.length > 4) { ids = ids.slice(-4); this.toast('Comparison holds up to 4 images', '#fbbf24'); }
    this.wsSet({ compareIds: ids });
    this.loadCompare();
  };
  P.loadCompare = async function () {
    const items = [];
    for (const id of this._ws().compareIds) { const m = await this._imageMeta(id); if (m) items.push(m); }
    this.wsSet({ compareItems: items });
  };
  P.showInLibrary = function (id) {
    this.setScreen('library');
    this.selectLibraryImage(id);
  };

  // ── Edit: image-first img2img / inpaint / outpaint ──────────────
  P.sendToEdit = async function (id, focus) {
    const m = await this._imageMeta(id);
    if (!m) { this.toast('Image not found', '#ef4444'); return; }
    const ws = this._ws();
    this.wsSet({ editSourceId: id, editSource: m, editOriginalId: ws.editOriginalId && ws.editFocusChain ? ws.editOriginalId : id, editFocusChain: true, editFocus: focus || 'img2img' });
    this._resetMaskFor(m);
    this.setScreen('edit');
  };
  P.useAsNewSource = async function (id) {
    const m = await this._imageMeta(id);
    if (!m) return;
    this.wsSet({ editSourceId: id, editSource: m });
    this._resetMaskFor(m);
    this.toast('New source selected', '#a78bfa');
  };
  P.returnToOriginal = function () {
    const ws = this._ws();
    if (ws.editOriginalId) this.useAsNewSource(ws.editOriginalId);
  };
  P._ensureEditSource = async function () {
    const ws = this._ws();
    if (ws.editSourceId && (!ws.editSource || ws.editSource.id !== ws.editSourceId)) {
      const m = await this._imageMeta(ws.editSourceId);
      if (m) { this.wsSet({ editSource: m }); this._resetMaskFor(m); } else this.wsSet({ editSourceId: null, editSource: null });
    }
    if (ws.enhSourceId && (!ws.enhSource || ws.enhSource.id !== ws.enhSourceId)) {
      const m = await this._imageMeta(ws.enhSourceId);
      this.wsSet(m ? { enhSource: m } : { enhSourceId: null, enhSource: null });
    }
  };

  P._randomSeedIfUnset = function (v) {
    const n = parseInt(v, 10);
    return Number.isInteger(n) && n >= 0 ? n : Math.floor(Math.random() * 2000000000) + 1;
  };
  P._editCommon = function () {
    const s = this.state;
    return { prompt: String(s.i2iPrompt || s.prompt || '').trim(), negative_prompt: s.i2iNeg || s.negPrompt || '',
      steps: +s.i2iSteps || 20, cfg_scale: +s.i2iCfg || 7, seed: this._randomSeedIfUnset(s.i2iSeed), save_prompts: !!s.savePrompts };
  };
  P._runEditJob = async function (route, body, kind) {
    const ws = this._ws();
    if (!body.prompt) { this.toast('Enter a prompt (Edit prompt or the Create prompt)', '#fbbf24'); return null; }
    this.wsSet({ editStatus: 'running', editKind: kind, editProgress: 0 });
    const r = await this._api(route, body);
    if (!r.ok) {
      this.wsSet({ editStatus: 'error', editError: r.data.error || 'rejected' });
      return r;
    }
    this.wsSet({ editJobId: r.data.job_id });
    const job = await this._waitJob(r.data.job_id);
    const results = D.jobResults(job);
    if (this._jobOk(job.status) && results.length) {
      const res = results.map(x => Object.assign({ kind, sourceId: ws.editSourceId, seed: body.seed }, x));
      this.wsSet({ editStatus: 'done', editResults: res.concat(this._ws().editResults).slice(0, 24), editLastBody: { route, body, kind } });
      this.toast(kind + ' complete', '#65d66e');
      setTimeout(() => this.loadRuns(), 1200);
    } else {
      this.wsSet({ editStatus: 'error', editError: this._failText(job) });
      this.toast(kind + ' failed · ' + (job.firstFailedGate || job.status), '#ef4444');
    }
    return r;
  };

  const _origImg2img = P.onImg2imgSubmit;
  P.onImg2imgSubmit = async function () {
    const ws = this._ws();
    if (!ws.editSourceId) return _origImg2img.call(this);
    const body = Object.assign({ image_id: ws.editSourceId, strength: +this.state.i2iDenoise }, this._editCommon());
    if (ws.prep && ws.prep !== 'none') body.source_prep = ws.prep;
    const r = await this._runEditJob('/api/actions/img2img', body, 'img2img');
    if (r && !r.ok) this.toast(r.data.error || 'img2img rejected', '#ef4444');
  };
  P.anotherVariation = function () {
    const ws = this._ws(), last = ws.editLastBody;
    if (!last) return;
    const body = Object.assign({}, last.body, { seed: Math.floor(Math.random() * 2000000000) + 1 });
    if (last.kind === 'inpaint') body.mask_data = this._maskDataUrl();
    this._runEditJob(last.route, body, last.kind);
  };

  // ── Mask editor (canvas at source resolution; alpha = painted) ──
  P._resetMaskFor = function (m) {
    if (!m || !m.width || !m.height) return;
    if (this._mask && this._mask.w === m.width && this._mask.h === m.height && this._mask.for === m.id) return;
    const keep = this._mask && this._mask.w === m.width && this._mask.h === m.height; // same geometry: keep painted mask
    if (keep) { this._mask.for = m.id; return; }
    const c = document.createElement('canvas');
    c.width = m.width; c.height = m.height;
    c.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;cursor:crosshair;touch-action:none;opacity:.55;';
    c.setAttribute('aria-label', 'Inpaint mask — paint the area to change');
    const ctx = c.getContext('2d', { willReadFrequently: true });
    this._mask = { canvas: c, ctx, w: m.width, h: m.height, for: m.id, undo: [], redo: [] };
    let drawing = false, lx = 0, ly = 0;
    const pos = e => { const r = c.getBoundingClientRect(); return [(e.clientX - r.left) * (c.width / r.width), (e.clientY - r.top) * (c.height / r.height)]; };
    const setup = () => {
      const b = this._ws().brush;
      ctx.globalCompositeOperation = b.mode === 'erase' ? 'destination-out' : 'source-over';
      ctx.strokeStyle = ctx.fillStyle = '#ffffff';
      ctx.lineWidth = b.size; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    };
    c.addEventListener('pointerdown', e => {
      e.preventDefault();
      this._maskSnapshot();
      drawing = true; setup(); [lx, ly] = pos(e);
      ctx.beginPath(); ctx.arc(lx, ly, this._ws().brush.size / 2, 0, Math.PI * 2); ctx.fill();
      try { c.setPointerCapture(e.pointerId); } catch (_) {}
    });
    c.addEventListener('pointermove', e => { if (!drawing) return; const [x, y] = pos(e); ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(x, y); ctx.stroke(); lx = x; ly = y; });
    const end = () => { if (!drawing) return; drawing = false; ctx.globalCompositeOperation = 'source-over'; this._maskChanged(); };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    this._maskChanged();
  };
  P._maskAlpha = function () {
    const m = this._mask; if (!m) return null;
    const d = m.ctx.getImageData(0, 0, m.w, m.h).data, a = new Uint8ClampedArray(m.w * m.h);
    for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3];
    return a;
  };
  P._maskPut = function (a) {
    const m = this._mask; if (!m) return;
    const img = m.ctx.createImageData(m.w, m.h);
    for (let i = 0; i < a.length; i++) { const j = i * 4; img.data[j] = img.data[j + 1] = img.data[j + 2] = 255; img.data[j + 3] = a[i]; }
    m.ctx.putImageData(img, 0, 0);
  };
  P._maskSnapshot = function () {
    const m = this._mask; if (!m) return;
    m.undo.push(this._maskAlpha()); if (m.undo.length > 30) m.undo.shift();
    m.redo = [];
  };
  P._maskChanged = function () {
    const a = this._maskAlpha();
    this.wsSet({ maskInfo: a ? { coverage: D.maskCoverage(a), w: this._mask.w, h: this._mask.h, undo: this._mask.undo.length, redo: this._mask.redo.length } : null });
  };
  P.maskOp = function (op) {
    const m = this._mask; if (!m) return;
    if (op === 'undo' || op === 'redo') {
      const from = op === 'undo' ? m.undo : m.redo, to = op === 'undo' ? m.redo : m.undo;
      if (!from.length) return;
      to.push(this._maskAlpha()); this._maskPut(from.pop()); this._maskChanged(); return;
    }
    this._maskSnapshot();
    const a = this._maskAlpha(), r = Math.max(2, Math.round(Math.min(m.w, m.h) / 64));
    const next = op === 'grow' ? D.maskDilate(a, m.w, m.h, r) : op === 'shrink' ? D.maskErode(a, m.w, m.h, r)
      : op === 'feather' ? D.maskFeather(a, m.w, m.h, r * 2) : op === 'blur' ? D.maskBlur(a, m.w, m.h, r) : op === 'invert' ? D.maskInvert(a)
      : op === 'clear' ? new Uint8ClampedArray(a.length) : a;
    this._maskPut(next); this._maskChanged();
  };
  P._maskDataUrl = function () { return this._mask ? this._mask.canvas.toDataURL('image/png') : null; };

  P.onInpaintSubmit = async function (confirmed) {
    const ws = this._ws();
    if (!ws.editSourceId || !this._mask) { this.toast('Choose a source image (Library → Inpaint, or a result → Inpaint)', '#fbbf24'); return; }
    const v = D.maskVerdict(this._maskAlpha());
    if (v.kind === 'blank') { this.toast(v.message, '#fbbf24'); return; }
    if (v.kind === 'full' && !confirmed && !window.confirm(v.message + '\n\nContinue anyway?')) return;
    const body = Object.assign({ image_id: ws.editSourceId, mask_data: this._maskDataUrl(), strength: +this.state.inpStrength, confirm_full_mask: v.kind === 'full' }, this._editCommon());
    const r = await this._runEditJob('/api/actions/inpaint', body, 'inpaint');
    if (r && !r.ok) {
      if (r.data.needs_confirmation && window.confirm(r.data.error + '\n\nContinue anyway?')) return this.onInpaintSubmit(true);
      this.toast(r.data.error || 'Inpaint rejected', '#ef4444');
    }
  };
  P.onOutpaintSubmit = async function () {
    const ws = this._ws();
    if (!ws.editSourceId) { this.toast('Choose a source image first', '#fbbf24'); return; }
    const o = ws.out;
    const body = Object.assign({ image_id: ws.editSourceId, left: +o.left || 0, right: +o.right || 0, top: +o.top || 0, bottom: +o.bottom || 0, strength: +o.strength }, this._editCommon());
    const r = await this._runEditJob('/api/actions/outpaint', body, 'outpaint');
    if (r && !r.ok) this.toast(r.data.error || 'Outpaint rejected', '#ef4444');
  };

  P.buildInpaintTools = function () {
    const ws = this._ws(), s = this.state, src = ws.editSource;
    const base = s.backendUrl;
    const panelFor = (title, body) => h('div', { style: css.panel }, h('div', { style: Object.assign({}, css.title, { marginBottom: 8 }) }, title), body);
    if (!src) return null;
    const mi = ws.maskInfo || {};
    const b = ws.brush;
    const zoomW = ws.maskZoom === 1 ? '100%' : Math.round(src.width * (ws.maskZoom === 2 ? 1 : 2)) + 'px';
    const strength = +s.i2iDenoise;
    return this._editBody(src, base, s, ws, mi, b, zoomW, strength, panelFor);
  };
  P.buildEditSourceCard = function () {
    const ws = this._ws(), src = ws.editSource, base = this.state.backendUrl;
    const panel = body => h('div', { style: Object.assign({}, css.panel, { maxWidth: 760 }) }, h('div', { style: Object.assign({}, css.title, { marginBottom: 8 }) }, 'Source image'), body);
    if (!src) return panel(h('div', { style: css.muted }, 'Choose Img2Img, Inpaint or Outpaint on any result or Library image; it appears here as the source. Legacy runs can still be picked under Advanced Source Selection below.'));
    return panel(h('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(90px,140px) minmax(0,1fr)', gap: 10, alignItems: 'start' } },
      h('img', { src: base + src.url, alt: 'edit source', style: { width: '100%', borderRadius: 7, border: '1px solid rgba(148,163,184,.2)' } }),
      h('div', { style: { display: 'grid', gap: 6 } },
        h('div', { style: css.mono }, src.id),
        h('div', { style: css.muted }, src.width + '×' + src.height + ' · ' + ((src.meta && src.meta.operation) || 'image') + (src.meta && src.meta.seed != null ? ' · seed ' + src.meta.seed : '') + (src.keeper ? ' · ★ Keeper' : '')),
        h('div', { style: css.row },
          ws.editOriginalId && ws.editOriginalId !== src.id ? btn('Return to Original', () => this.returnToOriginal(), '#94a3b8') : null,
          src.parent ? btn('View Parent', () => this.useAsNewSource(src.parent), '#94a3b8') : null,
          btn('Open', () => window.open(base + src.url, '_blank'), '#94a3b8'),
          btn('Clear source', () => this.wsSet({ editSourceId: null, editSource: null, editOriginalId: null }), '#94a3b8')))));
  };
  P._editBody = function (src, base, s, ws, mi, b, zoomW, strength, panelFor) {

    const i2i = h('div', { style: { display: 'grid', gap: 8 } },
      h('div', { style: css.label }, 'Img2Img strength · ' + strength.toFixed(2)),
      h('div', { style: css.row },
        h('input', { type: 'range', min: '0.05', max: '0.95', step: '0.01', value: String(strength), onChange: e => this.setState({ i2iDenoise: e.target.value }), style: { flex: '1 1 160px', minHeight: 30 } }),
        numInput(strength, v => this.setState({ i2iDenoise: v }), { min: '0.05', max: '0.95', step: '0.05' }),
        ...D.STRENGTH_PRESETS.map(([n, v]) => btn(n + ' ' + v.toFixed(2), () => this.setState({ i2iDenoise: v }), Math.abs(strength - v) < 0.001 ? '#a78bfa' : '#94a3b8'))),
      h('div', { style: css.muted }, 'Higher strength changes more. Effects vary by model; the numeric value is what is sent.'),
      h('div', { style: css.row },
        h('div', { style: css.label }, 'Source prep'),
        h('select', { value: ws.prep, onChange: e => this.wsSet({ prep: e.target.value }), style: Object.assign({}, css.input, { width: 'auto' }) },
          h('option', { value: 'none' }, 'As is (' + src.width + '×' + src.height + ')'),
          h('option', { value: 'crop-square' }, 'Center crop · square'),
          h('option', { value: 'crop-portrait' }, 'Center crop · portrait 3:4'),
          h('option', { value: 'crop-landscape' }, 'Center crop · landscape 4:3'),
          h('option', { value: 'fit-square' }, 'Fit/contain · square'),
          h('option', { value: 'resize-512' }, 'Resize · longest side 512')),
        h('span', { style: css.muted }, 'Temporary working copy; the canonical source is never modified.')),
      h('div', { style: css.row }, btn(ws.editStatus === 'running' && ws.editKind === 'img2img' ? 'Img2Img running…' : 'Run Img2Img', () => this.onImg2imgSubmit(), '#a78bfa')));

    const toolBtn = (label, active, fn) => btn(label, fn, active ? '#38bdf8' : '#94a3b8');
    const maskEditor = h('div', { style: { display: 'grid', gap: 8 } },
      h('div', { style: css.row },
        toolBtn('Brush', b.mode === 'paint', () => this.wsSet({ brush: Object.assign({}, b, { mode: 'paint' }) })),
        toolBtn('Eraser', b.mode === 'erase', () => this.wsSet({ brush: Object.assign({}, b, { mode: 'erase' }) })),
        h('label', { style: css.muted }, 'Size ' + b.size),
        h('input', { type: 'range', min: '4', max: String(Math.max(64, Math.round(Math.min(src.width, src.height) / 3))), step: '2', value: String(b.size), onChange: e => this.wsSet({ brush: Object.assign({}, b, { size: +e.target.value }) }), style: { flex: '1 1 120px', minHeight: 30 } })),
      h('div', { style: css.row },
        btn('Undo', () => this.maskOp('undo'), '#94a3b8', { disabled: !mi.undo }), btn('Redo', () => this.maskOp('redo'), '#94a3b8', { disabled: !mi.redo }),
        btn('Grow', () => this.maskOp('grow'), '#94a3b8'), btn('Shrink', () => this.maskOp('shrink'), '#94a3b8'),
        btn('Feather', () => this.maskOp('feather'), '#94a3b8'), btn('Blur', () => this.maskOp('blur'), '#94a3b8'),
        btn('Invert', () => this.maskOp('invert'), '#94a3b8'), btn('Clear', () => this.maskOp('clear'), '#f87171'),
        btn(ws.maskZoom === 1 ? 'Fit' : ws.maskZoom === 2 ? '100%' : '200%', () => this.wsSet({ maskZoom: ws.maskZoom === 3 ? 1 : ws.maskZoom + 1 }), '#94a3b8')),
      h('div', { style: { overflow: 'auto', maxHeight: '70vh', border: '1px solid rgba(148,163,184,.16)', borderRadius: 8, background: '#05080d' } },
        h('div', { style: { position: 'relative', width: zoomW, maxWidth: ws.maskZoom === 1 ? '100%' : 'none', aspectRatio: src.width + ' / ' + src.height, background: 'center/100% 100% no-repeat url("' + base + src.url + '")' } },
          this._mask ? this._mask.canvas : null)),
      h('div', { style: css.muted }, 'Mask ' + (mi.w || src.width) + '×' + (mi.h || src.height) + ' · painted ' + Math.round((mi.coverage || 0) * 1000) / 10 + '%' +
        ((mi.coverage || 0) >= D.FULL_MASK_COVERAGE ? ' — the entire image is masked; this regenerates nearly everything' : '') + '. Painted area is regenerated; the rest is kept. Mask survives parameter changes and retries.'),
      h('div', { style: css.row },
        h('label', { style: css.muted }, 'Inpaint strength'),
        numInput(s.inpStrength, v => this.setState({ inpStrength: v }), { min: '0.05', max: '0.99', step: '0.05' }),
        btn(ws.editStatus === 'running' && ws.editKind === 'inpaint' ? 'Inpainting…' : 'Run Inpaint', () => this.onInpaintSubmit(), '#a78bfa')));

    const o = ws.out;
    const side = (k, lbl) => h('label', { style: Object.assign({}, css.muted, { display: 'grid', gap: 3 }) }, lbl,
      numInput(o[k], v => this.wsSet({ out: Object.assign({}, o, { [k]: v }) }), { min: '0', max: '512', step: '64' }));
    const outW = src.width + (+o.left || 0) + (+o.right || 0), outH = src.height + (+o.top || 0) + (+o.bottom || 0);
    const outpaint = h('div', { style: { display: 'grid', gap: 8 } },
      h('div', { style: css.row }, side('left', 'Left px'), side('right', 'Right px'), side('top', 'Top px'), side('bottom', 'Bottom px')),
      h('div', { style: css.row },
        btn('+25% right', () => this.wsSet({ out: Object.assign({}, o, { left: 0, right: Math.round(src.width / 4 / 64) * 64 || 64, top: 0, bottom: 0 }) }), '#94a3b8'),
        btn('+25% left & right', () => this.wsSet({ out: Object.assign({}, o, { left: Math.round(src.width / 8 / 64) * 64 || 64, right: Math.round(src.width / 8 / 64) * 64 || 64, top: 0, bottom: 0 }) }), '#94a3b8'),
        btn('+25% bottom', () => this.wsSet({ out: Object.assign({}, o, { left: 0, right: 0, top: 0, bottom: Math.round(src.height / 4 / 64) * 64 || 64 }) }), '#94a3b8'),
        h('label', { style: css.muted }, 'Strength'), numInput(o.strength, v => this.wsSet({ out: Object.assign({}, o, { strength: v }) }), { min: '0.5', max: '0.99', step: '0.01' })),
      h('div', { style: css.muted }, 'New canvas ≈ ' + outW + '×' + outH + ' (rounded up to multiples of 64). The original is kept exactly and blended over a 48 px overlap. Tip: describe what should appear in the new area (e.g. "empty desk and wall"); naming the main subject can duplicate it.'),
      h('div', { style: css.row }, btn(ws.editStatus === 'running' && ws.editKind === 'outpaint' ? 'Outpainting…' : 'Run Outpaint', () => this.onOutpaintSubmit(), '#a78bfa')));

    const results = ws.editResults;
    const resultsPanel = results.length ? h('div', { style: { display: 'grid', gap: 8 } },
      h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(110px,1fr))', gap: 8 } },
        ...results.map((r, i) => h('div', { key: r.imageId || i, style: { display: 'grid', gap: 4 } },
          thumb(r.imageUrl ? base + r.imageUrl : null, i === (ws.editActive || 0), () => this.wsSet({ editActive: i }), r.imageId, r.kind + (r.seed != null ? ' · ' + r.seed : ''))))),
      (() => {
        const r = results[ws.editActive || 0];
        if (!r || !r.imageId) return null;
        return h('div', { style: css.row },
          btn('Use as New Source', () => this.useAsNewSource(r.imageId), '#a78bfa'),
          btn('Compare to Source', () => { this.wsSet({ compareIds: [r.sourceId || ws.editSourceId, r.imageId].filter(Boolean) }); this.loadCompare(); this.setScreen('library'); }, '#38bdf8'),
          ws.editLastBody ? btn('Generate Another Variation', () => this.anotherVariation(), '#65d66e') : null,
          btn('Inpaint this', () => this.useAsNewSource(r.imageId), '#a78bfa'),
          btn('Enhance', () => this.sendToEnhance(r.imageId), '#f59e0b'),
          btn('Open Full Size', () => window.open(base + r.imageUrl, '_blank'), '#94a3b8'),
          btn('☆/★ Keeper', () => this.toggleKeeper(r.imageId, !r.keeper, r), '#fbbf24'),
          ws.editOriginalId ? btn('Return to Original', () => this.returnToOriginal(), '#94a3b8') : null);
      })()) : null;

    const status = ws.editStatus === 'running' ? h('div', { style: { color: tone.info, fontSize: 12 } }, (ws.editKind || 'edit') + ' running on Big Mac… (results appear below when the job finishes)')
      : ws.editStatus === 'error' ? h('div', { style: { color: tone.bad, fontSize: 12 } }, ws.editError || 'failed') : null;

    return h('div', { style: { marginTop: 12 } },
      this._gate('img2img') ? panelFor('Img2Img', i2i) : null,
      this._gate('inpaint') ? panelFor('Inpaint mask', maskEditor) : null,
      this._gate('outpaint') ? panelFor('Outpaint · extend canvas', outpaint) : null,
      status,
      results.length ? panelFor('Edit results', resultsPanel) : null);
  };

  // ── Enhance ─────────────────────────────────────────────────────
  P.sendToEnhance = async function (id) {
    const m = await this._imageMeta(id);
    if (!m) return;
    this.wsSet({ enhSourceId: id, enhSource: m });
    this.setScreen('enhance');
  };
  P._runEnhance = async function (route, body, method) {
    this.wsSet({ enhStatus: 'running', enhMethodRunning: method });
    const r = await this._api(route, body);
    if (!r.ok) { this.wsSet({ enhStatus: 'error', enhError: r.data.error }); this.toast(r.data.error || 'Enhance rejected', '#ef4444'); return; }
    const job = await this._waitJob(r.data.job_id);
    const res = D.jobResults(job).map(x => Object.assign({ method }, x));
    if (this._jobOk(job.status) && res.length) {
      this.wsSet({ enhStatus: 'done', enhResults: res.concat(this._ws().enhResults).slice(0, 12) });
      this.toast(method + ' complete', '#65d66e');
    } else this.wsSet({ enhStatus: 'error', enhError: this._failText(job) });
  };
  P.buildEnhanceWorkbench = function () {
    const ws = this._ws(), src = ws.enhSource, base = this.state.backendUrl;
    if (!src) return h('div', { style: css.panel }, h('div', { style: css.title }, 'Enhance'), h('div', { style: css.muted }, 'Choose Enhance on any result or Library image to preselect it here.'));
    const card = (title, method, desc, target, action, enabled) => h('div', { style: { border: '1px solid rgba(148,163,184,.14)', borderRadius: 8, padding: 10, display: 'grid', gap: 6, opacity: enabled ? 1 : 0.55 } },
      h('div', { style: { fontWeight: 800, color: '#e2e8f0', fontSize: 13 } }, title),
      h('div', { style: css.muted }, desc),
      h('div', { style: css.mono }, 'method: ' + method + ' · ' + src.width + '×' + src.height + ' → ' + target),
      action);
    const sc = +ws.lanczosScale || 2;
    return h('div', { style: css.panel },
      h('div', { style: Object.assign({}, css.title, { marginBottom: 8 }) }, 'Enhance source'),
      h('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(90px,140px) 1fr', gap: 10, marginBottom: 10 } },
        h('img', { src: base + src.url, alt: 'enhance source', style: { width: '100%', borderRadius: 7 } }),
        h('div', { style: css.mono }, src.id + '\n' + src.width + '×' + src.height)),
      h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 8 } },
        card('Resize · Lanczos', 'deterministic resampling (not AI)', 'Pixel resampling on the MacBook. Adds no detail.', (src.width * sc) + '×' + (src.height * sc),
          h('div', { style: css.row }, ...[2, 3, 4].map(k => btn(k + '×', () => this.wsSet({ lanczosScale: k }), k === sc ? '#f59e0b' : '#94a3b8')),
            btn('Run Lanczos', () => this._runEnhance('/api/actions/upscale', { image_id: src.id, scale: sc, resample: 'lanczos' }, 'Lanczos'), '#f59e0b')), true),
        card('Real-ESRGAN x4', 'AI super-resolution (RealESRGAN_x4plus on Big Mac)', 'Model-based upscaling; sharpens and invents fine texture.', (src.width * 4) + '×' + (src.height * 4),
          this._gate('realEsrgan') ? btn('Run Real-ESRGAN', () => this._runEnhance('/api/actions/upscale-esrgan', { image_id: src.id }, 'Real-ESRGAN'), '#f59e0b') : h('div', { style: css.muted }, 'Unavailable (gate closed).'), this._gate('realEsrgan')),
        card('High-Res Refine', 'diffusion second pass (sd-cli --hires, SDCPP)', 'A generation-time second pass: it re-renders the image at higher resolution with denoising. It needs the original prompt and seed, so it runs from Create.', '×1.1–2.0',
          btn('Set up in Create', () => { this.reuseSettings(src.id); this.wsSet({ hires: true }); }, '#f59e0b'), this._gate('hiresRefine'))),
      ws.enhStatus === 'running' ? h('div', { style: { color: tone.info, fontSize: 12, marginTop: 8 } }, (ws.enhMethodRunning || 'Enhance') + ' running…') : null,
      ws.enhStatus === 'error' ? h('div', { style: { color: tone.bad, fontSize: 12, marginTop: 8 } }, ws.enhError || 'failed') : null,
      ws.enhResults.length ? h('div', { style: { marginTop: 10, display: 'grid', gap: 8 } },
        ...ws.enhResults.slice(0, 4).map(r => h('div', { key: r.imageId, style: { display: 'grid', gridTemplateColumns: 'minmax(90px,140px) 1fr', gap: 10 } },
          thumb(base + r.imageUrl, false, () => window.open(base + r.imageUrl, '_blank'), r.imageId, r.method + ' · ' + r.width + '×' + r.height),
          h('div', { style: css.row },
            btn('Compare', () => { this.wsSet({ compareIds: [src.id, r.imageId] }); this.loadCompare(); this.setScreen('library'); }, '#38bdf8'),
            this._gate('img2img') ? btn('Img2Img', () => this.sendToEdit(r.imageId, 'img2img'), '#a78bfa') : null,
            this._gate('inpaint') ? btn('Inpaint', () => this.sendToEdit(r.imageId, 'inpaint'), '#a78bfa') : null,
            btn('Use as Source', () => this.sendToEnhance(r.imageId), '#f59e0b'),
            btn('Open', () => window.open(base + r.imageUrl, '_blank'), '#94a3b8'))))) : null);
  };

  // ── Library: images, lineage, keepers, compare ──────────────────
  P.loadLibraryImages = async function (filter) {
    const ws = this._ws();
    const f = filter || ws.lib.filter;
    this.wsSet({ lib: Object.assign({}, ws.lib, { filter: f, loading: true }) });
    const r = await this._api('/api/library/images?filter=' + encodeURIComponent(f), undefined);
    this.wsSet({ lib: Object.assign({}, this._ws().lib, { items: r.ok ? r.data.items : [], total: r.ok ? r.data.total : 0, loading: false }) });
  };
  P.selectLibraryImage = async function (id) {
    const m = await this._imageMeta(id);
    this.wsSet({ lib: Object.assign({}, this._ws().lib, { selectedId: id, selected: m }) });
  };
  P.buildLibraryWorkbench = function () {
    const ws = this._ws(), lib = ws.lib, base = this.state.backendUrl;
    if (!lib.loadedOnce) { lib.loadedOnce = true; setTimeout(() => this.loadLibraryImages(), 0); }
    const filters = [['all', 'All'], ['keepers', '★ Keepers'], ['flux2-klein-4b', 'FLUX'], ['sd15', 'SD1.5'], ['txt2img', 'txt2img'], ['variation', 'Variations'], ['seed-lab', 'Seed Lab'],
      ['batch', 'Batch'], ['img2img', 'Img2Img'], ['inpaint', 'Inpaint'], ['outpaint', 'Outpaint'], ['esrgan', 'Real-ESRGAN'], ['lanczos', 'Lanczos']];
    const sel = lib.selected;
    const selView = sel ? { imageId: sel.id, imageUrl: sel.url, seed: sel.meta && sel.meta.seed, target: sel.meta && sel.meta.target, operation: sel.meta && sel.meta.operation, keeper: sel.keeper } : null;
    const lineageChip = (id, label) => h('button', { key: label + id, type: 'button', onClick: () => this.selectLibraryImage(id), title: id,
      style: { border: '1px solid rgba(148,163,184,.2)', background: 'rgba(5,10,18,.6)', color: '#cbd5e1', borderRadius: 6, padding: '4px 7px', fontSize: 11, cursor: 'pointer', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, label);
    const detail = sel ? h('div', { style: { borderTop: '1px solid rgba(148,163,184,.12)', marginTop: 10, paddingTop: 10, display: 'grid', gridTemplateColumns: 'minmax(120px,220px) 1fr', gap: 10 } },
      h('img', { src: base + sel.url, alt: sel.id, style: { width: '100%', borderRadius: 7 } }),
      h('div', { style: { display: 'grid', gap: 6, alignContent: 'start' } },
        h('div', { style: css.mono }, sel.id),
        h('div', { style: css.muted }, [sel.width + '×' + sel.height, sel.meta.operation, sel.meta.target, sel.meta.seed != null ? 'seed ' + sel.meta.seed : null, sel.meta.steps ? sel.meta.steps + ' steps' : null, sel.meta.strength ? 'strength ' + sel.meta.strength : null, sel.keeper ? '★ Keeper' : null].filter(Boolean).join(' · ') || 'legacy image (no lineage recorded)'),
        h('div', { style: css.row }, ...this.imageActions(selView)),
        h('div', { style: css.row }, h('span', { style: css.label }, 'Lineage'),
          sel.ancestors.length ? lineageChip(sel.ancestors[sel.ancestors.length - 1], '⇤ Original') : null,
          sel.parent ? lineageChip(sel.parent, '↑ Parent') : h('span', { style: css.muted }, 'no parent'),
          ...sel.children.map((c, i) => lineageChip(c, '↓ Child ' + (i + 1))),
          sel.parent ? btn('Compare with parent', () => { this.wsSet({ compareIds: [sel.parent, sel.id] }); this.loadCompare(); }, '#38bdf8') : null))) : null;
    return h('div', null,
      h('div', { style: css.panel },
        h('div', { style: Object.assign({}, css.row, { marginBottom: 8 }) }, h('div', { style: css.title }, 'Images'), h('span', { style: css.muted }, lib.loading ? 'loading…' : lib.total + ' images'), h('div', { style: { flex: 1 } }), btn('Refresh', () => this.loadLibraryImages(), '#94a3b8')),
        h('div', { style: Object.assign({}, css.row, { marginBottom: 8 }) }, ...filters.map(([k, l]) => btn(l, () => this.loadLibraryImages(k), lib.filter === k ? '#38bdf8' : '#94a3b8'))),
        lib.items.length ? h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(96px,1fr))', gap: 6, maxHeight: 420, overflowY: 'auto' } },
          ...lib.items.map(it => h('div', { key: it.id }, thumb(base + it.url, lib.selectedId === it.id, () => this.selectLibraryImage(it.id), it.id,
            (it.keeper ? '★ ' : '') + ((it.meta && it.meta.operation) || '') + (it.meta && it.meta.seed != null ? ' ' + it.meta.seed : '')))))
          : h('div', { style: css.muted }, lib.loading ? '' : 'No images for this filter.'),
        detail),
      this.buildCompareWorkspace());
  };
  P.buildCompareWorkspace = function () {
    const ws = this._ws(), base = this.state.backendUrl, items = ws.compareItems;
    if (!ws.compareIds.length) return null;
    if (items.length !== ws.compareIds.length && !ws.compareLoading) { ws.compareLoading = true; setTimeout(() => { this.loadCompare().then(() => { this._ws().compareLoading = false; }); }, 0); }
    const z = ws.compareZoom;
    const rows = D.compareRows(items);
    const sync = e => { const el = e.currentTarget; document.querySelectorAll('[data-compare-pane]').forEach(p => { if (p !== el) { p.scrollLeft = el.scrollLeft; p.scrollTop = el.scrollTop; } }); };
    return h('div', { style: css.panel },
      h('div', { style: Object.assign({}, css.row, { marginBottom: 8 }) },
        h('div', { style: css.title }, 'Compare (' + items.length + '/4)'), h('div', { style: { flex: 1 } }),
        ...[1, 2, 4].map(k => btn(k === 1 ? 'Fit' : k + '×', () => this.wsSet({ compareZoom: k }), z === k ? '#38bdf8' : '#94a3b8')),
        btn('Clear', () => this.wsSet({ compareIds: [], compareItems: [] }), '#f87171')),
      h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 8 } },
        ...items.map(it => h('div', { key: it.id, style: { display: 'grid', gap: 4 } },
          h('div', { 'data-compare-pane': '1', onScroll: sync, style: { overflow: 'auto', maxHeight: '60vh', border: '1px solid rgba(148,163,184,.16)', borderRadius: 7, background: '#05080d' } },
            h('img', { src: base + it.url, alt: it.id, style: { width: z === 1 ? '100%' : (it.width * z / 2) + 'px', display: 'block', imageRendering: z > 2 ? 'pixelated' : 'auto' } })),
          h('div', { style: css.mono }, it.id),
          h('div', { style: css.row }, btn('Remove', () => this.toggleCompare(it.id), '#94a3b8'), btn('Open', () => window.open(base + it.url, '_blank'), '#94a3b8'))))),
      rows.length ? h('table', { style: { width: '100%', marginTop: 8, borderCollapse: 'collapse', fontSize: 11 } },
        h('tbody', null, ...rows.map(r => h('tr', { key: r.key, style: { color: r.differs ? '#fde68a' : '#94a3b8' } },
          h('td', { style: { padding: '3px 6px', fontWeight: 700 } }, r.key + (r.differs ? ' ≠' : '')),
          ...r.values.map((v, i) => h('td', { key: i, style: { padding: '3px 6px', fontFamily: "'IBM Plex Mono',monospace" } }, v)))))) : null);
  };

  // ── Batch: numbered prompts + backend queue ─────────────────────
  P.parseBatch = async function (text) {
    const t = text !== undefined ? text : this._ws().batchText;
    this.wsSet({ batchText: t });
    if (!t.trim()) { this.wsSet({ parse: null }); return; }
    const r = await this._api('/api/batch/parse', { text: t });
    this.wsSet({ parse: r.ok ? r.data : { ok: false, count: 0, errors: [r.data.error || 'parse failed'], warnings: [], entries: [] }, preflight: null, confirmLarge: false });
  };
  P.startBatch = async function () {
    const ws = this._ws(), s = this.state;
    if (!ws.parse || !ws.parse.ok) { this.toast('Fix the parse errors first', '#fbbf24'); return; }
    const qty = Math.max(1, Math.min(100, parseInt(ws.batchQty, 10) || 1));
    const pf = await this._api('/api/preflight', { target: s.target, prompts: ws.parse.count, quantity: qty });
    this.wsSet({ preflight: pf.ok ? pf.data : null });
    if (!pf.ok) { this.toast('Preflight failed', '#ef4444'); return; }
    if (!pf.data.ok) { this.toast('Preflight blocked: ' + pf.data.rows.filter(r => r.state === 'FAIL').map(r => r.detail).join('; '), '#ef4444'); return; }
    if (pf.data.needsConfirmation && !ws.confirmLarge) { this.toast('Large request: confirm ' + pf.data.summary + ' below', '#fbbf24'); return; }
    const settings = this._createBody({ quantity: qty });
    delete settings.prompt;
    const r = await this._api('/api/queues', { text: ws.batchText, settings, confirm_large: ws.confirmLarge });
    if (!r.ok) { this.toast(r.data.error || 'Queue rejected', '#ef4444'); return; }
    this.wsSet({ queueId: r.data.id, queue: r.data });
    this._pollQueue();
  };
  P._pollQueue = function () {
    clearInterval(this._queueTimer);
    const tick = async () => {
      const id = this._ws().queueId;
      if (!id) { clearInterval(this._queueTimer); return; }
      const r = await this._api('/api/queues/' + id, undefined);
      if (!r.ok) { clearInterval(this._queueTimer); this.wsSet({ queueId: null, queue: null, queueLost: r.data.error }); this._detectRestoredQueue(); return; }
      this.wsSet({ queue: r.data });
      if (r.data.status !== 'RUNNING') clearInterval(this._queueTimer);
    };
    tick();
    this._queueTimer = setInterval(tick, 2000);
  };
  P.queueAction = async function (action, qi) {
    const ws = this._ws();
    const route = qi === undefined ? '/api/queues/' + ws.queueId + '/' + action : '/api/queues/' + ws.queueId + '/items/' + qi + '/' + action;
    // Restored queues without saved prompts need the same numbered text again.
    const needsText = qi === undefined && ws.queue && ws.queue.promptsMissing && action !== 'stop-after-current';
    if (needsText && !String(ws.batchText || '').trim()) { this.toast('Prompt saving was off: paste the same numbered batch above, then resume.', '#fbbf24'); return; }
    const r = await this._api(route, needsText ? { text: ws.batchText } : {});
    if (!r.ok) { this.toast(r.data.error || 'Queue action failed', '#ef4444'); return; }
    this.wsSet({ queue: r.data });
    if (r.data.status === 'RUNNING') this._pollQueue();
  };
  P.buildBatchWorkspace = function () {
    const ws = this._ws(), s = this.state, base = s.backendUrl, pr = ws.parse, q = ws.queue;
    const spec = this._targetSpec();
    const entryRow = e => h('div', { key: e.index, style: { borderBottom: '1px solid rgba(148,163,184,.08)', padding: '5px 0' } },
      h('button', { type: 'button', onClick: () => this.wsSet({ expanded: Object.assign({}, ws.expanded, { [e.index]: !ws.expanded[e.index] }) }),
        style: { border: 0, background: 'transparent', color: '#dbe4ee', cursor: 'pointer', fontSize: 13, textAlign: 'left', width: '100%', padding: '4px 0', minHeight: 30 } },
        (ws.expanded[e.index] ? '▾ ' : '▸ ') + e.number + ' — ' + e.title),
      ws.expanded[e.index] ? h('div', { style: Object.assign({}, css.muted, { whiteSpace: 'pre-wrap', paddingLeft: 16 }) }, e.preview + (e.chars > 160 ? ' … (' + e.chars + ' chars)' : '')) : null);
    const parsePanel = pr ? h('div', { style: { display: 'grid', gap: 6 } },
      h('div', { style: { fontWeight: 800, color: pr.ok ? tone.ok : tone.bad } }, 'Parsed prompts: ' + pr.count),
      ...pr.errors.map(e => h('div', { key: e, style: { color: tone.bad, fontSize: 12 } }, '✗ ' + e)),
      ...pr.warnings.map(w => h('div', { key: w, style: { color: tone.warn, fontSize: 12 } }, '⚠ ' + w)),
      h('div', { style: { maxHeight: 280, overflowY: 'auto' } }, ...pr.entries.map(entryRow))) : h('div', { style: css.muted }, 'Paste a numbered collection: "1. Title", a blank line, then the prompt (any number of lines). Only a line starting "<number>. Title" after a blank line starts a new entry.');
    const pf = ws.preflight;
    const pfPanel = pf ? h('div', { style: { display: 'grid', gap: 4 } },
      h('div', { style: { fontWeight: 800, color: '#e2e8f0' } }, 'Requested work: ' + pf.summary),
      ...pf.rows.map(r => h('div', { key: r.check, style: { fontSize: 11, color: stateTone(r.state) } }, r.state + ' · ' + r.check + ' — ' + r.detail)),
      pf.needsConfirmation ? h('label', { style: Object.assign({}, css.row, { color: tone.warn, fontSize: 12 }) },
        h('input', { type: 'checkbox', checked: !!ws.confirmLarge, onChange: e => this.wsSet({ confirmLarge: e.target.checked }) }), 'I confirm ' + pf.total + ' images') : null) : null;
    const queuePanel = q ? h('div', { style: { display: 'grid', gap: 6 } },
      h('div', { style: css.row },
        h('div', { style: { fontWeight: 800, color: stateTone(q.status) } }, q.status + ' · ' + q.complete + ' / ' + q.total + ' complete' + (q.failed ? ' · ' + q.failed + ' failed' : '')),
        h('div', { style: { flex: 1 } }),
        q.status === 'RUNNING' && !q.stopAfterCurrent ? btn('Stop After Current', () => this.queueAction('stop-after-current'), '#fbbf24') : null,
        (q.status === 'STOPPED' || (q.stopAfterCurrent && q.status === 'RUNNING')) && q.queued ? btn('Resume Remaining', () => this.queueAction('resume'), '#65d66e') : null,
        q.failed || q.interrupted ? btn(q.interrupted ? 'Retry Interrupted/Failed' : 'Retry Failed', () => this.queueAction('retry-failed'), '#f87171') : null,
        btn('Dismiss', () => this.wsSet({ queueId: null, queue: null }), '#94a3b8')),
      q.restored ? h('div', { style: { color: tone.warn, fontSize: 12 } }, 'Restarted queue detected. ' + q.complete + ' completed · ' + q.queued + ' queued · ' + q.interrupted + ' interrupted.' +
        (q.promptsMissing ? ' Prompt text was not saved (prompt saving off): paste the same numbered batch above to resume.' : '')) : null,
      h('div', { style: css.muted }, 'Percentages are time-estimated per running item; the count above is exact.'),
      h('div', { style: { maxHeight: 420, overflowY: 'auto', display: 'grid', gap: 5 } },
        ...q.items.map(it => h('div', { key: it.queueIndex, style: { border: '1px solid rgba(148,163,184,.1)', borderRadius: 7, padding: 7, display: 'grid', gap: 5 } },
          h('div', { style: css.row },
            chip(it.status, stateTone(it.status)),
            h('span', { style: { color: '#dbe4ee', fontSize: 12 } }, '#' + (it.queueIndex + 1) + ' · ' + it.number + ' — ' + it.title),
            it.seeds && it.seeds.length ? h('span', { style: css.mono }, 'seed ' + it.seeds.join(',')) : null,
            it.progress && it.status === 'RUNNING' ? h('span', { style: css.muted }, '~' + it.progress.percent + '% (est.)') : null,
            h('div', { style: { flex: 1 } }),
            it.status === 'QUEUED' ? btn('↑', () => this.queueAction('up', it.queueIndex), '#94a3b8') : null,
            it.status === 'QUEUED' ? btn('↓', () => this.queueAction('down', it.queueIndex), '#94a3b8') : null,
            it.status === 'QUEUED' ? btn('Remove', () => this.queueAction('remove', it.queueIndex), '#f87171') : null),
          it.error ? h('div', { style: { color: tone.bad, fontSize: 11 } }, it.error) : null,
          it.results && it.results.length ? h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(72px,96px))', gap: 5 } },
            ...it.results.filter(r => r.imageUrl).map(r => h('div', { key: r.imageId }, thumb(base + r.imageUrl, false, () => this.showInLibrary(r.imageId), r.imageId, String(r.seed))))) : null)))) : null;
    return h('div', { style: css.panel },
      h('div', { style: Object.assign({}, css.title, { marginBottom: 4 }) }, 'Numbered prompt batch'),
      h('div', { style: Object.assign({}, css.muted, { marginBottom: 8 }) }, 'Uses the Create settings: ' + ((spec && spec.label) || s.target) + ' · ' + s.width + '×' + s.height + ' · ' + s.steps + ' steps · seed ' + (Number(s.seed) >= 0 ? s.seed : 'random') + '. Titles and numbers are not sent as prompt text.'),
      h('textarea', { rows: 12, value: ws.batchText, onChange: e => this.parseBatch(e.target.value), placeholder: '1. First title\n\nFirst prompt…\n\n2. Second title\n\nSecond prompt…',
        style: Object.assign({}, css.input, { fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, resize: 'vertical', minHeight: 180 }) }),
      h('div', { style: Object.assign({}, css.row, { margin: '8px 0' }) },
        btn('Parse', () => this.parseBatch(), '#38bdf8'),
        h('label', { style: css.muted }, 'Images per prompt'), numInput(ws.batchQty, v => this.wsSet({ batchQty: v, preflight: null, confirmLarge: false }), { min: '1', max: '100', step: '1' }),
        btn(q && q.status === 'RUNNING' ? 'Queue running…' : 'Preflight & Start Queue', () => this.startBatch(), '#65d66e', { disabled: !pr || !pr.ok || (q && q.status === 'RUNNING') }),
        btn('Clear', () => this.wsSet({ batchText: '', parse: null, preflight: null }), '#94a3b8')),
      parsePanel, pfPanel, queuePanel,
      ws.queueLost ? h('div', { style: { color: tone.warn, fontSize: 12 } }, ws.queueLost) : null);
  };

  // ── Doctor ──────────────────────────────────────────────────────
  P.runDoctor = async function () {
    this.wsSet({ doctorBusy: true });
    const r = await this._api('/api/doctor', undefined);
    this.wsSet({ doctorBusy: false, doctor: r.ok ? r.data : { overall: 'FAIL', rows: [{ check: 'Doctor', state: 'FAIL', detail: r.data.error || 'request failed' }] } });
  };
  P.buildDoctorPanel = function () {
    const ws = this._ws(), d = ws.doctor;
    return h('div', { style: css.panel },
      h('div', { style: Object.assign({}, css.row, { marginBottom: 8 }) }, h('div', { style: css.title }, 'DexDiffusion Doctor'), d ? chip(d.overall, stateTone(d.overall)) : null, h('div', { style: { flex: 1 } }),
        btn(ws.doctorBusy ? 'Checking…' : 'Run Doctor', () => this.runDoctor(), '#38bdf8')),
      h('div', { style: css.muted }, 'Read-only health check. It never generates an image and never touches DEX//REACH.'),
      d ? h('div', { style: { display: 'grid', gap: 3, marginTop: 8 } }, ...d.rows.map(r => h('div', { key: r.check, style: { display: 'grid', gridTemplateColumns: '48px minmax(0,1fr)', gap: 6, fontSize: 12, padding: '3px 0', borderBottom: '1px solid rgba(148,163,184,.06)' } },
        h('span', { style: { color: stateTone(r.state), fontWeight: 800 } }, r.state),
        h('div', { style: { display: 'flex', flexWrap: 'wrap', columnGap: 10, rowGap: 2, minWidth: 0 } }, h('span', { style: { color: '#cbd5e1' } }, r.check), h('span', { style: css.mono }, r.detail))))) : null);
  };

  // ── Create extras (quantity, QoL, High-Res Refine, staging) ─────
  P.buildCreateWorkbench = function () {
    const ws = this._ws(), s = this.state, ctl = this._controls(), spec = this._targetSpec() || {};
    const setDims = kind => { const d = D.aspectDims(kind, spec.defaultWidth || s.width, spec.maxWidth); this.setState({ width: d.width, height: d.height }); };
    const q = Math.max(1, parseInt(ws.quantity, 10) || 1);
    const ignored = ['negativePrompt', 'cfg', 'scheduler', 'vae'].filter(k => !ctl[k]).map(k => ({ negativePrompt: 'negative prompt', cfg: 'CFG', scheduler: 'scheduler', vae: 'VAE' }[k]));
    return h('div', { style: css.panel },
      h('div', { style: Object.assign({}, css.row, { marginBottom: 8 }) },
        h('div', { style: css.title }, 'Output'),
        chip((spec.label || s.target) + ' · ' + ctl.backend.toUpperCase(), '#38bdf8'),
        chip(q + ' image' + (q > 1 ? 's' : '') + (q > 1 && ctl.nativeBatch && q <= 16 ? ' · native batch' : q > 1 ? ' · sequential' : ''), '#65d66e')),
      h('div', { style: Object.assign({}, css.row, { marginBottom: 8 }) },
        h('label', { style: Object.assign({}, css.label, { marginBottom: 0 }) }, 'Quantity'),
        numInput(ws.quantity, v => this.wsSet({ quantity: v }), { min: '1', max: '100', step: '1', 'aria-label': 'Quantity' }),
        btn('Square', () => setDims('square'), '#94a3b8'), btn('Landscape', () => setDims('landscape'), '#94a3b8'), btn('Portrait', () => setDims('portrait'), '#94a3b8'),
        btn('Swap W↔H', () => this.setState({ width: s.height, height: s.width }), '#94a3b8')),
      h('div', { style: Object.assign({}, css.row, { marginBottom: 8 }) },
        btn('Random seed', () => this.setState({ seed: '-1' }), '#94a3b8'),
        btn('Reuse last seed', () => { if (s.lastSeed != null) this.setState({ seed: String(s.lastSeed) }); }, '#94a3b8', { disabled: s.lastSeed == null }),
        btn('Generate Again', () => { if (ws.lastBody) this.onGenerate(Object.assign({}, ws.lastBody, { prompt: String(s.prompt || '').trim() || ws.lastBody.prompt })); }, '#65d66e', { disabled: !ws.lastBody }),
        btn('Clear prompt', () => this.setState({ prompt: '', negPrompt: '' }), '#f87171')),
      ignored.length ? h('div', { style: Object.assign({}, css.muted, { color: '#fde68a' }) }, (spec.label || s.target) + ' does not use: ' + ignored.join(', ') + '. Those fields are disabled and not sent.') : null,
      ctl.hiresRefine ? h('div', { style: { borderTop: '1px solid rgba(148,163,184,.12)', marginTop: 8, paddingTop: 8, display: 'grid', gap: 6 } },
        h('label', { style: Object.assign({}, css.row, { color: '#dbe4ee', fontSize: 12 }) },
          h('input', { type: 'checkbox', checked: !!ws.hires, onChange: e => this.wsSet({ hires: e.target.checked }) }),
          'High-Res Refine (diffusion second pass, sd-cli --hires) — not a resize, not Real-ESRGAN'),
        ws.hires ? h('div', { style: css.row },
          h('label', { style: css.muted }, 'Scale'), numInput(ws.hiresScale, v => this.wsSet({ hiresScale: v }), { min: '1.1', max: '2', step: '0.1' }),
          h('label', { style: css.muted }, '2nd-pass steps (0 = same)'), numInput(ws.hiresSteps, v => this.wsSet({ hiresSteps: v }), { min: '0', max: '150', step: '1' }),
          h('label', { style: css.muted }, 'Denoise'), numInput(ws.hiresDenoise, v => this.wsSet({ hiresDenoise: v }), { min: '0.05', max: '0.95', step: '0.05' }),
          h('select', { value: ws.hiresUpscaler, onChange: e => this.wsSet({ hiresUpscaler: e.target.value }), style: Object.assign({}, css.input, { width: 'auto' }) },
            ...['Latent', 'Lanczos', 'Nearest'].map(u => h('option', { value: u }, u + ' upscaler'))),
          h('span', { style: css.muted }, '→ ' + Math.round(s.width * ws.hiresScale / 8) * 8 + '×' + Math.round(s.height * ws.hiresScale / 8) * 8)) : null) : null);
  };

  P.buildResultStaging = function () {
    const ws = this._ws(), s = this.state, base = s.backendUrl;
    const res = ws.results;
    const active = res[ws.activeIndex];
    const lab = ws.seedLab, ab = ws.ab;
    const grid = res.length > 1 || (res.length === 1 && res[0].status !== 'DONE') ? h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(88px,1fr))', gap: 6, marginBottom: 8 } },
      ...res.map((r, i) => h('div', { key: i }, r.imageUrl
        ? thumb(base + r.imageUrl, i === ws.activeIndex, () => this.selectResult(i), r.imageId, (r.keeper ? '★ ' : '') + 's' + r.seed)
        : h('div', { style: { aspectRatio: '1 / 1', border: '1px dashed rgba(148,163,184,.25)', borderRadius: 8, display: 'grid', placeItems: 'center', fontSize: 10, color: stateTone(r.status), textAlign: 'center', padding: 4 } }, r.status + (r.seed != null ? '\nseed ' + r.seed : '') + (r.error ? '\n' + r.error : ''))))) : null;
    const info = active && active.imageId ? h('div', { style: Object.assign({}, css.muted, { marginBottom: 6 }) },
      [active.target, active.width + '×' + active.height, 'seed ' + active.seed, active.operation, active.status].filter(Boolean).join(' · ')) : null;
    const actions = active && active.imageId ? h('div', { style: Object.assign({}, css.row, { marginBottom: 8 }) }, ...this.imageActions(active)) : null;
    const seedLab = lab.open ? h('div', { style: { borderTop: '1px solid rgba(148,163,184,.12)', paddingTop: 8, marginTop: 4, display: 'grid', gap: 6 } },
      h('div', { style: css.row }, h('div', { style: css.title }, 'Seed Lab'), btn('Close', () => this.wsSet({ seedLab: Object.assign({}, lab, { open: false }) }), '#94a3b8')),
      h('div', { style: css.row },
        btn('Neighbours S±2', () => this.wsSet({ seedLab: Object.assign({}, lab, { mode: 'neighbors' }) }), lab.mode === 'neighbors' ? '#38bdf8' : '#94a3b8'),
        btn('Random seeds', () => this.wsSet({ seedLab: Object.assign({}, lab, { mode: 'random' }) }), lab.mode === 'random' ? '#38bdf8' : '#94a3b8'),
        lab.mode === 'random' ? numInput(lab.count, v => this.wsSet({ seedLab: Object.assign({}, lab, { count: v }) }), { min: '1', max: '16', step: '1' }) : null,
        btn('Explore', () => this.runSeedLab(), '#65d66e')),
      h('div', { style: css.muted }, lab.mode === 'neighbors'
        ? 'Seeds ' + (neighborSeeds(lab.base != null ? lab.base : s.seed, 2).join(', ') || '— (pick a result or set a fixed seed)') + '. Everything else stays constant. Pick any result, then Reuse Seed to make it the new reference.'
        : 'Independent random non-negative seeds; everything else constant.')) : null;
    const abPanel = h('div', { style: { borderTop: '1px solid rgba(148,163,184,.12)', paddingTop: 8, marginTop: 4, display: 'grid', gap: 6 } },
      h('div', { style: css.row }, h('div', { style: css.title }, 'Prompt A/B'),
        btn(ab.open ? 'Hide' : 'Show', () => this.wsSet({ ab: Object.assign({}, ab, { open: !ab.open }) }), '#94a3b8')),
      ab.open ? h('div', { style: { display: 'grid', gap: 6 } },
        h('div', { style: css.muted }, 'Prompt A is the main prompt. Seed, model, size, steps' + (this._controls().cfg ? ', CFG, scheduler' : '') + ' are held constant' + (s.savePrompts ? '.' : '; prompt text is not stored (prompt saving is off).')),
        h('textarea', { rows: 3, value: ab.promptB, placeholder: 'Prompt B…', onChange: e => this.wsSet({ ab: Object.assign({}, this._ws().ab, { promptB: e.target.value }) }), style: Object.assign({}, css.input, { resize: 'vertical' }) }),
        h('div', { style: css.row }, btn(ab.status === 'running' ? 'Running A then B…' : 'Run A/B', () => this.runPromptAB(), '#65d66e', { disabled: ab.status === 'running' })),
        ab.pair.length ? h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 } },
          ...ab.pair.map(p => h('div', { key: p.label, style: { display: 'grid', gap: 4 } },
            p.imageUrl ? thumb(base + p.imageUrl, false, () => window.open(base + p.imageUrl, '_blank'), p.imageId, 'Prompt ' + p.label + ' · s' + p.seed) : h('div', { style: { color: tone.bad } }, p.label + ': failed'),
            p.imageId ? h('div', { style: css.row }, btn('Compare', () => this.toggleCompare(p.imageId), '#38bdf8'), btn('Keeper', () => this.toggleKeeper(p.imageId, !p.keeper, p), '#fbbf24')) : null))) : null,
        ab.held ? h('div', { style: css.mono }, 'Held constant: ' + Object.entries(ab.held).map(([k, v]) => k + '=' + v).join(' · ') + ' · Changed: prompt only') : null) : null);
    if (!res.length && !lab.open) return h('div', { style: { marginTop: 8 } }, abPanel);
    return h('div', { 'data-results-anchor': '1', style: Object.assign({}, css.panel, { marginTop: 10 }) },
      res.length ? h('div', { style: Object.assign({}, css.row, { marginBottom: 6 }) }, h('div', { style: css.title }, 'Results'),
        h('span', { style: css.muted }, res.filter(r => r.status === 'DONE').length + ' / ' + res.length + ' done')) : null,
      grid, info, actions, seedLab, abPanel);
  };

  // ── Reload recovery: resume the active job / queue from backend state ──
  const _mount = P.componentDidMount;
  P.componentDidMount = function () {
    _mount.call(this);
    const ws = this._ws();
    this._ensureEditSource();
    if (ws.activeJobId) {
      fetch(this.state.backendUrl + '/api/jobs/' + ws.activeJobId).then(r => (r.ok ? r.json() : null)).then(job => {
        if (!job) { this.wsSet({ activeJobId: null }); return; }
        if (!this._jobTerminal(job.status)) {
          this.setState({ jobStatus: 'generating', progress: D.jobProgressPercent(job.progress) || 0 });
          this.toast('Reattached to the running generation', '#38bdf8');
          this._followCreateJob(job.id, null);
        } else this._onCreateDone(job, null);
      }).catch(() => {});
    }
    if (ws.queueId) this._pollQueue();
    else this._detectRestoredQueue();
  };
  // Surface a queue restored after a console restart that still has work.
  P._detectRestoredQueue = function () {
    fetch(this.state.backendUrl + '/api/queues').then(r => (r.ok ? r.json() : null)).then(d => {
      const q = d && d.queues.filter(x => x.restored && (x.queued || x.interrupted)).sort((a, b) => b.updatedAt - a.updatedAt)[0];
      if (q) { this.wsSet({ queueId: q.id, queueLost: null }); this._pollQueue(); this.toast('Restarted queue detected — see Batch', '#fbbf24'); }
    }).catch(() => {});
  };
  const _unmount = P.componentWillUnmount;
  P.componentWillUnmount = function () { clearInterval(this._queueTimer); _unmount.call(this); };

  // ── Render: merge workstation slots into the template values ────
  const _renderVals = P.renderVals;
  P.renderVals = function () {
    const vals = _renderVals.call(this);
    const ws = this._ws(), s = this.state, ctl = this._controls();
    const q = Math.max(1, parseInt(ws.quantity, 10) || 1);
    const generating = s.jobStatus === 'generating';
    vals.backendKind = ctl.backend;
    vals.ctlNeg = String(!ctl.negativePrompt);
    vals.ctlCfg = String(!ctl.cfg);
    vals.ctlSched = String(!ctl.scheduler);
    vals.createWorkbench = this.buildCreateWorkbench();
    vals.resultStaging = this.buildResultStaging();
    vals.batchWorkspace = this.buildBatchWorkspace();
    vals.inpaintTools = this.buildInpaintTools();
    vals.editSourceCard = this.buildEditSourceCard();
    vals.enhanceWorkbench = this.buildEnhanceWorkbench();
    vals.libraryWorkbench = this.buildLibraryWorkbench();
    vals.doctorPanel = this.buildDoctorPanel();
    vals.generateLabel = generating ? 'Generating' + (q > 1 ? ' ' + q + ' images' : '') + '… ~' + s.progress + '% (est.)' : q > 1 ? 'Generate ' + q + ' Images' : 'Generate Image';
    return vals;
  };
})();
