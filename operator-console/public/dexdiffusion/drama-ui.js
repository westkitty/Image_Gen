// Drama (audio-drama production): paste a script → parse → review/correct → bind voices →
// render lines/scenes/project (takes are never overwritten) → pick takes → assemble & export.
//
// The unsaved working script lives only in server memory; "Save project" is the explicit act that
// persists script + dialogue. Dialogue never goes into generic job records either way.
// Line/direction/pause inputs write straight to a debounced PATCH on `input` and do not re-render,
// so typing then clicking a button is never lost to a DOM rebuild.
(function () {
  'use strict';
  const C = window.DexDiffusionComponent;
  if (!C) return;
  const P = C.prototype;
  const h = (...a) => React.createElement(...a);
  const { css, tone, btn, chip } = window.DexUI;
  const numText = (window.DexUI && window.DexUI.numText) || (p => p);   // numeric text inputs (see DexUI.numText in workstation-ui.js)
  const field = (label, control) => h('label', { style: { display: 'grid', gap: 4, minWidth: 0 } }, h('span', { style: css.label }, label), control);
  const fmtT = s => (s == null || !isFinite(s)) ? '—' : s >= 60 ? Math.floor(s / 60) + ':' + String(Math.round(s % 60)).padStart(2, '0') : s.toFixed(1) + 's';
  const STATUS_TONE = { empty: '#94a3b8', rendering: tone.info, generated: tone.ok, failed: tone.bad };
  const KEY = 'dex_drama_project';

  P._dm = function () {
    if (!this.dm) {
      let cur = null; try { cur = sessionStorage.getItem(KEY); } catch (_) {}
      this.dm = { projects: null, currentId: cur, current: null, script: '', title: '', mode: 'deterministic', parseResult: null, run: null, busy: false, assembled: null, tracksOpen: false, musicLib: [], collapsed: {}, pending: {}, error: null };
      this._dmText = { script: '', title: '' };
    }
    return this.dm;
  };
  P.dmSet = function (patch, opts) {
    Object.assign(this._dm(), patch);
    // Never rebuild the form under an active text field (a poll tick would steal focus).
    const ae = document.activeElement;
    if (opts && opts.skipIfTyping && ae && ae.closest && ae.closest('[data-drama]') && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) return;
    this.setState({ _dmTick: (this.state._dmTick || 0) + 1 });
  };
  P._dmApi = function (route, body, method) { return this._vpApi(route, body, method); };
  P._confirmDramaDraftDiscard = function (action) {
    const dm = this._dm(), text = this._dmText || {};
    const dirty = !!((dm.current && !dm.current.saved) || Object.keys(dm.pending || {}).length || String(text.script || '').trim() || String(text.title || '').trim());
    if (!dirty) return true;
    return window.confirm(`Discard the current unsaved Drama script/project changes and ${action}? No script text will be saved automatically.`);
  };

  P.loadDramaProjects = async function () {
    const r = await this._dmApi('/api/drama/projects');
    if (r.ok) this.dmSet({ projects: r.data.projects }, { skipIfTyping: true });
    const dm = this._dm();
    if (dm.currentId && !dm.current) this.openDramaProject(dm.currentId, true);
  };
  // Scene-scoped Direct state belongs to one project's scene ids; clear it wherever the project (or its scenes) is replaced.
  P._dmClearScene = function () {
    const dm = this._dm();
    dm.timeline = null; dm.sceneId = null; dm._tlAsked = null; dm._tlReq = null; dm.cues = null; dm._cuesAsked = false; dm.selClip = null; dm.suggest = null;
  };
  P.openDramaProject = async function (id, quiet) {
    const dm = this._dm();
    if (!quiet && dm.currentId !== id && !this._confirmDramaDraftDiscard('open another project')) { this.dmSet({}); return false; }
    if (dm.currentId !== id) {
      this._dmResetEdits(); this._dmStopRunTracking();
      // Scene-scoped Direct state belongs to the previous project; stale ids would request B's timeline with A's scene.
      this._dmClearScene();
    }
    const request = this._dmOpenRequest = {};
    const r = await this._dmApi('/api/drama/projects/' + id);
    if (this._dmOpenRequest !== request) return false;
    if (!r.ok) { try { sessionStorage.removeItem(KEY); } catch (_) {} this.dmSet({ current: null, currentId: null }); if (!quiet) this.toast(r.data.error || 'Project not found', '#ef4444'); return; }
    try { sessionStorage.setItem(KEY, id); } catch (_) {}
    if (!this._vp().profiles) this.loadVoiceProfiles();
    if (this._dm().currentId !== id) this._dmResetEdits();
    // A re-render during the fetch may have reloaded the previous project's scene state; drop it once B is applied.
    if (this._dm().current && this._dm().current.id !== r.data.project.id) this._dmClearScene();
    this._dmText = { script: '', title: '' };
    this.dmSet({ current: r.data.project, currentId: id, assembled: null, run: null, parseResult: null });
    this.setActiveAssetSelection && this.setActiveAssetSelection({ kind: 'drama-project', id: r.data.project.id });
    if (r.data.project.active_run) this._followDramaRun(r.data.project.active_run);
  };
  P._dmSetProject = function (project) { this.dmSet({ current: project }, { skipIfTyping: true }); };
  P.createDramaProject = async function () {
    const t = this._dmText;
    if (!String(t.script || '').trim()) { this.toast('Paste a script first', '#fbbf24'); return; }
    this.dmSet({ busy: true, error: null });
    const r = await this._dmApi('/api/drama/projects', { title: t.title, script: t.script, mode: this._dm().mode });
    this.dmSet({ busy: false });
    if (!r.ok) { this.dmSet({ parseResult: r.data, error: (r.data.errors || [r.data.error]).join(' · ') }); this.toast('Parse failed: ' + ((r.data.errors || [])[0] || r.data.error), '#ef4444'); return; }
    await this.loadDramaProjects();
    this._dmText = { script: '', title: '' };
    try { sessionStorage.setItem(KEY, r.data.project.id); } catch (_) {}
    this._dmResetEdits();
    this._dmStopRunTracking();
    this._dmClearScene();
    this.dmSet({ current: r.data.project, currentId: r.data.project.id, parseResult: { ok: true, mode: r.data.mode }, assembled: null });
    this.setActiveAssetSelection && this.setActiveAssetSelection({ kind: 'drama-project', id: r.data.project.id });
    if (!this._vp().profiles) this.loadVoiceProfiles();
    this.toast('Parsed ' + r.data.project.scenes.reduce((n, s) => n + s.lines.length, 0) + ' lines · review below before rendering', '#65d66e');
  };
  P.reparseDrama = async function () {
    const dm = this._dm(), t = this._dmText;
    if (!dm.current || !String(t.script || '').trim()) return;
    if (!window.confirm('Re-parse replaces the parsed lines (and their takes) with a fresh parse of this script. Continue?')) return;
    const owner = this._dmProjectOwner(); if (!owner) return;
    const r = await this._dmApi('/api/drama/projects/' + owner.id + '/reparse', { script: t.script, mode: dm.mode });
    if (!this._dmOwnsProject(owner)) return;
    if (!r.ok) { this.dmSet({ parseResult: r.data }); this.toast((r.data.errors || [r.data.error])[0], '#ef4444'); return; }
    this._dmResetEdits();
    this._dmStopRunTracking();
    this._dmClearScene();
    this.dmSet({ current: r.data.project, parseResult: { ok: true } });
  };
  P.dramaSave = async function (save) {
    if (this._dramaSavePromise) return this._dramaSavePromise;
    const dm = this._dm(); if (!dm.current) return false;
    const projectId = dm.current.id;
    const work = async () => {
      if (await this._dmFlush() === false) return false;
      if (!save && !window.confirm('Remove the saved project file? The script stays in memory until the console restarts.')) return false;
      let r;
      try { r = await this._dmApi('/api/drama/projects/' + projectId + (save ? '/save' : '/unsave'), {}); }
      catch (e) { this.toast('Save failed: ' + (e && e.message || 'request failed'), '#ef4444'); return false; }
      if (!r.ok) { this.toast(r.data.error || 'Save failed', '#ef4444'); return false; }
      if (this._dm().currentId !== projectId) return false;
      this.dmSet({ current: r.data.project }); this.loadDramaProjects();
      this.toast(save ? 'Project saved — script and dialogue are now stored on this MacBook' : 'Project file removed (working copy kept in memory)', save ? '#65d66e' : '#fbbf24');
      return true;
    };
    this._dramaSavePromise = work().finally(() => { this._dramaSavePromise = null; });
    return this._dramaSavePromise;
  };
  P.dramaDelete = async function () {
    const dm = this._dm(); if (!dm.current) return;
    if (!window.confirm('Delete "' + dm.current.title + '" (' + (dm.current.saved ? 'saved file included' : 'unsaved') + ')? Generated audio stays in the Library.')) return;
    await this._dmApi('/api/drama/projects/' + dm.current.id, undefined, 'DELETE');
    try { sessionStorage.removeItem(KEY); } catch (_) {}
    this._dmResetEdits();
    this._dmStopRunTracking();
    this.dmSet({ current: null, currentId: null }); this.loadDramaProjects();
  };

  // debounced line edits (no re-render while typing)
  P._dmResetEdits = function () {
    clearTimeout(this._dmTimer); clearTimeout(this._dmDirT);
    this._dmEditEpoch = (this._dmEditEpoch || 0) + 1;
    this._dm().pending = {};
    this._dmPendingProjectId = null;
    this._dmFlushPromise = null;
  };
  P._dmQueue = function (lineId, patch) {
    const dm = this._dm();
    if (!dm.current) return;
    // A reset already cleared pending edits; just claim them for this project without bumping the epoch,
    // which would orphan in-flight same-project responses.
    if (this._dmPendingProjectId != null && this._dmPendingProjectId !== dm.current.id) this._dmResetEdits();
    this._dmPendingProjectId = dm.current.id;
    dm.pending[lineId] = Object.assign(dm.pending[lineId] || {}, patch);
    clearTimeout(this._dmTimer); this._dmTimer = setTimeout(() => this._dmFlush(), 700);
  };
  P._dmFlush = async function () {
    clearTimeout(this._dmTimer);
    if (this._dmFlushPromise) return this._dmFlushPromise;
    const run = async () => {
      const dm = this._dm(), projectId = dm.current && dm.current.id, epoch = this._dmEditEpoch;
      const ownsEdits = () => this._dmEditEpoch === epoch && this._dm().currentId === projectId;
      if (!projectId) return Object.keys(dm.pending || {}).length === 0;
      while (ownsEdits() && Object.keys(dm.pending || {}).length) {
        const batch = dm.pending; dm.pending = {};
        const entries = Object.entries(batch);
        for (let i = 0; i < entries.length; i++) {
          const [lid, patch] = entries[i];
          let r;
          try { r = await this._dmApi(`/api/drama/projects/${projectId}/lines/${lid}`, patch, 'PATCH'); }
          catch (e) { r = { ok: false, data: { error: e && e.message || 'request failed' } }; }
          if (!ownsEdits()) return false;
          if (!r.ok) {
            const retry = Object.fromEntries(entries.slice(i));
            for (const [id, newer] of Object.entries(dm.pending)) retry[id] = Object.assign({}, retry[id] || {}, newer);
            dm.pending = retry;
            this.toast(r.data.error || 'Edit failed; changes remain pending', '#ef4444');
            return false;
          }
          if (dm.currentId === projectId) this._dmSetProject(r.data.project);
        }
      }
      return true;
    };
    const promise = run().finally(() => { if (this._dmFlushPromise === promise) this._dmFlushPromise = null; });
    this._dmFlushPromise = promise;
    return promise;
  };
  P._dmProjectOwner = function () {
    const dm = this._dm();
    return dm.current ? { id: dm.current.id, epoch: this._dmEditEpoch } : null;
  };
  P._dmOwnsProject = function (owner) {
    const dm = this._dm();
    return !!(owner && dm.current && dm.current.id === owner.id && dm.currentId === owner.id && this._dmEditEpoch === owner.epoch);
  };
  P.dramaLine = async function (lineId, patch) {
    const owner = this._dmProjectOwner();
    if (!owner || await this._dmFlush() === false || !this._dmOwnsProject(owner)) return;
    const r = await this._dmApi(`/api/drama/projects/${owner.id}/lines/${lineId}`, patch, 'PATCH');
    if (!this._dmOwnsProject(owner)) return;
    if (!r.ok) { this.toast(r.data.error || 'Edit failed', '#ef4444'); return; }
    this.dmSet({ current: r.data.project });
  };
  P.dramaDeleteLine = async function (lineId) {
    const owner = this._dmProjectOwner(); if (!owner) return;
    const r = await this._dmApi(`/api/drama/projects/${owner.id}/lines/${lineId}`, undefined, 'DELETE');
    if (this._dmOwnsProject(owner) && r.ok) this.dmSet({ current: r.data.project });
  };
  P.dramaBind = async function (actor, profileId, dir) {
    const owner = this._dmProjectOwner(); if (!owner) return;
    const r = await this._dmApi(`/api/drama/projects/${owner.id}/actors/${actor.id}`, { voice_profile_id: profileId, default_direction: dir }, 'PUT');
    if (!this._dmOwnsProject(owner)) return;
    if (!r.ok) { this.toast(r.data.error || 'Could not bind voice', '#ef4444'); return; }
    this.dmSet({ current: r.data.project }, { skipIfTyping: dir !== undefined });
  };
  P.dramaSelectTake = async function (lineId, takeId) {
    const owner = this._dmProjectOwner(); if (!owner) return;
    const r = await this._dmApi(`/api/drama/projects/${owner.id}/lines/${lineId}/takes/${takeId}/select`, {});
    if (!this._dmOwnsProject(owner)) return;
    if (r.ok) this.dmSet({ current: r.data.project }); else this.toast(r.data.error, '#ef4444');
  };
  P.dramaTakeAction = async function (lineId, takeId, action) {
    const dm = this._dm(), owner = this._dmProjectOwner(), line = dm.current && dm.current.scenes.flatMap(s => s.lines).find(l => l.id === lineId);
    const target = takeId || (line && (line.active_take_id || line.takes.find(t => t.pinned)?.id));
    if (!owner || !line || !target) return;
    const r = await this._dmApi(`/api/drama/projects/${owner.id}/lines/${lineId}/takes/${target}/decision/${action}`, {});
    if (!this._dmOwnsProject(owner)) return;
    if (!r.ok) { this.toast(r.data.error || 'Take action failed', '#ef4444'); return; }
    this.dmSet({ current: r.data.project });
    this.toast(({ reject: 'Take rejected and retained in history', restore: 'Take restored', pin: 'Pin updated', undo: 'Take selection undone' })[action], '#65d66e');
  };
  P.dramaAuditionPhrase = async function (line, phrase) {
    const dm = this._dm(), r = await this._dmApi(`/api/drama/projects/${dm.current.id}/lines/${line.id}/phrases/${encodeURIComponent(phrase.id)}/audition`, {});
    if (!r.ok) { this.toast(r.data.error || 'Phrase audition failed', '#ef4444'); return; }
    const entry = { job_id: r.data.audition.job_id, status: 'RUNNING', engine: r.data.engine, direction: r.data.direction };
    const auditions = Object.assign({}, dm.phraseAuditions || {}, { [phrase.id]: entry }); this.dmSet({ phraseAuditions: auditions });
    const tick = async () => {
      const result = await this._dmApi('/api/voice/render/' + entry.job_id);
      if (!result.ok) { entry.status = 'FAILED'; entry.error = result.data.error || 'Could not read audition status'; }
      else { entry.status = result.data.status; entry.artifact = result.data.artifact; entry.error = result.data.error; }
      this.dmSet({ phraseAuditions: Object.assign({}, this._dm().phraseAuditions, { [phrase.id]: Object.assign({}, entry) }) });
      if (['COMPLETE', 'FAILED', 'INTERRUPTED', 'CANCELLED'].includes(entry.status)) clearInterval(timer);
    };
    tick(); const timer = setInterval(tick, 1400);
  };
  P.dramaUsePhraseDirection = async function (line, phrase) {
    const delivery = window.prompt('Direction for the selected phrase', phrase.delivery || '');
    if (delivery == null) return;
    const phrases = line.performance_score.phrases.map(x => Object.assign({}, x, x.id === phrase.id ? { delivery } : {}));
    const owner = this._dmProjectOwner(); if (!owner) return;
    const r = await this._dmApi(`/api/drama/projects/${owner.id}/lines/${line.id}/performance-score`, { phrases }, 'PUT');
    if (!this._dmOwnsProject(owner)) return;
    if (!r.ok) { this.toast(r.data.error || 'Direction save failed', '#ef4444'); return; }
    this.dmSet({ current: r.data.project });
    await this.dramaRender({ scope: 'line', line_id: line.id, alternate: true });
  };

  P.dramaDirectSelection = async function (line, removeId) {
    const owner = this._dmProjectOwner();
    if (!owner) return;
    const score = line.performance_score && line.performance_score.source && line.performance_score.source.text === line.text ? line.performance_score : { phrases: [] };
    let phrases = (score.phrases || []).map(x => Object.assign({}, x));
    if (removeId === '*') phrases = [];
    else if (removeId) phrases = phrases.filter(x => x.id !== removeId);
    else {
      const range = this._dmSelection && this._dmSelection[line.id];
      if (!range || range.start === range.end) { this.toast('Select a phrase in the dialogue first', '#fbbf24'); return; }
      if (phrases.some(x => range.start < x.end && range.end > x.start)) { this.toast('That selection overlaps an existing directed phrase', '#fbbf24'); return; }
      const delivery = window.prompt('Acting direction for the selected phrase', '');
      if (delivery == null || !delivery.trim()) return;
      phrases.push({ id: 'phrase-' + range.start + '-' + range.end, start: range.start, end: range.end, text: line.text.slice(range.start, range.end), delivery: delivery.trim() });
      phrases.sort((a, b) => a.start - b.start);
    }
    const r = await this._dmApi(`/api/drama/projects/${owner.id}/lines/${line.id}/performance-score`, { phrases }, 'PUT');
    if (!this._dmOwnsProject(owner)) return;
    if (!r.ok) { this.toast(r.data.error || 'Could not save phrase direction', '#ef4444'); return; }
    this.dmSet({ current: r.data.project });
    this.toast(removeId ? 'Phrase direction removed' : 'Phrase direction saved; exact dialogue retained', '#65d66e');
  };

  // ── rendering runs ────────────────────────────────────────────────────────
  P.dramaRender = async function (opts) {
    const owner = this._dmProjectOwner();
    if (!owner || await this._dmFlush() === false || !this._dmOwnsProject(owner)) return;
    const r = await this._dmApi(`/api/drama/projects/${owner.id}/render`, opts);
    if (!this._dmOwnsProject(owner)) return;
    if (!r.ok) { this.toast((r.data.error || 'Render rejected') + (r.data.gate ? ' · ' + r.data.gate : ''), '#ef4444'); this.dmSet({ error: r.data.error }); return; }
    this.dmSet({ current: r.data.project, error: null });
    if (r.data.run && r.data.run.id) this._followDramaRun(r.data.run.id, owner.id); else this.toast(r.data.run.note || 'Nothing to render', '#38bdf8');
  };
  P._dmStopRunTracking = function () {
    clearInterval(this._dmRunTimer);
    this._dmRunOwner = null;
    clearInterval(this._dmProdTimer);
    this._dmProdOwner = null;
  };
  P._followDramaRun = function (runId, forProjectId) {
    clearInterval(this._dmRunTimer); // only replaces the render-run poll; a production poll is independent
    const projectId = forProjectId || this._dm().currentId, owner = this._dmRunOwner = {};
    const ownsRun = () => this._dmRunOwner === owner && this._dm().currentId === projectId;
    const tick = async () => {
      if (!ownsRun()) { clearInterval(timer); return; }
      const r = await this._dmApi('/api/drama/runs/' + runId);
      if (!ownsRun()) { clearInterval(timer); return; }
      if (!r.ok) { clearInterval(this._dmRunTimer); this.dmSet({ run: { status: 'failed', errors: [{ error: 'Lost track of the render run (' + (r.data.error || r.status) + '). Takes already generated are kept.' }] } }); return; }
      this.dmSet({ run: r.data.run, current: r.data.project }, { skipIfTyping: true });
      if (r.data.run.status !== 'running') { clearInterval(this._dmRunTimer); this.toast('Render ' + r.data.run.status + ' · ' + r.data.run.done + ' ok' + (r.data.run.failed ? ', ' + r.data.run.failed + ' failed' : ''), r.data.run.failed ? '#fbbf24' : '#65d66e'); this.loadMediaLibrary && this.loadMediaLibrary('voice'); }
    };
    const timer = this._dmRunTimer = setInterval(tick, 1500);
    tick();
  };
  P.dramaAssemble = async function (sceneId) {
    await this._dmFlush();
    this.dmSet({ busy: true, assembled: null });
    const r = await this._dmApi(`/api/drama/projects/${this._dm().current.id}/assemble`, { scene_id: sceneId });
    this.dmSet({ busy: false });
    if (!r.ok) { const miss = (r.data.missing || []).length; this.dmSet({ assembled: { error: r.data.error + (miss ? ' — ' + r.data.missing.slice(0, 6).map(m => m.speaker + ' ' + m.line_id).join(', ') + (miss > 6 ? '…' : '') : '') } }); this.toast(r.data.error || 'Assemble failed', '#ef4444'); return; }
    this.dmSet({ assembled: r.data, current: r.data.project }); this.loadMediaLibrary && this.loadMediaLibrary('voice');
    this.toast('Exported ' + fmtT(r.data.artifact.duration) + (sceneId ? ' scene' : ' drama') + ' → Library', '#65d66e');
  };
  P.loadDramaMusic = async function () {
    const [m, v] = await Promise.all([this._dmApi('/api/library?kind=music'), this._dmApi('/api/library?kind=voice')]);
    this.dmSet({ musicLib: [...((m.data && m.data.items) || []), ...((v.data && v.data.items) || [])].filter(i => /\.(wav|mp3|m4a|m4b|flac)$/i.test(i.artifact_id)).slice(0, 80) });
  };
  P.dramaAddTrack = async function (form) {
    const owner = this._dmProjectOwner(); if (!owner) return;
    const r = await this._dmApi(`/api/drama/projects/${owner.id}/tracks`, form);
    if (!this._dmOwnsProject(owner)) return;
    if (!r.ok) { this.toast(r.data.error, '#ef4444'); return; }
    this.dmSet({ current: r.data.project });
  };
  P.dramaRemoveTrack = async function (id) {
    const owner = this._dmProjectOwner(); if (!owner) return;
    const r = await this._dmApi(`/api/drama/projects/${owner.id}/tracks/${id}`, undefined, 'DELETE');
    if (r.ok && this._dmOwnsProject(owner)) this.dmSet({ current: r.data.project });
  };

  // ── builders ───────────────────────────────────────────────────────────────
  P._dmBanner = function (p) {
    return h('div', { 'data-drama-privacy': p.saved ? 'saved' : 'unsaved', role: 'status', style: { border: '1px solid ' + (p.saved ? 'rgba(101,214,110,.4)' : 'rgba(251,191,36,.45)'), background: p.saved ? 'rgba(101,214,110,.06)' : 'rgba(251,191,36,.07)', borderRadius: 9, padding: '8px 10px', display: 'grid', gap: 5 } },
      h('div', { style: css.row }, h('b', { style: { color: p.saved ? '#86efac' : '#fde68a', fontSize: 12 } }, p.saved ? '💾 SAVED project — the script and dialogue are stored on this MacBook' : '🕒 UNSAVED working script — held in memory only, lost on console restart'),
        h('div', { style: { flex: 1 } }), p.saved ? btn('Remove saved file', () => this.dramaSave(false), '#94a3b8', { 'data-drama-unsave': '1' }) : btn('Save project', () => this.dramaSave(true), '#65d66e', { 'data-drama-save': '1' })),
      h('div', { style: css.muted }, p.saved ? 'Location: sdcpp-workflow/state/drama/' + p.id + '.json. Dialogue is still never copied into job logs; generated audio lives in the Library.' : 'Saving is explicit: it writes this script, the cast bindings and take history to disk. Generated audio is already in the Library. Exported file names and Library entries use the scene/project title.'));
  };
  P._dmCast = function (p) {
    const profiles = this._vp().profiles || [];
    return h('div', { 'data-drama-cast': '1', style: css.panel },
      h('div', { style: Object.assign({}, css.row, { marginBottom: 8 }) }, h('div', { style: css.title }, 'Cast'), h('span', { style: css.muted }, 'Bind each speaker to a saved voice. Only speakers with lines to render block rendering.'), h('div', { style: { flex: 1 } }), btn('Manage voices', () => { this.vpSet({ tab: 'profiles' }); this.setScreen('voice'); }, '#a78bfa')),
      !profiles.length ? h('div', { style: { color: tone.warn, fontSize: 12, marginBottom: 6 } }, 'No saved voices yet — create some in Voice → Voices & long-form.') : null,
      h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,300px),1fr))', gap: 8 } }, ...p.actors.map(a => {
        const unresolved = p.unresolved.some(u => u.key === a.speaker_key);
        return h('div', { key: a.id, 'data-actor': a.speaker_key, style: { border: '1px solid ' + (unresolved ? 'rgba(251,191,36,.5)' : 'rgba(148,163,184,.18)'), borderRadius: 9, padding: 9, display: 'grid', gap: 6, minWidth: 0 } },
          h('div', { style: css.row }, h('b', { style: { color: '#e2e8f0' } }, a.speaker), chip(a.lines + ' line' + (a.lines === 1 ? '' : 's'), '#94a3b8'), unresolved ? chip('needs a voice', tone.warn) : chip('ready', tone.ok)),
          h('select', { 'aria-label': 'Voice for ' + a.speaker, value: a.voice_profile_id || '', style: css.input, onChange: e => this.dramaBind(a, e.target.value || null) },
            h('option', { value: '' }, '— choose a voice —'), ...profiles.map(pr => h('option', { key: pr.id, value: pr.id }, pr.name + ' · ' + pr.type + (pr.validation.state === 'invalid' ? ' (invalid)' : '')))),
          h('input', { value: a.default_direction || '', placeholder: 'default delivery for this actor (optional)', style: css.input, onInput: e => { clearTimeout(this._dmDirT); const v = e.target.value; this._dmDirT = setTimeout(() => this.dramaBind(a, a.voice_profile_id, v), 700); } }));
      })));
  };
  P._dmTake = function (line, t, idx) {
    const base = this.state.backendUrl;
    return h('div', { key: t.id, 'data-take': t.id, style: { border: '1px solid ' + (t.active ? 'rgba(101,214,110,.5)' : 'rgba(148,163,184,.16)'), borderRadius: 8, padding: 6, display: 'grid', gap: 4, minWidth: 0 } },
      h('div', { style: css.row }, h('b', { style: { fontSize: 11, color: '#cbd5e1' } }, 'Take ' + (idx + 1)), chip(t.state ? t.state.label : t.status, (window.DexStudio && window.DexStudio.TAKE_TONE[t.state && t.state.label]) || (t.status === 'complete' ? tone.ok : t.status === 'failed' ? tone.bad : tone.info)), t.engine ? chip(t.engine, '#94a3b8') : null, t.duration ? chip(fmtT(t.duration), '#94a3b8') : null,
        t.seed != null ? h('span', { style: css.mono }, 'seed ' + t.seed) : null, t.settings && t.settings.delivery && t.settings.delivery.note ? chip('direction not applied', tone.warn) : null, t.settings && t.settings.seeded === false ? h('span', { title: 'This engine has no seed: re-rendering the same text gives the same audio. Change the text, direction or voice for a different take.', style: { border: '1px solid rgba(148,163,184,.4)', color: '#94a3b8', borderRadius: 6, padding: '2px 7px', fontSize: 10 } }, 'deterministic engine') : null,
        t.settings && t.settings.direction ? chip('direction: ' + t.settings.direction, '#a78bfa') : null,
        t.qa && t.qa.integrity ? chip('QA: ' + (t.qa.integrity.ok ? 'valid audio' : 'failed'), t.qa.integrity.ok ? tone.ok : tone.bad) : chip('QA: not checked', '#94a3b8'),
        t.human_review ? chip('listened: ' + t.human_review.state, t.human_review.state === 'heard-ok' ? tone.ok : tone.warn) : null,
        t.created_at ? h('span', { style: { color: '#64748b', fontSize: 10 } }, new Date(t.created_at).toLocaleString()) : null,
        h('div', { style: { flex: 1 } }), t.rejected ? chip('rejected · retained', tone.warn) : null, t.pinned ? chip('pinned', tone.ok) : null,
        t.status === 'complete' ? (t.active ? chip('✓ selected for export', tone.ok) : btn('Select', () => this.dramaSelectTake(line.id, t.id), '#65d66e', { 'data-use-take': t.id })) : null),
      t.url ? this._mediaEl(base + t.url, 'audio', 'take-' + t.id) : null,
      t.status === 'complete' ? h('div', { style: css.row },
        t.rejected ? btn('Restore take', () => this.dramaTakeAction(line.id, t.id, 'restore'), '#38bdf8') : btn('Reject', () => this.dramaTakeAction(line.id, t.id, 'reject'), '#f87171'),
        btn(t.pinned ? 'Unpin' : 'Pin approved take', () => this.dramaTakeAction(line.id, t.id, 'pin'), '#a78bfa', { disabled: t.rejected || !t.approved, title: t.approved ? 'Keep this selection from being silently replaced by a later render' : 'Approve this current take in Review before pinning it' }),
        btn('Undo selection', () => this.dramaTakeAction(line.id, t.id, 'undo'), '#94a3b8', { disabled: !(line.take_decision_history || []).length })) : null,
      t.status === 'failed' ? h('div', { style: { color: tone.bad, fontSize: 11, overflowWrap: 'anywhere' } }, '✗ ' + (t.error || 'failed') + (t.gate ? ' (' + t.gate + ')' : '')) : null);
  };
  P._dmLine = function (p, scene, line, speakers) {
    const dm = this._dm(), running = dm.run && dm.run.status === 'running';
    const skip = line.kind === 'direction' || line.render === false;
    return h('div', { key: line.id, 'data-line': line.id, style: { border: '1px solid rgba(148,163,184,.14)', borderRadius: 9, padding: 8, display: 'grid', gap: 6, background: skip ? 'rgba(8,14,24,.35)' : 'rgba(8,14,24,.7)', opacity: skip ? 0.75 : 1, minWidth: 0 } },
      h('div', { style: css.row }, chip(line.freshness === 'stale' ? 'out of date' : line.status, line.freshness === 'stale' ? tone.warn : (STATUS_TONE[line.status] || '#94a3b8')), h('span', { style: css.mono }, line.id), line.edited ? chip('edited', tone.warn) : null, h('div', { style: { flex: 1 } }),
        !skip ? btn('Render', () => this.dramaRender({ scope: 'line', line_id: line.id, alternate: false }), '#38bdf8', { disabled: running, 'data-render-line': line.id }) : null,
        !skip && line.takes.length ? btn('Alternate take', () => this.dramaRender({ scope: 'line', line_id: line.id, alternate: true }), '#a78bfa', { disabled: running, 'data-alt-take': line.id }) : null,
        btn('✕', () => this.dramaDeleteLine(line.id), '#94a3b8', { 'aria-label': 'Delete line', title: 'Remove this line from the project' })),
      h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,150px),1fr))', gap: 6 } },
        field('Speaker', h('input', { value: line.speaker, list: 'dm-speakers', style: css.input, onChange: e => this.dramaLine(line.id, { speaker: e.target.value }) })),
        field('Kind', h('select', { value: line.kind, style: css.input, onChange: e => this.dramaLine(line.id, { kind: e.target.value }) }, ...['dialogue', 'narration', 'direction'].map(k => h('option', { key: k, value: k }, k)))),
        field('Delivery direction', h('input', { value: line.direction || '', placeholder: 'e.g. quietly', style: css.input, onInput: e => this._dmQueue(line.id, { direction: e.target.value }) })),
        field('Pause before (s)', h('input', numText({ min: '0', step: '0.1', value: line.pause_before_s == null ? '' : String(line.pause_before_s), placeholder: 'auto', style: css.input, onInput: e => this._dmQueue(line.id, { pause_before_s: e.target.value }) }))),
        field('Pause after (s)', h('input', numText({ min: '0', step: '0.1', value: line.pause_after_s == null ? '' : String(line.pause_after_s), placeholder: String(p.settings.line_gap_s), style: css.input, onInput: e => this._dmQueue(line.id, { pause_after_s: e.target.value }) })))),
      h('textarea', { rows: Math.min(5, Math.max(1, Math.ceil(line.text.length / 90))), value: line.text, 'aria-label': 'Line text', style: Object.assign({}, css.input, { resize: 'vertical' }), onSelect: e => { this._dmSelection = this._dmSelection || {}; this._dmSelection[line.id] = { start: e.target.selectionStart, end: e.target.selectionEnd }; }, onInput: e => this._dmQueue(line.id, { text: e.target.value }) }),
      !skip ? h('div', { style: css.row }, btn('Direct selected phrase', () => this.dramaDirectSelection(line), '#fbbf24', { 'aria-label': 'Apply acting direction to selected dialogue phrase' }),
        line.performance_score && (line.performance_score.phrases || []).length ? btn('Clear directions', () => this.dramaDirectSelection(line, '*'), '#94a3b8') : null,
        line.performance_score && line.performance_score.source && line.performance_score.source.text !== line.text ? h('span', { role: 'status', style: { color: '#fbbf24', fontSize: 11 } }, 'Dialogue changed; old phrase ranges are stale. Select phrases again to rebind directions.') : null,
        ...(line.performance_score && line.performance_score.phrases || []).map(q => {
          const a = (dm.phraseAuditions || {})[q.id];
          return h('div', { key: q.id, style: { border: '1px solid rgba(251,191,36,.35)', borderRadius: 6, padding: 5, color: '#fde68a', fontSize: 11, display: 'grid', gap: 4 } },
            h('span', null, `${q.text} — ${q.delivery || q.preset || 'directed'}`),
            h('div', { style: css.row }, btn('Audition phrase', () => this.dramaAuditionPhrase(line, q), '#a78bfa'), btn('Change direction · render line alternate', () => this.dramaUsePhraseDirection(line, q), '#38bdf8'), btn('×', () => this.dramaDirectSelection(line, q.id), '#fca5a5', { 'aria-label': 'Remove phrase direction' })),
            a ? h('div', { style: { display: 'grid', gap: 4 } }, h('span', { role: 'status', style: css.muted }, `${a.status} · ${a.engine || ''} · ${a.direction || 'no direction'}`), a.artifact ? this._mediaEl(base + a.artifact.url, 'audio', 'phrase-audition-' + q.id) : a.error ? h('span', { role: 'alert', style: { color: tone.bad } }, a.error) : null) : null);
        })) : null,
      line.takes.length ? h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,260px),1fr))', gap: 6 } }, ...line.takes.map((t, i) => this._dmTake(line, t, i))) : null);
  };
  P._dmRunPanel = function (p) {
    const r = this._dm().run; if (!r) return null;
    const running = r.status === 'running';
    return h('div', { 'data-drama-run': r.status, role: 'status', style: { border: '1px solid ' + (running ? 'rgba(56,189,248,.5)' : r.failed ? 'rgba(248,113,113,.5)' : 'rgba(101,214,110,.4)'), borderRadius: 9, padding: 10, display: 'grid', gap: 5 } },
      h('div', { style: css.row }, h('b', { style: { color: running ? '#7dd3fc' : r.failed ? '#fca5a5' : '#86efac' } }, running ? 'Rendering' : 'Render ' + r.status), h('span', { style: css.mono }, r.scope + (r.scene_id ? ' ' + r.scene_id : '') + ' · ' + r.done + ' done' + (r.failed ? ' · ' + r.failed + ' failed' : '') + ' / ' + r.total)),
      running ? h('div', { style: { color: '#cbd5e1', fontSize: 12 } }, (r.line_label || '') + (r.active ? ' · ' + r.active.label : ' · waiting')) : null,
      h('div', { style: { height: 6, background: 'rgba(255,255,255,.08)', borderRadius: 3, overflow: 'hidden' } }, h('div', { style: { height: '100%', width: Math.round(((r.done + r.failed) / Math.max(1, r.total)) * 100) + '%', background: 'linear-gradient(90deg,#8b5cf6,#22d3ee)', transition: 'width .4s' } })),
      ...(r.errors || []).map((e, i) => h('div', { key: i, style: { color: tone.bad, fontSize: 12, overflowWrap: 'anywhere' } }, '✗ ' + (e.speaker ? e.speaker + ' ' : '') + (e.line_id || '') + ': ' + e.error)),
      !running && r.failed ? h('div', { style: css.row }, btn('Retry failed / incomplete lines', () => this.dramaRender({ scope: r.scope, scene_id: r.scene_id, resume: true }), '#fbbf24')) : null);
  };
  P._dmTracks = function (p) {
    const dm = this._dm(), lib = dm.musicLib, form = this._dmTrackForm = this._dmTrackForm || { role: 'music', artifact_id: '', start_s: 0, gain: 0.3, fade_in_s: 0, fade_out_s: 0, trim_start_s: 0, scene_id: '' };
    return h('details', { 'data-drama-tracks': '1', open: dm.tracksOpen ? '' : null, onToggle: e => { dm.tracksOpen = e.target.open; if (e.target.open && !dm.musicLib.length) this.loadDramaMusic(); }, style: { border: '1px solid rgba(148,163,184,.16)', borderRadius: 9, padding: '6px 10px' } },
      h('summary', { style: Object.assign({}, css.title, { cursor: 'pointer', minHeight: 36, display: 'flex', alignItems: 'center' }) }, '▸ Music / ambience / SFX tracks (' + p.tracks.length + ')'),
      h('div', { style: { display: 'grid', gap: 8, marginTop: 8 } },
        ...p.tracks.map(t => h('div', { key: t.id, style: css.row }, chip(t.role, '#22d3ee'), h('span', { style: css.mono }, t.artifact_id), h('span', { style: css.muted }, 'start ' + t.start_s + 's · gain ' + t.gain + (t.scene_id ? ' · ' + t.scene_id : '')), btn('Remove', () => this.dramaRemoveTrack(t.id), '#f87171'))),
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,130px),1fr))', gap: 6 } },
          field('Role', h('select', { style: css.input, value: form.role, onChange: e => { form.role = e.target.value; } }, ...['music', 'ambience', 'sfx'].map(r => h('option', { key: r, value: r }, r)))),
          field('Audio (WAV from Library)', h('select', { style: css.input, value: form.artifact_id, onChange: e => { form.artifact_id = e.target.value; } }, h('option', { value: '' }, lib.length ? '— choose —' : '(open to load)'), ...lib.map(i => h('option', { key: i.artifact_id, value: i.artifact_id }, i.kind + ' · ' + i.artifact_id.slice(0, 40))))),
          field('Scene (optional)', h('select', { style: css.input, value: form.scene_id, onChange: e => { form.scene_id = e.target.value; } }, h('option', { value: '' }, 'whole project'), ...p.scenes.map(s => h('option', { key: s.id, value: s.id }, s.title.slice(0, 30))))),
          ...[['start_s', 'Start (s)'], ['trim_start_s', 'Trim start (s)'], ['gain', 'Volume (0–2)'], ['fade_in_s', 'Fade in (s)'], ['fade_out_s', 'Fade out (s)']].map(([k, l]) => field(l, h('input', numText({ step: '0.1', min: '0', value: String(form[k]), style: css.input, onInput: e => { form[k] = e.target.value; } }))))),
        btn('Add track', () => form.artifact_id ? this.dramaAddTrack(form) : this.toast('Choose an audio file first', '#fbbf24'), '#22d3ee')));
  };
  P.buildDramaWorkspace = function () {
    const dm = this._dm();
    if (!dm.loadedOnce) { dm.loadedOnce = true; setTimeout(() => this.loadDramaProjects(), 0); }
    const t = this._dmText, p = dm.current, base = this.state.backendUrl;
    const speakers = p ? [...new Set(p.scenes.flatMap(s => s.lines.map(l => l.speaker)))] : [];
    const projectList = h('div', { style: css.row }, h('span', { style: css.muted }, 'Projects'), h('select', { 'aria-label': 'Open project', value: dm.currentId || '', style: Object.assign({}, css.input, { width: 'auto', minWidth: 200 }), onChange: e => { if (e.target.value) this.openDramaProject(e.target.value); else if (this._confirmDramaDraftDiscard('leave the current project')) { try { sessionStorage.removeItem(KEY); } catch (_) {} this.dmSet({ current: null, currentId: null }); this.setActiveAssetSelection && this.setActiveAssetSelection(null); } else this.dmSet({}); } },
      h('option', { value: '' }, (dm.projects && dm.projects.length ? '— open a project (' + dm.projects.length + ') —' : '— no projects yet —')), ...((dm.projects || []).map(x => h('option', { key: x.id, value: x.id }, (x.saved ? '💾 ' : '🕒 ') + x.title + ' · ' + x.lines + ' lines')))),
      p ? btn('＋ New from script', () => { if (!this._confirmDramaDraftDiscard('start a new script')) return; try { sessionStorage.removeItem(KEY); } catch (_) {} this.dmSet({ current: null, currentId: null }); this.setActiveAssetSelection && this.setActiveAssetSelection(null); }, '#94a3b8') : null);
    const scriptPanel = h('div', { 'data-drama-script': '1', style: css.panel },
      h('div', { style: Object.assign({}, css.row, { marginBottom: 8 }) }, h('div', { style: css.title }, p ? 'Script (original — authoritative)' : 'Paste a script'), h('div', { style: { flex: 1 } }),
        ...[['deterministic', 'Deterministic parser'], ['llm', 'Local model (Ollama) parser']].map(([k, l]) => btn(l, () => this.dmSet({ mode: k }, { skipIfTyping: false }), dm.mode === k ? '#a78bfa' : '#94a3b8', { 'data-parse-mode': k }))),
      h('div', { style: Object.assign({}, css.muted, { marginBottom: 6 }) }, dm.mode === 'llm' ? 'The local model proposes speakers, narration/dialogue and delivery cues. Its output is validated against a strict schema and every line must be verbatim text from your script — it can never rewrite dialogue; invalid output is rejected.' : 'Reads "NAME: text", "NAME: [quietly] text", "NAME (whispering): text", screenplay cues, scene headings (INT./EXT./# Title), [pause 2s] and narration paragraphs. No model involved.'),
      field('Title', h('input', { value: t.title || (p ? p.title : ''), placeholder: 'Untitled drama', style: css.input, onInput: e => { t.title = e.target.value; } })),
      h('textarea', { rows: p ? 6 : 12, 'data-drama-script-input': '1', value: t.script || (p ? p.source_script : ''), placeholder: 'INT. WAREHOUSE - NIGHT\n\nTIGER: I warned you.\nCODEC: [quietly] I know.\n\nThe rain hammers the roof.', style: Object.assign({}, css.input, { resize: 'vertical', fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, marginTop: 6 }), onInput: e => { t.script = e.target.value; } }),
      h('div', { style: Object.assign({}, css.row, { marginTop: 8 }) }, p ? btn('Re-parse script', () => this.reparseDrama(), '#fbbf24', { 'data-reparse': '1' }) : btn(dm.busy ? 'Parsing…' : 'Parse script', () => this.createDramaProject(), '#65d66e', { 'data-parse': '1', disabled: dm.busy })),
      dm.parseResult && dm.parseResult.ok === false ? h('div', { role: 'alert', 'data-parse-error': '1', style: { color: tone.bad, fontSize: 12, marginTop: 6 } }, '✗ ' + (dm.parseResult.errors || []).join(' · '),
        ...(dm.parseResult.rejected || []).slice(0, 5).map((r, i) => h('div', { key: i, style: css.mono }, 'rejected: ' + r.speaker + ': ' + r.text))) : null,
      p && p.parse_warnings && p.parse_warnings.length ? h('div', { style: { color: tone.warn, fontSize: 12, marginTop: 6 } }, '⚠ ' + p.parse_warnings.join(' ')) : null);
    if (!p) return h('div', { 'data-drama': '1', style: { display: 'grid', gap: 12, minWidth: 0 } }, projectList, scriptPanel,
      h('div', { style: css.muted }, 'Drama turns a script into a multi-voice audio drama: parse → review → cast saved voices → render lines (every re-render is a new take) → choose takes → assemble one WAV.'));
    const scenes = p.scenes.map(sc => {
      const open = !dm.collapsed[sc.id];
      return h('div', { key: sc.id, 'data-scene': sc.id, style: css.panel },
        h('div', { style: css.row }, h('button', { type: 'button', 'aria-expanded': String(open), onClick: () => { dm.collapsed[sc.id] = open; this.dmSet({}); }, style: { border: 0, background: 'transparent', color: '#e2e8f0', fontWeight: 800, fontSize: 14, cursor: 'pointer', minHeight: 36 } }, (open ? '▾ ' : '▸ ') + sc.title),
          h('span', { style: css.muted }, sc.lines.length + ' lines'), h('div', { style: { flex: 1 } }),
          btn('Render scene', () => this.dramaRender({ scope: 'scene', scene_id: sc.id, resume: true }), '#38bdf8', { disabled: dm.run && dm.run.status === 'running', 'data-render-scene': sc.id }),
          btn('Assemble scene', () => this.dramaAssemble(sc.id), '#22d3ee', { disabled: dm.busy, 'data-assemble-scene': sc.id })),
        open ? h('div', { style: { display: 'grid', gap: 8, marginTop: 8 } }, ...sc.lines.map(l => this._dmLine(p, sc, l, speakers))) : null);
    });
    const done = p.scenes.reduce((n, s) => n + s.lines.filter(l => l.status === 'generated').length, 0), total = p.scenes.reduce((n, s) => n + s.lines.filter(l => l.render !== false && l.kind !== 'direction').length, 0);
    const asm = dm.assembled;
    return h('div', { 'data-drama': '1', style: { display: 'grid', gap: 12, minWidth: 0 } }, projectList,
      h('datalist', { id: 'dm-speakers' }, ...speakers.map(s => h('option', { key: s, value: s }))),
      h('div', { style: css.row }, h('div', { style: { fontSize: 18, fontWeight: 800, color: '#f0f4f8' } }, p.title), chip(done + ' / ' + total + ' lines generated', done === total && total ? tone.ok : '#94a3b8'), h('div', { style: { flex: 1 } }), btn('Delete project', () => this.dramaDelete(), '#f87171')),
      this._dmBanner(p),
      p.unresolved.length ? h('div', { 'data-drama-unresolved': '1', role: 'alert', style: { border: '1px solid rgba(251,191,36,.5)', borderRadius: 9, padding: '8px 10px', color: '#fde68a', fontSize: 12 } }, '⚠ Rendering is blocked until these speakers have a voice: ' + p.unresolved.map(u => u.speaker + ' (' + u.lines + ')').join(', ') + '.') : null,
      this._dmCast(p), scriptPanel,
      h('div', { style: Object.assign({}, css.row, { marginTop: 4 }) }, h('div', { style: css.title }, 'Parsed script — review & correct'), h('div', { style: { flex: 1 } }),
        btn('Render project (resume)', () => this.dramaRender({ scope: 'project', resume: true }), '#38bdf8', { disabled: dm.run && dm.run.status === 'running', 'data-render-project': '1' }),
        btn('Assemble full drama', () => this.dramaAssemble(undefined), '#22d3ee', { disabled: dm.busy, 'data-assemble-project': '1' })),
      this._dmRunPanel(p), dm.error ? h('div', { role: 'alert', style: { color: tone.bad, fontSize: 12 } }, '✗ ' + dm.error) : null,
      ...scenes, this._dmTracks(p),
      asm ? (asm.error ? h('div', { role: 'alert', 'data-assemble-error': '1', style: { color: tone.bad, fontSize: 12, border: '1px solid rgba(248,113,113,.4)', borderRadius: 9, padding: 10 } }, '✗ ' + asm.error)
        : h('div', { 'data-assemble-result': '1', style: Object.assign({}, css.panel, { borderColor: 'rgba(101,214,110,.45)' }) }, h('div', { style: css.title }, 'Exported audio drama'),
          this._mediaEl(base + asm.artifact.url, 'audio', 'drama-export'),
          h('div', { style: css.muted }, [asm.artifact.artifact_id, fmtT(asm.artifact.duration), asm.manifest.items.length + ' lines', asm.manifest.sample_rate + ' Hz ' + (asm.manifest.channels === 1 ? 'mono' : 'stereo'), 'sha256 ' + asm.artifact.sha256.slice(0, 12) + '…'].join(' · ')),
          h('div', { style: css.row }, h('a', { href: base + asm.artifact.download_url, style: { color: '#7dd3fc', fontSize: 12, fontWeight: 700, padding: '8px 4px' } }, 'Download WAV')))) : null,
      p.exports.length ? h('details', null, h('summary', { style: Object.assign({}, css.muted, { cursor: 'pointer' }) }, '▸ Previous exports (' + p.exports.length + ')'), ...p.exports.map(e => h('div', { key: e.id, style: css.row }, h('span', { style: css.mono }, e.artifact_id), h('span', { style: css.muted }, e.scope + ' · ' + fmtT(e.duration_s)), e.url ? this._mediaEl(base + e.url, 'audio', 'ex-' + e.id) : null))) : null);
  };

  // Wire into the media screen host.
  const _renderVals = P.renderVals;
  P.renderVals = function () {
    const vals = _renderVals.call(this);
    const screen = this.state.screens[this.state.version];
    vals.isDramaStr = String(screen === 'drama'); vals.navDrama = () => this.setScreen('drama');
    if (screen === 'drama') { vals.isMedia = true; vals.mediaWorkspace = this.buildDramaWorkspace(); }
    return vals;
  };
  const _setScreen = P.setScreen;
  P.setScreen = function (s, opts) {
    const accepted = _setScreen.call(this, s, opts);
    if (accepted === false) return false;
    if (s === 'drama') { this._dm(); this.loadDramaProjects && !this._dm().projects && this.loadDramaProjects(); this.loadWorkers && this.loadWorkers(); }
    return accepted;
  };
})();
