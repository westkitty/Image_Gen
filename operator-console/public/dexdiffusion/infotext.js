// A1111 infotext ("PNG Info") parse / format and the mapping to DexDiffusion Create settings (P12).
// Pure; loaded by the browser (window.DexInfotext) and the server (require).
//
// Every parsed field is returned with a state so nothing is silently dropped:
//   restorable  - applied to the Create form by "Send to Create"
//   unavailable - understood, but this engine/UI cannot do it (reason says why)
//   unverified  - shown for information (e.g. a model hash that was not recomputed)
// Parser ported from A1111 modules/generation_parameters_copypaste.py (parse_generation_parameters) from knowledge;
// not diffed against the pinned commit.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DexInfotext = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Keys are bounded (A1111 keys are short): an unbounded key made a long colon-free line quadratic (80 KB took 11 s).
  const RE_PARAM = /\s*(\w[\w \-/]{0,60}):\s*("(?:\\.|[^\\"])+"|[^,]*)(?:,|$)/g;
  const MAX_INFOTEXT = 256 * 1024;
  const RE_IMAGESIZE = /^(\d+)x(\d+)$/;

  function unquote(v) {
    const s = String(v).trim();
    if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') { try { return JSON.parse(s); } catch (_) { return s.slice(1, -1); } }
    return s;
  }
  function pairs(line) {
    const out = []; let m; const re = new RegExp(RE_PARAM.source, 'g');
    while ((m = re.exec(line)) !== null) { out.push([m[1].trim(), unquote(m[2])]); if (re.lastIndex === m.index) re.lastIndex++; }
    return out;
  }

  // -> { prompt, negative, params: [[key, value]...], raw }
  function parseInfotext(text) {
    const raw = String(text == null ? '' : text).slice(0, MAX_INFOTEXT).replace(/\r\n?/g, '\n');
    const lines = raw.split('\n');
    let last = lines.length ? lines[lines.length - 1] : '';
    let kv = pairs(last);
    let body = lines;
    if (kv.length < 3) { kv = []; } else body = lines.slice(0, -1);
    let prompt = [], negative = [], inNeg = false;
    for (const line of body) {
      const t = line.trim();
      if (t.startsWith('Negative prompt:')) { inNeg = true; negative.push(t.slice('Negative prompt:'.length).trim()); continue; }
      (inNeg ? negative : prompt).push(line);
    }
    return { prompt: prompt.join('\n').trim(), negative: negative.join('\n').trim(), params: kv, raw };
  }

  // A1111 sampler names <-> console ids. "Karras"/"Exponential" suffixes are older single-field forms of the schedule.
  const SAMPLER_IN = {
    'euler a': 'euler_a', 'euler': 'euler', 'heun': 'heun', 'dpm2': 'dpm2', 'dpm2 a': 'dpm2_a', 'lms': 'lms',
    'dpm++ 2s a': 'dpmpp2s_a', 'dpm++ 2m': 'dpmpp2m', 'dpm++ 2m v2': 'dpmpp2mv2', 'lcm': 'lcm', 'ipndm': 'ipndm', 'ipndm-v': 'ipndm_v',
    'ddim trailing': 'ddim_trailing', 'tcd': 'tcd', 'res multistep': 'res_multistep', 'res 2s': 'res_2s', 'er sde': 'er_sde', 'euler cfg++': 'euler_cfg_pp', 'euler a cfg++': 'euler_a_cfg_pp',
  };
  const SAMPLER_OUT = { euler_a: 'Euler a', euler: 'Euler', heun: 'Heun', dpm2: 'DPM2', dpm2_a: 'DPM2 a', lms: 'LMS', dpmpp2s_a: 'DPM++ 2S a', dpmpp2m: 'DPM++ 2M', dpmpp2mv2: 'DPM++ 2M v2', lcm: 'LCM', ipndm: 'iPNDM', ipndm_v: 'iPNDM-v', ddim_trailing: 'DDIM trailing', tcd: 'TCD', res_multistep: 'RES multistep', res_2s: 'RES 2S', er_sde: 'ER SDE', euler_cfg_pp: 'Euler CFG++', euler_a_cfg_pp: 'Euler a CFG++' };
  const UNSUPPORTED_SAMPLERS = new Set(['ddim', 'plms', 'unipc', 'dpm fast', 'dpm adaptive', 'dpm++ sde', 'dpm++ 2m sde', 'dpm++ 3m sde']);
  const SCHEDULE_IN = { automatic: null, uniform: 'discrete', karras: 'karras', exponential: 'exponential', 'align your steps': 'ays', 'sgm uniform': 'sgm_uniform', simple: 'simple', 'kl optimal': 'kl_optimal' };
  const SCHEDULE_OUT = { discrete: 'Uniform', karras: 'Karras', exponential: 'Exponential', ays: 'Align Your Steps', sgm_uniform: 'SGM Uniform', simple: 'Simple', kl_optimal: 'KL Optimal' };

  // Fields A1111 writes that no installed engine can honour, with the reason (preserved, never dropped).
  const UNAVAILABLE = {
    'variation seed': 'variation seed is not supported by the installed sd-cli (P05)',
    'variation seed strength': 'variation seed is not supported by the installed sd-cli (P05)',
    'seed resize from': 'seed resize is not supported by the installed sd-cli (P05)',
    'face restoration': 'face restoration needs GFPGAN/CodeFormer, which are not installed (P09)',
    'denoising strength': 'strength only applies to Img2Img / Inpaint (use Edit) — Create ignores it unless Hires fix is on',
    'mask blur': 'inpaint settings are restored from Edit, not Create',
    'inpainting fill': 'inpaint settings are restored from Edit, not Create',
    'ensd': 'ENSD (eta noise seed delta) is not supported by the installed sd-cli (P05)',
    's churn': 'sigma churn is not supported by the installed sd-cli (P05)', 's tmin': 'sigma tmin is not supported by the installed sd-cli (P05)',
    's tmax': 'sigma tmax is not supported by the installed sd-cli (P05)', 's noise': 'sigma noise is not supported by the installed sd-cli (P05)',
    'refiner': 'refiner checkpoints are not supported by the installed sd-cli (P06)', 'refiner switch at': 'refiner checkpoints are not supported by the installed sd-cli (P06)',
    'hires checkpoint': 'a separate hires checkpoint is not supported by the installed sd-cli (P06)', 'hires sampler': 'a per-pass hires sampler is not supported by the installed sd-cli (P06)',
    'hires prompt': 'a per-pass hires prompt is not supported by the installed sd-cli (P06)', 'hires negative prompt': 'a per-pass hires prompt is not supported by the installed sd-cli (P06)',
    'controlnet 0': 'ControlNet is not available (no model installed)', 'noise multiplier': 'noise multiplier is not supported by the installed sd-cli',
    'token merging ratio': 'token merging is not supported by the installed sd-cli', 'tiling': null,
  };
  const INFO_ONLY = new Set(['version', 'model hash', 'lora hashes', 'ti hashes', 'hashes', 'vae hash', 'template', 'negative template', 'parser']);

  const num = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };

  // parsed: parseInfotext() result. ctx: { targets: [{id,label,filename?}], currentTarget }.
  function toCreateSettings(parsed, ctx) {
    const c = ctx || {}, fields = [], settings = {}, warnings = [];
    const add = (key, value, state, extra) => fields.push(Object.assign({ key, value, state }, extra || {}));
    const kv = new Map(parsed.params.map(([k, v]) => [k.toLowerCase(), v]));
    if (parsed.prompt) { settings.prompt = parsed.prompt; add('Prompt', parsed.prompt, 'restorable'); }
    if (parsed.negative) { settings.negPrompt = parsed.negative; add('Negative prompt', parsed.negative, 'restorable'); }
    let scheduleFromSampler = null;
    for (const [key, value] of parsed.params) {
      const k = key.toLowerCase();
      if (k === 'steps') { const n = num(value); n && Number.isInteger(n) ? (settings.steps = n, add(key, value, 'restorable')) : add(key, value, 'unavailable', { reason: 'not a whole number' }); }
      else if (k === 'cfg scale') { const n = num(value); n !== null ? (settings.cfg = n, add(key, value, 'restorable')) : add(key, value, 'unavailable', { reason: 'not a number' }); }
      else if (k === 'seed') { const n = num(value); n !== null && Number.isInteger(n) ? (settings.seed = n, add(key, value, 'restorable')) : add(key, value, 'unavailable', { reason: 'not a whole number' }); }
      else if (k === 'size') { const m = RE_IMAGESIZE.exec(String(value).trim()); m ? (settings.width = +m[1], settings.height = +m[2], add(key, value, 'restorable')) : add(key, value, 'unavailable', { reason: 'expected WIDTHxHEIGHT' }); }
      else if (k === 'clip skip') { const n = num(value); n && Number.isInteger(n) ? (settings.clipSkip = n, add(key, value, 'restorable')) : add(key, value, 'unavailable', { reason: 'not a whole number' }); }
      else if (k === 'eta') { const n = num(value); n !== null ? (settings.eta = n, add(key, value, 'restorable')) : add(key, value, 'unavailable', { reason: 'not a number' }); }
      else if (k === 'sampler') {
        let name = String(value).trim().toLowerCase(), sched = null;
        const sm = /^(.*?)\s+(karras|exponential)$/.exec(name);
        if (sm && !parsed.params.some(([kk]) => kk.toLowerCase() === 'schedule type')) { name = sm[1]; sched = sm[2] === 'karras' ? 'karras' : 'exponential'; }
        if (SAMPLER_IN[name]) { settings.sampler = SAMPLER_IN[name]; add(key, value, 'restorable'); if (sched) scheduleFromSampler = sched; }
        else add(key, value, 'unavailable', { reason: UNSUPPORTED_SAMPLERS.has(name) ? `"${value}" is a stock A1111 sampler the installed sd-cli does not provide` : `"${value}" is not a sampler this console knows` });
      }
      else if (k === 'schedule type') {
        const s = SCHEDULE_IN[String(value).trim().toLowerCase()];
        if (s === null) add(key, value, 'restorable', { note: 'Automatic: the console default is kept' });
        else if (s) { settings.scheduler = s; add(key, value, 'restorable'); }
        else add(key, value, 'unavailable', { reason: `schedule type "${value}" is not available` });
      }
      else if (k === 'model') {
        const want = String(value).trim().toLowerCase().replace(/\.(safetensors|ckpt)$/, '');
        const t = (c.targets || []).find(x => [x.id, x.label, x.filename, x.modelFile].filter(Boolean).some(n => String(n).toLowerCase().replace(/\.(safetensors|ckpt)$/, '') === want));
        if (t) { settings.target = t.id; add(key, value, 'restorable', { note: `matches ${t.label || t.id}` }); }
        else { add(key, value, 'unverified', { reason: 'no installed target has this name' }); warnings.push(`Model "${value}" is not an installed target; the current model is kept.`); }
      }
      else if (k === 'hires upscale') { const n = num(value); n ? (settings.hires = Object.assign(settings.hires || {}, { scale: n }), add(key, value, 'restorable')) : add(key, value, 'unavailable', { reason: 'not a number' }); }
      else if (k === 'hires steps') { const n = num(value); n !== null ? (settings.hires = Object.assign(settings.hires || {}, { steps: n }), add(key, value, 'restorable')) : add(key, value, 'unavailable', { reason: 'not a number' }); }
      else if (k === 'hires upscaler') { settings.hires = Object.assign(settings.hires || {}, { upscaler: value }); add(key, value, 'restorable'); }
      else if (k === 'hires resize') { const m = RE_IMAGESIZE.exec(String(value).trim()); m ? (settings.hires = Object.assign(settings.hires || {}, { width: +m[1], height: +m[2] }), add(key, value, 'restorable')) : add(key, value, 'unavailable', { reason: 'expected WIDTHxHEIGHT' }); }
      else if (INFO_ONLY.has(k)) add(key, value, 'unverified', { reason: k.endsWith('hash') || k === 'hashes' ? 'hashes are not recomputed here' : 'informational' });
      else if (k in UNAVAILABLE && UNAVAILABLE[k]) add(key, value, 'unavailable', { reason: UNAVAILABLE[k] });
      else add(key, value, 'unavailable', { reason: 'not a setting this console uses' });
    }
    // Hires denoise is the same A1111 key as img2img strength: only meaningful here when hires fields are present.
    if (settings.hires && kv.has('denoising strength')) {
      const n = num(kv.get('denoising strength'));
      if (n !== null) { settings.hires.denoise = n; const f = fields.find(x => x.key.toLowerCase() === 'denoising strength'); if (f) { f.state = 'restorable'; delete f.reason; f.note = 'applied as the Hires fix denoise'; } }
    }
    if (scheduleFromSampler && !settings.scheduler) settings.scheduler = scheduleFromSampler;
    return { fields, settings, warnings };
  }

  // meta: stored image meta (+ width/height). Returns A1111-style infotext. Prompt lines are included only when given.
  function formatInfotext(meta, opts) {
    const m = meta || {}, o = opts || {};
    const lines = [];
    if (o.prompt) lines.push(o.prompt);
    if (o.negative) lines.push('Negative prompt: ' + o.negative);
    const p = [];
    const q = v => (/[,:\n"]/.test(String(v)) ? JSON.stringify(String(v)) : String(v));
    if (m.steps != null) p.push('Steps: ' + m.steps);
    if (m.sampler) p.push('Sampler: ' + (SAMPLER_OUT[m.sampler] || m.sampler));
    if (m.scheduler && SCHEDULE_OUT[m.scheduler]) p.push('Schedule type: ' + SCHEDULE_OUT[m.scheduler]);
    if (m.cfg != null && m.cfg !== '') p.push('CFG scale: ' + m.cfg);
    if (m.seed != null && m.seed !== '') p.push('Seed: ' + m.seed);
    if (m.width && m.height) p.push(`Size: ${m.width}x${m.height}`);
    if (o.modelName) p.push('Model: ' + q(o.modelName));
    if (m.clip_skip != null && m.clip_skip !== '') p.push('Clip skip: ' + m.clip_skip);
    if (m.eta != null && m.eta !== '') p.push('Eta: ' + m.eta);
    if (m.hires) {
      const h = m.hires;
      if (h.denoise != null) p.push('Denoising strength: ' + h.denoise);
      if (h.scale != null) p.push('Hires upscale: ' + h.scale);
      if (h.width && h.height) p.push(`Hires resize: ${h.width}x${h.height}`);
      if (h.steps) p.push('Hires steps: ' + h.steps);
      if (h.upscaler) p.push('Hires upscaler: ' + q(h.upscaler));
    }
    if (m.operation === 'img2img' || m.operation === 'inpaint') { if (m.strength != null) p.push('Denoising strength: ' + m.strength); }
    p.push('Version: ' + (o.version || 'DexDiffusion'));
    lines.push(p.join(', '));
    return lines.join('\n');
  }

  return { parseInfotext, toCreateSettings, formatInfotext, SAMPLER_IN, SAMPLER_OUT };
});
