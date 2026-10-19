// DexDiffusion Edit workbench (img2img / Inpaint / Outpaint) and the shared widgets used by
// Create and Edit: Resources (LoRA/VAE), model picker and preset bar.
//
// Design rules (see docs/edit-workbench-20261002.md):
//   * ONE authoritative entry: openImageInEdit(imageId, mode). It loads THAT image's recorded
//     generation record (/api/images/:id/meta → recall) and builds the Edit operation state from
//     it only — never from Create's form.
//   * ONE operation state (this.ed.state) feeds both layouts (Compact / Studio) and one Run control.
//   * Text inputs write straight into state on `input` and do NOT re-render, so a click on Run
//     right after typing can never be lost to a DOM rebuild.
//   * The mask lives in SOURCE IMAGE coordinates inside one transformed stage (image + canvas),
//     so zoom/pan/resize can never misalign it.
//   * Every failure is shown with its stage and message; nothing is swallowed.
(function () {
  'use strict';
  const C = window.DexDiffusionComponent;
  if (!C) return;
  const P = C.prototype;
  const h = (...a) => React.createElement(...a);
  const D = window.DexClient, E = window.DexEdit;
  const UI = window.DexUI || {};
  const css = UI.css || {};
  const tone = UI.tone || { ok: '#65d66e', warn: '#fbbf24', bad: '#f87171', info: '#38bdf8', off: '#94a3b8' };
  const btn = UI.btn, chip = UI.chip;
  const LAYOUT_KEY = 'dex_edit_layout';
  const SCRIPTS_KEY = 'dex_edit_scripts';
  const OPS = [['img2img', 'img2img'], ['inpaint', 'Inpaint'], ['outpaint', 'Outpaint']];
  const OP_LABEL = { img2img: 'img2img', inpaint: 'Inpaint', outpaint: 'Outpaint' };
  // Stock A1111 scripts available per operation (script-chains.js). Each runs one real sd-cli pass per tile / loop / direction.
  const SCRIPT_OP = { 'sd-upscale': 'img2img', loopback: 'img2img', 'outpaint-poor': 'outpaint', 'outpaint-mk2': 'outpaint' };
  const SCRIPT_LABEL = { 'sd-upscale': 'SD upscale', loopback: 'Loopback', 'outpaint-poor': "Poor man's outpainting", 'outpaint-mk2': 'Outpainting mk2' };
  const SCRIPT_DEFAULTS = {
    'sd-upscale': { scale: 2, overlap: 64, tile_width: 512, tile_height: 512, upscaler: 'lanczos' },
    loopback: { loops: 4, final_strength: 0.5, curve: 'Linear' },
    'outpaint-poor': { pixels: 128, mask_blur: 4, masked_content: 'fill', directions: ['left', 'right', 'up', 'down'] },
    'outpaint-mk2': { pixels: 128, mask_blur: 8, noise_q: 1, color_variation: 0.05, directions: ['left', 'right', 'up', 'down'] },
  };
  const SAMPLERS = ['euler_a', 'euler', 'heun', 'dpm2', 'dpm2_a', 'lms', 'dpmpp2s_a', 'dpmpp2m', 'dpmpp2mv2', 'ipndm', 'ipndm_v', 'lcm'];
  const SCHEDULERS = ['discrete', 'karras', 'exponential', 'ays', 'sgm_uniform', 'simple'];
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const short = id => { const s = String(id || ''); return s.length > 44 ? s.slice(0, 20) + '…' + s.slice(-20) : s; };
  const label = (t, ...kids) => h('label', { style: { display: 'grid', gap: 4, minWidth: 0 } }, h('span', { style: css.label }, t), ...kids);
  const pillStyle = (c) => ({ border: '1px solid ' + c + '55', color: c, background: c + '12', borderRadius: 6, padding: '2px 7px', fontSize: 10, fontWeight: 700 });

  // ── state ─────────────────────────────────────────────────────────────
  P._ed = function () {
    if (this.ed) return this.ed;
    let layout = 'compact';
    try { const v = localStorage.getItem(LAYOUT_KEY); if (v === 'studio' || v === 'compact') layout = v; } catch (_) {}
    this._snaps = this._snaps || new Map();        // imageId → in-memory sensitive snapshot (never persisted)
    this.ed = { layout, op: 'img2img', source: null, state: null, loading: null, error: null, run: { status: 'idle' }, results: [], active: 0,
      outpaint: { left: 0, right: 128, top: 0, bottom: 0 }, prep: 'none', resize: { mode: '', kind: 'to', w: '', h: '', by: '', bg: '#ffffff' }, exactSteps: false, inpaint: { area: 'whole', padding: 32, blur: 4, content: 'original', w: 512, h: 512 }, ext: '', maskInfo: null, assets: null, assetsFor: null, log: null,
      brush: { mode: 'paint', size: 40 }, openSections: {}, attempt: null, presetName: '' };
    return this.ed;
  };
  P.edSet = function (patch) { Object.assign(this._ed(), typeof patch === 'function' ? patch(this._ed()) : patch); this.setState({ _edTick: (this.state._edTick || 0) + 1 }); };
  P.edQuiet = function (patch) { Object.assign(this._ed(), patch); }; // state write without a re-render
  // Edit runs on the model the edit worker actually loads (server: editWorkerTarget = sdcpp.env REMOTE_MODEL), never the
  // secondary slot: offering other checkpoints here made the choice a silent no-op and mislabelled the results.
  P._editTargets = function () {
    const usable = (this.state.modelTargets || []).filter(t => (t.backend || 'sdcpp') !== 'mflux' && !['model-missing', 'dormant'].includes(t.runtime) && String(t.status).toLowerCase() !== 'broken');
    const worker = this.state.capabilityData && this.state.capabilityData.editWorkerTarget;
    return worker ? usable.filter(t => t.id === worker) : usable;
  };
  P._activeSecondary = function () { return (this.state.modelState && this.state.modelState.activeSecondaryModel) || (this.state.systemInfo && this.state.systemInfo.modelState && this.state.systemInfo.modelState.activeSecondaryModel) || null; };
  P._rememberSnapshot = function (imageId, body, seed) {
    if (!imageId || !body || !body.prompt) return;
    this._snaps = this._snaps || new Map();
    this._snaps.set(imageId, E.snapshotFromRequest(body, imageId, seed));
    while (this._snaps.size > 200) this._snaps.delete(this._snaps.keys().next().value);
  };

  // A private, in-memory comparison baseline. Prompt text and mask bytes are never
  // written to storage by this guard.
  P._editDraftSnapshot = function () {
    const ed = this._ed();
    if (!ed.source) return null;
    const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
    const snapshot = {
      source: ed.source.key || ed.source.imageId || ed.source.stagedId || null,
      operation: ed.op,
      state: clone(ed.state),
      outpaint: clone(ed.outpaint), outpaintStrength: ed.outpaintStrength, ext: ed.ext,
      prep: ed.prep, resize: clone(ed.resize), exactSteps: ed.exactSteps,
      inpaint: clone(ed.inpaint), script: clone(ed.script || { kind: '', opts: {} }),
      mask: this._mask && this._mask.key === ed.source.key ? this._maskDataUrl() : null,
    };
    const stable = value => Array.isArray(value) ? value.map(stable)
      : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]))
      : value;
    return JSON.stringify(stable(snapshot));
  };
  P._editDraftIsDirty = function () {
    if (!this._ed().source || this._editDraftBaseline == null) return false;
    return this._editDraftSnapshot() !== this._editDraftBaseline;
  };
  P._confirmEditDraftDiscard = function (nextAction) {
    if (!this._editDraftIsDirty()) return true;
    const source = this._ed().source;
    return window.confirm(`Discard unsaved Edit changes for ${source.imageId || 'this temporary source'} and ${nextAction}? The source image itself remains unchanged.`);
  };

  // ── authoritative entry point ─────────────────────────────────────────
  // Resolve the exact image, load ITS generation record, populate the shared Edit
  // state, make sure the pixels load, then show what was recalled. Fails visibly.
  P.openImageInEdit = async function (imageId, mode, opts) {
    const o = opts || {};
    const ed = this._ed();
    const op = OPS.some(x => x[0] === mode) ? mode : (ed.op || 'img2img');
    const replacing = !!(ed.source && (ed.source.imageId || ed.source.key) !== imageId);
    if (replacing && !this._confirmEditDraftDiscard('open ' + imageId)) return false;
    if (!o.quiet && !this._confirmWorkspaceLeave('edit')) return false;
    const acceptedDraft = replacing ? this._editDraftSnapshot() : null;
    const requestId = this._editOpenRequestId = (this._editOpenRequestId || 0) + 1;
    const r = await this._api('/api/images/' + encodeURIComponent(imageId) + '/meta');
    if (requestId !== this._editOpenRequestId) return false;
    if (!r.ok) {
      const message = 'Could not load the source image record (' + (r.data && r.data.error || ('HTTP ' + r.status)) + '). The current Edit draft was preserved.';
      if (!ed.source) this.edSet({ error: { stage: 'load-source', message, imageId } });
      this.toast(message, '#ef4444');
      return false;
    }
    const view = r.data;
    const recall = view.recall || E.buildRecall(view);
    const st = E.applyRecallToEdit(recall, { snapshot: this._snaps && this._snaps.get(imageId), op, targets: this._editTargets().concat(this.state.modelTargets || []), activeSecondary: this._activeSecondary(), editWorker: this.state.capabilityData && this.state.capabilityData.editWorkerTarget });
    const url = this.state.backendUrl + view.url;
    const loaded = await new Promise(res => { const im = new Image(); im.onload = () => res(true); im.onerror = () => res(false); im.src = url; });
    if (requestId !== this._editOpenRequestId) return false;
    if (!loaded) {
      if (!ed.source) this.edSet({ error: { stage: 'load-pixels', message: 'The source image file could not be loaded: ' + view.id, imageId } });
      this.toast('Source image failed to load', '#ef4444');
      return false;
    }
    if (acceptedDraft !== null && this._editDraftSnapshot() !== acceptedDraft) {
      this.toast('Edit changed while the new source was loading. The current draft was kept; review it and retry the source change.', '#fbbf24');
      return false;
    }
    const src = { key: imageId, imageId, staged: false, url: view.url, width: view.width, height: view.height, meta: view.meta, parent: view.parent, keeper: view.keeper, recall };
    this._maskFor(src, true);
    const ws = this._ws();
    this.wsSet({ editSourceId: imageId, editSource: view, editOriginalId: o.chain && ws.editOriginalId ? ws.editOriginalId : imageId, editFocusChain: !!o.chain });
    this.edSet({ loading: null, error: null, source: src, state: st, op, run: { status: 'idle' }, log: null, maskInfo: null });
    this._editDraftBaseline = this._editDraftSnapshot();
    this.setActiveAssetSelection && this.setActiveAssetSelection({ kind: 'image', id: imageId });
    if (!o.quiet) this.setScreen('edit', { skipUnsavedGuard: true });
    this.loadEditAssets();
    if (!o.quiet) this.toast('Loaded ' + short(imageId) + (st.recalledFrom.recorded ? ' with its recorded settings' : ' (no recorded settings)'), '#a78bfa');
    return true;
  };
  P.sendToEdit = function (id, focus) { return this.openImageInEdit(id, focus); };
  P.useAsNewSource = function (id) { return this.openImageInEdit(id, this._ed().op, { chain: true }); };
  P.returnToOriginal = function () { const ws = this._ws(); if (ws.editOriginalId) this.openImageInEdit(ws.editOriginalId, this._ed().op); };
  P.sendActiveResultToEdit = function (op) {
    const a = this._activeResult && this._activeResult();
    if (!a || !a.imageId) { this.toast('Generate or select an image first — nothing to send to Edit yet.', '#fbbf24'); return; }
    return this.openImageInEdit(a.imageId, op || 'img2img');
  };
  P._ensureEditSource = async function () {
    const ed = this._ed(), ws = this._ws();
    if (!ed.source && ws.editSourceId && !String(ws.editSourceId).startsWith('staged:') && !ed.loading && !ed.error) this.openImageInEdit(ws.editSourceId, ed.op, { quiet: true });
    if (ws.enhSourceId && (!ws.enhSource || ws.enhSource.id !== ws.enhSourceId)) {
      const m = await this._imageMeta(ws.enhSourceId);
      this.wsSet(m ? { enhSource: m } : { enhSourceId: null, enhSource: null });
    }
  };
  // Staged (imported) sources have no generation record: neutral defaults, said plainly.
  P.importEditSource = async function (file) {
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) { this.toast('Image too large (25 MB max)', '#ef4444'); return; }
    if (!this._confirmEditDraftDiscard('import this image') || !this._confirmWorkspaceLeave('edit')) return false;
    const r = await fetch(this.state.backendUrl + '/api/staging?accept=image', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file });
    const d = await r.json().catch(() => ({ error: r.statusText }));
    if (!r.ok) { this.toast(d.error || 'Import rejected', '#ef4444'); return; }
    const recall = { schema: E.RECALL_SCHEMA, imageId: 'staged:' + d.id, recorded: false, params: { loras: [] }, missing: [], prompt: { available: false, reason: 'Imported images carry no generation record' } };
    const st = E.applyRecallToEdit(recall, { op: this._ed().op, targets: this._editTargets(), activeSecondary: this._activeSecondary(), editWorker: this.state.capabilityData && this.state.capabilityData.editWorkerTarget });
    const src = { key: 'staged:' + d.id, imageId: null, staged: true, stagedId: d.id, url: d.url, width: d.width, height: d.height, meta: { operation: 'imported (temporary)' }, recall };
    this._maskFor(src, true);
    this.wsSet({ editSourceId: 'staged:' + d.id, editSource: Object.assign({ id: d.id, stagedId: d.id, staged: true, meta: src.meta }, { url: d.url, width: d.width, height: d.height }), editOriginalId: 'staged:' + d.id });
    st.params.width = d.width; st.params.height = d.height;
    this._editDraftBaseline = null;
    this.setScreen('edit', { skipUnsavedGuard: true });
    this.edSet({ source: src, state: st, loading: null, error: null, run: { status: 'idle' }, maskInfo: null });
    this._editDraftBaseline = this._editDraftSnapshot();
    this.toast('Imported ' + d.width + '×' + d.height + ' as a temporary source', '#a78bfa');
  };

  // ── resources (LoRA / VAE) — shared by Create and Edit ───────────────────
  P.loadEditAssets = async function () {
    const ed = this._ed(), t = ed.state && ed.state.editModel;
    if (!t || ed.assetsFor === t) return;
    ed.assetsFor = t;
    const r = await this._api('/api/extra-networks?target=' + encodeURIComponent(t));
    if (r.ok) this.edSet({ assets: { loras: r.data.loras || [], vaes: r.data.vaes || [] } });
  };
  function compatOf(l, catalog) {
    const c = (catalog || []).find(x => String(x.filename || x.name || '').replace(/\.[^.]+$/, '') === l.name || x.name === l.name);
    if (!c) return { state: 'unknown', label: 'not in catalog', color: tone.off, item: null };
    if (c.compatibility === 'Compatible') return { state: 'ok', label: 'compatible', color: tone.ok, item: c };
    if (c.compatibility === 'Probably compatible') return { state: 'warn', label: 'probably compatible', color: tone.warn, item: c };
    if (c.compatibility === 'Incompatible') return { state: 'bad', label: 'incompatible', color: tone.bad, item: c };
    return { state: 'unknown', label: c.compatibility || 'unverified', color: tone.off, item: c };
  }
  // LoRAs that will actually be sent: incompatible ones are held back unless the user overrides.
  P._effectiveLoras = function (loras, catalog) {
    return E.normalizeLoras(loras).filter(l => l.override || compatOf(l, catalog).state !== 'bad').map(l => ({ name: l.name, weight: l.weight }));
  };
  // cfg: { scope, loras, setLoras(fn(loras)->loras), catalog, vaes, vae, setVae, showVae, onTrigger, modelLabel }
  P.buildResourcesControl = function (cfg) {
    const loras = cfg.loras || [], catalog = cfg.catalog || [];
    const rows = loras.map(l => {
      const cp = compatOf(l, catalog), item = cp.item;
      const out = h('span', { style: { color: '#38bdf8', fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, minWidth: 34 } }, E.formatWeight(l.weight));
      return h('div', { key: l.name, 'data-lora': l.name, style: { border: '1px solid ' + (cp.state === 'bad' ? '#f8717177' : 'rgba(148,163,184,.18)'), borderRadius: 8, padding: 8, display: 'grid', gap: 6, background: 'rgba(8,14,24,.7)' } },
        h('div', { style: css.row }, h('b', { style: { color: '#e2e8f0', fontSize: 12, fontFamily: "'IBM Plex Mono',monospace" } }, l.name),
          h('span', { style: pillStyle(cp.color) }, '● ' + cp.label), item && item.family ? h('span', { style: pillStyle('#94a3b8') }, String(item.family).toUpperCase()) : null,
          h('div', { style: { flex: 1 } }),
          h('button', { type: 'button', 'aria-label': 'Remove LoRA ' + l.name, onClick: () => cfg.setLoras(a => a.filter(x => x.name !== l.name)), style: { border: 0, background: 'transparent', color: '#f87171', cursor: 'pointer', fontSize: 16, minWidth: 32, minHeight: 32 } }, '×')),
        h('div', { style: css.row }, h('span', { style: css.muted }, 'Weight'),
          h('input', { type: 'range', min: '-2', max: '2', step: '0.05', value: String(l.weight), 'aria-label': 'Weight for ' + l.name, style: { flex: '1 1 140px', minHeight: 28 },
            onInput: e => { const w = E.clampWeight(e.target.value); l.weight = w; out.textContent = E.formatWeight(w); cfg.quiet && cfg.quiet(l.name, w); }, onChange: e => cfg.setLoras(a => a.map(x => x.name === l.name ? Object.assign({}, x, { weight: E.clampWeight(e.target.value) }) : x)) }), out),
        cp.state === 'bad' ? h('div', { role: 'alert', style: { color: tone.bad, fontSize: 11 } }, '⚠ Incompatible with ' + (cfg.modelLabel || 'this model') + ' — held back from the request. ',
          h('button', { type: 'button', onClick: () => cfg.setLoras(a => a.map(x => x.name === l.name ? Object.assign({}, x, { override: !x.override }) : x)), style: { border: 0, background: 'transparent', color: '#fde68a', cursor: 'pointer', textDecoration: 'underline', fontSize: 11 } }, l.override ? 'Excluding again' : 'Use anyway')) : null,
        item && item.trigger_words && item.trigger_words.length ? h('div', { style: css.row }, h('span', { style: css.muted }, 'Triggers'), ...item.trigger_words.map(w => h('button', { key: w, type: 'button', onClick: () => cfg.onTrigger && cfg.onTrigger(w), title: 'Add to prompt', style: { border: '1px solid rgba(56,189,248,.3)', background: 'rgba(56,189,248,.08)', color: '#7dd3fc', borderRadius: 5, padding: '2px 7px', fontSize: 10, cursor: 'pointer' } }, '+ ' + w))) : null);
    });
    const chosen = new Set(loras.map(l => l.name));
    const avail = catalog.filter(c => !chosen.has(String(c.filename || c.name).replace(/\.[^.]+$/, '')));
    const add = catalog.length ? h('select', { 'aria-label': 'Add LoRA', value: '', style: Object.assign({}, css.input, { maxWidth: 360 }),
      onChange: e => { const c = catalog.find(x => (x.filename || x.name) === e.target.value); if (c) cfg.setLoras(a => a.concat([{ name: String(c.filename || c.name).replace(/\.[^.]+$/, ''), weight: Number(c.default_weight) || 0.8 }])); } },
      h('option', { value: '' }, avail.length ? '＋ Add LoRA… (' + avail.length + ' available)' : 'All discovered LoRAs are active'),
      ...avail.map(c => h('option', { key: c.id || c.filename, value: c.filename || c.name }, (c.name || c.filename) + ' — ' + (c.compatibility || 'unverified') + (c.family ? ' · ' + c.family : '')))) : null;
    const vae = cfg.showVae && cfg.setVae ? label('VAE', h('select', { value: cfg.vae || 'auto', style: css.input, onChange: e => cfg.setVae(e.target.value) },
      h('option', { value: 'auto' }, 'Default / backend-selected'), h('option', { value: 'none' }, 'None'), ...(cfg.vaes || []).map(v => h('option', { key: v.id || v.filename, value: v.id || v.filename }, v.name || v.filename)))) : null;
    return h('div', { 'data-resources': cfg.scope, style: { border: '1px solid rgba(167,139,250,.28)', borderRadius: 9, padding: 10, display: 'grid', gap: 8, background: 'rgba(14,10,28,.35)', minWidth: 0 } },
      h('div', { style: css.row }, h('div', { style: css.title }, 'Resources · LoRA' + (cfg.showVae ? ' & VAE' : '')), h('span', { style: pillStyle(loras.length ? '#a78bfa' : '#94a3b8') }, loras.length + ' active'),
        h('div', { style: { flex: 1 } }), cfg.modelLabel ? h('span', { style: css.muted }, 'for ' + cfg.modelLabel) : null),
      ...rows,
      add, !catalog.length ? h('div', { style: css.muted }, 'No LoRAs are installed on Big Mac (expected at /Volumes/wc2tb/ImageGen/loras), so none can be added. Active ones recalled from a source image still show above.') : null,
      vae);
  };

  // ── model picker (concise, searchable, grouped) ────────────────────────
  // Imperative DOM so typing in the search box never loses focus; `update()` refreshes it each render.
  P._modelPicker = function (ctx) {
    this._pickers = this._pickers || {};
    if (this._pickers[ctx]) return this._pickers[ctx];
    const self = this;
    const q = { open: false, query: '', family: 'all', readyOnly: false, favOnly: false };
    const props = { targets: [], cards: [], activeId: null, onPick: () => {}, ctx };
    // Favourite models (several at once) persist per browser; the set is shared by Create and Edit pickers.
    const FAV_KEY = 'dexdiffusion.model.favorites.v1';
    const favs = () => { try { const a = JSON.parse(localStorage.getItem(FAV_KEY) || '[]'); return new Set(Array.isArray(a) ? a.filter(x => typeof x === 'string') : []); } catch (_) { return new Set(); } };
    const saveFavs = set => { try { localStorage.setItem(FAV_KEY, JSON.stringify([...set])); } catch (_) {} };
    // A distinct local icon per model: monogram on a hue derived from the id. No remote images, nothing hotlinked.
    const iconFor = (id, label) => { let h = 0; for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; const initials = (String(label || id).match(/[A-Za-z0-9]+/g) || ['?']).slice(0, 2).map(w => w[0].toUpperCase()).join('');
      const n = document.createElement('span'); n.setAttribute('aria-hidden', 'true'); n.setAttribute('data-model-icon', id); n.textContent = initials;
      n.style.cssText = `flex:0 0 auto;width:30px;height:30px;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;font:800 11px DM Sans,sans-serif;color:#0b1420;background:hsl(${h % 360} 60% 62%);`; return n; };
    const root = document.createElement('div'); root.style.cssText = 'position:relative;min-width:0;'; root.setAttribute('data-model-picker', ctx);
    const trigger = document.createElement('button'); trigger.type = 'button'; trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.style.cssText = 'width:100%;text-align:left;border:1px solid rgba(148,163,184,.25);background:#0b1420;color:#e8f0f7;border-radius:8px;padding:8px 10px;min-height:42px;cursor:pointer;display:flex;gap:8px;align-items:center;font:600 13px DM Sans,system-ui,sans-serif;';
    const panel = document.createElement('div'); panel.setAttribute('role', 'listbox'); panel.setAttribute('aria-label', 'Model choices');
    panel.style.cssText = 'display:none;position:absolute;z-index:60;left:0;right:0;top:calc(100% + 4px);min-width:min(100%,320px);max-height:min(60vh,460px);overflow:auto;border:1px solid rgba(148,163,184,.3);background:#0a111c;border-radius:10px;box-shadow:0 14px 40px rgba(0,0,0,.6);padding:8px;';
    const search = document.createElement('input'); search.type = 'search'; search.placeholder = 'Search models…'; search.setAttribute('aria-label', 'Search models');
    search.style.cssText = 'width:100%;border:1px solid rgba(148,163,184,.25);background:#05080d;color:#e2e8f0;border-radius:7px;padding:8px;min-height:36px;margin-bottom:6px;font:13px DM Sans,system-ui,sans-serif;';
    const chips = document.createElement('div'); chips.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px;';
    const list = document.createElement('div');
    const foot = document.createElement('div'); foot.style.cssText = 'margin-top:6px;font:11px DM Sans,sans-serif;color:#8193a8;';
    panel.append(search, chips, list, foot); root.append(trigger, panel);
    const mk = (tag, css2, text) => { const n = document.createElement(tag); n.style.cssText = css2; if (text != null) n.textContent = text; return n; };
    const chipEl = (text, active, fn) => { const b = mk('button', `border:1px solid ${active ? '#38bdf8' : 'rgba(148,163,184,.25)'};background:${active ? 'rgba(56,189,248,.16)' : 'transparent'};color:${active ? '#7dd3fc' : '#a8b6c8'};border-radius:999px;padding:3px 10px;min-height:28px;font:700 11px DM Sans,sans-serif;cursor:pointer;`, text); b.type = 'button'; b.addEventListener('click', fn); return b; };
    function draw() {
      const g = E.groupModels(props.targets, props.cards, { query: q.query, family: q.family, readyOnly: q.readyOnly, activeId: props.activeId });
      const fv = favs();
      if (q.favOnly) { g.groups = g.groups.map(gr => Object.assign({}, gr, { items: gr.items.filter(it => fv.has(it.id)) })).filter(gr => gr.items.length); g.shown = g.groups.reduce((n, gr) => n + gr.items.length, 0); }
      chips.replaceChildren(chipEl('All', q.family === 'all', () => { q.family = 'all'; draw(); }), ...g.families.map(f => chipEl(f.label, q.family === f.family, () => { q.family = f.family; draw(); })), chipEl('★ Favorites', q.favOnly, () => { q.favOnly = !q.favOnly; draw(); }), chipEl('Ready only', q.readyOnly, () => { q.readyOnly = !q.readyOnly; draw(); }));
      list.replaceChildren(...(g.groups.length ? g.groups.flatMap(gr => [mk('div', 'font:800 10px DM Sans,sans-serif;letter-spacing:.1em;text-transform:uppercase;color:#7f8ca8;padding:8px 4px 3px;', gr.label + ' · ' + gr.items.length),
        ...gr.items.map(it => { const row = mk('button', `display:grid;gap:2px;width:100%;text-align:left;border:1px solid ${it.active ? '#65d66e' : 'transparent'};background:${it.active ? 'rgba(101,214,110,.08)' : 'transparent'};color:#e2e8f0;border-radius:7px;padding:7px 8px;min-height:44px;cursor:pointer;font:13px DM Sans,sans-serif;`);
          row.type = 'button'; row.setAttribute('role', 'option'); row.setAttribute('aria-selected', String(it.active)); row.setAttribute('data-model-id', it.id);
          const top = mk('div', 'display:flex;gap:6px;align-items:center;flex-wrap:wrap;'); top.append(iconFor(it.id, it.label), mk('b', 'font-weight:700;', it.label), ...(it.primary ? [mk('span', 'font-size:10px;color:#fbbf24;', '★ primary')] : []),
            mk('span', `font-size:10px;font-weight:700;border:1px solid ${it.readiness.ok ? '#65d66e55' : '#f8717155'};color:${it.readiness.ok ? '#86efac' : '#fca5a5'};border-radius:5px;padding:1px 6px;`, it.readiness.label), mk('span', 'font-size:10px;color:#7f8ca8;', it.backend.toUpperCase()));
          row.append(top, mk('div', 'font-size:11px;color:#8193a8;line-height:1.35;', it.blurb)); row.disabled = !it.readiness.ok && it.readiness.key !== 'available';
          row.addEventListener('click', () => {
            close(); trigger.focus();   // synchronously: the option that had focus was just hidden, so focus would otherwise sit on <body> until the next frame
            const done = props.onPick(it.id); requestAnimationFrame(() => trigger.focus());
            guardFocus(done);
          });
          const star = mk('button', `flex:0 0 auto;min-width:40px;min-height:44px;border:1px solid transparent;background:transparent;color:${fv.has(it.id) ? '#fbbf24' : '#64748b'};font-size:18px;cursor:pointer;border-radius:7px;`, fv.has(it.id) ? '★' : '☆');
          star.type = 'button'; star.setAttribute('data-model-fav', it.id); star.setAttribute('aria-pressed', String(fv.has(it.id))); star.setAttribute('aria-label', (fv.has(it.id) ? 'Remove ' : 'Add ') + it.label + (fv.has(it.id) ? ' from favorites' : ' to favorites'));
          star.addEventListener('click', ev => { ev.stopPropagation(); const f2 = favs(); if (f2.has(it.id)) f2.delete(it.id); else f2.add(it.id); saveFavs(f2); draw(); });
          const wrap = mk('div', 'display:flex;gap:2px;align-items:stretch;'); row.style.flex = '1 1 auto'; row.style.minWidth = '0'; wrap.append(row, star); return wrap; })]) : [mk('div', 'color:#8193a8;font-size:12px;padding:10px;', 'No models match.')]));
      foot.textContent = g.shown + ' of ' + g.total + ' models';
      const a = props.targets.find(t => t.id === props.activeId), c = props.cards.find(x => x.id === props.activeId), fam = a ? E.familyOf(c && c.family ? { family: c.family, id: a.id } : a) : '';
      const rd = E.readinessOf(a);
      trigger.replaceChildren(mk('span', 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;', (a && (a.label || a.id)) || props.activeId || 'Choose a model'),
        mk('span', 'font-size:10px;color:#7f8ca8;', E.FAMILY_LABEL[fam] || ''), mk('span', `font-size:10px;font-weight:700;color:${rd.ok ? '#86efac' : '#fca5a5'};`, a ? rd.label : ''), mk('span', 'color:#7f8ca8;', q.open ? '▴' : '▾'));
      trigger.setAttribute('aria-expanded', String(q.open));
    }
    // A model switch is asynchronous (a secondary-model activation takes seconds, then the screen re-renders and can drop focus to
    // <body>). Until the switch settles, give focus back to the picker whenever it falls to <body>; any key press or pointer
    // action by the user ends the guard immediately so it never fights real navigation.
    let guardStop = null;
    function guardFocus(done) {
      if (guardStop) guardStop();
      let finished = false;
      const tick = () => { const a = document.activeElement; if (trigger.isConnected && (!a || a === document.body)) trigger.focus(); };
      const timer = setInterval(tick, 120);
      const hard = setTimeout(stop, 30000);
      const user = () => stop();
      function stop() { if (finished) return; finished = true; clearInterval(timer); clearTimeout(hard); document.removeEventListener('keydown', user, true); document.removeEventListener('pointerdown', user, true); guardStop = null; }
      guardStop = stop;
      document.addEventListener('keydown', user, true); document.addEventListener('pointerdown', user, true);
      Promise.resolve(done).catch(() => {}).then(() => setTimeout(() => { tick(); stop(); }, 1500));
    }
    function close() { q.open = false; panel.style.display = 'none'; trigger.setAttribute('aria-expanded', 'false'); draw(); }
    function open() { q.open = true; panel.style.display = 'block'; draw(); setTimeout(() => search.focus(), 0); }
    trigger.addEventListener('click', () => (q.open ? close() : open()));
    search.addEventListener('input', () => { q.query = search.value; draw(); });
    panel.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); trigger.focus(); return; }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
      const options = [...list.querySelectorAll('[role="option"]:not(:disabled)')];
      if (!options.length) return;
      e.preventDefault();
      const current = options.indexOf(document.activeElement);
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? options.length - 1
        : e.key === 'ArrowDown' ? (current + 1) % options.length : (current <= 0 ? options.length - 1 : current - 1);
      options[next].focus();
    });
    document.addEventListener('click', e => { if (q.open && !root.contains(e.target)) close(); }, true);
    const shell = document.createElement('div');
    if (ctx === 'create') { const lb = document.createElement('div'); lb.textContent = 'Model'; lb.style.cssText = 'font-size:10px;color:#6090a8;text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px;'; shell.append(lb, root); } else shell.append(root);
    const picker = { root, shell, update(p) {
      const had = document.activeElement === search; Object.assign(props, p); draw();
      if (had && q.open) requestAnimationFrame(() => { if (q.open && document.activeElement !== search) { const s0 = search.selectionStart; search.focus(); try { search.setSelectionRange(s0, s0); } catch (_) {} } });
    } };
    this._pickers[ctx] = picker;
    return picker;
  };
  P.buildModelPicker = function (ctx, targets, activeId, onPick) {
    const pk = this._modelPicker(ctx);
    pk.update({ targets, cards: this.state.modelCards || [], activeId, onPick });
    return pk.shell;
  };

  // ── presets (versioned recipes) — shared by Create and Edit ───────────────
  P.persistRecipes = function (list) { try { localStorage.setItem('dex_favorite_presets', JSON.stringify(list)); } catch (_) {} this.setState({ favoritePresets: list }); };
  P.saveRecipe = function (mode, settings, name) {
    const nm = String(name || '').trim() || (OP_LABEL[mode] || 'Create') + ' ' + new Date().toLocaleTimeString();
    const r = E.migrateRecipe(Object.assign({ id: String(Date.now()), name: nm, mode }, settings), !!this.state.savePrompts);
    const list = [r].concat((this.state.favoritePresets || []).filter(p => !(p.name === nm && (p.mode || 'create') === mode))).slice(0, 60);
    this.persistRecipes(list);
    this.toast('Saved ' + (OP_LABEL[mode] || 'Create') + ' preset "' + nm + '"' + (this.state.savePrompts ? '' : ' — settings only (prompt saving is off)'), '#38bdf8');
    return r;
  };
  P.buildPresetBar = function (mode, onApply, getSettings) {
    const all = E.recipesForMode(this.state.favoritePresets, mode);
    const nameKey = '_presetName_' + mode;
    const sel = h('select', { 'aria-label': 'Saved presets', style: Object.assign({}, css.input, { flex: '1 1 160px', width: 'auto' }), onChange: e => { const r = all.find(x => x.id === e.target.value); if (r) onApply(r); e.target.value = ''; }, value: '' },
      h('option', { value: '' }, all.length ? 'Apply preset… (' + all.length + ')' : 'No presets yet'), ...all.map(r => h('option', { key: r.id, value: r.id }, r.name + (r.promptSaved ? ' · with prompt' : ''))));
    const nameIn = h('input', { value: this[nameKey] || '', placeholder: 'Preset name', 'aria-label': 'New preset name', style: Object.assign({}, css.input, { flex: '1 1 130px', width: 'auto' }), onInput: e => { this[nameKey] = e.target.value; } });
    return h('div', { 'data-presets': mode, style: { display: 'grid', gap: 6 } },
      h('div', { style: css.row }, sel, nameIn, btn('Save preset', () => { this.saveRecipe(mode, getSettings(), this[nameKey]); this[nameKey] = ''; }, '#38bdf8'),
        all.length ? btn('Delete…', () => { const pick = window.prompt('Delete which preset? Type its exact name:\n' + all.map(r => '• ' + r.name).join('\n')); const r = all.find(x => x.name === (pick || '').trim()); if (r) this.persistRecipes(this.state.favoritePresets.filter(x => x.id !== r.id)); }, '#94a3b8') : null),
      h('div', { style: css.muted }, 'Presets keep settings and resources, never the source image. ' + (this.state.savePrompts ? 'Prompt saving is ON: prompt text is stored with new presets.' : 'Prompt saving is OFF: prompt text is NOT stored in presets.')));
  };
  P.editPresetSettings = function () {
    const st = this._ed().state; if (!st) return {};
    const p = st.params, ed = this._ed();
    const s = { target: st.editModel, steps: p.steps, cfg: p.cfg, sampler: p.sampler, scheduler: p.scheduler, vae: p.vae, strength: ed.op === 'outpaint' ? ed.outpaintStrength : p.strength, loras: st.loras, prompt: st.prompt, negPrompt: st.negative };
    if (ed.op === 'outpaint') s.outpaint = Object.assign({}, ed.outpaint, { strength: ed.outpaintStrength });
    return s;
  };
  P.applyEditRecipe = function (r) {
    const ed = this._ed(), st = ed.state; if (!st) { this.toast('Open an image in Edit first, then apply a preset.', '#fbbf24'); return; }
    const p = Object.assign({}, st.params);
    for (const k of ['steps', 'cfg', 'sampler', 'scheduler', 'vae']) if (r[k] !== undefined) p[k] = r[k];
    if (r.strength !== undefined) p.strength = r.strength;
    const next = Object.assign({}, st, { params: p, loras: r.loras ? E.normalizeLoras(r.loras) : st.loras });
    if (r.target && this._editTargets().some(t => t.id === r.target)) next.editModel = r.target;
    if (r.prompt !== undefined && r.promptSaved) { next.prompt = r.prompt; next.negative = r.negPrompt || ''; next.promptStatus = { available: true, preset: true }; }
    this.edSet({ state: next, outpaint: r.outpaint ? Object.assign({}, ed.outpaint, r.outpaint) : ed.outpaint, outpaintStrength: r.outpaint && r.outpaint.strength !== undefined ? r.outpaint.strength : ed.outpaintStrength });
    this.loadEditAssets();
    this.toast('Applied preset "' + r.name + '"' + (r.promptSaved ? '' : ' (prompt unchanged)'), '#65d66e');
  };

  // ── mask editor: source-image coordinates in one transformed stage ───────
  P._maskFor = function (src, force) {
    if (!src || !src.width || !src.height) return null;
    if (this._mask && this._mask.key === src.key && !force) return this._mask;
    if (this._mask && this._mask.ro) { try { this._mask.ro.disconnect(); } catch (_) {} }
    const self = this, w = src.width, hgt = src.height;
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = hgt;
    canvas.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;opacity:.6;pointer-events:none;';
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const img = document.createElement('img'); img.src = this.state.backendUrl + src.url; img.draggable = false; img.alt = 'Inpaint source';
    img.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;display:block;pointer-events:none;user-select:none;';
    const stage = document.createElement('div'); stage.style.cssText = `position:absolute;left:0;top:0;width:${w}px;height:${hgt}px;transform-origin:0 0;will-change:transform;`;
    stage.append(img, canvas);
    const ring = document.createElement('div'); ring.style.cssText = 'position:absolute;display:none;pointer-events:none;border:1.5px solid #fff;box-shadow:0 0 0 1px #000;border-radius:50%;transform:translate(-50%,-50%);';
    const viewport = document.createElement('div');
    viewport.setAttribute('data-no-fullscreen', '1'); viewport.setAttribute('data-mask-viewport', '1'); viewport.tabIndex = 0;
    viewport.setAttribute('role', 'application'); viewport.setAttribute('aria-label', `Inpaint mask editor, source ${w} by ${hgt} pixels. Drag to paint, hold Space or use the Pan tool to move, Ctrl+wheel to zoom.`);
    viewport.style.cssText = `position:relative;width:100%;aspect-ratio:${w} / ${hgt};max-height:70vh;min-height:200px;overflow:hidden;background:#05080d;border:1px solid rgba(148,163,184,.25);border-radius:8px;touch-action:none;cursor:crosshair;user-select:none;`;
    viewport.append(stage, ring);
    const zoomLabel = document.createElement('span'); zoomLabel.style.cssText = 'font:700 11px IBM Plex Mono,monospace;color:#7dd3fc;min-width:78px;display:inline-block;';
    const zoomSlider = document.createElement('input'); zoomSlider.type = 'range'; zoomSlider.min = '0'; zoomSlider.max = '100'; zoomSlider.step = '1'; zoomSlider.value = '0'; zoomSlider.setAttribute('aria-label', 'Zoom'); zoomSlider.style.cssText = 'flex:1 1 120px;min-height:28px;';
    const maxZoom = 16;
    const m = { key: src.key, w, h: hgt, canvas, ctx, img, stage, ring, viewport, zoomLabel, zoomSlider, undo: [], redo: [], tool: 'paint', space: false,
      view: { imgW: w, imgH: hgt, boxW: 1, boxH: 1, zoom: 1, panX: 0, panY: 0 } };
    this._mask = m;
    const brush = () => self._ed().brush;
    m.apply = () => {
      const o = E.viewOrigin(m.view);
      stage.style.transform = `translate(${o.x}px,${o.y}px) scale(${o.s})`;
      const pct = Math.round(o.s * 100);
      zoomLabel.textContent = (m.view.zoom === 1 ? 'Fit · ' : '') + pct + '%';
      const minZoom = Math.min(1, 1 / E.fitScale(m.w, m.h, m.view.boxW, m.view.boxH));
      zoomSlider.min = String(Math.floor(Math.log(minZoom) / Math.log(maxZoom) * 100));
      zoomSlider.value = String(Math.round(Math.log(m.view.zoom) / Math.log(maxZoom) * 100));
    };
    m.fit = () => { m.view = Object.assign({}, m.view, { zoom: 1, panX: 0, panY: 0 }); m.apply(); };
    m.actual = () => { m.view = E.zoomTo100(m.view); m.apply(); };
    m.zoomBy = f => { m.view = E.zoomAt(m.view, f, m.view.boxW / 2, m.view.boxH / 2, maxZoom); m.apply(); };
    zoomSlider.addEventListener('input', () => { const z = Math.pow(maxZoom, Number(zoomSlider.value) / 100); m.view = E.zoomAt(m.view, z / (m.view.zoom || 1), m.view.boxW / 2, m.view.boxH / 2, maxZoom); m.apply(); });
    m.ro = new ResizeObserver(() => { const r = viewport.getBoundingClientRect(); if (r.width > 0) { m.view = E.clampPan(Object.assign({}, m.view, { boxW: r.width, boxH: r.height })); m.apply(); } });
    m.ro.observe(viewport);
    const setupBrush = () => { const b = brush(); ctx.globalCompositeOperation = m.tool === 'erase' || b.mode === 'erase' ? 'destination-out' : 'source-over'; ctx.strokeStyle = ctx.fillStyle = '#ffffff'; ctx.lineWidth = b.size; ctx.lineCap = ctx.lineJoin = 'round'; };
    const local = e => { const r = viewport.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const toImg = e => { const l = local(e); return E.screenToImage(m.view, l.x, l.y); };
    const ptrs = new Map(); let stroke = null, pan = null, pinch = null;
    const updateRing = e => {
      const b = brush(), o = E.viewOrigin(m.view), l = local(e);
      const panning = m.tool === 'pan' || m.space;
      ring.style.display = panning ? 'none' : 'block'; viewport.style.cursor = panning ? 'grab' : 'crosshair';
      ring.style.left = l.x + 'px'; ring.style.top = l.y + 'px'; ring.style.width = ring.style.height = Math.max(4, b.size * o.s) + 'px';
    };
    const drawTo = (p, from) => {
      const b = brush(); const q = E.clampToImage(p, w, hgt, b.size / 2); if (!q) return from;
      ctx.beginPath(); if (from) { ctx.moveTo(from.x, from.y); ctx.lineTo(q.x, q.y); ctx.stroke(); } else { ctx.arc(q.x, q.y, b.size / 2, 0, Math.PI * 2); ctx.fill(); }
      return q;
    };
    viewport.addEventListener('pointerdown', e => {
      viewport.focus({ preventScroll: true });
      if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return;
      ptrs.set(e.pointerId, local(e));
      try { viewport.setPointerCapture(e.pointerId); } catch (_) {}
      if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }; stroke = null; return; }
      if (e.button === 1 || m.tool === 'pan' || m.space) { pan = { x: local(e).x, y: local(e).y, px: m.view.panX, py: m.view.panY }; viewport.style.cursor = 'grabbing'; e.preventDefault(); return; }
      self._maskSnapshot(); setupBrush(); stroke = { last: drawTo(toImg(e), null) }; e.preventDefault();
    });
    viewport.addEventListener('pointermove', e => {
      updateRing(e);
      if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, local(e));
      if (pinch && ptrs.size >= 2) {
        const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        if (pinch.d > 0 && d > 0) m.view = E.zoomAt(m.view, d / pinch.d, mx, my, maxZoom);
        m.view = E.clampPan(Object.assign({}, m.view, { panX: m.view.panX + (mx - pinch.mx), panY: m.view.panY + (my - pinch.my) }));
        pinch = { d, mx, my }; m.apply(); return;
      }
      if (pan) { const l = local(e); m.view = E.clampPan(Object.assign({}, m.view, { panX: pan.px + (l.x - pan.x), panY: pan.py + (l.y - pan.y) })); m.apply(); return; }
      if (stroke) { const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e]; for (const ce of (evs.length ? evs : [e])) stroke.last = drawTo(toImg(ce), stroke.last); }
    });
    const end = e => {
      ptrs.delete(e.pointerId);
      if (ptrs.size < 2) pinch = null;
      if (pan && ptrs.size === 0) { pan = null; updateRing(e); }
      if (stroke && ptrs.size === 0) { stroke = null; ctx.globalCompositeOperation = 'source-over'; self._maskChanged(); }
    };
    viewport.addEventListener('pointerup', end); viewport.addEventListener('pointercancel', end);
    viewport.addEventListener('pointerleave', () => { ring.style.display = 'none'; });
    viewport.addEventListener('wheel', e => {
      if (e.ctrlKey || e.metaKey) { e.preventDefault(); const l = local(e); m.view = E.zoomAt(m.view, Math.exp(-e.deltaY * 0.0025), l.x, l.y, maxZoom); m.apply(); }
      else if (m.view.zoom > 1.0001) { e.preventDefault(); m.view = E.clampPan(Object.assign({}, m.view, { panX: m.view.panX - e.deltaX, panY: m.view.panY - e.deltaY })); m.apply(); }
    }, { passive: false });
    viewport.addEventListener('keydown', e => {
      if (e.code === 'Space') { m.space = true; e.preventDefault(); return; }
      if (e.key === '+' || e.key === '=') m.zoomBy(1.25); else if (e.key === '-') m.zoomBy(0.8); else if (e.key === '0') m.fit();
      else if (e.key === '[') self.edQuiet({ brush: Object.assign({}, brush(), { size: Math.max(4, brush().size - 4) }) }); else if (e.key === ']') self.edQuiet({ brush: Object.assign({}, brush(), { size: brush().size + 4 }) });
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); self.maskOp(e.shiftKey ? 'redo' : 'undo'); }
    });
    viewport.addEventListener('keyup', e => { if (e.code === 'Space') m.space = false; });
    m.apply();
    return m;
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
  P._maskSnapshot = function () { const m = this._mask; if (!m) return; m.undo.push(this._maskAlpha()); if (m.undo.length > 30) m.undo.shift(); m.redo = []; };
  P._maskChanged = function () {
    const a = this._maskAlpha();
    this.edSet({ maskInfo: a ? { coverage: D.maskCoverage(a), w: this._mask.w, h: this._mask.h, undo: this._mask.undo.length, redo: this._mask.redo.length } : null, attempt: null });
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
  // Test hook: paint a rectangle in IMAGE coordinates (identical code path to a stroke's result).
  P._maskFillRect = function (x, y, w, h) { const m = this._mask; if (!m) return; this._maskSnapshot(); m.ctx.globalCompositeOperation = 'source-over'; m.ctx.fillStyle = '#fff'; m.ctx.fillRect(x, y, w, h); this._maskChanged(); };

  // ── run ─────────────────────────────────────────────────────────────
  const gateOf = (self, op) => self._gate(op);
  P._editBlocker = function () {
    const ed = this._ed(), st = ed.state, src = ed.source, op = ed.op;
    if (!src || !st) return 'Choose a source image first (Library → Img2Img/Inpaint/Outpaint, a result, or Import).';
    if (!gateOf(this, op)) return OP_LABEL[op] + ' is not currently available (capability gate closed).';
    if (!String(st.prompt || '').trim() && !(op === 'outpaint' && String(ed.ext || '').trim())) return st.promptStatus && st.promptStatus.available === false
      ? 'Enter a prompt — ' + (st.promptStatus.message || 'the source prompt is unavailable') + '.' : 'Enter a prompt.';
    if (!st.editModel) return 'No SDCPP model is available to run edits.';
    if (op === 'inpaint') {
      if (!((ed.maskInfo || {}).coverage > 0)) return 'Paint the area to change first (the mask is empty).';
    }
    if (op === 'outpaint') { const o = ed.outpaint; if (!((+o.left || 0) + (+o.right || 0) + (+o.top || 0) + (+o.bottom || 0))) return 'Set how many pixels to extend on at least one side.'; }
    return null;
  };
  P._editRequest = function () {
    const ed = this._ed(), st = ed.state, p = st.params, op = ed.op, src = ed.source;
    const catalog = (ed.assets && ed.assets.loras) || [];
    const seed = Number.isInteger(+p.seed) && +p.seed >= 0 ? +p.seed : Math.floor(Math.random() * 2000000000) + 1;
    const body = Object.assign(src.staged ? { staged_id: src.stagedId } : { image_id: src.imageId }, {
      prompt: String(st.prompt || '').trim(), negative_prompt: st.negative || '', steps: +p.steps || 20, cfg_scale: +p.cfg || 7, seed,
      sampler: p.sampler, scheduler: p.scheduler, vae: p.vae || 'auto', loras: this._effectiveLoras(st.loras, catalog), save_prompts: !!this.state.savePrompts });
    if (!body.prompt) delete body.prompt;
    // A1111 img2img "Script" dropdown: a chosen stock script reroutes Run to /api/scripts/<kind> with the same prompt and sampling.
    const sc = ed.script || {};
    if (sc.kind && SCRIPT_OP[sc.kind] === op) {
      body.strength = op === 'outpaint' ? +(ed.outpaintStrength || 0.8) : +p.strength;
      body.script = this._edScriptOptions(sc);
      return { body, route: '/api/scripts/' + sc.kind };
    }
    if (op === 'img2img') {
      body.strength = +p.strength;
      const rz = ed.resize || {};
      if (rz.mode) {
        body.resize_mode = rz.mode; body.background_color = rz.bg || '#ffffff';
        if (rz.kind === 'by') body.resize_by = +rz.by; else { body.resize_width = parseInt(rz.w, 10); body.resize_height = parseInt(rz.h, 10); }
      } else if (ed.prep && ed.prep !== 'none') body.source_prep = ed.prep;
      if (ed.exactSteps) body.exact_steps = true;
    }
    if (op === 'inpaint') {
      body.strength = +p.strength; body.mask_data = this._maskDataUrl();
      const ip = ed.inpaint || {};
      body.inpaint_area = ip.area || 'whole'; body.mask_blur = parseInt(ip.blur, 10); body.masked_content = ip.content || 'original';
      if (ip.area === 'only_masked') { body.inpaint_padding = parseInt(ip.padding, 10); body.width = parseInt(ip.w, 10); body.height = parseInt(ip.h, 10); }
    }
    if (op === 'outpaint') { const o = ed.outpaint; Object.assign(body, { left: +o.left || 0, right: +o.right || 0, top: +o.top || 0, bottom: +o.bottom || 0, strength: +(ed.outpaintStrength || 0.85) }); if (String(ed.ext || '').trim()) body.extension_prompt = ed.ext.trim(); }
    return { body, route: '/api/actions/' + op };
  };
  P.runEdit = async function (confirmedFull) {
    const ed = this._ed();
    if (ed.run.status === 'running') { this.toast('An edit is already running — it will finish below.', '#fbbf24'); return; }
    const blocker = this._editBlocker();
    if (blocker) { this.edSet({ attempt: { error: blocker, at: Date.now() } }); this.toast(blocker, '#fbbf24'); return; }
    const op = ed.op;
    if (op === 'inpaint' && !confirmedFull) { const v = D.maskVerdict(this._maskAlpha()); if (v.kind === 'full' && !window.confirm(v.message + '\n\nContinue anyway?')) return; }
    const t0 = Date.now();
    const setRun = (patch) => this.edSet({ attempt: null, run: Object.assign({}, this._ed().run, patch) });
    this.edSet({ attempt: null, run: { status: 'running', op, startedAt: t0, stage: { key: 'validating', label: 'Validating request', percent: null, determinate: false }, error: null } });
    try {
      const st = ed.state, target = st.editModel, active = this._activeSecondary();
      // The edit worker loads its own configured model (editWorkerTarget), not the secondary slot: switching the slot would
      // only cost ~5 s and replace the user's loaded model for nothing.
      const worker = this.state.capabilityData && this.state.capabilityData.editWorkerTarget;
      if (target && target !== active && target !== worker) {
        setRun({ stage: { key: 'switching-model', label: 'Switching edit model to ' + target + ' (Big Mac)', percent: null, determinate: false } });
        const sw = await this._api('/api/models/secondary/activate', { target });
        if (!sw.ok) throw Object.assign(new Error(sw.data.error || 'model switch rejected'), { stage: 'switching-model' });
        this.setState({ modelState: sw.data.modelState || sw.data });
      }
      setRun({ stage: { key: 'submitting', label: 'Submitting to Big Mac', percent: null, determinate: false } });
      const req = this._editRequest();
      let r = await this._api(req.route, Object.assign({}, req.body, op === 'inpaint' ? { confirm_full_mask: D.maskVerdict(this._maskAlpha()).kind === 'full' } : {}));
      if (!r.ok && r.data && r.data.needs_confirmation && window.confirm(r.data.error + '\n\nContinue anyway?')) r = await this._api(req.route, Object.assign({}, req.body, { confirm_full_mask: true }));
      if (!r.ok) throw Object.assign(new Error(r.data.error || ('HTTP ' + r.status)), { stage: 'request', gate: r.data.gate });
      this._lastEditBody = req.body;
      setRun({ jobId: r.data.job_id, stage: { key: 'queued', label: 'Queued', percent: null, determinate: false } });
      this._followEditJob(r.data.job_id, op, req.body);
    } catch (e) {
      const stage = e.stage || 'request';
      this.edSet({ run: { status: 'error', op, startedAt: t0, error: { stage, message: e.message, gate: e.gate || null, retry: 'run' } } });
      this.toast(OP_LABEL[op] + ' failed at ' + stage + ': ' + e.message, '#ef4444');
    }
  };
  P._followEditJob = async function (jobId, op, body) {
    let fails = 0, lastKey = 'queued';
    for (;;) {
      await sleep(900);
      const run = this._ed().run;
      if (run.jobId !== jobId) return;                       // superseded
      let job;
      try {
        const r = await fetch(this.state.backendUrl + '/api/jobs/' + jobId, { signal: AbortSignal.timeout(6000) });
        if (r.status === 404) { this.edSet({ run: Object.assign({}, run, { status: 'error', error: { stage: 'polling', message: 'The console no longer knows this job (it may have restarted).', retry: 'none' } }) }); return; }
        if (!r.ok) throw new Error('HTTP ' + r.status);
        job = await r.json(); fails = 0;
      } catch (e) {
        fails++;
        if (fails >= 4) { this.edSet({ run: Object.assign({}, run, { status: 'error', error: { stage: 'polling', message: 'Lost contact with the console while the job was running: ' + e.message, retry: 'poll' } }) }); this.toast('Lost contact with the job — use “Retry status check”.', '#ef4444'); return; }
        this.edSet({ run: Object.assign({}, run, { warn: 'Connection problem (' + fails + '/4): ' + e.message }) }); continue;
      }
      const stage = job.stage || E.deriveStage(job);
      if (stage.key && stage.key !== 'complete' && stage.key !== 'failed') lastKey = stage.key;
      if (!this._jobTerminal(job.status)) { this.edSet({ run: Object.assign({}, this._ed().run, { stage, warn: null, resource: job.resource || null }) }); continue; }
      if (!this._jobOk(job.status)) {
        this.edSet({ run: Object.assign({}, this._ed().run, { status: 'error', stage, error: { stage: lastKey, gate: job.firstFailedGate || null, message: this._failText(job), retry: 'run' } }) });
        this.toast(OP_LABEL[op] + ' failed at ' + lastKey + (job.firstFailedGate ? ' · gate ' + job.firstFailedGate : ''), '#ef4444'); return;
      }
      const results = D.jobResults(job).filter(x => x.imageId);
      if (!results.length) { this.edSet({ run: Object.assign({}, this._ed().run, { status: 'error', stage, error: { stage: 'result-resolution', message: 'The job finished but no canonical output image was reported.', gate: null, retry: 'none' } }) }); this.toast('Job finished without an output image', '#ef4444'); return; }
      const mapped = results.map(x => Object.assign({ kind: op, sourceId: this._ed().source && this._ed().source.imageId }, x));
      mapped.forEach(x => this._rememberSnapshot(x.imageId, body, x.seed));
      this.edSet({ results: mapped.concat(this._ed().results).slice(0, 24), active: 0, run: Object.assign({}, this._ed().run, { status: 'done', stage: { key: 'complete', label: 'Complete', percent: 100, determinate: true }, finishedAt: Date.now() }) });
      this.toast(OP_LABEL[op] + ' complete', '#65d66e');
      setTimeout(() => this.loadRuns(), 1200);
      return;
    }
  };
  P.retryEdit = function () { const e = this._ed().run.error; if (!e) return; if (e.retry === 'poll') { const run = this._ed().run; this.edSet({ run: Object.assign({}, run, { status: 'running', error: null }) }); this._followEditJob(run.jobId, run.op, this._lastEditBody || {}); } else this.runEdit(); };
  P.loadEditLog = async function () {
    const id = this._ed().run.jobId; if (!id) return;
    const r = await fetch(this.state.backendUrl + '/api/jobs/' + id + '/log').then(x => x.text()).catch(e => 'Could not load log: ' + e.message);
    this.edSet({ log: String(r).slice(-6000) });
  };

  // ── builders ──────────────────────────────────────────────────────────
  const numField = (self, key, attrs) => { const st = self._ed().state;
    return h('input', Object.assign({ type: 'number', inputMode: 'decimal', value: String(st.params[key] ?? ''), style: css.input, onInput: e => { st.params[key] = e.target.value; } }, attrs || {})); };

  P._edSourceCard = function () {
    const ed = this._ed(), src = ed.source, base = this.state.backendUrl, ws = this._ws();
    return h('div', { 'data-edit-source': '1', style: { display: 'grid', gridTemplateColumns: 'minmax(84px,132px) minmax(0,1fr)', gap: 10, alignItems: 'start', minWidth: 0 } },
      h('img', { src: base + src.url, alt: 'Edit source image', 'data-fullscreen': 'only', 'data-fullscreen-image-id': src.imageId || '', 'data-fullscreen-caption': src.imageId || 'imported image', style: { width: '100%', borderRadius: 8, border: '1px solid rgba(148,163,184,.25)', cursor: 'zoom-in', background: '#05080d' } }),
      h('div', { style: { display: 'grid', gap: 5, minWidth: 0 } },
        h('div', { style: css.mono }, src.imageId || ('imported · ' + src.stagedId)),
        h('div', { style: css.muted }, src.width + '×' + src.height + ' · ' + ((src.meta && src.meta.operation) || 'image') + (src.meta && src.meta.seed != null ? ' · seed ' + src.meta.seed : '') + (src.keeper ? ' · ★ Keeper' : '')),
        h('div', { style: css.row },
          ws.editOriginalId && src.imageId && ws.editOriginalId !== src.imageId ? btn('Return to original', () => this.returnToOriginal(), '#94a3b8') : null,
          src.parent ? btn('View parent', () => this.openImageInEdit(src.parent, ed.op, { chain: true }), '#94a3b8') : null,
          btn('Clear', () => { if (!this._confirmEditDraftDiscard('clear the source')) return; if (src.staged) fetch(base + '/api/staging/' + src.stagedId, { method: 'DELETE' }); this._mask = null; this._editDraftBaseline = null; this.wsSet({ editSourceId: null, editSource: null, editOriginalId: null }); this.edSet({ source: null, state: null, run: { status: 'idle' }, results: ed.results }); this.setActiveAssetSelection && this.setActiveAssetSelection(null); }, '#94a3b8'))));
  };
  P._edRecallBanner = function () {
    const ed = this._ed(), st = ed.state, rc = st.recalledFrom, p = st.params, src = ed.source;
    const bits = [['model', st.sourceModel || '—'], ['seed', p.seed], ['size', (src.width || p.width) + '×' + (src.height || p.height)], ['steps', p.steps], ['CFG', p.cfg], ['sampler', p.sampler], ['scheduler', p.scheduler], ['VAE', p.vae === 'auto' ? 'default' : p.vae], ['LoRAs', st.loras.length]];
    return h('div', { 'data-recall-banner': '1', role: 'status', style: { border: '1px solid ' + (rc.recorded ? 'rgba(101,214,110,.35)' : 'rgba(251,191,36,.4)'), background: rc.recorded ? 'rgba(101,214,110,.06)' : 'rgba(251,191,36,.07)', borderRadius: 9, padding: '8px 10px', display: 'grid', gap: 5, minWidth: 0 } },
      h('div', { style: css.row }, h('b', { style: { color: rc.recorded ? '#86efac' : '#fde68a', fontSize: 12 } }, rc.recorded ? '✓ Recalled this image’s recorded settings' : '⚠ No recorded settings for this image'),
        h('div', { style: { flex: 1 } }), btn('Re-apply source settings', () => { const r = src.recall; this.edSet({ state: E.applyRecallToEdit(r, { snapshot: this._snaps && this._snaps.get(src.imageId), op: ed.op, targets: this._editTargets().concat(this.state.modelTargets || []), activeSecondary: this._activeSecondary(), editWorker: this.state.capabilityData && this.state.capabilityData.editWorkerTarget }) }); this.loadEditAssets(); }, '#94a3b8')),
      h('div', { style: css.row }, ...bits.map(([k, v]) => h('span', { key: k, style: pillStyle('#94a3b8') }, k + ' ' + v))),
      !st.promptStatus.available ? h('div', { 'data-prompt-unavailable': '1', style: { color: '#fde68a', fontSize: 12 } }, '🔒 ' + st.promptStatus.message + '. Enter the prompt you want for this edit.') : st.promptStatus.session ? h('div', { style: css.muted }, 'Prompt restored from this session (not stored on disk — prompt saving is off).') : null,
      ...st.notes.map(n => h('div', { key: n, style: { color: '#fde68a', fontSize: 11 } }, '• ' + n)),
      st.sourceModel && st.editModel && st.sourceModel !== st.editModel ? h('div', { style: { color: '#fde68a', fontSize: 11 } }, '• Source model ' + st.sourceModel + ' → edit runs on ' + st.editModel + '.') : null);
  };
  P._edOpSwitch = function () {
    const ed = this._ed();
    return h('div', { role: 'tablist', 'aria-label': 'Edit operation', 'data-op-switch': '1', style: { display: 'flex', gap: 4, flexWrap: 'wrap' } },
      ...OPS.map(([k, l]) => h('button', { key: k, type: 'button', role: 'tab', 'aria-selected': String(ed.op === k), 'aria-pressed': String(ed.op === k), 'data-op': k, disabled: !gateOf(this, k), onClick: () => this.edSet({ op: k, run: ed.run.status === 'running' ? ed.run : { status: 'idle' }, attempt: null }),
        style: { flex: '1 1 90px', minHeight: 40, borderRadius: 8, border: '1px solid ' + (ed.op === k ? '#a78bfa' : 'rgba(148,163,184,.25)'), background: ed.op === k ? 'rgba(167,139,250,.18)' : 'rgba(8,14,24,.7)', color: ed.op === k ? '#e9d5ff' : '#b8c7d6', fontWeight: 800, fontSize: 13, cursor: 'pointer' } }, l)));
  };
  P._edPromptBlock = function () {
    const ed = this._ed(), st = ed.state;
    const ph = st.promptStatus.available ? 'Describe the edit…' : st.promptStatus.message + ' — enter a prompt';
    return h('div', { style: { display: 'grid', gap: 8 } },
      label('Prompt', h('textarea', { rows: 3, 'data-edit-prompt': '1', value: st.prompt || '', placeholder: ph, style: Object.assign({}, css.input, { resize: 'vertical', borderColor: !String(st.prompt || '').trim() && ed.attempt ? '#f87171' : undefined }), onInput: e => { st.prompt = e.target.value; this._edSyncRun(); } })),
      label('Negative prompt', h('textarea', { rows: 2, 'data-edit-negative': '1', value: st.negative || '', placeholder: 'low quality, blurry…', style: Object.assign({}, css.input, { resize: 'vertical' }), onInput: e => { st.negative = e.target.value; } })));
  };
  // Every installed checkpoint is listed in the Edit catalog, but only the ones the edit worker can actually run for the
  // chosen operation are selectable; the rest say why (e.g. text-to-image only) instead of pretending to be editable.
  P._editCatalog = function (supported, op) {
    const ok = new Set((supported || []).map(t => t.id)), worker = this.state.capabilityData && this.state.capabilityData.editWorkerTarget;
    const label = OP_LABEL[op] || 'this operation';
    return (this.state.modelTargets || []).map(t => {
      if (ok.has(t.id)) return t;
      const why = (t.backend || 'sdcpp') === 'mflux' ? 'FLUX.2 Klein has no ' + label + ' path here (text-to-image only).'
        : String(t.status).toLowerCase() === 'broken' ? 'Marked broken; not usable for ' + label + '.'
        : t.runtime === 'model-missing' ? 'Model file missing.'
        : worker ? label + ' runs on ' + worker + ' only; this checkpoint is text-to-image.' : 'No ' + label + ' worker is available for this checkpoint.';
      return Object.assign({}, t, { unsupported: why });
    });
  };
  P._edParams = function () {
    const ed = this._ed(), st = ed.state, p = st.params, op = ed.op;
    const targets = this._editTargets();
    const strengthKey = op === 'outpaint' ? 'outpaintStrength' : 'strength';
    const strength = op === 'outpaint' ? (ed.outpaintStrength != null ? ed.outpaintStrength : 0.85) : p.strength;
    const sOut = h('span', { style: { color: '#38bdf8', fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, minWidth: 36 } }, Number(strength).toFixed(2));
    return h('div', { style: { display: 'grid', gap: 8 } },
      h('div', { style: { display: 'grid', gap: 4, minWidth: 0 } }, h('span', { style: css.label }, 'Edit model'), this.buildModelPicker('edit', this._editCatalog(targets, op), st.editModel, id => { this.edSet({ state: Object.assign({}, st, { editModel: id }), assetsFor: null }); this.loadEditAssets(); })),
      this.state.capabilityData && this.state.capabilityData.editWorkerTarget ? h('div', { style: css.muted, 'data-edit-worker-model': this.state.capabilityData.editWorkerTarget }, 'Img2Img, Inpaint, Outpaint and the scripts run on ' + this.state.capabilityData.editWorkerTarget + ' (the edit worker\'s configured model); other checkpoints are not used by Edit.') : null,
      st.editModel && st.editModel !== this._activeSecondary() && !(this.state.capabilityData && this.state.capabilityData.editWorkerTarget === st.editModel) ? h('div', { style: { color: '#fde68a', fontSize: 11 } }, 'Switching to ' + st.editModel + ' happens when you press Run (the Big Mac secondary slot is replaced).') : null,
      h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,92px),1fr))', gap: 8 } },
        label('Steps', numField(this, 'steps', { min: '1', max: '150', step: '1' })), label('CFG', numField(this, 'cfg', { min: '1', max: '30', step: '0.5' })),
        label('Seed (−1 = random)', numField(this, 'seed', { step: '1' })),
        label('Sampler', h('select', { value: p.sampler, style: css.input, onChange: e => { p.sampler = e.target.value; } }, ...(SAMPLERS.includes(p.sampler) ? SAMPLERS : [p.sampler].concat(SAMPLERS)).map(s => h('option', { key: s, value: s }, s)))),
        label('Scheduler', h('select', { value: p.scheduler, style: css.input, onChange: e => { p.scheduler = e.target.value; } }, ...(SCHEDULERS.includes(p.scheduler) ? SCHEDULERS : [p.scheduler].concat(SCHEDULERS)).map(s => h('option', { key: s, value: s }, s))))),
      label((op === 'outpaint' ? 'Outpaint' : op === 'inpaint' ? 'Inpaint' : 'Img2img') + ' strength', h('div', { style: css.row },
        h('input', { type: 'range', min: op === 'outpaint' ? '0.5' : '0.05', max: '0.99', step: '0.01', value: String(strength), 'aria-label': 'Strength', style: { flex: '1 1 150px', minHeight: 30 }, onInput: e => { const v = +e.target.value; if (op === 'outpaint') ed.outpaintStrength = v; else p.strength = v; sOut.textContent = v.toFixed(2); }, onChange: () => this.edSet({}) }), sOut,
        ...(op === 'img2img' ? D.STRENGTH_PRESETS.map(([n, v]) => btn(n, () => { p.strength = v; this.edSet({}); }, Math.abs(p.strength - v) < 0.001 ? '#a78bfa' : '#94a3b8')) : []))));
  };
  P._edResources = function () {
    const ed = this._ed(), st = ed.state, cat = (ed.assets && ed.assets.loras) || [];
    const spec = (this.state.modelTargets || []).find(t => t.id === st.editModel);
    return this.buildResourcesControl({ scope: 'edit', loras: st.loras, catalog: cat, vaes: ed.assets && ed.assets.vaes, vae: st.params.vae, showVae: true, modelLabel: spec && (spec.label || spec.id),
      setLoras: fn => this.edSet({ state: Object.assign({}, st, { loras: E.normalizeLoras(fn(st.loras)) }) }),
      quiet: (name, w) => { const l = st.loras.find(x => x.name === name); if (l) l.weight = w; },
      setVae: v => { st.params.vae = v; this.edSet({}); },
      onTrigger: w => { st.prompt = (st.prompt ? st.prompt.replace(/[,\s]+$/, '') + ', ' : '') + w; this.edSet({}); } });
  };
  P._edMaskBlock = function () {
    const ed = this._ed(), src = ed.source, m = this._maskFor(src), mi = ed.maskInfo || {}, b = ed.brush;
    const tb = (lbl, active, fn, extra) => btn(lbl, fn, active ? '#38bdf8' : '#94a3b8', extra);
    return h('div', { 'data-mask-editor': '1', style: { display: 'grid', gap: 8, minWidth: 0 } },
      h('div', { style: css.row },
        tb('Brush', m.tool === 'paint' && b.mode === 'paint', () => { m.tool = 'paint'; this.edSet({ brush: Object.assign({}, b, { mode: 'paint' }) }); }),
        tb('Eraser', b.mode === 'erase' && m.tool !== 'pan', () => { m.tool = 'paint'; this.edSet({ brush: Object.assign({}, b, { mode: 'erase' }) }); }),
        tb('Pan', m.tool === 'pan', () => { m.tool = m.tool === 'pan' ? 'paint' : 'pan'; this.edSet({}); }),
        h('label', { style: css.muted }, 'Brush ' + b.size + ' px'),
        h('input', { type: 'range', min: '4', max: String(Math.max(64, Math.round(Math.min(src.width, src.height) / 3))), step: '2', value: String(b.size), 'aria-label': 'Brush size in image pixels', style: { flex: '1 1 110px', minHeight: 28 }, onChange: e => this.edSet({ brush: Object.assign({}, b, { size: +e.target.value }) }) })),
      h('div', { style: css.row }, tb('Fit', m.view.zoom === 1, () => m.fit()), tb('100%', false, () => m.actual()), btn('−', () => m.zoomBy(0.8), '#94a3b8', { 'aria-label': 'Zoom out' }), btn('+', () => m.zoomBy(1.25), '#94a3b8', { 'aria-label': 'Zoom in' }), m.zoomSlider, m.zoomLabel),
      h('div', { style: css.row }, btn('Undo', () => this.maskOp('undo'), '#94a3b8', { disabled: !mi.undo }), btn('Redo', () => this.maskOp('redo'), '#94a3b8', { disabled: !mi.redo }),
        btn('Grow', () => this.maskOp('grow'), '#94a3b8'), btn('Shrink', () => this.maskOp('shrink'), '#94a3b8'), btn('Feather', () => this.maskOp('feather'), '#94a3b8'), btn('Blur', () => this.maskOp('blur'), '#94a3b8'), btn('Invert', () => this.maskOp('invert'), '#94a3b8'), btn('Clear', () => this.maskOp('clear'), '#f87171')),
      m.viewport,
      h('div', { style: css.muted }, 'Mask ' + src.width + '×' + src.height + ' (source pixels) · painted ' + Math.round((mi.coverage || 0) * 1000) / 10 + '%' + ((mi.coverage || 0) >= D.FULL_MASK_COVERAGE ? ' — the entire image is masked' : '') + '. Painted area is regenerated; the rest is kept exactly. Ctrl/⌘+wheel or pinch to zoom, Pan tool or Space to move.'),
      this._edInpaintOptions());
  };
  // A1111 inpaint options (P08): area / padding / mask blur / masked content — only what the installed engine can do.
  P._edInpaintOptions = function () {
    const ed = this._ed(), ip = ed.inpaint || (ed.inpaint = { area: 'whole', padding: 32, blur: 4, content: 'original', w: 512, h: 512 });
    const setIp = patch => this.edSet({ inpaint: Object.assign({}, this._ed().inpaint, patch) });
    const num = (key, lbl, attrs) => label(lbl, h('input', Object.assign({ type: 'number', value: String(ip[key]), style: css.input, 'data-edit-field': 'inpaint-' + key, onChange: e => setIp({ [key]: e.target.value }) }, attrs)));
    return h('div', { style: { display: 'grid', gap: 8, borderTop: '1px solid rgba(148,163,184,.14)', paddingTop: 8 }, 'data-inpaint-options': 'true' },
      label('Inpaint area', h('select', { value: ip.area, style: css.input, 'data-edit-field': 'inpaint-area', 'aria-label': 'Inpaint area', onChange: e => setIp({ area: e.target.value }) },
        h('option', { value: 'whole' }, 'Whole picture'), h('option', { value: 'only_masked' }, 'Only masked (padded crop at a work size)'))),
      ip.area === 'only_masked' ? h('div', { style: css.row },
        num('padding', 'Only-masked padding (px)', { min: '0', max: '256', step: '4' }), num('w', 'Work width', { min: '64', max: '2048', step: '8' }), num('h', 'Work height', { min: '64', max: '2048', step: '8' })) : null,
      ip.area === 'only_masked' ? h('div', { style: css.muted, 'data-edit-field': 'inpaint-area-note' }, 'The mask box plus padding is cropped, resized to the work size, inpainted, then pasted back into the untouched original through the mask.') : null,
      num('blur', 'Mask blur (px) — softness of the restored edge', { min: '0', max: '64', step: '1' }),
      label('Masked content', h('select', { value: ip.content, style: css.input, 'data-edit-field': 'inpaint-content', 'aria-label': 'Masked content', onChange: e => setIp({ content: e.target.value }) },
        h('option', { value: 'original' }, 'Original'), h('option', { value: 'fill' }, 'Fill (colours diffused from the surroundings)'))),
      h('div', { style: css.muted, 'data-edit-field': 'inpaint-unavailable' }, 'Not available with the installed engine: latent noise / latent nothing masked content, inpaint conditioning-mask weight (needs an inpaint-trained checkpoint) and soft inpainting.'));
  };
  P._edOutpaintBlock = function () {
    const ed = this._ed(), src = ed.source, o = ed.outpaint;
    const side = (k, l) => label(l + ' px', h('input', { type: 'number', min: '0', max: '512', step: '64', value: String(o[k]), style: css.input, onInput: e => { o[k] = e.target.value; }, onChange: () => this.edSet({}) }));
    const L = +o.left || 0, R = +o.right || 0, T = +o.top || 0, B = +o.bottom || 0, W = src.width + L + R, H = src.height + T + B;
    return h('div', { style: { display: 'grid', gap: 8 } },
      label('Extension prompt (describes only the NEW area)', h('textarea', { rows: 2, value: ed.ext || '', placeholder: 'e.g. empty wooden desk and plain gray wall', style: Object.assign({}, css.input, { resize: 'vertical' }), onInput: e => { ed.ext = e.target.value; this._edSyncRun(); } })),
      h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,90px),1fr))', gap: 8 } }, side('left', 'Left'), side('right', 'Right'), side('top', 'Top'), side('bottom', 'Bottom')),
      h('div', { style: css.row }, btn('+25% right', () => this.edSet({ outpaint: { left: 0, right: Math.round(src.width / 4 / 64) * 64 || 64, top: 0, bottom: 0 } }), '#94a3b8'),
        btn('+25% each side', () => { const x = Math.round(src.width / 8 / 64) * 64 || 64; this.edSet({ outpaint: { left: x, right: x, top: 0, bottom: 0 } }); }, '#94a3b8'),
        btn('+25% bottom', () => this.edSet({ outpaint: { left: 0, right: 0, top: 0, bottom: Math.round(src.height / 4 / 64) * 64 || 64 } }), '#94a3b8')),
      h('div', { 'aria-label': 'Outpaint canvas preview', style: { position: 'relative', width: '100%', maxWidth: 360, aspectRatio: W + ' / ' + H, border: '1px dashed rgba(167,139,250,.6)', borderRadius: 6, background: 'rgba(167,139,250,.08)' } },
        h('div', { style: { position: 'absolute', left: (L / W * 100) + '%', top: (T / H * 100) + '%', width: (src.width / W * 100) + '%', height: (src.height / H * 100) + '%', background: 'center/100% 100% no-repeat url("' + this.state.backendUrl + src.url + '")', outline: '1px solid #38bdf8' } })),
      h('div', { style: css.muted }, 'New canvas ≈ ' + W + '×' + H + ' (rounded up to multiples of 64). The original is kept exactly and blended over a 48 px overlap. Describe the new area, not the main subject.'));
  };
  P._edPrepBlock = function () {
    const ed = this._ed(), src = ed.source, R = window.DexResize, rz = ed.resize || (ed.resize = { mode: '', kind: 'to', w: '', h: '', by: '', bg: '#ffffff' });
    // Read the current value at call time: a handler captured by an earlier render must not overwrite a newer field.
    const setRz = patch => this.edSet({ resize: Object.assign({}, this._ed().resize, patch) });
    const st = ed.state || {}, p = st.params || {};
    const preview = (() => {
      if (!rz.mode) return null;
      const spec = rz.kind === 'by' ? { mode: rz.mode, by: +rz.by } : { mode: rz.mode, width: parseInt(rz.w, 10), height: parseInt(rz.h, 10) };
      const check = R.normalizeResize(rz.kind === 'by' ? { resize_mode: rz.mode, resize_by: rz.by } : { resize_mode: rz.mode, resize_width: rz.w, resize_height: rz.h, background_color: rz.bg });
      if (check.error) return { error: check.error };
      const t = R.targetSize(check.spec, src.width, src.height);
      return { text: src.width + '×' + src.height + ' → ' + t.width + '×' + t.height };
    })();
    const legacy = label('Quick preparation (temporary copy; the original is never modified)', h('select', { value: ed.prep, disabled: !!rz.mode, 'aria-label': 'Quick source preparation', style: css.input, onChange: e => this.edSet({ prep: e.target.value }) },
      h('option', { value: 'none' }, 'As is (' + src.width + '×' + src.height + ')'), h('option', { value: 'crop-square' }, 'Center crop · square'), h('option', { value: 'crop-portrait' }, 'Center crop · portrait 3:4'),
      h('option', { value: 'crop-landscape' }, 'Center crop · landscape 4:3'), h('option', { value: 'fit-square' }, 'Fit/contain · square'), h('option', { value: 'resize-512' }, 'Resize · longest side 512')));
    const strength = +p.strength, steps = +p.steps;
    const exactInfo = ed.exactSteps ? (R.exactSteps(steps, strength) ? ('Runs exactly ' + steps + ' sampler steps (sd-cli is asked for ' + R.exactSteps(steps, strength) + ', because it runs ⌊steps × strength⌋ + 1).') : 'Needs steps and a strength between 0 and 1.')
      : ('Without it sd-cli runs ' + (steps && strength ? R.executedSteps(steps, strength) : '—') + ' of ' + (steps || '—') + ' steps (⌊steps × strength⌋ + 1).');
    return h('div', { style: { display: 'grid', gap: 8 }, 'data-edit-resize': 'true' },
      legacy,
      label('Resize mode (A1111)', h('select', { value: rz.mode, 'data-edit-field': 'resize-mode', 'aria-label': 'Resize mode', style: css.input, onChange: e => { setRz({ mode: e.target.value }); if (e.target.value) this.edSet({ prep: 'none' }); } },
        h('option', { value: '' }, 'Off — use the quick preparation above'), h('option', { value: 'resize' }, 'Just resize (stretch)'), h('option', { value: 'crop' }, 'Crop and resize'), h('option', { value: 'fill' }, 'Resize and fill'))),
      rz.mode ? h('div', { style: { display: 'grid', gap: 8 } },
        label('Size by', h('select', { value: rz.kind, 'data-edit-field': 'resize-kind', 'aria-label': 'Resize size mode', style: css.input, onChange: e => setRz({ kind: e.target.value }) }, h('option', { value: 'to' }, 'Resize to (width × height)'), h('option', { value: 'by' }, 'Resize by (scale)'))),
        rz.kind === 'by'
          ? label('Scale (0.25–4)', h('input', { type: 'number', min: '0.25', max: '4', step: '0.05', value: rz.by, 'data-edit-field': 'resize-by', style: css.input, onChange: e => setRz({ by: e.target.value }) }))
          : h('div', { style: css.row }, label('Width', h('input', { type: 'number', min: '64', max: '2048', step: '8', value: rz.w, placeholder: String(src.width), 'data-edit-field': 'resize-width', style: css.input, onChange: e => setRz({ w: e.target.value }) })),
              label('Height', h('input', { type: 'number', min: '64', max: '2048', step: '8', value: rz.h, placeholder: String(src.height), 'data-edit-field': 'resize-height', style: css.input, onChange: e => setRz({ h: e.target.value }) }))),
        label('Transparent areas become', h('input', { type: 'color', value: rz.bg || '#ffffff', 'data-edit-field': 'resize-bg', 'aria-label': 'Background colour for transparency', style: Object.assign({}, css.input, { width: 80, padding: 2 }), onChange: e => setRz({ bg: e.target.value }) })),
        preview ? h('div', { style: preview.error ? Object.assign({}, css.muted, { color: '#fca5a5' }) : css.muted, role: preview.error ? 'alert' : 'status', 'data-edit-field': 'resize-preview' }, preview.error || preview.text) : null) : null,
      h('label', { style: Object.assign({}, css.row, { color: '#dbe4ee', fontSize: 12 }) }, h('input', { type: 'checkbox', checked: !!ed.exactSteps, 'data-edit-field': 'exact-steps', onChange: e => this.edSet({ exactSteps: e.target.checked }) }), 'Do exactly the amount of steps the slider specifies'),
      h('div', { style: css.muted, 'data-edit-field': 'exact-steps-note' }, exactInfo),
      h('div', { style: css.muted, 'data-edit-field': 'img2img-unavailable' }, 'Not available with the installed engine: Latent-upscale resize mode, image CFG scale (needs an inpaint/edit-trained checkpoint), colour correction, and batch img2img from uploads or a directory.'));
  };
  // Progress: determinate only when the backend reported real steps; else stage text + indeterminate bar.
  P._edProgress = function (run) {
    const s = run.stage || {};
    const elapsed = run.startedAt ? Math.round((Date.now() - run.startedAt) / 1000) : 0;
    const bar = s.determinate && s.percent != null
      ? h('div', { style: { height: '100%', width: s.percent + '%', background: 'linear-gradient(90deg,#8b5cf6,#38bdf8)', transition: 'width .4s' } })
      : h('div', { className: 'dex-indeterminate-bar', style: { position: 'absolute', top: 0, height: '100%', width: '38%', background: 'linear-gradient(90deg,#8b5cf6,#38bdf8)', animation: 'dexIndeterminate 1.1s ease-in-out infinite' } });
    return h('div', { 'data-edit-progress': '1', role: 'status', 'aria-live': 'polite', style: { display: 'grid', gap: 5 } },
      h('div', { style: css.row }, h('b', { style: { color: s.key === 'waiting-bigmac' ? tone.warn : '#a5b4fc', fontSize: 12 } }, (OP_LABEL[run.op] || 'Edit') + ' · ' + (s.label || 'Working')), h('div', { style: { flex: 1 } }),
        h('span', { style: css.mono }, (s.determinate && s.percent != null ? s.percent + '% · ' : '') + elapsed + 's')),
      h('div', { style: { position: 'relative', height: 6, background: 'rgba(255,255,255,.08)', borderRadius: 3, overflow: 'hidden' } }, bar),
      run.warn ? h('div', { style: { color: tone.warn, fontSize: 11 } }, run.warn) : null,
      h('div', { style: css.muted }, s.determinate ? 'Real sampling progress from Big Mac.' : 'No step count available for this stage — the bar is indeterminate, not a percentage.'));
  };
  const runBtnStyle = (blocker, running) => ({ minHeight: 48, borderRadius: 10, border: 0, fontWeight: 800, fontSize: 15, cursor: running ? 'progress' : 'pointer', color: blocker || running ? '#cbd5e1' : '#06060a', background: running ? 'rgba(56,189,248,.25)' : blocker ? 'rgba(148,163,184,.22)' : 'linear-gradient(90deg,#a78bfa,#22d3ee)' });
  // Patch the Run button + blocker text IN PLACE (no re-render) after text input, so the button the
  // user is about to click is never replaced under the pointer.
  P._edSyncRun = function () {
    const ed = this._ed(), btnEl = document.querySelector('[data-run-edit]'), bl = document.querySelector('[data-run-blocker]');
    if (!btnEl || !bl || ed.run.status === 'running') return;
    const blocker = this._editBlocker();
    const st = runBtnStyle(blocker, false);
    btnEl.style.color = st.color; btnEl.style.background = st.background; btnEl.setAttribute('aria-disabled', String(!!blocker));
    bl.style.display = blocker ? 'block' : 'none'; bl.textContent = blocker ? 'ℹ ' + blocker : '';
  };
  P._edRunBar = function () {
    const ed = this._ed(), run = ed.run, op = ed.op, running = run.status === 'running';
    const blocker = running ? null : this._editBlocker();
    const lbl = running ? 'Running ' + OP_LABEL[run.op || op] + '…' : 'Run ' + OP_LABEL[op];
    return h('div', { 'data-edit-run': '1', style: { display: 'grid', gap: 8, minWidth: 0 } },
      h('button', { type: 'button', 'data-run-edit': '1', 'aria-disabled': String(!!blocker || running), 'aria-busy': String(running), onClick: () => this.runEdit(), style: runBtnStyle(blocker, running) }, lbl),
      h('div', { 'data-run-blocker': '1', style: { display: blocker ? 'block' : 'none', color: ed.attempt ? '#fca5a5' : '#fde68a', fontSize: 12 } }, blocker ? (ed.attempt ? '✗ ' : 'ℹ ') + blocker : ''),
      running ? this._edProgress(run) : null,
      run.status === 'error' ? h('div', { role: 'alert', 'data-edit-error': '1', style: { border: '1px solid rgba(248,113,113,.5)', background: 'rgba(248,113,113,.08)', borderRadius: 8, padding: 9, display: 'grid', gap: 5 } },
        h('div', { style: { color: '#fca5a5', fontWeight: 800, fontSize: 13 } }, '✗ ' + OP_LABEL[run.op || op] + ' failed at stage: ' + run.error.stage + (run.error.gate ? ' (gate ' + run.error.gate + ')' : '')),
        h('div', { style: { color: '#fecaca', fontSize: 12, overflowWrap: 'anywhere' } }, run.error.message),
        h('div', { style: css.row }, run.error.retry === 'poll' ? btn('Retry status check', () => this.retryEdit(), '#fbbf24') : run.error.retry === 'run' ? btn('Retry', () => this.retryEdit(), '#fbbf24') : null,
          run.jobId ? btn(ed.log ? 'Refresh technical log' : 'Show technical log', () => this.loadEditLog(), '#94a3b8') : null),
        ed.log ? h('pre', { style: Object.assign({}, css.mono, { whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto', margin: 0 }) }, ed.log) : null) : null,
      run.status === 'done' ? h('div', { role: 'status', style: { color: tone.ok, fontSize: 12 } }, '✓ Complete in ' + Math.round(((run.finishedAt || Date.now()) - run.startedAt) / 1000) + 's — result below.') : null);
  };
  P._edResults = function () {
    const ed = this._ed(), rs = ed.results, base = this.state.backendUrl;
    if (!rs.length) return null;
    const a = rs[Math.min(ed.active, rs.length - 1)];
    return h('div', { 'data-edit-results': '1', style: { display: 'grid', gap: 8, minWidth: 0 } },
      h('div', { style: css.title }, 'Edit results'),
      h('img', { src: base + a.imageUrl, alt: 'Edit result', 'data-fullscreen': 'only', 'data-fullscreen-image-id': a.imageId, 'data-fullscreen-caption': a.imageId, style: { width: '100%', maxHeight: '60vh', objectFit: 'contain', borderRadius: 8, background: '#030710', border: '1px solid rgba(148,163,184,.2)', cursor: 'zoom-in' } }),
      rs.length > 1 ? h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(70px,96px))', gap: 6 } }, ...rs.map((r, i) => h('button', { key: r.imageId, type: 'button', title: r.imageId + (i === ed.active ? ' (click again for fullscreen)' : ''), onClick: () => (i === ed.active ? window.DexLightbox.open({ src: base + r.imageUrl, caption: r.imageId, actions: this.lightboxActions(r.imageId) }) : this.edSet({ active: i })),
        style: { padding: 0, border: '2px solid ' + (i === ed.active ? '#38bdf8' : 'rgba(148,163,184,.2)'), borderRadius: 7, overflow: 'hidden', cursor: 'pointer', background: '#0a0e14', aspectRatio: '1 / 1' } }, h('img', { src: base + r.imageUrl, alt: r.imageId, style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' } })))) : null,
      h('div', { style: css.row }, btn('Use as new source', () => this.useAsNewSource(a.imageId), '#a78bfa'), btn('Compare to source', () => { if (this.setScreen('library') === false) return; this.wsSet({ compareIds: [a.sourceId || ed.source.imageId, a.imageId].filter(Boolean) }); this.loadCompare(); }, '#38bdf8'),
        btn('Another variation', () => { const s = this._ed().state; s.params.seed = -1; this.runEdit(); }, '#65d66e'), btn('Enhance', () => this.sendToEnhance(a.imageId), '#f59e0b'), btn('Keeper', () => this.toggleKeeper(a.imageId, !a.keeper, a), '#fbbf24')));
  };
  P._edLayoutSwitch = function () {
    const ed = this._ed(), set = l => { try { localStorage.setItem(LAYOUT_KEY, l); } catch (_) {} this.edSet({ layout: l }); };
    return h('div', { style: css.row }, h('span', { style: css.muted }, 'Layout'), btn('A · Compact', () => set('compact'), ed.layout === 'compact' ? '#a78bfa' : '#94a3b8', { 'aria-pressed': String(ed.layout === 'compact'), 'data-layout': 'compact' }),
      btn('B · Studio', () => set('studio'), ed.layout === 'studio' ? '#a78bfa' : '#94a3b8', { 'aria-pressed': String(ed.layout === 'studio'), 'data-layout': 'studio' }));
  };
  const accordion = (self, key, title, body, openByDefault) => {
    const ed = self._ed(); const open = ed.openSections[key] !== undefined ? ed.openSections[key] : !!openByDefault;
    return h('details', { 'data-section': key, open: open ? '' : null, onToggle: e => { ed.openSections[key] = e.target.open; }, style: { border: '1px solid rgba(148,163,184,.16)', borderRadius: 9, background: 'rgba(6,10,16,.5)' } },
      h('summary', { style: { padding: '10px 12px', fontSize: 12, fontWeight: 800, color: '#cbd5e1', letterSpacing: '.05em', textTransform: 'uppercase', minHeight: 40, display: 'flex', alignItems: 'center' } }, (open ? '▾ ' : '▸ ') + title),
      h('div', { style: { padding: '0 12px 12px' } }, body));
  };

  // CN-10/11 Puppet Master: pose authoring (OpenPose-18 PNG/JSON export; quadruped/winged plans labelled non-OpenPose).
  // A persistent DOM widget (like the model picker) so a re-render never interrupts a drag; one editor per source image.
  // No ControlNet model is installed, so exported poses are files for later use and never condition a generation here.
  P._edPuppet = function () {
    const ed = this._ed(), src = ed.source;
    if (!window.DexPuppetMaster || !src) return h('div', { style: css.muted }, 'Puppet Master is not loaded.');
    const key = src.imageId || src.url;
    if (this._puppet && this._puppet.key === key) return this._puppet.root;
    if (this._puppet) { try { this._puppet.api.destroy(); } catch (_) {} if (this._puppet.blobUrl) URL.revokeObjectURL(this._puppet.blobUrl); }
    const root = document.createElement('div'); root.setAttribute('data-puppet-master', key);
    const w = Number(src.width || (ed.state && ed.state.params && ed.state.params.width) || 512), hh = Number(src.height || (ed.state && ed.state.params && ed.state.params.height) || 512);
    const clamp = v => Math.max(64, Math.min(2048, Math.round(v)));
    const api = window.DexPuppetMaster.mount(root, { width: clamp(w), height: clamp(hh), plan: 'openpose18' });
    const holder = this._puppet = { key, root, api, blobUrl: null };
    fetch(this.state.backendUrl + src.url).then(r => r.ok ? r.blob() : null).then(b => {
      if (!b || this._puppet !== holder) return;
      holder.blobUrl = URL.createObjectURL(b); api.setBackground(holder.blobUrl);   // blob: only — the editor refuses remote URLs
    }).catch(() => {});
    return root;
  };
  P._edScriptOptions = function (sc) {
    const o = Object.assign({}, SCRIPT_DEFAULTS[sc.kind], sc.opts && sc.opts[sc.kind]);
    const num = k => (o[k] === '' || o[k] === undefined ? undefined : Number(o[k]));
    if (sc.kind === 'sd-upscale') return { scale: num('scale'), overlap: num('overlap'), tile_width: num('tile_width'), tile_height: num('tile_height'), upscaler: o.upscaler };
    if (sc.kind === 'loopback') return { loops: num('loops'), final_strength: num('final_strength'), curve: o.curve };
    if (sc.kind === 'outpaint-poor') return { pixels: num('pixels'), mask_blur: num('mask_blur'), masked_content: o.masked_content, directions: o.directions };
    return { pixels: num('pixels'), mask_blur: num('mask_blur'), noise_q: num('noise_q'), color_variation: num('color_variation'), directions: o.directions };
  };
  P._edScriptBlock = function () {
    const ed = this._ed(), op = ed.op;
    if (!ed.script) { let saved = null; try { saved = JSON.parse(localStorage.getItem(SCRIPTS_KEY) || 'null'); } catch (_) {} ed.script = { kind: saved && SCRIPT_OP[saved.kind] ? saved.kind : '', opts: (saved && saved.opts && typeof saved.opts === 'object') ? saved.opts : {} }; }
    const sc = ed.script;
    // SC-25: script choice and options persist per browser (A1111 keeps script settings in ui-config.json). No prompt text.
    const persist = cur => { try { localStorage.setItem(SCRIPTS_KEY, JSON.stringify({ kind: cur.kind, opts: cur.opts })); } catch (_) {} };
    const kinds = Object.keys(SCRIPT_OP).filter(k => SCRIPT_OP[k] === op);
    if (!kinds.length) return null;
    const active = sc.kind && SCRIPT_OP[sc.kind] === op ? sc.kind : '';
    const o = active ? Object.assign({}, SCRIPT_DEFAULTS[active], sc.opts[active]) : {};
    // Merge into the CURRENT options (not this render's snapshot): a handler bound in an earlier render must not undo newer edits.
    const curO = () => Object.assign({}, SCRIPT_DEFAULTS[active], this._ed().script.opts[active]);
    const setO = patch => { const cur = this._ed().script; cur.opts[active] = Object.assign(curO(), patch); cur.preview = null; persist(cur); this.edSet({ script: cur }); };
    const field = (k, t, attrs) => label(t, h('input', Object.assign({ type: 'number', value: String(o[k]), style: css.input, 'data-script-field': k, onChange: e => setO({ [k]: e.target.value }) }, attrs)));
    const choice = (k, t, list) => label(t, h('select', { value: o[k], style: css.input, 'data-script-field': k, 'aria-label': t, onChange: e => setO({ [k]: e.target.value }) }, ...list.map(v => h('option', { key: v, value: v }, v))));
    const dirs = () => h('div', { style: css.row, 'data-script-field': 'directions' }, h('span', { style: css.label }, 'Outpainting direction'),
      ...['left', 'right', 'up', 'down'].map(d => h('label', { key: d, style: Object.assign({}, css.row, { fontSize: 12, color: '#cbd5e1' }) }, h('input', { type: 'checkbox', checked: (o.directions || []).includes(d), onChange: e => setO({ directions: ['left', 'right', 'up', 'down'].filter(x => x === d ? e.target.checked : (curO().directions || []).includes(x)) }) }), d)));
    const fields = active === 'sd-upscale' ? [field('scale', 'Scale factor (1–4)', { min: '1', max: '4', step: '0.05' }), field('overlap', 'Tile overlap (0–256, step 16)', { min: '0', max: '256', step: '16' }), field('tile_width', 'Tile width', { step: '8' }), field('tile_height', 'Tile height', { step: '8' }), choice('upscaler', 'Upscaler', ['lanczos', 'nearest', 'bicubic', 'bilinear', 'none'])]
      : active === 'loopback' ? [field('loops', 'Loops (1–32)', { min: '1', max: '32' }), field('final_strength', 'Final denoising strength', { min: '0', max: '1', step: '0.01' }), choice('curve', 'Denoising strength curve', ['Aggressive', 'Linear', 'Lazy'])]
      : active === 'outpaint-poor' ? [field('pixels', 'Pixels to expand', { min: '8', max: '256', step: '8' }), field('mask_blur', 'Mask blur', { min: '0', max: '64' }), choice('masked_content', 'Masked content', ['fill', 'original']), dirs()]
      : active === 'outpaint-mk2' ? [field('pixels', 'Pixels to expand', { min: '8', max: '256', step: '8' }), field('mask_blur', 'Mask blur', { min: '0', max: '64' }), field('noise_q', 'Fall-off exponent (lower = higher detail)', { min: '0', max: '4', step: '0.01' }), field('color_variation', 'Color variation', { min: '0', max: '1', step: '0.01' }), dirs()] : [];
    const preview = async () => { const req = this._editRequest(); const r = await this._api(req.route, Object.assign({}, req.body, { dry_run: true })); const cur = this._ed().script; cur.preview = r.ok ? r.data : { error: r.data.error || ('HTTP ' + r.status) }; this.edSet({ script: cur }); };
    const pv = sc.preview;
    return h('div', { 'data-edit-scripts': op, style: { display: 'grid', gap: 6, borderTop: '1px solid rgba(148,163,184,.12)', paddingTop: 8, marginTop: 8 } },
      label('Script (A1111)', h('select', { value: active, style: css.input, 'data-script-field': 'kind', 'aria-label': 'Stock A1111 script', onChange: e => { const cur = this._ed().script; cur.kind = e.target.value; cur.preview = null; persist(cur); this.edSet({ script: cur }); } },
        h('option', { value: '' }, 'None'), ...kinds.map(k => h('option', { key: k, value: k }, SCRIPT_LABEL[k])))),
      active ? h('div', { style: Object.assign({}, css.row, { alignItems: 'end' }) }, ...fields) : null,
      active ? h('div', { style: css.muted }, 'Run uses this script: every ' + (active === 'loopback' ? 'loop' : active === 'sd-upscale' ? 'tile' : active === 'outpaint-mk2' ? 'direction' : 'tile') + ' is a separate real sd-cli pass on Big Mac (one model load each); only the final image is saved. Strength outside sd-cli\'s 0.01–0.99 is clamped and recorded.' + (active === 'outpaint-mk2' || active === 'outpaint-poor' ? ' Latent noise / latent nothing are not offered: sd-cli cannot initialise the masked latent.' : '')) : null,
      active ? h('div', { style: css.row }, btn('Preview passes', preview, '#38bdf8', { 'data-script-preview': 'true' }),
        pv ? h('span', { style: pv.error ? { color: tone.bad, fontSize: 12 } : css.mono, 'data-script-plan': 'true' }, pv.error ? pv.error : (pv.passes + ' pass(es) → ' + pv.result_size)) : null) : null);
  };
  P.buildEditWorkbench = function () {
    const ed = this._ed(), ws = this._ws();
    const frame = (...kids) => h('div', { 'data-edit-workbench': ed.layout, style: { display: 'grid', gap: 12, maxWidth: ed.layout === 'studio' ? 1280 : 860, minWidth: 0 } }, ...kids);
    if (!this._edBound) { this._edBound = true; this._ensureEditSource(); if (!this._pasteBound) { this._pasteBound = true; window.addEventListener('paste', e => { if (this.state.screens[this.state.version] !== 'edit') return; const f = [...((e.clipboardData && e.clipboardData.files) || [])].find(x => /^image\//.test(x.type)); if (f) { e.preventDefault(); this.importEditSource(f); } }); } }
    const importer = h('label', { style: { border: '1px dashed rgba(167,139,250,.5)', color: '#c4b5fd', borderRadius: 8, padding: '10px 12px', minHeight: 40, cursor: 'pointer', fontSize: 12, fontWeight: 700, display: 'inline-block' }, onDragover: e => e.preventDefault(), onDrop: e => { e.preventDefault(); this.importEditSource(e.dataTransfer.files[0]); } },
      'Import image (PNG/JPEG/WebP) — click, drop or paste', h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', style: { display: 'none' }, onChange: e => this.importEditSource(e.target.files[0]) }));
    if (ed.loading) return frame(h('div', { role: 'status', 'data-edit-loading': '1', style: Object.assign({}, css.panel, { color: '#a5b4fc' }) }, 'Loading source image and its recorded settings…', h('div', { style: css.mono }, ed.loading)));
    if (ed.error) return frame(h('div', { role: 'alert', 'data-edit-load-error': '1', style: { border: '1px solid rgba(248,113,113,.5)', background: 'rgba(248,113,113,.08)', borderRadius: 9, padding: 12, display: 'grid', gap: 8 } },
      h('b', { style: { color: '#fca5a5' } }, '✗ Could not open this image in Edit (stage: ' + ed.error.stage + ')'), h('div', { style: { color: '#fecaca', fontSize: 12 } }, ed.error.message),
      h('div', { style: css.row }, ed.error.imageId ? btn('Try again', () => this.openImageInEdit(ed.error.imageId, ed.op), '#fbbf24') : null, btn('Dismiss', () => this.edSet({ error: null }), '#94a3b8'))), importer);
    if (!ed.source || !ed.state) return frame(h('div', { style: css.panel }, h('div', { style: Object.assign({}, css.title, { marginBottom: 6 }) }, 'Edit'),
      h('div', { style: css.muted }, 'Send an image here with Img2Img, Inpaint or Outpaint from a result, the image viewer or the Library — it arrives with its own recorded generation settings. Or import one.'),
      h('div', { style: Object.assign({}, css.row, { marginTop: 8 }) }, importer, btn('Open Library', () => this.setScreen('library'), '#38bdf8'))),
      ed.results.length ? this._edResults() : null);
    const st = ed.state, op = ed.op;
    const preset = this.buildPresetBar(op, r => this.applyEditRecipe(r), () => this.editPresetSettings());
    const opPanel = h('div', null, op === 'inpaint' ? this._edMaskBlock() : op === 'outpaint' ? this._edOutpaintBlock() : h('div', { style: css.muted }, 'img2img re-renders the whole source image guided by the prompt and strength. Use Inpaint to change only part of it.'), this._edScriptBlock());
    const adv = [accordion(this, 'prep', 'Source preparation', this._edPrepBlock(), false), accordion(this, 'presets', 'Presets', preset, false), accordion(this, 'pose', 'Puppet Master · pose (OpenPose export)', h('div', { 'data-edit-puppet': 'true' }, this._ed().puppetOn ? this._edPuppet() : btn('Start pose editor', () => this.edSet({ puppetOn: true }), '#a78bfa', { 'data-puppet-start': 'true' })), !!this._ed().puppetOn), accordion(this, 'recall', 'Recalled record (raw)', h('pre', { style: Object.assign({}, css.mono, { whiteSpace: 'pre-wrap', maxHeight: 220, overflow: 'auto', margin: 0 }) }, JSON.stringify({ recall: ed.source.recall, edit: { op, editModel: st.editModel, params: st.params, loras: st.loras } }, null, 1)), false)];
    if (op !== 'img2img') adv.shift();
    const run = this._edRunBar(), results = this._edResults();
    const head = h('div', { style: css.row }, h('div', { style: css.title }, 'Edit'), h('div', { style: { flex: 1 } }), this._edLayoutSwitch());
    if (ed.layout === 'studio') {
      const stage = op === 'inpaint' ? this._edMaskBlock() : h('div', { style: { display: 'grid', gap: 8 } }, h('img', { src: this.state.backendUrl + ed.source.url, alt: 'Edit source', 'data-fullscreen': 'only', 'data-fullscreen-image-id': ed.source.imageId || '', style: { width: '100%', maxHeight: '70vh', objectFit: 'contain', background: '#05080d', border: '1px solid rgba(148,163,184,.2)', borderRadius: 8, cursor: 'zoom-in' } }), op === 'outpaint' ? this._edOutpaintBlock() : null);
      return frame(head, this._edRecallBanner(), this._edOpSwitch(),
        h('div', { className: 'dex-ed-studio' },
          h('div', { style: { display: 'grid', gap: 12, minWidth: 0, alignContent: 'start' } }, h('div', { style: css.panel }, stage), results ? h('div', { style: css.panel }, results) : null),
          h('div', { style: { display: 'grid', gap: 12, minWidth: 0, alignContent: 'start' } }, h('div', { style: css.panel }, this._edSourceCard()), h('div', { style: css.panel }, this._edPromptBlock(), this._edParams(), this._edScriptBlock()), this._edResources(), h('div', { className: 'dex-ed-run', style: Object.assign({}, css.panel, { marginBottom: 0 }) }, run), ...adv.slice(0, 3))));
    }
    return frame(head, this._edRecallBanner(), h('div', { style: css.panel }, this._edSourceCard()), this._edOpSwitch(), h('div', { style: css.panel }, this._edPromptBlock(), this._edParams()), this._edResources(),
      h('div', { style: css.panel }, h('div', { style: Object.assign({}, css.title, { marginBottom: 8 }) }, OP_LABEL[op] + ' settings'), opPanel),
      h('div', { className: 'dex-ed-run', style: Object.assign({}, css.panel, { marginBottom: 0 }) }, run), results ? h('div', { style: css.panel }, results) : null, ...adv);
  };

  // Viewer actions: send the exact image to Edit with any operation.
  P.lightboxActions = function (imageId) {
    if (!imageId) return [];
    const out = [];
    for (const [k, l] of OPS) if (this._gate(k)) out.push({ label: '→ ' + l, onClick: () => this.openImageInEdit(imageId, k) });
    out.push({ label: 'Details', onClick: () => this.showInLibrary(imageId) });
    // Nondestructive basics: each makes a NEW canonical image linked to this one; the original file is never modified.
    if (window.DexTransform) {
      out.push({ label: '↻ Rotate', title: 'Rotate 90° clockwise (new version)', onClick: () => this.transformImage(imageId, [{ op: 'rotate', degrees: 90 }]) });
      out.push({ label: '↺ Rotate', title: 'Rotate 90° counter-clockwise (new version)', onClick: () => this.transformImage(imageId, [{ op: 'rotate', degrees: 270 }]) });
      out.push({ label: '⇋ Flip', title: 'Mirror left-right (new version)', onClick: () => this.transformImage(imageId, [{ op: 'flip', axis: 'h' }]) });
      out.push({ label: '⇅ Flip', title: 'Mirror top-bottom (new version)', onClick: () => this.transformImage(imageId, [{ op: 'flip', axis: 'v' }]) });
      for (const [rw, rh] of [[1, 1], [4, 3], [16, 9]]) out.push({ label: 'Crop ' + rw + ':' + rh, title: 'Centre crop to ' + rw + ':' + rh + ' (new version)', onClick: () => this.transformImage(imageId, null, { rw, rh }) });
    }
    return out;
  };
  P.transformImage = async function (imageId, ops, crop) {
    const meta = await this._imageMeta(imageId);
    if (!meta || !meta.width) { this.toast('Could not read this image to transform it', '#ef4444'); return; }
    const list = ops || [window.DexTransform.cropPreset(meta.width, meta.height, crop.rw, crop.rh)];
    const check = window.DexTransform.normalize(list, { width: meta.width, height: meta.height });
    if (check.error) { this.toast(check.error, '#ef4444'); return; }
    const r = await this._api('/api/actions/transform', { image_id: imageId, ops: check.ops });
    if (!r.ok) { this.toast((r.data && r.data.error) || 'Transform rejected', '#ef4444'); return; }
    this.toast('Creating a new version (' + check.result.width + '×' + check.result.height + ')…', '#a78bfa');
    const job = await this._waitJob(r.data.job_id);
    const done = job && (job.results || []).find(x => x.status === 'DONE');
    if (job && this._jobOk(job.status) && done) { this.toast('Saved as a new image; the original is unchanged', '#65d66e'); this.showInLibrary(done.imageId); }
    else this.toast('Transform failed' + (job && job.firstFailedGate ? ' at ' + job.firstFailedGate : ''), '#ef4444');
  };

  // ── Create integration ───────────────────────────────────────────────
  P._createLoras = function () { return this.state.createLoras || []; };
  P.setCreateLoras = function (fn) {
    this.setState({ createLoras: E.normalizeLoras(fn(this._createLoras())) });
  };
  P.buildCreateResources = function () {
    const s = this.state, spec = this._targetSpec(), ctl = this._controls();
    if (!ctl.lora) return h('div', { 'data-resources': 'create', style: Object.assign({}, css.panel, { borderStyle: 'dashed' }) }, h('div', { style: css.title }, 'Resources · LoRA'), h('div', { style: css.muted }, (spec && spec.label || s.target) + ' does not use LoRAs or VAE overrides (MFLUX). Choose an SDCPP model to use them.'));
    return this.buildResourcesControl({ scope: 'create', loras: this._createLoras(), catalog: (s.assets && s.assets.loras) || [], vaes: s.assets && s.assets.vaes, vae: s.selectedVae === 'default' ? 'auto' : s.selectedVae, showVae: true, modelLabel: spec && (spec.label || spec.id),
      setLoras: fn => this.setCreateLoras(fn), setVae: v => this.setState({ selectedVae: v === 'auto' ? 'default' : v }),
      quiet: (name, w) => { const l = this._createLoras().find(x => x.name === name); if (l) l.weight = w; }, onTrigger: w => this.addTriggerWord(w) });
  };
  P.createPresetSettings = function () { const s = this.state; return { target: s.target, width: +s.width, height: +s.height, steps: +s.steps, cfg: +s.cfg, sampler: s.sampler, scheduler: s.scheduler, vae: s.selectedVae, preset: s.preset, quantity: this.ws ? this.ws.quantity : 1, loras: this._createLoras(), prompt: s.prompt, negPrompt: s.negPrompt }; };

  // ── wiring ────────────────────────────────────────────────────────────
  const _onCreateDone = P._onCreateDone;
  P._onCreateDone = function (job, body) {
    _onCreateDone.call(this, job, body);
    try { if (body) for (const r of D.jobResults(job)) if (r.imageId && r.status === 'DONE') this._rememberSnapshot(r.imageId, body, r.seed); } catch (_) {}
  };
  const _createBody = P._createBody;
  P._createBody = function (over) {
    const body = _createBody.call(this, over);
    if (this._controls().lora) { const eff = this._effectiveLoras(this._createLoras(), (this.state.assets && this.state.assets.loras) || []); if (eff.length) body.loras = eff; }
    return body;
  };
  const _renderVals = P.renderVals;
  P.renderVals = function () {
    const vals = _renderVals.call(this);
    this._ed();
    const screen = this.state.screens[this.state.version];
    vals.editWorkbench = screen === 'edit' ? this.buildEditWorkbench() : null;
    vals.createResources = screen === 'create' ? this.buildCreateResources() : null;
    vals.goToImg2img = () => this.sendActiveResultToEdit('img2img');
    const targets = (this.state.modelTargets || []);
    // A real Node (same reference every render) is mounted once by the runtime and never re-parented,
    // so the picker keeps focus and its open state across renders.
    const pick = this._modelPicker('create');
    pick.update({ targets, cards: this.state.modelCards || [], activeId: this.state.target, onPick: id => this.selectModelWithValidation(id) });
    vals.targetSelectV1 = vals.targetSelectV2 = vals.targetSelectV3 = pick.shell;
    vals.createPresets = h('div', { style: { marginBottom: 12 } }, this.buildPresetBar('create', r => this.applyFavoritePreset(r.id), () => this.createPresetSettings()));
    return vals;
  };
  const _mount = P.componentDidMount;
  P.componentDidMount = function () { _mount.call(this); this._ed(); };
})();
