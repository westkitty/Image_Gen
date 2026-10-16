// Voice Designer — DESCRIBE → AUDITION → COMPARE → APPROVE → LOCK → REUSE, entirely local (Qwen3-TTS VoiceDesign on Big Mac).
//
// Enduring voice identity is separate from scene acting direction. Auditions are seeded and traceable, nothing is auto-approved,
// the clone transcript is verified against the exact audition text, and controls the installed engines cannot honour are
// disabled with the recorded evidence instead of pretending.
(function () {
  'use strict';
  const C = window.DexDiffusionComponent;
  if (!C || !window.DexUI || !window.DexStudio) return;
  const P = C.prototype;
  const U = window.DexStudio;
  const { h, field, fmtT } = U;
  const { css, tone, btn, chip } = window.DexUI;
  const IDENT = [['age', 'Perceived age', 'e.g. middle-aged'], ['gender_presentation', 'Gender presentation', 'e.g. masculine, androgynous'], ['accent', 'Accent', 'e.g. Scottish, Southern US'], ['linguistic_style', 'Linguistic style', 'e.g. clipped, formal, drawling'],
    ['register', 'Vocal register', 'e.g. low baritone'], ['timbre', 'Timbre', 'e.g. gravelly, smooth'], ['resonance', 'Resonance', 'e.g. chest, nasal'], ['texture', 'Texture', 'e.g. rough, silky'], ['breathiness', 'Breathiness', 'e.g. slight'],
    ['personality', 'Personality & speaking character', 'e.g. calm, dry, unhurried'], ['language', 'Language', 'en']];
  const PERF = [['pacing', 'Default pacing', 'measured'], ['energy', 'Default energy', 'low'], ['default_direction', 'Default delivery direction', 'e.g. calm']];

  P._vd = function () {
    if (!this.vd) this.vd = { sel: null, draft: null, rounds: {}, text: 'I told you this would end badly, and you smiled at me like it was a joke.', lines: '', mode: 'single', count: 3, keepText: false, direction: '', cmp: { a: null, b: null }, trialLines: '', trial: null, preview: null, bank: { ids: {}, audio: false, transcripts: false, report: null }, promote: { transcript: '', name: '' }, busy: false, caps: null };
    return this.vd;
  };
  P.vdSet = function (patch, opts) { Object.assign(this._vd(), patch); const ae = document.activeElement; if (opts && opts.skipIfTyping && ae && ae.closest && ae.closest('[data-voice-designer]') && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) return; this.vpSet({}); };
  const api = (self, r, b, m) => self._vpApi(r, b, m);

  P.vdLoad = async function () {
    const vd = this._vd();
    if (!vd.caps) { const r = await api(this, '/api/voice/designer/capabilities'); if (r.ok) vd.caps = r.data; }
    await this.loadVoiceProfiles(); this.vpSet({});
  };
  P.vdSelect = async function (id) {
    const vd = this._vd(); vd.sel = id; vd.draft = null; vd.promote = { transcript: '', name: '' }; vd.trial = null; vd.cmp = { a: null, b: null };
    const r = await api(this, `/api/voice/profiles/${id}/auditions`); if (r.ok) { vd.rounds[id] = r.data.rounds; r.data.rounds.filter(x => x.status === 'rendering').forEach(x => this.vdFollowRound(id, x.id)); }
    this.vpSet({});
  };
  P.vdCreate = async function (name, design) {
    if (!String(name || '').trim()) { this.toast('Give the character voice a name', '#fbbf24'); return; }
    const r = await api(this, '/api/voice/profiles', { name, type: 'designed', design: design || { identity: {} } });
    if (!r.ok) { this.toast(r.data.error || 'Could not create', '#ef4444'); return; }
    await this.loadVoiceProfiles(); await this.vdSelect(r.data.profile.id); this.toast('Created — describe the voice, then audition it', '#65d66e');
  };
  P.vdSaveDesign = async function (p) {
    const vd = this._vd(); const r = await api(this, '/api/voice/profiles/' + p.id, { design: vd.draft }, 'PUT');
    if (!r.ok) { this.toast((r.data.error || 'Save failed') + (r.data.gate ? ' · ' + r.data.gate : ''), '#ef4444'); return; }
    vd.draft = null; await this.loadVoiceProfiles(); this.toast('Design saved' + (r.data.profile.identity_version > (p.identity_version || 1) ? ' — identity v' + r.data.profile.identity_version + ' (earlier auditions describe the old voice)' : ''), '#65d66e');
  };
  P.vdAudition = async function (p) {
    const vd = this._vd(); const lines = vd.mode === 'scene' ? vd.lines.split('\n').map(x => x.trim()).filter(Boolean) : null;
    const body = { count: vd.count, keep_text: vd.keepText, source: vd.mode === 'scene' ? 'scene' : 'custom', direction: vd.direction || undefined }; if (lines) body.lines = lines; else body.text = vd.text;
    const r = await api(this, `/api/voice/profiles/${p.id}/auditions`, body);
    if (!r.ok) { this.toast((r.data.error || 'Audition refused') + (r.data.gate ? ' · ' + r.data.gate : ''), '#ef4444'); return; }
    vd.lastTexts = lines || [vd.text]; (vd.rounds[p.id] = vd.rounds[p.id] || []).unshift(r.data.round); this.vpSet({}); this.vdFollowRound(p.id, r.data.round.id);
  };
  P.vdFollowRound = function (pid, rid) {
    const vd = this._vd(); clearInterval(this._vdTimer); const self = this;
    const tick = async () => {
      const r = await api(self, `/api/voice/profiles/${pid}/auditions/${rid}`); if (!r.ok) { clearInterval(self._vdTimer); return; }
      vd.rounds[pid] = (vd.rounds[pid] || []).map(x => (x.id === rid ? r.data.round : x)); self.vdSet({}, { skipIfTyping: true });
      if (r.data.round.status !== 'rendering') { clearInterval(self._vdTimer); self.loadMediaLibrary && self.loadMediaLibrary('voice'); for (const c of r.data.round.candidates) for (const cl of c.clips) U.peaks(self, cl.artifact_id, 200).then(() => self.vdSet({}, { skipIfTyping: true })); self.toast('Audition ' + r.data.round.status, r.data.round.status === 'complete' ? '#65d66e' : '#fbbf24'); }
    };
    tick(); this._vdTimer = setInterval(tick, 1500);
  };
  P.vdMark = async function (p, rid, cid, patch) { const r = await api(this, `/api/voice/profiles/${p.id}/auditions/${rid}/candidates/${cid}`, patch, 'PATCH'); if (!r.ok) { this.toast(r.data.error || 'Could not update', '#ef4444'); return; } const rr = await api(this, `/api/voice/profiles/${p.id}/auditions/${rid}`); if (rr.ok) this._vd().rounds[p.id] = this._vd().rounds[p.id].map(x => (x.id === rid ? rr.data.round : x)); this.vpSet({}); };
  P.vdApprove = async function (p, rid, cid) {
    const note = window.prompt('Why this one? (optional note kept with the approval)', '') || '';
    const r = await api(this, `/api/voice/profiles/${p.id}/auditions/${rid}/candidates/${cid}/approve`, { note });
    if (!r.ok) { this.toast((r.data.error || 'Cannot approve') + (r.data.gate ? ' · ' + r.data.gate : ''), '#ef4444'); return; }
    await this.loadVoiceProfiles(); await this.vdSelect(p.id); this.toast('Approved — you can now lock the voice and promote it to a clone', '#65d66e');
  };
  P.vdLifecycle = async function (p, what, body, method) { const r = await api(this, `/api/voice/profiles/${p.id}/${what}`, body === undefined ? {} : body, method || 'POST'); if (!r.ok) { this.toast((r.data.error || 'Failed') + (r.data.gate ? ' · ' + r.data.gate : ''), '#ef4444'); return false; } await this.loadVoiceProfiles(); this.vpSet({}); return true; };
  P.vdPromote = async function (p, rid, cid) {
    const vd = this._vd(); const r = await api(this, `/api/voice/profiles/${p.id}/auditions/${rid}/candidates/${cid}/promote`, { transcript: vd.promote.transcript, name: vd.promote.name || undefined });
    if (!r.ok) { this.toast((r.data.error || 'Promotion refused') + (r.data.gate ? ' · ' + r.data.gate : ''), '#ef4444'); return; }
    await this.loadVoiceProfiles(); this.toast('Promoted: “' + r.data.profile.name + '” is a cloned voice with full provenance. Run its multi-line trial before production.', '#65d66e'); await this.vdSelect(r.data.profile.id);
  };
  P.vdTrial = async function (p) {
    const vd = this._vd(); const lines = vd.trialLines.split('\n').map(x => x.trim()).filter(Boolean);
    const r = await api(this, `/api/voice/profiles/${p.id}/trials`, { lines }); if (!r.ok) { this.toast(r.data.error || 'Trial refused', '#ef4444'); return; }
    vd.trial = r.data.trial; this.vpSet({}); clearInterval(this._vdTrialTimer); const self = this;
    const tick = async () => { const x = await api(self, `/api/voice/profiles/${p.id}/trials/${r.data.trial.id}`); if (!x.ok) { clearInterval(self._vdTrialTimer); return; } vd.trial = x.data.trial; self.vdSet({}, { skipIfTyping: true }); if (x.data.trial.status !== 'rendering') { clearInterval(self._vdTrialTimer); self.loadMediaLibrary && self.loadMediaLibrary('voice'); } };
    tick(); this._vdTrialTimer = setInterval(tick, 1500);
  };
  P.vdPreview = async function (p) {
    const vd = this._vd(); const r = await api(this, '/api/voice/preview', { profile_id: p.id, text: vd.text }); if (!r.ok) { this.toast(r.data.error || 'Preview refused', '#ef4444'); return; }
    vd.preview = { job_id: r.data.job_id, status: 'QUEUED', truncated: r.data.truncated }; this.vpSet({}); clearInterval(this._vdPrevTimer); const self = this;
    const tick = async () => { const x = await api(self, '/api/voice/render/' + r.data.job_id); if (!x.ok) { clearInterval(self._vdPrevTimer); return; } vd.preview = Object.assign({}, vd.preview, x.data); self.vdSet({}, { skipIfTyping: true }); if (['COMPLETE', 'FAILED', 'INTERRUPTED', 'CANCELLED'].includes(x.data.status)) clearInterval(self._vdPrevTimer); };
    tick(); this._vdPrevTimer = setInterval(tick, 1500);
  };
  P.vdBankExport = function () {
    const vd = this._vd(), ids = Object.keys(vd.bank.ids).filter(k => vd.bank.ids[k]); if (!ids.length) { this.toast('Choose at least one voice', '#fbbf24'); return; }
    fetch(this.state.backendUrl + '/api/voice/bank/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profile_ids: ids, include_audio: vd.bank.audio, include_transcripts: vd.bank.transcripts }) }).then(async r => {
      if (!r.ok) { const d = await r.json().catch(() => ({})); this.toast(d.error || 'Export failed', '#ef4444'); return; }
      const blob = await r.blob(), a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'dexdiffusion-voice-bank.zip'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    });
  };
  P.vdBankImport = async function (file, apply) {
    if (!file) return; const vd = this._vd(); vd.bank.file = file;
    const r = await fetch(this.state.backendUrl + '/api/voice/bank/import' + (apply ? '?apply=1' : ''), { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file });
    vd.bank.report = await r.json().catch(() => ({ errors: ['unreadable response'] })); if (apply && vd.bank.report.applied) { await this.loadVoiceProfiles(); this.toast('Imported ' + vd.bank.report.created.length + ' voice(s) as unapproved drafts — audition them locally', '#65d66e'); }
    this.vpSet({});
  };

  // ── builders ───────────────────────────────────────────────────────────────────────────────────
  P._vdWave = function (clip) { const pk = this._peakCache && this._peakCache.get(clip.artifact_id + '|200'); return pk ? U.waveform(this, clip.artifact_id, pk, 360, 36, '#a78bfa') : null; };
  P._vdCandidate = function (p, round, c) {
    const vd = this._vd(), base = this.state.backendUrl, ab = vd.cmp;
    return h('div', { key: c.id, 'data-candidate': c.id, style: { border: '1px solid ' + (c.approved ? 'rgba(101,214,110,.6)' : c.rejected ? 'rgba(248,113,113,.3)' : c.favorite ? 'rgba(251,191,36,.5)' : 'rgba(148,163,184,.2)'), borderRadius: 10, padding: 8, display: 'grid', gap: 5, opacity: c.rejected ? 0.55 : 1, minWidth: 0 } },
      h('div', { style: css.row }, h('b', { style: { fontSize: 12, color: '#e2e8f0' } }, 'Candidate'), h('span', { style: css.mono }, 'seed ' + c.seed), c.status !== 'complete' ? chip(c.status, c.status === 'failed' ? tone.bad : tone.info) : null, c.approved ? chip('✓ APPROVED', tone.ok) : null, c.favorite ? chip('★ favourite', tone.warn) : null, c.rejected ? chip('rejected', tone.bad) : null),
      ...c.clips.sort((a, b) => a.line_index - b.line_index).map(cl => h('div', { key: cl.artifact_id, style: { display: 'grid', gap: 3 } }, this._vdWave(cl), cl.url ? this._mediaEl(base + cl.url, 'audio', 'au-' + cl.artifact_id) : null, h('span', { style: css.muted }, (round.line_count > 1 ? 'line ' + (cl.line_index + 1) + ' · ' : '') + fmtT(cl.duration) + ' · sha ' + cl.sha256.slice(0, 10)))),
      c.error ? h('div', { style: { color: tone.bad, fontSize: 11 } }, '✗ ' + c.error) : null,
      c.status === 'complete' ? h('div', { style: css.row }, btn(c.favorite ? '★' : '☆', () => this.vdMark(p, round.id, c.id, { favorite: !c.favorite }), tone.warn, { 'aria-label': 'Favourite', 'aria-pressed': String(!!c.favorite) }), btn(c.rejected ? 'Un-reject' : 'Reject', () => this.vdMark(p, round.id, c.id, { rejected: !c.rejected }), '#f87171', { disabled: !!c.approved }),
        btn('A', () => { ab.a = c.clips[0] && c.clips[0].url; this.vpSet({}); }, ab.a && c.clips[0] && ab.a === c.clips[0].url ? '#65d66e' : '#94a3b8', { 'aria-label': 'Set as compare A' }), btn('B', () => { ab.b = c.clips[0] && c.clips[0].url; this.vpSet({}); }, ab.b && c.clips[0] && ab.b === c.clips[0].url ? '#65d66e' : '#94a3b8', { 'aria-label': 'Set as compare B' }),
        btn('Approve this voice', () => this.vdApprove(p, round.id, c.id), tone.ok, { disabled: !!c.rejected || !!c.approved, 'data-approve': c.id })) : null,
      c.status === 'complete' ? h('input', { value: c.note || '', placeholder: 'notes (e.g. warmer, too nasal)', 'aria-label': 'Notes', style: css.input, onChange: e => this.vdMark(p, round.id, c.id, { note: e.target.value }) }) : null);
  };
  P._vdCompare = function () {
    const vd = this._vd(), base = this.state.backendUrl, ab = vd.cmp; if (!ab.a && !ab.b) return null;
    const play = url => { vd._cmpAudio && vd._cmpAudio.pause(); vd._cmpAudio = new Audio(base + url); vd._cmpAudio.play(); };
    return h('div', { 'data-ab': '1', style: Object.assign({}, css.row, { border: '1px solid rgba(34,211,238,.35)', borderRadius: 9, padding: 8 }) }, h('b', { style: { fontSize: 12, color: '#67e8f9' } }, 'A / B compare'),
      btn('▶ A', () => ab.a && play(ab.a), '#65d66e', { disabled: !ab.a }), btn('▶ B', () => ab.b && play(ab.b), '#65d66e', { disabled: !ab.b }),
      btn('A then B', () => { if (!ab.a || !ab.b) return; vd._cmpAudio && vd._cmpAudio.pause(); const a = new Audio(base + ab.a); vd._cmpAudio = a; a.onended = () => play(ab.b); a.play(); }, tone.info, { disabled: !ab.a || !ab.b }), btn('Swap', () => { [ab.a, ab.b] = [ab.b, ab.a]; this.vpSet({}); }, '#94a3b8'), btn('Clear', () => { ab.a = ab.b = null; vd._cmpAudio && vd._cmpAudio.pause(); this.vpSet({}); }, '#94a3b8'));
  };
  P._vdDesigner = function (p) {
    const vd = this._vd(), caps = vd.caps, eng = caps && caps.engines.find(e => e.id === (p.preferred_engine || 'qwen3-tts-voice-design')), draft = vd.draft || (vd.draft = JSON.parse(JSON.stringify(p.design || { identity: {} })));
    draft.identity = draft.identity || {}; draft.performance = draft.performance || {};
    const locked = !!p.locked, dirOk = !eng || eng.controls.delivery_direction.enabled;
    const ro = { disabled: locked, title: locked ? 'This voice is locked; unlock it to change its identity' : '' };
    return h('div', { 'data-designer-form': p.id, style: Object.assign({}, css.panel, { display: 'grid', gap: 8 }) },
      h('div', { style: css.row }, h('div', { style: css.title }, 'DESCRIBE · ' + p.name), chip('identity v' + (p.identity_version || 1), '#94a3b8'), p.approval && p.approval.state === 'approved' ? chip('approved', tone.ok) : chip('draft', tone.warn), locked ? chip('🔒 locked', tone.ok) : null, h('div', { style: { flex: 1 } }),
        locked ? btn('Unlock (reopens approval)', () => this.vdLifecycle(p, 'unlock'), tone.warn, { 'data-unlock': '1' }) : null),
      h('div', { style: css.muted }, 'Enduring identity only. Scene-specific acting direction is supplied per line later, and is not part of who the character is.'),
      h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,210px),1fr))', gap: 8 } }, ...IDENT.map(([k, l, ph]) => field(l, h('input', Object.assign({ value: draft.identity[k] || '', placeholder: ph, 'data-design': k, style: css.input, onInput: e => { draft.identity[k] = e.target.value; } }, ro))))),
      h('details', null, h('summary', { style: Object.assign({}, css.muted, { cursor: 'pointer' }) }, '▸ Default performance & pronunciation (not part of identity)'),
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,210px),1fr))', gap: 8, marginTop: 6 } }, ...PERF.map(([k, l, ph]) => field(l, h('input', { value: draft.performance[k] || '', placeholder: ph, style: css.input, onInput: e => { draft.performance[k] = e.target.value; } }))),
          field('Optional actor FX preset', h('input', { value: draft.fx_preset || '', placeholder: 'e.g. radio', style: css.input, onInput: e => { draft.fx_preset = e.target.value; } }))),
        field('Pronunciation notes', h('textarea', { rows: 2, value: draft.pronunciation_notes || '', style: Object.assign({}, css.input, { resize: 'vertical' }), onInput: e => { draft.pronunciation_notes = e.target.value; } }))),
      h('div', { 'data-composed': '1', style: { border: '1px dashed rgba(148,163,184,.3)', borderRadius: 8, padding: 8, fontSize: 12, color: '#cbd5e1' } }, h('b', null, 'Voice description sent to the model: '), p.description || '(describe at least a few traits)'),
      h('div', { style: css.row }, btn('Save design', () => this.vdSaveDesign(p), '#65d66e', { disabled: locked, 'data-save-design': '1' }), btn('Discard edits', () => { vd.draft = null; this.vpSet({}); }, '#94a3b8')),
      eng ? h('div', { 'data-engine-controls': eng.id, style: { display: 'grid', gap: 2, fontSize: 11 } }, h('div', { style: css.label }, eng.label + ' · ' + eng.revision),
        ...Object.entries(eng.controls).map(([k, v]) => h('div', { key: k, style: { display: 'flex', gap: 6, color: v.enabled ? tone.ok : '#94a3b8' } }, h('span', null, v.enabled ? '✓' : '✗'), h('span', null, k.replace(/_/g, ' ')), v.enabled ? null : h('span', { style: { color: '#7f8ca8', overflowWrap: 'anywhere' } }, '— ' + String(v.reason || '').slice(0, 150))))) : null);
  };
  P._vdAudition = function (p) {
    const vd = this._vd(), rounds = vd.rounds[p.id] || [], running = rounds.some(r => r.status === 'rendering'), dirOk = !vd.caps || (vd.caps.engines.find(e => e.id === 'qwen3-tts-voice-design') || { controls: { delivery_direction: { enabled: true } } }).controls.delivery_direction.enabled;
    return h('div', { 'data-audition-lab': p.id, style: Object.assign({}, css.panel, { display: 'grid', gap: 8 }) },
      h('div', { style: css.title }, 'AUDITION'),
      h('div', { style: css.row }, btn('One passage', () => this.vdSet({ mode: 'single' }), vd.mode === 'single' ? '#a78bfa' : '#94a3b8', { 'data-aud-mode': 'single' }), btn('Short scene (character lines)', () => this.vdSet({ mode: 'scene' }), vd.mode === 'scene' ? '#a78bfa' : '#94a3b8', { 'data-aud-mode': 'scene' })),
      vd.mode === 'single' ? field('Audition text (your choice — at least ~10 words gives a 3 s+ reference you can promote)', h('textarea', { rows: 3, value: vd.text, 'data-aud-text': '1', style: Object.assign({}, css.input, { resize: 'vertical' }), onInput: e => { vd.text = e.target.value; } }))
        : field('Lines this character speaks (one per line, up to 6; the same seed is used for every line so the character stays consistent)', h('textarea', { rows: 5, value: vd.lines, 'data-aud-lines': '1', style: Object.assign({}, css.input, { resize: 'vertical' }), onInput: e => { vd.lines = e.target.value; } })),
      h('div', { style: css.grid2 },
        field('Candidates (each its own recorded seed)', h('input', { type: 'number', min: '1', max: '6', value: String(vd.count), style: css.input, onInput: e => { vd.count = Math.max(1, Math.min(6, Number(e.target.value) || 3)); } })),
        field('Acting direction for this audition' + (dirOk ? '' : ' — not supported'), h('input', { value: dirOk ? vd.direction : '', disabled: !dirOk, placeholder: dirOk ? 'optional, e.g. wary' : 'unavailable', style: css.input, onInput: e => { vd.direction = e.target.value; } }))),
      h('label', { style: { display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, color: '#cbd5e1', minHeight: 32 } }, h('input', { type: 'checkbox', checked: vd.keepText, 'data-keep-text': '1', onChange: e => this.vdSet({ keepText: e.target.checked }) }), 'Keep the audition text with the saved record (off by default: only a hash is stored, so a line from an unsaved screenplay is never written to disk)'),
      h('div', { style: css.row }, btn(running ? 'Generating on Big Mac…' : 'Generate ' + vd.count + ' candidate' + (vd.count > 1 ? 's' : ''), () => this.vdAudition(p), '#65d66e', { disabled: running || p.validation.state === 'invalid', 'data-generate-auditions': '1' }),
        btn('Quick preview (scratch, never a take)', () => this.vdPreview(p), '#94a3b8', { 'data-preview': '1' })),
      vd.preview ? h('div', { 'data-preview-result': vd.preview.status, style: { display: 'grid', gap: 4 } }, h('div', { style: css.row }, chip('PREVIEW', tone.warn), chip(vd.preview.status, vd.preview.status === 'COMPLETE' ? tone.ok : tone.info), vd.preview.truncated ? chip('opening only', '#94a3b8') : null, vd.preview.error ? h('span', { style: { color: tone.bad, fontSize: 12 } }, vd.preview.error) : null),
        vd.preview.artifact ? this._mediaEl(this.state.backendUrl + vd.preview.artifact.url, 'audio', 'vd-prev-' + vd.preview.job_id) : null, h('div', { style: css.muted }, 'Previews are labelled scratch audio. They never replace an approved take or enter a master.')) : null,
      this._vdCompare(),
      ...rounds.map(r => h('div', { key: r.id, 'data-round': r.id, style: { borderTop: '1px solid rgba(148,163,184,.14)', paddingTop: 8, display: 'grid', gap: 6 } },
        h('div', { style: css.row }, chip(r.status, r.status === 'complete' ? tone.ok : r.status === 'rendering' ? tone.info : tone.warn), h('span', { style: css.mono }, r.engine + ' · ' + r.runtime), h('span', { style: css.muted }, new Date(r.created_at).toLocaleTimeString() + ' · ' + r.line_count + ' line(s) · ' + r.candidates.length + ' candidate(s) · identity v' + r.identity_version), r.stale ? chip('describes an older version of this voice — cannot be approved', tone.warn) : null),
        r.error ? h('div', { style: { color: tone.bad, fontSize: 12 } }, '✗ ' + r.error) : null,
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,300px),1fr))', gap: 8 } }, ...r.candidates.map(c => this._vdCandidate(p, r, c))))));
  };
  P._vdLifecycle = function (p) {
    const vd = this._vd(), rounds = vd.rounds[p.id] || [], appr = rounds.flatMap(r => r.candidates.map(c => ({ r, c }))).find(x => x.c.approved), rd = p.readiness;
    const promoted = (p.promoted_clone_ids || []).map(id => (this._vp().profiles || []).find(x => x.id === id)).filter(Boolean);
    const pm = vd.promote;
    if (appr && !pm.transcript && vd.lastTexts && vd.lastTexts.length === 1) pm.transcript = vd.lastTexts[0];
    return h('div', { 'data-voice-lifecycle': p.id, style: Object.assign({}, css.panel, { display: 'grid', gap: 8 }) },
      h('div', { style: css.title }, 'APPROVE · LOCK · REUSE'),
      h('div', { style: css.row }, p.approval && p.approval.state === 'approved' ? chip('approved' + (p.approval.audition_id ? ' · ' + p.approval.audition_id : ''), tone.ok) : chip('not approved — approve a candidate above', tone.warn), p.locked ? chip('🔒 locked: reuse everywhere, identity cannot drift', tone.ok) : btn('Lock this voice', () => this.vdLifecycle(p, 'lock'), tone.ok, { disabled: !(p.approval && p.approval.state === 'approved'), 'data-lock': '1', title: !(p.approval && p.approval.state === 'approved') ? 'Approve a candidate first' : '' })),
      rd ? h('div', { 'data-readiness': rd.ready ? 'ready' : 'not-ready', style: { display: 'grid', gap: 2, fontSize: 12 } }, ...rd.checks.map(c => h('div', { key: c.id, style: { color: c.ok ? tone.ok : tone.warn } }, (c.ok ? '✓ ' : '○ ') + c.message))) : null,
      appr ? h('div', { 'data-promote': '1', style: { border: '1px solid rgba(167,139,250,.4)', borderRadius: 9, padding: 8, display: 'grid', gap: 6 } },
        h('div', { style: css.title }, 'Promote the approved audition to a reusable cloned voice'),
        h('div', { style: css.muted }, 'The approved clip becomes the reference sample of a linked Qwen3-TTS Base profile. The transcript must match the audition text EXACTLY (verified by checksum; the text itself is not stored unless you kept it). Qwen3 Base cannot honour acting directions, so the clone is for consistency of voice, not delivery.'),
        field('Exact transcript of the approved clip', h('textarea', { rows: 3, value: pm.transcript, 'data-promote-transcript': '1', style: Object.assign({}, css.input, { resize: 'vertical' }), onInput: e => { pm.transcript = e.target.value; } })),
        field('Name for the clone', h('input', { value: pm.name, placeholder: p.name + ' (clone)', style: css.input, onInput: e => { pm.name = e.target.value; } })),
        h('div', { style: css.row }, btn('Promote to clone', () => this.vdPromote(p, appr.r.id, appr.c.id), '#a78bfa', { 'data-promote-go': '1' }))) : null,
      promoted.length ? h('div', { style: css.muted }, 'Linked clones: ' + promoted.map(x => x.name + (x.readiness && x.readiness.ready ? ' (production-ready)' : ' (needs trial/approval)')).join(', ')) : null);
  };
  P._vdClone = function (p) {
    const vd = this._vd(), base = this.state.backendUrl, t = vd.trial, rd = p.readiness;
    return h('div', { 'data-clone-trial': p.id, style: Object.assign({}, css.panel, { display: 'grid', gap: 8 }) },
      h('div', { style: css.title }, 'Cloned voice · ' + p.name), h('div', { style: css.row }, chip('origin: ' + ((p.origin || {}).kind || 'manual'), '#22d3ee'), p.origin && p.origin.design_profile_id ? chip('from design ' + p.origin.design_profile_id, '#94a3b8') : null, p.origin && p.origin.seed != null ? chip('seed ' + p.origin.seed, '#94a3b8') : null, p.approval && p.approval.state === 'approved' ? chip('approved', tone.ok) : chip('draft', tone.warn), p.locked ? chip('🔒 locked', tone.ok) : null, p.trial && p.trial.passed ? chip('trial accepted', tone.ok) : chip('trial pending', tone.warn)),
      rd ? h('div', { style: { display: 'grid', gap: 2, fontSize: 12 } }, ...rd.checks.map(c => h('div', { key: c.id, style: { color: c.ok ? tone.ok : tone.warn } }, (c.ok ? '✓ ' : '○ ') + c.message))) : null,
      h('div', { style: css.muted }, 'Test the clone across several dialogue lines before treating it as production-ready. The software only checks that each clip decodes and isn’t silent; whether it sounds right is your decision.'),
      field('Trial lines (at least 3, one per line)', h('textarea', { rows: 4, value: vd.trialLines, 'data-trial-lines': '1', placeholder: 'Three or more different lines the character might say…', style: Object.assign({}, css.input, { resize: 'vertical' }), onInput: e => { vd.trialLines = e.target.value; } })),
      h('div', { style: css.row }, btn('Run trial', () => this.vdTrial(p), '#65d66e', { 'data-run-trial': '1', disabled: !!(t && t.status === 'rendering') }),
        t && t.status === 'complete' ? btn('Accept trial (I listened)', async () => { const r = await api(this, `/api/voice/profiles/${p.id}/trials/${t.id}/accept`, { note: window.prompt('Note (optional):', '') || '' }); if (r.ok) { await this.loadVoiceProfiles(); this.toast('Trial accepted', '#65d66e'); this.vpSet({}); } else this.toast(r.data.error || 'Cannot accept', '#ef4444'); }, tone.ok, { 'data-accept-trial': '1' }) : null,
        !p.locked ? btn('Approve voice', () => this.vdLifecycle(p, 'approve', {}), tone.ok) : null, !p.locked && p.approval && p.approval.state === 'approved' ? btn('Lock voice', () => this.vdLifecycle(p, 'lock'), tone.ok) : null),
      t ? h('div', { 'data-trial-result': t.status, style: { display: 'grid', gap: 4 } }, chip(t.status, t.status === 'complete' ? tone.ok : t.status === 'rendering' ? tone.info : tone.bad), t.error ? h('div', { style: { color: tone.bad, fontSize: 12 } }, '✗ ' + t.error) : null,
        ...t.clips.map(c => h('div', { key: c.artifact_id, style: css.row }, h('span', { style: css.mono }, 'line ' + (c.line_index + 1)), c.url ? this._mediaEl(base + c.url, 'audio', 'tr-' + c.artifact_id) : null, chip(c.checks.decodable && c.checks.not_silent ? 'checks ✓' : 'checks ✗', c.checks.decodable && c.checks.not_silent ? tone.ok : tone.bad)))) : null);
  };
  P._vdBank = function () {
    const vd = this._vd(), list = this._vp().profiles || [], b = vd.bank, rep = b.report;
    return h('div', { 'data-voice-bank': '1', style: css.panel },
      h('div', { style: css.title }, 'Portable voice bank'), h('div', { style: css.muted }, 'Export voices as a versioned package. By default it is metadata only; reference audio and transcripts are included only if you tick them. Cached speaker state is never exported or imported.'),
      h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,210px),1fr))', gap: 4 } }, ...list.map(p => h('label', { key: p.id, style: { display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, color: '#cbd5e1', minHeight: 30 } }, h('input', { type: 'checkbox', checked: !!b.ids[p.id], onChange: e => { b.ids[p.id] = e.target.checked; this.vpSet({}); } }), p.name + ' · ' + p.type))),
      h('div', { style: css.row }, h('label', { style: { display: 'flex', gap: 4, alignItems: 'center', fontSize: 12, color: '#cbd5e1' } }, h('input', { type: 'checkbox', checked: b.audio, 'data-bank-audio': '1', onChange: e => { b.audio = e.target.checked; this.vpSet({}); } }), 'include reference audio'), h('label', { style: { display: 'flex', gap: 4, alignItems: 'center', fontSize: 12, color: '#cbd5e1' } }, h('input', { type: 'checkbox', checked: b.transcripts, 'data-bank-transcripts': '1', onChange: e => { b.transcripts = e.target.checked; this.vpSet({}); } }), 'include transcripts'), btn('Export bank (.zip)', () => this.vdBankExport(), tone.info, { 'data-bank-export': '1' }),
        h('label', { style: { border: '1px dashed rgba(167,139,250,.5)', color: '#c4b5fd', borderRadius: 8, padding: '8px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 700, minHeight: 36 } }, 'Import bank (dry run first)', h('input', { type: 'file', accept: '.zip', style: { display: 'none' }, 'data-bank-import': '1', onChange: e => this.vdBankImport(e.target.files[0], false) }))),
      rep ? h('div', { 'data-bank-report': rep.errors && rep.errors.length ? 'error' : 'ok', style: { display: 'grid', gap: 3, fontSize: 12 } }, ...(rep.errors || []).map((e, i) => h('div', { key: 'e' + i, style: { color: tone.bad } }, '✗ ' + e)),
        ...(rep.profiles || []).map((x, i) => h('div', { key: 'p' + i, style: { color: x.problems.length ? tone.bad : '#cbd5e1' } }, (x.problems.length ? '✗ ' : '✓ ') + x.name + ' → ' + x.action + (x.problems.length ? ': ' + x.problems.join('; ') : '') + (x.warnings.length ? ' · ⚠ ' + x.warnings.join('; ') : ''))),
        rep.ok && !rep.applied ? btn('Import these voices', () => this.vdBankImport(b.file, true), '#65d66e', { 'data-bank-apply': '1' }) : null, rep.applied ? h('div', { style: { color: tone.ok } }, 'Imported ' + rep.created.length + ' voice(s). They arrive unapproved and unlocked.') : null) : null);
  };
  P.buildVoiceDesigner = function () {
    const vd = this._vd(), vp = this._vp();
    if (!vd.loaded) { vd.loaded = true; setTimeout(() => this.vdLoad(), 0); }
    const list = (vp.profiles || []).filter(x => x.type === 'designed' || (x.origin && x.origin.kind === 'promoted')), sel = vd.sel && (vp.profiles || []).find(x => x.id === vd.sel);
    const creating = vd.creating;
    return h('div', { 'data-voice-designer': '1', style: { display: 'grid', gap: 12, minWidth: 0 } },
      h('div', { style: css.panel },
        h('div', { style: Object.assign({}, css.row, { marginBottom: 8 }) }, h('div', { style: css.title }, 'Character voices'), h('span', { style: css.muted }, 'Designed locally with Qwen3-TTS VoiceDesign — no cloud service is involved.'), h('div', { style: { flex: 1 } }), btn('＋ New character voice', () => this.vdSet({ creating: !creating }), '#a78bfa', { 'data-new-character': '1' })),
        creating ? h('div', { style: Object.assign({}, css.row, { marginBottom: 8 }) }, h('input', { placeholder: 'Character name', 'data-new-character-name': '1', id: 'vd-new-name', style: Object.assign({}, css.input, { width: 240 }) }), btn('Create', () => { const n = document.getElementById('vd-new-name').value; this.vdSet({ creating: false }); this.vdCreate(n); }, '#65d66e', { 'data-create-character': '1' })) : null,
        list.length ? h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,210px),1fr))', gap: 8 } }, ...list.map(x => h('button', { key: x.id, type: 'button', 'data-character': x.id, onClick: () => this.vdSelect(x.id), style: { textAlign: 'left', border: '1px solid ' + (vd.sel === x.id ? '#a78bfa' : 'rgba(148,163,184,.2)'), background: vd.sel === x.id ? 'rgba(167,139,250,.12)' : 'rgba(8,14,24,.7)', color: '#e2e8f0', borderRadius: 9, padding: 10, cursor: 'pointer', display: 'grid', gap: 4, minHeight: 60 } },
          h('b', { style: { fontSize: 13 } }, (x.locked ? '🔒 ' : '') + x.name), h('div', { style: css.row }, chip(x.type, '#a78bfa'), x.approval && x.approval.state === 'approved' ? chip('approved', tone.ok) : chip('draft', tone.warn), x.readiness && x.readiness.ready ? chip('production-ready', tone.ok) : null)))) : h('div', { style: css.muted }, vp.profiles ? 'No designed voices yet. Create a character voice, describe it, audition several local candidates, approve one and lock it.' : 'Loading…')),
      sel && sel.type === 'designed' ? [h('div', { key: 'd' }, this._vdDesigner(sel)), h('div', { key: 'a' }, this._vdAudition(sel)), h('div', { key: 'l' }, this._vdLifecycle(sel))] : null,
      sel && sel.type === 'cloned' ? this._vdClone(sel) : null,
      this._vdBank());
  };
})();
