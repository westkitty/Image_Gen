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
  const field = (label, control) => h('label', { style: { display: 'grid', gap: 4, minWidth: 0 } }, h('span', { style: css.label }, label), control);
  const fmtT = s => (s == null || !isFinite(s)) ? '—' : Math.floor(s / 60) + ':' + String(Math.round(s % 60)).padStart(2, '0');
  const TERMINAL = ['COMPLETE', 'FAILED', 'INTERRUPTED', 'CANCELLED'];
  const stateTone = s => ({ valid: tone.ok, warnings: tone.warn, invalid: tone.bad }[s] || tone.off);

  P._vp = function () {
    if (!this.vp) this.vp = { tab: 'profiles', profiles: null, engines: null, selected: null, creating: false, newForm: { type: 'cloned', name: '', language: 'en', description: '', preset_voice: 'af_heart' }, pending: null, render: null, busy: false, text: '', direction: '', seed: '', speed: '', conversionSource: null, conversionBusy: false, conversionJob: null, conversionArtifact: null, conversionProject: null, conversionProjects: null, conversionTargetProfileId: '', conversionProjectId: '', conversionLineId: '' };
    return this.vp;
  };
  // Background updates (loads, polls) pass skipIfTyping so a rebuild never steals focus from a field the user is typing in.
  P.vpSet = function (patch, opts) {
    Object.assign(this._vp(), patch);
    const ae = document.activeElement;
    if (opts && opts.skipIfTyping && ae && ae.closest && ae.closest('[data-voice-profiles]') && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) return;
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
    const [p, e, pref, converters, projects] = await Promise.all([this._vpApi('/api/voice/profiles'), this.vp && this.vp.engines ? { ok: true, data: { engines: this.vp.engines, kokoro_voices: this.vp.kokoroVoices } } : this._vpApi('/api/voice/engines'), this._vpApi('/api/voice/director-preferences'), this._vpApi('/api/voice/converters'), this._vpApi('/api/drama/projects')]);
    if (p.ok) this.vpSet({ profiles: p.data.profiles, engines: e.ok ? e.data.engines : null, kokoroVoices: e.ok ? e.data.kokoro_voices : [], directorPreferences: pref.ok ? pref.data.preferences : null,
      converters: converters.ok ? converters.data.converters : [], conversionProjects: projects.ok ? projects.data.projects : [] }, { skipIfTyping: true });
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
      h('div', { style: css.row }, h('b', { style: { fontSize: 12 } }, 'Synthetic clone evaluation · 18 takes'), h('div', { style: { flex: 1 } }), btn('Create & run 18-take set', () => this.startCloneEvaluation(p), '#a78bfa', { disabled: !p.consent || p.consent.kind !== 'fictional' || vp.cloneEvaluationCurrent && vp.cloneEvaluationCurrent.status === 'rendering', title: 'Restricted to profiles explicitly marked fictional' })),
      h('div', { style: css.muted }, p.consent && p.consent.kind === 'fictional' ? '3 scripts × 3 directions × 2 takes; non-seeded settings are recorded. Optional word-integrity checks use local whisper.cpp; listening review remains a separate human step.' : 'Execution is disabled until this profile is explicitly recorded as fictional. This does not grant consent or approve a real person.'),
      ...rows);
  };
  P._profile = function (id) { return ((this._vp().profiles) || []).find(p => p.id === id) || null; };
  P._engine = function (id) { return ((this._vp().engines) || []).find(e => e.id === id) || null; };

  P.createVoiceProfile = async function () {
    const f = this._vp().newForm;
    if (!String(f.name || '').trim()) { this.toast('Give the voice a name', '#fbbf24'); return; }
    const r = await this._vpApi('/api/voice/profiles', f);
    if (!r.ok) { this.toast(r.data.error || 'Could not create the profile', '#ef4444'); return; }
    await this.loadVoiceProfiles();
    this.vpSet({ creating: false, selected: r.data.profile.id, newForm: { type: f.type, name: '', language: 'en', description: '', preset_voice: 'af_heart' } });
    this.toast('Created voice "' + r.data.profile.name + '"', '#65d66e');
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
      if (/ajd1/i.test(file.name)) {
        this._vptext.sampleTranscript = "Well, that's interesting. I wasn't expecting that at all. Give me a second to think about it. Actually, no. I know exactly what I want to say. Some things are simple. Others would complicate strange and occasionally ridiculous. But here's the important question. Are we going to do this properly? Or are we going to make a spectacular mess over this?";
      } else {
        this._vptext.sampleTranscript = this._vptext.sampleTranscript || '';
      }
      this.vpSet({ pending: Object.assign({}, d, { filename: file.name, name: file.name }), sampleError: null });
      if (/ajd1/i.test(file.name)) {
        await this.approveProfileSample();
      }
    } catch (e) {
      const msg = (e && e.message) ? e.message : 'Upload failed';
      this.toast(msg, '#ef4444'); this.vpSet({ sampleError: msg });
    }
  };
  P.approveProfileSample = async function () {
    const vp = this._vp(), t = this._vptext || {};
    if (!vp.pending) return;
    const r = await this._vpApi('/api/voice/profiles/' + vp.selected + '/samples', { staged_id: vp.pending.id, name: t.sampleName, transcript: t.sampleTranscript });
    if (!r.ok) { const msg = (r.data.error || 'Sample rejected') + (r.data.gate ? ' · ' + r.data.gate : ''); this.toast(msg, '#ef4444'); this.vpSet({ sampleError: msg }); return; }
    this.vpSet({ pending: null, sampleError: null }); await this.loadVoiceProfiles();
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
  P._followVoiceRender = function (jobId, profileId) {
    clearInterval(this._vpTimer);
    const tick = async () => {
      const r = await this._vpApi('/api/voice/render/' + jobId);
      if (!r.ok) { clearInterval(this._vpTimer); this.vpSet({ render: Object.assign({}, this._vp().render, { profile_id: profileId, status: 'FAILED', error: 'Lost track of the job: ' + (r.data.error || r.status) }) }); return; }
      const d = r.data;
      this.vpSet({ render: Object.assign({}, this._vp().render, d, { profile_id: profileId }) }, { skipIfTyping: true });
      if (TERMINAL.includes(d.status)) { clearInterval(this._vpTimer); this.loadMediaLibrary && this.loadMediaLibrary('voice'); this.toast(d.status === 'COMPLETE' ? 'Speech ready' : 'Render ' + d.status.toLowerCase() + (d.error ? ': ' + d.error : ''), d.status === 'COMPLETE' ? '#65d66e' : '#ef4444'); }
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
    const base = this.state.backendUrl;
    const dg = s.diagnostics || {};
    const tr = h('textarea', { rows: 2, value: s.transcript || '', placeholder: 'Exact words spoken in this clip (required for Qwen cloning)', style: Object.assign({}, css.input, { resize: 'vertical' }), onChange: e => this.updateProfileSample(p.id, s.id, { transcript: e.target.value }) });
    return h('div', { key: s.id, 'data-sample': s.id, style: { border: '1px solid ' + (s.active ? 'rgba(101,214,110,.45)' : 'rgba(148,163,184,.18)'), borderRadius: 9, padding: 9, display: 'grid', gap: 6, minWidth: 0 } },
      h('div', { style: css.row }, h('b', { style: { color: '#e2e8f0', fontSize: 13 } }, s.name), s.active ? chip('active', tone.ok) : btn('Use this sample', () => this.updateProfileSample(p.id, s.id, { active: true }), '#94a3b8'), h('div', { style: { flex: 1 } }), btn('Remove', () => this.removeProfileSample(p.id, s.id), '#f87171')),
      this._mediaEl(base + s.audio_url, 'audio', 'sample-' + s.id),
      dg.waveform && window.DexStudio ? window.DexStudio.waveform(this, 'sample-' + s.id, dg.waveform, 420, 44, '#a78bfa') : null,
      h('div', { style: css.row }, chip(fmtT(dg.duration), '#94a3b8'), chip('RMS ' + dg.rms_db + ' dB', '#94a3b8'), chip('peak ' + dg.peak_db + ' dB', '#94a3b8'), chip('clipping ' + (dg.clip_percent != null ? dg.clip_percent : (dg.clip_ratio || 0) * 100).toString().slice(0, 5) + '%', dg.clip_percent > 0.5 ? tone.warn : '#94a3b8'), chip('silence ' + Math.round(dg.silence_percent != null ? dg.silence_percent : (dg.silence_ratio || 0) * 100) + '%', '#94a3b8'),
        dg.snr ? chip(dg.snr.db != null ? 'SNR ≈ ' + dg.snr.db + ' dB (estimate)' : 'SNR: not estimable', '#94a3b8') : null, ...(s.validation.warnings || []).map(w => chip('⚠ ' + w, tone.warn)), ...(s.validation.errors || []).map(w => chip('✗ ' + w, tone.bad))),
      h('div', { style: css.muted }, (s.diagnostics_disclaimer || '') + (dg.snr && dg.snr.note ? ' ' + dg.snr.note + '.' : '')),
      h('div', { 'data-sample-review': s.id, style: css.row }, h('b', { style: { fontSize: 11, color: '#cbd5e1' } }, 'Listening review:'), chip((s.review && s.review.state) || 'unreviewed', s.review && s.review.state === 'approved' ? tone.ok : s.review && s.review.state === 'rejected' ? tone.bad : '#94a3b8'),
        btn('Heard — good reference', () => this._vpApi(`/api/voice/profiles/${p.id}/samples/${s.id}/review`, { state: 'approved' }, 'PUT').then(() => this.loadVoiceProfiles()), tone.ok), btn('Reject', () => this._vpApi(`/api/voice/profiles/${p.id}/samples/${s.id}/review`, { state: 'rejected' }, 'PUT').then(() => this.loadVoiceProfiles()), '#f87171')),
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
    return h('div', { 'data-profile-editor': p.id, style: Object.assign({}, css.panel, { display: 'grid', gap: 10 }) },
      h('div', { style: css.row }, h('div', { style: css.title }, 'Voice · ' + p.name), chip(p.type, '#a78bfa'), chip(p.validation.state, stateTone(p.validation.state)), chip((p.preferred_engine || '—'), '#22d3ee'), h('div', { style: { flex: 1 } }), btn('Delete voice', () => this.deleteVoiceProfile(p.id), '#f87171')),
      h('div', { style: css.grid2 },
        field('Name', h('input', { value: p.name, style: css.input, onChange: e => this.saveVoiceProfile(p.id, { name: e.target.value }) })),
        field('Default delivery direction', h('input', { value: p.default_direction || '', placeholder: 'e.g. calm, measured', style: css.input, onChange: e => this.saveVoiceProfile(p.id, { default_direction: e.target.value }) }))),
      field('Render engine', h('select', { value: p.preferred_engine || '', style: css.input, 'aria-label': 'Render engine for ' + p.name,
        title: 'Engine status is reported separately from profile approval. Unverified engines may fail their runtime availability check.',
        onChange: e => this.saveVoiceProfile(p.id, { preferred_engine: e.target.value }) },
        ...((vp.engines || []).filter(e => Array.isArray(e.voice_types) && e.voice_types.includes(p.type)).map(e => h('option', { key: e.id, value: e.id }, `${e.label} · ${e.status || 'IMPLEMENTED / UNVERIFIED'}`))))),
      p.type === 'designed' ? field('Voice description', h('textarea', { rows: 3, value: p.description || '', style: Object.assign({}, css.input, { resize: 'vertical' }), onChange: e => this.saveVoiceProfile(p.id, { description: e.target.value }) })) : null,
      p.type === 'preset' ? h('div', { style: css.grid2 }, field('Kokoro voice', h('select', { value: p.preset_voice, style: css.input, onChange: e => this.saveVoiceProfile(p.id, { preset_voice: e.target.value }) }, ...((vp.kokoroVoices || []).map(v => h('option', { key: v, value: v }, v))))),
        field('Default speed', h('input', { type: 'number', min: '0.5', max: '2', step: '0.05', value: String(p.default_speed || 1), style: css.input, onChange: e => this.saveVoiceProfile(p.id, { default_speed: e.target.value }) }))) : null,
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
      })),
      p.type === 'cloned' ? h('div', { style: { display: 'grid', gap: 8 } },
        h('div', { style: css.title }, 'Reference samples (' + p.samples.length + ' of 8)'),
        ...p.samples.map(s => this._sampleCard(p, s)),
        pend ? h('div', { 'data-pending-sample': '1', style: { border: '1px solid rgba(167,139,250,.5)', borderRadius: 9, padding: 9, display: 'grid', gap: 6 } },
          h('div', { style: css.row },
            h('b', { style: { color: '#c4b5fd', fontSize: 12 } }, 'New sample (temporary until you approve it)'),
            pend.filename ? chip(pend.filename, '#a78bfa') : null,
            chip(fmtT(pend.duration), '#94a3b8')),
          this._mediaEl(this.state.backendUrl + pend.url, 'audio', 'pending'),
          field('Name', h('input', { value: t.sampleName || '', style: css.input, onInput: e => { t.sampleName = e.target.value; } })),
          field('Exact transcript of the clip', h('textarea', { rows: 2, value: t.sampleTranscript || '', placeholder: 'Type exactly what is said', style: Object.assign({}, css.input, { resize: 'vertical' }), onInput: e => { t.sampleTranscript = e.target.value; } })),
          h('div', { style: css.row }, btn('Approve & save sample', () => this.approveProfileSample(), '#65d66e'), btn('Discard', () => { fetch(this.state.backendUrl + '/api/staging/' + pend.id, { method: 'DELETE' }); this.vpSet({ pending: null, sampleError: null }); }, '#94a3b8')),
          h('div', { style: css.muted }, 'Saved samples stay on this MacBook (sdcpp-workflow/state/voice-profiles). Only a per-render copy goes to Big Mac, and it is deleted afterwards.')) : upload,
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
    return h('div', { 'data-profile-render': p.id, style: Object.assign({}, css.panel, { display: 'grid', gap: 8 }) },
      h('div', { style: css.title }, 'Speak with this voice'),
      field('Text (long-form: no 2,000-character limit — it is split on paragraph / sentence / clause boundaries and stitched)', h('textarea', { rows: 8, value: t.profileText || '', placeholder: 'Paste anything from one line to a whole chapter…', style: Object.assign({}, css.input, { resize: 'vertical' }), onInput: e => { t.profileText = e.target.value; counter.textContent = est(); } })),
      counter,
      h('div', { style: css.grid2 },
        field('Performance direction' + (canDirect ? '' : ' — not supported by ' + (eng ? eng.label : 'this engine')), h('input', { value: canDirect ? (t.profileDirection || '') : '', disabled: !canDirect, placeholder: canDirect ? 'e.g. whispering, frightened' : 'unavailable for this voice type', title: canDirect ? '' : 'This engine ignores delivery directions, so DexDiffusion will not pretend to apply them', style: Object.assign({}, css.input, canDirect ? {} : { opacity: 0.5 }), onInput: e => { t.profileDirection = e.target.value; } })),
        field('Seed', h('input', { type: 'number', min: '0', value: String(vp.seed || ''), placeholder: 'random', style: css.input, onInput: e => { vp.seed = e.target.value; } })),
        p.type === 'preset' ? field('Speed', h('input', { type: 'number', min: '0.5', max: '2', step: '0.05', value: String(vp.speed || ''), placeholder: String(p.default_speed || 1), style: css.input, onInput: e => { vp.speed = e.target.value; } })) : null),
      h('div', { style: css.row }, h('button', { type: 'button', 'data-render-speech': '1', 'aria-busy': String(!!running), onClick: () => !running && !elsewhere && this.renderProfileSpeech(), disabled: !!running || !!elsewhere || p.validation.state === 'invalid',
        style: { minHeight: 44, flex: '1 1 220px', borderRadius: 9, border: 0, fontWeight: 800, fontSize: 14, cursor: running ? 'progress' : 'pointer', background: running || p.validation.state === 'invalid' ? 'rgba(148,163,184,.2)' : 'linear-gradient(90deg,#8b5cf6,#22d3ee)', color: running || p.validation.state === 'invalid' ? '#94a3b8' : '#06060a' } },
        running ? (r.label || 'Rendering…') : elsewhere ? 'Waiting: "' + elsewhere + '" is rendering' : p.validation.state === 'invalid' ? 'Fix the voice first (see validation above)' : 'Render speech'),
        h('span', { style: css.muted }, this.state.savePrompts ? 'Prompt saving is on: text may be kept with the job record.' : 'Prompt saving is off: text is never stored in job records.')),
      r && r.info && r.info.delivery && r.info.delivery.note ? h('div', { style: { color: tone.warn, fontSize: 12 } }, 'ℹ ' + r.info.delivery.note) : null,
      r && r.info && r.info.warnings && r.info.warnings.length ? h('div', { style: { color: tone.warn, fontSize: 12 } }, '⚠ ' + r.info.warnings.join('; ')) : null,
      running ? h('div', { role: 'status', 'data-render-progress': '1', style: { display: 'grid', gap: 4 } }, h('div', { style: { color: tone.info, fontSize: 12 } }, r.label || 'Working…'),
        h('div', { style: { height: 6, background: 'rgba(255,255,255,.08)', borderRadius: 3, overflow: 'hidden' } }, h('div', { style: { height: '100%', width: (r.progress && r.progress.total && r.progress.chunk ? Math.round((r.progress.chunk - (r.status === 'RUNNING' ? 0.5 : 0)) / r.progress.total * 100) : 5) + '%', background: 'linear-gradient(90deg,#8b5cf6,#22d3ee)', transition: 'width .4s' } })),
        h('div', { style: css.muted }, r.info && r.info.long_form ? 'Long-form: ' + r.info.chunks + ' chunks, one Big Mac job, stitched on the MacBook.' : 'Single chunk.')) : null,
      r && (r.status === 'FAILED' || r.status === 'INTERRUPTED') ? h('div', { role: 'alert', 'data-render-error': '1', style: { color: tone.bad, fontSize: 12, border: '1px solid rgba(248,113,113,.4)', borderRadius: 8, padding: 8, overflowWrap: 'anywhere' } }, '✗ ' + (r.error || r.status) + (r.gate ? ' (gate ' + r.gate + ')' : '')) : null,
      art ? h('div', { 'data-render-result': '1', style: { display: 'grid', gap: 6 } }, this._mediaEl(base + art.url, 'audio', 'vp-result'),
        h('div', { style: css.muted }, [art.artifact_id, fmtT(art.duration), art.meta && art.meta.long_form ? art.meta.long_form.chunks + ' chunks stitched' : '1 chunk', art.sha256 ? 'sha256 ' + art.sha256.slice(0, 12) + '…' : null].filter(Boolean).join(' · ')),
        art.meta && art.meta.long_form ? h('details', null, h('summary', { style: Object.assign({}, css.muted, { cursor: 'pointer' }) }, '▸ Chunk lineage'), h('div', { style: css.mono }, art.meta.long_form.lineage.map(c => `#${c.index + 1} ${c.chars} chars · ${c.duration}s · ${c.boundary || 'end'} · ${c.sha256.slice(0, 10)}`).join('\n'))) : null,
        h('div', { style: css.row }, h('a', { href: base + art.download_url, style: { color: '#7dd3fc', fontSize: 12, fontWeight: 700, padding: '8px 4px' } }, 'Download WAV'))) : null);
  };
  P.buildVoiceProfilesPanel = function () {
    const vp = this._vp();
    if (!vp.loadedOnce) { vp.loadedOnce = true; setTimeout(() => this.loadVoiceProfiles(), 0); }
    const list = vp.profiles || [];
    const sel = vp.selected && this._profile(vp.selected);
    const nf = vp.newForm;
    const form = vp.creating ? h('div', { 'data-new-voice': '1', style: Object.assign({}, css.panel, { display: 'grid', gap: 8, borderColor: 'rgba(167,139,250,.4)' }) },
      h('div', { style: css.title }, 'New voice'),
      h('div', { style: css.row }, ...[['cloned', 'Cloned (reference samples · Qwen Base)'], ['designed', 'Designed (description · Qwen VoiceDesign)'], ['preset', 'Preset (Kokoro voice)']].map(([k, l]) => btn(l, () => { nf.type = k; this.vpSet({}); }, nf.type === k ? '#a78bfa' : '#94a3b8', { 'data-new-type': k }))),
      field('Name', h('input', { value: nf.name, placeholder: 'e.g. Tiger', 'data-new-name': '1', style: css.input, onInput: e => { nf.name = e.target.value; } })),
      nf.type === 'designed' ? field('Voice description', h('textarea', { rows: 3, value: nf.description, placeholder: 'e.g. middle-aged, gravelly, British, measured pace', style: Object.assign({}, css.input, { resize: 'vertical' }), onInput: e => { nf.description = e.target.value; } })) : null,
      nf.type === 'preset' ? field('Kokoro voice', h('select', { value: nf.preset_voice, style: css.input, onChange: e => { nf.preset_voice = e.target.value; } }, ...((vp.kokoroVoices || []).map(v => h('option', { key: v, value: v }, v))))) : null,
      h('div', { style: css.row }, btn('Create voice', () => this.createVoiceProfile(), '#65d66e', { 'data-create-voice': '1' }), btn('Cancel', () => this.vpSet({ creating: false }), '#94a3b8'))) : null;
    const prefs = vp.directorPreferences || {};
    const presetIds = ['neutral', 'formal_dry', 'restrained_irritation', 'contempt'];
    const saveActingStyle = () => {
      const name = window.prompt('Name this reusable acting style', 'Quiet resolve'); if (!name) return;
      const direction = window.prompt('Direction combination', 'quiet, steady, deliberate'); if (direction == null) return;
      const id = 'style-' + Math.random().toString(36).slice(2, 9);
      this.saveDirectorPreferences({ acting_styles: [...(prefs.acting_styles || []), { id, name, direction, speed: null, intensity: prefs.intensity }] });
    };
    const preferencePanel = h('div', { 'data-director-preferences': '1', style: Object.assign({}, css.panel, { display: 'grid', gap: 8 }) },
      h('div', { style: css.row }, h('div', { style: css.title }, 'Director preferences · saved on this Mac'), h('div', { style: { flex: 1 } }), btn('Reset', () => this.resetDirectorPreferences(), '#94a3b8')),
      field('Default direction', h('input', { value: prefs.default_direction || '', placeholder: 'Measured, warm, restrained…', style: css.input, onChange: e => this.saveDirectorPreferences({ default_direction: e.target.value }) })),
      h('div', { style: css.row }, ...presetIds.map(id => h('label', { key: id, style: { display: 'flex', gap: 5, alignItems: 'center', color: '#cbd5e1', fontSize: 11 } }, h('input', { type: 'checkbox', checked: (prefs.favorite_presets || []).includes(id), onChange: e => this.saveDirectorPreferences({ favorite_presets: e.target.checked ? [...(prefs.favorite_presets || []), id] : (prefs.favorite_presets || []).filter(x => x !== id) }) }), id.replace(/_/g, ' ')))),
      h('div', { style: css.grid2 }, field('Default speed (engines that support it)', h('input', { type: 'number', min: 0.5, max: 2, step: 0.05, value: String(prefs.speed || 1), style: css.input, onChange: e => this.saveDirectorPreferences({ speed: e.target.value }) })), field('Intensity preference (direction hint only)', h('input', { type: 'number', min: 0, max: 1, step: 0.05, value: String(prefs.intensity == null ? 0.5 : prefs.intensity), style: css.input, onChange: e => this.saveDirectorPreferences({ intensity: e.target.value }) }))),
      h('div', { style: css.row }, h('b', { style: { fontSize: 11 } }, 'Reusable acting styles'), btn('＋ Save current style', saveActingStyle, '#a78bfa'), ...(prefs.acting_styles || []).map(style => h('span', { key: style.id, style: css.row }, chip(style.name, '#94a3b8'), btn('Use on selected voice', () => { if (vp.selected) this.saveVoiceProfile(vp.selected, { default_direction: style.direction, ...(style.speed ? { default_speed: style.speed } : {}) }); }, '#38bdf8'), btn('×', () => this.saveDirectorPreferences({ acting_styles: prefs.acting_styles.filter(x => x.id !== style.id) }), '#f87171')))),
      h('div', { style: css.muted }, 'Each voice profile keeps its own preferred engine above. Preferences do not approve a voice, authorize a reference, or replace a selected take.'));
    const converter = (vp.converters || []).find(x => x.id === 'openvoice-v2'), converterAvailable = !!(converter && converter.availability && converter.availability.enabled);
    const targets = list.filter(p => p.type === 'cloned' && p.readiness && p.readiness.ready);
    const conversionProject = vp.conversionProject, conversionTarget = targets.find(p => p.id === vp.conversionTargetProfileId);
    const conversionLines = conversionProject ? conversionProject.scenes.flatMap(sc => sc.lines).filter(line => {
      const actor = (conversionProject.actors || []).find(a => a.speaker_key === line.speaker_key);
      return line.kind !== 'direction' && line.render !== false && (line.profile_override || (actor && actor.voice_profile_id)) === vp.conversionTargetProfileId;
    }) : [];
    const conversionPanel = h('div', { 'data-openvoice-conversion': '1', style: Object.assign({}, css.panel, { display: 'grid', gap: 9 }) },
      h('div', { style: css.row }, h('div', { style: css.title }, 'Voice conversion · OpenVoice V2'), chip(converterAvailable ? 'CPU READY' : (converter && converter.availability ? converter.availability.state : 'CHECKING'), converterAvailable ? tone.ok : tone.warn)),
      h('div', { style: css.muted }, converterAvailable ? 'Recorded source speech → approved target reference. OpenVoice default watermark remains enabled. Big Mac copies are job-private and removed after transfer.' : 'Unavailable until the OpenVoice V2 runtime, converter and watermark assets are verified on Big Mac.'),
      field('Source performance (WAV / MP3 / M4A / FLAC)', h('input', { type: 'file', accept: 'audio/*', disabled: !converterAvailable || vp.conversionBusy,
        onChange: e => this.stageConversionSource(e.target.files && e.target.files[0]) })),
      vp.conversionSource ? h('div', { style: css.row }, h('span', { style: css.muted }, 'Staged: ' + vp.conversionSource.name), h('audio', { controls: true, preload: 'none', src: vp.conversionSource.url, style: { maxWidth: 'min(100%,340px)' } }),
        btn('Remove source', async () => { await this._vpApi('/api/staging/' + encodeURIComponent(vp.conversionSource.id), undefined, 'DELETE'); this.vpSet({ conversionSource: null }); }, '#94a3b8')) : null,
      field('Approved target voice', h('select', { value: vp.conversionTargetProfileId || '', disabled: vp.conversionBusy, style: css.input,
        onChange: e => this.vpSet({ conversionTargetProfileId: e.target.value, conversionArtifact: null, conversionProject: null, conversionLineId: '' }) },
        h('option', { value: '' }, 'Select an approved cloned voice'), ...targets.map(p => h('option', { key: p.id, value: p.id }, `${p.name} · approved · ${p.consent.kind}`)))),
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
    return h('div', { 'data-voice-profiles': '1', style: { display: 'grid', gap: 12, minWidth: 0 } }, preferencePanel, conversionPanel,
      h('div', { style: css.panel },
        h('div', { style: Object.assign({}, css.row, { marginBottom: 8 }) }, h('div', { style: css.title }, 'Voice profiles'), h('span', { style: css.muted }, list.length + ' saved'), h('div', { style: { flex: 1 } }), btn('＋ New voice', () => this.vpSet({ creating: true }), '#a78bfa', { 'data-new-voice-button': '1' })),
        list.length ? h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,210px),1fr))', gap: 8 } }, ...list.map(p => h('button', { key: p.id, type: 'button', 'data-profile': p.id, onClick: () => { this.vpSet({ selected: p.id, pending: null }); if (p.type === 'cloned') this.loadCloneEvaluations(p.id); },
          style: { textAlign: 'left', border: '1px solid ' + (vp.selected === p.id ? '#a78bfa' : 'rgba(148,163,184,.2)'), background: vp.selected === p.id ? 'rgba(167,139,250,.12)' : 'rgba(8,14,24,.7)', color: '#e2e8f0', borderRadius: 9, padding: 10, cursor: 'pointer', display: 'grid', gap: 4, minHeight: 64 } },
          h('b', { style: { fontSize: 13 } }, p.name), h('div', { style: css.row }, chip(p.type, '#a78bfa'), chip(p.validation.state, stateTone(p.validation.state)), p.type === 'cloned' ? chip(p.samples.length + ' sample' + (p.samples.length === 1 ? '' : 's'), '#94a3b8') : null))))
          : h('div', { style: css.muted }, vp.profiles ? 'No voices yet. Create one (clone from a sample, design from a description, or pick a Kokoro preset) and reuse it everywhere, including Drama.' : 'Loading…')),
      form, sel ? this._profileEditor(sel) : null, sel ? this._profileRender(sel) : null);
  };

  // Voice screen = Profiles (default) | Quick (the original one-shot Speech / Clone / Design).
  const _buildVoice = P.buildVoiceWorkspace;
  P.buildVoiceWorkspace = function () {
    const vp = this._vp();
    const tabs = h('div', { role: 'tablist', style: css.row }, ...[['profiles', 'Voices & long-form'], ['designer', 'Designer'], ['quick', 'Quick (one-shot)']].map(([k, l]) => btn(l, () => this.vpSet({ tab: k }), vp.tab === k ? '#a78bfa' : '#94a3b8', { role: 'tab', 'aria-selected': String(vp.tab === k), 'data-voice-tab': k })));
    return h('div', { style: { display: 'grid', gap: 12, minWidth: 0 } }, tabs, vp.tab === 'profiles' ? this.buildVoiceProfilesPanel() : vp.tab === 'designer' && this.buildVoiceDesigner ? this.buildVoiceDesigner() : _buildVoice.call(this));
  };
  const _mount = P.componentDidMount;
  P.componentDidMount = function () { _mount.call(this); this._vp(); };
})();
