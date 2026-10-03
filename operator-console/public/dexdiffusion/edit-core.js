// Pure DexDiffusion Edit/Create core, shared by the browser UI and the Node server/tests.
//
// One source of truth for:
//   * structured generation resources (LoRAs) and their serialization to the
//     backend's `<lora:name:weight>` prompt syntax (done at the request boundary)
//   * exact per-image parameter recall (`buildRecall`) and applying it to Edit state
//   * mask/viewport geometry in SOURCE IMAGE coordinates
//   * truthful job stage/progress derivation from sd-cli logs
//   * grouped/searchable model selector data
//   * versioned preset ("recipe") schema + migration
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DexEdit = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ── Resources: LoRAs ────────────────────────────────────────────────────
  const LORA_RE = /<lora:([^:>]+)(?::([^>]*))?>/g;
  const MIN_LORA_WEIGHT = -2, MAX_LORA_WEIGHT = 2;

  function formatWeight(w) {
    const n = Math.round(Number(w) * 100) / 100;
    return String(Number.isFinite(n) ? n : 1);
  }
  function clampWeight(w) {
    const n = Number(w);
    if (!Number.isFinite(n)) return 1;
    return Math.max(MIN_LORA_WEIGHT, Math.min(MAX_LORA_WEIGHT, Math.round(n * 100) / 100));
  }
  function parseLoraTags(prompt) {
    const out = [];
    const re = new RegExp(LORA_RE.source, 'g');
    let m;
    while ((m = re.exec(String(prompt || ''))) !== null) {
      const raw = m[2] == null || m[2] === '' ? 1 : Number(m[2]);
      out.push({ name: m[1], weight: Number.isFinite(raw) ? clampWeight(raw) : NaN, tag: m[0] });
    }
    return out;
  }
  function stripLoraTags(prompt) {
    return String(prompt || '').replace(new RegExp(LORA_RE.source, 'g'), ' ').replace(/[ \t]{2,}/g, ' ').replace(/ ?\n ?/g, '\n').trim();
  }
  // [{name, weight}] cleaned: strings, clamped numeric weights, duplicates by name collapsed (last wins).
  function normalizeLoras(list) {
    const seen = new Map();
    for (const l of Array.isArray(list) ? list : []) {
      if (!l || typeof l.name !== 'string' || !l.name.trim()) continue;
      const name = l.name.trim().replace(/\.(safetensors|ckpt|pt|bin)$/i, '');
      seen.set(name, Object.assign({ name, weight: l.weight === undefined ? 1 : clampWeight(l.weight) }, l.override === true ? { override: true } : {}));
    }
    return [...seen.values()];
  }
  function serializeLoraTags(loras) {
    return normalizeLoras(loras).map(l => `<lora:${l.name}:${formatWeight(l.weight)}>`).join(' ');
  }
  // Merge tags found in the prompt (legacy clients) with structured loras
  // (structured wins per name). Returns the clean visible prompt, the merged
  // structured list and the prompt to hand to the backend.
  function resolveResources({ prompt, loras } = {}) {
    const fromTags = parseLoraTags(prompt).filter(t => Number.isFinite(t.weight)).map(t => ({ name: t.name, weight: t.weight }));
    const merged = normalizeLoras([...fromTags, ...(Array.isArray(loras) ? loras : [])]);
    const clean = stripLoraTags(prompt);
    const tags = serializeLoraTags(merged);
    return { prompt: clean, loras: merged, backendPrompt: tags ? (clean ? clean + ' ' + tags : tags) : clean };
  }
  // LoRA compatibility of structured loras against a target family (resolved by the catalog).
  function checkLoraCompat(loras, catalog, family) {
    const byName = new Map();
    for (const c of catalog || []) {
      const base = String(c.filename || c.name || '').replace(/\.(safetensors|ckpt|pt|bin)$/i, '');
      byName.set(base, c); if (c.name) byName.set(String(c.name).replace(/\.(safetensors|ckpt|pt|bin)$/i, ''), c);
    }
    return normalizeLoras(loras).map(l => {
      const c = byName.get(l.name);
      if (!c) return { ...l, state: 'unknown', message: 'Not found in the discovered LoRA catalog' };
      if (!family || !c.family || c.family === 'unknown') return { ...l, state: 'unknown', family: c.family || null, message: 'Family unknown; compatibility unverified' };
      const ok = c.family === family || (c.family === 'sdxl' && family === 'pony') || (c.family === 'pony' && family === 'sdxl');
      return ok ? { ...l, state: 'ok', family: c.family } : { ...l, state: 'incompatible', family: c.family, message: `${c.family} LoRA does not match ${family} model` };
    });
  }

  // Sampler ids as accepted by sd-cli/the console (targets declare 'dpm++2m' style labels).
  const SAMPLER_ALIASES = { 'dpm++2m': 'dpmpp2m', 'dpm++ 2m': 'dpmpp2m', 'dpm++2mv2': 'dpmpp2mv2', 'dpm++2s_a': 'dpmpp2s_a', 'dpm++ 2s a': 'dpmpp2s_a', 'dpm++ sde': 'dpmpp2s_a', 'euler a': 'euler_a' };
  function canonicalSampler(s) {
    if (s === undefined || s === null || s === '') return undefined;
    const k = String(s).trim().toLowerCase();
    return SAMPLER_ALIASES[k] || k;
  }

  // ── Per-image generation recall ─────────────────────────────────────────
  const RECALL_SCHEMA = 'dexdiffusion.image_recall.v1';
  const RECALL_PARAM_KEYS = ['target', 'seed', 'width', 'height', 'steps', 'cfg', 'sampler', 'scheduler', 'vae', 'preset', 'strength'];

  // Build the recall record for ONE canonical image from its recorded meta.
  // `view` is the /api/images/:id/meta payload ({id,url,width,height,meta,parent,...}).
  // Prompt text is available only when it was stored (prompt saving was on).
  function buildRecall(view) {
    const v = view || {};
    const meta = v.meta || {};
    const params = {};
    const missing = [];
    for (const k of RECALL_PARAM_KEYS) {
      let val = meta[k];
      if ((k === 'width' || k === 'height') && v[k]) val = v[k]; // actual decoded pixel size wins
      if (val === undefined || val === null || val === '') missing.push(k); else params[k] = val;
    }
    params.loras = normalizeLoras(meta.loras);
    const recorded = !!(meta.target || meta.steps || meta.seed != null || meta.gen_schema);
    const hasText = typeof meta.prompt === 'string' && meta.prompt.length > 0;
    return {
      schema: RECALL_SCHEMA,
      imageId: v.id || null,
      operation: meta.operation || null,
      parentId: v.parent || meta.parent || null,
      runId: v.runId || meta.runId || null,
      recorded,
      params,
      missing,
      prompt: hasText
        ? { available: true, text: meta.prompt, negative: typeof meta.negative_prompt === 'string' ? meta.negative_prompt : '', reason: null, scope: meta.prompt_scope || null }
        : { available: false, text: '', negative: '', reason: meta.prompt_saved === false || (recorded && meta.prompt_saved !== true) ? 'Source prompt unavailable — prompt saving was off' : 'Source prompt was never recorded for this image' },
    };
  }

  // In-memory snapshots hold sensitive text for the current session only. They are
  // keyed by canonical image id and built from the REQUEST that made the image.
  function snapshotFromRequest(body, imageId, seed) {
    const b = body || {};
    const r = resolveResources({ prompt: b.prompt, loras: b.loras });
    return {
      imageId, seed: seed != null ? seed : b.seed,
      prompt: r.prompt, negative: b.negative_prompt || '', loras: r.loras,
    };
  }

  // Edit operation state shared by every Edit layout. Built ONLY from the recall
  // record (+ optional in-memory session snapshot) — never from Create's form.
  const EDIT_DEFAULTS = { steps: 20, cfg: 7, strength: 0.75, sampler: 'euler_a', scheduler: 'discrete', vae: 'auto', preset: null };
  function applyRecallToEdit(recall, { snapshot, op, targets, activeSecondary } = {}) {
    const r = recall || {};
    const p = r.params || {};
    const snap = snapshot && snapshot.imageId === r.imageId ? snapshot : null;
    const targetList = Array.isArray(targets) ? targets : [];
    const spec = targetList.find(t => t.id === p.target) || null;
    const editable = !!spec && (spec.backend || 'sdcpp') !== 'mflux';
    const promptAvail = r.prompt && r.prompt.available ? r.prompt : snap ? { available: true, text: snap.prompt, negative: snap.negative, reason: null, session: true } : (r.prompt || { available: false, reason: 'No source record' });
    const loras = (p.loras && p.loras.length ? p.loras : (snap && snap.loras) || []);
    const notes = [];
    if (!r.recorded) notes.push('This image has no recorded generation settings (created before settings were stored). Showing neutral defaults.');
    if (p.target && !spec) notes.push(`Source model "${p.target}" is not a currently available target.`);
    if (promptAvail.available && promptAvail.scope === 'extension') notes.push('The recorded prompt is the outpaint extension prompt: it describes only the area that was added.');
    if (spec && !editable) notes.push(`${spec.label || spec.id} cannot run image edits; Edit will use ${activeSecondary || 'the active SDCPP model'}.`);
    return {
      version: 1,
      sourceImageId: r.imageId,
      op: op || 'img2img',
      recalledFrom: { imageId: r.imageId, recorded: !!r.recorded, missing: r.missing || [], sessionPrompt: !!(promptAvail && promptAvail.session) },
      sourceModel: p.target || null,
      editModel: editable ? p.target : (activeSecondary || null),
      params: {
        seed: p.seed != null ? p.seed : -1,
        width: p.width, height: p.height,
        steps: p.steps != null ? p.steps : EDIT_DEFAULTS.steps,
        cfg: p.cfg != null ? p.cfg : EDIT_DEFAULTS.cfg,
        sampler: p.sampler || EDIT_DEFAULTS.sampler,
        scheduler: p.scheduler || EDIT_DEFAULTS.scheduler,
        vae: p.vae || EDIT_DEFAULTS.vae,
        preset: p.preset || EDIT_DEFAULTS.preset,
        strength: EDIT_DEFAULTS.strength,
      },
      prompt: promptAvail.available ? promptAvail.text : '',
      negative: promptAvail.available ? (promptAvail.negative || '') : '',
      promptStatus: promptAvail.available ? { available: true, session: !!promptAvail.session } : { available: false, message: promptAvail.reason || 'Source prompt unavailable' },
      loras: normalizeLoras(loras),
      notes,
    };
  }

  // ── Mask / viewport geometry (all in SOURCE IMAGE pixels) ───────────────
  function fitScale(imgW, imgH, boxW, boxH) {
    if (!(imgW > 0 && imgH > 0 && boxW > 0 && boxH > 0)) return 1;
    return Math.min(boxW / imgW, boxH / imgH);
  }
  // view: { imgW, imgH, boxW, boxH, zoom (multiplier of fit, 1 = fit), panX, panY (screen px) }
  function viewScale(v) { return fitScale(v.imgW, v.imgH, v.boxW, v.boxH) * (v.zoom || 1); }
  function viewOrigin(v) {
    const s = viewScale(v);
    return { x: (v.boxW - v.imgW * s) / 2 + (v.panX || 0), y: (v.boxH - v.imgH * s) / 2 + (v.panY || 0), s };
  }
  function screenToImage(v, sx, sy) {
    const o = viewOrigin(v);
    return { x: (sx - o.x) / o.s, y: (sy - o.y) / o.s };
  }
  function imageToScreen(v, ix, iy) {
    const o = viewOrigin(v);
    return { x: ix * o.s + o.x, y: iy * o.s + o.y };
  }
  function clampPan(v) {
    const s = viewScale(v), w = v.imgW * s, h = v.imgH * s;
    const lim = (img, box, pan) => (img <= box ? 0 : Math.max(-(img - box) / 2, Math.min((img - box) / 2, pan)));
    return { ...v, panX: lim(w, v.boxW, v.panX || 0), panY: lim(h, v.boxH, v.panY || 0) };
  }
  // Zoom keeping the image point under (sx, sy) fixed. zoom is clamped to [1, maxZoom].
  function zoomAt(v, factor, sx, sy, maxZoom = 16) {
    const before = screenToImage(v, sx, sy);
    const zoom = Math.max(1, Math.min(maxZoom, (v.zoom || 1) * factor));
    let next = { ...v, zoom };
    const o = viewOrigin(next);
    // shift pan so `before` maps back onto (sx, sy)
    const dx = sx - (before.x * o.s + o.x), dy = sy - (before.y * o.s + o.y);
    next = { ...next, panX: (next.panX || 0) + dx, panY: (next.panY || 0) + dy };
    return clampPan(next);
  }
  function zoomTo100(v, sx, sy) { // actual pixels (1 image px = 1 CSS px)
    const fit = fitScale(v.imgW, v.imgH, v.boxW, v.boxH);
    const target = Math.max(1, 1 / fit);
    return zoomAt({ ...v, zoom: 1, panX: 0, panY: 0 }, target, sx == null ? v.boxW / 2 : sx, sy == null ? v.boxH / 2 : sy);
  }
  // Clamp a brush stroke point into the image; null if wholly outside by more than the radius.
  function clampToImage(p, imgW, imgH, radius = 0) {
    if (p.x < -radius || p.y < -radius || p.x > imgW + radius || p.y > imgH + radius) return null;
    return { x: Math.max(0, Math.min(imgW, p.x)), y: Math.max(0, Math.min(imgH, p.y)) };
  }

  // ── Truthful job stage/progress ─────────────────────────────────────────
  // sd-cli prints "  |=====>   | N/M - 5.2s/it" for sampling steps and
  // "N/M - 300MB/s" for weight loading. Only the former is a real step count.
  function parseSdProgress(text) {
    const t = String(text || '').replace(/\r/g, '\n');
    const lines = t.split('\n');
    let step = null, total = null, phase = null;
    for (const line of lines) {
      let m;
      if (/encode_first_stage/.test(line)) phase = phase === 'sampling' ? phase : 'encoding';
      if (/sampling using|target t_enc/.test(line) && !phase) phase = 'preparing';
      if ((m = /\|\s*(\d+)\/(\d+)\s*-\s*[\d.]+\s*(?:s\/it|it\/s)/.exec(line))) { step = Number(m[1]); total = Number(m[2]); phase = 'sampling'; }
      if (/sampling completed/.test(line)) { phase = 'decoding'; if (total) step = total; }
      if (/decode_first_stage completed|generate_image completed/.test(line)) phase = 'decoded';
    }
    return { phase, step, total, percent: step != null && total ? Math.round((step / total) * 100) : null };
  }
  const SCRIPT_STAGES = [
    [/=== Pre-flight verification ===/, 'preflight', 'Checking Big Mac and model'],
    [/=== Uploading init image to BigMac ===/, 'uploading', 'Uploading source image to Big Mac'],
    [/=== Uploading mask to BigMac ===/, 'uploading', 'Uploading mask to Big Mac'],
    [/=== Generating [^=]+ on BigMac/, 'generating', 'Generating on Big Mac'],
    [/=== Verifying remote PNG ===/, 'validating', 'Validating output on Big Mac'],
    [/=== Copying PNG to MacBook ===/, 'transferring', 'Transferring result to the MacBook'],
  ];
  // job: API-shaped { status, resource, stdout?, stderr?, firstFailedGate } plus
  // `sdLog` (tail of the sd-cli log) supplied by the server. Returns a stage view.
  function deriveStage(job, sdLog) {
    const j = job || {};
    const st = String(j.status || '').toLowerCase();
    if (st === 'pass' || st === 'partial' || st === 'done' || st === 'complete') return { key: 'complete', label: 'Complete', percent: 100, determinate: true };
    if (['fail', 'failed', 'error', 'cancelled', 'interrupted', 'lost'].includes(st)) return { key: 'failed', label: 'Failed' + (j.firstFailedGate ? ' at ' + j.firstFailedGate : ''), percent: null, determinate: false, gate: j.firstFailedGate || null };
    if (st === 'queued' || st === 'pending' || !st) {
      if (j.resource && j.resource.waiting) return { key: 'waiting-bigmac', label: 'Waiting for Big Mac' + (j.resource.blocked_reason ? ' — ' + j.resource.blocked_reason : ''), percent: null, determinate: false, position: j.resource.position };
      return { key: 'queued', label: 'Queued', percent: null, determinate: false };
    }
    // running
    const logs = String(j.stderr || '') + '\n' + String(j.stdout || '');
    let key = 'running', label = 'Running';
    for (const [re, k, l] of SCRIPT_STAGES) if (re.test(logs)) { key = k; label = l; }
    const sd = parseSdProgress(sdLog);
    if (key === 'generating' || key === 'running') {
      if (sd.phase === 'sampling' && sd.total) return { key: 'sampling', label: `Sampling step ${sd.step}/${sd.total}`, percent: sd.percent, determinate: true, step: sd.step, total: sd.total };
      if (sd.phase === 'decoding') return { key: 'decoding', label: 'Decoding image', percent: null, determinate: false };
      if (sd.phase === 'encoding' || sd.phase === 'preparing') return { key: 'preparing', label: 'Encoding source and loading model', percent: null, determinate: false };
    }
    return { key, label, percent: null, determinate: false };
  }

  // ── Model selector data ─────────────────────────────────────────────────
  const FAMILY_ORDER = ['flux', 'sdxl', 'pony', 'sd15', 'other'];
  const FAMILY_LABEL = { flux: 'FLUX', sdxl: 'SDXL', pony: 'Pony / SDXL', sd15: 'SD 1.5', other: 'Other' };
  function familyOf(t) {
    const f = String((t && (t.family || t.id)) || '').toLowerCase();
    if (f.includes('flux')) return 'flux';
    if (f.includes('pony')) return 'pony';
    if (f.includes('sdxl') || f.includes('xl')) return 'sdxl';
    if (f.includes('sd15') || f.includes('sd1.5') || f.includes('1-5')) return 'sd15';
    return 'other';
  }
  function readinessOf(t) {
    if (!t) return { key: 'unknown', label: 'Unknown', ok: false };
    if (t.runtime === 'model-missing') return { key: 'missing', label: 'Model missing', ok: false };
    if (t.runtime === 'dormant') return { key: 'dormant', label: 'Dormant', ok: false };
    const st = String(t.status || '').toLowerCase();
    if (['proofed', 'proven', 'verified_working', 'repaired_and_verified'].includes(st)) return { key: 'proven', label: 'Proven', ok: true };
    if (st === 'broken' || st === 'failed_unresolved') return { key: 'broken', label: 'Broken', ok: false };
    return { key: 'available', label: 'Available · unproven', ok: true };
  }
  // targets: capability targets; cards: model cards (optional, matched by id).
  // Returns { groups:[{family,label,items:[{id,label,family,readiness,blurb,primary,active}]}], total, shown }.
  function groupModels(targets, cards, { query = '', family = 'all', readyOnly = false, activeId = null } = {}) {
    const cardById = new Map((cards || []).map(c => [c.id, c]));
    const q = String(query || '').trim().toLowerCase();
    const items = (targets || []).map(t => {
      const c = cardById.get(t.id) || {};
      const fam = familyOf(c.family ? { family: c.family, id: t.id } : t);
      const readiness = readinessOf(t);
      const blurb = String(c.description || c.why_use || (t.backend === 'mflux' ? 'MFLUX engine' : 'stable-diffusion.cpp')).split(/(?<=[.!?])\s/)[0].slice(0, 110);
      return { id: t.id, label: t.label || c.display_name || t.id, family: fam, readiness, blurb, primary: !!t.primary, active: t.id === activeId, backend: t.backend || 'sdcpp',
        haystack: [t.id, t.label, c.display_name, c.description, (c.specialties || []).join(' '), (c.best_for || []).join(' ')].join(' ').toLowerCase() };
    });
    const shown = items.filter(i => (family === 'all' || i.family === family) && (!readyOnly || i.readiness.ok) && (!q || i.haystack.includes(q)));
    const groups = FAMILY_ORDER.map(f => ({ family: f, label: FAMILY_LABEL[f], items: shown.filter(i => i.family === f).sort((a, b) => (b.primary - a.primary) || (b.readiness.ok - a.readiness.ok) || a.label.localeCompare(b.label)) })).filter(g => g.items.length);
    return { groups, total: items.length, shown: shown.length, families: FAMILY_ORDER.filter(f => items.some(i => i.family === f)).map(f => ({ family: f, label: FAMILY_LABEL[f] })) };
  }

  // ── Presets / recipes (versioned) ───────────────────────────────────────
  const RECIPE_SCHEMA_VERSION = 2;
  const RECIPE_MODES = ['create', 'img2img', 'inpaint', 'outpaint'];
  const RECIPE_FIELDS_V2 = ['target', 'width', 'height', 'steps', 'cfg', 'sampler', 'scheduler', 'vae', 'preset', 'strength', 'quantity', 'seed'];
  // Accepts v0/v1 recipes (no `v`, no mode) and v2. Sensitive text only with savePrompts === true.
  function migrateRecipe(input, savePrompts) {
    const src = input || {};
    const out = { v: RECIPE_SCHEMA_VERSION, id: src.id ? String(src.id) : undefined, name: String(src.name || 'Recipe').slice(0, 80),
      mode: RECIPE_MODES.includes(src.mode) ? src.mode : 'create' };
    if (out.id === undefined) delete out.id;
    for (const k of RECIPE_FIELDS_V2) if (src[k] !== undefined && src[k] !== null && src[k] !== '') out[k] = src[k];
    const loras = normalizeLoras(src.loras);
    if (loras.length) out.loras = loras;
    if (out.mode === 'outpaint' && src.outpaint && typeof src.outpaint === 'object') {
      const o = {}; for (const k of ['left', 'right', 'top', 'bottom', 'strength']) if (Number.isFinite(Number(src.outpaint[k]))) o[k] = Number(src.outpaint[k]);
      out.outpaint = o;
    }
    if (savePrompts === true) {
      if (typeof src.prompt === 'string') out.prompt = src.prompt;
      const neg = src.negPrompt !== undefined ? src.negPrompt : src.negative;
      if (typeof neg === 'string') out.negPrompt = neg;
    }
    out.promptSaved = savePrompts === true && typeof src.prompt === 'string';
    return out;
  }
  function recipesForMode(list, mode) { return (Array.isArray(list) ? list : []).filter(r => (r.mode || 'create') === mode); }

  return {
    LORA_RE, parseLoraTags, stripLoraTags, normalizeLoras, serializeLoraTags, resolveResources, checkLoraCompat, formatWeight, clampWeight,
    canonicalSampler, RECALL_SCHEMA, buildRecall, snapshotFromRequest, applyRecallToEdit, EDIT_DEFAULTS,
    fitScale, viewScale, viewOrigin, screenToImage, imageToScreen, clampPan, zoomAt, zoomTo100, clampToImage,
    parseSdProgress, deriveStage,
    familyOf, readinessOf, groupModels, FAMILY_LABEL,
    RECIPE_SCHEMA_VERSION, RECIPE_MODES, migrateRecipe, recipesForMode,
  };
});
