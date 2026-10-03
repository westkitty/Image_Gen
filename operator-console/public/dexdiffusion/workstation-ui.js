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
  window.DexUI = { css, tone, btn: (...a) => btn(...a), chip: (...a) => chip(...a) };
  const openFull = (self, id, url) => window.DexLightbox.open({ src: url, caption: id, actions: self.lightboxActions ? self.lightboxActions(id) : [] });
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
      detailer: saved.detailer || { open: false, imageId: null, mode: 'face', threshold: 0.3, padding: 0.2, feather: 8.0, strength: 0.45, prompt: '', maskPreview: null, loading: false, targetSelection: 'largest', dilate: 0, note: '' },
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
  P._waitJob = async function (jobId, onTick) {
    const controller = new AbortController();
    this._jobWaitControllers = this._jobWaitControllers || new Set();
    this._jobWaitControllers.add(controller);
    let failures = 0;
    const deadline = Date.now() + 30 * 60 * 1000;
    try {
      while (!controller.signal.aborted && Date.now() < deadline) {
        try {
          const r = await fetch(this.state.backendUrl + '/api/jobs/' + jobId, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(4000)]) });
          if (r.status === 404) return { id: jobId, status: 'LOST', firstFailedGate: 'job-lost', error: 'Job not found (console restarted?)' };
          if (!r.ok) throw new Error('Job status request failed: HTTP ' + r.status);
          const job = await r.json(); failures = 0;
          if (onTick) onTick(job);
          if (this._jobTerminal(job.status)) return job;
        } catch (e) {
          if (++failures >= 5) return { id: jobId, status: 'LOST', firstFailedGate: 'polling', error: e.message };
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      return { id: jobId, status: 'LOST', firstFailedGate: controller.signal.aborted ? 'polling-cancelled' : 'polling-timeout' };
    } finally { this._jobWaitControllers.delete(controller); }
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
    this.setState({ jobStatus: 'generating', progress: null, jobStage: null, currentImageSrc: null, errorMsg: '', lastGenerationParams: Object.assign({}, body, { preset: this.state.preset }) });
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
    const add = (label, fn, color, attrs) => out.push(btn(label, fn, color, attrs));
    // Variations and seed exploration only make sense for text-to-image outputs.
    const generated = !img.operation || ['txt2img', 'variation', 'seed-lab', 'prompt-ab', 'batch'].includes(img.operation);
    add('Fullscreen', () => openFull(this, id, base + '/api/images/' + encodeURIComponent(id)), '#94a3b8');
    if (generated && !o.noVariation) add('Variation', () => this.generateVariation(img), '#65d66e');
    if (generated && img.seed != null && img.target) add('Explore Seeds', () => this.openSeedLab(img), '#65d66e');
    if (this._gate('img2img')) add('Img2Img', () => this.sendToEdit(id, 'img2img'), '#a78bfa');
    if (this._gate('inpaint')) add('Inpaint', () => this.sendToEdit(id, 'inpaint'), '#a78bfa');
    if (this._gate('outpaint')) add('Outpaint', () => this.sendToEdit(id, 'outpaint'), '#a78bfa');
    add('Enhance', () => this.sendToEnhance(id), '#f59e0b');
    add('Detailer', () => this.openDetailer(id), '#a855f7', { 'data-detailer-open': id });
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

  // Edit (img2img / inpaint / outpaint) lives in edit-ui.js: one authoritative openImageInEdit,
  // one operation state, one Run control.

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
        h('img', { src: base + src.url, alt: 'enhance source', 'data-fullscreen': 'only', 'data-fullscreen-image-id': src.id, 'data-fullscreen-caption': src.id, style: { width: '100%', borderRadius: 7, cursor: 'zoom-in' } }),
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
          thumb(base + r.imageUrl, false, () => openFull(this, r.imageId, base + r.imageUrl), r.imageId, r.method + ' · ' + r.width + '×' + r.height),
          h('div', { style: css.row },
            btn('Compare', () => { this.wsSet({ compareIds: [src.id, r.imageId] }); this.loadCompare(); this.setScreen('library'); }, '#38bdf8'),
            this._gate('img2img') ? btn('Img2Img', () => this.sendToEdit(r.imageId, 'img2img'), '#a78bfa') : null,
            this._gate('inpaint') ? btn('Inpaint', () => this.sendToEdit(r.imageId, 'inpaint'), '#a78bfa') : null,
            btn('Use as Source', () => this.sendToEnhance(r.imageId), '#f59e0b'),
            btn('Fullscreen', () => openFull(this, r.imageId, base + r.imageUrl), '#94a3b8'))))) : null);
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
  // Library thumbnail: click = fullscreen (with Edit actions in the viewer); the corner "ⓘ" selects it for details/lineage.
  P._libThumb = function (it, selected) {
    const base = this.state.backendUrl, id = it.id || it.artifact_id, url = base + it.url;
    return h('div', { key: id, 'data-lib-thumb': id, style: { position: 'relative', border: '2px solid ' + (selected ? '#38bdf8' : 'rgba(148,163,184,.16)'), borderRadius: 8, overflow: 'hidden', background: '#0a0e14', aspectRatio: '1 / 1' } },
      h('img', { src: url, alt: id, loading: 'lazy', 'data-fullscreen': 'only', 'data-fullscreen-image-id': id, 'data-fullscreen-caption': id, style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block', cursor: 'zoom-in' } }),
      h('button', { type: 'button', 'aria-label': 'Select ' + id + ' for details', title: 'Details, lineage and actions', onClick: () => this.selectLibraryImage(id),
        style: { position: 'absolute', top: 4, right: 4, minWidth: 30, minHeight: 30, borderRadius: 15, border: '1px solid rgba(148,163,184,.5)', background: 'rgba(4,8,14,.85)', color: '#e2e8f0', cursor: 'pointer', fontSize: 14 } }, 'ⓘ'),
      h('div', { style: { position: 'absolute', left: 0, right: 0, bottom: 0, background: 'rgba(4,8,14,.78)', color: '#dbe4ee', fontSize: 10, padding: '3px 5px', pointerEvents: 'none', fontFamily: "'IBM Plex Mono',monospace" } },
        (it.keeper ? '★ ' : '') + ((it.meta && it.meta.operation) || it.operation || '') + (it.meta && it.meta.seed != null ? ' ' + it.meta.seed : '')));
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
      h('img', { src: base + sel.url, alt: sel.id, 'data-fullscreen': 'only', 'data-fullscreen-image-id': sel.id, 'data-fullscreen-caption': sel.id, style: { width: '100%', borderRadius: 7, cursor: 'zoom-in' } }),
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
          ...lib.items.map(it => this._libThumb(it, lib.selectedId === it.id)))
          : h('div', { style: css.muted }, lib.loading ? '' : 'No images for this filter.'),
        detail),
      this.buildCompareWorkspace(),
      this.buildDetailerModal());
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
            h('img', { src: base + it.url, alt: it.id, 'data-fullscreen': 'only', 'data-fullscreen-image-id': it.id, 'data-fullscreen-caption': it.id, style: { width: z === 1 ? '100%' : (it.width * z / 2) + 'px', display: 'block', imageRendering: z > 2 ? 'pixelated' : 'auto', cursor: 'zoom-in' } })),
          h('div', { style: css.mono }, it.id),
          h('div', { style: css.row }, btn('Remove', () => this.toggleCompare(it.id), '#94a3b8'), btn('Fullscreen', () => openFull(this, it.id, base + it.url), '#94a3b8'))))),
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
      h('div', { style: css.muted }, 'Completed-item counts are exact; sampling percentages appear only when reported by the backend.'),
      h('div', { style: { maxHeight: 420, overflowY: 'auto', display: 'grid', gap: 5 } },
        ...q.items.map(it => h('div', { key: it.queueIndex, style: { border: '1px solid rgba(148,163,184,.1)', borderRadius: 7, padding: 7, display: 'grid', gap: 5 } },
          h('div', { style: css.row },
            chip(it.status, stateTone(it.status)),
            h('span', { style: { color: '#dbe4ee', fontSize: 12 } }, '#' + (it.queueIndex + 1) + ' · ' + it.number + ' — ' + it.title),
            it.seeds && it.seeds.length ? h('span', { style: css.mono }, 'seed ' + it.seeds.join(',')) : null,
            it.progress && it.status === 'RUNNING' ? h('span', { style: css.muted }, it.progress.label + (it.progress.percent == null ? '' : ' · ' + it.progress.percent + '%')) : null,
            h('div', { style: { flex: 1 } }),
            it.status === 'QUEUED' ? btn('↑', () => this.queueAction('up', it.queueIndex), '#94a3b8') : null,
            it.status === 'QUEUED' ? btn('↓', () => this.queueAction('down', it.queueIndex), '#94a3b8') : null,
            it.status === 'QUEUED' ? btn('Remove', () => this.queueAction('remove', it.queueIndex), '#f87171') : null),
          it.error ? h('div', { style: { color: tone.bad, fontSize: 11 } }, it.error) : null,
          it.results && it.results.length ? h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(72px,96px))', gap: 5 } },
            ...it.results.filter(r => r.imageUrl).map(r => h('div', { key: r.imageId }, thumb(base + r.imageUrl, false, () => openFull(this, r.imageId, base + r.imageUrl), r.imageId, String(r.seed))))) : null)))) : null;
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
  P.buildCreateWorkbench = function (modelsListDisplay) {
    const ws = this._ws(), s = this.state, ctl = this._controls(), spec = this._targetSpec() || {};
    const setDims = kind => { const d = D.aspectDims(kind, spec.defaultWidth || s.width, spec.maxWidth); this.setState({ width: d.width, height: d.height }); };
    const q = Math.max(1, parseInt(ws.quantity, 10) || 1);
    const ignored = ['negativePrompt', 'cfg', 'scheduler', 'vae'].filter(k => !ctl[k]).map(k => ({ negativePrompt: 'negative prompt', cfg: 'CFG', scheduler: 'scheduler', vae: 'VAE' }[k]));
    return h('div', { style: css.panel },
      h('div', { style: Object.assign({}, css.row, { marginBottom: 8 }) },
        h('div', { style: css.title }, 'Output'),
        chip((spec.label || s.target) + ' · ' + ctl.backend.toUpperCase(), '#38bdf8'),
        chip(q + ' image' + (q > 1 ? 's' : '') + (q > 1 && ctl.nativeBatch && q <= 16 ? ' · native batch' : q > 1 ? ' · sequential' : ''), '#65d66e'),
        btn(s.modelBrowserOpen ? 'Close Models 🎴' : 'Browse Models 🎴', () => this.setState({ modelBrowserOpen: !s.modelBrowserOpen }), '#a78bfa')),
      s.availableModelDefaults ? h('div', {
        style: {
          background: 'rgba(56, 189, 248, 0.08)',
          border: '1px solid rgba(56, 189, 248, 0.3)',
          borderRadius: 8,
          padding: '8px 12px',
          marginTop: 6,
          marginBottom: 6,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          flexWrap: 'wrap',
          fontSize: 12
        }
      },
        h('span', { style: { color: '#93c5fd' } },
          `Recommended defaults for ${s.availableModelDefaults.displayName || s.target}: ${s.availableModelDefaults.width}×${s.availableModelDefaults.height} · ${s.availableModelDefaults.steps} steps · CFG ${s.availableModelDefaults.cfg}`
        ),
        h('div', { style: { display: 'flex', gap: 6 } },
          btn('⚡ Use model defaults', () => this.applyModelDefaults(), '#38bdf8'),
          btn('Dismiss', () => this.setState({ availableModelDefaults: null }), '#94a3b8')
        )
      ) : null,
      s.modelBrowserOpen && modelsListDisplay ? h('div', { style: { borderTop: '1px solid rgba(148,163,184,.14)', marginTop: 8, paddingTop: 8, marginBottom: 8, maxHeight: 440, overflowY: 'auto' } },
        modelsListDisplay
      ) : null,
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

  // ── Detailer (Apple Vision Face / Hand / Person) ──────────────
  P.openDetailer = function (imageId) {
    this._detailerPreviewToken = this._detailerRunToken = null;
    this._detailerOpener = document.activeElement;
    const ws = this._ws();
    const active = this._activeResult();
    const targetId = imageId || (active && active.imageId) || (ws.lib && ws.lib.selectedId) || null;
    if (!targetId) { this.toast('Select an image to detail', '#fbbf24'); return; }
    this.wsSet({
      detailer: {
        open: true,
        imageId: targetId,
        mode: 'face',
        threshold: 0.3,
        padding: 0.2,
        feather: 8.0,
        strength: 0.45,
        prompt: 'preserve identity, pose and expression; improve facial anatomy, eyes, mouth and skin detail',
        maskPreview: null,
        loading: false,
        detections: [],
        targetSelection: 'largest',
        dilate: 0,
        note: ''
      }
    });
  };

  P.closeDetailer = function () {
    this._detailerPreviewToken = this._detailerRunToken = null;
    const ws = this._ws();
    this.wsSet({ detailer: Object.assign({}, ws.detailer, { open: false, maskPreview: null }) });
    requestAnimationFrame(() => { const opener = this._detailerOpener; const fallback = document.querySelector('[data-detailer-open="' + CSS.escape(ws.detailer.imageId || '') + '"]'); (opener && opener.isConnected ? opener : fallback)?.focus(); });
  };

  P.detailerPayload = function (d) {
    return {
      image_id: d.imageId, mode: d.mode, threshold: d.threshold, padding: d.padding, feather: d.feather,
      targetSelection: d.targetSelection || 'largest', dilate: d.dilate || 0
    };
  };

  P.previewDetailerMask = async function () {
    const ws = this._ws(), d = ws.detailer;
    if (!d || !d.imageId) return;
    const requestKey = JSON.stringify(this.detailerPayload(d));
    const previewToken = this._detailerPreviewToken = {};
    this.wsSet({ detailer: Object.assign({}, d, { loading: true, note: 'Detecting with Apple Vision…' }) });
    try {
      const res = await this._api('/api/detailer/mask-preview', this.detailerPayload(d));
      if (this._detailerPreviewToken !== previewToken) return;
      const cur = this._ws().detailer;
      if (!cur.open || JSON.stringify(this.detailerPayload(cur)) !== requestKey) {
        this.wsSet({ detailer: Object.assign({}, cur, { loading: false, maskPreview: null, note: 'Options changed — preview again.' }) });
        return;
      }
      if (res.ok && res.data.empty) {
        this.wsSet({ detailer: Object.assign({}, cur, { loading: false, maskPreview: null, detections: [], note: res.data.message }) });
        this.toast(res.data.message, '#fbbf24');
      } else if (res.ok && res.data.mask_preview) {
        const n = (res.data.detections || []).length;
        const cov = res.data.mask && res.data.mask.coverage != null ? ' · ' + (res.data.mask.coverage * 100).toFixed(1) + '% of the image' : '';
        this.wsSet({ detailer: Object.assign({}, cur, { loading: false, maskPreview: res.data.mask_preview, detections: res.data.detections || [], note: n + ' target(s) selected' + cov }) });
        this.toast('Mask generated · ' + n + ' target(s)', '#38bdf8');
      } else {
        const msg = (res.data && res.data.error) || 'Mask preview failed';
        this.wsSet({ detailer: Object.assign({}, cur, { loading: false, note: msg }) });
        this.toast(msg, '#ef4444');
      }
    } catch (e) {
      if (this._detailerPreviewToken !== previewToken) return;
      this.wsSet({ detailer: Object.assign({}, this._ws().detailer, { loading: false, note: 'Error generating mask: ' + e.message }) });
      this.toast('Error generating mask: ' + e.message, '#ef4444');
    }
  };

  P.runDetailer = async function () {
    const ws = this._ws(), d = ws.detailer;
    if (!d || !d.imageId) return;
    const runKey = JSON.stringify(this.detailerPayload(d));
    const runToken = this._detailerRunToken = {};
    this.wsSet({ detailer: Object.assign({}, d, { loading: true, note: 'Detecting with Apple Vision…' }) });
    try {
      let maskData = d.maskPreview;
      if (!maskData) {
        const pRes = await this._api('/api/detailer/mask-preview', this.detailerPayload(d));
        if (pRes.ok && pRes.data.empty) throw new Error(pRes.data.message);
        if (!pRes.ok || !pRes.data.mask_preview) throw new Error((pRes.data && pRes.data.error) || 'Failed to detect targets for detailer mask');
        maskData = pRes.data.mask_preview;
      }

      const promptText = d.prompt || (d.mode === 'hand'
        ? 'preserve hand pose and interaction; correct hand anatomy and finger structure'
        : d.mode === 'person'
        ? 'preserve pose and scene composition; improve anatomy and clothing detail'
        : 'preserve identity, pose and expression; improve facial anatomy, eyes, mouth and skin detail');

      if (this._detailerRunToken !== runToken) return;
      const currentOptions = this._ws().detailer;
      if (!currentOptions.open || JSON.stringify(this.detailerPayload(currentOptions)) !== runKey) throw new Error('Options changed — preview again before running.');
      const inpaintRes = await this._api('/api/actions/inpaint', {
        image_id: d.imageId,
        mask_data: maskData,
        prompt: promptText,
        strength: d.strength || 0.45,
        parent_image_id: d.imageId,
        detailed_from: d.imageId,
        operation: 'detailer'
      });
      const submittedOptions = this._ws().detailer;
      if (this._detailerRunToken !== runToken || !submittedOptions.open || JSON.stringify(this.detailerPayload(submittedOptions)) !== runKey) { this.loadRuns(); return; }
      if (!inpaintRes.ok) throw new Error(inpaintRes.data.error || 'Inpaint submission failed');
      this.toast('Detailer inpaint submitted to Big Mac…', '#a855f7');
      this.wsSet({ detailer: Object.assign({}, this._ws().detailer, { jobId: inpaintRes.data.job_id, note: 'Waiting for Big Mac' }) });
      const job = await this._waitJob(inpaintRes.data.job_id, tick => {
        const cur = this._ws().detailer;
        if (this._detailerRunToken !== runToken || !cur.open || cur.imageId !== d.imageId || cur.jobId !== inpaintRes.data.job_id) return;
        const stage = tick.stage || { label: 'Running' };
        this.wsSet({ detailer: Object.assign({}, cur, { note: 'Detailer · ' + stage.label + (stage.determinate ? ' · ' + stage.percent + '%' : '') }) });
      });
      if (this._detailerRunToken !== runToken || this._ws().detailer.jobId !== inpaintRes.data.job_id) { this.loadRuns(); return; }
      if (!this._jobOk(job.status)) throw new Error(this._failText(job) + (job.error ? ' ' + job.error : ''));
      this._onCreateDone(job, null);
      this.closeDetailer();
      this.setScreen('create');
    } catch (e) {
      if (this._detailerRunToken !== runToken) return;
      this.wsSet({ detailer: Object.assign({}, this._ws().detailer, { loading: false, note: 'Detailer failed: ' + e.message }) });
      this.toast('Detailer failed: ' + e.message, '#ef4444');
    }
  };

  P.buildDetailerModal = function () {
    const ws = this._ws(), d = ws.detailer || {};
    if (!d || !d.open) return null;
    return h('div', {
      role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Native Vision Detailer', 'data-detailer-dialog': '1', tabIndex: -1,
      style: {
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(2,4,8,.85)', backdropFilter: 'blur(8px)',
        zIndex: 9999, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: 16
      }
    },
      h('div', {
        style: {
          background: '#090d16', border: '1px solid rgba(168,85,247,.35)',
          borderRadius: 12, padding: 18, maxWidth: 640, width: '100%',
          maxHeight: '90vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12
        }
      },
        h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
          h('div', { style: { fontSize: 15, fontWeight: 800, color: '#f3e8ff', fontFamily: "\'DM Sans\',sans-serif" } }, 'Native Vision Detailer'),
          btn('Close', () => this.closeDetailer(), '#94a3b8')
        ),
        h('div', { style: css.muted }, 'Targeted inpaint refinement using Apple Vision detection on MacBook Air. Reuses existing inpaint pipeline and preserves source image.'),
        h('div', { style: css.row },
          btn('Face', () => this.wsSet({ detailer: Object.assign({}, d, { mode: 'face', maskPreview: null, note: '', prompt: 'preserve identity, pose and expression; improve facial anatomy, eyes, mouth and skin detail' }) }), d.mode === 'face' ? '#a855f7' : '#94a3b8'),
          btn('Hand (Derived ROI)', () => this.wsSet({ detailer: Object.assign({}, d, { mode: 'hand', maskPreview: null, note: '', prompt: 'preserve hand pose and interaction; correct hand anatomy and finger structure' }) }), d.mode === 'hand' ? '#a855f7' : '#94a3b8'),
          btn('Person', () => this.wsSet({ detailer: Object.assign({}, d, { mode: 'person', maskPreview: null, note: '', prompt: 'preserve pose and scene composition; improve anatomy and clothing detail' }) }), d.mode === 'person' ? '#a855f7' : '#94a3b8')
        ),
        h('div', { style: css.row },
          h('span', { style: css.muted }, 'Targets'),
          btn('Largest only', () => this.wsSet({ detailer: Object.assign({}, d, { targetSelection: 'largest', maskPreview: null }) }), (d.targetSelection || 'largest') === 'largest' ? '#a855f7' : '#94a3b8'),
          btn('All (up to 5)', () => this.wsSet({ detailer: Object.assign({}, d, { targetSelection: 'all', maskPreview: null }) }), d.targetSelection === 'all' ? '#a855f7' : '#94a3b8')
        ),
        h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 } },
          h('div', null,
            h('div', { style: css.label }, 'Denoise strength: ' + (d.strength || 0.45)),
            h('input', { type: 'range', min: '0.10', max: '0.80', step: '0.05', value: String(d.strength || 0.45),
              onChange: e => this.wsSet({ detailer: Object.assign({}, d, { strength: +e.target.value }) }), style: { width: '100%' } })
          ),
          h('div', null,
            h('div', { style: css.label }, 'Detection threshold: ' + (d.threshold || 0.3)),
            h('input', { type: 'range', min: '0.10', max: '0.90', step: '0.05', value: String(d.threshold || 0.3),
              onChange: e => this.wsSet({ detailer: Object.assign({}, d, { threshold: +e.target.value, maskPreview: null, note: '' }) }), style: { width: '100%' } })
          ),
          h('div', null,
            h('div', { style: css.label }, 'ROI Padding: ' + (d.padding || 0.2)),
            h('input', { type: 'range', min: '0.00', max: '0.60', step: '0.05', value: String(d.padding || 0.2),
              onChange: e => this.wsSet({ detailer: Object.assign({}, d, { padding: +e.target.value, maskPreview: null, note: '' }) }), style: { width: '100%' } })
          ),
          h('div', null,
            h('div', { style: css.label }, 'Feather radius: ' + (d.feather || 8) + 'px'),
            h('input', { type: 'range', min: '0', max: '20', step: '1', value: String(d.feather || 8),
              onChange: e => this.wsSet({ detailer: Object.assign({}, d, { feather: +e.target.value, maskPreview: null, note: '' }) }), style: { width: '100%' } })
          ),
          h('div', null,
            h('div', { style: css.label }, 'Grow / shrink mask: ' + (d.dilate || 0) + 'px'),
            h('input', { type: 'range', min: '-30', max: '30', step: '1', value: String(d.dilate || 0),
              onChange: e => this.wsSet({ detailer: Object.assign({}, d, { dilate: +e.target.value, maskPreview: null, note: '' }) }), style: { width: '100%' } })
          )
        ),
        d.note ? h('div', { role: 'status', 'data-detailer-note': '1', style: { fontSize: 12, color: /failed|No |Error|did not/.test(d.note) ? '#fca5a5' : '#cbd5e1' } }, d.note) : null,
        h('div', null,
          h('div', { style: css.label }, 'Repair prompt override'),
          h('textarea', {
            rows: 2, value: d.prompt || '',
            onChange: e => this.wsSet({ detailer: Object.assign({}, d, { prompt: e.target.value }) }),
            placeholder: 'Delta prompt…',
            style: Object.assign({}, css.input, { resize: 'vertical' })
          })
        ),
        d.maskPreview ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
          h('div', { style: css.label }, 'Mask Preview (White = inpaint region, ' + (d.detections ? d.detections.length : 0) + ' target(s))'),
          h('img', { src: d.maskPreview, alt: 'Mask preview', 'data-fullscreen': 'only', style: { maxHeight: 180, objectFit: 'contain', borderRadius: 6, border: '1px solid rgba(168,85,247,.4)' } })
        ) : null,
        h('div', { style: { borderTop: '1px solid rgba(148,163,184,.14)', paddingTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
          h('span', { style: { fontSize: 11, color: '#f87171', fontStyle: 'italic' } }, 'Face Swap: UNAVAILABLE (No proven license-safe local model)'),
          h('div', { style: css.row },
            btn(d.loading ? 'Scanning…' : 'Preview Mask', () => this.previewDetailerMask(), '#38bdf8', { disabled: d.loading }),
            btn(d.loading ? 'Processing…' : 'Run Detailer', () => this.runDetailer(), '#a855f7', { disabled: d.loading })
          )
        )
      )
    );
  };

  P.buildResultStaging = function () {
    const ws = this._ws(), s = this.state, base = s.backendUrl;
    const res = ws.results || [];
    const activeIdx = Math.max(0, Math.min(res.length - 1, ws.activeIndex || 0));
    const active = res[activeIdx];
    const lab = ws.seedLab, ab = ws.ab, d = ws.detailer || {};
    const isNarrow = typeof window !== 'undefined' && window.innerWidth < 768;

    // Sibling filmstrip thumbnails
    const filmstripItems = res.map((r, i) => {
      const isHero = i === activeIdx;
      const borderStyle = isHero ? '2px solid #38bdf8' : '1px solid rgba(148,163,184,.22)';
      const bgStyle = isHero ? 'rgba(56,189,248,.12)' : 'rgba(10,16,28,.6)';

      return h('div', {
        key: r.imageId || i,
        // Selector strip: first click selects, clicking the already-active thumbnail opens it fullscreen.
        onClick: () => (i === activeIdx && r.imageUrl ? openFull(this, r.imageId, base + r.imageUrl) : this.selectResult(i)),
        style: {
          cursor: 'pointer',
          borderRadius: 8,
          border: borderStyle,
          background: bgStyle,
          padding: 4,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 4,
          flexShrink: 0,
          width: isNarrow ? '96px' : '100%',
          boxSizing: 'border-box',
          transition: 'all .15s ease'
        }
      },
        r.imageUrl
          ? h('div', { style: { position: 'relative', width: '100%', aspectRatio: '1 / 1', overflow: 'hidden', borderRadius: 6 } },
              h('img', {
                src: base + r.imageUrl,
                alt: 'Result ' + (i + 1),
                style: { width: '100%', height: '100%', objectFit: 'cover' }
              }),
              h('span', {
                style: {
                  position: 'absolute', bottom: 3, left: 3,
                  background: 'rgba(0,0,0,.75)', color: isHero ? '#38bdf8' : '#cbd5e1',
                  borderRadius: 4, padding: '1px 5px', fontSize: 9, fontWeight: 700,
                  fontFamily: "'IBM Plex Mono',monospace"
                }
              }, isHero ? 'HERO #' + (i + 1) : '#' + (i + 1))
            )
          : h('div', {
              style: {
                aspectRatio: '1 / 1', width: '100%',
                border: '1px dashed rgba(148,163,184,.25)', borderRadius: 6,
                display: 'grid', placeItems: 'center', fontSize: 10,
                color: stateTone(r.status), textAlign: 'center', padding: 4
              }
            }, r.status + (r.seed != null ? '\ns' + r.seed : '')),
        h('div', {
          style: {
            fontSize: 10, color: isHero ? '#7dd3fc' : '#94a3b8',
            fontFamily: "'IBM Plex Mono',monospace", whiteSpace: 'nowrap',
            overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%'
          }
        }, (r.keeper ? '★ ' : '') + 's' + (r.seed != null ? r.seed : '—'))
      );
    });

    // Large Dominant Hero display
    const heroImage = active && active.imageUrl
      ? h('div', { style: { position: 'relative', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' } },
          h('img', {
            src: base + active.imageUrl,
            alt: 'Hero result', 'data-fullscreen': 'only', 'data-fullscreen-image-id': active.imageId || '', 'data-fullscreen-caption': active.imageId || '',
            style: {
              width: '100%', maxHeight: '680px', objectFit: 'contain', cursor: 'zoom-in',
              borderRadius: 8, background: '#030710', border: '1px solid rgba(148,163,184,.14)'
            }
          }),
          h('div', {
            style: {
              position: 'absolute', bottom: 8, left: 8, right: 8,
              background: 'rgba(4,8,16,.85)', backdropFilter: 'blur(6px)',
              border: '1px solid rgba(148,163,184,.2)', borderRadius: 6,
              padding: '6px 10px', display: 'flex', justifyContent: 'space-between',
              alignItems: 'center', fontSize: 11, color: '#e2e8f0', fontFamily: "'IBM Plex Mono',monospace"
            }
          },
            h('span', null, [
              '#' + (activeIdx + 1) + ' of ' + res.length,
              active.target,
              active.width + '×' + active.height,
              'seed ' + active.seed,
              active.operation
            ].filter(Boolean).join(' · ')),
            h('span', { style: { color: active.keeper ? '#fbbf24' : '#94a3b8' } },
              active.keeper ? '★ Keeper' : 'Normal')
          )
        )
      : (active ? h('div', {
          style: {
            minHeight: '260px', width: '100%', display: 'grid', placeItems: 'center',
            border: '1px dashed rgba(148,163,184,.25)', borderRadius: 8, color: stateTone(active.status)
          }
        }, 'Generating image #' + (activeIdx + 1) + '… ' + active.status) : null);

    // Multi-Output Hero Workspace layout
    const multiOutputWorkspace = res.length > 0 ? h('div', {
      className: 'dex-hero-workspace',
      style: {
        display: 'flex',
        flexDirection: isNarrow ? 'column' : 'row',
        gap: 12,
        alignItems: 'stretch',
        marginBottom: 10
      }
    },
      // Dominant Hero column
      h('div', {
        style: {
          flex: '1 1 0%',
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 8
        }
      },
        heroImage,
        active && active.imageId ? h('div', { style: Object.assign({}, css.row, { marginTop: 4, flexWrap: 'wrap' }) },
          btn(active.keeper ? '★ Keeper' : '☆ Keeper', () => this.toggleKeeper(active.imageId, !active.keeper, active), '#fbbf24'),
          btn('Copy Seed', () => { navigator.clipboard.writeText(String(active.seed)); this.toast('Copied seed ' + active.seed, '#38bdf8'); }, '#94a3b8'),
          btn('Reuse Settings', () => this.reuseSettings(active.imageId), '#94a3b8'),
          btn('Same / New Seed', () => this.generateVariation(active), '#65d66e'),
          this._gate('img2img') ? btn('Send to Img2Img', () => this.sendToEdit(active.imageId, 'img2img'), '#a78bfa') : null,
          this._gate('inpaint') ? btn('Send to Inpaint', () => this.sendToEdit(active.imageId, 'inpaint'), '#a78bfa') : null,
          btn('Upscale', () => this.sendToEnhance(active.imageId), '#f59e0b'),
          btn('Detailer', () => this.openDetailer(active.imageId), '#a855f7'),
          btn('Fullscreen', () => openFull(this, active.imageId, base + '/api/images/' + encodeURIComponent(active.imageId)), '#94a3b8'),
          btn('Lineage', () => this.showInLibrary(active.imageId), '#94a3b8')
        ) : null
      ),
      // Siblings Filmstrip Rail
      res.length > 1 ? h('div', {
        className: 'dex-filmstrip-rail',
        style: isNarrow ? {
          display: 'flex',
          flexDirection: 'row',
          gap: 8,
          overflowX: 'auto',
          paddingBottom: 6,
          width: '100%'
        } : {
          flex: '0 0 148px',
          width: '148px',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          maxHeight: '680px',
          overflowY: 'auto',
          paddingRight: 4,
          borderLeft: '1px solid rgba(148,163,184,.14)',
          paddingLeft: 8
        }
      },
        h('div', { style: Object.assign({}, css.label, { marginBottom: 2 }) }, 'Siblings (' + res.length + ')'),
        ...filmstripItems
      ) : null
    ) : null;

    // Detailer Modal / Drawer
    const detailerPanel = this.buildDetailerModal();

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
            p.imageUrl ? thumb(base + p.imageUrl, false, () => openFull(this, p.imageId, base + p.imageUrl), p.imageId, 'Prompt ' + p.label + ' · s' + p.seed) : h('div', { style: { color: tone.bad } }, p.label + ': failed'),
            p.imageId ? h('div', { style: css.row }, btn('Compare', () => this.toggleCompare(p.imageId), '#38bdf8'), btn('Keeper', () => this.toggleKeeper(p.imageId, !p.keeper, p), '#fbbf24')) : null))) : null,
        ab.held ? h('div', { style: css.mono }, 'Held constant: ' + Object.entries(ab.held).map(([k, v]) => k + '=' + v).join(' · ') + ' · Changed: prompt only') : null) : null);

    if (!res.length && !lab.open) return h('div', { style: { marginTop: 8 } }, abPanel, detailerPanel);
    return h('div', { 'data-results-anchor': '1', style: Object.assign({}, css.panel, { marginTop: 10 }) },
      res.length ? h('div', { style: Object.assign({}, css.row, { marginBottom: 8 }) },
        h('div', { style: css.title }, 'Workspace Results'),
        h('span', { style: css.muted }, res.filter(r => r.status === 'DONE').length + ' / ' + res.length + ' done'),
        h('span', { style: { marginLeft: 'auto', fontSize: 10, color: '#64748b', fontFamily: "'IBM Plex Mono',monospace" } },
          'Navigate: ↑/↓/←/→ · Home/End')
      ) : null,
      multiOutputWorkspace, seedLab, abPanel, detailerPanel);
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
          this.setState({ jobStatus: 'generating', progress: job.stage && job.stage.determinate ? job.stage.percent : null, jobStage: job.stage || null });
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

  // ── Keyboard navigation: siblings filmstrip rail (Up/Down/Left/Right/Home/End) ──
  const _onKeydown = P.onKeydown;
  P.onKeydown = function (e) {
    const tag = (e.target && e.target.tagName || '').toLowerCase();
    const inField = tag === 'input' || tag === 'textarea' || tag === 'select';
    const curScreen = (this.state.screens && this.state.screens[this.state.version]) || 'create';
    if (!inField && curScreen === 'create') {
      const ws = this._ws();
      const res = (ws && ws.results) ? ws.results.filter(r => r.imageUrl) : [];
      if (res.length > 1) {
        const curIdx = ws.activeIndex || 0;
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
          e.preventDefault();
          this.selectResult((curIdx + 1) % res.length);
          return;
        }
        if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
          e.preventDefault();
          this.selectResult((curIdx - 1 + res.length) % res.length);
          return;
        }
        if (e.key === 'Home') {
          e.preventDefault();
          this.selectResult(0);
          return;
        }
        if (e.key === 'End') {
          e.preventDefault();
          this.selectResult(res.length - 1);
          return;
        }
      }
    }
    if (_onKeydown) _onKeydown.call(this, e);
  };

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
    vals.createWorkbench = this.buildCreateWorkbench(vals.modelsListDisplay);
    vals.resultStaging = this.buildResultStaging();
    vals.batchWorkspace = this.buildBatchWorkspace();
    vals.enhanceWorkbench = this.buildEnhanceWorkbench();
    vals.libraryWorkbench = this.buildLibraryWorkbench();
    vals.doctorPanel = this.buildDoctorPanel();
    vals.generateLabel = generating ? 'Generating' + (q > 1 ? ' ' + q + ' images' : '') + '… ' + ((s.jobStage || {}).label || 'Waiting for backend') + ((s.jobStage || {}).determinate ? ' · ' + s.jobStage.percent + '%' : '') : q > 1 ? 'Generate ' + q + ' Images' : 'Generate Image';
    return vals;
  };
})();
