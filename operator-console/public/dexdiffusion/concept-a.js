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

  const MODULES = [
    { id: 'workstation', label: 'Workstation', icon: '⌂', accent: '#ef6f61', desc: 'Start, resume, and see what needs attention.' },
    { id: 'generate', label: 'Generate', icon: '✦', accent: '#38bdf8', desc: 'Create images from prompts and references.' },
    { id: 'edit', label: 'Edit', icon: '◈', accent: '#a78bfa', desc: 'Transform, inpaint, and enhance image assets.' },
    { id: 'media', label: 'Media', icon: '▦', accent: '#f59e0b', desc: 'Browse the canonical creative asset library.' },
    { id: 'voice', label: 'Voice', icon: '◌', accent: '#22d3ee', desc: 'Create and manage narration and voice assets.' },
    { id: 'music', label: 'Music', icon: '♫', accent: '#14b8a6', desc: 'Generate songs and instrumental audio.' },
    { id: 'assets3d', label: '3D Assets', icon: '◇', accent: '#65d66e', desc: 'Create and inspect individual 3D assets.' },
    { id: 'world', label: 'World Viewer', icon: '◎', accent: '#818cf8', desc: 'Assemble environments, cameras, and renders.' },
    { id: 'drama', label: 'Drama', icon: '▣', accent: '#e11d68', desc: 'Turn scripts and assets into audio drama.' },
    { id: 'settings', label: 'Settings / Help', icon: '?', accent: '#94a3b8', desc: 'Preferences, capability truth, and tutorials.' },
  ];

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
      quick: ['Choose a canonical image, select a proven 3D mode, and start the job.', 'Open the resulting GLB or send the individual asset to World Viewer.'],
      what: '3D Assets owns individual generated or imported objects. Hunyuan 3D, staging, checksum verification, canonical storage, and remote cleanup remain in the existing job path.',
      steps: ['Select an image source.', 'Choose Quick Geometry, Mesh, or Textured Asset only when its live proof gate is open.', 'Inspect, export, or place the asset in World Viewer.'],
      tips: ['PBR is disabled because its memory safety is not proven on the current machine.', 'World owns environments; this module owns individual objects.'],
      faq: ['Why is a mode unavailable? The runtime has not proven that mode safe and executable here.', 'Does World receive a copy? The handoff uses the canonical asset identity.'],
    },
    world: {
      quick: ['Open a world or sample environment, then place supported assets in the viewport.', 'Use render/export to create a media result without implying editable-scene transfer.'],
      what: 'World Viewer owns environments, scene assembly, camera, lighting, and render output. Individual object generation remains in 3D Assets.',
      steps: ['Open or create a supported world.', 'Place assets and adjust camera or environment settings.', 'Render, export, or hand the rendered result to Media or Drama.'],
      tips: ['Reset camera/navigation if a view becomes unusable.', 'Hidden 3D workspaces should not consume render resources.'],
      faq: ['Can Drama edit a live world? Only a real scene contract can provide that; rendered handoffs are labeled as renders.', 'Why is a feature disabled? The current World runtime does not expose an executable path.'],
    },
    drama: {
      quick: ['Paste a script, parse it, review the lines, and bind saved voices before rendering.', 'Attach real Media audio and rendered assets only through the available contracts.'],
      what: 'Drama is the narrative assembly workspace. Script parsing, voice casting, line/take rendering, scene assembly, and audio export are backed; storyboard, beats, and dialogue-polish surfaces are staged until their contracts are implemented.',
      steps: ['Create or open a Drama project.', 'Review parsed scenes and cast speakers to saved voices.', 'Render takes, assemble the project, and export the resulting WAV/package.'],
      tips: ['Unsaved scripts remain in memory until Save project is explicit.', 'Every rerender is a new take; choose the active take deliberately.'],
      faq: ['Why is a tab labeled Planned? It has no executable backend contract yet.', 'Can Music be attached? Only completed canonical audio assets can be attached.'],
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
    this.ca = { help: { open: false, module: 'workstation', tab: 'quick', opener: null }, autoHelp, settingsTab: 'general' };
    return this.ca;
  };
  P.caSync = function () { this.setState({ _caTick: (this.state._caTick || 0) + 1 }); };
  P.caModule = function () { return moduleFor(this.state.screens[this.state.version]); };
  P.caNavigate = function (id) {
    const target = id === 'workstation' ? 'workstation' : id === 'generate' ? 'create' : id === 'edit' ? 'edit' : id === 'media' ? 'library' : id === 'assets3d' ? '3d' : id === 'settings' ? 'system' : id;
    this.setScreen(target);
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

  P.buildConceptWorkstation = function (vals, accent) {
    const runs = (this.state.runs || []).slice(0, 8), v12 = window.__DEX_V12 || {}, snap = v12.snapshot || {};
    const runCard = r => h('button', { key: r.id, type: 'button', className: 'ca-asset-card', onClick: () => this.showInLibrary(r.id), title: 'Open ' + r.id },
      r.fullUrl ? h('img', { src: r.fullUrl, alt: r.id, loading: 'lazy' }) : h('div', { className: 'ca-asset-placeholder' }, 'No preview'),
      h('span', null, r.model + ' · ' + r.size), h('small', null, r.badge || 'RUN'));
    const quick = [
      ['Generate an image', 'Prompt → canonical image', 'generate'], ['Edit an image', 'Img2img or Inpaint', 'edit'], ['Open Media', 'Search and reuse assets', 'media'],
      ['Create voice', 'Narration and profiles', 'voice'], ['Open 3D Assets', 'Individual GLB assets', 'assets3d'], ['Open World Viewer', 'Scene and camera work', 'world'],
      ['Open Music', 'Song or instrumental audio', 'music'], ['Open Drama', 'Script and voice assembly', 'drama'],
    ].map(([title, desc, id]) => h('button', { key: id, type: 'button', className: 'ca-quick-card', onClick: () => this.caNavigate(id) }, h('span', { className: 'ca-quick-icon', style: { color: MODULES.find(m => m.id === id)?.accent || accent } }, MODULES.find(m => m.id === id)?.icon || '→'), h('span', null, h('b', null, title), h('small', null, desc))));
    const projects = (this.state.worldProjects || []).slice(0, 4);
    const projectBody = projects.length ? h('div', { className: 'ca-list' }, ...projects.map(p => {
      return h('button', { key: p.id || p.project_id, type: 'button', className: 'ca-list-row', onClick: () => this.caNavigate('world') },
        h('b', null, p.title || p.name || p.id), h('small', null, 'World project · open in World Viewer'));
    })) : h('div', { className: 'ca-empty' }, 'No project records are exposed by the current runtime. Resume from a recent asset or open a creative module.');
    const activeItems = [...(snap.active || []).slice(0, 4).map(j => h('div', { key: j.id, className: 'ca-list-row' }, h('b', null, j.label || j.operation || 'Job'), status(j.status || 'ACTIVE', '#38bdf8'))),
      ...(snap.queue || []).slice(0, 3).map(j => h('div', { key: j.id, className: 'ca-list-row' }, h('b', null, j.label || j.operation || 'Queued job'), status('QUEUED', '#f59e0b')))];
    if (!activeItems.length) activeItems.push(h('div', { className: 'ca-empty', key: 'none' }, 'No active or queued jobs.'));
    const promptComposer = h('div', { className: 'ca-stack' },
      h('label', { className: 'ca-field' }, h('span', null, 'Prompt'), h('textarea', { rows: 4, value: this.state.prompt || '', placeholder: 'Describe the image. A1111 syntax supported.', onInput: e => { this.state.prompt = e.target.value; } })),
      vals.promptTools || null,
      this.buildCreateResources(),
      h('div', { className: 'ca-form-actions' }, btn('Open Generate', () => this.caNavigate('generate'), '#38bdf8'))
    );
    return h('div', { className: 'ca-workstation' },
      panel('Quick prompt', promptComposer, accent),
      panel('Quick Start', h('div', { className: 'ca-quick-grid' }, ...quick), accent),
      h('div', { className: 'ca-columns-2' }, panel('Recent Projects', projectBody, accent), panel('Active Jobs', h('div', { className: 'ca-list' }, ...activeItems), accent)),
      panel('Recent Assets', runs.length ? h('div', { className: 'ca-asset-grid' }, ...runs.map(runCard)) : h('div', { className: 'ca-empty' }, 'No indexed image runs yet. Generate an image to create the first canonical asset.'), accent),
      panel('Templates / Recipes', h('div', { className: 'ca-recipe-row' }, h('span', null, 'Use saved settings recipes from Generate.'), btn('Open Generate', () => this.caNavigate('generate'), '#38bdf8'), h('span', { className: 'ca-muted' }, 'Prompt text is governed by the existing privacy setting.')), accent));
  };

  P.buildConceptGenerate = function (vals, accent) {
    const s = this.state, ctl = this._controls(), targets = s.modelTargets || [], target = this._targetSpec() || {};
    const input = (label, value, onInput, extra) => h('label', { className: 'ca-field' }, h('span', null, label), h('input', Object.assign({ value: String(value ?? ''), onInput, onChange: onInput }, extra || {})));
    const prompt = h('label', { className: 'ca-field' }, h('span', null, 'Prompt'), h('textarea', { rows: 6, value: s.prompt || '', placeholder: 'Describe the image. A1111 syntax supported.', onInput: e => { this.state.prompt = e.target.value; } }));
    const negative = ctl.negativePrompt ? h('label', { className: 'ca-field' }, h('span', null, 'Negative prompt'), h('textarea', { rows: 2, value: s.negPrompt || '', onInput: e => { this.state.negPrompt = e.target.value; } })) : h('div', { className: 'ca-note' }, 'Negative prompt is unavailable for ' + (target.label || s.target) + ' and will not be sent.');
    const targetSelect = h('label', { className: 'ca-field' }, h('span', null, 'Model target'), h('select', { value: s.target, onChange: e => this.onSelectTarget(e.target.value) }, ...(targets.length ? targets : [{ id: s.target, label: s.target, status: 'UNKNOWN' }]).map(t => h('option', { key: t.id, value: t.id }, (t.label || t.id) + ' · ' + (t.status || 'UNKNOWN')))));
    const basic = h('div', { className: 'ca-form-grid' },
      input('Steps', s.steps, e => { this.state.steps = e.target.value; }, { type: 'number', min: 1, max: 150 }),
      ctl.cfg ? input('CFG', s.cfg, e => { this.state.cfg = e.target.value; }, { type: 'number', min: 1, max: 30, step: .5 }) : null,
      input('Seed', s.seed, e => { this.state.seed = e.target.value; }, { type: 'number' }),
      input('Width', s.width, e => { this.state.width = e.target.value; }, { type: 'number', min: 256, step: 8 }),
      input('Height', s.height, e => { this.state.height = e.target.value; }, { type: 'number', min: 256, step: 8 }),
      ctl.scheduler ? h('label', { className: 'ca-field' }, h('span', null, 'Scheduler'), h('select', { value: s.scheduler, onChange: e => this.setState({ scheduler: e.target.value }) }, ...['discrete', 'karras', 'exponential', 'ays', 'sgm_uniform', 'simple'].map(x => h('option', { key: x }, x)))) : null);
    const generate = h('button', { type: 'button', className: 'ca-primary', onClick: () => this.onGenerate(), disabled: s.jobStatus === 'generating' }, s.jobStatus === 'generating' ? (vals.generateLabel || 'Generating…') : 'Generate Image');
    const modelPicker = vals.targetSelectV1 || targetSelect;
    const workbench = s.screens[s.version] === 'batch' ? this.buildBatchWorkspace() : h('div', { className: 'ca-generate-form' }, panel('Prompt and target', h('div', { className: 'ca-stack' }, prompt, vals.promptTools || null, modelPicker, targetSelect, negative, basic, vals.createResources || null, vals.createPresets || null, h('div', { className: 'ca-form-actions' }, generate)), accent), this.buildCreateWorkbench(vals.modelsListDisplay));
    return h('div', { className: 'ca-generate-layout' }, h('section', { className: 'ca-main-column' }, workbench), h('section', { className: 'ca-results-column' }, panel('Preview and result', this.buildResultStaging(), accent), s.screens[s.version] === 'batch' ? null : panel('Advanced workflows', h('div', { className: 'ca-muted' }, 'Batch, sweeps, prompt drafts, wildcards, enhancement, command preview, recipes, macros, and reproducibility remain available in the existing Advanced controls above.'), accent)));
  };

  P.buildConceptSettings = function (vals, accent) {
    const ca = this._ca(), tab = ca.settingsTab;
    const tabs = ['general', 'capabilities', 'keyboard', 'help', 'system'].map(k => h('button', { key: k, type: 'button', className: 'ca-tab', 'aria-selected': String(tab === k), onClick: () => { ca.settingsTab = k; this.caSync(); } }, k[0].toUpperCase() + k.slice(1)));
    const helpIndex = h('div', { className: 'ca-help-index' }, ...MODULES.map(m => h('button', { key: m.id, type: 'button', className: 'ca-list-row', onClick: e => this.caOpenHelp(m.id, e) }, h('span', { style: { color: m.accent } }, m.icon + '  ' + m.label), h('small', null, 'Open tutorial'))));
    const caps = (this.state.modelTargets || []).slice(0, 30).map(t => h('div', { key: t.id, className: 'ca-list-row' }, h('b', null, t.label || t.id), status(t.status || 'UNKNOWN', /PROVEN|AVAILABLE/i.test(t.status || '') ? '#65d66e' : '#fbbf24')));
    let body;
    if (tab === 'help') {
      body = panel('Tutorial index', helpIndex, accent);
    } else if (tab === 'capabilities') {
      const ledger = caps.length ? h('div', { className: 'ca-list' }, ...caps) : h('div', { className: 'ca-empty' }, 'Capability data is loading.');
      body = h('div', { className: 'ca-settings-stack' }, panel('Live model capability ledger', ledger, accent), vals.truthStatusPanel);
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

  P.buildConceptInspector = function (moduleId, accent) {
    const s = this.state, target = this._targetSpec() || {}, v12 = window.__DEX_V12 || {}, snap = v12.snapshot || {};
    const text = { workstation: 'Choose a real task or resume a canonical asset.', generate: (target.label || s.target) + ' · ' + (target.status || 'unknown'), edit: this._ed && this._ed().source ? 'Source: ' + this._ed().source.imageId : 'Open a canonical image to edit.', media: 'Select an asset for metadata, lineage, and compatible actions.', voice: 'Voice output is retained in the canonical media store.', music: 'Worker and heavy-compute state come from the runtime.', assets3d: 'Individual assets only; environments belong in World Viewer.', world: 'World owns scene assembly and render output.', drama: 'Script and audio assembly with explicit asset contracts.', settings: 'Live capability and system truth.' }[moduleId];
    return h('aside', { className: 'ca-inspector', 'aria-label': 'Contextual inspector' }, panel('Inspector', h('div', { className: 'ca-stack' }, h('div', { className: 'ca-note' }, text), moduleId === 'generate' ? h('div', { className: 'ca-list' }, h('div', { className: 'ca-list-row' }, h('b', null, 'Output'), h('small', null, '/Users/andrew/images_made')), h('div', { className: 'ca-list-row' }, h('b', null, 'Privacy'), h('small', null, s.savePrompts ? 'Prompt saving on' : 'Prompt saving off'))) : null, moduleId === 'settings' ? null : h('button', { type: 'button', className: 'ca-secondary', 'data-ca-open-help': moduleId, onClick: e => this.caOpenHelp(moduleId, e) }, 'How to use ' + (MODULES.find(m => m.id === moduleId)?.label || 'this section')), (snap.active || []).length ? h('div', { className: 'ca-note' }, (snap.active || []).length + ' active job' + ((snap.active || []).length === 1 ? '' : 's') + ' · background work continues while you navigate.') : null), accent));
  };

  P.buildConceptHelp = function () {
    const ca = this._ca(); if (!ca.help.open) return null;
    const moduleId = ca.help.module, content = HELP[moduleId] || HELP.settings, mod = MODULES.find(m => m.id === moduleId) || MODULES[9];
    const tab = ca.help.tab, text = content[tab] || content.quick;
    const body = Array.isArray(text) ? h('ol', { className: 'ca-help-list' }, ...text.map((x, i) => h('li', { key: i }, x))) : h('p', { className: 'ca-help-copy' }, text);
    return h('div', { className: 'ca-modal-backdrop', onClick: e => { if (e.target === e.currentTarget) this.caCloseHelp(); } }, h('section', { className: 'ca-help-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'ca-help-title', 'data-ca-help-dialog': 'true' }, h('header', { className: 'ca-help-header' }, h('div', null, h('span', { style: { color: mod.accent } }, mod.icon + ' '), h('h2', { id: 'ca-help-title' }, 'How to use ' + mod.label), h('p', null, mod.desc)), h('button', { type: 'button', className: 'ca-icon-button', 'aria-label': 'Close help', onClick: () => this.caCloseHelp() }, '×')), h('div', { className: 'ca-help-tabs', role: 'tablist' }, ...[['quick', 'Quick Start'], ['what', 'What It Does'], ['steps', 'Steps'], ['tips', 'Tips'], ['faq', 'FAQ']].map(([key, label]) => h('button', { key, type: 'button', className: 'ca-tab', 'data-ca-help-tab': key, 'aria-selected': String(tab === key), onClick: () => { ca.help.tab = key; this.caSync(); } }, label))), h('div', { className: 'ca-help-body' }, body), h('footer', { className: 'ca-help-footer' }, h('label', { className: 'ca-check-row' }, h('input', { type: 'checkbox', checked: !ca.autoHelp, onChange: e => this.caSetAutoHelp(!e.target.checked) }), h('span', null, "Don't show automatically")), h('button', { type: 'button', className: 'ca-primary', onClick: () => this.caCloseHelp() }, 'Done'))));
  };

  P.buildConceptShell = function (vals) {
    const ca = this._ca(), moduleId = this.caModule(), mod = MODULES.find(m => m.id === moduleId) || MODULES[0], accent = mod.accent, screen = this.state.screens[this.state.version];
    const nav = MODULES.map(m => h('button', { key: m.id, type: 'button', className: 'ca-nav-item' + (m.id === moduleId ? ' is-active' : ''), 'data-nav': 'true', 'data-active': m.id === moduleId ? 'true' : 'false', 'aria-current': m.id === moduleId ? 'page' : undefined, title: m.label, onClick: () => this.caNavigate(m.id), style: { '--ca-accent': m.accent } }, h('span', { className: 'ca-nav-icon', 'aria-hidden': 'true' }, m.icon), h('span', { className: 'ca-nav-label' }, m.label)));
    const tabs = moduleId === 'generate' ? [['create', 'Text to Image', true], ['batch', 'Batch / Sweep', true]] : moduleId === 'edit' ? [['edit', 'Img2Img / Inpaint', true], ['enhance', 'Upscale / Enhance', true]] : moduleId === 'music' ? [['music', 'Song', true], ['music', 'Instrumental', true], ['planned-stems', 'Stems · Planned', false], ['planned-mastering', 'Mastering · Planned', false]] : moduleId === 'drama' ? [['drama', 'Script', true], ['planned-beats', 'Beats · Planned', false], ['planned-storyboard', 'Storyboard · Planned', false], ['drama', 'Performance', true], ['planned-polish', 'Dialogue Polish · Planned', false]] : moduleId === 'settings' ? [['general', 'General', true], ['capabilities', 'Capabilities', true], ['help', 'Help / Tutorials', true], ['system', 'System', true]] : [];
    const headerTabs = tabs.length ? h('div', { className: 'ca-tabs ca-header-tabs', role: 'tablist' }, ...tabs.map(([id, label, enabled], i) => h('button', { key: label, type: 'button', className: 'ca-tab' + ((id === screen || (moduleId === 'settings' && ca.settingsTab === id) || (moduleId === 'music' && i === 0) || (moduleId === 'drama' && i === 0)) ? ' is-selected' : ''), disabled: !enabled, onClick: () => { if (id === 'general' || id === 'capabilities' || id === 'help' || id === 'system') { ca.settingsTab = id; this.caSync(); } else if (id === 'edit' || id === 'enhance' || id === 'create' || id === 'batch') this.setScreen(id); } }, label))) : null;
    let canvas;
    if (moduleId === 'workstation') canvas = this.buildConceptWorkstation(vals, accent);
    else if (moduleId === 'generate') canvas = this.buildConceptGenerate(vals, accent);
    else if (moduleId === 'edit') canvas = screen === 'enhance' ? this.buildEnhanceWorkbench() : this.buildEditWorkbench();
    else if (moduleId === 'media') canvas = h('div', { className: 'ca-media-stack' }, this.buildLibraryWorkbench(), this.buildMediaLibraryPanel());
    else if (moduleId === 'voice') canvas = this.buildVoiceWorkspace();
    else if (moduleId === 'music') canvas = this.buildMusicWorkspace();
    else if (moduleId === 'assets3d') canvas = this.buildAsset3dWorkspace();
    else if (moduleId === 'world') canvas = this.buildWorldWorkspace();
    else if (moduleId === 'drama') canvas = this.buildDramaWorkspace();
    else canvas = this.buildConceptSettings(vals, accent);
    return h('div', { className: 'ca-shell', style: { '--ca-accent': accent } },
      h('aside', { className: 'ca-nav', 'aria-label': 'Primary modules' }, h('div', { className: 'ca-brand' }, h('img', { src: 'uploads/grok_image_1775521844329.jpg', alt: 'DexDiffusion' }), h('div', null, h('b', null, 'DexDiffusion'), h('small', null, 'Single-Canvas Workstation'))), h('nav', null, ...nav), h('button', { type: 'button', className: 'ca-nav-jobs', onClick: () => this.caToggleJobs() }, '▤  Jobs', status(String((window.__DEX_V12?.activeJobCount || 0) + (window.__DEX_V12?.queuedJobCount || 0)), '#38bdf8'))),
      h('header', { className: 'ca-topbar' }, h('div', { className: 'ca-topbar-context' }, h('span', { className: 'ca-kicker' }, 'DEXDIFFUSION'), h('b', null, 'Local creative workstation')), h('button', { type: 'button', className: 'ca-search', onClick: () => this.caTogglePalette() }, '⌘K  Search projects, assets, runs, help'), h('div', { className: 'ca-topbar-actions' }, h('span', { className: 'ca-live' }, window.__DEX_V12?.connected ? 'LIVE' : 'CONNECTING'), h('button', { type: 'button', className: 'ca-topbar-job', onClick: () => this.caToggleJobs() }, 'Jobs ' + ((window.__DEX_V12?.activeJobCount || 0) + (window.__DEX_V12?.queuedJobCount || 0))), h('button', { type: 'button', className: 'ca-icon-button', 'aria-label': 'Open help', 'data-ca-open-help': moduleId, onClick: e => this.caOpenHelp(moduleId, e) }, '?'))),
      h('header', { className: 'ca-module-header', style: { borderLeftColor: accent } }, h('div', { className: 'ca-module-title' }, h('span', { className: 'ca-module-icon', style: { color: accent } }, mod.icon), h('div', null, h('h1', null, mod.label), h('p', null, mod.desc))), headerTabs, h('button', { type: 'button', className: 'ca-help-button', 'data-ca-open-help': moduleId, onClick: e => this.caOpenHelp(moduleId, e) }, '?  How to use this section')),
      h('main', { className: 'ca-canvas', 'data-ca-module': moduleId }, canvas),
      this.buildConceptInspector(moduleId, accent),
      h('footer', { className: 'ca-queue-bar' }, h('div', null, h('b', null, 'Queue / History'), h('span', null, (window.__DEX_V12?.activeJobCount || 0) + ' active · ' + (window.__DEX_V12?.queuedJobCount || 0) + ' queued · recent results retained')), h('button', { type: 'button', className: 'ca-secondary', onClick: () => this.caToggleJobs() }, 'Open Global Job Center  ⌘⇧J')),
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
})();
