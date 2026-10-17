// A1111's two stock outpainting scripts as option validators and plan maths. Pure; shared by the browser and the server.
// The pixel work lives in bin/outpaint-a1111.py; every size computed here must agree with that script's plan output.
// Upstream: AUTOMATIC1111/stable-diffusion-webui @ 82a973c04367123ae98bd9abdf80d9eda9b910e2
//   poor-man  scripts/poor_mans_outpainting.py  (PM:<line>)   pixels 8-256/8 (128), mask blur 0-64 (4),
//             masked content fill|original|latent noise|latent nothing (fill), direction left/right/up/down (all)
//   mk2       scripts/outpainting_mk_2.py       (MK2:<line>)  pixels 8-256/8 (128), mask blur 0-64 (8), direction (all),
//             fall-off exponent 0-4/0.01 (1.0), color variation 0-1/0.01 (0.05)
// latent noise / latent nothing need control sd-cli does not expose, so they are refused with a reason.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DexOutpaint = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const DIRECTIONS = Object.freeze(['left', 'right', 'up', 'down']);
  const MASKED_CONTENTS = Object.freeze(['fill', 'original']);
  const UNAVAILABLE_MASKED_CONTENTS = Object.freeze(['latent noise', 'latent nothing']);
  const RANGES = Object.freeze({
    pixels: Object.freeze({ min: 8, max: 256, step: 8 }),
    mask_blur: Object.freeze({ min: 0, max: 64, step: 1 }),
    noise_q: Object.freeze({ min: 0, max: 4, step: 0.01 }),
    color_variation: Object.freeze({ min: 0, max: 1, step: 0.01 }),
  });
  const POOR_DEFAULTS = Object.freeze({ pixels: 128, mask_blur: 4, masked_content: 'fill', directions: DIRECTIONS, tile_w: 512, tile_h: 512 });
  const MK2_DEFAULTS = Object.freeze({ pixels: 128, mask_blur: 8, directions: DIRECTIONS, noise_q: 1.0, color_variation: 0.05, seed: 0, work_w: 512, work_h: 512 });

  const blank = v => v === undefined || v === null || v === '';
  const ceil64 = v => Math.ceil(v / 64) * 64;

  // Slider semantics: within [min, max] and on the step grid (gradio sliders snap to it).
  function sliderError(name, value) {
    const r = RANGES[name];
    if (typeof value !== 'number' || !Number.isFinite(value)) return `${name} must be a number`;
    if (value < r.min || value > r.max) return `${name} must be between ${r.min} and ${r.max}`;
    const k = (value - r.min) / r.step;
    if (Math.abs(k - Math.round(k)) > 1e-6) return `${name} must be a multiple of ${r.step}`;
    return null;
  }
  const numField = v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v);

  // Accepts an array or a comma list; returns directions in canonical left,right,up,down order.
  function normalizeDirections(value) {
    if (blank(value)) return { directions: DIRECTIONS.slice() };
    const list = (Array.isArray(value) ? value : String(value).split(',')).map(d => String(d).trim().toLowerCase()).filter(Boolean);
    for (const d of list) if (!DIRECTIONS.includes(d)) return { error: `direction must be any of ${DIRECTIONS.join(', ')} (got "${d}")` };
    if (!list.length) return { error: 'at least one outpainting direction is required' };
    return { directions: DIRECTIONS.filter(d => list.includes(d)) };
  }

  function normalizeMaskedContent(value) {
    if (blank(value)) return { content: POOR_DEFAULTS.masked_content };
    const v = String(value).trim().toLowerCase().replace(/_/g, ' ');
    if (UNAVAILABLE_MASKED_CONTENTS.includes(v)) return { error: `masked_content "${v}" is not available: sd-cli cannot initialise the masked latent with noise or nothing` };
    if (!MASKED_CONTENTS.includes(v)) return { error: `masked_content must be one of ${MASKED_CONTENTS.join(', ')}` };
    return { content: v };
  }

  function pick(body, key, dflt) {
    const v = numField(body[key]);
    return blank(v) ? { value: dflt } : { value: v, given: true };
  }

  // Returns { options } or { error } for poor man's outpainting.
  function normalizePoorOptions(body = {}) {
    const dirs = normalizeDirections(body.directions);
    if (dirs.error) return { error: dirs.error };
    const content = normalizeMaskedContent(body.masked_content);
    if (content.error) return { error: content.error };
    const options = { directions: dirs.directions, masked_content: content.content, tile_w: POOR_DEFAULTS.tile_w, tile_h: POOR_DEFAULTS.tile_h };
    for (const name of ['pixels', 'mask_blur']) {
      const p = pick(body, name, POOR_DEFAULTS[name]);
      const err = sliderError(name, p.value);
      if (err) return { error: err };
      options[name] = p.value;
    }
    for (const name of ['tile_w', 'tile_h']) {
      const p = pick(body, name, POOR_DEFAULTS[name]);
      if (!Number.isInteger(p.value) || p.value < 64) return { error: `${name} must be an integer of at least 64` };
      options[name] = p.value;
    }
    if (options.pixels >= options.tile_w || options.pixels >= options.tile_h) return { error: 'pixels (tile overlap) must be smaller than the tile size' };
    return { options };
  }

  // Returns { options } or { error } for outpainting mk2.
  function normalizeMk2Options(body = {}) {
    const dirs = normalizeDirections(body.directions);
    if (dirs.error) return { error: dirs.error };
    if (!blank(body.masked_content)) return { error: 'masked_content does not apply to outpainting mk2 (it always keeps the original)' };
    const options = { directions: dirs.directions };
    for (const name of ['pixels', 'mask_blur', 'noise_q', 'color_variation']) {
      const p = pick(body, name, MK2_DEFAULTS[name]);
      const err = sliderError(name, p.value);
      if (err) return { error: err };
      options[name] = p.value;
    }
    const seed = pick(body, 'seed', MK2_DEFAULTS.seed);
    if (!Number.isInteger(seed.value) || seed.value < 0) return { error: 'seed must be an integer >= 0' };
    options.seed = seed.value;
    for (const name of ['work_w', 'work_h']) {
      const p = pick(body, name, MK2_DEFAULTS[name]);
      if (!Number.isInteger(p.value) || p.value < 64) return { error: `${name} must be an integer of at least 64` };
      options[name] = p.value;
    }
    return { options };
  }

  // PM:38-56 / MK2:153-185: requested pixels per side, grown so the result is a multiple of 64 and split in proportion.
  function expansion(srcW, srcH, pixels, directions) {
    let left = directions.includes('left') ? pixels : 0, right = directions.includes('right') ? pixels : 0;
    let up = directions.includes('up') ? pixels : 0, down = directions.includes('down') ? pixels : 0;
    const targetW = ceil64(srcW + left + right), targetH = ceil64(srcH + up + down);
    if (left > 0) left = Math.floor(left * (targetW - srcW) / (left + right));
    if (right > 0) right = targetW - srcW - left;
    if (up > 0) up = Math.floor(up * (targetH - srcH) / (up + down));
    if (down > 0) down = targetH - srcH - up;
    return { left, right, up, down, target_w: targetW, target_h: targetH };
  }

  // Size of the finished image. poor ('poor'): the 64-aligned target on both axes, even an axis nothing expands (PM:44-45);
  // mk2: source plus the expanded pixels only, since every step is cropped back to its grown size (MK2:254).
  function outputSize(srcW, srcH, pixels, directions, script = 'poor') {
    const e = expansion(srcW, srcH, pixels, directions);
    if (script === 'mk2') return { width: srcW + e.left + e.right, height: srcH + e.up + e.down };
    return { width: e.target_w, height: e.target_h };
  }

  const degenerate = (rect, what) => (rect[2] < rect[0] || rect[3] < rect[1]
    ? { error: `${what} rectangle is degenerate [${rect.join(', ')}]: pixels too small for this mask blur` } : null);

  // IM:78-111 split_grid layout (tile origins only).
  function splitGridLayout(w, h, tileW, tileH, overlap) {
    const nonW = tileW - overlap, nonH = tileH - overlap;
    if (nonW <= 0 || nonH <= 0) return { error: 'pixels (tile overlap) must be smaller than the tile size (upstream divides by zero)' };
    const cols = Math.ceil((w - overlap) / nonW), rows = Math.ceil((h - overlap) / nonH);
    const dx = cols > 1 ? (w - tileW) / (cols - 1) : 0, dy = rows > 1 ? (h - tileH) / (rows - 1) : 0;
    const ys = [], xs = [];
    for (let r = 0; r < rows; r++) { let y = Math.trunc(r * dy); if (y + tileH >= h) y = h - tileH; ys.push(y); }
    for (let c = 0; c < cols; c++) { let x = Math.trunc(c * dx); if (x + tileW >= w) x = w - tileW; xs.push(x); }
    return { cols, rows, xs, ys };
  }

  // PM:34-107 sizes-only plan; mirrors `outpaint-a1111.py poor-plan --geometry-only`. Returns the plan or { error }.
  function poorGeometry(srcW, srcH, opts = {}) {
    const o = { ...POOR_DEFAULTS, ...opts };
    const { pixels, mask_blur: mb, tile_w: tileW, tile_h: tileH } = o;
    const directions = DIRECTIONS.filter(d => o.directions.includes(d));
    const ex = expansion(srcW, srcH, pixels, directions);
    const { left, right, up, down, target_w: tw, target_h: th } = ex;
    const maskRect = [left + (left > 0 ? mb * 2 : 0), up + (up > 0 ? mb * 2 : 0), tw - right - (right > 0 ? mb * 2 : 0), th - down - (down > 0 ? mb * 2 : 0)];
    const latentRect = [left + (left > 0 ? Math.floor(mb / 2) : 0), up + (up > 0 ? Math.floor(mb / 2) : 0), tw - right - (right > 0 ? Math.floor(mb / 2) : 0), th - down - (down > 0 ? Math.floor(mb / 2) : 0)];
    const bad = degenerate(maskRect, 'mask') || degenerate(latentRect, 'latent mask');
    if (bad) return bad;
    const layout = splitGridLayout(tw, th, tileW, tileH, pixels);
    if (layout.error) return layout;
    const tiles = [];
    let work = 0;
    layout.ys.forEach((y, row) => layout.xs.forEach((x, col) => {
      const inside = x >= left && x + tileW <= tw - right && y >= up && y + tileH <= th - down; // PM:99
      tiles.push({ row, col, x, y, w: tileW, h: tileH, process: !inside, work_index: inside ? null : work });
      if (!inside) work += 1;
    }));
    return {
      src_w: srcW, src_h: srcH, pixels, directions, mask_blur: mb, left, right, up, down, target_w: tw, target_h: th,
      mask_rect: maskRect, latent_rect: latentRect, mask_blur_sigma: mb * 2, overlap: pixels, tile_w: tileW, tile_h: tileH,
      cols: layout.cols, rows: layout.rows, tiles, work_count: work,
    };
  }

  // MK2:145-277 sizes-only plan; mirrors `outpaint-a1111.py mk2-plan`. Returns the plan or { error }.
  function mk2Steps(srcW, srcH, opts = {}) {
    const o = { ...MK2_DEFAULTS, ...opts };
    const directions = DIRECTIONS.filter(d => o.directions.includes(d));
    const ex = expansion(srcW, srcH, o.pixels, directions);
    const mbx = ex.left > 0 || ex.right > 0 ? o.mask_blur : 0, mby = ex.up > 0 || ex.down > 0 ? o.mask_blur : 0; // MK2:158-166
    const steps = [];
    let cw = srcW, ch = srcH;
    for (const d of DIRECTIONS) {
      const e = ex[d];
      if (e <= 0) continue;
      const left = d === 'left', right = d === 'right', top = d === 'up', bottom = d === 'down';
      const horiz = left || right, vert = top || bottom;
      const resW = cw + (horiz ? e : 0), resH = ch + (vert ? e : 0);
      const prw = ceil64(resW), prh = ceil64(resH);
      const rect = [left ? e + mbx : 0, top ? e + mby : 0, right ? prw - e - mbx : resW, bottom ? prh - e - mby : resH]; // MK2:205-210
      const tw = horiz ? Math.min(o.work_w, cw + e) : prw, th = vert ? Math.min(o.work_h, ch + e) : prh;            // MK2:217-218
      const crop = [left ? 0 : prw - tw, top ? 0 : prh - th, left ? tw : prw, top ? th : prh];                      // MK2:222-227
      const lrect = [left ? e + mbx * 2 : 0, top ? e + mby * 2 : 0, right ? tw - e - mbx * 2 : resW, bottom ? th - e - mby * 2 : resH]; // MK2:238-243
      const bad = degenerate(rect, 'mask') || degenerate(lrect, 'latent mask');
      if (bad) return bad;
      steps.push({
        index: steps.length, direction: d, expand_pixels: e, src_w: cw, src_h: ch, res_w: resW, res_h: resH,
        canvas_w: prw, canvas_h: prh, paste: [left ? e : 0, top ? e : 0], mask_rect: rect, latent_rect: lrect,
        work_w: tw, work_h: th, crop, mask_blur_sigma_x: mbx * 4, mask_blur_sigma_y: mby * 4,
      });
      cw = resW; ch = resH;
    }
    return {
      src_w: srcW, src_h: srcH, pixels: o.pixels, directions, mask_blur: o.mask_blur, left: ex.left, right: ex.right, up: ex.up, down: ex.down,
      target_w: ex.target_w, target_h: ex.target_h, mask_blur_x: mbx, mask_blur_y: mby, process_w: o.work_w, process_h: o.work_h,
      steps, final_w: cw, final_h: ch,
    };
  }

  return {
    DIRECTIONS, MASKED_CONTENTS, UNAVAILABLE_MASKED_CONTENTS, RANGES, POOR_DEFAULTS, MK2_DEFAULTS,
    normalizeDirections, normalizeMaskedContent, normalizePoorOptions, normalizeMk2Options,
    expansion, outputSize, splitGridLayout, poorGeometry, mk2Steps,
  };
});
