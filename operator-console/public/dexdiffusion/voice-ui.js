// Voice Profiles + long-form speech UI. Persistent profiles ("actors") with multiple reference
// samples, engine capability truth, per-render performance direction, and long-form text with
// chunk progress. Quick one-shot Speech/Clone/Design stays available as "Quick".
//
// Private text (script, transcripts) lives in memory only until the user saves a sample/profile.
// Text inputs write state on `input` without re-rendering (so typing then clicking never loses
// a click to a DOM rebuild); structural changes re-render.
(function () {
  'use strict';
  const C = window.DexDiffusionComponent;
  if (!C) return;
  const P = C.prototype;
  const h = (...a) => React.createElement(...a);
  const { css, tone, btn, chip } = window.DexUI;
  const numText = (window.DexUI && window.DexUI.numText) || (p => p);   // numeric text inputs (see DexUI.numText in workstation-ui.js)
  const kokoroChoice = (voices, value, onChange, title) => window.DexModal ? window.DexModal.kokoroChoice(h, voices, value, onChange, title)
    : h('select', { value, style: css.input, 'aria-label': title, onChange: e => onChange(e.target.value) }, ...((voices || []).map(v => h('option', { key: v, value: v }, v))));
  const field = (label, control) => h('label', { style: { display: 'grid', gap: 4, minWidth: 0 } }, h('span', { style: css.label }, label), control);
  const fmtT = s => (s == null || !isFinite(s)) ? '—' : Math.floor(s / 60) + ':' + String(Math.round(s % 60)).padStart(2, '0');
  const TERMINAL = ['COMPLETE', 'FAILED', 'INTERRUPTED', 'CANCELLED'];
  const stateTone = s => ({ valid: tone.ok, warnings: tone.warn, invalid: tone.bad }[s] || tone.off);

  const fmtClock = s => {
    if (s == null || !isFinite(s) || s < 0) return '0:00';
    const sec = Math.floor(s);
    return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
  };
  const VOICE_STUDIO_CSS = `
[data-voice-studio="1"]{display:grid;gap:12px;min-width:0;box-sizing:border-box}
[data-voice-studio="1"] *{box-sizing:border-box}
[data-voice-studio="1"] .vb-header{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;padding:8px 12px;border-radius:10px;border:1px solid rgba(148,163,184,.16);background:rgba(9,20,32,.78)}
[data-voice-studio="1"] .vb-tabs{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
[data-voice-studio="1"] .vb-actions{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
[data-voice-studio="1"] .vb-shell{display:grid;grid-template-columns:minmax(250px,305px) minmax(0,1fr);gap:12px;align-items:start;min-width:0}
[data-voice-studio="1"] .vb-rail{border:1px solid rgba(148,163,184,.16);background:rgba(6,10,16,.78);border-radius:11px;padding:11px;display:grid;gap:9px;min-width:0;position:sticky;top:0}
[data-voice-studio="1"] .vb-voice-list{display:grid;gap:6px;max-height:520px;overflow-y:auto;padding-right:2px;min-width:0}
[data-voice-studio="1"] .vb-voice-card{width:100%;text-align:left;border:1px solid rgba(148,163,184,.18);background:rgba(9,20,32,.62);color:#e2e8f0;border-radius:9px;padding:9px 10px;cursor:pointer;display:grid;grid-template-columns:34px minmax(0,1fr);gap:9px;align-items:center;min-height:58px;transition:border-color .15s,background .15s;font-family:'DM Sans',sans-serif}
[data-voice-studio="1"] .vb-voice-card:hover{border-color:rgba(245,158,11,.45);background:rgba(9,20,32,.9)}
[data-voice-studio="1"] .vb-voice-card.is-active{border-color:rgba(245,158,11,.8);background:rgba(245,158,11,.10);box-shadow:inset 2px 0 0 #f59e0b}
[data-voice-studio="1"] .vb-avatar{width:34px;height:34px;border-radius:999px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;letter-spacing:.03em;flex-shrink:0}
[data-voice-studio="1"] .vb-stage{display:grid;gap:12px;min-width:0}
[data-voice-studio="1"] .vb-card{border:1px solid rgba(148,163,184,.16);background:rgba(6,10,16,.74);border-radius:11px;padding:12px;display:grid;gap:10px;min-width:0}
[data-voice-studio="1"] .vb-history-list{display:grid;gap:6px;max-height:320px;overflow-y:auto;min-width:0}
[data-voice-studio="1"] .vb-history-row{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:9px;align-items:center;padding:8px 10px;border-radius:9px;border:1px solid rgba(148,163,184,.14);background:rgba(9,20,32,.56);min-width:0}
[data-voice-studio="1"] .vb-play-circle{width:34px;height:34px;border-radius:999px;border:1px solid rgba(245,158,11,.55);background:rgba(245,158,11,.14);color:#fbbf24;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;font-size:12px;font-weight:800;flex-shrink:0}
[data-voice-studio="1"] .vb-play-circle.is-playing{background:#f59e0b;color:#080c12;border-color:#f59e0b}
[data-voice-studio="1"] .vb-player{position:sticky;bottom:0;z-index:20;display:grid;gap:6px;padding:10px 12px;border-radius:11px;border:1px solid rgba(245,158,11,.5);background:#080e18;box-shadow:0 -8px 26px rgba(0,0,0,.45);min-width:0}
@media (max-width:860px){[data-voice-studio="1"] .vb-shell{grid-template-columns:minmax(0,1fr)}[data-voice-studio="1"] .vb-rail{position:static}[data-voice-studio="1"] .vb-voice-list{max-height:220px}}
`;
  function injectVoiceStudioCss() {
    if (typeof document === 'undefined' || document.getElementById('dex-voice-studio-css')) return;
    const s = document.createElement('style');
    s.id = 'dex-voice-studio-css';
    s.textContent = VOICE_STUDIO_CSS;
    document.head.appendChild(s);
  }
  const avatarPalette = type => type === 'cloned'
    ? { bg: 'rgba(245,158,11,.18)', fg: '#fbbf24', bd: 'rgba(245,158,11,.5)' }
    : type === 'designed'
      ? { bg: 'rgba(167,139,250,.18)', fg: '#c4b5fd', bd: 'rgba(167,139,250,.5)' }
      : { bg: 'rgba(34,211,238,.16)', fg: '#67e8f9', bd: 'rgba(34,211,238,.45)' };
  const initials = name => {
    const parts = String(name || 'V').trim().split(/\s+/).filter(Boolean);
    return parts.length >= 2 ? (parts[0][0] + parts[1][0]).toUpperCase() : String(parts[0] || 'V').slice(0, 2).toUpperCase();
  };

  P._vp = function () {
    if (!this.vp) this.vp = { tab: 'profiles', profiles: null, engines: null, selected: null, search: '', typeFilter: 'all', historyFilter: 'all', historySearch: '', historyRequested: false, player: null, playerPlaying: false, creating: false, newForm: { type: 'cloned', name: '', language: 'en', preferred_engine: 'qwen3-tts-base', description: '', default_direction: '', notes: '', preset_voice: 'af_heart' }, createPending: null, createTrim: null, createTrimOpen: false, createSampleError: null, createBusy: false, transcribing: false, transcribeError: null, asrStatus: null, pending: null, render: null, busy: false, text: '', direction: '', seed: '', speed: '', conversionSource: null, conversionBusy: false, conversionJob: null, conversionArtifact: null, conversionProject: null, conversionProjects: null, conversionTargetProfileId: '', conversionProjectId: '', conversionLineId: '' };
    return this.vp;
  };
  // Background updates (loads, polls) pass skipIfTyping so a rebuild never steals focus from a field the user is typing in.
  P.vpSet = function (patch, opts) {
    Object.assign(this._vp(), patch);
    const ae = document.activeElement;
    if (opts && opts.skipIfTyping && ae && ae.closest && ae.closest('[data-voice-studio],[data-voice-profiles],[data-new-voice]') && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) return;
    this.setState({ _vpTick: (this.state._vpTick || 0) + 1 });
  };
  P._vpApi = async function (route, body, method) {
    const r = await fetch(this.state.backendUrl + route, { method: method || (body === undefined ? 'GET' : 'POST'), headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await r.json().catch(() => ({ error: r.statusText }));
    return { ok: r.ok, status: r.status, data };
  };
  P.stageConversionSource = async function (file) {
    if (!file) return;
    const r = await fetch(this.state.backendUrl + '/api/staging?accept=audio', { method: 'POST', body: file });
    const data = await r.json().catch(() => ({ error: r.statusText }));
    if (!r.ok || !data.id) { this.toast(data.error || 'Could not stage source audio', '#ef4444'); return; }
    this.vpSet({ conversionSource: { id: data.id, name: file.name, url: this.state.backendUrl + '/api/staging/' + encodeURIComponent(data.id) }, conversionArtifact: null });
  };
  P.loadConversionProject = async function (id) {
    const r = await this._vpApi('/api/drama/projects/' + encodeURIComponent(id));
    if (!r.ok) { this.toast(r.data.error || 'Could not load Drama project', '#ef4444'); return; }
    this.vpSet({ conversionProject: r.data.project, conversionProjectId: id, conversionLineId: '' });
  };
  P.startOpenVoiceConversion = async function () {
    const vp = this._vp();
    if (!vp.conversionSource || !vp.conversionTargetProfileId || vp.conversionBusy) return;
    const r = await this._vpApi('/api/voice/convert', { source_staged_id: vp.conversionSource.id, target_profile_id: vp.conversionTargetProfileId });
    if (!r.ok) { this.toast(r.data.error || 'OpenVoice conversion was refused', '#ef4444'); return; }
    this.vpSet({ conversionBusy: true, conversionJob: { id: r.data.job_id, status: 'QUEUED', progress: null }, conversionArtifact: null });
    const poll = async () => {
      const d = await this._vpApi('/api/jobs/' + encodeURIComponent(r.data.job_id));
      const g = d.data && d.data.generic;
      if (!d.ok || !g) { this.vpSet({ conversionBusy: false }); this.toast('Conversion job status became unavailable', '#ef4444'); return; }
      this.vpSet({ conversionJob: { id: g.job_id, status: g.status, progress: g.progress || null, error: g.error || null } });
      if (g.status === 'COMPLETE' && g.artifacts && g.artifacts.length) {
        const artifact = g.artifacts[0];
        this.vpSet({ conversionBusy: false, conversionArtifact: { id: artifact, jobId: g.job_id, url: this.state.backendUrl + '/api/media/' + encodeURIComponent(artifact) } });
        this.toast('OpenVoice conversion complete · preview before use', '#65d66e'); return;
      }
      if (['FAILED', 'INTERRUPTED', 'CANCELLED'].includes(g.status)) { this.vpSet({ conversionBusy: false }); this.toast(g.error || 'OpenVoice conversion ' + g.status.toLowerCase(), '#ef4444'); return; }
      setTimeout(poll, 1200);
    };
    poll();
  };
  P.attachConvertedTake = async function () {
    const vp = this._vp();
    if (!vp.conversionArtifact || !vp.conversionProjectId || !vp.conversionLineId) return;
    const r = await this._vpApi(`/api/drama/projects/${encodeURIComponent(vp.conversionProjectId)}/lines/${encodeURIComponent(vp.conversionLineId)}/conversions`,
      { artifact_id: vp.conversionArtifact.id, job_id: vp.conversionArtifact.jobId, target_profile_id: vp.conversionTargetProfileId });
    if (!r.ok) { this.toast(r.data.error || 'Converted take could not be attached', '#ef4444'); return; }
    this.toast('Converted take added · local word-integrity QA passed; select it in Drama', '#65d66e');
    this.loadConversionProject(vp.conversionProjectId);
  };
  P.loadVoiceProfiles = async function () {
    const vp = this._vp();
    if (!vp.historyRequested && this.loadMediaLibrary) {
      vp.historyRequested = true;
      this.loadMediaLibrary('voice');
    }
    const [p, e, pref, converters, projects, asr] = await Promise.all([this._vpApi('/api/voice/profiles'), this.vp && this.vp.engines ? { ok: true, data: { engines: this.vp.engines, kokoro_voices: this.vp.kokoroVoices } } : this._vpApi('/api/voice/engines'), this._vpApi('/api/voice/director-preferences'), this._vpApi('/api/voice/converters'), this._vpApi('/api/drama/projects'), this._vpApi('/api/voice/transcribe/status')]);
    if (p.ok) {
      const list = p.data.profiles || [];
      const nextSel = vp.selected && list.some(x => x.id === vp.selected) ? vp.selected : (!vp.selected && list[0] ? list[0].id : vp.selected);
      this.vpSet({ profiles: list, selected: nextSel, engines: e.ok ? e.data.engines : null, kokoroVoices: e.ok ? e.data.kokoro_voices : [], directorPreferences: pref.ok ? pref.data.preferences : null,
        converters: converters.ok ? converters.data.converters : [], conversionProjects: projects.ok ? projects.data.projects : [], asrStatus: asr.ok ? asr.data.asr : this._vp().asrStatus }, { skipIfTyping: true });
    }
  };
  P.saveDirectorPreferences = async function (patch) {
    const r = await this._vpApi('/api/voice/director-preferences', patch, 'PUT');
    if (!r.ok) { this.toast(r.data.error || 'Could not save director preferences', '#ef4444'); return; }
    this.vpSet({ directorPreferences: r.data.preferences });
  };
  P.resetDirectorPreferences = async function () {
    const r = await this._vpApi('/api/voice/director-preferences', undefined, 'DELETE');
    if (r.ok) this.vpSet({ directorPreferences: r.data.preferences });
  };
  P.loadCloneEvaluations = async function (id) {
    const r = await this._vpApi(`/api/voice/profiles/${id}/evaluations`);
    if (r.ok) this.vpSet({ cloneEvaluations: Object.assign({}, this._vp().cloneEvaluations, { [id]: r.data.evaluations }) }, { skipIfTyping: true });
  };
  P.startCloneEvaluation = async function (profile) {
    const scripts = ['The train leaves at noon. I will meet you beside the old clock.', 'I thought you said the letter was destroyed. Then why is it on my desk?', 'Take a breath. We have one chance to get this right, and we are going to use it.'];
    const directions = ['Neutral, clear, conversational delivery.', 'Quietly controlled anger, with a deliberate pause before the final sentence.', 'Warm reassurance, steady pace, and understated confidence.'];
    const r = await this._vpApi(`/api/voice/profiles/${profile.id}/evaluations`, { scripts, directions });
    if (!r.ok) { this.toast(r.data.error || 'Clone evaluation blocked', '#ef4444'); return; }
    const evaluation = r.data.evaluation; this.vpSet({ cloneEvaluationCurrent: evaluation });
    const tick = async () => {
      const d = await this._vpApi(`/api/voice/profiles/${profile.id}/evaluations/${evaluation.id}`);
      if (!d.ok) return;
      this.vpSet({ cloneEvaluationCurrent: d.data.evaluation });
      if (d.data.evaluation.status !== 'rendering') { clearInterval(timer); this.loadCloneEvaluations(profile.id); }
    };
    tick(); const timer = setInterval(tick, 1500);
  };
  P.reviewCloneEvaluation = async function (profileId, evaluationId, index, state) {
    const r = await this._vpApi(`/api/voice/profiles/${profileId}/evaluations/${evaluationId}/takes/${index}/review`, { state }, 'PATCH');
    if (!r.ok) { this.toast(r.data.error || 'Review could not be saved', '#ef4444'); return; }
    this.loadCloneEvaluations(profileId);
  };
  P.checkCloneEvaluationWords = async function (profileId, evaluationId) {
    const scripts = ['The train leaves at noon. I will meet you beside the old clock.', 'I thought you said the letter was destroyed. Then why is it on my desk?', 'Take a breath. We have one chance to get this right, and we are going to use it.'];
    const r = await this._vpApi(`/api/voice/profiles/${profileId}/evaluations/${evaluationId}/word-integrity`, { scripts });
    if (!r.ok) { this.toast(r.data.error || 'Word-integrity check failed', '#ef4444'); return; }
    await this.loadCloneEvaluations(profileId);
    this.toast(`Local ASR word-integrity: ${r.data.evaluation.word_integrity.status} · ${r.data.evaluation.word_integrity.clips_measured || 0}/18 clips`, '#65d66e');
  };
  P._cloneEvaluationPanel = function (p) {
    const vp = this._vp(), evaluations = ((vp.cloneEvaluations || {})[p.id] || []).slice(0, 3);
    const rows = evaluations.map(ev => {
      const clips = ev.clips.map(c => { const wi = c.word_integrity, wordStatus = wi && typeof wi === 'object' ? wi.status : wi || 'not-measured', wordDetails = wi && typeof wi === 'object' && wi.measured ? ` · WER ${wi.wer} · missing ${wi.missing.length} · repeated ${wi.repeated.length}` : ''; return h('div', { key: c.index, style: { display: 'grid', gridTemplateColumns: '1fr auto', gap: 5, alignItems: 'center', borderBottom: '1px solid rgba(148,163,184,.1)', padding: 4 } },
        h('div', null, h('span', { style: css.mono }, `${c.blind_label} · script ${c.script_index + 1} · direction ${c.direction_index + 1} · take ${c.repeat}`),
          h('div', { style: css.muted }, `QA: ${c.checks && c.checks.decodable && c.checks.not_silent ? 'valid audio' : 'check failed'} · word integrity: ${wordStatus}${wordDetails} · human: ${c.human_review && c.human_review.state || 'not reviewed'}`),
          c.url ? this._mediaEl(this.state.backendUrl + c.url, 'audio', `eval-${ev.id}-${c.index}`) : null),
        h('div', { style: css.row }, btn('Heard OK', () => this.reviewCloneEvaluation(p.id, ev.id, c.index, 'heard-ok'), tone.ok), btn('Needs work', () => this.reviewCloneEvaluation(p.id, ev.id, c.index, 'needs-work'), tone.warn))); });
      return h('details', { key: ev.id, open: ev.status === 'rendering' }, h('summary', { style: { cursor: 'pointer', minHeight: 30 } }, `${ev.status} · ${ev.engine || ''} · ${ev.clips.length}/18 · ${ev.id}`), ev.status === 'complete' ? btn('Run local word-integrity QA', () => this.checkCloneEvaluationWords(p.id, ev.id), '#38bdf8', { 'data-word-integrity': ev.id }) : null, ev.word_integrity ? h('div', { style: css.muted, 'data-word-integrity-status': ev.word_integrity.status }, `ASR ${ev.word_integrity.status} · ${ev.word_integrity.clips_measured || 0}/18 measured · ${ev.word_integrity.model || ''} · human review remains separate`) : null, h('div', { style: { display: 'grid', gap: 5 } }, ...clips));
    });
    return h('div', { 'data-clone-evaluation': p.id, style: { borderTop: '1px solid rgba(148,163,184,.18)', paddingTop: 8, display: 'grid', gap: 6 } },
      h('div', { style: css.row }, h('b', { style: { fontSize: 12 } }, 'Clone evaluation · 18 takes'), h('div', { style: { flex: 1 } }), btn('Create & run 18-take set', () => this.startCloneEvaluation(p), '#a78bfa', { disabled: p.validation.state === 'invalid' || (vp.cloneEvaluationCurrent && vp.cloneEvaluationCurrent.status === 'rendering') })),
      h('div', { style: css.muted }, '3 scripts × 3 directions × 2 takes; non-seeded settings are recorded. Optional word-integrity checks use local whisper.cpp; listening review remains a separate human step.'),
      ...rows);
  };
  P._profile = function (id) { return ((this._vp().profiles) || []).find(p => p.id === id) || null; };
  P._engine = function (id) { return ((this._vp().engines) || []).find(e => e.id === id) || null; };

  P._defaultCreateForm = function (type = 'cloned') {
    const defEngine = type === 'designed' ? 'qwen3-tts-voice-design' : type === 'preset' ? 'kokoro' : 'qwen3-tts-base';
    return { type, name: '', language: 'en', preferred_engine: defEngine, description: '', default_direction: '', notes: '', preset_voice: 'af_heart' };
  };
  P.openCreateVoiceModal = function (prefill = null) {
    const vp = this._vp(), pre = prefill || {};
    const type = ['cloned', 'designed', 'preset'].includes(pre.type) ? pre.type : 'cloned';
    const baseForm = this._defaultCreateForm(type);
    if (pre.name) baseForm.name = String(pre.name).slice(0, 60);
    if (pre.preferred_engine) baseForm.preferred_engine = pre.preferred_engine;
    if (pre.language) baseForm.language = pre.language;
    this._vptext = this._vptext || {};
    this._vptext.createTranscript = pre.transcript ? String(pre.transcript) : '';
    let createPending = null, createTrim = null, createTrimOpen = false;
    if (pre.staged && pre.staged.id) {
      const dur = Number(pre.staged.duration);
      createPending = Object.assign({}, pre.staged);
      createTrim = Number.isFinite(dur) && dur >= 0.5 ? { start: 0, end: +Math.min(dur, 30).toFixed(3) } : null;
      createTrimOpen = Number.isFinite(dur) && dur > 30;
    }
    this.vpSet({ creating: true, newForm: baseForm, createPending, createTrim, createTrimOpen, createSampleError: null, transcribeError: null, transcribing: false, createBusy: false });
    if (!vp.asrStatus) this._vpApi('/api/voice/transcribe/status').then(r => { if (r.ok) this.vpSet({ asrStatus: r.data.asr }, { skipIfTyping: true }); });
  };
  P.closeCreateVoiceModal = function (discardStaged = true) {
    const vp = this._vp();
    if (discardStaged && vp.createPending && vp.createPending.id && !vp.createPending.shared) {
      fetch(this.state.backendUrl + '/api/staging/' + encodeURIComponent(vp.createPending.id), { method: 'DELETE' }).catch(() => {});
    }
    if (this._vptext) this._vptext.createTranscript = '';
    this.vpSet({ creating: false, createPending: null, createTrim: null, createTrimOpen: false, createSampleError: null, transcribeError: null, transcribing: false, createBusy: false });
  };
  P.clearCreatePendingSample = function () {
    const vp = this._vp();
    if (vp.createPending && vp.createPending.id && !vp.createPending.shared) {
      fetch(this.state.backendUrl + '/api/staging/' + encodeURIComponent(vp.createPending.id), { method: 'DELETE' }).catch(() => {});
    }
    this.vpSet({ createPending: null, createTrim: null, createTrimOpen: false, createSampleError: null, transcribeError: null });
  };
  P.stageCreateSample = async function (file) {
    if (!file) return;
    if (file.size > 40 * 1024 * 1024) { const msg = 'Audio too large (40 MB max)'; this.toast(msg, '#ef4444'); this.vpSet({ createSampleError: msg }); return; }
    try {
      const r = await fetch(this.state.backendUrl + '/api/staging?accept=audio', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file });
      const d = await r.json().catch(() => ({ error: r.statusText }));
      if (!r.ok) { const msg = d.error || 'Sample rejected'; this.toast(msg, '#ef4444'); this.vpSet({ createSampleError: msg }); return; }
      const vp = this._vp();
      if (vp.createPending && vp.createPending.id && !vp.createPending.shared) {
        fetch(this.state.backendUrl + '/api/staging/' + encodeURIComponent(vp.createPending.id), { method: 'DELETE' }).catch(() => {});
      }
      const duration = Number(d.duration);
      const trim = Number.isFinite(duration) && duration >= 0.5 ? { start: 0, end: +Math.min(duration, 30).toFixed(3) } : null;
      if (!String(vp.newForm.name || '').trim()) {
        vp.newForm.name = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim().slice(0, 60);
      }
      this.vpSet({
        createPending: Object.assign({}, d, { filename: file.name, name: file.name }),
        createTrim: trim,
        createTrimOpen: Number.isFinite(duration) && duration > 30,
        createSampleError: trim ? null : (Number.isFinite(duration) && duration < 0.5 ? 'Audio reference is shorter than 0.5 seconds' : 'Could not determine audio duration; try a WAV/MP3/M4A/FLAC file'),
        transcribeError: null,
      });
    } catch (e) {
      const msg = (e && e.message) ? e.message : 'Upload failed';
      this.toast(msg, '#ef4444'); this.vpSet({ createSampleError: msg });
    }
  };
  P.setCreateTrim = function (which, value) {
    const vp = this._vp(), old = vp.createTrim, d = Number(vp.createPending && vp.createPending.duration);
    if (!old || !Number.isFinite(d)) return;
    const next = this._normalizeSampleTrim(which === 'start' ? value : old.start, which === 'end' ? value : old.end, d, which);
    if (next) this.vpSet({ createTrim: next });
  };
  P.playCreateSampleSelection = function () {
    const vp = this._vp(), clip = vp.createTrim;
    const audio = document.querySelector('[data-create-sample-card] audio[data-create-audio-player]');
    if (!audio) return;
    audio.pause();
    if (clip) audio.currentTime = clip.start;
    const p = audio.play();
    if (p && typeof p.catch === 'function') p.catch(() => { this.toast('Playback unavailable; use the audio controls', '#fbbf24'); });
  };
  P.transcribeCreateSample = async function () {
    const vp = this._vp();
    if (!vp.createPending || vp.transcribing) return;
    this.vpSet({ transcribing: true, transcribeError: null });
    const body = { staged_id: vp.createPending.id };
    if (vp.createTrim) { body.trim_start_s = vp.createTrim.start; body.trim_end_s = vp.createTrim.end; }
    const r = await this._vpApi('/api/voice/transcribe', body);
    if (!r.ok) {
      const msg = r.data.error || 'Local transcription unavailable';
      this.vpSet({ transcribing: false, transcribeError: msg });
      this.toast(msg, '#fbbf24');
      return;
    }
    this._vptext = this._vptext || {};
    this._vptext.createTranscript = r.data.text || '';
    this.vpSet({ transcribing: false, transcribeError: null, createSampleError: null });
    this.toast(r.data.text ? 'Transcribed locally' : 'No speech detected in sample', r.data.text ? '#65d66e' : '#fbbf24');
  };
  P.transcribeExistingSample = async function (profileId, sampleId) {
    this.vpSet({ transcribingSampleId: sampleId });
    const r = await this._vpApi('/api/voice/transcribe', { profile_id: profileId, sample_id: sampleId });
    this.vpSet({ transcribingSampleId: null });
    if (!r.ok) { this.toast(r.data.error || 'Local transcription unavailable', '#fbbf24'); return; }
    await this.updateProfileSample(profileId, sampleId, { transcript: r.data.text || '' });
    this.toast(r.data.text ? 'Transcript filled locally' : 'No speech detected in sample', r.data.text ? '#65d66e' : '#fbbf24');
  };
  P.createVoiceProfile = async function () {
    const vp = this._vp(), f = vp.newForm, t = this._vptext || {};
    if (vp.createBusy) return;
    const fallbackName = vp.createPending ? (vp.createPending.filename || '').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim().slice(0, 60) : '';
    const name = String(f.name || '').trim() || fallbackName;
    if (!name) { this.toast('Give the voice a name', '#fbbf24'); return; }
    const transcript = String(t.createTranscript || '').trim();
    if (f.type === 'cloned' && vp.createPending) {
      const sel = vp.createTrim;
      if (!sel || sel.end - sel.start < 0.5 || sel.end - sel.start > 30.001) {
        this.vpSet({ createSampleError: 'Select a 0.5–30 second reference excerpt' }); return;
      }
      const engineId = f.preferred_engine || 'qwen3-tts-base';
      if (engineId === 'qwen3-tts-base' && !transcript) {
        this.vpSet({ createSampleError: 'Reference text is required for Qwen3-TTS Base (transcribe/type what is spoken, or switch Default Engine to VoxCPM2)' });
        return;
      }
    }
    this.vpSet({ createBusy: true, createSampleError: null });
    const payload = {
      name,
      type: f.type,
      language: f.language || 'en',
      preferred_engine: f.preferred_engine || undefined,
      description: f.type === 'designed' ? f.description : undefined,
      preset_voice: f.type === 'preset' ? f.preset_voice : undefined,
      default_direction: f.default_direction || '',
      notes: f.notes || '',
    };
    const r = await this._vpApi('/api/voice/profiles', payload);
    if (!r.ok) { this.vpSet({ createBusy: false }); this.toast(r.data.error || 'Could not create the profile', '#ef4444'); return; }
    const created = r.data.profile;
    if (f.type === 'cloned' && vp.createPending) {
      const sel = vp.createTrim;
      const sampleName = (vp.createPending.filename || name).replace(/\.[^.]+$/, '').slice(0, 60);
      const sr = await this._vpApi(`/api/voice/profiles/${created.id}/samples`, {
        staged_id: vp.createPending.id,
        name: sampleName,
        transcript,
        trim_start_s: sel.start,
        trim_end_s: sel.end,
      });
      if (!sr.ok) {
        await this._vpApi('/api/voice/profiles/' + created.id, undefined, 'DELETE').catch(() => {});
        const msg = (sr.data.error || 'Sample rejected') + (sr.data.gate ? ' · ' + sr.data.gate : '');
        this.vpSet({ createBusy: false, createSampleError: msg });
        this.toast(msg, '#ef4444');
        return;
      }
    }
    if (this._vptext) this._vptext.createTranscript = '';
    await this.loadVoiceProfiles();
    this.vpSet({ creating: false, createBusy: false, createPending: null, createTrim: null, createTrimOpen: false, createSampleError: null, transcribeError: null, selected: created.id, newForm: this._defaultCreateForm(f.type) });
    this.toast('Created voice "' + created.name + '"', '#65d66e');
  };
  P.saveVoiceProfile = async function (id, patch) {
    const r = await this._vpApi('/api/voice/profiles/' + id, patch, 'PUT');
    if (!r.ok) { this.toast(r.data.error || 'Save failed', '#ef4444'); return; }
    await this.loadVoiceProfiles();
    if (patch && patch.preferred_engine) {
      const prefs = this._vp().directorPreferences || {};
      await this.saveDirectorPreferences({ preferred_models: Object.assign({}, prefs.preferred_models, { [id]: patch.preferred_engine }) });
    }
    this.toast('Saved', '#65d66e');
  };
  P.deleteVoiceProfile = async function (id) {
    const p = this._profile(id);
    if (!window.confirm('Delete voice "' + (p && p.name) + '" and all of its reference samples? This cannot be undone.')) return;
    await this._vpApi('/api/voice/profiles/' + id, undefined, 'DELETE');
    this.vpSet({ selected: null }); await this.loadVoiceProfiles();
  };
  P._normalizeSampleTrim = function (start, end, duration, moved = 'start') {
    const d = Number(duration);
    if (!Number.isFinite(d) || d < 0.5) return null;
    const cap = n => Math.min(d, Math.max(0, Number(n) || 0));
    let a = cap(start), b = cap(end);
    if (moved === 'start') {
      a = Math.min(a, d - 0.5);
      b = Math.min(d, Math.max(a + 0.5, Math.min(b, a + 30)));
    } else {
      b = Math.max(0.5, b);
      a = Math.max(0, Math.min(b - 0.5, Math.max(a, b - 30)));
    }
    return { start: +a.toFixed(3), end: +b.toFixed(3) };
  };
  P.setSampleTrim = function (which, value) {
    const vp = this._vp(), old = vp.trim, d = Number(vp.pending && vp.pending.duration);
    if (!old || !Number.isFinite(d)) return;
    const next = this._normalizeSampleTrim(which === 'start' ? value : old.start, which === 'end' ? value : old.end, d, which);
    if (next) this.vpSet({ trim: next });
  };
  P.playSampleSelection = function () {
    const vp = this._vp(), clip = vp.trim;
    const audio = document.querySelector('[data-pending-sample] audio[data-trim-player]');
    if (!clip || !audio) return;
    audio.pause();
    audio.currentTime = clip.start;
    const p = audio.play();
    if (p && typeof p.catch === 'function') p.catch(() => { this.toast('Playback unavailable; try the audio player controls', '#fbbf24'); });
  };
  P.loadSampleWaveform = async function (file, stagedId, duration) {
    if (file.size > 12 * 1024 * 1024 || duration > 600 || !window.AudioContext) return;
    let context = null;
    try {
      context = new AudioContext();
      const audio = await context.decodeAudioData(await file.arrayBuffer());
      const samples = audio.getChannelData(0), columns = 96, group = samples.length / columns;
      const waveform = Array.from({ length: columns }, (_, i) => {
        const from = Math.floor(i * group), to = Math.floor((i + 1) * group);
        let peak = 0;
        const stride = Math.max(1, Math.floor((to - from) / 180));
        for (let j = from; j < to; j += stride) peak = Math.max(peak, Math.abs(samples[j]));
        return Math.min(1, +peak.toFixed(3));
      });
      if (this._vp().pending?.id === stagedId) this.vpSet({ sampleWaveform: waveform });
    } catch (_) { /* The range editor works without client-side codec support. */ }
    finally { if (context) context.close().catch(() => {}); }
  };
  P.stageProfileSample = async function (file) {
    if (!file) return;
    if (file.size > 40 * 1024 * 1024) { const msg = 'Audio too large (40 MB max)'; this.toast(msg, '#ef4444'); this.vpSet({ sampleError: msg }); return; }
    try {
      const r = await fetch(this.state.backendUrl + '/api/staging?accept=audio', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file });
      const d = await r.json().catch(() => ({ error: r.statusText }));
      if (!r.ok) { const msg = d.error || 'Sample rejected'; this.toast(msg, '#ef4444'); this.vpSet({ sampleError: msg }); return; }
      this._vptext = this._vptext || {};
      const sampleName = file.name.replace(/\.[^.]+$/, '').slice(0, 60);
      this._vptext.sampleName = sampleName;
      // No filename-triggered auto-approval: every upload gets a reviewable
      // selection, and its transcript must describe only that excerpt.
      this._vptext.sampleTranscript = '';
      const duration = Number(d.duration);
      const trim = Number.isFinite(duration) && duration >= 0.5 ? { start: 0, end: +Math.min(duration, 30).toFixed(3) } : null;
      this.vpSet({ pending: Object.assign({}, d, { filename: file.name, name: file.name }), trim, sampleWaveform: null, sampleError: trim ? null : (Number.isFinite(duration) && duration < 0.5 ? 'Audio reference is shorter than 0.5 seconds' : 'Could not determine audio duration; try a WAV/MP3/M4A/FLAC file') });
      if (trim) this.loadSampleWaveform(file, d.id, duration);
    } catch (e) {
      const msg = (e && e.message) ? e.message : 'Upload failed';
      this.toast(msg, '#ef4444'); this.vpSet({ sampleError: msg });
    }
  };
  P.approveProfileSample = async function () {
    const vp = this._vp(), t = this._vptext || {};
    if (!vp.pending) return;
    const sel = vp.trim;
    if (!sel || sel.end - sel.start < 0.5 || sel.end - sel.start > 30.001) {
      this.vpSet({ sampleError: 'Select a 0.5–30 second reference excerpt' }); return;
    }
    const r = await this._vpApi('/api/voice/profiles/' + vp.selected + '/samples', { staged_id: vp.pending.id, name: t.sampleName, transcript: t.sampleTranscript, trim_start_s: sel.start, trim_end_s: sel.end });
    if (!r.ok) { const msg = (r.data.error || 'Sample rejected') + (r.data.gate ? ' · ' + r.data.gate : ''); this.toast(msg, '#ef4444'); this.vpSet({ sampleError: msg }); return; }
    this.vpSet({ pending: null, trim: null, sampleWaveform: null, sampleError: null }); await this.loadVoiceProfiles();
    this.toast('Sample saved to the voice' + (r.data.sample.validation.warnings.length ? ' — with warnings' : ''), r.data.sample.validation.warnings.length ? '#fbbf24' : '#65d66e');
  };
  P.updateProfileSample = async function (pid, sid, patch) {
    const r = await this._vpApi(`/api/voice/profiles/${pid}/samples/${sid}`, patch, 'PUT');
    if (!r.ok) { this.toast(r.data.error || 'Update failed', '#ef4444'); return; }
    await this.loadVoiceProfiles();
  };
  P.removeProfileSample = async function (pid, sid) {
    if (!window.confirm('Remove this reference sample?')) return;
    await this._vpApi(`/api/voice/profiles/${pid}/samples/${sid}`, undefined, 'DELETE'); await this.loadVoiceProfiles();
  };

  // ── long-form render ────────────────────────────────────────────────────
  P.renderProfileSpeech = async function () {
    const vp = this._vp(), t = this._vptext || {};
    const text = String(t.profileText || '');
    if (!vp.selected) { this.toast('Choose a voice first', '#fbbf24'); return; }
    if (!text.trim()) { this.toast('Enter the text to speak', '#fbbf24'); return; }
    const profile = (vp.profiles || []).find(x => x.id === vp.selected), engine = profile && this._engine(profile.preferred_engine), prefs = vp.directorPreferences || {};
    const direction = (t.profileDirection || profile && profile.default_direction || prefs.default_direction || '');
    const speed = vp.speed || (engine && engine.capabilities.speed_control ? prefs.speed : undefined);
    const settings = { profile_id: vp.selected, direction: engine && engine.capabilities.delivery_instructions ? direction : '', speed, language: undefined };
    await this.saveDirectorPreferences({ last_audition: { profile_id: vp.selected, direction: settings.direction, speed: speed || 1, updated_at: Date.now() } });
    const r = await this._vpApi('/api/voice/render', { ...settings, text, seed: vp.seed, save_prompts: !!this.state.savePrompts });
    if (!r.ok) { this.vpSet({ render: { profile_id: vp.selected, status: 'FAILED', error: r.data.error, gate: r.data.gate } }); this.toast(r.data.error || 'Render rejected', '#ef4444'); return; }
    this.vpSet({ render: { profile_id: vp.selected, status: 'QUEUED', job_id: r.data.job_id, info: r.data, label: 'Queued' } });
    this._followVoiceRender(r.data.job_id, vp.selected);
  };
  P._ensureVoiceBarAudio = function () {
    if (this._vbAudio) return this._vbAudio;
    const audio = new Audio();
    audio.preload = 'metadata';
    const syncDom = () => {
      const dur = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : (this._vp().player && this._vp().player.duration) || 0;
      const cur = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
      const clk = document.querySelector('[data-vb-player-clock="1"]');
      if (clk) clk.textContent = fmtClock(cur) + ' / ' + fmtClock(dur);
      const rng = document.querySelector('[data-vb-player-seek="1"]');
      if (rng && dur > 0 && document.activeElement !== rng) rng.value = String(Math.min(dur, cur));
    };
    audio.addEventListener('timeupdate', syncDom);
    audio.addEventListener('loadedmetadata', () => {
      const vp = this._vp();
      if (vp.player && Number.isFinite(audio.duration) && audio.duration > 0) vp.player.duration = audio.duration;
      syncDom();
    });
    audio.addEventListener('play', () => this.vpSet({ playerPlaying: true }, { skipIfTyping: true }));
    audio.addEventListener('pause', () => this.vpSet({ playerPlaying: false }, { skipIfTyping: true }));
    audio.addEventListener('ended', () => { syncDom(); this.vpSet({ playerPlaying: false }, { skipIfTyping: true }); });
    this._vbAudio = audio;
    return audio;
  };
  P.playInVoiceBar = function (track, autoPlay = true) {
    if (!track || !track.url) return;
    const vp = this._vp(), audio = this._ensureVoiceBarAudio();
    const same = vp.player && vp.player.id === track.id && audio.src && audio.src.endsWith(track.url);
    if (same) {
      if (autoPlay) { if (audio.paused) audio.play().catch(() => {}); else audio.pause(); }
      return;
    }
    audio.pause();
    audio.src = track.url;
    audio.currentTime = 0;
    this.vpSet({ player: Object.assign({}, track), playerPlaying: false }, { skipIfTyping: true });
    if (autoPlay) audio.play().catch(() => { this.toast('Playback unavailable in this environment', '#fbbf24'); });
  };
  P.toggleVoiceBarPlay = function () {
    const vp = this._vp();
    if (!vp.player) return;
    const audio = this._ensureVoiceBarAudio();
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  };
  P.seekVoiceBar = function (seconds) {
    const audio = this._vbAudio;
    const val = Number(seconds);
    if (!audio || !Number.isFinite(val)) return;
    audio.currentTime = Math.max(0, val);
  };
  P.closeVoiceBar = function () {
    if (this._vbAudio) { this._vbAudio.pause(); this._vbAudio.removeAttribute('src'); }
    this.vpSet({ player: null, playerPlaying: false });
  };

  P._followVoiceRender = function (jobId, profileId) {
    clearInterval(this._vpTimer);
    const tick = async () => {
      const r = await this._vpApi('/api/voice/render/' + jobId);
      if (!r.ok) { clearInterval(this._vpTimer); this.vpSet({ render: Object.assign({}, this._vp().render, { profile_id: profileId, status: 'FAILED', error: 'Lost track of the job: ' + (r.data.error || r.status) }) }); return; }
      const d = r.data;
      this.vpSet({ render: Object.assign({}, this._vp().render, d, { profile_id: profileId }) }, { skipIfTyping: true });
      if (TERMINAL.includes(d.status)) {
        clearInterval(this._vpTimer);
        this.loadMediaLibrary && this.loadMediaLibrary('voice');
        if (d.status === 'COMPLETE' && d.artifact) {
          const prof = this._profile(profileId);
          this.playInVoiceBar({
            id: d.artifact.artifact_id,
            title: prof ? prof.name : d.artifact.artifact_id,
            subtitle: [(prof && prof.preferred_engine) || 'voice', fmtT(d.artifact.duration)].filter(Boolean).join(' · '),
            url: this.state.backendUrl + d.artifact.url,
            downloadUrl: this.state.backendUrl + d.artifact.download_url,
            duration: d.artifact.duration || 0,
          }, false);
        }
        this.toast(d.status === 'COMPLETE' ? 'Speech ready' : 'Render ' + d.status.toLowerCase() + (d.error ? ': ' + d.error : ''), d.status === 'COMPLETE' ? '#65d66e' : '#ef4444');
      }
    };
    tick(); this._vpTimer = setInterval(tick, 1800);
  };

  // ── builders ──────────────────────────────────────────────────────────────
  P._capMatrix = function (engineId) {
    const e = this._engine(engineId); if (!e) return null;
    const c = e.capabilities;
    const rows = [['Voice cloning', c.cloning], ['Voice design', c.voice_design], ['Preset voices', c.preset_voices], ['Multiple reference samples per render', c.multi_sample_reference], ['Delivery / performance direction', c.delivery_instructions],
      ['Speed control', c.speed_control], ['Paralinguistic tags', c.paralinguistic_tags], ['Streaming', c.streaming], ['Seeded / deterministic', c.deterministic_seed], ['Cached voice prompt', c.prompt_caching]];
    return h('details', { 'data-engine-caps': engineId, style: { border: '1px solid rgba(148,163,184,.14)', borderRadius: 8, padding: '6px 10px' } },
      h('summary', { style: Object.assign({}, css.muted, { cursor: 'pointer', minHeight: 32, display: 'flex', alignItems: 'center' }) }, '▸ ' + e.label + ' — what this engine can really do'),
      h('div', { style: { display: 'grid', gap: 3, marginTop: 6 } }, ...rows.map(([k, v]) => h('div', { key: k, style: { display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12 } }, h('span', { style: { color: '#94a3b8' } }, k), h('b', { style: { color: v ? tone.ok : '#94a3b8' } }, v ? 'Yes' : 'No'))),
        h('div', { style: css.muted }, 'Languages: ' + (c.languages || []).join(', ') + ' · ' + c.sample_rate + ' Hz · max ' + c.max_chunk_chars + ' chars per chunk' + (c.reference_seconds ? ' · reference ' + c.reference_seconds.min + '–' + c.reference_seconds.max + ' s (best ' + c.reference_seconds.recommended.join('–') + ')' : '')),
        ...Object.entries(e.evidence || {}).filter(([k]) => ['delivery_instructions', 'prompt_caching', 'multi_sample_reference'].includes(k)).map(([k, v]) => h('div', { key: k, style: css.muted }, '• ' + k.replace(/_/g, ' ') + ': ' + v))));
  };
  P._sampleCard = function (p, s) {
    const base = this.state.backendUrl, vp = this._vp();
    const dg = s.diagnostics || {};
    const transcribingThis = vp.transcribingSampleId === s.id;
    const tr = h('textarea', { rows: 2, value: s.transcript || '', placeholder: 'Exact words spoken in this clip (required for Qwen3-TTS Base; optional for VoxCPM2)', style: Object.assign({}, css.input, { resize: 'vertical' }), onChange: e => this.updateProfileSample(p.id, s.id, { transcript: e.target.value }) });
    return h('div', { key: s.id, 'data-sample': s.id, style: { border: '1px solid ' + (s.active ? 'rgba(101,214,110,.45)' : 'rgba(148,163,184,.18)'), borderRadius: 9, padding: 9, display: 'grid', gap: 6, minWidth: 0 } },
      h('div', { style: css.row }, h('b', { style: { color: '#e2e8f0', fontSize: 13 } }, s.name), s.active ? chip('active', tone.ok) : btn('Use this sample', () => this.updateProfileSample(p.id, s.id, { active: true }), '#94a3b8'), h('div', { style: { flex: 1 } }), btn(transcribingThis ? 'Transcribing…' : 'Transcribe', () => this.transcribeExistingSample(p.id, s.id), '#38bdf8', { disabled: !!transcribingThis }), btn('Remove', () => this.removeProfileSample(p.id, s.id), '#f87171')),
      this._mediaEl(base + s.audio_url, 'audio', 'sample-' + s.id),
      dg.waveform && window.DexStudio ? window.DexStudio.waveform(this, 'sample-' + s.id, dg.waveform, 420, 44, '#a78bfa') : null,
      h('div', { style: css.row }, chip(fmtT(dg.duration), '#94a3b8'), chip('RMS ' + dg.rms_db + ' dB', '#94a3b8'), chip('peak ' + dg.peak_db + ' dB', '#94a3b8'), chip('clipping ' + (dg.clip_percent != null ? dg.clip_percent : (dg.clip_ratio || 0) * 100).toString().slice(0, 5) + '%', dg.clip_percent > 0.5 ? tone.warn : '#94a3b8'), chip('silence ' + Math.round(dg.silence_percent != null ? dg.silence_percent : (dg.silence_ratio || 0) * 100) + '%', '#94a3b8'),
        dg.snr ? chip(dg.snr.db != null ? 'SNR ≈ ' + dg.snr.db + ' dB (estimate)' : 'SNR: not estimable', '#94a3b8') : null, ...(s.validation.warnings || []).map(w => chip('⚠ ' + w, tone.warn)), ...(s.validation.errors || []).map(w => chip('✗ ' + w, tone.bad))),
      h('div', { style: css.muted }, (s.diagnostics_disclaimer || '') + (dg.snr && dg.snr.note ? ' ' + dg.snr.note + '.' : '')),
      tr);
  };
  P._profileEditor = function (p) {
    const vp = this._vp(), t = this._vptext = this._vptext || {};
    if (p.type === 'cloned' && !(vp.cloneEvaluations || {})[p.id] && !(vp.cloneEvaluationLoading || {})[p.id]) {
      vp.cloneEvaluationLoading = Object.assign({}, vp.cloneEvaluationLoading, { [p.id]: true });
      setTimeout(() => this.loadCloneEvaluations(p.id), 0);
    }
    const eng = (p.compatible_engines || []).map(id => this._engine(id)).filter(Boolean);
    const val = p.validation && p.validation.engines ? Object.entries(p.validation.engines) : [];
    const pend = vp.pending;
    const selectedTrim = vp.trim;
    const wave = vp.sampleWaveform;
    const duration = Number(pend?.duration);
    const validSelection = selectedTrim && Number.isFinite(duration) && selectedTrim.end - selectedTrim.start >= 0.5 && selectedTrim.end - selectedTrim.start <= 30.001;
    const selectedDuration = validSelection ? selectedTrim.end - selectedTrim.start : 0;
    const inputId = 'profile-sample-file-input';
    const triggerSamplePick = e => {
      if (e && e.preventDefault) { e.preventDefault(); e.stopPropagation(); }
      const inp = document.getElementById(inputId) || (e && e.currentTarget && (e.currentTarget.closest('[data-profile-editor]') || e.currentTarget.parentElement)?.querySelector('input[type="file"]')) || document.querySelector('[data-profile-editor] input[type="file"]');
      if (inp) inp.click();
    };
    const sampleInput = h('input', {
      id: inputId,
      type: 'file',
      accept: 'audio/*,.wav,.mp3,.m4a,.flac',
      style: { position: 'absolute', opacity: 0, width: 1, height: 1, pointerEvents: 'none' },
      onChange: e => {
        const file = e.target.files && e.target.files[0];
        e.target.value = '';
        if (file) this.stageProfileSample(file);
      }
    });
    const sampleErr = vp.sampleError;
    const sampleErrorBlock = sampleErr ? h('div', {
      role: 'alert',
      'data-sample-error': '1',
      style: { color: tone.bad, fontSize: 12, border: '1px solid rgba(248,113,113,.4)', borderRadius: 8, padding: 8, background: 'rgba(239,68,68,.08)', overflowWrap: 'anywhere' }
    }, '✗ ' + sampleErr) : null;
    const upload = h('label', {
      htmlFor: inputId,
      'data-sample-dropzone': '1',
      style: { border: '1px dashed rgba(167,139,250,.5)', color: '#c4b5fd', borderRadius: 8, padding: 11, minHeight: 44, cursor: 'pointer', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
      onDragEnter: e => { e.preventDefault(); e.stopPropagation(); },
      onDragOver: e => { e.preventDefault(); e.stopPropagation(); },
      onDragLeave: e => { e.preventDefault(); e.stopPropagation(); },
      onDrop: e => { e.preventDefault(); e.stopPropagation(); if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) this.stageProfileSample(e.dataTransfer.files[0]); }
    },
      h('span', null, 'Add a reference sample (WAV / MP3 / M4A / FLAC) — click or drop'),
      h('button', {
        type: 'button',
        'data-upload-button': 'sample',
        onClick: triggerSamplePick,
        style: { border: '1px solid rgba(167,139,250,.6)', background: 'rgba(167,139,250,.2)', color: '#c4b5fd', borderRadius: 7, padding: '7px 11px', minHeight: 34, fontSize: 12, cursor: 'pointer', fontWeight: 700, fontFamily: "'DM Sans',sans-serif" }
      }, 'Upload sample'),
      sampleInput);
    return h('div', { 'data-profile-editor': p.id, className: 'vb-card', style: { display: 'grid', gap: 10 } },
      h('div', { style: css.row },
        h('div', { style: css.title }, 'Voice settings · ' + p.name),
        chip(p.type, '#a78bfa'),
        chip(p.validation.state, stateTone(p.validation.state)),
        chip((p.preferred_engine || '—'), '#22d3ee'),
        h('div', { style: { flex: 1 } }),
        btn('Delete voice', () => this.deleteVoiceProfile(p.id), '#f87171')),
      h('div', { style: css.grid2 },
        field('Name', h('input', { value: p.name, style: css.input, onChange: e => this.saveVoiceProfile(p.id, { name: e.target.value }) })),
        field('Default delivery direction', h('input', { value: p.default_direction || '', placeholder: 'e.g. calm, measured', style: css.input, onChange: e => this.saveVoiceProfile(p.id, { default_direction: e.target.value }) }))),
      h('div', { style: css.grid2 },
        field('Render engine', window.DexModal ? window.DexModal.choiceButton(h, { id: 'voice-engine', title: 'Render engine for ' + p.name, ariaLabel: 'Render engine for ' + p.name,
          subtitle: 'Engine status is reported separately from profile approval. Unverified engines may fail their runtime availability check.',
          value: p.preferred_engine || '', placeholder: 'Choose an engine', attrs: { 'data-voice-engine': p.id },
          options: (vp.engines || []).filter(e => Array.isArray(e.voice_types) && e.voice_types.includes(p.type)).map(e => ({ value: e.id, label: e.label, badge: e.status || 'IMPLEMENTED / UNVERIFIED', hint: e.description || ('Voice types: ' + e.voice_types.join(', ')) })),
          onChange: v => this.saveVoiceProfile(p.id, { preferred_engine: v }) })
          : h('select', { value: p.preferred_engine || '', style: css.input, 'aria-label': 'Render engine for ' + p.name,
          title: 'Engine status is reported separately from profile approval. Unverified engines may fail their runtime availability check.',
          onChange: e => this.saveVoiceProfile(p.id, { preferred_engine: e.target.value }) },
          ...((vp.engines || []).filter(e => Array.isArray(e.voice_types) && e.voice_types.includes(p.type)).map(e => h('option', { key: e.id, value: e.id }, `${e.label} · ${e.status || 'IMPLEMENTED / UNVERIFIED'}`))))),
        field('Notes', h('input', {
          value: p.notes || '',
          style: css.input,
          onChange: e => this.saveVoiceProfile(p.id, { notes: e.target.value }),
          onDragEnter: e => { e.preventDefault(); e.stopPropagation(); },
          onDragOver: e => { e.preventDefault(); e.stopPropagation(); },
          onDrop: e => {
            if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
              e.preventDefault();
              e.stopPropagation();
              this.stageProfileSample(e.dataTransfer.files[0]);
            }
          }
        }))),
      p.type === 'designed' ? field('Voice description', h('textarea', { rows: 3, value: p.description || '', style: Object.assign({}, css.input, { resize: 'vertical' }), onChange: e => this.saveVoiceProfile(p.id, { description: e.target.value }) })) : null,
      p.type === 'preset' ? h('div', { style: css.grid2 }, field('Kokoro voice', kokoroChoice(vp.kokoroVoices, p.preset_voice, v => this.saveVoiceProfile(p.id, { preset_voice: v }), 'Kokoro voice for ' + p.name)),
        field('Default speed', h('input', numText({ min: '0.5', max: '2', step: '0.05', value: String(p.default_speed || 1), style: css.input, onChange: e => this.saveVoiceProfile(p.id, { default_speed: e.target.value }) })))) : null,
      p.type === 'cloned' ? h('div', { style: { display: 'grid', gap: 8 } },
        h('div', { style: css.title }, 'Reference samples (' + p.samples.length + ' of 8)'),
        ...p.samples.map(s => this._sampleCard(p, s)),
        pend ? h('div', { 'data-pending-sample': '1', style: { border: '1px solid rgba(167,139,250,.5)', borderRadius: 9, padding: 9, display: 'grid', gap: 6 } },
          h('div', { style: css.row },
            h('b', { style: { color: '#c4b5fd', fontSize: 12 } }, 'New sample (temporary until you approve it)'),
            pend.filename ? chip(pend.filename, '#a78bfa') : null,
            chip(fmtT(pend.duration), '#94a3b8')),
          h('audio', { src: this.state.backendUrl + pend.url, controls: true, preload: 'metadata', 'data-trim-player': '1',
            style: { width: '100%', minHeight: 40 }, onTimeUpdate: e => {
              if (this._vp().trim && e.currentTarget.currentTime >= this._vp().trim.end) e.currentTarget.pause();
            } }),
          h('div', { 'data-sample-trimmer': '1', style: { display: 'grid', gap: 7, padding: 9, borderRadius: 8, border: '1px solid rgba(167,139,250,.4)', background: 'rgba(167,139,250,.07)' } },
            h('b', { style: { color: '#ddd6fe', fontSize: 12 } }, 'Select the reference excerpt · maximum 30 seconds'),
            wave && wave.length ? h('svg', { viewBox: '0 0 960 60', role: 'img', 'aria-label': 'Audio waveform; selected portion highlighted', style: { width: '100%', height: 60, background: '#0b1323', borderRadius: 6 } },
              ...wave.map((peak, i) => h('rect', { key: i, x: i * 10 + 2, y: 30 - Math.max(2, peak * 27), width: 6, height: Math.max(4, peak * 54), rx: 2,
                fill: validSelection && i / wave.length >= selectedTrim.start / duration && i / wave.length <= selectedTrim.end / duration ? '#a78bfa' : '#3e526d' }))) : null,
            h('div', { style: css.row }, h('span', { style: css.muted }, 'Start'),
              h('input', { type: 'range', min: 0, max: duration || 30, step: 0.05, value: selectedTrim?.start || 0,
                'aria-label': 'Reference start time', 'data-trim-start': '1', style: { flex: '1 1 160px', accentColor: '#a78bfa' }, onInput: e => this.setSampleTrim('start', e.target.value) }),
              h('input', { type: 'number', min: 0, max: duration || 30, step: 0.05, value: selectedTrim?.start || 0,
                'aria-label': 'Start seconds', style: Object.assign({}, css.input, { width: 78 }), onChange: e => this.setSampleTrim('start', e.target.value) })),
            h('div', { style: css.row }, h('span', { style: css.muted }, 'End'),
              h('input', { type: 'range', min: 0.5, max: duration || 30, step: 0.05, value: selectedTrim?.end || 0.5,
                'aria-label': 'Reference end time', 'data-trim-end': '1', style: { flex: '1 1 160px', accentColor: '#a78bfa' }, onInput: e => this.setSampleTrim('end', e.target.value) }),
              h('input', { type: 'number', min: 0.5, max: duration || 30, step: 0.05, value: selectedTrim?.end || 0.5,
                'aria-label': 'End seconds', style: Object.assign({}, css.input, { width: 78 }), onChange: e => this.setSampleTrim('end', e.target.value) })),
            h('div', { style: css.row },
              h('span', { role: 'status', 'data-trim-duration': '1', style: { color: validSelection ? '#65d66e' : '#f87171', fontSize: 12, fontWeight: 700 } },
                validSelection ? selectedTrim.start.toFixed(2) + '–' + selectedTrim.end.toFixed(2) + 's · ' + selectedDuration.toFixed(2) + 's selected' : 'Select a valid excerpt'),
              btn('Play selected excerpt', () => this.playSampleSelection(), '#a78bfa', { disabled: !validSelection, 'data-trim-preview': '1' }),
              btn('Start at playhead', () => { const a = document.querySelector('[data-pending-sample] audio[data-trim-player]'); if (a) this.setSampleTrim('start', a.currentTime); }, '#94a3b8'),
              btn('End at playhead', () => { const a = document.querySelector('[data-pending-sample] audio[data-trim-player]'); if (a) this.setSampleTrim('end', a.currentTime); }, '#94a3b8')),
            h('div', { style: css.muted }, 'Selection is decoded to a new 24 kHz mono WAV when saved; the uploaded source file remains unchanged. Edit the transcript to match only this selection.')),

          field('Name', h('input', { value: t.sampleName || '', style: css.input, onInput: e => { t.sampleName = e.target.value; } })),
          field('Exact transcript of the clip', h('textarea', { rows: 2, value: t.sampleTranscript || '', placeholder: 'Type exactly what is said', style: Object.assign({}, css.input, { resize: 'vertical' }), onInput: e => { t.sampleTranscript = e.target.value; } })),
          h('div', { style: css.row }, btn('Approve & save selected excerpt', () => this.approveProfileSample(), '#65d66e', { disabled: !validSelection }), btn('Discard', () => { fetch(this.state.backendUrl + '/api/staging/' + pend.id, { method: 'DELETE' }); this.vpSet({ pending: null, trim: null, sampleWaveform: null, sampleError: null }); }, '#94a3b8')),
          h('div', { style: css.muted }, 'Saved samples stay in DexDiffusion’s private backend state. An isolated temporary worker copy is used during each render and cleaned up afterward.')) : upload,
        sampleErrorBlock, this._cloneEvaluationPanel(p)) : null,
      h('div', { 'data-profile-validation': '1', style: { display: 'grid', gap: 4 } }, ...val.map(([id, r]) => h('div', { key: id, style: { fontSize: 12, color: r.ok ? (r.warnings.length ? tone.warn : tone.ok) : tone.bad } },
        (r.ok ? (r.warnings.length ? '⚠ ' : '✓ ') : '✗ ') + (this._engine(id) ? this._engine(id).label : id) + ': ' + (r.ok ? (r.warnings.length ? r.warnings.join('; ') : 'ready to render') : r.errors.join('; '))))),
      ...eng.map(e => this._capMatrix(e.id)));
  };
  P._profileRender = function (p) {
    const vp = this._vp(), t = this._vptext = this._vptext || {};
    // A render belongs to the voice that started it: never show its progress/result/error on another voice.
    const own = !!(vp.render && vp.render.profile_id === p.id), r = own ? vp.render : null;
    const elsewhere = !own && vp.render && !TERMINAL.includes(vp.render.status) ? ((vp.profiles || []).find(x => x.id === vp.render.profile_id) || {}).name || 'another voice' : null;
    const eng = this._engine(p.preferred_engine), canDirect = eng && eng.capabilities.delivery_instructions;
    const base = this.state.backendUrl;
    const running = r && !TERMINAL.includes(r.status);
    const est = () => { const n = String(t.profileText || '').length; return n ? n + ' characters' + (eng && n > eng.capabilities.max_chunk_chars ? ' · ≈ ' + Math.ceil(n / (eng.capabilities.max_chunk_chars * 0.8)) + ' chunks (long-form)' : ' · single chunk') : 'no text yet'; };
    const counter = h('span', { style: css.muted }, est());
    const art = r && r.artifact;
    const pal = avatarPalette(p.type);
    const jumpToSettings = () => {
      const ed = document.querySelector('[data-profile-editor]');
      if (ed && ed.scrollIntoView) ed.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    return h('div', {
      'data-profile-render': p.id,
      className: 'vb-card',
      style: { borderColor: 'rgba(245,158,11,.28)', background: 'linear-gradient(180deg, rgba(9,20,32,.9), rgba(6,10,16,.84))' },
    },
      h('div', { style: Object.assign({}, css.row, { justifyContent: 'space-between', alignItems: 'center' }) },
        h('div', { style: Object.assign({}, css.row, { gap: 10, minWidth: 0 }) },
          h('div', { className: 'vb-avatar', style: { background: pal.bg, color: pal.fg, border: '1px solid ' + pal.bd } }, initials(p.name)),
          h('div', { style: { display: 'grid', gap: 2, minWidth: 0 } },
            h('div', { style: Object.assign({}, css.title, { fontSize: 15 }) }, 'Generate · ' + p.name),
            h('div', { style: css.muted }, 'Speak with this voice · ' + (eng ? eng.label : (p.preferred_engine || 'voice')) + (p.default_direction ? ' · ' + p.default_direction : '')))),
        h('div', { style: css.row },
          chip(p.type, '#a78bfa'),
          chip(p.validation.state, stateTone(p.validation.state)),
          btn('Voice settings', jumpToSettings, '#94a3b8'))),
      field('Text (long-form: no 2,000-character limit — it is split on paragraph / sentence / clause boundaries and stitched)',
        h('textarea', { rows: 6, value: t.profileText || '', placeholder: 'Paste anything from one line to a whole chapter…', style: Object.assign({}, css.input, { resize: 'vertical', lineHeight: 1.5 }), onInput: e => { t.profileText = e.target.value; counter.textContent = est(); } })),
      h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,170px),1fr))', gap: 10 } },
        field('Performance direction' + (canDirect ? '' : ' — not supported by ' + (eng ? eng.label : 'this engine')),
          h('input', { value: canDirect ? (t.profileDirection || '') : '', disabled: !canDirect, placeholder: canDirect ? 'e.g. whispering, frightened' : 'unavailable for this voice type', title: canDirect ? '' : 'This engine ignores delivery directions, so DexDiffusion will not pretend to apply them', style: Object.assign({}, css.input, canDirect ? {} : { opacity: 0.5 }), onInput: e => { t.profileDirection = e.target.value; } })),
        field('Seed', h('input', numText({ min: '0', value: String(vp.seed || ''), placeholder: 'random', style: css.input, onInput: e => { vp.seed = e.target.value; } }))),
        p.type === 'preset' ? field('Speed', h('input', numText({ min: '0.5', max: '2', step: '0.05', value: String(vp.speed || ''), placeholder: String(p.default_speed || 1), style: css.input, onInput: e => { vp.speed = e.target.value; } }))) : null),
      h('div', { style: Object.assign({}, css.row, { justifyContent: 'space-between', alignItems: 'center' }) },
        h('div', { style: { display: 'grid', gap: 2 } },
          counter,
          h('span', { style: css.muted }, this.state.savePrompts ? 'Prompt saving is on: text may be kept with the job record.' : 'Prompt saving is off: text is never stored in job records.')),
        h('button', { type: 'button', 'data-render-speech': '1', 'aria-busy': String(!!running), onClick: () => !running && !elsewhere && this.renderProfileSpeech(), disabled: !!running || !!elsewhere || p.validation.state === 'invalid',
          style: { minHeight: 42, minWidth: 190, borderRadius: 9, border: 0, padding: '0 18px', fontWeight: 800, fontSize: 13.5, cursor: running ? 'progress' : 'pointer', background: running || p.validation.state === 'invalid' ? 'rgba(148,163,184,.2)' : 'linear-gradient(90deg,#ca8a04,#eab308)', color: running || p.validation.state === 'invalid' ? '#94a3b8' : '#080c12', fontFamily: "'DM Sans',sans-serif" } },
          running ? (r.label || 'Rendering…') : elsewhere ? 'Waiting: "' + elsewhere + '" is rendering' : p.validation.state === 'invalid' ? 'Fix the voice first (see validation above)' : 'Render speech')),
      r && r.info && r.info.delivery && r.info.delivery.note ? h('div', { style: { color: tone.warn, fontSize: 12 } }, 'ℹ ' + r.info.delivery.note) : null,
      r && r.info && r.info.warnings && r.info.warnings.length ? h('div', { style: { color: tone.warn, fontSize: 12 } }, '⚠ ' + r.info.warnings.join('; ')) : null,
      running ? h('div', { role: 'status', 'data-render-progress': '1', style: { display: 'grid', gap: 4 } }, h('div', { style: { color: '#fbbf24', fontSize: 12, fontWeight: 700 } }, r.label || 'Working…'),
        h('div', { style: { height: 6, background: 'rgba(255,255,255,.08)', borderRadius: 3, overflow: 'hidden' } }, h('div', { style: { height: '100%', width: (r.progress && r.progress.total && r.progress.chunk ? Math.round((r.progress.chunk - (r.status === 'RUNNING' ? 0.5 : 0)) / r.progress.total * 100) : 5) + '%', background: 'linear-gradient(90deg,#ca8a04,#eab308)', transition: 'width .4s' } })),
        h('div', { style: css.muted }, r.info && r.info.long_form ? 'Long-form: ' + r.info.chunks + ' chunks, one Big Mac job, stitched on the MacBook.' : 'Single chunk.')) : null,
      r && (r.status === 'FAILED' || r.status === 'INTERRUPTED') ? h('div', { role: 'alert', 'data-render-error': '1', style: { color: tone.bad, fontSize: 12, border: '1px solid rgba(248,113,113,.4)', borderRadius: 8, padding: 8, overflowWrap: 'anywhere' } }, '✗ ' + (r.error || r.status) + (r.gate ? ' (gate ' + r.gate + ')' : '')) : null,
      art ? h('div', { 'data-render-result': '1', style: { display: 'grid', gap: 8, padding: 10, borderRadius: 9, border: '1px solid rgba(101,214,110,.3)', background: 'rgba(101,214,110,.06)' } },
        this._mediaEl(base + art.url, 'audio', 'vp-result'),
        h('div', { style: css.muted }, [art.artifact_id, fmtT(art.duration), art.meta && art.meta.long_form ? art.meta.long_form.chunks + ' chunks stitched' : '1 chunk', art.sha256 ? 'sha256 ' + art.sha256.slice(0, 12) + '…' : null].filter(Boolean).join(' · ')),
        art.meta && art.meta.long_form ? h('details', null, h('summary', { style: Object.assign({}, css.muted, { cursor: 'pointer' }) }, '▸ Chunk lineage'), h('div', { style: css.mono }, art.meta.long_form.lineage.map(c => `#${c.index + 1} ${c.chars} chars · ${c.duration}s · ${c.boundary || 'end'} · ${c.sha256.slice(0, 10)}`).join('\n'))) : null,
        h('div', { style: css.row },
          btn('▶ Play in bar', () => this.playInVoiceBar({
            id: art.artifact_id,
            title: p.name + ' · Generated speech',
            subtitle: [eng ? eng.label : (p.preferred_engine || 'voice'), fmtT(art.duration)].filter(Boolean).join(' · '),
            url: base + art.url,
            downloadUrl: base + art.download_url,
            duration: art.duration || 0,
          }, true), '#eab308'),
          h('a', { href: base + art.download_url, download: '', style: { color: '#7dd3fc', fontSize: 12, fontWeight: 700, padding: '8px 4px', textDecoration: 'none' } }, 'Download WAV'))) : null);
  };
  P._buildVoiceHistoryPanel = function () {
    const vp = this._vp(), base = this.state.backendUrl;
    const mws = this._mws ? this._mws() : null;
    const libItems = (mws && mws.lib && Array.isArray(mws.lib.items)) ? mws.lib.items : [];
    const voiceItems = libItems.filter(i => i && i.kind === 'voice');
    const q = String(vp.historySearch || '').trim().toLowerCase();
    const filtered = voiceItems.filter(i => {
      if (vp.historyFilter === 'keepers' && !i.keeper) return false;
      if (!q) return true;
      return [i.artifact_id, i.operation, i.model, i.worker].some(v => String(v || '').toLowerCase().includes(q));
    }).slice(0, 25);
    return h('div', { 'data-vb-history': '1', className: 'vb-card' },
      h('div', { style: Object.assign({}, css.row, { justifyContent: 'space-between', alignItems: 'center' }) },
        h('div', { style: css.row },
          h('div', { style: css.title }, 'Generation history'),
          chip(String(filtered.length) + (voiceItems.length !== filtered.length ? ' / ' + voiceItems.length : '') + ' clips', '#94a3b8')),
        h('div', { style: css.row },
          btn('All', () => this.vpSet({ historyFilter: 'all' }), vp.historyFilter === 'all' ? '#eab308' : '#94a3b8'),
          btn('★ Keepers', () => this.vpSet({ historyFilter: 'keepers' }), vp.historyFilter === 'keepers' ? '#eab308' : '#94a3b8'),
          btn('↻ Refresh', () => this.loadMediaLibrary && this.loadMediaLibrary('voice'), '#94a3b8'))),
      h('input', {
        key: 'vb-history-search',
        'data-vb-history-search': '1',
        value: vp.historySearch || '',
        placeholder: 'Search clips, model, or worker…',
        style: css.input,
        onInput: e => this.vpSet({ historySearch: e.target.value }),
      }),
      filtered.length
        ? h('div', { className: 'vb-history-list' }, ...filtered.map(item => {
          const active = vp.player && vp.player.id === item.artifact_id;
          const isPlaying = !!(active && vp.playerPlaying);
          const track = {
            id: item.artifact_id,
            title: item.artifact_id,
            subtitle: [item.operation || item.model || item.worker || 'voice', fmtT(item.duration), item.seed != null ? 'seed ' + item.seed : null].filter(Boolean).join(' · '),
            url: base + item.url,
            downloadUrl: base + (item.download_url || item.url),
            duration: item.duration || 0,
          };
          return h('div', { key: item.artifact_id, className: 'vb-history-row' },
            h('button', {
              type: 'button',
              'data-vb-play': item.artifact_id,
              'aria-label': (isPlaying ? 'Pause ' : 'Play ') + item.artifact_id,
              className: 'vb-play-circle' + (isPlaying ? ' is-playing' : ''),
              onClick: () => active ? this.toggleVoiceBarPlay() : this.playInVoiceBar(track, true),
            }, isPlaying ? '❚❚' : '▶'),
            h('div', { style: { display: 'grid', gap: 2, minWidth: 0 } },
              h('div', { style: { color: '#e2e8f0', fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, item.artifact_id),
              h('div', { style: css.muted }, [fmtT(item.duration), item.model || item.worker || 'voice', item.operation, item.created_at ? String(item.created_at).slice(0, 16).replace('T', ' ') : null].filter(Boolean).join(' · '))),
            h('div', { style: css.row },
              btn(item.keeper ? '★' : '☆', () => this.toggleMediaKeeper && this.toggleMediaKeeper(item.artifact_id, !item.keeper), item.keeper ? '#eab308' : '#94a3b8', { 'aria-label': item.keeper ? 'Unstar keeper' : 'Mark keeper' }),
              h('a', { href: base + (item.download_url || item.url), download: '', style: { color: '#7dd3fc', fontSize: 12, fontWeight: 700, padding: '6px 8px', textDecoration: 'none' } }, 'WAV')));
        }))
        : h('div', { style: css.muted }, voiceItems.length ? 'No clips match this filter.' : 'No generated voice clips yet. Render speech above and clips will appear here and in the player bar.'));
  };
  P._buildVoicePlayerBar = function () {
    const vp = this._vp(), tr = vp.player;
    if (!tr) return null;
    const a = this._vbAudio;
    const dur = (a && isFinite(a.duration) && a.duration > 0) ? a.duration : Number(tr.duration || 0);
    const cur = a ? (a.currentTime || 0) : 0;
    return h('div', { 'data-vb-player': '1', className: 'vb-player', role: 'region', 'aria-label': 'Audio player bar' },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', minWidth: 0 } },
        h('button', {
          type: 'button',
          'data-vb-player-toggle': '1',
          'aria-label': vp.playerPlaying ? 'Pause' : 'Play',
          className: 'vb-play-circle' + (vp.playerPlaying ? ' is-playing' : ''),
          onClick: () => this.toggleVoiceBarPlay(),
        }, vp.playerPlaying ? '❚❚' : '▶'),
        h('div', { style: { display: 'grid', gap: 2, minWidth: 0, flex: '1 1 160px' } },
          h('div', { style: { color: '#f8fafc', fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, tr.title || tr.id || 'Audio clip'),
          tr.subtitle ? h('div', { style: css.muted }, tr.subtitle) : null),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flex: '2 1 200px', minWidth: 160 } },
          h('input', {
            type: 'range',
            'data-vb-player-seek': '1',
            'aria-label': 'Seek audio position',
            min: 0,
            max: dur || 100,
            step: 0.05,
            value: cur,
            onInput: e => this.seekVoiceBar(e.target.value),
            style: { flex: 1, minWidth: 80, accentColor: '#f59e0b' },
          }),
          h('span', { 'data-vb-player-clock': '1', style: Object.assign({}, css.muted, { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }) }, fmtClock(cur) + ' / ' + fmtClock(dur))),
        h('div', { style: css.row },
          tr.downloadUrl ? h('a', { href: tr.downloadUrl, download: '', style: { color: '#7dd3fc', fontSize: 12, fontWeight: 700, padding: '6px 8px', textDecoration: 'none' } }, 'Download WAV') : null,
          btn('✕', () => this.closeVoiceBar(), '#94a3b8', { 'aria-label': 'Close player bar' }))));
  };
  P._buildCreateVoiceBody = function () {
    const vp = this._vp(), nf = vp.newForm, t = this._vptext = this._vptext || {}, pend = vp.createPending, trim = vp.createTrim;
    const duration = Number(pend && pend.duration);
    const validSel = !!(trim && Number.isFinite(duration) && trim.end - trim.start >= 0.5 && trim.end - trim.start <= 30.001);
    const selDur = validSel ? trim.end - trim.start : 0;
    const engines = (vp.engines || []).filter(e => Array.isArray(e.voice_types) && e.voice_types.includes(nf.type));
    const engineChoice = engines.some(e => e.id === nf.preferred_engine) ? nf.preferred_engine : ((engines[0] && engines[0].id) || (nf.type === 'designed' ? 'qwen3-tts-voice-design' : nf.type === 'preset' ? 'kokoro' : 'qwen3-tts-base'));
    const langs = [['en', 'English'], ['zh', 'Chinese'], ['ja', 'Japanese'], ['ko', 'Korean'], ['de', 'German'], ['fr', 'French'], ['es', 'Spanish'], ['it', 'Italian'], ['pt', 'Portuguese'], ['ru', 'Russian']];
    const switchType = k => {
      nf.type = k;
      const compat = (vp.engines || []).filter(e => Array.isArray(e.voice_types) && e.voice_types.includes(k));
      if (compat.length && !compat.some(e => e.id === nf.preferred_engine)) nf.preferred_engine = compat[0].id;
      else if (!compat.length) nf.preferred_engine = k === 'designed' ? 'qwen3-tts-voice-design' : k === 'preset' ? 'kokoro' : 'qwen3-tts-base';
      this.vpSet({ createSampleError: null, transcribeError: null });
    };
    const createInputId = 'create-voice-sample-input';
    const triggerPick = e => {
      if (e && e.preventDefault) { e.preventDefault(); e.stopPropagation(); }
      const inp = document.getElementById(createInputId) || document.querySelector('[data-create-sample-input="1"]');
      if (inp) inp.click();
    };
    const fileInput = h('input', {
      id: createInputId,
      'data-create-sample-input': '1',
      type: 'file',
      accept: 'audio/*,.wav,.mp3,.m4a,.flac',
      style: { position: 'absolute', opacity: 0, width: 1, height: 1, pointerEvents: 'none' },
      onChange: e => {
        const file = e.target.files && e.target.files[0];
        e.target.value = '';
        if (file) this.stageCreateSample(file);
      },
    });
    const modeTabs = h('div', { style: Object.assign({}, css.row, { gap: 6 }) },
      ...[['cloned', 'Clone from audio'], ['designed', 'Designed voice'], ['preset', 'Built-in voice']].map(([k, l]) =>
        h('button', {
          key: k, type: 'button', 'data-new-type': k,
          onClick: () => switchType(k),
          style: {
            border: '1px solid ' + (nf.type === k ? '#eab308' : 'rgba(148,163,184,.28)'),
            background: nf.type === k ? 'linear-gradient(90deg,#ca8a04,#eab308)' : 'rgba(15,23,42,.7)',
            color: nf.type === k ? '#090d16' : '#cbd5e1',
            borderRadius: 8, padding: '8px 14px', minHeight: 36, fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif",
          },
        }, l)));
    const clonedLeft = h('div', { style: { display: 'grid', gap: 10, minWidth: 0 } },
      pend ? h('div', { 'data-create-sample-card': '1', style: { border: '1px solid rgba(148,163,184,.28)', background: 'rgba(9,14,24,.9)', borderRadius: 10, padding: 14, display: 'grid', gap: 10, textAlign: 'center' } },
        h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, flexWrap: 'wrap' } },
          h('b', { style: { color: '#f8fafc', fontSize: 14 } }, 'File uploaded'),
          chip(fmtT(pend.duration), '#94a3b8')),
        h('div', { style: { color: '#94a3b8', fontSize: 12, overflowWrap: 'anywhere' } }, 'File: ' + (pend.filename || pend.name || 'sample')),
        h('audio', {
          src: this.state.backendUrl + pend.url,
          controls: true,
          preload: 'metadata',
          'data-create-audio-player': '1',
          style: { width: '100%', minHeight: 36 },
          onTimeUpdate: e => { if (this._vp().createTrim && e.currentTarget.currentTime >= this._vp().createTrim.end) e.currentTarget.pause(); },
        }),
        h('div', { style: Object.assign({}, css.row, { justifyContent: 'center', gap: 8 }) },
          btn('▶ Play', () => this.playCreateSampleSelection(), '#cbd5e1', { disabled: !validSel }),
          btn(vp.transcribing ? 'Transcribing…' : 'Transcribe', () => this.transcribeCreateSample(), '#cbd5e1', {
            'data-create-transcribe': '1',
            disabled: !!vp.transcribing,
            title: vp.asrStatus && !vp.asrStatus.available ? vp.asrStatus.reason : 'Transcribe audio locally with whisper.cpp',
          }),
          btn(vp.createTrimOpen ? 'Hide trim' : 'Trim excerpt', () => this.vpSet({ createTrimOpen: !vp.createTrimOpen }), '#a78bfa', { 'data-create-trim-toggle': '1' }),
          btn('Remove', () => this.clearCreatePendingSample(), '#f87171', { 'data-create-remove': '1' })),
        vp.createTrimOpen && Number.isFinite(duration) ? h('div', { style: { textAlign: 'left', display: 'grid', gap: 6, paddingTop: 8, borderTop: '1px solid rgba(148,163,184,.16)' } },
          h('div', { style: css.row }, h('span', { style: css.muted }, 'Start'),
            h('input', { type: 'range', min: 0, max: duration || 30, step: 0.05, value: trim?.start || 0, style: { flex: 1, accentColor: '#eab308' }, onInput: e => this.setCreateTrim('start', e.target.value) }),
            h('input', { type: 'number', min: 0, max: duration || 30, step: 0.05, value: trim?.start || 0, style: Object.assign({}, css.input, { width: 76 }), onChange: e => this.setCreateTrim('start', e.target.value) })),
          h('div', { style: css.row }, h('span', { style: css.muted }, 'End'),
            h('input', { type: 'range', min: 0.5, max: duration || 30, step: 0.05, value: trim?.end || 0.5, style: { flex: 1, accentColor: '#eab308' }, onInput: e => this.setCreateTrim('end', e.target.value) }),
            h('input', { type: 'number', min: 0.5, max: duration || 30, step: 0.05, value: trim?.end || 0.5, style: Object.assign({}, css.input, { width: 76 }), onChange: e => this.setCreateTrim('end', e.target.value) })),
          h('div', { style: { color: validSel ? '#65d66e' : '#f87171', fontSize: 12, fontWeight: 700 } },
            validSel ? `${trim.start.toFixed(2)}–${trim.end.toFixed(2)}s · ${selDur.toFixed(2)}s selected (max 30s)` : 'Select a 0.5–30 second excerpt')) : null)
        : h('label', {
          htmlFor: createInputId,
          'data-create-dropzone': '1',
          style: { border: '1px dashed rgba(234,179,8,.55)', background: 'rgba(15,23,42,.55)', color: '#fde68a', borderRadius: 10, padding: '22px 14px', cursor: 'pointer', display: 'grid', gap: 8, justifyItems: 'center', textAlign: 'center' },
          onDragEnter: e => { e.preventDefault(); e.stopPropagation(); },
          onDragOver: e => { e.preventDefault(); e.stopPropagation(); },
          onDragLeave: e => { e.preventDefault(); e.stopPropagation(); },
          onDrop: e => { e.preventDefault(); e.stopPropagation(); if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) this.stageCreateSample(e.dataTransfer.files[0]); },
        },
          h('b', { style: { fontSize: 13, color: '#f8fafc' } }, 'Drop a voice sample or click to upload'),
          h('span', { style: css.muted }, 'WAV, MP3, M4A, or FLAC · 5–20 s recommended (max 30 s excerpt)'),
          h('button', { type: 'button', 'data-create-upload': '1', onClick: triggerPick, style: { border: '1px solid rgba(234,179,8,.6)', background: 'rgba(234,179,8,.16)', color: '#fde047', borderRadius: 8, padding: '8px 14px', minHeight: 36, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" } }, 'Upload audio'),
          fileInput),
      field('Reference Text', h('textarea', {
        rows: 4,
        'data-create-transcript': '1',
        value: t.createTranscript || '',
        placeholder: 'Exact words spoken in the audio sample…',
        style: Object.assign({}, css.input, { resize: 'vertical' }),
        onInput: e => { t.createTranscript = e.target.value; if (vp.createSampleError) this.vpSet({ createSampleError: null }); },
      })),
      h('div', { style: { fontSize: 11, color: engineChoice === 'qwen3-tts-base' && pend && !String(t.createTranscript || '').trim() ? '#f87171' : '#94a3b8' } },
        engineChoice === 'qwen3-tts-base'
          ? 'Required for Qwen3-TTS Base when adding a sample. Switch Default Engine to VoxCPM2 if you want to skip Reference Text.'
          : 'Optional for VoxCPM2 (useful to keep if you ever switch this voice to Qwen3-TTS Base).'),
      vp.transcribeError ? h('div', { role: 'alert', style: { color: tone.warn, fontSize: 12, border: '1px solid rgba(251,191,36,.4)', borderRadius: 8, padding: 8, background: 'rgba(251,191,36,.08)', overflowWrap: 'anywhere' } }, '⚠ ' + vp.transcribeError) : null,
      vp.createSampleError ? h('div', { role: 'alert', 'data-create-sample-error': '1', style: { color: tone.bad, fontSize: 12, border: '1px solid rgba(248,113,113,.4)', borderRadius: 8, padding: 8, background: 'rgba(239,68,68,.08)', overflowWrap: 'anywhere' } }, '✗ ' + vp.createSampleError) : null);
    const designedLeft = h('div', { style: { display: 'grid', gap: 10, minWidth: 0 } },
      field('Voice Description', h('textarea', {
        rows: 5,
        'data-create-description': '1',
        value: nf.description || '',
        placeholder: 'Describe this voice (age, timbre, accent, texture, e.g. middle-aged, gravelly, British, measured pace)…',
        style: Object.assign({}, css.input, { resize: 'vertical' }),
        onInput: e => { nf.description = e.target.value; },
      })),
      h('div', { style: css.muted }, 'Used directly by Qwen3-TTS VoiceDesign or VoxCPM2 to synthesize this voice from text.'));
    const presetLeft = h('div', { style: { display: 'grid', gap: 10, minWidth: 0 } },
      field('Built-in Kokoro Voice', kokoroChoice(vp.kokoroVoices, nf.preset_voice, v => { nf.preset_voice = v; this.vpSet({}); }, 'Kokoro voice for the new profile')),
      field('Default Speed', h('input', numText({ min: '0.5', max: '2', step: '0.05', value: String(nf.default_speed || 1), style: css.input, onInput: e => { nf.default_speed = e.target.value; } }))),
      h('div', { style: css.muted }, 'Instant deterministic speech using Kokoro 82M.'));
    const rightCol = h('div', { style: { display: 'grid', gap: 10, minWidth: 0 } },
      field('Name', h('input', { value: nf.name || '', placeholder: 'e.g. Tiger or Mid-Century Narrator', 'data-new-name': '1', style: css.input, onInput: e => { nf.name = e.target.value; } })),
      field('Default Delivery / Personality (Optional)', h('input', { value: nf.default_direction || '', placeholder: 'e.g. calm, dry, measured', style: css.input, onInput: e => { nf.default_direction = e.target.value; } })),
      field('Notes (Optional)', h('input', { value: nf.notes || '', placeholder: 'Optional notes about this voice…', style: css.input, onInput: e => { nf.notes = e.target.value; } })),
      field('Language', h('select', { value: nf.language || 'en', disabled: nf.type === 'preset', style: Object.assign({}, css.input, nf.type === 'preset' ? { opacity: 0.6 } : {}), onChange: e => { nf.language = e.target.value; this.vpSet({}); } },
        ...langs.map(([code, label]) => h('option', { key: code, value: code }, label)))),
      field('Default Engine', h('select', { 'data-create-engine': '1', value: engineChoice, style: css.input, onChange: e => { nf.preferred_engine = e.target.value; this.vpSet({ createSampleError: null }); } },
        ...(engines.length ? engines.map(e => h('option', { key: e.id, value: e.id },
          e.id === 'qwen3-tts-base' ? 'Qwen3-TTS Base (voice clone · seeded, needs reference text)' :
          e.id === 'voxcpm2' && nf.type === 'cloned' ? 'VoxCPM2 (controllable clone · acting directions, transcript optional)' :
          e.label)) : [h('option', { key: engineChoice, value: engineChoice }, engineChoice)]))));
    const footer = h('div', { style: Object.assign({}, css.row, { justifyContent: 'flex-end', gap: 8, paddingTop: 10, borderTop: '1px solid rgba(148,163,184,.16)' }) },
      btn('Cancel', () => this.closeCreateVoiceModal(true), '#94a3b8'),
      h('button', {
        type: 'button',
        'data-create-voice': '1',
        disabled: !!vp.createBusy,
        onClick: () => this.createVoiceProfile(),
        style: {
          border: 0,
          background: vp.createBusy ? 'rgba(148,163,184,.25)' : 'linear-gradient(90deg,#ca8a04,#eab308)',
          color: vp.createBusy ? '#94a3b8' : '#090d16',
          borderRadius: 8, padding: '9px 18px', minHeight: 38, fontSize: 13, fontWeight: 800, cursor: vp.createBusy ? 'progress' : 'pointer', fontFamily: "'DM Sans',sans-serif",
        },
      }, vp.createBusy ? 'Creating…' : 'Create Profile'));
    return h('div', { 'data-new-voice': '1', style: { display: 'grid', gap: 14, minWidth: 0 } },
      modeTabs,
      h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,290px),1fr))', gap: 16, alignItems: 'start' } },
        nf.type === 'designed' ? designedLeft : nf.type === 'preset' ? presetLeft : clonedLeft,
        rightCol),
      footer);
  };
  P._buildVoiceModals = function () {
    const vp = this._vp();
    const list = vp.profiles || [];
    const M = window.DexModal;
    const createModal = vp.creating ? (M ? M.frame(h, { id: 'create-voice', title: 'Create Voice', subtitle: 'Create a new voice profile from an audio sample, description, or built-in voice.', size: 'lg', onClose: () => this.closeCreateVoiceModal(true) }, this._buildCreateVoiceBody())
      : h('div', { style: Object.assign({}, css.panel, { borderColor: 'rgba(234,179,8,.45)' }) }, this._buildCreateVoiceBody())) : null;
    const prefs = vp.directorPreferences || {};
    const presetIds = ['neutral', 'formal_dry', 'restrained_irritation', 'contempt'];
    const saveActingStyle = () => {
      const name = window.prompt('Name this reusable acting style', 'Quiet resolve'); if (!name) return;
      const direction = window.prompt('Direction combination', 'quiet, steady, deliberate'); if (direction == null) return;
      const id = 'style-' + Math.random().toString(36).slice(2, 9);
      this.saveDirectorPreferences({ acting_styles: [...(prefs.acting_styles || []), { id, name, direction, speed: null, intensity: prefs.intensity }] });
    };
    const preferencePanel = h('div', { 'data-director-preferences': '1', className: 'vb-card' },
      h('div', { style: css.row }, h('div', { style: css.title }, 'Director preferences · saved on this Mac'), h('div', { style: { flex: 1 } }), btn('Reset', () => this.resetDirectorPreferences(), '#94a3b8')),
      field('Default direction', h('input', { value: prefs.default_direction || '', placeholder: 'Measured, warm, restrained…', style: css.input, onChange: e => this.saveDirectorPreferences({ default_direction: e.target.value }) })),
      h('div', { style: css.row }, ...presetIds.map(id => h('label', { key: id, style: { display: 'flex', gap: 5, alignItems: 'center', color: '#cbd5e1', fontSize: 11 } }, h('input', { type: 'checkbox', checked: (prefs.favorite_presets || []).includes(id), onChange: e => this.saveDirectorPreferences({ favorite_presets: e.target.checked ? [...(prefs.favorite_presets || []), id] : (prefs.favorite_presets || []).filter(x => x !== id) }) }), id.replace(/_/g, ' ')))),
      h('div', { style: css.grid2 }, field('Default speed (engines that support it)', h('input', numText({ min: 0.5, max: 2, step: 0.05, value: String(prefs.speed || 1), style: css.input, onChange: e => this.saveDirectorPreferences({ speed: e.target.value }) }))), field('Intensity preference (direction hint only)', h('input', numText({ min: 0, max: 1, step: 0.05, value: String(prefs.intensity == null ? 0.5 : prefs.intensity), style: css.input, onChange: e => this.saveDirectorPreferences({ intensity: e.target.value }) })))),
      h('div', { style: css.row }, h('b', { style: { fontSize: 11 } }, 'Reusable acting styles'), btn('＋ Save current style', saveActingStyle, '#a78bfa'), ...(prefs.acting_styles || []).map(style => h('span', { key: style.id, style: css.row }, chip(style.name, '#94a3b8'), btn('Use on selected voice', () => { if (vp.selected) this.saveVoiceProfile(vp.selected, { default_direction: style.direction, ...(style.speed ? { default_speed: style.speed } : {}) }); }, '#38bdf8'), btn('×', () => this.saveDirectorPreferences({ acting_styles: prefs.acting_styles.filter(x => x.id !== style.id) }), '#f87171')))),
      h('div', { style: css.muted }, 'Each voice profile keeps its own preferred engine above. Preferences do not approve a voice, authorize a reference, or replace a selected take.'));
    const converter = (vp.converters || []).find(x => x.id === 'openvoice-v2'), converterAvailable = !!(converter && converter.availability && converter.availability.enabled);
    const targets = list.filter(p => p.type === 'cloned' && Array.isArray(p.samples) && p.samples.some(s => !s.validation || s.validation.ok !== false));
    const conversionProject = vp.conversionProject, conversionTarget = targets.find(p => p.id === vp.conversionTargetProfileId);
    const conversionLines = conversionProject ? conversionProject.scenes.flatMap(sc => sc.lines).filter(line => {
      const actor = (conversionProject.actors || []).find(a => a.speaker_key === line.speaker_key);
      return line.kind !== 'direction' && line.render !== false && (line.profile_override || (actor && actor.voice_profile_id)) === vp.conversionTargetProfileId;
    }) : [];
    const conversionPanel = h('div', { 'data-openvoice-conversion': '1', className: 'vb-card' },
      h('div', { style: css.row }, h('div', { style: css.title }, 'Voice conversion · OpenVoice V2'), chip(converterAvailable ? 'CPU READY' : (converter && converter.availability ? converter.availability.state : 'CHECKING'), converterAvailable ? tone.ok : tone.warn)),
      h('div', { style: css.muted }, converterAvailable ? 'Recorded source speech → cloned target voice. OpenVoice default watermark remains enabled. Big Mac copies are job-private and removed after transfer.' : 'Unavailable until the OpenVoice V2 runtime, converter and watermark assets are verified on Big Mac.'),
      field('Source performance (WAV / MP3 / M4A / FLAC)', h('input', { type: 'file', accept: 'audio/*', disabled: !converterAvailable || vp.conversionBusy,
        onChange: e => this.stageConversionSource(e.target.files && e.target.files[0]) })),
      vp.conversionSource ? h('div', { style: css.row }, h('span', { style: css.muted }, 'Staged: ' + vp.conversionSource.name), h('audio', { controls: true, preload: 'none', src: vp.conversionSource.url, style: { maxWidth: 'min(100%,340px)' } }),
        btn('Remove source', async () => { await this._vpApi('/api/staging/' + encodeURIComponent(vp.conversionSource.id), undefined, 'DELETE'); this.vpSet({ conversionSource: null }); }, '#94a3b8')) : null,
      field('Target voice', h('select', { value: vp.conversionTargetProfileId || '', disabled: vp.conversionBusy, style: css.input,
        onChange: e => this.vpSet({ conversionTargetProfileId: e.target.value, conversionArtifact: null, conversionProject: null, conversionLineId: '' }) },
        h('option', { value: '' }, 'Select a cloned voice'), ...targets.map(p => h('option', { key: p.id, value: p.id }, `${p.name} · ${p.samples.length} sample${p.samples.length === 1 ? '' : 's'}`)))),
      h('div', { style: css.row }, btn(vp.conversionBusy ? 'Conversion running…' : 'Convert source performance', () => this.startOpenVoiceConversion(), converterAvailable && vp.conversionSource && conversionTarget ? tone.ok : tone.off,
        { disabled: !converterAvailable || !vp.conversionSource || !conversionTarget || vp.conversionBusy, 'data-openvoice-start': '1' }),
        vp.conversionJob ? chip(`${vp.conversionJob.status}${vp.conversionJob.progress && vp.conversionJob.progress.label ? ' · ' + vp.conversionJob.progress.label : ''}`, vp.conversionJob.status === 'COMPLETE' ? tone.ok : vp.conversionJob.status === 'FAILED' ? tone.bad : tone.warn) : null),
      vp.conversionArtifact ? h('div', { style: Object.assign({}, css.panel, { display: 'grid', gap: 8 }) }, h('b', null, 'Converted result · A/B preview'),
        h('div', { style: css.grid2 }, h('div', null, h('div', { style: css.label }, 'Source'), h('audio', { controls: true, preload: 'none', src: vp.conversionSource && vp.conversionSource.url })),
          h('div', null, h('div', { style: css.label }, 'OpenVoice V2'), h('audio', { controls: true, preload: 'none', src: vp.conversionArtifact.url }))),
        h('div', { style: css.muted }, 'Model output passed local audio validation. Listen before selecting it; voice-identity fidelity is not automatically rated.'),
        field('Drama project', h('select', { value: vp.conversionProjectId || '', style: css.input, onChange: e => this.loadConversionProject(e.target.value) }, h('option', { value: '' }, 'Select a project'), ...(vp.conversionProjects || []).map(p => h('option', { key: p.id, value: p.id }, p.title || p.id)))),
        conversionProject ? field('Dialogue line assigned to this target profile', h('select', { value: vp.conversionLineId || '', style: css.input, onChange: e => this.vpSet({ conversionLineId: e.target.value }) },
          h('option', { value: '' }, 'Select a dialogue line'), ...conversionLines.map(line => h('option', { key: line.id, value: line.id }, `${line.speaker}: ${line.text.slice(0, 100)}`)))) : null,
        btn('Add as a Drama take', () => this.attachConvertedTake(), vp.conversionLineId ? '#38bdf8' : tone.off, { disabled: !vp.conversionLineId, 'data-openvoice-attach': '1' })) : null);
    const panelModal = vp.panelModal || null;
    const closePanel = () => this.vpSet({ panelModal: null });
    const panelFrame = M && panelModal === 'prefs' ? M.frame(h, { id: 'director-preferences', title: 'Director preferences', subtitle: 'Saved on this Mac.', size: 'md', onClose: closePanel }, preferencePanel)
      : M && panelModal === 'conversion' ? M.frame(h, { id: 'voice-conversion', title: 'Voice conversion · OpenVoice V2', size: 'md', onClose: closePanel }, conversionPanel) : null;
    return { M, createModal, panelFrame, preferencePanel, conversionPanel, converterAvailable, targets };
  };

  P.buildVoiceProfilesPanel = function () {
    const vp = this._vp();
    if (!vp.loadedOnce) { vp.loadedOnce = true; setTimeout(() => this.loadVoiceProfiles(), 0); }
    const list = vp.profiles || [];
    const sel = vp.selected && this._profile(vp.selected);
    const q = String(vp.search || '').trim().toLowerCase();
    const tf = vp.typeFilter || 'all';
    const filtered = list.filter(p => {
      if (tf !== 'all' && p.type !== tf) return false;
      if (!q) return true;
      return [p.name, p.type, p.preferred_engine, p.default_direction, p.notes].some(v => String(v || '').toLowerCase().includes(q));
    });
    const rail = h('div', { 'data-vb-voices-rail': '1', className: 'vb-rail' },
      h('div', { style: Object.assign({}, css.row, { justifyContent: 'space-between', alignItems: 'center' }) },
        h('div', { style: css.title }, 'Voices'),
        chip(filtered.length + (filtered.length !== list.length ? ' / ' + list.length : '') + ' saved', '#94a3b8')),
      h('input', {
        key: 'vb-voice-search',
        'data-vb-voice-search': '1',
        value: vp.search || '',
        placeholder: 'Filter voices…',
        style: css.input,
        onInput: e => this.vpSet({ search: e.target.value }),
      }),
      h('div', { style: css.row },
        ...[['all', 'All'], ['cloned', 'Cloned'], ['designed', 'Designed'], ['preset', 'Built-in']].map(([k, l]) =>
          btn(l, () => this.vpSet({ typeFilter: k }), tf === k ? '#eab308' : '#94a3b8', { 'data-vb-type-filter': k }))),
      list.length === 0
        ? h('div', { style: css.muted }, vp.profiles ? 'No voices yet. Create one to reuse across Generate and Drama.' : 'Loading…')
        : filtered.length === 0
          ? h('div', { style: { display: 'grid', gap: 6 } },
            h('div', { style: css.muted }, 'No voices match "' + (vp.search || tf) + '".'),
            btn('Clear filter', () => this.vpSet({ search: '', typeFilter: 'all' }), '#94a3b8'))
          : h('div', { className: 'vb-voice-list' }, ...filtered.map(p => {
            const pal = avatarPalette(p.type);
            const active = vp.selected === p.id;
            return h('button', {
              key: p.id,
              type: 'button',
              'data-profile': p.id,
              className: 'vb-voice-card' + (active ? ' is-active' : ''),
              onClick: () => {
                this.vpSet({ selected: p.id, pending: null });
                this.setActiveAssetSelection && this.setActiveAssetSelection({ kind: 'voice-profile', id: p.id });
                if (p.type === 'cloned') this.loadCloneEvaluations(p.id);
              },
            },
              h('div', { className: 'vb-avatar', style: { background: pal.bg, color: pal.fg, border: '1px solid ' + pal.bd } }, initials(p.name)),
              h('div', { style: { display: 'grid', gap: 4, minWidth: 0 } },
                h('div', { style: { fontSize: 13, fontWeight: 700, color: '#f1f5f9', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, p.name),
                h('div', { style: css.row },
                  chip(p.type, '#a78bfa'),
                  chip(p.validation.state, stateTone(p.validation.state)),
                  p.type === 'cloned' ? chip(p.samples.length + ' sample' + (p.samples.length === 1 ? '' : 's'), '#94a3b8') : null)));
          })));
    const emptyStage = h('div', { className: 'vb-card', style: { gap: 10, padding: 18 } },
      h('div', { style: Object.assign({}, css.title, { fontSize: 15 }) }, 'Select or create a voice'),
      h('div', { style: css.muted }, 'Pick a voice on the left to generate speech, audition clips in the bar, or edit reference samples.'),
      h('div', { style: css.row }, btn('＋ Create Voice', () => this.openCreateVoiceModal(), '#eab308')));
    const stage = h('div', { 'data-vb-stage': '1', className: 'vb-stage' },
      sel ? this._profileRender(sel) : emptyStage,
      this._buildVoiceHistoryPanel(),
      sel ? this._profileEditor(sel) : null);
    return h('div', { 'data-voice-profiles': '1', style: { display: 'grid', gap: 12, minWidth: 0 } },
      h('div', { className: 'vb-shell' }, rail, stage));
  };

  // Voice screen = Voices & Generate (default) | Designer | Quick (one-shot).
  const _buildVoice = P.buildVoiceWorkspace;
  P.buildVoiceWorkspace = function () {
    injectVoiceStudioCss();
    const vp = this._vp();
    if (!vp.loadedOnce) { vp.loadedOnce = true; setTimeout(() => this.loadVoiceProfiles(), 0); }
    const { M, createModal, panelFrame, preferencePanel, conversionPanel, converterAvailable, targets } = this._buildVoiceModals();
    const tabs = h('div', { role: 'tablist', className: 'vb-tabs' },
      ...[['profiles', 'Voices'], ['designer', 'Designer'], ['quick', 'Quick (one-shot)']].map(([k, l]) =>
        btn(l, () => this.vpSet({ tab: k }), vp.tab === k ? '#eab308' : '#94a3b8', { role: 'tab', 'aria-selected': String(vp.tab === k), 'data-voice-tab': k })));
    const actions = h('div', { className: 'vb-actions' },
      h('span', { 'data-open-director-preferences': '1', style: { display: 'inline-flex' } },
        btn('Director prefs', () => this.vpSet({ panelModal: 'prefs' }), '#94a3b8')),
      h('span', { 'data-open-voice-conversion': '1', style: { display: 'inline-flex' } },
        btn('OpenVoice · ' + targets.length, () => this.vpSet({ panelModal: 'conversion' }), converterAvailable ? '#22d3ee' : '#94a3b8')),
      h('button', {
        type: 'button',
        'data-new-voice-button': '1',
        onClick: () => this.openCreateVoiceModal(),
        style: {
          border: 0,
          background: 'linear-gradient(90deg,#ca8a04,#eab308)',
          color: '#090d16',
          borderRadius: 8,
          padding: '0 14px',
          minHeight: 34,
          fontSize: 12.5,
          fontWeight: 800,
          cursor: 'pointer',
          fontFamily: "'DM Sans',sans-serif",
        },
      }, '＋ Create Voice'));
    const headerBar = h('div', { className: 'vb-header' }, tabs, actions);
    const body = vp.tab === 'profiles'
      ? this.buildVoiceProfilesPanel()
      : vp.tab === 'designer' && this.buildVoiceDesigner
        ? this.buildVoiceDesigner()
        : _buildVoice.call(this);
    return h('div', { 'data-voice-studio': '1' },
      headerBar,
      createModal,
      panelFrame,
      !M && vp.tab === 'profiles' ? preferencePanel : null,
      !M && vp.tab === 'profiles' ? conversionPanel : null,
      body,
      this._buildVoicePlayerBar());
  };
  const _mount = P.componentDidMount;
  P.componentDidMount = function () { _mount.call(this); this._vp(); };
})();
