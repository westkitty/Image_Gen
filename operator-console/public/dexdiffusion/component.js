// DexDiffusion component — ported verbatim from DexDiffusion_Combined.dc.html
// Runs on the lightweight DC-compatible runtime in dc-runtime.js (DCLogic + React.createElement).
// The fictional A1111 onGenerate() stub (sdapi/v1) was removed so the real port-31337
// generate-controlled flow (the first onGenerate) is the one that runs.

class Component extends DCLogic {
  state = {
    version: (() => { const v = Number(localStorage.getItem('dex_version')); return v === 2 || v === 3 ? v : 1; })(),
    screens: (() => { let s = 'create'; try { s = sessionStorage.getItem('dex_screen') || 'create'; } catch {} return { 1: s, 2: s, 3: s }; })(),
    // Create
    target: 'sd15',
    prompt: '', negPrompt: '',
    promptOpen: true,
    settingsOpen: false, compactMode: localStorage.getItem('dex_compact_mode') === 'true',
    selectedVae: 'default', favoriteName: '',
    // Recipes (formerly Favorite presets). Prompt text persists only when prompt saving is on;
    // older presets that stored prompts are scrubbed on load when it is off.
    favoritePresets: (() => {
      try {
        const save = localStorage.getItem('dex_save_prompts') === 'true';
        const raw = JSON.parse(localStorage.getItem('dex_favorite_presets') || '[]');
        const clean = raw.map(p => DexClient.sanitizeRecipe(p.params ? { id: p.id, name: p.name, target: p.params.target, width: p.params.width, height: p.params.height, steps: p.params.steps, cfg: p.params.cfg_scale, sampler: p.params.sampler, scheduler: p.params.scheduler, vae: p.params.selectedVae, preset: p.params.preset, prompt: p.params.prompt, negPrompt: p.params.negative_prompt } : p, save));
        localStorage.setItem('dex_favorite_presets', JSON.stringify(clean));
        return clean;
      } catch { return []; }
    })(),
    steps: 20, cfg: 7, seed: -1, width: 512, height: 512,
    sampler: 'euler_a', scheduler: 'discrete',
    jobStatus: 'idle', progress: 0, currentImageSrc: null, lastSeed: null, errorMsg: '', lastGenerationParams: null,
    // Batch
    batchAxisX: 'seed', batchValuesX: '-1,-1,-1,-1',
    batchPrompt: '', batchNeg: '', batchSteps: 20, batchCfg: 7, batchW: 512, batchH: 512,
    batchQueue: [], batchRunning: false, batchDone: 0, batchTotal: 0,
    batchStatus: 'idle',
    // img2img
    i2iPrompt: '', i2iNeg: '', i2iDenoise: 0.75,
    i2iSteps: 20, i2iCfg: 7, i2iSeed: -1, i2iSrcRunId: 'last',
    i2iStatus: 'idle', i2iProgress: 0, i2iResult: null,
    // Enhance
    enhSrcRunId: 'last', enhScale: 2, enhMethod: 'pillow',
    enhStatus: 'idle', enhResult: null,
    // Models
    checkpoints: [], loadingCheckpoints: false, activeCheckpoint: '', capabilityData: null,
    modelTargets: [],          // raw capability targets (with defaults) for preset application
    preset: 'balanced',
    // img2img / enhance source files (populated from /api/runs/:id/files)
    runFiles: {}, i2iSrcFile: '', enhSrcFile: '',
    // Library filters + pagination
    libFilter: 'all', libOffset: 0, libTotal: 0, libHasMore: false, libLoadingMore: false,
    // Ollama prompt enhance
    ollamaOnline: false, ollamaModel: '', enhancingPrompt: false,
    // Wildcards
    wildcards: [], showWildcards: false, wildcardFilter: '',
    // Extra networks / LoRA
    assets: { loras: [], vaes: [], embeddings: [] }, loadingAssets: false,
    // Inpaint (extends the Edit screen)
    inpStatus: 'idle', inpResult: null, inpMaskData: null, inpStrength: 0.75,
    // Global
    backendUrl: (() => { try { return DexClient.resolveBackendBase(localStorage.getItem('dex_backend_url')); } catch { return ''; } })(),
    backendOnline: false,
    runs: (() => { try { return JSON.parse(localStorage.getItem('dex_runs') || '[]'); } catch { return []; } })(),
    selectedRunId: '', selectedRunDetail: null, loadingRunDetail: false, runSearch: '',
    assetQuery: '', serverStatusSummary: '', lastValidation: '',
    savePrompts: localStorage.getItem('dex_save_prompts') === 'true',
    toasts: [],
  };

  _pingTimer = null; _pollTimer = null; _toastId = 0;
  _completedImageCache = { key: null, node: null };

  componentDidMount() {
    this._keyHandler = (e) => this.onKeydown(e);
    window.addEventListener('keydown', this._keyHandler);
    this.pingBackend();
    this._pingTimer = setInterval(() => this.pingBackend(), 20000);
    this.loadRuns();
    this.loadModels();
    this.loadAssets();
    this.loadWildcards();
    this.checkOllama();
    this.loadSystemInfo();
  }
  componentWillUnmount() {
    clearInterval(this._pingTimer); clearInterval(this._pollTimer);
    window.removeEventListener('keydown', this._keyHandler);
  }

