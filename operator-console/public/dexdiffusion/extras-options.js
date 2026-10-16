// A1111 Extras (P09): validation and geometry for resize-based postprocessing. Pure; loaded by the
// browser (window.DexExtras) and the server (require). bin/extras-resize.py executes the same plan.
//
// Provided: scale-by factor, scale-to size (+ crop to fit), upscaler 1, upscaler 2 with visibility blend.
// The upscalers are Pillow resamplers (Lanczos/Bicubic/Bilinear/Nearest); Real-ESRGAN stays its own action.
// NOT provided (no installed weights/runtime, see docs/parity P09): GFPGAN, CodeFormer, SwinIR, other model upscalers.
// Ported from A1111 scripts/postprocessing_upscale.py from knowledge; not diffed against the pinned source.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DexExtras = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const UPSCALERS = ['none', 'lanczos', 'bicubic', 'bilinear', 'nearest'];
  const MAX_SIDE = 4096, MIN_SIDE = 64, MAX_SCALE = 8;
  const KEYS = new Set(['mode', 'scale', 'width', 'height', 'crop', 'upscaler', 'upscaler2', 'visibility', 'gfpgan', 'codeformer']);
  const DEFAULTS = { mode: 'by', scale: 2, width: 1024, height: 1024, crop: true, upscaler: 'lanczos', upscaler2: 'none', visibility: 0.5 };
  const FACE = 'Face restoration (GFPGAN / CodeFormer) is not available: no restoration weights or PyTorch runtime are installed on this system.';

  function normalizeExtras(raw) {
    if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'extras must be an object' };
    for (const k of Object.keys(raw)) if (!KEYS.has(k)) return { error: `Unexpected extras field: ${k}` };
    for (const f of ['gfpgan', 'codeformer']) if (raw[f] !== undefined && Number(raw[f]) > 0) return { error: FACE };
    const o = Object.assign({}, DEFAULTS, raw);
    delete o.gfpgan; delete o.codeformer;
    if (o.mode !== 'by' && o.mode !== 'to') return { error: 'mode must be "by" or "to"' };
    o.scale = Number(o.scale); o.width = Number(o.width); o.height = Number(o.height); o.visibility = Number(o.visibility);
    o.crop = !!o.crop;
    if (!UPSCALERS.includes(o.upscaler)) return { error: `upscaler must be one of ${UPSCALERS.join(', ')}` };
    if (!UPSCALERS.includes(o.upscaler2)) return { error: `upscaler2 must be one of ${UPSCALERS.join(', ')}` };
    if (!(o.visibility >= 0 && o.visibility <= 1)) return { error: 'visibility must be between 0 and 1' };
    if (o.mode === 'by') {
      if (!(o.scale >= 1 && o.scale <= MAX_SCALE)) return { error: `scale must be between 1 and ${MAX_SCALE}` };
    } else {
      for (const [n, v] of [['width', o.width], ['height', o.height]]) if (!Number.isInteger(v) || v < MIN_SIDE || v > MAX_SIDE) return { error: `${n} must be an integer between ${MIN_SIDE} and ${MAX_SIDE}` };
    }
    if (o.upscaler === 'none' && o.upscaler2 === 'none' && o.mode === 'by') return { error: 'Nothing to do: choose an upscaler' };
    return { options: o };
  }

  // Geometry only. `stage` is the size every upscaler produces; `out` is the final canvas.
  function plan(srcW, srcH, o) {
    const f = o.mode === 'by' ? o.scale : Math.max(o.width / srcW, o.height / srcH);
    const noScale = o.upscaler === 'none' && (o.upscaler2 === 'none' || o.visibility === 0);
    const stage = noScale ? { w: srcW, h: srcH } : { w: Math.round(srcW * f), h: Math.round(srcH * f) };
    const crop = o.mode === 'to' && o.crop;
    const out = crop ? { w: o.width, h: o.height } : stage;
    return { factor: f, stage, out, crop, blend: o.upscaler2 !== 'none' && o.visibility > 0 };
  }

  function validateForSource(srcW, srcH, o) {
    const p = plan(srcW, srcH, o);
    if (p.stage.w > MAX_SIDE || p.stage.h > MAX_SIDE) return `Result would be ${p.stage.w}×${p.stage.h}, larger than the ${MAX_SIDE}px limit`;
    return null;
  }

  return { UPSCALERS, MAX_SIDE, DEFAULTS, FACE, normalizeExtras, plan, validateForSource };
});
