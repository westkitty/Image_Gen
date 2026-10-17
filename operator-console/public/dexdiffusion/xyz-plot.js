// A1111 "X/Y/Z plot" script (P10): axis catalog, value parsing (CSV, ranges), cell expansion and gating.
// Pure; loaded by the browser (window.DexXyz) and the server (require). The server validates every cell with
// the real generation validator and runs the cells through the durable queue; bin/xyz-grid.py draws the grid.
//
// Provided axes: Seed, Steps, CFG scale, Sampler, Scheduler, Width, Height, Size, Clip skip, Eta, Prompt S/R, Negative prompt S/R,
// Prompt order (permutations), Hires steps / Hires upscaler / Denoising (hires denoise; need High-Res Refine on).
// Refused with the engine reason (ABSENT_AXES): Var. seed / Var. strength, Checkpoint / VAE / Refiner (a model-slot swap per cell),
// Sigma / churn / noise-multiplier axes and the other A1111 axes the installed sd-cli cannot honour. [a:b:n] scheduling is not provided.
// Also: swapAxes helpers, per-axis "vary seeds", and the upstream cost-ordered cell processing order.
// Semantics ported from the pinned A1111 scripts/xyz_grid.py (apply_order, apply_size, cell(): vary_seeds_*, draw_xyz_grid ordering).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DexXyz = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // kind: int | float | text | sr.  cap: the target capability that must be on for the axis to change pixels.
  // cost: how expensive a change of this axis is (A1111 AxisOption.cost); the costliest axis is processed outermost.
  const AXES = {
    seed: { label: 'Seed', kind: 'int', min: -1, max: 2147483647, field: 'seed' },
    steps: { label: 'Steps', kind: 'int', min: 1, max: 150, field: 'steps' },
    cfg_scale: { label: 'CFG scale', kind: 'float', min: 1, max: 30, field: 'cfg_scale', cap: 'cfg' },
    sampler: { label: 'Sampler', kind: 'text', field: 'sampler', cap: 'sampler' },
    scheduler: { label: 'Scheduler', kind: 'text', field: 'scheduler', cap: 'scheduler' },
    width: { label: 'Width', kind: 'int', min: 64, max: 2048, field: 'width' },
    height: { label: 'Height', kind: 'int', min: 64, max: 2048, field: 'height' },
    clip_skip: { label: 'Clip skip', kind: 'int', min: 1, max: 12, field: 'clip_skip', cap: 'clipSkip' },
    eta: { label: 'Eta', kind: 'float', min: 0, max: 1, field: 'eta', cap: 'eta' },
    size: { label: 'Size', kind: 'size', min: 64, max: 2048 },
    hires_steps: { label: 'Hires steps', kind: 'int', min: 0, max: 150, field: 'hires_steps', cap: 'hiresRefine', needs: 'hires' },
    hires_upscaler: { label: 'Hires upscaler', kind: 'text', field: 'hires_upscaler', cap: 'hiresRefine', needs: 'hires' },
    // A1111 txt2img "Denoising" is the hires-pass denoising strength; sd-cli's equivalent is --hires-denoise (0.05-0.95).
    denoising: { label: 'Denoising', kind: 'float', min: 0.05, max: 0.95, field: 'hires_denoise', cap: 'hiresRefine', needs: 'hires' },
    prompt_order: { label: 'Prompt order', kind: 'order' },
    prompt_sr: { label: 'Prompt S/R', kind: 'sr' },
    negative_sr: { label: 'Negative prompt S/R', kind: 'sr', cap: 'negativePrompt' },
  };
  const MAX_CELLS = 64;
  const MAX_ORDER_FRAGMENTS = 5;   // 5! = 120 permutations already exceeds MAX_CELLS; refuse before generating n! of them

  const NO_ENGINE = 'the installed sd-cli has no';
  const ABSENT_AXES = {
    var_seed: { label: 'Var. seed', reason: `${NO_ENGINE} variation seed (subseed)` },
    var_strength: { label: 'Var. strength', reason: `${NO_ENGINE} variation strength (subseed strength)` },
    checkpoint: { label: 'Checkpoint name', reason: 'a checkpoint swap per cell is not available (one model slot per queue run)' },
    vae: { label: 'VAE', reason: 'a VAE swap per cell is not available (one model slot per queue run)' },
    refiner_checkpoint: { label: 'Refiner checkpoint', reason: `${NO_ENGINE} refiner stage` },
    refiner_switch_at: { label: 'Refiner switch at', reason: `${NO_ENGINE} refiner stage` },
    hires_sampler: { label: 'Hires sampler', reason: `${NO_ENGINE} separate hires sampler` },
    image_cfg_scale: { label: 'Image CFG Scale', reason: `${NO_ENGINE} image CFG scale` },
    s_min_uncond: { label: 'Negative Guidance minimum sigma', reason: `${NO_ENGINE} negative-guidance sigma control` },
    s_churn: { label: 'Sigma Churn', reason: `${NO_ENGINE} sigma churn control` },
    s_tmin: { label: 'Sigma min', reason: `${NO_ENGINE} sampler sigma control` },
    s_tmax: { label: 'Sigma max', reason: `${NO_ENGINE} sampler sigma control` },
    s_noise: { label: 'Sigma noise', reason: `${NO_ENGINE} sampler noise control` },
    initial_noise_multiplier: { label: 'Initial noise multiplier', reason: `${NO_ENGINE} initial noise multiplier` },
    extra_noise: { label: 'Extra noise', reason: `${NO_ENGINE} extra-noise control` },
    schedule_sigma: { label: 'Schedule min/max sigma, rho, beta alpha/beta', reason: `${NO_ENGINE} scheduler parameter control` },
    styles: { label: 'Styles', reason: `${NO_ENGINE} prompt styles` },
    unipc_order: { label: 'UniPC Order', reason: `${NO_ENGINE} UniPC order control` },
    face_restore: { label: 'Face restore', reason: `${NO_ENGINE} face restoration` },
    token_merging: { label: 'Token merging ratio', reason: `${NO_ENGINE} token merging` },
    discard_sigma: { label: 'Always discard next-to-last sigma', reason: `${NO_ENGINE} sigma discard option` },
    sgm_noise: { label: 'SGM noise multiplier', reason: `${NO_ENGINE} SGM noise multiplier` },
    rng_source: { label: 'RNG source', reason: `${NO_ENGINE} RNG source selection on this axis` },
    fp8_mode: { label: 'FP8 mode', reason: `${NO_ENGINE} FP8 storage switch` },
    inpainting_mask_weight: { label: 'Cond. Image Mask Weight', reason: `${NO_ENGINE} conditioning mask weight` },
  };
  const absentReason = a => { const x = ABSENT_AXES[a.type]; return x ? `${x.label} is not available: ${x.reason}` : null; };

  // CSV with double-quoted fields ("a, b" stays one value), whitespace trimmed, empties dropped.
  // keepEmpty (A1111 csv_string_to_list_strip, used for text axes): empty entries stay so a word can be replaced by nothing,
  // and every value is stripped even when it was quoted.
  function csv(text, keepEmpty) {
    const out = []; let cur = '', q = false, was = false;
    const s = String(text == null ? '' : text);
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (q) { if (c === '"' && s[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
      else if (c === '"' && cur.trim() === '') { q = true; was = true; cur = ''; }
      else if (c === ',') { out.push(was ? cur : cur.trim()); cur = ''; was = false; }
      else cur += c;
    }
    out.push(was ? cur : cur.trim());
    if (keepEmpty) return String(text == null ? '' : text).trim() === '' ? [] : out.map(v => v.trim());
    return out.filter(v => v !== '');
  }

  // Upstream re_range / re_range_float accept a leading '+' and spaces after a sign.
  const INT_RANGE = /^\s*([+-]?\s*\d+)\s*-\s*([+-]?\s*\d+)\s*(?:\(\s*([+-]\d+)\s*\))?\s*(?:\[\s*(\d+)\s*\])?\s*$/;
  const FLT_RANGE = /^\s*([+-]?\s*\d+(?:\.\d*)?)\s*-\s*([+-]?\s*\d+(?:\.\d*)?)\s*(?:\(\s*([+-]\d+(?:\.\d*)?)\s*\))?\s*(?:\[\s*(\d+)\s*\])?\s*$/;
  const round8 = x => Math.round(x * 1e8) / 1e8;   // upstream labels round floats to 8 places
  const num = t => Number(String(t).replace(/\s+/g, ''));

  function expandRange(v, kind) {
    const m = (kind === 'int' ? INT_RANGE : FLT_RANGE).exec(v);
    if (!m) return null;
    const a = num(m[1]), b = num(m[2]);
    const out = [];
    if (m[4] !== undefined) {
      // np.linspace(a, b, n): a + i*step, last point forced to b. Int axes truncate (int(x)), they do not round.
      const n = Number(m[4]);
      if (n < 1) return { error: `"${v}": count must be at least 1` };
      const st = n > 1 ? (b - a) / (n - 1) : 0;
      for (let i = 0; i < n; i++) out.push(n === 1 ? a : (i === n - 1 ? b : a + i * st));
    } else if (kind === 'int') {
      const step = m[3] !== undefined ? Number(m[3]) : (b >= a ? 1 : -1);
      if (step === 0 || (b > a && step < 0) || (b < a && step > 0)) return { error: `"${v}": step goes the wrong way` };
      for (let x = a, i = 0; step > 0 ? x <= b : x >= b; x += step, i++) { out.push(x); if (i > 4096) return { error: `"${v}": too many values` }; }
    } else {
      // np.arange(a, b + step, step): n = ceil((stop - a) / step) values a + i*step, so the last one can pass b.
      const step = m[3] !== undefined ? Number(m[3]) : (b >= a ? 1 : -1);
      if (step === 0 || (b > a && step < 0) || (b < a && step > 0)) return { error: `"${v}": step goes the wrong way` };
      const n = Math.ceil((b + step - a) / step);
      if (n > 4096) return { error: `"${v}": too many values` };
      for (let i = 0; i < n; i++) out.push(a + i * step);
    }
    return { values: out.map(x => kind === 'int' ? Math.trunc(x) : round8(x)) };
  }

  // itertools.permutations order (lexicographic by position).
  function permutations(items) {
    const out = [];
    const rec = (rest, acc) => { if (!rest.length) { out.push(acc); return; } rest.forEach((x, i) => rec(rest.filter((_, j) => j !== i), acc.concat([x]))); };
    rec(items, []);
    return out;
  }

  // A1111 apply_order: x is a permutation of fragments; the fragments are found in the prompt, taken out, and put back in
  // the permuted order, in the slots they occupied (earliest-seen first). Returns null if a fragment is not in the prompt
  // (upstream would silently corrupt the prompt via find() == -1; this refuses instead).
  function applyPromptOrder(prompt, x) {
    let rest = String(prompt);
    const order = x.map(tok => [rest.indexOf(tok), tok]);
    if (order.some(o => o[0] < 0)) return null;
    order.sort((a, b) => a[0] - b[0]);   // stable, like Python's sort
    const parts = [];
    for (const [, tok] of order) {
      const n = rest.indexOf(tok);
      if (n < 0) return null;
      parts.push(rest.slice(0, n));
      rest = rest.slice(n + tok.length);
    }
    let tmp = '';
    parts.forEach((part, i) => { tmp += part + x[i]; });
    return tmp + rest;
  }

  // -> { values } | { error }.  Values are numbers for int/float axes, strings otherwise.
  function parseValues(type, text) {
    const ax = AXES[type];
    if (!ax) return { error: `Unknown axis "${type}"` };
    const items = csv(text, ax.kind === 'text' || ax.kind === 'sr');
    if (!items.length) return { error: `${ax.label}: enter at least one value` };
    if (ax.kind === 'text' && items.some(v => v === '')) return { error: `${ax.label}: values cannot be empty` };
    if (ax.kind === 'text' || ax.kind === 'sr') return { values: items };
    if (ax.kind === 'size') {
      const values = [];
      for (const v of items) {
        const m = /^\s*(\d+)\s*x\s*(\d+)\s*$/i.exec(v);
        if (!m) return { error: `${ax.label}: "${v}" is not WxH (for example 512x768)` };
        const w = Number(m[1]), h = Number(m[2]);
        if (w < ax.min || w > ax.max || h < ax.min || h > ax.max) return { error: `${ax.label}: ${w}x${h} is outside ${ax.min}–${ax.max} on each side` };
        values.push(`${w}x${h}`);
      }
      return { values };
    }
    if (ax.kind === 'order') {
      if (items.some(v => v === '')) return { error: `${ax.label}: fragments cannot be empty` };
      if (items.length < 2) return { error: `${ax.label}: enter at least two prompt fragments to permute` };
      if (items.length > MAX_ORDER_FRAGMENTS) return { error: `${ax.label}: ${items.length} fragments make ${items.length}! permutations; the limit is ${MAX_ORDER_FRAGMENTS} fragments` };
      return { values: permutations(items) };
    }
    const values = [];
    for (const v of items) {
      const r = expandRange(v, ax.kind);
      if (r && r.error) return { error: `${ax.label}: ${r.error}` };
      if (r) { values.push(...r.values); continue; }
      const n = num(v);
      if (!Number.isFinite(n) || (ax.kind === 'int' && !Number.isInteger(n))) return { error: `${ax.label}: "${v}" is not ${ax.kind === 'int' ? 'a whole number' : 'a number'}` };
      values.push(n);
    }
    if (!values.length) return { error: `${ax.label}: enter at least one value` };
    for (const n of values) if (n < ax.min || n > ax.max) return { error: `${ax.label}: ${n} is outside ${ax.min}–${ax.max}` };
    return { values };
  }

  const fmt = (type, v) => `${AXES[type].label}: ${Array.isArray(v) ? v.join(', ') : v}`;

  // Swap X/Y, Y/Z, X/Z (A1111 swap_axes: type and values travel together; the "vary seeds" flags are positional and stay).
  // pair: 'xy' | 'yz' | 'xz'.  Returns a new axes config; the input is not modified.
  function swapAxes(axes, pair) {
    const p = String(pair || '').toLowerCase();
    if (!['xy', 'yz', 'xz'].includes(p)) throw new Error(`swapAxes: unknown pair "${pair}"`);
    const out = { x: axes && axes.x, y: axes && axes.y, z: axes && axes.z };
    const [a, b] = p.split('');
    const t = out[a]; out[a] = out[b]; out[b] = t;
    for (const k of ['x', 'y', 'z']) out[k] = out[k] ? Object.assign({}, out[k]) : out[k];
    return out;
  }
  const swapXY = axes => swapAxes(axes, 'xy'), swapYZ = axes => swapAxes(axes, 'yz'), swapXZ = axes => swapAxes(axes, 'xz');

  // A1111 draw_xyz_grid ordering: the axis whose change is costliest (checkpoint, VAE...) is the outermost loop so it changes least.
  // costs: { x, y, z } numbers (missing = 0).  Returns { first, second, third } axis letters, outermost to innermost.
  // Ties fall back to the default z (outer), y, x (inner), exactly as upstream's if/elif chain does.
  function processingOrder(costs) {
    const c = { x: Number(costs && costs.x) || 0, y: Number(costs && costs.y) || 0, z: Number(costs && costs.z) || 0 };
    let first = 'z', second = 'y';
    if (c.x > c.y && c.x > c.z) { first = 'x'; second = c.y > c.z ? 'y' : 'z'; }
    else if (c.y > c.x && c.y > c.z) { first = 'y'; second = c.x > c.z ? 'x' : 'z'; }
    else if (c.z > c.x && c.z > c.y) { first = 'z'; second = c.x > c.y ? 'x' : 'y'; }
    const third = ['x', 'y', 'z'].find(k => k !== first && k !== second);
    return { first, second, third };
  }

  // Cell indices (ix + iy*nx + iz*nx*ny, the result-grid position) in execution order. Grid positions never change.
  function cellOrder(dims, costs) {
    const { first, second, third } = processingOrder(costs);
    const d = { x: dims[0], y: dims[1], z: dims[2] };
    const out = [], idx = {};
    for (idx[first] = 0; idx[first] < d[first]; idx[first]++) for (idx[second] = 0; idx[second] < d[second]; idx[second]++) for (idx[third] = 0; idx[third] < d[third]; idx[third]++) {
      out.push(idx.x + idx.y * d.x + idx.z * d.x * d.y);
    }
    return out;
  }

  // axes: { x, y, z } each { type, values (text) } or empty/'none'. base: { prompt, negative_prompt }.
  // caps: targetCapabilities() object (optional); an axis whose capability is off is refused rather than producing identical images.
  // base.hires: true when the request has High-Res Refine on (hires_scale or hires_width/height set); the Hires steps / upscaler /
  //   Denoising axes are refused unless it is exactly true, because without the second pass they would change nothing.
  // base.seed: the fixed base seed when known (>= 0). opts.keepRandomSeeds (leave Seed -1 as -1), opts.random (() => [0,1), for tests), opts.varySeeds: { x, y, z } booleans (A1111 "Vary seeds for X/Y/Z").
  // Result also carries order (cell indices in execution order, costliest axis outermost) and processing {first,second,third}.
  function buildPlan(base, axes, caps, opts) {
    const o = Object.assign({ maxCells: MAX_CELLS }, opts);
    const used = [], errors = [];
    for (const k of ['x', 'y', 'z']) {
      const a = axes && axes[k];
      if (!a || !a.type || a.type === 'none') { used.push(null); continue; }
      const ax = AXES[a.type];
      const gone = !ax && absentReason(a);
      if (gone) { errors.push(`${k.toUpperCase()} axis ${gone}`); used.push(null); continue; }
      if (!ax) { errors.push(`${k.toUpperCase()} axis: unknown type "${a.type}"`); used.push(null); continue; }
      if (ax.cap && caps && caps[ax.cap] === false) { errors.push(`${k.toUpperCase()} axis ${ax.label}: this target does not use ${ax.label.toLowerCase()}, so every cell would be identical`); used.push(null); continue; }
      if (ax.needs === 'hires' && !(base && base.hires === true)) { errors.push(`${k.toUpperCase()} axis ${ax.label}: High-Res Refine is off, so the second pass never runs and every cell would be identical; turn it on first`); used.push(null); continue; }
      const p = parseValues(a.type, a.values);
      if (p.error) { errors.push(`${k.toUpperCase()} axis ${p.error}`); used.push(null); continue; }
      let values = p.values;
      // A1111 fix_axis_seeds: -1 on a Seed axis becomes one concrete random seed, fixed once for the whole plot,
      // unless "keep -1 for seeds" (opts.keepRandomSeeds) is on.
      if (a.type === 'seed' && !o.keepRandomSeeds) { const rnd = o.random || Math.random; values = values.map(v => v === -1 ? Math.floor(rnd() * (AXES.seed.max + 1)) : v); }
      used.push({ axis: k, type: a.type, values });
    }
    const types = used.filter(Boolean).map(u => u.type);
    if (new Set(types).size !== types.length) errors.push('Each axis must use a different type');
    if (types.includes('size') && (types.includes('width') || types.includes('height'))) errors.push('Size cannot be combined with a Width or Height axis (both would set the image size)');
    if (!used.some(Boolean) && !errors.length) errors.push('Choose at least one axis');
    const dims = used.map(u => u ? u.values.length : 1);
    const total = dims[0] * dims[1] * dims[2];
    if (total > o.maxCells) errors.push(`The plot has ${total} cells; the limit is ${o.maxCells}`);
    if (errors.length) return { ok: false, errors, dims, total, cells: [] };

    const vary = Object.assign({ x: false, y: false, z: false }, o.varySeeds);
    const seedBase = base && Number.isInteger(base.seed) && base.seed >= 0 ? base.seed : null;
    const xdim = vary.x ? dims[0] : 1, ydim = vary.y ? dims[1] : 1;
    const cells = [];
    for (let iz = 0; iz < dims[2]; iz++) for (let iy = 0; iy < dims[1]; iy++) for (let ix = 0; ix < dims[0]; ix++) {
      const idx = [ix, iy, iz];
      let prompt = base.prompt || '', negative = base.negative_prompt || '';
      const overrides = {}, labels = [], safe = [];   // safe: titles that carry no prompt text (those are persisted with queue items)
      used.forEach((u, n) => {
        if (!u) return;
        const v = u.values[idx[n]], ax = AXES[u.type];
        if (u.type === 'prompt_sr') {
          const search = u.values[0];
          if (search === '') errors.push('Prompt S/R: the first value is the text to search for and cannot be empty');
          if (search === '' || (!prompt.includes(search) && !negative.includes(search))) errors.push(`Prompt S/R: "${search}" was not found in the prompt or negative prompt`);
          prompt = prompt.split(search).join(v); negative = negative.split(search).join(v);
        } else if (u.type === 'negative_sr') {
          const search = u.values[0];
          if (search === '') errors.push('Negative prompt S/R: the first value is the text to search for and cannot be empty');
          else if (!negative.includes(search)) errors.push(`Negative prompt S/R: "${search}" was not found in the negative prompt`);
          negative = negative.split(search).join(v);
        } else if (u.type === 'prompt_order') {
          const next = applyPromptOrder(prompt, v);
          if (next === null) errors.push(`Prompt order: a fragment of "${v.join(', ')}" was not found in the prompt`);
          else prompt = next;
        } else if (u.type === 'size') {
          const [w, h] = v.split('x').map(Number);
          overrides.width = w; overrides.height = h;
        } else overrides[ax.field] = v;
        labels.push(fmt(u.type, v));
        safe.push(ax.kind === 'sr' || ax.kind === 'order' ? `${ax.label} #${idx[n] + 1}` : fmt(u.type, v));
      });
      // A1111 cell(): the axis value is applied first, then the vary-seeds offsets are added to whatever the seed is.
      const seedOffset = (vary.x ? ix : 0) + (vary.y ? iy * xdim : 0) + (vary.z ? iz * xdim * ydim : 0);
      if (seedOffset) {
        const startSeed = overrides.seed !== undefined ? overrides.seed : seedBase;
        if (startSeed !== null && startSeed !== undefined && startSeed >= 0) {
          overrides.seed = startSeed + seedOffset;
          if (overrides.seed > AXES.seed.max) errors.push(`Vary seeds: seed ${startSeed} + ${seedOffset} is above ${AXES.seed.max}`);
        }
      }
      cells.push({ index: cells.length, seedOffset, ix, iy, iz, prompt, negative_prompt: negative, overrides, labels, title: safe.join(' · '), fullTitle: labels.join(' · ') });
    }
    const uniq = [...new Set(errors)];
    if (uniq.length) return { ok: false, errors: uniq, dims, total, cells: [] };
    const costs = { x: 0, y: 0, z: 0 };
    used.forEach((u, n) => { if (u) costs['xyz'[n]] = AXES[u.type].cost || 0; });
    return { ok: true, errors: [], dims, total, cells, order: cellOrder(dims, costs), processing: processingOrder(costs),
      axes: used.map(u => u && { type: u.type, label: AXES[u.type].label, values: u.values.map(v => Array.isArray(v) ? v.join(', ') : String(v)) }) };
  }

  return { AXES, ABSENT_AXES, MAX_CELLS, csv, parseValues, applyPromptOrder, buildPlan, swapAxes, swapXY, swapYZ, swapXZ, processingOrder, cellOrder };
});
