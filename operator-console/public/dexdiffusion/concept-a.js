// Concept A — the shared DexDiffusion workstation shell.
//
// This layer composes the existing capability-backed workspaces. It owns
// navigation, contextual help, the inspector frame, and the responsive shell;
// generation, media, audio, edit, 3D, and world state remain owned by the
// existing component layers.
(function () {
  'use strict';
  const C = window.DexDiffusionComponent;
  if (!C) return;
  const P = C.prototype;
  const h = (...a) => React.createElement(...a);
  const UI = window.DexUI || {};
  const btn = UI.btn || ((label, onClick, color, extra) => h('button', Object.assign({ type: 'button', onClick }, extra || {}), label));

  const ICON_PATHS = {
    workstation: 'M3 11 12 3l9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-9Z',
    generate: 'M12 2l1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9L12 2Zm6 13 1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3Z',
    edit: 'M4 16.5V20h3.5L18.8 8.7l-3.5-3.5L4 16.5Zm11.9-9.9 1.3-1.3a1.6 1.6 0 0 1 2.3 0l.2.2a1.6 1.6 0 0 1 0 2.3l-1.3 1.3-2.5-2.5Z',
    media: 'M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm10 0h6v6h-6v-6Z',
    voice: 'M12 15a3 3 0 0 0 3-3V7a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3Zm-6-3a6 6 0 0 0 12 0M12 18v4m-4 0h8',
    music: 'M9 18V5l10-2v13M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3Zm10-2a3 3 0 1 1-3-3 3 3 0 0 1 3 3Z',
    assets3d: 'M12 3 4 7.5v9l8 4.5 8-4.5v-9L12 3Zm0 0v9m8-4.5-8 4.5-8-4.5M8 5.2l8 4.5',
    world: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0 0c2-2.2 3-5.2 3-9s-1-6.8-3-9c-2 2.2-3 5.2-3 9s1 6.8 3 9ZM3 12h18',
    drama: 'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm3 4h8M8 12h8M8 16h5',
    settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0-6v3m0 14v3M4.2 4.2l2.1 2.1m11.4 11.4 2.1 2.1M2 12h3m14 0h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1',
  };
  // Order follows the product map: image tools (orange), audio (subdued blue), 3D/world (green), system (pale red).
  const MODULES = [
    { id: 'workstation', label: 'Workstation', icon: 'workstation', accent: '#ef6f61', desc: 'Start, resume, and see what needs attention.' },
    { id: 'generate', label: 'Create', icon: 'generate', accent: '#f59e0b', desc: 'Create images from prompts and references.' },
    { id: 'edit', label: 'Edit', icon: 'edit', accent: '#fb923c', desc: 'Transform, inpaint, and enhance image assets.' },
    { id: 'voice', label: 'Voice', icon: 'voice', accent: '#60a5fa', desc: 'Create and manage narration and voice assets.' },
    { id: 'drama', label: 'Drama', icon: 'drama', accent: '#7aa7e6', desc: 'Turn scripts and assets into audio drama.' },
    { id: 'music', label: 'Music', icon: 'music', accent: '#6b9bd6', desc: 'Generate songs and instrumental audio.' },
    { id: 'assets3d', label: '3D Assets', icon: 'assets3d', accent: '#65d66e', desc: 'Create and inspect individual 3D assets.' },
    { id: 'world', label: 'World Viewer', icon: 'world', accent: '#4ade80', desc: 'Generate point-cloud worlds from one image and explore them.' },
    { id: 'media', label: 'Library', icon: 'media', accent: '#f59e0b', desc: 'Browse the canonical creative asset library.' },
    { id: 'settings', label: 'System', icon: 'settings', accent: '#fca5a5', desc: 'Preferences, capability truth, and tutorials.' },
  ];
  function moduleIcon(id, size) {
    return h('svg', { className: 'ca-svg-icon', width: size || 18, height: size || 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true', focusable: 'false' }, h('path', { d: ICON_PATHS[id] || ICON_PATHS.settings }));
  }

  const HELP = {
    workstation: {
      quick: ['Use Workstation to resume a recent asset or start a new creative task.', 'Choose a Quick Start card, then keep the global Queue visible while work runs.'],
      what: 'Workstation is the launch and resume surface. It summarizes real recent assets, active jobs, projects known to the current runtime, and reusable recipes without replacing Media or the Job Center.',
      steps: ['Choose a module under Quick Start.', 'Resume a recent asset from the Recent Assets list when you already have source material.', 'Open Jobs to follow active or interrupted work.'],
      tips: ['Use Media for full search, filtering, lineage, and collections.', 'An interrupted job is recoverable context, not a completed result.'],
      faq: ['Where are files saved? Generated images are stored in /Users/andrew/images_made; audio and other media use the project media stores.', 'Why is there no project card? Workstation only shows project records the current runtime actually exposes.'],
    },
    generate: {
      quick: ['Write a prompt, confirm the target and output size, then choose Generate Image.', 'The result stays in the workspace and is also registered in the canonical Media system.'],
      what: 'Generate runs the existing controlled image-generation paths. The selected capability target decides which settings are valid; unsupported controls remain unavailable and are not sent.',
      steps: ['Enter a prompt and select a target.', 'Review dimensions, quantity, seed, and Advanced controls.', 'Generate, then use the result actions to send the exact canonical asset to Edit, Media, Compare, or Export.'],
      tips: ['FLUX.2 Klein 4B does not use SD-specific negative prompt, CFG, scheduler, or VAE controls.', 'ETA is shown only when the runtime has enough completed timing evidence.'],
      faq: ['Where does the image go? The durable copy is under /Users/andrew/images_made and is served by canonical asset ID.', 'Why is a control dimmed? The current model or runtime capability does not support it.'],
    },
    edit: {
      quick: ['Open a canonical image from Generate or Media, choose img2img or Inpaint, and use the single Run control.', 'Enhance keeps the source asset intact and creates a new result.'],
      what: 'Edit owns image transformation. Current supported paths include img2img, inpaint, Lanczos, Real-ESRGAN when available, and the documented partial High-Res Refine flow.',
      steps: ['Choose or import a source image.', 'Select the operation and adjust only the relevant inspector controls.', 'Run, review the result, and save a new version or return it to Media.'],
      tips: ['Outpaint and Face Restore remain unavailable unless their backend gates are open.', 'A failed export does not remove the generated source asset.'],
      faq: ['Why is a mode unavailable? The UI reflects the live capability gate rather than a visual mockup.', 'Can I recover the source prompt? Only when prompt saving or a recorded generation snapshot permits it.'],
    },
    media: {
      quick: ['Search the canonical library, select an asset, and use its compatible action.', 'Use the detail panel for provenance, lineage, collections, and handoffs.'],
      what: 'Media is the asset hub. It combines indexed images with the project audio/video stores where those stores have real data. It does not duplicate bytes for navigation.',
      steps: ['Search or filter the library.', 'Select an asset for metadata and lineage.', 'Open it in a compatible module or export it.'],
      tips: ['Grid previews use indexed thumbnails where available.', 'Privacy-aware replay never invents prompt text that was not saved.'],
      faq: ['Why is a category empty? Empty categories are reported from the real index; no placeholder library is created.', 'How do I compare images? Select images through the existing compare action and use the shared comparison view.'],
    },
    voice: {
      quick: ['Choose a supported voice workflow, enter text, and Generate.', 'Preview the resulting audio before sending it to Media or Drama.'],
      what: 'Voice exposes the installed and proven speech workers, voice profiles, long-form rendering, and the existing audio handoff paths.',
      steps: ['Choose a voice or profile.', 'Enter script text and supported controls.', 'Generate, listen, then save, export, or attach the canonical audio to Drama.'],
      tips: ['Text remains private according to the prompt-saving setting.', 'Long-form failures identify the failed chunk so recovery does not discard the whole script.'],
      faq: ['Why is a voice disabled? Its runtime, model, or proof state is not available.', 'Can voice go to Drama? Yes when the generated canonical audio asset satisfies the Drama attachment contract.'],
    },
    music: {
      quick: ['Describe a song or instrumental track, choose a real worker, then Generate.', 'Preview the waveform and send completed audio to Media.'],
      what: 'Music uses the installed ACE-Step and Magenta RealTime bridges. Song and instrumental controls are worker-specific; unsupported stems and mastering operations remain explicitly planned.',
      steps: ['Choose Song or Instrumental and the available worker.', 'Enter the prompt and only worker-supported options.', 'Generate, preview, and export or attach the resulting audio asset.'],
      tips: ['ACE-Step can take several minutes for a full song.', 'Heavy-compute ownership and waiting state are shown by the shared runtime.'],
      faq: ['Why are Stems or Mastering unavailable? No executable contract is enabled for those tabs.', 'Where is music stored? Completed audio is registered in the canonical music media store.'],
    },
    assets3d: {
      quick: ['Choose a canonical image, select a proven 3D mode, and start the job.', 'Open the 3D preview of the resulting GLB, or download it.'],
      what: '3D Assets owns individual generated or imported objects. Hunyuan 3D, staging, checksum verification, canonical storage, and remote cleanup remain in the existing job path.',
      steps: ['Select an image source.', 'Choose Quick Geometry, Mesh, or Textured Asset only when its live proof gate is open.', 'Open the 3D preview, download the GLB, or open it in Blender.'],
      tips: ['PBR is disabled because its memory safety is not proven on the current machine.', 'World owns environments; this module owns individual objects.'],
      faq: ['Why is a mode unavailable? The runtime has not proven that mode safe and executable here.', 'Does World receive a copy? The handoff uses the canonical asset identity.'],
    },
    world: {
      quick: ['Choose one canonical source image, then Make 3D (Quick 3D) or Make World (Complete 360).', 'Open a finished project in World Focus: W/A/S/D move, drag to look, R resets the camera.'],
      what: 'World turns the image you choose into a point-cloud 3D scene. Quick 3D reconstructs it with SHARP; Complete 360 builds a panorama and aligned reconstructions as a progressive preview. World Focus is a separate viewer page. Projects are generated, not hand-edited.',
      steps: ['Pick a source image, or send one from Library with Use for World.', 'Press Make 3D or Make World and follow the job in Jobs.', 'When a project shows COMPLETE (or a PARTIAL preview), press Open Focus.'],
      tips: ['A failed project shows the stage that failed; Retry submits the same mode and image again.', 'Scene placement and environment editing are not available.'],
      faq: ['Can Drama edit a live world? No: only rendered results are handed off, and they are labeled as renders.', 'Why is Open Focus missing? Only a project with a viewer-ready PLY can be opened.'],
    },
    drama: {
      quick: ['Paste a script, parse it, cast voices in CAST, then press PRODUCE ENTIRE DRAMA.', 'Only what changed is regenerated or remixed; finished work is reused.'],
      what: 'Drama is the audio-drama studio, all local: SCRIPT (parse and review), CAST (voices, pronunciation, effects, optional pacing), DIRECT (multitrack timeline, sound cues), PRODUCE (one-click, resumable production), REVIEW (take states, integrity, local speech check), MASTER (loudness, formats, proof report) and EXPORT (WAV, MP3, chaptered M4B, scene masters, stems, package).',
      steps: ['Parse the script and check the classification badge.', 'Cast every speaker to a saved voice; set optional effects and pronunciation.', 'Direct cues and clip edits, then PRODUCE; review the takes and the proof; record your listening acceptance; export.'],
      tips: ['Unsaved scripts remain in memory until Save project is explicit; Save is required to resume after a restart.', 'Editing one line only regenerates that line; changing effects or cues only remixes the affected scenes.', 'Speech verification needs a local whisper.cpp install; otherwise it reports UNAVAILABLE, never a pass.'],
      faq: ['Why was a take marked OUTDATED? Its text, voice, reference sample, engine or synthesis settings no longer match; it is kept but cannot enter the current master.', 'Can earlier versions be exported? Yes: they stay playable and are labelled HISTORICAL.'],
    },
    settings: {
      quick: ['Use Settings / Help to inspect capability truth, appearance preferences, storage destinations, keyboard shortcuts, and this tutorial index.', 'Use the Help button in any module for contextual guidance.'],
      what: 'Settings / Help is the truthful system and learning surface. Destructive maintenance remains outside ordinary creative settings.',
      steps: ['Choose a settings section.', 'Read the live capability ledger or open a module tutorial.', 'Return to the creative workspace without interrupting jobs.'],
      tips: ['Available, caveated, experimental, unavailable, and planned states are distinct.', 'Queue and Help remain available while background work runs.'],
      faq: ['Can I clean old runs here? Destructive maintenance is intentionally not promoted into normal UI.', 'How do I keep Help from opening automatically? Disable automatic opening below; manual Help remains available.'],
    },
  };

  function moduleFor(screen) {
    if (screen === 'create' || screen === 'batch') return 'generate';
    if (screen === 'edit' || screen === 'enhance') return 'edit';
    if (screen === 'library') return 'media';
    if (screen === '3d') return 'assets3d';
    if (screen === 'system' || screen === 'models') return 'settings';
    return ['workstation', 'voice', 'music', 'world', 'drama'].includes(screen) ? screen : 'workstation';
  }

  P._ca = function () {
    if (this.ca) return this.ca;
    let autoHelp = true;
    try { autoHelp = localStorage.getItem('dex_concept_help_auto') !== 'false'; } catch (_) {}
    this.ca = { help: { open: false, module: 'workstation', tab: 'quick', opener: null }, autoHelp, settingsTab: 'general', queueOpen: false, helpQuery: '', faqOpen: {}, inspectorOpen: false, inspectorOpener: null, promptSelection: null, libraryView: 'images' };
    return this.ca;
  };
  P.caSync = function () { this.setState({ _caTick: (this.state._caTick || 0) + 1 }); };
  P.caSetLibraryView = function (view) {
    this._ca().libraryView = view === 'media' ? 'media' : 'images';
    this.caSync();
    requestAnimationFrame(() => document.querySelector('[data-ca-library-tab="' + this._ca().libraryView + '"]')?.focus());
  };
  P.caModule = function () { return moduleFor(this.state.screens[this.state.version]); };
  P.caNavigate = function (id) {
    const target = id === 'workstation' ? 'workstation' : id === 'generate' ? 'create' : id === 'edit' ? 'edit' : id === 'media' ? 'library' : id === 'assets3d' ? '3d' : id === 'settings' ? 'system' : id;
    if (this.setScreen(target) === false) return false;
    if (target === 'create' && this._ca().promptSelection) {
      const selection = this._ca().promptSelection;
      const focusStartedAt = performance.now();
      const focusPrompt = () => {
        if (this.state.screens[this.state.version] !== 'create' || performance.now() - focusStartedAt > 3000) return;
        const prompt = document.querySelector('[data-dex-field="prompt"]');
        if (!prompt) { requestAnimationFrame(focusPrompt); return; }
        const active = document.activeElement;
        if (active !== document.body && active !== prompt && !active?.closest('.ca-workstation')) return;
        if (active !== prompt) {
          prompt.focus({ preventScroll: true });
          try { prompt.setSelectionRange(selection.start, selection.end, selection.direction || 'none'); } catch (_) {}
        }
        requestAnimationFrame(focusPrompt);
      };
      requestAnimationFrame(() => requestAnimationFrame(focusPrompt));
    }
    return true;
  };
  P.caOpenInspector = function (event) {
    const ca = this._ca(); ca.inspectorOpen = true; ca.inspectorOpener = event && event.currentTarget || document.activeElement;
    this.caSync();
    const focusClose = () => document.querySelector('.ca-inspector-close')?.focus();
    requestAnimationFrame(() => requestAnimationFrame(focusClose));
    setTimeout(focusClose, 80);
  };
  P.caCloseInspector = function () {
    const ca = this._ca(), opener = ca.inspectorOpener;
    ca.inspectorOpen = false; ca.inspectorOpener = null;
    this.caSync();
    const restoreFocus = () => {
      const active = document.activeElement;
      if (active !== document.body && active !== opener && !active?.classList.contains('ca-inspector-close')) return;
      const currentOpener = document.querySelector('.ca-inspector-open');
      const target = currentOpener && currentOpener.getClientRects().length ? currentOpener : opener;
      if (target && target.isConnected && typeof target.focus === 'function') target.focus({ preventScroll: true });
    };
    requestAnimationFrame(() => requestAnimationFrame(restoreFocus));
    setTimeout(restoreFocus, 80);
  };
  P.caOpenHelp = function (moduleId, event) {
    if (event) event.__dexConceptHelpHandled = true;
    const ca = this._ca();
    ca.help = { open: true, module: HELP[moduleId] ? moduleId : 'settings', tab: 'quick', opener: (event && event.currentTarget) || document.activeElement };
    this.setState({ _caHelpTick: (this.state._caHelpTick || 0) + 1 });
    requestAnimationFrame(() => document.querySelector('[data-ca-help-dialog] [data-ca-help-tab="quick"]')?.focus());
  };
  P.caCloseHelp = function () {
    const ca = this._ca(), opener = ca.help.opener;
    ca.help = { open: false, module: ca.help.module, tab: 'quick', opener: null };
    this.setState({ _caHelpTick: (this.state._caHelpTick || 0) + 1 });
    requestAnimationFrame(() => { if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus(); });
  };
  P.caToggleJobs = function () {
    const v12 = window.__DEX_V12;
    if (v12 && v12.toggleJobCenter) v12.toggleJobCenter();
    else document.getElementById('v12-hud-jobs-btn')?.click();
  };
  P.caToggleQueue = function () {
    const ca = this._ca(); ca.queueOpen = !ca.queueOpen;
    this.setState({ _caQueueTick: (this.state._caQueueTick || 0) + 1 });
  };
  P.caOpenTutorial = function (moduleId) {
    const ca = this._ca(); ca.settingsTab = 'help'; ca.helpQuery = (MODULES.find(m => m.id === moduleId) || {}).label || '';
    this.caCloseHelp(); this.caNavigate('settings');
    this.setState({ _caHelpIndexTick: (this.state._caHelpIndexTick || 0) + 1 });
  };
  P.caTogglePalette = function () {
    const v12 = window.__DEX_V12;
    if (v12 && v12.toggleCommandPalette) v12.toggleCommandPalette();
    else document.getElementById('v12-hud-palette-btn')?.click();
  };
  P.caSetAutoHelp = function (value) {
    const ca = this._ca(); ca.autoHelp = !!value;
    try { localStorage.setItem('dex_concept_help_auto', String(!!value)); } catch (_) {}
    this.setState({ _caHelpTick: (this.state._caHelpTick || 0) + 1 });
  };

  function panel(title, body, accent) {
    return h('section', { className: 'ca-panel', style: { borderTopColor: accent || '#334155' } }, h('h3', null, title), body);
  }
  function status(text, color) { return h('span', { className: 'ca-status', style: { color: color || '#94a3b8', borderColor: (color || '#94a3b8') + '66', background: (color || '#94a3b8') + '12' } }, text); }
  function progressPercent(progress) {
    if (!progress || typeof progress !== 'object') return null;
    const value = Number.isFinite(progress.totalPercent) ? progress.totalPercent
      : Number.isFinite(progress.currentRunPercent) ? progress.currentRunPercent
        : Number.isFinite(progress.percent) ? progress.percent : null;
    return value == null ? null : Math.max(0, Math.min(100, Math.round(value)));
  }

  P.buildConceptWorkstation = function (vals, accent) {
    const runs = (this.state.runs || []).slice(0, 8), v12 = window.__DEX_V12 || {}, snap = v12.snapshot || {};
    const latest = runs[0] || null;
    const runCard = r => {
      const model = r.model && r.model !== 'controlled' ? r.model : null, size = r.size && r.size !== '—' ? r.size : null;
      const metadata = [model, size].filter(Boolean).join(' · ') || 'Image run';
      return h('button', { key: r.id, type: 'button', className: 'ca-asset-card', onClick: () => this.showInLibrary(r.id), title: 'Open ' + r.id },
        h('div', { className: 'ca-asset-preview', style: { width: '100%', aspectRatio: '1 / 1', display: 'grid', placeItems: 'center', overflow: 'hidden', background: '#0d1823', color: '#91a2b4', fontSize: 10 } },
          r.fullUrl ? h('img', { src: r.fullUrl, alt: 'Preview of ' + r.id, loading: 'lazy', onError: e => { const preview = e.currentTarget && e.currentTarget.parentElement; if (!preview) return; preview.textContent = 'Preview unavailable'; preview.setAttribute('role', 'img'); preview.setAttribute('aria-label', 'Preview unavailable for ' + r.id); } }) : 'Preview unavailable'),
        h('span', null, metadata), h('small', null, r.badge || 'RUN'));
    };
    const quick = [
      ['Create image', 'Prompt and generate', 'generate'], ['Edit image', 'Transform a source', 'edit'], ['Design voice', 'Profiles and narration', 'voice'],
      ['Produce drama', 'Script, cast, and direct', 'drama'], ['Create music', 'Song or instrumental', 'music'], ['Build 3D asset', 'Individual 3D output', 'assets3d'],
    ].map(([title, desc, id]) => h('button', { key: id, type: 'button', className: 'ca-quick-card', onClick: () => this.caNavigate(id) }, h('span', { className: 'ca-quick-icon', style: { color: MODULES.find(m => m.id === id)?.accent || accent } }, moduleIcon(id, 20)), h('span', null, h('b', null, title), h('small', null, desc))));
    const projects = (this.state.worldProjects || []).slice(0, 4);
    const projectBody = projects.length ? h('div', { className: 'ca-list' }, ...projects.map(p => {
      return h('button', { key: p.id || p.project_id, type: 'button', className: 'ca-list-row', onClick: () => this.caNavigate('world') },
        h('b', null, p.title || p.name || p.id), h('small', null, 'World project · open in World Viewer'));
    })) : h('div', { className: 'ca-empty' }, 'No project records are exposed by the current runtime. Resume from a recent asset or open a creative module.');
    const activeItems = [...(snap.active || []).slice(0, 4).map(j => h('div', { key: j.id, className: 'ca-list-row' }, h('b', null, j.label || j.operation || 'Job'), status(j.status || 'ACTIVE', '#38bdf8'))),
      ...(snap.queue || []).slice(0, 3).map(j => h('div', { key: j.id, className: 'ca-list-row' }, h('b', null, j.label || j.operation || 'Queued job'), status('QUEUED', '#f59e0b')))];
    if (!activeItems.length) activeItems.push(h('div', { className: 'ca-empty', key: 'none' }, 'No active or queued jobs.'));
    const promptComposer = h('div', { className: 'ca-stack' },
      h('label', { className: 'ca-field' }, h('span', null, 'Prompt'), h('textarea', { rows: 4, value: this.state.prompt || '', placeholder: 'Describe the image. A1111 syntax supported.', 'data-dex-quick-prompt': 'true', onInput: e => { this.state.prompt = e.target.value; this._ca().promptSelection = { start: e.target.selectionStart, end: e.target.selectionEnd, direction: e.target.selectionDirection }; }, onSelect: e => { this._ca().promptSelection = { start: e.target.selectionStart, end: e.target.selectionEnd, direction: e.target.selectionDirection }; } })),
      vals.promptTools || null,
      this.buildCreateResources(),
      h('div', { className: 'ca-form-actions' }, btn('Continue in Create', () => this.caNavigate('generate'), '#ef6f61'))
    );
    const jobCount = (snap.active || []).length, queuedCount = (snap.queue || []).length;
    const heroAction = latest
      ? h('button', { type: 'button', className: 'ca-primary', onClick: () => this.showInLibrary(latest.id), 'aria-label': 'Continue with latest image ' + latest.id }, 'Continue with latest image')
      : h('button', { type: 'button', className: 'ca-primary', onClick: () => this.caNavigate('generate') }, 'Create your first image');
    const activity = jobCount ? jobCount + ' active job' + (jobCount === 1 ? '' : 's') : queuedCount ? queuedCount + ' queued job' + (queuedCount === 1 ? '' : 's') : 'No active work';
    return h('div', { className: 'ca-workstation' },
      h('section', { className: 'ca-home-hero', 'aria-labelledby': 'ca-home-title' },
        h('img', { className: 'ca-home-mascot', src: 'uploads/grok_image_1775521844329.jpg', alt: 'Dexter at his keyboard' }),
        h('div', { className: 'ca-home-copy' }, h('span', { className: 'ca-home-eyebrow' }, 'DEXTER STUDIO · PRIVATE CREATIVE WORKSPACE'), h('h2', { id: 'ca-home-title' }, 'Your work, ready to continue.'),
          h('p', null, latest ? 'Latest image · ' + [latest.model && latest.model !== 'controlled' ? latest.model : null, latest.size && latest.size !== '—' ? latest.size : null, latest.id].filter(Boolean).join(' · ') : 'Create, refine, and organize images, audio, drama, and 3D work from one place.'),
          h('div', { className: 'ca-home-actions' }, heroAction, h('button', { type: 'button', className: 'ca-secondary', onClick: () => this.caToggleJobs() }, 'Open Job Center')),
          h('div', { className: 'ca-home-live', role: 'status' }, h('span', { className: jobCount ? 'is-working' : '' }), activity + ' · Event stream ' + (v12.connected ? 'connected' : 'reconnecting')))),
      panel('Active Jobs', h('div', { className: 'ca-list' }, ...activeItems), accent),
      panel('Create something', h('div', { className: 'ca-quick-grid' }, ...quick), accent),
      panel('Recent Assets', runs.length ? h('div', { className: 'ca-asset-grid' }, ...runs.map(runCard)) : h('div', { className: 'ca-empty' }, 'No indexed image runs yet. Generate an image to create the first canonical asset.'), accent),
      panel('Start with a prompt', promptComposer, accent),
      h('div', { className: 'ca-columns-2' }, panel('Recent Projects', projectBody, accent), panel('Templates / Recipes', h('div', { className: 'ca-recipe-row' }, h('span', null, 'Use saved settings recipes from Generate.'), btn('Open Generate', () => this.caNavigate('generate'), '#38bdf8'), h('span', { className: 'ca-muted' }, 'Prompt text is governed by the existing privacy setting.')), accent)));
  };

  // ── Prompt styles (A1111 semantics, P04 S04.2): templates with an optional {prompt} placeholder. ──
  P._sty = function () { const ca = this._ca(); return ca.styles || (ca.styles = { list: [], loaded: false, selected: [], editor: null, preview: null, note: '' }); };
  P.caLoadStyles = async function () {
    const st = this._sty();
    const r = await this._api('/api/styles');
    if (r.ok) { st.list = r.data.styles || []; st.selected = st.selected.filter(id => st.list.some(x => x.id === id)); st.loaded = true; }
    else st.note = 'Could not load styles: ' + ((r.data && r.data.error) || r.status);
    // V2 loads this once at start-up: repaint only if Create (the only V2 screen showing styles) is on screen, so the load never
    // re-renders a different form (Edit, Voice...) while someone is typing into it.
    if (this.state.version === 2 && (this.state.screens || {})[2] !== 'create') return;
    this.caSync();
  };
  P.caStyleNote = function (text) { this._sty().note = text; this.caSync(); };
  P.caToggleStyle = function (id, on) {
    const st = this._sty(); st.selected = on ? [...new Set([...st.selected, id])] : st.selected.filter(x => x !== id); st.preview = null; this.caSync();
  };
  P.caPreviewStyles = async function () {
    const st = this._sty(), s = this.state;
    if (!st.selected.length) return this.caStyleNote('Select at least one style first.');
    const r = await this._api('/api/styles/apply', { style_ids: st.selected, prompt: s.prompt || '', negative_prompt: s.negPrompt || '', target: s.target });
    st.preview = r.ok ? r.data : null; st.note = r.ok ? '' : 'Preview failed: ' + ((r.data && r.data.error) || r.status); this.caSync();
  };
  P.caApplyStyles = async function () {
    const st = this._sty();
    await this.caPreviewStyles();
    if (!st.preview) return;
    if (st.preview.syntax_error) return this.caStyleNote('Not applied: ' + st.preview.syntax_error);
    this.setState({ prompt: st.preview.prompt, negPrompt: st.preview.negative_prompt });
    st.preview = null; st.note = 'Applied ' + (st.selected.length) + ' style(s) to the prompt.'; this.caSync();
  };
  P.caOpenStyleEditor = function (style) {
    const st = this._sty(), s = this.state;
    st.editor = style ? { id: style.id, name: style.name, prompt: style.prompt, negative_prompt: style.negative_prompt }
      : { id: null, name: '', prompt: '', negative_prompt: '' };
    this.caSync();
  };
  // Save the current prompt/negative as a new template (explicit user action; the text is stored on disk as a style).
  P.caStyleFromPrompt = function () {
    const s = this.state, st = this._sty();
    st.editor = { id: null, name: '', prompt: s.prompt || '', negative_prompt: s.negPrompt || '', fromPrompt: true }; this.caSync();
  };
  P.caSaveStyle = async function () {
    const st = this._sty(), ed = st.editor; if (!ed) return;
    const body = { name: ed.name, prompt: ed.prompt, negative_prompt: ed.negative_prompt };
    const r = ed.id ? await this._api('/api/styles/' + encodeURIComponent(ed.id), body, 'PUT') : await this._api('/api/styles', body);
    if (!r.ok) { ed.error = (r.data && r.data.error) || ('HTTP ' + r.status); return this.caSync(); }
    st.editor = null; st.note = (ed.id ? 'Updated style "' : 'Saved style "') + r.data.style.name + '".';
    await this.caLoadStyles();
  };
  P.caDeleteStyle = async function (style) {
    if (!window.confirm('Delete style "' + style.name + '"? Prompts already generated are not affected.')) return;
    const r = await this._api('/api/styles/' + encodeURIComponent(style.id), undefined, 'DELETE');
    const st = this._sty(); st.note = r.ok ? 'Deleted style "' + style.name + '".' : 'Delete failed: ' + ((r.data && r.data.error) || r.status);
    st.preview = null; await this.caLoadStyles();
  };
  P.buildStylesPanel = function () {
    const st = this._sty();
    // Loaded on first open (a user action): a background re-render while typing would drop focus from the prompt box.
    const ed = st.editor;
    const field = (label, key, extra) => h('label', { className: 'ca-field' }, h('span', null, label),
      extra && extra.area ? h('textarea', { rows: 2, value: ed[key], 'data-dex-field': 'style-' + key, onInput: e => { ed[key] = e.target.value; } })
        : h('input', { value: ed[key], 'data-dex-field': 'style-' + key, maxLength: 60, onInput: e => { ed[key] = e.target.value; } }));
    const editor = ed ? h('div', { className: 'ca-stack', 'data-dex-field': 'style-editor' },
      h('div', { className: 'ca-muted' }, (ed.id ? 'Edit style' : 'New style') + ' — use {prompt} where the current text should go; without it the template is appended after ", ".'),
      ed.fromPrompt ? h('div', { className: 'ca-note' }, 'This saves the text below on disk as a reusable template, independent of the "Save prompts in run records" setting.') : null,
      field('Name', 'name'), field('Prompt template', 'prompt', { area: true }), field('Negative template', 'negative_prompt', { area: true }),
      ed.error ? h('div', { className: 'ca-note', role: 'alert', 'data-dex-field': 'style-error' }, ed.error) : null,
      h('div', { className: 'ca-form-actions' }, h('button', { type: 'button', className: 'ca-secondary', 'data-dex-field': 'style-save', onClick: () => this.caSaveStyle() }, ed.id ? 'Save changes' : 'Save style'),
        h('button', { type: 'button', className: 'ca-secondary', onClick: () => { st.editor = null; this.caSync(); } }, 'Cancel'))) : null;
    const rows = st.list.length ? st.list.map(x => h('div', { key: x.id, className: 'ca-list-row', 'data-style-id': x.id },
      h('label', { className: 'ca-check-row' }, h('input', { type: 'checkbox', checked: st.selected.includes(x.id), 'data-dex-field': 'style-check', onChange: e => this.caToggleStyle(x.id, e.target.checked) }), h('span', null, x.name)),
      h('span', { className: 'ca-muted' }, [x.prompt ? '+' : '', x.negative_prompt ? '−' : ''].join(' ').trim()),
      h('button', { type: 'button', className: 'ca-secondary', 'data-dex-field': 'style-edit', onClick: () => this.caOpenStyleEditor(x) }, 'Edit / rename'),
      h('button', { type: 'button', className: 'ca-secondary', 'data-dex-field': 'style-delete', onClick: () => this.caDeleteStyle(x) }, 'Delete')))
      : [h('div', { key: 'empty', className: 'ca-empty', 'data-dex-field': 'styles-empty' }, st.loaded ? 'No styles yet. Save the current prompt, or create one.' : 'Loading styles…')];
    const pv = st.preview ? h('div', { className: 'ca-stack', 'data-dex-field': 'style-preview' },
      h('div', { className: 'ca-muted' }, 'Result of ' + st.preview.applied.join(' + ')),
      h('pre', { className: 'ca-code', 'data-dex-field': 'style-preview-prompt', style: { whiteSpace: 'pre-wrap', margin: 0 } }, st.preview.prompt),
      h('pre', { className: 'ca-code', 'data-dex-field': 'style-preview-negative', style: { whiteSpace: 'pre-wrap', margin: 0 } }, st.preview.negative_prompt || '(no negative prompt)'),
      st.preview.syntax_error ? h('div', { className: 'ca-note', role: 'alert', 'data-dex-field': 'style-syntax-error' }, st.preview.syntax_error) : null) : null;
    // V2 uses a plain native <details> (synchronous toggle, keyboard-native); V4 keeps its state-owned toggle.
    const nat = this.state.version === 2;
    return h('details', Object.assign({ className: 'ca-field', 'data-dex-field': 'styles-panel', open: !!st.open }, nat ? { onToggle: e => { st.open = !!e.target.open; } } : {}),
      h('summary', nat ? { onClick: e => { const d = e.target.closest('details'); st.open = !(d && d.open); } } : { onClick: e => { e.preventDefault(); st.open = !st.open; if (st.open && !st.loaded) this.caLoadStyles(); else this.caSync(); } }, 'Prompt styles' + (st.list.length ? ' (' + st.list.length + ')' : '')),
      h('div', { className: 'ca-stack' }, h('div', { className: 'ca-list' }, ...rows),
        h('div', { className: 'ca-form-actions' },
          h('button', { type: 'button', className: 'ca-secondary', 'data-dex-field': 'style-preview-button', onClick: () => this.caPreviewStyles() }, 'Preview'),
          h('button', { type: 'button', className: 'ca-secondary', 'data-dex-field': 'style-apply', onClick: () => this.caApplyStyles() }, 'Apply to prompt'),
          h('button', { type: 'button', className: 'ca-secondary', 'data-dex-field': 'style-new', onClick: () => this.caOpenStyleEditor(null) }, 'New style'),
          h('button', { type: 'button', className: 'ca-secondary', 'data-dex-field': 'style-from-prompt', onClick: () => this.caStyleFromPrompt() }, 'Save prompt as style')),
        st.note ? h('div', { className: 'ca-muted', role: 'status', 'data-dex-field': 'style-note' }, st.note) : null, pv, editor));
  };

  // Advanced sampling: only controls the installed sd-cli can honour, plus an explicit list of what it cannot.
  P.buildAdvancedSampling = function () {
    const s = this.state, ctl = this._controls(), D = window.DexClient;
    if (!ctl.eta && !ctl.rng) return null;
    const effective = D.canonicalSamplerId(s.sampler);
    const etaOk = D.ETA_SAMPLERS.includes(effective);
    const input = (label, value, onInput, extra) => h('label', { className: 'ca-field' }, h('span', null, label), h('input', Object.assign({ value: String(value ?? ''), onInput, onChange: onInput }, extra || {})));
    const nat = s.version === 2;
    return h('details', Object.assign({ className: 'ca-field', 'data-dex-field': 'advanced-sampling', open: !!this._ca().advSampling }, nat ? { onToggle: e => { this._ca().advSampling = !!e.target.open; } } : {}),
      // Open state is owned by app state and flipped synchronously on click (the native 'toggle' event is async and
      // loses a race with a re-render that rebuilds the element).
      h('summary', nat ? { onClick: e => { const d = e.target.closest('details'); this._ca().advSampling = !(d && d.open); } } : { onClick: e => { e.preventDefault(); const ca = this._ca(); ca.advSampling = !ca.advSampling; this.caSync(); } }, 'Advanced sampling'),
      h('div', { className: 'ca-stack' },
        ctl.eta ? input('Eta — noise multiplier (blank = sampler default)', s.eta, e => { this.state.eta = e.target.value; }, { type: 'number', min: 0, max: 2, step: 0.05, 'data-dex-field': 'eta', disabled: !etaOk, title: etaOk ? '' : 'Eta only affects ' + D.ETA_SAMPLERS.join(', ') }) : null,
        ctl.eta && !etaOk ? h('div', { className: 'ca-note', 'data-dex-field': 'eta-note' }, 'Eta has no effect with the ' + effective + ' sampler. It applies to: ' + D.ETA_SAMPLERS.join(', ') + '.') : null,
        ctl.rng ? h('label', { className: 'ca-field' }, h('span', null, 'Noise RNG'), h('select', { value: s.rng || '', 'data-dex-field': 'rng', onChange: e => this.setState({ rng: e.target.value }) }, ...D.RNG_CHOICES.map(([id, label]) => h('option', { key: id || 'default', value: id }, label)))) : null,
        h('div', { className: 'ca-muted', 'data-dex-field': 'unavailable-sampling' }, 'Not available with the installed stable-diffusion.cpp (no matching option): variation seed and strength, seed resize, S churn / tmin / tmax / noise, UniPC variant and order, beta schedule, zero-terminal-SNR, sigma min/max/rho.')));
  };

  // "What do these settings do?" — truthful descriptions locked to the implementation by tests/settings-help.test.js.
  P.buildSettingsGuide = function () {
    const H = window.DexSettingsHelp; if (!H) return null;
    const ca = this._ca();
    const nat = this.state.version === 2;
    return h('details', Object.assign({ className: 'ca-field', 'data-dex-field': 'settings-guide', open: !!ca.guide }, nat ? { onToggle: e => { ca.guide = !!e.target.open; } } : {}),
      h('summary', nat ? { onClick: e => { const d = e.target.closest('details'); ca.guide = !(d && d.open); } } : { onClick: e => { e.preventDefault(); ca.guide = !ca.guide; this.caSync(); } }, 'What do these settings do?'),
      h('div', { className: 'ca-stack' }, ...H.GROUPS.map(g => h('section', { key: g.id, 'data-guide-group': g.id, className: 'ca-stack' },
        h('b', null, g.title), ...g.items.map(([name, text]) => h('div', { key: name, className: 'ca-muted' }, h('b', null, name + ': '), text))))));
  };

  // Request preview: asks the server to normalise the exact body Generate would send and to build the
  // worker command with the same function the job runner uses. Nothing is queued or stored.
  P.caLoadPreview = async function () {
    const ca = this._ca();
    ca.preview = { busy: true }; this.caSync();
    const r = await this._api('/api/preview/generation', Object.assign({ job_type: 'txt2img' }, this._createBody()));
    ca.preview = r.ok ? { ok: true, data: r.data } : { ok: false, error: (r.data && r.data.error) || ('HTTP ' + r.status) };
    this.caSync();
  };
  P.buildRequestPreview = function () {
    const pv = this._ca().preview;
    const body = !pv ? h('div', { className: 'ca-muted' }, 'Shows the validated request and the exact worker command for the current settings. Nothing is queued.')
      : pv.busy ? h('div', { className: 'ca-muted' }, 'Building preview…')
      : !pv.ok ? h('div', { className: 'ca-note', 'data-dex-field': 'preview-error', role: 'alert' }, 'Preview rejected: ' + pv.error)
      : h('div', { className: 'ca-stack' },
          h('div', { className: 'ca-muted' }, 'Worker command (prompt text redacted)'),
          h('pre', { className: 'ca-code', 'data-dex-field': 'preview-command', style: { whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 } }, pv.data.preview.command),
          h('div', { className: 'ca-muted' }, 'Normalised request (what the server will execute)'),
          h('pre', { className: 'ca-code', 'data-dex-field': 'preview-json', style: { whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 } }, JSON.stringify(pv.data.normalized, null, 2)));
    return h('div', { className: 'ca-stack', 'data-dex-field': 'request-preview' },
      h('div', { className: 'ca-form-actions' }, h('button', { type: 'button', className: 'ca-secondary', 'data-dex-field': 'preview-button', onClick: () => this.caLoadPreview() }, 'Preview request')), body);
  };

  // V2 Create: the same sampling controls, effective-settings readout and request preview V4 uses, built from the shared
  // DexClient choice tables and the server's /api/preview/generation. Controls the selected backend cannot honour are
  // replaced by an explanation and are never sent (see _createBody).
  P.buildEffectiveSettings = function () {
    const s = this.state, ctl = this._controls(), target = this._targetSpec() || {}, D = window.DexClient;
    const row = (label, value) => h('div', { key: label, style: { display: 'flex', justifyContent: 'space-between', gap: 10, padding: '5px 0', borderBottom: '1px solid rgba(148,163,184,.1)', fontSize: 11 } }, h('span', { style: { color: '#91a2b4' } }, label), h('b', { style: { color: '#dbe7f3', textAlign: 'right', overflowWrap: 'anywhere' } }, value == null || value === '' ? '—' : String(value)));
    const eta = ctl.eta && s.eta !== '' && s.eta != null && D.ETA_SAMPLERS.includes(D.canonicalSamplerId(s.sampler)) ? s.eta : null;
    return h('div', { 'data-studio-effective-settings': 'true', role: 'group', 'aria-label': 'Effective settings', style: { display: 'grid' } },
      row('Target', target.label || s.target),
      row('Canvas', (s.width || '—') + ' × ' + (s.height || '—')),
      row('Steps / seed', (s.steps || '—') + ' / ' + (s.seed === '' || s.seed == null || String(s.seed) === '-1' ? 'random' : s.seed)),
      row('Sampler', ctl.sampler ? D.canonicalSamplerId(s.sampler) : 'Fixed (flow-match Euler)'),
      row('CLIP skip / tiling', ctl.clipSkip ? ((s.clipSkip === '' || s.clipSkip == null ? 'model default' : s.clipSkip) + ' / ' + (s.tiling ? 'VAE tiling on' : 'off')) : 'Not available for this target'),
      ctl.eta ? row('Eta / RNG', (eta == null ? 'sampler default' : eta) + ' / ' + (s.rng || 'default')) : null);
  };
  P.buildV2Sampling = function () {
    const s = this.state, ctl = this._controls(), target = this._targetSpec() || {}, D = window.DexClient;
    const input = (label, value, onInput, extra) => h('label', { className: 'ca-field' }, h('span', null, label), h('input', Object.assign({ value: String(value ?? ''), onInput, onChange: onInput }, extra || {})));
    const note = !ctl.sampler ? h('div', { className: 'ca-note', 'data-dex-field': 'sampling-note' }, (target.label || s.target) + ' uses a fixed flow-match Euler sampler. Sampler, CLIP skip and VAE tiling are unavailable and will not be sent.') : null;
    const controls = h('div', { className: 'ca-form-grid', style: { gridTemplateColumns: 'repeat(2,minmax(0,1fr))' } },
      ctl.sampler ? h('label', { className: 'ca-field' }, h('span', null, 'Sampler'), h('select', { 'aria-label': 'Sampler', value: D.canonicalSamplerId(s.sampler), 'data-dex-field': 'sampler', onChange: e => this.setCreateLoraField('sampler', e.target.value) }, ...D.SAMPLER_CHOICES.map(([id, label]) => h('option', { key: id, value: id }, label)))) : null,
      ctl.scheduler ? h('label', { className: 'ca-field' }, h('span', null, 'Scheduler'), h('select', { 'aria-label': 'Scheduler', value: s.scheduler, 'data-dex-field': 'scheduler', onChange: e => this.setCreateLoraField('scheduler', e.target.value) }, ...D.SCHEDULER_CHOICES.map(([id, label]) => h('option', { key: id, value: id }, label)))) : null,
      ctl.clipSkip ? input('CLIP skip (blank = model default)', s.clipSkip, e => { this.state.clipSkip = e.target.value; }, { type: 'number', min: 1, max: 12, step: 1, 'data-dex-field': 'clip-skip' }) : null,
      ctl.tiling ? h('label', { className: 'ca-check-row' }, h('input', { type: 'checkbox', checked: !!s.tiling, 'data-dex-field': 'tiling', onChange: e => this.setState({ tiling: e.target.checked }) }), h('span', null, 'VAE tiling (lower memory for large images)')) : null);
    return h('div', { className: 'ca-stack', 'data-dex-field': 'v2-sampling' },
      note, controls, this.buildAdvancedSampling(),
      h('div', { className: 'ca-muted', style: { marginTop: 4 } }, 'Effective settings'), this.buildEffectiveSettings(),
      this.buildRequestPreview(), this.buildSettingsGuide());
  };

  P.buildConceptGenerate = function (vals, accent) {
    const s = this.state, ctl = this._controls(), targets = s.modelTargets || [], target = this._targetSpec() || {};
    const input = (label, value, onInput, extra) => h('label', { className: 'ca-field' }, h('span', null, label), h('input', Object.assign({ value: String(value ?? ''), onInput, onChange: onInput }, extra || {})));
    const DP = window.DexPrompt;
    // Notes are written straight into the DOM while typing (no setState), so the editor never loses focus or cursor.
    const refreshPromptNotes = e => {
      const scope = e && e.target && e.target.closest ? e.target.closest('.ca-generate-form') : null;
      const el = scope && scope.querySelector('[data-dex-field="prompt-notes"]'); if (!el || !DP) return;
      const text = DP.notesForTarget(target, this.state.prompt, this.state.negPrompt).join(' ');
      el.textContent = text; el.hidden = !text;
    };
    const initialNotes = DP ? DP.notesForTarget(target, s.prompt, s.negPrompt).join(' ') : '';
    const prompt = h('label', { className: 'ca-field' }, h('span', null, 'Prompt'), h('textarea', { rows: 6, value: s.prompt || '', placeholder: 'Describe the image.', 'data-dex-field': 'prompt', onInput: e => { this.state.prompt = e.target.value; refreshPromptNotes(e); const c = e.target.closest('label') && e.target.closest('label').querySelector('[data-prompt-counter]'); if (c) c.textContent = e.target.value.length + ' / 1000'; } }),
      h('small', { className: 'ca-muted', 'data-prompt-counter': 'true', title: 'Characters in the prompt. 1000 is interface guidance, not a backend hard limit.' }, (s.prompt || '').length + ' / 1000'),
      h('small', { className: 'ca-muted', 'data-dex-field': 'prompt-syntax-help' }, DP ? DP.syntaxHelp(target) : ''),
      h('small', { className: 'ca-note', 'data-dex-field': 'prompt-notes', role: 'status', hidden: !initialNotes }, initialNotes),
      h('small', { className: 'ca-muted', 'data-dex-field': 'token-count' }, 'Token count: unknown for this backend (not estimated).'));
    const negative = ctl.negativePrompt ? h('label', { className: 'ca-field' }, h('span', null, 'Negative prompt'), h('textarea', { rows: 2, value: s.negPrompt || '', 'data-dex-field': 'negative-prompt', onInput: e => { this.state.negPrompt = e.target.value; refreshPromptNotes(e); } })) : h('div', { className: 'ca-note' }, 'Negative prompt is unavailable for ' + (target.label || s.target) + ' and will not be sent.');
    const samplingNote = !ctl.sampler ? h('div', { className: 'ca-note', 'data-dex-field': 'sampling-note' }, (target.label || s.target) + ' uses a fixed flow-match Euler sampler. Sampler, CLIP skip and VAE tiling are unavailable and will not be sent.') : null;
    const targetSelect = h('label', { className: 'ca-field' }, h('span', null, 'Model target'), h('select', { value: s.target, onChange: e => this.onSelectTarget(e.target.value) }, ...(targets.length ? targets : [{ id: s.target, label: s.target, status: 'UNKNOWN' }]).map(t => h('option', { key: t.id, value: t.id }, (t.label || t.id) + ' · ' + (t.status || 'UNKNOWN')))));
    const basic = h('div', { className: 'ca-form-grid' },
      input('Steps', s.steps, e => this.setCreateLoraField('steps', e.target.value), { type: 'number', min: 1, max: 150 }),
      ctl.cfg ? input('CFG', s.cfg, e => this.setCreateLoraField('cfg', e.target.value), { type: 'number', min: 0, max: 30, step: .5 }) : null,
      h('label', { className: 'ca-field', 'data-dex-field': 'seed-row' }, h('span', null, 'Seed'),
        h('span', { style: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' } },
          h('input', { type: 'number', value: String(s.seed ?? ''), 'data-dex-field': 'seed', 'aria-label': 'Seed (-1 = random)', style: { flex: '1 1 90px', minWidth: 0 }, onInput: e => { this.state.seed = e.target.value; }, onChange: e => this.setState({ seed: e.target.value }) }),
          h('span', { className: 'ca-check-row', style: { display: 'inline-flex', gap: 4, alignItems: 'center' } },
            h('input', { type: 'checkbox', 'data-dex-field': 'seed-random', 'aria-label': 'Random seed', checked: String(s.seed) === '-1' || String(s.seed ?? '') === '',
              onChange: e => this.setState({ seed: e.target.checked ? '-1' : String(s.lastSeed != null ? s.lastSeed : Math.floor(Math.random() * 4294967295)) }) }), h('span', null, 'Random')),
          h('button', { type: 'button', className: 'ca-secondary', 'data-dex-field': 'seed-dice', title: 'New random seed value', 'aria-label': 'Generate a random seed value', style: { minWidth: 34 },
            onClick: () => this.setState({ seed: String(Math.floor(Math.random() * 4294967295)) }) }, '🎲'),
          h('button', { type: 'button', className: 'ca-secondary', 'data-dex-field': 'seed-reuse', title: s.lastSeed != null ? 'Reuse the last seed (' + s.lastSeed + ')' : 'No previous seed yet', 'aria-label': 'Reuse the previous seed', disabled: s.lastSeed == null, style: { minWidth: 34 },
            onClick: () => { if (s.lastSeed != null) this.setState({ seed: String(s.lastSeed) }); } }, '↻'))),
      input('Width', s.width, e => { this.state.width = e.target.value; }, { type: 'number', min: 256, step: 8 }),
      input('Height', s.height, e => { this.state.height = e.target.value; }, { type: 'number', min: 256, step: 8 }),
      h('div', { className: 'ca-muted', 'data-dex-field': 'pixel-size', role: 'status' }, (parseInt(s.width, 10) || 0) + ' × ' + (parseInt(s.height, 10) || 0) + ' px · ' + (((parseInt(s.width, 10) || 0) * (parseInt(s.height, 10) || 0)) / 1e6).toFixed(2) + ' MP · ' + ((parseInt(s.width, 10) || 0) === (parseInt(s.height, 10) || 0) ? 'square' : (parseInt(s.width, 10) || 0) > (parseInt(s.height, 10) || 0) ? 'landscape' : 'portrait')),
      ctl.sampler ? h('label', { className: 'ca-field' }, h('span', null, 'Sampler'), h('select', { value: window.DexClient.canonicalSamplerId(s.sampler), 'data-dex-field': 'sampler', onChange: e => this.setCreateLoraField('sampler', e.target.value) }, ...window.DexClient.SAMPLER_CHOICES.map(([id, label]) => h('option', { key: id, value: id }, label)))) : null,
      ctl.clipSkip ? input('CLIP skip (blank = model default)', s.clipSkip, e => { this.state.clipSkip = e.target.value; }, { type: 'number', min: 1, max: 12, step: 1, 'data-dex-field': 'clip-skip' }) : null,
      ctl.tiling ? h('label', { className: 'ca-check-row' }, h('input', { type: 'checkbox', checked: !!s.tiling, 'data-dex-field': 'tiling', onChange: e => this.setState({ tiling: e.target.checked }) }), h('span', null, 'VAE tiling (lower memory for large images)')) : null,
      ctl.scheduler ? h('label', { className: 'ca-field' }, h('span', null, 'Scheduler'), h('select', { value: s.scheduler, onChange: e => this.setCreateLoraField('scheduler', e.target.value) }, ...window.DexClient.SCHEDULER_CHOICES.map(([id, label]) => h('option', { key: id, value: id }, label)))) : null);
    const generate = h('button', { type: 'button', className: 'ca-primary', onClick: () => this.onGenerate(), disabled: s.jobStatus === 'generating' }, s.jobStatus === 'generating' ? (vals.generateLabel || 'Generating…') : 'Generate Image');
    const interrupt = s.jobStatus === 'generating' && this._ws().activeJobId ? h('button', { type: 'button', className: 'ca-secondary', 'data-interrupt': 'true', onClick: () => this.interruptGeneration(), disabled: !!this._ws().interrupting, title: 'Cancel this generation and confirm the Big Mac process has stopped', 'aria-label': 'Cancel generation' }, this._ws().interrupting ? 'Cancelling…' : 'Cancel') : null;
    const modelPicker = vals.targetSelectV1 || targetSelect;
    const workbench = s.screens[s.version] === 'batch' ? this.buildBatchWorkspace() : h('div', { className: 'ca-generate-form' }, panel('Prompt and target', h('div', { className: 'ca-stack' }, prompt, vals.promptTools || null, modelPicker, targetSelect, negative, samplingNote, basic, this.buildAdvancedSampling(), this.buildSettingsGuide(), this.buildStylesPanel(), vals.createResources || null, vals.createPresets || null, this.buildCreateLoraControls(), h('div', { className: 'ca-form-actions' }, generate, interrupt), this.buildRequestPreview()), accent), this.buildCreateWorkbench(vals.modelsListDisplay));
    return h('div', { className: 'ca-generate-layout' }, h('section', { className: 'ca-results-column' }, panel('Preview and result', this.buildResultStaging(), accent), s.screens[s.version] === 'batch' ? null : panel('Advanced workflows', h('div', { className: 'ca-muted' }, 'Batch / Sweep, prompt drafts, wildcards, enhancement, recipes, macros, and reproducibility remain available in their existing controls. Use Preview request below the form to inspect the exact request and worker command.'), accent)), h('section', { className: 'ca-main-column' }, workbench));
  };

  P.buildConceptSettings = function (vals, accent) {
    const ca = this._ca(), tab = ca.settingsTab;
    const tabs = ['general', 'capabilities', 'keyboard', 'help', 'system'].map(k => h('button', { key: k, type: 'button', className: 'ca-tab', 'aria-selected': String(tab === k), onClick: () => { ca.settingsTab = k; this.caSync(); } }, k[0].toUpperCase() + k.slice(1)));
    const q = String(ca.helpQuery || '').trim().toLowerCase();
    const helpModules = MODULES.filter(m => !q || [m.label, m.desc, ...(HELP[m.id]?.quick || []), ...(HELP[m.id]?.faq || [])].join(' ').toLowerCase().includes(q));
    const helpIndex = h('div', { className: 'ca-help-index' },
      h('label', { className: 'ca-help-search' }, h('span', null, 'Search tutorials'), h('input', { type: 'search', value: ca.helpQuery, placeholder: 'Search modules, steps, or FAQ', onInput: e => { ca.helpQuery = e.target.value; this.caSync(); } })),
      helpModules.length ? h('div', { className: 'ca-help-card-grid' }, ...helpModules.map(m => h('article', { key: m.id, className: 'ca-help-card', style: { '--ca-card-accent': m.accent } }, h('div', { className: 'ca-help-card-title' }, h('span', { style: { color: m.accent } }, moduleIcon(m.id, 18)), h('b', null, m.label)), h('p', null, m.desc), h('button', { type: 'button', className: 'ca-secondary', onClick: e => this.caOpenHelp(m.id, e) }, 'Open tutorial')))) : h('div', { className: 'ca-empty' }, 'No local tutorial matches that search.'));
    const caps = (this.state.modelTargets || []).slice(0, 30).map(t => h('div', { key: t.id, className: 'ca-list-row' }, h('b', null, t.label || t.id), status(t.status || 'UNKNOWN', /PROVEN|AVAILABLE/i.test(t.status || '') ? '#65d66e' : '#fbbf24')));
    let body;
    if (tab === 'help') {
      body = panel('Tutorial index', helpIndex, accent);
    } else if (tab === 'capabilities') {
      const ledger = caps.length ? h('div', { className: 'ca-list' }, ...caps) : h('div', { className: 'ca-empty' }, 'Capability data is loading.');
      body = h('div', { className: 'ca-settings-stack' }, panel('Live model capability ledger', ledger, accent), this.buildFileVerificationPanel(), vals.truthStatusPanel);
    } else if (tab === 'keyboard') {
      const keys = h('div', { className: 'ca-list' },
        h('div', { className: 'ca-list-row' }, h('b', null, 'Cmd/Ctrl + K'), h('small', null, 'Command palette')),
        h('div', { className: 'ca-list-row' }, h('b', null, 'Cmd/Ctrl + Shift + J'), h('small', null, 'Global Queue / History')),
        h('div', { className: 'ca-list-row' }, h('b', null, 'Cmd/Ctrl + Enter'), h('small', null, 'Primary Generate')),
        h('div', { className: 'ca-list-row' }, h('b', null, 'Escape'), h('small', null, 'Close the top transient surface')));
      body = panel('Keyboard', keys, accent);
    } else if (tab === 'system') {
      body = h('div', { className: 'ca-settings-stack' }, vals.systemInfoPanel, this.buildDoctorPanel(), this.buildWorkersPanel());
    } else {
      const general = h('div', { className: 'ca-list' },
        h('label', { className: 'ca-check-row' }, h('input', { type: 'checkbox', checked: !!this.state.savePrompts, onChange: e => { this.setState({ savePrompts: e.target.checked }); try { localStorage.setItem('dex_save_prompts', String(e.target.checked)); } catch (_) {} } }), h('span', null, 'Save prompts in run records')),
        h('div', { className: 'ca-note' }, 'When off, prompt text is not written into run records.'));
      body = h('div', { className: 'ca-settings-stack' },
        panel('General', general, accent),
        panel('Appearance', h('div', { className: 'ca-note' }, 'The native dark operator-console theme is retained. Module accents identify context but are never the only state cue.'), accent),
        panel('Automatic help', h('label', { className: 'ca-check-row' }, h('input', { type: 'checkbox', checked: !!ca.autoHelp, onChange: e => this.caSetAutoHelp(e.target.checked) }), h('span', null, 'Open contextual Help automatically on first visit')), accent));
    }
    return h('div', { className: 'ca-settings' }, h('div', { className: 'ca-tabs', role: 'tablist' }, ...tabs), body);
  };

  // Shared by the V4 inspector and the V2 Context drawer: the module's live context, read from existing state only.
  P._ctxModel = function (moduleId) {
    const s = this.state, target = this._targetSpec() || {}, v12 = window.__DEX_V12 || {}, snap = v12.snapshot || {};
    const row = (label, value) => h('div', { className: 'ca-inspector-row', key: label }, h('span', null, label), h('b', null, value == null || value === '' ? '—' : String(value)));
    const empty = text => h('div', { className: 'ca-empty' }, text);
    const ed = this._ed ? (this._ed() || {}) : {};
    const activeAsset = s.activeAssetSelection;
    let heading = 'Live module context', intro = 'This panel follows the current module state and does not create a second record or job store.';
    let body = [];
    if (moduleId === 'generate') {
      heading = 'Generation context';
      body = [row('Target', target.label || s.target), row('Status', target.status || 'UNKNOWN'), row('Canvas', (s.width || '—') + ' × ' + (s.height || '—')), row('Steps / seed', (s.steps || '—') + ' / ' + (s.seed || 'random')), row('Sampler', this._controls().sampler ? window.DexClient.canonicalSamplerId(s.sampler) : 'Fixed (flow-match Euler)'), row('CLIP skip / tiling', this._controls().clipSkip ? ((s.clipSkip === '' || s.clipSkip == null ? 'model default' : s.clipSkip) + ' / ' + (s.tiling ? 'VAE tiling on' : 'off')) : 'Not available for this target'), row('Output', '/Users/andrew/images_made'), row('Prompt record', s.savePrompts ? 'Saved with run' : 'Params only')];
      intro = 'Only controls supported by the selected target are sent to the existing generation path.';
    } else if (moduleId === 'edit') {
      heading = 'Edit context';
      body = [row('Source', ed.source && (ed.source.imageId || ed.source.id)), row('Operation', ed.operation || ed.mode || s.screens[s.version]), row('Strength', ed.strength), row('Lineage', ed.source ? 'Canonical source retained' : 'Choose a source image')];
      intro = ed.source ? 'The source remains intact; a successful edit becomes a new canonical asset.' : 'Open a canonical image from Media to populate the edit context.';
    } else if (moduleId === 'media') {
      const sel = this._ws && this._ws().lib && this._ws().lib.selected;
      heading = sel ? 'Selected asset' : 'Media context';
      if (sel) {
        const view = { imageId: sel.id, imageUrl: sel.url, seed: sel.meta && sel.meta.seed, target: sel.meta && sel.meta.target, operation: sel.meta && sel.meta.operation, keeper: sel.keeper };
        body = [sel.url ? h('img', { className: 'ca-inspector-preview', src: s.backendUrl + sel.url, alt: sel.id }) : null, row('Asset ID', sel.id), row('Dimensions', (sel.width || '—') + ' × ' + (sel.height || '—')), row('Operation', sel.meta && sel.meta.operation), row('Lineage', sel.parent ? 'Parent: ' + sel.parent : (sel.ancestors && sel.ancestors.length ? 'Original recorded' : 'No lineage recorded')), h('div', { className: 'ca-inspector-actions' }, ...((this.imageActions && this.imageActions(view, { noVariation: true })) || []).slice(0, 5))];
        intro = 'Actions below use the existing Media/lineage handlers for this canonical asset.';
      } else body = [empty('Select an indexed image to inspect metadata, lineage, and compatible actions.')];
    } else if (moduleId === 'voice') {
      const vp = this._vp ? this._vp() : {}, profile = vp.selected && this._profile ? this._profile(vp.selected) : null, render = vp.render;
      heading = 'Voice context'; body = [row('Profile', profile && (profile.name || profile.id)), row('Engine', profile && profile.preferred_engine), row('Profiles', vp.profiles ? vp.profiles.length : 'loading'), row('Render', render && render.status), row('Artifact', render && (render.artifact_id || render.audio_url))];
      intro = profile ? 'Selected voice profile and render state are read from the Voice workspace.' : 'Choose a saved voice profile to populate this inspector.';
    } else if (moduleId === 'music') {
      const mw = this._mws ? this._mws() : {}, worker = this._worker && this._worker(mw.musicWorker), job = mw.jobs && mw.jobs.music;
      heading = 'Music context'; body = [row('Mode', mw.instrumental ? 'Instrumental' : 'Song'), row('Worker', worker && worker.label || mw.musicWorker), row('Worker state', worker && worker.state), row('Duration', mw.aceDuration ? mw.aceDuration + ' s' : '—'), row('Current job', job && job.status), row('Result', job && ((job.artifacts_detail || [])[0] || job.artifacts && job.artifacts[0]))];
      intro = 'Worker availability, job status, and duration are live runtime values. Stems and mastering remain planned.';
    } else if (moduleId === 'assets3d') {
      const job = s.asset3dJob, worker = s.asset3dWorkerStatus;
      heading = '3D asset context'; body = [row('Source artifact', s.asset3dSourceArtifact || (s.runs[0] && s.runs[0].imageFile)), row('Mode', s.asset3dMode), row('Worker', worker && (worker.remote && worker.remote.identity || worker.status)), row('Job', job && (job.status || job.job_id)), row('Output', job && job.artifacts_detail && job.artifacts_detail[0] && job.artifacts_detail[0].artifact_id)];
      intro = 'Individual asset generation is separate from World environment assembly.';
    } else if (moduleId === 'world') {
      const p = (s.worldProjects || [])[0];
      heading = 'World context'; body = [row('Projects', (s.worldProjects || []).length), row('Current project', p && (p.title || p.name || p.id)), row('Source artifact', s.worldSourceArtifact), row('Worker', s.worldWorkerStatus && (s.worldWorkerStatus.status || s.worldWorkerStatus.state)), row('Known render', p && (p.render_artifact_id || p.output_artifact))];
      intro = p ? 'World project records and source artifacts are read from the existing World state.' : 'No World project record is exposed by the current runtime.';
    } else if (moduleId === 'drama') {
      const dm = this._dm ? this._dm() : {}, p = dm.current, run = dm.run;
      heading = 'Drama context'; body = [row('Project', p && (p.title || p.id)), row('Scenes', p && p.scenes && p.scenes.length), row('Actors', p && p.actors && p.actors.length), row('Unresolved', p && p.unresolved && p.unresolved.length), row('Stage', dm.stage), row('Plan', p && p.plan && (p.plan.ready ? (p.plan.work_required ? 'work required' : 'up to date') : 'blocked')), row('Production', (dm.production && dm.production.status) || (run && run.status)), row('Master', p && p.project_master && p.project_master.artifact_id)];
      intro = p ? 'Script, cast, production and proof state are owned by the Drama workspace.' : 'Open or create a Drama project through its existing parser contract.';
    } else if (moduleId === 'settings') {
      heading = 'System context'; body = [row('Event stream', v12.connected ? 'Connected' : 'Reconnecting'), row('Target count', (s.modelTargets || []).length), row('Active jobs', (snap.active || []).length), row('Queued jobs', (snap.queue || []).length), row('Prompt privacy', s.savePrompts ? 'Save enabled' : 'Params only')];
      intro = 'Settings exposes live capability and system truth; it does not silently enable unavailable features.';
    } else {
      heading = 'Workstation context'; body = [row('Recent runs', (s.runs || []).length), row('World projects', (s.worldProjects || []).length), row('Active jobs', (snap.active || []).length), row('Queued jobs', (snap.queue || []).length)];
    }
    if (activeAsset) body.unshift(row('Active asset · ' + activeAsset.kind, activeAsset.id));
    return { heading, intro, body, snap };
  };

  // ── V2 Help / Context drawer ─────────────────────────────────────────────────────────────────────────────
  // A non-modal side drawer (V2 header buttons). Help reuses the module tutorials above; Context reuses _ctxModel.
  // Nothing here creates a record: it only reads existing state and tutorial text.
  P.v2OpenDrawer = function (tab, ev) {
    const ca = this._ca();
    // Escape closes the drawer wherever focus is (focus moves into it on a short timer). Inner widgets that handle Escape themselves
    // call preventDefault first, so this bubbling listener only acts when nothing else claimed the key.
    if (!this._v2dEscBound) {
      this._v2dEscBound = true;
      document.addEventListener('keydown', e => { const d = this._ca().v2d; if (e.key === 'Escape' && d && d.open && !e.defaultPrevented) { e.preventDefault(); this.v2CloseDrawer(); } });
    }
    ca.v2d = { open: true, tab: tab === 'context' ? 'context' : 'help', opener: tab === 'context' ? 'context' : 'help' };
    this.caSync();
    // Only take focus when it is not already inside the drawer: a keyboard user may have reached a tab/close control in the interim.
    setTimeout(() => { const d = document.querySelector('[data-v2-drawer]'); if (d && !d.contains(document.activeElement)) d.focus(); }, 30);
  };
  P.v2CloseDrawer = function () {
    const ca = this._ca(), kind = ca.v2d && ca.v2d.opener;
    ca.v2d = { open: false, tab: (ca.v2d && ca.v2d.tab) || 'help' };
    this.caSync();
    // The header re-renders, so return focus to the opener by identity (its data attribute), not by node reference.
    setTimeout(() => { const o = kind && document.querySelector('[data-studio-' + kind + ']'); if (o) o.focus(); }, 30);
  };
  P._v2DrawerVnode = function () {
    const ca = this._ca(), d = ca.v2d;
    if (!d || !d.open) return null;
    const s = this.state, screen = (s.screens && s.screens[s.version]) || 'create', mod = moduleFor(screen);
    const meta = MODULES.find(m => m.id === mod) || { label: 'This screen' };
    const tabBtn = (id, label) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(d.tab === id), 'data-v2-drawer-tab': id, className: 'ca-secondary', style: { flex: 1, minHeight: 44, fontWeight: d.tab === id ? 800 : 500, borderColor: d.tab === id ? '#7dd3fc' : undefined },
      onClick: () => { ca.v2d = Object.assign({}, ca.v2d, { tab: id }); this.caSync(); } }, label);
    let body;
    if (d.tab === 'help') {
      const H = HELP[mod];
      const list = (title, items, ordered) => items && items.length ? h('section', { key: title, 'data-help-section': title.toLowerCase() }, h('h3', { style: { fontSize: 12, textTransform: 'uppercase', letterSpacing: '.07em', color: '#91a2b4', margin: '12px 0 6px' } }, title),
        h(ordered ? 'ol' : 'ul', { style: { margin: 0, paddingLeft: 20, lineHeight: 1.55, fontSize: 13 } }, ...items.map((t, i) => h('li', { key: i, style: { marginBottom: 6 } }, t)))) : null;
      body = H ? h('div', { 'data-help-module': mod },
        h('p', { style: { fontSize: 13, lineHeight: 1.55, margin: '4px 0 8px' } }, H.what),
        list('Quick start', H.quick), list('Steps', H.steps, true), list('Tips', H.tips), list('FAQ', H.faq))
        : h('div', { className: 'ca-empty' }, 'No tutorial is available for this screen.');
    } else {
      const M = this._ctxModel(mod);
      body = h('div', { 'data-context-module': mod, className: 'ca-inspector-context' }, h('div', { className: 'ca-note' }, M.intro), ...M.body);
    }
    // A div, not an aside: a global narrow-screen rule hides every non-navigation aside.
    return h('div', { role: 'dialog', 'aria-modal': 'false', 'aria-label': (d.tab === 'help' ? 'Help — ' : 'Context — ') + meta.label, 'data-v2-drawer': d.tab, tabIndex: -1,
      onKeyDown: e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.v2CloseDrawer(); } },
      style: { position: 'fixed', top: 52, right: 0, bottom: 0, width: 'min(380px,100vw)', zIndex: 11000, background: '#14161b', borderLeft: '1px solid #454a54', boxShadow: '-12px 0 40px #0008', overflowY: 'auto', padding: 14, color: '#e5edf5', boxSizing: 'border-box' } },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 } }, h('b', { style: { flex: 1, fontSize: 15 } }, meta.label),
        h('button', { type: 'button', className: 'ca-secondary', 'data-v2-drawer-close': '1', 'aria-label': 'Close ' + (d.tab === 'help' ? 'help' : 'context'), style: { minWidth: 44, minHeight: 44 }, onClick: () => this.v2CloseDrawer() }, '×')),
      h('div', { role: 'tablist', 'aria-label': 'Drawer sections', style: { display: 'flex', gap: 6, marginBottom: 6 } }, tabBtn('help', 'Help'), tabBtn('context', 'Context')),
      body);
  };

  // The slot value is ONE persistent DOM node (like the model picker): re-renders must not rebuild the drawer under a keyboard
  // user. Its contents are swapped only when the rendered HTML really changes, and focus is restored by identity.
  P.buildV2Drawer = function () {
    const shell = this._v2dShell || (this._v2dShell = document.createElement('div'));
    shell.setAttribute('data-v2-drawer-host', '');
    const vnode = this._v2DrawerVnode();
    if (!vnode) { if (shell.firstChild) shell.replaceChildren(); shell._html = ''; shell.style.display = 'none'; return shell; }
    shell.style.display = '';
    const next = window.DCRuntime.renderVNode(vnode), html = next.outerHTML;
    if (shell._html === html) return shell;
    const ae = document.activeElement, inside = ae && shell.contains(ae);
    const key = inside ? (ae.hasAttribute('data-v2-drawer-tab') ? '[data-v2-drawer-tab="' + ae.getAttribute('data-v2-drawer-tab') + '"]' : ae.hasAttribute('data-v2-drawer-close') ? '[data-v2-drawer-close]' : '[data-v2-drawer]') : null;
    shell.replaceChildren(next); shell._html = html;
    if (key) { const el = shell.querySelector(key); if (el) el.focus(); }
    return shell;
  };

  P.buildConceptInspector = function (moduleId, accent) {
    const M = this._ctxModel(moduleId), heading = M.heading, intro = M.intro, body = M.body, snap = M.snap;
    const helpButton = moduleId === 'settings' ? null : h('button', { type: 'button', className: 'ca-secondary', 'data-ca-open-help': moduleId, onClick: e => this.caOpenHelp(moduleId, e) }, 'How to use ' + (MODULES.find(m => m.id === moduleId)?.label || 'this section'));
    const ca = this._ca();
    return h(React.Fragment, null,
      ca.inspectorOpen ? h('button', { type: 'button', tabIndex: -1, 'aria-hidden': 'true', className: 'ca-inspector-backdrop', onClick: () => this.caCloseInspector() }) : null,
      h('aside', { className: 'ca-inspector' + (ca.inspectorOpen ? ' is-open' : ''), 'aria-label': 'Contextual inspector', role: ca.inspectorOpen ? 'dialog' : undefined, 'aria-modal': ca.inspectorOpen ? 'true' : undefined, 'aria-hidden': String(!ca.inspectorOpen && typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 1100px)').matches) },
        h('div', { className: 'ca-inspector-mobile-head' }, h('b', null, 'Context'), h('button', { type: 'button', className: 'ca-icon-button ca-inspector-close', 'data-dex-field': 'inspector-close', 'aria-label': 'Close contextual inspector', onClick: () => this.caCloseInspector() }, '×')),
        panel(heading, h('div', { className: 'ca-inspector-context' }, h('div', { className: 'ca-note' }, intro), ...body, helpButton, (snap.active || []).length ? h('div', { className: 'ca-note' }, (snap.active || []).length + ' active job' + ((snap.active || []).length === 1 ? '' : 's') + ' · background work continues while you navigate.') : null), accent)));
  };

  P.buildConceptQueue = function () {
    const ca = this._ca(); if (!ca.queueOpen) return null;
    const snap = (window.__DEX_V12 && window.__DEX_V12.snapshot) || {};
    const lists = [['Active', snap.active || [], '#38bdf8'], ['Queue', snap.queue || [], '#f59e0b'], ['Recent', snap.recent || [], '#94a3b8']];
    const jobRow = (j, i, toneColor) => {
      const id = j.id || j.job_id || ('job-' + i), p = j.progress, pct = progressPercent(p);
      return h('div', { className: 'ca-queue-row', key: id }, h('div', { className: 'ca-queue-row-title' }, h('span', { className: 'ca-queue-dot', style: { background: toneColor } }), h('b', null, j.label || j.operation || j.kind || 'Job'), status(j.status || (toneColor === '#f59e0b' ? 'QUEUED' : 'ACTIVE'), toneColor)), h('small', null, j.error || j.message || (j.artifact_id ? 'Artifact ' + j.artifact_id : id)), pct != null ? h('div', { className: 'ca-queue-progress', role: 'progressbar', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100 }, h('span', { style: { width: pct + '%' } })) : null, p && p.label ? h('small', { className: 'ca-muted' }, p.label) : null, j.elapsedMs != null ? h('small', null, Math.round(j.elapsedMs / 1000) + ' s elapsed') : null, j.canCancel ? h('button', { type: 'button', className: 'ca-secondary ca-queue-cancel', onClick: () => window.__DEX_V12.cancelJob && window.__DEX_V12.cancelJob(id) }, 'Cancel') : null);
    };
    return h('section', { className: 'ca-queue-expanded', 'aria-label': 'Queue and history dock' }, h('div', { className: 'ca-queue-expanded-head' }, h('div', null, h('b', null, 'Queue / History'), h('span', null, 'Shared V12 snapshot · no duplicate subscription')), h('div', { className: 'ca-form-actions' }, h('button', { type: 'button', className: 'ca-secondary', onClick: () => this.caToggleJobs() }, 'Open Full Job Center'), h('button', { type: 'button', className: 'ca-icon-button', 'aria-label': 'Collapse queue and history', onClick: () => this.caToggleQueue() }, '×'))), h('div', { className: 'ca-queue-columns' }, ...lists.map(([label, jobs, color]) => h('div', { className: 'ca-queue-column', key: label }, h('h4', null, label, h('span', null, jobs.length)), jobs.length ? jobs.slice(0, 8).map((j, i) => jobRow(j, i, color)) : h('div', { className: 'ca-empty' }, 'None reported by V12.')))));
  };

  P.buildConceptHelp = function () {
    const ca = this._ca(); if (!ca.help.open) return null;
    const moduleId = ca.help.module, content = HELP[moduleId] || HELP.settings, mod = MODULES.find(m => m.id === moduleId) || MODULES[9], tab = ca.help.tab;
    const steps = content.steps || [], faq = content.faq || [];
    let body;
    if (tab === 'quick') body = h('div', { className: 'ca-help-step-grid' }, ...(content.quick || []).map((x, i) => h('article', { className: 'ca-help-step', key: i }, h('span', null, String(i + 1).padStart(2, '0')), h('p', null, x))));
    else if (tab === 'what') body = h('div', { className: 'ca-tutorial-flow' }, h('div', null, h('b', null, 'Input'), h('span', null, 'Prompt, asset, script, or live project state')), h('i', null, '→'), h('div', null, h('b', null, 'Function'), h('span', null, content.what)), h('i', null, '→'), h('div', null, h('b', null, 'Output'), h('span', null, 'Canonical asset, project record, or truthful unavailable state')), h('div', { className: 'ca-tutorial-connected' }, h('b', null, 'Connected modules'), h('span', null, 'Media · Queue / History · capability ledger')));
    else if (tab === 'steps') body = h('ol', { className: 'ca-help-list' }, ...steps.map((x, i) => h('li', { key: i }, x)));
    else if (tab === 'tips') body = h('div', { className: 'ca-help-tip-grid' }, ...(content.tips || []).map((x, i) => h('div', { className: 'ca-help-tip', key: i }, h('b', null, 'Tip ' + (i + 1)), h('p', null, x))));
    else body = h('div', { className: 'ca-help-faq' }, ...faq.map((x, i) => h('details', { key: i, open: !!ca.faqOpen[moduleId + ':' + i], onToggle: e => { ca.faqOpen[moduleId + ':' + i] = e.target.open; } }, h('summary', null, x.split('?')[0] + (x.includes('?') ? '?' : '')), h('p', null, x.includes('?') ? x.slice(x.indexOf('?') + 1).trim() : x))));
    return h('div', { className: 'ca-modal-backdrop', onClick: e => { if (e.target === e.currentTarget) this.caCloseHelp(); } }, h('section', { className: 'ca-help-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'ca-help-title', 'data-ca-help-dialog': 'true' }, h('header', { className: 'ca-help-header' }, h('div', null, h('span', { className: 'ca-help-icon', style: { color: mod.accent } }, moduleIcon(mod.id, 22)), h('h2', { id: 'ca-help-title' }, 'How to use ' + mod.label), h('p', null, mod.desc)), h('button', { type: 'button', className: 'ca-icon-button', 'aria-label': 'Close help', onClick: () => this.caCloseHelp() }, '×')), h('div', { className: 'ca-help-tabs', role: 'tablist' }, ...[['quick', 'Quick Start'], ['what', 'What It Does'], ['steps', 'Steps'], ['tips', 'Tips'], ['faq', 'FAQ']].map(([key, label]) => h('button', { key, type: 'button', className: 'ca-tab', role: 'tab', 'data-ca-help-tab': key, 'aria-selected': String(tab === key), onClick: () => { ca.help.tab = key; this.caSync(); } }, label))), h('div', { className: 'ca-help-body' }, body), h('footer', { className: 'ca-help-footer' }, h('label', { className: 'ca-check-row' }, h('input', { type: 'checkbox', checked: !ca.autoHelp, onChange: e => this.caSetAutoHelp(!e.target.checked) }), h('span', null, "Don't show automatically")), h('button', { type: 'button', className: 'ca-secondary', onClick: () => this.caOpenTutorial(moduleId) }, 'View full tutorial'), h('button', { type: 'button', className: 'ca-primary', onClick: () => this.caCloseHelp() }, 'Done'))));
  };

  P.buildConceptShell = function (vals) {
    const ca = this._ca(), moduleId = this.caModule(), mod = MODULES.find(m => m.id === moduleId) || MODULES[0], accent = mod.accent, screen = this.state.screens[this.state.version];
    const resource = (window.__DEX_V12 && window.__DEX_V12.snapshot && window.__DEX_V12.snapshot.resources) || {};
    const resourceBusy = !!(resource.occupied || resource.owner);
    const resourceText = resourceBusy ? 'Big Mac · ' + ((resource.owner && resource.owner.label) || 'compute in use') : 'Big Mac · free';
    const navItem = m => h('button', { key: m.id, type: 'button', className: 'ca-nav-item' + (m.id === moduleId ? ' is-active' : ''), 'data-nav': 'true', 'data-active': m.id === moduleId ? 'true' : 'false', 'aria-current': m.id === moduleId ? 'page' : undefined, title: m.label, onClick: () => this.caNavigate(m.id), style: { '--ca-accent': m.accent } }, h('span', { className: 'ca-nav-icon', 'aria-hidden': 'true' }, moduleIcon(m.icon, 17)), h('span', { className: 'ca-nav-label' }, m.label));
    const nav = [
      ['HOME', ['workstation']], ['CREATE', ['generate', 'edit']], ['AUDIO', ['voice', 'drama', 'music']],
      ['SPATIAL', ['assets3d', 'world']], ['MANAGE', ['media', 'settings']],
    ].map(([label, ids]) => h('div', { key: label, className: 'ca-nav-group' }, h('span', { className: 'ca-nav-group-label' }, label), ...ids.map(id => navItem(MODULES.find(m => m.id === id)))));
    const tabs = moduleId === 'generate' ? [['create', 'Text to Image', true], ['batch', 'Batch / Sweep', true]] : moduleId === 'edit' ? [['edit', 'Img2Img / Inpaint', true], ['enhance', 'Upscale / Enhance', true]] : moduleId === 'music' ? [['music-song', 'Song', true], ['music-instrumental', 'Instrumental', true], ['planned-stems', 'Stems · Planned', false], ['planned-mastering', 'Mastering · Planned', false]] : moduleId === 'drama' ? [] : moduleId === 'settings' ? [['general', 'General', true], ['capabilities', 'Capabilities', true], ['help', 'Help / Tutorials', true], ['system', 'System', true]] : [];
    const headerTabs = tabs.length ? h('div', { className: 'ca-tabs ca-header-tabs', role: 'tablist' }, ...tabs.map(([id, label, enabled], i) => { const selected = id === screen || (moduleId === 'settings' && ca.settingsTab === id) || (id === 'music-song' && !this._mws().instrumental) || (id === 'music-instrumental' && !!this._mws().instrumental) || (moduleId === 'drama' && i === 0); return h('button', { key: label, type: 'button', role: 'tab', className: 'ca-tab' + (selected ? ' is-selected' : ''), 'aria-selected': String(selected), disabled: !enabled, onClick: () => { if (id === 'general' || id === 'capabilities' || id === 'help' || id === 'system') { ca.settingsTab = id; this.caSync(); } else if (id === 'music-song' || id === 'music-instrumental') this.mSet({ instrumental: id === 'music-instrumental' }); else if (id === 'edit' || id === 'enhance' || id === 'create' || id === 'batch') this.setScreen(id); } }, label); })) : null;
    let canvas;
    if (moduleId === 'workstation') canvas = this.buildConceptWorkstation(vals, accent);
    else if (moduleId === 'generate') canvas = this.buildConceptGenerate(vals, accent);
    else if (moduleId === 'edit') canvas = screen === 'enhance' ? this.buildEnhanceWorkbench() : this.buildEditWorkbench();
    else if (moduleId === 'media') {
      const libraryView = ca.libraryView === 'media' ? 'media' : 'images';
      const libraryTabs = h('div', { className: 'ca-library-tabs', role: 'tablist', 'aria-label': 'Library views', style: { display: 'flex', gap: 4, paddingBottom: 8, borderBottom: '1px solid rgba(148,163,184,.16)' }, onKeyDown: e => {
        const keys = { ArrowLeft: libraryView === 'media' ? 'images' : 'media', ArrowRight: libraryView === 'images' ? 'media' : 'images', Home: 'images', End: 'media' };
        if (keys[e.key]) { e.preventDefault(); this.caSetLibraryView(keys[e.key]); }
      } },
        ...[['images', 'Image library'], ['media', 'Audio & video index']].map(([id, label]) => h('button', { key: id, type: 'button', role: 'tab', className: 'ca-tab' + (libraryView === id ? ' is-selected' : ''), 'data-ca-library-tab': id, 'aria-selected': String(libraryView === id), 'aria-controls': 'ca-library-view-' + id, tabIndex: libraryView === id ? 0 : -1, onClick: () => this.caSetLibraryView(id) }, label)));
      const imagePanel = h('div', { id: 'ca-library-view-images', role: 'tabpanel', 'aria-label': 'Image library', tabIndex: 0, hidden: libraryView !== 'images' }, libraryView === 'images' ? this.buildLibraryWorkbench() : null);
      const mediaPanel = h('div', { id: 'ca-library-view-media', role: 'tabpanel', 'aria-label': 'Audio and video index', tabIndex: 0, hidden: libraryView !== 'media' }, libraryView === 'media' ? this.buildMediaLibraryPanel() : null);
      canvas = h('div', { className: 'ca-media-stack' }, libraryTabs, imagePanel, mediaPanel);
    }
    else if (moduleId === 'voice') canvas = this.buildVoiceWorkspace();
    else if (moduleId === 'music') canvas = this.buildMusicWorkspace();
    else if (moduleId === 'assets3d') canvas = this.buildAsset3dWorkspace();
    else if (moduleId === 'world') canvas = this.buildWorldWorkspace();
    else if (moduleId === 'drama') canvas = this.buildDramaWorkspace();
    else canvas = this.buildConceptSettings(vals, accent);
    return h('div', { className: 'ca-shell', 'data-ca-module': moduleId, style: { '--ca-accent': accent } },
      h('aside', { className: 'ca-nav', 'aria-label': 'Primary modules' }, h('button', { type: 'button', className: 'ca-brand', onClick: () => this.caNavigate('workstation'), 'aria-label': 'Dexter Studio home · Workstation' }, h('img', { src: 'uploads/grok_image_1775521844329.jpg', alt: '' }), h('span', { className: 'ca-brand-copy' }, h('b', null, 'DexDiffusion'), h('small', null, 'DEXTER STUDIO'))), h('nav', { 'aria-label': 'Workspaces' }, ...nav), h('button', { type: 'button', className: 'ca-nav-jobs', onClick: () => this.caToggleJobs() }, 'Jobs', status(String((window.__DEX_V12?.activeJobCount || 0) + (window.__DEX_V12?.queuedJobCount || 0)), '#e32636'))),
      h('header', { className: 'ca-topbar' }, h('div', { className: 'ca-topbar-context' }, h('span', { className: 'ca-kicker' }, 'DEXTER STUDIO'), h('b', null, 'Private creative workstation')), h('button', { type: 'button', className: 'ca-search', onClick: () => this.caTogglePalette(), 'aria-label': 'Search commands and navigation' }, h('span', { className: 'ca-search-short' }, 'Search'), h('span', { className: 'ca-search-hint' }, '⌘K  Search commands and navigation')), h('div', { className: 'ca-topbar-actions' }, h('span', { className: 'ca-live ' + (window.__DEX_V12?.connected ? 'is-connected' : 'is-disconnected'), role: 'status' }, 'Event stream ' + (window.__DEX_V12?.connected ? 'connected' : 'reconnecting')), h('button', { type: 'button', className: 'ca-topbar-job', onClick: () => this.caToggleJobs() }, 'Jobs ' + ((window.__DEX_V12?.activeJobCount || 0) + (window.__DEX_V12?.queuedJobCount || 0))), h('button', { type: 'button', className: 'ca-icon-button ca-inspector-open', 'aria-label': 'Open contextual inspector', 'aria-expanded': String(ca.inspectorOpen), onClick: e => this.caOpenInspector(e) }, 'Details'), h('button', { type: 'button', className: 'ca-icon-button', 'aria-label': 'Open help', 'data-ca-open-help': moduleId, onClick: e => this.caOpenHelp(moduleId, e) }, '?'))),
      h('header', { className: 'ca-module-header', style: { borderLeftColor: accent } }, h('div', { className: 'ca-module-title' }, h('span', { className: 'ca-module-icon', style: { color: accent } }, moduleIcon(mod.icon, 22)), h('div', null, h('h1', null, mod.label), h('p', null, mod.desc))), headerTabs, h('button', { type: 'button', className: 'ca-help-button', 'data-ca-open-help': moduleId, onClick: e => this.caOpenHelp(moduleId, e) }, '?  How to use this section')),
      h('main', { className: 'ca-canvas', 'data-ca-module': moduleId }, canvas),
      this.buildConceptInspector(moduleId, accent),
      h('footer', { className: 'ca-queue-bar' }, h('div', { className: 'ca-job-summary' }, h('b', null, 'Queue / History'), h('span', { className: 'ca-queue-count' }, (window.__DEX_V12?.activeJobCount || 0) + ' active · ' + (window.__DEX_V12?.queuedJobCount || 0) + ' queued · recent results retained'), h('span', { className: 'ca-resource-status ' + (resourceBusy ? 'is-busy' : 'is-free'), role: 'status' }, resourceText)), h('div', { className: 'ca-form-actions' }, h('button', { type: 'button', className: 'ca-secondary', 'aria-expanded': String(ca.queueOpen), onClick: () => this.caToggleQueue() }, ca.queueOpen ? 'Collapse dock' : 'Expand dock'), h('button', { type: 'button', className: 'ca-secondary', onClick: () => this.caToggleJobs() }, 'Open Global Job Center  ⌘⇧J'))),
      this.buildConceptQueue(),
      this.buildConceptHelp());
  };

  const oldKeydown = P.onKeydown;
  P.onKeydown = function (e) {
    const ca = this._ca();
    if (ca.help.open) {
      const dialog = document.querySelector('[data-ca-help-dialog]');
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.caCloseHelp(); return; }
      if (e.key === 'Tab' && dialog) {
        const controls = [...dialog.querySelectorAll('button,input,select,textarea')].filter(x => !x.disabled && x.getClientRects().length);
        const first = controls[0], last = controls[controls.length - 1];
        if (e.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { e.preventDefault(); first?.focus(); }
      }
      return;
    }
    if (ca.inspectorOpen) {
      const drawer = document.querySelector('.ca-inspector.is-open');
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.caCloseInspector(); return; }
      if (e.key === 'Tab' && drawer) {
        const controls = [...drawer.querySelectorAll('button,input,select,textarea,a,[tabindex]:not([tabindex="-1"])')].filter(x => !x.disabled && x.getClientRects().length);
        const first = controls[0], last = controls[controls.length - 1];
        if (e.shiftKey && (document.activeElement === first || !drawer.contains(document.activeElement))) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && (document.activeElement === last || !drawer.contains(document.activeElement))) { e.preventDefault(); first?.focus(); }
      }
    }
    if (oldKeydown) oldKeydown.call(this, e);
  };

  const oldRenderVals = P.renderVals;
  P.renderVals = function () {
    const vals = oldRenderVals.call(this);
    vals.conceptShell = this.buildConceptShell(vals);
    return vals;
  };

  const oldMount = P.componentDidMount;
  P.componentDidMount = function () {
    oldMount.call(this);
    this._ca();
    if (!this._caHelpDelegate) {
      this._caHelpDelegate = event => {
        if (event.__dexConceptHelpHandled) return;
        const trigger = event.target && event.target.closest && event.target.closest('[data-ca-open-help]');
        if (trigger) this.caOpenHelp(trigger.getAttribute('data-ca-open-help'), event);
      };
      document.addEventListener('click', this._caHelpDelegate);
    }
  };
  const oldUnmount = P.componentWillUnmount;
  P.componentWillUnmount = function () {
    if (this._caHelpDelegate) {
      document.removeEventListener('click', this._caHelpDelegate);
      this._caHelpDelegate = null;
    }
    if (oldUnmount) oldUnmount.call(this);
  };
})();
