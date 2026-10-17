// A1111 Extras (P09): validation and geometry for resize-based postprocessing. Pure; loaded by the
// browser (window.DexExtras) and the server (require). bin/extras-resize.py executes the same plan.
//
// Provided: scale-by factor (+ max side length), scale-to size (+ crop to fit), upscaler 1, upscaler 2 with visibility blend.
// The upscalers are Pillow resamplers (Lanczos/Nearest are A1111's built-ins; Bicubic/Bilinear are DexDiffusion extras);
// Real-ESRGAN stays its own action.
// NOT provided (no installed weights/runtime, see docs/parity P09): GFPGAN, CodeFormer, SwinIR, other model upscalers.
// Diffed against the pinned source 2026-10-16 (82a973c0): scripts/postprocessing_upscale.py upscale()/process(),
// modules/upscaler.py Upscaler.upscale() (dest = int((dim*scale)//8*8), then a final LANCZOS resize to dest).
// Deliberate DexDiffusion limits: output side ≤ 4096 px (upstream slider max 8192).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DexExtras = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const UPSCALERS = ['none', 'lanczos', 'bicubic', 'bilinear', 'nearest'];
  const MAX_SIDE = 4096, MIN_SIDE = 64, MAX_SCALE = 8;
  const KEYS = new Set(['mode', 'scale', 'width', 'height', 'crop', 'upscaler', 'upscaler2', 'visibility', 'max_side', 'gfpgan', 'codeformer']);
  const DEFAULTS = { mode: 'by', scale: 2, width: 1024, height: 1024, crop: true, upscaler: 'lanczos', upscaler2: 'none', visibility: 0.5, max_side: 0 };
  const FACE = 'Face restoration (GFPGAN / CodeFormer) is not available: no restoration weights or PyTorch runtime are installed on this system.';
  const NONE1 = 'Upscaler 1 is None: A1111 then performs no upscale at all (upscaler 2 and crop are skipped). Choose an upscaler.';

  function normalizeExtras(raw) {
    if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'extras must be an object' };
    for (const k of Object.keys(raw)) if (!KEYS.has(k)) return { error: `Unexpected extras field: ${k}` };
    for (const f of ['gfpgan', 'codeformer']) if (raw[f] !== undefined && Number(raw[f]) > 0) return { error: FACE };
    const o = Object.assign({}, DEFAULTS, raw);
    delete o.gfpgan; delete o.codeformer;
    if (o.mode !== 'by' && o.mode !== 'to') return { error: 'mode must be "by" or "to"' };
    o.scale = Number(o.scale); o.width = Number(o.width); o.height = Number(o.height); o.visibility = Number(o.visibility); o.max_side = Number(o.max_side);
    o.crop = !!o.crop;
    if (!UPSCALERS.includes(o.upscaler)) return { error: `upscaler must be one of ${UPSCALERS.join(', ')}` };
    if (!UPSCALERS.includes(o.upscaler2)) return { error: `upscaler2 must be one of ${UPSCALERS.join(', ')}` };
    if (o.upscaler === 'none') return { error: NONE1 };
    if (!(o.visibility >= 0 && o.visibility <= 1)) return { error: 'visibility must be between 0 and 1' };
    if (!Number.isInteger(o.max_side) || o.max_side < 0 || o.max_side > MAX_SIDE) return { error: `max_side must be 0 (no limit) or an integer up to ${MAX_SIDE}` };
    if (o.mode === 'by') {
      if (!(o.scale >= 1 && o.scale <= MAX_SCALE)) return { error: `scale must be between 1 and ${MAX_SCALE}` };
    } else {
      for (const [n, v] of [['width', o.width], ['height', o.height]]) if (!Number.isInteger(v) || v < MIN_SIDE || v > MAX_SIDE) return { error: `${n} must be an integer between ${MIN_SIDE} and ${MAX_SIDE}` };
    }
    return { options: o };
  }

  // postprocessing_upscale.limit_size_by_one_dimention (Python `limit * w // h` on floats = floor of the true quotient).
  function limitSize(w, h, limit) {
    if (h > w && h > limit) { w = Math.floor(limit * w / h); h = limit; }
    else if (w > limit) { h = Math.floor(limit * h / w); w = limit; }
    return { w: Math.trunc(w), h: Math.trunc(h) };
  }

  // Geometry only. `factor` is the upscale_by passed to every upscaler; `stage` = upscaler.py dest size;
  // `out` is the final canvas (crop to fit pastes `stage` centred on a black W×H canvas).
  function plan(srcW, srcH, o) {
    let mode = o.mode, crop = o.mode === 'to' && o.crop, f, limited = null;
    if (mode === 'to') f = Math.max(o.width / srcW, o.height / srcH);
    else {
      f = o.scale;
      if (o.max_side && Math.max(srcW, srcH) * f > o.max_side) {
        mode = 'to'; crop = false;
        limited = limitSize(srcW * f, srcH * f, o.max_side);
        f = Math.max(limited.w / srcW, limited.h / srcH);
      }
    }
    const stage = { w: Math.floor((srcW * f) / 8) * 8, h: Math.floor((srcH * f) / 8) * 8 };
    const out = crop ? { w: o.width, h: o.height } : stage;
    return { factor: f, stage, first: { w: Math.trunc(srcW * f), h: Math.trunc(srcH * f) }, out, crop, limited, blend: o.upscaler2 !== 'none' && o.visibility > 0 };
  }

  function validateForSource(srcW, srcH, o) {
    const p = plan(srcW, srcH, o);
    if (p.stage.w < 8 || p.stage.h < 8) return `Result would be ${p.stage.w}×${p.stage.h}`;
    if (p.stage.w > MAX_SIDE || p.stage.h > MAX_SIDE) return `Result would be ${p.stage.w}×${p.stage.h}, larger than the ${MAX_SIDE}px limit`;
    return null;
  }

  return { UPSCALERS, MAX_SIDE, DEFAULTS, FACE, NONE1, normalizeExtras, limitSize, plan, validateForSource };
});
