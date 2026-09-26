// DexDiffusion media-neutral UI layer: Voice, Music and Video workspaces,
// reusable reference-audio staging, a mixed-media Library panel, worker and
// resource status, and "waiting for Big Mac" feedback.
//
// Voice/Music/Video workers are dormant until installed and proven: controls
// render from the worker registry, but Generate stays disabled with the real
// reason. Private text (speech text, lyrics, descriptions, transcripts) lives
// only in memory (this._mtext) and is never written to localStorage.
(function () {
  'use strict';
  const C = window.DexDiffusionComponent;
  if (!C) return;
  const P = C.prototype;
  const h = (...a) => React.createElement(...a);
  const css = {
    panel: { border: '1px solid rgba(148,163,184,.14)', background: 'rgba(6,10,16,.64)', borderRadius: 9, padding: 12, marginBottom: 12, minWidth: 0 },
    title: { fontSize: 12, fontWeight: 800, color: '#cbd5e1', letterSpacing: '.06em', textTransform: 'uppercase' },
    label: { fontSize: 10, color: '#7f8ca8', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 4, fontWeight: 700, display: 'block' },
    input: { width: '100%', border: '1px solid rgba(148,163,184,.16)', background: 'rgba(5,10,18,.72)', color: '#e2e8f0', borderRadius: 7, padding: '8px 9px', outline: 'none', fontSize: 13, fontFamily: "'DM Sans',sans-serif", minHeight: 36 },
    row: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' },
    muted: { fontSize: 11, color: '#8193a8', lineHeight: 1.45 },
    mono: { fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, color: '#94a3b8', overflowWrap: 'anywhere' },
    grid2: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,220px),1fr))', gap: 10 },
  };
  const tone = { ok: '#65d66e', warn: '#fbbf24', bad: '#f87171', info: '#38bdf8', off: '#94a3b8' };
  const btn = (label, onClick, color, extra) => h('button', Object.assign({ type: 'button', onClick,
    style: { border: '1px solid ' + (color || '#38bdf8') + '66', background: (color || '#38bdf8') + '16', color: color || '#38bdf8', borderRadius: 7, padding: '7px 11px', minHeight: 36, fontSize: 12, cursor: 'pointer', fontWeight: 700, fontFamily: "'DM Sans',sans-serif" } }, extra || {}), label);
  const chip = (text, color) => h('span', { style: { border: '1px solid ' + color + '55', color, background: color + '12', borderRadius: 6, padding: '2px 7px', fontSize: 10, fontWeight: 700 } }, text);
  const fmtTime = s => (s == null || !isFinite(s)) ? '—' : Math.floor(s / 60) + ':' + String(Math.round(s % 60)).padStart(2, '0');

  // ── state ────────────────────────────────────────────────────────
  P._mws = function () {
    if (!this.mws) this.mws = { voiceMode: 'speech', workers: null, resources: null, lib: { kind: 'all', items: [], counts: {}, showTest: false, loading: false }, refs: {}, seed: '', speed: 1, language: 'auto', duration: 60, instrumental: false, influence: 0.5 };
    if (!this._mtext) this._mtext = {}; // private text: memory only
    return this.mws;
  };
  P.mSet = function (patch) { Object.assign(this._mws(), patch); this.setState({ _mTick: (this.state._mTick || 0) + 1 }); };
  P.loadWorkers = async function () {
    try {
      const [w, r] = await Promise.all([fetch(this.state.backendUrl + '/api/workers').then(x => x.json()), fetch(this.state.backendUrl + '/api/resources').then(x => x.json())]);
      this.mSet({ workers: w.workers, resources: r });
    } catch (_) {}
  };
  P._worker = function (id) { return ((this._mws().workers) || []).find(w => w.id === id) || null; };

  // Persistent media elements: the runtime rebuilds vnodes each render, so a
  // cached real <audio>/<video> node keeps playback position across renders.
  P._mediaEl = function (url, kind) {
    this._mediaEls = this._mediaEls || new Map();
    let el = this._mediaEls.get(url);
    if (!el) {
      el = document.createElement(kind === 'video' ? 'video' : 'audio');
      el.src = url; el.controls = true; el.preload = 'metadata';
      el.style.cssText = 'width:100%;min-height:40px;display:block;border-radius:8px;';
      el.setAttribute('aria-label', kind + ' player');
      this._mediaEls.set(url, el);
    }
    return el;
  };

  // ── reusable reference-audio stager (Voice Clone, Music reference) ─
  P.stageReference = async function (slot, file) {
    if (!file) return;
    if (file.size > 40 * 1024 * 1024) { this.toast('Audio too large (40 MB max)', '#ef4444'); return; }
    const r = await fetch(this.state.backendUrl + '/api/staging?accept=audio', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file });
    const d = await r.json().catch(() => ({ error: r.statusText }));
    if (!r.ok) { this.toast(d.error || 'Reference rejected', '#ef4444'); return; }
    const prev = this._mws().refs[slot];
    if (prev) fetch(this.state.backendUrl + '/api/staging/' + prev.id, { method: 'DELETE' });
    this.mSet({ refs: Object.assign({}, this._mws().refs, { [slot]: d }) });
    this.toast('Reference staged · ' + fmtTime(d.duration), '#a78bfa');
  };
  P.removeReference = function (slot) {
    const prev = this._mws().refs[slot];
    if (prev) fetch(this.state.backendUrl + '/api/staging/' + prev.id, { method: 'DELETE' });
    const refs = Object.assign({}, this._mws().refs); delete refs[slot];
    this.mSet({ refs });
  };
  P.buildReferenceStager = function (slot, label) {
    const ref = this._mws().refs[slot], base = this.state.backendUrl;
    const input = h('input', { type: 'file', accept: 'audio/wav,audio/x-wav,audio/mpeg,audio/mp4,audio/x-m4a,audio/flac,.wav,.mp3,.m4a,.flac', style: { display: 'none' }, onChange: e => this.stageReference(slot, e.target.files[0]) });
    return h('div', { style: { display: 'grid', gap: 6, minWidth: 0 } },
      h('span', { style: css.label }, label),
      ref ? h('div', { style: { display: 'grid', gap: 6, border: '1px solid rgba(167,139,250,.3)', borderRadius: 8, padding: 8 } },
        this._mediaEl(base + ref.url, 'audio'),
        h('div', { style: css.row }, chip(ref.mime, '#a78bfa'), h('span', { style: css.muted }, fmtTime(ref.duration) + ' · ' + Math.round(ref.bytes / 1024) + ' KB · temporary (24 h)'),
          h('label', { style: { color: '#c4b5fd', fontSize: 12, cursor: 'pointer', fontWeight: 700, padding: '7px 4px' } }, 'Replace', input),
          btn('Remove', () => this.removeReference(slot), '#f87171')))
        : h('label', { style: { border: '1px dashed rgba(167,139,250,.5)', color: '#c4b5fd', borderRadius: 8, padding: '12px', minHeight: 44, cursor: 'pointer', fontSize: 12, fontWeight: 700, display: 'block' },
          onDragover: e => e.preventDefault(), onDrop: e => { e.preventDefault(); this.stageReference(slot, e.dataTransfer.files[0]); } },
          'Add reference audio (WAV / MP3 / M4A / FLAC, ≤ 10 min) — click or drop', input));
  };

  // ── shared pieces ─────────────────────────────────────────────────
  P._workerCard = function (id) {
    const w = this._worker(id);
    if (!w) return h('div', { style: css.muted }, 'Loading worker status…');
    const flag = (k, v) => h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12 } }, h('span', { style: { color: '#94a3b8' } }, k), h('span', { style: { color: v ? tone.ok : tone.warn, fontWeight: 700 } }, v ? 'Yes' : 'No'));
    return h('div', { style: Object.assign({}, css.panel, { marginBottom: 0 }) },
      h('div', { style: Object.assign({}, css.row, { marginBottom: 6 }) }, h('span', { style: { fontWeight: 800, color: '#e2e8f0' } }, 'Worker: ' + w.label), chip(w.state, w.enabled ? tone.ok : tone.warn)),
      flag('Architecture ready', w.architecture_available), flag('Runtime installed', w.runtime_available), flag('Model installed', w.model_available),
      flag('Generation enabled', w.enabled), flag('Proven', w.proven),
      w.activation ? h('details', { style: { marginTop: 6 } }, h('summary', { style: Object.assign({}, css.muted, { cursor: 'pointer' }) }, '▸ Activation path'),
        h('div', { style: css.mono }, w.activation + ' Runtime: ' + w.runtimePath + ' · Model: ' + w.modelPath)) : null);
  };
  P._generateBar = function (workerId, kind, operation) {
    const w = this._worker(workerId);
    const enabled = !!(w && w.enabled);
    return h('div', { style: Object.assign({}, css.row, { marginTop: 10 }) },
      h('button', { type: 'button', disabled: !enabled, 'aria-disabled': String(!enabled), title: enabled ? 'Generate' : 'Runtime/model not installed',
        style: { flex: '1 1 220px', minHeight: 44, borderRadius: 9, border: 0, fontWeight: 800, fontSize: 14, cursor: enabled ? 'pointer' : 'not-allowed',
          background: enabled ? 'linear-gradient(90deg,#8b5cf6,#22d3ee)' : 'rgba(148,163,184,.12)', color: enabled ? '#06060a' : '#94a3b8' },
        onClick: () => enabled && this.mediaGenerate(workerId, kind, operation) }, enabled ? 'Generate' : 'Generate — Runtime/model not installed'),
      h('span', { style: css.muted }, enabled ? '' : 'Install and prove ' + ((w && w.label) || workerId) + ' to enable. Nothing is downloaded from here.'));
  };
  P.mediaGenerate = async function (worker, kind, operation) {
    const r = await fetch(this.state.backendUrl + '/api/media/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ media_kind: kind, worker, operation, save_prompts: !!this.state.savePrompts }) });
    const d = await r.json().catch(() => ({}));
    this.toast((d.error || 'Generation unavailable') + (d.gate ? ' · ' + d.gate : ''), '#fbbf24');
  };
  P._resultArea = function (kind) {
    const items = ((this._mws().lib.items) || []).filter(i => i.kind === kind).slice(0, 4);
    return h('div', { style: css.panel },
      h('div', { style: Object.assign({}, css.title, { marginBottom: 8 }) }, 'Results'),
      items.length ? h('div', { style: { display: 'grid', gap: 8 } }, ...items.map(i => this._mediaCard(i)))
        : h('div', { style: css.muted }, 'No ' + kind + ' results yet. Finished ' + kind + ' files will play here with position, duration, volume, model and seed, and appear in the Library.'));
  };
  const field = (label, control) => h('label', { style: { display: 'grid', gap: 4, minWidth: 0 } }, h('span', { style: css.label }, label), control);
  P._text = function (key, placeholder, rows) {
    return h('textarea', { rows: rows || 3, value: this._mtext[key] || '', placeholder, onChange: e => { this._mtext[key] = e.target.value; }, style: Object.assign({}, css.input, { resize: 'vertical' }) });
  };
  P._input = function (key, attrs) { const m = this._mws(); return h('input', Object.assign({ value: String(m[key] ?? ''), onChange: e => this.mSet({ [key]: e.target.value }), style: css.input }, attrs || {})); };

  // ── Voice ─────────────────────────────────────────────────────────
  P.buildVoiceWorkspace = function () {
    const m = this._mws();
    const modes = [['speech', 'Speech'], ['clone', 'Voice Clone'], ['design', 'Voice Design']];
    const common = h('div', { style: css.grid2 },
      field('Worker / model', h('select', { style: css.input, value: 'qwen3-tts' }, h('option', { value: 'qwen3-tts' }, 'Qwen3-TTS (not installed)'))),
      field('Language', h('select', { style: css.input, value: m.language, onChange: e => this.mSet({ language: e.target.value }) }, ...['auto', 'en', 'zh', 'ja', 'ko', 'de', 'fr', 'es'].map(l => h('option', { value: l }, l)))),
      field('Seed', this._input('seed', { type: 'number', min: '0', placeholder: 'random' })),
      field('Speed', this._input('speed', { type: 'number', min: '0.5', max: '2', step: '0.05' })));
    const body = m.voiceMode === 'speech' ? h('div', { style: { display: 'grid', gap: 10 } },
      field('Text to speak', this._text('voiceText', 'What should be said…', 4)),
      field('Voice / profile', h('select', { style: css.input }, h('option', null, 'Default voice'))),
      field('Style / instruction', this._text('voiceStyle', 'e.g. calm, warm, slightly slower', 2)))
      : m.voiceMode === 'clone' ? h('div', { style: { display: 'grid', gap: 10 } },
        this.buildReferenceStager('voiceRef', 'Reference voice audio'),
        field('Reference transcript', this._text('voiceTranscript', 'Exact words spoken in the reference (improves cloning)', 2)),
        field('Profile name', this._input('profileName', { placeholder: 'e.g. Narrator A' })),
        field('Text to speak', this._text('voiceText', 'What the cloned voice should say…', 3)))
      : h('div', { style: { display: 'grid', gap: 10 } },
        field('Voice description', this._text('voiceDescription', 'e.g. middle-aged, gravelly, British, measured pace', 3)),
        field('Text to speak', this._text('voiceText', 'Preview line…', 3)),
        h('div', { style: css.muted }, 'Saved voice designs will appear under Voice / profile once the worker is active.'));
    return h('div', { style: { display: 'grid', gap: 12, minWidth: 0 } },
      h('div', { style: css.panel },
        h('div', { style: Object.assign({}, css.row, { marginBottom: 10 }) }, h('div', { style: css.title }, 'Voice'), ...modes.map(([k, l]) => btn(l, () => this.mSet({ voiceMode: k }), m.voiceMode === k ? '#a78bfa' : '#94a3b8'))),
        body, h('div', { style: { height: 10 } }), common,
        h('div', { style: Object.assign({}, css.muted, { marginTop: 8 }) }, this.state.savePrompts ? 'Prompt saving is on: text may be kept with results.' : 'Prompt saving is off: text stays in this tab only and is never stored.'),
        this._generateBar('qwen3-tts', 'voice', m.voiceMode)),
      this._workerCard('qwen3-tts'), this._resultArea('voice'));
  };

  // ── Music ─────────────────────────────────────────────────────────
  P.buildMusicWorkspace = function () {
    const m = this._mws();
    return h('div', { style: { display: 'grid', gap: 12, minWidth: 0 } },
      h('div', { style: css.panel },
        h('div', { style: Object.assign({}, css.title, { marginBottom: 10 }) }, 'Music'),
        h('div', { style: { display: 'grid', gap: 10 } },
          field('Song description', this._text('musicPrompt', 'e.g. dreamy synth-pop about a night drive', 3)),
          h('label', { style: Object.assign({}, css.row, { color: '#dbe4ee', fontSize: 12 }) }, h('input', { type: 'checkbox', checked: !!m.instrumental, onChange: e => this.mSet({ instrumental: e.target.checked }) }), 'Instrumental (no vocals)'),
          m.instrumental ? null : field('Lyrics', this._text('musicLyrics', '[verse]\n…\n[chorus]\n…', 5)),
          h('div', { style: css.grid2 },
            field('Style', this._input('style', { placeholder: 'e.g. lo-fi' })), field('Genre', this._input('genre', { placeholder: 'e.g. electronic' })),
            field('Mood', this._input('mood', { placeholder: 'e.g. wistful' })), field('Instrumentation', this._input('instruments', { placeholder: 'e.g. piano, pads, 808' })),
            field('Duration (s)', this._input('duration', { type: 'number', min: '10', max: '600' })), field('Seed', this._input('seed', { type: 'number', min: '0', placeholder: 'random' })),
            field('Worker / model', h('select', { style: css.input }, h('option', null, 'ACE-Step (not installed)')))),
          this.buildReferenceStager('musicRef', 'Reference audio (optional)'),
          m.refs.musicRef ? field('Reference influence · ' + Number(m.influence).toFixed(2), h('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(m.influence), onChange: e => this.mSet({ influence: e.target.value }), style: { minHeight: 30 } })) : null,
          h('div', { style: css.muted }, 'Available controls will follow the installed worker; not every worker supports every control.')),
        this._generateBar('ace-step', 'music', 'song')),
      this._workerCard('ace-step'), this._resultArea('music'));
  };

  // ── Video (dormant slot) ─────────────────────────────────────────
  P.buildVideoWorkspace = function () {
    return h('div', { style: { display: 'grid', gap: 12, minWidth: 0 } },
      h('div', { style: css.panel },
        h('div', { style: Object.assign({}, css.title, { marginBottom: 6 }) }, 'Video'),
        h('div', { style: css.muted }, 'Video generation is not implemented yet. This slot shows the planned LTX worker truthfully; nothing here generates or downloads anything.'),
        this._generateBar('ltx-video', 'video', 'clip')),
      this._workerCard('ltx-video'));
  };

  // ── Library: mixed media ─────────────────────────────────────────
  P.loadMediaLibrary = async function (kind) {
    const m = this._mws(), k = kind || m.lib.kind;
    this.mSet({ lib: Object.assign({}, m.lib, { kind: k, loading: true }) });
    try {
      const d = await fetch(this.state.backendUrl + '/api/library?kind=' + encodeURIComponent(k) + (m.lib.showTest ? '&show_test=1' : '')).then(r => r.json());
      this.mSet({ lib: Object.assign({}, this._mws().lib, { items: d.items || [], counts: d.counts || {}, loading: false }) });
    } catch (_) { this.mSet({ lib: Object.assign({}, this._mws().lib, { loading: false }) }); }
  };
  P._mediaCard = function (i) {
    const base = this.state.backendUrl;
    if (i.kind === 'image') return h('button', { type: 'button', onClick: () => this.selectLibraryImage(i.artifact_id), title: i.artifact_id,
      style: { padding: 0, border: '1px solid rgba(148,163,184,.16)', borderRadius: 8, overflow: 'hidden', background: '#0a0e14', cursor: 'pointer', aspectRatio: '1 / 1', position: 'relative' } },
      h('img', { src: base + i.url, alt: i.artifact_id, loading: 'lazy', style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' } }),
      h('span', { style: { position: 'absolute', left: 0, right: 0, bottom: 0, background: 'rgba(4,8,14,.78)', color: '#dbe4ee', fontSize: 10, padding: '3px 5px', textAlign: 'left' } },
        (i.keeper ? '★ ' : '') + (i.test_artifact ? '[test] ' : '') + (i.operation || 'image')));
    return h('div', { style: { gridColumn: '1 / -1', border: '1px solid rgba(148,163,184,.16)', borderRadius: 8, padding: 8, display: 'grid', gap: 6, minWidth: 0 } },
      h('div', { style: css.row }, chip(i.kind, i.kind === 'voice' ? '#a78bfa' : i.kind === 'music' ? '#22d3ee' : '#f59e0b'), h('span', { style: css.mono }, i.artifact_id),
        h('span', { style: css.muted }, fmtTime(i.duration) + (i.model ? ' · ' + i.model : '') + (i.seed != null ? ' · seed ' + i.seed : '') + (i.keeper ? ' · ★' : ''))),
      this._mediaEl(base + i.url, i.kind === 'video' ? 'video' : 'audio'));
  };
  P.buildMediaLibraryPanel = function () {
    const m = this._mws(), lib = m.lib;
    if (!lib.loadedOnce) { lib.loadedOnce = true; setTimeout(() => this.loadMediaLibrary(), 0); }
    const kinds = [['all', 'All'], ['image', 'Images'], ['voice', 'Voice'], ['music', 'Music'], ['video', 'Video'], ['keepers', '★ Keepers']];
    const c = lib.counts || {};
    return h('div', { style: css.panel },
      h('div', { style: Object.assign({}, css.row, { marginBottom: 8 }) }, h('div', { style: css.title }, 'Media Library'),
        h('span', { style: css.muted }, 'images ' + (c.image ?? '—') + ' · voice ' + (c.voice ?? 0) + ' · music ' + (c.music ?? 0) + ' · video ' + (c.video ?? 0))),
      h('div', { style: Object.assign({}, css.row, { marginBottom: 8 }) }, ...kinds.map(([k, l]) => btn(l, () => this.loadMediaLibrary(k), lib.kind === k ? '#38bdf8' : '#94a3b8')),
        h('label', { style: Object.assign({}, css.row, { fontSize: 11, color: '#94a3b8' }) }, h('input', { type: 'checkbox', checked: !!lib.showTest, onChange: e => { lib.showTest = e.target.checked; this.loadMediaLibrary(); } }), 'Show test artifacts')),
      lib.items.length ? h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(84px,1fr))', gap: 6, maxHeight: 360, overflowY: 'auto' } }, ...lib.items.slice(0, 120).map(i => this._mediaCard(i)))
        : h('div', { style: css.muted }, lib.loading ? 'Loading…' : (lib.kind === 'voice' || lib.kind === 'music' || lib.kind === 'video') ? 'No ' + lib.kind + ' yet — the worker is not installed.' : 'Nothing here.'),
      h('div', { style: Object.assign({}, css.muted, { marginTop: 6 }) }, 'Select an image to open its actions, lineage and compare tools below.'));
  };

  // ── System / Models: workers + resources ─────────────────────────
  P.buildWorkersPanel = function () {
    const m = this._mws(), rs = m.resources;
    if (!m.workersLoadedOnce) { m.workersLoadedOnce = true; setTimeout(() => this.loadWorkers(), 0); }
    const row = w => h('div', { key: w.id, style: { display: 'grid', gridTemplateColumns: 'minmax(0,1.3fr) minmax(0,1fr)', gap: 6, fontSize: 12, padding: '5px 0', borderBottom: '1px solid rgba(148,163,184,.06)' } },
      h('div', { style: { minWidth: 0 } }, h('div', { style: { color: '#e2e8f0', fontWeight: 700 } }, w.label), h('div', { style: css.muted }, w.media_kind + ' · ' + w.resource_class + ' resource')),
      h('div', { style: { display: 'flex', gap: 4, flexWrap: 'wrap', alignContent: 'start' } }, chip(w.state || '—', w.enabled && w.proven ? tone.ok : tone.warn),
        chip('runtime ' + (w.runtime_available ? '✓' : '✗'), w.runtime_available ? tone.ok : tone.off), chip('model ' + (w.model_available ? '✓' : '✗'), w.model_available ? tone.ok : tone.off),
        chip(w.proven ? 'proven' : 'not proven', w.proven ? tone.ok : tone.off)));
    return h('div', { style: css.panel },
      h('div', { style: Object.assign({}, css.row, { marginBottom: 8 }) }, h('div', { style: css.title }, 'Workers & Big Mac resources'), h('div', { style: { flex: 1 } }), btn('Refresh', () => this.loadWorkers(), '#94a3b8')),
      ...((m.workers || []).map(row)),
      rs ? h('div', { style: { marginTop: 8, display: 'grid', gap: 3, fontSize: 12 } },
        h('div', null, h('b', { style: { color: '#cbd5e1' } }, 'Heavy compute: '), h('span', { style: css.mono }, rs.group + ' · capacity ' + rs.capacity)),
        h('div', null, h('b', { style: { color: '#cbd5e1' } }, 'Owner: '), h('span', { style: css.mono }, rs.owner ? rs.owner.label + ' (since ' + new Date(rs.owner.since).toLocaleTimeString() + ')' : 'none')),
        h('div', null, h('b', { style: { color: '#cbd5e1' } }, 'Waiting: '), h('span', { style: css.mono }, rs.waiting.length ? rs.waiting.map(w => '#' + w.position + ' ' + w.label).join(' · ') : 'none')),
        h('div', null, h('b', { style: { color: '#cbd5e1' } }, 'External heavy load: '), h('span', { style: css.mono }, rs.external.occupied ? rs.external.detail : 'none detected (read-only ollama ps)'))) : null,
      h('details', { style: { marginTop: 8 } }, h('summary', { style: Object.assign({}, css.muted, { cursor: 'pointer' }) }, '▸ Raw worker data'),
        h('pre', { style: Object.assign({}, css.mono, { whiteSpace: 'pre-wrap', maxHeight: 240, overflow: 'auto' }) }, JSON.stringify({ workers: m.workers, resources: rs }, null, 1))));
  };

  // ── "Waiting for Big Mac" status while a heavy job holds the queue ──
  P._pollResources = function () {
    const busy = this.state.jobStatus === 'generating' || (this.ws && (this.ws.editStatus === 'running' || this.ws.enhStatus === 'running'));
    if (busy) fetch(this.state.backendUrl + '/api/resources').then(r => r.json()).then(rs => { if (JSON.stringify(rs) !== JSON.stringify(this._mws().resources)) this.mSet({ resources: rs }); }).catch(() => {});
  };
  const _mount = P.componentDidMount;
  P.componentDidMount = function () {
    _mount.call(this);
    this._resTimer = setInterval(() => this._pollResources(), 3000);
    this.loadWorkers();
  };
  const _unmount = P.componentWillUnmount;
  P.componentWillUnmount = function () { clearInterval(this._resTimer); _unmount.call(this); };

  const _setScreen = P.setScreen;
  P.setScreen = function (s) {
    _setScreen.call(this, s);
    if (s === 'library') this.loadMediaLibrary();
    if (['voice', 'music', 'video', 'system', 'models'].includes(s)) this.loadWorkers();
    if (['voice', 'music'].includes(s)) this.loadMediaLibrary(s);
  };

  const _renderVals = P.renderVals;
  P.renderVals = function () {
    const vals = _renderVals.call(this);
    const screen = this.state.screens[this.state.version];
    this._mws();
    for (const k of ['Voice', 'Music', 'Video']) {
      vals['is' + k + 'Str'] = String(screen === k.toLowerCase());
      vals['nav' + k] = () => this.setScreen(k.toLowerCase());
    }
    vals.isMedia = ['voice', 'music', 'video'].includes(screen);
    vals.mediaWorkspace = screen === 'voice' ? this.buildVoiceWorkspace() : screen === 'music' ? this.buildMusicWorkspace() : screen === 'video' ? this.buildVideoWorkspace() : null;
    const workers = this.buildWorkersPanel();
    vals.doctorPanel = h('div', null, vals.doctorPanel, workers);
    vals.modelsListDisplay = h('div', null, this.buildWorkersPanel(), vals.modelsListDisplay);
    vals.libraryWorkbench = h('div', null, this.buildMediaLibraryPanel(), vals.libraryWorkbench);
    // Heavy lease feedback on the Create button.
    const rs = this._mws().resources, aj = this.ws && this.ws.activeJobId;
    if (this.state.jobStatus === 'generating' && rs && aj && rs.waiting.some(w => w.job_id === aj)) {
      vals.generateLabel = 'Waiting for Big Mac — ' + (rs.owner ? rs.owner.label + ' owns heavy compute' : rs.external.occupied ? 'external heavy load' : 'queued');
    }
    return vals;
  };
})();
