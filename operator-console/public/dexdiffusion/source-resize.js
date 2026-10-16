// A1111 img2img source geometry (P07): "Just resize", "Crop and resize", "Resize and fill", resize-to / resize-by,
// transparency background colour, and "do exactly the amount of steps". Pure; the pixel work is bin/resize-source.py.
//
// Pixel rules are stable-diffusion-webui's images.resize_image (modes 0/1/2) with PIL LANCZOS:
//   resize: stretch to W x H.   crop: scale to cover, centre crop.
//   fill:   scale to fit, centre, and stretch the one-pixel edge row/column into the empty bands.
// Not provided (no sd-cli equivalent): A1111's "Latent upscale" resize mode.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DexResize = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

const MODES = Object.freeze(['resize', 'crop', 'fill']);
const MIN_EDGE = 64, MAX_EDGE = 2048, MIN_BY = 0.25, MAX_BY = 4;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

const num = v => (v === undefined || v === null || v === '' ? null : Number(v));

// Returns { spec } (spec null when no resize was requested) or { error }.
function normalizeResize(body = {}) {
  const mode = body.resize_mode === undefined || body.resize_mode === null || body.resize_mode === '' ? null : String(body.resize_mode);
  const w = num(body.resize_width), h = num(body.resize_height), by = num(body.resize_by);
  const bg = body.background_color === undefined || body.background_color === null || body.background_color === '' ? '#ffffff' : String(body.background_color);
  if (!COLOR_RE.test(bg)) return { error: 'background_color must look like #rrggbb' };
  if (mode === null) {
    if (w !== null || h !== null || by !== null) return { error: 'resize_width/resize_height/resize_by need a resize_mode (resize, crop or fill)' };
    return { spec: null, background_color: bg };
  }
  if (!MODES.includes(mode)) return { error: `resize_mode must be one of ${MODES.join(', ')} (latent upscale is not available)` };
  const hasSize = w !== null || h !== null;
  if (hasSize && by !== null) return { error: 'Use either resize_width/resize_height or resize_by, not both' };
  if (!hasSize && by === null) return { error: 'Give a target size (resize_width and resize_height) or resize_by' };
  if (by !== null) {
    if (!Number.isFinite(by) || by < MIN_BY || by > MAX_BY) return { error: `resize_by must be between ${MIN_BY} and ${MAX_BY}` };
    return { spec: { mode, by, background_color: bg } };
  }
  if (w === null || h === null) return { error: 'resize_width and resize_height must be given together' };
  for (const [name, v] of [['resize_width', w], ['resize_height', h]]) {
    if (!Number.isInteger(v) || v < MIN_EDGE || v > MAX_EDGE || v % 8) return { error: `${name} must be a multiple of 8 between ${MIN_EDGE} and ${MAX_EDGE}` };
  }
  return { spec: { mode, width: w, height: h, background_color: bg } };
}

// Target size for a source. resize_by truncates like A1111, then rounds DOWN to a multiple of 8 (sd-cli needs it).
function targetSize(spec, srcW, srcH) {
  if (spec.by === undefined) return { width: spec.width, height: spec.height };
  const down8 = v => Math.max(MIN_EDGE, Math.floor(Math.trunc(v) / 8) * 8);
  return { width: down8(srcW * spec.by), height: down8(srcH * spec.by) };
}

// sd.cpp img2img (src/stable-diffusion.cpp:3890): t_enc = floor(steps * strength) and the sigma schedule keeps t_enc + 2 sigmas,
// so floor(steps * strength) + 1 sampler steps actually run (live-verified: --steps 8 at 0.5 shows 5/5 progress).
const executedSteps = (steps, strength) => Math.floor(Number(steps) * Number(strength) + 1e-9) + 1;
// The CLI step count that makes exactly `steps` sampler steps run ("do exactly the amount of steps the slider specifies").
function exactSteps(steps, strength) {
  const s = Number(steps), k = Number(strength);
  if (!Number.isInteger(s) || s < 1 || !(k > 0 && k < 1)) return null;
  let n = Math.max(1, Math.ceil((s - 1) / k - 1e-9));
  while (executedSteps(n, k) < s) n++;
  while (n > 1 && executedSteps(n - 1, k) >= s) n--;
  return n;
}

  return { MODES, MIN_EDGE, MAX_EDGE, MIN_BY, MAX_BY, normalizeResize, targetSize, exactSteps, executedSteps };
});
