// Rotate / flip / crop request validation and centred-crop presets. Pure; browser (window.DexTransform) and server (require).
// bin/transform-image.py executes the same plan and re-validates every field.
(function (root, factory) { if (typeof module === 'object' && module.exports) module.exports = factory(); else root.DexTransform = factory(); })(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const MAX_OPS = 6, MAX_SIDE = 4096, MIN_CROP = 8;
  function normalize(raw, src) {
    if (!Array.isArray(raw) || !raw.length || raw.length > MAX_OPS) return { error: `1-${MAX_OPS} operations are required` };
    let W = src && src.width, H = src && src.height;
    if (!(W > 0 && H > 0)) return { error: 'The source image size is unknown' };
    const out = [];
    for (const o of raw) {
      if (!o || typeof o !== 'object' || Array.isArray(o)) return { error: 'Each operation must be an object' };
      if (o.op === 'rotate') {
        const d = Number(o.degrees); if (![90, 180, 270].includes(d)) return { error: 'rotate degrees must be 90, 180 or 270' };
        out.push({ op: 'rotate', degrees: d }); if (d !== 180) [W, H] = [H, W];
      } else if (o.op === 'flip') {
        if (o.axis !== 'h' && o.axis !== 'v') return { error: 'flip axis must be h or v' };
        out.push({ op: 'flip', axis: o.axis });
      } else if (o.op === 'crop') {
        const [x, y, w, h] = ['x', 'y', 'w', 'h'].map(k => Number(o[k]));
        if (![x, y, w, h].every(Number.isInteger)) return { error: 'crop needs integer x, y, w, h' };
        if (x < 0 || y < 0 || w < MIN_CROP || h < MIN_CROP || x + w > W || y + h > H) return { error: `crop box ${x},${y} ${w}×${h} is outside the ${W}×${H} image` };
        out.push({ op: 'crop', x, y, w, h }); W = w; H = h;
      } else return { error: 'Unknown operation: ' + String(o.op) };
      if (Math.max(W, H) > MAX_SIDE) return { error: `The result would be larger than ${MAX_SIDE}px` };
    }
    return { ops: out, result: { width: W, height: H } };
  }
  // Largest centred box with aspect ratio rw:rh inside w×h (even sizes).
  function cropPreset(w, h, rw, rh) {
    let cw = w, ch = Math.floor(w * rh / rw);
    if (ch > h) { ch = h; cw = Math.floor(h * rw / rh); }
    cw -= cw % 2; ch -= ch % 2;
    return { op: 'crop', x: Math.floor((w - cw) / 2), y: Math.floor((h - ch) / 2), w: cw, h: ch };
  }
  return { MAX_OPS, MAX_SIDE, MIN_CROP, normalize, cropPreset };
});
