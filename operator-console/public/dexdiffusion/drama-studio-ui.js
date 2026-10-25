// Audio Drama Studio — the staged Drama workspace.
//
//   SCRIPT → CAST → DIRECT → PRODUCE → REVIEW → MASTER → EXPORT
//
// These are workflow stages inside the one Drama module (not extra top-level tabs). Every control is wired to a real
// endpoint or is disabled with an honest reason. The advanced manual scene/line/take controls from the original Drama
// workspace remain available under SCRIPT (line editor) and PRODUCE → "Advanced manual rendering".
//
// Privacy: the screenplay lives in the project; job rows, the Job Center and SSE only ever carry indexes, never text.
(function () {
  'use strict';
  const C = window.DexDiffusionComponent;
  if (!C || !window.DexUI) return;
  const P = C.prototype;
  const h = (...a) => React.createElement(...a);
  const { css, tone, btn, chip } = window.DexUI;
  const field = (label, control) => h('label', { style: { display: 'grid', gap: 4, minWidth: 0 } }, h('span', { style: css.label }, label), control);
  const fmtT = s => (s == null || !isFinite(s)) ? '—' : s >= 60 ? Math.floor(s / 60) + ':' + String(Math.round(s % 60)).padStart(2, '0') : s.toFixed(1) + 's';
  const KEY = 'dex_drama_project';
  const STAGES = [['script', 'Script'], ['cast', 'Cast'], ['direct', 'Direct'], ['produce', 'Produce'], ['review', 'Review'], ['master', 'Master'], ['export', 'Export']];
  const TERMINAL = ['complete', 'failed', 'partial', 'cancelled', 'superseded', 'interrupted'];
  const TAKE_TONE = { COMPLETE: tone.ok, APPROVED: '#34d399', OUTDATED: tone.warn, REVIEW_REQUIRED: tone.warn, RENDERING: tone.info, QUEUED: tone.info, FAILED: tone.bad, INTERRUPTED: tone.warn, MISSING: '#94a3b8' };
  const U = window.DexStudio = window.DexStudio || {};
  const REDUCED = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // ── small shared helpers (also used by drama-direct-ui.js and voice-designer-ui.js) ───────────────
  U.h = h; U.field = field; U.fmtT = fmtT; U.TAKE_TONE = TAKE_TONE;
  U.api = (self, route, body, method) => self._vpApi(route, body, method);
  // Cached <canvas> waveform from server-computed peaks (int8 min/max per bin); never decodes audio in the browser.
  U.waveform = function (self, key, peaks, w, hgt, color) {
    self._wfCache = self._wfCache || new Map();
    const k = key + '|' + w + 'x' + hgt + '|' + color;
    let c = self._wfCache.get(k);
    if (!c) {
      c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = hgt; c.style.cssText = 'width:100%;height:' + hgt + 'px;display:block';
      c.setAttribute('role', 'img'); c.setAttribute('aria-label', 'waveform');
      const g = c.getContext('2d'), n = peaks.max.length, mid = hgt / 2;
      g.fillStyle = color;
      for (let x = 0; x < c.width; x++) { const i = Math.min(n - 1, Math.floor(x * n / c.width)); g.fillRect(x, mid - (peaks.max[i] / 127) * mid, 1, Math.max(1, ((peaks.max[i] - peaks.min[i]) / 127) * mid)); }
      self._wfCache.set(k, c);
    }
    return c;
  };
  U.peaks = async function (self, artifactId, bins) {
    self._peakCache = self._peakCache || new Map(); const k = artifactId + '|' + bins;
    if (self._peakCache.has(k)) return self._peakCache.get(k);
    const r = await self._vpApi('/api/voice/peaks/' + encodeURIComponent(artifactId) + '?bins=' + bins); if (!r.ok) return null;
    self._peakCache.set(k, r.data); return r.data;
  };
  U.stateOf = function (p, prod) {
    if (!p) return { key: 'none', label: 'No project', tone: '#94a3b8', next: null };
    const plan = p.plan || {}, c = plan.counts || {};
    if (prod && !TERMINAL.includes(prod.status)) return { key: 'running', label: prod.progress && prod.progress.waiting ? 'Waiting for Big Mac' : 'Producing…', tone: tone.info, next: { label: 'Open Produce', stage: 'produce' } };
    if (prod && prod.status === 'interrupted') return { key: 'interrupted', label: 'Interrupted — resumable', tone: tone.warn, next: { label: 'Resume production', stage: 'produce' } };
    if (prod && (prod.status === 'partial' || prod.status === 'failed')) return { key: 'partial', label: 'Last run had failures', tone: tone.bad, next: { label: 'Review failures', stage: 'produce' } };
    if ((p.unresolved || []).length) return { key: 'missing-cast', label: 'Voices missing', tone: tone.warn, next: { label: 'Cast voices', stage: 'cast' } };
    if ((p.parse_warnings || []).length && !p.productions.length) return { key: 'parsing', label: 'Review the parse', tone: tone.warn, next: { label: 'Review script', stage: 'script' } };
    if (!plan.ready) return { key: 'blocked', label: 'Blocked: ' + ((plan.blocking_errors || [])[0] || {}).code, tone: tone.bad, next: { label: 'See why', stage: 'produce' } };
    if ((c.stale || 0) > 0) return { key: 'stale', label: c.stale + ' take' + (c.stale > 1 ? 's' : '') + ' out of date', tone: tone.warn, next: { label: 'Produce changes', stage: 'produce' } };
    if (plan.work_required) return { key: 'ready', label: 'Ready to produce', tone: tone.ok, next: { label: 'Produce entire drama', stage: 'produce' } };
    const last = (p.productions || [])[0], asr = last && last.qa && last.qa.asr && last.qa.asr.state;
    if (p.project_master && last && last.acceptance && last.acceptance.state === 'approved') return { key: 'verified', label: 'Verified export available', tone: tone.ok, next: { label: 'Export', stage: 'export' } };
    if (p.project_master) return { key: 'needs-review', label: asr === 'REVIEW' ? 'Complete — speech review suggested' : 'Complete — needs your listening review', tone: tone.info, next: { label: 'Review', stage: 'review' } };
    return { key: 'ready', label: 'Up to date', tone: tone.ok, next: { label: 'Produce', stage: 'produce' } };
  };

  // ── data ──────────────────────────────────────────────────────────────────────────────────────────
  P.dmStage = function (stage) { this.dmSet({ stage }); };
  P.dmFollowProduction = function (id) {
    clearInterval(this._dmProdTimer); const self = this;
    const projectId = this._dm().currentId, token = this._dmProdOwner = {};
    const ownsProd = () => self._dmProdOwner === token && self._dm().currentId === projectId;
    const tick = async () => {
      if (!ownsProd()) return;
      const r = await self._vpApi('/api/drama/productions/' + id);
      if (!ownsProd()) return;
      if (!r.ok) { clearInterval(self._dmProdTimer); self.dmSet({ production: { id, status: 'failed', errors: [{ message: 'Lost track of the production (' + (r.data.error || r.status) + '). Finished work is kept; start again to resume.' }] } }); return; }
      self.dmSet({ production: r.data.production, current: r.data.project }, { skipIfTyping: true });
      if (TERMINAL.includes(r.data.production.status)) { clearInterval(self._dmProdTimer); self.loadMediaLibrary && self.loadMediaLibrary('voice'); self.dmLoadHistory(); self.toast('Production ' + r.data.production.status, r.data.production.status === 'complete' ? '#65d66e' : '#fbbf24'); }
    };
    tick(); this._dmProdTimer = setInterval(tick, 1200);
  };
  P.dmProduce = async function (body) {
    const owner = this._dmProjectOwner();
    if (!owner || await this._dmFlush() === false || !this._dmOwnsProject(owner)) return;
    const dm = this._dm();
    const r = await this._vpApi('/api/drama/projects/' + owner.id + '/produce', body || {});
    if (!this._dmOwnsProject(owner)) return;
    if (!r.ok) { dm.produceBlock = r.data; this.dmSet({ error: r.data.error }); this.toast((r.data.error || 'Production refused').slice(0, 140), '#ef4444'); return; }
    dm.produceBlock = null; this.dmSet({ current: r.data.project, production: r.data.production, error: null }); this.dmFollowProduction(r.data.production.id);
  };
  P.dmCancelProduction = async function () {
    const dm = this._dm(); if (!dm.production) return;
    const r = await this._vpApi('/api/drama/productions/' + dm.production.id + '/cancel', {}); this.toast(r.ok ? 'Cancelling after the current Big Mac render…' : (r.data.error || 'Could not cancel'), r.ok ? '#fbbf24' : '#ef4444');
  };
  P.dmLoadHistory = async function () {
    const owner = this._dmProjectOwner(); if (!owner) return;
    const r = await this._vpApi('/api/drama/projects/' + owner.id + '/history'); if (r.ok && this._dmOwnsProject(owner)) this.dmSet({ history: r.data.productions }, { skipIfTyping: true });
  };
  P.dmSaveSettings = async function (what, body) {
    const owner = this._dmProjectOwner(); if (!owner) return;
    const r = await this._vpApi('/api/drama/projects/' + owner.id + '/' + what, body, 'PUT');
    if (!this._dmOwnsProject(owner)) return;
    if (!r.ok) { this.toast(r.data.error || 'Could not save', '#ef4444'); return; } this.dmSet({ current: r.data.project });
  };
  P.dmReparsePreview = async function (apply, confirm) {
    const dm = this._dm(), t = this._dmText; if (!dm.current || !String(t.script || '').trim()) { this.toast('Edit the script first', '#fbbf24'); return; }
    const owner = this._dmProjectOwner();
    const r = await this._vpApi('/api/drama/projects/' + owner.id + '/reparse', { script: t.script, mode: dm.mode, apply: !!apply, confirm: !!confirm });
    if (!this._dmOwnsProject(owner)) return;
    if (!r.ok && r.status !== 409) { this.dmSet({ parseResult: r.data }); this.toast((r.data.errors || [r.data.error])[0], '#ef4444'); return; }
    if (r.status === 409) { this.dmSet({ reparse: { preview: r.data.preview, needsConfirm: true } }); return; }
    if (r.data.applied) { this._dmText = { script: '', title: '' }; this._dmResetEdits(); this._dmStopRunTracking(); this.dmSet({ current: r.data.project, reparse: null, parseResult: { ok: true } }); this.toast('Re-parsed; recordings were kept where the text still matches', '#65d66e'); }
    else this.dmSet({ reparse: { preview: r.data.preview, needsConfirm: r.data.preview.requires_confirmation } });
  };

  // ── pieces ──────────────────────────────────────────────────────────────────────────────────────
  P._dmStageBar = function (p) {
    const dm = this._dm(), st = U.stateOf(p, dm.production);
    return h('div', { 'data-drama-stages': '1' },
      h('div', { role: 'tablist', 'aria-label': 'Drama workflow', style: Object.assign({}, css.row, { gap: 4 }) }, ...STAGES.map(([id, label], i) => {
        const sel = dm.stage === id;
        return h('button', { key: id, type: 'button', role: 'tab', 'aria-selected': String(sel), 'data-stage': id, onClick: () => this.dmStage(id),
          style: { minHeight: 36, border: '1px solid ' + (sel ? '#e11d68' : 'rgba(148,163,184,.25)'), background: sel ? 'rgba(225,29,104,.16)' : 'transparent', color: sel ? '#fda4af' : '#cbd5e1', borderRadius: 8, padding: '4px 12px', fontSize: 12, fontWeight: 800, cursor: 'pointer', letterSpacing: '.04em' } }, (i + 1) + ' · ' + label.toUpperCase());
      })),
      h('div', { 'data-drama-state': st.key, role: 'status', style: Object.assign({}, css.row, { marginTop: 6 }) }, chip(st.label, st.tone), st.next ? btn(st.next.label + ' →', () => this.dmStage(st.next.stage), st.tone, { 'data-next-step': st.next.stage }) : null));
  };
  P._dmCoverage = function (p) {
    const c = p.source && p.source.coverage; if (!c) return null;
    return h('div', { 'data-source-coverage': String(c.ok), style: Object.assign({}, css.row, { fontSize: 11 }) },
      c.ok === true ? chip('✓ every character of the script is classified (' + (c.classified_chars || 0) + ')', tone.ok) : c.ok === false ? chip('✗ ' + c.unclassified + ' unclassified span(s), ' + c.mismatches + ' line mismatch(es)', tone.bad) : chip('LLM parse: verbatim-checked', tone.info),
      chip('source rev ' + p.source.rev, '#94a3b8'), p.archived_lines ? chip(p.archived_lines + ' archived line(s)', '#94a3b8') : null);
  };
  P._dmReparsePanel = function (p) {
    const rp = this._dm().reparse; if (!rp) return null;
    const pv = rp.preview, s = pv.summary;
    return h('div', { 'data-reparse-preview': '1', role: 'region', 'aria-label': 'Re-parse preview', style: Object.assign({}, css.panel, { borderColor: pv.requires_confirmation ? 'rgba(251,191,36,.6)' : 'rgba(56,189,248,.5)' }) },
      h('div', { style: css.title }, 'Re-parse preview — nothing has changed yet'),
      h('div', { style: css.row }, chip(s.unchanged + ' unchanged', tone.ok), chip(s.changed + ' edited', tone.info), chip(s.moved + ' moved', tone.info), chip(s.added + ' new', '#a78bfa'), chip(s.removed + ' removed → archived', tone.warn), s.ambiguous ? chip(s.ambiguous + ' ambiguous', tone.bad) : null, chip(s.takes_preserved + ' recordings kept', tone.ok), s.takes_archived ? chip(s.takes_archived + ' recordings archived', tone.warn) : null),
      ...pv.conflicts.map((c, i) => h('div', { key: 'c' + i, style: { color: tone.warn, fontSize: 12 } }, '⚠ ' + c.type + ' — ' + (c.speaker || '') + ': ' + (c.detail || ''))),
      ...pv.warnings.map((w, i) => h('div', { key: 'w' + i, style: css.muted }, 'ℹ ' + w.type + ': ' + (w.detail || ''))),
      h('details', null, h('summary', { style: Object.assign({}, css.muted, { cursor: 'pointer' }) }, '▸ Line-by-line changes'), h('div', { style: { display: 'grid', gap: 2, marginTop: 4 } }, ...pv.items.filter(i => i.status !== 'unchanged').slice(0, 80).map((i, k) => h('div', { key: k, style: css.mono }, i.status.toUpperCase().padEnd(8) + ' ' + i.speaker + ': ' + i.text_preview + (i.takes ? '  [' + i.takes + ' take(s)]' : ''))))),
      h('div', { style: css.row }, btn(rp.needsConfirm ? 'Apply anyway (ambiguous recordings are archived)' : 'Apply re-parse', () => this.dmReparsePreview(true, true), rp.needsConfirm ? '#fbbf24' : '#65d66e', { 'data-reparse-apply': '1' }), btn('Cancel', () => this.dmSet({ reparse: null }), '#94a3b8')));
  };

  // SCRIPT ------------------------------------------------------------------------------------------
  P._dmStageScript = function (p, speakers) {
    const dm = this._dm(), t = this._dmText;
    const scriptPanel = h('div', { 'data-drama-script': '1', style: css.panel },
      h('div', { style: Object.assign({}, css.row, { marginBottom: 8 }) }, h('div', { style: css.title }, 'Script (original — authoritative)'), h('div', { style: { flex: 1 } }),
        ...[['deterministic', 'Deterministic parser'], ['llm', 'Local model (Ollama) parser']].map(([k, l]) => btn(l, () => this.dmSet({ mode: k }), dm.mode === k ? '#a78bfa' : '#94a3b8', { 'data-parse-mode': k }))),
      h('div', { style: Object.assign({}, css.muted, { marginBottom: 6 }) }, dm.mode === 'llm' ? 'The local model proposes speakers, narration/dialogue and delivery cues. Its output is validated against a strict schema and every line must be verbatim text from your script — it can never rewrite dialogue; invalid output is rejected.' : 'Reads "NAME: text", "NAME: [quietly] text", "NAME (whispering): text", screenplay cues, scene headings (INT./EXT./# Title), [pause 2s], sound cues ([SFX: …], [MUSIC: …], [AMBIENCE: …]) and narration paragraphs. No model involved.'),
      this._dmCoverage(p),
      field('Title', h('input', { value: t.title || p.title, placeholder: 'Untitled drama', style: css.input, onInput: e => { t.title = e.target.value; } })),
      h('textarea', { rows: 6, 'data-drama-script-input': '1', value: t.script || p.source_script, style: Object.assign({}, css.input, { resize: 'vertical', fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, marginTop: 6 }), onInput: e => { t.script = e.target.value; } }),
      h('div', { style: Object.assign({}, css.row, { marginTop: 8 }) }, btn('Re-parse script (preview first)', () => this.dmReparsePreview(false, false), '#fbbf24', { 'data-reparse': '1' }), h('span', { style: css.muted }, 'Matching is by content, never by position: reordered lines keep their own recordings; ambiguous matches need your confirmation.')),
      dm.parseResult && dm.parseResult.ok === false ? h('div', { role: 'alert', 'data-parse-error': '1', style: { color: tone.bad, fontSize: 12, marginTop: 6 } }, '✗ ' + (dm.parseResult.errors || []).join(' · ')) : null,
      (p.parse_warnings || []).length ? h('div', { style: { color: tone.warn, fontSize: 12, marginTop: 6 } }, '⚠ ' + p.parse_warnings.join(' ')) : null);
    const scenes = p.scenes.map(sc => {
      const open = !dm.collapsed[sc.id];
      return h('div', { key: sc.id, 'data-scene': sc.id, style: css.panel },
        h('div', { style: css.row }, h('button', { type: 'button', 'aria-expanded': String(open), onClick: () => { dm.collapsed[sc.id] = open; this.dmSet({}); }, style: { border: 0, background: 'transparent', color: '#e2e8f0', fontWeight: 800, fontSize: 14, cursor: 'pointer', minHeight: 36 } }, (open ? '▾ ' : '▸ ') + sc.title), h('span', { style: css.muted }, sc.lines.length + ' lines')),
        open ? h('div', { style: { display: 'grid', gap: 8, marginTop: 8 } }, ...sc.lines.map(l => this._dmLine(p, sc, l, speakers))) : null);
    });
    return h('div', { style: { display: 'grid', gap: 12 } }, this._dmReparsePanel(p), scriptPanel, h('div', { style: css.title }, 'Parsed script — review & correct'), ...scenes);
  };

  // PRODUCE -----------------------------------------------------------------------------------------
  P._dmPlanPanel = function (p) {
    const plan = p.plan || { counts: {}, blocking_errors: [] }, c = plan.counts || {};
    return h('div', { 'data-drama-plan': plan.ready ? 'ready' : 'blocked', style: css.panel },
      h('div', { style: css.row }, h('div', { style: css.title }, 'Incremental plan'), h('span', { style: css.muted }, 'what would run right now')),
      h('div', { style: Object.assign({}, css.row, { marginTop: 6 }) }, chip((c.reuse || 0) + ' reusable', tone.ok), chip((c.new || 0) + ' new', tone.info), chip((c.stale || 0) + ' out of date', (c.stale || 0) ? tone.warn : '#94a3b8'), chip((c.in_flight || 0) + ' in flight', '#94a3b8'), (c.blocked || 0) ? chip(c.blocked + ' blocked', tone.bad) : null, chip(plan.review_items + ' review item(s)', plan.review_items ? tone.warn : '#94a3b8'), plan.asset_problems ? chip(plan.asset_problems + ' asset problem(s)', tone.bad) : null),
      h('div', { style: Object.assign({}, css.row, { marginTop: 6 }) }, ...(plan.assembly || []).map(a => chip('scene ' + a.scene_id.replace('sc-', '') + ': ' + (a.action === 'reuse' ? 'up to date' : a.action === 'rebuild' ? 'remix only' : a.action === 'rebuild-after-speech' ? 'needs speech' : 'blocked'), a.action === 'reuse' ? tone.ok : a.action === 'blocked' ? tone.bad : tone.info))),
      ...(plan.blocking_errors || []).map((b, i) => h('div', { key: i, role: 'alert', style: { color: tone.bad, fontSize: 12, marginTop: 4 } }, '✗ ' + b.code + ' — ' + b.message)),
      !(plan.blocking_errors || []).length && !plan.work_required ? h('div', { style: { color: tone.ok, fontSize: 12, marginTop: 6 } }, '✓ Everything is current: producing again only reuses the existing master.') : null);
  };
  P._dmProductionPanel = function (p) {
    const dm = this._dm(), pr = dm.production || p.active_production; if (!pr) return null;
    const running = !TERMINAL.includes(pr.status), pg = pr.progress || {}, pct = pg.total ? Math.round((pg.done || 0) / pg.total * 100) : null;
    const PH = ['planning', 'rendering', 'assembling', 'mastering', 'publishing', 'reviewing', 'complete'];
    const tint = running ? tone.info : pr.status === 'complete' ? tone.ok : pr.status === 'cancelled' ? tone.warn : tone.bad;
    return h('div', { 'data-production': pr.status, role: 'status', 'aria-live': 'polite', style: Object.assign({}, css.panel, { borderColor: tint + '88' }) },
      h('div', { style: css.row }, h('b', { style: { color: tint, fontSize: 14 } }, running ? 'Producing' : 'Production ' + pr.status + (pr.noop ? ' (nothing to do — reused existing master)' : '')), h('span', { style: css.mono }, pr.id), h('div', { style: { flex: 1 } }), running ? btn('Cancel after current render', () => this.dmCancelProduction(), '#f87171', { 'data-cancel-production': '1' }) : null),
      h('div', { style: Object.assign({}, css.row, { gap: 4 }) }, ...PH.map(ph => chip(ph, ph === pr.phase || (ph === 'complete' && pr.status === 'complete') ? tint : PH.indexOf(ph) < PH.indexOf(pr.phase) ? tone.ok : '#64748b'))),
      running ? h('div', { 'data-production-label': '1', style: { color: '#cbd5e1', fontSize: 12 } }, pg.label || '…') : null,
      h('div', { style: { height: 6, background: 'rgba(255,255,255,.08)', borderRadius: 3, overflow: 'hidden' }, role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': pct == null ? undefined : pct }, h('div', { style: { height: '100%', width: (pct == null ? (running ? 8 : 100) : pct) + '%', background: 'linear-gradient(90deg,#e11d68,#f59e0b)', transition: REDUCED() ? 'none' : 'width .4s' } })),
      h('div', { style: css.row }, chip('chunks cached ' + pr.chunks.cached, tone.ok), chip('generated ' + pr.chunks.generated, tone.info), pr.chunks.invalid ? chip('invalid receipts ' + pr.chunks.invalid, tone.warn) : null, pr.chunks.retries ? chip('retries ' + pr.chunks.retries, tone.warn) : null, pr.chunks.failed ? chip('failed ' + pr.chunks.failed, tone.bad) : null, chip('lines reused ' + pr.lines.reused + ' · generated ' + pr.lines.generated, '#94a3b8')),
      pr.superseded ? h('div', { style: { color: tone.warn, fontSize: 12 } }, 'The script or cast changed during production. The new recordings are saved — produce again to assemble the current version (only what changed will run).') : null,
      ...(pr.errors || []).map((e, i) => h('div', { key: i, style: { color: tone.bad, fontSize: 12, overflowWrap: 'anywhere' } }, '✗ ' + (e.code ? e.code + ': ' : '') + (e.line_id ? e.line_id + ' — ' : '') + (e.message || ''))),
      !running && (pr.status === 'partial' || pr.status === 'failed' || pr.status === 'cancelled' || pr.status === 'superseded') ? h('div', { style: css.row }, btn('Resume / retry (only missing work runs)', () => this.dmProduce({}), '#fbbf24', { 'data-resume-production': '1' }), h('span', { style: css.muted }, 'Verified chunks and finished lines are kept; they are not regenerated.')) : null,
      pr.status === 'complete' && p.project_master ? h('div', { style: css.row }, btn('Review →', () => this.dmStage('review'), tone.info), btn('Master →', () => this.dmStage('master'), tone.info), btn('Export →', () => this.dmStage('export'), tone.ok)) : null);
  };
  P._dmStageProduce = function (p) {
    const dm = this._dm(), pr = dm.production || p.active_production, running = pr && !TERMINAL.includes(pr.status), plan = p.plan || {};
    const cannot = running || !plan.ready || (p.unresolved || []).length;
    const block = dm.produceBlock && dm.produceBlock.plan;
    const wait = !plan.ready ? 'Blocked — see the plan below' : (p.unresolved || []).length ? 'Cast voices first' : running ? 'Production running…' : plan.work_required ? 'PRODUCE ENTIRE DRAMA' : 'PRODUCE (everything is current)';
    const mainBtn = h('button', { type: 'button', 'data-produce': '1', 'aria-busy': String(!!running), disabled: !!cannot, onClick: () => !cannot && this.dmProduce({}),
      style: { minHeight: 52, width: '100%', borderRadius: 11, border: 0, fontWeight: 900, fontSize: 16, letterSpacing: '.06em', cursor: cannot ? 'not-allowed' : 'pointer', background: cannot ? 'rgba(148,163,184,.2)' : 'linear-gradient(90deg,#e11d68,#f59e0b)', color: cannot ? '#94a3b8' : '#16060d' } }, wait);
    const adv = h('details', { 'data-advanced-render': '1', open: dm.advOpen ? '' : null, onToggle: e => { dm.advOpen = e.target.open; }, style: { border: '1px solid rgba(148,163,184,.16)', borderRadius: 9, padding: '6px 10px' } },
      h('summary', { style: Object.assign({}, css.title, { cursor: 'pointer', minHeight: 36, display: 'flex', alignItems: 'center' }) }, '▸ Advanced manual rendering (scene / line / alternate takes)'),
      h('div', { style: { display: 'grid', gap: 8, marginTop: 8 } },
        h('div', { style: css.muted }, 'Manual renders use the same incremental plan and add NEW takes; they never replace a recording. One-click production is preferred because it groups lines per voice (fewer model loads).'),
        h('div', { style: css.row }, btn('Render project (resume)', () => this.dramaRender({ scope: 'project', resume: true }), '#38bdf8', { disabled: !!running || (dm.run && dm.run.status === 'running'), 'data-render-project': '1' }),
          ...p.scenes.filter(s => s.lines.some(l => l.render !== false && l.kind !== 'direction')).map(sc => btn('Render “' + sc.title.slice(0, 22) + '”', () => this.dramaRender({ scope: 'scene', scene_id: sc.id, resume: true }), '#38bdf8', { disabled: !!running || (dm.run && dm.run.status === 'running'), 'data-render-scene': sc.id }))),
        this._dmRunPanel(p), dm.error ? h('div', { role: 'alert', style: { color: tone.bad, fontSize: 12 } }, '✗ ' + dm.error) : null));
    return h('div', { style: { display: 'grid', gap: 12 } },
      (p.unresolved || []).length ? h('div', { 'data-drama-unresolved-produce': '1', role: 'alert', style: { color: '#fde68a', fontSize: 12, border: '1px solid rgba(251,191,36,.5)', borderRadius: 9, padding: '8px 10px' } }, '⚠ These speakers have no usable voice yet: ' + p.unresolved.map(u => u.speaker + ' (' + u.lines + ', ' + u.reason + ')').join(', ') + '.') : null,
      mainBtn, h('div', { style: css.muted }, 'Production validates the script and cast, plans only what changed, renders missing speech grouped per voice on Big Mac through the shared compute queue, remixes only the scenes that changed, masters, encodes, verifies and writes a proof report. Progress below mirrors the global Job Center and never shows script text.'),
      this._dmPlanPanel(p), this._dmProductionPanel(p), adv);
  };

  // REVIEW ------------------------------------------------------------------------------------------
  P.dmRunQa = async function (asr) {
    const dm = this._dm(), owner = this._dmProjectOwner(); if (!owner) return; this.dmSet({ qaBusy: true });
    const r = await this._vpApi('/api/drama/projects/' + owner.id + '/qa', { asr });
    if (!this._dmOwnsProject(owner)) { this.dmSet({ qaBusy: false }); return; }
    this.dmSet({ qaBusy: false, qa: r.ok ? r.data : null, current: r.ok ? r.data.project : dm.current });
    this.toast(r.ok ? 'Review finished: ' + r.data.summary.hard_failures.length + ' hard failure(s), speech check ' + r.data.summary.asr.state : (r.data.error || 'Review failed'), r.ok && !r.data.summary.hard_failures.length ? '#65d66e' : '#ef4444');
  };
  P.dmTakeAction = async function (lineId, takeId, what, body) {
    const owner = this._dmProjectOwner(); if (!owner) return;
    const r = await this._vpApi(`/api/drama/projects/${owner.id}/lines/${lineId}/takes/${takeId}/${what}`, body || {});
    if (!this._dmOwnsProject(owner)) return;
    if (!r.ok) { this.toast(r.data.error || 'Action failed', '#ef4444'); return; } this.dmSet({ current: r.data.project });
  };
  P.dmPacingPreview = async function (lineId, tempo) {
    const id = this._dm().current.id; const r = await this._vpApi(`/api/drama/projects/${id}/lines/${lineId}/pacing-preview`, { tempo }); this.dmSet({ pacing: Object.assign({}, this._dm().pacing, { [lineId]: r.ok ? r.data : { error: r.data.error, warnings: r.data.warnings } }) });
  };
  P._dmStageReview = function (p) {
    const dm = this._dm(), qa = dm.qa, base = this.state.backendUrl;
    const qaBy = new Map(((qa && qa.lines) || []).map(l => [l.line_id, l]));
    const st = this._vp && this._vp().qaStatus;
    if (!dm.qaStatusLoaded) { dm.qaStatusLoaded = true; this._vpApi('/api/drama/qa/status').then(r => { if (r.ok) this.dmSet({ qaStatus: r.data }, { skipIfTyping: true }); }); }
    const qs = dm.qaStatus;
    const header = h('div', { style: css.panel },
      h('div', { style: css.row }, h('div', { style: css.title }, 'Review'), h('span', { style: css.muted }, 'Hard integrity failures are deterministic. Speech recognition below is advisory evidence only.'), h('div', { style: { flex: 1 } }),
        btn(dm.qaBusy ? 'Checking…' : 'Run integrity + speech checks', () => this.dmRunQa(true), tone.info, { disabled: !!dm.qaBusy, 'data-run-qa': '1' }), btn('Integrity only', () => this.dmRunQa(false), '#94a3b8', { disabled: !!dm.qaBusy })),
      qs ? h('div', { 'data-asr-status': qs.asr.available ? 'available' : 'unavailable', style: Object.assign({}, css.row, { marginTop: 6 }) }, chip(qs.asr.available ? 'Local speech check: whisper.cpp ready (' + (qs.asr.model || '').split('/').pop() + ')' : 'Local speech check: UNAVAILABLE', qs.asr.available ? tone.ok : tone.warn), qs.asr.available ? null : h('span', { style: css.muted }, qs.asr.reason), chip('speech-boundary: energy detector' + (qs.silero.available ? '' : ' (Silero not installed)'), '#94a3b8')) : null,
      qa ? h('div', { 'data-qa-summary': qa.summary.asr.state, style: Object.assign({}, css.row, { marginTop: 6 }) }, chip(qa.summary.checked + ' takes checked', '#94a3b8'), chip(qa.summary.hard_failures.length + ' hard failure(s)', qa.summary.hard_failures.length ? tone.bad : tone.ok), chip(qa.summary.advisories.length + ' advisory', qa.summary.advisories.length ? tone.warn : '#94a3b8'), chip('speech check: ' + qa.summary.asr.state, qa.summary.asr.state === 'PASS' ? tone.ok : qa.summary.asr.state === 'REVIEW' ? tone.warn : '#94a3b8')) : null);
    const lineCards = p.scenes.flatMap(sc => sc.lines.filter(l => l.render !== false && l.kind !== 'direction').map(l => {
      const q = qaBy.get(l.id), active = l.takes.find(t => t.active) || l.takes.find(t => t.status === 'complete');
      const pace = (dm.pacing || {})[l.id];
      return h('div', { key: l.id, 'data-review-line': l.id, style: { border: '1px solid rgba(148,163,184,.16)', borderRadius: 9, padding: 8, display: 'grid', gap: 6 } },
        h('div', { style: css.row }, h('b', { style: { color: '#e2e8f0' } }, l.speaker), h('span', { style: css.mono }, l.id), chip(l.freshness === 'current' ? 'current' : l.freshness === 'stale' ? 'out of date' : 'no take', l.freshness === 'current' ? tone.ok : l.freshness === 'stale' ? tone.warn : '#94a3b8'),
          q ? chip(q.integrity_ok ? 'integrity ✓' : 'integrity ✗ ' + q.hard.map(x => x.code).join(','), q.integrity_ok ? tone.ok : tone.bad) : null, q && q.asr ? chip('speech: ' + q.asr.status, q.asr.status === 'PASS' ? tone.ok : q.asr.status === 'REVIEW' ? tone.warn : '#94a3b8') : null),
        h('div', { style: css.muted }, l.text.length > 160 ? l.text.slice(0, 157) + '…' : l.text),
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,260px),1fr))', gap: 6 } }, ...l.takes.filter(t => t.status !== 'failed' || t.error).map((t, i) => h('div', { key: t.id, 'data-review-take': t.id, style: { border: '1px solid ' + (t.active ? 'rgba(101,214,110,.5)' : 'rgba(148,163,184,.14)'), borderRadius: 8, padding: 6, display: 'grid', gap: 4 } },
          h('div', { style: css.row }, h('b', { style: { fontSize: 11 } }, 'Take ' + (i + 1)), chip(t.state ? t.state.label : t.status, TAKE_TONE[t.state && t.state.label] || '#94a3b8'), t.measure && t.measure.wpm ? chip(t.measure.wpm + ' wpm', '#94a3b8') : null, t.human_review ? chip('you: ' + t.human_review.state, t.human_review.state === 'heard-ok' ? tone.ok : tone.warn) : null),
          t.url ? this._mediaEl(base + t.url, 'audio', 'rv-' + t.id) : null,
          t.status === 'complete' ? h('div', { style: css.row }, t.active ? chip('✓ in master', tone.ok) : btn('Use', () => this.dramaSelectTake(l.id, t.id), '#65d66e'),
            t.state && t.state.label === 'APPROVED' ? btn('Unapprove', () => this.dmTakeAction(l.id, t.id, 'approve', { approved: false }), '#94a3b8') : btn('Approve', () => this.dmTakeAction(l.id, t.id, 'approve', { approved: true }), '#34d399', { disabled: !(t.state && t.state.freshness === 'current'), title: t.state && t.state.freshness !== 'current' ? 'Only a take that matches the current line, voice and settings can be approved' : '' }),
            btn('Heard OK', () => this.dmTakeAction(l.id, t.id, 'review', { state: 'heard-ok' }), tone.ok), btn('Needs work', () => this.dmTakeAction(l.id, t.id, 'review', { state: 'needs-work' }), tone.warn),
            t.legacy && !t.adopted_legacy ? btn('Adopt (matches current text)', () => this.dmTakeAction(l.id, t.id, 'adopt'), tone.warn, { title: 'Pre-fingerprint recording: confirm it matches the line as written now' }) : null) : null))),
        q && q.asr && q.asr.status === 'REVIEW' ? h('div', { style: { fontSize: 12, color: tone.warn } }, 'Listen for: ' + [...(q.asr.missing || []).map(m => 'possibly missing “' + m.text + '” (word ' + (m.at_word + 1) + ')'), ...(q.asr.repeated || []).map(r => 'repeated “' + r.text + '”'), ...(q.asr.pronunciation_suspects || []).map(s => '“' + s.expected + '” heard as “' + s.heard + '”'), q.asr.incomplete ? 'the ending may be cut off' : null].filter(Boolean).join(' · ') + '. ' + (q.asr.limitations || '')) : null,
        q && q.advisory && q.advisory.length ? h('div', { style: { fontSize: 12, color: tone.warn } }, 'Advisory: ' + q.advisory.map(a => a.message).join('; ')) : null,
        active && l.takes.some(t => t.status === 'complete') ? h('div', { style: css.row }, btn('Suggest trim (silence)', async () => { const owner = this._dmProjectOwner(); if (!owner || owner.id !== p.id) return; const r = await this._vpApi(`/api/drama/projects/${owner.id}/lines/${l.id}/apply-trim`, {}); if (!this._dmOwnsProject(owner)) return; this.toast(r.ok ? 'Trim saved on the clip (original untouched)' : (r.data.error || 'No trim'), r.ok ? '#65d66e' : '#fbbf24'); if (r.ok) this.dmSet({ current: r.data.project }); }, '#94a3b8'),
          btn('Preview ×1.25 pace', () => this.dmPacingPreview(l.id, 1.25), '#94a3b8'), pace && pace.result ? h('span', { style: css.muted }, pace.original.wpm + ' → ' + pace.result.wpm + ' wpm (verified)') : null, pace && pace.error ? h('span', { style: { color: tone.warn, fontSize: 11 } }, pace.error) : null) : null,
        pace && pace.result ? h('div', { style: { display: 'grid', gap: 3 } }, this._mediaEl(base + pace.result.url, 'audio', 'pace-' + l.id), ...(pace.warnings || []).map((w, i) => h('div', { key: i, style: { color: tone.warn, fontSize: 11 } }, '⚠ ' + w))) : null);
    }));
    return h('div', { style: { display: 'grid', gap: 12 } }, header, ...lineCards);
  };

  // MASTER ------------------------------------------------------------------------------------------
  P.dmAcceptance = async function (productionId, state) {
    const note = window.prompt(state === 'approved' ? 'Optional note for your listening acceptance:' : 'What was wrong?', '') || '';
    const r = await this._vpApi('/api/drama/productions/' + productionId + '/acceptance', { state, note }); if (!r.ok) { this.toast(r.data.error || 'Could not record', '#ef4444'); return; }
    await this.dmLoadHistory(); await this.dmLoadProof(productionId); this.toast('Listening acceptance recorded: ' + state, '#65d66e');
  };
  P.dmLoadProof = async function (id) { const r = await this._vpApi('/api/drama/productions/' + id + '/proof'); if (r.ok) this.dmSet({ proof: r.data }, { skipIfTyping: true }); };
  P._dmStageMaster = function (p) {
    const dm = this._dm(), m = p.mastering || {}, dlv = p.delivery || { formats: ['mp3', 'm4b'], stems: false }, mix = p.mix || {}, pm = p.project_master;
    if (!dm.presets) { dm.presets = {}; this._vpApi('/api/drama/mastering/presets').then(r => { if (r.ok) this.dmSet({ presets: r.data }, { skipIfTyping: true }); }); }
    const presets = (dm.presets && dm.presets.presets) || [];
    const last = (p.productions || [])[0], pid = last && last.id;
    if (pid && (!dm.proof || dm.proof.proof.production_id !== pid) && !dm._proofAsked) { dm._proofAsked = pid; this.dmLoadProof(pid); }
    const pf = dm.proof && dm.proof.proof;
    const mr = pm && pm.mastering;
    return h('div', { style: { display: 'grid', gap: 12 } },
      h('div', { 'data-mastering': '1', style: css.panel }, h('div', { style: css.title }, 'Mastering & delivery'),
        h('div', { style: css.muted }, 'The 24-bit/48 kHz WAV master is always produced. Loudness is measured (ITU-R BS.1770) before and after; the result states exactly what was and was not applied.'),
        h('div', { style: css.grid2 }, field('Delivery preset', h('select', { 'data-mastering-preset': '1', value: m.preset || 'drama', style: css.input, onChange: e => this.dmSaveSettings('mastering', { preset: e.target.value }) }, ...presets.map(x => h('option', { key: x.id, value: x.id }, x.label + (x.target_lufs != null ? ' · ' + x.target_lufs + ' LUFS / ' + x.ceiling_dbtp + ' dBTP' : ' · untouched'))))),
          field('Formats encoded from the master', h('div', { style: css.row }, ...['mp3', 'm4b', 'm4a', 'flac'].map(f => h('label', { key: f, style: { display: 'flex', gap: 4, alignItems: 'center', fontSize: 12, color: '#cbd5e1', minHeight: 32 } }, h('input', { type: 'checkbox', checked: dlv.formats.includes(f), 'data-format': f, onChange: e => this.dmSaveSettings('delivery', { formats: e.target.checked ? [...dlv.formats, f] : dlv.formats.filter(x => x !== f) }) }), f.toUpperCase() + (f === 'm4b' ? ' (chapters)' : ''))), h('label', { style: { display: 'flex', gap: 4, alignItems: 'center', fontSize: 12, color: '#cbd5e1' } }, h('input', { type: 'checkbox', checked: !!dlv.stems, 'data-stems': '1', onChange: e => this.dmSaveSettings('delivery', { stems: e.target.checked }) }), 'Stems (dialogue/music/ambience/SFX)')))),
        h('div', { style: css.grid2 },
          field('Music ducking under dialogue (dB)', h('input', { type: 'number', min: '-30', max: '0', step: '1', value: String(mix.duck_db), style: css.input, onChange: e => this.dmSaveSettings('mix', { duck_db: e.target.value }) })),
          field('Dialogue levelling target (dBFS RMS, blank = off)', h('input', { type: 'number', min: '-40', max: '-6', step: '1', value: mix.dialogue_leveling == null ? '' : String(mix.dialogue_leveling), placeholder: 'off', style: css.input, onChange: e => this.dmSaveSettings('mix', { dialogue_leveling: e.target.value === '' ? null : e.target.value }) }))),
        h('div', { style: css.muted }, 'Changing mastering, formats or mix never re-renders speech; only the affected scenes are remixed and the master re-encoded. Pacing (speed) is optional, off by default and set per actor in CAST.')),
      mr ? h('div', { 'data-mastering-result': mr.applied ? 'applied' : 'not-applied', style: css.panel }, h('div', { style: css.title }, 'Last master'),
        h('div', { style: css.row }, chip(mr.applied ? 'mastering applied: ' + (mr.gain_db > 0 ? '+' : '') + mr.gain_db + ' dB' : 'mastering NOT applied', mr.applied ? tone.ok : tone.warn), mr.limiter_engaged ? chip('true-peak limiter engaged', tone.warn) : chip('no limiter needed', '#94a3b8'),
          mr.after ? chip('measured ' + mr.after.integrated_lufs + ' LUFS', tone.info) : null, mr.after ? chip('true peak ' + mr.after.true_peak_dbtp + ' dBTP', tone.info) : null, mr.before ? chip('before ' + mr.before.integrated_lufs + ' LUFS', '#94a3b8') : null),
        mr.reason ? h('div', { style: css.muted }, mr.reason) : null) : null,
      pf ? this._dmProofPanel(pf, dm.proof.verification) : (last ? h('div', { style: css.muted }, 'Loading proof report…') : h('div', { style: css.muted }, 'Produce the drama to create a proof report.')));
  };
  P._dmProofPanel = function (pf, ver) {
    const ok = v => (v ? '✓' : '✗');
    return h('div', { 'data-proof': pf.production_id, style: css.panel },
      h('div', { style: css.row }, h('div', { style: css.title }, 'Production proof'), chip(ver && ver.ok ? 'matches master checksum' : 'DOES NOT MATCH master', ver && ver.ok ? tone.ok : tone.bad), h('span', { style: css.mono }, 'proof ' + pf.proof_sha256.slice(0, 12) + '…')),
      h('div', { style: css.muted }, 'Items marked ✓ were checked by software. Whether the performance is good is your call — recorded below.'),
      h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,230px),1fr))', gap: 6, marginTop: 6 } },
        ...[['Source coverage', ok(pf.completeness.source_coverage_ok !== false) + ' rev ' + pf.source.rev], ['Lines covered', pf.completeness.lines_covered + ' / ' + pf.completeness.lines_total], ['Rendered / reused', pf.counts.lines_rendered + ' / ' + pf.counts.lines_reused], ['Required cues unresolved', String(pf.cues.required_unresolved)],
          ['Master decodes', ok(pf.integrity.decodable)], ['Finite samples', ok(pf.integrity.finite)], ['Length matches plan', ok(pf.integrity.length_matches_plan)], ['Clipped samples', String(pf.integrity.clipped_samples)],
          ['Speech check', pf.asr.state + (pf.asr.model ? ' · ' + pf.asr.model : '')], ['Mastering', pf.mastering ? (pf.mastering.applied ? 'applied ' + pf.mastering.preset : 'not applied') : '—'], ['Engines', pf.provenance.engines.join(', ')], ['Local only', ok(pf.provenance.local_only)]]
          .map(([k, v]) => h('div', { key: k, style: { border: '1px solid rgba(148,163,184,.14)', borderRadius: 7, padding: '5px 8px', display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12 } }, h('span', { style: { color: '#94a3b8' } }, k), h('b', { style: { color: '#e2e8f0', overflowWrap: 'anywhere', textAlign: 'right' } }, v)))),
      pf.asr.state === 'UNAVAILABLE' ? h('div', { style: { color: tone.warn, fontSize: 12, marginTop: 6 } }, 'ℹ Speech verification did not run: ' + (pf.asr.reason || 'unavailable') + ' This is not a pass.') : null,
      h('div', { 'data-acceptance': pf.human_acceptance.state, style: Object.assign({}, css.row, { marginTop: 8 }) }, h('b', { style: { fontSize: 12, color: '#cbd5e1' } }, 'Human listening acceptance:'), chip(pf.human_acceptance.state, pf.human_acceptance.state === 'approved' ? tone.ok : pf.human_acceptance.state === 'rejected' ? tone.bad : tone.warn),
        btn('Approve after listening', () => this.dmAcceptance(pf.production_id, 'approved'), tone.ok, { 'data-accept': '1' }), btn('Reject', () => this.dmAcceptance(pf.production_id, 'rejected'), tone.bad), btn('Reset to pending', () => this.dmAcceptance(pf.production_id, 'pending'), '#94a3b8')),
      pf.human_acceptance.note ? h('div', { style: css.muted }, '“' + pf.human_acceptance.note + '”') : null);
  };

  // EXPORT ------------------------------------------------------------------------------------------
  P.dmCompare = async function (fromId) {
    const dm = this._dm(); const r = await this._vpApi('/api/drama/projects/' + dm.current.id + '/revisions?from=' + encodeURIComponent(fromId) + '&to=current');
    this.dmSet({ revision: r.ok ? Object.assign({ from: fromId }, r.data) : { error: r.data.error } });
  };
  P.dmExportPackage = function () {
    const dm = this._dm(), inc = dm.pkgInclude = dm.pkgInclude || {};
    fetch(this.state.backendUrl + '/api/drama/projects/' + dm.current.id + '/package', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ include: inc }) }).then(async r => {
      if (!r.ok) { const d = await r.json().catch(() => ({})); this.toast(d.error || 'Package failed', '#ef4444'); return; }
      const blob = await r.blob(), a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'dexdiffusion-drama-package.zip'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    });
  };
  P.dmImportPackage = async function (file, apply) {
    if (!file) return; const r = await fetch(this.state.backendUrl + '/api/drama/packages/import' + (apply ? '?apply=1' : ''), { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file });
    const d = await r.json().catch(() => ({ errors: ['unreadable response'] })); this._dmPkgFile = file; this.dmSet({ pkgReport: d });
    if (apply && d.applied) { await this.loadDramaProjects(); this.toast('Imported as a new project', '#65d66e'); }
  };
  // Manual assembly: build an export from the existing takes without synthesising anything. Stale takes are refused unless the
  // user explicitly asks for a historical snapshot, which is labelled as such everywhere.
  P.dramaAssemble = async function (sceneId, historical) {
    const owner = this._dmProjectOwner();
    if (!owner || await this._dmFlush() === false || !this._dmOwnsProject(owner)) return;
    this.dmSet({ busy: true, assembled: null });
    const r = await this._dmApi(`/api/drama/projects/${owner.id}/assemble`, { scene_id: sceneId, historical: !!historical });
    if (!this._dmOwnsProject(owner)) { this.dmSet({ busy: false }); return; }
    this.dmSet({ busy: false });
    if (!r.ok) { const miss = (r.data.missing || []).length; this.dmSet({ assembled: { error: r.data.error + (miss ? ' — ' + r.data.missing.slice(0, 6).map(m => m.speaker + ' ' + m.line_id + ' (' + m.state + ')').join(', ') + (miss > 6 ? '…' : '') : ''), canHistorical: (r.data.missing || []).some(m => m.state === 'stale') } }); this.toast(r.data.error || 'Assemble failed', '#ef4444'); return; }
    this.dmSet({ assembled: r.data, current: r.data.project }); this.loadMediaLibrary && this.loadMediaLibrary('voice'); this.dmLoadHistory();
    this.toast((historical ? 'Historical snapshot exported' : 'Exported') + ' ' + fmtT(r.data.artifact.duration) + (sceneId ? ' scene' : ' drama'), '#65d66e');
  };
  P._dmManualAssembly = function (p) {
    const dm = this._dm(), asm = dm.assembled, base = this.state.backendUrl;
    return h('div', { 'data-manual-assembly': '1', style: css.panel }, h('div', { style: css.title }, 'Assemble now from existing takes (no new speech)'),
      h('div', { style: css.muted }, 'Only recordings that match the current script, voices and settings are used. A deliberately chosen older take can be exported as a clearly labelled HISTORICAL snapshot; it is never presented as the current master.'),
      h('div', { style: css.row }, btn('Assemble full drama', () => this.dramaAssemble(undefined, false), '#22d3ee', { disabled: !!dm.busy, 'data-assemble-project': '1' }), btn('Historical snapshot (selected takes)', () => this.dramaAssemble(undefined, true), '#fbbf24', { disabled: !!dm.busy, 'data-assemble-historical': '1' }),
        ...p.scenes.filter(s => s.lines.some(l => l.render !== false && l.kind !== 'direction')).map(sc => btn('Assemble “' + sc.title.slice(0, 22) + '”', () => this.dramaAssemble(sc.id, false), '#22d3ee', { disabled: !!dm.busy, 'data-assemble-scene': sc.id }))),
      asm ? (asm.error ? h('div', { role: 'alert', 'data-assemble-error': '1', style: { color: tone.bad, fontSize: 12, border: '1px solid rgba(248,113,113,.4)', borderRadius: 9, padding: 10 } }, '✗ ' + asm.error, asm.canHistorical ? h('div', { style: css.muted }, 'Some takes are out of date. Produce again, or export a historical snapshot of the selected takes.') : null)
        : h('div', { 'data-assemble-result': asm.manifest.kind, style: Object.assign({}, css.panel, { borderColor: asm.manifest.current ? 'rgba(101,214,110,.45)' : 'rgba(251,191,36,.5)' }) },
          h('div', { style: css.row }, h('div', { style: css.title }, asm.manifest.current ? 'Exported audio drama (current)' : 'HISTORICAL snapshot — not the current version'), chip(asm.manifest.kind, asm.manifest.current ? tone.ok : tone.warn), asm.manifest.stale_lines && asm.manifest.stale_lines.length ? chip(asm.manifest.stale_lines.length + ' out-of-date take(s) used', tone.warn) : null),
          this._mediaEl(base + asm.artifact.url, 'audio', 'drama-export'),
          h('div', { style: css.muted }, [asm.artifact.artifact_id, fmtT(asm.artifact.duration), asm.manifest.items.length + ' lines', asm.manifest.sample_rate + ' Hz ' + (asm.manifest.channels === 1 ? 'mono' : 'stereo'), 'sha256 ' + asm.artifact.sha256.slice(0, 12) + '…'].join(' · ')),
          h('div', { style: css.row }, h('a', { href: base + asm.artifact.download_url, style: { color: '#7dd3fc', fontSize: 12, fontWeight: 700, padding: '8px 4px' } }, 'Download WAV')))) : null);
  };
  P._dmStageExport = function (p) {
    const dm = this._dm(), base = this.state.backendUrl, pm = p.project_master;
    if (!dm.history && !dm._historyAsked) { dm._historyAsked = true; this.dmLoadHistory(); }
    const hist = dm.history || [], dl = (label, o) => o ? h('a', { key: label, href: base + o.download_url, 'data-download': label, style: { color: '#7dd3fc', fontSize: 12, fontWeight: 700, padding: '8px 6px', minHeight: 36, display: 'inline-flex', alignItems: 'center' } }, '⬇ ' + label) : null;
    const rev = dm.revision && dm.revision.report;
    const inc = dm.pkgInclude = dm.pkgInclude || {};
    const rep = dm.pkgReport;
    return h('div', { style: { display: 'grid', gap: 12 } },
      h('div', { 'data-export-current': pm ? '1' : '0', style: css.panel }, h('div', { style: css.title }, 'Current master'),
        pm ? h('div', { style: { display: 'grid', gap: 6 } }, this._mediaEl(base + p.project_master.url, 'audio', 'master'),
          h('div', { style: css.row }, chip(fmtT(pm.duration), '#94a3b8'), chip('sha256 ' + pm.sha256.slice(0, 12) + '…', '#94a3b8'), pm.mastering ? chip(pm.mastering.applied ? 'mastered ' + pm.mastering.preset : 'not mastered', pm.mastering.applied ? tone.ok : tone.warn) : null),
          h('div', { style: css.row }, dl('WAV master', p.project_master), ...Object.entries(pm.outputs || {}).map(([f, id]) => { const o = (hist[0] && hist[0].outputs && hist[0].outputs[f]) || null; return dl(f.toUpperCase(), o); }),
            ...Object.entries(pm.stems || {}).map(([r, id]) => h('a', { key: r, href: base + '/api/media/' + encodeURIComponent(id) + '/download', style: { color: '#a5b4fc', fontSize: 12, padding: '8px 6px' } }, '⬇ stem · ' + r))),
          pm.chapters && pm.chapters.length ? h('details', null, h('summary', { style: Object.assign({}, css.muted, { cursor: 'pointer' }) }, '▸ Chapters (' + pm.chapters.length + ')'), h('div', { style: css.mono }, pm.chapters.map(c => fmtT(c.start_s) + '  ' + c.title).join('\n'))) : null)
          : h('div', { style: css.muted }, 'No master yet. Use PRODUCE.')),
      this._dmManualAssembly(p),
      h('div', { 'data-scene-masters': '1', style: css.panel }, h('div', { style: css.title }, 'Scene masters (each is the same audio the preview plays)'),
        h('div', { style: { display: 'grid', gap: 6, marginTop: 6 } }, ...p.scenes.map(sc => { const m = (p.scene_masters || {})[sc.id]; return h('div', { key: sc.id, style: css.row }, h('b', { style: { fontSize: 12, color: '#e2e8f0', minWidth: 120 } }, sc.title.slice(0, 40)), m ? [h('a', { key: 'a', href: base + '/api/media/' + encodeURIComponent(m.artifact_id) + '/download', style: { color: '#7dd3fc', fontSize: 12, padding: '8px 6px' } }, '⬇ scene master · ' + fmtT(m.duration))] : chip('not built', '#94a3b8')); }))),
      h('div', { 'data-history': '1', style: css.panel }, h('div', { style: css.title }, 'Productions (earlier versions stay playable and are labelled historical)'),
        ...(hist.length ? hist : []).map(x => h('div', { key: x.id, 'data-production-row': x.id, style: { borderTop: '1px solid rgba(148,163,184,.12)', paddingTop: 6, marginTop: 6, display: 'grid', gap: 4 } },
          h('div', { style: css.row }, chip(x.label, x.current ? tone.ok : x.historical ? tone.warn : '#94a3b8'), h('span', { style: css.mono }, x.id + ' · source rev ' + x.source_rev), x.acceptance ? chip('you: ' + x.acceptance.state, x.acceptance.state === 'approved' ? tone.ok : tone.warn) : null, h('div', { style: { flex: 1 } }),
            x.historical ? btn('Compare with current', () => this.dmCompare(x.id), tone.info, { 'data-compare': x.id }) : null),
          x.master ? h('div', { style: css.row }, this._mediaEl(base + x.master.url, 'audio', 'h-' + x.id), dl('WAV (' + x.label.toLowerCase() + ')', x.master), ...Object.entries(x.outputs || {}).map(([f, o]) => dl(f.toUpperCase(), o))) : null)),
        !hist.length ? h('div', { style: css.muted }, 'No productions yet.') : null),
      dm.revision ? h('div', { 'data-revision': '1', style: css.panel }, h('div', { style: css.title }, 'Director’s revision report'),
        dm.revision.error ? h('div', { style: { color: tone.bad } }, dm.revision.error) : [
          h('div', { key: 's', style: css.row }, chip(rev.summary.dialogue_changed + ' dialogue changed', rev.summary.dialogue_changed ? tone.warn : '#94a3b8'), chip(rev.summary.voice_identity_changed + ' voice identity', rev.summary.voice_identity_changed ? tone.warn : '#94a3b8'), chip(rev.summary.stale_clips + ' clips stale', rev.summary.stale_clips ? tone.warn : '#94a3b8'), chip(rev.summary.needs_regeneration + ' need regeneration', rev.summary.needs_regeneration ? tone.bad : tone.ok), chip(rev.summary.reused + ' reused', tone.ok), chip(rev.summary.remix_only + ' remix-only scene(s)', tone.info), chip(rev.summary.effects_changed + ' effects', '#94a3b8'), chip(rev.summary.cues_changed + ' cues', '#94a3b8'), rev.summary.mastering_changed ? chip('mastering changed', tone.warn) : null),
          h('div', { key: 'm', style: css.muted }, rev.method),
          h('details', { key: 'd' }, h('summary', { style: Object.assign({}, css.muted, { cursor: 'pointer' }) }, '▸ Details'), h('div', { style: css.mono }, [...rev.dialogue_changed.map(x => 'dialogue  ' + x.line_id + ' (' + x.changed.join(', ') + ')'), ...rev.voice_identity_changed.map(x => 'voice     ' + x.line_id + ' (' + x.changed.join(', ') + ')'), ...rev.lines_added.map(x => 'added     ' + x.line_id), ...rev.lines_removed.map(x => 'removed   ' + x.line_id), ...rev.remix_only.map(x => 'remix     ' + x.scene_id + ' [' + x.parts.join(', ') + ']')].join('\n') || 'No differences.'))]) : null,
      h('div', { 'data-package': '1', style: css.panel }, h('div', { style: css.title }, 'Portable project package'),
        h('div', { style: css.muted }, 'Private material is excluded unless you tick it. Reference samples and the screenplay can identify people and unreleased work.'),
        h('div', { style: css.row }, ...[['screenplay', 'Screenplay text'], ['voice_samples', 'Voice reference samples + transcripts'], ['takes', 'Take audio'], ['masters', 'Scene + project masters'], ['stems', 'Stems'], ['timeline', 'Timeline, cues & cast settings']].map(([k, l]) => h('label', { key: k, style: { display: 'flex', gap: 4, alignItems: 'center', fontSize: 12, color: '#cbd5e1', minHeight: 32 } }, h('input', { type: 'checkbox', checked: inc[k] === undefined ? k === 'timeline' : !!inc[k], 'data-pkg': k, onChange: e => { inc[k] = e.target.checked; this.dmSet({}); } }), l))),
        h('div', { style: css.row }, btn('Download package (.zip)', () => this.dmExportPackage(), tone.info, { 'data-package-export': '1' }),
          h('label', { style: { border: '1px dashed rgba(167,139,250,.5)', color: '#c4b5fd', borderRadius: 8, padding: '8px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 700, minHeight: 36 } }, 'Import a package (dry run first)', h('input', { type: 'file', accept: '.zip', style: { display: 'none' }, 'data-package-import': '1', onChange: e => this.dmImportPackage(e.target.files[0], false) }))),
        rep ? h('div', { 'data-package-report': rep.errors && rep.errors.length ? 'error' : 'ok', style: { fontSize: 12, display: 'grid', gap: 3 } }, ...(rep.errors || []).map((e, i) => h('div', { key: 'e' + i, style: { color: tone.bad } }, '✗ ' + e)), ...(rep.warnings || []).map((w, i) => h('div', { key: 'w' + i, style: { color: tone.warn } }, '⚠ ' + w)),
          rep.project ? h('div', { style: css.muted }, rep.project.title + ' · ' + rep.project.scenes + ' scenes · ' + rep.project.lines + ' lines · ' + rep.media.total + ' media file(s)' + (rep.applied ? ' — imported' : '')) : null,
          rep.ok && !rep.applied ? btn('Import as a new project', () => this.dmImportPackage(this._dmPkgFile, true), '#65d66e') : null) : null));
  };

  // ── the workspace ────────────────────────────────────────────────────────────────────────────────
  P.buildDramaWorkspace = function () {
    const dm = this._dm();
    if (!dm.stage) dm.stage = 'script';
    if (!dm.loadedOnce) { dm.loadedOnce = true; setTimeout(() => this.loadDramaProjects(), 0); }
    const t = this._dmText, p = dm.current;
    const updateUnsavedScriptIndicator = () => {
      const indicator = document.querySelector('[data-drama-draft-state]');
      if (!indicator) return;
      const dirty = !!(String(t.script || '').trim() || String(t.title || '').trim());
      indicator.dataset.dramaDraftState = dirty ? 'unsaved' : 'empty';
      indicator.textContent = dirty ? 'UNSAVED SCRIPT · held in memory only until parsed into a project' : 'No unsaved script draft';
    };
    const projectList = h('div', { style: css.row }, h('span', { style: css.muted }, 'Projects'), h('select', { 'aria-label': 'Open project', value: dm.currentId || '', style: Object.assign({}, css.input, { width: 'auto', minWidth: 200 }), onChange: e => { if (e.target.value) this.openDramaProject(e.target.value); else if (this._confirmDramaDraftDiscard('leave the current project')) { try { sessionStorage.removeItem(KEY); } catch (_) {} this.dmSet({ current: null, currentId: null }); this.setActiveAssetSelection && this.setActiveAssetSelection(null); } else this.dmSet({}); } },
      h('option', { value: '' }, (dm.projects && dm.projects.length ? '— open a project (' + dm.projects.length + ') —' : '— no projects yet —')), ...((dm.projects || []).map(x => h('option', { key: x.id, value: x.id }, (x.saved ? '💾 ' : '🕒 ') + x.title + ' · ' + x.lines + ' lines')))),
      p ? btn('＋ New from script', () => { if (!this._confirmDramaDraftDiscard('start a new script')) return; try { sessionStorage.removeItem(KEY); } catch (_) {} this.dmSet({ current: null, currentId: null, production: null, history: null, proof: null, qa: null, revision: null, reparse: null }); this.setActiveAssetSelection && this.setActiveAssetSelection(null); }, '#94a3b8') : null,
      h('label', { style: { border: '1px dashed rgba(167,139,250,.5)', color: '#c4b5fd', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', fontSize: 12, fontWeight: 700 } }, 'Import package', h('input', { type: 'file', accept: '.zip', style: { display: 'none' }, onChange: e => { this.dmStage('export'); this.dmImportPackage(e.target.files[0], false); } })));
    if (!p) {
      const scriptPanel = h('div', { 'data-drama-script': '1', style: css.panel },
        h('div', { style: Object.assign({}, css.row, { marginBottom: 8 }) }, h('div', { style: css.title }, 'Paste a script'), h('div', { style: { flex: 1 } }),
          ...[['deterministic', 'Deterministic parser'], ['llm', 'Local model (Ollama) parser']].map(([k, l]) => btn(l, () => this.dmSet({ mode: k }), dm.mode === k ? '#a78bfa' : '#94a3b8', { 'data-parse-mode': k }))),
        h('div', { 'data-drama-draft-state': (String(t.script || '').trim() || String(t.title || '').trim()) ? 'unsaved' : 'empty', role: 'status', 'aria-live': 'polite', style: { color: (String(t.script || '').trim() || String(t.title || '').trim()) ? '#fde68a' : tone.off, fontSize: 11, marginBottom: 6 } }, (String(t.script || '').trim() || String(t.title || '').trim()) ? 'UNSAVED SCRIPT · held in memory only until parsed into a project' : 'No unsaved script draft'),
        h('div', { style: Object.assign({}, css.muted, { marginBottom: 6 }) }, dm.mode === 'llm' ? 'The local model proposes speakers, narration/dialogue and delivery cues. Its output is validated against a strict schema and every line must be verbatim text from your script — it can never rewrite dialogue; invalid output is rejected.' : 'Reads "NAME: text", "NAME: [quietly] text", "NAME (whispering): text", screenplay cues, scene headings (INT./EXT./# Title), [pause 2s], sound cues ([SFX: …], [MUSIC: …], [AMBIENCE: …]) and narration paragraphs. No model involved.'),
        field('Title', h('input', { value: t.title, placeholder: 'Untitled drama', style: css.input, onInput: e => { t.title = e.target.value; updateUnsavedScriptIndicator(); } })),
        h('textarea', { rows: 12, 'data-drama-script-input': '1', value: t.script, placeholder: 'INT. WAREHOUSE - NIGHT\n[AMBIENCE: rain on a tin roof, loop]\nTIGER: I warned you.\nCODEC: [quietly] I know.\n\nThe rain hammers the roof.', style: Object.assign({}, css.input, { resize: 'vertical', fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, marginTop: 6 }), onInput: e => { t.script = e.target.value; updateUnsavedScriptIndicator(); } }),
        h('div', { style: Object.assign({}, css.row, { marginTop: 8 }) }, btn(dm.busy ? 'Parsing…' : 'Parse script', () => this.createDramaProject(), '#65d66e', { 'data-parse': '1', disabled: dm.busy })),
        dm.parseResult && dm.parseResult.ok === false ? h('div', { role: 'alert', 'data-parse-error': '1', style: { color: tone.bad, fontSize: 12, marginTop: 6 } }, '✗ ' + (dm.parseResult.errors || []).join(' · '), ...(dm.parseResult.rejected || []).slice(0, 5).map((r, i) => h('div', { key: i, style: css.mono }, 'rejected: ' + r.speaker + ': ' + r.text))) : null);
      return h('div', { 'data-drama': '1', style: { display: 'grid', gap: 12, minWidth: 0 } }, projectList, scriptPanel,
        h('div', { style: css.muted }, 'Drama turns a script into a multi-voice audio drama: SCRIPT → CAST → DIRECT → PRODUCE → REVIEW → MASTER → EXPORT. Everything runs on your machines; no cloud speech, ever.'),
        dm.pkgReport ? this._dmStageExport({ scenes: [], tracks: [], exports: [], project_master: null }) : null);
    }
    const speakers = [...new Set(p.scenes.flatMap(s => s.lines.map(l => l.speaker)))];
    const done = p.scenes.reduce((n, s) => n + s.lines.filter(l => l.freshness === 'current').length, 0), total = p.scenes.reduce((n, s) => n + s.lines.filter(l => l.render !== false && l.kind !== 'direction').length, 0);
    let body;
    switch (dm.stage) {
      case 'cast': body = this._dmStageCast(p); break;
      case 'direct': body = this._dmStageDirect(p); break;
      case 'produce': body = this._dmStageProduce(p); break;
      case 'review': body = this._dmStageReview(p); break;
      case 'master': body = this._dmStageMaster(p); break;
      case 'export': body = this._dmStageExport(p); break;
      default: body = this._dmStageScript(p, speakers);
    }
    return h('div', { 'data-drama': '1', 'data-drama-stage': dm.stage, style: { display: 'grid', gap: 12, minWidth: 0 } }, projectList,
      h('datalist', { id: 'dm-speakers' }, ...speakers.map(s => h('option', { key: s, value: s }))),
      h('div', { style: css.row }, h('div', { style: { fontSize: 18, fontWeight: 800, color: '#f0f4f8' } }, p.title), chip(done + ' / ' + total + ' lines current', done === total && total ? tone.ok : '#94a3b8'), h('div', { style: { flex: 1 } }), btn('Delete project', () => this.dramaDelete(), '#f87171')),
      this._dmBanner(p),
      p.unresolved.length ? h('div', { 'data-drama-unresolved': '1', role: 'alert', style: { border: '1px solid rgba(251,191,36,.5)', borderRadius: 9, padding: '8px 10px', color: '#fde68a', fontSize: 12 } }, '⚠ Rendering is blocked until these speakers have a voice: ' + p.unresolved.map(u => u.speaker + ' (' + u.lines + ')').join(', ') + '.') : null,
      this._dmStageBar(p), body);
  };

  // follow an already running production after a reload
  const _open = P.openDramaProject;
  P.openDramaProject = async function (id, quiet) {
    await _open.call(this, id, quiet);
    const dm = this._dm(); dm.history = null; dm._historyAsked = false; dm.proof = null; dm._proofAsked = null; dm.revision = null; dm.qa = null; dm.reparse = null;
    if (dm.current && dm.current.active_production) { dm.production = dm.current.active_production; this.dmFollowProduction(dm.current.active_production.id); }
    else if (dm.current && dm.current.productions && dm.current.productions[0]) dm.production = null;
  };
  P._dmStageCast = P._dmStageCast || function (p) { return h('div', null, 'Cast Bible loads with the studio extras.'); };
  P._dmStageDirect = P._dmStageDirect || function (p) { return h('div', null, 'Timeline loads with the studio extras.'); };
})();
