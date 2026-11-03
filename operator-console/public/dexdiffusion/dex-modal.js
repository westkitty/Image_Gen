// dex-modal.js — the one centered modal system for DexDiffusion Studio.
//
// Pickers (models, voices, engines, saved chats) and dense panels open in a clear modal over the centre of the studio
// instead of dropping long lists into the page. Three surfaces share one look:
//   DexModal.open(opts)        imperative dialog (focus trap, Escape, backdrop click, focus restored to the opener)
//   DexModal.choose(opts)      searchable, grouped chooser built on open(); resolves the chosen value or null
//   DexModal.frame(h, opts, …) the same dialog as a vnode, for content that lives in component state
//   DexModal.choiceButton(h, opts) a compact button that shows the current value and opens choose()
// Nothing here talks to the backend; callers keep all behaviour and only change where the choice is made.
(function () {
  'use strict';
  const CSS = `
.dx-modal-backdrop{position:fixed;inset:0;z-index:13000;background:rgba(2,6,12,.72);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box}
.dx-modal{width:min(980px,100%);max-height:min(88vh,920px);display:flex;flex-direction:column;background:#0d1622;color:#e2e8f0;border:1px solid rgba(148,163,184,.3);border-radius:14px;box-shadow:0 24px 70px rgba(0,0,0,.6);overflow:hidden;font:13px 'DM Sans',system-ui,sans-serif;box-sizing:border-box}
.dx-modal.dx-size-sm{width:min(560px,100%)}.dx-modal.dx-size-md{width:min(760px,100%)}.dx-modal.dx-size-xl{width:min(1180px,100%)}
.dx-modal-head{display:flex;align-items:flex-start;gap:12px;padding:14px 16px;border-bottom:1px solid rgba(148,163,184,.16)}
.dx-modal-head h2{margin:0;font-size:16px;font-weight:800;color:#f1f5f9}.dx-modal-head p{margin:4px 0 0;color:#8ea0b5;font-size:12px;line-height:1.45}
.dx-modal-close{margin-left:auto;flex:0 0 auto;min-width:36px;min-height:36px;border:1px solid rgba(148,163,184,.25);background:transparent;color:#cbd5e1;border-radius:8px;cursor:pointer;font-size:15px}
.dx-modal-body{overflow:auto;padding:14px 16px;min-height:80px;display:grid;gap:12px;align-content:start}
.dx-modal-foot{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;padding:12px 16px;border-top:1px solid rgba(148,163,184,.16)}
.dx-modal-foot:empty{display:none}
.dx-btn{border:1px solid rgba(148,163,184,.3);background:rgba(148,163,184,.08);color:#e2e8f0;border-radius:8px;min-height:36px;padding:7px 12px;font:700 12px 'DM Sans',sans-serif;cursor:pointer}
.dx-btn:disabled{opacity:.45;cursor:not-allowed}.dx-btn.dx-primary{background:linear-gradient(90deg,#f59e0b,#fb923c);color:#1a1006;border-color:transparent}
.dx-btn.dx-accent{border-color:#a78bfa;color:#ddd6fe;background:rgba(167,139,250,.12)}
.dx-input{width:100%;box-sizing:border-box;border:1px solid rgba(148,163,184,.25);background:#060b12;color:#e2e8f0;border-radius:8px;padding:8px 10px;min-height:36px;font:13px 'DM Sans',sans-serif}
.dx-chips{display:flex;gap:5px;flex-wrap:wrap}.dx-chip{border:1px solid rgba(148,163,184,.25);background:transparent;color:#a8b6c8;border-radius:999px;padding:3px 11px;min-height:28px;font:700 11px 'DM Sans',sans-serif;cursor:pointer}
.dx-chip[aria-pressed="true"]{border-color:#38bdf8;background:rgba(56,189,248,.15);color:#7dd3fc}
.dx-list{display:grid;gap:4px}.dx-group{font:800 10px 'DM Sans',sans-serif;letter-spacing:.1em;text-transform:uppercase;color:#7f8ca8;padding:8px 4px 2px}
.dx-option{display:grid;gap:3px;width:100%;text-align:left;border:1px solid transparent;background:rgba(148,163,184,.04);color:#e2e8f0;border-radius:8px;padding:8px 10px;min-height:44px;cursor:pointer;font:13px 'DM Sans',sans-serif}
.dx-option:hover,.dx-option:focus-visible{border-color:rgba(56,189,248,.5);background:rgba(56,189,248,.07)}
.dx-option[aria-selected="true"]{border-color:#65d66e;background:rgba(101,214,110,.08)}.dx-option:disabled{opacity:.5;cursor:not-allowed}
.dx-option b{font-weight:700}.dx-option small{color:#8193a8;font-size:11px;line-height:1.35}.dx-badge{display:inline-block;margin-left:6px;font-size:10px;font-weight:700;border:1px solid rgba(148,163,184,.35);border-radius:5px;padding:0 6px;color:#a8b6c8}
.dx-choice{width:100%;min-width:0;display:flex;gap:8px;align-items:center;text-align:left;border:1px solid rgba(148,163,184,.25);background:#0b1420;color:#e8f0f7;border-radius:8px;padding:7px 10px;min-height:38px;cursor:pointer;font:600 13px 'DM Sans',system-ui,sans-serif}
.dx-choice:disabled{opacity:.5;cursor:not-allowed}.dx-choice>span:first-child{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dx-launch{display:flex;gap:10px;align-items:center;flex-wrap:wrap;border:1px solid rgba(148,163,184,.16);border-radius:10px;padding:10px 12px;background:#0c1520}
.dx-launch b{font-size:12px;letter-spacing:.06em;text-transform:uppercase}.dx-launch small{color:#8ea0b5;flex:1 1 200px}
@media (max-width:640px){.dx-modal-backdrop{padding:6px}.dx-modal{max-height:96vh}}
@media (prefers-reduced-motion:reduce){.dx-modal-backdrop{backdrop-filter:none}}`;
  function injectCss() {
    if (document.getElementById('dx-modal-css')) return;
    const s = document.createElement('style'); s.id = 'dx-modal-css'; s.textContent = CSS; document.head.appendChild(s);
  }
  const mk = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const FOCUSABLE = 'button:not([disabled]),[href],input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  function focusables(root) { return Array.from(root.querySelectorAll(FOCUSABLE)).filter(n => n.getClientRects().length); }
  function trapKeys(e, dialog, close) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close('escape'); return; }
    if (e.key !== 'Tab') return;
    const f = focusables(dialog); if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  const stack = [];
  let seq = 0;

  function open(opts) {
    injectCss();
    const o = opts || {};
    const opener = document.activeElement;
    const id = 'dx-modal-title-' + (++seq);
    const backdrop = mk('div', 'dx-modal-backdrop'); backdrop.setAttribute('data-dex-modal', o.id || 'modal');
    const dialog = mk('div', 'dx-modal dx-size-' + (o.size || 'lg'));
    dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-labelledby', id);
    const head = mk('div', 'dx-modal-head'), titles = mk('div');
    const title = mk('h2', null, o.title || ''); title.id = id;
    const subtitle = mk('p', null, o.subtitle || ''); if (!o.subtitle) subtitle.hidden = true;
    titles.append(title, subtitle);
    const closeBtn = mk('button', 'dx-modal-close', '✕'); closeBtn.type = 'button'; closeBtn.setAttribute('aria-label', 'Close ' + (o.title || 'dialog'));
    head.append(titles, closeBtn);
    const body = mk('div', 'dx-modal-body'), footer = mk('div', 'dx-modal-foot');
    dialog.append(head, body, footer); backdrop.append(dialog);
    let closed = false;
    const api = {
      root: backdrop, dialog, body, footer,
      setTitle(t, sub) { title.textContent = t || ''; if (sub !== undefined) { subtitle.textContent = sub || ''; subtitle.hidden = !sub; } },
      isOpen: () => !closed,
      close(reason) {
        if (closed) return; closed = true;
        backdrop.remove(); const i = stack.indexOf(api); if (i > -1) stack.splice(i, 1);
        try { if (o.onClose) o.onClose(reason || 'close'); } catch (_) {}
        if (opener && opener.isConnected && typeof opener.focus === 'function') { try { opener.focus(); } catch (_) {} }
      },
    };
    closeBtn.addEventListener('click', () => api.close('close'));
    backdrop.addEventListener('mousedown', e => { if (e.target === backdrop) api.close('backdrop'); });
    dialog.addEventListener('keydown', e => trapKeys(e, dialog, api.close));
    // Keys typed inside the modal never reach the page's global shortcuts.
    dialog.addEventListener('keyup', e => e.stopPropagation());
    document.body.appendChild(backdrop); stack.push(api);
    setTimeout(() => {
      if (closed) return;
      const target = (o.initialFocus && body.querySelector(o.initialFocus)) || focusables(body)[0] || closeBtn;
      try { target.focus(); } catch (_) {}
    }, 0);
    return api;
  }

  // options: [{ value, label, hint, badge, group, disabled, reason, keywords }]
  function choose(opts) {
    const o = opts || {};
    return new Promise(resolve => {
      let done = false;
      const finish = v => { if (done) return; done = true; resolve(v); };
      const m = open({ id: o.id || 'choose', title: o.title || 'Choose', subtitle: o.subtitle, size: o.size || 'md', onClose: () => finish(null), initialFocus: 'input[type=search]' });
      const options = (o.options || []).map(x => typeof x === 'object' ? x : { value: x, label: String(x) });
      const groups = [...new Set(options.map(x => x.group).filter(Boolean))];
      const q = { text: '', group: 'all' };
      const search = mk('input', 'dx-input'); search.type = 'search'; search.placeholder = o.placeholder || 'Search…'; search.setAttribute('aria-label', 'Search ' + (o.title || 'choices'));
      const chips = mk('div', 'dx-chips'), list = mk('div', 'dx-list'), foot = mk('small'); foot.style.color = '#8193a8';
      list.setAttribute('role', 'listbox'); list.setAttribute('aria-label', o.title || 'Choices');
      if (options.length > 6 || o.search) m.body.append(search);
      if (groups.length > 1) m.body.append(chips);
      m.body.append(list, foot);
      if (o.note) { const n = mk('div', null, o.note); n.style.cssText = 'color:#8ea0b5;font-size:11px;line-height:1.45'; m.body.append(n); }
      function draw() {
        chips.replaceChildren(...['all'].concat(groups).map(g => { const c = mk('button', 'dx-chip', g === 'all' ? 'All' : g); c.type = 'button'; c.setAttribute('aria-pressed', String(q.group === g)); c.addEventListener('click', () => { q.group = g; draw(); }); return c; }));
        const t = q.text.trim().toLowerCase();
        const shown = options.filter(x => (q.group === 'all' || x.group === q.group) && (!t || [x.label, x.hint, x.badge, x.group, x.keywords, String(x.value)].join(' ').toLowerCase().includes(t)));
        const rows = [];
        const byGroup = groups.length > 1 && q.group === 'all';
        let last = null;
        for (const x of shown) {
          if (byGroup && x.group !== last) { rows.push(mk('div', 'dx-group', x.group || 'Other')); last = x.group; }
          const b = mk('button', 'dx-option'); b.type = 'button'; b.setAttribute('role', 'option');
          b.setAttribute('data-choice-value', String(x.value)); b.setAttribute('aria-selected', String(x.value === o.value));
          const top = mk('div'); top.append(mk('b', null, x.label || String(x.value)));
          if (x.badge) top.append(mk('span', 'dx-badge', x.badge));
          if (x.value === o.value) top.append(mk('span', 'dx-badge', 'current'));
          b.append(top);
          if (x.hint || (x.disabled && x.reason)) b.append(mk('small', null, x.disabled && x.reason ? x.reason : x.hint));
          b.disabled = !!x.disabled;
          b.addEventListener('click', () => { finish(x.value); m.close('choose'); });
          rows.push(b);
        }
        list.replaceChildren(...(rows.length ? rows : [mk('div', null, o.empty || 'Nothing matches.')]));
        foot.textContent = shown.length + ' of ' + options.length;
      }
      search.addEventListener('input', () => { q.text = search.value; draw(); });
      m.dialog.addEventListener('keydown', e => {
        if (!['ArrowDown', 'ArrowUp'].includes(e.key)) return;
        const opt = Array.from(list.querySelectorAll('.dx-option:not(:disabled)')); if (!opt.length) return;
        e.preventDefault();
        const i = opt.indexOf(document.activeElement);
        (opt[e.key === 'ArrowDown' ? Math.min(opt.length - 1, i + 1) : Math.max(0, i - 1)] || opt[0]).focus();
      });
      draw();
      if (!(options.length > 6 || o.search)) setTimeout(() => { const cur = list.querySelector('[aria-selected="true"]:not(:disabled)') || list.querySelector('.dx-option:not(:disabled)'); if (cur) cur.focus(); }, 0);
    });
  }

  // Vnode dialog for state-owned content. `opts.onClose` is required; the caller drops the frame from its render to close.
  const focused = new Set();
  function frame(h, opts, ...children) {
    injectCss();
    const o = opts || {};
    const key = o.id || 'frame';
    if (!focused.has(key)) {
      focused.add(key);
      // The vnode is mounted on the next render: retry for a few frames until the dialog exists, then focus into it.
      let tries = 0;
      const focusIn = () => {
        const d = document.querySelector('[data-dex-modal="' + key + '"] .dx-modal');
        if (!d) { if (++tries < 20) requestAnimationFrame(focusIn); return; }
        if (!d.contains(document.activeElement)) { const f = focusables(d.querySelector('.dx-modal-body') || d)[0] || d.querySelector('.dx-modal-close'); if (f) f.focus(); }
      };
      requestAnimationFrame(focusIn);
    }
    const close = reason => { focused.delete(key); o.onClose(reason); };
    return h('div', { className: 'dx-modal-backdrop', 'data-dex-modal': key, onMousedown: e => { if (e.target === e.currentTarget) close('backdrop'); } },
      h('div', { className: 'dx-modal dx-size-' + (o.size || 'lg'), role: 'dialog', 'aria-modal': 'true', 'aria-label': o.title || 'Dialog', onKeydown: e => trapKeys(e, e.currentTarget, close) },
        h('div', { className: 'dx-modal-head' },
          h('div', null, h('h2', null, o.title || ''), o.subtitle ? h('p', null, o.subtitle) : null),
          h('button', { type: 'button', className: 'dx-modal-close', 'aria-label': 'Close ' + (o.title || 'dialog'), onClick: () => close('close') }, '✕')),
        h('div', { className: 'dx-modal-body' }, ...children),
        o.footer ? h('div', { className: 'dx-modal-foot' }, ...[].concat(o.footer)) : null));
  }

  // A compact launcher row: label, one-line summary, and the button that opens the modal.
  function launcher(h, { title, summary, label, onOpen, attrs }) {
    injectCss();
    return h('div', Object.assign({ className: 'dx-launch' }, attrs || {}), h('b', null, title), h('small', null, summary || ''),
      h('button', { type: 'button', className: 'dx-btn dx-accent', onClick: onOpen, 'aria-haspopup': 'dialog' }, label || 'Open'));
  }

  function choiceButton(h, o) {
    injectCss();
    const opts = (o.options || []).map(x => typeof x === 'object' ? x : { value: x, label: String(x) });
    const cur = opts.find(x => x.value === o.value);
    const attrs = Object.assign({ type: 'button', className: 'dx-choice', 'aria-haspopup': 'dialog', disabled: !!o.disabled,
      'aria-label': (o.ariaLabel || o.title || 'Choose') + ': ' + (cur ? cur.label : (o.placeholder || 'none')),
      onClick: () => choose({ id: o.id, title: o.title, subtitle: o.subtitle, options: opts, value: o.value, note: o.note, placeholder: o.searchPlaceholder })
        .then(v => { if (v !== null && v !== undefined && v !== o.value) o.onChange(v); }) }, o.attrs || {});
    if (o.style) attrs.style = o.style;
    return h('button', attrs, h('span', null, cur ? cur.label : (o.placeholder || 'Choose…')), cur && cur.badge ? h('span', { className: 'dx-badge' }, cur.badge) : null, h('span', { 'aria-hidden': 'true', style: { color: '#7f8ca8' } }, '▾'));
  }

  // Kokoro voice ids follow <language><gender>_<name> (af_heart = American English, female). Labels only; ids are unchanged.
  const KOKORO_LANG = { a: 'American English', b: 'British English', e: 'Spanish', f: 'French', h: 'Hindi', i: 'Italian', j: 'Japanese', p: 'Brazilian Portuguese', z: 'Mandarin Chinese' };
  function kokoroOptions(voices) {
    return (voices || []).map(v => {
      const m = /^([a-z])([fm])_(.+)$/.exec(String(v));
      if (!m) return { value: v, label: String(v) };
      const name = m[3].replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      return { value: v, label: name, badge: m[2] === 'f' ? 'female' : 'male', hint: v + ' · ' + (KOKORO_LANG[m[1]] || 'language ' + m[1]), group: KOKORO_LANG[m[1]] || 'Other' };
    });
  }
  function kokoroChoice(h, voices, value, onChange, title) {
    return choiceButton(h, { id: 'kokoro-voice', title: title || 'Kokoro voice', subtitle: 'Kokoro preset voices, grouped by language.', value, options: kokoroOptions(voices), placeholder: value || 'Choose a voice', onChange, attrs: { 'data-kokoro-voice': title || 'kokoro' } });
  }
  window.DexModal = { open, choose, frame, launcher, choiceButton, kokoroOptions, kokoroChoice, injectCss, stack };
})();
