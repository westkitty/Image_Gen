// One reusable fullscreen image viewer for every actual input/output image.
//
// Opt in with attributes on any element (usually the <img>):
//   data-fullscreen            → clicking/tapping opens the viewer
//   data-fullscreen="only"     → also stops the click reaching parent handlers
//   data-fullscreen-src="…"    → full image URL (defaults to the element's own src)
//   data-fullscreen-caption    → caption text
//   data-fullscreen-image-id   → canonical image id (the app can attach Edit actions)
//   data-fullscreen-return     → stable identity for an opener that may be remounted
// Elements inside [data-no-fullscreen] (the active inpaint mask editor) never open it,
// so painting is never interrupted.
//
// Keyboard: Esc closes, +/- zoom, 0 fit, Tab is trapped inside the dialog and focus
// returns to the opener on close. The page state underneath is never touched.
(function () {
  'use strict';
  let root = null, lastFocus = null, findOpener = null, zoomed = false, onKey = null, onCloseCb = null;

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
    const cb = onCloseCb; onCloseCb = null; if (cb) { try { cb(); } catch (_) {} }
    const opener = lastFocus?.isConnected ? lastFocus : findOpener?.();
    if (opener) opener.focus({ preventScroll: true });
    lastFocus = null;
    findOpener = null;
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

  // opts: { src, caption, alt, actions, downloadUrl, downloadName, onClose, opener, findOpener,
  //         collection: { items: [{ id, src, caption, downloadUrl }], index, actionsFor(id) } }
  // With a collection, Previous/Next follow exactly the supplied (filtered + sorted) list.
  function open(opts) {
    const o = opts || {};
    const col = o.collection && Array.isArray(o.collection.items) && o.collection.items.length ? o.collection : null;
    if (!o.src && !col) return false;
    close();
    lastFocus = o.opener || document.activeElement;
    findOpener = o.findOpener || null;
    onCloseCb = typeof o.onClose === 'function' ? o.onClose : null;
    let idx = col ? Math.min(Math.max(0, o.collection.index | 0), col.items.length - 1) : 0;
    const cur = () => (col ? col.items[idx] : { src: o.src, caption: o.caption, downloadUrl: o.downloadUrl, id: null });
    const img = el('img', { src: '', alt: '', draggable: 'false', 'data-lightbox-image': '1' });
    const errBox = el('div', { role: 'alert', 'data-lightbox-error': '1', style: 'display:none;color:#fca5a5;font:600 14px DM Sans,system-ui,sans-serif;padding:24px;text-align:center;' });
    const box = el('div', { style: 'flex:1;min-height:0;display:flex;justify-content:center;align-items:center;overflow:hidden;padding:8px;touch-action:pan-y;' }, img, errBox);
    setZoom(img, box, false);
    img.addEventListener('click', () => { if (img.__noToggle) { img.__noToggle = false; return; } setZoom(img, box, !zoomed); });
    const btnCss = 'min-height:40px;min-width:40px;border:1px solid rgba(148,163,184,.35);background:rgba(15,23,42,.9);color:#e2e8f0;border-radius:8px;padding:6px 12px;font:600 13px DM Sans,system-ui,sans-serif;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;';
    const mkBtn = (label, fn, aria) => el('button', { type: 'button', 'aria-label': aria || label, onclick: fn, style: btnCss }, label);
    const closeBtn = mkBtn('✕ Close', close, 'Close fullscreen image');
    const prevBtn = mkBtn('◀', () => go(-1), 'Previous image'); prevBtn.setAttribute('data-lightbox-prev', '1');
    const nextBtn = mkBtn('▶', () => go(1), 'Next image'); nextBtn.setAttribute('data-lightbox-next', '1');
    const counter = el('span', { 'data-lightbox-count': '1', 'aria-live': 'polite', style: 'color:#e2e8f0;font:600 13px IBM Plex Mono,monospace;min-width:70px;text-align:center;' });
    const dl = el('a', { 'data-lightbox-download': '1', style: btnCss + 'display:none;' }, '⬇ Download');
    const copyBtn = mkBtn('Copy Image', () => copyImage(cur(), copyBtn), 'Copy image to clipboard');
    const caption = el('span', { style: 'flex:1;min-width:120px;color:#94a3b8;font:12px IBM Plex Mono,monospace;overflow-wrap:anywhere;' });
    const actionsHost = el('span', { style: 'display:contents;' });
    const bar = el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:10px 12px;background:rgba(2,6,12,.92);border-bottom:1px solid rgba(148,163,184,.2);' },
      closeBtn, ...(col ? [prevBtn, counter, nextBtn] : []),
      mkBtn('Fit', () => setZoom(img, box, false), 'Fit image to screen'),
      mkBtn('100%', () => setZoom(img, box, true), 'Show actual pixels'),
      dl, copyBtn, actionsHost, caption);

    function paint() {
      const c = cur();
      errBox.style.display = 'none'; img.style.visibility = 'visible';
      img.onerror = () => { img.style.visibility = 'hidden'; errBox.textContent = 'This image could not be loaded (missing or corrupt). Use Previous/Next or Close to continue browsing.'; errBox.style.display = 'block'; };
      img.src = c.src || ''; img.alt = c.caption || 'Image';
      setZoom(img, box, false);
      caption.textContent = c.caption || '';
      if (c.downloadUrl) { dl.setAttribute('href', c.downloadUrl); dl.setAttribute('download', c.downloadName || c.id || ''); dl.style.display = 'inline-flex'; } else dl.style.display = 'none';
      if (col) {
        counter.textContent = (idx + 1) + ' / ' + col.items.length;
        prevBtn.disabled = idx <= 0; nextBtn.disabled = idx >= col.items.length - 1;
        prevBtn.style.opacity = prevBtn.disabled ? '.35' : '1'; nextBtn.style.opacity = nextBtn.disabled ? '.35' : '1';
        if (typeof col.onIndex === 'function') { try { col.onIndex(idx, c); } catch (_) {} }
      }
      actionsHost.textContent = '';
      const acts = col && typeof col.actionsFor === 'function' ? col.actionsFor(c.id) : (o.actions || []);
      for (const a of acts) { const b = mkBtn(a.label, () => { close(); a.onClick(); }); if (a.title) b.title = a.title; actionsHost.append(b); }
      // Warm the neighbours (bounded: at most one image each side).
      if (col) for (const d of [-1, 1]) { const n = col.items[idx + d]; if (n && n.src) { const pre = new Image(); pre.src = n.src; } }
    }
    function go(d) { if (!col) return; const n = idx + d; if (n < 0 || n >= col.items.length) return; idx = n; paint(); }

    root = el('div', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Fullscreen image viewer', 'data-lightbox': '1',
      style: 'position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.94);display:flex;flex-direction:column;' }, bar, box);
    document.body.append(root);
    paint();
    const ownsKeys = t => t && t.closest && t.closest('input,textarea,select,[contenteditable="true"]');
    onKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
      if (col && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !ownsKeys(e.target) && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); go(e.key === 'ArrowLeft' ? -1 : 1); return; }
      if (e.key === '+' || e.key === '=') setZoom(img, box, true);
      else if (e.key === '-' || e.key === '0') setZoom(img, box, false);
      else if (e.key === 'Tab' && root) {
        const f = [...root.querySelectorAll('button:not([disabled]),a[href]')]; if (!f.length) return;
        const i = f.indexOf(document.activeElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && (i === -1 || i === f.length - 1)) { e.preventDefault(); f[0].focus(); }
      }
    };
    document.addEventListener('keydown', onKey, true);
    // Swipe navigation only when the image is fitted (a zoomed image pans instead) and the gesture is mostly horizontal.
    let t0 = null;
    box.addEventListener('touchstart', e => { t0 = e.touches.length === 1 && !zoomed ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null; }, { passive: true });
    box.addEventListener('touchend', e => {
      if (!t0 || zoomed) { t0 = null; return; }
      const t = e.changedTouches[0], dx = t.clientX - t0.x, dy = t.clientY - t0.y; t0 = null;
      if (Math.abs(dx) > 50 && Math.abs(dx) > 2 * Math.abs(dy)) go(dx < 0 ? 1 : -1);
    }, { passive: true });
    // Drag to pan while zoomed (the box scrolls; this just maps pointer drags onto it).
    let drag = null;
    box.addEventListener('pointerdown', e => { if (!zoomed || e.button > 0) return; drag = { x: e.clientX, y: e.clientY, l: box.scrollLeft, t: box.scrollTop, moved: false }; box.setPointerCapture(e.pointerId); });
    box.addEventListener('pointermove', e => { if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true; box.scrollLeft = drag.l - dx; box.scrollTop = drag.t - dy; });
    const endDrag = () => { if (drag && drag.moved) img.__noToggle = true; drag = null; };
    box.addEventListener('pointerup', endDrag); box.addEventListener('pointercancel', endDrag);
    closeBtn.focus();
    return true;
  }

  // Binary clipboard copy where the browser allows it; otherwise say so (never a false success).
  async function copyImage(c, btn) {
    const say = t => { const old = btn.textContent; btn.textContent = t; setTimeout(() => { if (btn.isConnected) btn.textContent = 'Copy Image'; }, 2200); void old; };
    try {
      if (!(navigator.clipboard && window.ClipboardItem && window.isSecureContext)) throw new Error('unsupported');
      const r = await fetch(c.src); if (!r.ok) throw new Error('fetch');
      let blob = await r.blob();
      if (blob.type !== 'image/png') { // clipboard guarantees PNG only
        const bmp = await createImageBitmap(blob), cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
        cv.getContext('2d').drawImage(bmp, 0, 0); blob = await new Promise(res => cv.toBlob(res, 'image/png'));
      }
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      say('Copied ✓');
    } catch (_) { say('Copy unavailable — use Download'); }
  }

  // Delegated, capture-phase: works for elements re-created by every render.
  function onClick(e) {
    if (e.defaultPrevented && e.__dexLightbox) return;
    let t = e.target && e.target.closest ? e.target.closest('[data-fullscreen]') : null;
    if (!t) return;
    if (t === over && t.previousElementSibling) t = t.previousElementSibling; // the thumbnail under it is the opener
    if (t.closest('[data-no-fullscreen]')) return;
    if (root && root.contains(t)) return;
    const src = t.getAttribute('data-fullscreen-src') || t.currentSrc || t.getAttribute('src');
    if (!src) return;
    const id = t.getAttribute('data-fullscreen-image-id');
    const app = window.__dex;
    const actions = id && app && typeof app.lightboxActions === 'function' ? app.lightboxActions(id) : [];
    // The delegated image is the opener. Clicks otherwise blur the previous
    // control to body, which cannot receive meaningful returned focus.
    if (t.tabIndex >= 0) t.focus();
    const returnId = t.getAttribute('data-fullscreen-return');
    const findOpener = returnId ? () => document.querySelector('[data-fullscreen-return="' + CSS.escape(returnId) + '"]') : null;
    const ok = open({ src, caption: t.getAttribute('data-fullscreen-caption') || id || '', alt: t.getAttribute('alt') || '', actions, opener: t, findOpener });
    if (ok && t.getAttribute('data-fullscreen') === 'only') { e.stopPropagation(); e.preventDefault(); }
  }
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', e => {
    const opener = e.target?.closest?.('[data-fullscreen]');
    if (!opener || opener.closest('[data-no-fullscreen]') || opener.matches('button,a[href]')) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); opener.click(); }
  });

  // A thumbnail (data-fullscreen-src differs from its src) still drags, saves and copies as its original: while the pointer
  // rests on it or presses it, the original itself lies over it. One at a time, dropped when the pointer moves on.
  // A drag begun before the original has arrived is refused; it never hands over the thumbnail.
  let over = null, restTimer = 0, resting = null, failedSrc = null;
  const thumbOf = t => { const i = t && t.closest && t.closest('img[data-fullscreen-src]'); return i && !i.hasAttribute('data-original') && i.getAttribute('src') !== i.getAttribute('data-fullscreen-src') ? i : null; };
  function dropOriginal() { if (over) { over.onload = over.onerror = null; over.remove(); if (!over.complete) over.removeAttribute('src'); over = null; } }
  function layOriginal(thumb) {
    const src = thumb.getAttribute('data-fullscreen-src');
    if (!over || over.getAttribute('src') !== src) {
      dropOriginal();
      over = el('img', { alt: '', 'aria-hidden': 'true', 'data-original': '1', style: 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;cursor:zoom-in;' });
      for (const n of ['data-fullscreen', 'data-fullscreen-src', 'data-fullscreen-image-id', 'data-fullscreen-caption']) if (thumb.hasAttribute(n)) over.setAttribute(n, thumb.getAttribute(n));
      over.style.pointerEvents = 'none'; // until it has arrived, the thumbnail below stays the one in hand
      over.onload = () => { failedSrc = null; if (over) over.style.pointerEvents = ''; };
      over.onerror = () => { failedSrc = src; dropOriginal(); };
      over.fetchPriority = 'low';
      over.src = src;
    }
    if (over.previousElementSibling !== thumb) thumb.after(over); // a re-render replaces the cell; the loaded original moves across
  }
  document.addEventListener('pointerover', e => {
    if (e.buttons || (e.pointerType && e.pointerType !== 'mouse')) return; // a pressed pointer is holding its image
    if (over && over.parentElement && over.parentElement.contains(e.target)) return;
    const thumb = thumbOf(e.target), src = thumb && thumb.getAttribute('data-fullscreen-src');
    clearTimeout(restTimer); resting = thumb;
    if (over && over.getAttribute('src') === src) { layOriginal(thumb); return; }
    dropOriginal();
    if (thumb) restTimer = setTimeout(() => { if (resting === thumb && thumb.isConnected) layOriginal(thumb); }, 150);
  }, true);
  document.addEventListener('mousedown', e => {
    const thumb = thumbOf(e.target); if (!thumb) return;
    layOriginal(thumb);
    if (e.button === 2 || e.ctrlKey) over.style.pointerEvents = ''; // the menu's Save and Copy Address use the address, loaded or not
  }, true);
  document.addEventListener('dragstart', e => {
    const thumb = thumbOf(e.target); if (!thumb) return;
    e.preventDefault();
    layOriginal(thumb);
    const app = window.__dex;
    if (app && app.toast) app.toast(thumb.getAttribute('data-fullscreen-src') === failedSrc ? 'The original image could not be loaded, so it was not dragged.' : 'Loading the original image. Drag it again in a moment.', '#fbbf24');
  }, true);

  window.DexLightbox = { open, close, isOpen: () => !!root };
})();
