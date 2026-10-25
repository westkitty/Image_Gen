// DexDiffusion component — ported verbatim from DexDiffusion_Combined.dc.html
// Runs on the lightweight DC-compatible runtime in dc-runtime.js (DCLogic + React.createElement).
// The fictional A1111 onGenerate() stub (sdapi/v1) was removed so the real port-31337
// generate-controlled flow (the first onGenerate) is the one that runs.

class Component extends DCLogic {
  state = {
    // G4 / T-401: Studio is the only normal product shell. A one-time, idempotent migration records
    // where the profile came from and points the preference at Studio without touching any draft.
    version: (() => {
      try {
        const Nav = window.DexStudioNav;
        if (!Nav) return 2;
        Nav.migratePreferences(localStorage);
        const developerMode = Nav.isDeveloperMode(localStorage, window.location);
        return Nav.resolveInitialVersion(localStorage.getItem('dex_version'), { developerMode });
      } catch (_) { return 2; }
    })(),
    screens: (() => {
      let s = 'create';
      try { s = window.DexStudioNav ? window.DexStudioNav.resolveInitialScreen(sessionStorage.getItem('dex_screen')) : (sessionStorage.getItem('dex_screen') || 'create'); } catch {}
      let ca = 'workstation'; try { ca = sessionStorage.getItem('dex_concept_screen') || 'workstation'; } catch {}
      // Unified Studio: only the opt-in masters layout of V2 may restore the Chat leaf; V1/V3 never see it.
      let s2 = s;
      try { const Nav = window.DexStudioNav; if (Nav && Nav.resolveLayout(localStorage) === 'masters') s2 = Nav.resolveInitialScreenV2(sessionStorage.getItem('dex_screen')); } catch {}
      return { 1: s, 2: s2, 3: s, 4: ca };
    })(),
    // Unified Studio navigation layout (rollback flag): 'flat' is the 14-chip row and stays the default.
    studioLayout: (() => { try { return window.DexStudioNav ? window.DexStudioNav.resolveLayout(localStorage) : 'flat'; } catch (_) { return 'flat'; } })(),
    studioSubroute: (() => { try { const Nav = window.DexStudioNav; return Nav && Nav.resolveLayout(localStorage) === 'masters' ? Nav.resolveSubroute(sessionStorage.getItem(Nav.SUBROUTE_KEY), sessionStorage.getItem('dex_screen')) : null; } catch (_) { return null; } })(),
    // Cross-master handoff origin for the masters layout's Back control: { leaf } or null.
    navReturnTo: null,
    // Chat placeholder readiness, read from the server; never "ready" without the Chat UI (Phase 5).
    chatAvailability: { phase: 'idle', ollama: 'unknown', feature: 'unknown', checkedAt: null },
    chatModels: [], chatModel: 'gemma3:4b', chatSessionId: null, chatMessages: [], chatDraft: '',
    chatRunning: false, chatStreamText: '', chatStatus: '', chatError: '', chatJobId: null,
    chatSessionMode: 'temporary', chatSaveNext: false, chatSavedSessions: [], chatSavedSessionsLoaded: false,
    chatHistoryCredential: '', chatHistoryStatus: '', chatExportFormat: 'json',
    activeAssetSelection: null,
    // Create
    target: 'sd15',
    prompt: '', negPrompt: '',
    promptOpen: true,
    negPromptOpen: false,
    settingsOpen: false, compactMode: localStorage.getItem('dex_compact_mode') === 'true',
    selectedVae: 'default', favoriteName: '',
    // Recipes (formerly Favorite presets). Prompt text persists only when prompt saving is on;
    // older presets that stored prompts are scrubbed on load when it is off.
    favoritePresets: (() => {
      try {
        const save = localStorage.getItem('dex_save_prompts') === 'true';
        const raw = JSON.parse(localStorage.getItem('dex_favorite_presets') || '[]');
        // Versioned recipes (v2: mode + resources). Legacy v0/v1 entries migrate in place as Create presets.
        const clean = raw.map(p => DexEdit.migrateRecipe(p.params ? { id: p.id, name: p.name, target: p.params.target, width: p.params.width, height: p.params.height, steps: p.params.steps, cfg: p.params.cfg_scale, sampler: p.params.sampler, scheduler: p.params.scheduler, vae: p.params.selectedVae, preset: p.params.preset, prompt: p.params.prompt, negPrompt: p.params.negative_prompt } : p, save));
        localStorage.setItem('dex_favorite_presets', JSON.stringify(clean));
        return clean;
      } catch { return []; }
    })(),
    steps: 20, cfg: 7, seed: -1, width: 512, height: 512,
    sampler: 'euler_a', scheduler: 'discrete', clipSkip: '', tiling: false, eta: '', rng: '',
    jobStatus: 'idle', progress: 0, currentImageSrc: null, lastSeed: null, errorMsg: '', lastGenerationParams: null,
    // T-202: the exact job currently owned by the Studio Create screen (mirrored for the Cancel control).
    activeJobId: null,
    // Batch
    batchAxisX: 'seed', batchValuesX: '-1,-1,-1,-1',
    batchPrompt: '', batchNeg: '', batchSteps: 20, batchCfg: 7, batchW: 512, batchH: 512,
    batchQueue: [], batchRunning: false, batchDone: 0, batchTotal: 0,
    batchStatus: 'idle',
    // Edit (img2img/inpaint/outpaint) state lives in edit-ui.js (this.ed); only legacy source pickers remain here.
    i2iSrcRunId: 'last',
    // Enhance
    enhSrcRunId: 'last', enhScale: 2, enhMethod: 'pillow',
    enhStatus: 'idle', enhResult: null,
    // Models
    checkpoints: [], loadingCheckpoints: false, activeCheckpoint: '', capabilityData: null,
    modelTargets: [],          // raw capability targets (with defaults) for preset application
    preset: 'balanced',
    modelCards: [], loadingModelCards: false, modelSearch: '', modelFamilyFilter: 'all',
    modelBrowserOpen: false, modelSwitchWarning: null,
    // img2img / enhance source files (populated from /api/runs/:id/files)
    runFiles: {}, i2iSrcFile: '', enhSrcFile: '',
    // Library filters + pagination
    libFilter: 'all', libOffset: 0, libTotal: 0, libHasMore: false, libLoadingMore: false,
    // Ollama prompt enhance
    ollamaOnline: false, ollamaModel: '', enhancingPrompt: false,
    enhancementResult: null, previousPrompt: null,
    enhancingNegPrompt: false, negEnhancementResult: null, previousNegPrompt: null,
    // Wildcards
    wildcards: [], showWildcards: false, wildcardFilter: '',
    showNegWildcards: false, negWildcardFilter: '',
    // Extra networks / LoRA
    assets: { loras: [], vaes: [], embeddings: { count: 0, items: [], empty_state_message: 'No Textual Inversion embeddings discovered' } },
    loadingAssets: false, extraNetworksTab: 'loras',
    loraWeights: {}, createLoras: [],
    showLoraPicker: false, loraSearchQuery: '',
    createLora: (() => { try { return Object.assign({ enabled: false, selectedId: '', strength: 1, advanced: false, savedSettings: null, overrides: {} }, JSON.parse(localStorage.getItem('dex_create_lora_v1') || '{}')); } catch { return { enabled: false, selectedId: '', strength: 1, advanced: false, savedSettings: null, overrides: {} }; } })(),
    // Global
    backendUrl: (() => { try { return DexClient.resolveBackendBase(localStorage.getItem('dex_backend_url')); } catch { return ''; } })(),
    backendOnline: false,
    runs: (() => { try { return JSON.parse(localStorage.getItem('dex_runs') || '[]'); } catch { return []; } })(),
    selectedRunId: '', selectedRunDetail: null, loadingRunDetail: false, runSearch: '',
    worldProjects: [], worldLoading: false, worldSourceArtifact: '', worldWorkerStatus: null,
    asset3dWorkerStatus: null, asset3dSourceArtifact: '', asset3dPreviewFailedId: '', asset3dMode: 'mesh', asset3dLoading: false, asset3dJob: null,
    assetQuery: '', serverStatusSummary: '', lastValidation: '',
    savePrompts: localStorage.getItem('dex_save_prompts') === 'true',
    toasts: [],
  };

  _pingTimer = null; _pollTimer = null; _worldPollTimer = null; _asset3dPollTimer = null; _toastId = 0;
  _completedImageCache = { key: null, node: null };

  componentDidMount() {
    if (this.state.version === 2 && this.state.screens[2] === 'chat') this.loadChatAvailability();
    this._keyHandler = (e) => this.onKeydown(e);
    this._beforeUnloadHandler = (e) => {
      if (!this._hasUnsavedWorkspaceWork()) return;
      e.preventDefault();
      e.returnValue = '';
    };
    this._wheelHandler = (e) => {
      const preview = document.querySelector('[data-studio-preview="create"]');
      if (!preview || !preview.contains(e.target)) return;
      let cur = e.target;
      let targetCanScroll = false;
      while (cur && cur !== preview) {
        if (cur.scrollHeight > cur.clientHeight + 2) {
          const oy = window.getComputedStyle(cur).overflowY;
          if (oy === 'auto' || oy === 'scroll') {
            if ((e.deltaY > 0 && cur.scrollTop + cur.clientHeight < cur.scrollHeight - 1) ||
                (e.deltaY < 0 && cur.scrollTop > 1)) {
              targetCanScroll = true;
              break;
            }
          }
        }
        cur = cur.parentElement;
      }
      if (targetCanScroll) return;
      const pane = document.querySelector('[data-studio-create] [data-scroll-pane]');
      if (pane && pane.scrollHeight > pane.clientHeight) {
        pane.scrollTop += e.deltaY;
      }
    };
    window.addEventListener('wheel', this._wheelHandler, { passive: true });
    window.addEventListener('keydown', this._keyHandler);
    window.addEventListener('beforeunload', this._beforeUnloadHandler);
    this.pingBackend();
    this._pingTimer = setInterval(() => this.pingBackend(), 20000);
    this.loadRuns();
    this.loadWorldProjects();
    this.loadAsset3dWorkers();
    this.loadModels();
    this.loadAssets();
    this.loadWildcards();
    this.checkOllama();
    this.loadSystemInfo();
  }
  componentWillUnmount() {
    clearInterval(this._pingTimer); clearInterval(this._pollTimer); clearInterval(this._worldPollTimer); clearInterval(this._asset3dPollTimer);
    this._pollGeneration = (this._pollGeneration || 0) + 1;
    for (const controller of this._jobWaitControllers || []) controller.abort();
    this._detailerDetectController?.abort();
    if (this._wheelHandler) window.removeEventListener('wheel', this._wheelHandler);
    window.removeEventListener('keydown', this._keyHandler);
    window.removeEventListener('beforeunload', this._beforeUnloadHandler);
  }

  _workspaceForScreen(screen) {
    if (screen === 'create' || screen === 'batch') return 'generate';
    if (screen === 'edit' || screen === 'enhance') return 'edit';
    if (screen === 'library') return 'media';
    if (screen === 'models' || screen === 'system') return 'settings';
    return screen || 'workstation';
  }

  _unsavedWorkspaceWork() {
    const edDirty = typeof this._editDraftIsDirty === 'function' && this._editDraftIsDirty();
    if (edDirty) return { workspace: 'edit', label: 'unsaved Edit changes' };
    const dm = typeof this._dm === 'function' ? this._dm() : null;
    const dmText = this._dmText || {};
    if (dm && ((dm.current && !dm.current.saved) || Object.keys(dm.pending || {}).length || this._dmFlushPromise || this._dramaSavePromise || String(dmText.script || '').trim() || String(dmText.title || '').trim())) {
      return { workspace: 'drama', label: 'Drama project or script' };
    }
    const prompt = String(this.state.prompt || '').trim() || String(this.state.negPrompt || '').trim();
    if (prompt) return { workspace: 'generate', label: 'Create prompt' };
    return null;
  }

  _hasUnsavedWorkspaceWork() { return !!this._unsavedWorkspaceWork(); }

  _confirmWorkspaceLeave(targetScreen) {
    const current = this.state.screens[this.state.version];
    const dirty = this._unsavedWorkspaceWork();
    if (!dirty || this._workspaceForScreen(current) !== dirty.workspace || this._workspaceForScreen(current) === this._workspaceForScreen(targetScreen)) return true;
    if (dirty.workspace === 'drama' && this._canSaveDramaBeforeLeaving()) {
      this._showDramaLeaveDialog(targetScreen);
      return false;
    }
    return window.confirm(`${dirty.label} are not saved to a durable project. Switch workspaces? This draft stays in memory while DexDiffusion remains open; closing or reloading the page loses it.`);
  }

  _canSaveDramaBeforeLeaving() {
    const dm = this.dm, text = this._dmText || {};
    if (!dm || !dm.current || !dm.current.id || typeof this.dramaSave !== 'function') return false;
    // Save project persists parsed project state. A modified script/title still in
    // the text editor has not been applied to that project and must not be implied saved.
    return (!String(text.script || '').trim() || text.script === dm.current.source_script) &&
      (!String(text.title || '').trim() || text.title === dm.current.title);
  }

