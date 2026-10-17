// A1111 "SD upscale" (scripts/sd_upscale.py) geometry, validation and cost. Pure; browser (window.DexSdUpscale) + server.
// bin/sd-upscale-tiles.py executes the same plan. Pinned upstream: 82a973c04367123ae98bd9abdf80d9eda9b910e2.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DexSdUpscale = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  // sd_upscale.py:23-25 slider ranges/defaults; tile size = width/height sliders (64-2048 step 8 upstream).
  const LIMITS = {
    overlap: { min: 0, max: 256, step: 16, def: 64 },
    scale: { min: 1, max: 4, step: 0.05, def: 2 },
    tile: { min: 64, max: 2048, step: 8 },
    steps: { min: 1, max: 150 },
  };
  const UPSCALERS = ['none', 'lanczos', 'nearest', 'bicubic', 'bilinear', 'realesrgan'];
  const KEYS = new Set(['overlap', 'scale', 'upscaler', 'tileWidth', 'tileHeight', 'steps']);
  const DEFAULTS = { overlap: 64, scale: 2, upscaler: 'lanczos', tileWidth: 512, tileHeight: 512, steps: 20 };

  const onStep = (v, lo, st) => Math.abs((v - lo) / st - Math.round((v - lo) / st)) < 1e-6;

  function normalizeSdUpscale(raw) {
    if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'sdUpscale must be an object' };
    for (const k of Object.keys(raw)) if (!KEYS.has(k)) return { error: `Unexpected sdUpscale field: ${k}` };
    const o = Object.assign({}, DEFAULTS, raw);
    for (const k of ['overlap', 'scale', 'tileWidth', 'tileHeight', 'steps']) o[k] = Number(o[k]);
    if (!UPSCALERS.includes(o.upscaler)) return { error: `upscaler must be one of ${UPSCALERS.join(', ')}` };
    const L = LIMITS;
    if (!Number.isInteger(o.overlap) || o.overlap < L.overlap.min || o.overlap > L.overlap.max || o.overlap % L.overlap.step) return { error: `overlap must be a multiple of ${L.overlap.step} between ${L.overlap.min} and ${L.overlap.max}` };
    if (!(o.scale >= L.scale.min && o.scale <= L.scale.max) || !onStep(o.scale, L.scale.min, L.scale.step)) return { error: `scale must be between ${L.scale.min} and ${L.scale.max} in steps of ${L.scale.step}` };
    for (const [n, v] of [['tileWidth', o.tileWidth], ['tileHeight', o.tileHeight]]) {
      if (!Number.isInteger(v) || v < L.tile.min || v > L.tile.max || v % L.tile.step) return { error: `${n} must be a multiple of ${L.tile.step} between ${L.tile.min} and ${L.tile.max}` };
    }
    if (o.overlap >= Math.min(o.tileWidth, o.tileHeight)) return { error: 'overlap must be smaller than the tile size' };
    if (!Number.isInteger(o.steps) || o.steps < L.steps.min || o.steps > L.steps.max) return { error: `steps must be an integer between ${L.steps.min} and ${L.steps.max}` };
    return { options: o };
  }

  // upscaler.py:56-57: every upscaler lands on int((dim * scale) // 8 * 8). 'none' keeps the source size (sd_upscale.py:45).
  function upscaledSize(w, h, o) {
    if (o.upscaler === 'none') return { w, h };
    return { w: Math.floor(w * o.scale / 8) * 8, h: Math.floor(h * o.scale / 8) * 8 };
  }

  // images.split_grid (images.py:78-111), geometry only; tiles row-major.
  function plan(srcW, srcH, o) {
    const img = upscaledSize(srcW, srcH, o);
    const tw = o.tileWidth, th = o.tileHeight, ov = o.overlap;
    if (!(img.w > ov && img.h > ov)) return { error: 'Image must be larger than the tile overlap' };
    const cols = Math.ceil((img.w - ov) / (tw - ov));
    const rows = Math.ceil((img.h - ov) / (th - ov));
    const dx = cols > 1 ? (img.w - tw) / (cols - 1) : 0;
    const dy = rows > 1 ? (img.h - th) / (rows - 1) : 0;
    const tiles = [];
    for (let r = 0; r < rows; r++) {
      let y = Math.trunc(r * dy);
      if (y + th >= img.h) y = img.h - th;
      for (let c = 0; c < cols; c++) {
        let x = Math.trunc(c * dx);
        if (x + tw >= img.w) x = img.w - tw;
        tiles.push({ index: tiles.length, row: r, col: c, x, y, box: [x, y, x + tw, y + th] });
      }
    }
    // Tiles are generated at tile size, so a final image smaller than a tile pads with black upstream.
    return { image: img, cols, rows, tileCount: tiles.length, tiles, undersized: img.w < tw || img.h < th };
  }

  // sd_upscale.py:78-95 + process_images: next batch starts at processed.seed + 1 (not + batch size).
  function seedOffset(index, batchSize) {
    const b = batchSize || 1;
    return Math.floor(index / b) + (index % b);
  }

  // One img2img pass per tile; cost in sampler-steps.
  function estimateCost(srcW, srcH, o) {
    const p = plan(srcW, srcH, o);
    if (p.error) return p;
    return { tileCount: p.tileCount, steps: o.steps, totalSteps: p.tileCount * o.steps, finalWidth: p.image.w, finalHeight: p.image.h };
  }

  return { LIMITS, UPSCALERS, DEFAULTS, normalizeSdUpscale, upscaledSize, plan, seedOffset, estimateCost };
});
