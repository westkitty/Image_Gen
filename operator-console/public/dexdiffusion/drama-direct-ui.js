// Audio Drama Studio — CAST (Cast Bible, FX rack, pacing) and DIRECT (multitrack timeline, clip inspector, Sound Director).
//
// The timeline is a VIEW of the one server-side timeline model: clip positions, FX and gains shown here are exactly what the
// mixer renders into the scene master that this page plays (the preview IS the export source). Waveforms come from
// server-computed peaks; nothing is decoded in the browser. Every edit is a non-destructive override on the project.
(function () {
  'use strict';
  const C = window.DexDiffusionComponent;
  if (!C || !window.DexUI || !window.DexStudio) return;
  const P = C.prototype;
  const U = window.DexStudio;
  const { h, field, fmtT, TAKE_TONE } = U;
  const { css, tone, btn, chip } = window.DexUI;
  const ROLE_COLOR = { music: '#a78bfa', ambience: '#2dd4bf', sfx: '#fbbf24' };
  const LANES_H = 58, LABEL_W = 118;

  // ── CAST ────────────────────────────────────────────────────────────────────────────────────────────
  P.dmActor = async function (actor, patch, quiet) {
    const r = await this._vpApi(`/api/drama/projects/${this._dm().current.id}/actors/${actor.id}`, patch, 'PUT');
    if (!r.ok) { this.toast(r.data.error || 'Could not update the actor', '#ef4444'); return false; }
    this.dmSet({ current: r.data.project }, { skipIfTyping: quiet }); return true;
  };
  P._dmFxEditor = function (a, fxData) {
    const dm = this._dm(); dm.fxDraft = dm.fxDraft || {};
    const draft = dm.fxDraft[a.id] || (dm.fxDraft[a.id] = JSON.parse(JSON.stringify(a.fx || { version: 1, preset: 'custom', bypass: false, nodes: [] })));
    const effects = fxData.effects, spec = type => (effects.find(e => e.type === type) || { params: {} }).params;
    const touch = () => { draft.preset = 'custom'; this.dmSet({}); };
    return h('div', { 'data-fx-editor': a.speaker_key, style: { border: '1px solid rgba(148,163,184,.18)', borderRadius: 9, padding: 8, display: 'grid', gap: 6 } },
      h('label', { style: { display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, color: '#cbd5e1', minHeight: 32 } }, h('input', { type: 'checkbox', checked: !!draft.bypass, onChange: e => { draft.bypass = e.target.checked; this.dmSet({}); } }), 'Bypass the whole rack (clean take)'),
      ...draft.nodes.map((n, i) => h('div', { key: n.id || i, 'data-fx-node': n.type, style: { border: '1px solid rgba(148,163,184,.14)', borderRadius: 8, padding: 6, display: 'grid', gap: 4, opacity: n.enabled === false ? 0.55 : 1 } },
        h('div', { style: css.row }, h('input', { type: 'checkbox', checked: n.enabled !== false, 'aria-label': 'Enable ' + n.type, onChange: e => { n.enabled = e.target.checked; touch(); } }), h('b', { style: { fontSize: 12, color: '#e2e8f0' } }, (effects.find(e => e.type === n.type) || {}).label || n.type), h('div', { style: { flex: 1 } }),
          btn('↑', () => { if (i > 0) { [draft.nodes[i - 1], draft.nodes[i]] = [draft.nodes[i], draft.nodes[i - 1]]; touch(); } }, '#94a3b8', { 'aria-label': 'Move up', disabled: i === 0 }), btn('↓', () => { if (i < draft.nodes.length - 1) { [draft.nodes[i + 1], draft.nodes[i]] = [draft.nodes[i], draft.nodes[i + 1]]; touch(); } }, '#94a3b8', { 'aria-label': 'Move down', disabled: i === draft.nodes.length - 1 }), btn('✕', () => { draft.nodes.splice(i, 1); touch(); }, '#f87171', { 'aria-label': 'Remove effect' })),
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,150px),1fr))', gap: 6 } }, ...Object.entries(spec(n.type)).map(([k, d]) => field(k.replace(/_/g, ' '), h('input', { type: 'number', min: String(d.min), max: String(d.max), step: d.max - d.min > 50 ? '1' : '0.05', value: String((n.params || {})[k] == null ? d.default : n.params[k]), style: css.input, onInput: e => { n.params = n.params || {}; n.params[k] = Number(e.target.value); draft.preset = 'custom'; } })))))),
      h('div', { style: css.row }, h('select', { 'aria-label': 'Add effect', style: Object.assign({}, css.input, { width: 'auto' }), value: '', onChange: e => { if (e.target.value) { draft.nodes.push({ id: 'n' + (draft.nodes.length + 1) + Date.now() % 1000, type: e.target.value, enabled: true, params: {} }); touch(); } } }, h('option', { value: '' }, '＋ add effect…'), ...effects.map(e => h('option', { key: e.type, value: e.type }, e.label))),
        btn('Apply to ' + a.speaker, async () => { if (await this.dmActor(a, { fx: draft })) { delete dm.fxDraft[a.id]; this.toast('Effects applied as a derived mix; original takes remain unchanged. Preview the scene in DIRECT before export.', '#65d66e'); } }, '#65d66e', { 'data-fx-apply': a.speaker_key }),
        btn('Undo last FX change', async () => { if (await this.dmActor(a, { fx_undo: true })) { delete dm.fxDraft[a.id]; this.toast('Previous FX chain restored; the clean take is unchanged.', '#65d66e'); } }, '#94a3b8', { disabled: !(a.fx_history || []).length, 'data-fx-undo': a.speaker_key }),
        btn('Restore clean', async () => { if (await this.dmActor(a, { fx: null })) { delete dm.fxDraft[a.id]; this.toast('Clean take selected for the next scene preview.', '#65d66e'); } }, '#94a3b8'),
        btn('Save as custom preset…', async () => { const name = window.prompt('Name for this preset:', ''); if (!name) return; const r = await this._vpApi('/api/drama/fx/presets', { name, chain: draft }); this.toast(r.ok ? 'Preset saved' : (r.data.error || 'Could not save'), r.ok ? '#65d66e' : '#ef4444'); if (r.ok) this.dmSet({ fx: null }); }, '#a78bfa'),
        btn('Reset', () => { delete dm.fxDraft[a.id]; this.dmSet({}); }, '#94a3b8')),
      h('div', { style: css.muted }, 'Order matters. “Reverb” is an echo-tap room simulation (not convolution). Standard pitch shift uses FFmpeg asetrate/atempo and does not preserve formants.' + (fxData.processors && fxData.processors.formant_pitch && fxData.processors.formant_pitch.available ? ` Formant-preserving pitch uses ${fxData.processors.formant_pitch.method}; it remains an approximate DSP edit, not neural speech conversion.` : ' Formant-preserving pitch is hidden because its processor is unavailable.') + ' Tails of echoes/reverb are padded so they are not cut. Original take bytes stay unchanged; use DIRECT → Render preview to hear the derived mix.'));
  };
  P._dmStageCast = function (p) {
    const dm = this._dm(), profiles = this._vp().profiles || [];
    if (!dm.fx) { dm.fx = {}; this._vpApi('/api/drama/fx/presets').then(r => { if (r.ok) this.dmSet({ fx: r.data }, { skipIfTyping: true }); }); }
    if (!dm.pacingPresets) { dm.pacingPresets = []; this._vpApi('/api/drama/pacing/presets').then(r => { if (r.ok) this.dmSet({ pacingPresets: r.data.presets }, { skipIfTyping: true }); }); }
    const fxData = dm.fx && dm.fx.builtin ? dm.fx : null;
    const cards = p.actors.map(a => {
      const unresolved = p.unresolved.some(u => u.key === a.speaker_key), pf = a.permitted_features, pr = a.profile;
      const full = profiles.find(x => x.id === a.voice_profile_id);
      const dirOk = !pf || pf.delivery_direction.ok, rules = a.pronunciation || [];
      const pacing = a.pacing || { mode: 'off' };
      const pacingSel = pacing.mode === 'off' ? 'off' : pacing.preset || (pacing.mode === 'wpm' ? 'custom-wpm' : 'custom-tempo');
      return h('div', { key: a.id, 'data-actor': a.speaker_key, style: { border: '1px solid ' + (unresolved ? 'rgba(251,191,36,.5)' : 'rgba(148,163,184,.18)'), borderRadius: 10, padding: 10, display: 'grid', gap: 8, minWidth: 0 } },
        h('div', { style: css.row }, h('b', { style: { color: '#e2e8f0', fontSize: 14 } }, a.speaker), h('span', { style: css.mono }, a.speaker_key), chip(a.lines + ' line' + (a.lines === 1 ? '' : 's'), '#94a3b8'), unresolved ? chip('needs a voice', tone.warn) : chip('ready', tone.ok),
          full && full.locked ? chip('🔒 voice locked', tone.ok) : null, full && full.approval && full.approval.state === 'approved' ? chip('voice approved', tone.ok) : null, full && full.readiness && !full.readiness.ready ? chip('voice not production-ready: ' + full.readiness.checks.filter(c => !c.ok).map(c => c.id).join(', '), tone.warn) : null),
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,200px),1fr))', gap: 8 } },
          field('Voice', h('select', { 'aria-label': 'Voice for ' + a.speaker, value: a.voice_profile_id || '', style: css.input, onChange: e => this.dmActor(a, { voice_profile_id: e.target.value || null }) }, h('option', { value: '' }, '— choose a voice —'), ...profiles.map(x => h('option', { key: x.id, value: x.id }, (x.locked ? '🔒 ' : '') + x.name + ' · ' + x.type + (x.validation.state === 'invalid' ? ' (invalid)' : ''))))),
          field('Role', h('select', { value: a.role || (a.speaker_key === (p.settings.narrator_name || 'NARRATOR') ? 'narrator' : 'character'), style: css.input, onChange: e => this.dmActor(a, { role: e.target.value }) }, ...['character', 'narrator', 'background', 'remote'].map(r => h('option', { key: r, value: r }, r)))),
          field('Language', h('select', { value: a.language || '', style: css.input, onChange: e => this.dmActor(a, { language: e.target.value }) }, h('option', { value: '' }, 'project default (' + p.settings.default_language + ')'), ...['en', 'zh', 'ja', 'ko', 'de', 'fr', 'es', 'it', 'pt', 'ru'].map(l => h('option', { key: l, value: l }, l)))),
          field('Default delivery direction' + (dirOk ? '' : ' — not supported'), h('input', { value: a.default_direction || '', disabled: !dirOk, placeholder: dirOk ? 'e.g. low, unhurried' : 'unavailable for this voice', title: dirOk ? '' : (pf.delivery_direction.reason || ''), style: Object.assign({}, css.input, dirOk ? {} : { opacity: 0.5 }), onInput: e => { clearTimeout(this._dmDirT); const v = e.target.value; this._dmDirT = setTimeout(() => this.dmActor(a, { default_direction: v }, true), 700); } }))),
        !dirOk ? h('div', { style: { color: tone.warn, fontSize: 11 } }, 'ℹ ' + pf.label + ' cannot apply delivery directions — the field is disabled rather than pretending. ' + (pf.delivery_direction.reason ? '(' + String(pf.delivery_direction.reason).slice(0, 140) + '…)' : '')) : null,
        pf ? h('div', { 'data-permitted': a.speaker_key, style: css.row }, chip(pf.label, '#22d3ee'), chip('direction ' + (pf.delivery_direction.ok ? 'yes' : 'no'), pf.delivery_direction.ok ? tone.ok : '#94a3b8'), chip('speed ' + (pf.speed.ok ? 'yes' : 'no'), pf.speed.ok ? tone.ok : '#94a3b8'), chip('seed ' + (pf.seed.ok ? 'yes' : 'no'), pf.seed.ok ? tone.ok : '#94a3b8'), chip('cached voice prompt: no', '#94a3b8'), chip('expressive tags: no', '#94a3b8')) : null,
        h('details', { open: rules.length ? '' : null }, h('summary', { style: Object.assign({}, css.muted, { cursor: 'pointer', minHeight: 30, display: 'flex', alignItems: 'center' }) }, '▸ Pronunciation (' + rules.length + ') — respelled words are spoken, the script is never changed'),
          h('div', { style: { display: 'grid', gap: 4, marginTop: 4 } }, ...rules.map((r, i) => h('div', { key: i, style: css.row }, h('span', { style: css.mono }, r.from + ' → ' + r.to + (r.ignore_case ? ' (any case)' : '')), btn('✕', () => this.dmActor(a, { pronunciation: rules.filter((_, j) => j !== i) }), '#f87171', { 'aria-label': 'Remove rule' }))),
            h('div', { style: css.row }, h('input', { placeholder: 'word as written', 'aria-label': 'Word as written', style: Object.assign({}, css.input, { width: 150 }), id: 'pr-from-' + a.id }), h('input', { placeholder: 'how to say it (respelling)', 'aria-label': 'Respelling', style: Object.assign({}, css.input, { width: 190 }), id: 'pr-to-' + a.id }),
              btn('Add', () => { const f = document.getElementById('pr-from-' + a.id), t = document.getElementById('pr-to-' + a.id); if (!f.value.trim() || !t.value.trim()) return; this.dmActor(a, { pronunciation: [...rules, { from: f.value.trim(), to: t.value.trim(), ignore_case: true }] }); }, '#65d66e', { 'data-pron-add': a.speaker_key })))),
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,230px),1fr))', gap: 8 } },
          field('Actor FX (non-destructive)', h('select', { 'data-fx-select': a.speaker_key, value: a.fx ? a.fx.preset : 'none', style: css.input, onChange: e => { delete dm.fxDraft?.[a.id]; this.dmActor(a, { fx: e.target.value === 'none' ? null : e.target.value }); } }, ...(fxData ? fxData.builtin.filter(x => x.id !== 'custom').map(x => h('option', { key: x.id, value: x.id }, x.label)) : [h('option', { key: 'none', value: 'none' }, 'None / Clean')]), a.fx && a.fx.preset === 'custom' ? h('option', { key: 'c', value: 'custom' }, 'Custom (edited)') : null,
            ...(fxData ? fxData.custom.map(c => h('option', { key: c.id, value: 'custom:' + c.id, disabled: true }, '★ ' + c.name + ' (apply from editor)')) : []))),
          field('Pacing master (optional — off by default)', h('select', { 'data-pacing-select': a.speaker_key, value: pacingSel, style: css.input, onChange: e => { const v = e.target.value; if (v === 'off' || v === 'fast_monologue' || v === 'brisk') this.dmActor(a, { pacing: v }); else if (v === 'custom-wpm') { const w = Number(window.prompt('Target words per minute (60–600):', '220')); if (w) this.dmActor(a, { pacing: { mode: 'wpm', target_wpm: w } }); } else { const t = Number(window.prompt('Tempo multiplier (0.5–2):', '1.15')); if (t) this.dmActor(a, { pacing: { mode: 'tempo', tempo: t } }); } } },
            h('option', { value: 'off' }, 'Off — as performed'), ...(dm.pacingPresets || []).filter(x => x.id !== 'off').map(x => h('option', { key: x.id, value: x.id }, x.label)), h('option', { value: 'custom-wpm' }, 'Custom WPM…'), h('option', { value: 'custom-tempo' }, 'Custom tempo…')))),
        fxData && (dm.fxOpen || {})[a.id] ? this._dmFxEditor(a, fxData) : null,
        h('div', { style: css.row }, btn((dm.fxOpen || {})[a.id] ? 'Hide effects rack' : 'Edit effects rack…', () => { dm.fxOpen = dm.fxOpen || {}; dm.fxOpen[a.id] = !dm.fxOpen[a.id]; this.dmSet({}); }, '#a78bfa', { 'data-fx-open': a.speaker_key }), btn('Open in Voice Designer', () => { if (a.voice_profile_id) this.vpSet({ tab: 'designer', selected: a.voice_profile_id }); this.setScreen('voice'); }, '#22d3ee'),
          pacing.mode !== 'off' ? chip(pacing.mode === 'wpm' ? '≈' + pacing.target_wpm + ' wpm' : '×' + pacing.tempo, tone.warn) : null),
        h('input', { value: a.notes || '', placeholder: 'performance notes (optional)', style: css.input, onInput: e => { clearTimeout(this._dmNoteT); const v = e.target.value; this._dmNoteT = setTimeout(() => this.dmActor(a, { notes: v }, true), 800); } }),
        (a.history || []).length ? h('details', null, h('summary', { style: Object.assign({}, css.muted, { cursor: 'pointer' }) }, '▸ History (' + a.history.length + ')'), h('div', { style: css.mono }, a.history.slice(0, 8).map(x => new Date(x.at).toLocaleString() + '  ' + x.changed.join(', ') + (x.identity_version ? '  (voice v' + x.identity_version + ')' : '')).join('\n'))) : null);
    });
    return h('div', { style: { display: 'grid', gap: 12 } },
      h('div', { 'data-drama-cast': '1', style: css.panel },
        h('div', { style: Object.assign({}, css.row, { marginBottom: 8 }) }, h('div', { style: css.title }, 'Cast Bible'), h('span', { style: css.muted }, 'One record per speaker in your script — no characters are invented. Changing a voice, language or pronunciation re-renders only that speaker; changing effects or pacing only re-mixes.'), h('div', { style: { flex: 1 } }), btn('Manage voices', () => { this.vpSet({ tab: 'profiles' }); this.setScreen('voice'); }, '#a78bfa')),
        !profiles.length ? h('div', { style: { color: tone.warn, fontSize: 12, marginBottom: 6 } }, 'No saved voices yet — design or clone some in Voice.') : null,
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,420px),1fr))', gap: 10 } }, ...cards)));
  };

  // ── DIRECT ──────────────────────────────────────────────────────────────────────────────────────────
  P.dmLoadTimeline = async function (sceneId) {
    const dm = this._dm(); if (!dm.current) return; sceneId = sceneId || dm.sceneId || (dm.current.scenes.find(s => s.lines.some(l => l.kind !== 'direction')) || dm.current.scenes[0] || {}).id; if (!sceneId) return;
    const r = await this._vpApi(`/api/drama/projects/${dm.current.id}/scenes/${sceneId}/timeline`); if (!r.ok) { this.toast(r.data.error || 'Timeline unavailable', '#ef4444'); return; }
    dm.sceneId = sceneId; this.dmSet({ timeline: r.data.timeline }, { skipIfTyping: true });
    for (const lane of r.data.timeline.lanes) for (const c of lane.clips) if (c.artifact_id && c.resolved !== false) U.peaks(this, c.artifact_id, 240).then(pk => { if (pk) this.dmSet({}, { skipIfTyping: true }); });
  };
  P.dmPreviewScene = async function () {
    const dm = this._dm(); this.dmSet({ previewBusy: true });
    const r = await this._vpApi(`/api/drama/projects/${dm.current.id}/scenes/${dm.sceneId}/preview`, {}); this.dmSet({ previewBusy: false });
    if (!r.ok) { this.toast((r.data.error || 'Preview failed') + (r.data.lines ? ' (' + r.data.lines.length + ' line(s) need speech)' : ''), '#ef4444'); return; }
    this.dmSet({ timeline: r.data.timeline }); this.toast(r.data.reused ? 'Preview is current' : 'Preview rendered — this is the audio the export reuses', '#65d66e');
  };
  P.dmClip = async function (lineId, patch) {
    const dm = this._dm(); const r = await this._vpApi(`/api/drama/projects/${dm.current.id}/lines/${lineId}/clip`, patch, 'PUT');
    if (!r.ok) { this.toast(r.data.error || 'Edit rejected', '#ef4444'); return false; } this.dmSet({ current: r.data.project }); await this.dmLoadTimeline(); return true;
  };
  P.dmTrack = async function (trackId, patch) {
    const dm = this._dm(); const r = await this._vpApi(`/api/drama/projects/${dm.current.id}/tracks/${trackId}`, patch, 'PUT');
    if (!r.ok) { this.toast(r.data.error || 'Edit rejected', '#ef4444'); return false; } this.dmSet({ current: r.data.project }); await this.dmLoadTimeline(); return true;
  };
  P.dmCueAction = async function (lineId, what, body) {
    const dm = this._dm(); const r = await this._vpApi(`/api/drama/projects/${dm.current.id}/cues/${encodeURIComponent(lineId)}${what}`, body, body === undefined ? 'DELETE' : (what === '' ? 'PUT' : 'POST'));
    if (!r.ok) { this.toast(r.data.error || 'Cue update failed', '#ef4444'); return null; } if (r.data.project) this.dmSet({ current: r.data.project }); await this.dmLoadCues(); await this.dmLoadTimeline(); return r.data;
  };
  P.dmLoadCues = async function () { const dm = this._dm(); const r = await this._vpApi(`/api/drama/projects/${dm.current.id}/cues`); if (r.ok) this.dmSet({ cues: r.data }, { skipIfTyping: true }); };
  P.dmSuggest = async function (lineId) { const r = await this._vpApi(`/api/drama/projects/${this._dm().current.id}/cues/${encodeURIComponent(lineId)}/suggest`); this.dmSet({ suggest: r.ok ? Object.assign({ line_id: lineId }, r.data) : { line_id: lineId, error: r.data.error } }); };
  P.dmProcedural = async function (lineId, recipe, seconds) {
    const r = await this._vpApi('/api/drama/procedural', { recipe, seconds }); if (!r.ok) { this.toast(r.data.error || 'Could not generate', '#ef4444'); return; }
    await this.dmCueAction(lineId, '/bind', { artifact_id: r.data.artifact.artifact_id }); this.toast('Generated locally and bound to the cue', '#65d66e');
  };
  P._dmPlayhead = function () {
    const dm = this._dm(), el = dm.audioEl; if (!el || !dm.phNode) return;
    const t = el.currentTime || 0; dm.phNode.style.left = (LABEL_W + t * dm.pxs) + 'px'; if (dm.clockNode) dm.clockNode.textContent = fmtT(t) + ' / ' + fmtT(dm.timeline ? dm.timeline.length_s : 0);
    if (!el.paused) dm.raf = requestAnimationFrame(() => this._dmPlayhead());
  };
  P._dmClipBlock = function (lane, c, tl, pxs) {
    const dm = this._dm(), sel = dm.selClip === c.id, color = lane.kind === 'cue' ? (ROLE_COLOR[lane.role] || '#94a3b8') : (c.fx ? '#f472b6' : '#38bdf8');
    const left = (c.start_s || 0) * pxs, width = Math.max(14, (c.duration_s || 0.3) * pxs), pk = c.artifact_id && this._peakCache && this._peakCache.get(c.artifact_id + '|240');
    const label = lane.kind === 'dialogue' ? `Dialogue ${lane.label}, line ${c.line_id}, starts ${(c.start_s || 0).toFixed(2)} seconds, ${(c.duration_s || 0).toFixed(2)} long` : `${lane.role} cue ${c.label || c.track_id}, starts ${(c.start_s == null ? 0 : c.start_s).toFixed(2)} seconds`;
    const refocus = () => { requestAnimationFrame(() => { const n = document.querySelector('[data-clip="' + c.id.replace(/"/g, '\\"') + '"]'); if (n) n.focus(); }); };
    const move = async delta => { if (lane.kind === 'dialogue') await this.dmClip(c.line_id, { start_offset_s: Math.round((((c.overrides && c.overrides.start_offset_s) || 0) + delta) * 1000) / 1000 }); else if (c.resolved) await this.dmTrack(c.track_id, { move_to_s: Math.max(0, Math.round(((c.start_s || 0) + delta) * 1000) / 1000) }); refocus(); };
    const el = h('button', { key: c.id, type: 'button', 'data-clip': c.id, 'aria-label': label, 'aria-pressed': String(sel), tabindex: 0,
      onClick: () => { dm.selClip = c.id; this.dmSet({}); },
      onKeydown: e => {
        const step = e.shiftKey ? 1 : 0.1;
        if (e.key === 'ArrowLeft') { e.preventDefault(); move(-step); } else if (e.key === 'ArrowRight') { e.preventDefault(); move(step); }
        else if (e.key === 'Enter') { dm.selClip = c.id; this.dmSet({}); }
      },
      onPointerdown: e => {
        if (e.button !== 0) return; const sx = e.clientX; let moved = false; const target = e.currentTarget;
        const mv = ev => { const dx = ev.clientX - sx; if (Math.abs(dx) > 3) { moved = true; target.style.transform = 'translateX(' + dx + 'px)'; } };
        const up = ev => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); target.style.transform = ''; if (moved) { dm.suppressClick = true; move((ev.clientX - sx) / pxs); } };
        window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
      },
      style: { position: 'absolute', left, top: 4, width, height: LANES_H - 8, border: '1px solid ' + (sel ? '#fff' : color), background: color + (sel ? '44' : '24'), borderRadius: 6, padding: 0, overflow: 'hidden', cursor: 'grab', color: '#fff', outlineOffset: 2, opacity: c.resolved === false ? 0.45 : 1, touchAction: 'none' } },
      pk ? U.waveform(this, c.artifact_id, pk, Math.min(1600, Math.round(width)), LANES_H - 10, color) : null,
      h('span', { style: { position: 'absolute', left: 3, top: 1, fontSize: 9, fontWeight: 800, textShadow: '0 0 3px #000', pointerEvents: 'none', whiteSpace: 'nowrap' } }, lane.kind === 'dialogue' ? (c.take_state ? c.take_state.label : '') + (c.fx ? ' · ' + c.fx.preset : '') + (c.tempo !== 1 ? ' · ×' + c.tempo : '') : (c.label || c.track_id) + (c.loop ? ' ⟳' : '') + (c.anchored ? ' ⚓' : '') + (c.resolved === false ? ' (unresolved)' : '')));
    return el;
  };
  P._dmInspector = function (tl) {
    const dm = this._dm(), p = dm.current; const id = dm.selClip; if (!id) return h('div', { style: css.muted }, 'Select a clip to edit it (click it, or Tab to it). Arrow keys nudge by 0.1 s (Shift: 1 s). Drag to move. Edits are non-destructive overrides; “Reset clip” restores the original.');
    let lane = null, c = null; for (const l of tl.lanes) { const f = l.clips.find(x => x.id === id); if (f) { lane = l; c = f; } }
    if (!c) return h('div', { style: css.muted }, 'That clip is no longer on this scene.');
    const num = (label, key, step, get, set, attrs) => field(label, h('input', Object.assign({ type: 'number', step: String(step), value: String(get()), style: css.input, 'data-insp': key, onChange: e => set(Number(e.target.value)) }, attrs || {})));
    if (lane.kind === 'dialogue') {
      const o = c.overrides || {}, line = p.scenes.flatMap(s => s.lines).find(l => l.id === c.line_id), takes = (line ? line.takes : []).filter(t => t.status === 'complete');
      return h('div', { 'data-inspector': 'dialogue', style: { display: 'grid', gap: 6 } },
        h('div', { style: css.row }, h('b', { style: { color: '#e2e8f0' } }, lane.label + ' · ' + c.line_id), chip(c.take_state ? c.take_state.label : '—', TAKE_TONE[c.take_state && c.take_state.label] || '#94a3b8'), c.fx ? chip('FX ' + c.fx.preset, '#f472b6') : null, c.tempo !== 1 ? chip('pace ×' + c.tempo, tone.warn) : null, c.pinned ? chip('take pinned', tone.info) : null),
        c.pacing && c.pacing.warnings && c.pacing.warnings.length ? h('div', { style: { color: tone.warn, fontSize: 11 } }, '⚠ ' + c.pacing.warnings.join(' ')) : null,
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,130px),1fr))', gap: 6 } },
          num('Nudge (s)', 'nudge', 0.05, () => o.start_offset_s || 0, v => this.dmClip(c.line_id, { start_offset_s: v })), num('Gain (dB)', 'gain', 0.5, () => o.gain_db || 0, v => this.dmClip(c.line_id, { gain_db: v })),
          num('Fade in (s)', 'fadein', 0.05, () => o.fade_in_s || 0, v => this.dmClip(c.line_id, { fade_in_s: v })), num('Fade out (s)', 'fadeout', 0.05, () => o.fade_out_s || 0, v => this.dmClip(c.line_id, { fade_out_s: v })),
          num('Trim start (s)', 'trimstart', 0.05, () => o.trim_start_s || 0, v => this.dmClip(c.line_id, { trim_start_s: v })), num('Trim end (s)', 'trimend', 0.05, () => (o.trim_end_s == null ? '' : o.trim_end_s), v => this.dmClip(c.line_id, { trim_end_s: v || null }))),
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,200px),1fr))', gap: 6 } },
          field('Effects on this clip', h('select', { 'data-insp': 'fx', value: o.fx_override === undefined ? 'inherit' : o.fx_override === null ? 'none' : o.fx_override.preset, style: css.input, onChange: e => this.dmClip(c.line_id, { fx_override: e.target.value }) }, h('option', { value: 'inherit' }, 'Inherit from actor'), h('option', { value: 'none' }, 'Clean (no effects)'), ...((dm.fx && dm.fx.builtin) || []).filter(x => !['none', 'custom'].includes(x.id)).map(x => h('option', { key: x.id, value: x.id }, x.label)))),
          field('Pacing on this clip', h('select', { 'data-insp': 'pacing', value: o.pacing === undefined ? 'inherit' : o.pacing.mode === 'off' ? 'off' : o.pacing.preset || 'custom', style: css.input, onChange: e => this.dmClip(c.line_id, { pacing: e.target.value }) }, h('option', { value: 'inherit' }, 'Inherit from actor'), h('option', { value: 'off' }, 'Off — as performed'), ...(dm.pacingPresets || []).filter(x => x.id !== 'off').map(x => h('option', { key: x.id, value: x.id }, x.label)))),
          field('Take for this clip', h('select', { 'data-insp': 'take', value: o.pinned_take_id || '', style: css.input, onChange: e => this.dmClip(c.line_id, { pinned_take_id: e.target.value || null }) }, h('option', { value: '' }, 'Automatic (selected take)'), ...takes.map((t, i) => h('option', { key: t.id, value: t.id, disabled: !(t.state && t.state.freshness === 'current') }, 'Take ' + (line.takes.indexOf(t) + 1) + ' · ' + (t.state ? t.state.label : t.status) + (t.seed != null ? ' · seed ' + t.seed : '')))))),
        h('div', { style: css.row }, btn('Reset clip', () => this.dmClip(c.line_id, { reset: true }), '#94a3b8', { 'data-insp': 'reset' }), btn('Trim to speech (suggested)', async () => { const r = await this._vpApi(`/api/drama/projects/${p.id}/lines/${c.line_id}/apply-trim`, {}); this.toast(r.ok ? 'Trim applied to the clip (original untouched)' : (r.data.error || 'No clear boundaries'), r.ok ? '#65d66e' : '#fbbf24'); if (r.ok) { this.dmSet({ current: r.data.project }); this.dmLoadTimeline(); } }, '#94a3b8')));
    }
    const tr = (p.tracks || []).find(t => t.id === c.track_id); if (!tr) return null;
    const at = dm.audioEl ? dm.audioEl.currentTime : 0;
    return h('div', { 'data-inspector': 'cue', style: { display: 'grid', gap: 6 } },
      h('div', { style: css.row }, h('b', { style: { color: ROLE_COLOR[lane.role] } }, lane.role + ' · ' + (tr.label || tr.id)), c.anchored ? chip('⚓ anchored to the script — moves with the dialogue', tone.info) : chip('absolute time', '#94a3b8'), c.required ? chip('required', tone.warn) : chip('optional', '#94a3b8')),
      h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,130px),1fr))', gap: 6 } },
        num(c.anchored ? 'Offset from anchor (s)' : 'Start (s)', 'start', 0.05, () => tr.start_s || 0, v => this.dmTrack(tr.id, { start_s: v })), num('Gain (0–2)', 'tgain', 0.05, () => tr.gain, v => this.dmTrack(tr.id, { gain: v })),
        num('Fade in (s)', 'tfadein', 0.1, () => tr.fade_in_s || 0, v => this.dmTrack(tr.id, { fade_in_s: v })), num('Fade out (s)', 'tfadeout', 0.1, () => tr.fade_out_s || 0, v => this.dmTrack(tr.id, { fade_out_s: v })),
        num('Trim start (s)', 'ttrimstart', 0.1, () => tr.trim_start_s || 0, v => this.dmTrack(tr.id, { trim_start_s: v })), num('Length (s, blank=natural)', 'tlen', 0.1, () => (tr.length_s == null ? '' : tr.length_s), v => this.dmTrack(tr.id, { length_s: v || null })), num('Priority', 'tprio', 1, () => tr.priority || 0, v => this.dmTrack(tr.id, { priority: v }))),
      h('div', { style: css.row },
        ...[['loop', 'Loop to fill'], ['duck', 'Duck under dialogue'], ['required', 'Required for certification']].map(([k, l]) => h('label', { key: k, style: { display: 'flex', gap: 4, alignItems: 'center', fontSize: 12, color: '#cbd5e1', minHeight: 32 } }, h('input', { type: 'checkbox', checked: !!tr[k] || (k === 'required' && tr.required !== false), 'data-insp': k, onChange: e => this.dmTrack(tr.id, { [k]: e.target.checked }) }), l))),
      h('div', { style: css.row }, btn('Split at playhead', async () => { const r = await this._vpApi(`/api/drama/projects/${p.id}/tracks/${tr.id}/split`, { at_s: at }); this.toast(r.ok ? 'Cue split' : (r.data.error || 'Cannot split here'), r.ok ? '#65d66e' : '#fbbf24'); if (r.ok) { this.dmSet({ current: r.data.project }); this.dmLoadTimeline(); } }, '#94a3b8', { 'data-insp': 'split' }), btn('Remove cue', async () => { const r = await this._vpApi(`/api/drama/projects/${p.id}/tracks/${tr.id}`, undefined, 'DELETE'); if (r.ok) { dm.selClip = null; this.dmSet({ current: r.data.project }); this.dmLoadTimeline(); } }, '#f87171')));
  };
  P._dmCuePanel = function (p) {
    const dm = this._dm(), base = this.state.backendUrl, cues = dm.cues;
    if (!cues && !dm._cuesAsked) { dm._cuesAsked = true; this.dmLoadCues(); }
    if (!dm.musicLib.length && !dm._libAsked) { dm._libAsked = true; this.loadDramaMusic(); }
    const lib = dm.musicLib || [];
    return h('div', { 'data-sound-director': '1', style: css.panel },
      h('div', { style: css.row }, h('div', { style: css.title }, 'Sound Director — cues from your script'), h('span', { style: css.muted }, 'Cues are never spoken. Bind them to audio in your library, or generate a simple effect locally. Nothing is downloaded.')),
      cues && cues.cues.length ? h('div', { style: { display: 'grid', gap: 8, marginTop: 6 } }, ...cues.cues.map(c => {
        const sg = dm.suggest && dm.suggest.line_id === c.line_id ? dm.suggest : null;
        return h('div', { key: c.id, 'data-cue': c.line_id, style: { border: '1px solid ' + (c.status === 'resolved' ? 'rgba(101,214,110,.35)' : c.required ? 'rgba(248,113,113,.5)' : 'rgba(251,191,36,.35)'), borderRadius: 8, padding: 8, display: 'grid', gap: 5 } },
          h('div', { style: css.row }, chip(c.role, ROLE_COLOR[c.role] || '#94a3b8'), h('b', { style: { fontSize: 12, color: '#e2e8f0' } }, c.description || '(no description)'), chip(c.status, c.status === 'resolved' ? tone.ok : c.required ? tone.bad : tone.warn),
            h('label', { style: { display: 'flex', gap: 4, alignItems: 'center', fontSize: 12, color: '#cbd5e1' } }, h('input', { type: 'checkbox', checked: !!c.required, 'data-cue-required': c.line_id, onChange: e => this.dmCueAction(c.line_id, '', { required: e.target.checked }) }), 'required')),
          c.status === 'unresolved' ? h('div', { style: css.row }, h('select', { 'aria-label': 'Bind to library audio', style: Object.assign({}, css.input, { width: 'auto', maxWidth: 260 }), value: '', 'data-cue-bind': c.line_id, onChange: e => e.target.value && this.dmCueAction(c.line_id, '/bind', { artifact_id: e.target.value }) }, h('option', { value: '' }, lib.length ? 'Bind to library audio…' : 'Library is empty'), ...lib.map(i => h('option', { key: i.artifact_id, value: i.artifact_id }, i.kind + ' · ' + i.artifact_id.slice(0, 44)))),
            btn('Suggest', () => this.dmSuggest(c.line_id), '#94a3b8', { 'data-cue-suggest': c.line_id })) : h('div', { style: css.row }, h('span', { style: css.mono }, c.artifact_id), btn('Unbind', () => this.dmCueAction(c.line_id, '/bind'), '#f87171')),
          sg ? h('div', { style: { fontSize: 12, display: 'grid', gap: 4 } }, sg.error ? h('div', { style: { color: tone.bad } }, sg.error) : [
            ...(sg.matches.filter(m => m.score > 0).slice(0, 4).map(m => h('div', { key: m.artifact_id, style: css.row }, h('span', { style: css.mono }, m.artifact_id), btn('Use', () => this.dmCueAction(c.line_id, '/bind', { artifact_id: m.artifact_id }), '#65d66e')))),
            !sg.matches.some(m => m.score > 0) ? h('div', { key: 'n', style: css.muted }, 'No library item matches these words.') : null,
            h('div', { key: 'p', style: css.row }, h('span', { style: css.muted }, 'Generate locally:'), ...sg.procedural.map(x => btn(x.label, () => this.dmProcedural(c.line_id, x.recipe, 8), '#a78bfa', { 'data-procedural': x.recipe }))),
            h('div', { key: 't', style: css.muted }, sg.note)]) : null);
      })) : h('div', { style: css.muted }, cues ? 'No sound cues in this script. Write “[SFX: a heavy door slams]”, “[MUSIC: tense strings, fade out 3s]” or “[AMBIENCE: rain, loop]” on their own line, or add a track below.' : 'Loading…'),
      cues && cues.issues.blocking.length ? h('div', { role: 'alert', style: { color: tone.bad, fontSize: 12, marginTop: 6 } }, '✗ ' + cues.issues.blocking.length + ' required cue(s) unresolved — they block a certified production.') : null);
  };
  P._dmStageDirect = function (p) {
    const dm = this._dm();
    const scenes = p.scenes.filter(s => s.lines.some(l => l.kind !== 'direction' && l.render !== false));
    if (!dm.fx) { dm.fx = {}; this._vpApi('/api/drama/fx/presets').then(r => { if (r.ok) this.dmSet({ fx: r.data }, { skipIfTyping: true }); }); }
    if (!dm.pacingPresets) { dm.pacingPresets = []; this._vpApi('/api/drama/pacing/presets').then(r => { if (r.ok) this.dmSet({ pacingPresets: r.data.presets }, { skipIfTyping: true }); }); }
    if (!dm.sceneId && scenes[0]) dm.sceneId = scenes[0].id;
    if (!dm.timeline || dm.timeline.scene_id !== dm.sceneId) { if (!dm._tlAsked || dm._tlAsked !== dm.sceneId) { dm._tlAsked = dm.sceneId; this.dmLoadTimeline(dm.sceneId); } }
    const tl = dm.timeline && dm.timeline.scene_id === dm.sceneId ? dm.timeline : null, base = this.state.backendUrl;
    dm.pxs = dm.pxs || 80;
    const sceneTabs = h('div', { role: 'tablist', 'aria-label': 'Scenes', style: css.row }, ...scenes.map(s => btn(s.title.slice(0, 28), () => { dm.sceneId = s.id; dm.selClip = null; dm.timeline = null; this.dmSet({}); }, dm.sceneId === s.id ? '#e11d68' : '#94a3b8', { role: 'tab', 'aria-selected': String(dm.sceneId === s.id), 'data-scene-tab': s.id })));
    if (!tl) return h('div', { style: { display: 'grid', gap: 12 } }, sceneTabs, h('div', { style: css.muted }, scenes.length ? 'Loading timeline…' : 'No renderable lines yet.'), this._dmCuePanel(p));
    const width = Math.max(480, Math.ceil(tl.length_s * dm.pxs) + 60);
    // the scene master the browser plays: the same artifact the export reuses
    // (an in-memory Audio object: a re-render must never pause playback by detaching a media element from the page)
    let audio = null;
    if (tl.master) {
      dm._audios = dm._audios || new Map(); const url = base + tl.master.url; audio = dm._audios.get(url);
      if (!audio) { audio = new Audio(url); audio.preload = 'auto'; dm._audios.set(url, audio); audio.addEventListener('play', () => this._dmPlayhead()); audio.addEventListener('timeupdate', () => this._dmPlayhead()); audio.addEventListener('seeked', () => this._dmPlayhead()); audio.addEventListener('ended', () => this._dmPlayhead()); }
      for (const [u, a] of dm._audios) if (u !== url && !a.paused) a.pause();
      dm.audioEl = audio;
    } else dm.audioEl = null;
    const seek = e => { if (!dm.audioEl) return; const rect = e.currentTarget.getBoundingClientRect(); dm.audioEl.currentTime = Math.max(0, (e.clientX - rect.left + e.currentTarget.scrollLeft - LABEL_W) / dm.pxs); this._dmPlayhead(); };
    const ticks = []; for (let t = 0; t <= tl.length_s + 1; t += (dm.pxs >= 60 ? 1 : 5)) ticks.push(h('div', { key: t, 'aria-hidden': 'true', style: { position: 'absolute', left: LABEL_W + t * dm.pxs, top: 0, bottom: 0, borderLeft: '1px solid rgba(148,163,184,.12)', fontSize: 9, color: '#64748b', paddingLeft: 2 } }, fmtT(t)));
    const lanes = tl.lanes.filter(l => l.kind === 'dialogue' || l.clips.length || true).map(l => h('div', { key: l.id, role: 'group', 'aria-label': (l.kind === 'dialogue' ? 'Dialogue lane ' + l.label : l.role + ' lane'), 'data-lane': l.id, style: { position: 'relative', height: LANES_H, borderTop: '1px solid rgba(148,163,184,.1)', minWidth: width } },
      h('div', { style: { position: 'sticky', left: 0, zIndex: 3, width: LABEL_W, height: '100%', background: 'rgba(8,12,20,.95)', display: 'flex', alignItems: 'center', padding: '0 8px', fontSize: 11, fontWeight: 800, color: l.kind === 'cue' ? ROLE_COLOR[l.role] : '#cbd5e1', borderRight: '1px solid rgba(148,163,184,.18)', boxSizing: 'border-box' } }, l.kind === 'dialogue' ? l.label : l.role),
      h('div', { style: { position: 'absolute', left: LABEL_W, top: 0, bottom: 0, right: 0 } }, ...l.clips.filter(c => c.resolved !== false || true).map(c => c.resolved === false && c.start_s == null ? null : this._dmClipBlock(l, c, tl, dm.pxs)))));
    const markers = tl.markers.map(m => h('div', { key: m.id, title: m.label || 'marker', style: { position: 'absolute', left: LABEL_W + m.t_s * dm.pxs, top: 0, bottom: 0, borderLeft: '2px dashed #f59e0b', zIndex: 2, pointerEvents: 'none' } }, h('span', { style: { fontSize: 9, color: '#f59e0b', background: 'rgba(0,0,0,.6)', padding: '0 2px' } }, m.label || '')));
    const phNode = document.createElement('div'); phNode.setAttribute('aria-hidden', 'true'); phNode.style.cssText = 'position:absolute;top:0;bottom:0;width:2px;background:#f43f5e;z-index:5;pointer-events:none;left:' + LABEL_W + 'px'; dm.phNode = phNode;
    const clock = document.createElement('span'); clock.setAttribute('aria-live', 'off'); clock.style.cssText = 'font-family:IBM Plex Mono,monospace;font-size:12px;color:#cbd5e1;min-width:90px;display:inline-block'; clock.textContent = fmtT(audio ? audio.currentTime : 0) + ' / ' + fmtT(tl.length_s); dm.clockNode = clock;
    setTimeout(() => this._dmPlayhead(), 0);
    const toggle = () => { if (!dm.audioEl) { this.toast('Render the preview first', '#fbbf24'); return; } if (dm.audioEl.paused) dm.audioEl.play(); else dm.audioEl.pause(); };
    return h('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(0,1fr)', gap: 12 } }, sceneTabs,
      h('div', { 'data-timeline': tl.scene_id, style: Object.assign({}, css.panel, { minWidth: 0 }) },
        h('div', { style: Object.assign({}, css.row, { marginBottom: 6 }) }, h('div', { style: css.title }, tl.title), chip(tl.fresh ? 'preview is current' : tl.master ? 'preview out of date' : 'no preview yet', tl.fresh ? tone.ok : tone.warn), tl.incomplete ? chip('some lines have no current take', tone.bad) : null, h('div', { style: { flex: 1 } }),
          btn(dm.previewBusy ? 'Rendering…' : tl.fresh ? 'Preview (current)' : 'Render preview', () => this.dmPreviewScene(), tone.info, { disabled: !!dm.previewBusy || tl.incomplete, 'data-render-preview': '1' }),
          btn('⏮ 5s', () => { if (dm.audioEl) { dm.audioEl.currentTime = Math.max(0, dm.audioEl.currentTime - 5); this._dmPlayhead(); } }, '#94a3b8', { 'aria-label': 'Back 5 seconds' }), btn('▶/❚❚', toggle, '#65d66e', { 'data-transport': 'play', 'aria-label': 'Play or pause the preview (Space)' }), btn('5s ⏭', () => { if (dm.audioEl) { dm.audioEl.currentTime = Math.min(dm.audioEl.duration || 1e9, dm.audioEl.currentTime + 5); this._dmPlayhead(); } }, '#94a3b8', { 'aria-label': 'Forward 5 seconds' }), clock,
          btn('−', () => { dm.pxs = Math.max(20, dm.pxs / 1.4); this.dmSet({}); }, '#94a3b8', { 'aria-label': 'Zoom out' }), btn('+', () => { dm.pxs = Math.min(400, dm.pxs * 1.4); this.dmSet({}); }, '#94a3b8', { 'aria-label': 'Zoom in' }),
          btn('Marker at playhead', async () => { const t = dm.audioEl ? dm.audioEl.currentTime : 0; const r = await this._vpApi(`/api/drama/projects/${p.id}/markers`, { scene_id: tl.scene_id, t_s: t, label: window.prompt('Marker label (optional):', '') || '' }); if (r.ok) this.dmLoadTimeline(); }, '#f59e0b')),
        h('div', { style: css.muted }, 'The preview plays the actual scene master (same mixer, effects, ducking and levels as the export). After you edit anything, press “Render preview”. Clip lanes: pink = effects applied, blue = clean.'),
        h('div', { 'data-timeline-scroll': '1', tabindex: -1, onKeydown: e => { if (e.key === ' ' && !/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) { e.preventDefault(); toggle(); } }, onClick: e => { if (dm.suppressClick) { dm.suppressClick = false; return; } if (e.target.closest('[data-clip]')) return; seek(e); }, style: { position: 'relative', overflowX: 'auto', border: '1px solid rgba(148,163,184,.18)', borderRadius: 8, background: 'rgba(3,6,12,.7)' } },
          h('div', { style: { position: 'relative', minWidth: width } }, h('div', { style: { position: 'relative', height: 18 } }, ...ticks), ...lanes, ...markers, phNode))),
      h('div', { 'data-inspector-panel': '1', style: css.panel }, h('div', { style: css.title }, 'Clip inspector'), this._dmInspector(tl)),
      this._dmCuePanel(p), this._dmTracks(p));
  };
})();
