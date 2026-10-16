// A1111 "X/Y/Z plot" script (P10): axis catalog, value parsing (CSV, ranges), cell expansion and gating.
// Pure; loaded by the browser (window.DexXyz) and the server (require). The server validates every cell with
// the real generation validator and runs the cells through the durable queue; bin/xyz-grid.py draws the grid.
//
// Provided axes: Seed, Steps, CFG scale, Sampler, Scheduler, Width, Height, Clip skip, Eta, Prompt S/R, Negative prompt S/R.
// NOT provided (no installed engine support, see docs/parity P10): Checkpoint / VAE / Refiner axes (a model-slot swap per
// cell), prompt-order permutations, [a:b:n] scheduling, Hires/Denoising axes, Noise-multiplier / Sigma axes, per-axis seed variation.
// Ported from A1111 scripts/xyz_grid.py from knowledge; not diffed against the pinned commit.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DexXyz = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // kind: int | float | text | sr.  cap: the target capability that must be on for the axis to change pixels.
  const AXES = {
    seed: { label: 'Seed', kind: 'int', min: 0, max: 2147483647, field: 'seed' },
    steps: { label: 'Steps', kind: 'int', min: 1, max: 150, field: 'steps' },
    cfg_scale: { label: 'CFG scale', kind: 'float', min: 1, max: 30, field: 'cfg_scale', cap: 'cfg' },
    sampler: { label: 'Sampler', kind: 'text', field: 'sampler', cap: 'sampler' },
    scheduler: { label: 'Scheduler', kind: 'text', field: 'scheduler', cap: 'scheduler' },
    width: { label: 'Width', kind: 'int', min: 64, max: 2048, field: 'width' },
    height: { label: 'Height', kind: 'int', min: 64, max: 2048, field: 'height' },
    clip_skip: { label: 'Clip skip', kind: 'int', min: 1, max: 12, field: 'clip_skip', cap: 'clipSkip' },
    eta: { label: 'Eta', kind: 'float', min: 0, max: 1, field: 'eta', cap: 'eta' },
    prompt_sr: { label: 'Prompt S/R', kind: 'sr' },
    negative_sr: { label: 'Negative prompt S/R', kind: 'sr', cap: 'negativePrompt' },
  };
  const MAX_CELLS = 64;

  // CSV with double-quoted fields ("a, b" stays one value), whitespace trimmed, empties dropped.
  function csv(text) {
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
    return out.filter(v => v !== '');
  }

  const INT_RANGE = /^\s*(-?\d+)\s*-\s*(-?\d+)\s*(?:\(\s*([+-]\d+)\s*\))?\s*(?:\[\s*(\d+)\s*\])?\s*$/;
  const FLT_RANGE = /^\s*(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)\s*(?:\(\s*([+-]\d+(?:\.\d+)?)\s*\))?\s*(?:\[\s*(\d+)\s*\])?\s*$/;
  const round6 = x => Math.round(x * 1e6) / 1e6;

  function expandRange(v, kind) {
    const m = (kind === 'int' ? INT_RANGE : FLT_RANGE).exec(v);
    if (!m) return null;
    const a = Number(m[1]), b = Number(m[2]);
    const out = [];
    if (m[4] !== undefined) {
      const n = Number(m[4]);
      if (n < 1) return { error: `"${v}": count must be at least 1` };
      for (let i = 0; i < n; i++) out.push(n === 1 ? a : a + (b - a) * i / (n - 1));
    } else {
      let step = m[3] !== undefined ? Number(m[3]) : (b >= a ? 1 : -1);
      if (step === 0 || (b > a && step < 0) || (b < a && step > 0)) return { error: `"${v}": step goes the wrong way` };
      for (let x = a, i = 0; step > 0 ? x <= b + 1e-9 : x >= b - 1e-9; x += step, i++) { out.push(x); if (i > 4096) return { error: `"${v}": too many values` }; }
    }
    return { values: out.map(x => kind === 'int' ? Math.round(x) : round6(x)) };
  }

  // -> { values } | { error }.  Values are numbers for int/float axes, strings otherwise.
  function parseValues(type, text) {
    const ax = AXES[type];
    if (!ax) return { error: `Unknown axis "${type}"` };
    const items = csv(text);
    if (!items.length) return { error: `${ax.label}: enter at least one value` };
    if (ax.kind === 'text' || ax.kind === 'sr') return { values: items };
    const values = [];
    for (const v of items) {
      const r = expandRange(v, ax.kind);
      if (r && r.error) return { error: `${ax.label}: ${r.error}` };
      if (r) { values.push(...r.values); continue; }
      const n = Number(v);
      if (!Number.isFinite(n) || (ax.kind === 'int' && !Number.isInteger(n))) return { error: `${ax.label}: "${v}" is not ${ax.kind === 'int' ? 'a whole number' : 'a number'}` };
      values.push(n);
    }
    for (const n of values) if (n < ax.min || n > ax.max) return { error: `${ax.label}: ${n} is outside ${ax.min}–${ax.max}` };
    return { values };
  }

  const fmt = (type, v) => `${AXES[type].label}: ${v}`;

  // axes: { x, y, z } each { type, values (text) } or empty/'none'. base: { prompt, negative_prompt }.
  // caps: targetCapabilities() object (optional); an axis whose capability is off is refused rather than producing identical images.
  function buildPlan(base, axes, caps, opts) {
    const o = Object.assign({ maxCells: MAX_CELLS }, opts);
    const used = [], errors = [];
    for (const k of ['x', 'y', 'z']) {
      const a = axes && axes[k];
      if (!a || !a.type || a.type === 'none') { used.push(null); continue; }
      const ax = AXES[a.type];
      if (!ax) { errors.push(`${k.toUpperCase()} axis: unknown type "${a.type}"`); used.push(null); continue; }
      if (ax.cap && caps && caps[ax.cap] === false) { errors.push(`${k.toUpperCase()} axis ${ax.label}: this target does not use ${ax.label.toLowerCase()}, so every cell would be identical`); used.push(null); continue; }
      const p = parseValues(a.type, a.values);
      if (p.error) { errors.push(`${k.toUpperCase()} axis ${p.error}`); used.push(null); continue; }
      used.push({ axis: k, type: a.type, values: p.values });
    }
    const types = used.filter(Boolean).map(u => u.type);
    if (new Set(types).size !== types.length) errors.push('Each axis must use a different type');
    if (!used.some(Boolean) && !errors.length) errors.push('Choose at least one axis');
    const dims = used.map(u => u ? u.values.length : 1);
    const total = dims[0] * dims[1] * dims[2];
    if (total > o.maxCells) errors.push(`The plot has ${total} cells; the limit is ${o.maxCells}`);
    if (errors.length) return { ok: false, errors, dims, total, cells: [] };

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
          if (!prompt.includes(search) && !negative.includes(search)) errors.push(`Prompt S/R: "${search}" was not found in the prompt or negative prompt`);
          prompt = prompt.split(search).join(v); negative = negative.split(search).join(v);
        } else if (u.type === 'negative_sr') {
          const search = u.values[0];
          if (!negative.includes(search)) errors.push(`Negative prompt S/R: "${search}" was not found in the negative prompt`);
          negative = negative.split(search).join(v);
        } else overrides[ax.field] = v;
        labels.push(fmt(u.type, v));
        safe.push(ax.kind === 'sr' ? `${ax.label} #${idx[n] + 1}` : fmt(u.type, v));
      });
      cells.push({ index: cells.length, ix, iy, iz, prompt, negative_prompt: negative, overrides, labels, title: safe.join(' · '), fullTitle: labels.join(' · ') });
    }
    const uniq = [...new Set(errors)];
    if (uniq.length) return { ok: false, errors: uniq, dims, total, cells: [] };
    return { ok: true, errors: [], dims, total, cells, axes: used.map(u => u && { type: u.type, label: AXES[u.type].label, values: u.values.map(String) }) };
  }

  return { AXES, MAX_CELLS, csv, parseValues, buildPlan };
});
