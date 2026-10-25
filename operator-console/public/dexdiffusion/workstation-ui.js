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
      quantity: saved.quantity || 1, hires: false, hiresMode: 'scale', hiresScale: 2, hiresW: 1024, hiresH: 1024, hiresSteps: 0, hiresDenoise: 0.45, hiresUpscaler: 'Latent',
      results: [], activeIndex: 0, lastBody: null,
      seedLab: { open: false, mode: 'neighbors', count: 4 }, ab: { open: false, promptB: '', status: 'idle', pair: [] },
      batchText: typeof saved.batchText === 'string' ? saved.batchText : '', parse: null, expanded: {}, batchQty: 1, preflight: null, confirmLarge: false,
      queueId: saved.queueId || null, queue: null,
      editSourceId: saved.editSourceId || null, editOriginalId: saved.editOriginalId || null, editSource: null, editResults: [], editStatus: 'idle', prep: 'none',
      brush: saved.brush || { mode: 'paint', size: 40 }, maskZoom: 1, maskInfo: null,
      out: { left: 0, right: 128, top: 0, bottom: 0, strength: 0.85 }, outStatus: 'idle',
      enhSourceId: saved.enhSourceId || null, enhSource: null, enhResults: [], enhStatus: 'idle', lanczosScale: 2, refEdit: { prompt: '', steps: 4, seed: -1 }, pnginfo: { busy: false, name: '', result: null, error: null }, fileCheck: { busy: false, items: [], error: null }, xyz: { x: { type: 'steps', values: '10, 20' }, y: { type: 'cfg_scale', values: '5, 7' }, z: { type: 'none', values: '' }, keepRandom: false, legend: true, margin: 0, plan: null, error: null, grid: null }, extras: { mode: 'by', scale: 2, width: 1024, height: 1024, crop: true, upscaler: 'lanczos', upscaler2: 'none', visibility: 0.5, max_side: 0 },
      lib: Object.assign({ filter: 'all', items: [], total: 0, selectedId: null, selected: null, loading: false, offset: 0, sort: 'desc', error: null }, D.loadLibPrefs ? D.loadLibPrefs() : {}),
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
  P._api = async function (route, body, method, signal) {
    const r = await fetch(this.state.backendUrl + route, body === undefined && !method ? undefined : {
      signal, method: method || 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
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
    const fs = window.DexFailureStage && window.DexFailureStage.classify(job.firstFailedGate, String(job.stderr || '') + '\n' + String(job.stdout || ''));
    // The engine bridge reports a sanitized reason (fixed template, model filename only); the job record carries it after the gate.
    const rm = /failed at gate [^:]+:\s*(.+)$/.exec(String(job.error || (job.generic && job.generic.error) || ''));
    const reason = (fs && fs.reason) || (rm && rm[1]);
    if (reason) return reason + (fs && fs.nextStep ? ' ' + fs.nextStep : '');
    return (fs && fs.stage ? fs.text + ' ' : '') + 'Failed at gate "' + g + '"' + (hints[g] ? ' — ' + hints[g] : '') + '.';
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
      fast_batch: !!ws.fastBatch,
      save_prompts: !!s.savePrompts,
    };
    if (ctl.negativePrompt) body.negative_prompt = s.negPrompt || '';
    if (ctl.cfg) body.cfg_scale = +s.cfg;
    if (ctl.scheduler) body.scheduler = s.scheduler || 'discrete';
    if (ctl.sampler && s.sampler) body.sampler = D.canonicalSamplerId(s.sampler);
    if (ctl.clipSkip && s.clipSkip !== '' && s.clipSkip != null) body.clip_skip = parseInt(s.clipSkip, 10);
    if (ctl.tiling && s.tiling) body.tiling = true;
    if (ctl.eta && s.eta !== '' && s.eta != null && D.ETA_SAMPLERS.includes(D.canonicalSamplerId(s.sampler))) body.eta = Number(s.eta);  // disabled in the UI otherwise, so not sent
    if (ctl.rng && s.rng) body.rng = s.rng;
    if (ctl.vae) body.vae = s.selectedVae === 'default' ? 'auto' : s.selectedVae;
    if (ctl.hiresRefine && ws.hires) {
      Object.assign(body, { hires_steps: parseInt(ws.hiresSteps, 10) || 0, hires_denoise: +ws.hiresDenoise, hires_upscaler: ws.hiresUpscaler });
      if (ws.hiresMode === 'size') Object.assign(body, { hires_width: parseInt(ws.hiresW, 10), hires_height: parseInt(ws.hiresH, 10) });
      else body.hires_scale = +ws.hiresScale;
    }
    const cleanOver = Object.assign({}, over || {});
    const isExactReplay = cleanOver.exactReplay === true;
    delete cleanOver.exactReplay;
    const merged = Object.assign(body, cleanOver);
    if (ctl.lora) {
      if (isExactReplay && Array.isArray(cleanOver.loras)) {
        if (cleanOver.loras.length) merged.loras = cleanOver.loras;
        else delete merged.loras;
      } else {
        const eff = typeof this.getEffectiveCreateLoras === 'function' ? this.getEffectiveCreateLoras() : [];
        if (eff.length) merged.loras = eff.map(l => ({ name: l.name, weight: l.weight }));
        else delete merged.loras;
      }
    } else {
      delete merged.loras;
    }
    delete merged.exactReplay;
    return merged;
  };

  // V2 Create LoRA state is a single, target-scoped adapter. The API still
  // receives the existing structured `loras` contract; prompt tags are never
  // authored by the browser.
  P._createLoraOptions = function (targetOverride) {
    const target = targetOverride || this.state.target || 'sd15';
    const targetSpec = typeof this._targetSpec === 'function' ? (this._targetSpec(target) || {}) : {};
    return (this.state.assets && this.state.assets.loras || []).map(l => {
      const targetFamily = targetSpec.family || (target.indexOf('sdxl') === 0 ? 'sdxl' : target === 'sd15' || target.indexOf('sd15-') === 0 ? 'sd15' : target.indexOf('flux2-') === 0 ? 'flux2' : '');
      const route = (l.production_routes || []).find(r => r.target === target && (r.recipe && r.backend_override || targetSpec.backend === 'mflux' && r.backend === 'mflux' && r.rslora_equivalent)) || null;
      // A server route for this exact checkpoint means the runtime policy already
      // accepted the adapter family (e.g. an SDXL accelerator on a Pony checkpoint).
      const familyMatches = l.family === targetFamily || !!route;
      const familyOnly = !!route && route.verified === false;
      const provenTarget = Array.isArray(l.proof_target_ids) && l.proof_target_ids.includes(target);
      const backendMatches = !l.proof_backend || l.proof_backend === (targetSpec.backend || 'sdcpp');
      const metalProven = ['AT_RUNTIME_ONLY_PROVEN', 'FUNCTIONAL_METAL'].includes(l.metal_inference_status) && (l.metal_target_ids || []).includes(target);
      const modeAvailable = !l.proof_apply_modes || l.proof_apply_modes.includes('immediately') || metalProven;
      const mfluxStyle = targetSpec.backend === 'mflux' && l.name === 'pixelart_lora' && l.mflux_rslora_verified === true && route;
      const hasProductionRoute = !!route && (route.production === true || !!route.backend_override || !!route.rslora_equivalent);
      const isCompat = l.compatibility === 'Compatible';
      const routeProven = metalProven || hasProductionRoute || (provenTarget && backendMatches && modeAvailable);
      const enabled = !!mfluxStyle || (familyMatches && !l.rs_lora && isCompat && (routeProven || (!l.proof_status && !l.proof_target_ids)));
      const routeStatus = mfluxStyle
        ? 'STYLE · MFLUX · rsLoRA scaling verified; no acceleration claim'
        : metalProven
        ? (l.metal_performance_status === 'MEASURED'
          ? `Timing measured · ${l.metal_performance_summary || 'MTL0 / at_runtime; quality review pending'}`
          : 'Metal-compatible · MTL0 / at_runtime')
        : provenTarget ? 'CPU-only · SDCPP / immediately'
        : familyOnly ? 'Family-compatible · unproven on this checkpoint'
        : (hasProductionRoute ? 'Verified production route' : (isCompat ? 'Compatible' : 'Inference unavailable'));
      const classification = l.classification ? String(l.classification).toUpperCase() : (l.is_speed_adapter ? 'ACCELERATION' : 'STYLE');
      return Object.assign({}, l, {
        use_enabled: enabled,
        family_only: familyOnly,
        accelerator: enabled && (classification === 'ACCELERATION' || l.is_speed_adapter === true),
        route_status: routeStatus,
        classification,
        unavailable_reason: l.unavailable_reason || (l.rs_lora && !mfluxStyle ? 'rsLoRA scaling is not verified on this backend.' : !familyMatches ? 'Adapter family does not match the selected checkpoint.' : !enabled ? 'Installed; inference is not yet proven for this checkpoint and backend.' : ''),
        selected_route: route
      });
    });
  };

  // Acceleration adapters usable on the selected checkpoint (server route +
  // compatible card). Recomputed from state.assets on every render, so the
  // highlight follows model switches once that target's cards arrive.
  P.createLoraAccelerators = function (targetOverride) {
    return this._createLoraOptions(targetOverride).filter(l => l.accelerator);
  };
  // Mirrors lora-runtime-policy FAMILY_TARGET_FAMILIES: could this accelerator
  // still have a route on `target`? Only used while that target's cards load.
  P._acceleratorFamilyMayFit = function (lora, target) {
    if (!lora || !(String(lora.classification || '').toUpperCase() === 'ACCELERATION' || lora.is_speed_adapter)) return false;
    const spec = typeof this._targetSpec === 'function' ? (this._targetSpec(target) || {}) : {};
    const id = String(target || '');
    const fam = spec.family || (id.indexOf('turbo') > -1 ? 'sdxl_turbo' : id.indexOf('pony') > -1 ? 'pony' : id.indexOf('sdxl') === 0 ? 'sdxl' : id === 'sd15' || id.indexOf('sd15-') === 0 ? 'sd15' : '');
    return ({ sdxl: ['sdxl', 'pony'], sd15: ['sd15'] }[lora.family] || []).includes(fam);
  };
  P.createLoraRecipeSummary = function (lora) {
    let r = this._createLoraRouteRecipe(lora);
    if (!r) { const preset = this._createLoraRecipe(lora); r = preset && preset.kind === 'lora' ? preset.recommended || null : null; }
    if (!r) return '';
    return [r.steps != null ? r.steps + ' steps' : null, r.sampler, r.scheduler, r.cfg != null ? 'CFG ' + r.cfg : null].filter(Boolean).join(' · ');
  };
  P._activeCreateLoraRouteRecipe = function () {
    const state = this.state.createLora || {};
    if (!state.enabled || !state.selectedId) return null;
    const selected = this._createLoraOptions().find(l => l.id === state.selectedId && l.use_enabled);
    if (!selected) return null;
    const route = this._createLoraRouteRecipe(selected);
    if (route) return route;
    const preset = this._createLoraRecipe(selected);
    return preset && preset.kind === 'lora' ? preset.recommended || null : null;
  };

  P.getEffectiveCreateLoras = function () {
    const state = this.state.createLora;
    if (!state || !state.selectedId || state.enabled === false) return [];
    const options = this._createLoraOptions();
    const selected = options.find(l => l.id === state.selectedId && l.use_enabled);
    if (!selected) return [];
    const rawStrength = state.strength !== undefined && state.strength !== null ? Number(state.strength) : (selected.default_weight || 1.0);
    const min = selected.min_weight !== undefined ? selected.min_weight : 0.0;
    const max = selected.max_weight !== undefined ? selected.max_weight : 2.0;
    const strength = Number.isFinite(rawStrength) ? Math.min(max, Math.max(min, rawStrength)) : (selected.default_weight || 1.0);
    return [{
      name: selected.name,
      weight: strength,
      id: selected.id,
      adapter: selected.filename || selected.name
    }];
  };

  P.resetCreateLoraRecipe = function () {
    const state = this.state.createLora || {};
    if (!state.enabled || !state.selectedId) return false;
    const options = typeof this._createLoraOptions === 'function' ? this._createLoraOptions() : [];
    const selected = options.find(l => l.id === state.selectedId && l.use_enabled);
    if (!selected) return false;
    const defaultWeight = selected.default_weight !== undefined ? selected.default_weight : 1.0;
    const next = Object.assign({}, state, {
      strength: defaultWeight,
      overrides: {}
    });
    this._persistCreateLora(next);
    const applied = this._applyCreateLoraRecipe(selected, next.savedSettings || {}, {});
    next.recipeSettings = applied;
    this._persistCreateLora(next);
    const appliedSteps = applied.steps != null ? applied.steps : this.state.steps;
    const appliedCfg = applied.cfg != null ? applied.cfg : this.state.cfg;
    this.toast(`Reset ${selected.name} to recommended recipe (${appliedSteps} steps, CFG ${appliedCfg})`, '#65d66e');
    return true;
  };

  P._persistCreateLora = function (next) {
    try { localStorage.setItem('dex_create_lora_v1', JSON.stringify(next)); } catch (_) {}
    this.setState({ createLora: next });
  };
  P._createLoraRecipe = function (asset) {
    const presets = window.ImageGenModelPresets;
    const identity = asset && (asset.filename || asset.name || asset.id) || '';
    return presets && presets.resolveModelPreset(identity) || null;
  };
  // The server route recipe is the one validation enforces; model-presets is a
  // fallback for adapters without a server route.
  P._createLoraRouteRecipe = function (asset) {
    const r = asset && asset.selected_route && asset.selected_route.recipe;
    if (!r) return null;
    return { steps: r.steps, cfg: r.cfg_scale !== undefined ? r.cfg_scale : r.cfg, sampler: r.sampler, scheduler: r.scheduler };
  };
  P._applyCreateLoraRecipe = function (asset, base, overrides) {
    let rec = this._createLoraRouteRecipe(asset);
    if (!rec) {
      const recipe = this._createLoraRecipe(asset);
      if (!recipe || recipe.kind !== 'lora') return {};
      rec = recipe.recommended || {};
    }
    const patch = {};
    for (const [field, value] of Object.entries({ steps: rec.steps, cfg: rec.cfg, sampler: rec.sampler, scheduler: rec.scheduler || 'discrete' })) {
      if (value !== undefined && !(overrides && overrides[field])) patch[field] = value;
    }
    if (Object.keys(patch).length) this.setState(patch);
    return patch;
  };
  P.selectCreateLora = function (adapterId) {
    const state = this.state.createLora || {};
    if (!adapterId) {
      if (state.enabled) {
        const base = state.savedSettings || {}, overrides = state.overrides || {}, restore = {};
        for (const field of ['steps', 'cfg', 'sampler', 'scheduler']) {
          if (!Object.prototype.hasOwnProperty.call(overrides, field) && base[field] !== undefined) restore[field] = base[field];
        }
        if (Object.keys(restore).length) this.setState(restore);
      }
      const next = { enabled: false, selectedId: '', strength: 1.0, savedSettings: null, recipeSettings: null, overrides: {} };
      this._persistCreateLora(next);
      return;
    }
    const options = this._createLoraOptions();
    const selected = options.find(l => l.id === adapterId);
    if (!selected) return;
    if (!selected.use_enabled) {
      this.toast(selected.unavailable_reason || 'This adapter is not available for this checkpoint.', '#fbbf24');
      return;
    }
    const savedSettings = state.savedSettings || { steps: this.state.steps, cfg: this.state.cfg, sampler: this.state.sampler, scheduler: this.state.scheduler };
    const defaultWeight = selected.default_weight !== undefined ? selected.default_weight : 1.0;
    const next = {
      enabled: true,
      selectedId: selected.id,
      strength: defaultWeight,
      savedSettings,
      recipeSettings: null,
      overrides: {}
    };
    const applied = this._applyCreateLoraRecipe(selected, savedSettings, {});
    next.recipeSettings = applied;
    this._persistCreateLora(next);
  };
  P.setCreateLoraEnabled = function (enabled) {
    const state = Object.assign({ enabled: false, selectedId: '', strength: 1, advanced: false, savedSettings: null, overrides: {} }, this.state.createLora || {});
    const options = this._createLoraOptions(), selected = options.find(l => l.id === state.selectedId && l.use_enabled)
      || (enabled ? options.find(l => l.use_enabled) : null);
    if (enabled && !selected) { this.toast('No proven LoRA is available for this checkpoint.', '#fbbf24'); return; }
    if (enabled) {
      const savedSettings = state.savedSettings || { steps: this.state.steps, cfg: this.state.cfg, sampler: this.state.sampler, scheduler: this.state.scheduler };
      const next = Object.assign({}, state, { enabled: true, selectedId: selected.id, savedSettings, overrides: {} });
      const applied = this._applyCreateLoraRecipe(selected, savedSettings, {});
      next.recipeSettings = applied;
      this._persistCreateLora(next);
    } else {
      const base = state.savedSettings || {}, overrides = state.overrides || {}, restore = {};
      for (const field of ['steps', 'cfg', 'sampler', 'scheduler']) if (!Object.prototype.hasOwnProperty.call(overrides, field) && base[field] !== undefined) restore[field] = base[field];
      if (Object.keys(restore).length) this.setState(restore);
      this._persistCreateLora(Object.assign({}, state, { enabled: false, savedSettings: null, recipeSettings: null, overrides: {} }));
    }
  };
  P.setCreateLoraField = function (field, value) {
    const current = this.state.createLora || {}, next = Object.assign({}, current, { overrides: Object.assign({}, current.overrides || {}, { [field]: value }) });
    if (current.enabled) this._persistCreateLora(next);
    this.setState({ [field]: value });
  };
  P._restoreCreateLoraSettings = function () {
    const state = this.state.createLora || {};
    if (!state.enabled) return;
    const selected = this._createLoraOptions().find(l => l.id === state.selectedId && l.use_enabled);
    if (!selected) {
      // The checkpoint changed under an active adapter: turn it off and give the
      // user back the settings they had before the recipe was applied.
      this.selectCreateLora('');
      return;
    }
    // Still usable (e.g. a family-compatible accelerator): re-apply this
    // checkpoint's route recipe, then the user's manual overrides.
    const patch = Object.assign({}, state.recipeSettings || {});
    for (const [field, value] of Object.entries(this._createLoraRouteRecipe(selected) || {})) if (value !== undefined) patch[field] = value;
    for (const [field, value] of Object.entries(state.overrides || {})) if (['steps', 'cfg', 'sampler', 'scheduler'].includes(field)) patch[field] = value;
    if (Object.keys(patch).length) this.setState(patch);
  };
  P.setCreateLoraStrength = function (value, min, max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return;
    const state = this.state.createLora || {};
    const selected = this._createLoraOptions().find(l => l.id === state.selectedId);
    const lo = min !== undefined ? min : (selected ? selected.min_weight : 0.0);
    const hi = max !== undefined ? max : (selected ? selected.max_weight : 2.0);
    const clamped = Math.max(lo, Math.min(hi, n));
    const next = Object.assign({}, state, { strength: clamped });
    this._persistCreateLora(next);
  };
  P.buildCreateLoraControls = function () {
    const state = this.state.createLora || {}, options = this._createLoraOptions();
    const selected = options.find(l => l.id === state.selectedId) || null;
    const enabledOptions = options.filter(l => l.use_enabled);
    const strength = Number(state.strength ?? (selected && selected.default_weight) ?? 1);
    const checkbox = h('label', { className: 'ca-check-row', style: { display: 'inline-flex', alignItems: 'center', gap: 7 }, title: enabledOptions.length ? 'Enable one proven adapter for this checkpoint.' : 'No adapter is proven for this checkpoint and backend.' },
      h('input', { type: 'checkbox', 'data-dex-field': 'use-lora', checked: !!state.enabled, disabled: !selected || !selected.use_enabled || this.state.jobStatus === 'generating', onChange: e => this.setCreateLoraEnabled(e.target.checked) }), h('span', null, 'Use LoRA'));
    const select = h('label', { className: 'ca-field', style: { minWidth: 0, width: '100%', gridColumn: '1 / -1' } }, this.state.version === 2 ? null : h('span', null, 'Adapter'), h('select', { 'aria-label': 'Adapter', 'data-dex-field': 'create-lora-adapter', value: state.selectedId || '', disabled: this.state.jobStatus === 'generating', style: { width: '100%', minWidth: 0 }, onChange: e => {
      const val = e.target.value;
      if (!val) {
        this.selectCreateLora('');
      } else {
        const l = options.find(x => x.id === val);
        if (l && l.use_enabled) {
          this.selectCreateLora(val);
        } else {
          if ((this.state.createLora || {}).enabled) this.setCreateLoraEnabled(false);
          const next = Object.assign({}, this.state.createLora || state, { selectedId: val, strength: l ? l.default_weight : 1, enabled: false, savedSettings: null, recipeSettings: null, overrides: {} });
          this._persistCreateLora(next);
        }
      }
    } },
      h('option', { value: '' }, options.length ? 'Select a compatible adapter' : 'No adapters discovered'), ...options.map(l => h('option', { key: l.id, value: l.id, disabled: !l.use_enabled }, l.name + (l.use_enabled ? ' · PROVEN' : ' · ' + l.unavailable_reason)))));
    const reason = !enabledOptions.length ? h('small', { className: 'ca-muted', role: 'status', 'data-dex-field': 'lora-unavailable', style: { gridColumn: '1 / -1', lineHeight: 1.25 } }, selected ? selected.unavailable_reason : 'Only adapters proven for this checkpoint and backend can be used.') : null;
    const advanced = h('details', { 'data-dex-field': 'lora-advanced', open: !!state.advanced, onToggle: e => this._persistCreateLora(Object.assign({}, this.state.createLora || {}, { advanced: e.target.open })), style: { flexBasis: '100%' } },
      h('summary', { style: { cursor: 'pointer', color: '#b7c7d8', fontSize: 12 } }, 'Advanced'),
      selected ? h('div', { className: 'ca-form-grid', style: { marginTop: 8 } },
        h('label', { className: 'ca-field' }, h('span', null, 'Strength · ' + strength.toFixed(2)), h('input', { type: 'range', min: selected.min_weight, max: selected.max_weight, step: selected.step, value: strength, disabled: !state.enabled || !selected.use_enabled, 'aria-label': 'LoRA strength', 'data-dex-field': 'lora-strength-slider', onInput: e => this.setCreateLoraStrength(e.target.value, selected.min_weight, selected.max_weight) })),
        h('label', { className: 'ca-field' }, h('span', null, 'Exact strength'), h('input', { type: 'number', min: selected.min_weight, max: selected.max_weight, step: selected.step, value: strength, disabled: !state.enabled || !selected.use_enabled, 'aria-label': 'Exact LoRA strength', 'data-dex-field': 'lora-strength-number', onInput: e => this.setCreateLoraStrength(e.target.value, selected.min_weight, selected.max_weight) })),
        h('div', { className: 'ca-muted', 'data-dex-field': 'lora-recipe' }, (() => { const r = this._createLoraRecipe(selected); const x = r && r.recommended || {}; return state.enabled ? 'Effective recipe: ' + (x.steps || this.state.steps) + ' steps · ' + (x.sampler || this.state.sampler) + ' · ' + (x.scheduler || 'engine default') + ' · CFG ' + (x.cfg != null ? x.cfg : this.state.cfg) + ' · ' + selected.route_status + ' (selected automatically)' : 'LoRA off · current settings: ' + this.state.steps + ' steps · ' + this.state.sampler + ' · ' + (this.state.scheduler || 'engine default') + ' · CFG ' + this.state.cfg; })()),
        h('button', { type: 'button', className: 'ca-secondary', disabled: !state.enabled || !selected.use_enabled, onClick: () => { const next = Object.assign({}, this.state.createLora || {}, { overrides: {} }); this._persistCreateLora(next); next.recipeSettings = this._applyCreateLoraRecipe(selected, next.savedSettings || {}, {}); this._persistCreateLora(next); } }, 'Reset to recommended settings')) : h('div', { className: 'ca-muted' }, 'Select an adapter to inspect its validated settings.'));
    return h('div', { className: 'ca-form-actions', 'data-dex-field': 'create-lora-controls', style: { display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 4, alignItems: 'center', minWidth: 0, width: '100%' } }, checkbox, select, advanced, reason);
  };

  P.onGenerate = async function (over, opts) {
    const o = opts || {};
    if (this.state.jobStatus === 'generating' && !o.force) {
      this.toast('A generation is already running — its results will appear here.', '#fbbf24');
      return;
    }
    const body = this._createBody(over);
    if (body.loras && body.loras.length) {
      const loraState = this.state.createLora || {}, lora = this._createLoraOptions().find(x => x.id === loraState.selectedId && x.use_enabled);
      if (lora) {
        const strength = Number(body.loras[0].weight);
        if (!Number.isFinite(strength) || strength < lora.min_weight || strength > lora.max_weight) {
          this.toast('LoRA strength is outside the validated adapter range.', '#ef4444');
          return;
        }
      }
    }
    if (!body.prompt) { this.toast('Enter a prompt first', '#fbbf24'); return; }
    if (body.quantity >= 4) {
      const pf = await this._api('/api/preflight', { target: body.target, prompts: 1, quantity: body.quantity });
      const bad = pf.ok ? pf.data.rows.filter(r => r.state === 'FAIL') : [];
      if (bad.length) { this.toast('Preflight: ' + bad.map(r => r.detail).join('; '), '#ef4444'); return; }
      if (pf.ok && pf.data.needsConfirmation && !window.confirm('Generate ' + pf.data.summary + '?')) return;
    }
    this.wsSet({ lastBody: body, results: [], activeIndex: 0 });
    this.setState({ jobStatus: 'generating', progress: null, jobStage: null, currentImageSrc: null, errorMsg: '', lastGenerationParams: Object.assign({}, body, { preset: this.state.preset }) });
    const second = this._ws().second && this._ws().second.on && !this._ws().hires;
    if (second) { for (const k of Object.keys(body)) if (/^hires_/.test(k)) delete body[k]; delete body.quantity; }
    const r = second ? await this._api('/api/actions/hires-2pass', Object.assign({}, body, { second_pass: this._secondPassBody() }))
      : await this._api('/api/actions/generate-controlled', body);
    if (!r.ok) {
      this.setState({ jobStatus: 'error', errorMsg: r.data.error || 'rejected' });
      this.toast(r.data.error || 'Generate failed', '#ef4444');
      return;
    }
    this.wsSet({ activeJobId: r.data.job_id, results: (r.data.seeds || []).map((seed, i) => ({ index: i, status: 'QUEUED', seed, target: body.target })) });
    this._followCreateJob(r.data.job_id, body);
  };

  P._followCreateJob = function (jobId, body) {
    this._startPoll(jobId, job => this._onCreateDone(job, body), job => this._onCreateTick(job));
  };
  // Progressive results: every cell the backend has already validated and canonicalized (status DONE/FAILED in job.results)
  // is shown immediately; cells still running keep their QUEUED placeholder. Nothing here plays a completion sound.
  P._onCreateTick = function (job) {
    const got = D.jobResults(job); if (!got.length) return;
    const ws = this._ws(), cur = ws.results || [], base = this.state.backendUrl;
    const merged = cur.map((r, i) => got[i] || r);
    for (let i = cur.length; i < got.length; i++) merged.push(got[i]);
    // After a refresh/reattach the placeholders are gone: rebuild them from the job's planned seeds so the batch size stays visible.
    for (let i = merged.length; Array.isArray(job.seeds) && i < job.seeds.length; i++) merged.push({ index: i, status: 'QUEUED', seed: job.seeds[i], target: job.controlledTarget || this.state.target });
    const changed = merged.some((r, i) => !cur[i] || cur[i].status !== r.status || cur[i].imageId !== r.imageId);
    if (!changed) return;
    const firstIdx = merged.findIndex(x => x.status === 'DONE');
    const patch = { results: merged };
    if (firstIdx >= 0 && !(cur.some(x => x.status === 'DONE'))) patch.activeIndex = firstIdx;
    this.wsSet(patch);
    if (firstIdx >= 0 && !this.state.currentImageSrc) this.setState({ currentImageSrc: base + merged[firstIdx].imageUrl, lastSeed: merged[firstIdx].seed });
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
    } else if (String(job.status == null ? '' : job.status).toUpperCase() === 'CANCELLED') {
      this.setState({ jobStatus: 'idle', progress: 0, errorMsg: '' });
      // OP-7: only a verified worker record counts as "stopped"; anything else is said plainly.
      const st = job.remoteStop;
      const msg = st === 'cancelled_verified' ? ' · Big Mac stop verified' : st === 'stop_unverified' || st === 'orphan_suspect' ? ' · unable to verify the Big Mac stop — heavy work paused' : st ? ' · stopping on Big Mac…' : '';
      this.toast('Generation cancelled' + msg, st && st !== 'cancelled_verified' ? '#ef4444' : '#fbbf24');
    } else {
      this.setState({ jobStatus: 'error', progress: 0, errorMsg: this._failText(job) });
      this.toast('Generation failed · ' + (job.firstFailedGate || job.status), '#ef4444');
    }
  };
  // Interrupt the running generation: stops the local process, then verifies the Big Mac process is really gone.
  // T-104/T-202: the server reports acceptance and verification separately; this never turns "asked" into "stopped".
  P.interruptGeneration = async function () {
    const ws = this._ws();
    const id = ws.activeJobId;
    // A job restored from a reload is not cancellable until its state is confirmed.
    if (!id || ws.interrupting) return;
    if (ws.reconciling) { this.toast('Still checking the job that was running before the reload — try again in a moment.', '#fbbf24'); return; }
    this.wsSet({ interrupting: true, interruptState: 'requested', cancelReason: '' });
    const r = await this._api('/api/jobs/' + encodeURIComponent(id) + '/cancel', { reason: 'Cancelled from Create' });
    const d = (r.data && typeof r.data === 'object') ? r.data : {};
    const rs = d.remote_stop;
    const verified = d.terminationVerified === true || rs === 'verified' || rs === 'cancelled_verified' || rs === 'not_started' || rs === 'completed_naturally';
    let state;
    if (d.cancelState === 'refused_unsafe' || d.gate === 'cancel-unsafe' || d.gate === 'cancel-unsupported' || d.gate === 'unknown-job') state = 'refused';
    else if (d.cancelState === 'already_terminal' || rs === 'already_finished') state = 'finished';
    else if (verified) state = 'verified';
    else if (!r.ok && r.status !== 202) state = 'error';
    else state = 'unverified';
    this.wsSet({ interrupting: false, interruptState: state, cancelReason: d.error || '' });
    if (state === 'unverified') this.toast('Stop requested, but it could not be verified — the job stays running and heavy work stays paused until reconciliation (Job Center)', '#ef4444');
    else if (state === 'refused') this.toast(d.error || 'This job cannot be stopped safely from here. It was left running; see the Job Center.', '#ef4444');
    else if (state === 'finished') this.toast('That job had already finished.', '#fbbf24');
    else if (state === 'error') this.toast(d.error || 'Cancel failed', '#ef4444');
    else if (state === 'verified' && rs === 'not_started') this.toast('Cancelled before the worker started it.', '#fbbf24');
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
    if (this.setScreen('create') === false) return false;
    this.onGenerate(over);
    return true;
  };
  P.openSeedLab = function (img) {
    if (this.setScreen('create') === false) return false;
    const ws = this._ws();
    if (img && img.seed != null) this.setState({ seed: String(img.seed) });
    this.wsSet({ seedLab: Object.assign({}, ws.seedLab, { open: true, base: img ? img.seed : null, parent: img ? img.imageId : null }) });
    return true;
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

  // Apply parsed Create settings (from /api/pnginfo) to the Create form. Returns the keys that were applied.
  P.applyCreateSettings = function (st) {
    const patch = {}, ws = this._ws(), applied = [];
    const put = (k, v) => { patch[k] = v; applied.push(k); };
    if (st.target && (this.state.modelTargets || []).some(t => t.id === st.target)) put('target', st.target);
    for (const k of ['prompt', 'negPrompt', 'steps', 'cfg', 'width', 'height', 'scheduler', 'clipSkip', 'eta']) if (st[k] !== undefined) put(k, st[k]);
    if (st.seed !== undefined) put('seed', String(st.seed));
    if (st.sampler) put('sampler', st.sampler);
    this.setState(patch);
    if (st.hires && st.hires.enabled === false) { this.wsSet({ hires: false }); applied.push('hires'); }
    else if (st.hires) {
      const h2 = st.hires, w = { hires: true };
      if (h2.width && h2.height) Object.assign(w, { hiresMode: 'size', hiresW: String(h2.width), hiresH: String(h2.height) }); else if (h2.scale) Object.assign(w, { hiresMode: 'scale', hiresScale: h2.scale });
      if (h2.steps !== undefined) w.hiresSteps = String(h2.steps);
      if (h2.denoise !== undefined) w.hiresDenoise = h2.denoise;
      if (h2.upscaler && D.HIRES_UPSCALERS.includes(h2.upscaler)) w.hiresUpscaler = h2.upscaler;
      this.wsSet(w); applied.push('hires');
    }
    return applied;
  };
  P._confirmCreateDraftReplacement = function () {
    const dirty = this._unsavedWorkspaceWork && this._unsavedWorkspaceWork();
    if (!dirty || dirty.workspace !== 'generate') return true;
    return window.confirm('Replace the unsaved Create prompt with settings from this image? Choose Cancel to keep the current prompt and settings.');
  };
  P.reuseSettings = async function (id) {
    const r = await this._api('/api/pnginfo', { image_id: id });
    if (!r.ok) { this.toast(r.data.error || 'Could not load settings', '#ef4444'); return false; }
    if (!this._confirmCreateDraftReplacement()) return false;
    // Resolve navigation protection before changing prompt/model/operation fields.
    if (this.setScreen('create') === false) return false;
    const applied = this.applyCreateSettings(r.data.create.settings);
    this.setActiveAssetSelection && this.setActiveAssetSelection({ kind: 'image', id });
    const seed = r.data.create.settings.seed;
    this.toast('Restored ' + applied.length + ' settings' + (seed !== undefined ? ' · seed ' + seed : '') + (r.data.create.settings.prompt ? '' : ' · prompt was not saved'), '#38bdf8');
    return true;
  };
  // PNG Info: read A1111 / ComfyUI metadata from any PNG (nothing is stored) and send it to Create.
  P.readPngInfo = async function (file) {
    if (!file) return;
    this.wsSet({ pnginfo: { busy: true, name: file.name, result: null, error: null } });
    try {
      const r = await fetch(this.state.backendUrl + '/api/pnginfo', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: file });
      const data = await r.json().catch(() => ({}));
      this.wsSet({ pnginfo: { busy: false, name: file.name, result: r.ok ? data : null, error: r.ok ? null : (data.error || 'HTTP ' + r.status) } });
    } catch (err) { this.wsSet({ pnginfo: { busy: false, name: file.name, result: null, error: String(err.message || err) } }); }
  };
  P.copyInfotext = async function (text) {
    try { await navigator.clipboard.writeText(text); this.toast('Generation parameters copied', '#65d66e'); } catch (_) { this.toast('Clipboard unavailable', '#fbbf24'); }
  };
  P.buildPngInfoPanel = function () {
    const ws = this._ws(), pi = ws.pnginfo || {}, res = pi.result;
    const tone3 = { restorable: tone.ok, unavailable: tone.warn, unverified: tone.info };
    return h('div', { style: css.panel, 'data-pnginfo-panel': 'true' },
      h('div', { style: css.title }, 'PNG Info'),
      h('div', { style: Object.assign({}, css.muted, { margin: '4px 0 8px' }) }, 'Read generation parameters from any PNG (A1111 "parameters" text). The file is read once and not stored.'),
      h('input', { type: 'file', accept: 'image/png', 'aria-label': 'PNG file to read', 'data-pnginfo-file': 'true', onChange: e => { const f = e.target.files && e.target.files[0]; this.readPngInfo(f); e.target.value = ''; } }),
      pi.busy ? h('div', { style: { color: tone.info, fontSize: 12, marginTop: 6 } }, 'Reading ' + pi.name + '…') : null,
      pi.error ? h('div', { style: { color: tone.bad, fontSize: 12, marginTop: 6 }, 'data-pnginfo-error': 'true' }, pi.error) : null,
      res ? h('div', { style: { display: 'grid', gap: 6, marginTop: 8 }, 'data-pnginfo-result': res.source },
        h('div', { style: { fontWeight: 800, color: res.source === 'a1111' ? tone.ok : tone.warn } }, 'Source: ' + ({ a1111: 'A1111 parameters', comfyui: 'ComfyUI graph', dexdiffusion: 'DexDiffusion library', none: 'no generation metadata' })[res.source] + (res.size ? ' · ' + res.size.width + '×' + res.size.height : '')),
        ...(res.notes || []).map(n => h('div', { key: n, style: css.muted }, n)),
        ...(res.create.warnings || []).map(n => h('div', { key: n, style: { color: tone.warn, fontSize: 12 } }, '⚠ ' + n)),
        res.create.fields.length ? h('div', { style: { display: 'grid', gap: 2 } }, ...res.create.fields.map(f => h('div', { key: f.key, 'data-pnginfo-field': f.key, 'data-state': f.state, style: { display: 'grid', gridTemplateColumns: '130px minmax(0,1fr)', gap: 8, fontSize: 12, padding: '2px 0', borderBottom: '1px solid rgba(148,163,184,.08)' } },
          h('span', { style: { color: tone3[f.state], fontWeight: 700 } }, f.key),
          h('span', { style: { color: '#cbd5e1', overflowWrap: 'anywhere' } }, String(f.value).slice(0, 300), (f.reason || f.note) ? h('span', { style: css.muted }, '  — ' + (f.reason || f.note)) : null)))) : null,
        res.create.fields.length ? h('div', { style: css.row },
          btn('Send to Create', () => { if (!this._confirmCreateDraftReplacement() || this.setScreen('create') === false) return; const a = this.applyCreateSettings(res.create.settings); this.toast('Restored ' + a.length + ' settings', '#38bdf8'); }, '#65d66e'),
          btn('Copy infotext', () => this.copyInfotext(res.infotext), '#94a3b8')) : null) : null);
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
    if (this.setScreen('library') === false) return false;
    this.selectLibraryImage(id);
    return true;
  };
  // Library-origin sources can be older than the recent-run list. Retain exactly
  // the selected canonical image ID through 3D / World navigation.
  P.useLibrarySource = function (id, destination) {
    const SA = window.DexSourceAsset;
    if (!SA || !SA.isImageId(id) || !['3d', 'world'].includes(destination)) {
      this.toast('Choose a published Library image first.', '#fbbf24');
      return false;
    }
    if (this.setScreen(destination) === false) return false;
    this.setActiveAssetSelection({ kind: 'image', id });
    this.setState(destination === '3d'
      ? { asset3dSourceArtifact: id, asset3dPreviewFailedId: '' }
      : { worldSourceArtifact: id });
    return true;
  };

  // Edit (img2img / inpaint / outpaint) lives in edit-ui.js: one authoritative openImageInEdit,
  // one operation state, one Run control.

  // ── Enhance ─────────────────────────────────────────────────────
  P.sendToEnhance = async function (id) {
    // G3: the Enhance handoff names one canonical image; a missing or malformed
    // id is refused rather than silently replaced by the newest result.
    const SA = window.DexSourceAsset;
    if (SA && !SA.isImageId(String(id == null ? '' : id))) {
      this.toast(SA.MESSAGES['not-canonical'], '#fbbf24'); return false;
    }
    const m = await this._imageMeta(id);
    if (!m) return false;
    if (this.setScreen('enhance') === false) return false;
    this.wsSet({ enhSourceId: id, enhSource: m });
    this.setActiveAssetSelection && this.setActiveAssetSelection({ kind: 'image', id: m.id || id });
    return true;
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
  // A1111 Extras: scale-by / scale-to (+crop), upscaler 1 and 2 with visibility. Face restoration is shown as unavailable.
  P._extrasCard = function (src) {
    const X = window.DexExtras, ex = this._ws().extras;
    const setEx = patch => this.wsSet({ extras: Object.assign({}, this._ws().extras, patch) });
    const lbl = (t, el) => h('label', { style: { display: 'grid', gap: 3, fontSize: 12, color: '#cbd5e1' } }, t, el);
    const num = (key, t, attrs) => lbl(t, h('input', Object.assign({ type: 'number', value: String(ex[key]), style: css.input, 'data-extras-field': key, onChange: e => setEx({ [key]: e.target.value }) }, attrs)));
    // Upscaler 1 has no "None": in A1111 that makes the whole upscale a no-op (upscaler 2 and crop are skipped too).
    const sel = (key, t, list) => lbl(t, h('select', { value: ex[key], style: css.input, 'data-extras-field': key, 'aria-label': t, onChange: e => setEx({ [key]: e.target.value }) },
      ...(list || X.UPSCALERS).map(u => h('option', { value: u }, u === 'none' ? 'None' : u[0].toUpperCase() + u.slice(1)))));
    const chk = X.normalizeExtras(ex);
    const plan = chk.options ? X.plan(src.width, src.height, chk.options) : null;
    const tooBig = chk.options ? X.validateForSource(src.width, src.height, chk.options) : null;
    const err = chk.error || tooBig;
    return h('div', { 'data-extras-card': 'true', style: { border: '1px solid rgba(148,163,184,.14)', borderRadius: 8, padding: 10, display: 'grid', gap: 6, gridColumn: '1 / -1' } },
      h('div', { style: { fontWeight: 800, color: '#e2e8f0', fontSize: 13 } }, 'Extras · scale, crop and blend'),
      h('div', { style: css.muted }, 'A1111 Extras resize: deterministic Pillow resampling on the MacBook. Adds no detail.'),
      h('div', { style: css.row },
        lbl('Resize', h('select', { value: ex.mode, style: css.input, 'data-extras-field': 'mode', 'aria-label': 'Extras resize mode', onChange: e => setEx({ mode: e.target.value }) }, h('option', { value: 'by' }, 'Scale by'), h('option', { value: 'to' }, 'Scale to size'))),
        ex.mode === 'by' ? [num('scale', 'Factor (1–8)', { min: '1', max: '8', step: '0.25' }), num('max_side', 'Max side length (0 = no limit)', { min: '0', max: '4096', step: '8' })] : [num('width', 'Width', { min: '64', max: '4096', step: '8' }), num('height', 'Height', { min: '64', max: '4096', step: '8' }),
          lbl('Crop to fit', h('input', { type: 'checkbox', checked: !!ex.crop, 'data-extras-field': 'crop', 'aria-label': 'Crop to fit', onChange: e => setEx({ crop: e.target.checked }) }))]),
      h('div', { style: css.row }, sel('upscaler', 'Upscaler 1', X.UPSCALERS.filter(u => u !== 'none')), sel('upscaler2', 'Upscaler 2'),
        ex.upscaler2 !== 'none' ? num('visibility', 'Upscaler 2 visibility (0–1)', { min: '0', max: '1', step: '0.05' }) : null),
      h('div', { style: css.muted, 'data-extras-field': 'face-note' }, 'GFPGAN / CodeFormer face restoration and model upscalers other than Real-ESRGAN are not available: no weights or PyTorch runtime are installed.'),
      h('div', { style: css.mono, 'data-extras-field': 'preview' }, err ? err : ('method: extras · ' + src.width + '×' + src.height + ' → ' + plan.out.w + '×' + plan.out.h + (plan.limited ? ' (limited by max side length)' : ''))),
      btn('Run Extras', () => { if (!err) this._runEnhance('/api/actions/upscale', { image_id: src.id, extras: chk.options }, 'Extras'); }, err ? '#64748b' : '#f59e0b'));
  };
  // FLUX.2 Klein reference editing (MFLUX): the image + a prompt -> a new image that keeps the scene. Not ControlNet.
  P._refEditCard = function (src) {
    const re = this._ws().refEdit, setRe = patch => this.wsSet({ refEdit: Object.assign({}, this._ws().refEdit, patch) });
    const fit = v => Math.min(1536, Math.max(256, Math.round(v / 16) * 16));
    const w = fit(src.width), hgt = fit(src.height);
    const steps = Number(re.steps), okSteps = Number.isInteger(steps) && steps >= 1 && steps <= 8, okPrompt = String(re.prompt || '').trim().length > 0;
    const seedStr = String(re.seed).trim(), okSeed = seedStr === '' || /^-?\d+$/.test(seedStr);
    const run = () => { if (okSteps && okPrompt && okSeed) this._runEnhance('/api/actions/flux2-edit', { image_id: src.id, prompt: re.prompt, steps, seed: seedStr === '' ? -1 : Number(seedStr), save_prompts: !!this.state.savePrompts }, 'FLUX.2 reference edit'); };
    return h('div', { 'data-refedit-card': 'true', style: { border: '1px solid rgba(148,163,184,.14)', borderRadius: 8, padding: 10, display: 'grid', gap: 6, gridColumn: '1 / -1' } },
      h('div', { style: { fontWeight: 800, color: '#e2e8f0', fontSize: 13 } }, 'Reference edit · FLUX.2 Klein'),
      h('div', { style: css.muted }, 'Describe the change; the model keeps the scene of this image and applies it (MFLUX on Big Mac, ~1 min). This is reference editing, not ControlNet: no control weight, preprocessors or start/end fractions.'),
      h('textarea', { rows: 2, value: re.prompt, placeholder: 'e.g. the same fox, but with bright blue fur', style: Object.assign({}, css.input, { resize: 'vertical' }), 'data-refedit-field': 'prompt', 'aria-label': 'Reference edit prompt', onChange: e => setRe({ prompt: e.target.value }) }),
      h('div', { style: css.row },
        h('label', { style: { display: 'grid', gap: 3, fontSize: 12, color: '#cbd5e1' } }, 'Steps (1–8)', h('input', { type: 'text', inputMode: 'numeric', value: String(re.steps), style: css.input, 'data-refedit-field': 'steps', onChange: e => setRe({ steps: e.target.value }) })),
        h('label', { style: { display: 'grid', gap: 3, fontSize: 12, color: '#cbd5e1' } }, 'Seed (-1 random)', h('input', { type: 'text', inputMode: 'numeric', value: String(re.seed), style: css.input, 'data-refedit-field': 'seed', onChange: e => setRe({ seed: e.target.value }) }))),
      h('div', { style: css.mono, 'data-refedit-field': 'preview' }, 'method: FLUX.2 reference edit · ' + src.width + '×' + src.height + ' → ' + w + '×' + hgt + (okSteps ? '' : ' · steps must be 1–8') + (okSeed ? '' : ' · seed must be a whole number') + (okPrompt ? '' : ' · describe the edit')),
      btn('Run reference edit', run, okSteps && okPrompt && okSeed ? '#f59e0b' : '#64748b'));
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
        this._extrasCard(src),
        this._refEditCard(src),
        card('Real-ESRGAN x4', 'AI super-resolution (RealESRGAN_x4plus on Big Mac)', 'Model-based upscaling; sharpens and invents fine texture.', (src.width * 4) + '×' + (src.height * 4),
          this._gate('realEsrgan') ? btn('Run Real-ESRGAN', () => this._runEnhance('/api/actions/upscale-esrgan', { image_id: src.id }, 'Real-ESRGAN'), '#f59e0b') : h('div', { style: css.muted }, 'Unavailable (gate closed).'), this._gate('realEsrgan')),
        card('High-Res Refine', 'diffusion second pass (sd-cli --hires, SDCPP)', 'A generation-time second pass: it re-renders the image at higher resolution with denoising. It needs the original prompt and seed, so it runs from Create.', '×1.1–2.0',
          btn('Set up in Create', async () => { if (await this.reuseSettings(src.id)) this.wsSet({ hires: true }); }, '#f59e0b'), this._gate('hiresRefine'))),
      ws.enhStatus === 'running' ? h('div', { style: { color: tone.info, fontSize: 12, marginTop: 8 } }, (ws.enhMethodRunning || 'Enhance') + ' running…') : null,
      ws.enhStatus === 'error' ? h('div', { style: { color: tone.bad, fontSize: 12, marginTop: 8 } }, ws.enhError || 'failed') : null,
      ws.enhResults.length ? h('div', { style: { marginTop: 10, display: 'grid', gap: 8 } },
        ...ws.enhResults.slice(0, 4).map(r => h('div', { key: r.imageId, style: { display: 'grid', gridTemplateColumns: 'minmax(90px,140px) 1fr', gap: 10 } },
          thumb(base + r.imageUrl, false, () => openFull(this, r.imageId, base + r.imageUrl), r.imageId, r.method + ' · ' + r.width + '×' + r.height),
          h('div', { style: css.row },
            btn('Compare', () => { if (this.setScreen('library') === false) return; this.wsSet({ compareIds: [src.id, r.imageId] }); this.loadCompare(); }, '#38bdf8'),
            this._gate('img2img') ? btn('Img2Img', () => this.sendToEdit(r.imageId, 'img2img'), '#a78bfa') : null,
            this._gate('inpaint') ? btn('Inpaint', () => this.sendToEdit(r.imageId, 'inpaint'), '#a78bfa') : null,
            btn('Use as Source', () => this.sendToEnhance(r.imageId), '#f59e0b'),
            btn('Fullscreen', () => openFull(this, r.imageId, base + r.imageUrl), '#94a3b8'))))) : null);
  };

  // ── Library: images, lineage, keepers, compare ──────────────────
  // Library browsing preferences (view/rows/columns/density/sort) are non-sensitive and live in localStorage.
  const LIB_PREF_KEY = 'dexdiffusion.library.prefs.v1';
  const libDefaults = { view: 'grid', rows: 4, cols: 0, density: 'comfortable', sort: 'desc' };
  D.loadLibPrefs = function () {
    try { const p = JSON.parse(localStorage.getItem(LIB_PREF_KEY) || '{}') || {}; return D.cleanLibPrefs(p); } catch (_) { return D.cleanLibPrefs({}); }
  };
  D.cleanLibPrefs = function (p) {
    const n = (v, lo, hi, d) => { v = parseInt(v, 10); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
    return { view: p.view === 'list' ? 'list' : 'grid', rows: n(p.rows, 1, 50, libDefaults.rows), cols: n(p.cols, 0, 12, libDefaults.cols),
      density: ['compact', 'comfortable', 'large'].includes(p.density) ? p.density : libDefaults.density, sort: p.sort === 'asc' ? 'asc' : 'desc' };
  };
  const LIB_MIN = { compact: 72, comfortable: 108, large: 160 };
  // Columns are clamped to what the viewport can hold at the chosen density; the effective value is shown to the user.
  P._libLayout = function (lib) {
    // Prefer the measured width of the real grid container; fall back to a viewport estimate before first paint.
    const vw = (typeof window !== 'undefined' && window.innerWidth) || 1024, avail = this._libWidth > 0 ? this._libWidth : Math.max(120, Math.min(vw, 1400) - 56), min = LIB_MIN[lib.density] || 108;
    const fit = Math.max(1, Math.floor((avail + 6) / (min + 6)));
    const cols = lib.view === 'list' ? 1 : (lib.cols > 0 ? Math.min(lib.cols, fit) : fit);
    return { cols, fit, clamped: lib.view === 'grid' && lib.cols > 0 && lib.cols > fit, pageSize: Math.max(1, (lib.view === 'list' ? 1 : cols) * lib.rows) };
  };
  // Called from a ref on the grid/list container: when the usable width changes the effective column count (and so the page size) is recomputed.
  P._libMeasure = function (w) {
    if (!(w > 0) || Math.abs(w - (this._libWidth || 0)) <= 8) return;
    const before = this._libLayout(this._ws().lib); this._libWidth = w;
    const after = this._libLayout(this._ws().lib);
    if (before.pageSize === after.pageSize && before.cols === after.cols) return;
    clearTimeout(this._libMeasureT); this._libMeasureT = setTimeout(() => this.loadLibraryImages(), 120);
  };
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function' && !window.__dexLibResize) {
    window.__dexLibResize = true;
    window.addEventListener('resize', () => { const app = window.__dex; if (!app || !app._ws || !app._ws().lib) return; clearTimeout(app._libResizeT); app._libResizeT = setTimeout(() => {
      const el = document.querySelector('[data-lib-grid],[data-lib-list]'); if (el) app._libMeasure(el.clientWidth); }, 150); });
  }
  P.setLibPrefs = function (patch) {
    const lib = Object.assign({}, this._ws().lib, patch), prefs = D.cleanLibPrefs(lib);
    try { localStorage.setItem(LIB_PREF_KEY, JSON.stringify(prefs)); } catch (_) {}
    Object.assign(lib, prefs);
    // Layout changes never reset each other; only a page-size change re-pages from the same first item.
    this.wsSet({ lib });
    if ('rows' in patch || 'cols' in patch || 'view' in patch || 'sort' in patch) this.loadLibraryImages(undefined, 'offset' in patch ? patch.offset : this._ws().lib.offset);
  };
  P.loadLibraryImages = async function (filter, offset) {
    const ws = this._ws(), f = filter || ws.lib.filter, lay = this._libLayout(ws.lib);
    const off = filter && filter !== ws.lib.filter ? 0 : Math.max(0, offset == null ? ws.lib.offset : offset);
    this.wsSet({ lib: Object.assign({}, ws.lib, { filter: f, loading: true, offset: off, error: null }) });
    const r = await this._api('/api/library/images?filter=' + encodeURIComponent(f) + '&sort=' + ws.lib.sort + '&limit=' + lay.pageSize + '&offset=' + off, undefined);
    // A malformed 200 (no items array) used to store `undefined` and crash the next render.
    const items = r.ok && r.data && Array.isArray(r.data.items) ? r.data.items : [];
    const total = r.ok && r.data && Number.isFinite(r.data.total) ? r.data.total : items.length;
    const malformed = r.ok && !(r.data && Array.isArray(r.data.items));
    this.wsSet({ lib: Object.assign({}, this._ws().lib, { items, total, loading: false,
      error: !r.ok ? 'Could not load the Library' : malformed ? 'The Library returned an unexpected response, so no images are shown.' : null }) });
  };
  // Full-size viewer over the ACTIVE (filtered + sorted) collection, not just the visible page.
  P.openLibraryViewer = async function (id) {
    const ws = this._ws(), base = this.state.backendUrl;
    let items = ws.lib.items, index = items.findIndex(x => x.id === id);
    const r = await this._api('/api/library/images?filter=' + encodeURIComponent(ws.lib.filter) + '&sort=' + ws.lib.sort + '&limit=500&offset=0', undefined);
    if (r.ok && r.data.items.some(x => x.id === id)) { items = r.data.items; index = items.findIndex(x => x.id === id); }
    if (index < 0) return;
    const self = this, esc = s => (window.CSS && CSS.escape ? CSS.escape(s) : s);
    // Any app re-render (e.g. the 3 s resource poll) rebuilds the Library DOM, detaching the thumbnail that opened the
    // viewer; return focus to the live thumbnail for the same image instead of the detached node (which leaves focus on body).
    const opener = () => document.querySelector('[data-lib-thumb="' + esc(id) + '"] [aria-label="' + esc('Open ' + id + ' full size') + '"]');
    window.DexLightbox.open({
      collection: { index, items: items.map(it => ({ id: it.id, src: base + it.url, caption: it.id, downloadUrl: base + (it.downloadUrl || '/api/images/' + encodeURIComponent(it.id) + '/export'), downloadName: it.id })),
        actionsFor: iid => (self.lightboxActions ? self.lightboxActions(iid) : []), onIndex: (i, c) => { self._libLastViewed = c.id; } },
      onClose: () => { const back = opener(); if (back) { try { back.focus({ preventScroll: true }); } catch (_) {} }
        const last = self._libLastViewed; if (!last) return; setTimeout(() => { const el = document.querySelector('[data-lib-thumb="' + esc(last) + '"] img'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' }); }, 0); },
    });
  };
  P.selectLibraryImage = async function (id) {
    const m = await this._imageMeta(id);
    // A partial record must not be trusted: `ancestors`/`children` used to be assumed
    // present, and one malformed /api/images/:id/meta response crashed the whole render.
    if (!m || typeof m !== 'object' || !(m.id || id) || !m.url) {
      this.toast('That image record is incomplete, so it was not opened. Refresh the Library and try again.', '#fbbf24');
      return false;
    }
    const rec = Object.assign({}, m, {
      id: m.id || id,
      ancestors: Array.isArray(m.ancestors) ? m.ancestors : [],
      children: Array.isArray(m.children) ? m.children : []
    });
    this.wsSet({ lib: Object.assign({}, this._ws().lib, { selectedId: id, selected: rec }) });
    this.setActiveAssetSelection && this.setActiveAssetSelection({ kind: 'image', id: rec.id });
    return true;
  };
  // Library thumbnail: click = fullscreen (with Edit actions in the viewer); the corner "ⓘ" selects it for details/lineage.
  P._libThumb = function (it, selected) {
    const base = this.state.backendUrl, id = it.id || it.artifact_id, url = base + it.url;
    return h('div', { key: id, 'data-lib-thumb': id, style: { position: 'relative', border: '2px solid ' + (selected ? '#38bdf8' : 'rgba(148,163,184,.16)'), borderRadius: 8, overflow: 'hidden', background: '#0a0e14', aspectRatio: '1 / 1' } },
      h('img', { src: url, alt: id, loading: 'lazy', tabIndex: 0, 'data-fullscreen': 'only', 'data-fullscreen-image-id': id, 'data-fullscreen-caption': id, style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block', cursor: 'zoom-in' } }),
      h('button', { type: 'button', 'aria-label': 'Select ' + id + ' for details', title: 'Details, lineage and actions', onClick: () => this.selectLibraryImage(id),
        style: { position: 'absolute', top: 4, right: 4, minWidth: 30, minHeight: 30, borderRadius: 15, border: '1px solid rgba(148,163,184,.5)', background: 'rgba(4,8,14,.85)', color: '#e2e8f0', cursor: 'pointer', fontSize: 14 } }, 'ⓘ'),
      h('div', { style: { position: 'absolute', left: 0, right: 0, bottom: 0, background: 'rgba(4,8,14,.78)', color: '#dbe4ee', fontSize: 10, padding: '3px 5px', pointerEvents: 'none', fontFamily: "'IBM Plex Mono',monospace" } },
        (it.keeper ? '★ ' : '') + ((it.meta && it.meta.operation) || it.operation || '') + (it.meta && it.meta.seed != null ? ' ' + it.meta.seed : '')));
  };
  // MT-07/13/14/15/16 export: PNG / JPEG / WebP copies (canonical files untouched), A1111 filename pattern, optional
  // infotext + sidecar .txt, one ZIP for several images. Prompt text is included only when prompt saving is on.
  P.runExport = async function (ids) {
    const ws = this._ws(), ex = ws.exportOpts || (ws.exportOpts = { format: 'png', quality: 90, metadata: 'infotext', pattern: '[basename]', sidecar: false });
    if (!ids.length) return;
    this.wsSet({ exportBusy: true });
    try {
      const r = await fetch(this.state.backendUrl + '/api/images/export', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, format: ex.format, quality: Number(ex.quality), metadata: ex.metadata, pattern: ex.pattern, sidecar: !!ex.sidecar, zip: ids.length > 1, save_prompts: !!this.state.savePrompts }) });
      if (!r.ok) { this.toast((await r.json().catch(() => ({}))).error || 'Export failed', '#ef4444'); return; }
      const name = (/filename="([^"]+)"/.exec(r.headers.get('Content-Disposition') || '') || [])[1] || 'export';
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement('a'); a.href = url; a.download = name; a.setAttribute('data-export-download', name); document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      this.toast('Exported ' + name + (r.headers.get('X-Dex-Prompt-Included') === '1' ? ' (with prompts)' : ' (settings only, no prompt text)'), '#65d66e');
    } finally { this.wsSet({ exportBusy: false }); }
  };
  P.buildExportPanel = function (ids) {
    const ws = this._ws(), ex = ws.exportOpts || (ws.exportOpts = { format: 'png', quality: 90, metadata: 'infotext', pattern: '[basename]', sidecar: false });
    const set = patch => this.wsSet({ exportOpts: Object.assign({}, this._ws().exportOpts, patch) });
    const lbl = (t, el) => h('label', { style: { display: 'grid', gap: 3, fontSize: 12, color: '#cbd5e1' } }, t, el);
    return h('div', { 'data-export-panel': 'true', style: Object.assign({}, css.row, { alignItems: 'end' }) },
      lbl('Format', h('select', { value: ex.format, style: css.input, 'data-export-field': 'format', 'aria-label': 'Export format', onChange: e => set({ format: e.target.value }) }, h('option', { value: 'png' }, 'PNG'), h('option', { value: 'jpeg' }, 'JPEG'), h('option', { value: 'webp' }, 'WebP'))),
      ex.format !== 'png' ? lbl('Quality (1–100)', h('input', { type: 'number', min: '1', max: '100', value: String(ex.quality), style: Object.assign({}, css.input, { width: 70 }), 'data-export-field': 'quality', onChange: e => set({ quality: e.target.value }) })) : null,
      lbl('Metadata', h('select', { value: ex.metadata, style: css.input, 'data-export-field': 'metadata', 'aria-label': 'Embedded metadata', onChange: e => set({ metadata: e.target.value }) }, h('option', { value: 'infotext' }, 'A1111 parameters'), h('option', { value: 'none' }, 'None'))),
      lbl('Filename pattern', h('input', { value: ex.pattern, style: Object.assign({}, css.input, { width: 180 }), 'data-export-field': 'pattern', 'aria-label': 'Filename pattern, e.g. [seed]-[steps]', onChange: e => set({ pattern: e.target.value }) })),
      h('label', { style: Object.assign({}, css.row, { fontSize: 12, color: '#cbd5e1' }) }, h('input', { type: 'checkbox', checked: !!ex.sidecar, 'data-export-field': 'sidecar', onChange: e => set({ sidecar: e.target.checked }) }), 'Sidecar .txt'),
      btn(ws.exportBusy ? 'Exporting…' : (ids.length > 1 ? 'Export ' + ids.length + ' as ZIP' : 'Export copy'), () => this.runExport(ids), '#65d66e', { disabled: !!ws.exportBusy, 'data-export-run': String(ids.length) }));
  };
  // ── Library controls, grid/list, pager ───────────────────────────
  P.buildLibraryControls = function () {
    const lib = this._ws().lib, lay = this._libLayout(lib), set = p => this.setLibPrefs(p);
    const sel = (label, key, opts, val, onChange) => h('label', { style: { display: 'grid', gap: 2, fontSize: 11, color: '#94a3b8' } }, label,
      h('select', { value: String(val), 'aria-label': label, 'data-lib-control': key, style: Object.assign({}, css.input, { minHeight: 34 }), onChange: e => onChange(e.target.value) },
        ...opts.map(([v, l]) => h('option', { key: v, value: String(v) }, l))));
    const rowOpts = [1, 2, 3, 4, 5, 6, 8, 10, 15, 20, 30, 50].map(n => [n, String(n)]);
    const colOpts = [[0, 'Auto'], ...[1, 2, 3, 4, 5, 6, 8, 10, 12].map(n => [n, String(n)])];
    return h('div', { 'data-lib-controls': 'true', style: Object.assign({}, css.row, { marginBottom: 8, alignItems: 'end' }) },
      h('div', { role: 'group', 'aria-label': 'View mode', style: css.row },
        btn('Grid', () => set({ view: 'grid' }), lib.view === 'grid' ? '#38bdf8' : '#94a3b8', { 'aria-pressed': String(lib.view === 'grid'), 'data-lib-view': 'grid' }),
        btn('List', () => set({ view: 'list' }), lib.view === 'list' ? '#38bdf8' : '#94a3b8', { 'aria-pressed': String(lib.view === 'list'), 'data-lib-view': 'list' })),
      sel('Rows', 'rows', rowOpts, lib.rows, v => set({ rows: v, offset: 0 })),
      lib.view === 'grid' ? sel('Columns', 'cols', colOpts, lib.cols, v => set({ cols: v })) : null,
      sel('Density', 'density', [['compact', 'Compact'], ['comfortable', 'Comfortable'], ['large', 'Large']], lib.density, v => set({ density: v })),
      sel('Sort', 'sort', [['desc', 'Newest first'], ['asc', 'Oldest first']], lib.sort, v => set({ sort: v, offset: 0 })),
      lib.view === 'grid' ? h('span', { 'data-lib-effective': lay.cols + 'x' + lib.rows, style: css.muted }, lay.cols + ' × ' + lib.rows + (lay.clamped ? ' (limited by screen width)' : '')) : null);
  };
  P.buildLibraryItems = function () {
    const lib = this._ws().lib, base = this.state.backendUrl, lay = this._libLayout(lib), min = LIB_MIN[lib.density] || 108;
    if (lib.view === 'list') {
      return h('div', { role: 'list', 'data-lib-list': 'true', ref: el => { if (el) this._libMeasure(el.clientWidth); }, style: { display: 'grid', gap: 4 } }, ...lib.items.map(it => {
        const m = it.meta || {}, sel = lib.selectedId === it.id;
        return h('div', { key: it.id, role: 'listitem', 'data-lib-thumb': it.id, style: { display: 'grid', gridTemplateColumns: 'auto minmax(0,1fr) auto', gap: 10, alignItems: 'center', padding: 4, border: '1px solid ' + (sel ? '#38bdf8' : 'rgba(148,163,184,.14)'), borderRadius: 8 } },
          h('button', { type: 'button', 'aria-label': 'Open ' + it.id + ' full size', onClick: () => this.openLibraryViewer(it.id), style: { padding: 0, border: 0, background: '#0a0e14', borderRadius: 6, cursor: 'zoom-in', width: min * 0.7, height: min * 0.7, overflow: 'hidden' } },
            h('img', { src: base + (it.thumbnailUrl || it.url), alt: '', loading: 'lazy', decoding: 'async', style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' } })),
          h('div', { style: { minWidth: 0 } }, h('div', { style: Object.assign({}, css.mono, { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }) }, (it.keeper ? '★ ' : '') + it.id),
            h('div', { style: css.muted }, [it.width && it.height ? it.width + '×' + it.height : null, m.operation, m.target, m.seed != null ? 'seed ' + m.seed : null].filter(Boolean).join(' · '))),
          h('div', { style: css.row }, btn('Details', () => this.selectLibraryImage(it.id), '#94a3b8'),
            h('a', { href: base + (it.downloadUrl || '/api/images/' + encodeURIComponent(it.id) + '/export'), download: it.id, 'data-lib-download': it.id, style: { color: '#7dd3fc', fontSize: 12, fontWeight: 700, padding: '8px 6px' } }, 'Download')));
      }));
    }
    return h('div', { 'data-lib-grid': 'true', ref: el => { if (el) this._libMeasure(el.clientWidth); }, style: { display: 'grid', gridTemplateColumns: 'repeat(' + lay.cols + ',minmax(0,1fr))', gap: 6 } }, ...lib.items.map(it => {
      const m = it.meta || {}, sel = lib.selectedId === it.id;
      return h('div', { key: it.id, 'data-lib-thumb': it.id, style: { position: 'relative', border: '2px solid ' + (sel ? '#38bdf8' : 'rgba(148,163,184,.16)'), borderRadius: 8, overflow: 'hidden', background: '#0a0e14', aspectRatio: '1 / 1' } },
        h('img', { src: base + (it.thumbnailUrl || it.url), alt: it.id, loading: 'lazy', decoding: 'async', tabIndex: 0, role: 'button', 'aria-label': 'Open ' + it.id + ' full size',
          onClick: () => this.openLibraryViewer(it.id), onKeyDown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.openLibraryViewer(it.id); } },
          style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block', cursor: 'zoom-in' } }),
        h('button', { type: 'button', 'aria-label': 'Select ' + it.id + ' for details', title: 'Details, lineage and actions', onClick: () => this.selectLibraryImage(it.id),
          style: { position: 'absolute', top: 3, right: 3, minWidth: lib.density === 'compact' ? 24 : 30, minHeight: lib.density === 'compact' ? 24 : 30, padding: 0, borderRadius: 15, border: '1px solid rgba(148,163,184,.5)', background: 'rgba(4,8,14,.85)', color: '#e2e8f0', cursor: 'pointer', fontSize: 13 } }, 'ⓘ'),
        lib.density !== 'compact' ? h('div', { style: { position: 'absolute', left: 0, right: 0, bottom: 0, background: 'rgba(4,8,14,.78)', color: '#dbe4ee', fontSize: 10, padding: '3px 5px', pointerEvents: 'none', fontFamily: "'IBM Plex Mono',monospace", overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' } },
          (it.keeper ? '★ ' : '') + (m.operation || '') + (m.seed != null ? ' ' + m.seed : '')) : null);
    }));
  };
  P.buildLibraryPager = function () {
    const lib = this._ws().lib, lay = this._libLayout(lib), size = lay.pageSize, from = lib.total ? lib.offset + 1 : 0, to = Math.min(lib.total, lib.offset + lib.items.length);
    const go = off => this.loadLibraryImages(undefined, off);
    return h('div', { 'data-lib-pager': 'true', style: Object.assign({}, css.row, { marginTop: 8 }) },
      btn('◀ Previous page', () => go(Math.max(0, lib.offset - size)), '#94a3b8', { disabled: lib.offset <= 0 || lib.loading, 'data-lib-page': 'prev' }),
      h('span', { 'data-lib-range': from + '-' + to + '/' + lib.total, 'aria-live': 'polite', style: css.muted }, 'Showing ' + from + '–' + to + ' of ' + lib.total),
      btn('Next page ▶', () => go(lib.offset + size), '#94a3b8', { disabled: lib.offset + lib.items.length >= lib.total || lib.loading, 'data-lib-page': 'next' }));
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
        h('div', { style: css.muted, 'data-library-generation-metadata': sel.id }, [
          sel.meta.target ? 'checkpoint ' + sel.meta.target : null,
          Array.isArray(sel.meta.loras) && sel.meta.loras.length ? 'LoRA ' + sel.meta.loras.map(l => `${l.name || 'adapter'}${l.weight != null ? ' ' + l.weight : ''}`).join(', ') : 'LoRA none recorded',
          sel.meta.seed != null ? 'seed ' + sel.meta.seed : null,
          sel.meta.steps != null ? sel.meta.steps + ' steps' : null,
          sel.meta.sampler ? 'sampler ' + sel.meta.sampler : null,
          sel.meta.cfg != null ? 'CFG ' + sel.meta.cfg : null,
          sel.meta.backend ? 'backend ' + sel.meta.backend : null,
          Number.isFinite(Number(sel.meta.generation_seconds)) ? Number(sel.meta.generation_seconds) + ' s generation' : null,
        ].filter(Boolean).join(' · ') || 'generation parameters not recorded'),
        h('div', { style: Object.assign({}, css.row, { flexWrap: 'wrap' }), 'data-library-primary-actions': sel.id },
          this._gate('img2img') ? btn('Edit', () => this.sendToEdit(sel.id, 'img2img'), '#a78bfa') : null,
          btn('Enhance', () => this.sendToEnhance(sel.id), '#f59e0b'),
          btn('Use for 3D', () => this.useLibrarySource(sel.id, '3d'), '#38bdf8'),
          btn('Use for World', () => this.useLibrarySource(sel.id, 'world'), '#38bdf8'),
          h('a', { href: base + '/api/images/' + encodeURIComponent(sel.id) + '/export', download: sel.id,
            'aria-label': 'Download selected image', style: { padding: '8px 9px', color: '#7dd3fc', fontSize: 12, fontWeight: 700 } }, 'Download')),
        h('details', { style: { border: '1px solid rgba(148,163,184,.17)', borderRadius: 8, padding: '8px 10px' } },
          h('summary', { style: { cursor: 'pointer', color: '#cbd5e1', fontSize: 12 } }, 'More image actions'),
          h('div', { style: Object.assign({}, css.row, { marginTop: 8, flexWrap: 'wrap' }) }, ...this.imageActions(selView))),
        h('div', { style: css.row, 'data-export-actions': 'true' },
          btn('Copy infotext', async () => { const r = await fetch(base + '/api/images/' + encodeURIComponent(sel.id) + '/infotext'); if (r.ok) this.copyInfotext(await r.text()); else this.toast((await r.json().catch(() => ({}))).error || 'No recorded settings', '#fbbf24'); }, '#94a3b8'),
          h('a', { href: base + '/api/images/' + encodeURIComponent(sel.id) + '/export?metadata=1', download: sel.id, 'data-export-link': 'metadata', style: { color: '#94a3b8', fontSize: 12, textDecoration: 'underline', padding: '6px 8px' } }, 'Export PNG with parameters'),
          h('a', { href: base + '/api/images/' + encodeURIComponent(sel.id) + '/export', download: sel.id, 'data-export-link': 'plain', style: { color: '#94a3b8', fontSize: 12, textDecoration: 'underline', padding: '6px 8px' } }, 'Export plain PNG')),
        this.buildExportPanel([sel.id]),
        h('div', { style: css.row }, h('span', { style: css.label }, 'Lineage'),
          (sel.ancestors || []).length ? lineageChip(sel.ancestors[sel.ancestors.length - 1], '⇤ Original') : null,
          sel.parent ? lineageChip(sel.parent, '↑ Parent') : h('span', { style: css.muted }, 'no parent'),
          ...(sel.children || []).map((c, i) => lineageChip(c, '↓ Child ' + (i + 1))),
          sel.parent ? btn('Compare with parent', () => { this.wsSet({ compareIds: [sel.parent, sel.id] }); this.loadCompare(); }, '#38bdf8') : null))) : null;
    return h('div', null,
      this.buildPngInfoPanel(),
      h('div', { style: css.panel },
        h('div', { style: Object.assign({}, css.row, { marginBottom: 8 }) }, h('div', { style: css.title }, 'Images'), h('span', { style: css.muted }, lib.loading ? 'loading…' : lib.total + ' images'), h('div', { style: { flex: 1 } }), lib.items.length > 1 ? btn('Save all shown (' + lib.items.length + ') as ZIP', () => this.runExport(lib.items.map(it => it.id)), '#94a3b8', { 'data-export-all': String(lib.items.length), disabled: !!ws.exportBusy }) : null, btn('Refresh', () => this.loadLibraryImages(), '#94a3b8')),
        h('div', { style: Object.assign({}, css.row, { marginBottom: 8 }) }, ...filters.map(([k, l]) => btn(l, () => this.loadLibraryImages(k), lib.filter === k ? '#38bdf8' : '#94a3b8'))),
        this.buildLibraryControls(),
        lib.error ? h('div', { role: 'alert', style: Object.assign({}, css.muted, { color: '#fca5a5' }) }, lib.error) : null,
        lib.items.length ? this.buildLibraryItems()
          : h('div', { style: css.muted }, lib.loading ? '' : 'No images for this filter.'),
        this.buildLibraryPager(),
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
    const numbered = h('div', { style: css.panel },
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
    return h('div', { style: { display: 'grid', gap: 10 } }, this.buildXyzPanel(), this.buildPromptMatrixPanel(), this.buildPromptLinesPanel(), numbered);
  };

  // ── X/Y/Z plot (A1111 script): axes + values -> validated cells -> durable queue -> legend grid ──
  P._xyzBody = function () {
    const x = this._ws().xyz;
    const v = x.vary || {};
    return { settings: this._createBody({ quantity: 1 }), x: x.x, y: x.y, z: x.z, keep_random_seed: !!x.keepRandom, vary_seeds: { x: !!v.x, y: !!v.y, z: !!v.z }, confirm_large: !!this._ws().confirmLarge };
  };
  P.xyzCheck = async function () {
    const r = await this._api('/api/xyz/plan', this._xyzBody());
    this.wsSet({ xyz: Object.assign({}, this._ws().xyz, { plan: r.ok ? r.data : null, error: r.ok ? null : (r.data.error || 'Plot rejected') }) });
    return r.ok;
  };
  P.xyzStart = async function () {
    if (!(await this.xyzCheck())) return;
    // Run with the seed the preview showed (a random base seed is fixed once per plot, and the preview must match the run).
    const body = this._xyzBody(), shown = this._ws().xyz.plan;
    if (shown && shown.fixedSeed != null && !(Number(body.settings.seed) >= 0)) body.settings.seed = shown.fixedSeed;
    const r = await this._api('/api/xyz', body);
    if (!r.ok) { this.wsSet({ xyz: Object.assign({}, this._ws().xyz, { error: r.data.error || 'Plot rejected', needsConfirm: !!r.data.needs_confirmation }) }); return; }
    this.wsSet({ queueId: r.data.id, queue: r.data, xyz: Object.assign({}, this._ws().xyz, { error: null, queueId: r.data.id, grid: null }) });
    this._pollQueue();
  };
  P.xyzGrid = async function () {
    const x = this._ws().xyz;
    this.wsSet({ xyz: Object.assign({}, x, { gridStatus: 'running' }) });
    const r = await this._api('/api/xyz/' + x.queueId + '/grid', { legend: x.legend, margin: +x.margin || 0 });
    if (!r.ok) { this.wsSet({ xyz: Object.assign({}, this._ws().xyz, { gridStatus: 'error', error: r.data.error }) }); return; }
    const job = await this._waitJob(r.data.job_id);
    const res = D.jobResults(job);
    this.wsSet({ xyz: Object.assign({}, this._ws().xyz, { gridStatus: this._jobOk(job.status) && res.length ? 'done' : 'error', grid: res, error: this._jobOk(job.status) ? null : this._failText(job) }) });
  };
  P.buildXyzPanel = function () {
    const ws = this._ws(), x = ws.xyz, X = window.DexXyz, base = this.state.backendUrl, q = ws.queue;
    const setX = patch => this.wsSet({ xyz: Object.assign({}, this._ws().xyz, patch, { plan: null }) });
    const setAxis = (k, patch) => setX({ [k]: Object.assign({}, this._ws().xyz[k], patch) });
    const axisRow = k => h('div', { key: k, style: css.row },
      h('label', { style: { display: 'grid', gap: 3, fontSize: 12, color: '#cbd5e1' } }, k.toUpperCase() + ' axis',
        h('select', { value: x[k].type, style: css.input, 'data-xyz-field': k + '-type', 'aria-label': k.toUpperCase() + ' axis type', onChange: e => setAxis(k, { type: e.target.value }) },
          h('option', { value: 'none' }, 'Nothing'), ...Object.keys(X.AXES).map(t => h('option', { key: t, value: t }, X.AXES[t].label)),
          // Stock A1111 axes the installed engines cannot honour stay listed (disabled) with the reason, never silently missing.
          ...Object.keys(X.ABSENT_AXES || {}).map(t => h('option', { key: t, value: t, disabled: true, title: X.ABSENT_AXES[t].reason }, X.ABSENT_AXES[t].label + ' — not available')))),
      h('label', { style: Object.assign({}, css.row, { fontSize: 12, color: '#cbd5e1' }) }, h('input', { type: 'checkbox', checked: !!(x.vary && x.vary[k]), 'data-xyz-field': 'vary-' + k, onChange: e => setX({ vary: Object.assign({}, this._ws().xyz.vary, { [k]: e.target.checked }) }) }), 'Vary seeds for ' + k.toUpperCase()),
      x[k].type !== 'none' ? h('label', { style: { display: 'grid', gap: 3, fontSize: 12, color: '#cbd5e1', flex: 1, minWidth: 160 } }, k.toUpperCase() + ' values',
        h('input', { type: 'text', value: x[k].values, style: css.input, 'data-xyz-field': k + '-values', 'aria-label': k.toUpperCase() + ' axis values', placeholder: ({ sr: 'search, replacement 1, replacement 2', order: 'fragment a, fragment b, fragment c', size: '512x512, 512x768', text: 'value 1, value 2' })[X.AXES[x[k].type].kind] || '10, 20 or 10-30 (+10) or 1-5 [3]', onChange: e => setAxis(k, { values: e.target.value }) })) : null);
    const running = q && q.settings && q.settings.kind === 'xyz' && q.status === 'RUNNING';
    const isXyz = q && q.settings && q.settings.kind === 'xyz';
    const plan = x.plan;
    return h('div', { style: css.panel, 'data-xyz-panel': 'true' },
      h('div', { style: Object.assign({}, css.title, { marginBottom: 4 }) }, 'X/Y/Z plot'),
      h('div', { style: Object.assign({}, css.muted, { marginBottom: 8 }) }, 'Runs the Create settings once per cell, changing only the chosen axes (A1111 script). A random seed is fixed once so cells differ only by the axes.'),
      h('div', { style: { display: 'grid', gap: 8 } }, axisRow('x'), axisRow('y'), axisRow('z')),
      h('div', { style: css.row, 'data-xyz-field': 'swap' }, ...['xy', 'yz', 'xz'].map(pr => btn('Swap ' + pr[0].toUpperCase() + '/' + pr[1].toUpperCase(), () => { const cur = this._ws().xyz, sw = X.swapAxes({ x: cur.x, y: cur.y, z: cur.z }, pr); setX({ x: sw.x, y: sw.y, z: sw.z }); }, '#94a3b8', { 'data-xyz-swap': pr }))),
      h('label', { style: Object.assign({}, css.row, { fontSize: 12, color: '#cbd5e1', margin: '6px 0' }) }, h('input', { type: 'checkbox', checked: !!x.keepRandom, 'data-xyz-field': 'keep-random', onChange: e => setX({ keepRandom: e.target.checked }) }), 'Keep -1 for seeds (every cell draws its own random seed)'),
      h('div', { style: css.muted, 'data-xyz-field': 'unavailable' }, 'Not available with the installed engines (listed disabled in the axis menus): Checkpoint / VAE / Refiner (a model-slot swap per cell), variation seeds, noise/sigma axes and the other entries marked "not available". Hires steps / upscaler / Denoising need High-Res Refine turned on.'),
      h('div', { style: Object.assign({}, css.row, { margin: '8px 0' }) },
        btn('Check plot', () => this.xyzCheck(), '#38bdf8'),
        btn(running ? 'Plot running…' : 'Start plot', () => this.xyzStart(), '#65d66e', { disabled: !!running })),
      x.error ? h('div', { style: { color: tone.bad, fontSize: 12 }, 'data-xyz-field': 'error' }, x.error) : null,
      x.needsConfirm ? h('label', { style: Object.assign({}, css.row, { color: tone.warn, fontSize: 12 }) }, h('input', { type: 'checkbox', checked: !!ws.confirmLarge, onChange: e => this.wsSet({ confirmLarge: e.target.checked }) }), 'Confirm this large plot, then press Start again') : null,
      plan ? h('div', { style: { display: 'grid', gap: 3 }, 'data-xyz-field': 'plan' },
        h('div', { style: { fontWeight: 800, color: tone.ok } }, plan.total + ' cells · ' + plan.dims.join(' × ') + (plan.fixedSeed != null ? ' · seed ' + plan.fixedSeed : ' · random seeds')),
        ...plan.cells.slice(0, 8).map(c => h('div', { key: c.index, style: css.mono }, (c.index + 1) + '. ' + c.title)),
        plan.cells.length > 8 ? h('div', { style: css.muted }, '… ' + (plan.cells.length - 8) + ' more') : null) : null,
      isXyz ? h('div', { style: { display: 'grid', gap: 6, marginTop: 6 }, 'data-xyz-field': 'progress' },
        h('div', { style: { fontWeight: 800, color: stateTone(q.status) } }, 'Plot ' + q.status + ' · ' + q.complete + ' / ' + q.total + ' cells' + (q.failed ? ' · ' + q.failed + ' failed' : '')),
        h('div', { style: css.row },
          h('label', { style: Object.assign({}, css.row, { fontSize: 12, color: '#cbd5e1' }) }, h('input', { type: 'checkbox', checked: x.legend !== false, 'data-xyz-field': 'legend', onChange: e => this.wsSet({ xyz: Object.assign({}, this._ws().xyz, { legend: e.target.checked }) }) }), 'Legend'),
          h('label', { style: { display: 'grid', gap: 3, fontSize: 12, color: '#cbd5e1' } }, 'Margin px', numInput(x.margin, v => this.wsSet({ xyz: Object.assign({}, this._ws().xyz, { margin: v }) }), { min: '0', max: '200', step: '2' })),
          btn(x.gridStatus === 'running' ? 'Building grid…' : 'Build grid', () => this.xyzGrid(), '#f59e0b', { disabled: !q.complete || x.gridStatus === 'running' }))) : null,
      x.grid && x.grid.length ? h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(160px,1fr))', gap: 8, marginTop: 8 }, 'data-xyz-field': 'grid' },
        ...x.grid.map(r => h('div', { key: r.imageId }, thumb(base + r.imageUrl, false, () => openFull(this, r.imageId, base + r.imageUrl), r.imageId, 'XYZ grid ' + r.width + '×' + r.height)))) : null);
  };

  // ── Model files: header-verified architecture (P11) ──────────────
  P.verifyModelFiles = async function (refresh) {
    this.wsSet({ fileCheck: Object.assign({}, this._ws().fileCheck, { busy: true, error: null }) });
    const r = await this._api('/api/models/inspect', { kind: 'checkpoint', refresh: !!refresh });
    this.wsSet({ fileCheck: { busy: false, items: r.ok ? r.data.items : (this._ws().fileCheck.items || []), error: r.ok ? null : (r.data.error || 'Inspection failed') } });
  };
  P.buildFileVerificationPanel = function () {
    const ws = this._ws(), fc = ws.fileCheck || {};
    const gb = n => (n / 1e9).toFixed(2) + ' GB';
    const tone2 = { match: tone.ok, 'header-only': tone.info, mismatch: tone.bad, unknown: tone.off };
    const row = it => {
      const h2 = it.header, ag = it.agreement;
      return h('div', { key: it.path, 'data-file-row': it.filename, style: { display: 'grid', gridTemplateColumns: 'minmax(0,2fr) 70px 90px 80px minmax(0,1.2fr)', gap: 8, fontSize: 12, padding: '4px 0', borderBottom: '1px solid rgba(148,163,184,.08)', alignItems: 'center' } },
        h('span', { style: css.mono }, it.filename), h('span', { style: css.muted }, gb(it.size_bytes)),
        h2 ? h('span', { style: { color: '#e2e8f0', fontWeight: 700 } }, h2.arch + (h2.embedded_vae ? ' + VAE' : '')) : h('span', { style: { color: tone.bad } }, it.error ? 'unreadable' : '—'),
        h2 ? h('span', { style: css.muted }, Object.keys(h2.dtypes).filter(d => d.startsWith('F') || d.startsWith('BF')).join('/')) : h('span'),
        h('span', { style: { color: ag ? tone2[ag.state] : tone.off } }, it.error ? it.error : h2 && h2.truncated ? 'file is truncated' : ag ? ({ match: 'name and header agree', 'header-only': 'name gave no family', mismatch: 'NAME SAYS ' + ag.byName + ', HEADER ' + ag.byHeader, unknown: 'architecture not recognised' })[ag.state] : ''));
    };
    return h('div', { style: css.panel, 'data-file-verification': 'true' },
      h('div', { style: Object.assign({}, css.row, { marginBottom: 6 }) }, h('div', { style: css.title }, 'Checkpoint file verification'), h('div', { style: { flex: 1 } }),
        btn(fc.busy ? 'Reading headers…' : 'Verify files', () => this.verifyModelFiles(false), '#38bdf8', { disabled: !!fc.busy }),
        btn('Re-read', () => this.verifyModelFiles(true), '#94a3b8', { disabled: !!fc.busy })),
      h('div', { style: css.muted }, 'Reads each checkpoint\'s safetensors header on Big Mac (never the weights) to confirm the architecture, precision and embedded VAE, instead of trusting the filename.'),
      fc.error ? h('div', { style: { color: tone.bad, fontSize: 12, marginTop: 6 }, 'data-file-error': 'true' }, fc.error) : null,
      fc.items && fc.items.length ? h('div', { style: { marginTop: 8 } }, ...fc.items.map(row)) : null);
  };

  // ── Prompt matrix + Prompts from list (A1111 scripts, SC-16..SC-19): plan on the server, run as validated queue cells ──
  P._pmx = function () {
    const ws = this._ws();
    if (!ws.pmx) ws.pmx = { target: 'positive', putAtStart: false, joiner: 'comma', differentSeeds: false, keepRandom: false, legend: true, margin: 0, plan: null, error: null, grid: null };
    return ws.pmx;
  };
  P._plines = function () {
    const ws = this._ws();
    if (!ws.plines) ws.plines = { text: '', iterateSeed: false, sameSeed: false, position: 'start', plan: null, error: null, needsConfirm: false };
    return ws.plines;
  };
  P._pmxBody = function () {
    const m = this._pmx();
    return { settings: this._createBody({ quantity: 1 }), target: m.target, put_at_start: !!m.putAtStart, joiner: m.joiner, different_seeds: !!m.differentSeeds, keep_random_seed: !!m.keepRandom, confirm_large: !!this._ws().confirmLarge };
  };
  P._plinesBody = function () {
    const m = this._plines();
    return { settings: this._createBody({ quantity: 1 }), text: m.text, iterate_seed: !!m.iterateSeed, same_seed: !!m.sameSeed, prompt_position: m.position === 'end' ? 'end' : 'start', confirm_large: !!this._ws().confirmLarge };
  };
  P.pmxCheck = async function () {
    const r = await this._api('/api/promptmatrix/plan', this._pmxBody());
    this.wsSet({ pmx: Object.assign({}, this._pmx(), { plan: r.ok ? r.data : null, error: r.ok ? null : (r.data.error || 'Matrix rejected'), needsConfirm: false }) });
    return r.ok;
  };
  P.pmxStart = async function () {
    if (!(await this.pmxCheck())) return;
    // Run with the seed the preview showed (a random base seed is fixed once; the preview must match the run).
    const body = this._pmxBody(), shown = this._pmx().plan;
    if (shown && shown.fixedSeed != null && !(Number(body.settings.seed) >= 0)) body.settings.seed = shown.fixedSeed;
    const r = await this._api('/api/promptmatrix', body);
    if (!r.ok) { this.wsSet({ pmx: Object.assign({}, this._pmx(), { error: r.data.error || 'Matrix rejected', needsConfirm: !!r.data.needs_confirmation }) }); return; }
    this.wsSet({ queueId: r.data.id, queue: r.data, pmx: Object.assign({}, this._pmx(), { error: null, needsConfirm: false, queueId: r.data.id, grid: null }) });
    this._pollQueue();
  };
  P.pmxGrid = async function () {
    const m = this._pmx();
    this.wsSet({ pmx: Object.assign({}, m, { gridStatus: 'running' }) });
    const r = await this._api('/api/xyz/' + m.queueId + '/grid', { legend: m.legend, margin: +m.margin || 0 });
    if (!r.ok) { this.wsSet({ pmx: Object.assign({}, this._pmx(), { gridStatus: 'error', error: r.data.error }) }); return; }
    const job = await this._waitJob(r.data.job_id);
    const res = D.jobResults(job);
    this.wsSet({ pmx: Object.assign({}, this._pmx(), { gridStatus: this._jobOk(job.status) && res.length ? 'done' : 'error', grid: res, error: this._jobOk(job.status) ? null : this._failText(job) }) });
  };
  P.plinesCheck = async function () {
    const r = await this._api('/api/promptlines/plan', this._plinesBody());
    this.wsSet({ plines: Object.assign({}, this._plines(), { plan: r.ok ? r.data : null, error: r.ok ? null : (r.data.errors && r.data.errors.length > 1 ? r.data.errors.join('\n') : (r.data.error || 'List rejected')), needsConfirm: false }) });
    return r.ok;
  };
  P.plinesStart = async function () {
    if (!(await this.plinesCheck())) return;
    const body = this._plinesBody(), shown = this._plines().plan;
    if (shown && shown.fixedSeed != null && !(Number(body.settings.seed) >= 0)) body.settings.seed = shown.fixedSeed;
    const r = await this._api('/api/promptlines', body);
    if (!r.ok) { this.wsSet({ plines: Object.assign({}, this._plines(), { error: r.data.error || 'List rejected', needsConfirm: !!r.data.needs_confirmation }) }); return; }
    this.wsSet({ queueId: r.data.id, queue: r.data, plines: Object.assign({}, this._plines(), { error: null, needsConfirm: false, queueId: r.data.id }) });
    this._pollQueue();
  };
  // One cell of a plan preview: the exact normalised job the server validated (SC-19 dry run).
  function jobLine(c) {
    const j = c.job || {};
    const bits = [j.width + '×' + j.height, j.steps + ' steps'];
    if (j.cfg_scale !== '' && j.cfg_scale != null) bits.push('cfg ' + j.cfg_scale);
    if (j.sampler) bits.push(j.sampler);
    bits.push('seed ' + (Number(j.seed) >= 0 ? j.seed : 'random'));
    return bits.join(' · ');
  }
  function planList(plan, field, withLine) {
    return h('div', { style: { maxHeight: 320, overflowY: 'auto', display: 'grid', gap: 6, border: '1px solid rgba(148,163,184,.1)', borderRadius: 7, padding: 7 }, ['data-' + field + '-field']: 'cells' },
      ...plan.cells.map(c => h('div', { key: c.index, style: { display: 'grid', gap: 2 }, 'data-cell': String(c.index + 1) },
        h('div', { style: { fontSize: 12, color: '#dbe4ee', overflowWrap: 'anywhere' } }, (c.index + 1) + '. ' + (withLine ? 'Line ' + c.line + ' · ' : '') + c.prompt),
        c.negative_prompt ? h('div', { style: css.mono }, 'negative: ' + c.negative_prompt) : null,
        h('div', { style: css.mono }, jobLine(c)))));
  }
  P.buildPromptMatrixPanel = function () {
    const ws = this._ws(), m = this._pmx(), base = this.state.backendUrl, q = ws.queue;
    const setM = patch => this.wsSet({ pmx: Object.assign({}, this._pmx(), patch, { plan: null }) });
    const isM = q && q.settings && q.settings.kind === 'promptmatrix';
    const running = isM && q.status === 'RUNNING';
    const plan = m.plan;
    const sel = (field, value, opts, onChange, label) => h('label', { style: { display: 'grid', gap: 3, fontSize: 12, color: '#cbd5e1' } }, label,
      h('select', { value, style: css.input, 'data-pmx-field': field, 'aria-label': label, onChange: e => onChange(e.target.value) }, ...opts.map(o => h('option', { key: o[0], value: o[0] }, o[1]))));
    const chk = (field, checked, onChange, label) => h('label', { style: Object.assign({}, css.row, { fontSize: 12, color: '#cbd5e1' }) }, h('input', { type: 'checkbox', checked: !!checked, 'data-pmx-field': field, onChange: e => onChange(e.target.checked) }), label);
    return h('div', { style: css.panel, 'data-pmx-panel': 'true' },
      h('div', { style: Object.assign({}, css.title, { marginBottom: 4 }) }, 'Prompt matrix'),
      h('div', { style: Object.assign({}, css.muted, { marginBottom: 8 }) }, 'Split the Create ' + (m.target === 'negative' ? 'negative ' : '') + 'prompt with | : the first part is the base and every other part is switched on or off, giving 2^N images (up to 6 parts = 64). Example: a cat | red hat | blue scarf. Cells run with the Create settings; a random seed is fixed once so only the prompt changes.'),
      h('div', { style: css.row },
        sel('target', m.target, [['positive', 'Positive prompt'], ['negative', 'Negative prompt']], v => setM({ target: v }), 'Matrix on'),
        sel('joiner', m.joiner, [['comma', 'Comma ( , )'], ['space', 'Space']], v => setM({ joiner: v }), 'Joining character')),
      h('div', { style: { display: 'grid', gap: 4, margin: '6px 0' } },
        chk('put-at-start', m.putAtStart, v => setM({ putAtStart: v }), 'Put variable parts at start of prompt'),
        chk('different-seeds', m.differentSeeds, v => setM({ differentSeeds: v }), 'Use a different seed for each picture (base seed + cell number)'),
        chk('keep-random', m.keepRandom, v => setM({ keepRandom: v }), 'Keep random seeds in the prompt matrix (each part combination draws its own seed)')),
      h('div', { style: css.muted, 'data-pmx-field': 'unavailable' }, 'Not available: more than 6 optional parts, empty parts (refused rather than duplicated), A1111\'s coloured active/inactive text on the grid (the grid uses the X/Y/Z legend labels), a matrix on positive and negative at once, and varying the checkpoint per cell.'),
      h('div', { style: Object.assign({}, css.row, { margin: '8px 0' }) },
        btn('Check matrix', () => this.pmxCheck(), '#38bdf8'),
        btn(running ? 'Matrix running…' : 'Start matrix', () => this.pmxStart(), '#65d66e', { disabled: !!running })),
      m.error ? h('div', { style: { color: tone.bad, fontSize: 12, whiteSpace: 'pre-wrap' }, 'data-pmx-field': 'error' }, m.error) : null,
      m.needsConfirm ? h('label', { style: Object.assign({}, css.row, { color: tone.warn, fontSize: 12 }) }, h('input', { type: 'checkbox', checked: !!ws.confirmLarge, onChange: e => this.wsSet({ confirmLarge: e.target.checked }) }), 'Confirm this large matrix, then press Start again') : null,
      plan ? h('div', { style: { display: 'grid', gap: 4 }, 'data-pmx-field': 'plan' },
        h('div', { style: { fontWeight: 800, color: tone.ok } }, plan.total + ' cells · ' + plan.dims[0] + ' × ' + plan.dims[1] + (plan.fixedSeed != null ? ' · seed ' + plan.fixedSeed : ' · random seeds')),
        planList(plan, 'pmx', false)) : null,
      isM ? h('div', { style: { display: 'grid', gap: 6, marginTop: 6 }, 'data-pmx-field': 'progress' },
        h('div', { style: { fontWeight: 800, color: stateTone(q.status) } }, 'Matrix ' + q.status + ' · ' + q.complete + ' / ' + q.total + ' cells' + (q.failed ? ' · ' + q.failed + ' failed' : '')),
        h('div', { style: css.row },
          chk('legend', m.legend !== false, v => this.wsSet({ pmx: Object.assign({}, this._pmx(), { legend: v }) }), 'Legend'),
          h('label', { style: { display: 'grid', gap: 3, fontSize: 12, color: '#cbd5e1' } }, 'Margin px', numInput(m.margin, v => this.wsSet({ pmx: Object.assign({}, this._pmx(), { margin: v }) }), { min: '0', max: '200', step: '2' })),
          btn(m.gridStatus === 'running' ? 'Building grid…' : 'Build grid', () => this.pmxGrid(), '#f59e0b', { disabled: !q.complete || m.gridStatus === 'running' }))) : null,
      m.grid && m.grid.length ? h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(160px,1fr))', gap: 8, marginTop: 8 }, 'data-pmx-field': 'grid' },
        ...m.grid.map(r => h('div', { key: r.imageId }, thumb(base + r.imageUrl, false, () => openFull(this, r.imageId, base + r.imageUrl), r.imageId, 'Matrix grid ' + r.width + '×' + r.height)))) : null);
  };
  P.buildPromptLinesPanel = function () {
    const ws = this._ws(), m = this._plines(), q = ws.queue;
    const setM = patch => this.wsSet({ plines: Object.assign({}, this._plines(), patch, { plan: null }) });
    const isL = q && q.settings && q.settings.kind === 'promptlines';
    const running = isL && q.status === 'RUNNING';
    const plan = m.plan;
    const chk = (field, checked, onChange, label) => h('label', { style: Object.assign({}, css.row, { fontSize: 12, color: '#cbd5e1' }) }, h('input', { type: 'checkbox', checked: !!checked, 'data-plines-field': field, onChange: e => onChange(e.target.checked) }), label);
    return h('div', { style: css.panel, 'data-plines-panel': 'true' },
      h('div', { style: Object.assign({}, css.title, { marginBottom: 4 }) }, 'Prompts from list'),
      h('div', { style: Object.assign({}, css.muted, { marginBottom: 8 }) }, 'One prompt per line (blank lines are skipped, up to 64). A line that starts with -- sets options A1111-style: --prompt "a cat" --negative_prompt "blurry" --steps 20 --cfg_scale 7 --seed 5 --width 512 --height 512 --sampler_name "Euler a". Without --prompt the Create prompt is used. Anything unrecognised is an error naming its line.'),
      h('textarea', { rows: 8, value: m.text, 'data-plines-field': 'text', 'aria-label': 'Prompt list', placeholder: 'a red cat on a sofa\n--prompt "a blue dog" --steps 12 --seed 5\n--prompt "a green frog" --sampler_name "Euler a"',
        onChange: e => setM({ text: e.target.value }), style: Object.assign({}, css.input, { fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, resize: 'vertical', minHeight: 120 }) }),
      h('div', { style: Object.assign({}, css.row, { margin: '6px 0' }) },
        h('label', { style: Object.assign({}, css.muted) }, 'Load a text file ', h('input', { type: 'file', accept: '.txt,text/plain', 'data-plines-field': 'file', 'aria-label': 'Load prompt list from a text file',
          onChange: e => { const f = e.target.files && e.target.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => setM({ text: String(rd.result || '') }); rd.readAsText(f); e.target.value = ''; } }))),
      h('div', { style: { display: 'grid', gap: 4, margin: '6px 0' } },
        chk('iterate-seed', m.iterateSeed, v => setM({ iterateSeed: v }), 'Iterate seed every line (base seed + line index; a --seed on a line wins)'),
        chk('same-seed', m.sameSeed, v => setM({ sameSeed: v }), 'Use same random seed for all lines (otherwise every line draws its own seed)'),
        h('label', { style: Object.assign({}, css.row, { fontSize: 12, color: '#cbd5e1', margin: '6px 0' }) }, 'Insert prompts at the',
          h('select', { value: m.position === 'end' ? 'end' : 'start', style: css.input, 'data-plines-field': 'position', 'aria-label': 'Insert prompts at the start or end of the Create prompt', onChange: e => setM({ position: e.target.value }) },
            h('option', { value: 'start' }, 'start'), h('option', { value: 'end' }, 'end')), ' of the Create prompt (when it is not empty)')),
      h('div', { style: css.muted, 'data-plines-field': 'unavailable' }, 'Not available (refused by name, never ignored): --sd_model, --outpath_samples/--outpath_grids, --styles, --subseed/--subseed_strength, --seed_resize_from_w/h, --sampler_index, --batch_size, --n_iter, --restore_faces, --tiling, --do_not_save_samples/--do_not_save_grid, --prompt_for_display. No combined grid of the lines. Options a target ignores (for example --cfg_scale on FLUX.2) are refused.'),
      h('div', { style: Object.assign({}, css.row, { margin: '8px 0' }) },
        btn('Dry run', () => this.plinesCheck(), '#38bdf8'),
        btn(running ? 'List running…' : 'Start list', () => this.plinesStart(), '#65d66e', { disabled: !!running })),
      m.error ? h('div', { style: { color: tone.bad, fontSize: 12, whiteSpace: 'pre-wrap' }, 'data-plines-field': 'error' }, m.error) : null,
      m.needsConfirm ? h('label', { style: Object.assign({}, css.row, { color: tone.warn, fontSize: 12 }) }, h('input', { type: 'checkbox', checked: !!ws.confirmLarge, onChange: e => this.wsSet({ confirmLarge: e.target.checked }) }), 'Confirm this large list, then press Start again') : null,
      plan ? h('div', { style: { display: 'grid', gap: 4 }, 'data-plines-field': 'plan' },
        h('div', { style: { fontWeight: 800, color: tone.ok } }, plan.total + ' prompts' + (plan.skipped ? ' · ' + plan.skipped + ' blank lines skipped' : '') + (plan.fixedSeed != null ? ' · base seed ' + plan.fixedSeed : ' · random seeds') + ' — exactly what will run:'),
        planList(plan, 'plines', true)) : null,
      isL ? h('div', { style: { fontWeight: 800, color: stateTone(q.status), marginTop: 6 }, 'data-plines-field': 'progress' }, 'List ' + q.status + ' · ' + q.complete + ' / ' + q.total + ' prompts' + (q.failed ? ' · ' + q.failed + ' failed' : '')) : null);
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
        h('label', { style: Object.assign({}, css.row, { fontSize: 12, color: '#cbd5e1', gap: 4 }), title: 'Run all images in one model load (faster). They appear together at the end instead of one by one. Stable Diffusion models only.' },
          h('input', { type: 'checkbox', 'data-fast-batch': 'true', checked: !!ws.fastBatch, onChange: e => this.wsSet({ fastBatch: e.target.checked }) }), 'Fast batch'),
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
        ws.hires ? h('div', { style: { display: 'grid', gap: 6 }, 'data-dex-field': 'hires-panel' },
          h('div', { style: css.row },
            h('label', { style: css.muted }, 'Second pass size'),
            h('select', { value: ws.hiresMode, 'data-dex-field': 'hires-mode', 'aria-label': 'Hires size mode', onChange: e => this.wsSet({ hiresMode: e.target.value }), style: Object.assign({}, css.input, { width: 'auto' }) },
              h('option', { value: 'scale' }, 'Upscale by'), h('option', { value: 'size' }, 'Resize to')),
            ws.hiresMode === 'size'
              ? [h('label', { key: 'w', style: css.muted }, 'Width'), numInput(ws.hiresW, v => this.wsSet({ hiresW: v }), { min: '64', max: '2048', step: '8', 'data-dex-field': 'hires-width' }),
                 h('label', { key: 'h', style: css.muted }, 'Height'), numInput(ws.hiresH, v => this.wsSet({ hiresH: v }), { min: '64', max: '2048', step: '8', 'data-dex-field': 'hires-height' })]
              : [h('label', { key: 's', style: css.muted }, 'Scale'), numInput(ws.hiresScale, v => this.wsSet({ hiresScale: v }), { min: '1.1', max: '2', step: '0.1', 'data-dex-field': 'hires-scale' })],
            h('span', { style: css.muted, 'data-dex-field': 'hires-final' }, '→ ' + (t => t.width + '×' + t.height)(D.hiresTarget({ width: +s.width, height: +s.height }, ws)))),
          h('div', { style: css.row },
            h('label', { style: css.muted }, '2nd-pass steps (0 = same)'), numInput(ws.hiresSteps, v => this.wsSet({ hiresSteps: v }), { min: '0', max: '150', step: '1' }),
            h('label', { style: css.muted }, 'Denoise'), numInput(ws.hiresDenoise, v => this.wsSet({ hiresDenoise: v }), { min: '0.05', max: '0.95', step: '0.05' }),
            h('select', { value: ws.hiresUpscaler, 'data-dex-field': 'hires-upscaler', 'aria-label': 'Hires upscaler', onChange: e => this.wsSet({ hiresUpscaler: e.target.value }), style: Object.assign({}, css.input, { width: 'auto' }) },
              ...D.HIRES_UPSCALERS.map(u => h('option', { key: u, value: u }, u)))),
          h('div', { style: css.muted, 'data-dex-field': 'hires-unavailable' }, 'This in-engine pass reuses the first-pass prompt, sampler, scheduler and checkpoint. For separate second-pass settings use “Independent second pass” below; a refiner switch point (latent handoff) is not available with the installed engine.')) : null) : null,
      this._secondPassPanel(spec));
  };
  // OP-4A: independent pixel-space second pass (base → upscale → img2img with its own settings). Blank = inherit from the base pass.
  P._secondPassPanel = function (spec) {
    const ws = this._ws(), sp = ws.second || {};
    const set = patch => this.wsSet({ second: Object.assign({}, this._ws().second, patch) });
    const lbl = (t, el) => h('label', { style: { display: 'grid', gap: 3, fontSize: 12, color: '#cbd5e1' } }, t, el);
    const sel = (key, t, opts) => lbl(t, h('select', { value: sp[key] || '', style: css.input, 'data-second-field': key, 'aria-label': 'Second pass ' + t, onChange: e => set({ [key]: e.target.value }) }, ...opts.map(([v, l]) => h('option', { key: v, value: v }, l))));
    const num = (key, t, attrs) => lbl(t, h('input', Object.assign({ type: 'number', value: sp[key] == null ? '' : String(sp[key]), placeholder: 'same as base', style: Object.assign({}, css.input, { width: 110 }), 'data-second-field': key, onChange: e => set({ [key]: e.target.value }) }, attrs)));
    const targets = (this.state.modelTargets || []).filter(t => (t.backend || 'sdcpp') !== 'mflux' && t.id !== 'flux-fp8' && !t.aliasOf && String(t.status).toLowerCase() !== 'broken');
    const conflict = !!ws.hires;
    return h('div', { 'data-second-pass': 'true', style: { borderTop: '1px solid rgba(148,163,184,.12)', marginTop: 8, paddingTop: 8, display: 'grid', gap: 6 } },
      h('label', { style: Object.assign({}, css.row, { color: '#dbe4ee', fontSize: 12 }) },
        h('input', { type: 'checkbox', checked: !!sp.on, disabled: conflict, 'data-second-field': 'on', onChange: e => set({ on: e.target.checked }) }),
        'Independent second pass (upscale + img2img with its own prompt, checkpoint, sampler) — keeps the base image too'),
      conflict ? h('div', { style: css.muted }, 'Turn off High-Res Refine to use the independent second pass (they are different operations).') : null,
      sp.on && !conflict ? h('div', { style: { display: 'grid', gap: 6 } },
        h('textarea', { rows: 2, value: sp.prompt || '', placeholder: 'Second-pass prompt (blank = same as the base prompt)', 'data-second-field': 'prompt', 'data-prompt-edit': 'true', style: Object.assign({}, css.input, { resize: 'vertical' }), onChange: e => set({ prompt: e.target.value }) }),
        h('input', { type: 'text', value: sp.negative_prompt || '', placeholder: 'Second-pass negative prompt (blank = same as base)', 'data-second-field': 'negative_prompt', style: css.input, onChange: e => set({ negative_prompt: e.target.value }) }),
        h('div', { style: Object.assign({}, css.row, { alignItems: 'end' }) },
          sel('target', 'Checkpoint', [['', spec && spec.backend === 'mflux' ? 'choose (MFLUX cannot refine)' : 'same as base']].concat(targets.map(t => [t.id, t.label || t.id]))),
          sel('sampler', 'Sampler', [['', 'same as base']].concat(D.SAMPLER_CHOICES.map(c => [c[0], c[1] || c[0]]))),
          sel('scheduler', 'Scheduler', [['', 'same as base']].concat(D.SCHEDULER_CHOICES)),
          num('steps', 'Steps', { min: '1', max: '150' }), num('cfg_scale', 'CFG', { min: '1', max: '30', step: '0.5' }),
          num('denoise', 'Denoise (default 0.45)', { min: '0.01', max: '0.99', step: '0.05' }), num('scale', 'Scale (default 1.5)', { min: '1', max: '4', step: '0.25' }),
          sel('upscaler', 'Upscaler', [['', 'Lanczos'], ['nearest', 'Nearest'], ['bicubic', 'Bicubic'], ['bilinear', 'Bilinear']])),
        h('div', { style: css.muted, 'data-second-field': 'note' }, 'Pixel-space refinement: the base image is kept as its own result, upscaled, then re-rendered on the chosen SDCPP checkpoint. Not the same as an SDXL refiner switch or latent hires handoff (those need engine changes).')) : null);
  };
  P._secondPassBody = function () {
    const sp = this._ws().second || {}, out = {};
    for (const k of ['prompt', 'negative_prompt', 'target', 'sampler', 'scheduler', 'upscaler']) if (sp[k]) out[k] = sp[k];
    for (const k of ['steps', 'cfg_scale', 'denoise', 'scale']) if (sp[k] !== undefined && sp[k] !== '' && sp[k] !== null) out[k] = Number(sp[k]);
    return out;
  };

  // ── Detailer (Apple Vision Face / Hand / Person) ──────────────
  P.openDetailer = function (imageId) {
    this._detailerDetectController?.abort();
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
    this._detailerDetectController?.abort();
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
    this._detailerDetectController?.abort();
    const controller = this._detailerDetectController = new AbortController();
    this.wsSet({ detailer: Object.assign({}, d, { loading: true, maskPreview: null, detections: [], note: 'Detecting with Apple Vision…' }) });
    try {
      const res = await this._api('/api/detailer/mask-preview', this.detailerPayload(d), undefined, controller.signal);
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
    this._detailerDetectController?.abort();
    const controller = this._detailerDetectController = new AbortController();
    this.wsSet({ detailer: Object.assign({}, d, { loading: true, note: 'Detecting with Apple Vision…' }) });
    try {
      let maskData = d.maskPreview;
      if (!maskData) {
        const pRes = await this._api('/api/detailer/mask-preview', this.detailerPayload(d), undefined, controller.signal);
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
              alignItems: 'center', fontSize: 11, color: '#e2e8f0', fontFamily: "'IBM Plex Mono',monospace", pointerEvents: 'none'
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
        active && active.imageId && active.status === 'DONE' ? h('div', { style: { display: 'grid', gap: 8, width: '100%', marginTop: 6 } },
          h('div', { style: Object.assign({}, css.row, { flexWrap: 'wrap', alignItems: 'center' }) },
            h('span', { role: 'status', style: { color: '#86efac', fontWeight: 700, fontSize: 12 } }, 'Saved to Library'),
            btn('Open in Library', () => this.showInLibrary(active.imageId), '#38bdf8'),
            this._gate('img2img') ? btn('Edit', () => this.sendToEdit(active.imageId, 'img2img'), '#a78bfa') : null,
            btn('Enhance', () => this.sendToEnhance(active.imageId), '#f59e0b'),
            h('a', { href: base + '/api/images/' + encodeURIComponent(active.imageId), download: active.imageId,
              style: { display: 'inline-flex', alignItems: 'center', padding: '7px 11px', borderRadius: 7, border: '1px solid rgba(148,163,184,.5)', color: '#f8fafc', textDecoration: 'none', fontWeight: 700, fontSize: 12 } }, 'Download')),
          h('details', { style: { border: '1px solid rgba(148,163,184,.22)', borderRadius: 8, padding: '8px 10px' } },
            h('summary', { style: { cursor: 'pointer', color: '#cbd5e1', fontSize: 12 } }, 'More image actions'),
            h('div', { style: Object.assign({}, css.row, { marginTop: 8, flexWrap: 'wrap' }) },
              btn(active.keeper ? '★ Keeper' : '☆ Keeper', () => this.toggleKeeper(active.imageId, !active.keeper, active), '#fbbf24'),
              btn('Copy Seed', () => { navigator.clipboard.writeText(String(active.seed)); this.toast('Copied seed ' + active.seed, '#38bdf8'); }, '#94a3b8'),
              btn('Reuse Settings', () => this.reuseSettings(active.imageId), '#94a3b8'),
              btn('Same / New Seed', () => this.generateVariation(active), '#65d66e'),
              this._gate('inpaint') ? btn('Send to Inpaint', () => this.sendToEdit(active.imageId, 'inpaint'), '#a78bfa') : null,
              btn('Detailer', () => this.openDetailer(active.imageId), '#a855f7'),
              btn('Fullscreen', () => openFull(this, active.imageId, base + '/api/images/' + encodeURIComponent(active.imageId)), '#94a3b8'),
              btn('Lineage', () => this.showInLibrary(active.imageId), '#94a3b8')))
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

    if (!res.length && !lab.open) {
      if (this.state.jobStatus === 'generating' || ws.activeJobId) return null;
      return h('div', { style: { marginTop: 8 } },
        h('section', { 'aria-label': 'Image results', className: 'ca-empty-result', style: { border: '1px dashed rgba(148,163,184,.24)', borderRadius: 10, padding: 18, marginBottom: 10, background: 'rgba(16,27,39,.55)' } },
          h('h3', { style: { fontSize: 14, fontWeight: 700, color: '#dbe7f3', margin: 0 } }, 'No image result in this workspace yet'),
          h('p', { style: { color: '#91a2b4', fontSize: 12, lineHeight: 1.5, margin: '6px 0 12px' } }, 'Generated images appear here with their existing review, edit, compare, and export actions. No sample result is shown.'),
          btn('Generate Image', () => this.onGenerate(), '#ef6f61')),
        abPanel, detailerPanel);
    }
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
    // Keep the open Library current if files are added or removed outside the
    // app. Each request uses the bounded server inventory and cached validation.
    this._libraryFreshnessTimer = setInterval(() => {
      const legacy = this.state && this.state.screens && this.state.screens[this.state.version] === 'library';
      const concept = this._ca && this._ca().module === 'library';
      if (legacy || concept) this.loadLibraryImages();
    }, 20000);
    const ws = this._ws();
    this._ensureEditSource();
    if (ws.activeJobId) {
      // The job id survived a reload. Until it is confirmed, the Cancel control must not claim it can stop it.
      this.wsSet({ reconciling: true, interruptState: '', interrupting: false });
      fetch(this.state.backendUrl + '/api/jobs/' + ws.activeJobId).then(r => (r.ok ? r.json() : null)).then(job => {
        this.wsSet({ reconciling: false });
        if (!job) {
          this.wsSet({ activeJobId: null });
          this.setState({ jobStatus: 'idle', progress: 0, errorMsg: '' });
          this.toast('The job that was running before the reload no longer exists on the server.', '#fbbf24');
          return;
        }
        if (!this._jobTerminal(job.status)) {
          this.setState({ jobStatus: 'generating', progress: job.stage && job.stage.determinate ? job.stage.percent : null, jobStage: job.stage || null });
          this.toast('Reattached to the running generation', '#38bdf8');
          this._followCreateJob(job.id, null);
        } else this._onCreateDone(job, null);
      }).catch(() => {
        // Unknown state is not "still running": drop the stale id instead of offering a Cancel that cannot be honoured.
        this.wsSet({ reconciling: false, activeJobId: null, interrupting: false, interruptState: '' });
        this.setState({ jobStatus: 'idle', progress: 0, errorMsg: '' });
        this.toast('Could not confirm the job that was running before the reload. It is no longer offered here as cancellable — check the Job Center.', '#fbbf24');
      });
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
  P.componentWillUnmount = function () { clearInterval(this._queueTimer); clearInterval(this._libraryFreshnessTimer); _unmount.call(this); };

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
    const curScreen = (s.screens && s.screens[s.version]) || 'create';
    const q = Math.max(1, parseInt(ws.quantity, 10) || 1);
    const generating = s.jobStatus === 'generating';
    vals.backendKind = ctl.backend;
    vals.ctlNeg = String(!ctl.negativePrompt);
    vals.ctlCfg = String(!ctl.cfg);
    vals.ctlSched = String(!ctl.scheduler);
    vals.ctlSampler = String(!ctl.sampler);
    vals.samplerValue = D.canonicalSamplerId(s.sampler);
    vals.createWorkbench = this.buildCreateWorkbench(vals.modelsListDisplay);
    vals.createLoraControls = curScreen === 'create' ? this.buildCreateLoraControls() : null;
    vals.promptGuidance = curScreen === 'create' ? (() => {
      const DP = window.DexPrompt, target = this._targetSpec() || {};
      if (!DP) return null;
      const notes = DP.notesForTarget(target, s.prompt, s.negPrompt).join(' ');
      const oneLine = { fontSize: 10, color: '#8888b0', lineHeight: '14px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' };
      const help = DP.syntaxHelp(target), tokens = 'Token count: unknown for this backend (not estimated).';
      return h('div', { style: { display: 'grid', gap: 0, margin: '1px 0 2px', minWidth: 0 } },
        h('small', { className: 'ca-muted', 'data-dex-field': 'prompt-syntax-help', title: help, style: oneLine }, help),
        h('small', { className: 'ca-note', 'data-dex-field': 'prompt-notes', role: 'status', hidden: !notes, style: { fontSize: 10, margin: '2px 0' } }, notes),
        h('small', { className: 'ca-muted', 'data-dex-field': 'token-count', title: tokens, style: oneLine }, tokens));
    })() : null;
    if (curScreen === 'create' && this.buildStylesPanel && this._sty) {
      // V2 loads the style list once, when Create first renders (with the other start-up loads), never as a side effect of
      // opening the panel: a late re-render there would rebuild the form under the user's hands.
      const st = this._sty();
      if (!st.loaded && !st.tried) { st.tried = true; setTimeout(() => this.caLoadStyles(), 0); }
    }
    vals.createStyles = curScreen === 'create' && this.buildStylesPanel ? this.buildStylesPanel() : null;
    vals.v2Drawer = this.buildV2Drawer ? this.buildV2Drawer() : null;
    vals.createSampling = curScreen === 'create' && this.buildV2Sampling ? this.buildV2Sampling() : null;
    vals.fileVerificationPanel = curScreen === 'models' ? this.buildFileVerificationPanel() : null;
    vals.pixelSizeText = (() => { const w = parseInt(s.width, 10) || 0, hh = parseInt(s.height, 10) || 0; return w + ' × ' + hh + ' px · ' + ((w * hh) / 1e6).toFixed(2) + ' MP · ' + (w === hh ? 'square' : w > hh ? 'landscape' : 'portrait'); })();
    vals.resultStaging = this.buildResultStaging();
    vals.batchWorkspace = this.buildBatchWorkspace();
    vals.enhanceWorkbench = this.buildEnhanceWorkbench();
    vals.libraryWorkbench = this.buildLibraryWorkbench();
    vals.doctorPanel = this.buildDoctorPanel();
    vals.generateLabel = generating ? 'Generating' + (q > 1 ? ' ' + q + ' images' : '') + '… ' + ((s.jobStage || {}).label || 'Waiting for backend') + ((s.jobStage || {}).determinate ? ' · ' + s.jobStage.percent + '%' : '') : q > 1 ? 'Generate ' + q + ' Images' : 'Generate Image';
    return vals;
  };
})();