  onKeydown(e) {
    const tag = (e.target && e.target.tagName || '').toLowerCase();
    const inField = tag === 'input' || tag === 'textarea' || tag === 'select';
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); this.onGenerate(); return; }
    if (inField) return;
    if (e.key === '/') { e.preventDefault(); this.setState({ promptOpen: true }, () => document.querySelector('textarea[placeholder*="Describe the image"]')?.focus()); }
    if (e.key.toLowerCase() === 'p') this.setState(s => ({ promptOpen: !s.promptOpen }));
    if (e.key.toLowerCase() === 's') this.setState(s => ({ settingsOpen: !s.settingsOpen }));
    if (e.key.toLowerCase() === 'l') this.setScreen('library');
  }

  // ── Toast ─────────────────────────────────────────────────────
  toast(msg, color = '#65d66e') {
    const id = ++this._toastId;
    this.setState(s => ({ toasts: [...s.toasts, { id, msg, color }] }));
    setTimeout(() => this.setState(s => ({ toasts: s.toasts.filter(t => t.id !== id) })), 3200);
  }

  // ── Backend ping ──────────────────────────────────────────────
  async pingBackend() {
    try {
      const r = await fetch(this.state.backendUrl + '/api/version', { signal: AbortSignal.timeout(3000) });
      if (this.state.backendOnline !== r.ok) this.setState({ backendOnline: r.ok });
    } catch {
      if (this.state.backendOnline !== false) this.setState({ backendOnline: false });
    }
  }

  // Map one /api/run-index item to the run-card shape the UI uses.
  _mapRunItem(item) {
    const base = this.state.backendUrl;
    const img = item.primaryImage || null;
    const ok = item.status === 'PASS' || item.status === 'PARTIAL';
    const fail = item.status === 'FAIL';
    const thumbUrl = img ? base + '/api/run-file?path=' + item.id + '/' + img : null;
    return {
      id: item.id,
      model: item.controlledTargetLabel || item.type || 'sd15',
      size: item.imageCount ? item.imageCount + ' img' : '—',
      seed: '—',
      timestamp: item.createdAt || Date.now(),
      imageFile: img,
      filterCategory: item.filterCategory || '',
      type: item.type || '',
      badge: ok ? item.status : fail ? 'FAIL' : '—',
      badgeColor: ok ? '#65d66e' : fail ? '#ef4444' : '#fbbf24',
      badgeBg: ok ? 'rgba(101,214,110,.1)' : fail ? 'rgba(239,68,68,.1)' : 'rgba(251,191,36,.1)',
      thumb: thumbUrl
        ? 'center/cover no-repeat url("' + thumbUrl + '")'
        : 'linear-gradient(135deg,#0e2a1a,#1a0e2a)',
    };
  }

  // ── Load runs from real API (filter + pagination aware) ───────
  async loadRuns(opts = {}) {
    const append = !!opts.append;
    const offset = append ? this.state.libOffset : 0;
    const filter = this.state.libFilter || 'all';
    if (append) this.setState({ libLoadingMore: true });
    try {
      const url = this.state.backendUrl + '/api/run-index?limit=50&offset=' + offset +
        (filter && filter !== 'all' ? '&filter=' + encodeURIComponent(filter) : '');
      const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (!r.ok) { this.setState({ libLoadingMore: false }); return; }
      const data = await r.json();
      const mapped = (data.items || []).map(it => this._mapRunItem(it));
      const runs = append ? [...this.state.runs, ...mapped] : mapped;
      try { localStorage.setItem('dex_runs', JSON.stringify(runs.slice(0, 100))); } catch {}
      this.setState({
        runs,
        libTotal: data.total != null ? data.total : runs.length,
        libHasMore: !!data.hasMore,
        libOffset: data.nextOffset != null ? data.nextOffset : offset + mapped.length,
        libLoadingMore: false,
      });
    } catch { this.setState({ libLoadingMore: false }); }
  }

  setLibFilter(f) { this.setState({ libFilter: f, libOffset: 0 }); this.loadRuns({ filter: f }); }
  loadMoreRuns() { if (this.state.libHasMore && !this.state.libLoadingMore) this.loadRuns({ append: true }); }

  refreshAll() {
    this.pingBackend();
    this.loadRuns();
    this.loadModels();
    this.loadAssets();
    this.loadWildcards();
    this.checkOllama();
    this.loadSystemInfo();
    this.toast('Refreshed visible data', '#38bdf8');
  }

  // ── Assets / LoRA (Extra Networks) ────────────────────────────
  async loadAssets() {
    this.setState({ loadingAssets: true });
    try {
      const r = await fetch(this.state.backendUrl + '/api/assets', { signal: AbortSignal.timeout(8000) });
      if (r.ok) {
        const d = await r.json();
        this.setState({ assets: { loras: d.loras || [], vaes: d.vaes || [], embeddings: d.embeddings || [] }, loadingAssets: false });
      } else { this.setState({ loadingAssets: false }); }
    } catch { this.setState({ loadingAssets: false }); }
  }
  async discoverAssets() {
    try {
      this.setState({ loadingAssets: true });
      await fetch(this.state.backendUrl + '/api/actions/discover-assets', { method: 'POST' });
      await this.loadAssets();
      this.toast('Asset discovery refreshed', '#38bdf8');
    } catch (e) {
      this.setState({ loadingAssets: false });
      this.toast('Asset discovery failed: ' + e.message, '#ef4444');
    }
  }
  insertLora(filename) {
    const base = String(filename || '').replace(/\.[^.]+$/, '');
    const tag = '<lora:' + base + ':0.8>';
    this.setState(s => ({ prompt: (s.prompt ? s.prompt + ' ' : '') + tag }));
    this.toast('Inserted ' + tag, '#38bdf8');
  }

  // ── Wildcards ─────────────────────────────────────────────────
  async loadWildcards() {
    try {
      const r = await fetch(this.state.backendUrl + '/api/wildcards', { signal: AbortSignal.timeout(6000) });
      if (r.ok) { const d = await r.json(); this.setState({ wildcards: d.wildcards || [] }); }
    } catch {}
  }
  insertWildcard(name) {
    this.setState(s => ({ prompt: (s.prompt ? s.prompt + ' ' : '') + '__' + name + '__', showWildcards: false, wildcardFilter: '' }));
    this.toast('Inserted __' + name + '__', '#38bdf8');
  }
  // Replace the partial __filter text at cursor with __name__
  insertWildcardFiltered(name) {
    const { prompt, wildcardFilter } = this.state;
    const partial = '__' + wildcardFilter;
    const idx = prompt.lastIndexOf(partial);
    if (idx !== -1) {
      const newPrompt = prompt.slice(0, idx) + '__' + name + '__' + prompt.slice(idx + partial.length);
      this.setState({ prompt: newPrompt, showWildcards: false, wildcardFilter: '' });
    } else {
      this.setState(s => ({ prompt: (s.prompt ? s.prompt + ' ' : '') + '__' + name + '__', showWildcards: false, wildcardFilter: '' }));
    }
    this.toast('Inserted __' + name + '__', '#38bdf8');
  }
  // Prompt change — detect __ trigger for wildcard autocomplete
  onPromptChange(e) {
    const val = e.target.value;
    const cursor = e.target.selectionStart != null ? e.target.selectionStart : val.length;
    const before = val.slice(0, cursor);
    const match = before.match(/__([^_\s]*)$/);
    if (match) {
      this.setState({ prompt: val, wildcardFilter: match[1], showWildcards: true });
    } else {
      this.setState({ prompt: val, wildcardFilter: '', showWildcards: false });
    }
  }

  // ── Ollama prompt enhancement ─────────────────────────────────
  async checkOllama() {
    try {
      const r = await fetch(this.state.backendUrl + '/api/ollama/status', { signal: AbortSignal.timeout(4000) });
      if (!r.ok) { this.setState({ ollamaOnline: false }); return; }
      const d = await r.json().catch(() => ({}));
      const online = !!(d && (d.online || d.connected || d.available || (d.models && d.models.length)));
      const model = (d && (d.model || (d.models && d.models[0]))) || '';
      this.setState({ ollamaOnline: online, ollamaModel: typeof model === 'string' ? model : (model && model.name) || '' });
    } catch { this.setState({ ollamaOnline: false }); }
  }
  async enhancePrompt() {
    const { prompt, backendUrl, ollamaModel, enhancingPrompt } = this.state;
    if (enhancingPrompt) return;
    if (!prompt.trim()) { this.toast('Write a prompt to enhance first', '#fbbf24'); return; }
    this.setState({ enhancingPrompt: true });
    try {
      const r = await fetch(backendUrl + '/api/ollama/enhance', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, model: ollamaModel || undefined }),
        signal: AbortSignal.timeout(60000),
      });
      if (!r.ok) { this.setState({ enhancingPrompt: false }); this.toast('Ollama unavailable (' + r.status + ')', '#ef4444'); return; }
      const d = await r.json();
      const enhanced = d.enhanced || d.prompt || d.result || d.response || '';
      if (enhanced) { this.setState({ prompt: String(enhanced).trim(), enhancingPrompt: false }); this.toast('Prompt enhanced', '#65d66e'); }
      else { this.setState({ enhancingPrompt: false }); this.toast('No enhancement returned', '#fbbf24'); }
    } catch (e) { this.setState({ enhancingPrompt: false }); this.toast('Enhance failed: ' + e.message, '#ef4444'); }
  }

  // ── Job status helpers ────────────────────────────────────────
  // The real backend reports terminal jobs as PASS / PARTIAL / FAIL (not
  // done/error/failed). Treat anything that is not queued/running as finished.
  _jobTerminal(s) { return !!s && s !== 'queued' && s !== 'running' && s !== 'pending'; }
  _jobOk(s) { return s === 'PASS' || s === 'PARTIAL' || s === 'done' || s === 'complete' || s === 'succeeded'; }
  // Build a /api/run-file URL, tolerating an absolute path or a bare filename.
  _imgUrl(runId, file) {
    if (!runId || !file) return null;
    const name = String(file).split('/').pop();
    return this.state.backendUrl + '/api/run-file?path=' + runId + '/' + name;
  }
  // img2img and inpaint jobs never populate job.controlledOutputImage (that marker
  // is only printed by sdcpp-controlled-generate.sh) — resolve their output PNG from
  // the run's own metadata instead, keyed off job.runId which IS always set.
  async _resolveOutputImage(job) {
    if (job.controlledOutputImageUrl) return this.state.backendUrl + job.controlledOutputImageUrl;
    if (job.controlledOutputImage) return this._imgUrl(job.runId, job.controlledOutputImage);
    if (!job.runId) return null;
    try {
      const r = await fetch(this.state.backendUrl + '/api/runs/' + job.runId);
      if (!r.ok) return null;
      const data = await r.json();
      const file = (data.metadata && data.metadata.primary_image) || (data.images && data.images[0]) || null;
      return this._imgUrl(job.runId, file);
    } catch { return null; }
  }
  // Map the sampler dropdown's display label to a backend-accepted sampler id.
  _mapSampler(s) {
    const m = { 'dpm++ 2m': 'dpmpp2m', 'dpm++ sde': 'dpmpp2s_a', 'dpm++ 2s a': 'dpmpp2s_a' };
    return m[s] || s;
  }

  // ── Job poller ────────────────────────────────────────────────
  _startPoll(jobId, onComplete) {
    clearInterval(this._pollTimer);
    this._pollTimer = setInterval(async () => {
      try {
        const r = await fetch(this.state.backendUrl + '/api/jobs/' + jobId, { signal: AbortSignal.timeout(3000) });
        if (!r.ok) return;
        const job = await r.json();
        const pct = DexClient.jobProgressPercent(job.progress);
        if (pct != null) {
          const nextProgress = Math.min(99, pct);
          if (nextProgress !== this.state.progress) this.setState({ progress: nextProgress });
        }
        if (this._jobTerminal(job.status)) {
          clearInterval(this._pollTimer);
          onComplete(job);
        }
      } catch {}
    }, 900);
  }

  setVersion(v) { try { localStorage.setItem('dex_version', String(v)); } catch {} this.setState({ version: v }); }
  setScreen(s) { const { version, screens } = this.state; try { sessionStorage.setItem('dex_screen', s); } catch {} this.setState({ screens: { ...screens, [version]: s } }); }

  // ── Models — load from /api/capabilities ──────────────────────
  async loadModels() {
    this.setState({ loadingCheckpoints: true });
    try {
      const r = await fetch(this.state.backendUrl + '/api/capabilities', { signal: AbortSignal.timeout(8000) });
      if (r.ok) {
        const data = await r.json();
        // Real backend exposes the controlled-generate targets under `modelTargets`
        // (the handoff doc called this `controlledTargets`); accept either.
        const targets = data.modelTargets || data.controlledTargets || [];
        const checkpoints = targets.map(t => ({
          title: DexClient.targetOptionLabel(t),
          name: t.id,
          hash: t.status || '',
          status: t.status,
        }));
        this.setState({ checkpoints, modelTargets: targets, capabilityData: data, loadingCheckpoints: false });
        let saved = null;
        try { saved = localStorage.getItem('dex_target'); } catch {}
        const initial = DexClient.chooseInitialTarget(targets, saved, this.state.target);
        if (initial && initial !== this.state.target) {
          this.setState({ target: initial, activeCheckpoint: initial });
          this.applyTargetDefaults(initial);
        }
        this.toast('Loaded ' + checkpoints.length + ' targets', '#38bdf8');
      } else { this.setState({ loadingCheckpoints: false }); this.toast('Failed to load capabilities (' + r.status + ')', '#ef4444'); }
    } catch(e) { this.setState({ loadingCheckpoints: false }); this.toast('Cannot reach backend', '#ef4444'); }
  }

  loadCheckpoint(name) {
    // Setting the active target — no separate HTTP call needed; target is passed on generate
    this.setState({ activeCheckpoint: name, target: name });
    this.applyTargetDefaults(name);
    this.toast('Target set: ' + name, '#38bdf8');
  }

  // Apply a target's capability defaults (dims/steps/cfg/sampler), scaled by the
  // active speed preset, when the Target or Preset dropdown changes.
  applyTargetDefaults(targetId, presetOverride) {
    const t = (this.state.modelTargets || []).find(x => x.id === targetId);
    if (!t) return;
    const preset = presetOverride || this.state.preset || 'balanced';
    const baseSteps = t.defaultSteps || 20;
    const factor = preset === 'smoke' ? 0.05 : preset === 'fast' ? 0.5 : preset === 'quality' ? 2 : 1;
    let steps = Math.round(baseSteps * factor);
    if (t.minSteps) steps = Math.max(t.minSteps, steps);
    if (t.maxSteps) steps = Math.min(t.maxSteps, steps);
    this.setState({
      steps,
      cfg: t.defaultCfgScale != null ? t.defaultCfgScale : this.state.cfg,
      width: t.defaultWidth || this.state.width,
      height: t.defaultHeight || this.state.height,
      sampler: t.defaultSampler || this.state.sampler,
    });
  }
  onSelectTarget(id) {
    try { localStorage.setItem('dex_target', id); } catch {}
    this.setState({ target: id, activeCheckpoint: id });
    this.applyTargetDefaults(id);
  }

  async loadSystemInfo() {
    try {
      const r = await fetch(this.state.backendUrl + '/api/system-info', { signal: AbortSignal.timeout(8000) });
      if (r.ok) this.setState({ systemInfo: await r.json() });
    } catch {}
  }
  onSelectPreset(label) {
    // The prototype's preset options are display labels (e.g. "Fast (SD1.5)"); map to a speed bucket.
    const k = /smoke/i.test(label) ? 'smoke' : /fast|turbo|lcm/i.test(label) ? 'fast' : /qual|high|slow|detail/i.test(label) ? 'quality' : 'balanced';
    this.setState({ preset: k });
    this.applyTargetDefaults(this.state.target, k);
    this.toast('Preset: ' + k, '#38bdf8');
  }

  currentParams() {
    const { target, prompt, negPrompt, steps, cfg, seed, width, height, sampler, scheduler, savePrompts, selectedVae, preset } = this.state;
    return { target, prompt, negative_prompt: negPrompt, steps: +steps, cfg_scale: +cfg, seed, width: +width, height: +height,
      sampler: this._mapSampler(sampler), scheduler, preset, save_prompts: savePrompts,
      vae: selectedVae === 'default' ? 'auto' : selectedVae, selectedVae };
  }

  vaeLabel(value) {
    if (!value || value === 'default') return 'default / backend-selected';
    if (value === 'none') return 'none';
    return value;
  }

  validationMessages() {
    const p = this.currentParams();
    const out = [];
    if (!String(p.prompt || '').trim()) out.push(['Prompt required', 'warn']);
    if (!Number.isFinite(p.steps) || p.steps < 1 || p.steps > 150) out.push(['Steps must be 1-150', 'error']);
    if (!Number.isFinite(p.cfg_scale) || p.cfg_scale < 1 || p.cfg_scale > 30) out.push(['CFG scale must be 1-30', 'error']);
    if (!Number.isFinite(p.width) || !Number.isFinite(p.height) || p.width % 8 || p.height % 8) out.push(['Width and height must be multiples of 8', 'error']);
    const ctl = DexClient.controlsFor((this.state.modelTargets || []).find(t => t.id === p.target));
    if (p.selectedVae && p.selectedVae !== 'default' && p.selectedVae !== 'none') out.push([ctl.vae ? 'VAE override is passed to sd-cli --vae for this SDCPP target' : 'This target ignores VAE selection', ctl.vae ? 'info' : 'warn']);
    if (!out.length) out.push(['Ready to generate', 'ok']);
    return out;
  }

  saveFavoritePreset() {
    const name = (this.state.favoriteName || '').trim() || ('Recipe ' + new Date().toLocaleTimeString());
    const s = this.state;
    const preset = DexClient.sanitizeRecipe({ id: String(Date.now()), name, target: s.target, width: +s.width, height: +s.height, steps: +s.steps, cfg: +s.cfg,
      sampler: s.sampler, scheduler: s.scheduler, vae: s.selectedVae, preset: s.preset, quantity: this.ws ? this.ws.quantity : 1, prompt: s.prompt, negPrompt: s.negPrompt }, s.savePrompts);
    const favoritePresets = [preset, ...this.state.favoritePresets.filter(p => p.name !== name)].slice(0, 20);
    localStorage.setItem('dex_favorite_presets', JSON.stringify(favoritePresets));
    this.setState({ favoritePresets, favoriteName: '' });
    this.toast('Saved recipe: ' + name + (this.state.savePrompts ? '' : ' (settings only — prompt saving is off)'), '#38bdf8');
  }

  applyFavoritePreset(id) {
    const p = this.state.favoritePresets.find(x => x.id === id);
    if (!p) return;
    // Settings only; the current prompt is kept unless the recipe carries one.
    this.setState({
      target: p.target || this.state.target,
      prompt: typeof p.prompt === 'string' ? p.prompt : this.state.prompt,
      negPrompt: typeof p.negPrompt === 'string' ? p.negPrompt : this.state.negPrompt,
      steps: p.steps || this.state.steps,
      cfg: p.cfg ?? this.state.cfg,
      width: p.width || this.state.width,
      height: p.height || this.state.height,
      sampler: p.sampler || this.state.sampler,
      scheduler: p.scheduler || this.state.scheduler,
      selectedVae: p.vae || 'default',
      promptOpen: true
    });
    if (this.ws && p.quantity) this.ws.quantity = p.quantity;
    this.toast('Applied recipe: ' + p.name, '#65d66e');
  }

  renameFavoritePreset(id) {
    const p = this.state.favoritePresets.find(x => x.id === id);
    if (!p) return;
    const name = (window.prompt('Rename recipe', p.name) || '').trim();
    if (!name) return;
    const favoritePresets = this.state.favoritePresets.map(x => x.id === id ? { ...x, name: name.slice(0, 80) } : x);
    localStorage.setItem('dex_favorite_presets', JSON.stringify(favoritePresets));
    this.setState({ favoritePresets });
  }

  deleteFavoritePreset(id) {
    const favoritePresets = this.state.favoritePresets.filter(p => p.id !== id);
    localStorage.setItem('dex_favorite_presets', JSON.stringify(favoritePresets));
    this.setState({ favoritePresets });
  }

  async inspectRun(runId) {
    if (!runId || runId === 'no runs yet') return;
    this.setState({ selectedRunId: runId, selectedRunDetail: null, loadingRunDetail: true });
    try {
      const r = await fetch(this.state.backendUrl + '/api/runs/' + runId + '/metadata', { signal: AbortSignal.timeout(7000) });
      if (!r.ok) throw new Error('metadata ' + r.status);
      const detail = await r.json();
      this.setState({ selectedRunDetail: detail, loadingRunDetail: false });
    } catch (e) {
      this.setState({ loadingRunDetail: false });
      this.toast('Run metadata unavailable: ' + e.message, '#ef4444');
    }
  }

  reuseSelectedRun() {
    const d = this.state.selectedRunDetail;
    const replay = d && d.replay;
    if (!replay || !replay.available) { this.toast('Selected run is not reusable', '#fbbf24'); return; }
    this.setState({
      target: replay.target || this.state.target,
      prompt: replay.prompt || this.state.prompt,
      negPrompt: replay.negative_prompt || '',
      steps: replay.steps || this.state.steps,
      cfg: replay.cfg_scale || this.state.cfg,
      seed: replay.seed ?? this.state.seed,
      width: replay.width || this.state.width,
      height: replay.height || this.state.height,
      promptOpen: true,
      screens: { ...this.state.screens, [this.state.version]: 'create' }
    });
    this.toast('Run settings loaded into Create', '#65d66e');
  }

  copyText(label, text) {
    try {
      navigator.clipboard.writeText(text);
      this.toast(label + ' copied', '#38bdf8');
    } catch {
      this.toast('Clipboard unavailable', '#ef4444');
    }
  }

  async serverStatus() {
    try {
      const r = await fetch(this.state.backendUrl + '/api/server-status', { signal: AbortSignal.timeout(5000) });
      const d = await r.json().catch(() => ({}));
      this.setState({ serverStatusSummary: d.status || d.summary || JSON.stringify(d).slice(0, 160) });
      this.toast('Server status refreshed', '#38bdf8');
    } catch (e) {
      this.setState({ serverStatusSummary: 'Unavailable: ' + e.message });
    }
  }

  // ── Source files for img2img / Enhance / Inpaint ──────────────
  // Populate the "Source image" picker from /api/runs/:id/files.
  async loadRunFiles(runId) {
    if (!runId || runId === 'last') runId = (this.state.runs[0] || {}).id;
    if (!runId || this.state.runFiles[runId]) return;
    try {
      const r = await fetch(this.state.backendUrl + '/api/runs/' + runId + '/files', { signal: AbortSignal.timeout(6000) });
      if (!r.ok) return;
      const d = await r.json();
      const imgs = (d.images && d.images.length ? d.images : (d.files || []))
        .filter(f => /\.(png|jpe?g|webp)$/i.test(f));
      this.setState(s => ({ runFiles: { ...s.runFiles, [runId]: imgs } }));
    } catch {}
  }

  // ── Generate (txt2img) ────────────────────────────────────────
  async onGenerate() {
    const { jobStatus, prompt, negPrompt, steps, cfg, seed, width, height,
            target, backendUrl, savePrompts, sampler, scheduler, selectedVae } = this.state;
    if (jobStatus === 'generating') {
      clearInterval(this._pollTimer);
      this.setState({ jobStatus: 'idle', progress: 0 });
      return;
    }
    if (!prompt.trim()) { this.toast('Enter a prompt first', '#fbbf24'); return; }
    const body = {
      target: target || 'sd15',
      prompt: prompt.trim(),
      negative_prompt: negPrompt || '',
      steps: +steps, cfg_scale: +cfg, seed: +seed,
      width: +width, height: +height,
      sampler: this._mapSampler(sampler), scheduler: scheduler || 'discrete',
      vae: selectedVae === 'default' ? 'auto' : selectedVae,
      save_prompts: savePrompts,
    };
    this.setState({ jobStatus: 'generating', progress: 0, currentImageSrc: null, errorMsg: '', lastGenerationParams: { ...body, preset: this.state.preset || 'balanced', selectedVae: this.state.selectedVae } });
    try {
      const r = await fetch(backendUrl + '/api/actions/generate-controlled', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: r.statusText }));
        this.setState({ jobStatus: 'error', errorMsg: err.error || r.statusText });
        this.toast(err.error || 'Generate failed', '#ef4444'); return;
      }
      const { job_id } = await r.json();
      this._startPoll(job_id, (job) => this._onGenerateDone(job, body, backendUrl));
    } catch(e) {
      this.setState({ jobStatus: 'error', errorMsg: e.message });
      this.toast(e.message, '#ef4444');
    }
  }

  _onGenerateDone(job, params, backendUrl) {
    if (this._jobOk(job.status)) {
      const runId = job.runId;
      const imgFile = job.controlledOutputImage;
      const imgSrc = job.controlledOutputImageUrl ? backendUrl + job.controlledOutputImageUrl : this._imgUrl(runId, imgFile);
      const run = {
        id: runId || ('local-' + Date.now()),
        model: params.target || 'sd15',
        size: params.width + 'x' + params.height,
        seed: params.seed,
        timestamp: Date.now(),
        imageFile: imgFile ? String(imgFile).split('/').pop() : null,
        badge: job.status === 'PARTIAL' ? 'PARTIAL' : 'PASS',
        badgeColor: '#65d66e', badgeBg: 'rgba(101,214,110,.1)',
        thumb: imgSrc
          ? 'center/cover no-repeat url("' + imgSrc + '")'
          : 'linear-gradient(135deg,#0e2a1a,#1a0e2a)',
      };
      const runs = [run, ...this.state.runs].slice(0, 100);
      try { localStorage.setItem('dex_runs', JSON.stringify(runs)); } catch {}
      this.setState(s => ({ jobStatus: 'complete', progress: 100, currentImageSrc: imgSrc, lastSeed: params.seed, runs,
        lastGenerationParams: { ...(s.lastGenerationParams || params), runId, imageFile: imgFile, status: job.status } }));
      this.toast('Done · ' + (runId || ''), '#65d66e');
      setTimeout(() => this.loadRuns(), 1500);
    } else {
      const gate = job.firstFailedGate ? ' · gate: ' + job.firstFailedGate : '';
      this.setState({ jobStatus: 'error', progress: 0, errorMsg: 'Job ' + (job.status || 'failed') + gate + ' (exit ' + (job.exitCode ?? '?') + ')' });
      this.toast('Generation failed' + gate, '#ef4444');
    }
  }

  // ── Batch / Sweep ─────────────────────────────────────────────
  async onBatchSubmit() {
    const { batchAxisX, batchValuesX, batchPrompt, batchNeg, batchSteps, batchCfg, batchW, batchH, backendUrl, savePrompts, target, sampler, scheduler } = this.state;
    const vals = batchValuesX.split(',').map(v => v.trim()).filter(Boolean);
    if (!vals.length) { this.toast('Enter axis values first', '#fbbf24'); return; }
    if (!batchPrompt.trim()) { this.toast('Enter a batch prompt', '#fbbf24'); return; }
    this.setState({ batchRunning: true, batchDone: 0, batchTotal: vals.length, batchStatus: 'running' });
    this.toast('Batch started · ' + vals.length + ' jobs', '#38bdf8');
    let done = 0;
    for (const v of vals) {
      const body = {
        target: target || 'sd15',
        prompt: batchPrompt,
        negative_prompt: batchNeg,
        steps: batchAxisX === 'steps' ? +v : +batchSteps,
        cfg_scale: batchAxisX === 'cfg' ? +v : +batchCfg,
        seed: batchAxisX === 'seed' ? +v : -1,
        width: +batchW, height: +batchH,
        sampler: this._mapSampler(sampler), scheduler: scheduler || 'discrete',
        save_prompts: savePrompts,
      };
      try {
        const r = await fetch(backendUrl + '/api/actions/generate-controlled', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        if (r.ok) {
          const { job_id } = await r.json();
          await new Promise(resolve => {
            const t = setInterval(async () => {
              try {
                const jr = await fetch(backendUrl + '/api/jobs/' + job_id, { signal: AbortSignal.timeout(3000) });
                if (jr.ok) {
                  const job = await jr.json();
                  if (this._jobTerminal(job.status)) {
                    clearInterval(t); resolve();
                  }
                }
              } catch { clearInterval(t); resolve(); }
            }, 1200);
          });
        }
      } catch {}
      done++;
      this.setState({ batchDone: done });
    }
    this.setState({ batchRunning: false, batchStatus: 'done' });
    this.toast('Batch complete · ' + done + ' images', '#65d66e');
    setTimeout(() => this.loadRuns(), 1500);
  }

  // Resolve the actual run + image filename to use as a source, honoring the
  // explicit "Source image" picker when set, else the run's primary image.
  _resolveSource(runId, file) {
    const runs = this.state.runs;
    const srcRun = (runId && runId !== 'last') ? runs.find(r => r.id === runId) : runs[0];
    if (!srcRun) return { error: 'No source run — generate an image first' };
    const imageFile = file || srcRun.imageFile || (this.state.runFiles[srcRun.id] || [])[0];
    if (!imageFile) return { error: 'Source run has no image file' };
    return { run: srcRun, imageFile };
  }
  onI2iRunChange(runId) { this.setState({ i2iSrcRunId: runId, i2iSrcFile: '' }); this.loadRunFiles(runId); }
  onEnhRunChange(runId) { this.setState({ enhSrcRunId: runId, enhSrcFile: '' }); this.loadRunFiles(runId); }

  // ── img2img ───────────────────────────────────────────────────
  async onImg2imgSubmit() {
    const { i2iPrompt, i2iNeg, i2iDenoise, i2iSteps, i2iCfg, i2iSeed, i2iSrcRunId, i2iSrcFile, backendUrl, prompt, negPrompt } = this.state;
    const src = this._resolveSource(i2iSrcRunId, i2iSrcFile);
    if (src.error) { this.toast(src.error, '#fbbf24'); return; }
    this.setState({ i2iStatus: 'generating', i2iProgress: 0, i2iResult: null });
    const body = {
      run_id: src.run.id,
      init_image_file: src.imageFile,
      strength: +i2iDenoise,
      prompt: i2iPrompt || prompt,
      negative_prompt: i2iNeg || negPrompt,
      steps: +i2iSteps, cfg_scale: +i2iCfg, seed: +i2iSeed,
    };
    try {
      const r = await fetch(backendUrl + '/api/actions/img2img', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: r.statusText }));
        this.setState({ i2iStatus: 'error' });
        this.toast(err.error || 'img2img failed', '#ef4444'); return;
      }
      const { job_id } = await r.json();
      const poll = setInterval(async () => {
        try {
          const jr = await fetch(backendUrl + '/api/jobs/' + job_id, { signal: AbortSignal.timeout(3000) });
          if (!jr.ok) return;
          const job = await jr.json();
          if (job.progress != null) this.setState({ i2iProgress: Math.min(99, Math.round(job.progress)) });
          if (this._jobTerminal(job.status)) {
            clearInterval(poll);
            if (this._jobOk(job.status)) {
              const imgSrc = await this._resolveOutputImage(job);
              this.setState({ i2iStatus: 'done', i2iProgress: 100, i2iResult: imgSrc });
              this.toast('img2img complete', '#65d66e');
              setTimeout(() => this.loadRuns(), 1500);
            } else { this.setState({ i2iStatus: 'error' }); this.toast('img2img failed', '#ef4444'); }
          }
        } catch {}
      }, 900);
    } catch(e) { this.setState({ i2iStatus: 'error' }); this.toast(e.message, '#ef4444'); }
  }

  // ── Enhance ───────────────────────────────────────────────────
  async onEnhanceSubmit() {
    const { enhSrcRunId, enhSrcFile, enhScale, enhMethod, backendUrl } = this.state;
    const src = this._resolveSource(enhSrcRunId, enhSrcFile);
    if (src.error) { this.toast(src.error, '#fbbf24'); return; }
    this.setState({ enhStatus: 'running', enhResult: null });
    const endpoint = enhMethod === 'realesrgan' ? '/api/actions/upscale-esrgan' : '/api/actions/upscale';
    const body = { runId: src.run.id, image: src.imageFile, scale: +enhScale, resample: 'lanczos' };
    try {
      const r = await fetch(backendUrl + endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: r.statusText }));
        this.setState({ enhStatus: 'error' });
        this.toast(err.error || 'Enhance failed', '#ef4444'); return;
      }
      const { job_id } = await r.json();
      const poll = setInterval(async () => {
        try {
          const jr = await fetch(backendUrl + '/api/jobs/' + job_id, { signal: AbortSignal.timeout(3000) });
          if (!jr.ok) return;
          const job = await jr.json();
          if (this._jobTerminal(job.status)) {
            clearInterval(poll);
            if (this._jobOk(job.status)) {
              const imgFile = job.upscaledImage;
              const imgSrc = imgFile ? backendUrl + '/api/run-file?path=' + imgFile : null;
              this.setState({ enhStatus: 'done', enhResult: imgSrc });
              this.toast('Enhanced ' + enhScale + '× (' + enhMethod + ')', '#65d66e');
              setTimeout(() => this.loadRuns(), 1500);
            } else { this.setState({ enhStatus: 'error' }); this.toast('Enhance failed', '#ef4444'); }
          }
        } catch {}
      }, 900);
    } catch(e) { this.setState({ enhStatus: 'error' }); this.toast(e.message, '#ef4444'); }
  }

  // ── Hires Fix (two-pass) ──────────────────────────────────────
  async onHiresSubmit() {
    const { prompt, negPrompt, target, steps, cfg, seed, width, height, backendUrl, savePrompts, sampler, scheduler } = this.state;
    if (!prompt.trim()) { this.toast('Enter a prompt for Hires Fix', '#fbbf24'); return; }
    this.setState({ jobStatus: 'generating', progress: 0, currentImageSrc: null, errorMsg: '' });
    this.toast('Hires Fix started', '#38bdf8');
    const body = {
      target: target || 'sd15', prompt: prompt.trim(), negative_prompt: negPrompt || '',
      steps: +steps, cfg_scale: +cfg, seed: +seed, width: +width, height: +height,
      sampler: this._mapSampler(sampler), scheduler: scheduler || 'discrete',
      scale: 2, save_prompts: savePrompts,
    };
    try {
      const r = await fetch(backendUrl + '/api/actions/hires-fix', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!r.ok) { const e = await r.json().catch(() => ({})); this.setState({ jobStatus: 'error', errorMsg: e.error || ('hires-fix ' + r.status) }); this.toast('Hires Fix failed', '#ef4444'); return; }
      const { job_id } = await r.json();
      this._startPoll(job_id, (job) => {
        if (this._jobOk(job.status)) {
          const img = job.hiresFinalImage || job.controlledOutputImage;
          const imgUrl = job.hiresFinalImageUrl || (!job.hiresFinalImage && job.controlledOutputImageUrl);
          const imgSrc = imgUrl ? this.state.backendUrl + imgUrl : this._imgUrl(job.runId || job.hiresRunId, img);
          this.setState({ jobStatus: 'complete', progress: 100, currentImageSrc: imgSrc, lastSeed: +seed });
          this.toast('Hires Fix complete', '#65d66e'); setTimeout(() => this.loadRuns(), 1500);
        } else { this.setState({ jobStatus: 'error', errorMsg: 'Hires Fix ' + job.status }); this.toast('Hires Fix failed', '#ef4444'); }
      });
    } catch (e) { this.setState({ jobStatus: 'error', errorMsg: e.message }); this.toast(e.message, '#ef4444'); }
  }

  // ── X/Y/Z Plot ────────────────────────────────────────────────
  async onXyzSubmit() {
    const { batchPrompt, prompt, batchNeg, negPrompt, batchAxisX, batchValuesX, target, batchSteps, batchCfg, batchW, batchH, backendUrl, savePrompts } = this.state;
    const usePrompt = batchPrompt.trim() || prompt.trim();
    if (!usePrompt) { this.toast('Enter a prompt for the plot', '#fbbf24'); return; }
    const values = batchValuesX.split(',').map(v => v.trim()).filter(Boolean);
    if (!values.length) { this.toast('Enter X values (comma-separated)', '#fbbf24'); return; }
    this.setState({ batchRunning: true, batchStatus: 'running', batchDone: 0, batchTotal: values.length });
    this.toast('X/Y/Z plot started', '#38bdf8');
    const body = {
      target: target || 'sd15', prompt: usePrompt, negative_prompt: batchNeg || negPrompt || '',
      x_axis: batchAxisX, x_values: values,
      steps: +batchSteps, cfg_scale: +batchCfg, width: +batchW, height: +batchH,
      save_prompts: savePrompts,
    };
    try {
      const r = await fetch(backendUrl + '/api/actions/xyz-plot', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!r.ok) { const e = await r.json().catch(() => ({})); this.setState({ batchRunning: false, batchStatus: 'idle' }); this.toast(e.error || 'X/Y/Z plot failed', '#ef4444'); return; }
      const { job_id } = await r.json();
      this._startPoll(job_id, (job) => {
        this.setState({ batchRunning: false, batchStatus: this._jobOk(job.status) ? 'done' : 'idle' });
        this.toast(this._jobOk(job.status) ? 'X/Y/Z plot complete' : 'X/Y/Z plot failed', this._jobOk(job.status) ? '#65d66e' : '#ef4444');
        setTimeout(() => this.loadRuns(), 1500);
      });
    } catch (e) { this.setState({ batchRunning: false, batchStatus: 'idle' }); this.toast(e.message, '#ef4444'); }
  }

  // ── Inpaint (extends Edit) ────────────────────────────────────
  onInpaintMask(dataUrl) { this.setState({ inpMaskData: dataUrl }); }
  async onInpaintSubmit() {
    const { i2iSrcRunId, i2iSrcFile, i2iPrompt, prompt, i2iNeg, negPrompt, inpStrength, i2iSteps, i2iCfg, i2iSeed, inpMaskData, backendUrl } = this.state;
    const src = this._resolveSource(i2iSrcRunId, i2iSrcFile);
    if (src.error) { this.toast(src.error, '#fbbf24'); return; }
    if (!inpMaskData) { this.toast('Paint a mask over the area to change', '#fbbf24'); return; }
    this.setState({ inpStatus: 'generating', inpResult: null });
    this.toast('Inpaint started', '#38bdf8');
    const body = {
      run_id: src.run.id, init_image_file: src.imageFile, mask_data: inpMaskData,
      strength: +inpStrength, prompt: i2iPrompt || prompt, negative_prompt: i2iNeg || negPrompt,
      steps: +i2iSteps, cfg_scale: +i2iCfg, seed: +i2iSeed,
    };
    try {
      const r = await fetch(backendUrl + '/api/actions/inpaint', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!r.ok) { const e = await r.json().catch(() => ({})); this.setState({ inpStatus: 'error' }); this.toast(e.error || 'Inpaint failed', '#ef4444'); return; }
      const { job_id } = await r.json();
      const poll = setInterval(async () => {
        try {
          const jr = await fetch(backendUrl + '/api/jobs/' + job_id, { signal: AbortSignal.timeout(3000) });
          if (!jr.ok) return;
          const job = await jr.json();
          if (this._jobTerminal(job.status)) {
            clearInterval(poll);
            if (this._jobOk(job.status)) {
              const imgSrc = await this._resolveOutputImage(job);
              this.setState({ inpStatus: 'done', inpResult: imgSrc });
              this.toast('Inpaint complete', '#65d66e'); setTimeout(() => this.loadRuns(), 1500);
            } else { this.setState({ inpStatus: 'error' }); this.toast('Inpaint failed', '#ef4444'); }
          }
        } catch {}
      }, 900);
    } catch (e) { this.setState({ inpStatus: 'error' }); this.toast(e.message, '#ef4444'); }
  }

  // A single cached <canvas> reused across renders so the painted mask bitmap
  // survives re-render (the dc-runtime re-parents the same Node rather than
  // rebuilding it). Strokes are opaque white; the backend reads the alpha channel.
  _getInpCanvas() {
    if (this._inpCanvas) return this._inpCanvas;
    const c = document.createElement('canvas');
    c.width = 384; c.height = 384;
    c.style.cssText = 'width:100%;height:100%;display:block;cursor:crosshair;touch-action:none;';
    c.setAttribute('aria-label', 'Inpaint mask canvas — drag to paint');
    const ctx = c.getContext('2d');
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 30;
    let drawing = false, lx = 0, ly = 0;
    const pos = (e) => { const r = c.getBoundingClientRect(); return [ (e.clientX - r.left) * (c.width / r.width), (e.clientY - r.top) * (c.height / r.height) ]; };
    c.addEventListener('pointerdown', (e) => { drawing = true; [lx, ly] = pos(e); ctx.beginPath(); ctx.arc(lx, ly, 15, 0, 6.2832); ctx.fillStyle = '#ffffff'; ctx.fill(); try { c.setPointerCapture(e.pointerId); } catch {} });
    c.addEventListener('pointermove', (e) => { if (!drawing) return; const [x, y] = pos(e); ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(x, y); ctx.stroke(); [lx, ly] = [x, y]; });
    const end = () => { if (!drawing) return; drawing = false; this.onInpaintMask(c.toDataURL('image/png')); };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    this._inpCanvas = c;
    return c;
  }
  clearInpMask() {
    if (this._inpCanvas) { const ctx = this._inpCanvas.getContext('2d'); ctx.clearRect(0, 0, this._inpCanvas.width, this._inpCanvas.height); }
    this.setState({ inpMaskData: null });
  }
  buildInpaintTools(srcRunId, srcFile, inpStatus, inpResult, inpStrength, accent) {
    const src = this._resolveSource(srcRunId, srcFile);
    const srcUrl = src.run ? this._imgUrl(src.run.id, src.imageFile) : null;
    const h = React.createElement;
    return h('div', { style: { marginTop: 14, borderTop: '1px solid rgba(148,163,184,.12)', paddingTop: 12 } },
      h('div', { style: { fontSize: 11, fontWeight: 600, color: '#92a4b8', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 7 } }, 'Inpaint — paint the area to change'),
      h('div', { style: { position: 'relative', width: '100%', maxWidth: 384, margin: '0 auto', aspectRatio: '1 / 1', borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(148,163,184,.16)', background: srcUrl ? ('center/contain no-repeat url("' + srcUrl + '") #0a0e14') : '#0a0e14' } },
        srcUrl ? null : h('div', { style: { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#5a6678' } }, 'Pick a source image above'),
        h('div', { style: { position: 'absolute', inset: 0, opacity: .5 } }, this._getInpCanvas())),
      h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', marginTop: 9 } },
        h('label', { style: { fontSize: 11, color: '#92a4b8' } }, 'Strength'),
        h('input', { type: 'number', min: '0.01', max: '0.99', step: '0.05', value: String(inpStrength), onChange: e => this.setState({ inpStrength: e.target.value }),
          style: { width: 70, border: '1px solid rgba(148,163,184,.16)', background: '#091420', color: '#e8f0f7', borderRadius: 7, padding: '6px', outline: 'none', fontSize: 12 } }),
        h('button', { onClick: () => this.clearInpMask(),
          style: { border: '1px solid rgba(148,163,184,.18)', background: 'transparent', color: '#b8c7d6', borderRadius: 7, padding: '6px 12px', fontSize: 12, cursor: 'pointer' } }, 'Clear mask'),
        h('button', { onClick: () => this.onInpaintSubmit(),
          style: { flex: 1, background: accent, color: '#06121a', border: 0, fontWeight: 800, borderRadius: 8, padding: '8px', cursor: 'pointer', fontSize: 13, fontFamily: "'DM Sans',sans-serif" } },
          inpStatus === 'generating' ? 'Inpainting…' : 'Run Inpaint')),
      inpStatus === 'done' && inpResult ? h('img', { src: inpResult, alt: 'inpaint result', style: { marginTop: 9, maxWidth: '100%', borderRadius: 6 } }) :
      inpStatus === 'error' ? h('div', { style: { marginTop: 9, fontSize: 12, color: '#ef4444' } }, '✗ Inpaint failed') : null);
  }

  buildGenerationMeta(params) {
    if (!params) return null;
    const h = React.createElement;
    const row = (label, value, wide) => h('div', { style: { gridColumn: wide ? '1 / -1' : 'auto', minWidth: 0 } },
      h('div', { style: { fontSize: 10, color: '#6f7898', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 3 } }, label),
      h('div', { style: { fontSize: 11, color: '#cbd5e1', fontFamily: "'IBM Plex Mono',monospace", lineHeight: 1.45, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' } }, String(value ?? '—')));
    return h('div', { style: { width: '100%', maxWidth: 720, marginTop: 12, padding: 12, border: '1px solid rgba(148,163,184,.16)', borderRadius: 8, background: 'rgba(5,10,18,.78)', boxShadow: '0 10px 30px rgba(0,0,0,.18)' } },
      h('div', { style: { fontSize: 11, color: '#94a3b8', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 9 } }, 'Generation settings'),
      h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 9 } },
        row('Prompt', params.prompt, true),
        params.negative_prompt ? row('Negative', params.negative_prompt, true) : null,
        row('Target', params.target),
        row('Preset', params.preset),
        row('Steps', params.steps),
        row('CFG', params.cfg_scale),
        row('Seed', params.seed),
        row('Size', (params.width || '—') + ' x ' + (params.height || '—')),
        row('Sampler', params.sampler),
        row('Scheduler', params.scheduler),
        row('VAE', this.vaeLabel(params.selectedVae)),
        row('Save prompts', params.save_prompts ? 'on' : 'off'),
        params.runId ? row('Run', params.runId, true) : null));
  }

  buildImageDisplay(jobStatus, progress, imageSrc, lastSeed, errorMsg) {
    if (jobStatus === 'generating') {
      const steps = Math.round(progress / 100 * (+this.state.steps || 20));
      const determinate = progress > 0;
      // When the backend reports a percentage, show a determinate bar; otherwise an
      // indeterminate shimmer so the user has live feedback that work is happening.
      const bar = determinate
        ? React.createElement('div', { style: { height: '100%', width: progress + '%', background: 'linear-gradient(90deg,#38bdf8,#65d66e)', borderRadius: 3, transition: 'width .3s ease' } })
        : React.createElement('div', { className: 'dex-indeterminate-bar', style: { position: 'absolute', top: 0, height: '100%', width: '40%', borderRadius: 3, background: 'linear-gradient(90deg,#38bdf8,#65d66e)', animation: 'dexIndeterminate 1.1s ease-in-out infinite' } });
      return React.createElement('div', { role: 'status', 'aria-busy': 'true', style: { textAlign: 'center', padding: '0 24px', maxWidth: 320 } },
        React.createElement('div', { style: { fontSize: 13, color: '#9090c8', marginBottom: 14, fontFamily: "'DM Sans',sans-serif" } },
          determinate ? ('Generating… ' + progress + '%') : 'Working — waiting for backend…'),
        React.createElement('div', { style: { position: 'relative', height: 5, background: 'rgba(255,255,255,.08)', borderRadius: 3, overflow: 'hidden', marginBottom: 8 } }, bar),
        determinate ? React.createElement('div', { style: { fontSize: 11, color: '#6060a0', fontFamily: "'IBM Plex Mono',monospace" } },
          'step ~' + steps + ' / ' + (this.state.steps || 20)) : null);
    }
    if (jobStatus === 'complete' && imageSrc) {
      const metaKey = JSON.stringify(this.state.lastGenerationParams || {});
      const cacheKey = imageSrc + '|' + metaKey;
      if (this._completedImageCache.key === cacheKey && this._completedImageCache.node) return this._completedImageCache.node;
      this._completedImageCache = { key: cacheKey, node: React.createElement('div', { style: { width: '100%', height: '100%', overflowY: 'auto', padding: '16px 10px 28px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start' } },
        React.createElement('img', { src: imageSrc, alt: 'Generated image', crossOrigin: 'anonymous', style: { width: 'min(100%, 720px)', maxHeight: 'min(70vh, 720px)', objectFit: 'contain', borderRadius: 6, flexShrink: 0 } }),
        this.buildGenerationMeta(this.state.lastGenerationParams)) };
      return this._completedImageCache.node;
    }
    if (jobStatus === 'complete') {
      return React.createElement('div', { style: { textAlign: 'center' } },
        React.createElement('div', { style: { width: 240, height: 240, background: 'linear-gradient(135deg,#0e2a1a,#1a0e2a)', borderRadius: 12, marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 8 } },
          React.createElement('div', { style: { fontSize: 13, color: '#65d66e', fontFamily: "'IBM Plex Mono',monospace" } }, '✓ Job done'),
          React.createElement('div', { style: { fontSize: 11, color: '#4a6878', fontFamily: "'IBM Plex Mono',monospace" } }, 'seed: ' + (lastSeed ?? '—'))),
        React.createElement('div', { style: { fontSize: 11, color: '#5060a0' } }, 'Image saved to runs/ — check Library'));
    }
    if (jobStatus === 'error') {
      return React.createElement('div', { style: { textAlign: 'center', padding: 20 } },
        React.createElement('div', { style: { fontSize: 14, color: '#ef4444', marginBottom: 8 } }, '✗ Generation failed'),
        React.createElement('div', { style: { fontSize: 11, color: '#7070a0', maxWidth: 260, lineHeight: 1.5 } }, errorMsg || 'Backend offline or job rejected. Check System screen.'));
    }
    return null;
  }

  renderVals() {
    const s = this.state;
    const { version, screens, prompt, negPrompt, promptOpen, steps, cfg, seed, width, height,
            sampler, scheduler,
            jobStatus, progress, currentImageSrc, lastSeed, errorMsg,
            target, backendOnline, backendUrl, runs, savePrompts, toasts,
            batchAxisX, batchValuesX, batchPrompt, batchNeg, batchSteps, batchCfg, batchW, batchH,
            batchRunning, batchDone, batchTotal, batchStatus,
            i2iPrompt, i2iNeg, i2iDenoise, i2iSteps, i2iCfg, i2iSeed, i2iSrcRunId, i2iSrcFile, i2iStatus, i2iProgress, i2iResult,
            enhSrcRunId, enhSrcFile, enhScale, enhMethod, enhStatus, enhResult,
            checkpoints, loadingCheckpoints, activeCheckpoint,
            preset, runFiles, libFilter, libHasMore, libTotal, libLoadingMore,
            ollamaOnline, enhancingPrompt, wildcards, showWildcards, wildcardFilter, assets, loadingAssets,
            inpStatus, inpResult, inpStrength } = s;
    const screen = screens[version];
    const isGenerating = jobStatus === 'generating';
    const accent = version === 2 ? '#f59e0b' : version === 3 ? '#a78bfa' : '#38bdf8';

    // ── Library cards ──────────────────────────────────────────
    const libraryCards = runs.length > 0 ? runs : [{ id: 'no runs yet', badge: '—', badgeColor: '#6060a0', badgeBg: 'rgba(80,80,160,.08)', model: 'run generate to start', size: '—', thumb: 'linear-gradient(135deg,#0a0a18,#141428)' }];

    // ── Status chips ──────────────────────────────────────────
    const backendDot = backendOnline ? '#65d66e' : '#ef4444';
    const jobDot = isGenerating ? '#38bdf8' : jobStatus==='complete' ? '#65d66e' : jobStatus==='error' ? '#ef4444' : '#fbbf24';

    // ── Run log ───────────────────────────────────────────────
    const jobLogDisplay = runs.length === 0
      ? React.createElement('div', { style: { fontSize: 12, color: '#5060a0' } }, 'No runs yet.')
      : React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 5 } },
          ...runs.slice(0,12).map(r => React.createElement('div', { key: r.id,
            style: { padding: '6px 10px', background: 'rgba(255,255,255,.02)', border: '1px solid rgba(255,255,255,.07)', borderRadius: 7, fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, color: '#8888a8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
            r.id + ' · ' + r.model + ' · ' + r.size + ' · seed ' + r.seed)));

    // ── Batch progress display ────────────────────────────────
    const batchProgressDisplay = React.createElement('div', { style: { marginTop: 12 } },
      batchStatus === 'idle' ? React.createElement('div', { style: { fontSize: 12, color: '#5060a0' } }, 'Queue empty · configure above and submit') :
      batchStatus === 'running' ? React.createElement('div', null,
        React.createElement('div', { style: { fontSize: 12, color: '#38bdf8', marginBottom: 8, fontFamily: "'DM Sans',sans-serif" } }, 'Running job ' + batchDone + ' of ' + batchTotal + '…'),
        React.createElement('div', { style: { height: 5, background: 'rgba(255,255,255,.08)', borderRadius: 3, overflow: 'hidden', marginBottom: 8 } },
          React.createElement('div', { style: { height: '100%', width: Math.round((batchDone/Math.max(batchTotal,1))*100) + '%', background: 'linear-gradient(90deg,#38bdf8,#65d66e)', borderRadius: 3, transition: 'width .3s ease' } })),
        React.createElement('div', { style: { fontSize: 11, color: '#6060a0', fontFamily: "'IBM Plex Mono',monospace" } }, batchDone + ' / ' + batchTotal + ' complete')) :
      batchStatus === 'done' ? React.createElement('div', { style: { fontSize: 12, color: '#65d66e' } }, '✓ Batch complete · ' + batchTotal + ' images added to Library') :
      null
    );

    // ── img2img status display ────────────────────────────────
    const i2iStatusDisplay = React.createElement('div', { style: { marginTop: 8 } },
      i2iStatus === 'idle' ? null :
      i2iStatus === 'generating' ? React.createElement('div', null,
        React.createElement('div', { style: { fontSize: 12, color: '#a78bfa', marginBottom: 6 } }, 'img2img · ' + i2iProgress + '%'),
        React.createElement('div', { style: { height: 4, background: 'rgba(255,255,255,.08)', borderRadius: 2, overflow: 'hidden' } },
          React.createElement('div', { style: { height: '100%', width: i2iProgress + '%', background: 'linear-gradient(90deg,#8b5cf6,#38bdf8)', borderRadius: 2, transition: 'width .15s linear' } }))) :
      i2iStatus === 'done' && i2iResult ? React.createElement('img', { src: i2iResult, alt: 'img2img result', style: { maxWidth: '100%', maxHeight: 200, borderRadius: 6, objectFit: 'contain' } }) :
      i2iStatus === 'done' ? React.createElement('div', { style: { fontSize: 12, color: '#65d66e' } }, '✓ Done (sim · no image data)') :
      i2iStatus === 'error' ? React.createElement('div', { style: { fontSize: 12, color: '#ef4444' } }, '✗ img2img failed') :
      null
    );

    // ── Enhance status display ────────────────────────────────
    const enhStatusDisplay = React.createElement('div', { style: { marginTop: 8 } },
      enhStatus === 'running' ? React.createElement('div', { style: { fontSize: 12, color: '#38bdf8' } }, 'Upscaling…') :
      enhStatus === 'done' && enhResult ? React.createElement('img', { src: enhResult, alt: 'enhanced', style: { maxWidth: '100%', maxHeight: 200, borderRadius: 6, objectFit: 'contain' } }) :
      enhStatus === 'done' ? React.createElement('div', { style: { fontSize: 12, color: '#65d66e' } }, '✓ Enhance done') :
      enhStatus === 'error' ? React.createElement('div', { style: { fontSize: 12, color: '#ef4444' } }, '✗ Enhance failed') :
      null
    );

    // ── Models list display ───────────────────────────────────
    const modelsListDisplay = loadingCheckpoints
      ? React.createElement('div', { style: { fontSize: 12, color: '#38bdf8', fontFamily: "'IBM Plex Mono',monospace" } }, 'Loading…')
      : checkpoints.length === 0
        ? React.createElement('div', { style: { fontSize: 12, color: '#5060a0' } }, 'No checkpoints loaded — click Refresh above')
        : React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 5 } },
            ...checkpoints.map(cp => React.createElement('div', { key: cp.name,
              onClick: () => this.loadCheckpoint(cp.name),
              role: 'button', tabIndex: 0,
              'aria-pressed': String(activeCheckpoint === cp.name),
              'aria-label': 'Set target ' + (cp.title || cp.name),
              onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.loadCheckpoint(cp.name); } },
              style: { padding: '8px 12px', border: '1px solid ' + (activeCheckpoint === cp.name ? 'rgba(101,214,110,.35)' : 'rgba(255,255,255,.08)'), background: activeCheckpoint === cp.name ? 'rgba(101,214,110,.07)' : 'rgba(255,255,255,.02)', borderRadius: 8, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
              React.createElement('span', { style: { fontSize: 12, color: activeCheckpoint === cp.name ? '#65d66e' : '#c0c0d8', fontFamily: "'IBM Plex Mono',monospace", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, marginRight: 8 } }, cp.title || cp.name),
              cp.hash ? React.createElement('span', { style: { fontSize: 10, color: '#5060a0', fontFamily: "'IBM Plex Mono',monospace", flexShrink: 0 } }, cp.hash.slice(0,8)) : null
            ))
          );

    // ── Source run + image pickers for i2i / enhance / inpaint ──
    const selStyle = { width: '100%', border: '1px solid rgba(255,255,255,.12)', background: 'rgba(0,0,0,.3)', color: '#e0e0f0', borderRadius: 7, padding: '7px', outline: 'none', fontSize: 12, fontFamily: "'DM Sans',sans-serif" };
    const runOpts = (sel) => [
      React.createElement('option', { value: 'last' }, runs[0] ? 'Last: ' + runs[0].id : '— no runs —'),
      ...runs.slice(0, 20).map(r => React.createElement('option', { key: r.id, value: r.id }, r.id + ' · ' + r.size)),
    ];
    const filesFor = (runId) => runFiles[(runId && runId !== 'last') ? runId : (runs[0] || {}).id] || [];
    const imageOpts = (files, selFile) => files.length
      ? files.map(f => React.createElement('option', { key: f, value: f }, f))
      : [React.createElement('option', { value: '' }, runs[0] ? 'Primary image' : '— no images —')];

    const srcRunOptions = React.createElement('select', { value: i2iSrcRunId, onChange: e => this.onI2iRunChange(e.target.value), style: selStyle }, ...runOpts());
    const srcImageOptions = React.createElement('select', { value: i2iSrcFile, onChange: e => this.setState({ i2iSrcFile: e.target.value }), style: selStyle }, ...imageOpts(filesFor(i2iSrcRunId), i2iSrcFile));
    const enhSrcOptions = React.createElement('select', { value: enhSrcRunId, onChange: e => this.onEnhRunChange(e.target.value), style: selStyle }, ...runOpts());
    const enhImageOptions = React.createElement('select', { value: enhSrcFile, onChange: e => this.setState({ enhSrcFile: e.target.value }), style: selStyle }, ...imageOpts(filesFor(enhSrcRunId), enhSrcFile));

    // ── Library filter chips ──────────────────────────────────
    const FILTERS = [['all','All'],['controlled','Controlled'],['sd15','SD1.5'],['sdxl-base','SDXL base'],['sdxl-turbo','SDXL Turbo'],['flux-fp8','Flux fp8'],['hires','Hires Fix'],['upscale','Upscale'],['smoke','Smoke proofs'],['failed','Failed']];
    const libraryFilters = React.createElement('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
      ...FILTERS.map(([val, label]) => React.createElement('button', { key: val,
        onClick: () => this.setLibFilter(val),
        'aria-pressed': String(libFilter === val),
        style: { border: '1px solid ' + (libFilter === val ? accent : 'rgba(148,163,184,.18)'), background: libFilter === val ? accent + '22' : 'rgba(255,255,255,.02)', color: libFilter === val ? accent : '#b8c7d6', borderRadius: 999, padding: '4px 11px', fontSize: 11, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" } },
        label)));

    // ── Library "Load More" + count ───────────────────────────
    const libraryLoadMore = React.createElement('div', { style: { textAlign: 'center', padding: '14px 0 4px' } },
      libHasMore ? React.createElement('button', { onClick: () => this.loadMoreRuns(),
        style: { border: '1px solid rgba(148,163,184,.2)', background: 'rgba(9,20,32,.8)', color: '#b8c7d6', borderRadius: 8, padding: '7px 18px', fontSize: 12, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" } },
        libLoadingMore ? 'Loading…' : 'Load More') : null,
      React.createElement('span', { style: { fontSize: 11, color: '#6090a8', marginLeft: 10 } }, runs.length + ' of ' + (libTotal || runs.length) + ' runs'));

    // ── Prompt tools (Enhance via Ollama + Wildcards) ─────────
    const wcFiltered = wildcardFilter
      ? wildcards.filter(w => w.name.toLowerCase().includes(wildcardFilter.toLowerCase()))
      : wildcards;
    const promptTools = React.createElement('div', { style: { display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap', marginTop: 6, position: 'relative' } },
      React.createElement('button', { onClick: () => this.enhancePrompt(), disabled: !ollamaOnline || enhancingPrompt,
        title: ollamaOnline ? 'Enhance prompt with Ollama' : 'Ollama offline',
        style: { border: '1px solid ' + (ollamaOnline ? accent : 'rgba(148,163,184,.18)'), background: 'transparent', color: ollamaOnline ? accent : '#5a6678', borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: ollamaOnline ? 'pointer' : 'not-allowed', opacity: ollamaOnline ? 1 : .6, fontFamily: "'DM Sans',sans-serif" } },
        enhancingPrompt ? '✨ Enhancing…' : '✨ Enhance'),
      React.createElement('button', { onClick: () => this.setState(s => ({ showWildcards: !s.showWildcards, wildcardFilter: '' })),
        style: { border: '1px solid ' + (showWildcards ? accent : 'rgba(148,163,184,.18)'), background: 'transparent', color: showWildcards ? accent : '#b8c7d6', borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" } },
        wildcardFilter ? ('__ ' + wildcardFilter + '… (' + wcFiltered.length + ')') : '⊞ Wildcards (' + wildcards.length + ')'),
      showWildcards ? React.createElement('div', { style: { position: 'absolute', top: '110%', left: 0, zIndex: 50, background: '#0c1018', border: '1px solid rgba(148,163,184,.2)', borderRadius: 8, padding: 6, display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 240, overflowY: 'auto', minWidth: 220, boxShadow: '0 8px 24px rgba(0,0,0,.5)' } },
        wildcardFilter ? React.createElement('div', { style: { fontSize: 10, color: '#5a6678', padding: '2px 6px 5px', borderBottom: '1px solid rgba(148,163,184,.1)', marginBottom: 3, fontFamily: "'IBM Plex Mono',monospace" } }, 'autocomplete: __' + wildcardFilter + '…') : null,
        wcFiltered.length ? wcFiltered.map(w => React.createElement('button', { key: w.name,
          onClick: () => wildcardFilter ? this.insertWildcardFiltered(w.name) : this.insertWildcard(w.name),
          style: { textAlign: 'left', border: 'none', background: 'transparent', color: '#c0c0d8', borderRadius: 5, padding: '5px 8px', fontSize: 12, cursor: 'pointer', fontFamily: "'IBM Plex Mono',monospace" } },
          '__' + w.name + '__', React.createElement('span', { style: { color: '#5a6678', marginLeft: 4 } }, '(' + (w.count || 0) + ')')))
          : React.createElement('div', { style: { fontSize: 12, color: '#5a6678', padding: 6 } }, wildcardFilter ? 'No match for "' + wildcardFilter + '"' : 'No wildcards')) : null);

    // ── Dynamic target selects (populated from /api/capabilities) ─
    const _makeTargetSelect = (labelStyle, selStyle) => {
      const opts = checkpoints.length > 0
        ? checkpoints.map(cp => React.createElement('option', { key: cp.name, value: cp.name }, cp.title || cp.name))
        : [React.createElement('option', { key: '_cur', value: target }, loadingCheckpoints ? 'Loading models…' : (target || 'sd15'))];
      return React.createElement('div', null,
        React.createElement('div', { style: labelStyle }, 'Target model'),
        React.createElement('select', { style: selStyle, value: target, onChange: e => this.onSelectTarget(e.target.value) }, ...opts));
    };
    const targetSelectV1 = _makeTargetSelect(
      { fontSize: '10px', color: '#6090a8', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: '4px' },
      { width: '100%', border: '1px solid rgba(148,163,184,.16)', background: '#091420', color: '#e8f0f7', borderRadius: '7px', padding: '7px', outline: 'none', fontSize: '12px', fontFamily: "'DM Sans',sans-serif" }
    );
    const targetSelectV2 = _makeTargetSelect(
      { fontSize: '10px', color: '#8888b0', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: '4px' },
      { width: '100%', border: '1px solid rgba(200,180,255,.14)', background: '#110a1e', color: '#eeeaf8', borderRadius: '7px', padding: '7px', outline: 'none', fontSize: '12px', fontFamily: "'DM Sans',sans-serif" }
    );
    const targetSelectV3 = _makeTargetSelect(
      { fontSize: '10px', letterSpacing: '.1em', textTransform: 'uppercase', color: '#7070a0', fontWeight: '600', marginBottom: '4px' },
      { width: '100%', border: '1px solid rgba(255,255,255,.09)', background: '#141418', color: '#f4f4f8', borderRadius: '6px', padding: '8px', outline: 'none', fontSize: '12px', fontFamily: "'Space Grotesk',sans-serif" }
    );

    // ── Extra Networks (LoRA / VAE) panel ─────────────────────
    const assetMatch = item => !s.assetQuery || String((item && (item.name || item.filename || item.id)) || '').toLowerCase().includes(s.assetQuery.toLowerCase());
    const loras = (assets.loras || []).filter(assetMatch);
    const vaes = (assets.vaes || []).filter(assetMatch);
    const embeddings = (assets.embeddings || []).filter(assetMatch);
    const rawAssetCounts = { loras: (assets.loras || []).length, vaes: (assets.vaes || []).length, embeddings: (assets.embeddings || []).length };
    const assetRow = (kind, item, action) => React.createElement('div', { key: kind + ':' + (item.id || item.filename || item.name),
      style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, border: '1px solid rgba(148,163,184,.12)', background: 'rgba(9,20,32,.7)', borderRadius: 8, padding: '7px 10px' } },
      React.createElement('span', { style: { fontSize: 12, color: '#c0c0d8', fontFamily: "'IBM Plex Mono',monospace", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 } }, item.name || item.filename),
      action ? React.createElement('button', { onClick: action,
        style: { border: '1px solid ' + accent, background: 'transparent', color: accent, borderRadius: 6, padding: '3px 9px', fontSize: 11, cursor: 'pointer', flexShrink: 0, fontFamily: "'DM Sans',sans-serif" } }, 'Insert') :
        React.createElement('span', { style: { fontSize: 10, color: '#6090a8', flexShrink: 0, fontFamily: "'DM Sans',sans-serif" } }, 'Available'));
    const assetSection = (title, items, empty, render) => React.createElement('div', { style: { marginTop: 10 } },
      React.createElement('div', { style: { fontSize: 10, color: '#6090a8', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 6, fontWeight: 700 } }, title),
      items.length ? React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 220, overflowY: 'auto', paddingRight: 2 } },
        ...items.map(render)) : React.createElement('div', { style: { fontSize: 12, color: '#6090a8', fontStyle: 'italic' } }, empty));
    const extraNetworksDisplay = React.createElement('div', null,
      React.createElement('div', { style: { fontSize: 11, color: '#6090a8', marginBottom: 7 } },
        loadingAssets ? 'Discovering assets…' : (rawAssetCounts.loras + ' LoRAs · ' + rawAssetCounts.vaes + ' VAEs · ' + rawAssetCounts.embeddings + ' embeddings')),
      React.createElement('input', { value: s.assetQuery, onChange: e => this.setState({ assetQuery: e.target.value }), placeholder: 'Search LoRA, VAE, embeddings',
        style: { width: '100%', border: '1px solid rgba(148,163,184,.16)', background: 'rgba(5,10,18,.72)', color: '#e2e8f0', borderRadius: 7, padding: '7px 9px', outline: 'none', fontSize: 12, fontFamily: "'DM Sans',sans-serif", marginBottom: 8 } }),
      assetSection('LoRAs', loras, 'No LoRAs detected. Run Discover assets.', l => assetRow('lora', l, () => this.insertLora(l.filename || l.name))),
      assetSection('VAEs', vaes, 'No VAEs detected.', v => assetRow('vae', v)),
      assetSection('Embeddings', embeddings, 'No embeddings detected.', e => assetRow('embedding', e)));

    const h = React.createElement;
    const fieldLabel = { fontSize: 10, color: '#7f8ca8', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 4, fontWeight: 700 };
    const panelInput = { width: '100%', border: '1px solid rgba(148,163,184,.16)', background: 'rgba(5,10,18,.72)', color: '#e2e8f0', borderRadius: 7, padding: '7px 9px', outline: 'none', fontSize: 12, fontFamily: "'DM Sans',sans-serif" };
    const actionButton = (label, onClick, tone = accent) => h('button', { onClick,
      style: { border: '1px solid ' + tone + '66', background: tone + '16', color: tone, borderRadius: 7, padding: '7px 10px', fontSize: 12, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", fontWeight: 700 } }, label);
    const validationPanel = h('div', { style: { display: 'grid', gap: 5, marginBottom: 10 } },
      ...this.validationMessages().map(([msg, kind]) => h('div', { key: msg,
        style: { border: '1px solid ' + (kind === 'error' ? 'rgba(239,68,68,.28)' : kind === 'warn' ? 'rgba(251,191,36,.26)' : kind === 'info' ? 'rgba(56,189,248,.24)' : 'rgba(101,214,110,.24)'),
          background: kind === 'error' ? 'rgba(239,68,68,.07)' : kind === 'warn' ? 'rgba(251,191,36,.07)' : kind === 'info' ? 'rgba(56,189,248,.06)' : 'rgba(101,214,110,.06)',
          color: kind === 'error' ? '#fca5a5' : kind === 'warn' ? '#fde68a' : kind === 'info' ? '#7dd3fc' : '#86efac',
          borderRadius: 7, padding: '6px 8px', fontSize: 11, lineHeight: 1.35 } }, msg)));
    const favoritePresetRows = s.favoritePresets.length
      ? h('div', { style: { display: 'grid', gap: 5, maxHeight: 160, overflowY: 'auto' } },
          ...s.favoritePresets.map(p => h('div', { key: p.id, style: { display: 'flex', alignItems: 'center', gap: 6, border: '1px solid rgba(148,163,184,.12)', borderRadius: 7, padding: 6, background: 'rgba(5,10,18,.46)' } },
            h('button', { onClick: () => this.applyFavoritePreset(p.id), style: { flex: 1, border: 0, background: 'transparent', color: '#cbd5e1', textAlign: 'left', cursor: 'pointer', fontSize: 12, fontFamily: "'DM Sans',sans-serif" } }, p.name),
            h('button', { onClick: () => this.renameFavoritePreset(p.id), title: 'Rename recipe', style: { border: '1px solid rgba(148,163,184,.16)', background: 'transparent', color: '#94a3b8', borderRadius: 6, cursor: 'pointer', padding: '3px 7px' } }, 'Rename'),
            h('button', { onClick: () => this.deleteFavoritePreset(p.id), title: 'Delete recipe', style: { border: '1px solid rgba(148,163,184,.16)', background: 'transparent', color: '#94a3b8', borderRadius: 6, cursor: 'pointer', padding: '3px 7px' } }, 'x'))))
      : h('div', { style: { fontSize: 12, color: '#64748b' } }, 'No saved recipes yet.');
    const favoritePresetPanel = h('div', { style: { borderTop: '1px solid rgba(148,163,184,.12)', marginTop: 10, paddingTop: 10 } },
      h('div', { style: { ...fieldLabel, marginBottom: 7 } }, 'Recipes' + (s.savePrompts ? ' · settings + prompt' : ' · settings only (prompt saving off)')),
      h('div', { style: { display: 'flex', gap: 6, marginBottom: 8 } },
        h('input', { value: s.favoriteName, onChange: e => this.setState({ favoriteName: e.target.value }), placeholder: 'Name this setup', style: { ...panelInput, flex: 1 } }),
        actionButton('Save Recipe', () => this.saveFavoritePreset())),
      favoritePresetRows);
    const vaeSelect = h('select', { value: s.selectedVae, onChange: e => this.setState({ selectedVae: e.target.value }), style: panelInput },
      h('option', { value: 'default' }, 'Default / backend-selected'),
      h('option', { value: 'none' }, 'None'),
      ...vaes.map(v => h('option', { key: v.id || v.filename || v.name, value: v.filename || v.name }, v.name || v.filename)));
    const compactToggle = h('button', { onClick: () => { const compactMode = !this.state.compactMode; localStorage.setItem('dex_compact_mode', String(compactMode)); this.setState({ compactMode }); },
      style: { ...panelInput, cursor: 'pointer', textAlign: 'left' } }, s.compactMode ? 'Compact on' : 'Compact off');
    const settingsDrawerBody = h('div', { style: { padding: 11, display: 'grid', gap: 10 } },
      validationPanel,
      h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 } },
        h('div', null, h('div', { style: fieldLabel }, 'VAE catalog'), vaeSelect),
        h('div', null, h('div', { style: fieldLabel }, 'Compact mode'), compactToggle)),
      h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 } },
        actionButton('Copy prompt + settings', () => this.copyText('Prompt and settings', JSON.stringify(this.currentParams(), null, 2))),
        actionButton('Send result to img2img', () => this.setScreen('edit'), '#a78bfa')),
      favoritePresetPanel);
    const settingsDrawer = h('div', { style: { border: '1px solid rgba(148,163,184,.16)', background: 'rgba(6,10,16,.64)', borderRadius: 9, marginBottom: 10, overflow: 'hidden' } },
      h('button', { onClick: () => this.setState(x => ({ settingsOpen: !x.settingsOpen })),
        style: { width: '100%', border: 0, background: 'transparent', padding: '9px 11px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: accent, fontWeight: 800, fontSize: 12, letterSpacing: '.06em', textTransform: 'uppercase', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" } },
        'Settings drawer', h('span', { style: { color: '#7f8ca8', fontWeight: 500, letterSpacing: 0, textTransform: 'none' } }, (s.settingsOpen ? 'hide' : 'show') + ' · model · VAE · output')),
      s.settingsOpen ? settingsDrawerBody : null);

    const filteredRuns = (runs || []).filter(r => !s.runSearch || String(r.id + ' ' + r.model + ' ' + r.size).toLowerCase().includes(s.runSearch.toLowerCase()));
    const runInspector = h('div', { style: { border: '1px solid rgba(148,163,184,.14)', background: 'rgba(6,10,16,.64)', borderRadius: 9, padding: 11, marginBottom: 12 } },
      h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 } },
        h('div', { style: { fontSize: 12, fontWeight: 800, color: '#cbd5e1', letterSpacing: '.06em', textTransform: 'uppercase' } }, 'Run inspector'),
        h('div', { style: { flex: 1 } }),
        actionButton('Refresh', () => this.loadRuns(), '#94a3b8')),
      h('input', { value: s.runSearch, onChange: e => this.setState({ runSearch: e.target.value }), placeholder: 'Filter loaded runs', style: { ...panelInput, marginBottom: 8 } }),
      h('div', { style: { display: 'grid', gap: 5, maxHeight: 210, overflowY: 'auto', marginBottom: 8 } },
        ...(filteredRuns.length ? filteredRuns.slice(0, 20).map(r => h('button', { key: r.id, onClick: () => this.inspectRun(r.id),
          style: { border: '1px solid ' + (s.selectedRunId === r.id ? accent : 'rgba(148,163,184,.12)'), background: s.selectedRunId === r.id ? accent + '14' : 'rgba(5,10,18,.46)', color: '#cbd5e1', borderRadius: 7, padding: '7px 9px', cursor: 'pointer', textAlign: 'left', fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
          r.id + ' · ' + r.model + ' · ' + r.size)) : [h('div', { style: { color: '#64748b', fontSize: 12 } }, 'No matching loaded runs')])),
      s.loadingRunDetail ? h('div', { style: { fontSize: 12, color: '#7dd3fc' } }, 'Loading metadata...') :
      s.selectedRunDetail ? h('div', { style: { borderTop: '1px solid rgba(148,163,184,.12)', paddingTop: 8, display: 'grid', gap: 7 } },
        h('div', { style: { color: '#94a3b8', fontSize: 11, fontFamily: "'IBM Plex Mono',monospace", overflowWrap: 'anywhere' } }, s.selectedRunId),
        h('div', { style: { color: '#cbd5e1', fontSize: 12 } }, (s.selectedRunDetail.status || s.selectedRunDetail.runCard?.status || 'metadata loaded') + ' · ' + ((s.selectedRunDetail.images || []).length || 0) + ' images'),
        h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
          actionButton('Reuse in Create', () => this.reuseSelectedRun()),
          actionButton('Copy metadata', () => this.copyText('Run metadata', JSON.stringify(s.selectedRunDetail, null, 2)), '#94a3b8'))) : null);

    const capability = s.capabilityData || {};
    const featureGates = capability.featureGates || capability.features || {};
    const truthStatusPanel = h('div', { style: { border: '1px solid rgba(148,163,184,.14)', background: 'rgba(6,10,16,.64)', borderRadius: 9, padding: 11, marginBottom: 12 } },
      h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 } },
        h('div', { style: { fontSize: 12, fontWeight: 800, color: '#cbd5e1', letterSpacing: '.06em', textTransform: 'uppercase' } }, 'Truth status'),
        h('div', { style: { flex: 1 } }),
        actionButton('Refresh all', () => this.refreshAll(), '#94a3b8')),
      // Derived from /api/system-info capabilities (runtime evidence + Big Mac asset probe).
      h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 6 } },
        ...((s.systemInfo && s.systemInfo.capabilities) || []).map(c => {
          const b = DexClient.capabilityBadge(c.status);
          const [border, bg, fg] = ({ ok: ['rgba(101,214,110,.24)', 'rgba(101,214,110,.06)', '#86efac'], warn: ['rgba(251,191,36,.2)', 'rgba(251,191,36,.05)', '#fde68a'], bad: ['rgba(248,113,113,.3)', 'rgba(248,113,113,.07)', '#fca5a5'], off: ['rgba(148,163,184,.18)', 'rgba(148,163,184,.04)', '#94a3b8'] })[b.tone];
          const when = c.lastPass && c.status === 'proven' ? ' · ' + String(c.lastPass.at).slice(0, 10) : '';
          return h('div', { key: c.id, title: c.reason || (c.lastPass ? 'last pass: run ' + c.lastPass.runId : ''), style: { border: '1px solid ' + border, background: bg, borderRadius: 7, padding: '7px 8px', color: fg, fontSize: 11 } }, b.label + ' · ' + c.label + when);
        })),
      !(s.systemInfo && s.systemInfo.capabilities) ? h('div', { style: { color: '#94a3b8', fontSize: 11 } }, 'Capability status loading (GET /api/system-info)…') : null,
      s.serverStatusSummary ? h('div', { style: { marginTop: 8, color: '#94a3b8', fontSize: 11, fontFamily: "'IBM Plex Mono',monospace", overflowWrap: 'anywhere' } }, s.serverStatusSummary) : null);

    // ── System / About: operational facts from /api/system-info ─────
    const si = s.systemInfo;
    const siRow = (k, v, mono) => h('div', { key: k, style: { display: 'grid', gridTemplateColumns: 'minmax(80px,150px) minmax(0,1fr)', gap: 8, padding: '3px 0', fontSize: 12 } },
      h('div', { style: { color: '#7f93a8' } }, k),
      h('div', { style: { color: '#e2e8f0', overflowWrap: 'anywhere', fontFamily: mono ? "'IBM Plex Mono',monospace" : 'inherit' } }, v == null || v === '' ? '—' : String(v)));
    const siSection = (title, rows) => h('div', { key: title, style: { marginTop: 10 } },
      h('div', { style: { fontSize: 10, fontWeight: 800, color: '#94a3b8', letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 4 } }, title), ...rows);
    const siTs = si && si.network && si.network.tailscale;
    const siLauncher = si && si.launcher;
    const systemInfoPanel = h('div', { style: { border: '1px solid rgba(56,189,248,.22)', background: 'rgba(6,10,16,.64)', borderRadius: 9, padding: 12, marginBottom: 12 } },
      h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
        h('div', { style: { fontSize: 12, fontWeight: 800, color: '#cbd5e1', letterSpacing: '.06em', textTransform: 'uppercase' } }, 'About DexDiffusion'),
        h('div', { style: { flex: 1 } }),
        actionButton('Refresh', () => this.loadSystemInfo(), '#94a3b8')),
      !si ? h('div', { style: { color: '#94a3b8', fontSize: 12, marginTop: 8 } }, 'System info not loaded yet (GET /api/system-info).') : h('div', null,
        siSection('Access', [
          siRow('Local', si.network.localUrl, true),
          siRow('Tailnet', siTs && siTs.serveConfigured ? siTs.url + '  (' + siTs.scope + ')' : ((siTs && siTs.reason) || 'unknown'), true),
          siRow('Backend bind', si.network.localBind, true),
        ]),
        siSection('Primary engine', [
          siRow('Target', si.primaryTarget ? si.primaryTarget.label + ' · ' + si.primaryTarget.status : '—'),
          siRow('Model', si.generation.mflux.model + ' (' + si.generation.mflux.quantization + ')', true),
          siRow('Runtime', 'MFLUX ' + si.generation.mflux.version + ' · ' + si.generation.engine + ' on ' + si.generation.machine),
          siRow('Normal settings', si.generation.mflux.typical.steps + ' steps · guidance ' + si.generation.mflux.typical.guidance + ' · ' + si.generation.mflux.typical.sizes.join(' or ') + ' · seed supported'),
          siRow('Not used by MFLUX', si.generation.mflux.unsupported.join(', ')),
        ]),
        siSection('Generation & storage', [
          siRow('Big Mac route', si.generation.route, true),
          siRow('Generated images', si.storage.canonicalImages, true),
          siRow('Retention', si.generation.retentionNote),
        ]),
        siSection('Mac launcher', [
          siRow('App', siLauncher.appPath + (siLauncher.installed ? '' : '  (not installed)'), true),
          siRow('Dock', siLauncher.dockInstalled == null ? 'unknown' : siLauncher.dockInstalled ? 'installed (' + siLauncher.dockEntries + ')' : 'not in Dock'),
          siRow('Reinstall', siLauncher.installer, true),
        ]),
        siSection('SDCPP (secondary)', [
          siRow('Role', si.sdcpp.role),
          siRow('Revision', si.sdcpp.revision, true),
          siRow('Binary', si.sdcpp.binary, true),
          siRow('Models', si.sdcpp.models.map(m => m.path + ' (' + m.license + ')').join(' · '), true),
          siRow('Other targets', si.sdcpp.otherTargets),
        ]),
        h('div', { style: { color: '#7f93a8', fontSize: 11, marginTop: 10 } }, 'Docs: ' + si.app.docs + ' · state: ' + si.app.operationalState + ' · terminal: bin/dexdiffusion status · checked ' + si.checkedAt)));

    const keyboardHelp = h('div', { style: { border: '1px solid rgba(148,163,184,.12)', borderRadius: 8, padding: 9, color: '#94a3b8', fontSize: 11, lineHeight: 1.6, marginBottom: 10, background: 'rgba(5,10,18,.38)' } },
      'Keyboard shortcuts: Command+Enter generate · / focus prompt · P collapse prompt · S settings · L library');

    // ── Inpaint tools (canvas mask editor) inside Edit ────────
    const inpaintTools = this.buildInpaintTools(i2iSrcRunId, i2iSrcFile, inpStatus, inpResult, inpStrength, accent);

    // ── Toast overlay ─────────────────────────────────────────
    const toastOverlay = React.createElement('div', {
      style: { position: 'fixed', bottom: 20, right: 20, display: 'flex', flexDirection: 'column', gap: 8, zIndex: 9999, pointerEvents: 'none' }
    }, ...toasts.map(t => React.createElement('div', { key: t.id,
      style: { background: 'rgba(14,14,20,.96)', border: '1px solid ' + t.color, borderLeft: '3px solid ' + t.color, borderRadius: 8, padding: '9px 14px', fontSize: 13, color: t.color, fontFamily: "'DM Sans',sans-serif", fontWeight: 600, backdropFilter: 'blur(8px)', maxWidth: 360, lineHeight: 1.4 } },
      t.msg
    )));

    return {
      version, versionStr: String(version), screen, compactModeStr: String(s.compactMode),
      isV1: version===1, isV2: version===2, isV3: version===3,
      isV1Str: String(version===1), isV2Str: String(version===2), isV3Str: String(version===3),
      setV1: ()=>this.setVersion(1), setV2: ()=>this.setVersion(2), setV3: ()=>this.setVersion(3),
      isCreate: screen==='create', isBatch: screen==='batch', isEdit: screen==='edit',
      isEnhance: screen==='enhance', isLibrary: screen==='library', isModels: screen==='models', isSystem: screen==='system',
      isCreateStr: String(screen==='create'), isBatchStr: String(screen==='batch'),
      isEditStr: String(screen==='edit'), isEnhanceStr: String(screen==='enhance'),
      isLibraryStr: String(screen==='library'), isModelsStr: String(screen==='models'), isSystemStr: String(screen==='system'),
      navCreate: ()=>this.setScreen('create'), navBatch: ()=>this.setScreen('batch'),
      navEdit: ()=>this.setScreen('edit'), navEnhance: ()=>this.setScreen('enhance'),
      navLibrary: ()=>this.setScreen('library'), navModels: ()=>this.setScreen('models'), navSystem: ()=>this.setScreen('system'),
      // Create form
      prompt, negPrompt, steps: String(steps), cfg: String(cfg), seed: String(seed),
      width: String(width), height: String(height), promptLen: String(prompt.length),
      onPromptChange: e=>this.onPromptChange(e),
      promptPanelDisplay: promptOpen ? 'block' : 'none',
      promptToggleLabel: promptOpen ? 'Hide prompt' : 'Show prompt',
      promptChevron: promptOpen ? '▴' : '▾',
      onTogglePrompt: ()=>this.setState(s => ({promptOpen: !s.promptOpen})),
      onNegChange: e=>this.setState({negPrompt:e.target.value}),
      onStepsChange: e=>this.setState({steps:e.target.value}),
      onCfgChange: e=>this.setState({cfg:e.target.value}),
      onSeedChange: e=>this.setState({seed:e.target.value}),
      onWidthChange: e=>this.setState({width:e.target.value}),
      onHeightChange: e=>this.setState({height:e.target.value}),
      sampler, scheduler,
      onSamplerChange: e=>this.setState({sampler:e.target.value}),
      onSchedulerChange: e=>this.setState({scheduler:e.target.value}),
      setDim512: ()=>this.setState({width:512,height:512}),
      setDim768: ()=>this.setState({width:768,height:512}),
      setDim1024: ()=>this.setState({width:1024,height:1024}),
      onGenerate: ()=>this.onGenerate(),
      generateLabel: isGenerating ? ('Generating… ' + progress + '%') : 'Generate Image',
      genCursor: isGenerating ? 'default' : 'pointer',
      genOpacity: isGenerating ? '0.75' : '1',
      genBg1: isGenerating ? 'linear-gradient(90deg,#1a5068,#2a6034)' : 'linear-gradient(90deg,#38bdf8,#65d66e)',
      genBg2: isGenerating ? 'linear-gradient(90deg,#7a5008,#8a3810)' : 'linear-gradient(90deg,#f59e0b,#fb923c)',
      genBg3: isGenerating ? 'linear-gradient(135deg,#4a2a8a,#0a6a8a)' : 'linear-gradient(135deg,#8b5cf6,#22d3ee)',
      showJobResult: jobStatus !== 'idle',
      jobIdle: jobStatus === 'idle',
      imageDisplay: this.buildImageDisplay(jobStatus, progress, currentImageSrc, lastSeed, errorMsg),
      actionStatus: isGenerating ? ('generating · ' + progress + '%') : jobStatus==='complete' ? ('done · seed ' + lastSeed) : jobStatus==='error' ? 'error · check backend' : 'idle · no job',
      // Status chips
      backendDot, backendLabel: backendOnline ? 'Backend' : 'Offline',
      backendChipBg: backendOnline ? 'rgba(101,214,110,.08)' : 'rgba(239,68,68,.08)',
      backendChipBorder: backendOnline ? 'rgba(101,214,110,.2)' : 'rgba(239,68,68,.2)',
      jobDot, jobLabel: isGenerating ? (progress + '%') : jobStatus==='complete' ? 'Done' : jobStatus==='error' ? 'Error' : 'Idle',
      jobChipBg: isGenerating ? 'rgba(56,189,248,.07)' : jobStatus==='complete' ? 'rgba(101,214,110,.07)' : jobStatus==='error' ? 'rgba(239,68,68,.07)' : 'rgba(251,191,36,.07)',
      jobChipBorder: isGenerating ? 'rgba(56,189,248,.2)' : jobStatus==='complete' ? 'rgba(101,214,110,.2)' : jobStatus==='error' ? 'rgba(239,68,68,.2)' : 'rgba(251,191,36,.2)',
      // System
      backendUrl, backendStatusColor: backendOnline ? '#65d66e' : '#ef4444',
      backendStatusText: backendOnline ? '✓ Online' : '✗ Offline',
      onBackendUrlChange: e=>{ const u=DexClient.resolveBackendBase(e.target.value); this.setState({backendUrl:u}); try { localStorage.setItem('dex_backend_url',u); } catch {} },
      onVerifyBackend: ()=>{ this.pingBackend(); this.toast('Pinging backend…', '#38bdf8'); },
      onStartServer: ()=>{ fetch(this.state.backendUrl+'/api/actions/server-start',{method:'POST'}).then(r=>r.json()).then(d=>{ const {job_id}=d; if(job_id) this._startPoll(job_id,()=>{ this.toast('Server started','#65d66e'); this.pingBackend(); }); }).catch(()=>this.toast('Start failed','#ef4444')); },
      onStopServer: ()=>{ fetch(this.state.backendUrl+'/api/actions/server-stop',{method:'POST'}).then(r=>r.json()).then(d=>{ const {job_id}=d; if(job_id) this._startPoll(job_id,()=>{ this.toast('Server stopped','#fbbf24'); this.pingBackend(); }); }).catch(()=>this.toast('Stop failed','#ef4444')); },
      onServerStatus: ()=>{ this.pingBackend(); this.loadRuns(); this.serverStatus(); },
      target, onTargetChange: e=>this.onSelectTarget(e.target.value),
      targetSelectV1, targetSelectV2, targetSelectV3,
      preset, onPresetChange: e=>this.onSelectPreset(e.target.value),
      promptTools, onEnhancePrompt: ()=>this.enhancePrompt(),
      onCopyParams: ()=>this.copyText('Params', JSON.stringify(this.currentParams(), null, 2)),
      onReuseLastSeed: ()=>{ if(lastSeed!=null){this.setState({seed:String(lastSeed)}); this.toast('Seed '+lastSeed+' reloaded', '#38bdf8');} },
      goToImg2img: ()=>this.setScreen('edit'),
      savePrompts, onSavePrompts: e=>{ const v=e.target.checked; this.setState({savePrompts:v}); localStorage.setItem('dex_save_prompts',String(v)); },
      onRefreshRuns: ()=>this.loadRuns(), onRefreshAll: ()=>this.refreshAll(), onDiscoverAssets: ()=>this.discoverAssets(),
      settingsDrawer, runInspector, truthStatusPanel, systemInfoPanel, keyboardHelp, validationPanel,
      libraryCards, runsCount: String(runs.length), jobLogDisplay,
      libraryFilters, libraryLoadMore, extraNetworksDisplay,
      onHiresSubmit: ()=>this.onHiresSubmit(),
      onXyzSubmit: ()=>this.onXyzSubmit(),
      // Batch
      batchAxisX, batchValuesX, batchPrompt, batchNeg,
      batchSteps: String(batchSteps), batchCfg: String(batchCfg),
      batchW: String(batchW), batchH: String(batchH),
      batchRunning, batchDone: String(batchDone), batchTotal: String(batchTotal), batchStatus,
      onBatchAxisChange: e=>this.setState({batchAxisX:e.target.value}),
      onBatchValuesChange: e=>this.setState({batchValuesX:e.target.value}),
      onBatchPromptChange: e=>this.setState({batchPrompt:e.target.value}),
      onBatchNegChange: e=>this.setState({batchNeg:e.target.value}),
      onBatchStepsChange: e=>this.setState({batchSteps:e.target.value}),
      onBatchCfgChange: e=>this.setState({batchCfg:e.target.value}),
      onBatchWChange: e=>this.setState({batchW:e.target.value}),
      onBatchHChange: e=>this.setState({batchH:e.target.value}),
      onBatchSubmit: ()=>this.onBatchSubmit(),
      batchSubmitLabel: batchRunning ? ('Running ' + batchDone + '/' + batchTotal + '…') : batchStatus==='done' ? 'Run Again' : 'Submit Batch',
      batchProgressDisplay,
      // img2img
      i2iPrompt, i2iNeg, i2iDenoise: String(i2iDenoise), i2iSteps: String(i2iSteps),
      i2iCfg: String(i2iCfg), i2iSeed: String(i2iSeed), i2iSrcRunId, i2iStatus, i2iProgress: String(i2iProgress),
      onI2iPromptChange: e=>this.setState({i2iPrompt:e.target.value}),
      onI2iNegChange: e=>this.setState({i2iNeg:e.target.value}),
      onI2iDenoiseChange: e=>this.setState({i2iDenoise:e.target.value}),
      onI2iStepsChange: e=>this.setState({i2iSteps:e.target.value}),
      onI2iCfgChange: e=>this.setState({i2iCfg:e.target.value}),
      onI2iSeedChange: e=>this.setState({i2iSeed:e.target.value}),
      onImg2imgSubmit: ()=>this.onImg2imgSubmit(),
      i2iSubmitLabel: i2iStatus==='generating' ? ('img2img · ' + i2iProgress + '%') : 'Run img2img',
      i2iStatusDisplay, srcRunOptions, srcImageOptions, inpaintTools,
      // Enhance
      enhSrcRunId, enhScale: String(enhScale), enhMethod, enhStatus,
      onEnhScaleChange: e=>this.setState({enhScale:e.target.value}),
      onEnhMethodChange: e=>this.setState({enhMethod:e.target.value}),
      onEnhSrcChange: e=>this.setState({enhSrcRunId:e.target.value}),
      onEnhanceSubmit: ()=>this.onEnhanceSubmit(),
      enhSubmitLabel: enhStatus==='running' ? 'Enhancing…' : 'Enhance Image',
      enhStatusDisplay, enhSrcOptions, enhImageOptions,
      // Models
      checkpoints, loadingCheckpoints, activeCheckpoint, modelsListDisplay,
      onLoadModels: ()=>this.loadModels(),
      loadModelsLabel: loadingCheckpoints ? 'Loading…' : 'Refresh Models',
      // Toasts
      toastOverlay,
    };
  }
}

// Expose for the bootstrap in index.html
window.DexDiffusionComponent = Component;
