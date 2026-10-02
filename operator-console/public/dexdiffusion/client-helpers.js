// Pure DexDiffusion client helpers, shared by component.js and the Node tests.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DexClient = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // The UI and API share one origin, so the default backend base is '' and every
  // request is a relative '/api/...' path. That works unchanged from
  // 127.0.0.1, localhost and the Tailscale HTTPS hostname. A stored loopback URL
  // (the old default) is ignored: on another tailnet device it would address
  // that device, not the MacBook.
  const LEGACY_LOOPBACK = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\/*$/i;
  function resolveBackendBase(stored) {
    const value = typeof stored === 'string' ? stored.trim() : '';
    if (!value || LEGACY_LOOPBACK.test(value)) return '';
    return value.replace(/\/+$/, '');
  }

  // Jobs report progress either as a number or as the sequential-run object
  // { totalPercent, currentRunPercent, ... }. Returns an integer 0-100 or null.
  function jobProgressPercent(progress) {
    let value = progress;
    if (value && typeof value === 'object') {
      value = value.totalPercent != null ? value.totalPercent : value.currentRunPercent;
    }
    if (value == null || value === '') return null;
    value = Number(value);
    if (!Number.isFinite(value)) return null;
    return Math.max(0, Math.min(100, Math.round(value)));
  }

  // Pick the target to show once capabilities load:
  // 1. a saved preference that is still offered, else
  // 2. the backend-designated primary target if it is proofed, else
  // 3. the current selection (unchanged behaviour).
  function chooseInitialTarget(targets, savedId, currentId) {
    const list = Array.isArray(targets) ? targets : [];
    const NOT_READY = new Set(['dormant', 'model-missing']);
    const has = id => !!id && list.some(t => t && t.id === id && !NOT_READY.has(t.runtime));
    if (has(savedId)) return savedId;
    const primary = list.find(t => t && t.primary === true && ['proofed', 'proven'].includes(t.status));
    if (primary) return primary.id;
    return currentId;
  }

  // Dropdown label: marks the primary engine and dormant legacy targets.
  function targetOptionLabel(t) {
    const base = (t && (t.label || t.id)) || '';
    if (t && t.primary) return base + ' — Primary';
    if (t && t.runtime === 'dormant') return base + ' — dormant';
    if (t && t.runtime === 'model-missing') return base + ' — model missing';
    return base;
  }

  function dimensionRules(target) {
    const t = target || {};
    const mflux = t.backend === 'mflux';
    const num = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
    return {
      minWidth: num(t.minWidth, mflux ? 256 : 64), minHeight: num(t.minHeight, mflux ? 256 : 64),
      maxWidth: num(t.maxWidth, 2048), maxHeight: num(t.maxHeight, 2048),
      dimensionMultiple: num(t.dimensionMultiple, mflux ? 16 : 8),
    };
  }
  function dimensionIssue(target, width, height) {
    const t = target || {}, r = dimensionRules(t), label = t.label || t.id || 'this target';
    const w = Number(width), h = Number(height);
    if (!Number.isInteger(w) || w < r.minWidth || w > r.maxWidth) return `Width must be between ${r.minWidth} and ${r.maxWidth} for ${label}.`;
    if (w % r.dimensionMultiple) return `Width must be a multiple of ${r.dimensionMultiple} for ${label}.`;
    if (!Number.isInteger(h) || h < r.minHeight || h > r.maxHeight) return `Height must be between ${r.minHeight} and ${r.maxHeight} for ${label}.`;
    if (h % r.dimensionMultiple) return `Height must be a multiple of ${r.dimensionMultiple} for ${label}.`;
    return null;
  }
  function dimensionsForTarget(target, current) {
    const t = target || {}, r = dimensionRules(t), c = current || {};
    const fit = (value, fallback, min, max) => {
      const n = Number(value);
      if (Number.isInteger(n) && n >= min && n <= max && n % r.dimensionMultiple === 0) return n;
      const d = Math.max(min, Math.min(max, Number(fallback) || min));
      return Math.max(min, Math.min(max, Math.floor(d / r.dimensionMultiple) * r.dimensionMultiple));
    };
    return {
      width: fit(c.width, t.defaultWidth, r.minWidth, r.maxWidth),
      height: fit(c.height, t.defaultHeight, r.minHeight, r.maxHeight),
    };
  }
  function dimensionInfo(width, height) {
    const w = Number(width), h = Number(height);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return { aspectRatio: '—', megapixels: '—' };
    const gcd = (a, b) => b ? gcd(b, a % b) : a;
    const d = gcd(Math.round(w), Math.round(h));
    return { aspectRatio: `${Math.round(w / d)}:${Math.round(h / d)}`, megapixels: ((w * h) / 1000000).toFixed(2) };
  }

  // Truth-status presentation for a derived capability status.
  const CAPABILITY_LABELS = {
    proven: ['Proven', 'ok'], available: ['Available · unproven', 'warn'], dormant: ['Dormant', 'off'],
    unavailable: ['Unavailable', 'off'], broken: ['Broken', 'bad'],
  };
  function capabilityBadge(status) {
    const [label, tone] = CAPABILITY_LABELS[status] || ['Unknown', 'off'];
    return { label, tone };
  }

  // ── Workstation helpers (pure; unit-tested in Node) ─────────────────────

  // Local mask processing on an alpha array (0-255, length w*h). Dimensions are
  // always preserved; painted = alpha > 0 (the backend's alpha convention).
  function maskDilate(a, w, h, r) {
    r = Math.max(0, Math.round(r));
    if (!r) return Uint8ClampedArray.from(a);
    const tmp = new Uint8ClampedArray(a.length), out = new Uint8ClampedArray(a.length);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let m = 0;
      for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r) && m < 255; k++) if (a[y * w + k] > m) m = a[y * w + k];
      tmp[y * w + x] = m;
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let m = 0;
      for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r) && m < 255; k++) if (tmp[k * w + x] > m) m = tmp[k * w + x];
      out[y * w + x] = m;
    }
    return out;
  }
  function maskInvert(a) { const o = new Uint8ClampedArray(a.length); for (let i = 0; i < a.length; i++) o[i] = 255 - a[i]; return o; }
  function maskErode(a, w, h, r) { return maskInvert(maskDilate(maskInvert(a), w, h, r)); }
  function maskBlur(a, w, h, r) {
    r = Math.max(0, Math.round(r));
    if (!r) return Uint8ClampedArray.from(a);
    const tmp = new Float32Array(a.length), out = new Uint8ClampedArray(a.length);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0, n = 0;
      for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) { s += a[y * w + k]; n++; }
      tmp[y * w + x] = s / n;
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0, n = 0;
      for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) { s += tmp[k * w + x]; n++; }
      out[y * w + x] = Math.round(s / n);
    }
    return out;
  }
  // Feather = soften the edge outward (grow then blur) so the painted core stays fully masked.
  function maskFeather(a, w, h, r) { return maskBlur(maskDilate(a, w, h, Math.ceil(r / 2)), w, h, r); }
  function maskCoverage(a) {
    if (!a || !a.length) return 0;
    let n = 0;
    for (let i = 0; i < a.length; i++) if (a[i] > 0) n++;
    return n / a.length;
  }
  const FULL_MASK_COVERAGE = 0.98;
  function maskVerdict(a) {
    const c = maskCoverage(a);
    if (c === 0) return { ok: false, kind: 'blank', coverage: c, message: 'Mask has no painted pixels. Paint over the region to change first.' };
    if (c >= FULL_MASK_COVERAGE) return { ok: false, kind: 'full', coverage: c, message: 'The entire image is masked. This will regenerate nearly everything.' };
    return { ok: true, kind: 'partial', coverage: c };
  }

  // Aspect presets relative to the target's base size, multiples of 64.
  function aspectDims(kind, base, max) {
    const b = Math.max(64, Math.min(Number(base) || 512, Number(max) || 2048));
    const short = Math.max(64, Math.round((b * 0.75) / 64) * 64);
    if (kind === 'landscape') return { width: b, height: short };
    if (kind === 'portrait') return { width: short, height: b };
    return { width: b, height: b };
  }

  // Which Create controls are meaningful for a target (from /api/capabilities
  // target.capabilities). Unknown targets get conservative SDCPP-like defaults.
  function controlsFor(target) {
    const c = (target && target.capabilities) || {};
    const mflux = c.backend ? c.backend === 'mflux' : (target && target.backend) === 'mflux';
    const on = (k, dflt) => (k in c ? !!c[k] : dflt);
    return {
      backend: mflux ? 'mflux' : 'sdcpp',
      negativePrompt: on('negativePrompt', !mflux), cfg: on('cfg', !mflux), scheduler: on('scheduler', !mflux),
      vae: on('vae', !mflux), lora: on('lora', !mflux), hiresRefine: on('hiresRefine', !mflux),
      img2img: on('img2img', false), inpaint: on('inpaint', false), outpaint: on('outpaint', false), controlNet: on('controlNet', false),
      nativeBatch: on('nativeBatch', !mflux),
    };
  }

  const STRENGTH_PRESETS = [['Subtle', 0.35], ['Balanced', 0.55], ['Strong', 0.75]];

  // Normalise a job into a result list (structured results, else the legacy single image).
  function jobResults(job) {
    if (job && Array.isArray(job.results) && job.results.length) {
      return job.results.map((r, i) => {
        if (r.seed == null && r.imageId) {
          const m = String(r.imageId).match(/-s(\d+)-/);
          if (m) return Object.assign({}, r, { seed: Number(m[1]) });
        }
        return r;
      });
    }
    const url = job && (job.controlledOutputImageUrl || job.upscaledImageUrl || job.hiresFinalImageUrl);
    if (!url) return [];
    const id = decodeURIComponent(String(url).split('/').pop());
    const m = id.match(/-s(\d+)-/);
    return [{ index: 0, status: 'DONE', imageId: id, imageUrl: url, runId: job.runId || null, seed: m ? Number(m[1]) : null, target: job.controlledTarget || null }];
  }

  // Metadata differences for the comparison workspace.
  const COMPARE_KEYS = ['operation', 'target', 'seed', 'width', 'height', 'steps', 'cfg', 'scheduler', 'strength', 'parent'];
  function compareRows(items) {
    return COMPARE_KEYS.map(k => {
      const vals = items.map(it => { const m = (it && it.meta) || {}; const v = k === 'width' || k === 'height' ? (it[k] != null ? it[k] : m[k]) : m[k]; return v == null ? '—' : String(v); });
      return { key: k, values: vals, differs: new Set(vals).size > 1 };
    }).filter(r => r.values.some(v => v !== '—'));
  }

  // Recipes: reusable non-sensitive settings. Prompt text is kept only when
  // prompt saving is enabled.
  const RECIPE_FIELDS = ['target', 'width', 'height', 'steps', 'cfg', 'sampler', 'scheduler', 'vae', 'preset', 'strength', 'quantity'];
  function sanitizeRecipe(input, savePrompts) {
    const src = input || {};
    const out = { name: String(src.name || 'Recipe').slice(0, 80) };
    for (const k of RECIPE_FIELDS) if (src[k] !== undefined && src[k] !== null && src[k] !== '') out[k] = src[k];
    if (src.id) out.id = String(src.id);
    if (savePrompts === true) {
      if (typeof src.prompt === 'string') out.prompt = src.prompt;
      if (typeof src.negPrompt === 'string') out.negPrompt = src.negPrompt;
    }
    return out;
  }

  // Edit-session snapshot safe for localStorage: ids and numbers only, prompts
  // only when prompt saving is on.
  const SESSION_KEYS = ['quantity', 'editSourceId', 'editOriginalId', 'enhSourceId', 'activeImageId', 'compareIds', 'queueId', 'activeJobId', 'strength', 'brush'];
  function persistableSession(ws, savePrompts) {
    const out = {};
    for (const k of SESSION_KEYS) if (ws && ws[k] !== undefined && ws[k] !== null) out[k] = ws[k];
    if (savePrompts === true && ws && typeof ws.batchText === 'string') out.batchText = ws.batchText;
    return out;
  }

  return {
    resolveBackendBase, jobProgressPercent, chooseInitialTarget, targetOptionLabel, capabilityBadge,
    dimensionIssue, dimensionsForTarget, dimensionInfo,
    maskDilate, maskErode, maskBlur, maskFeather, maskInvert, maskCoverage, maskVerdict, FULL_MASK_COVERAGE,
    aspectDims, controlsFor, STRENGTH_PRESETS, jobResults, compareRows, sanitizeRecipe, RECIPE_FIELDS, persistableSession,
  };
});
