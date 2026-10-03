// One reusable fullscreen image viewer for every actual input/output image.
//
// Opt in with attributes on any element (usually the <img>):
//   data-fullscreen            → clicking/tapping opens the viewer
//   data-fullscreen="only"     → also stops the click reaching parent handlers
//   data-fullscreen-src="…"    → full image URL (defaults to the element's own src)
//   data-fullscreen-caption    → caption text
//   data-fullscreen-image-id   → canonical image id (the app can attach Edit actions)
// Elements inside [data-no-fullscreen] (the active inpaint mask editor) never open it,
// so painting is never interrupted.
//
// Keyboard: Esc closes, +/- zoom, 0 fit, Tab is trapped inside the dialog and focus
// returns to the opener on close. The page state underneath is never touched.
(function () {
  'use strict';
  let root = null, lastFocus = null, zoomed = false, onKey = null;

  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'style') n.style.cssText = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v);
    }
    for (const c of kids) if (c != null) n.append(c);
    return n;
  }

  function close() {
    if (!root) return;
    document.removeEventListener('keydown', onKey, true);
    root.remove(); root = null; zoomed = false;
    if (lastFocus && document.contains(lastFocus)) { try { lastFocus.focus(); } catch (_) {} }
    lastFocus = null;
  }

  function setZoom(img, box, z) {
    zoomed = z;
    if (z) {
      img.style.cssText = 'max-width:none;max-height:none;width:auto;height:auto;cursor:zoom-out;display:block;margin:auto;';
      box.style.overflow = 'auto'; box.style.alignItems = 'flex-start';
    } else {
      img.style.cssText = 'max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain;cursor:zoom-in;display:block;margin:auto;';
      box.style.overflow = 'hidden'; box.style.alignItems = 'center';
    }
  }

  // opts: { src, caption, alt, actions: [{ label, onClick }] }
  function open(opts) {
    const o = opts || {};
    if (!o.src) return false;
    close();
    lastFocus = document.activeElement;
    const img = el('img', { src: o.src, alt: o.alt || o.caption || 'Image', draggable: 'false', 'data-lightbox-image': '1' });
    const box = el('div', { style: 'flex:1;min-height:0;display:flex;justify-content:center;align-items:center;overflow:hidden;padding:8px;' }, img);
    setZoom(img, box, false);
    img.addEventListener('click', () => setZoom(img, box, !zoomed));
    const mkBtn = (label, fn, aria) => el('button', { type: 'button', 'aria-label': aria || label, onclick: fn,
      style: 'min-height:40px;min-width:40px;border:1px solid rgba(148,163,184,.35);background:rgba(15,23,42,.9);color:#e2e8f0;border-radius:8px;padding:6px 12px;font:600 13px DM Sans,system-ui,sans-serif;cursor:pointer;' }, label);
    const closeBtn = mkBtn('✕ Close', close, 'Close fullscreen image');
    const bar = el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:10px 12px;background:rgba(2,6,12,.92);border-bottom:1px solid rgba(148,163,184,.2);' },
      closeBtn,
      mkBtn('Fit', () => setZoom(img, box, false), 'Fit image to screen'),
      mkBtn('100%', () => setZoom(img, box, true), 'Show actual pixels'),
      ...(o.actions || []).map(a => mkBtn(a.label, () => { close(); a.onClick(); })),
      el('span', { style: 'flex:1;min-width:120px;color:#94a3b8;font:12px IBM Plex Mono,monospace;overflow-wrap:anywhere;' }, o.caption || ''));
    root = el('div', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Fullscreen image viewer', 'data-lightbox': '1',
      style: 'position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.94);display:flex;flex-direction:column;' }, bar, box);
    document.body.append(root);
    onKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
      if (e.key === '+' || e.key === '=') setZoom(img, box, true);
      else if (e.key === '-' || e.key === '0') setZoom(img, box, false);
      else if (e.key === 'Tab' && root) {
        const f = [...root.querySelectorAll('button')]; if (!f.length) return;
        const i = f.indexOf(document.activeElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && (i === -1 || i === f.length - 1)) { e.preventDefault(); f[0].focus(); }
      }
    };
    document.addEventListener('keydown', onKey, true);
    closeBtn.focus();
    return true;
  }

  // Delegated, capture-phase: works for elements re-created by every render.
  function onClick(e) {
    if (e.defaultPrevented && e.__dexLightbox) return;
    const t = e.target && e.target.closest ? e.target.closest('[data-fullscreen]') : null;
    if (!t) return;
    if (t.closest('[data-no-fullscreen]')) return;
    if (root && root.contains(t)) return;
    const src = t.getAttribute('data-fullscreen-src') || t.currentSrc || t.getAttribute('src');
    if (!src) return;
    const id = t.getAttribute('data-fullscreen-image-id');
    const app = window.__dex;
    const actions = id && app && typeof app.lightboxActions === 'function' ? app.lightboxActions(id) : [];
    const ok = open({ src, caption: t.getAttribute('data-fullscreen-caption') || id || '', alt: t.getAttribute('alt') || '', actions });
    if (ok && t.getAttribute('data-fullscreen') === 'only') { e.stopPropagation(); e.preventDefault(); }
  }
  document.addEventListener('click', onClick, true);

  window.DexLightbox = { open, close, isOpen: () => !!root };
})();
