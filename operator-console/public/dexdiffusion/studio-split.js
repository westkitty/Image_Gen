// Draggable divider between a studio's canvas (output) and its settings panel.
//
// Drag the bar left or right to give the canvas or the settings more room. Drag it all the way across the canvas
// to the far edge and let go: the settings and the canvas swap sides. Double-click the bar to restore the default
// width. With the keyboard: focus the bar, Left/Right resize, Enter swaps sides, Home restores the default.
//
// The bar is an overlay in <body>, never a child of the studio DOM, because the studio's runtime rebuilds those
// subtrees on every render. Widths and sides are applied through CSS variables on <html>, so nothing here writes
// to elements the runtime owns. Layout per studio persists in localStorage.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DexSplit = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const STORE_KEY = 'dex_split_layout_v1';
  const MIN_SETTINGS = 280, MIN_CANVAS = 240, SWAP_ZONE = 56, KEY_STEP = 24;

  // Studios with a canvas beside a settings panel. `canvas`/`settings` are the child indexes inside the container;
  // `side` is where the settings sit by default; `minWidth` is the viewport width below which the studio stacks.
  const SPLITS = [
    { id: 'create', label: 'Create', selector: '[data-v="2"] [data-studio-create]', canvas: 0, settings: 1, side: 'right', minWidth: 1101, swappedCols: '370px minmax(0,1fr)' },
    { id: 'edit', label: 'Edit', selector: '[data-v="2"] .dex-ed-studio', canvas: 0, settings: 1, side: 'right', minWidth: 901, swappedCols: 'minmax(300px,1fr) minmax(0,1.5fr)' },
  ];

  // ── pure layout maths (exported for tests) ─────────────────────────────────────────────────────────────────
  const clampWidth = (w, total) => Math.round(Math.max(MIN_SETTINGS, Math.min(w, Math.max(MIN_SETTINGS, total - MIN_CANVAS))));
  // Where the settings would sit for a pointer at x, given the container box and the side the settings are on.
  // Returns { width, swap }: swap is true when the bar has been dragged into the far edge zone.
  function dragResult(x, box, side, gap) {
    const half = (gap || 0) / 2;
    if (side === 'right') {
      if (x <= box.left + SWAP_ZONE) return { width: null, swap: true };
      return { width: clampWidth(box.right - x - half, box.width), swap: false };
    }
    if (x >= box.right - SWAP_ZONE) return { width: null, swap: true };
    return { width: clampWidth(x - box.left - half, box.width), swap: false };
  }
  function columnsFor(entry, side) {
    const w = entry && entry.width ? Math.round(entry.width) + 'px' : null;
    if (!w) return null;
    const track = 'min(' + w + ', calc(100% - ' + MIN_CANVAS + 'px))';
    return side === 'left' ? track + ' minmax(0,1fr)' : 'minmax(0,1fr) ' + track;
  }
  const sideOf = (def, entry) => (entry && entry.swapped ? (def.side === 'right' ? 'left' : 'right') : def.side);
  // The stylesheet text for the current layout. Only studios the user changed get rules.
  function cssFor(layout) {
    let css = '';
    for (const def of SPLITS) {
      const entry = layout[def.id]; if (!entry) continue;
      const side = sideOf(def, entry), cols = columnsFor(entry, side);
      const swapped = side !== def.side;
      let rules = '';
      if (cols || swapped) rules += def.selector + '{grid-template-columns:' + (cols || def.swappedCols) + '!important}';
      if (swapped) {
        rules += def.selector + '>:nth-child(' + (def.settings + 1) + '){order:1}';
        rules += def.selector + '>:nth-child(' + (def.canvas + 1) + '){order:2;border-right:none!important;border-left:1px solid rgba(200,180,255,.08)}';
      }
      if (rules) css += '@media (min-width:' + def.minWidth + 'px){' + rules + '}';
    }
    return css;
  }

  if (typeof document === 'undefined') return { SPLITS, MIN_SETTINGS, MIN_CANVAS, SWAP_ZONE, clampWidth, dragResult, columnsFor, cssFor, sideOf };

  // ── browser ────────────────────────────────────────────────────────────────────────────────────────────────
  let layout = {};
  try { const v = JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); if (v && typeof v === 'object') layout = v; } catch (_) { layout = {}; }
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(layout)); } catch (_) {} };

  const style = document.createElement('style');
  style.setAttribute('data-dex-split-style', '');
  style.textContent = '.dx-split-bar{position:fixed;z-index:60;width:12px;margin-left:-6px;cursor:col-resize;touch-action:none;display:none;outline:none}' +
    '.dx-split-bar::before{content:"";position:absolute;left:5px;top:0;bottom:0;width:2px;background:rgba(200,180,255,.14);transition:background .12s}' +
    '.dx-split-bar>i{position:absolute;left:2px;width:8px;height:36px;margin-top:-18px;border-radius:5px;background:rgba(200,180,255,.22);box-shadow:inset 0 0 0 1px rgba(0,0,0,.25)}' +
    '.dx-split-bar:hover::before,.dx-split-bar:focus-visible::before,.dx-split-bar[data-dragging]::before{background:#f59e0b}' +
    '.dx-split-bar:hover>i,.dx-split-bar:focus-visible>i,.dx-split-bar[data-dragging]>i{background:#f59e0b}' +
    '.dx-split-swap{position:fixed;z-index:59;pointer-events:none;display:none;align-items:center;justify-content:center;border:2px dashed #f59e0b;background:rgba(245,158,11,.16);color:#fde68a;text-shadow:0 1px 2px #000;padding:12px;text-align:center;font:700 13px "DM Sans",system-ui,sans-serif;border-radius:10px}' +
    'html[data-dx-split-dragging],html[data-dx-split-dragging] *{cursor:col-resize!important;user-select:none!important}';
  const sheet = document.createElement('style');
  sheet.setAttribute('data-dex-split-layout', '');
  const mountStyles = () => { if (!style.isConnected) document.head.appendChild(style); if (!sheet.isConnected) document.head.appendChild(sheet); };
  const applyLayout = () => { sheet.textContent = cssFor(layout); };

  const bars = new Map();
  let swapHint = null, drag = null, raf = 0;

  function containerFor(def) {
    for (const el of document.querySelectorAll(def.selector)) if (el.offsetParent !== null || el.getClientRects().length) return el;
    return null;
  }
  // Visible part of an element: its box clipped by scrolling/clipping ancestors and the viewport.
  function visibleBox(el) {
    const r = el.getBoundingClientRect();
    let top = r.top, bottom = r.bottom;
    for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (/(auto|scroll|hidden|clip)/.test(cs.overflowY)) { const ar = a.getBoundingClientRect(); top = Math.max(top, ar.top); bottom = Math.min(bottom, ar.bottom); }
    }
    top = Math.max(top, 0); bottom = Math.min(bottom, window.innerHeight);
    return { left: r.left, right: r.right, width: r.width, top, bottom };
  }
  function geometry(def) {
    const box = containerFor(def); if (!box) return null;
    const kids = box.children, canvas = kids[def.canvas], settings = kids[def.settings];
    if (!canvas || !settings) return null;
    const c = canvas.getBoundingClientRect(), s = settings.getBoundingClientRect();
    if (!c.width || !s.width || Math.abs(c.top - s.top) > c.height / 2) return null;   // stacked (narrow window)
    const side = s.left > c.left ? 'right' : 'left';
    const gap = side === 'right' ? s.left - c.right : c.left - s.right;
    const x = side === 'right' ? s.left - gap / 2 : s.right + gap / 2;
    return { box, vis: visibleBox(box), side, gap: Math.max(0, gap), x, settingsWidth: s.width };
  }

  function barFor(def) {
    let bar = bars.get(def.id);
    if (bar && bar.isConnected) return bar;
    bar = document.createElement('div');
    bar.className = 'dx-split-bar';
    bar.setAttribute('data-dex-split', def.id);
    bar.setAttribute('role', 'separator');
    bar.setAttribute('aria-orientation', 'vertical');
    bar.setAttribute('aria-label', def.label + ': divider between canvas and settings');
    bar.setAttribute('tabindex', '0');
    bar.title = 'Drag to resize · drag all the way across to swap sides · double-click to reset';
    bar.appendChild(document.createElement('i'));
    bar.addEventListener('pointerdown', e => startDrag(def, bar, e));
    bar.addEventListener('dblclick', () => reset(def.id));
    bar.addEventListener('keydown', e => onKey(def, e));
    document.body.appendChild(bar);
    bars.set(def.id, bar);
    return bar;
  }
  function hint() {
    if (swapHint && swapHint.isConnected) return swapHint;
    swapHint = document.createElement('div');
    swapHint.className = 'dx-split-swap';
    swapHint.setAttribute('data-dex-split-swap-hint', '');
    document.body.appendChild(swapHint);
    return swapHint;
  }

  function position() {
    raf = 0;
    if (!document.body) return;
    for (const def of SPLITS) {
      const g = geometry(def);
      const bar = g ? barFor(def) : bars.get(def.id);
      if (!bar) continue;
      if (!g || g.vis.bottom - g.vis.top < 40) { if (!drag || drag.def !== def) bar.style.display = 'none'; continue; }
      bar.style.display = 'block';
      bar.style.top = g.vis.top + 'px';
      bar.style.height = (g.vis.bottom - g.vis.top) + 'px';
      if (!drag || drag.def !== def) bar.style.left = g.x + 'px';
      bar.firstChild.style.top = ((g.vis.bottom - g.vis.top) / 2) + 'px';
      bar.setAttribute('data-settings-side', g.side);
      bar.setAttribute('aria-valuenow', String(Math.round(g.settingsWidth)));
      bar.setAttribute('aria-valuemin', String(MIN_SETTINGS));
      bar.setAttribute('aria-valuemax', String(Math.round(Math.max(MIN_SETTINGS, g.box.getBoundingClientRect().width - MIN_CANVAS))));
    }
  }
  const schedule = () => { if (!raf) raf = requestAnimationFrame(position); };

  // Geometry updates are frame-scheduled. Reflect an accepted layout state on
  // the separator immediately so keyboard and assistive consumers never see
  // the old side while the next frame is pending.
  function syncBarSide(id) {
    const def = SPLITS.find(x => x.id === id);
    const bar = bars.get(id);
    if (def && bar) bar.setAttribute('data-settings-side', sideOf(def, layout[id]));
  }

  function setEntry(id, patch, transient) {
    layout[id] = Object.assign({}, layout[id], patch);
    if (!layout[id].width && !layout[id].swapped) delete layout[id];
    if (!transient) save();
    applyLayout(); syncBarSide(id); schedule();
  }
  function reset(id) { delete layout[id]; save(); applyLayout(); syncBarSide(id); schedule(); }
  function swap(id) { const e = layout[id] || {}; setEntry(id, { swapped: !e.swapped, width: e.width || null }); }

  function startDrag(def, bar, e) {
    if (e.button !== 0) return;
    const g = geometry(def); if (!g) return;
    e.preventDefault();
    try { bar.setPointerCapture(e.pointerId); } catch (_) {}
    drag = { def, bar, g, startWidth: g.settingsWidth, prevWidth: (layout[def.id] || {}).width || null, swap: false, moved: false };
    bar.setAttribute('data-dragging', '');
    document.documentElement.setAttribute('data-dx-split-dragging', '');
    const move = ev => {
      const box = drag.g.box.getBoundingClientRect();
      const res = dragResult(ev.clientX, box, drag.g.side, drag.g.gap);
      drag.moved = drag.moved || Math.abs(ev.clientX - e.clientX) > 2;
      drag.swap = res.swap;
      const h = hint();
      if (res.swap) {
        if ((layout[def.id] || {}).width !== drag.prevWidth) setEntry(def.id, { width: drag.prevWidth }, true);
        bar.style.left = (drag.g.side === 'right' ? box.left + 6 : box.right - 6) + 'px';
        const w = Math.min(drag.startWidth, box.width - MIN_CANVAS);
        h.style.display = 'flex';
        h.style.top = drag.g.vis.top + 8 + 'px'; h.style.height = Math.max(40, drag.g.vis.bottom - drag.g.vis.top - 16) + 'px';
        h.style.width = Math.max(120, w - 16) + 'px';
        h.style.left = (drag.g.side === 'right' ? box.left + 8 : box.right - 8 - Math.max(120, w - 16)) + 'px';
        h.textContent = 'Release to move the settings to the ' + (drag.g.side === 'right' ? 'left' : 'right');
      } else {
        h.style.display = 'none';
        drag.width = res.width;
        bar.style.left = (drag.g.side === 'right' ? box.right - res.width - drag.g.gap / 2 : box.left + res.width + drag.g.gap / 2) + 'px';
        setEntry(def.id, { width: res.width }, true);
      }
    };
    const end = () => {
      bar.removeEventListener('pointermove', move); bar.removeEventListener('pointerup', end); bar.removeEventListener('pointercancel', end);
      bar.removeAttribute('data-dragging');
      document.documentElement.removeAttribute('data-dx-split-dragging');
      if (swapHint) swapHint.style.display = 'none';
      const d = drag; drag = null;
      const cur = layout[def.id] || {};
      // Swapping keeps the width the settings had before this drag, not the width passed on the way across.
      if (d && d.swap) setEntry(def.id, { swapped: !cur.swapped, width: d.prevWidth });
      else if (d && d.moved) setEntry(def.id, {});
      schedule();
    };
    bar.addEventListener('pointermove', move); bar.addEventListener('pointerup', end); bar.addEventListener('pointercancel', end);
  }

  function onKey(def, e) {
    const g = geometry(def); if (!g) return;
    const total = g.box.getBoundingClientRect().width;
    let grow = 0;
    if (e.key === 'ArrowLeft') grow = g.side === 'right' ? KEY_STEP : -KEY_STEP;
    else if (e.key === 'ArrowRight') grow = g.side === 'right' ? -KEY_STEP : KEY_STEP;
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); swap(def.id); return; }
    else if (e.key === 'Home') { e.preventDefault(); reset(def.id); return; }
    else return;
    e.preventDefault();
    setEntry(def.id, { width: clampWidth(g.settingsWidth + grow, total) });
  }

  function start() {
    mountStyles(); applyLayout();
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', schedule);
    document.addEventListener('scroll', schedule, true);
    setInterval(schedule, 1000);   // cheap safety net for layout changes no observer reports (fonts, images)
    schedule();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();

  return {
    SPLITS, MIN_SETTINGS, MIN_CANVAS, SWAP_ZONE, clampWidth, dragResult, columnsFor, cssFor, sideOf,
    layout: () => JSON.parse(JSON.stringify(layout)), reset, swap, refresh: schedule,
    setWidth: (id, w) => setEntry(id, { width: w }),
  };
});
