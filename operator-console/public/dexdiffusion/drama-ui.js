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

  P.loadDramaProjects = async function () {
    const r = await this._dmApi('/api/drama/projects');
    if (r.ok) this.dmSet({ projects: r.data.projects }, { skipIfTyping: true });
    const dm = this._dm();
    if (dm.currentId && !dm.current) this.openDramaProject(dm.currentId, true);
  };
  P.openDramaProject = async function (id, quiet) {
    const r = await this._dmApi('/api/drama/projects/' + id);
    if (!r.ok) { try { sessionStorage.removeItem(KEY); } catch (_) {} this.dmSet({ current: null, currentId: null }); if (!quiet) this.toast(r.data.error || 'Project not found', '#ef4444'); return; }
    try { sessionStorage.setItem(KEY, id); } catch (_) {}
    if (!this._vp().profiles) this.loadVoiceProfiles();
    this._dmText = { script: '', title: '' };
    this.dmSet({ current: r.data.project, currentId: id, assembled: null, run: null, parseResult: null });
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
    this.dmSet({ current: r.data.project, currentId: r.data.project.id, parseResult: { ok: true, mode: r.data.mode }, assembled: null });
    if (!this._vp().profiles) this.loadVoiceProfiles();
    this.toast('Parsed ' + r.data.project.scenes.reduce((n, s) => n + s.lines.length, 0) + ' lines · review below before rendering', '#65d66e');
  };
  P.reparseDrama = async function () {
    const dm = this._dm(), t = this._dmText;
    if (!dm.current || !String(t.script || '').trim()) return;
    if (!window.confirm('Re-parse replaces the parsed lines (and their takes) with a fresh parse of this script. Continue?')) return;
    const r = await this._dmApi('/api/drama/projects/' + dm.current.id + '/reparse', { script: t.script, mode: dm.mode });
    if (!r.ok) { this.dmSet({ parseResult: r.data }); this.toast((r.data.errors || [r.data.error])[0], '#ef4444'); return; }
    this.dmSet({ current: r.data.project, parseResult: { ok: true } });
  };
  P.dramaSave = async function (save) {
    const dm = this._dm(); if (!dm.current) return;
    await this._dmFlush();
    if (!save && !window.confirm('Remove the saved project file? The script stays in memory until the console restarts.')) return;
    const r = await this._dmApi('/api/drama/projects/' + dm.current.id + (save ? '/save' : '/unsave'), {});
    if (!r.ok) { this.toast(r.data.error || 'Save failed', '#ef4444'); return; }
    this.dmSet({ current: r.data.project }); this.loadDramaProjects();
    this.toast(save ? 'Project saved — script and dialogue are now stored on this MacBook' : 'Project file removed (working copy kept in memory)', save ? '#65d66e' : '#fbbf24');
  };
  P.dramaDelete = async function () {
    const dm = this._dm(); if (!dm.current) return;
    if (!window.confirm('Delete "' + dm.current.title + '" (' + (dm.current.saved ? 'saved file included' : 'unsaved') + ')? Generated audio stays in the Library.')) return;
    await this._dmApi('/api/drama/projects/' + dm.current.id, undefined, 'DELETE');
    try { sessionStorage.removeItem(KEY); } catch (_) {}
    this.dmSet({ current: null, currentId: null }); this.loadDramaProjects();
  };

  // debounced line edits (no re-render while typing)
  P._dmQueue = function (lineId, patch) {
    const dm = this._dm(); dm.pending[lineId] = Object.assign(dm.pending[lineId] || {}, patch);
    clearTimeout(this._dmTimer); this._dmTimer = setTimeout(() => this._dmFlush(), 700);
  };
  P._dmFlush = async function () {
    clearTimeout(this._dmTimer);
    const dm = this._dm(), pend = dm.pending; dm.pending = {};
    for (const [lid, patch] of Object.entries(pend)) {
      const r = await this._dmApi(`/api/drama/projects/${dm.current.id}/lines/${lid}`, patch, 'PATCH');
      if (!r.ok) this.toast(r.data.error || 'Edit failed', '#ef4444'); else this._dmSetProject(r.data.project);
    }
  };
  P.dramaLine = async function (lineId, patch) {
    await this._dmFlush();
    const r = await this._dmApi(`/api/drama/projects/${this._dm().current.id}/lines/${lineId}`, patch, 'PATCH');
    if (!r.ok) { this.toast(r.data.error || 'Edit failed', '#ef4444'); return; }
    this.dmSet({ current: r.data.project });
  };
  P.dramaDeleteLine = async function (lineId) {
    const r = await this._dmApi(`/api/drama/projects/${this._dm().current.id}/lines/${lineId}`, undefined, 'DELETE');
    if (r.ok) this.dmSet({ current: r.data.project });
  };
  P.dramaBind = async function (actor, profileId, dir) {
    const r = await this._dmApi(`/api/drama/projects/${this._dm().current.id}/actors/${actor.id}`, { voice_profile_id: profileId, default_direction: dir }, 'PUT');
    if (!r.ok) { this.toast(r.data.error || 'Could not bind voice', '#ef4444'); return; }
    this.dmSet({ current: r.data.project }, { skipIfTyping: dir !== undefined });
  };
  P.dramaSelectTake = async function (lineId, takeId) {
    const r = await this._dmApi(`/api/drama/projects/${this._dm().current.id}/lines/${lineId}/takes/${takeId}/select`, {});
    if (r.ok) this.dmSet({ current: r.data.project }); else this.toast(r.data.error, '#ef4444');
  };

  // ── rendering runs ────────────────────────────────────────────────────────
  P.dramaRender = async function (opts) {
    await this._dmFlush();
    const dm = this._dm();
    const r = await this._dmApi(`/api/drama/projects/${dm.current.id}/render`, opts);
    if (!r.ok) { this.toast((r.data.error || 'Render rejected') + (r.data.gate ? ' · ' + r.data.gate : ''), '#ef4444'); this.dmSet({ error: r.data.error }); return; }
    this.dmSet({ current: r.data.project, error: null });
    if (r.data.run && r.data.run.id) this._followDramaRun(r.data.run.id); else this.toast(r.data.run.note || 'Nothing to render', '#38bdf8');
  };
  P._followDramaRun = function (runId) {
    clearInterval(this._dmRunTimer);
    const tick = async () => {
      const r = await this._dmApi('/api/drama/runs/' + runId);
      if (!r.ok) { clearInterval(this._dmRunTimer); this.dmSet({ run: { status: 'failed', errors: [{ error: 'Lost track of the render run (' + (r.data.error || r.status) + '). Takes already generated are kept.' }] } }); return; }
      this.dmSet({ run: r.data.run, current: r.data.project }, { skipIfTyping: true });
      if (r.data.run.status !== 'running') { clearInterval(this._dmRunTimer); this.toast('Render ' + r.data.run.status + ' · ' + r.data.run.done + ' ok' + (r.data.run.failed ? ', ' + r.data.run.failed + ' failed' : ''), r.data.run.failed ? '#fbbf24' : '#65d66e'); this.loadMediaLibrary && this.loadMediaLibrary('voice'); }
    };
    tick(); this._dmRunTimer = setInterval(tick, 1500);
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
    this.dmSet({ musicLib: [...((m.data && m.data.items) || []), ...((v.data && v.data.items) || [])].filter(i => /\.wav$/i.test(i.artifact_id)).slice(0, 80) });
  };
  P.dramaAddTrack = async function (form) {
    const r = await this._dmApi(`/api/drama/projects/${this._dm().current.id}/tracks`, form);
    if (!r.ok) { this.toast(r.data.error, '#ef4444'); return; }
    this.dmSet({ current: r.data.project });
  };
  P.dramaRemoveTrack = async function (id) { const r = await this._dmApi(`/api/drama/projects/${this._dm().current.id}/tracks/${id}`, undefined, 'DELETE'); if (r.ok) this.dmSet({ current: r.data.project }); };

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
      h('div', { style: css.row }, h('b', { style: { fontSize: 11, color: '#cbd5e1' } }, 'Take ' + (idx + 1)), chip(t.status, t.status === 'complete' ? tone.ok : t.status === 'failed' ? tone.bad : tone.info), t.engine ? chip(t.engine, '#94a3b8') : null, t.duration ? chip(fmtT(t.duration), '#94a3b8') : null,
        t.seed != null ? h('span', { style: css.mono }, 'seed ' + t.seed) : null, t.settings && t.settings.delivery && t.settings.delivery.note ? chip('direction not applied', tone.warn) : null, t.settings && t.settings.seeded === false ? h('span', { title: 'This engine has no seed: re-rendering the same text gives the same audio. Change the text, direction or voice for a different take.', style: { border: '1px solid rgba(148,163,184,.4)', color: '#94a3b8', borderRadius: 6, padding: '2px 7px', fontSize: 10 } }, 'deterministic engine') : null,
        h('div', { style: { flex: 1 } }), t.status === 'complete' ? (t.active ? chip('✓ active', tone.ok) : btn('Use this take', () => this.dramaSelectTake(line.id, t.id), '#65d66e', { 'data-use-take': t.id })) : null),
      t.url ? this._mediaEl(base + t.url, 'audio', 'take-' + t.id) : null,
      t.status === 'failed' ? h('div', { style: { color: tone.bad, fontSize: 11, overflowWrap: 'anywhere' } }, '✗ ' + (t.error || 'failed') + (t.gate ? ' (' + t.gate + ')' : '')) : null);
  };
  P._dmLine = function (p, scene, line, speakers) {
    const dm = this._dm(), running = dm.run && dm.run.status === 'running';
    const skip = line.kind === 'direction' || line.render === false;
    return h('div', { key: line.id, 'data-line': line.id, style: { border: '1px solid rgba(148,163,184,.14)', borderRadius: 9, padding: 8, display: 'grid', gap: 6, background: skip ? 'rgba(8,14,24,.35)' : 'rgba(8,14,24,.7)', opacity: skip ? 0.75 : 1, minWidth: 0 } },
      h('div', { style: css.row }, chip(line.status, STATUS_TONE[line.status] || '#94a3b8'), h('span', { style: css.mono }, line.id), line.edited ? chip('edited', tone.warn) : null, h('div', { style: { flex: 1 } }),
        !skip ? btn('Render', () => this.dramaRender({ scope: 'line', line_id: line.id, alternate: false }), '#38bdf8', { disabled: running, 'data-render-line': line.id }) : null,
        !skip && line.takes.length ? btn('Alternate take', () => this.dramaRender({ scope: 'line', line_id: line.id, alternate: true }), '#a78bfa', { disabled: running, 'data-alt-take': line.id }) : null,
        btn('✕', () => this.dramaDeleteLine(line.id), '#94a3b8', { 'aria-label': 'Delete line', title: 'Remove this line from the project' })),
      h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,150px),1fr))', gap: 6 } },
        field('Speaker', h('input', { value: line.speaker, list: 'dm-speakers', style: css.input, onChange: e => this.dramaLine(line.id, { speaker: e.target.value }) })),
        field('Kind', h('select', { value: line.kind, style: css.input, onChange: e => this.dramaLine(line.id, { kind: e.target.value }) }, ...['dialogue', 'narration', 'direction'].map(k => h('option', { key: k, value: k }, k)))),
        field('Delivery direction', h('input', { value: line.direction || '', placeholder: 'e.g. quietly', style: css.input, onInput: e => this._dmQueue(line.id, { direction: e.target.value }) })),
        field('Pause before (s)', h('input', { type: 'number', min: '0', step: '0.1', value: line.pause_before_s == null ? '' : String(line.pause_before_s), placeholder: 'auto', style: css.input, onInput: e => this._dmQueue(line.id, { pause_before_s: e.target.value }) })),
        field('Pause after (s)', h('input', { type: 'number', min: '0', step: '0.1', value: line.pause_after_s == null ? '' : String(line.pause_after_s), placeholder: String(p.settings.line_gap_s), style: css.input, onInput: e => this._dmQueue(line.id, { pause_after_s: e.target.value }) }))),
      h('textarea', { rows: Math.min(5, Math.max(1, Math.ceil(line.text.length / 90))), value: line.text, 'aria-label': 'Line text', style: Object.assign({}, css.input, { resize: 'vertical' }), onInput: e => this._dmQueue(line.id, { text: e.target.value }) }),
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
          ...[['start_s', 'Start (s)'], ['trim_start_s', 'Trim start (s)'], ['gain', 'Volume (0–2)'], ['fade_in_s', 'Fade in (s)'], ['fade_out_s', 'Fade out (s)']].map(([k, l]) => field(l, h('input', { type: 'number', step: '0.1', min: '0', value: String(form[k]), style: css.input, onInput: e => { form[k] = e.target.value; } })))),
        btn('Add track', () => form.artifact_id ? this.dramaAddTrack(form) : this.toast('Choose an audio file first', '#fbbf24'), '#22d3ee')));
  };
  P.buildDramaWorkspace = function () {
    const dm = this._dm();
    if (!dm.loadedOnce) { dm.loadedOnce = true; setTimeout(() => this.loadDramaProjects(), 0); }
    const t = this._dmText, p = dm.current, base = this.state.backendUrl;
    const speakers = p ? [...new Set(p.scenes.flatMap(s => s.lines.map(l => l.speaker)))] : [];
    const projectList = h('div', { style: css.row }, h('span', { style: css.muted }, 'Projects'), h('select', { 'aria-label': 'Open project', value: dm.currentId || '', style: Object.assign({}, css.input, { width: 'auto', minWidth: 200 }), onChange: e => e.target.value ? this.openDramaProject(e.target.value) : this.dmSet({ current: null, currentId: null }) },
      h('option', { value: '' }, (dm.projects && dm.projects.length ? '— open a project (' + dm.projects.length + ') —' : '— no projects yet —')), ...((dm.projects || []).map(x => h('option', { key: x.id, value: x.id }, (x.saved ? '💾 ' : '🕒 ') + x.title + ' · ' + x.lines + ' lines')))),
      p ? btn('＋ New from script', () => { try { sessionStorage.removeItem(KEY); } catch (_) {} this.dmSet({ current: null, currentId: null }); }, '#94a3b8') : null);
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
  P.setScreen = function (s) { _setScreen.call(this, s); if (s === 'drama') { this._dm(); this.loadDramaProjects && !this._dm().projects && this.loadDramaProjects(); this.loadWorkers && this.loadWorkers(); } };
})();
