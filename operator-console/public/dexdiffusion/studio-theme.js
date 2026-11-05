// Studio color scheme: replace any of the studio's colors, and keep prompt boxes brighter than what is behind them.
//
// The studio's colors are written inline throughout its templates, so a theme cannot be a handful of CSS variables.
// Instead this module keeps a map of "from" colors to "to" colors and rewrites them wherever they appear: element
// style attributes, SVG fill/stroke, and <style> sheets. A MutationObserver applies the map to everything the
// studio renders later. With no colors changed the observer only watches for prompt boxes.
//
// A theme color ("Workspace background", "Info cards", ...) groups a main color with its near-identical shades.
// Changing it moves every shade by the same hue/saturation/lightness step, so hover and border variants keep their
// relationship. Translucent variants (rgba, #rrggbbaa) keep their alpha.
//
// Prompt boxes (every multi-line text box) get a background a set amount brighter than the surface they sit on,
// 20% toward white by default. The amount, or a fixed color, is adjustable in System → Color scheme.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DexTheme = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const STORE_KEY = 'dex_theme_v1';
  const DEFAULT_LIFT = 20;

  const ROLES = [
    { id: 'workspace', group: 'Backgrounds', label: 'Workspace background', primary: '#100f18', members: ['#0c0b14', '#09080f', '#120f1d', '#0e0d12', '#0e0e11'] },
    { id: 'panels', group: 'Backgrounds', label: 'Header and settings panels', primary: '#160f22', members: ['#130d1d', '#110a1e', '#140e20'] },
    { id: 'cards', group: 'Backgrounds', label: 'Info cards and inputs (blue)', primary: '#091420', members: ['#060a10', '#080c12', '#050a12', '#0d1117', '#08121a', '#0b1520', '#071018', '#0c1520', '#0a101a', '#111722', '#0b1420', '#0d1823', '#101b27', '#0a111c', '#060b12', '#05080d', '#132130'] },
    { id: 'frame', group: 'Backgrounds', label: 'Window frame and top bar', primary: '#08080c', members: ['#06060a', '#0a0a0e'] },
    { id: 'prompt', group: 'Backgrounds', label: 'Prompt boxes', special: 'prompt' },
    { id: 'text', group: 'Text and lines', label: 'Main text', primary: '#eeeaf8', members: ['#e2e8f0', '#dbe7f3', '#f8fafc', '#f1f5f9', '#cbd5e1', '#e2e2e8', '#e8e8f8', '#e0e0f0', '#f1f3f6', '#e8f0f7'] },
    { id: 'muted', group: 'Text and lines', label: 'Muted text and lines', primary: '#94a3b8', members: ['#93a3b8', '#9090b4', '#8888b0', '#7f93a8', '#8193a8', '#7f8ca8', '#64748b', '#7878a8', '#7070a0', '#9090b8', '#91a2b4'] },
    { id: 'violet-line', group: 'Text and lines', label: 'Panel outlines (violet)', primary: '#c8b4ff', members: [] },
    { id: 'orange', group: 'Accents', label: 'Primary accent (orange)', primary: '#f59e0b', members: ['#fb923c', '#f97316'] },
    { id: 'blue', group: 'Accents', label: 'Info accent (blue)', primary: '#38bdf8', members: ['#7dd3fc', '#0ea5e9'] },
    { id: 'violet', group: 'Accents', label: 'Violet accent', primary: '#a78bfa', members: ['#c4b5fd', '#e9d5ff', '#ddd6fe', '#8b5cf6', '#a5b4fc'] },
    { id: 'green', group: 'Accents', label: 'Success (green)', primary: '#65d66e', members: ['#86efac', '#9ae6a5', '#22c55e'] },
    { id: 'amber', group: 'Accents', label: 'Warnings (amber)', primary: '#fbbf24', members: ['#fde68a', '#fcd34d'] },
    { id: 'red', group: 'Accents', label: 'Errors (red)', primary: '#ef4444', members: ['#fca5a5', '#f87171', '#fecaca'] },
  ];

  // ── colour maths (pure, exported for tests) ───────────────────────────────────────────────────────────────
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  function parseHex(hex) {
    const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim()); if (!m) return null;
    let h = m[1]; if (h.length === 3) h = h.split('').map(c => c + c).join('');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const toHex = rgb => '#' + rgb.map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
  const key = rgb => rgb.map(v => Math.round(v)).join(',');
  function rgbToHsl([r, g, b]) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h * 60, s, l];
  }
  function hslToRgb([h, s, l]) {
    h = ((h % 360) + 360) % 360 / 360;
    if (s === 0) return [l * 255, l * 255, l * 255];
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    const f = t => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
    return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
  }
  function rgbToHsv([r, g, b]) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [(h * 60 + 360) % 360, max ? d / max : 0, max];
  }
  function hsvToRgb([h, s, v]) {
    const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
    const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
  }
  // Move `member` by the same hue/saturation/lightness step that takes `from` to `to`.
  function shift(member, from, to) {
    if (key(member) === key(from)) return to.slice();
    const a = rgbToHsl(from), b = rgbToHsl(to), m = rgbToHsl(member);
    // A grey has no hue: take the target's hue so a grey family can become a colour.
    const hue = a[1] < 0.02 ? b[0] : m[0] + (b[0] - a[0]);
    return hslToRgb([hue, clamp(m[1] + (b[1] - a[1]), 0, 1), clamp(m[2] + (b[2] - a[2]), 0, 1)]).map(Math.round);
  }
  // Theme state → Map("r,g,b" → [r,g,b]).
  function buildMap(state, roles) {
    const map = new Map(), list = roles || ROLES, over = (state && state.overrides) || {};
    for (const role of list) {
      if (role.special) continue;
      const to = parseHex(over[role.id]); if (!to) continue;
      const from = parseHex(role.primary);
      for (const hex of [role.primary].concat(role.members || [])) {
        const c = parseHex(hex); if (!c || map.has(key(c))) continue;
        const out = shift(c, from, to);
        if (key(out) !== key(c)) map.set(key(c), out);
      }
    }
    for (const [id, hex] of Object.entries(over)) {   // single colours picked from "More colours on this screen"
      if (!id.startsWith('c:')) continue;
      const from = parseHex(id.slice(2)), to = parseHex(hex);
      if (from && to && !map.has(key(from)) && key(from) !== key(to)) map.set(key(from), to);
    }
    return map;
  }
  const COLOR_RE = /#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-zA-Z_-])|rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([\d.]+%?)\s*)?\)/g;
  function remapText(text, map) {
    if (!text || !map || !map.size) return text;
    return text.replace(COLOR_RE, (all, hex, r, g, b, a) => {
      if (hex) {
        const body = hex.length === 8 ? hex.slice(0, 6) : hex;
        const c = parseHex(body); const out = c && map.get(key(c));
        if (!out) return all;
        return toHex(out) + (hex.length === 8 ? hex.slice(6) : '');
      }
      const out = map.get(r + ',' + g + ',' + b); if (!out) return all;
      const rgb = out.map(v => Math.round(v)).join(', ');
      return a !== undefined ? 'rgba(' + rgb + ', ' + a + ')' : 'rgb(' + rgb + ')';
    });
  }
  function colorsIn(text) {
    const out = [];
    if (!text) return out;
    text.replace(COLOR_RE, (all, hex, r, g, b) => {
      const c = hex ? parseHex(hex.length === 8 ? hex.slice(0, 6) : hex) : [Number(r), Number(g), Number(b)];
      if (c) out.push(toHex(c));
      return all;
    });
    return out;
  }
  // Composite translucent layers (topmost last) over an opaque base, then lift toward white by `lift` percent.
  function composite(layers, base) {
    let c = base.slice(0, 3);
    for (const [r, g, b, a] of layers) c = [r * a + c[0] * (1 - a), g * a + c[1] * (1 - a), b * a + c[2] * (1 - a)];
    return c;
  }
  const lighten = (rgb, pct) => rgb.map(v => Math.round(v + (255 - v) * clamp(pct, 0, 100) / 100));
  const roleById = id => ROLES.find(r => r.id === id) || (String(id).startsWith('c:') ? { id, group: 'More', label: id.slice(2), primary: id.slice(2), members: [] } : null);

  const pure = { ROLES, STORE_KEY, DEFAULT_LIFT, parseHex, toHex, rgbToHsl, hslToRgb, rgbToHsv, hsvToRgb, shift, buildMap, remapText, colorsIn, composite, lighten, roleById };
  if (typeof document === 'undefined') return pure;

  // ── browser: state ────────────────────────────────────────────────────────────────────────────────────────
  let state = { overrides: {}, promptLift: DEFAULT_LIFT, promptColor: null };
  try {
    const v = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (v && typeof v === 'object') state = { overrides: v.overrides && typeof v.overrides === 'object' ? v.overrides : {}, promptLift: Number.isFinite(v.promptLift) ? v.promptLift : DEFAULT_LIFT, promptColor: parseHex(v.promptColor) ? v.promptColor : null };
  } catch (_) {}
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (_) {} };
  let map = buildMap(state);

  // ── browser: rewriting colours ────────────────────────────────────────────────────────────────────────────
  const ATTRS = ['style', 'fill', 'stroke'];
  const records = { style: new WeakMap(), fill: new WeakMap(), stroke: new WeakMap(), text: new WeakMap() };
  const skip = el => !!(el.closest && el.closest('[data-dex-theme-skip]'));
  function processAttr(el, attr) {
    const cur = el.getAttribute(attr); if (cur == null) return;
    const rec = records[attr].get(el);
    if (rec && rec.out === cur) { if (rec.map === map) return; }
    const orig = rec && rec.out === cur ? rec.orig : cur;
    if (!map.size && !rec) return;
    if (skip(el)) return;
    const out = remapText(orig, map);
    records[attr].set(el, { orig, out, map });
    if (out !== cur) el.setAttribute(attr, out);
  }
  function processSheet(el) {
    if (el.hasAttribute('data-dex-theme-skip')) return;
    const cur = el.textContent, rec = records.text.get(el);
    if (rec && rec.out === cur && rec.map === map) return;
    const orig = rec && rec.out === cur ? rec.orig : cur;
    if (!map.size && !rec) return;
    const out = remapText(orig, map);
    records.text.set(el, { orig, out, map });
    if (out !== cur) el.textContent = out;
  }
  function processTree(node) {
    if (!(node instanceof Element)) { if (node && node.parentNode && node.parentNode.tagName === 'STYLE') processSheet(node.parentNode); return; }
    if (node.tagName === 'STYLE') { processSheet(node); return; }
    for (const a of ATTRS) if (node.hasAttribute(a)) processAttr(node, a);
    for (const el of node.querySelectorAll('[style],[fill],[stroke],style')) {
      if (el.tagName === 'STYLE') processSheet(el); else for (const a of ATTRS) if (el.hasAttribute(a)) processAttr(el, a);
    }
  }
  function applyAll() { processTree(document.documentElement); schedulePrompts(); }

  // ── browser: prompt boxes ─────────────────────────────────────────────────────────────────────────────────
  const PROMPT_SEL = 'textarea, dex-prompt-field';
  const promptSheet = document.createElement('style');
  promptSheet.setAttribute('data-dex-theme-skip', '');
  promptSheet.setAttribute('data-dex-prompt-tints', '');
  const ownSheet = document.createElement('style');
  ownSheet.setAttribute('data-dex-theme-skip', '');
  ownSheet.textContent = '[data-dx-prompt]::placeholder{color:rgba(238,234,248,.58)!important}' +
    '[data-dex-theme-panel] .dx-th-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}' +
    '[data-dex-theme-panel] select,[data-dex-theme-panel] input[type=text]{min-height:36px;border-radius:7px;border:1px solid rgba(148,163,184,.4);background:rgba(0,0,0,.3);color:inherit;padding:6px 9px;font:inherit;font-size:13px}' +
    '[data-dex-theme-panel] button{border:1px solid rgba(148,163,184,.4);background:rgba(148,163,184,.1);color:#dbe7f3;border-radius:7px;padding:7px 11px;font-size:12px;font-weight:600;cursor:pointer;min-height:34px}' +
    '[data-dex-theme-panel] .dx-th-swatch{width:44px;height:34px;border-radius:7px;border:1px solid rgba(255,255,255,.35);padding:0;box-shadow:inset 0 0 0 2px rgba(0,0,0,.35)}' +
    '[data-dex-theme-panel] .dx-th-picker{display:grid;grid-template-columns:minmax(180px,260px) 22px minmax(160px,1fr);gap:12px;align-items:start;border:1px solid rgba(148,163,184,.25);border-radius:9px;padding:12px;background:rgba(0,0,0,.25)}' +
    '[data-dex-theme-panel] .dx-th-sv{position:relative;height:170px;border-radius:7px;cursor:crosshair;touch-action:none}' +
    '[data-dex-theme-panel] .dx-th-hue{position:relative;height:170px;border-radius:7px;cursor:ns-resize;touch-action:none;background:linear-gradient(to bottom,#f00 0%,#ff0 17%,#0f0 33%,#0ff 50%,#00f 67%,#f0f 83%,#f00 100%)}' +
    '[data-dex-theme-panel] .dx-th-knob{position:absolute;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;border:2px solid #fff;box-shadow:0 0 0 1px #000,0 1px 3px #000;pointer-events:none}' +
    '[data-dex-theme-panel] .dx-th-hue .dx-th-knob{left:50%;width:26px;height:8px;margin:-4px 0 0 -13px;border-radius:4px}' +
    '[data-dex-theme-panel] .dx-th-chip{display:inline-flex;align-items:center;gap:6px;border:1px solid rgba(148,163,184,.3);border-radius:999px;padding:3px 4px 3px 8px;font-size:12px}' +
    '[data-dex-theme-panel] .dx-th-chip i{display:inline-block;width:14px;height:14px;border-radius:4px;border:1px solid rgba(255,255,255,.3)}' +
    '[data-dex-theme-panel] .dx-th-chip button{min-height:22px;padding:1px 7px;font-size:11px;border-radius:999px}' +
    '@media (max-width:640px){[data-dex-theme-panel] .dx-th-picker{grid-template-columns:minmax(0,1fr) 22px}}';
  const parseCss = s => { const m = /rgba?\(([^)]+)\)/.exec(s || ''); if (!m) return null; const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
  // The colour a prompt box sits on: its ancestors' backgrounds composited from the first opaque one upward.
  function backdropOf(el) {
    const layers = [];
    for (let a = el.parentElement; a; a = a.parentElement) {
      const cs = getComputedStyle(a);
      let c = parseCss(cs.backgroundColor);
      if ((!c || !c[3]) && cs.backgroundImage && cs.backgroundImage !== 'none') c = parseCss(cs.backgroundImage);
      if (c && c[3] > 0) { layers.push(c); if (c[3] >= 1) break; }
    }
    if (!layers.length) return [16, 15, 24];
    const base = layers[layers.length - 1][3] >= 1 ? layers.pop() : [8, 8, 12, 1];
    return composite(layers.reverse(), base);
  }
  let promptRaf = 0;
  function tintPrompts() {
    promptRaf = 0;
    const fixed = parseHex(state.promptColor);
    const css = new Map(); let n = 0;
    for (const el of document.querySelectorAll(PROMPT_SEL)) {
      if (el.tagName === 'TEXTAREA' && el.parentElement && el.parentElement.closest('dex-prompt-field')) continue;
      if (el.closest('[data-dex-theme-panel]')) continue;
      const rgb = fixed || lighten(backdropOf(el), state.promptLift);
      const hex = toHex(rgb);
      let id = css.get(hex); if (!id) { id = 'p' + (n++); css.set(hex, id); }
      if (el.getAttribute('data-dx-prompt') !== id) el.setAttribute('data-dx-prompt', id);
    }
    let text = '';
    for (const [hex, id] of css) text += '[data-dx-prompt="' + id + '"]{background-color:' + hex + '!important;background-image:none!important}';
    if (promptSheet.textContent !== text) promptSheet.textContent = text;
  }
  const schedulePrompts = () => { if (!promptRaf) promptRaf = requestAnimationFrame(tintPrompts); };

  function observe() {
    new MutationObserver(list => {
      let prompts = false;
      for (const m of list) {
        if (m.type === 'attributes') {
          const name = m.attributeName;
          if (ATTRS.includes(name) && (map.size || records[name].has(m.target))) processAttr(m.target, name);
          prompts = true; continue;
        }
        if (m.target && m.target.tagName === 'STYLE') { processSheet(m.target); continue; }
        for (const n of m.addedNodes) { if (map.size) processTree(n); prompts = true; }
      }
      if (prompts) schedulePrompts();
    }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ATTRS.concat(['class']) });
  }

  // ── browser: public operations ────────────────────────────────────────────────────────────────────────────
  const listeners = new Set();
  const changed = () => { map = buildMap(state); save(); applyAll(); for (const fn of listeners) { try { fn(); } catch (_) {} } };
  function currentHex(roleId) {
    if (roleId === 'prompt') {
      if (state.promptColor) return state.promptColor;
      const el = document.querySelector('[data-dx-prompt]'); const c = el && parseCss(getComputedStyle(el).backgroundColor);
      return c ? toHex(c) : toHex(lighten(parseHex('#160f22'), state.promptLift));
    }
    const role = roleById(roleId); if (!role) return null;
    return state.overrides[roleId] || role.primary;
  }
  function setColor(roleId, hex) {
    const c = parseHex(hex); if (!c) return false;
    if (roleId === 'prompt') state.promptColor = toHex(c); else state.overrides[roleId] = toHex(c);
    changed(); return true;
  }
  function resetColor(roleId) {
    if (roleId === 'prompt') state.promptColor = null; else delete state.overrides[roleId];
    changed();
  }
  function resetAll() { state = { overrides: {}, promptLift: DEFAULT_LIFT, promptColor: null }; changed(); }
  function setPromptLift(pct) { state.promptLift = clamp(Math.round(Number(pct) || 0), 0, 60); changed(); }
  // Colours in use on the current screen that no theme colour covers, most used first.
  function screenColors(limit) {
    const known = new Set();
    for (const r of ROLES) for (const h of [r.primary].concat(r.members || [])) if (h) known.add(h);
    const counts = new Map();
    for (const el of document.querySelectorAll('#app-root [style]')) {
      if (!el.getClientRects().length) continue;
      const rec = records.style.get(el), text = rec && rec.out === el.getAttribute('style') ? rec.orig : el.getAttribute('style');
      for (const hex of colorsIn(text)) if (!known.has(hex)) counts.set(hex, (counts.get(hex) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit || 16).map(([hex, count]) => ({ hex, count }));
  }

  // ── browser: System → Color scheme panel (a persistent DOM node the studio template mounts) ─────────────────
  let panel = null;
  const ui = { role: 'workspace', open: false, hsv: [0, 0, 0] };
  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith('on')) n.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'style') n.style.cssText = v;
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) n.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
    return n;
  }
  const roleLabel = id => (roleById(id) || { label: id }).label;
  function fillOptions(select) {
    const keep = ui.role;
    select.textContent = '';
    const groups = new Map();
    for (const r of ROLES) { if (!groups.has(r.group)) groups.set(r.group, []); groups.get(r.group).push(r); }
    for (const [g, roles] of groups) select.appendChild(el('optgroup', { label: g }, roles.map(r => el('option', { value: r.id }, r.label + (r.id === 'prompt' ? (state.promptColor ? ' (custom)' : ' (auto)') : state.overrides[r.id] ? ' (changed)' : '')))));
    const custom = Object.keys(state.overrides).filter(k => k.startsWith('c:')).map(k => ({ hex: k.slice(2) }));
    const more = custom.concat(screenColors(16).filter(c => !state.overrides['c:' + c.hex]));
    if (more.length) select.appendChild(el('optgroup', { label: 'More colors on this screen' }, more.map(c => el('option', { value: 'c:' + c.hex }, c.hex + (state.overrides['c:' + c.hex] ? ' (changed)' : '')))));
    if (![...select.options].some(o => o.value === keep)) select.appendChild(el('option', { value: keep }, roleLabel(keep)));
    select.value = keep;
  }
  function renderPicker(root) {
    const hex = currentHex(ui.role) || '#000000';
    const [h, s, v] = ui.hsv;
    const sv = root.querySelector('.dx-th-sv'), hue = root.querySelector('.dx-th-hue');
    sv.style.background = 'linear-gradient(to top,#000,transparent),linear-gradient(to right,#fff,hsl(' + h + ',100%,50%))';
    sv.firstChild.style.left = (s * 100) + '%'; sv.firstChild.style.top = ((1 - v) * 100) + '%';
    hue.firstChild.style.top = (h / 360 * 100) + '%';
    root.querySelector('[data-theme-new]').style.background = hex;
    const input = root.querySelector('[data-theme-hex]'); if (document.activeElement !== input) input.value = hex;
  }
  function renderPanel() {
    if (!panel) return;
    const select = panel.querySelector('[data-theme-role]');
    if (document.activeElement !== select) fillOptions(select);
    const hex = currentHex(ui.role) || '#000000';
    const sw = panel.querySelector('[data-theme-swatch]'); sw.style.background = hex; sw.title = 'Change ' + roleLabel(ui.role) + ' (' + hex + ')';
    panel.querySelector('[data-theme-current]').textContent = roleLabel(ui.role) + ' · ' + hex;
    const picker = panel.querySelector('[data-theme-picker]'); picker.hidden = !ui.open;
    const role = roleById(ui.role);
    panel.querySelector('[data-theme-was]').style.background = role && role.special === 'prompt' ? toHex(lighten(parseHex('#160f22'), DEFAULT_LIFT)) : (role ? role.primary : hex);
    if (ui.open) renderPicker(picker);
    const lift = panel.querySelector('[data-theme-lift]'); lift.value = String(state.promptLift);
    panel.querySelector('[data-theme-lift-label]').textContent = state.promptColor ? 'Prompt boxes use a fixed color (' + state.promptColor + '). Reset "Prompt boxes" to go back to automatic.' : 'Prompt boxes are ' + state.promptLift + '% brighter than the background behind them.';
    lift.disabled = !!state.promptColor;
    const list = panel.querySelector('[data-theme-changed]'); list.textContent = '';
    const changedIds = Object.keys(state.overrides).concat(state.promptColor ? ['prompt'] : []);
    if (!changedIds.length) list.appendChild(el('span', { style: 'font-size:12px;opacity:.75' }, 'No colors changed. The studio uses its original scheme.'));
    for (const id of changedIds) {
      const to = id === 'prompt' ? state.promptColor : state.overrides[id];
      list.appendChild(el('span', { class: 'dx-th-chip', 'data-theme-chip': id }, el('i', { 'data-dex-theme-skip': true, style: 'background:' + to }), roleLabel(id) + ' → ' + to,
        el('button', { type: 'button', title: 'Put back the original', onClick: () => { resetColor(id); } }, 'Reset')));
    }
  }
  function openPicker(roleId) {
    ui.role = roleId; ui.open = true;
    ui.hsv = rgbToHsv(parseHex(currentHex(roleId)) || [0, 0, 0]);
    renderPanel();
  }
  let liveRaf = 0, pendingHex = null;
  function liveSet(hex) {
    pendingHex = hex;
    if (liveRaf) return;
    liveRaf = requestAnimationFrame(() => { liveRaf = 0; if (pendingHex) setColor(ui.role, pendingHex); pendingHex = null; });
  }
  function dragOn(node, onPoint) {
    node.addEventListener('pointerdown', e => {
      e.preventDefault();
      try { node.setPointerCapture(e.pointerId); } catch (_) {}
      const handle = ev => { const r = node.getBoundingClientRect(); onPoint(clamp((ev.clientX - r.left) / r.width, 0, 1), clamp((ev.clientY - r.top) / r.height, 0, 1)); };
      handle(e);
      const up = () => { node.removeEventListener('pointermove', handle); node.removeEventListener('pointerup', up); node.removeEventListener('pointercancel', up); };
      node.addEventListener('pointermove', handle); node.addEventListener('pointerup', up); node.addEventListener('pointercancel', up);
    });
  }
  function panelNode() {
    if (panel) { renderPanel(); return panel; }
    const select = el('select', { 'data-theme-role': true, 'aria-label': 'Color to change', style: 'min-width:240px;max-width:100%', onChange: e => openPicker(e.target.value), onFocus: () => fillOptions(select) });
    const sv = el('div', { class: 'dx-th-sv', 'data-theme-sv': true, 'data-dex-theme-skip': true, role: 'slider', 'aria-label': 'Saturation and brightness' }, el('span', { class: 'dx-th-knob' }));
    const hue = el('div', { class: 'dx-th-hue', 'data-theme-hue': true, 'data-dex-theme-skip': true, role: 'slider', 'aria-label': 'Hue' }, el('span', { class: 'dx-th-knob' }));
    const fromHsv = () => toHex(hsvToRgb(ui.hsv));
    dragOn(sv, (x, y) => { ui.hsv = [ui.hsv[0], x, 1 - y]; const hx = fromHsv(); renderPicker(panel.querySelector('[data-theme-picker]')); panel.querySelector('[data-theme-new]').style.background = hx; panel.querySelector('[data-theme-hex]').value = hx; liveSet(hx); });
    dragOn(hue, (x, y) => { ui.hsv = [Math.min(359.9, y * 360), ui.hsv[1], ui.hsv[2]]; const hx = fromHsv(); renderPicker(panel.querySelector('[data-theme-picker]')); panel.querySelector('[data-theme-new]').style.background = hx; panel.querySelector('[data-theme-hex]').value = hx; liveSet(hx); });
    const hexInput = el('input', { type: 'text', 'data-theme-hex': true, 'aria-label': 'Hex color', spellcheck: 'false', style: 'width:110px;font-family:"IBM Plex Mono",monospace',
      onChange: e => { const c = parseHex(e.target.value); if (!c) { e.target.value = currentHex(ui.role); return; } ui.hsv = rgbToHsv(c); setColor(ui.role, toHex(c)); } });
    panel = el('section', { 'data-dex-theme-panel': true, style: 'border:1px solid rgba(148,163,184,.25);border-radius:9px;padding:12px;display:grid;gap:10px;' },
      el('div', { style: 'font-weight:700' }, 'Color scheme'),
      el('small', { style: 'opacity:.85;line-height:1.5' }, 'Choose a color the studio uses, then pick its replacement from the spectrum. Every place that color appears changes, including its lighter and darker shades. Changes apply right away and are kept on this device.'),
      el('div', { class: 'dx-th-row' },
        el('label', { for: 'dex-theme-role', style: 'font-size:12px;font-weight:700' }, 'Color to change'),
        Object.assign(select, { id: 'dex-theme-role' }),
        el('button', { type: 'button', class: 'dx-th-swatch', 'data-theme-swatch': true, 'data-dex-theme-skip': true, 'aria-label': 'Open the color spectrum', onClick: () => (ui.open ? (ui.open = false, renderPanel()) : openPicker(ui.role)) }),
        el('span', { 'data-theme-current': true, style: 'font-size:12px;font-family:"IBM Plex Mono",monospace;opacity:.85' })),
      el('div', { class: 'dx-th-picker', 'data-theme-picker': true, hidden: true },
        sv, hue,
        el('div', { style: 'display:grid;gap:8px;align-content:start' },
          el('div', { class: 'dx-th-row', style: 'font-size:12px' },
            el('span', null, 'Original'), el('i', { 'data-theme-was': true, 'data-dex-theme-skip': true, style: 'display:inline-block;width:34px;height:24px;border-radius:5px;border:1px solid rgba(255,255,255,.3)' }),
            el('span', null, 'New'), el('i', { 'data-theme-new': true, 'data-dex-theme-skip': true, style: 'display:inline-block;width:34px;height:24px;border-radius:5px;border:1px solid rgba(255,255,255,.3)' })),
          el('label', { class: 'dx-th-row', style: 'font-size:12px' }, 'Hex', hexInput),
          el('div', { class: 'dx-th-row' },
            el('button', { type: 'button', 'data-theme-reset-one': true, onClick: () => { resetColor(ui.role); openPicker(ui.role); } }, 'Reset this color'),
            el('button', { type: 'button', 'data-theme-done': true, onClick: () => { ui.open = false; renderPanel(); } }, 'Done')))),
      el('div', { style: 'display:grid;gap:5px' },
        el('label', { for: 'dex-theme-lift', style: 'font-size:12px;font-weight:700' }, 'Prompt box brightness'),
        el('div', { class: 'dx-th-row' },
          el('input', { id: 'dex-theme-lift', type: 'range', min: '0', max: '60', step: '1', 'data-theme-lift': true, style: 'width:220px', onInput: e => setPromptLift(e.target.value) }),
          el('span', { 'data-theme-lift-label': true, style: 'font-size:12px;opacity:.85' }))),
      el('div', { style: 'display:grid;gap:6px' },
        el('div', { style: 'font-size:12px;font-weight:700' }, 'Changed colors'),
        el('div', { class: 'dx-th-row', 'data-theme-changed': true })),
      el('div', { class: 'dx-th-row' }, el('button', { type: 'button', 'data-theme-reset-all': true, onClick: () => { resetAll(); ui.open = false; renderPanel(); } }, 'Reset all colors')));
    listeners.add(renderPanel);
    renderPanel();
    return panel;
  }

  // For the studio template: the same wrapper object while the panel is on screen (so the runtime leaves it alone),
  // a new one when it is not (the runtime only re-inserts a slot whose value changed).
  let slot = null;
  function panelSlot() {
    const node = panelNode();
    if (!slot || !node.isConnected) slot = window.React && window.React.createElement ? window.React.createElement('div', { 'data-dex-theme-slot': '' }, node) : node;
    return slot;
  }

  function start() {
    if (!ownSheet.isConnected) document.head.appendChild(ownSheet);
    if (!promptSheet.isConnected) document.head.appendChild(promptSheet);
    observe();
    applyAll();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();

  return Object.assign({}, pure, {
    state: () => JSON.parse(JSON.stringify(state)), currentHex, setColor, resetColor, resetAll, setPromptLift, screenColors, panelNode, panelSlot, refresh: applyAll,
  });
});
