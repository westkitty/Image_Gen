// prompt-builder.js — the Prompt Builder modal: construct a prompt with wildcards and the target model's real syntax,
// roll a preview of what it could become, randomize it (whole new prompt, or swap pieces in and out at a chosen
// randomness), then insert it into the prompt field.
//
// Truth rules:
//   * Syntax buttons come from DexPrompt.supportFor(target) (prompt-parity.js). A construct the backend reads as literal
//     text or refuses is shown as such and never offered as if it worked.
//   * The preview roll uses the server's own wildcard expansion (POST /api/wildcards/expand), the same code generation uses.
//   * Where a route does not expand __tokens__ (Edit, Music) the builder is opened with allowTokens:false and only ever
//     inserts resolved text.
// The pure helpers are exported for Node tests; the UI is browser-only and needs window.DexModal.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DexPromptBuilder = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ── pure helpers ────────────────────────────────────────────────────────────
  // Split on top-level commas (commas inside (), [], <> stay with their piece).
  function splitPieces(text) {
    const out = []; let depth = 0, cur = '';
    const s = String(text || '');
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '\\') { cur += c + (s[i + 1] || ''); i++; continue; }
      if (c === '(' || c === '[' || c === '<') depth++;
      else if ((c === ')' || c === ']' || c === '>') && depth > 0) depth--;
      if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
      cur += c;
    }
    out.push(cur.trim());
    return out.filter(Boolean);
  }
  const joinPieces = pieces => pieces.filter(p => String(p || '').trim()).join(', ');
  const TOKEN = /^__([A-Za-z0-9_-]+)__$/;
  const pick = (arr, rnd) => arr[Math.floor(rnd() * arr.length)];
  function shuffle(arr, rnd) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  // banks: { name: [items] } (only banks the user allowed). amount: 0..1.
  // -> new text. Pieces whose text is an item of a bank are swapped for another item of the same bank ("swap in and out");
  // others are replaced by a draw from a random allowed bank. Higher amounts also reorder and add pieces.
  function randomizePieces(text, banks, { amount = 0.35, keepSubject = true, tokens = false, rnd = Math.random } = {}) {
    const names = Object.keys(banks || {}).filter(n => (banks[n] || []).length);
    const pieces = splitPieces(text);
    if (!names.length) return joinPieces(pieces);
    const a = Math.max(0, Math.min(1, Number(amount) || 0));
    const draw = name => tokens ? '__' + name + '__' : pick(banks[name], rnd);
    const bankOf = piece => { const low = piece.toLowerCase(); return names.find(n => banks[n].some(it => it.toLowerCase() === low)) || null; };
    const out = pieces.map((p, i) => {
      if (keepSubject && i === 0) return p;
      if (rnd() >= a) return p;
      const tok = TOKEN.exec(p);
      if (tok) { const others = names.filter(n => n.toLowerCase() !== tok[1].toLowerCase()); return others.length ? '__' + pick(others, rnd) + '__' : p; }
      const own = bankOf(p);
      if (own) { const alt = banks[own].filter(it => it.toLowerCase() !== p.toLowerCase()); return tokens ? '__' + own + '__' : (alt.length ? pick(alt, rnd) : p); }
      return draw(pick(names, rnd));
    });
    let body = keepSubject ? out.slice(1) : out;
    if (a > 0.6) body = shuffle(body, rnd);
    const extra = Math.round(a * 3 * rnd());
    for (let k = 0; k < extra; k++) body.push(draw(pick(names, rnd)));
    return joinPieces(keepSubject ? [out[0]].concat(body) : body);
  }

  // A brand-new prompt: optional kept subject, then 2–7 pieces (more with more randomness) from distinct allowed banks.
  function newRandomPrompt(banks, { amount = 0.35, subject = '', tokens = false, rnd = Math.random } = {}) {
    const names = shuffle(Object.keys(banks || {}).filter(n => (banks[n] || []).length), rnd);
    const n = Math.min(names.length, 2 + Math.round(Math.max(0, Math.min(1, Number(amount) || 0)) * 5));
    const pieces = names.slice(0, n).map(name => tokens ? '__' + name + '__' : pick(banks[name], rnd));
    return joinPieces([String(subject || '').trim()].concat(pieces));
  }

  // Syntax actions; `support` is DexPrompt.supportFor(spec). Each returns { id, label, insert(sel) -> text, status, note }.
  function syntaxActions(support) {
    const s = support || {};
    const st = k => s[k] || 'unverified';
    const wrap = (l, r) => sel => l + (sel || 'word') + r;
    return [
      { id: 'emphasis', label: '(word)', title: 'Emphasis ×1.1', kind: 'attention', status: st('attention'), insert: wrap('(', ')') },
      { id: 'weight', label: '(word:1.3)', title: 'Explicit weight', kind: 'attention-weight', status: st('attention-weight'), weighted: true, insert: (sel, w) => '(' + (sel || 'word') + ':' + (Number(w) || 1.2).toFixed(2).replace(/0$/, '') + ')' },
      { id: 'deemphasis', label: '[word]', title: 'De-emphasis ÷1.1', kind: 'bracket-decay', status: st('bracket-decay'), insert: wrap('[', ']') },
      { id: 'escape', label: '\\( \\)', title: 'Literal parentheses', kind: 'escape', status: st('escape'), insert: sel => '\\(' + (sel || 'text') + '\\)' },
      { id: 'break', label: 'BREAK', title: 'Start a new 75-token chunk', kind: 'break', status: st('break'), insert: sel => (sel ? sel + ' ' : '') + 'BREAK ' },
      { id: 'schedule', label: '[a:b:0.5]', title: 'Prompt scheduling', kind: 'schedule', status: st('schedule'), insert: null },
      { id: 'alternation', label: '[a|b]', title: 'Alternation', kind: 'alternation', status: st('alternation'), insert: null },
      { id: 'and', label: 'AND', title: 'Composable conditioning', kind: 'and', status: st('and'), insert: null },
    ];
  }
  const STATUS_TEXT = { native: 'works on this model', literal: 'sent as plain text on this model', unsupported: 'refused on this model (no installed backend runs it)', unverified: 'unverified on this model' };

  // ── UI ──────────────────────────────────────────────────────────────────────
  // opts: { backendUrl, text, target (model spec), field ('prompt'|'negative'), tab, allowTokens, title, onApply(text) }
  function open(opts) {
    const M = window.DexModal, DP = window.DexPrompt;
    if (!M) throw new Error('DexModal is not loaded');
    const o = Object.assign({ backendUrl: '', text: '', target: null, field: 'prompt', tab: 'wildcards', allowTokens: true }, opts || {});
    const api = path => (o.backendUrl || '') + path;
    const spec = o.target || {};
    // plainText: a text prompt for an audio model, which has no image prompt syntax at all.
    const support = o.plainText ? { engine: 'plain text — no prompt syntax', attention: 'literal', 'attention-weight': 'literal', 'bracket-decay': 'literal', escape: 'literal', break: 'literal', schedule: 'literal', alternation: 'literal', and: 'literal' }
      : DP ? DP.supportFor(spec) : {};
    const modelName = spec.label || spec.id || 'this model';
    const m = M.open({ id: 'prompt-builder', size: 'xl', title: (o.field === 'negative' ? 'Negative prompt' : 'Prompt') + ' builder',
      subtitle: 'For ' + modelName + (support.engine ? ' · ' + support.engine : '') + '. Build here, roll a preview, then insert into the ' + (o.field === 'negative' ? 'negative prompt' : 'prompt') + '.',
      initialFocus: '[data-pb-field="construct"]' });
    const el = (tag, css, text, attrs) => { const n = document.createElement(tag); if (css) n.style.cssText = css; if (text != null) n.textContent = text; if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]); return n; };
    const button = (text, cls, fn, attrs) => { const b = el('button', null, text, attrs); b.type = 'button'; b.className = 'dx-btn' + (cls ? ' ' + cls : ''); b.addEventListener('click', fn); return b; };
    const label = t => el('div', 'font:800 10px DM Sans,sans-serif;letter-spacing:.1em;text-transform:uppercase;color:#8ea0b5;', t);
    const state = { tab: o.tab, banks: [], bankFilter: '', openBank: null, items: {}, amount: 35, keepSubject: o.field !== 'negative', tokens: !!o.allowTokens, allowed: null, weight: 1.2 };

    // Layout: tools on the left, construct + preview on the right (stacks on narrow screens).
    const grid = el('div', 'display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,380px),1fr));gap:14px;align-items:start;');
    const left = el('div', 'display:grid;gap:10px;min-width:0;'), right = el('div', 'display:grid;gap:10px;min-width:0;');
    grid.append(left, right); m.body.append(grid);

    // Construct box
    const construct = el('dex-prompt-field', null, null, { 'data-pb-field': 'construct', 'aria-label': 'Construct prompt', rows: '7', 'data-dex-field': o.field === 'negative' ? 'pb-negative' : 'pb-prompt' });
    construct.className = 'dx-input'; construct.style.resize = 'vertical'; construct.style.lineHeight = '1.45'; construct.value = o.text || '';
    let lastSel = { start: construct.value.length, end: construct.value.length };
    const remember = () => { lastSel = { start: construct.selectionStart, end: construct.selectionEnd }; };
    ['keyup', 'mouseup', 'select', 'input', 'blur'].forEach(ev => construct.addEventListener(ev, remember));
    const count = el('small', 'color:#8193a8;', '', { 'data-pb-field': 'count' });
    const analysis = el('div', 'font-size:11px;line-height:1.45;color:#a8b6c8;', '', { 'data-pb-field': 'analysis', role: 'status' });
    function refresh() {
      count.textContent = construct.value.length + ' characters · ' + splitPieces(construct.value).length + ' pieces';
      if (!DP || o.plainText) { analysis.textContent = ''; return; }
      const err = DP.validateForTarget(spec, o.field === 'negative' ? '' : construct.value, o.field === 'negative' ? construct.value : '');
      const notes = DP.notesForTarget(spec, construct.value, '');
      const kinds = DP.analyzePrompt(construct.value).kinds;
      analysis.textContent = err ? '⚠ ' + err : (notes.length ? notes.join(' ') : (kinds.length ? 'Syntax found: ' + kinds.join(', ') + ' — all usable on ' + modelName + '.' : ''));
      analysis.style.color = err ? '#fca5a5' : '#a8b6c8';
    }
    construct.addEventListener('input', refresh);
    function insertAt(text, replaceSelection) {
      const v = construct.value, s = Math.min(lastSel.start, v.length), e = Math.min(lastSel.end, v.length);
      const before = v.slice(0, s), after = v.slice(replaceSelection ? e : s);
      const sepL = before && !/[\s,(\[]$/.test(before) ? ', ' : '';
      const sepR = after && !/^[\s,)\]]/.test(after) ? ', ' : '';
      construct.value = before + sepL + text + sepR + after;
      const pos = (before + sepL + text).length; lastSel = { start: pos, end: pos };
      construct.focus(); try { construct.setSelectionRange(pos, pos); } catch (_) {}
      refresh();
    }
    const selected = () => construct.value.slice(Math.min(lastSel.start, lastSel.end), Math.max(lastSel.start, lastSel.end));

    // Preview
    const preview = el('div', 'min-height:64px;white-space:pre-wrap;border:1px dashed rgba(148,163,184,.3);border-radius:8px;padding:10px;color:#e2e8f0;background:#060b12;font-size:12px;line-height:1.5;', 'Press Roll preview to see one possible result.', { 'data-pb-field': 'preview', 'aria-live': 'polite' });
    let rolled = null;
    async function roll() {
      rollBtn.disabled = true; preview.textContent = 'Rolling…';
      try {
        const r = await fetch(api('/api/wildcards/expand'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: construct.value }) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || 'HTTP ' + r.status);
        rolled = String(d.expanded || '');
        preview.textContent = rolled || '(empty prompt)';
        useRolled.disabled = !rolled;
      } catch (e) { rolled = null; useRolled.disabled = true; preview.textContent = 'Preview failed: ' + e.message; }
      rollBtn.disabled = false;
    }
    const rollBtn = button('🎲 Roll preview', 'dx-accent', roll, { 'data-pb-action': 'roll' });
    const previewNote = el('small', 'color:#8193a8;line-height:1.4;', o.allowTokens
      ? 'One random draw from the same expansion generation uses. __tokens__ left in the prompt re-roll on every Generate.'
      : 'This section does not expand __tokens__, so Insert uses resolved text: tokens are rolled here first.');
    right.append(label('Construct prompt'), construct, count, analysis, el('div', 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;'), label('Preview'), preview, previewNote);
    right.children[4].append(rollBtn, button('Clear', '', () => { construct.value = ''; lastSel = { start: 0, end: 0 }; refresh(); }));

    // Tabs
    const tabs = el('div', null, null, { role: 'tablist', 'aria-label': 'Builder tools' }); tabs.className = 'dx-chips';
    const pane = el('div', 'display:grid;gap:8px;min-width:0;');
    left.append(tabs, pane);
    const TABS = [['wildcards', 'Wildcards'], ['syntax', 'Syntax'], ['randomize', '🎲 Randomize']];
    function drawTabs() {
      tabs.replaceChildren(...TABS.map(([k, t]) => { const c = el('button', null, t, { role: 'tab', 'aria-selected': String(state.tab === k), 'aria-pressed': String(state.tab === k), 'data-pb-tab': k }); c.type = 'button'; c.className = 'dx-chip'; c.addEventListener('click', () => { state.tab = k; drawTabs(); drawPane(); }); return c; }));
    }
    async function loadBank(name) {
      if (state.items[name]) return state.items[name];
      const r = await fetch(api('/api/wildcards/' + encodeURIComponent(name)));
      const d = await r.json().catch(() => ({}));
      state.items[name] = r.ok && Array.isArray(d.items) ? d.items : [];
      return state.items[name];
    }
    async function loadBanks() {
      try { const r = await fetch(api('/api/wildcards')); const d = await r.json(); state.banks = Array.isArray(d.wildcards) ? d.wildcards : []; } catch (_) { state.banks = []; }
      if (window.DexPromptChips) window.DexPromptChips.setBankCounts(state.banks);
      if (!state.allowed) state.allowed = new Set(state.banks.map(b => b.name));
      drawPane();
    }

    function drawWildcards() {
      const search = el('input', null, null, { type: 'search', placeholder: 'Search wildcard banks…', 'aria-label': 'Search wildcard banks' });
      search.className = 'dx-input'; search.value = state.bankFilter;
      const list = el('div', 'display:grid;gap:4px;max-height:min(46vh,420px);overflow:auto;');
      const draw = () => {
        const t = state.bankFilter.trim().toLowerCase();
        const shown = state.banks.filter(b => !t || b.name.toLowerCase().includes(t) || (b.preview || []).join(' ').toLowerCase().includes(t));
        list.replaceChildren(...(shown.length ? shown.map(b => {
          const row = el('div', 'border:1px solid rgba(148,163,184,.14);border-radius:8px;padding:7px 9px;display:grid;gap:5px;', null, { 'data-pb-bank': b.name });
          const top = el('div', 'display:flex;gap:6px;align-items:center;flex-wrap:wrap;');
          top.append(el('b', 'font:600 12px IBM Plex Mono,monospace;flex:1 1 auto;min-width:0;overflow-wrap:anywhere;', '__' + b.name + '__'), el('small', 'color:#7f8ca8;', (b.count || 0) + ' items'));
          if (o.allowTokens) top.append(button('Insert token', 'dx-accent', () => insertAt('__' + b.name + '__'), { 'data-pb-insert-token': b.name }));
          top.append(button(state.openBank === b.name ? 'Hide items' : 'Browse', '', async () => { state.openBank = state.openBank === b.name ? null : b.name; if (state.openBank) await loadBank(b.name); draw(); }, { 'data-pb-browse': b.name }));
          row.append(top);
          if ((b.preview || []).length && state.openBank !== b.name) row.append(el('small', 'color:#8193a8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;', 'e.g. ' + b.preview.join(' · ')));
          if (state.openBank === b.name) {
            const items = el('div', 'display:flex;gap:4px;flex-wrap:wrap;max-height:180px;overflow:auto;');
            const its = state.items[b.name] || [];
            items.append(button('Random item', '', () => insertAt(pick(its, Math.random) || ''), { 'data-pb-insert-random': b.name }));
            for (const it of its.slice(0, 300)) { const c = el('button', 'max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;', it, { title: 'Insert "' + it + '"' }); c.type = 'button'; c.className = 'dx-chip'; c.addEventListener('click', () => insertAt(it)); items.append(c); }
            row.append(items);
          }
          return row;
        }) : [el('div', 'color:#8193a8;', state.banks.length ? 'No bank matches.' : 'Loading wildcard banks…')]));
      };
      search.addEventListener('input', () => { state.bankFilter = search.value; draw(); });
      pane.append(search, list, el('small', 'color:#8193a8;line-height:1.4;', o.allowTokens ? 'Insert token keeps __name__ in the prompt (a fresh pick every Generate). Browse to insert a specific item as plain text.' : 'Insert a specific item, or Random item. Roll preview resolves any tokens before inserting.'));
      draw();
    }

    function drawSyntax() {
      const acts = syntaxActions(support);
      pane.append(el('div', 'font-size:12px;color:#cbd5e1;line-height:1.45;', 'Syntax for ' + modelName + ' (' + (support.engine || 'unknown engine') + '). Select text in the construct box to wrap it, or insert a placeholder.'));
      const weightRow = el('label', 'display:flex;gap:8px;align-items:center;font-size:12px;color:#cbd5e1;');
      const w = el('input', null, null, { type: 'range', min: '0.1', max: '2', step: '0.05', 'aria-label': 'Weight', 'data-pb-field': 'weight' }); w.value = String(state.weight);
      const wv = el('span', 'font:12px IBM Plex Mono,monospace;min-width:34px;', state.weight.toFixed(2));
      w.addEventListener('input', () => { state.weight = +w.value; wv.textContent = state.weight.toFixed(2); });
      weightRow.append('Weight', w, wv);
      const list = el('div', 'display:grid;gap:6px;');
      for (const a of acts) {
        const row = el('div', 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;border:1px solid rgba(148,163,184,.14);border-radius:8px;padding:7px 9px;', null, { 'data-pb-syntax': a.id, 'data-pb-status': a.status });
        const usable = a.insert && a.status === 'native';
        const b = button(a.label, usable ? 'dx-accent' : '', () => insertAt(a.insert(selected(), state.weight), true));
        b.style.fontFamily = 'IBM Plex Mono,monospace'; b.disabled = !usable;
        b.title = usable ? a.title : a.title + ' — ' + STATUS_TEXT[a.status];
        row.append(b, el('span', 'flex:1 1 160px;font-size:12px;color:#cbd5e1;', a.title), el('small', 'color:' + (a.status === 'native' ? '#86efac' : a.status === 'unsupported' ? '#fca5a5' : '#fde68a') + ';', STATUS_TEXT[a.status] || a.status));
        list.append(row);
      }
      const extras = el('div', 'display:grid;gap:4px;font-size:11px;color:#8ea0b5;line-height:1.45;');
      extras.append(el('div', null, o.allowTokens ? '__name__ — wildcard token, replaced by a random bank item at generation (see Wildcards).' : '__name__ wildcard tokens are not expanded here; use the Wildcards tab to insert resolved text.'));
      if (support.engine && !support.engine.startsWith('MFLUX') && !o.plainText) extras.append(el('div', null, '<lora:name:weight> — adapter tag; choose adapters with the LoRA button so the verified route is used.'));
      pane.append(weightRow, list, extras);
    }

    function drawRandomize() {
      const sliderRow = el('label', 'display:grid;gap:4px;font-size:12px;color:#cbd5e1;');
      const slider = el('input', null, null, { type: 'range', min: '0', max: '100', step: '1', 'aria-label': 'How random', 'data-pb-field': 'randomness' }); slider.value = String(state.amount);
      const word = () => state.amount < 20 ? 'Subtle' : state.amount < 50 ? 'Moderate' : state.amount < 80 ? 'Bold' : 'Wild';
      const val = el('span', 'font-weight:700;', '');
      const setVal = () => { val.textContent = 'How random: ' + state.amount + '% · ' + word(); };
      slider.addEventListener('input', () => { state.amount = +slider.value; setVal(); }); setVal();
      sliderRow.append(val, slider);
      const check = (text, key, attrs) => { const l = el('label', 'display:flex;gap:7px;align-items:center;font-size:12px;color:#cbd5e1;cursor:pointer;'); const c = el('input', null, null, Object.assign({ type: 'checkbox' }, attrs || {})); c.checked = !!state[key]; c.addEventListener('change', () => { state[key] = c.checked; }); l.append(c, text); return l; };
      const opts2 = el('div', 'display:grid;gap:6px;');
      opts2.append(check('Keep the first phrase (the subject)', 'keepSubject', { 'data-pb-field': 'keep-subject' }));
      if (o.allowTokens) opts2.append(check('Use wildcard tokens (re-roll on every Generate) instead of fixed text', 'tokens', { 'data-pb-field': 'use-tokens' }));
      const status = el('small', 'color:#8193a8;', '', { role: 'status' });
      const allowedBanks = () => state.banks.filter(b => state.allowed && state.allowed.has(b.name) && b.count > 0).map(b => b.name);
      async function bankItems() {
        const names = allowedBanks();
        if (!names.length) { status.textContent = 'Choose at least one wildcard bank below.'; return null; }
        status.textContent = 'Loading banks…';
        const out = {}; for (const n of names) out[n] = await loadBank(n);
        status.textContent = ''; return out;
      }
      const actions = el('div', 'display:flex;gap:8px;flex-wrap:wrap;');
      actions.append(
        button('🔀 Randomize pieces', 'dx-accent', async () => { const b = await bankItems(); if (!b) return; construct.value = randomizePieces(construct.value, b, { amount: state.amount / 100, keepSubject: state.keepSubject, tokens: state.tokens }); refresh(); status.textContent = 'Pieces swapped at ' + state.amount + '%. Press again for another variation.'; }, { 'data-pb-action': 'randomize-pieces' }),
        button('✨ New random prompt', 'dx-accent', async () => { const b = await bankItems(); if (!b) return; const subject = state.keepSubject ? (splitPieces(construct.value)[0] || '') : ''; construct.value = newRandomPrompt(b, { amount: state.amount / 100, subject, tokens: state.tokens }); refresh(); status.textContent = 'New prompt drawn from ' + Object.keys(b).length + ' banks.'; }, { 'data-pb-action': 'new-prompt' }));
      const bankBox = el('div', 'display:flex;gap:4px;flex-wrap:wrap;max-height:180px;overflow:auto;');
      for (const b of state.banks) {
        const c = el('button', null, b.name, { 'aria-pressed': String(!!(state.allowed && state.allowed.has(b.name))), 'data-pb-allow': b.name }); c.type = 'button'; c.className = 'dx-chip';
        c.addEventListener('click', () => { if (state.allowed.has(b.name)) state.allowed.delete(b.name); else state.allowed.add(b.name); c.setAttribute('aria-pressed', String(state.allowed.has(b.name))); });
        bankBox.append(c);
      }
      const allNone = el('div', 'display:flex;gap:6px;');
      allNone.append(button('All banks', '', () => { state.allowed = new Set(state.banks.map(b => b.name)); drawPane(); }), button('No banks', '', () => { state.allowed = new Set(); drawPane(); }));
      pane.append(el('div', 'font-size:12px;color:#cbd5e1;line-height:1.45;', 'Randomize pieces swaps comma-separated pieces for others from the same wildcard bank (or a random bank); higher randomness changes more pieces, reorders them and adds new ones. New random prompt draws a fresh set of pieces.'),
        sliderRow, opts2, actions, status, label('Draw from these banks'), allNone, bankBox);
    }
    function drawPane() {
      pane.replaceChildren();
      if (state.tab === 'syntax') drawSyntax();
      else if (state.tab === 'randomize') drawRandomize();
      else drawWildcards();
    }

    // Footer
    const cancel = button('Cancel', '', () => m.close('cancel'), { 'data-pb-action': 'cancel' });
    const useRolled = button('Insert rolled preview', '', () => { if (rolled == null) return; o.onApply(rolled); m.close('apply'); }, { 'data-pb-action': 'apply-rolled' });
    useRolled.disabled = true;
    const apply = button('Insert into ' + (o.field === 'negative' ? 'negative prompt' : 'prompt'), 'dx-primary', async () => {
      let text = construct.value;
      // Sections that do not expand tokens get resolved text, never a raw __token__.
      if (!o.allowTokens && /__[A-Za-z0-9_-]+__/.test(text)) { await roll(); if (rolled == null) return; text = rolled; }
      o.onApply(text); m.close('apply');
    }, { 'data-pb-action': 'apply' });
    m.footer.append(cancel, useRolled, apply);

    drawTabs(); drawPane(); refresh(); loadBanks();
    return m;
  }

  return { splitPieces, joinPieces, randomizePieces, newRandomPrompt, syntaxActions, STATUS_TEXT, open };
});