  _showDramaLeaveDialog(targetScreen) {
    if (this._pendingWorkspaceNavigation) return;
    const opener = document.activeElement;
    const dialog = document.createElement('section');
    dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'dex-leave-title'); dialog.dataset.workspaceLeaveDialog = 'drama';
    Object.assign(dialog.style, { position: 'fixed', zIndex: '2147483000', inset: '0', display: 'grid', placeItems: 'center', margin: '0', width: '100vw', height: '100vh', padding: '16px', boxSizing: 'border-box', border: '0', background: '#020617c9', color: '#e5e7eb', font: '14px system-ui' });
    const panel = document.createElement('div');
    Object.assign(panel.style, { width: 'min(460px, calc(100vw - 32px))', padding: '22px', borderRadius: '14px', border: '1px solid rgba(148,163,184,.35)', background: '#111827', boxShadow: '0 24px 80px #000b' });
    const title = document.createElement('h2'); title.id = 'dex-leave-title'; title.textContent = 'Unsaved Drama project';
    const message = document.createElement('p'); message.textContent = 'Save and continue waits for the project save to succeed. You can also stay here or leave the draft in memory without saving it.';
    const error = document.createElement('p'); error.setAttribute('role', 'alert'); error.hidden = true; Object.assign(error.style, { color: '#fca5a5' });
    const actions = document.createElement('div'); Object.assign(actions.style, { display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'flex-end', marginTop: '18px' });
    const button = (label, action, primary) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; Object.assign(b.style, { minHeight: '40px', padding: '8px 12px', borderRadius: '8px', border: '1px solid #64748b', background: primary ? '#65d66e' : '#1f2937', color: primary ? '#07120a' : '#e5e7eb', fontWeight: '700', cursor: 'pointer' }); b.addEventListener('click', action); return b; };
    const stay = button('Stay', () => this._finishDramaLeaveDialog(false), false);
    const leave = button('Leave draft in memory', () => this._finishDramaLeaveDialog(true), false);
    const save = button('Save and continue', async () => {
      if (this._pendingWorkspaceNavigation?.saving) return;
      this._pendingWorkspaceNavigation.saving = true; [stay, leave, save].forEach(b => b.disabled = true);
      let ok = false;
      try { ok = await this.dramaSave(true); } catch (e) { error.textContent = 'Save did not complete: ' + (e && e.message || 'unexpected error') + '. The current workspace and draft are unchanged.'; error.hidden = false; }
      if (ok) { this._pendingWorkspaceNavigation.saving = false; this._finishDramaLeaveDialog(true); return; }
      if (!this._pendingWorkspaceNavigation) return;
      this._pendingWorkspaceNavigation.saving = false; [stay, leave, save].forEach(b => b.disabled = false);
      error.textContent = 'Save did not complete. The current workspace and draft are unchanged. Resolve the error and retry, or stay.'; error.hidden = false;
      save.focus();
    }, true);
    actions.append(stay, leave, save); panel.append(title, message, error, actions); dialog.append(panel);
    this._pendingWorkspaceNavigation = { targetScreen, opener, dialog };
    dialog.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !this._pendingWorkspaceNavigation?.saving) { e.preventDefault(); this._finishDramaLeaveDialog(false); return; }
      if (e.key === 'Tab') {
        const controls = [stay, leave, save].filter(b => !b.disabled), first = controls[0], last = controls[controls.length - 1];
        if (e.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { e.preventDefault(); first?.focus(); }
      }
    });
    document.body.appendChild(dialog); save.focus();
  }

  _finishDramaLeaveDialog(continueNavigation) {
    const pending = this._pendingWorkspaceNavigation;
    if (!pending || pending.saving) return false;
    this._pendingWorkspaceNavigation = null;
    pending.dialog.remove();
    if (continueNavigation) this.setScreen(pending.targetScreen, { skipUnsavedGuard: true });
    else if (pending.opener && pending.opener.isConnected) pending.opener.focus();
    return true;
  }

  /** @param {{kind:'image'|'audio'|'voice-profile'|'drama-project'|'asset3d'|'world-project',id:string}|null} selection */
  setActiveAssetSelection(selection) {
    if (selection == null) { this.setState({ activeAssetSelection: null }); return true; }
    const kinds = new Set(['image', 'audio', 'voice-profile', 'drama-project', 'asset3d', 'world-project']);
    const kind = String(selection.kind || ''), id = String(selection.id || '').trim();
    if (!kinds.has(kind) || !id) return false;
    this.setState({ activeAssetSelection: Object.freeze({ kind, id }) });
    return true;
  }

  onKeydown(e) {
    if (this.state.version === 2 && this.state.screens[2] === 'chat' && this.state.studioLayout === 'masters') {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && e.target && e.target.closest('[data-studio-chat]')) { e.preventDefault(); this.sendChat(); return; }
      if (e.target && e.target.closest('[data-studio-chat]')) return;
    }
    const dialog = document.querySelector('[data-detailer-dialog]');
    if (dialog) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.closeDetailer(); return; }
      if (e.key === 'Tab') {
        const controls = [...dialog.querySelectorAll('button,input,select,textarea,[tabindex="0"]')].filter(n => !n.disabled && n.getBoundingClientRect().width);
        const first = controls[0], last = controls[controls.length - 1];
        if (e.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { e.preventDefault(); first?.focus(); }
      }
      return;
    }
    if (e.key === 'Escape') {
      if (this.state.showLoraPicker || this.state.showWildcards || this.state.showNegWildcards) {
        e.preventDefault();
        this.setState({ showLoraPicker: false, showWildcards: false, showNegWildcards: false });
        return;
      }
    }
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
    if (!msg) return;
    if ((this.state.toasts || []).some(t => t.msg === msg)) return;
    const id = ++this._toastId;
    this.setState(s => ({ toasts: [...(s.toasts || []), { id, msg, color }] }));
    setTimeout(() => this.setState(s => ({ toasts: (s.toasts || []).filter(t => t.id !== id) })), 3200);
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
      fullUrl: thumbUrl || '',
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
    this.loadWorldProjects();
    this.loadAsset3dWorkers();
    this.loadModels();
    this.loadAssets();
    this.loadWildcards();
    this.checkOllama();
    this.loadSystemInfo();
    this.toast('Refreshed visible data', '#38bdf8');
  }

  async loadWorldProjects() {
    this.setState({ worldLoading: true });
    try {
      const [projects, workers] = await Promise.all([
        fetch(this.state.backendUrl + '/api/world/projects', { signal: AbortSignal.timeout(7000) }),
        fetch(this.state.backendUrl + '/api/world/workers', { signal: AbortSignal.timeout(12000) }),
      ]);
      const p = projects.ok ? await projects.json() : { projects: [] };
      const w = workers.ok ? await workers.json() : null;
      this.setState({ worldProjects: p.projects || [], worldWorkerStatus: w, worldLoading: false });
    } catch (_) { this.setState({ worldLoading: false }); }
  }

  async loadAsset3dWorkers() {
    try {
      const r = await fetch(this.state.backendUrl + '/api/3d/workers', { signal: AbortSignal.timeout(15000) });
      if (r.ok) this.setState({ asset3dWorkerStatus: await r.json() });
    } catch (_) {}
  }

  async startAsset3d(mode) {
    const SA = this._sourceAsset();
    if (!SA) { this.toast('Source resolution failed to load — reload Studio before starting 3D.', '#ef4444'); return; }
    const resolved = SA.resolveSource({ explicitId: this.state.asset3dSourceArtifact, selection: this.state.activeAssetSelection });
    if (!resolved.ok) { try { document.querySelector('select[aria-label="3D source image"]')?.focus(); } catch (_) {} }
    if (!resolved.ok) { this.toast(resolved.message, '#fbbf24'); return; }
    const source = resolved.id;
    this.setState({ asset3dLoading: true, asset3dMode: mode });
    try {
      const url = mode === 'quick3d' ? '/api/world/projects' : '/api/3d/jobs';
      const body = mode === 'quick3d' ? { mode, sourceArtifactId: source, parameters: { seed: 42 } } : { mode, sourceArtifactId: source };
      const r = await fetch(this.state.backendUrl + url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const result = await r.json().catch(() => ({}));
      if (!r.ok) { this.toast(result.error || '3D request rejected', '#ef4444'); this.setState({ asset3dLoading: false }); return; }
      this.setState({ asset3dLoading: false, asset3dJob: result });
      if (mode !== 'quick3d' && result.artifacts_detail && result.artifacts_detail[0] && result.artifacts_detail[0].artifact_id) this.setActiveAssetSelection({ kind: 'asset3d', id: result.artifacts_detail[0].artifact_id });
      this.toast(mode === 'quick3d' ? 'Quick Geometry queued' : (mode === 'textured' ? 'Textured Asset queued' : 'Mesh queued'), '#38bdf8');
      await this.loadWorldProjects();
      if (result.job_id) this.pollAsset3dJob(result.job_id);
    } catch (e) { this.setState({ asset3dLoading: false }); this.toast('3D request failed: ' + e.message, '#ef4444'); }
  }

  pollAsset3dJob(jobId) {
    clearInterval(this._asset3dPollTimer);
    let failures = 0;
    this._asset3dPollTimer = setInterval(async () => {
      try {
        const r = await fetch(this.state.backendUrl + '/api/generic-jobs/' + encodeURIComponent(jobId), { signal: AbortSignal.timeout(8000) });
        if (!r.ok) throw new Error('job ' + r.status);
        const job = await r.json(); this.setState({ asset3dJob: job });
        if (['COMPLETE', 'FAILED', 'CANCELLED', 'INTERRUPTED'].includes(job.status)) {
          clearInterval(this._asset3dPollTimer); await this.loadAsset3dWorkers();
          this.toast(job.status === 'COMPLETE' ? '3D asset ready' : '3D job ' + job.status.toLowerCase(), job.status === 'COMPLETE' ? '#65d66e' : '#ef4444');
        }
      } catch (_) { if (++failures >= 5) clearInterval(this._asset3dPollTimer); }
    }, 1200);
  }

  openAsset3dViewer(artifactId) { this.setActiveAssetSelection({ kind: 'asset3d', id: artifactId }); window.open('/dexdiffusion/asset3d-viewer.html?artifact=' + encodeURIComponent(artifactId), '_blank', 'noopener'); }

  openAsset3dInBlender(artifactId) {
    fetch(this.state.backendUrl + '/api/3d/open-in-blender', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ artifact_id: artifactId }) })
      .then(async r => { const body = await r.json().catch(() => ({})); if (!r.ok) throw new Error(body.error || 'Blender request failed'); this.toast('Opened in Blender', '#65d66e'); })
      .catch(e => this.toast(e.message, '#ef4444'));
  }

  async startWorld(mode, sourceArtifactId) {
    const SA = this._sourceAsset();
    if (!SA) { this.toast('Source resolution failed to load — reload Studio before starting World.', '#ef4444'); return; }
    const resolved = SA.resolveSource({ explicitId: sourceArtifactId || this.state.worldSourceArtifact, selection: this.state.activeAssetSelection });
    if (!resolved.ok) { try { document.querySelector('select[aria-label="World source image"]')?.focus(); } catch (_) {} }
    if (!resolved.ok) { this.toast(resolved.message, '#fbbf24'); return; }
    const source = resolved.id;
    this.setState({ worldLoading: true });
    try {
      const r = await fetch(this.state.backendUrl + '/api/world/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode, sourceArtifactId: source, parameters: { seed: 42 } }) });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) { this.toast(body.error || 'World request rejected', '#ef4444'); this.setState({ worldLoading: false }); return; }
      if (body.id) this.setActiveAssetSelection({ kind: 'world-project', id: body.id });
      this.setScreen('world');
      this.toast(mode === 'quick3d' ? 'Quick 3D queued' : 'Complete 360 recorded as blocked', mode === 'quick3d' ? '#38bdf8' : '#fbbf24');
      await this.loadWorldProjects();
      if (body.job_id) this.pollWorldJob(body.job_id);
    } catch (e) { this.setState({ worldLoading: false }); this.toast('World request failed: ' + e.message, '#ef4444'); }
  }

  pollWorldJob(jobId) {
    clearInterval(this._worldPollTimer);
    let failures = 0;
    this._worldPollTimer = setInterval(async () => {
      try {
        const r = await fetch(this.state.backendUrl + '/api/generic-jobs/' + encodeURIComponent(jobId), { signal: AbortSignal.timeout(6000) });
        if (!r.ok) throw new Error('job ' + r.status);
        const j = await r.json();
        if (['COMPLETE', 'FAILED', 'CANCELLED', 'INTERRUPTED'].includes(j.status)) {
          clearInterval(this._worldPollTimer); await this.loadWorldProjects();
          this.toast(j.status === 'COMPLETE' ? 'World artifact ready' : 'World job ' + j.status.toLowerCase(), j.status === 'COMPLETE' ? '#65d66e' : '#ef4444');
        }
      } catch (_) { if (++failures >= 5) clearInterval(this._worldPollTimer); }
    }, 1200);
  }

  openWorldViewer(projectId) { this.setActiveAssetSelection({ kind: 'world-project', id: projectId }); window.open('/dexdiffusion/world-viewer.html?project=' + encodeURIComponent(projectId), '_blank', 'noopener'); }

  buildWorldWorkspace() {
    const h = React.createElement;
    const s = this.state;
    const SA = this._sourceAsset();
    const picks = SA ? SA.choices(s.runs) : [];
    const currentSource = s.worldSourceArtifact || '';
    if (SA && SA.isImageId(currentSource) && !picks.some(p => p.id === currentSource)) {
      picks.unshift({ id: currentSource, label: currentSource + ' · chosen in Library' });
    }
    const opts = [h('option', { key: '__none', value: '' }, picks.length ? 'Choose a source image…' : 'No canonical images loaded')]
      .concat(picks.map(p => h('option', { key: p.id, value: p.id }, p.label + (p.run && p.run.model ? ' · ' + p.run.model : ''))));
    const status = s.worldWorkerStatus;
    const workerLine = status && status.workers ? status.workers.map(w => `${w.label}: ${w.status}`).join(' · ') : 'Worker status loading…';
    return h('div', { style: { display: 'grid', gap: 14 } },
      h('div', { style: { background: '#060a10', border: '1px solid rgba(148,163,184,.14)', borderRadius: 12, padding: 16 } },
        h('div', { style: { fontSize: 18, color: '#f0f4f8', fontWeight: 750, marginBottom: 4 } }, 'World'),
        h('div', { style: { color: '#90a4b8', fontSize: 12, lineHeight: 1.5, marginBottom: 12 } }, 'Dedicated local 3D workspace. Quick 3D reconstructs one image; Complete 360 builds panorama, depth/scaffold, aligned SHARP proposals, fusion and viewer artifacts. Learned global depth is not installed, so Complete 360 may report WARN while using the bounded fallback.'),
        h('div', { 'data-source-rule': 'world', style: { color: '#8fa3b8', fontSize: 11, lineHeight: 1.5, marginBottom: 8 } }, 'World uses exactly the image you choose here. Nothing is substituted, and no source is pre-selected.'),
        h('select', { 'aria-label': 'World source image', value: s.worldSourceArtifact || '', onChange: e => { this.setState({ worldSourceArtifact: e.target.value }); if (SA && SA.isImageId(e.target.value)) this.setActiveAssetSelection({ kind: 'image', id: e.target.value }); }, style: { width: '100%', maxWidth: 520, marginBottom: 10, border: '1px solid rgba(148,163,184,.2)', background: '#091420', color: '#e8f0f7', borderRadius: 7, padding: 8 } }, ...opts),
        h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
          h('button', { onClick: () => this.startWorld('quick3d'), style: { border: '1px solid #38bdf866', background: '#38bdf616', color: '#38bdf8', borderRadius: 7, padding: '8px 12px', cursor: 'pointer', fontWeight: 700 } }, 'Make 3D'),
          h('button', { onClick: () => this.startWorld('complete360'), style: { border: '1px solid #f59e0b66', background: '#f59e0b16', color: '#fbbf24', borderRadius: 7, padding: '8px 12px', cursor: 'pointer', fontWeight: 700 } }, 'Make World'),
          h('button', { onClick: () => this.loadWorldProjects(), style: { border: '1px solid rgba(148,163,184,.2)', background: 'transparent', color: '#b8c7d6', borderRadius: 7, padding: '8px 12px', cursor: 'pointer' } }, 'Reload')
        ),
        h('div', { style: { marginTop: 12, color: '#70849a', fontSize: 11, fontFamily: "'IBM Plex Mono',monospace" } }, workerLine)
      ),
      ...(s.worldProjects || []).map(p => {
        const finalPly = p.artifacts && p.artifacts.finalPly;
        const canOpen = Array.isArray(finalPly) ? finalPly.length > 0 : !!finalPly;
        return h('div', { key: p.id, style: { background: '#060a10', border: '1px solid rgba(148,163,184,.12)', borderRadius: 10, padding: 13 } },
          h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' } }, h('div', { style: { color: '#e2e8f0', fontWeight: 700 } }, p.mode + ' · ' + p.id), h('div', { style: { color: p.status === 'COMPLETE' ? '#65d66e' : p.status === 'FAILED' ? '#fca5a5' : '#fbbf24', fontSize: 11, fontFamily: "'IBM Plex Mono',monospace" } }, p.status)),
          h('div', { style: { color: '#8da0b4', fontSize: 11, marginTop: 7 } }, 'stage: ' + p.currentStage + ' · source: ' + (p.sourceArtifactId || 'none')),
          p.failure ? h('div', { style: { color: '#fca5a5', fontSize: 11, marginTop: 6 } }, p.failure.stage + ': ' + (p.failure.error || 'failed')) : null,
          h('div', { style: { display: 'flex', gap: 7, marginTop: 10 } }, canOpen ? h('button', { onClick: () => this.openWorldViewer(p.id), style: { border: '1px solid #a78bfa66', background: '#a78bfa16', color: '#c4b5fd', borderRadius: 7, padding: '6px 9px', cursor: 'pointer' } }, 'Open Focus') : null, p.status === 'FAILED' ? h('button', { onClick: () => this.startWorld(p.mode, p.sourceArtifactId), style: { border: '1px solid #f59e0b66', background: 'transparent', color: '#fbbf24', borderRadius: 7, padding: '6px 9px', cursor: 'pointer' } }, 'Retry') : null)
        );
      })
    );
  }

  buildAsset3dWorkspace() {
    const h = React.createElement;
    const s = this.state;
    const SA = this._sourceAsset();
    const picks = SA ? SA.choices(s.runs) : [];
    const selected = s.asset3dSourceArtifact || '';
    if (SA && SA.isImageId(selected) && !picks.some(p => p.id === selected)) {
      picks.unshift({ id: selected, label: selected + ' · chosen in Library' });
    }
    const worker = s.asset3dWorkerStatus;
    const modes = worker && worker.modes ? worker.modes : {};
    const meshReady = modes.mesh && modes.mesh.status === 'PROVEN';
    const texturedReady = modes.textured && modes.textured.status === 'PROVEN';
    const job = s.asset3dJob;
    const artifact = job && Array.isArray(job.artifacts_detail) ? job.artifacts_detail[0] : null;
    const sourcePreview = selected ? s.backendUrl + '/api/images/' + encodeURIComponent(selected) : '';
    const opts = [h('option', { key: '__none', value: '' }, picks.length ? 'Choose a source image…' : 'No canonical images loaded')]
      .concat(picks.map(p => h('option', { key: p.id, value: p.id }, p.label + (p.run && p.run.model ? ' · ' + p.run.model : ''))));
    const statusLine = worker ? `Big Mac: ${worker.remote?.reachable ? worker.remote.identity : 'unavailable'} · runtime ${worker.remote?.runtime ? 'present' : 'missing'} · lease shared with all heavy inference` : 'Loading Big Mac 3D capability status…';
    const chip = (label, item) => h('div', { style: { border: '1px solid rgba(148,163,184,.15)', borderRadius: 7, padding: '8px 10px', background: 'rgba(9,20,32,.55)' } }, h('div', { style: { color: '#8da0b4', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em' } }, label), h('div', { style: { color: item?.status === 'PROVEN' ? '#65d66e' : item?.status === 'DISABLED' ? '#70849a' : '#fbbf24', font: "700 11px 'IBM Plex Mono',monospace", marginTop: 4 } }, item?.status || 'NOT_TESTED'));
    return h('div', { style: { display: 'grid', gap: 14, maxWidth: 1080 } },
      h('div', { style: { background: '#060a10', border: '1px solid rgba(148,163,184,.14)', borderRadius: 12, padding: 16 } },
        h('div', { style: { fontSize: 20, color: '#f0f4f8', fontWeight: 750 } }, '3D'),
        h('div', { style: { color: '#90a4b8', fontSize: 12, lineHeight: 1.5, margin: '4px 0 13px' } }, 'Create individual 3D assets from canonical DexDiffusion images. WorldGen remains the environment and 360 workspace.'),
        h('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(260px,1fr) minmax(180px,280px)', gap: 14, alignItems: 'start' } },
          h('div', null,
            h('div', { style: { color: '#6090a8', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 5 } }, 'Source · canonical image'),
            h('div', { 'data-source-rule': '3d', style: { color: '#8fa3b8', fontSize: 11, lineHeight: 1.5, marginBottom: 6 } }, 'Required. 3D uses exactly the image you choose; the newest result is never substituted.'),
            h('select', { 'aria-label': '3D source image', value: selected, onChange: e => { this.setState({ asset3dSourceArtifact: e.target.value, asset3dPreviewFailedId: '' }); if (SA && SA.isImageId(e.target.value)) this.setActiveAssetSelection({ kind: 'image', id: e.target.value }); }, style: { width: '100%', border: '1px solid rgba(148,163,184,.2)', background: '#091420', color: '#e8f0f7', borderRadius: 7, padding: 8 } }, ...opts),
            sourcePreview ? (s.asset3dPreviewFailedId === selected
              ? h('div', { role: 'status', style: { display: 'grid', placeItems: 'center', width: 150, height: 150, boxSizing: 'border-box', marginTop: 10, padding: 12, border: '1px solid rgba(148,163,184,.2)', borderRadius: 8, background: '#0d1823', color: '#91a2b4', fontSize: 11, lineHeight: 1.45, textAlign: 'center' } }, 'Source preview unavailable. Verify the canonical image in Library before starting a 3D job.')
              : h('img', { src: sourcePreview, alt: 'Selected canonical source preview', onError: () => this.setState({ asset3dPreviewFailedId: selected }), style: { width: 150, height: 150, objectFit: 'cover', borderRadius: 8, marginTop: 10, border: '1px solid rgba(148,163,184,.16)' } })) : null
          ),
          h('div', null,
            h('div', { style: { color: '#6090a8', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 5 } }, 'Mode'),
            h('button', { onClick: () => this.startAsset3d('quick3d'), disabled: s.asset3dLoading, style: { width: '100%', marginBottom: 7, border: '1px solid #38bdf866', background: '#38bdf616', color: '#38bdf8', borderRadius: 7, padding: '9px 10px', cursor: 'pointer', fontWeight: 700, textAlign: 'left' } }, 'Quick Geometry · PLY'),
            h('button', { onClick: () => this.startAsset3d('mesh'), disabled: !meshReady || s.asset3dLoading, style: { width: '100%', marginBottom: 7, border: '1px solid #a78bfa66', background: '#a78bfa16', color: '#c4b5fd', borderRadius: 7, padding: '9px 10px', cursor: meshReady ? 'pointer' : 'not-allowed', fontWeight: 700, textAlign: 'left', opacity: meshReady ? 1 : .5 } }, 'Mesh · GLB'),
            texturedReady ? h('button', { onClick: () => this.startAsset3d('textured'), disabled: s.asset3dLoading, style: { width: '100%', marginBottom: 7, border: '1px solid #65d66e66', background: '#65d66e16', color: '#9ae6a5', borderRadius: 7, padding: '9px 10px', cursor: 'pointer', fontWeight: 700, textAlign: 'left' } }, 'Textured Asset · GLB') : null,
            h('div', { style: { color: '#70849a', fontSize: 11, marginTop: 4 } }, 'PBR: disabled · not proven safe on this 32 GiB machine')
          )
        ),
        h('div', { style: { color: '#70849a', font: "11px 'IBM Plex Mono',monospace", marginTop: 13 } }, statusLine)
      ),
      h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 8 } }, chip('Quick Geometry', modes.quickGeometry), chip('Mesh', modes.mesh), chip('Textured Asset', modes.textured), chip('PBR', modes.pbr)),
      job ? h('div', { style: { background: '#060a10', border: '1px solid rgba(148,163,184,.12)', borderRadius: 10, padding: 13 } },
        h('div', { style: { color: '#e2e8f0', fontWeight: 700 } }, 'Latest 3D job · ' + (job.status || 'QUEUED')),
        h('div', { style: { color: '#8da0b4', fontSize: 11, marginTop: 6 } }, (job.worker_id || job.mode || '3D') + ' · ' + (job.job_id || 'queued')),
        job.error ? h('div', { style: { color: '#fca5a5', fontSize: 11, marginTop: 6 } }, (job.first_failed_gate || 'failed') + ': ' + job.error) : null,
        artifact ? h('div', { style: { display: 'flex', gap: 7, flexWrap: 'wrap', marginTop: 10 } }, h('button', { onClick: () => this.openAsset3dViewer(artifact.artifact_id), style: { border: '1px solid #a78bfa66', background: '#a78bfa16', color: '#c4b5fd', borderRadius: 7, padding: '7px 10px', cursor: 'pointer' } }, 'Open 3D preview'), h('button', { onClick: () => this.openAsset3dInBlender(artifact.artifact_id), style: { border: '1px solid #65d66e66', background: '#65d66e16', color: '#9ae6a5', borderRadius: 7, padding: '7px 10px', cursor: 'pointer' } }, 'Open in Blender'), h('a', { href: artifact.url + '/download', style: { border: '1px solid rgba(148,163,184,.2)', color: '#b8c7d6', borderRadius: 7, padding: '7px 10px', textDecoration: 'none' } }, 'Download GLB')) : null
      ) : null,
      h('div', { style: { color: '#70849a', fontSize: 11 } }, 'Generated assets are canonical MacBook artifacts. Big Mac output is temporary and cleaned after each job.')
    );
  }

  // ── Assets / LoRA (Extra Networks) ────────────────────────────
  async loadAssets() {
    this.setState({ loadingAssets: true });
    try {
      const target = this.state.target || 'flux2-klein-4b';
      const r = await fetch(this.state.backendUrl + '/api/extra-networks?target=' + encodeURIComponent(target), { signal: AbortSignal.timeout(8000) });
      if (r.ok) {
        const d = await r.json();
        // Startup can request the default target before loadModels restores the
        // saved checkpoint. Do not let that slower response replace the newer
        // target-scoped compatibility proof.
        if ((this.state.target || 'flux2-klein-4b') !== target) return;
        this.setState({
          assets: {
            loras: d.loras || [],
            vaes: d.vaes || [],
            embeddings: d.embeddings || { count: 0, items: [], empty_state_message: 'No Textual Inversion embeddings discovered' }
          },
          loadingAssets: false
        });
        if (typeof this._restoreCreateLoraSettings === 'function') this._restoreCreateLoraSettings();
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
  // LoRA selection routes through the canonical Create LoRA picker (state.createLora).
  // The API receives structured body.loras; prompt tags are never authored by the browser.
  insertLora(filename, weight = 0.8) {
    const base = String(filename || '').replace(/\.[^.]+$/, '');
    const options = typeof this._createLoraOptions === 'function' ? this._createLoraOptions() : [];
    const found = options.find(l => (l.filename && l.filename.replace(/\.[^.]+$/, '').toLowerCase() === base.toLowerCase()) || (l.name && l.name.toLowerCase() === base.toLowerCase()) || l.id === filename);
    if (found && typeof this.selectCreateLora === 'function') {
      this.selectCreateLora(found.id);
      if (typeof this.setCreateLoraStrength === 'function') {
        this.setCreateLoraStrength(weight, found.min_weight, found.max_weight);
      }
      this.setState({ createLoras: [] });
      this.toast('Selected adapter ' + found.name + ' · ' + Number(weight).toFixed(2), '#38bdf8');
      return;
    }
    this.toast('Adapter ' + base + ' is not compatible or available with this checkpoint', '#fbbf24');
  }
  insertTriggerPhrase(triggers) {
    const phrase = Array.isArray(triggers) ? triggers[0] : String(triggers || '');
    if (!phrase) return;
    const prompt = this.state.prompt || '';
    const textarea = document.querySelector('textarea[data-dex-field="prompt"]');
    if (textarea && textarea.selectionStart != null && textarea.selectionEnd != null) {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const prefix = prompt.slice(0, start);
      const suffix = prompt.slice(end);
      const sep = prefix.length && !prefix.endsWith(' ') && !prefix.endsWith(', ') ? ', ' : '';
      const nextPrompt = prefix + sep + phrase + (suffix.length && !suffix.startsWith(' ') && !suffix.startsWith(',') ? ', ' : ' ') + suffix;
      this.setState({ prompt: nextPrompt });
      setTimeout(() => {
        textarea.focus();
        const nextPos = start + sep.length + phrase.length;
        textarea.setSelectionRange(nextPos, nextPos);
      }, 20);
    } else {
      const sep = prompt.length && !prompt.endsWith(' ') && !prompt.endsWith(', ') ? ', ' : '';
      this.setState({ prompt: prompt + sep + phrase });
    }
    this.toast('Inserted trigger phrase: ' + phrase, '#65d66e');
  }
  getActiveLoras() {
    const prompt = this.state.prompt || '';
    const re = /<lora:([^:>]+)(?::([0-9.]+))?>/g;
    const loras = [];
    const knownLoras = (this.state.assets && this.state.assets.loras) || (Array.isArray(this.state.loras) ? this.state.loras : []);
    const effective = typeof this.getEffectiveCreateLoras === 'function' ? this.getEffectiveCreateLoras() : [];
    for (const l of effective) {
      loras.push({ name: l.name, weight: l.weight, family: l.family || 'unknown', token: '<lora:' + l.name + ':' + (l.weight != null ? Number(l.weight).toFixed(2) : '1.00') + '>' });
    }
    // Only if no canonical Create adapter is active, check for up to one legacy prompt tag
    if (loras.length === 0) {
      let m;
      while ((m = re.exec(prompt)) !== null) {
        const name = m[1];
        if (loras.some(x => x.name.toLowerCase() === name.toLowerCase())) continue;
        const weight = m[2] != null ? parseFloat(m[2]) : 1.0;
        const found = knownLoras.find(k => (k.name && k.name.toLowerCase() === name.toLowerCase()) || (k.filename && k.filename.replace(/\.[^.]+$/, '').toLowerCase() === name.toLowerCase()));
        let family = found && found.family ? found.family : null;
        if (!family) {
          const lower = name.toLowerCase();
          if (lower.includes('flux2')) family = 'flux2';
          else if (lower.includes('flux')) family = 'flux1';
          else if (lower.includes('pony')) family = 'pony';
          else if (lower.includes('sd15') || lower.includes('sd_1_5') || lower.includes('homofidelis')) family = 'sd15';
          else if (lower.includes('sdxl') || lower.includes('turbo') || lower.includes('photonic')) family = 'sdxl';
          else family = 'unknown';
        }
        loras.push({ name, weight, family, token: m[0] });
        break; // Never silently apply multiple adapters
      }
    }
    return loras;
  }
  getActiveWildcards() {
    const prompt = this.state.prompt || '';
    const re = /__([A-Za-z0-9_-]+)__/g;
    const wcs = [];
    let m;
    while ((m = re.exec(prompt)) !== null) {
      wcs.push({ name: m[1], token: m[0] });
    }
    return wcs;
  }
  setLoraWeight(name, weight) {
    const createLora = this.state.createLora;
    if (createLora && createLora.selectedId) {
      const options = typeof this._createLoraOptions === 'function' ? this._createLoraOptions() : [];
      const sel = options.find(l => l.id === createLora.selectedId);
      if (sel && (sel.name.toLowerCase() === name.toLowerCase() || sel.id.toLowerCase() === name.toLowerCase())) {
        this.setCreateLoraStrength(weight, sel.min_weight, sel.max_weight);
        return;
      }
    }
    const prompt = this.state.prompt || '';
    const w = Number(weight).toFixed(2).replace(/\.?0+$/, '');
    const re = new RegExp('<lora:' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?::[0-9.]+)?\\>', 'g');
    if (re.test(prompt)) {
      const nextPrompt = prompt.replace(re, '<lora:' + name + ':' + w + '>');
      this.setState({ prompt: nextPrompt, createLoras: [] });
    }
  }
  removeLora(token) {
    const named = /^<lora:([^:>]+)/.exec(String(token || ''));
    const name = named ? named[1] : String(token || '');
    const createLora = this.state.createLora;
    if (createLora && (createLora.selectedId || createLora.enabled)) {
      const options = typeof this._createLoraOptions === 'function' ? this._createLoraOptions() : [];
      const sel = options.find(l => l.id === createLora.selectedId);
      if (!token || !sel || sel.name.toLowerCase() === name.toLowerCase() || sel.id.toLowerCase() === name.toLowerCase() || String(token).includes(sel.name)) {
        this.selectCreateLora('');
        this.setState({ createLoras: [] });
        this.toast('Removed adapter' + (sel ? ' ' + sel.name : ''), '#94a3b8');
        return;
      }
    }
    this.setState({ createLoras: [] });
    const prompt = this.state.prompt || '';
    const next = prompt.replace(token, '').replace(/\s{2,}/g, ' ').trim();
    this.setState({ prompt: next });
    this.toast('Removed ' + token, '#94a3b8');
  }
  // Wildcard placement: reorder among the wildcards already in the prompt, or move one between positive and negative.
  // Operations are positional (by occurrence index) so repeated tokens stay unambiguous; only the tokens move, surrounding text is kept.
  _wcMatches(text) { const re = /__([A-Za-z0-9_-]+)__/g, out = []; let m; while ((m = re.exec(text || '')) !== null) out.push({ name: m[1], token: m[0], at: m.index }); return out; }
  getNegWildcards() { return this._wcMatches(this.state.negPrompt); }
  moveWildcard(index, dir) {
    const text = this.state.prompt || '', ms = this._wcMatches(text), a = ms[index], b = ms[index + dir];
    if (!a || !b) return;
    const [lo, hi] = a.at < b.at ? [a, b] : [b, a];
    this.setState({ prompt: text.slice(0, lo.at) + hi.token + text.slice(lo.at + lo.token.length, hi.at) + lo.token + text.slice(hi.at + hi.token.length) });
  }
  moveWildcardAcross(index, toNegative) {
    const from = toNegative ? 'prompt' : 'negPrompt', to = toNegative ? 'negPrompt' : 'prompt';
    const src = this.state[from] || '', m = this._wcMatches(src)[index];
    if (!m) return;
    const rest = (src.slice(0, m.at) + src.slice(m.at + m.token.length)).replace(/\s{2,}/g, ' ').replace(/\s+,/g, ',').replace(/,\s*,/g, ',').replace(/^[,\s]+|[,\s]+$/g, '');
    const dst = this.state[to] || '';
    this.setState({ [from]: rest, [to]: dst.includes(m.token) ? dst : (dst.trim() ? dst.trim() + ', ' : '') + m.token });
    this.toast('Moved ' + m.token + (toNegative ? ' to the negative prompt' : ' to the prompt'), '#38bdf8');
  }
  removeWildcard(token) {
    const prompt = this.state.prompt || '';
    const next = prompt.replace(token, '').replace(/\s{2,}/g, ' ').trim();
    this.setState({ prompt: next });
    this.toast('Removed ' + token, '#94a3b8');
  }
  addTriggerWord(word) {
    if (!word) return;
    this.setState(s => {
      const p = s.prompt ? s.prompt.trim() : '';
      if (p.includes(word)) return {};
      return { prompt: p ? p + ', ' + word : word };
    });
    this.toast('Added trigger: ' + word, '#38bdf8');
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
    const markerCount = (before.match(/__/g) || []).length;
    if (match && markerCount % 2 === 1) {
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
    const { prompt, target, backendUrl, ollamaModel, enhancingPrompt } = this.state;
    if (enhancingPrompt) return;
    if (!prompt.trim()) { this.toast('Write a prompt to enhance first', '#fbbf24'); return; }
    this.setState({ enhancingPrompt: true, enhancementResult: null });
    // The request can be cancelled by the user and times out on its own; the original prompt is never touched until Apply/Append.
    const ctrl = this._enhanceAbort = new AbortController();
    const timeout = AbortSignal.timeout(60000);
    try {
      const r = await fetch(backendUrl + '/api/ollama/enhance', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, target, model: ollamaModel || undefined, save_prompts: !!this.state.savePrompts }),
        signal: AbortSignal.any([ctrl.signal, timeout]),
      });
      if (!r.ok) {
        const failure = await r.json().catch(() => ({}));
        this.setState({ enhancingPrompt: false });
        this.toast(failure.error || ('Enhancement failed (' + r.status + ')'), '#ef4444');
        return;
      }
      const d = await r.json();
      const enhanced = d.enhanced_prompt || d.prompt || d.enhanced;
      if (enhanced) {
        const result = {
          ...d,
          enhanced,
          original: d.original_prompt || d.original || prompt,
          explanation: d.notes || d.explanation || '',
          suggested_settings: d.setting_suggestions || d.suggested_settings || null,
        };
        this.setState({ enhancingPrompt: false, enhancementResult: result });
        this.toast('Enhancement ready for review', '#65d66e');
        setTimeout(() => {
          const rev = document.querySelector('[data-prompt-enhancement-review]');
          if (rev) rev.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 60);
      } else {
        this.setState({ enhancingPrompt: false });
        this.toast('No enhancement returned', '#fbbf24');
      }
    } catch (e) {
      this.setState({ enhancingPrompt: false });
      if (ctrl.signal.aborted) this.toast('Enhance cancelled; your prompt is unchanged', '#94a3b8');
      else if (timeout.aborted) this.toast('Enhance timed out after 60 s; your prompt is unchanged', '#ef4444');
      else this.toast('Enhance failed: ' + e.message, '#ef4444');
    } finally { if (this._enhanceAbort === ctrl) this._enhanceAbort = null; }
  }
  cancelEnhance() { if (this._enhanceAbort) this._enhanceAbort.abort(); }
  applyEnhancement() {
    const { prompt, enhancementResult } = this.state;
    if (!enhancementResult || !enhancementResult.enhanced) return;
    this.setState({
      prompt: enhancementResult.enhanced,
      previousPrompt: prompt,
      enhancementResult: null
    });
    this.toast('Prompt updated (Undo available)', '#65d66e');
  }
  appendEnhancement() {
    const { prompt, enhancementResult } = this.state;
    if (!enhancementResult || !enhancementResult.enhanced) return;
    this.setState({
      prompt: (prompt ? prompt + '\n\n' : '') + enhancementResult.enhanced,
      previousPrompt: prompt,
      enhancementResult: null
    });
    this.toast('Prompt appended (Undo available)', '#65d66e');
  }
  undoEnhancement() {
    const { previousPrompt } = this.state;
    if (previousPrompt != null) {
      this.setState({ prompt: previousPrompt, previousPrompt: null });
      this.toast('Restored previous prompt', '#38bdf8');
    }
  }
  dismissEnhancement() {
    this.setState({ enhancementResult: null });
  }
  async enhanceNegativePrompt() {
    const { negPrompt, target, backendUrl, ollamaModel, enhancingNegPrompt } = this.state;
    if (enhancingNegPrompt) return;
    if (!negPrompt || !negPrompt.trim()) { this.toast('Write a negative prompt to enhance first', '#fbbf24'); return; }
    const requestSnapshot = { prompt: negPrompt, target };
    this._pendingNegEnhancement = requestSnapshot;
    this.setState({ enhancingNegPrompt: true, negEnhancementResult: null });
    const ctrl = this._enhanceNegAbort = new AbortController();
    const timeout = AbortSignal.timeout(60000);
    try {
      const r = await fetch(backendUrl + '/api/ollama/enhance', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ negative_prompt: negPrompt, field: 'negative', target, model: ollamaModel || undefined, save_prompts: !!this.state.savePrompts }),
        signal: AbortSignal.any([ctrl.signal, timeout]),
      });
      if (!r.ok) {
        const failure = await r.json().catch(() => ({}));
        this.setState({ enhancingNegPrompt: false });
        this.toast(failure.error || ('Negative enhancement failed (' + r.status + ')'), '#ef4444');
        return;
      }
      const d = await r.json();
      const enhanced = d.enhanced_prompt || d.negative_prompt || d.enhanced;
      if (enhanced) {
        // Protect against stale draft or target changes while fetch was in flight
        if (this.state.target !== requestSnapshot.target) {
          this.setState({ enhancingNegPrompt: false, negEnhancementResult: null });
          this.toast('Negative enhancement discarded: model target changed', '#fbbf24');
          return;
        }
        const isDraftModified = this.state.negPrompt !== requestSnapshot.prompt;
        const result = {
          ...d,
          enhanced,
          original: requestSnapshot.prompt,
          explanation: d.notes || d.explanation || '',
          isStale: isDraftModified,
          staleWarning: isDraftModified ? 'Draft edited while enhancing (original: "' + requestSnapshot.prompt.slice(0, 40) + '…")' : null
        };
        this.setState({ enhancingNegPrompt: false, negEnhancementResult: result });
        this.toast(isDraftModified ? 'Negative enhancement ready (draft was edited in progress)' : 'Negative enhancement ready for review', isDraftModified ? '#fbbf24' : '#65d66e');
        setTimeout(() => {
          const rev = document.querySelector('[data-negative-enhancement-review]');
          if (rev) rev.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 60);
      } else {
        this.setState({ enhancingNegPrompt: false });
        this.toast('No negative enhancement returned', '#fbbf24');
      }
    } catch (e) {
      this.setState({ enhancingNegPrompt: false });
      if (ctrl.signal.aborted) this.toast('Negative enhance cancelled; prompt unchanged', '#94a3b8');
      else if (timeout.aborted) this.toast('Negative enhance timed out after 60 s; prompt unchanged', '#ef4444');
      else this.toast('Negative enhance failed: ' + e.message, '#ef4444');
    } finally {
      if (this._enhanceNegAbort === ctrl) this._enhanceNegAbort = null;
      this._pendingNegEnhancement = null;
    }
  }
  cancelNegEnhance() {
    if (this._enhanceNegAbort) this._enhanceNegAbort.abort();
    this.setState({ enhancingNegPrompt: false });
  }
  applyNegEnhancement() {
    const { negPrompt, negEnhancementResult } = this.state;
    if (!negEnhancementResult || !negEnhancementResult.enhanced) return;
    this.setState({
      negPrompt: negEnhancementResult.enhanced,
      previousNegPrompt: negPrompt,
      negEnhancementResult: null
    });
    this.toast('Negative prompt updated (Undo available)', '#65d66e');
  }
  appendNegEnhancement() {
    const { negPrompt, negEnhancementResult } = this.state;
    if (!negEnhancementResult || !negEnhancementResult.enhanced) return;
    this.setState({
      negPrompt: (negPrompt ? negPrompt + ', ' : '') + negEnhancementResult.enhanced,
      previousNegPrompt: negPrompt,
      negEnhancementResult: null
    });
    this.toast('Negative prompt appended (Undo available)', '#65d66e');
  }
  undoNegEnhancement() {
    const { previousNegPrompt } = this.state;
    if (previousNegPrompt != null) {
      this.setState({ negPrompt: previousNegPrompt, previousNegPrompt: null });
      this.toast('Restored previous negative prompt', '#38bdf8');
    }
  }
  dismissNegEnhancement() {
    this.setState({ negEnhancementResult: null });
  }
  insertNegWildcard(name) {
    const token = '__' + name + '__';
    const negPrompt = this.state.negPrompt || '';
    const textarea = document.querySelector('textarea[data-dex-field="negative-prompt"]');
    if (textarea && textarea.selectionStart != null && textarea.selectionEnd != null) {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const prefix = negPrompt.slice(0, start);
      const suffix = negPrompt.slice(end);
      const sep = prefix.length && !prefix.endsWith(' ') && !prefix.endsWith(', ') ? ', ' : '';
      const nextNeg = prefix + sep + token + (suffix.length && !suffix.startsWith(' ') && !suffix.startsWith(',') ? ', ' : ' ') + suffix;
      this.setState({ negPrompt: nextNeg, showNegWildcards: false });
    } else {
      const sep = negPrompt.length && !negPrompt.endsWith(' ') && !negPrompt.endsWith(', ') ? ', ' : '';
      this.setState({ negPrompt: negPrompt + sep + token, showNegWildcards: false });
    }
    this.toast('Inserted ' + token + ' into negative prompt', '#65d66e');
  }
  applySuggestedSettings(settings) {
    if (!settings) return;
    const patch = {};
    if (settings.steps) patch.steps = settings.steps;
    if (settings.cfg != null) patch.cfg = settings.cfg;
    if (settings.sampler) patch.sampler = settings.sampler;
    this.setState(patch);
    this.toast('Applied settings: ' + Object.entries(patch).map(([k,v])=>k+'='+v).join(', '), '#65d66e');
  }

  // ── Job status helpers ────────────────────────────────────────
  // The real backend reports terminal jobs as PASS / PARTIAL / FAIL (not
  // done/error/failed). Treat anything that is not queued/running as finished.
  // Job status vocabulary differs by store: the controlled pipeline uses lowercase
  // (queued/running) while the durable job store uses uppercase (QUEUED/RUNNING).
  // Comparing one spelling made a live RUNNING generic job look finished, so a
  // reload adopted it as a failure and dropped its Cancel. Normalize first.
  _jobTerminal(s) {
    const v = String(s == null ? '' : s).toUpperCase();
    return !!v && v !== 'QUEUED' && v !== 'RUNNING' && v !== 'PENDING' && v !== 'STARTING' && v !== 'PREPARING' && v !== 'TRANSFERRING';
  }
  _jobOk(s) {
    const v = String(s == null ? '' : s).toUpperCase();
    return v === 'PASS' || v === 'PARTIAL' || v === 'DONE' || v === 'COMPLETE' || v === 'COMPLETED' || v === 'SUCCEEDED';
  }
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
  _startPoll(jobId, onComplete, onTick) {
    clearInterval(this._pollTimer);
    const generation = this._pollGeneration = (this._pollGeneration || 0) + 1;
    let busy = false, failures = 0;
    this._pollTimer = setInterval(async () => {
      if (busy) return;
      busy = true;
      try {
        const r = await fetch(this.state.backendUrl + '/api/jobs/' + jobId, { signal: AbortSignal.timeout(3000) });
        if (!r.ok) throw new Error(r.status === 404 ? 'Job not found (console restarted?)' : 'Job status request failed: HTTP ' + r.status);
        const job = await r.json();
        if (this._pollGeneration !== generation) return;
        failures = 0;
        const stage = job.stage || { label: 'Running', percent: null, determinate: false };
        this.setState({ jobStage: stage, progress: stage.determinate ? stage.percent : null });
        if (onTick && !this._jobTerminal(job.status)) { try { onTick(job); } catch (_) {} }
        if (this._jobTerminal(job.status)) {
          clearInterval(this._pollTimer);
          onComplete(job);
        }
      } catch (e) {
        if (this._pollGeneration !== generation) return;
        if (++failures >= 5) {
          clearInterval(this._pollTimer);
          onComplete({ id: jobId, status: 'FAIL', firstFailedGate: 'polling', error: e.message });
        }
      } finally { busy = false; }
    }, 900);
  }

  setVersion(v) { try { localStorage.setItem('dex_version', String(v)); } catch {} this.setState({ version: v }); }
  setScreen(s, opts) {
    // V2 has no Workstation destination (the palette still lists it): land on Create, the V2 home, instead of an unrendered screen.
    if (this.state.version === 2 && s === 'workstation') s = 'create';
    // The Chat leaf exists only in the opt-in masters layout of V2.
    if (s === 'chat' && !(this.state.version === 2 && this.state.studioLayout === 'masters')) s = 'create';
    if (this._pendingWorkspaceNavigation && !(opts && opts.skipUnsavedGuard)) return false;
    if (!(opts && opts.skipUnsavedGuard) && !this._confirmWorkspaceLeave(s)) return false;
    const { version, screens } = this.state;
    const from = screens[version];
    this._workspaceScrollPositions = this._workspaceScrollPositions || {};
    if (from) {
      const activePane = document.querySelector('[data-scroll-pane]');
      if (activePane) this._workspaceScrollPositions[from] = activePane.scrollTop;
    }
    try { sessionStorage.setItem(version === 4 ? 'dex_concept_screen' : 'dex_screen', s); } catch {}
    const Nav = window.DexStudioNav;
    if (version !== 4 && Nav) Nav.rememberLeaf(s, sessionStorage);
    const navPatch = version === 2 && this.state.studioLayout === 'masters' ? { navReturnTo: this._nextReturnTo(from, s, opts) } : {};
    let subroute = null;
    if (version === 2 && Nav && this.state.studioLayout === 'masters') {
      try { subroute = Nav.resolveSubroute(opts && opts.subroute || sessionStorage.getItem(Nav.SUBROUTE_KEY), s); } catch (_) {}
      if (opts && opts.subroute && subroute) { try { sessionStorage.setItem(Nav.SUBROUTE_KEY, subroute); } catch (_) {} }
    }
    this.setState({ screens: { ...screens, [version]: s }, studioSubroute: subroute, ...navPatch });
    try { const menu = document.querySelector('[data-studio-mobile-nav]'); if (menu) menu.open = false; } catch (_) {}
    if (s === 'chat' && from !== 'chat') this.loadChatAvailability();
    // Category navigation must present the selected screen immediately.
    // On rapid transitions the global rAF batcher can leave the previous
    // module visible even though route state has changed. Reconcile this
    // explicit user action synchronously; background updates remain batched.
    if (version === 2 && typeof this.__render === 'function') this.__render();
    const targetScroll = this._workspaceScrollPositions[s];
    if (typeof targetScroll === 'number') {
      requestAnimationFrame(() => {
        const nextPane = document.querySelector('[data-scroll-pane]');
        if (nextPane) nextPane.scrollTop = targetScroll;
      });
    }
    if (opts && opts.focusNav) this._focusNav(opts.focusNav);
    return true;
  }

  // ── Unified Studio masters layout (opt-in; the flat chip row stays the default) ──────────
  setStudioLayout(layout) {
    if (this.state.version !== 2 || !['flat', 'masters'].includes(layout)) return false;
    try { localStorage.setItem('dex_studio_layout', layout); } catch (_) { this.toast('Could not save Studio layout preference.', '#fca5a5'); return false; }
    const screens = { ...this.state.screens };
    if (layout === 'flat' && screens[2] === 'chat') { screens[2] = 'create'; try { sessionStorage.setItem('dex_screen', 'create'); } catch (_) {} }
    this._navMastersKey = null;
    this._navChipsKey = null;
    this.setState({ studioLayout: layout, screens, navReturnTo: null });
    return true;
  }
  // Area of a leaf: its master, or its utility for Library/Models/System.
  _navArea(leaf) { const Nav = window.DexStudioNav; return Nav ? (Nav.masterOf(leaf) || Nav.utilityOf(leaf) || null) : null; }
  // A programmatic jump into another area (Library → Edit, 3D → World, key L, palette) records where it came from;
  // navigating with the bars themselves, or going back, clears it.
  _nextReturnTo(from, to, opts) {
    if (opts && (opts.source === 'nav' || opts.source === 'return')) return null;
    if (!from || from === to || this._navArea(from) === this._navArea(to)) return this.state.navReturnTo;
    return { leaf: from };
  }
  selectStudioMaster(id) {
    const Nav = window.DexStudioNav;
    if (!Nav) return false;
    const current = this.state.screens[this.state.version];
    if (Nav.masterOf(current) === id) return this._focusNav('master');
    return this.setScreen(Nav.lastLeafFor(id, sessionStorage), { source: 'nav', focusNav: 'master' });
  }
  selectStudioLeaf(id) { return this.setScreen(id, { source: 'nav', focusNav: 'leaf' }); }
  selectStudioSubroute(id) {
    const Nav = window.DexStudioNav;
    const route = Nav && Object.values(Nav.SUBROUTES).flat().find(r => r.id === id);
    if (!route) return false;
    const ok = this.setScreen(route.leaf, { source: 'nav', focusNav: 'leaf', subroute: id });
    if (ok && route.tab && typeof this.vpSet === 'function') this.vpSet({ tab: route.tab });
    if (ok && id === 'history') setTimeout(() => { const el = document.querySelector('[data-chat-history-credential]'); if (el) el.focus(); }, 0);
    return ok;
  }
  selectStudioUtility(id) {
    const Nav = window.DexStudioNav;
    const u = Nav && Nav.UTILITIES.find(x => x.id === id);
    if (!u) return false;
    if (u.drawer) { const center = window.__DEX_V12; if (center && typeof center.toggleJobCenter === 'function') center.toggleJobCenter(); else this.toast('Job Center is initializing. Try again in a moment.', '#fbbf24'); return true; }
    return this.setScreen(u.leaf, { source: 'nav', focusNav: 'utility' });
  }
  navReturn() {
    const back = this.state.navReturnTo;
    if (!back) return false;
    return this.setScreen(back.leaf, { source: 'return', focusNav: 'leaf' });
  }
  // Bars are rebuilt when the screen changes; keep keyboard focus on the control the user operated.
  _focusNav(which) {
    try {
      const sel = which === 'master' ? '[data-master-tab][aria-selected="true"]' : which === 'utility' ? '[data-studio-utility][aria-current="page"]' : '[data-subnav-leaf][aria-current="page"]';
      const el = document.querySelector(sel) || document.querySelector('[data-master-tab][tabindex="0"]');
      if (el && el.focus) el.focus({ preventScroll: true });
    } catch (_) {}
    return true;
  }
  // Roving focus inside one bar: Arrow keys, Home and End move focus; Enter or Space activates.
  onStudioBarKeyDown(e, selector) {
    const keys = ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(e.key)) return;
    const items = [...document.querySelectorAll(selector)];
    const i = items.indexOf(document.activeElement);
    if (i < 0 || !items.length) return;
    e.preventDefault();
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (i + ((e.key === 'ArrowRight' || e.key === 'ArrowDown') ? 1 : -1) + items.length) % items.length;
    items.forEach((el, k) => el.setAttribute('tabindex', k === next ? '0' : '-1'));
    items[next].focus();
  }

  // Chat text stays in process memory on the server and this mounted component only.
  async _chatJson(path, method, body) {
    const headers = method === 'GET' ? {} : { 'Content-Type': 'application/json', 'X-Dex-Request': '1' };
    if (this.state.chatHistoryCredential) headers.Authorization = 'Bearer ' + this.state.chatHistoryCredential;
    const r = await fetch(this.state.backendUrl + path, {
      method, headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let value = null;
    if (r.status !== 204) { try { value = await r.json(); } catch (_) {} }
    if (!r.ok) throw new Error(value && value.error || `HTTP ${r.status}`);
    return value;
  }

  async refreshChatSession(id = this.state.chatSessionId) {
    if (!id) return;
    try {
      const session = await this._chatJson('/api/chat/sessions/' + encodeURIComponent(id), 'GET');
      if (this.state.chatSessionId === id) this.setState({ chatMessages: session.messages || [], chatSessionMode: session.mode });
    } catch (e) { this.setState({ chatError: e.message }); }
  }

  async newChat() {
    if (this.state.chatRunning) return;
    if (this.state.chatDraft.trim() && !window.confirm('Discard the unsent Chat draft?')) return;
    const oldId = this.state.chatSessionId;
    if (oldId && this.state.chatSessionMode === 'temporary') {
      try { await this._chatJson('/api/chat/sessions/' + encodeURIComponent(oldId), 'DELETE'); }
      catch (e) { this.setState({ chatError: 'Could not discard the current session: ' + e.message }); return; }
    }
    this.setState({ chatSessionId: null, chatSessionMode: 'temporary', chatSaveNext: false, chatMessages: [], chatDraft: '', chatStreamText: '', chatStatus: '', chatError: '' });
  }

  async loadSavedChats() {
    if (!this.state.chatHistoryCredential) {
      this.setState({ chatSavedSessions: [], chatSavedSessionsLoaded: false, chatHistoryStatus: 'Enter your saved-history credential to unlock.' });
      return;
    }
    try {
      const value = await this._chatJson('/api/chat/sessions', 'GET');
      this.setState({ chatSavedSessions: Array.isArray(value.sessions) ? value.sessions : [], chatSavedSessionsLoaded: true, chatHistoryStatus: 'Saved history unlocked for this tab.' });
    } catch (e) { this.setState({ chatSavedSessions: [], chatSavedSessionsLoaded: false, chatHistoryStatus: 'Saved history unavailable: ' + e.message }); }
  }

  async openSavedChat(id) {
    if (this.state.chatRunning) return;
    if (this.state.chatDraft.trim() && !window.confirm('Discard the unsent Chat draft?')) return;
    try {
      const session = await this._chatJson('/api/chat/sessions/' + encodeURIComponent(id), 'GET');
      if (session.mode !== 'saved') throw new Error('not-a-saved-session');
      if (this.state.chatSessionId && this.state.chatSessionMode === 'temporary')
        await this._chatJson('/api/chat/sessions/' + encodeURIComponent(this.state.chatSessionId), 'DELETE');
      this.setState({ chatSessionId: id, chatSessionMode: 'saved', chatMessages: session.messages || [], chatModel: session.model,
        chatDraft: '', chatStreamText: '', chatError: '', chatStatus: 'Saved conversation opened.' });
    } catch (e) { this.setState({ chatError: e.message }); }
  }

  async exportChat() {
    const id = this.state.chatSessionId;
    if (!id || this.state.chatSessionMode !== 'saved' || this.state.chatRunning) return;
    try {
      const format = this.state.chatExportFormat;
      const path = '/api/chat/sessions/' + encodeURIComponent(id) + '/export?format=' + format;
      const headers = { Authorization: 'Bearer ' + this.state.chatHistoryCredential };
      const response = await fetch(this.state.backendUrl + path, { headers });
      if (!response.ok) { const error = await response.json().catch(() => null); throw new Error(error && error.error || `HTTP ${response.status}`); }
      const url = URL.createObjectURL(await response.blob());
      const a = document.createElement('a');
      a.href = url; a.download = 'dexdiffusion-chat-' + id + '.' + format;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      this.setState({ chatStatus: 'Export download requested.' });
    } catch (e) { this.setState({ chatError: e.message }); }
  }

  async deleteChat() {
    const id = this.state.chatSessionId;
    if (!id || this.state.chatRunning) return;
    if (!window.confirm(`Delete this ${this.state.chatSessionMode} conversation? This cannot be undone.`)) return;
    try {
      await this._chatJson('/api/chat/sessions/' + encodeURIComponent(id), 'DELETE');
      this.setState({ chatSessionId: null, chatSessionMode: 'temporary', chatMessages: [], chatStreamText: '', chatStatus: 'Conversation deleted.', chatError: '' });
      this.loadSavedChats();
    } catch (e) { this.setState({ chatError: e.message }); }
  }

  async sendChat(regenerateOf = null) {
    if (this.state.chatRunning || this.state.chatAvailability.feature !== 'activated') return;
    const content = this.state.chatDraft.trim();
    if (!regenerateOf && !content) return;
    const client = window.DexChatClient;
    if (!client) { this.setState({ chatError: 'Chat transport unavailable.' }); return; }
    let id = this.state.chatSessionId;
    let completed = false;
    this._chatPendingDelta = '';
    this.setState({ chatRunning: true, chatStreamText: '', chatError: '', chatStatus: 'Connecting…', chatJobId: null });
    const flushDelta = () => {
      this._chatDeltaTimer = null;
      const text = this._chatPendingDelta;
      this._chatPendingDelta = '';
      if (text) this.setState(s => ({ chatStreamText: s.chatStreamText + text }));
    };
    try {
      if (!id) {
        const mode = this.state.chatSaveNext ? 'saved' : 'temporary';
        const session = await this._chatJson('/api/chat/sessions', 'POST', { mode, model: this.state.chatModel, ...(mode === 'saved' ? { consent: true } : {}) });
        id = session.session_id;
        this.setState({ chatSessionId: id, chatSessionMode: mode });
        if (mode === 'saved') this.loadSavedChats();
      }
      const requestId = client.requestId();
      const body = regenerateOf
        ? { session_id: id, request_id: requestId, action: 'regenerate', regenerate_of: regenerateOf, model: this.state.chatModel }
        : { session_id: id, request_id: requestId, action: 'send', content, model: this.state.chatModel };
      this._chatAbort = new AbortController();
      const response = await fetch(this.state.backendUrl + '/api/ollama/chat/stream', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Dex-Request': '1', ...(this.state.chatHistoryCredential ? { Authorization: 'Bearer ' + this.state.chatHistoryCredential } : {}) },
        body: JSON.stringify(body), signal: this._chatAbort.signal,
      });
      await client.readSse(response, ({ event, payload }) => {
        if (payload.request_id !== requestId || payload.session_id !== id) throw new Error('chat-event-mismatch');
        if (payload.job_id) this.setState({ chatJobId: payload.job_id });
        if (event === 'queued') this.setState({ chatStatus: `Queued${Number.isInteger(payload.position) ? ' · position ' + payload.position : ''}` });
        else if (event === 'started') this.setState({ chatStatus: 'Generating…' });
        else if (event === 'delta') {
          this._chatPendingDelta += payload.text;
          if (!this._chatDeltaTimer) this._chatDeltaTimer = setTimeout(flushDelta, 80);
        }
        else if (event === 'done') { completed = true; this.setState({ chatStatus: 'Complete' }); }
        else if (event === 'stopped') this.setState({ chatStatus: payload.stop === 'verified' ? 'Stopped · verified' : 'Stop requested · verification pending' });
        else if (event === 'error') this.setState({ chatStatus: 'Failed', chatError: payload.code || 'stream-error' });
      });
    } catch (e) {
      // A transport loss is not a verified Stop. The draft remains available; the session refresh shows any accepted user turn.
      this.setState({ chatError: e.message, chatStatus: 'Connection ended · completion unverified' });
    } finally {
      if (this._chatDeltaTimer) clearTimeout(this._chatDeltaTimer);
      flushDelta();
      this._chatAbort = null;
      this.setState({ chatRunning: false, chatJobId: null, chatStreamText: '' });
      if (id) await this.refreshChatSession(id);
      if (completed && !regenerateOf && this.state.chatDraft === content) this.setState({ chatDraft: '' });
      if (id && this.state.chatSessionMode === 'saved') this.loadSavedChats();
    }
  }

  async stopChat() {
    if (!this.state.chatRunning) return;
    this.setState({ chatStatus: 'Stop requested · verification pending' });
    if (this.state.chatJobId) {
      try {
        const result = await this._chatJson('/api/jobs/' + encodeURIComponent(this.state.chatJobId) + '/cancel', 'POST', { reason: 'Stopped by user' });
        if (result && (result.remote_stop === 'verified' || result.remote_stop === 'not_started')) this.setState({ chatStatus: 'Stopped · verified' });
      } catch (e) {
        if (this._chatAbort) this._chatAbort.abort();
        this.setState({ chatError: 'Stop confirmation failed: ' + e.message });
      }
    } else if (this._chatAbort) this._chatAbort.abort();
  }

  handoffChatToCreate(messageId, mode = 'replace') {
    const m = this.state.chatMessages.find(x => x.message_id === messageId && x.role === 'assistant' && x.status === 'complete');
    if (!m || !m.content.trim() || !['replace', 'append'].includes(mode)) return false;
    const existing = this.state.prompt.trim();
    if (mode === 'replace' && existing && !window.confirm('Replace the current Create prompt with this Chat reply?')) return false;
    if (!this.setScreen('create')) return false;
    this.setState({ prompt: mode === 'append' && existing ? existing + '\n\n' + m.content : m.content });
    this.toast('Chat text copied to Create. Review it before generating.', '#86efac');
    return true;
  }

  async loadChatAvailability() {
    if (this._chatAvailabilityInFlight) return this._chatAvailabilityInFlight;
    this.setState({ chatAvailability: { ...this.state.chatAvailability, phase: 'checking' } });
    const base = this.state.backendUrl || '';
    const get = async url => { try { const r = await fetch(base + url, { signal: AbortSignal.timeout(8000) }); let body = null; try { body = await r.json(); } catch (_) {} return { status: r.status, body }; } catch (_) { return { status: 0, body: null }; } };
    this._chatAvailabilityInFlight = (async () => {
      const [status, models] = await Promise.all([get('/api/ollama/status'), get('/api/chat/models')]);
      const ollama = status.status === 200 && status.body && Array.isArray(status.body.models) ? 'available' : 'failed';
      const feature = models.status === 404 && models.body && models.body.error === 'chat-disabled' ? 'not_activated' : models.status === 200 ? 'activated' : 'unknown';
      const installed = models.status === 200 && models.body && Array.isArray(models.body.models) ? models.body.models.filter(m => m.installed) : [];
      this.setState({ chatAvailability: { phase: 'done', ollama, feature, checkedAt: Date.now() }, chatModels: installed,
        chatModel: installed.some(m => m.name === this.state.chatModel) ? this.state.chatModel : (installed[0] && installed[0].name || this.state.chatModel) });
      if (feature === 'activated') this.loadSavedChats();
    })().finally(() => { this._chatAvailabilityInFlight = null; });
    return this._chatAvailabilityInFlight;
  }
  buildChatPlaceholder() {
    const h = React.createElement;
    const a = this.state.chatAvailability || {};
    const checking = a.phase !== 'done';
    const row = (key, label, value, tone) => h('div', { 'data-chat-status': key, style: { display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', border: '1px solid rgba(148,163,184,.2)', borderRadius: 8, padding: '7px 10px', background: 'rgba(148,163,184,.05)' } },
      h('span', { style: { color: '#cbd5e1', fontWeight: 600, fontSize: 12 } }, label), h('span', { 'data-chat-state': value.state, style: { color: tone, fontWeight: 700, fontSize: 12 } }, value.text));
    const conn = checking ? { state: 'checking', text: 'Checking…' } : a.ollama === 'available' ? { state: 'available', text: 'Ollama connection available' } : { state: 'failed', text: 'Connection failed: Chat needs the managed Ollama tunnel on 127.0.0.1:11436' };
    const feat = checking ? { state: 'checking', text: 'Checking…' } : a.feature === 'not_activated' ? { state: 'not_activated', text: 'Chat feature not activated' } : a.feature === 'activated' ? { state: 'activated', text: 'Chat backend switched on' } : { state: 'unknown', text: 'Chat feature state could not be read' };
    const ready = a.feature === 'activated' && a.ollama === 'available' && this.state.chatModels.length > 0;
    const messages = this.state.chatMessages || [];
    const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant' && m.status === 'complete');

    return h('section', {
      'data-chat-workspace': 'true',
      'aria-labelledby': 'dex-chat-title',
      style: { width: '100%', maxWidth: 880, margin: '0 auto', display: 'flex', flexDirection: 'column', flex: 1, minHeight: '100%', gap: 10, padding: '12px 0 0' }
    },
      // Compact top bar: Title + Model select + Quick actions
      h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
          h('h2', { id: 'dex-chat-title', style: { margin: 0, fontSize: 18, fontWeight: 750, color: '#f8fafc' } }, 'Chat'),
          h('span', {
            style: {
              display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, borderRadius: 999, padding: '2px 8px',
              background: ready ? 'rgba(101,214,110,.12)' : 'rgba(251,191,36,.12)',
              color: ready ? '#86efac' : '#fcd34d', border: '1px solid ' + (ready ? 'rgba(101,214,110,.3)' : 'rgba(251,191,36,.3)')
            }
          }, ready ? ('● ' + (this.state.chatModel || 'Ready')) : checking ? '● Checking…' : '● Offline')
        ),
        h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' } },
          h('label', { style: { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#94a3b8' } },
            'Model',
            h('select', { 'data-chat-model': 'true', value: this.state.chatModel, disabled: !ready || this.state.chatRunning, onChange: e => this.setState({ chatModel: e.target.value }), style: { border: '1px solid rgba(148,163,184,.25)', background: '#111722', color: '#f8fafc', borderRadius: 6, padding: '3px 8px', fontSize: 11 } },
              this.state.chatModels.map(m => h('option', { key: m.name, value: m.name }, m.name)))
          ),
          h('button', { type: 'button', 'data-chat-refresh': 'true', onClick: () => this.loadChatAvailability(), disabled: checking && a.phase === 'checking', style: { border: '1px solid rgba(148,163,184,.25)', background: 'transparent', color: '#cbd5e1', borderRadius: 6, padding: '3px 8px', fontSize: 11, cursor: 'pointer' } }, 'Check again'),
          h('button', { type: 'button', 'data-chat-new': 'true', onClick: () => this.newChat(), disabled: this.state.chatRunning, style: { border: '1px solid rgba(56,189,248,.35)', background: 'rgba(56,189,248,.1)', color: '#38bdf8', borderRadius: 6, padding: '3px 9px', fontSize: 11, cursor: 'pointer', fontWeight: 600 } }, 'New temporary chat'),
          h('button', { type: 'button', 'data-chat-delete': 'true', onClick: () => this.deleteChat(), disabled: !this.state.chatSessionId || this.state.chatRunning, style: { border: '1px solid rgba(239,68,68,.3)', background: 'transparent', color: '#fca5a5', borderRadius: 6, padding: '3px 8px', fontSize: 11, cursor: 'pointer' } }, 'Delete chat'),
          h('button', { type: 'button', 'data-chat-export': 'true', onClick: () => this.exportChat(), disabled: this.state.chatSessionMode !== 'saved' || !this.state.chatSessionId || this.state.chatRunning, style: { border: '1px solid rgba(148,163,184,.25)', background: 'transparent', color: '#cbd5e1', borderRadius: 6, padding: '3px 8px', fontSize: 11, cursor: 'pointer' } }, 'Export saved chat')
        )
      ),
      h('p', { style: { margin: 0, color: '#aab4c3', fontSize: 12, lineHeight: 1.5 } }, 'Temporary local conversation. Closing or reloading this page loses access to it; it is not saved in browser storage.'),
      // Collapsible status / credentials panel
      h('details', { 'data-chat-settings-details': 'true', open: true, style: { border: '1px solid rgba(148,163,184,.14)', borderRadius: 7, padding: '6px 10px', background: 'rgba(15,23,42,.35)' } },
        h('summary', { style: { fontSize: 11, color: '#94a3b8', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
          h('span', { style: { fontWeight: 600 } }, '⚙ Connection & Saved History Settings'),
          h('span', { style: { fontSize: 10, color: '#64748b' } }, 'click to collapse/expand')
        ),
        h('div', { style: { display: 'grid', gap: 6, marginTop: 8 } },
          h('div', { role: 'status', 'aria-live': 'polite', style: { display: 'grid', gap: 5 } },
            row('connection', 'Ollama', conn, conn.state === 'available' ? '#86efac' : conn.state === 'failed' ? '#fca5a5' : '#cbd5e1'),
            row('feature', 'Chat feature', feat, '#fcd34d'),
            row('generation', 'Chat generation', { state: ready ? 'ready' : 'unavailable', text: ready ? 'Ready for a temporary session' : 'Unavailable until Chat is enabled and an approved model is installed' }, ready ? '#86efac' : '#fcd34d')),
          h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end', marginTop: 2 } },
            h('label', { style: { display: 'grid', gap: 3, flex: '1 1 200px', fontSize: 11, color: '#cbd5e1' } }, 'Saved-history credential (kept in this tab only)',
              h('input', { type: 'password', 'data-chat-history-credential': 'true', value: this.state.chatHistoryCredential, autoComplete: 'off', onInput: e => this.setState({ chatHistoryCredential: e.target.value, chatSavedSessionsLoaded: false, chatSavedSessions: [], chatSaveNext: false }), style: { border: '1px solid rgba(148,163,184,.25)', background: '#111722', color: '#f8fafc', borderRadius: 5, padding: '4px 8px', fontSize: 11 } })),
            h('button', { type: 'button', 'data-chat-history-unlock': 'true', disabled: !this.state.chatHistoryCredential, onClick: () => this.loadSavedChats(), style: { border: '1px solid rgba(148,163,184,.3)', background: 'rgba(255,255,255,.05)', color: '#cbd5e1', borderRadius: 5, padding: '5px 10px', fontSize: 11, cursor: 'pointer' } }, 'Unlock saved history'),
            h('label', { style: { fontSize: 11, color: '#cbd5e1', display: 'flex', alignItems: 'center', gap: 4 } }, 'Export format ',
              h('select', { 'data-chat-export-format': 'true', value: this.state.chatExportFormat, onChange: e => this.setState({ chatExportFormat: e.target.value }), style: { border: '1px solid rgba(148,163,184,.25)', background: '#111722', color: '#f8fafc', borderRadius: 5, padding: '3px 6px', fontSize: 11 } },
                h('option', { value: 'json' }, 'JSON'), h('option', { value: 'md' }, 'Markdown')))),
          h('div', { role: 'status', 'data-chat-history-status': 'true', style: { fontSize: 11, color: '#94a3b8' } }, this.state.chatHistoryStatus),
          h('label', { style: { display: 'flex', gap: 6, alignItems: 'center', fontSize: 11, color: '#cbd5e1' } },
            h('input', { type: 'checkbox', 'data-chat-save-next': 'true', checked: this.state.chatSaveNext, disabled: !!this.state.chatSessionId || this.state.chatRunning || !this.state.chatSavedSessionsLoaded,
              onChange: e => this.setState({ chatSaveNext: e.target.checked }) }), 'Save the next conversation privately on this Mac (explicit opt-in)'),
          this.state.chatSavedSessions.length > 0 && h('label', { style: { display: 'grid', gap: 3, fontSize: 11, color: '#cbd5e1' } }, 'Saved conversations',
            h('select', { 'data-chat-saved-list': 'true', value: '', disabled: this.state.chatRunning, onChange: e => { if (e.target.value) this.openSavedChat(e.target.value); }, style: { border: '1px solid rgba(148,163,184,.25)', background: '#111722', color: '#f8fafc', borderRadius: 5, padding: '4px 8px', fontSize: 11 } },
              h('option', { value: '' }, 'Choose a saved conversation'),
              this.state.chatSavedSessions.map(s => h('option', { key: s.session_id, value: s.session_id }, `${s.created_at} · ${s.model} · ${s.message_count} messages`))))
        )
      ),
      // Transcript messages
      h('div', { 'data-chat-messages': 'true', role: 'log', 'aria-live': 'off', style: { display: 'grid', gap: 8, minHeight: 60, flex: '1 0 auto' } },
        messages.length ? messages.map(m => h('article', { key: m.message_id, 'data-chat-message': m.role, 'data-chat-message-status': m.status, style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', border: '1px solid rgba(148,163,184,.18)', borderRadius: 8, padding: 10, background: m.role === 'user' ? 'rgba(56,189,248,.05)' : 'rgba(15,23,42,.4)' } },
          h('strong', { style: { fontSize: 12, color: m.role === 'user' ? '#7dd3fc' : '#c4b5fd' } }, m.role === 'user' ? 'You' : `Assistant · ${m.status}`),
          h('div', { style: { fontSize: 13, color: '#f1f5f9', marginTop: 4, lineHeight: 1.5 } }, m.content),
          m.role === 'assistant' && m.status === 'complete' && h('div', { style: { display: 'flex', gap: 6, marginTop: 8 } },
            h('button', { type: 'button', 'data-chat-copy': 'true', onClick: () => this.copyText('Chat reply', m.content), style: { border: '1px solid rgba(148,163,184,.25)', background: 'transparent', color: '#cbd5e1', borderRadius: 5, padding: '3px 8px', fontSize: 11, cursor: 'pointer' } }, 'Copy'),
            h('button', { type: 'button', 'data-chat-to-create': 'replace', onClick: () => this.handoffChatToCreate(m.message_id, 'replace'), style: { border: '1px solid rgba(245,158,11,.4)', background: 'rgba(245,158,11,.1)', color: '#fbbf24', borderRadius: 5, padding: '3px 8px', fontSize: 11, cursor: 'pointer', fontWeight: 600 } }, 'Use in Create'),
            h('button', { type: 'button', 'data-chat-to-create': 'append', onClick: () => this.handoffChatToCreate(m.message_id, 'append'), style: { border: '1px solid rgba(148,163,184,.25)', background: 'transparent', color: '#cbd5e1', borderRadius: 5, padding: '3px 8px', fontSize: 11, cursor: 'pointer' } }, 'Append to Create')))) : h('div', { style: { fontSize: 12, color: '#64748b', fontStyle: 'italic', padding: '16px 0', textAlign: 'center' } }, 'No messages yet. Send a message below to start.'),
        this.state.chatRunning && h('article', { 'data-chat-stream': 'true', style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', border: '1px solid rgba(56,189,248,.3)', borderRadius: 8, padding: 10, background: 'rgba(56,189,248,.06)' } }, this.state.chatStreamText || this.state.chatStatus)),
      h('div', { role: 'status', 'aria-live': 'polite', 'data-chat-run-status': 'true', style: { fontSize: 11, color: '#94a3b8' } }, this.state.chatStatus),
      this.state.chatError && h('p', { role: 'alert', 'data-chat-error': 'true', style: { color: '#fca5a5', fontSize: 12, margin: '4px 0' } }, this.state.chatError),

      // PINNED BOTTOM COMPOSER: Always visible at bottom, never scrolled away!
      h('footer', {
        'data-chat-footer': 'true',
        style: { position: 'sticky', bottom: 0, zIndex: 10, background: '#0d1117', borderTop: '1px solid rgba(148,163,184,.14)', padding: '10px 0 14px', marginTop: 'auto', display: 'grid', gap: 6 }
      },
        h('label', { style: { display: 'grid', gap: 4 } },
          h('span', { style: { fontSize: 11, fontWeight: 600, color: '#cbd5e1' } }, 'Message'),
          h('textarea', {
            'data-chat-composer': 'true',
            value: this.state.chatDraft,
            onInput: e => this.setState({ chatDraft: e.target.value }),
            onChange: e => this.setState({ chatDraft: e.target.value }),
            disabled: !ready,
            rows: 3,
            placeholder: ready ? 'Write a message. Command or Control + Enter sends.' : 'Chat is unavailable.',
            style: { width: '100%', boxSizing: 'border-box', resize: 'none', background: '#111722', color: '#f8fafc', border: '1px solid rgba(148,163,184,.25)', borderRadius: 7, padding: '8px 10px', fontSize: 13, fontFamily: 'inherit', lineHeight: 1.4 }
          })
        ),
        h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' } },
          h('button', { type: 'button', 'data-chat-send': 'true', onClick: () => this.sendChat(), disabled: !ready || this.state.chatRunning || !this.state.chatDraft.trim(), style: { border: 'none', background: '#38bdf8', color: '#091420', fontWeight: 700, borderRadius: 6, padding: '6px 16px', fontSize: 12, cursor: ready && !this.state.chatRunning && this.state.chatDraft.trim() ? 'pointer' : 'default' } }, 'Send'),
          h('button', { type: 'button', 'data-chat-stop': 'true', onClick: () => this.stopChat(), disabled: !this.state.chatRunning, style: { border: '1px solid rgba(239,68,68,.4)', background: 'rgba(239,68,68,.1)', color: '#fca5a5', borderRadius: 6, padding: '6px 12px', fontSize: 12, cursor: this.state.chatRunning ? 'pointer' : 'default' } }, 'Stop'),
          h('button', { type: 'button', 'data-chat-regenerate': 'true', onClick: () => this.sendChat(lastAssistant && lastAssistant.message_id), disabled: !ready || this.state.chatRunning || !lastAssistant, style: { border: '1px solid rgba(148,163,184,.25)', background: 'transparent', color: '#cbd5e1', borderRadius: 6, padding: '6px 12px', fontSize: 12, cursor: ready && !this.state.chatRunning && lastAssistant ? 'pointer' : 'default' } }, 'Regenerate last reply'),
          h('span', { style: { marginLeft: 'auto', fontSize: 11, color: '#64748b' } }, '⌘/Ctrl + Enter sends')
        )
      )
    );
  }

  // ── Models — load from /api/capabilities & /api/models ───────
  async loadModels() {
    this.setState({ loadingCheckpoints: true, loadingModelCards: true });
    try {
      const [capRes, modelsRes] = await Promise.allSettled([
        fetch(this.state.backendUrl + '/api/capabilities', { signal: AbortSignal.timeout(8000) }),
        fetch(this.state.backendUrl + '/api/models', { signal: AbortSignal.timeout(8000) })
      ]);
      if (capRes.status === 'fulfilled' && capRes.value.ok) {
        const data = await capRes.value.json();
        const targets = data.modelTargets || data.controlledTargets || [];
        const checkpoints = targets.map(t => ({
          title: DexClient.targetOptionLabel(t),
          name: t.id,
          hash: t.status || '',
          status: t.status,
        }));
        this.setState({ checkpoints, modelTargets: targets, capabilityData: data, modelState: data.modelState || null });
        let saved = null;
        try { saved = localStorage.getItem('dex_target'); } catch {}
        const initial = DexClient.chooseInitialTarget(targets, saved, this.state.target);
        // Startup restores the remembered picker state only. Remote worker
        // activation requires an explicit user action.
        if (initial && initial !== this.state.target) await this.onSelectTarget(initial, { quiet: true, restoreOnly: true });
      }
      if (modelsRes.status === 'fulfilled' && modelsRes.value.ok) {
        const data = await modelsRes.value.json();
        this.setState({ modelCards: data.models || [] });
      }
      this.setState({ loadingCheckpoints: false, loadingModelCards: false });
      // Successful discovery is already reflected in the model controls. Keep
      // the transient toast for failures and user actions, not routine startup.
    } catch(e) {
      this.setState({ loadingCheckpoints: false, loadingModelCards: false });
      this.toast('Cannot reach backend', '#ef4444');
    }
  }

  loadCheckpoint(name) { this.selectModelWithValidation(name); }

  async selectModelWithValidation(id) {
    const fromId = this.state.target;
    const activeLoras = this.getActiveLoras();
    try {
      const res = await fetch(this.state.backendUrl + '/api/models/check-switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromModelId: fromId,
          toModelId: id,
          activeResources: {
            negativePrompt: this.state.negPrompt,
            loras: activeLoras
          }
        })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.warnings && data.warnings.length) {
          this.setState({ modelSwitchWarning: data.warnings });
          const firstMsg = data.warnings[0].message || data.warnings[0];
          this.toast(firstMsg, '#fbbf24');
        } else {
          this.setState({ modelSwitchWarning: null });
        }
      }
    } catch (_) {}
    await this.onSelectTarget(id, { preserveSettings: true });
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
    const dims = DexClient.dimensionsForTarget(t, { width: this.state.width, height: this.state.height });
    this.setState({
      steps,
      cfg: t.defaultCfgScale != null ? t.defaultCfgScale : this.state.cfg,
      width: dims.width,
      height: dims.height,
      sampler: t.defaultSampler || this.state.sampler,
      scheduler: t.defaultScheduler || 'discrete',
    });
  }

  applyModelDefaults() {
    const tId = this.state.target;
    const t = (this.state.modelTargets || []).find(x => x.id === tId);
    const card = (this.state.modelCards || []).find(c => c.id === tId);
    if (!t && !card) return;
    this.applyTargetDefaults(tId);
    const steps = card ? (card.default_steps || t.defaultSteps) : t.defaultSteps;
    const cfg = card ? (card.default_cfg != null ? card.default_cfg : t.defaultCfgScale) : t.defaultCfgScale;
    let w = t ? t.defaultWidth : 512;
    let h = t ? t.defaultHeight : 512;
    if (card && card.native_resolution) {
      const [nw, nh] = card.native_resolution.split('x').map(Number);
      if (nw && nh) { w = nw; h = nh; }
    }
    const patch = { availableModelDefaults: null };
    if (steps) patch.steps = steps;
    if (cfg != null) patch.cfg = cfg;
    if (w && h) { patch.width = w; patch.height = h; }
    this.setState(patch);
    const name = card ? card.display_name : (t ? t.label : tId);
    this.toast(`Applied model defaults for ${name} (${w}×${h}, ${steps} steps, CFG ${cfg})`, '#38bdf8');
  }

  async onSelectTarget(id, options = {}) {
    const target = (this.state.modelTargets || []).find(t => t.id === id);
    if (!target) return;
    if (this._enhanceNegAbort) {
      this._enhanceNegAbort.abort();
      this._enhanceNegAbort = null;
    }
    if (this.state.negEnhancementResult || this.state.enhancingNegPrompt) {
      this.setState({ enhancingNegPrompt: false, negEnhancementResult: null });
    }
    if (!options.restoreOnly && (target.backend || 'sdcpp') !== 'mflux') {
      if (!options.quiet) this.toast('Switching secondary model…', '#fbbf24');
      try {
        const response = await fetch(this.state.backendUrl + '/api/models/secondary/activate', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target: id }), signal: AbortSignal.timeout(45000)
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || ('HTTP ' + response.status));
        this.setState({ modelState: data.modelState || data });
      } catch (error) {
        this.toast('Model switch failed: ' + error.message, '#ef4444');
        return;
      }
    }
    try { localStorage.setItem('dex_target', id); } catch {}

    const card = (this.state.modelCards || []).find(c => c.id === id);
    const recW = (card && card.native_resolution ? Number(card.native_resolution.split('x')[0]) : target.defaultWidth) || 512;
    const recH = (card && card.native_resolution ? Number(card.native_resolution.split('x')[1]) : target.defaultHeight) || 512;
    const recSteps = (card && card.default_steps) || target.defaultSteps || 20;
    const recCfg = (card && card.default_cfg != null ? card.default_cfg : target.defaultCfgScale) != null ? (card && card.default_cfg != null ? card.default_cfg : target.defaultCfgScale) : 7.0;

    const defaultsInfo = {
      targetId: id,
      displayName: (card && card.display_name) || target.label || id,
      width: recW,
      height: recH,
      steps: recSteps,
      cfg: recCfg,
      sampler: target.defaultSampler,
      scheduler: target.defaultScheduler
    };

    if (options.preserveSettings) {
      // Preserve current user settings by default; apply only necessary normalization
      const dims = DexClient.dimensionsForTarget(target, { width: this.state.width, height: this.state.height });
      const patch = {
        target: id,
        activeCheckpoint: id,
        width: dims.width,
        height: dims.height,
        availableModelDefaults: defaultsInfo
      };
      if (target.maxSteps && this.state.steps > target.maxSteps) patch.steps = target.maxSteps;
      if (target.minSteps && this.state.steps < target.minSteps) patch.steps = target.minSteps;
      if (target.fixedCfgScale != null) patch.cfg = target.fixedCfgScale;
      if ((target.backend || 'sdcpp') === 'mflux') patch.sampler = 'euler';
      else {
        // Leaving MFLUX: its forced 'euler' is not a user choice, so adopt the new target's own default sampler/scheduler.
        const prev = (this.state.modelTargets || []).find(x => x.id === this.state.target);
        if (prev && prev.backend === 'mflux' && target.defaultSampler) { patch.sampler = target.defaultSampler; patch.scheduler = target.defaultScheduler || 'discrete'; }
      }
      this.setState(patch);
    } else {
      this.setState({ target: id, activeCheckpoint: id, availableModelDefaults: defaultsInfo });
      this.applyTargetDefaults(id);
    }

    this.loadAssets();
    // Check active Create LoRA compatibility with the new target
    const currentLoraState = this.state.createLora;
    if (currentLoraState && currentLoraState.selectedId && currentLoraState.enabled !== false) {
      const optionsForNewTarget = typeof this._createLoraOptions === 'function' ? this._createLoraOptions(id) : [];
      const matching = optionsForNewTarget.find(l => l.id === currentLoraState.selectedId);
      if (!matching || !matching.use_enabled) {
        const reason = matching ? matching.unavailable_reason : 'Incompatible with the selected checkpoint';
        const name = matching ? matching.name : currentLoraState.selectedId;
        this.toast(`Disabled ${name}: ${reason}`, '#fbbf24');
        if (typeof this.selectCreateLora === 'function') {
          this.selectCreateLora('');
        } else if (typeof this.setCreateLoraEnabled === 'function') {
          this.setCreateLoraEnabled(false);
        }
      }
    }
    if (!options.quiet) this.toast('Target set: ' + id, '#38bdf8');
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
    const target = (this.state.modelTargets || []).find(t => t.id === p.target);
    const dimensionError = DexClient.dimensionIssue(target, p.width, p.height);
    if (dimensionError) out.push([dimensionError, 'error']);
    const ctl = DexClient.controlsFor(target);
    if (p.selectedVae && p.selectedVae !== 'default' && p.selectedVae !== 'none') out.push([ctl.vae ? 'VAE override is passed to sd-cli --vae for this SDCPP target' : 'This target ignores VAE selection', ctl.vae ? 'info' : 'warn']);
    if (!out.length) out.push(['Ready to generate', 'ok']);
    return out;
  }

  saveFavoritePreset() {
    const name = (this.state.favoriteName || '').trim() || ('Recipe ' + new Date().toLocaleTimeString());
    this.saveRecipe('create', this.createPresetSettings(), name);
    this.setState({ favoriteName: '' });
  }

  applyFavoritePreset(id) {
    const p = this.state.favoritePresets.find(x => x.id === id);
    if (!p) return;
    const target = p.target || this.state.target;
    // Settings only; the current prompt is kept unless the recipe carries one.
    this.setState({
      target,
      prompt: typeof p.prompt === 'string' ? p.prompt : this.state.prompt,
      negPrompt: typeof p.negPrompt === 'string' ? p.negPrompt : this.state.negPrompt,
      steps: p.steps || this.state.steps,
      cfg: p.cfg ?? this.state.cfg,
      width: p.width || this.state.width,
      height: p.height || this.state.height,
      sampler: p.sampler || this.state.sampler,
      scheduler: p.scheduler || this.state.scheduler,
      selectedVae: p.vae || 'default',
      createLoras: [],
      promptOpen: true
    });
    if (this.ws && p.quantity) this.ws.quantity = p.quantity;
    const norm = DexEdit.normalizeLoras(p.loras);
    if (norm.length > 0 && typeof this._createLoraOptions === 'function') {
      const options = this._createLoraOptions(target);
      const match = options.find(l => (l.name && l.name.toLowerCase() === norm[0].name.toLowerCase()) || (l.filename && l.filename.replace(/\.[^.]+$/, '').toLowerCase() === norm[0].name.toLowerCase()) || l.id === norm[0].name);
      if (match && match.use_enabled) {
        const defaultWeight = match.default_weight !== undefined ? match.default_weight : 1.0;
        const rawWeight = norm[0].weight !== undefined ? Number(norm[0].weight) : defaultWeight;
        const min = match.min_weight !== undefined ? match.min_weight : 0.0;
        const max = match.max_weight !== undefined ? match.max_weight : 2.0;
        const weight = Number.isFinite(rawWeight) ? Math.min(max, Math.max(min, rawWeight)) : defaultWeight;
        const baseSettings = {
          steps: p.steps || this.state.steps,
          cfg: p.cfg ?? this.state.cfg,
          sampler: p.sampler || this.state.sampler,
          scheduler: p.scheduler || this.state.scheduler
        };
        const nextLora = {
          enabled: true,
          selectedId: match.id,
          strength: weight,
          savedSettings: baseSettings,
          recipeSettings: null,
          overrides: {}
        };
        if (typeof this._persistCreateLora === 'function') this._persistCreateLora(nextLora);
        else this.setState({ createLora: nextLora });
      } else {
        const clearLora = { enabled: false, selectedId: '', strength: 1, savedSettings: null, recipeSettings: null, overrides: {} };
        if (typeof this._persistCreateLora === 'function') this._persistCreateLora(clearLora);
        else this.setState({ createLora: clearLora });
      }
    } else {
      const clearLora = { enabled: false, selectedId: '', strength: 1, savedSettings: null, recipeSettings: null, overrides: {} };
      if (typeof this._persistCreateLora === 'function') this._persistCreateLora(clearLora);
      else this.setState({ createLora: clearLora });
    }
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
  // T-202: the dedicated Cancel control for the Create screen. The proven implementation already
  // exists in workstation-ui.js (`interruptGeneration`): it targets the exact job id, waits for the
  // server's remote-stop verdict and never claims success without it. This method only routes to it and
  // refuses honestly when the Studio workspace module is not loaded.
  onCancelJob() {
    if (typeof this.interruptGeneration === 'function') return this.interruptGeneration();
    this.toast('Cancelling is not available in this view — open Studio to stop the job.', '#fbbf24');
    return undefined;
  }

  async onGenerate() {
    const { jobStatus, prompt, negPrompt, steps, cfg, seed, width, height,
            target, backendUrl, savePrompts, sampler, scheduler, selectedVae } = this.state;
    // T-202: Generate starts one job. It is never a disguised "stop" that silently resets local state
    // while the worker keeps running. A running job has its own Cancel affordance keyed by job id.
    if (jobStatus === 'generating' || jobStatus === 'cancelling') {
      this.toast('A job is already running — use Cancel job to stop it', '#fbbf24');
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
      this.setState({ activeJobId: job_id });
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
      this.setState(s => ({ jobStatus: 'complete', progress: 100, activeJobId: null, currentImageSrc: imgSrc, lastSeed: params.seed, runs,
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
    const SA = this._sourceAsset();
    const runs = this.state.runs;
    const srcRun = (runId && runId !== 'last') ? runs.find(r => r.id === runId) : runs[0];
    if (!srcRun) return { error: 'No source run — generate an image first' };
    const imageFile = file || srcRun.imageFile || (this.state.runFiles[srcRun.id] || [])[0];
    if (!imageFile) return { error: 'Source run has no image file' };
    if (SA && !SA.isSafeImageName(String(imageFile))) {
      return { error: 'That source file name is not a supported image, so it was not sent to Enhance.' };
    }
    return { run: srcRun, imageFile };
  }
  onI2iRunChange(runId) { this.setState({ i2iSrcRunId: runId, i2iSrcFile: '' }); this.loadRunFiles(runId); }
  onEnhRunChange(runId) { this.setState({ enhSrcRunId: runId, enhSrcFile: '' }); this.loadRunFiles(runId); }

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

  // The Create workspace record lives in workstation-ui.js; read it defensively so the shell still
  // renders if that module is unavailable.
  // G3: canonical source resolution. One module decides which image a
  // World/3D/Enhance/Edit handoff acts on, and it refuses rather than guessing.
  _sourceAsset() { return window.DexSourceAsset || null; }

  _createWs() {
    try { return (typeof this._ws === 'function' ? this._ws() : null) || {}; } catch (_) { return {}; }
  }

  // T-402: horizontal chip row overflow. Keyboard users get the same reach as pointer users; the
  // row itself remains a single line (never a wrapped chip waterfall).
  scrollStudioNav(direction) {
    try {
      const nav = document.querySelector('[data-studio-nav]');
      if (!nav) return;
      const step = Math.max(160, Math.round(nav.clientWidth * 0.6)) * (direction < 0 ? -1 : 1);
      nav.scrollBy ? nav.scrollBy({ left: step, behavior: 'smooth' }) : (nav.scrollLeft += step);
      const active = nav.querySelector('[data-tab][data-active="true"]');
      if (active && active.focus) active.focus({ preventScroll: true });
    } catch (_) {}
  }

  // S03 / T-603: Swap is a required destination whose backend, semantics and licence are unresolved.
  // It stays navigable and truthful: no generation control, no hidden download, no fake job.
  buildSwapWorkspace() {
    const h = React.createElement;
    const card = (title, body) => h('div', { style: { border: '1px solid rgba(125,211,252,.16)', background: 'rgba(125,211,252,.05)', borderRadius: 10, padding: '12px 14px', marginBottom: 10 } },
      h('div', { style: { fontSize: 12, fontWeight: 700, color: '#dbeafe', marginBottom: 4 } }, title),
      h('div', { style: { fontSize: 12, color: '#93a3b8', lineHeight: 1.6 } }, body));
    const button = (label, onClick) => h('button', {
      type: 'button', onClick,
      style: { border: '1px solid rgba(148,163,184,.35)', background: 'rgba(255,255,255,.04)', color: '#e2e8f0', borderRadius: 8, padding: '7px 12px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }
    }, label);

    return h('div', { style: { maxWidth: 760, margin: '0 auto' } },
      h('h1', { style: { fontSize: 18, fontWeight: 700, color: '#f1f5f9', margin: '0 0 4px' } }, 'Swap'),
      h('p', { style: { fontSize: 13, color: '#a8b3c2', margin: '0 0 14px', lineHeight: 1.6 } },
        'This tool isn\'t enabled yet. Nothing here will start a job or download a model.'),
      card('What Swap is for', 'Replacing or exchanging content between images — for example putting one subject\'s appearance into another picture. The exact behaviour has not been agreed yet, so it is not built.'),
      card('What is missing', 'An approved, licensed model, an agreed definition of the operation, and a proven run on this machine. Until then no Swap button will pretend to work.'),
      card('What you can do now', 'Everything else in the studio still works. Use Edit to change an existing image, or Enhance to make one larger.'),
      h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 } },
        button('Open Library', () => this.setScreen('library')),
        button('Open Edit', () => this.setScreen('edit')),
        button('View system status', () => this.setScreen('system'))));
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
    if (jobStatus === 'cancelled') {
      return React.createElement('div', { role: 'status', style: { textAlign: 'center', padding: 20 } },
        React.createElement('div', { style: { fontSize: 14, color: '#94a3b8', marginBottom: 8 } }, 'Job cancelled'),
        React.createElement('div', { style: { fontSize: 12, color: '#64748b', maxWidth: 280, lineHeight: 1.5 } }, 'Your prompt and settings are still here. Press Generate image when you want to try again.'));
    }
    if (jobStatus === 'cancel-unverified') {
      const reason = this.state.cancelError || 'The worker could not confirm that it stopped.';
      return React.createElement('div', { role: 'alert', style: { textAlign: 'center', padding: 20 } },
        React.createElement('div', { style: { fontSize: 14, color: '#f59e0b', marginBottom: 8 } }, 'Could not confirm the worker stopped'),
        React.createElement('div', { style: { fontSize: 12, color: '#94a3b8', maxWidth: 320, lineHeight: 1.6, margin: '0 auto' } }, reason),
        React.createElement('div', { style: { fontSize: 11, color: '#64748b', marginTop: 8 } }, 'Heavy work stays paused until this is reconciled. See System for details.'));
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
            i2iSrcRunId, i2iSrcFile,
            enhSrcRunId, enhSrcFile, enhScale, enhMethod, enhStatus, enhResult,
            checkpoints, loadingCheckpoints, loadingModelCards, activeCheckpoint,
            preset, runFiles, libFilter, libHasMore, libTotal, libLoadingMore,
            ollamaOnline, ollamaModel, enhancingPrompt, wildcards, showWildcards, wildcardFilter, assets, loadingAssets,
          } = s;
    const screen = screens[version];
    const isGenerating = jobStatus === 'generating';
    const accent = version === 2 ? '#f59e0b' : version === 3 ? '#a78bfa' : '#38bdf8';

    // ── Library cards ──────────────────────────────────────────
    const libraryCards = runs.length > 0 ? runs.map(card => ({ ...card })) : [{ id: 'no runs yet', badge: '—', badgeColor: '#6060a0', badgeBg: 'rgba(80,80,160,.08)', model: 'run generate to start', size: '—', thumb: 'linear-gradient(135deg,#0a0a18,#141428)' }];

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

    // ── Enhance status display ────────────────────────────────
    const enhStatusDisplay = React.createElement('div', { style: { marginTop: 8 } },
      enhStatus === 'running' ? React.createElement('div', { style: { fontSize: 12, color: '#38bdf8' } }, 'Upscaling…') :
      enhStatus === 'done' && enhResult ? React.createElement('img', { src: enhResult, alt: 'enhanced', style: { maxWidth: '100%', maxHeight: 200, borderRadius: 6, objectFit: 'contain' } }) :
      enhStatus === 'done' ? React.createElement('div', { style: { fontSize: 12, color: '#65d66e' } }, '✓ Enhance done') :
      enhStatus === 'error' ? React.createElement('div', { style: { fontSize: 12, color: '#ef4444' } }, '✗ Enhance failed') :
      null
    );

    // ── Models list display (Visual Model Cards Browser) ───────
    const modelSearchTerm = (s.modelSearch || '').toLowerCase().trim();
    const modelFamilyFilter = s.modelFamilyFilter || 'all';
    const allCards = (s.modelCards && s.modelCards.length > 0)
      ? s.modelCards
      : checkpoints.map(cp => ({
          id: cp.name,
          display_name: cp.title || cp.name,
          family: 'unknown',
          backend: 'sdcpp',
          status: cp.status || 'PROVEN',
          primary: cp.name.includes('flux2'),
          preview_image: null,
          preview_provenance: 'placeholder',
          description: cp.title || cp.name,
          why_use: 'Standard image generation target.',
          best_for: ['General image generation'],
          specialties: ['Standard'],
          avoid_for: ['Untested edge cases'],
          native_resolution: '512x512',
          default_steps: 20,
          default_cfg: 7,
          speed_class: 'Standard',
          supports_negative_prompt: true,
          supports_lora: true,
          supports_embeddings: false,
          caveat: ''
        }));

    const filteredCards = allCards.filter(c => {
      if (modelFamilyFilter === 'proven' && c.status !== 'PROVEN') return false;
      if (modelFamilyFilter === 'fast' && !(c.speed_class && c.speed_class.toLowerCase().includes('fast'))) return false;
      if (modelFamilyFilter === 'photoreal' && !(c.specialties && c.specialties.includes('Photoreal'))) return false;
      if (modelFamilyFilter === 'flux' && !(c.family && c.family.startsWith('flux'))) return false;
      if (modelFamilyFilter === 'sdxl' && !(c.family && c.family.startsWith('sdxl'))) return false;
      if (modelFamilyFilter === 'sd15' && c.family !== 'sd15') return false;
      if (modelSearchTerm) {
        const text = (c.id + ' ' + c.display_name + ' ' + (c.description || '') + ' ' + (c.specialties || []).join(' ') + ' ' + (c.best_for || []).join(' ')).toLowerCase();
        if (!text.includes(modelSearchTerm)) return false;
      }
      return true;
    });

    const modelFilterTabs = [
      ['all', 'All (' + allCards.length + ')'],
      ['proven', 'Proven Only'],
      ['fast', 'Fast'],
      ['photoreal', 'Photoreal'],
      ['flux', 'FLUX'],
      ['sdxl', 'SDXL'],
      ['sd15', 'SD1.5']
    ];

    const modelsListDisplay = React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
      // Search + Filter Row
      React.createElement('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' } },
        React.createElement('input', {
          value: s.modelSearch || '',
          onChange: e => this.setState({ modelSearch: e.target.value }),
          placeholder: 'Search models (name, tag, specialty)…',
          style: { flex: '1 1 200px', border: '1px solid rgba(148,163,184,.18)', background: 'rgba(5,10,18,.75)', color: '#e2e8f0', borderRadius: 7, padding: '7px 9px', outline: 'none', fontSize: 12, fontFamily: "'DM Sans',sans-serif" }
        }),
        React.createElement('div', { style: { display: 'flex', gap: 4, flexWrap: 'wrap' } },
          ...modelFilterTabs.map(([key, label]) => React.createElement('button', {
            key,
            type: 'button',
            onClick: () => this.setState({ modelFamilyFilter: key }),
            style: { border: '1px solid ' + (modelFamilyFilter === key ? accent : 'rgba(148,163,184,.16)'), background: modelFamilyFilter === key ? accent + '22' : 'rgba(255,255,255,.03)', color: modelFamilyFilter === key ? accent : '#94a3b8', borderRadius: 6, padding: '4px 8px', fontSize: 10, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", fontWeight: 700 }
          }, label))
        )
      ),

      // Switch Warning Banner
      s.modelSwitchWarning && s.modelSwitchWarning.length ? React.createElement('div', {
        style: { border: '1px solid rgba(251,191,36,.4)', background: 'rgba(251,191,36,.08)', borderRadius: 8, padding: '8px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }
      },
        React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 3 } },
          React.createElement('div', { style: { fontSize: 11, fontWeight: 700, color: '#fde68a' } }, '⚠️ Model Switch Notice'),
          ...s.modelSwitchWarning.map((w, idx) => React.createElement('div', { key: idx, style: { fontSize: 11, color: '#fef08a' } }, '• ' + (w.message || w)))
        ),
        React.createElement('button', {
          type: 'button',
          onClick: () => this.setState({ modelSwitchWarning: null }),
          style: { border: 'none', background: 'transparent', color: '#fde68a', cursor: 'pointer', fontSize: 14, fontWeight: 700 }
        }, '×')
      ) : null,

      // Cards Grid
      loadingCheckpoints || loadingModelCards
        ? React.createElement('div', { style: { fontSize: 12, color: '#38bdf8', padding: 12, fontFamily: "'IBM Plex Mono',monospace" } }, 'Loading model cards…')
        : filteredCards.length === 0
          ? React.createElement('div', { style: { fontSize: 12, color: '#64748b', padding: 12 } }, 'No models match filter.')
          : React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: 10 } },
              ...filteredCards.map(c => {
                const isActive = activeCheckpoint === c.id || target === c.id;
                let sourceUrl = null;
                try {
                  const parsed = new URL(c.source_url || '');
                  if (parsed.protocol === 'https:' && parsed.hostname && !parsed.username && !parsed.password) sourceUrl = parsed.href;
                } catch (_) {}
                const provTone = c.preview_provenance === 'exact-model' ? '#10b981' : c.preview_provenance === 'family-sample' ? '#f59e0b' : '#64748b';
                const provLabel = c.preview_provenance === 'exact-model' ? '✓ EXACT MODEL (LOCAL)' : c.preview_provenance === 'family-sample' ? 'FAMILY SAMPLE' : 'PLACEHOLDER';
                const statusTone = c.status === 'PROVEN' ? '#65d66e' : '#fbbf24';

                return React.createElement('div', {
                  key: c.id,
                  style: { border: '1px solid ' + (isActive ? '#65d66e' : 'rgba(148,163,184,.14)'), background: isActive ? 'rgba(101,214,110,.05)' : 'rgba(8,12,18,.85)', borderRadius: 9, overflow: 'hidden', display: 'flex', flexDirection: 'column' }
                },
                  // Visual preview banner
                  React.createElement('div', { style: { position: 'relative', width: '100%', height: 110, background: 'linear-gradient(135deg,#0a101a,#141026)', overflow: 'hidden' } },
                    c.preview_image
                      ? React.createElement('img', { src: c.preview_image, alt: c.display_name, style: { width: '100%', height: '100%', objectFit: 'cover' } })
                      : React.createElement('div', { style: { width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, opacity: 0.25 } }, '🎴'),
                    // Provenance badge
                    React.createElement('div', { style: { position: 'absolute', top: 6, left: 6, background: 'rgba(5,10,18,.85)', border: '1px solid ' + provTone, color: provTone, borderRadius: 5, padding: '2px 6px', fontSize: 9, fontWeight: 800, letterSpacing: '.05em' } }, provLabel),
                    // Primary badge
                    c.primary ? React.createElement('div', { style: { position: 'absolute', top: 6, right: 6, background: 'rgba(251,191,36,.9)', color: '#000', borderRadius: 5, padding: '2px 6px', fontSize: 9, fontWeight: 800 } }, '★ PRIMARY') : null
                  ),

                  // Card details
                  React.createElement('div', { style: { padding: 10, display: 'flex', flexDirection: 'column', gap: 6, flex: 1 } },
                    // Title and badges
                    React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 } },
                      React.createElement('div', { style: { fontSize: 13, fontWeight: 800, color: '#f1f5f9', fontFamily: "'DM Sans',sans-serif" } }, c.display_name),
                      React.createElement('div', { style: { display: 'flex', gap: 4 } },
                        React.createElement('span', { style: { border: '1px solid rgba(56,189,248,.4)', background: 'rgba(56,189,248,.1)', color: '#38bdf8', borderRadius: 4, padding: '1px 5px', fontSize: 9, fontWeight: 700 } }, c.backend.toUpperCase()),
                        React.createElement('span', { style: { border: '1px solid ' + statusTone + '55', background: statusTone + '15', color: statusTone, borderRadius: 4, padding: '1px 5px', fontSize: 9, fontWeight: 700 } }, c.status)
                      )
                    ),

                    // Description (What is it)
                    React.createElement('div', { style: { fontSize: 11, color: '#94a3b8', lineHeight: 1.35 } }, c.description),
                    React.createElement('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' } },
                      sourceUrl
                        ? React.createElement('a', {
                            href: sourceUrl,
                            target: '_blank',
                            rel: 'noopener noreferrer',
                            'aria-label': 'Source for ' + c.display_name + ' (opens in a new tab)',
                            onClick: event => event.stopPropagation(),
                            style: { display: 'inline-flex', alignItems: 'center', border: '1px solid rgba(148,163,184,.38)', borderRadius: 5, padding: '3px 7px', color: '#cbd5e1', background: 'rgba(255,255,255,.035)', fontSize: 10, fontWeight: 700, textDecoration: 'none', outlineOffset: 2 }
                          }, 'Source ↗')
                        : React.createElement('span', { role: 'status', style: { color: '#64748b', fontSize: 10 } }, 'Source unavailable'),
                      (() => {
                        try {
                          const distribution = new URL(c.distribution_url || '');
                          if (distribution.protocol !== 'https:' || !distribution.hostname || distribution.username || distribution.password) return null;
                          return React.createElement('a', {
                            href: distribution.href, target: '_blank', rel: 'noopener noreferrer',
                            'aria-label': 'Weight distribution for ' + c.display_name + ' (opens in a new tab)',
                            onClick: event => event.stopPropagation(),
                            style: { display: 'inline-flex', alignItems: 'center', border: '1px solid rgba(148,163,184,.38)', borderRadius: 5, padding: '3px 7px', color: '#cbd5e1', background: 'rgba(255,255,255,.035)', fontSize: 10, fontWeight: 700, textDecoration: 'none', outlineOffset: 2 }
                          }, 'Weight distribution ↗');
                        } catch (_) { return null; }
                      })()
                    ),

                    // Why use it
                    c.why_use ? React.createElement('div', { style: { fontSize: 11, color: '#cbd5e1', lineHeight: 1.35 } },
                      React.createElement('span', { style: { color: '#7dd3fc', fontWeight: 700 } }, 'Why: '), c.why_use
                    ) : null,

                    // Best for (Strong at)
                    c.best_for && c.best_for.length ? React.createElement('div', { style: { fontSize: 10, color: '#86efac', display: 'flex', flexDirection: 'column', gap: 2 } },
                      ...c.best_for.slice(0, 2).map((b, bi) => React.createElement('div', { key: bi }, '✓ ' + b))
                    ) : null,

                    // Avoid for / caveat
                    c.avoid_for && c.avoid_for.length ? React.createElement('div', { style: { fontSize: 10, color: '#fca5a5' } },
                      '⚠ Avoid: ' + c.avoid_for[0]
                    ) : null,

                    // Caveat notice
                    c.caveat ? React.createElement('div', { style: { fontSize: 10, color: '#fde68a', fontStyle: 'italic' } }, c.caveat) : null,

                    // Specs & Capability Chips
                    React.createElement('div', { style: { display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 2 } },
                      React.createElement('span', { style: { border: '1px solid rgba(148,163,184,.14)', background: 'rgba(255,255,255,.03)', color: '#94a3b8', borderRadius: 4, padding: '1px 5px', fontSize: 9, fontFamily: "'IBM Plex Mono',monospace" } }, c.native_resolution),
                      React.createElement('span', { style: { border: '1px solid rgba(148,163,184,.14)', background: 'rgba(255,255,255,.03)', color: '#94a3b8', borderRadius: 4, padding: '1px 5px', fontSize: 9, fontFamily: "'IBM Plex Mono',monospace" } }, c.default_steps + ' steps'),
                      React.createElement('span', { style: { border: '1px solid rgba(148,163,184,.14)', background: 'rgba(255,255,255,.03)', color: '#94a3b8', borderRadius: 4, padding: '1px 5px', fontSize: 9, fontFamily: "'IBM Plex Mono',monospace" } }, 'CFG ' + c.default_cfg),
                      React.createElement('span', { style: { border: '1px solid rgba(148,163,184,.14)', background: 'rgba(255,255,255,.03)', color: '#94a3b8', borderRadius: 4, padding: '1px 5px', fontSize: 9 } }, c.speed_class)
                    ),

                    // Negative prompt & LoRA explicit badges
                    React.createElement('div', { style: { display: 'flex', gap: 4, flexWrap: 'wrap' } },
                      c.supports_negative_prompt
                        ? React.createElement('span', { style: { color: '#86efac', fontSize: 9, fontWeight: 700 } }, '✓ Neg prompt')
                        : React.createElement('span', { style: { color: '#f87171', fontSize: 9, fontWeight: 800 } }, '❌ No neg prompt (ignored)'),
                      React.createElement('span', { style: { color: c.supports_lora ? '#86efac' : '#94a3b8', fontSize: 9 } }, c.supports_lora ? '✓ LoRA' : 'No LoRA'),
                      React.createElement('span', { style: { color: c.supports_embeddings ? '#86efac' : '#94a3b8', fontSize: 9 } }, c.supports_embeddings ? '✓ Embeddings' : 'No Embeddings')
                    ),

                    // Action Buttons
                    React.createElement('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 } },
                      React.createElement('button', {
                        type: 'button',
                        disabled: c.runtime === 'model-missing' || c.runtime === 'dormant' || c.runtime === 'unknown',
                        onClick: () => this.selectModelWithValidation(c.id),
                        style: {
                          flex: '1 1 auto',
                          border: '1px solid ' + (isActive ? '#65d66e' : '#38bdf8'),
                          background: isActive ? 'rgba(101,214,110,.15)' : 'rgba(56,189,248,.12)',
                          color: isActive ? '#65d66e' : '#38bdf8',
                          borderRadius: 6,
                          padding: '6px 10px',
                          fontSize: 11,
                          fontWeight: 700,
                          cursor: 'pointer',
                          fontFamily: "'DM Sans',sans-serif"
                        }
                      }, isActive ? '✓ Active Model' : 'Select Model'),
                      (isActive && s.availableModelDefaults && (s.availableModelDefaults.targetId === c.id || s.target === c.id))
                        ? React.createElement('button', {
                            type: 'button',
                            onClick: () => this.applyModelDefaults(),
                            style: {
                              border: '1px solid #38bdf8',
                              background: 'rgba(56,189,248,.2)',
                              color: '#38bdf8',
                              borderRadius: 6,
                              padding: '6px 10px',
                              fontSize: 11,
                              fontWeight: 700,
                              cursor: 'pointer',
                              fontFamily: "'DM Sans',sans-serif"
                            }
                          }, '⚡ Use model defaults')
                        : null
                    )
                  )
                );
              })
            )
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

    // ── Prompt tools (Enhance via Ollama + Wildcards + LoRA + Active Resource Chips) ─
    const wcFiltered = wildcardFilter
      ? wildcards.filter(w => w.name.toLowerCase().includes(wildcardFilter.toLowerCase()))
      : wildcards;

    const activeLoras = this.getActiveLoras();
    const activeWildcards = this.getActiveWildcards();
    const hasActiveResources = activeLoras.length > 0 || activeWildcards.length > 0 || this.getNegWildcards().length > 0;

    // Active Create LoRA for quick display
    const currentCreateLora = this.state.createLora || {};
    const loraOptions = typeof this._createLoraOptions === 'function' ? this._createLoraOptions() : [];
    const selectedLora = loraOptions.find(l => l.id === currentCreateLora.selectedId) || null;
    const isLoraActive = !!(currentCreateLora.enabled && selectedLora && selectedLora.use_enabled);
    const loraStrength = Number(currentCreateLora.strength ?? (selectedLora && selectedLora.default_weight) ?? 1);

    // LoRA Search Filtering
    const loraQuery = (this.state.loraSearchQuery || '').toLowerCase().trim();
    const filteredLoraOptions = loraOptions.filter(l => !loraQuery || (l.name || l.id || '').toLowerCase().includes(loraQuery) || (l.classification || '').toLowerCase().includes(loraQuery));
    const provenLoraOptions = filteredLoraOptions.filter(l => l.use_enabled);
    const unprovenLoraOptions = filteredLoraOptions.filter(l => !l.use_enabled);

    const promptTools = React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4, width: '100%' } },
      // Top Controls Row
      React.createElement('div', { style: { display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap', position: 'relative' } },
        React.createElement('button', {
          onClick: () => (enhancingPrompt ? this.cancelEnhance() : this.enhancePrompt()),
          'data-enhance': 'true',
          disabled: !ollamaOnline,
          title: ollamaOnline ? ('Enhance prompt with ' + (ollamaModel || 'qwen3.8:27b-mlx')) : 'Ollama offline',
          style: { border: '1px solid ' + (ollamaOnline ? '#a78bfa' : 'rgba(148,163,184,.18)'), background: ollamaOnline ? 'rgba(167,139,250,.12)' : 'transparent', color: ollamaOnline ? '#c4b5fd' : '#5a6678', borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: ollamaOnline ? 'pointer' : 'not-allowed', opacity: ollamaOnline ? 1 : .6, fontFamily: "'DM Sans',sans-serif", fontWeight: 700 }
        }, enhancingPrompt ? '✕ Cancel enhance' : ('✨ Enhance (' + (ollamaModel ? ollamaModel.replace(':latest', '') : 'Ollama') + ')')),

        React.createElement('button', {
          onClick: () => this.setState(s => ({ showWildcards: !s.showWildcards, wildcardFilter: '' })),
          style: { border: '1px solid ' + (showWildcards ? accent : 'rgba(148,163,184,.18)'), background: 'transparent', color: showWildcards ? accent : '#b8c7d6', borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }
        }, wildcardFilter ? ('__ ' + wildcardFilter + '… (' + wcFiltered.length + ')') : ('⊞ Wildcards (' + wildcards.length + ')')),

        React.createElement('button', {
          type: 'button',
          'data-dex-field': 'open-lora-picker',
          'aria-expanded': !!this.state.showLoraPicker,
          'aria-haspopup': 'dialog',
          onClick: () => this.setState(st => ({ showLoraPicker: !st.showLoraPicker, loraSearchQuery: '' })),
          style: {
            border: '1px solid ' + (isLoraActive ? '#65d66e' : this.state.showLoraPicker ? accent : 'rgba(148,163,184,.18)'),
            background: isLoraActive ? 'rgba(101,214,110,.1)' : this.state.showLoraPicker ? 'rgba(255,255,255,.05)' : 'transparent',
            color: isLoraActive ? '#86efac' : this.state.showLoraPicker ? accent : '#b8c7d6',
            borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif",
            fontWeight: isLoraActive ? 700 : 400, display: 'inline-flex', alignItems: 'center', gap: 5
          }
        }, isLoraActive ? `⚡ LoRA: ${selectedLora.name} (${loraStrength.toFixed(2)})` : '⚡ LoRA'),

        s.previousPrompt != null ? React.createElement('button', {
          onClick: () => this.undoEnhancement(),
          title: 'Restore prompt before enhancement',
          style: { border: '1px solid rgba(56,189,248,.3)', background: 'rgba(56,189,248,.08)', color: '#38bdf8', borderRadius: 6, padding: '4px 8px', fontSize: 11, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }
        }, '↺ Undo Enhance') : null,

        // Wildcard dropdown
        showWildcards ? React.createElement('div', {
          style: { position: 'absolute', top: '110%', left: 0, zIndex: 60, background: '#0c1018', border: '1px solid rgba(148,163,184,.2)', borderRadius: 8, padding: 6, display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 240, overflowY: 'auto', minWidth: 260, boxShadow: '0 8px 24px rgba(0,0,0,.5)' }
        },
          wildcardFilter ? React.createElement('div', { style: { fontSize: 10, color: '#5a6678', padding: '2px 6px 5px', borderBottom: '1px solid rgba(148,163,184,.1)', marginBottom: 3, fontFamily: "'IBM Plex Mono',monospace" } }, 'autocomplete: __' + wildcardFilter + '…') : null,
          wcFiltered.length ? wcFiltered.map(w => React.createElement('button', {
            key: w.name,
            onClick: () => wildcardFilter ? this.insertWildcardFiltered(w.name) : this.insertWildcard(w.name),
            style: { textAlign: 'left', border: 'none', background: 'transparent', color: '#c0c0d8', borderRadius: 5, padding: '5px 8px', fontSize: 12, cursor: 'pointer', fontFamily: "'IBM Plex Mono',monospace", display: 'flex', justifyContent: 'space-between', alignItems: 'center' }
          },
            React.createElement('span', null, '__' + w.name + '__'),
            React.createElement('span', { style: { color: '#64748b', fontSize: 10 } }, (w.count || 0) + ' items')
          )) : React.createElement('div', { style: { fontSize: 12, color: '#5a6678', padding: 6 } }, wildcardFilter ? 'No match for "' + wildcardFilter + '"' : 'No wildcards')
        ) : null,

        // LoRA picker popover
        this.state.showLoraPicker ? React.createElement('div', {
          'data-dex-field': 'lora-picker-popover',
          role: 'dialog',
          'aria-label': 'Select LoRA',
          style: {
            position: 'absolute', top: '110%', left: 0, zIndex: 65,
            background: '#0c1018', border: '1px solid rgba(148,163,184,.25)',
            borderRadius: 8, padding: 12, display: 'flex', flexDirection: 'column',
            gap: 8, minWidth: 320, maxWidth: 420, width: '100%',
            boxShadow: '0 12px 32px rgba(0,0,0,.6)'
          }
        },
          React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
            React.createElement('span', { style: { fontSize: 11, fontWeight: 800, color: '#e2e8f0', letterSpacing: '.06em', textTransform: 'uppercase' } }, 'Select LoRA'),
            React.createElement('button', {
              type: 'button',
              'aria-label': 'Close LoRA picker',
              onClick: () => this.setState({ showLoraPicker: false }),
              style: { border: 'none', background: 'transparent', color: '#94a3b8', cursor: 'pointer', fontSize: 14, padding: '0 4px' }
            }, '✕')
          ),
          React.createElement('input', {
            type: 'text',
            placeholder: 'Search installed adapters…',
            'data-dex-field': 'lora-search-input',
            'aria-label': 'Search installed adapters',
            value: this.state.loraSearchQuery || '',
            onInput: e => this.setState({ loraSearchQuery: e.target.value }),
            style: { width: '100%', border: '1px solid rgba(148,163,184,.2)', background: 'rgba(255,255,255,.05)', color: '#f1f5f9', borderRadius: 6, padding: '6px 8px', fontSize: 12, outline: 'none', fontFamily: "'DM Sans',sans-serif" }
          }),
          React.createElement('select', {
            'aria-label': 'Adapter',
            'data-dex-field': 'lora-picker-select',
            value: currentCreateLora.selectedId || '',
            disabled: this.state.jobStatus === 'generating',
            style: { width: '100%', border: '1px solid rgba(148,163,184,.2)', background: '#141418', color: '#f1f5f9', borderRadius: 6, padding: '6px 8px', fontSize: 12, outline: 'none' },
            onChange: e => this.selectCreateLora(e.target.value)
          },
            React.createElement('option', { value: '' }, '(None — LoRA disabled)'),
            provenLoraOptions.length ? React.createElement('optgroup', { label: 'Compatible & Proven' },
              ...provenLoraOptions.map(l => React.createElement('option', { key: l.id, value: l.id }, `${l.name} (${l.classification || 'STYLE'}) · PROVEN`))
            ) : null,
            unprovenLoraOptions.length ? React.createElement('optgroup', { label: 'Incompatible or Unverified' },
              ...unprovenLoraOptions.map(l => React.createElement('option', { key: l.id, value: l.id, disabled: true }, `${l.name} · ${l.unavailable_reason}`))
            ) : null
          ),
          selectedLora ? React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 7, marginTop: 4, borderTop: '1px solid rgba(148,163,184,.15)', paddingTop: 8 } },
            React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
              React.createElement('span', { style: { fontSize: 11, color: '#94a3b8', fontWeight: 600 } }, 'Strength · ' + loraStrength.toFixed(2)),
              React.createElement('input', {
                type: 'number',
                'data-dex-field': 'lora-strength-number',
                'aria-label': 'Exact LoRA strength',
                min: selectedLora.min_weight, max: selectedLora.max_weight, step: selectedLora.step,
                value: loraStrength,
                disabled: !isLoraActive,
                onInput: e => this.setCreateLoraStrength(e.target.value, selectedLora.min_weight, selectedLora.max_weight),
                style: { width: 64, border: '1px solid rgba(148,163,184,.2)', background: 'rgba(255,255,255,.05)', color: '#f1f5f9', borderRadius: 4, padding: '3px 6px', fontSize: 11, textAlign: 'right' }
              })
            ),
            React.createElement('input', {
              type: 'range',
              'data-dex-field': 'lora-strength-slider',
              'aria-label': 'LoRA strength',
              min: selectedLora.min_weight, max: selectedLora.max_weight, step: selectedLora.step,
              value: loraStrength,
              disabled: !isLoraActive,
              onInput: e => this.setCreateLoraStrength(e.target.value, selectedLora.min_weight, selectedLora.max_weight),
              style: { width: '100%', cursor: 'pointer' }
            }),
            React.createElement('div', { style: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 2 } },
              React.createElement('button', {
                type: 'button',
                'data-dex-field': 'remove-lora-btn',
                onClick: () => this.selectCreateLora(''),
                style: { border: '1px solid rgba(239,68,68,.3)', background: 'rgba(239,68,68,.08)', color: '#fca5a5', borderRadius: 5, padding: '4px 8px', fontSize: 11, cursor: 'pointer', fontWeight: 600 }
              }, 'Remove LoRA'),
              selectedLora.trigger_words && selectedLora.trigger_words.length ? React.createElement('button', {
                type: 'button',
                'data-dex-field': 'insert-trigger-btn',
                onClick: () => this.insertTriggerPhrase(selectedLora.trigger_words),
                title: 'Insert "' + selectedLora.trigger_words[0] + '" into prompt',
                style: { border: '1px solid rgba(56,189,248,.3)', background: 'rgba(56,189,248,.08)', color: '#38bdf8', borderRadius: 5, padding: '4px 8px', fontSize: 11, cursor: 'pointer', fontWeight: 600 }
              }, 'Insert trigger (' + selectedLora.trigger_words[0] + ')') : null
            ),
            React.createElement('div', {
              'data-dex-field': 'lora-recipe',
              style: { fontSize: 11, color: '#94a3b8', background: 'rgba(0,0,0,.3)', padding: 7, borderRadius: 6, lineHeight: 1.4 }
            },
              React.createElement('div', { style: { color: isLoraActive ? '#86efac' : '#fbbf24', fontWeight: 700, marginBottom: 2 } },
                isLoraActive ? '● ' + selectedLora.route_status : 'LoRA off'
              ),
              React.createElement('div', null,
                (() => {
                  const r = typeof this._createLoraRecipe === 'function' ? this._createLoraRecipe(selectedLora) : null;
                  const x = r && r.recommended || {};
                  return isLoraActive
                    ? `Effective recipe: ${x.steps || this.state.steps} steps · ${x.sampler || this.state.sampler} · ${x.scheduler || 'engine default'} · CFG ${x.cfg != null ? x.cfg : this.state.cfg}`
                    : `Normal settings: ${this.state.steps} steps · ${this.state.sampler} · ${this.state.scheduler || 'engine default'} · CFG ${this.state.cfg}`;
                })()
              ),
              isLoraActive ? React.createElement('button', {
                type: 'button',
                onClick: () => this.resetCreateLoraRecipe ? this.resetCreateLoraRecipe() : null,
                style: { marginTop: 4, border: 'none', background: 'transparent', color: '#7dd3fc', cursor: 'pointer', fontSize: 10, padding: 0, textDecoration: 'underline' }
              }, 'Reset to recommended settings') : null
            )
          ) : React.createElement('div', { style: { fontSize: 11, color: '#64748b', padding: '4px 0' } }, 'Select an adapter to configure strength and settings.')
        ) : null
      ),

      // Prompt Enhancement Review Box
      s.enhancementResult ? React.createElement('div', {
        'data-prompt-enhancement-review': 'true',
        style: { border: '1px solid rgba(167,139,250,.4)', background: 'rgba(167,139,250,.07)', borderRadius: 8, padding: 10, display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, overflowWrap: 'anywhere' }
      },
        React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
          React.createElement('div', { style: { fontSize: 11, fontWeight: 800, color: '#c4b5fd' } }, '✨ Prompt Enhancement Review (' + (s.enhancementResult.profile || target) + ')'),
          React.createElement('button', { onClick: () => this.dismissEnhancement(), style: { border: 'none', background: 'transparent', color: '#94a3b8', cursor: 'pointer', fontSize: 13 } }, '×')
        ),
        React.createElement('div', { style: { fontSize: 10, fontWeight: 700, color: '#94a3b8' } }, 'ORIGINAL'),
        React.createElement('div', { style: { fontSize: 11, color: '#cbd5e1' } }, s.enhancementResult.original),
        React.createElement('div', { style: { fontSize: 10, fontWeight: 700, color: '#c4b5fd' } }, 'ENHANCED'),
        React.createElement('div', { style: { fontSize: 12, color: '#f1f5f9', background: 'rgba(0,0,0,.3)', padding: 6, borderRadius: 5, lineHeight: 1.4, maxHeight: 140, overflowY: 'auto' } }, s.enhancementResult.enhanced),
        s.enhancementResult.explanation ? React.createElement('div', { style: { fontSize: 11, color: '#7dd3fc' } }, 'Why: ' + s.enhancementResult.explanation) : null,
        s.enhancementResult.suggested_settings ? React.createElement('button', {
          onClick: () => this.applySuggestedSettings(s.enhancementResult.suggested_settings),
          style: { alignSelf: 'flex-start', border: '1px solid rgba(101,214,110,.4)', background: 'rgba(101,214,110,.1)', color: '#86efac', borderRadius: 5, padding: '3px 8px', fontSize: 10, cursor: 'pointer', fontWeight: 700 }
        }, '⚙ Apply suggested: ' + Object.entries(s.enhancementResult.suggested_settings).map(([k, v]) => k + '=' + v).join(', ')) : null,
        React.createElement('div', { style: { display: 'flex', gap: 6, marginTop: 4, paddingTop: 4, borderTop: '1px solid rgba(167,139,250,.2)', flexWrap: 'wrap' } },
          React.createElement('button', {
            onClick: () => this.applyEnhancement(),
            style: { border: '1px solid rgba(167,139,250,.6)', background: 'rgba(167,139,250,.2)', color: '#e9d5ff', borderRadius: 6, padding: '5px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }
          }, 'Apply Enhancement'),
          React.createElement('button', {
            onClick: () => this.appendEnhancement(),
            style: { border: '1px solid rgba(148,163,184,.2)', background: 'rgba(255,255,255,.05)', color: '#cbd5e1', borderRadius: 6, padding: '5px 10px', fontSize: 11, cursor: 'pointer' }
          }, 'Append'),
          React.createElement('button', {
            onClick: () => this.dismissEnhancement(),
            style: { border: 'none', background: 'transparent', color: '#94a3b8', padding: '5px 8px', fontSize: 11, cursor: 'pointer' }
          }, 'Cancel')
        )
      ) : null,

      // Active Resource Chips
      hasActiveResources ? React.createElement('div', { style: { display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center', marginTop: 2 } },
        React.createElement('span', { style: { fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 700 } }, 'Active:'),
        // LoRA chips
        ...activeLoras.map(l => {
          const loraAsset = (assets.loras || []).find(a => a.name.toLowerCase() === l.name.toLowerCase() || a.filename.toLowerCase().startsWith(l.name.toLowerCase()));
          const compat = loraAsset ? loraAsset.compatibility : 'Unknown';
          const compatTone = compat === 'Compatible' ? '#65d66e' : compat === 'Probably compatible' ? '#fbbf24' : compat === 'Incompatible' ? '#ef4444' : '#94a3b8';

          return React.createElement('span', {
            key: l.token,
            style: { display: 'inline-flex', alignItems: 'center', gap: 4, border: '1px solid rgba(148,163,184,.18)', background: 'rgba(15,23,42,.8)', borderRadius: 6, padding: '2px 6px', fontSize: 11, fontFamily: "'IBM Plex Mono',monospace" }
          },
            React.createElement('span', { style: { color: compatTone } }, '●'),
            React.createElement('span', { style: { color: '#e2e8f0' } }, l.name),
            React.createElement('button', {
              onClick: () => this.setLoraWeight(l.name, Math.max(0, l.weight - 0.1)),
              style: { border: 'none', background: 'transparent', color: '#94a3b8', cursor: 'pointer', padding: '0 2px' }
            }, '-'),
            React.createElement('span', { style: { color: '#38bdf8', fontWeight: 700 } }, l.weight.toFixed(2)),
            React.createElement('button', {
              onClick: () => this.setLoraWeight(l.name, Math.min(2, l.weight + 0.1)),
              style: { border: 'none', background: 'transparent', color: '#94a3b8', cursor: 'pointer', padding: '0 2px' }
            }, '+'),
            React.createElement('button', {
              onClick: () => this.removeLora(l.token),
              title: 'Remove LoRA',
              style: { border: 'none', background: 'transparent', color: '#f87171', cursor: 'pointer', marginLeft: 2, fontWeight: 700 }
            }, '×')
          );
        }),
        // Wildcard chips: any number, reorderable, movable between positive and negative (buttons, so keyboard and touch work)
        ...activeWildcards.map((w, i) => {
          const bank = wildcards.find(b => b.name.toLowerCase() === w.name.toLowerCase());
          const count = bank ? bank.count : '?';
          const mini = (label, title, onClick, disabled) => React.createElement('button', { type: 'button', onClick, disabled: !!disabled, title, 'aria-label': title,
            style: { border: 'none', background: 'transparent', color: disabled ? '#475569' : '#c4b5fd', cursor: disabled ? 'default' : 'pointer', padding: '2px 4px', minWidth: 22, minHeight: 22, fontWeight: 700 } }, label);
          return React.createElement('span', {
            key: w.token + ':' + i, 'data-wildcard-chip': 'positive',
            style: { display: 'inline-flex', alignItems: 'center', gap: 2, border: '1px solid rgba(167,139,250,.3)', background: 'rgba(167,139,250,.1)', borderRadius: 6, padding: '2px 4px', fontSize: 11, fontFamily: "'IBM Plex Mono',monospace", color: '#d8b4fe' }
          },
            mini('◀', 'Move ' + w.token + ' earlier', () => this.moveWildcard(i, -1), i === 0),
            '⊞ __' + w.name + '__',
            React.createElement('span', { style: { color: '#94a3b8', fontSize: 10 } }, '(' + count + ')'),
            mini('▶', 'Move ' + w.token + ' later', () => this.moveWildcard(i, 1), i === activeWildcards.length - 1),
            mini('→ neg', 'Move ' + w.token + ' to the negative prompt', () => this.moveWildcardAcross(i, true)),
            React.createElement('button', {
              onClick: () => this.removeWildcard(w.token),
              title: 'Remove Wildcard', 'aria-label': 'Remove ' + w.token,
              style: { border: 'none', background: 'transparent', color: '#f87171', cursor: 'pointer', marginLeft: 2, fontWeight: 700, minWidth: 22, minHeight: 22 }
            }, '×')
          );
        }),
        ...this.getNegWildcards().map((w, i) => React.createElement('span', {
          key: 'neg:' + w.token + ':' + i, 'data-wildcard-chip': 'negative',
          style: { display: 'inline-flex', alignItems: 'center', gap: 2, border: '1px solid rgba(248,113,113,.35)', background: 'rgba(248,113,113,.08)', borderRadius: 6, padding: '2px 4px', fontSize: 11, fontFamily: "'IBM Plex Mono',monospace", color: '#fca5a5' }
        }, 'neg ⊞ __' + w.name + '__',
          React.createElement('button', { type: 'button', onClick: () => this.moveWildcardAcross(i, false), title: 'Move ' + w.token + ' to the prompt', 'aria-label': 'Move ' + w.token + ' to the prompt',
            style: { border: 'none', background: 'transparent', color: '#c4b5fd', cursor: 'pointer', padding: '2px 4px', minWidth: 22, minHeight: 22, fontWeight: 700 } }, '→ pos')))
      ) : null
    );

    // ── Negative prompt tools (Enhance via Ollama + Wildcards + Review) ──────
    const controls = DexClient.controlsFor(target);
    const targetObj = (this.state.modelTargets || []).find(t => t.id === target);
    const targetCard = (this.state.modelCards || []).find(c => c.id === target);
    const negativePromptSupported = !!controls.negativePrompt;
    const negWildcards = this.getNegWildcards();
    const negWcFiltered = (wildcards || []).filter(w => !this.state.negWildcardFilter || w.name.toLowerCase().includes(this.state.negWildcardFilter.toLowerCase()));

    const negativePromptTools = negativePromptSupported ? React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4, width: '100%' } },
      React.createElement('div', { style: { display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap', position: 'relative' } },
        React.createElement('button', {
          type: 'button',
          onClick: () => (this.state.enhancingNegPrompt ? this.cancelNegEnhance() : this.enhanceNegativePrompt()),
          'data-enhance-negative': 'true',
          disabled: !ollamaOnline,
          title: ollamaOnline ? ('Enhance negative prompt with ' + (ollamaModel || 'Ollama')) : 'Ollama offline',
          style: { border: '1px solid ' + (ollamaOnline ? '#a78bfa' : 'rgba(148,163,184,.18)'), background: ollamaOnline ? 'rgba(167,139,250,.12)' : 'transparent', color: ollamaOnline ? '#c4b5fd' : '#5a6678', borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: ollamaOnline ? 'pointer' : 'not-allowed', opacity: ollamaOnline ? 1 : .6, fontFamily: "'DM Sans',sans-serif", fontWeight: 700 }
        }, this.state.enhancingNegPrompt ? '✕ Cancel enhance' : ('✨ Enhance Negative' + (ollamaModel ? ' (' + ollamaModel.replace(':latest', '') + ')' : ''))),

        React.createElement('button', {
          type: 'button',
          onClick: () => this.setState(st => ({ showNegWildcards: !st.showNegWildcards, negWildcardFilter: '' })),
          style: { border: '1px solid ' + (this.state.showNegWildcards ? accent : 'rgba(148,163,184,.18)'), background: 'transparent', color: this.state.showNegWildcards ? accent : '#b8c7d6', borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }
        }, this.state.negWildcardFilter ? ('__ ' + this.state.negWildcardFilter + '… (' + negWcFiltered.length + ')') : ('⊞ Wildcards (' + wildcards.length + ')')),

        this.state.previousNegPrompt != null ? React.createElement('button', {
          type: 'button',
          onClick: () => this.undoNegEnhancement(),
          title: 'Restore negative prompt before enhancement',
          style: { border: '1px solid rgba(56,189,248,.3)', background: 'rgba(56,189,248,.08)', color: '#38bdf8', borderRadius: 6, padding: '4px 8px', fontSize: 11, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }
        }, '↺ Undo Enhance') : null,

        this.state.showNegWildcards ? React.createElement('div', {
          style: { position: 'absolute', top: '110%', left: 0, zIndex: 60, background: '#0c1018', border: '1px solid rgba(148,163,184,.2)', borderRadius: 8, padding: 6, display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 240, overflowY: 'auto', minWidth: 260, boxShadow: '0 8px 24px rgba(0,0,0,.5)' }
        },
          this.state.negWildcardFilter ? React.createElement('div', { style: { fontSize: 10, color: '#5a6678', padding: '2px 6px 5px', borderBottom: '1px solid rgba(148,163,184,.1)', marginBottom: 3, fontFamily: "'IBM Plex Mono',monospace" } }, 'autocomplete: __' + this.state.negWildcardFilter + '…') : null,
          negWcFiltered.length ? negWcFiltered.map(w => React.createElement('button', {
            key: w.name,
            type: 'button',
            onClick: () => this.insertNegWildcard(w.name),
            style: { textAlign: 'left', border: 'none', background: 'transparent', color: '#c0c0d8', borderRadius: 5, padding: '5px 8px', fontSize: 12, cursor: 'pointer', fontFamily: "'IBM Plex Mono',monospace", display: 'flex', justifyContent: 'space-between', alignItems: 'center' }
          },
            React.createElement('span', null, '__' + w.name + '__'),
            React.createElement('span', { style: { color: '#64748b', fontSize: 10 } }, (w.count || 0) + ' items')
          )) : React.createElement('div', { style: { fontSize: 12, color: '#5a6678', padding: 6 } }, this.state.negWildcardFilter ? 'No match for "' + this.state.negWildcardFilter + '"' : 'No wildcards')
        ) : null
      ),

      this.state.negEnhancementResult ? React.createElement('div', {
        'data-negative-enhancement-review': 'true',
        style: { border: '1px solid rgba(167,139,250,.4)', background: 'rgba(167,139,250,.07)', borderRadius: 8, padding: 10, display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, overflowWrap: 'anywhere' }
      },
        React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
          React.createElement('div', { style: { fontSize: 11, fontWeight: 800, color: '#c4b5fd' } }, '✨ Negative Prompt Enhancement Review'),
          React.createElement('button', { type: 'button', onClick: () => this.dismissNegEnhancement(), style: { border: 'none', background: 'transparent', color: '#94a3b8', cursor: 'pointer', fontSize: 13 } }, '×')
        ),
        React.createElement('div', { style: { fontSize: 10, fontWeight: 700, color: '#94a3b8' } }, 'ORIGINAL'),
        React.createElement('div', { style: { fontSize: 11, color: '#cbd5e1' } }, this.state.negEnhancementResult.original),
        React.createElement('div', { style: { fontSize: 10, fontWeight: 700, color: '#c4b5fd' } }, 'ENHANCED (WHAT TO AVOID)'),
        React.createElement('div', { style: { fontSize: 12, color: '#f1f5f9', background: 'rgba(0,0,0,.3)', padding: 6, borderRadius: 5, lineHeight: 1.4, maxHeight: 140, overflowY: 'auto' } }, this.state.negEnhancementResult.enhanced),
        this.state.negEnhancementResult.explanation ? React.createElement('div', { style: { fontSize: 11, color: '#7dd3fc' } }, 'Why: ' + this.state.negEnhancementResult.explanation) : null,
        React.createElement('div', { style: { display: 'flex', gap: 6, marginTop: 4, paddingTop: 4, borderTop: '1px solid rgba(167,139,250,.2)', flexWrap: 'wrap' } },
          React.createElement('button', {
            type: 'button',
            onClick: () => this.applyNegEnhancement(),
            style: { border: '1px solid rgba(167,139,250,.6)', background: 'rgba(167,139,250,.2)', color: '#e9d5ff', borderRadius: 6, padding: '5px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }
          }, 'Apply Enhancement'),
          React.createElement('button', {
            type: 'button',
            onClick: () => this.appendNegEnhancement(),
            style: { border: '1px solid rgba(148,163,184,.2)', background: 'rgba(255,255,255,.05)', color: '#cbd5e1', borderRadius: 6, padding: '5px 10px', fontSize: 11, cursor: 'pointer' }
          }, 'Append'),
          React.createElement('button', {
            type: 'button',
            onClick: () => this.dismissNegEnhancement(),
            style: { border: 'none', background: 'transparent', color: '#94a3b8', padding: '5px 8px', fontSize: 11, cursor: 'pointer' }
          }, 'Cancel')
        )
      ) : null
    ) : null;

    // ── Dynamic target selects (populated from /api/capabilities) ─
    const _makeTargetSelect = (labelStyle, selStyle) => {
      const opts = checkpoints.length > 0
        ? checkpoints.map(cp => React.createElement('option', { key: cp.name, value: cp.name }, cp.title || cp.name))
        : [React.createElement('option', { key: '_cur', value: target }, loadingCheckpoints ? 'Loading models…' : (target || 'sd15'))];
      return React.createElement('div', null,
        React.createElement('div', { style: labelStyle }, 'Target model'),
        React.createElement('select', { style: selStyle, value: target, onChange: e => this.selectModelWithValidation(e.target.value) }, ...opts));
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

    // ── Extra Networks (LoRA, Embeddings, VAE) panel ───────────
    const extraNetworksTab = s.extraNetworksTab || 'loras';
    const assetQuery = (s.assetQuery || '').toLowerCase().trim();
    const lorasList = (assets.loras || []).filter(item => !assetQuery || (item.name || item.filename || '').toLowerCase().includes(assetQuery));
    const vaesList = (assets.vaes || []).filter(item => !assetQuery || (item.name || item.filename || '').toLowerCase().includes(assetQuery));
    const embeddingsState = assets.embeddings || { count: 0, items: [], empty_state_message: 'No Textual Inversion embeddings discovered' };

    const extraNetworksDisplay = React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
      // Tabs header
      React.createElement('div', { style: { display: 'flex', gap: 6, borderBottom: '1px solid rgba(148,163,184,.14)', paddingBottom: 6 } },
        React.createElement('button', {
          type: 'button',
          onClick: () => this.setState({ extraNetworksTab: 'loras' }),
          style: { border: 'none', background: 'transparent', color: extraNetworksTab === 'loras' ? accent : '#64748b', fontSize: 12, fontWeight: 700, cursor: 'pointer', borderBottom: extraNetworksTab === 'loras' ? '2px solid ' + accent : 'none', padding: '4px 8px' }
        }, 'LoRAs (' + (assets.loras || []).length + ')'),
        React.createElement('button', {
          type: 'button',
          onClick: () => this.setState({ extraNetworksTab: 'embeddings' }),
          style: { border: 'none', background: 'transparent', color: extraNetworksTab === 'embeddings' ? accent : '#64748b', fontSize: 12, fontWeight: 700, cursor: 'pointer', borderBottom: extraNetworksTab === 'embeddings' ? '2px solid ' + accent : 'none', padding: '4px 8px' }
        }, 'Embeddings (' + (embeddingsState.count || 0) + ')'),
        React.createElement('button', {
          type: 'button',
          onClick: () => this.setState({ extraNetworksTab: 'vaes' }),
          style: { border: 'none', background: 'transparent', color: extraNetworksTab === 'vaes' ? accent : '#64748b', fontSize: 12, fontWeight: 700, cursor: 'pointer', borderBottom: extraNetworksTab === 'vaes' ? '2px solid ' + accent : 'none', padding: '4px 8px' }
        }, 'VAEs (' + (assets.vaes || []).length + ')')
      ),

      // Search input
      React.createElement('input', {
        value: s.assetQuery || '',
        onChange: e => this.setState({ assetQuery: e.target.value }),
        placeholder: 'Search ' + extraNetworksTab + '…',
        style: { width: '100%', border: '1px solid rgba(148,163,184,.16)', background: 'rgba(5,10,18,.72)', color: '#e2e8f0', borderRadius: 7, padding: '7px 9px', outline: 'none', fontSize: 12, fontFamily: "'DM Sans',sans-serif" }
      }),

      // Tab Content: LoRAs
      extraNetworksTab === 'loras' ? React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 380, overflowY: 'auto' } },
        loadingAssets ? React.createElement('div', { style: { fontSize: 12, color: '#38bdf8' } }, 'Scanning LoRAs…') :
        lorasList.length === 0 ? React.createElement('div', { style: { fontSize: 12, color: '#64748b', fontStyle: 'italic' } }, 'No LoRAs match search.') :
        lorasList.map(l => {
          const baseName = l.name.replace(/\.[^.]+$/, '');
          const inPrompt = (prompt || '').includes('<lora:' + baseName);
          const activeWeight = (activeLoras.find(a => a.name === baseName) || {}).weight ?? s.loraWeights[l.id] ?? l.default_weight ?? 0.8;
          const loraProven = l.proof_status === 'PROVEN';
          const compatTone = l.compatibility === 'Compatible' ? '#65d66e' : l.compatibility === 'Probably compatible' ? '#fbbf24' : l.compatibility === 'Incompatible' ? '#ef4444' : '#94a3b8';

          return React.createElement('div', {
            key: l.id,
            style: { border: '1px solid rgba(148,163,184,.14)', background: 'rgba(9,20,32,.7)', borderRadius: 8, padding: 9, display: 'flex', flexDirection: 'column', gap: 6 }
          },
            // Title & compatibility badges
            React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
              React.createElement('div', { style: { fontSize: 12, fontWeight: 700, color: '#e2e8f0', fontFamily: "'IBM Plex Mono',monospace" } }, l.name),
              React.createElement('div', { style: { display: 'flex', gap: 4 } },
                React.createElement('span', { style: { border: '1px solid rgba(148,163,184,.2)', background: 'rgba(255,255,255,.04)', color: '#94a3b8', borderRadius: 4, padding: '1px 5px', fontSize: 9 } }, l.family.toUpperCase()),
                React.createElement('span', { style: { border: '1px solid ' + compatTone + '55', background: compatTone + '15', color: compatTone, borderRadius: 4, padding: '1px 5px', fontSize: 9, fontWeight: 700 } }, l.compatibility)
              )
            ),

            l.description ? React.createElement('div', { style: { fontSize: 10, lineHeight: 1.35, color: '#94a3b8' } }, l.description) : null,
            React.createElement('div', { role: 'status', style: { color: loraProven ? '#65d66e' : '#fbbf24', fontSize: 10 } }, loraProven ? 'Generation verified' : 'File installed; generation not verified'),
            (() => {
              let url = null;
              try {
                const parsed = new URL(l.source_url || '');
                if (parsed.protocol === 'https:' && parsed.hostname && !parsed.username && !parsed.password) url = parsed.href;
              } catch (_) {}
              return url
                ? React.createElement('a', {
                    href: url, target: '_blank', rel: 'noopener noreferrer',
                    'aria-label': 'Source for LoRA ' + l.name + ' (opens in a new tab)',
                    onClick: event => event.stopPropagation(),
                    style: { alignSelf: 'flex-start', border: '1px solid rgba(148,163,184,.38)', borderRadius: 5, padding: '3px 7px', color: '#cbd5e1', background: 'rgba(255,255,255,.035)', fontSize: 10, fontWeight: 700, textDecoration: 'none', outlineOffset: 2 }
                  }, 'Source ↗')
                : React.createElement('span', { role: 'status', style: { color: '#64748b', fontSize: 10 } }, 'Source unavailable');
            })(),

            // Weight controls
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
              React.createElement('span', { style: { fontSize: 10, color: '#7f8ca8', textTransform: 'uppercase' } }, 'Weight:'),
              React.createElement('input', {
                type: 'range',
                min: '0',
                max: '2',
                step: '0.05',
                value: activeWeight,
                disabled: !loraProven,
                onChange: e => {
                  const val = parseFloat(e.target.value);
                  this.setState(st => ({ loraWeights: { ...st.loraWeights, [l.id]: val } }));
                  if (inPrompt) this.setLoraWeight(baseName, val);
                },
                style: { flex: 1, accentColor: accent }
              }),
              React.createElement('span', { style: { fontSize: 11, color: '#38bdf8', fontFamily: "'IBM Plex Mono',monospace", width: 34 } }, activeWeight.toFixed(2))
            ),

            // Trigger words
            l.trigger_words && l.trigger_words.length ? React.createElement('div', { style: { display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' } },
              React.createElement('span', { style: { fontSize: 10, color: '#64748b' } }, 'Triggers:'),
              ...l.trigger_words.map(tw => React.createElement('button', {
                key: tw,
                type: 'button',
                disabled: !loraProven,
                onClick: () => this.addTriggerWord(tw),
                title: 'Click to add to prompt',
                style: { border: '1px solid rgba(56,189,248,.3)', background: 'rgba(56,189,248,.08)', color: '#7dd3fc', borderRadius: 4, padding: '1px 6px', fontSize: 10, cursor: 'pointer' }
              }, '+ ' + tw))
            ) : null,

            // Action Buttons
            React.createElement('div', { style: { display: 'flex', gap: 6, marginTop: 2 } },
              inPrompt
                ? React.createElement('button', {
                    type: 'button',
                    onClick: () => this.removeLora('<lora:' + baseName),
                    style: { border: '1px solid rgba(239,68,68,.4)', background: 'rgba(239,68,68,.1)', color: '#f87171', borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }
                  }, 'Remove from Prompt')
                : React.createElement('button', {
                    type: 'button',
                    disabled: !loraProven,
                    onClick: () => this.insertLora(l.filename || l.name, activeWeight),
                    style: { border: '1px solid ' + accent, background: accent + '18', color: accent, borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }
                  }, 'Add to Prompt'),
              React.createElement('button', {
                type: 'button',
                disabled: !loraProven,
                onClick: () => {
                  this.setState(st => ({ loraWeights: { ...st.loraWeights, [l.id]: 0.8 } }));
                  if (inPrompt) this.setLoraWeight(baseName, 0.8);
                },
                style: { border: '1px solid rgba(148,163,184,.18)', background: 'transparent', color: '#94a3b8', borderRadius: 6, padding: '4px 8px', fontSize: 11, cursor: 'pointer' }
              }, 'Reset')
            )
          );
        })
      ) : null,

      // Tab Content: Embeddings (Honest Empty State)
      extraNetworksTab === 'embeddings' ? React.createElement('div', {
        style: { border: '1px solid rgba(148,163,184,.16)', background: 'rgba(9,20,32,.7)', borderRadius: 8, padding: 16, display: 'flex', flexDirection: 'column', gap: 8, textAlign: 'center' }
      },
        React.createElement('div', { style: { fontSize: 13, fontWeight: 700, color: '#cbd5e1' } }, embeddingsState.empty_state_message || 'No Textual Inversion embeddings discovered'),
        React.createElement('div', { style: { fontSize: 11, color: '#94a3b8', lineHeight: 1.4 } },
          'SDCPP supports .bin and .safetensors textual inversion embeddings in the configured directory, but none are currently staged.'
        ),
        React.createElement('div', { style: { background: 'rgba(5,10,18,.8)', border: '1px solid rgba(148,163,184,.1)', borderRadius: 6, padding: '6px 10px', fontSize: 10, color: '#38bdf8', fontFamily: "'IBM Plex Mono',monospace", margin: '4px 0' } },
          '/Volumes/wc2tb/ImageGen/embeddings'
        ),
        React.createElement('div', { style: { fontSize: 10, color: '#64748b' } },
          'To use embeddings, drop compatible files into the directory above and click Discover Assets.'
        )
      ) : null,

      // Tab Content: VAEs
      extraNetworksTab === 'vaes' ? React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 380, overflowY: 'auto' } },
        vaesList.length === 0 ? React.createElement('div', { style: { fontSize: 12, color: '#64748b' } }, 'No VAEs discovered.') :
        vaesList.map(v => {
          const isSelected = s.selectedVae === v.filename;
          return React.createElement('div', {
            key: v.id,
            style: { border: '1px solid ' + (isSelected ? '#65d66e' : 'rgba(148,163,184,.14)'), background: isSelected ? 'rgba(101,214,110,.08)' : 'rgba(9,20,32,.7)', borderRadius: 8, padding: 9, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }
          },
            React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
              React.createElement('span', { style: { fontSize: 12, color: '#e2e8f0', fontFamily: "'IBM Plex Mono',monospace" } }, v.name || v.filename),
              React.createElement('span', { style: { fontSize: 10, color: '#94a3b8' } }, 'Family: ' + v.family + ' · ' + v.compatibility)
            ),
            React.createElement('button', {
              type: 'button',
              onClick: () => {
                this.setState({ selectedVae: v.filename });
                this.toast('Selected VAE: ' + v.filename, '#65d66e');
              },
              style: { border: '1px solid ' + (isSelected ? '#65d66e' : '#38bdf8'), background: 'transparent', color: isSelected ? '#65d66e' : '#38bdf8', borderRadius: 6, padding: '4px 8px', fontSize: 11, cursor: 'pointer', fontWeight: 700 }
            }, isSelected ? '✓ Active VAE' : 'Select VAE')
          );
        })
      ) : null
    );

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
    const createRecipes = s.favoritePresets.filter(p => (p.mode || 'create') === 'create');
    const favoritePresetRows = createRecipes.length
      ? h('div', { style: { display: 'grid', gap: 5, maxHeight: 160, overflowY: 'auto' } },
          ...createRecipes.map(p => h('div', { key: p.id, style: { display: 'flex', alignItems: 'center', gap: 6, border: '1px solid rgba(148,163,184,.12)', borderRadius: 7, padding: 6, background: 'rgba(5,10,18,.46)' } },
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
    const vaes = (assets && assets.vaes) || [];
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
        actionButton('Send result to img2img', () => this.sendActiveResultToEdit('img2img'), '#a78bfa')),
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
    // A partial or unexpected /api/system-info payload must never break renderVals: when it did,
    // one malformed field blanked the whole Studio (not just the System screen).
    let systemInfoPanel;
    try {
    systemInfoPanel = h('div', { style: { border: '1px solid rgba(56,189,248,.22)', background: 'rgba(6,10,16,.64)', borderRadius: 9, padding: 12, marginBottom: 12 } },
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
          siRow('Slot state', si.modelState.secondaryModelState),
          siRow('Active secondary', si.modelState.activeSecondaryModel || 'none'),
          siRow('Active path', si.modelState.activePath || 'none', true),
          siRow('Last switch', si.modelState.lastSwitchResult && (si.modelState.lastSwitchResult.status || si.modelState.lastSwitchResult), true),
          siRow('Revision', si.sdcpp.revision, true),
          siRow('Binary', si.sdcpp.binary, true),
          siRow('Models', si.sdcpp.models.map(m => m.path + ' (' + m.license + ')').join(' · '), true),
          siRow('Other targets', si.sdcpp.otherTargets),
        ]),
        h('div', { style: { color: '#7f93a8', fontSize: 11, marginTop: 10 } }, 'Docs: ' + si.app.docs + ' · state: ' + si.app.operationalState + ' · terminal: bin/dexdiffusion status · checked ' + si.checkedAt)));
    } catch (_) {
      systemInfoPanel = h('div', { role: 'status', 'data-system-info': 'incomplete', style: { border: '1px solid rgba(251,191,36,.35)', background: 'rgba(251,191,36,.07)', borderRadius: 9, padding: 12, marginBottom: 12, color: '#fbbf24', fontSize: 12, lineHeight: 1.5 } },
        'The system information this build received is incomplete, so the About panel is hidden rather than showing wrong values. Everything else in Studio still works; reload or check GET /api/system-info on the console.');
    }

    const keyboardHelp = h('div', { style: { border: '1px solid rgba(148,163,184,.12)', borderRadius: 8, padding: 9, color: '#94a3b8', fontSize: 11, lineHeight: 1.6, marginBottom: 10, background: 'rgba(5,10,18,.38)' } },
      'Keyboard shortcuts: Command+Enter generate · / focus prompt · P collapse prompt · S settings · L library');

    // ── Toast overlay ─────────────────────────────────────────
    const toastOverlay = React.createElement('div', {
      style: { position: 'fixed', bottom: 20, right: 20, display: 'flex', flexDirection: 'column', gap: 8, zIndex: 9999, pointerEvents: 'none' }
    }, ...toasts.map(t => React.createElement('div', { key: t.id,
      style: { background: 'rgba(14,14,20,.96)', border: '1px solid ' + t.color, borderLeft: '3px solid ' + t.color, borderRadius: 8, padding: '9px 14px', fontSize: 13, color: t.color, fontFamily: "'DM Sans',sans-serif", fontWeight: 600, backdropFilter: 'blur(8px)', maxWidth: 360, lineHeight: 1.4 } },
      t.msg
    )));

    return {
      version, versionStr: String(version), screen, compactModeStr: String(s.compactMode),
      devModeStr: String((() => { try { return window.DexStudioNav.isDeveloperMode(localStorage, window.location); } catch (_) { return false; } })()),
      isV1: version===1, isV2: version===2, isV3: version===3, isV4: version===4, isLegacy: version !== 4,
      isV1Str: String(version===1), isV2Str: String(version===2), isV3Str: String(version===3), isV4Str: String(version===4),
      setV1: ()=>this.setVersion(1), setV2: ()=>this.setVersion(2), setV3: ()=>this.setVersion(3), setV4: ()=>this.setVersion(4),
      isCreate: screen==='create', isBatch: screen==='batch', isEdit: screen==='edit',
      isEnhance: screen==='enhance', isLibrary: screen==='library', isWorld: screen==='world', is3d: screen==='3d', isModels: screen==='models', isSystem: screen==='system',
      isSwap: screen==='swap',
      isCreateStr: String(screen==='create'), isBatchStr: String(screen==='batch'),
      isEditStr: String(screen==='edit'), isEnhanceStr: String(screen==='enhance'),
      isLibraryStr: String(screen==='library'), isWorldStr: String(screen==='world'), is3dStr: String(screen==='3d'), isModelsStr: String(screen==='models'), isSystemStr: String(screen==='system'),
      isSwapStr: String(screen==='swap'),
      navCreate: ()=>this.setScreen('create'), navBatch: ()=>this.setScreen('batch'),
      navEdit: ()=>this.setScreen('edit'), navEnhance: ()=>this.setScreen('enhance'),
      navLibrary: ()=>this.setScreen('library'), navWorld: ()=>this.setScreen('world'), nav3d: ()=>this.setScreen('3d'), navModels: ()=>this.setScreen('models'), navSystem: ()=>this.setScreen('system'),
      navSwap: ()=>this.setScreen('swap'),
      // T-402: exactly one canonical chip row, built from the shared 14-category registry. The array
      // reference is cached per (version, screen) so an unrelated render tick never rebuilds the nav
      // (and therefore never steals focus or scroll from the user).
      navChips: (() => {
        const Nav = window.DexStudioNav;
        if (!Nav) return [];
        const key = version + '|' + screen + '|' + (s.studioSubroute || '');
        if (!this._navChips || this._navChipsKey !== key) {
          this._navChipsKey = key;
          this._navChips = Nav.chips({ activeScreen: screen, onSelect: id => this.setScreen(id) });
        }
        return this._navChips;
      })(),
      // Unified Studio masters layout (opt-in). Cached per (version, screen) like navChips, so unrelated renders
      // never rebuild the bars.
      isMastersLayout: version === 2 && s.studioLayout === 'masters',
      isFlatLayout: !(version === 2 && s.studioLayout === 'masters'),
      studioLayout: s.studioLayout,
      onStudioLayoutChange: e => this.setStudioLayout(e.target.value),
      isChat: version === 2 && s.studioLayout === 'masters' && screen === 'chat',
      ...(() => {
        const Nav = window.DexStudioNav;
        if (!Nav || version !== 2 || s.studioLayout !== 'masters') return { navMasters: [], navSubnav: [], navUtilities: [], hasSubnav: false, subnavLabel: '' };
        const key = version + '|' + screen;
        if (!this._navMastersBars || this._navMastersKey !== key) {
          this._navMastersKey = key;
          const master = Nav.masterOf(screen);
          const m = Nav.MASTERS.find(x => x.id === master);
          this._navMastersBars = {
            navMasters: Nav.masters({ activeScreen: screen, onSelect: id => this.selectStudioMaster(id) }),
            navSubnav: master ? Nav.subroutes(master, screen, s.studioSubroute, { onSelect: id => this.selectStudioSubroute(id) }) : [],
            // The Jobs utility is the existing Jobs drawer button (it carries the live job count), so it is not repeated here.
            navUtilities: Nav.utilities({ activeScreen: screen, onSelect: id => this.selectStudioUtility(id) }).filter(u => u.drawer !== 'true'),
            hasSubnav: !!master,
            subnavLabel: m ? m.label + ' screens' : '',
          };
        }
        return this._navMastersBars;
      })(),
      hasNavReturn: !!(version === 2 && s.studioLayout === 'masters' && s.navReturnTo),
      navReturnLabel: s.navReturnTo && window.DexStudioNav ? 'Back to ' + window.DexStudioNav.leafLabel(s.navReturnTo.leaf) : '',
      onNavReturn: () => this.navReturn(),
      onMasterBarKeyDown: e => this.onStudioBarKeyDown(e, '[data-master-tab]'),
      onSubnavKeyDown: e => this.onStudioBarKeyDown(e, '[data-subnav-leaf]'),
      onMobileMasterSelect: id => this.selectStudioMaster(id),
      chatWorkspace: version === 2 && s.studioLayout === 'masters' && screen === 'chat' ? this.buildChatPlaceholder() : null,
      navScrollBack: ()=>this.scrollStudioNav(-1),
      navScrollForward: ()=>this.scrollStudioNav(1),
      swapWorkspace: this.buildSwapWorkspace(),
      // Create form
      prompt, negPrompt, steps: String(steps), cfg: String(cfg), seed: String(seed),
      width: String(width), height: String(height), promptLen: String(prompt.length),
      dimensionSummary: (() => { const d = DexClient.dimensionInfo(width, height); return d.aspectRatio + ' · ' + d.megapixels + ' MP'; })(),
      onPromptChange: e=>this.onPromptChange(e),
      promptPanelDisplay: promptOpen ? 'block' : 'none',
      promptToggleLabel: promptOpen ? 'Hide prompt' : 'Show prompt',
      promptChevron: promptOpen ? '▴' : '▾',
      onTogglePrompt: ()=>this.setState(s => ({promptOpen: !s.promptOpen})),
      negPanelDisplay: (s.negPromptOpen || false) ? 'block' : 'none',
      negToggleLabel: (s.negPromptOpen || false) ? 'Hide' : 'Show',
      negChevron: (s.negPromptOpen || false) ? '▴' : '▾',
      onToggleNegPrompt: () => this.setState(st => ({ negPromptOpen: !st.negPromptOpen })),
      onNegChange: e => {
        const val = e.target.value;
        if (/<lora:/i.test(val)) {
          this.toast('LoRA adapters can only be applied in positive prompts or via the LoRA selector.', '#fbbf24');
        }
        const caret = e.target.selectionStart;
        const before = caret != null ? val.slice(0, caret) : val;
        const wcMatch = /__([A-Za-z0-9_-]*)$/.exec(before);
        if (wcMatch) {
          this.setState({ negPrompt: val, showNegWildcards: true, negWildcardFilter: wcMatch[1] });
        } else {
          this.setState({ negPrompt: val, negWildcardFilter: '' });
        }
      },
      negPromptBadge: !controls.negativePrompt ? React.createElement('span', {
        'data-dex-field': 'neg-prompt-notice',
        style: { fontSize: 10, color: '#fbbf24', background: 'rgba(251,191,36,.12)', border: '1px solid rgba(251,191,36,.25)', borderRadius: 4, padding: '2px 6px' }
      }, `Not supported by ${(targetCard && targetCard.display_name) || (targetObj && targetObj.label) || target} · draft preserved`) : null,
      negPromptPlaceholder: !controls.negativePrompt ? 'Negative prompts are not supported by this checkpoint.' : 'Negative: what to avoid…',
      negPromptDisabled: !controls.negativePrompt ? 'disabled' : null,
      negPromptOpacity: !controls.negativePrompt ? '0.55' : '1',
      negativePromptTools,
      onStepsChange: e=>this.setCreateLoraField('steps', e.target.value),
      onCfgChange: e=>this.setCreateLoraField('cfg', e.target.value),
      onSeedChange: e=>this.setState({seed:e.target.value}),
      onWidthChange: e=>this.setState({width:e.target.value}),
      onHeightChange: e=>this.setState({height:e.target.value}),
      sampler, scheduler,
      onSamplerChange: e=>this.setCreateLoraField('sampler', e.target.value),
      onSchedulerChange: e=>this.setCreateLoraField('scheduler', e.target.value),
      shapeSquareSelected: Number(width) === 512 && Number(height) === 512,
      shapeLandscapeSelected: Number(width) === 768 && Number(height) === 512,
      shapePortraitSelected: Number(width) === 512 && Number(height) === 768,
      shapeLargeSquareSelected: Number(width) === 1024 && Number(height) === 1024,
      setDim512: ()=>this.setState({width:512,height:512}),
      setDim768: ()=>this.setState({width:768,height:512}),
      setDimPortrait: ()=>this.setState({width:512,height:768}),
      setDim1024: ()=>this.setState({width:1024,height:1024}),
      onGenerate: ()=>this.onGenerate(),
      onCancelJob: ()=>this.onCancelJob(),
      onOpenHelp: e=>this.v2OpenDrawer && this.v2OpenDrawer('help', e),
      onOpenContext: e=>this.v2OpenDrawer && this.v2OpenDrawer('context', e),
      onOpenPalette: ()=>{ const center=window.__DEX_V12; if(center && typeof center.toggleCommandPalette==='function') center.toggleCommandPalette(); else this.toast('Command palette is initializing. Try again in a moment.', '#fbbf24'); },
      onOpenJobCenter: ()=>{ const center=window.__DEX_V12; if(center && typeof center.toggleJobCenter==='function') center.toggleJobCenter(); else this.toast('Job Center is initializing. Try again in a moment.', '#fbbf24'); },
      activeJobCount: (() => { const c=window.__DEX_V12; return c ? ((c.activeJobCount || 0)+(c.queuedJobCount || 0)) : 0; })(),
      offlineWarning: !backendOnline,
      // sc-if treats any non-empty string as true, so this must stay a real boolean.
      showCancel: (() => { const ws = this._createWs(); return jobStatus === 'generating' && !!ws.activeJobId; })(),
      activeCancelJobId: (() => { const ws = this._createWs(); return ws.activeJobId || ''; })(),
      cancelLabel: (() => { const ws = this._createWs(); return ws.reconciling ? 'Checking the job…' : ws.interrupting ? 'Stopping — checking the worker…' : 'Cancel job'; })(),
      cancelDisabled: (() => { const ws = this._createWs(); return String(!!(ws.interrupting || ws.reconciling)); })(),
      cancelError: (() => {
        const ws = this._createWs();
        if (ws.interruptState === 'unverified') return 'The stop request reached the server, but the worker could not be confirmed stopped. The job stays running and heavy work stays paused until it is reconciled.';
        if (ws.interruptState === 'refused') return ws.cancelReason || 'This job cannot be stopped safely from here. It was left running.';
        if (ws.interruptState === 'error') return 'The cancel request failed. The job may still be running — check the Job Center.';
        return '';
      })(),
      generateLabel: isGenerating ? ('Generating… ' + progress + '%') : 'Generate Image',
      genCursor: isGenerating ? 'default' : 'pointer',
      genOpacity: isGenerating ? '0.75' : '1',
      genBg1: isGenerating ? 'linear-gradient(90deg,#1a5068,#2a6034)' : 'linear-gradient(90deg,#38bdf8,#65d66e)',
      genBg2: isGenerating ? 'linear-gradient(90deg,#7a5008,#8a3810)' : 'linear-gradient(90deg,#f59e0b,#fb923c)',
      genBg3: isGenerating ? 'linear-gradient(135deg,#4a2a8a,#0a6a8a)' : 'linear-gradient(135deg,#8b5cf6,#22d3ee)',
      showJobResult: jobStatus !== 'idle',
      jobIdle: jobStatus === 'idle',
      imageDisplay: this.buildImageDisplay(jobStatus, progress, currentImageSrc, lastSeed, errorMsg),
      actionStatus: jobStatus==='cancelling' ? 'stopping · checking the worker'
        : jobStatus==='cancelled' ? 'cancelled · verified by the worker'
        : jobStatus==='cancel-unverified' ? ('stop not confirmed · ' + (this.state.cancelError || 'check System'))
        : isGenerating ? ('generating · ' + ((this.state.jobStage || {}).label || 'Waiting for backend'))
        : jobStatus==='complete' ? ('done · seed ' + lastSeed) : jobStatus==='error' ? 'error · check backend' : 'idle · no job',
      // Status chips
      backendDot, backendLabel: backendOnline ? 'Backend' : 'Offline',
      backendChipBg: backendOnline ? 'rgba(101,214,110,.08)' : 'rgba(239,68,68,.08)',
      backendChipBorder: backendOnline ? 'rgba(101,214,110,.2)' : 'rgba(239,68,68,.2)',
      jobDot, jobLabel: jobStatus==='cancelling' ? 'Stopping…' : jobStatus==='cancelled' ? 'Cancelled' : jobStatus==='cancel-unverified' ? 'Check required'
        : isGenerating ? (progress + '%') : jobStatus==='complete' ? 'Done' : jobStatus==='error' ? 'Error' : 'Idle',
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
      libraryCards, runsCount: String(runs.length), jobLogDisplay, worldWorkspace: this.buildWorldWorkspace(), asset3dWorkspace: this.buildAsset3dWorkspace(),
      libraryFilters, libraryLoadMore, extraNetworksDisplay,
      assetCountsDisplay: (assets.loras || []).length + ' LoRAs · ' + (assets.vaes || []).length + ' VAEs · ' + (assets.controlnets || []).length + ' ControlNets',
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
