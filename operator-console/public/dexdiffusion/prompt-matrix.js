// A1111 "Prompt matrix" and "Prompts from file or textbox" scripts (SC-16..SC-19): pure planning, no I/O.
// Loaded by the browser (window.DexPromptMatrix) and the server (require). The server validates every cell with the real
// generation validator and runs the cells through the durable queue (see prompt-scripts.js); the Prompt matrix result grid
// reuses the X/Y/Z grid builder (bin/xyz-grid.py) with the matrix laid out as X (columns) by Y (rows).
//
// Ported from A1111 scripts/prompt_matrix.py and scripts/prompts_from_file.py from knowledge; NOT diffed against the
// pinned upstream commit.
//
// Prompt matrix (A1111 behaviour kept): the prompt is split on "|"; the first segment is the base, every other segment is an
// optional part; the matrix has 2^N combinations, bit n of the cell number switches part n on. Enabled parts are stripped of
// whitespace and surrounding commas and joined with ", " (or a space), base first ("Put variable parts at start of prompt"
// puts them before the base). The grid splits the parts the way A1111 does: boundary = ceil((N+1)/2), the first
// boundary-1 optional parts run across (X), the rest down (Y); cell number = x + y * columns.
// Differences (deliberate): empty parts ("a||b", trailing "|") are an error instead of silently producing a duplicate
// cell; the base is trimmed of whitespace and surrounding commas; N is capped at 6 (64 cells); a matrix on the negative prompt is a "target" option here.
//
// Prompts from file or textbox (A1111 behaviour kept): one prompt per line; a line that starts with "--" is a flag line
// (shlex-split, values after --prompt/--negative_prompt run until the next flag); a flag line without --prompt uses the Create
// prompt, as A1111 does. Differences (deliberate, "strict"): every problem is an explicit error naming the line number
// (A1111 silently falls back to treating a broken flag line as a plain prompt); unknown flags, A1111 flags this console cannot
// honour, duplicate flags, missing/bad values and "--flag" text inside a plain prompt line are errors, never ignored;
// blank lines are skipped; at most 64 lines. A quoted "--x" word is treated as text, not a flag.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DexPromptMatrix = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX_CELLS = 64;
  const MAX_PARTS = 6;
  const MAX_SEED = 2147483647;

  // A1111 sampler names -> canonical console ids (mirrors infotext.js SAMPLER_IN; test-locked). Canonical ids pass through.
  const SAMPLER_IN = {
    'euler a': 'euler_a', 'euler': 'euler', 'heun': 'heun', 'dpm2': 'dpm2', 'dpm2 a': 'dpm2_a', 'lms': 'lms',
    'dpm++ 2s a': 'dpmpp2s_a', 'dpm++ 2m': 'dpmpp2m', 'dpm++ 2m v2': 'dpmpp2mv2', 'lcm': 'lcm', 'ipndm': 'ipndm', 'ipndm-v': 'ipndm_v',
    'ddim trailing': 'ddim_trailing', 'tcd': 'tcd', 'res multistep': 'res_multistep', 'res 2s': 'res_2s', 'er sde': 'er_sde', 'euler cfg++': 'euler_cfg_pp', 'euler a cfg++': 'euler_a_cfg_pp',
  };
  const SAMPLER_IDS = new Set(Object.values(SAMPLER_IN));
  // A1111 samplers with no installed engine (same list as infotext.js UNSUPPORTED_SAMPLERS).
  const UNSUPPORTED_SAMPLERS = new Set(['ddim', 'plms', 'unipc', 'dpm fast', 'dpm adaptive', 'dpm++ sde', 'dpm++ 2m sde', 'dpm++ 3m sde']);
  function resolveSampler(value) {
    const k = String(value).trim().toLowerCase();
    if (SAMPLER_IN[k]) return { id: SAMPLER_IN[k] };
    if (SAMPLER_IDS.has(k)) return { id: k };
    if (UNSUPPORTED_SAMPLERS.has(k)) return { error: `sampler "${value}" has no installed engine` };
    return { error: `unknown sampler "${value}"` };
  }

  // ───────────────────────── Prompt matrix ─────────────────────────
  // Linear trim of whitespace and commas at both ends (a regex alternation here was quadratic on long whitespace runs).
  const clean = s => {
    const t = String(s).trim();
    let i = 0, j = t.length;
    while (i < j && (t[i] === ',' || /\s/.test(t[i]))) i++;
    while (j > i && (t[j - 1] === ',' || /\s/.test(t[j - 1]))) j--;
    return t.slice(i, j);
  };

  // -> { base, parts[] } ; parts keep their raw text (labels), joined text is cleaned later.
  function splitMatrix(text) {
    const segs = String(text == null ? '' : text).split('|');
    return { base: segs[0].trim(), parts: segs.slice(1).map(s => s.trim()) };
  }

  // base: { prompt, negative_prompt }.  opts: { target: 'positive'|'negative', putAtStart, joiner: 'comma'|'space', differentSeeds }.
  // caps: targetCapabilities() object (optional): a negative-prompt matrix is refused where the target ignores the negative prompt.
  // -> { ok, errors, dims:[nx,ny,1], total, cells[], axes[3], parts[] }
  function buildMatrix(base, opts, caps, limits) {
    const o = Object.assign({ target: 'positive', putAtStart: false, joiner: 'comma', differentSeeds: false }, opts);
    const lim = Object.assign({ maxCells: MAX_CELLS }, limits);
    const errors = [];
    const onNeg = o.target === 'negative';
    if (o.target !== 'positive' && o.target !== 'negative') errors.push('Matrix target must be positive or negative');
    if (o.joiner !== 'comma' && o.joiner !== 'space') errors.push('Joining character must be comma or space');
    if (onNeg && caps && caps.negativePrompt === false) errors.push('This target does not use a negative prompt, so a negative-prompt matrix would produce identical images');
    const source = String((onNeg ? base.negative_prompt : base.prompt) || '');
    const sp0 = splitMatrix(source), head = clean(sp0.base), parts = sp0.parts;
    if (!parts.length) errors.push(`Add at least one "|" separated option to the ${onNeg ? 'negative ' : ''}prompt (for example: a cat | red hat | sunset)`);
    if (parts.length > MAX_PARTS) errors.push(`The matrix has ${parts.length} optional parts (${Math.pow(2, parts.length)} cells); the limit is ${MAX_PARTS} parts (${lim.maxCells} cells)`);
    parts.forEach((p, i) => { if (!clean(p)) errors.push(`Optional part ${i + 1} is empty (check for "||" or a trailing "|")`); });
    if (errors.length) return { ok: false, errors, dims: [1, 1, 1], total: 0, cells: [], axes: [null, null, null], parts };

    const N = parts.length, boundary = Math.ceil((N + 1) / 2);
    const nh = boundary - 1, nv = N - nh;                     // optional parts across / down
    const nx = 1 << nh, ny = 1 << nv, total = nx * ny;
    const sep = o.joiner === 'space' ? ' ' : ', ';
    const names = parts.map(clean);
    const join = bits => {
      const sel = names.filter((_, n) => bits & (1 << n));
      const pieces = (o.putAtStart ? sel.concat([head]) : [head].concat(sel)).filter(s => s !== '');
      return pieces.join(sep);
    };
    const cells = [];
    for (let k = 0; k < total; k++) {
      const ix = k % nx, iy = Math.floor(k / nx);
      const active = names.map((_, n) => !!(k & (1 << n)));
      const text = join(k);
      if (!onNeg && !text) { errors.push(`Cell ${k + 1} would have an empty prompt (the base part is empty)`); continue; }
      const on = names.filter((_, n) => active[n]);
      cells.push({
        index: k, ix, iy, iz: 0,
        prompt: onNeg ? String(base.prompt || '') : text,
        negative_prompt: onNeg ? text : String(base.negative_prompt || ''),
        overrides: {}, seedOffset: o.differentSeeds ? k : 0, active,
        labels: on.length ? on : ['base only'],
        // queueTitle is what the durable queue persists: part numbers only, never prompt text.
        title: on.length ? on.join(' + ') : 'base only',
        queueTitle: 'Matrix ' + (k + 1) + '/' + total + ' · parts ' + (active.map((a, n) => a ? n + 1 : 0).filter(Boolean).join(', ') || 'none'),
      });
    }
    if (total > lim.maxCells) errors.push(`The matrix has ${total} cells; the limit is ${lim.maxCells}`);
    if (errors.length) return { ok: false, errors, dims: [nx, ny, 1], total, cells: [], axes: [null, null, null], parts };
    const axisFor = (from, count, label) => {
      if (!count) return null;
      const values = [];
      for (let pos = 0; pos < (1 << count); pos++) {
        const on = names.slice(from, from + count).filter((_, i) => pos & (1 << i));
        values.push(on.length ? on.join(' + ') : 'base only');
      }
      return { type: 'prompt_matrix', label, values };
    };
    return { ok: true, errors: [], dims: [nx, ny, 1], total, cells, parts: names, axes: [axisFor(0, nh, 'Parts across'), axisFor(nh, nv, 'Parts down'), null] };
  }

  // ───────────────────────── Prompts from file or textbox ─────────────────────────
  // POSIX-shell-like split. Tokens are { text, quoted } so a quoted "--x" stays text. -> { tokens } | { error }
  function shellSplit(s) {
    const tokens = [];
    let cur = '', started = false, quoted = false, i = 0;
    const push = () => { if (started) { tokens.push({ text: cur, quoted }); } cur = ''; started = false; quoted = false; };
    while (i < s.length) {
      const c = s[i];
      if (/\s/.test(c)) { push(); i++; continue; }
      started = true;
      if (c === "'") {
        quoted = true; const end = s.indexOf("'", i + 1);
        if (end < 0) return { error: 'unterminated single quote' };
        cur += s.slice(i + 1, end); i = end + 1;
      } else if (c === '"') {
        quoted = true; i++; let closed = false;
        while (i < s.length) {
          const d = s[i];
          if (d === '"') { closed = true; i++; break; }
          if (d === '\\' && i + 1 < s.length && '"\\$`\n'.includes(s[i + 1])) { cur += s[i + 1]; i += 2; continue; }
          cur += d; i++;
        }
        if (!closed) return { error: 'unterminated double quote' };
      } else if (c === '\\') {
        if (i + 1 >= s.length) return { error: 'a backslash at the end of the line escapes nothing' };
        cur += s[i + 1]; quoted = quoted || false; i += 2;
      } else { cur += c; i++; }
    }
    push();
    return { tokens };
  }

  const INT_RE = /^-?\d+$/;
  const NUM_RE = /^-?(\d+\.?\d*|\.\d+)$/;
  // Flags that change generation. cap = target capability that must be on, or the flag would not change the picture.
  const FLAGS = {
    prompt: { kind: 'text' },
    negative_prompt: { kind: 'text', cap: 'negativePrompt', capLabel: 'a negative prompt' },
    seed: { kind: 'int', min: -1, max: MAX_SEED, field: 'seed' },
    steps: { kind: 'int', min: 1, max: 150, field: 'steps' },
    cfg_scale: { kind: 'float', min: 1, max: 30, field: 'cfg_scale', cap: 'cfg', capLabel: 'CFG scale' },
    width: { kind: 'int', min: 64, max: 2048, field: 'width' },
    height: { kind: 'int', min: 64, max: 2048, field: 'height' },
    sampler_name: { kind: 'sampler', field: 'sampler', cap: 'sampler', capLabel: 'a sampler choice' },
  };
  // Real A1111 flags with no honest equivalent here. Listed so they are refused by name, not ignored.
  const UNSUPPORTED_FLAGS = {
    sd_model: 'checkpoint switching per line needs a model-slot swap', outpath_samples: 'output paths are managed by the console', outpath_grids: 'output paths are managed by the console',
    prompt_for_display: 'display prompts are not stored', styles: 'apply styles in the prompt before pasting', subseed_strength: 'variation seed is not supported by the installed sd-cli',
    subseed: 'variation seed is not supported by the installed sd-cli', seed_resize_from_h: 'seed resize is not supported by the installed sd-cli', seed_resize_from_w: 'seed resize is not supported by the installed sd-cli',
    sampler_index: 'use --sampler_name instead', batch_size: 'each line is one image; use the line count', n_iter: 'each line is one image; repeat the line instead',
    restore_faces: 'face restoration is not available', tiling: 'per-line tiling is not available', do_not_save_samples: 'saving is managed by the console', do_not_save_grid: 'grids are built from the X/Y/Z grid builder',
  };

  // Parse one non-blank line. n = 1-based physical line number. -> { ok, prompt|null, negative|null, overrides, flags[], errors[] }
  function parseLine(line, n, caps, basePrompt) {
    const L = `Line ${n}`;
    const raw = String(line).trim();
    const out = { ok: false, prompt: null, negative: null, overrides: {}, flags: [], errors: [] };
    const fail = m => { out.errors.push(`${L}: ${m}`); return out; };
    if (!raw.startsWith('--')) {
      const hit = /(^|\s)(--[A-Za-z_][\w-]*)(?=\s|$)/.exec(raw);
      if (hit) return fail(`"${hit[2]}" looks like a flag inside a plain prompt; a flag line must start with --prompt (for example: --prompt "a cat" ${hit[2]} …)`);
      out.prompt = raw; out.ok = true; return out;
    }
    const sp = shellSplit(raw);
    if (sp.error) return fail(sp.error);
    const t = sp.tokens, isFlag = tok => !tok.quoted && tok.text.startsWith('--');
    let pos = 0;
    while (pos < t.length) {
      const tok = t[pos];
      if (!isFlag(tok)) return fail(`expected a "--flag" but found "${tok.text}" (put plain text after --prompt)`);
      const name = tok.text.slice(2);
      if (!name) return fail('a bare "--" is not a flag');
      if (Object.prototype.hasOwnProperty.call(UNSUPPORTED_FLAGS, name)) return fail(`--${name} is an A1111 option this console does not support (${UNSUPPORTED_FLAGS[name]})`);
      const def = Object.prototype.hasOwnProperty.call(FLAGS, name) ? FLAGS[name] : undefined;   // not inherited names like constructor
      if (!def) return fail(`unknown flag --${name} (supported: ${Object.keys(FLAGS).map(k => '--' + k).join(', ')})`);
      if (out.flags.includes(name)) return fail(`--${name} appears twice`);
      if (def.cap && caps && caps[def.cap] === false) return fail(`--${name} is refused: this target does not use ${def.capLabel}, so it would not change the image`);
      pos++;
      if (def.kind === 'text') {
        const parts = [];
        while (pos < t.length && !isFlag(t[pos])) { parts.push(t[pos].text); pos++; }
        const val = parts.join(' ').trim();
        if (!val) return fail(`--${name} needs text`);
        if (name === 'prompt') out.prompt = val; else out.negative = val;
        out.flags.push(name);
        continue;
      }
      if (pos >= t.length || isFlag(t[pos])) return fail(`--${name} needs a value`);
      const val = t[pos].text; pos++;
      out.flags.push(name);
      if (def.kind === 'sampler') {
        const r = resolveSampler(val);
        if (r.error) return fail(`--${name}: ${r.error}`);
        out.overrides[def.field] = r.id; continue;
      }
      if (def.kind === 'int' ? !INT_RE.test(val) : !NUM_RE.test(val)) return fail(`--${name} "${val}" is not ${def.kind === 'int' ? 'a whole number' : 'a number'}`);
      const num = Number(val);
      if (num < def.min || num > def.max) return fail(`--${name} ${num} is outside ${def.min}–${def.max}`);
      out.overrides[def.field] = num;
    }
    if (out.prompt === null) {
      if (!String(basePrompt || '').trim()) return fail('no --prompt and the Create prompt is empty');
    }
    out.ok = true;
    return out;
  }

  // text: the textbox / file contents.  base: { prompt, negative_prompt }.  opts: { iterateSeed }.  caps: targetCapabilities().
  // -> { ok, errors, total, skipped, cells[] }.  A cell is the exact normalised job before server validation (the dry run).
  function buildLines(text, base, opts, caps, limits) {
    const o = Object.assign({ iterateSeed: false }, opts);
    const lim = Object.assign({ maxCells: MAX_CELLS }, limits);
    const rows = String(text == null ? '' : text).split(/\r\n|\r|\n/);
    const errors = [], cells = [];
    let skipped = 0;
    rows.forEach((row, i) => {
      if (errors.length >= 20) return;   // enough to fix; never build a response proportional to the input
      if (!row.trim()) { skipped++; return; }
      const r = parseLine(row, i + 1, caps, base && base.prompt);
      if (!r.ok) { errors.push(...r.errors); return; }
      const n = i + 1, index = cells.length;
      const usesBasePrompt = r.prompt === null;
      const prompt = usesBasePrompt ? String(base.prompt || '') : r.prompt;
      const negative = r.negative !== null ? r.negative : String(base.negative_prompt || '');
      const flagText = Object.keys(r.overrides).map(k => `${k} ${r.overrides[k]}`);
      cells.push({
        index, line: n, prompt, negative_prompt: negative, overrides: r.overrides,
        seedOffset: o.iterateSeed ? index : 0, flags: r.flags,
        labels: ['Line ' + n].concat(flagText, r.negative !== null ? ['own negative prompt'] : [], usesBasePrompt ? ['Create prompt'] : []),
        // queueTitle is what the durable queue persists: the line number and numeric/enum flags, never prompt text.
        title: 'Line ' + n + (flagText.length ? ' · ' + flagText.join(' · ') : ''),
        queueTitle: 'Line ' + n + (flagText.length ? ' · ' + flagText.join(' · ') : ''),
      });
    });
    if (!cells.length && !errors.length) errors.push('Enter at least one prompt line');
    if (cells.length + errors.length > 0 && cells.length > lim.maxCells) errors.push(`The list has ${cells.length} prompts; the limit is ${lim.maxCells}`);
    if (errors.length) return { ok: false, errors, total: cells.length, skipped, cells: [] };
    return { ok: true, errors: [], total: cells.length, skipped, cells };
  }

  // One line per cell of what will actually be run (SC-19 dry-run text; the server adds the validator-normalised values).
  function describeCell(c) {
    const o = c.overrides || {};
    const bits = Object.keys(o).map(k => `${k}=${o[k]}`);
    if (c.seedOffset) bits.push(`seed+${c.seedOffset}`);
    return `${c.index + 1}. ${c.prompt}` + (c.negative_prompt ? `  [neg: ${c.negative_prompt}]` : '') + (bits.length ? `  (${bits.join(', ')})` : '');
  }
  // Dry run for either script: the expanded, ordered cell list without touching a server.
  function dryRun(kind, a) {
    const plan = kind === 'matrix' ? buildMatrix(a.base, a.opts, a.caps, a.limits) : buildLines(a.text, a.base, a.opts, a.caps, a.limits);
    return Object.assign({}, plan, { preview: plan.ok ? plan.cells.map(describeCell) : [] });
  }

  return { MAX_CELLS, MAX_PARTS, MAX_SEED, FLAGS, UNSUPPORTED_FLAGS, SAMPLER_IN, resolveSampler, splitMatrix, buildMatrix, shellSplit, parseLine, buildLines, describeCell, dryRun };
});
