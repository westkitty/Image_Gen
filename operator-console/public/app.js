'use strict';

const state = { capabilities: null, runs: [], lastJob: null, lastParams: null, lastSeed: '', activeImage: null, poller: null, modelInventory: null, controlledTargets: [], controlledTargetMap: {}, libraryFilter: 'all', libraryIndex: [], libraryOffset: 0, libraryHasMore: false, libraryLoading: false, libraryCompareIds: [], lastComparisonRows: [], hiddenSections: new Set() };
const $ = id => document.getElementById(id);
const $$ = sel => Array.from(document.querySelectorAll(sel));
const esc = value => String(value ?? '').replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));

const DEFAULT_PRESETS = {
  smoke: { steps: 1, cfg_scale: 7, sampler: 'euler_a', width: 512, height: 512 },
  thumbnail: { steps: 4, cfg_scale: 7, sampler: 'euler_a', width: 384, height: 384 },
  fast: { steps: 8, cfg_scale: 7, sampler: 'euler_a', width: 512, height: 512 },
  balanced: { steps: 16, cfg_scale: 7, sampler: 'euler_a', width: 512, height: 512 },
  quality: { steps: 20, cfg_scale: 7, sampler: 'euler_a', width: 512, height: 512 },
  quality_plus: { steps: 30, cfg_scale: 7, sampler: 'euler_a', width: 512, height: 512 }
};
const ASPECTS = [
  ['1:1', 512, 512], ['Portrait', 512, 768], ['Landscape', 768, 512], ['Wide', 1024, 576], ['Tall', 576, 1024], ['HD', 1024, 1024]
];
const PROMPT_DRAFT_KEY = 'createPromptDraft';
const HIDDEN_SECTIONS_KEY = 'hiddenCreateSections';
const OLLAMA_MODEL_KEY = 'ollamaSelectedModel';
const SECTION_TOGGLES = [
  ['settings-json', 'Settings JSON'],
  ['controlled-sweep', 'Sweep planner'],
  ['preview-json', 'Preview JSON'],
  ['ollama-chat', 'Ollama chat'],
  ['seed-variation', 'Seed & variation'],
  ['hires-faces-tiling', 'Hires / faces / tiling'],
  ['backend-routing', 'Backend routing'],
  ['system-gates', 'Capability gates'],
  ['job-log', 'Job log']
];

const FALLBACK_CONTROLLED_TARGETS = [
  { id: 'sd15', label: 'SD1.5 standard', status: 'supported', mode: 'existing supported txt2img', caveat: 'Normal supported generation path. Full Automatic1111 parity is still not claimed.', defaultWidth: 512, defaultHeight: 512, defaultSteps: 20, defaultCfgScale: 7, defaultSampler: 'euler_a', minSteps: 1, maxSteps: 150, maxWidth: 2048, maxHeight: 2048 },
  { id: 'sdxl-base', label: 'SDXL base', status: 'proofed', mode: 'proofed controlled generation', caveat: 'Controlled proofed path; not full A1111 parity.', defaultWidth: 512, defaultHeight: 512, defaultSteps: 4, defaultCfgScale: 7, defaultSampler: 'euler_a', minSteps: 1, maxSteps: 8, maxWidth: 1024, maxHeight: 1024 },
  { id: 'sdxl-turbo', label: 'SDXL Turbo', status: 'proofed', mode: 'proofed controlled generation', caveat: 'Controlled proofed path; not full A1111 parity.', defaultWidth: 512, defaultHeight: 512, defaultSteps: 4, defaultCfgScale: 0, defaultSampler: 'euler_a', minSteps: 1, maxSteps: 4, maxWidth: 1024, maxHeight: 1024 },
  { id: 'flux-fp8', label: 'Flux fp8', status: 'proofed', mode: 'proofed controlled generation', caveat: 'Controlled proofed path; not full A1111 parity. Uses the fp8 runtime-proven Flux file, not the full Flux file.', defaultWidth: 512, defaultHeight: 512, defaultSteps: 4, defaultCfgScale: 3.5, defaultSampler: 'euler', minSteps: 1, maxSteps: 8, maxWidth: 1024, maxHeight: 1024 },
  { id: 'sdxl-photonic', label: 'Photonic Fusion SDXL', status: 'staged', mode: 'migrated controlled generation', caveat: 'Migrated wc2tb SDXL checkpoint.', defaultWidth: 1024, defaultHeight: 1024, defaultSteps: 10, defaultCfgScale: 6.5, defaultSampler: 'dpm++2m', minSteps: 1, maxSteps: 150, maxWidth: 2048, maxHeight: 2048 },
  { id: 'sdxl-homochi', label: 'Homochi XL v2', status: 'staged', mode: 'migrated controlled generation', caveat: 'Migrated wc2tb SDXL checkpoint.', defaultWidth: 1024, defaultHeight: 1024, defaultSteps: 10, defaultCfgScale: 6.5, defaultSampler: 'dpm++2m', minSteps: 1, maxSteps: 150, maxWidth: 2048, maxHeight: 2048 },
  { id: 'sdxl-pony', label: 'Pony Diffusion V6 XL', status: 'staged', mode: 'migrated controlled generation', caveat: 'Migrated wc2tb SDXL checkpoint.', defaultWidth: 1024, defaultHeight: 1024, defaultSteps: 10, defaultCfgScale: 6.5, defaultSampler: 'dpm++2m', minSteps: 1, maxSteps: 150, maxWidth: 2048, maxHeight: 2048 },
  { id: 'sd15-homofidelis', label: 'HomoFidelis v5', status: 'staged', mode: 'migrated controlled generation', caveat: 'Migrated wc2tb SD1.5 checkpoint.', defaultWidth: 512, defaultHeight: 512, defaultSteps: 20, defaultCfgScale: 7, defaultSampler: 'euler_a', minSteps: 1, maxSteps: 150, maxWidth: 1024, maxHeight: 1024 }
];

function setPill(id, label, kind = '') {
  const pill = $(id);
  if (!pill) return;
  pill.className = `status-pill ${kind}`;
  const strong = pill.querySelector('strong');
  if (strong) strong.textContent = label;
}
function notifyLog(text) { $('job-log').textContent = text || 'No log.'; }
function saveBool(key, value) { localStorage.setItem(key, value ? 'true' : 'false'); }
function loadBool(key) { return localStorage.getItem(key) === 'true'; }
function savePromptDraft() {
  const draft = {
    prompt: $('prompt') ? $('prompt').value : '',
    negative_prompt: $('negative_prompt') ? $('negative_prompt').value : '',
    savedAt: new Date().toISOString()
  };
  localStorage.setItem(PROMPT_DRAFT_KEY, JSON.stringify(draft));
}
function loadPromptDraft(showNote = false) {
  let draft = null;
  try { draft = JSON.parse(localStorage.getItem(PROMPT_DRAFT_KEY) || 'null'); } catch (_) {}
  if (!draft || typeof draft !== 'object') {
    if (showNote) showCreateNote('No saved prompt draft found.', 'privacy');
    return false;
  }
  if ($('prompt')) {
    $('prompt').value = draft.prompt || '';
    $('prompt').dispatchEvent(new Event('input'));
  }
  if ($('negative_prompt')) {
    $('negative_prompt').value = draft.negative_prompt || '';
    $('negative_prompt').dispatchEvent(new Event('input'));
  }
  if (showNote) showCreateNote('Reloaded previous prompt draft.', '');
  return true;
}
function getSelectedOllamaModel() {
  const manual = $('ollama-model-manual') ? $('ollama-model-manual').value.trim() : '';
  if (manual) return manual;
  return $('ollama-model') ? $('ollama-model').value : '';
}
function saveSelectedOllamaModel() {
  const model = getSelectedOllamaModel();
  if (model) localStorage.setItem(OLLAMA_MODEL_KEY, model);
  else localStorage.removeItem(OLLAMA_MODEL_KEY);
}
function getControlledTargets() {
  return (state.capabilities && state.capabilities.modelTargets && state.capabilities.modelTargets.length)
    ? state.capabilities.modelTargets
    : FALLBACK_CONTROLLED_TARGETS;
}
function getControlledTargetSpec(targetId) {
  return state.controlledTargetMap[targetId] || getControlledTargets().find(t => t.id === targetId) || FALLBACK_CONTROLLED_TARGETS[0];
}
function renderControlledTargetCaveat(targetId) {
  const caveat = $('target-caveat');
  if (!caveat) return;
  const spec = getControlledTargetSpec(targetId);
  caveat.textContent = spec && spec.caveat ? spec.caveat : 'Controlled proofed path; not full A1111 parity.';
}
function applyControlledTargetDefaults(targetId) {
  const spec = getControlledTargetSpec(targetId);
  if (!spec) return;
  $('preset').value = 'Custom';
  if (spec.defaultSteps !== undefined) $('steps').value = spec.defaultSteps;
  if (spec.defaultCfgScale !== undefined) $('cfg_scale').value = spec.defaultCfgScale;
  if (spec.defaultSampler) $('sampler').value = spec.defaultSampler;
  if (spec.defaultWidth !== undefined) $('width').value = spec.defaultWidth;
  if (spec.defaultHeight !== undefined) $('height').value = spec.defaultHeight;
  renderControlledTargetCaveat(targetId);
}

async function api(path, options = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  if (!res.ok) {
    const body = json && json.error ? json.error : (json && json.raw ? json.raw : text);
    const excerpt = String(body || res.statusText || 'Request failed').slice(0, 500);
    throw new Error(`${res.status} ${res.statusText}: ${excerpt}`);
  }
  return json;
}

async function loadCapabilities() {
  try {
    state.capabilities = await api('/api/capabilities');
    await loadModelInventory();
    hydrateControls();
    renderFeatureGates();
    renderModels();
    renderSystemGates();
    setPill('pill-backend', 'Ready', 'ok');
  } catch (err) {
    setPill('pill-backend', 'Error', 'bad');
    notifyLog(err.message);
  }
}

async function loadModelInventory() {
  try {
    const inv = await api('/api/model-inventory');
    state.modelInventory = inv.summary ? { ...inv.summary, ...inv } : inv;
  } catch (err) {
    if (String(err.message || '').includes('Not Found')) {
      state.modelInventory = {
        present: false,
        stale: true,
        missing: true,
        endpointMissing: true,
        model_volume: 'wc2tb',
        model_volume_path: '/Volumes/wc2tb',
        external_root: '/Volumes/wc2tb/ImageGen',
        recommended_next_step: 'Inventory endpoint missing from the running server; restart the local operator console.'
      };
      return;
    }
    throw err;
  }
}

function renderSystemGates() {
  const el = $('system-gates');
  if (!el) return;
  const gates = (state.capabilities && state.capabilities.featureGates) || {};
  const groups = { supported: [], partial: [], gated: [] };
  const labels = {
    txt2img: 'txt2img', batch: 'Batch', xyzPlot: 'X/Y/Z Plot', server: 'Server lifecycle',
    gallery: 'Gallery', metadataReuse: 'Metadata reuse', pngInfo: 'PNG Info',
    discoverAssets: 'Discover assets', probeImageEdit: 'Probe img2img', probeUpscale: 'Probe upscale',
    pillowUpscale: 'Pillow Upscale', img2img: 'img2img', inpaint: 'Inpaint', outpaint: 'Outpaint',
    upscale: 'Upscale (AI/Extras)', hiresFix: 'Hires Fix', faceRestore: 'Face Restore',
    sdxlTurbo: 'SDXL Turbo', flux: 'Flux', sdxl: 'SDXL',
    lora: 'LoRA', textualInversion: 'Textual Inversion', hypernetworks: 'Hypernetworks'
  };
  for (const [key, gate] of Object.entries(gates)) {
    const s = gate.supported;
    const label = labels[key] || key;
    const route = gate.route ? ' · ' + gate.route : '';
    const reason = gate.reason || gate.caveat || '';
    if (s === true) groups.supported.push({ label, route, reason });
    else if (s === 'partial') groups.partial.push({ label, route, reason });
    else groups.gated.push({ label, route, reason });
  }
  const renderGroup = (title, items, cls) =>
    items.length ? '<div class="model-card"><h3 style="margin:0 0 6px">' + title + '</h3>' +
      items.map(i => '<div style="margin:3px 0"><span class="' + cls + '">' + esc(i.label) + '</span>' +
        (i.route ? '<span class="muted" style="font-size:11px"> ' + esc(i.route) + '</span>' : '') +
        (i.reason ? '<br><span class="fineprint" style="font-size:11px">' + esc(i.reason) + '</span>' : '') +
        '</div>').join('') + '</div>' : '';
  el.innerHTML =
    renderGroup('✓ Supported', groups.supported, 'derived-badge') +
    renderGroup('⚡ Partial', groups.partial, 'gate') +
    renderGroup('✗ Gated / not wired', groups.gated, 'muted');
}

function hydrateControls() {
  const caps = state.capabilities || {};
  const presets = caps.presets || DEFAULT_PRESETS;
  $('preset').innerHTML = Object.keys(presets).map(id => `<option value="${esc(id)}">${esc(id.replace('_', '+'))}</option>`).join('') + '<option value="Custom">Custom</option>';
  $('preset').value = 'quality';
  state.controlledTargets = getControlledTargets();
  state.controlledTargetMap = Object.fromEntries(state.controlledTargets.map(t => [t.id, t]));
  const modelOptions = state.controlledTargets.map(t => `<option value="${esc(t.id)}">${esc(t.label)}${t.status ? ` — ${esc(t.status)}` : ''}</option>`).join('');
  $('model').innerHTML = modelOptions || '<option value="sd15">SD1.5 standard</option>';
  $('vae').innerHTML = (caps.vaes || []).map(v => {
    const ok = v.id === 'auto' || v.status === 'available';
    return `<option value="${esc(v.id)}" ${ok ? '' : 'disabled'}>${esc(v.name)}${ok ? '' : ` — disabled (${esc(v.reason || 'Not supported')})`}</option>`;
  }).join('') || '<option value="auto">Auto</option>';
  $('sampler').innerHTML = (caps.samplers || []).map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
  $('scheduler').innerHTML = (caps.schedulers || []).map(s => `<option value="${esc(s.id)}" ${s.supported ? '' : 'disabled'}>${esc(s.name)}${s.supported ? '' : ` — disabled (${esc(s.reason)})`}</option>`).join('');
  hydrateEditGenerationControls(caps);
  const loraGate = (caps.featureGates && caps.featureGates.lora) || {};
  const loras = (caps.networks && caps.networks.loras) || [];
  const loraEnabled = loraGate.supported === true && loras.length > 0;
  if ($('lora-select')) {
    const loraOpts = '<option value="">— none —</option>' +
      loras.map(l => { const base = l.filename ? l.filename.replace(/\.(safetensors|ckpt|pt|bin)$/i, '') : l.id; return `<option value="${esc(base)}">${esc(base)}</option>`; }).join('');
    $('lora-select').innerHTML = loraOpts;
    $('lora-select').disabled = !loraEnabled;
  }
  if ($('lora-weight')) $('lora-weight').disabled = !loraEnabled;
  if ($('btn-insert-lora')) $('btn-insert-lora').disabled = !loraEnabled;
  if ($('lora-status')) $('lora-status').textContent = !loraGate.supported ? (loraGate.reason || 'LoRA not supported.') : loras.length === 0 ? 'No LoRAs discovered — run Discover Assets.' : `${loras.length} LoRA${loras.length !== 1 ? 's' : ''} available.`;
  const img2imgGate = (caps.featureGates && caps.featureGates.img2img) || {};
  const img2imgEnabled = img2imgGate.supported === true;
  const img2imgReason = img2imgEnabled ? '' : (img2imgGate.reason || 'img2img not yet supported.');
  ['img2img-run', 'img2img-image', 'img2img-strength', 'img2img-prompt', 'img2img-negative', 'img2img-steps', 'img2img-cfg-scale', 'img2img-seed', 'img2img-width', 'img2img-height', 'img2img-vae', 'img2img-sampler', 'img2img-scheduler', 'btn-img2img-preview', 'btn-img2img-submit'].forEach(id => {
    if ($(id)) $(id).disabled = !img2imgEnabled;
  });
  if ($('img2img-gate-reason')) $('img2img-gate-reason').textContent = img2imgEnabled ? '' : img2imgReason;
  const inpaintGate = (caps.featureGates && caps.featureGates.inpaint) || {};
  const inpaintEnabled = inpaintGate.supported === true;
  const inpaintReason = inpaintEnabled ? '' : (inpaintGate.reason || 'Inpaint not yet supported.');
  ['inpaint-run', 'inpaint-image', 'inpaint-strength', 'inpaint-prompt', 'inpaint-negative', 'inpaint-steps', 'inpaint-cfg-scale', 'inpaint-seed', 'inpaint-width', 'inpaint-height', 'inpaint-vae', 'inpaint-sampler', 'inpaint-scheduler', 'btn-inpaint-preview', 'btn-inpaint-submit'].forEach(id => {
    if ($(id)) $(id).disabled = !inpaintEnabled;
  });
  if ($('inpaint-gate-reason')) $('inpaint-gate-reason').textContent = inpaintEnabled ? '' : inpaintReason;
  const esrganGate = (caps.featureGates && caps.featureGates.realEsrgan) || {};
  const esrganEnabled = esrganGate.supported === true;
  const esrganReason = esrganEnabled ? (esrganGate.caveat || '') : (esrganGate.reason || 'Real-ESRGAN not yet enabled.');
  ['esrgan-run', 'esrgan-image', 'esrgan-tile-size', 'esrgan-repeats', 'btn-esrgan-submit'].forEach(id => {
    if ($(id)) $(id).disabled = !esrganEnabled;
  });
  if ($('esrgan-gate-reason')) $('esrgan-gate-reason').textContent = esrganReason;
  $('aspect-presets').innerHTML = ASPECTS.map(([label, w, h]) => `<button type="button" class="ghost small" data-size="${w}x${h}">${label} ${w}×${h}</button>`).join('');
  $('set-save-prompts').checked = loadBool('savePrompts');
  applyPreset('quality');
  const selectedTarget = $('model').value || 'sd15';
  applyControlledTargetDefaults(selectedTarget);
  loadStyles();
}

function hydrateEditGenerationControls(caps) {
  const vaeHtml = (caps.vaes || []).map(v => {
    const ok = v.id === 'auto' || v.status === 'available';
    return `<option value="${esc(v.id)}" ${ok ? '' : 'disabled'}>${esc(v.name)}${ok ? '' : ` — disabled (${esc(v.reason || 'Not supported')})`}</option>`;
  }).join('') || '<option value="auto">Auto</option>';
  const samplerHtml = (caps.samplers || []).map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
  const schedulerHtml = (caps.schedulers || []).map(s => `<option value="${esc(s.id)}" ${s.supported ? '' : 'disabled'}>${esc(s.name)}${s.supported ? '' : ` — disabled (${esc(s.reason)})`}</option>`).join('');
  ['img2img', 'inpaint'].forEach(prefix => {
    if ($(prefix + '-vae')) $(prefix + '-vae').innerHTML = vaeHtml;
    if ($(prefix + '-sampler')) $(prefix + '-sampler').innerHTML = samplerHtml;
    if ($(prefix + '-scheduler')) $(prefix + '-scheduler').innerHTML = schedulerHtml;
    if ($(prefix + '-vae')) $(prefix + '-vae').value = 'auto';
    if ($(prefix + '-sampler')) $(prefix + '-sampler').value = 'euler_a';
    if ($(prefix + '-scheduler')) $(prefix + '-scheduler').value = 'discrete';
  });
}

function applyPreset(id) {
  const preset = (state.capabilities && state.capabilities.presets && state.capabilities.presets[id]) || DEFAULT_PRESETS[id];
  if (!preset) return;
  $('steps').value = preset.steps;
  $('cfg_scale').value = preset.cfg_scale;
  $('sampler').value = preset.sampler;
  $('width').value = preset.width;
  $('height').value = preset.height;
}

function getCoreParams(source = '') {
  const prefix = source ? `${source}_` : '';
  return {
    prompt: $(prefix + 'prompt') ? $(prefix + 'prompt').value.trim() : $('prompt').value.trim(),
    negative_prompt: $(prefix + 'negative') ? $(prefix + 'negative').value.trim() : $('negative_prompt').value.trim(),
    preset: $('preset').value,
    target: $('model').value,
    model: $('model').value,
    vae: $('vae').value,
    steps: $('steps').value,
    cfg_scale: $('cfg_scale').value,
    sampler: $('sampler').value,
    scheduler: $('scheduler').value,
    width: $('width').value,
    height: $('height').value,
    seed: $('seed').value.trim(),
    mode: $('mode').value,
    api: $('api').value,
    clip_skip: $('clip_skip').value,
    tiling: $('tiling').checked,
    save_prompts: $('set-save-prompts').checked,
    quantity: $('quantity') ? Number($('quantity').value) : 1
  };
}

function getEditGenerationParams(kind) {
  return {
    steps: $(kind + '-steps') ? $(kind + '-steps').value : '20',
    cfg_scale: $(kind + '-cfg-scale') ? $(kind + '-cfg-scale').value : '7',
    sampler: $(kind + '-sampler') ? $(kind + '-sampler').value : 'euler_a',
    scheduler: $(kind + '-scheduler') ? $(kind + '-scheduler').value : 'discrete',
    width: $(kind + '-width') ? $(kind + '-width').value : '512',
    height: $(kind + '-height') ? $(kind + '-height').value : '512',
    seed: $(kind + '-seed') ? $(kind + '-seed').value.trim() : '',
    vae: $(kind + '-vae') ? $(kind + '-vae').value : 'auto'
  };
}

async function previewGenerationCommand(kind) {
  const runId = $(kind + '-run') && $(kind + '-run').value;
  const initImageFile = $(kind + '-image') && $(kind + '-image').value;
  const prompt = $(kind + '-prompt') && $(kind + '-prompt').value.trim();
  const negative_prompt = $(kind + '-negative') && $(kind + '-negative').value.trim();
  const strength = parseFloat($(kind + '-strength').value) || 0.75;
  const out = $(kind + '-preview');
  if (!out) return;
  if (!prompt) { out.hidden = false; out.textContent = 'Prompt is required for preview.'; return; }
  const body = {
    job_type: kind,
    run_id: runId || undefined,
    init_image_file: initImageFile || undefined,
    strength,
    prompt,
    negative_prompt,
    save_prompts: loadBool('savePrompts'),
    ...getEditGenerationParams(kind)
  };
  try {
    const result = await api('/api/preview/generation', { method: 'POST', body: JSON.stringify(body) });
    out.hidden = false;
    out.textContent = JSON.stringify({
      command: result.preview.command,
      argv: result.preview.argv,
      normalized: result.normalized,
      compatibility: result.compatibility && {
        family: result.compatibility.family,
        warnings: result.compatibility.compatibility_warnings || []
      }
    }, null, 2);
  } catch (err) {
    out.hidden = false;
    out.textContent = 'Preview error: ' + err.message;
  }
}

async function previewCreateCommand() {
  const out = $('create-debug-preview');
  if (!out) return;
  const params = { ...getCoreParams(), job_type: 'txt2img' };
  if (!params.prompt) { out.hidden = false; out.textContent = 'Prompt is required for preview.'; return; }
  try {
    const result = await api('/api/preview/generation', { method: 'POST', body: JSON.stringify(params) });
    out.hidden = false;
    out.textContent = JSON.stringify({
      command: result.preview.command,
      argv: result.preview.argv,
      normalized: result.normalized,
      compatibility: result.compatibility && {
        family: result.compatibility.family,
        warnings: result.compatibility.compatibility_warnings || []
      }
    }, null, 2);
  } catch (err) {
    out.hidden = false;
    out.textContent = 'Preview error: ' + err.message;
  }
}

function setPreviewProgress(label = 'Rendering image') {
  $('preview-stage').innerHTML = `
    <div class="render-progress" role="status" aria-live="polite">
      <div class="render-progress-label">${esc(label)}</div>
      <div class="render-progress-detail" id="preview-progress-detail">Current render: estimating...</div>
      <div class="render-progress-bar" role="progressbar" aria-label="Current render progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span></span></div>
    </div>`;
  $('preview-subtitle').textContent = 'Generation in progress.';
}
function parseRunFileUrl(url) {
  try {
    const parsed = new URL(url, window.location.origin);
    if (!parsed.pathname.endsWith('/api/run-file')) return null;
    return parsed.searchParams.get('path');
  } catch (_) {
    return null;
  }
}
function setPreviewImage(url, title = 'Selected image', imgPath = '', runId = '', filename = '') {
  const inferredPath = imgPath || parseRunFileUrl(url) || '';
  const inferredFile = filename || (inferredPath ? inferredPath.split('/').pop() : title);
  const inferredRun = runId || (inferredPath.includes('/') ? inferredPath.split('/')[0] : '');
  state.activeImage = url;
  $('preview-stage').innerHTML = `<img src="${esc(url)}" alt="${esc(title)}" title="Click to enlarge · Right-click for options" />`;
  $('preview-subtitle').textContent = title;
  const img = $('preview-stage').querySelector('img');
  if (img) {
    img.style.cursor = 'zoom-in';
    img.dataset.ctxPath = inferredPath;
    img.dataset.ctxRun = inferredRun;
    img.dataset.ctxFile = inferredFile;
    img.addEventListener('click', () => openImageViewer(inferredPath, inferredRun, inferredFile));
  }
}
function setPreviewMessage(message) { $('preview-stage').innerHTML = `<div class="empty-state">${esc(message)}</div>`; }

async function submitCreate(event) {
  event.preventDefault();
  const params = getCoreParams();
  params.target = $('model').value;
  state.lastParams = params;
  try {
    const result = await api('/api/actions/generate-controlled', { method: 'POST', body: JSON.stringify(params) });
    const target = getControlledTargetSpec(params.target);
    trackJob(result.job_id, `Generating ${target.label || params.target}…`);
  } catch (err) {
    setPill('pill-job', 'Failed', 'bad');
    setPreviewMessage('Render did not start: ' + err.message);
    notifyLog(err.message);
  }
}
async function submitBatch(event) {
  event.preventDefault();
  const params = getCoreParams('batch');
  params.count = $('batch_count').value;
  params.seedMode = $('seedMode').value;
  params.seedStart = $('seedStart').value.trim();
  try {
    const result = await api('/api/actions/generate-batch', { method: 'POST', body: JSON.stringify(params) });
    trackJob(result.job_id, 'Running batch…');
  } catch (err) { notifyLog(err.message); }
}

async function trackJob(jobId, label) {
  state.lastJob = jobId;
  setPill('pill-job', 'Running', 'run');
  setPreviewProgress(label);
  $('latest-job').innerHTML = renderJobProgress(label, 'queued');
  clearInterval(state.poller);
  state.poller = setInterval(() => pollJob(jobId), 1200);
  await pollJob(jobId);
}
function formatProgressLabel(progress) {
  if (!progress) return 'Current render: estimating...';
  const current = progress.currentRun || 1;
  const total = progress.totalRuns || 1;
  const left = progress.runsLeft != null ? progress.runsLeft : Math.max(0, total - (progress.completedRuns || 0));
  const currentPercent = Math.round(progress.currentRunPercent || 0);
  const totalPercent = Math.round(progress.totalPercent || 0);
  return `Render ${current}/${total} · ${left} left · current ${currentPercent}% · order ${totalPercent}%`;
}
function renderProgressBar(percent, label, className = 'job-progress') {
  const safePercent = Math.max(0, Math.min(100, Math.round(percent || 0)));
  return `<div class="${className} determinate" role="progressbar" aria-label="${esc(label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${safePercent}"><span style="width:${safePercent}%"></span></div>`;
}
function renderJobProgress(label, status, progress = null) {
  const progressLabel = formatProgressLabel(progress);
  const currentPercent = progress ? progress.currentRunPercent : 0;
  const totalPercent = progress ? progress.totalPercent : 0;
  return `<strong>${esc(label || 'Rendering image')}</strong><br>Status: ${esc(status || 'running')}<div class="job-progress-copy">${esc(progressLabel)}</div>${renderProgressBar(currentPercent, 'Current render progress')}${progress && progress.totalRuns > 1 ? renderProgressBar(totalPercent, 'Total order progress', 'job-progress order-progress') : ''}`;
}
async function pollJob(jobId) {
  try {
    const job = await api(`/api/jobs/${jobId}`);
    const log = await api(`/api/jobs/${jobId}/log`);
    notifyLog([log.stdout, log.stderr].filter(Boolean).join('\n\n'));
    const targetLine = job.controlledTarget ? `<br>Target: ${esc(job.controlledTarget)}` : '';
    const outputLine = job.controlledOutputImage ? `<br>Output: ${esc(job.controlledOutputImage)}` : '';
    const progress = (job.status === 'running' || job.status === 'queued')
      ? renderJobProgress(job.commandAction, job.status, job.progress)
      : '';
    if (progress) {
      $('latest-job').innerHTML = `${progress}${targetLine}${outputLine}${job.runId ? `<br>Run: ${esc(job.runId)}` : ''}`;
      const detail = $('preview-progress-detail');
      if (detail) detail.textContent = formatProgressLabel(job.progress);
      const previewBar = $('preview-stage').querySelector('.render-progress-bar');
      const previewFill = previewBar && previewBar.querySelector('span');
      const currentPercent = job.progress ? Math.round(job.progress.currentRunPercent || 0) : 0;
      if (previewBar) previewBar.setAttribute('aria-valuenow', String(currentPercent));
      if (previewFill) previewFill.style.width = currentPercent + '%';
    } else {
      $('latest-job').innerHTML = `<strong>${esc(job.commandAction)}</strong><br>Status: ${esc(job.status)}${targetLine}${outputLine}${job.runId ? `<br>Run: ${esc(job.runId)}` : ''}`;
    }
    if (job.status !== 'running' && job.status !== 'queued') {
      clearInterval(state.poller);
      setPill('pill-job', job.status, job.status === 'PASS' ? 'ok' : job.status === 'PARTIAL' ? 'run' : 'bad');
      setPill('pill-latest', job.status, job.status === 'PASS' ? 'ok' : 'bad');
      if (job.runId) await loadRunIntoPreview(job.runId);
      await loadGallery(true);
      if (job.status === 'FAIL' || job.status === 'ERROR') {
        setPreviewMessage('Render failed. Check the job log for the first failed gate.');
        const gateNote = job.firstFailedGate ? `<br><small>First failed gate: ${esc(job.firstFailedGate)}</small>` : '';
        const retryHtml = state.lastParams ? ' <button type="button" class="ghost small" id="btn-retry-job">Retry</button>' : '';
        $('latest-job').innerHTML += gateNote + retryHtml;
        const retryBtn = $('btn-retry-job');
        if (retryBtn) retryBtn.addEventListener('click', async () => {
          if (!state.lastParams) return;
          retryBtn.disabled = true;
          try {
            const result = await api('/api/actions/generate-controlled', { method: 'POST', body: JSON.stringify(state.lastParams) });
            const target = getControlledTargetSpec(state.lastParams.target);
            trackJob(result.job_id, `Retrying ${target.label || state.lastParams.target}…`);
          } catch (err) { notifyLog(err.message); retryBtn.disabled = false; }
        });
      }
    }
  } catch (err) { notifyLog(err.message); }
}
async function loadRunIntoPreview(runId) {
  try {
    const detail = await api(`/api/runs/${runId}`);
    const image = detail.images && detail.images[0];
    if (image) setPreviewImage(`/api/run-file?path=${encodeURIComponent(`${runId}/${image}`)}`, `Run ${runId}`, `${runId}/${image}`, runId, image);
  } catch (_) {}
}

function renderFeatureGates() {
  const gates = (state.capabilities && state.capabilities.featureGates) || {};
  const editFeatures = [
    ['img2img', 'Image to Image', 'Upload an input image, set denoising strength, then regenerate.'],
    ['inpaint', 'Inpaint', 'Mask editor, upload-mask mode, masked content, inpaint area.'],
    ['outpaint', 'Outpaint', 'Extend canvas edges and inpaint the new regions.']
  ];
  const enhanceFeatures = [
    ['faceRestore', 'Face Restore', 'GFPGAN/CodeFormer-style restoration.'],
    ['pngInfo', 'PNG Info', 'Recover generation parameters from image metadata.']
  ];
  $('edit-gates').innerHTML = editFeatures.map(f => featureCard(f, gates[f[0]])).join('');
  $('enhance-gates').innerHTML = enhanceFeatures.map(f => featureCard(f, gates[f[0]])).join('');
}
function featureCard([id, title, desc], gate = {}) {
  const supported = gate && gate.supported === true;
  const partial = gate && gate.supported === 'partial';
  const badgeCls = supported ? 'badge-ok' : partial ? 'badge-partial' : 'badge-blocked';
  const badgeLabel = supported ? 'Available' : partial ? 'Partial' : 'Blocked';
  const unlockHtml = (!supported && !partial && gate.unlock_requires)
    ? `<div class="unlock-needs"><strong>To unlock:</strong> ${esc(gate.unlock_requires)}</div>` : '';
  return `<article class="feature-card"><h3>${esc(title)}</h3><p>${esc(desc)}</p><span class="badge ${badgeCls}">${badgeLabel}</span><p class="fineprint">${esc(gate.reason || gate.caveat || 'Ready.')}</p>${unlockHtml}</article>`;
}

// ---- img2img -----------------------------------------------------------------
async function loadEditRuns() {
  const sel = $('img2img-run');
  const ipSel = $('inpaint-run');
  if (!sel && !ipSel) return;
  try {
    const data = await api('/api/runs');
    const imageRuns = (data.runs || []).filter(r => r.images && r.images.length > 0);
    const opts = imageRuns.length
      ? '<option value="">Choose a run…</option>' + imageRuns.map(r => '<option value="' + esc(r.id) + '">' + esc(r.id) + ' (' + r.images.length + ' image' + (r.images.length > 1 ? 's' : '') + ')</option>').join('')
      : '<option value="">No image runs found</option>';
    if (sel) sel.innerHTML = opts;
    if (ipSel) ipSel.innerHTML = opts;
  } catch (_) {
    if (sel) sel.innerHTML = '<option value="">Error loading runs</option>';
    if (ipSel) ipSel.innerHTML = '<option value="">Error loading runs</option>';
  }
}

async function onImg2imgRunChange() {
  const runId = $('img2img-run') && $('img2img-run').value;
  const imgSel = $('img2img-image');
  if (!runId || !imgSel) { if (imgSel) imgSel.innerHTML = '<option value="">Select a run first</option>'; return; }
  try {
    const detail = await api('/api/runs/' + encodeURIComponent(runId));
    const images = (detail.images || []).filter(f => f.endsWith('.png'));
    imgSel.innerHTML = images.length
      ? images.map(f => '<option value="' + esc(f) + '">' + esc(f) + '</option>').join('')
      : '<option value="">No PNG images in this run</option>';
  } catch (_) { imgSel.innerHTML = '<option value="">Error loading images</option>'; }
}

async function submitImg2img(event) {
  event.preventDefault();
  const runId = $('img2img-run') && $('img2img-run').value;
  const initImageFile = $('img2img-image') && $('img2img-image').value;
  if (!runId || !initImageFile) { notifyLog('Select a run and image first.'); return; }
  const strength = parseFloat($('img2img-strength').value) || 0.75;
  const prompt = $('img2img-prompt').value.trim();
  const negative_prompt = $('img2img-negative').value.trim();
  if (!prompt) { notifyLog('Prompt is required for img2img.'); return; }
  const save_prompts = loadBool('savePrompts');
  const generationParams = getEditGenerationParams('img2img');
  try {
    const result = await api('/api/actions/img2img', {
      method: 'POST',
      body: JSON.stringify({ run_id: runId, init_image_file: initImageFile, strength, prompt, negative_prompt, save_prompts, ...generationParams })
    });
    notifyLog('img2img job started: ' + result.job_id);
    trackJob(result.job_id, 'img2img');
  } catch (err) { notifyLog('img2img error: ' + err.message); }
}

// ---- Inpaint -----------------------------------------------------------------
const inpaintState = { ctx: null, painting: false, mode: 'paint', brushSize: 20 };

function initInpaintCanvas() {
  const canvas = $('inpaint-mask-canvas');
  if (!canvas) return;
  inpaintState.ctx = canvas.getContext('2d');
  canvas.addEventListener('mousedown', e => { inpaintState.painting = true; inpaintDraw(e); });
  canvas.addEventListener('mousemove', e => { if (inpaintState.painting) inpaintDraw(e); });
  canvas.addEventListener('mouseup', () => { inpaintState.painting = false; });
  canvas.addEventListener('mouseleave', () => { inpaintState.painting = false; });
  canvas.addEventListener('touchstart', e => { e.preventDefault(); inpaintState.painting = true; inpaintDraw(e.touches[0]); }, { passive: false });
  canvas.addEventListener('touchmove', e => { e.preventDefault(); if (inpaintState.painting) inpaintDraw(e.touches[0]); }, { passive: false });
  canvas.addEventListener('touchend', () => { inpaintState.painting = false; });
  $('inpaint-brush-size').addEventListener('input', e => {
    inpaintState.brushSize = Number(e.target.value);
    if ($('inpaint-brush-val')) $('inpaint-brush-val').textContent = e.target.value;
  });
  $('inpaint-mode-paint').addEventListener('change', () => { inpaintState.mode = 'paint'; });
  $('inpaint-mode-erase').addEventListener('change', () => { inpaintState.mode = 'erase'; });
  $('btn-inpaint-clear').addEventListener('click', clearInpaintMask);
  $('btn-inpaint-invert').addEventListener('click', invertInpaintMask);
}

function inpaintDraw(event) {
  const canvas = $('inpaint-mask-canvas');
  const ctx = inpaintState.ctx;
  if (!canvas || !ctx || canvas.hidden) return;
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const x = (event.clientX - rect.left) * scaleX;
  const y = (event.clientY - rect.top) * scaleY;
  const r = (inpaintState.brushSize / 2) * Math.max(scaleX, scaleY);
  ctx.globalCompositeOperation = inpaintState.mode === 'erase' ? 'destination-out' : 'source-over';
  ctx.fillStyle = 'rgba(255,255,255,1)';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function clearInpaintMask() {
  const canvas = $('inpaint-mask-canvas');
  if (!canvas || !inpaintState.ctx) return;
  inpaintState.ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function invertInpaintMask() {
  const canvas = $('inpaint-mask-canvas');
  const ctx = inpaintState.ctx;
  if (!canvas || !ctx) return;
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = imgData.data;
  for (let i = 0; i < d.length; i += 4) {
    const isOpaque = d[i + 3] > 0;
    d[i] = 255; d[i + 1] = 255; d[i + 2] = 255;
    d[i + 3] = isOpaque ? 0 : 255;
  }
  ctx.putImageData(imgData, 0, 0);
}

function loadInpaintSourceImage(url) {
  const img = new window.Image();
  img.onload = () => {
    const canvas = $('inpaint-mask-canvas');
    if (!canvas) return;
    canvas.width = img.naturalWidth || 512;
    canvas.height = img.naturalHeight || 512;
    if (!inpaintState.ctx) inpaintState.ctx = canvas.getContext('2d');
    inpaintState.ctx.clearRect(0, 0, canvas.width, canvas.height);
    const preview = $('inpaint-source-preview');
    if (preview) { preview.src = url; preview.style.display = 'block'; }
    const ph = $('inpaint-canvas-placeholder');
    if (ph) ph.hidden = true;
    canvas.hidden = false;
  };
  img.src = url;
}

async function onInpaintRunChange() {
  const runId = $('inpaint-run') && $('inpaint-run').value;
  const imgSel = $('inpaint-image');
  if (!runId || !imgSel) {
    if (imgSel) imgSel.innerHTML = '<option value="">Select a run first</option>';
    return;
  }
  try {
    const detail = await api('/api/runs/' + encodeURIComponent(runId));
    const images = (detail.images || []).filter(f => f.endsWith('.png'));
    imgSel.innerHTML = images.length
      ? images.map(f => '<option value="' + esc(f) + '">' + esc(f) + '</option>').join('')
      : '<option value="">No PNG images in this run</option>';
    if (images.length) onInpaintImageChange();
  } catch (_) { imgSel.innerHTML = '<option value="">Error loading images</option>'; }
}

function onInpaintImageChange() {
  const runId = $('inpaint-run') && $('inpaint-run').value;
  const file = $('inpaint-image') && $('inpaint-image').value;
  if (runId && file) {
    const url = '/api/run-file?path=' + encodeURIComponent(runId + '/' + file);
    loadInpaintSourceImage(url);
  }
}

async function submitInpaint(event) {
  event.preventDefault();
  const runId = $('inpaint-run') && $('inpaint-run').value;
  const initImageFile = $('inpaint-image') && $('inpaint-image').value;
  if (!runId || !initImageFile) { notifyLog('Select a run and image first.'); return; }
  const canvas = $('inpaint-mask-canvas');
  if (!canvas || !canvas.width || canvas.hidden) { notifyLog('Load a source image first.'); return; }
  const ctx = inpaintState.ctx || canvas.getContext('2d');
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const hasContent = Array.from(imgData.data).some((v, i) => (i + 1) % 4 === 0 && v > 0);
  if (!hasContent) { notifyLog('Paint a mask on the image before running inpaint.'); return; }
  const maskData = canvas.toDataURL('image/png');
  const strength = parseFloat($('inpaint-strength').value) || 0.75;
  const prompt = $('inpaint-prompt').value.trim();
  const negative_prompt = $('inpaint-negative').value.trim();
  if (!prompt) { notifyLog('Prompt is required for inpaint.'); return; }
  const save_prompts = loadBool('savePrompts');
  const generationParams = getEditGenerationParams('inpaint');
  try {
    const result = await api('/api/actions/inpaint', {
      method: 'POST',
      body: JSON.stringify({ run_id: runId, init_image_file: initImageFile, mask_data: maskData, strength, prompt, negative_prompt, save_prompts, ...generationParams })
    });
    notifyLog('Inpaint job started: ' + result.job_id);
    const resultDiv = $('inpaint-result');
    if (resultDiv) { resultDiv.style.display = 'block'; resultDiv.textContent = 'Inpaint job running…'; }
    trackJob(result.job_id, 'Inpaint');
  } catch (err) { notifyLog('Inpaint error: ' + err.message); }
}

function sendToInpaint(runId, image) {
  showScreen('edit');
  loadEditRuns().then(() => {
    const runSel = $('inpaint-run');
    if (runSel) {
      runSel.value = runId;
      onInpaintRunChange().then(() => {
        if (image) {
          const imgSel = $('inpaint-image');
          if (imgSel) { imgSel.value = image; onInpaintImageChange(); }
        }
      });
    }
  });
}

// ---- Pillow Upscale ----------------------------------------------------------
async function loadEnhanceRuns() {
  const sel = $('upscale-run');
  try {
    const data = await api('/api/runs');
    const imageRuns = (data.runs || []).filter(r => r.images && r.images.length > 0);
    if (!imageRuns.length) {
      sel.innerHTML = '<option value="">No image runs found</option>';
      return;
    }
    sel.innerHTML = '<option value="">Choose a run…</option>' +
      imageRuns.map(r => '<option value="' + esc(r.id) + '">' + esc(r.id) + ' (' + r.images.length + ' image' + (r.images.length > 1 ? 's' : '') + ')</option>').join('');
  } catch (_) {
    sel.innerHTML = '<option value="">Error loading runs</option>';
  }
}

async function onUpscaleRunChange() {
  const runId = $('upscale-run').value;
  const imgSel = $('upscale-image');
  if (!runId) { imgSel.innerHTML = '<option value="">Select a run first</option>'; return; }
  try {
    const detail = await api('/api/runs/' + encodeURIComponent(runId));
    const images = (detail.images || []).filter(f => !f.startsWith('upscaled/'));
    imgSel.innerHTML = images.length
      ? images.map(f => '<option value="' + esc(f) + '">' + esc(f) + '</option>').join('')
      : '<option value="">No PNG images in this run</option>';
  } catch (_) {
    imgSel.innerHTML = '<option value="">Error loading images</option>';
  }
}

async function submitUpscale(event) {
  event.preventDefault();
  const runId = $('upscale-run').value;
  const image = $('upscale-image').value;
  if (!runId || !image) { $('upscale-result').textContent = 'Select a run and image first.'; return; }
  const scale = Number($('upscale-scale').value);
  const resample = $('upscale-resample').value;
  const overwrite = $('upscale-overwrite').checked;
  $('upscale-result').textContent = 'Submitting upscale job…';
  try {
    const result = await api('/api/actions/upscale', {
      method: 'POST',
      body: JSON.stringify({ runId, image, scale, resample, overwrite })
    });
    trackUpscaleJob(result.job_id);
  } catch (err) {
    $('upscale-result').textContent = 'Error: ' + err.message;
  }
}

function trackUpscaleJob(jobId) {
  $('upscale-result').textContent = 'Upscale running…';
  const poller = setInterval(async () => {
    try {
      const job = await api('/api/jobs/' + jobId);
      if (job.status === 'running' || job.status === 'queued') return;
      clearInterval(poller);
      if (job.status === 'PASS' && job.upscaledImage) {
        $('upscale-result').textContent = 'PASS — ' + job.upscaledImage;
        const imgUrl = '/api/run-file?path=' + encodeURIComponent(job.upscaledImage);
        const parts = job.upscaledImage.split('/');
        setPreviewImage(imgUrl, 'Upscaled: ' + job.upscaledImage, job.upscaledImage, parts[0], parts.slice(1).join('/'));
        await loadGallery(true);
      } else {
        $('upscale-result').textContent = job.status + (job.firstFailedGate ? ' — gate: ' + job.firstFailedGate : '');
      }
    } catch (err) {
      clearInterval(poller);
      $('upscale-result').textContent = 'Poll error: ' + err.message;
    }
  }, 1200);
}

function sendToUpscale(runId, image) {
  showScreen('enhance');
  loadEnhanceRuns().then(() => {
    $('upscale-run').value = runId;
    onUpscaleRunChange().then(() => {
      if (image) $('upscale-image').value = image;
    });
  });
}

function sendToImg2img(runId, image) {
  showScreen('edit');
  loadEditRuns().then(() => {
    const sel = $('img2img-run');
    if (sel) {
      sel.value = runId;
      onImg2imgRunChange().then(() => {
        if (image) { const imgSel = $('img2img-image'); if (imgSel) imgSel.value = image; }
      });
    }
  });
}

// ---- Real-ESRGAN Upscale --------------------------------------------------------
async function loadEsrganRuns() {
  const sel = $('esrgan-run');
  if (!sel) return;
  try {
    const data = await api('/api/runs');
    const imageRuns = (data.runs || []).filter(r => r.images && r.images.length > 0);
    if (!imageRuns.length) { sel.innerHTML = '<option value="">No image runs found</option>'; return; }
    sel.innerHTML = '<option value="">Choose a run…</option>' +
      imageRuns.map(r => '<option value="' + esc(r.id) + '">' + esc(r.id) + ' (' + r.images.length + ' image' + (r.images.length > 1 ? 's' : '') + ')</option>').join('');
  } catch (_) {
    sel.innerHTML = '<option value="">Error loading runs</option>';
  }
}

async function onEsrganRunChange() {
  const runId = $('esrgan-run') && $('esrgan-run').value;
  const imgSel = $('esrgan-image');
  if (!runId || !imgSel) { if (imgSel) imgSel.innerHTML = '<option value="">Select a run first</option>'; return; }
  try {
    const detail = await api('/api/runs/' + encodeURIComponent(runId));
    const images = (detail.images || []).filter(f => f.toLowerCase().endsWith('.png'));
    imgSel.innerHTML = images.length
      ? images.map(f => '<option value="' + esc(f) + '">' + esc(f) + '</option>').join('')
      : '<option value="">No PNG images in this run</option>';
  } catch (_) {
    imgSel.innerHTML = '<option value="">Error loading images</option>';
  }
}

async function submitEsrgan(event) {
  event.preventDefault();
  const runId = $('esrgan-run') && $('esrgan-run').value;
  const initImageFile = $('esrgan-image') && $('esrgan-image').value;
  if (!runId || !initImageFile) { notifyLog('Select a run and image first.'); return; }
  const tileSize = parseInt($('esrgan-tile-size').value, 10);
  const repeats = parseInt($('esrgan-repeats').value, 10);
  $('esrgan-result').textContent = 'Submitting…';
  try {
    const result = await api('/api/actions/upscale-esrgan', {
      method: 'POST',
      body: JSON.stringify({ run_id: runId, init_image_file: initImageFile, tile_size: tileSize, repeats })
    });
    $('esrgan-result').textContent = 'Job queued: ' + result.job_id;
    trackJob(result.job_id, 'Real-ESRGAN upscale');
  } catch (err) {
    $('esrgan-result').textContent = 'Error: ' + err.message;
  }
}

// ---- Hires Fix ---------------------------------------------------------------
async function submitHiresFix(event) {
  event.preventDefault();
  const prompt = $('hf-prompt').value.trim();
  if (!prompt) { $('hf-result').textContent = 'Prompt is required.'; return; }
  const preset = $('hf-preset').value;
  const scale = Number($('hf-scale').value);
  const resample = $('hf-resample').value;
  const seed = $('hf-seed').value.trim();
  const body = { prompt, preset, scale, resample };
  if (seed) body.seed = Number(seed);
  $('hf-result').textContent = 'Submitting Hires Fix job…';
  $('btn-hf-submit').disabled = true;
  try {
    const result = await api('/api/actions/hires-fix', { method: 'POST', body: JSON.stringify(body) });
    trackHiresFixJob(result.job_id);
  } catch (err) {
    $('hf-result').textContent = 'Error: ' + err.message;
    $('btn-hf-submit').disabled = false;
  }
}

function trackHiresFixJob(jobId) {
  $('hf-result').textContent = 'Hires Fix running (two passes)…';
  const poller = setInterval(async () => {
    try {
      const job = await api('/api/jobs/' + jobId);
      if (job.status === 'running' || job.status === 'queued') return;
      clearInterval(poller);
      $('btn-hf-submit').disabled = false;
      if (job.status === 'PASS' && job.hiresFinalImage) {
        $('hf-result').textContent = 'PASS — ' + job.hiresFinalImage;
        const imgUrl = '/api/run-file?path=' + encodeURIComponent(job.hiresFinalImage);
        const prev = $('hf-preview');
        prev.innerHTML = '<img src="' + esc(imgUrl) + '" alt="Hires Fix result" style="max-width:100%;border-radius:12px;margin-top:8px" />';
        await loadGallery(true);
      } else {
        $('hf-result').textContent = job.status + (job.firstFailedGate ? ' — gate: ' + job.firstFailedGate : '');
      }
    } catch (err) {
      clearInterval(poller);
      $('btn-hf-submit').disabled = false;
      $('hf-result').textContent = 'Poll error: ' + err.message;
    }
  }, 1500);
}

function renderModels() {
  const caps = state.capabilities || {};
  state.modelInventory = caps.modelInventory || state.modelInventory;
  $('model-list').innerHTML = (caps.models || []).map(m =>
    '<div class="model-card"><h3>' + esc(m.name) + '</h3><p>' + esc(m.filename || '') + '</p><span class="badge">' + esc(m.status || 'unknown') + '</span></div>'
  ).join('') || '<div class="muted fineprint">No checkpoints in cache. Run asset discovery.</div>';

  const gates = caps.featureGates || {};
  const items = [['lora','LoRA'],['textualInversion','Textual Inversion'],['hypernetworks','Hypernetworks'],['vae','VAE switching']];
  $('network-list').innerHTML = items.map(([id, label]) =>
    '<div class="model-card"><h3>' + esc(label) + '</h3><p>' + esc((gates[id] && gates[id].reason) || 'Visible for parity; backend missing.') + '</p><span class="badge">' + (gates[id] && gates[id].supported ? 'Available' : 'Not wired') + '</span></div>'
  ).join('');

  // Asset cache status
  const ac = caps.assetCache || {};
  const net = caps.networks || {};
  const statusEl = $('asset-cache-status');
  const countsEl = $('asset-counts');
  if (statusEl) {
    if (!ac.present) {
      statusEl.textContent = 'Asset cache: not present — click "Discover assets" to scan BigMac staging dirs.';
    } else {
      const age = ac.cacheAgeMinutes !== null ? ac.cacheAgeMinutes + ' min ago' : 'unknown age';
      statusEl.textContent = 'Asset cache: fresh · last updated ' + age + (ac.discoveredAt ? ' (' + ac.discoveredAt.slice(0, 10) + ')' : '');
    }
  }
  if (countsEl) {
    const lc = (net.loras || []).length;
    const ec = (net.embeddings || []).length;
    const hc = (net.hypernetworks || []).length;
    countsEl.innerHTML =
      '<h3 style="margin:0 0 6px">Discovered counts</h3>' +
      '<p style="margin:0">LoRAs: ' + lc + ' &nbsp;·&nbsp; Embeddings: ' + ec + ' &nbsp;·&nbsp; Hypernetworks: ' + hc + '</p>' +
      '<p class="fineprint" style="margin:4px 0 0">Injection bridge not yet implemented. Counts are visibility only.</p>';
  }

  const stageEl = $('model-stage-status');
  if (stageEl) {
    const stage = caps.modelStage || {};
    const root = stage.external_root || '/Volumes/wc2tb/ImageGen';
    const status = !stage.present ? 'Missing cache' : stage.supportProven ? 'Smoke proven' : 'Staged check only';
    const sdxlState = stage.sdxlStagedState || (stage.sdxlStaged ? 'true' : 'missing');
    const turboState = stage.sdxlTurboStagedState || (stage.sdxlTurboStaged ? 'true' : 'missing');
    const fluxState = stage.fluxStagedState || (stage.fluxStaged ? 'true' : 'missing');
    const sdxlProofState = stage.sdxlSmokeProven ? 'bounded smoke proof passed' : (sdxlState === 'true' ? 'smoke proof required' : 'missing');
    const turboProofState = stage.sdxlTurboSmokeProven ? 'bounded smoke proof passed' : (turboState === 'true' ? 'smoke proof required' : 'missing or placeholder-only');
    const fluxProofState = stage.fluxSmokeProven ? 'bounded smoke proof passed' : (fluxState === 'true' ? 'smoke proof required' : fluxState === 'partial' ? 'partial; CLIP-L/T5XXL missing unless CLI proves embedded path' : 'missing or incomplete');
    const bits = [
      ['External root', root],
      ['Last checked', stage.checked_at || 'never'],
      ['SDXL Turbo', turboState === 'true' ? `staged; ${turboProofState}` : 'missing or placeholder-only'],
      ['Flux', fluxState === 'true' ? `component set staged; ${fluxProofState}` : fluxState === 'partial' ? 'partial; CLIP-L/T5XXL missing unless CLI proves embedded path' : 'missing or incomplete'],
      ['SDXL', sdxlState === 'true' ? `staged; ${sdxlProofState}` : 'missing'],
      ['wc2tb write test', stage.write_test || 'unknown'],
      ['Invalid candidates', String(stage.invalidCandidateCount || 0)],
      ['Next', stage.recommended_next_step || 'Run Check BigMac model stage after staging files.']
    ];
    stageEl.innerHTML =
      '<h3 style="margin:0 0 6px">SDXL Turbo / Flux staging</h3>' +
      '<p class="fineprint" style="margin:0 0 8px">' + esc(status) + '</p>' +
      bits.map(([k, v]) => '<div class="fineprint"><strong>' + esc(k) + ':</strong> ' + esc(v) + '</div>').join('') +
      '<div class="fineprint" style="margin-top:8px"><strong>SDXL Turbo file:</strong> sd_xl_turbo_1.0_fp16.safetensors</div>' +
      '<div class="fineprint"><strong>Ignore:</strong> 0B q6p/q8p Turbo placeholders</div>' +
      '<div class="fineprint"><strong>Flux files:</strong> diffusion/model, ae.safetensors, CLIP-L candidate, T5XXL candidate</div>' +
      '<div class="fineprint">Flux GGUF/quantized variants are accepted if stable-diffusion.cpp supports their flags on BigMac.</div>' +
      '<div class="fineprint" style="margin-top:8px"><strong>Docs:</strong> operator-console/docs/model-staging-sdxl-turbo-flux.md</div>';
  }

  const invEl = $('model-inventory-status');
  if (invEl) {
    const inv = caps.modelInventory || state.modelInventory || {};
    const status = inv.endpointMissing ? 'Inventory endpoint missing' : !inv.present ? 'Inventory cache missing' : inv.stale ? 'Inventory stale' : 'Inventory cached';
    const root = inv.external_root || '/Volumes/wc2tb/ImageGen';
    invEl.innerHTML =
      '<h3 style="margin:0 0 6px">Inventory / move plan</h3>' +
      '<p class="fineprint" style="margin:0 0 8px">' + esc(status) + '</p>' +
      '<div class="fineprint"><strong>Root:</strong> ' + esc(root) + '</div>' +
      '<div class="fineprint"><strong>Total candidates:</strong> ' + esc(inv.total_candidates || 0) + '</div>' +
      '<div class="fineprint"><strong>High confidence:</strong> ' + esc(inv.high_confidence_candidates || 0) + '</div>' +
      '<div class="fineprint"><strong>Moved:</strong> ' + esc(inv.moved_count || 0) + ' · <strong>Duplicate skips:</strong> ' + esc(inv.duplicate_skip_count || inv.duplicate_count || 0) + ' · <strong>Missing-source skips:</strong> ' + esc(inv.missing_source_skip_count || 0) + ' · <strong>Collisions:</strong> ' + esc(inv.collision_count || 0) + '</div>' +
      '<div class="fineprint"><strong>Manual review:</strong> ' + esc(inv.manual_review_count || 0) + ' · <strong>Skipped:</strong> ' + esc(inv.skipped_count || 0) + '</div>' +
      '<div class="fineprint" style="margin-top:8px">Moves are conservative. Unknown files require manual review.</div>' +
      '<div class="fineprint" style="margin-top:8px"><strong>Remaining high-confidence outside root:</strong> ' + esc(inv.remaining_high_confidence_outside_root || 0) + ' · <strong>Still actionable:</strong> ' + esc(inv.still_actionable_high_confidence_count || 0) + '</div>' +
      '<div class="fineprint"><strong>Next:</strong> ' + esc(inv.recommended_next_step || 'Run the inventory action again after review.') + '</div>' +
      '<div class="fineprint" style="margin-top:8px"><strong>Inventory:</strong> ' + esc(inv.inventory_path || 'not yet written') + '</div>' +
      '<div class="fineprint"><strong>Plan:</strong> ' + esc(inv.plan_path || 'not yet written') + '</div>' +
      '<div class="fineprint"><strong>Result:</strong> ' + esc(inv.result_path || 'not yet written') + '</div>' +
      (Array.isArray(inv.remaining_high_confidence_preview) && inv.remaining_high_confidence_preview.length
        ? '<div class="fineprint" style="margin-top:8px"><strong>High-confidence preview:</strong> ' + esc(inv.remaining_high_confidence_preview.slice(0, 6).join(' · ')) + '</div>'
        : '') +
      (Array.isArray(inv.still_actionable_high_confidence_preview) && inv.still_actionable_high_confidence_preview.length
        ? '<div class="fineprint"><strong>Still actionable preview:</strong> ' + esc(inv.still_actionable_high_confidence_preview.slice(0, 6).join(' · ')) + '</div>'
        : '') +
      (Array.isArray(inv.manual_review_preview) && inv.manual_review_preview.length
        ? '<div class="fineprint"><strong>Manual-review preview:</strong> ' + esc(inv.manual_review_preview.slice(0, 6).join(' · ')) + '</div>'
        : '') +
      (Array.isArray(inv.duplicate_skip_preview) && inv.duplicate_skip_preview.length
        ? '<div class="fineprint"><strong>Duplicate skips:</strong> ' + esc(inv.duplicate_skip_preview.slice(0, 4).join(' · ')) + '</div>'
        : '') +
      (Array.isArray(inv.missing_source_preview) && inv.missing_source_preview.length
        ? '<div class="fineprint"><strong>Missing sources:</strong> ' + esc(inv.missing_source_preview.slice(0, 4).join(' · ')) + '</div>'
        : '');
  }
}

async function runDiscoverAssets() {
  const btn = $('btn-discover-assets');
  if (btn) btn.disabled = true;
  try {
    const result = await api('/api/actions/discover-assets', { method: 'POST', body: '{}' });
    trackJob(result.job_id, 'Discovering assets…');
    // After job completes, reload capabilities to refresh counts
    const poller = setInterval(async () => {
      try {
        const job = await api('/api/jobs/' + result.job_id);
        if (job.status !== 'running' && job.status !== 'queued') {
          clearInterval(poller);
          await loadCapabilities();
          if (btn) btn.disabled = false;
        }
      } catch (_) { clearInterval(poller); if (btn) btn.disabled = false; }
    }, 1500);
  } catch (err) {
    notifyLog('Discover assets error: ' + err.message);
    if (btn) btn.disabled = false;
  }
}

async function runModelInventory() {
  const btn = $('btn-inventory-models');
  if (btn) btn.disabled = true;
  try {
    const result = await api('/api/actions/inventory-models', { method: 'POST', body: '{}' });
    trackJob(result.job_id, 'Inventorying wc2tb models…');
    const poller = setInterval(async () => {
      try {
        const job = await api('/api/jobs/' + result.job_id);
        if (job.status !== 'running' && job.status !== 'queued') {
          clearInterval(poller);
          await loadCapabilities();
          if (btn) btn.disabled = false;
        }
      } catch (_) { clearInterval(poller); if (btn) btn.disabled = false; }
    }, 1500);
  } catch (err) {
    notifyLog('Inventory models error: ' + err.message);
    if (btn) btn.disabled = false;
  }
}

async function runModelStageCheck() {
  const btn = $('btn-check-model-stage');
  if (btn) btn.disabled = true;
  try {
    const result = await api('/api/actions/check-model-stage', { method: 'POST', body: '{}' });
    trackJob(result.job_id, 'Checking BigMac model stage…');
    const poller = setInterval(async () => {
      try {
        const job = await api('/api/jobs/' + result.job_id);
        if (job.status !== 'running' && job.status !== 'queued') {
          clearInterval(poller);
          await loadCapabilities();
          if (btn) btn.disabled = false;
        }
      } catch (_) { clearInterval(poller); if (btn) btn.disabled = false; }
    }, 1500);
  } catch (err) {
    notifyLog('Model stage check error: ' + err.message);
    if (btn) btn.disabled = false;
  }
}

async function runSdxlSmoke() {
  const btn = $('btn-sdxl-smoke');
  if (btn) btn.disabled = true;
  try {
    const result = await api('/api/actions/sdxl-smoke', { method: 'POST', body: '{}' });
    trackJob(result.job_id, 'Running SDXL base smoke…');
    const poller = setInterval(async () => {
      try {
        const job = await api('/api/jobs/' + result.job_id);
        if (job.status !== 'running' && job.status !== 'queued') {
          clearInterval(poller);
          await loadCapabilities();
          if (btn) btn.disabled = false;
        }
      } catch (_) { clearInterval(poller); if (btn) btn.disabled = false; }
    }, 1500);
  } catch (err) {
    notifyLog('SDXL smoke error: ' + err.message);
    if (btn) btn.disabled = false;
  }
}

async function runSdxlTurboSmoke() {
  const btn = $('btn-sdxl-turbo-smoke');
  if (btn) btn.disabled = true;
  try {
    const result = await api('/api/actions/sdxl-turbo-smoke', { method: 'POST', body: '{}' });
    trackJob(result.job_id, 'Running SDXL Turbo smoke…');
    const poller = setInterval(async () => {
      try {
        const job = await api('/api/jobs/' + result.job_id);
        if (job.status !== 'running' && job.status !== 'queued') {
          clearInterval(poller);
          await loadCapabilities();
          if (btn) btn.disabled = false;
        }
      } catch (_) { clearInterval(poller); if (btn) btn.disabled = false; }
    }, 1500);
  } catch (err) {
    notifyLog('SDXL Turbo smoke error: ' + err.message);
    if (btn) btn.disabled = false;
  }
}

async function runFluxSmoke() {
  const btn = $('btn-flux-smoke');
  if (btn) btn.disabled = true;
  try {
    const result = await api('/api/actions/flux-smoke', { method: 'POST', body: '{}' });
    trackJob(result.job_id, 'Running Flux smoke…');
    const poller = setInterval(async () => {
      try {
        const job = await api('/api/jobs/' + result.job_id);
        if (job.status !== 'running' && job.status !== 'queued') {
          clearInterval(poller);
          await loadCapabilities();
          if (btn) btn.disabled = false;
        }
      } catch (_) { clearInterval(poller); if (btn) btn.disabled = false; }
    }, 1500);
  } catch (err) {
    notifyLog('Flux smoke error: ' + err.message);
    if (btn) btn.disabled = false;
  }
}

async function loadGallery(reset = false) {
  if (state.libraryLoading) return;
  state.libraryLoading = true;
  const el = $('gallery-grid');
  if (reset) {
    state.libraryOffset = 0;
    el.textContent = '';
  }
  try {
    const url = '/api/run-index?limit=50&offset=' + state.libraryOffset + '&filter=' + encodeURIComponent(state.libraryFilter);
    const data = await api(url);
    const items = data.items || [];
    if (items.length) {
      el.insertAdjacentHTML('beforeend', items.map(r => runIndexCard(r)).join(''));
    } else if (reset) {
      const msg = document.createElement('div');
      msg.className = 'empty-state';
      const filterLabels = { all: 'runs', controlled: 'controlled generation runs', 'controlled-sd15': 'SD1.5 runs', 'controlled-sdxl-base': 'SDXL base runs', 'controlled-sdxl-turbo': 'SDXL Turbo runs', 'controlled-flux-fp8': 'Flux fp8 runs', 'hires-fix': 'Hires Fix runs', upscale: 'upscale runs', smoke: 'smoke proof runs', img2img: 'img2img runs', inpaint: 'inpaint runs', failed: 'failed runs' };
      msg.textContent = 'No ' + (filterLabels[state.libraryFilter] || state.libraryFilter) + ' found.';
      el.appendChild(msg);
    }
    state.libraryOffset = typeof data.nextOffset === 'number' ? data.nextOffset : state.libraryOffset + items.length;
    state.libraryHasMore = data.hasMore === true;
    updateLoadMoreBtn(data.total || 0);
  } catch (err) {
    if (reset) el.textContent = '';
    const msg = document.createElement('div');
    msg.className = 'empty-state danger';
    msg.textContent = err.message;
    el.appendChild(msg);
    state.libraryHasMore = false;
    updateLoadMoreBtn(0);
  } finally {
    state.libraryLoading = false;
  }
}

function updateLoadMoreBtn(total) {
  const row = $('library-load-more-row');
  const info = $('library-count-info');
  if (row) row.style.display = state.libraryHasMore ? '' : 'none';
  if (info) info.textContent = total > 0 ? state.libraryOffset + ' of ' + total + ' runs' : '';
  updateCompareControls();
}

function openImageViewer(imgPath, runId, filename) {
  const overlay = $('image-viewer-overlay');
  const img = $('image-viewer-img');
  const info = $('image-viewer-info');
  const download = $('btn-viewer-download');
  if (!overlay || !img) return;
  const imageUrl = '/api/run-file?path=' + encodeURIComponent(imgPath);
  img.src = imageUrl;
  img.alt = filename || imgPath;
  img.title = 'Right-click to save image';
  if (download) {
    download.href = imageUrl;
    download.download = filename || imgPath.split('/').pop() || 'image-gen-output.png';
  }
  if (info) info.textContent = (runId ? runId + '  ·  ' : '') + (filename || imgPath);
  overlay.hidden = false;
  overlay.focus();
  const filePart = imgPath.includes('/') ? imgPath.split('/').slice(1).join('/') : imgPath;
  [['btn-viewer-copy-path', () => navigator.clipboard.writeText(imgPath).catch(() => {})],
   ['btn-viewer-fullscreen', () => {
     const panel = $('image-viewer-panel') || img;
     if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
     else if (panel.requestFullscreen) panel.requestFullscreen().catch(() => {});
   }],
   ['btn-viewer-upscale', () => { closeImageViewer(); sendToUpscale(runId, filePart); }],
   ['btn-viewer-img2img', () => { closeImageViewer(); sendToImg2img(runId, filePart); }],
   ['btn-viewer-inpaint', () => { closeImageViewer(); sendToInpaint(runId, filePart); }],
   ['btn-viewer-close', closeImageViewer]
  ].forEach(([id, handler]) => {
    const b = $(id);
    if (!b) return;
    const n = b.cloneNode(true);
    b.parentNode.replaceChild(n, b);
    $(id).addEventListener('click', handler);
  });
}

function closeImageViewer() {
  const overlay = $('image-viewer-overlay');
  if (overlay) overlay.hidden = true;
}
function runTypeBadgeClass(filterCategory, status) {
  if (status === 'FAIL') return 'badge-fail';
  if (filterCategory === 'controlled') return 'badge-controlled';
  if (filterCategory === 'smoke') return 'badge-smoke';
  if (filterCategory === 'hires-fix') return 'badge-hires';
  if (filterCategory === 'upscale') return 'badge-upscale';
  if (filterCategory === 'img2img') return 'badge-img2img';
  if (filterCategory === 'inpaint') return 'badge-inpaint';
  return 'badge-other';
}

function runIndexCard(r) {
  const img = r.primaryImage;
  const imgUrl = img ? '/api/run-file?path=' + encodeURIComponent(r.id + '/' + img) : '';
  const badgeClass = runTypeBadgeClass(r.filterCategory, r.status);
  const labelText = r.controlledTargetLabel || r.type || r.id;
  const statusBadge = r.status === 'FAIL' ? ' <span class="run-type-badge badge-fail">FAIL</span>' : '';
  const upscaledBadge = r.hasUpscaled ? '<span class="derived-badge">Upscaled ✓</span>' : '';
  const canCompare = r.filterCategory === 'controlled' || String(r.type || '').startsWith('controlled-');
  const compareChecked = state.libraryCompareIds.includes(r.id) ? ' checked' : '';
  const compareDisabled = canCompare ? '' : ' disabled title="Comparison is controlled runs only"';
  const ctxAttrs = img ? ' data-ctx-path="' + esc(r.id + '/' + img) + '" data-ctx-run="' + esc(r.id) + '" data-ctx-file="' + esc(img) + '"' : '';
  return '<article class="image-card" data-run="' + esc(r.id) + '">' +
    (imgUrl ? '<img src="' + esc(imgUrl) + '" alt="Run ' + esc(r.id) + '" loading="lazy"' + ctxAttrs + ' />' : '<div style="height:120px;background:#071018;border-radius:14px;margin-bottom:8px"></div>') +
    '<div class="run-type-badge ' + esc(badgeClass) + '">' + esc(labelText) + '</div>' + statusBadge + upscaledBadge +
    '<h3 style="margin:4px 0 2px">' + esc(r.title || r.type) + '</h3>' +
    '<p>' + esc(r.createdAt ? r.createdAt.replace(/(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/, '$1-$2-$3 $4:$5') : '') + ' · ' + esc(String(r.imageCount || 0)) + ' img</p>' +
    '<label class="compare-check"><input type="checkbox" data-compare-run="' + esc(r.id) + '" data-compare-enabled="' + (canCompare ? '1' : '0') + '"' + compareChecked + compareDisabled + ' /> Compare</label>' +
    '<div class="quick-row" style="margin-top:6px">' +
    '<button class="ghost small" data-detail-run="' + esc(r.id) + '">Detail</button>' +
    '<button class="ghost small" data-send-upscale="' + esc(r.id) + '"' + (img ? ' data-upscale-image="' + esc(img) + '"' : '') + '>Upscale</button>' +
    '</div></article>';
}

function closeRunDetail() {
  const overlay = $('run-detail-overlay');
  if (overlay) overlay.hidden = true;
}

function closeRunComparison() {
  const overlay = $('run-compare-overlay');
  if (overlay) overlay.hidden = true;
}

function updateCompareControls() {
  const count = state.libraryCompareIds.length;
  const countEl = $('compare-selection-count');
  const compareBtn = $('btn-compare-selected');
  const clearBtn = $('btn-clear-compare');
  if (countEl) countEl.textContent = count ? count + ' selected. Select 2-4 controlled runs.' : 'Select 2-4 controlled runs.';
  if (compareBtn) compareBtn.disabled = count < 2 || count > 4;
  if (clearBtn) clearBtn.disabled = count === 0;
  $$('[data-compare-run]').forEach(input => {
    const enabled = input.dataset.compareEnabled === '1';
    const selected = state.libraryCompareIds.includes(input.dataset.compareRun);
    input.checked = selected;
    input.disabled = !enabled || (!selected && count >= 4);
  });
}

function toggleCompareRun(runId, checked) {
  if (!runId) return;
  const current = state.libraryCompareIds.filter(id => id !== runId);
  if (checked) {
    if (state.libraryCompareIds.length >= 4) {
      notifyLog('Comparison is limited to 4 controlled runs.');
      updateCompareControls();
      return;
    }
    current.push(runId);
  }
  state.libraryCompareIds = current;
  updateCompareControls();
}

function clearCompareSelection() {
  state.libraryCompareIds = [];
  state.lastComparisonRows = [];
  updateCompareControls();
}

function firstPresent(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
}

function extractComparisonRow(runId, detail, error) {
  if (error) return { runId, error: error.message || String(error) };
  const rc = detail.run_card || {};
  const cm = (detail.manifests && detail.manifests.controlled) || null;
  const runType = detail.run_type || rc.run_type || '';
  if (!cm && !String(runType).startsWith('controlled-')) {
    return { runId, error: 'Not a controlled run.' };
  }
  const width = firstPresent(cm && cm.width, rc.width);
  const height = firstPresent(cm && cm.height, rc.height);
  const promptPrivate = detail.prompt_private !== false || (cm && cm.prompt_redacted === true);
  const promptText = !promptPrivate && cm && cm.prompt && cm.prompt !== '[REDACTED]' ? cm.prompt : null;
  const negativePrompt = !promptPrivate && cm && cm.negative_prompt && cm.negative_prompt !== '[REDACTED]' ? cm.negative_prompt : null;
  return {
    runId,
    status: firstPresent(detail.status, rc.status, 'UNKNOWN'),
    target: firstPresent(detail.controlled_target_label, cm && cm.controlledTargetLabel, cm && cm.controlledTarget, runType.replace(/^controlled-/, '')),
    targetId: firstPresent(cm && cm.controlledTarget, runType.replace(/^controlled-/, '')),
    width,
    height,
    size: width && height ? width + 'x' + height : null,
    steps: firstPresent(cm && cm.steps, rc.steps),
    cfgScale: firstPresent(cm && cm.cfg_scale, rc.cfg_scale),
    seed: firstPresent(cm && cm.seed_label, rc.seed),
    promptPrivate,
    promptText,
    negativePrompt,
    primaryImage: detail.primary_image || null,
    imageCount: (detail.images || []).length,
    createdAt: firstPresent(detail.created_at, rc.created_at, runId.slice(0, 15))
  };
}

function comparisonMetaItem(label, value) {
  return '<div class="comparison-meta-item"><span>' + esc(label) + '</span><strong>' + esc(value ?? '—') + '</strong></div>';
}

function renderComparisonCard(row) {
  if (row.error) {
    return '<article class="comparison-card comparison-card-error"><h3>' + esc(row.runId) + '</h3><div class="run-detail-failed-gate">' + esc(row.error) + '</div></article>';
  }
  const imageHtml = row.primaryImage
    ? '<button type="button" class="comparison-thumb" data-compare-image="' + esc(row.runId + '/' + row.primaryImage) + '" data-compare-image-run="' + esc(row.runId) + '" data-compare-image-name="' + esc(row.primaryImage) + '"><img src="' + esc('/api/run-file?path=' + encodeURIComponent(row.runId + '/' + row.primaryImage)) + '" alt="Run ' + esc(row.runId) + '" loading="lazy" /></button>'
    : '<div class="comparison-thumb comparison-thumb-missing">Image missing</div>';
  const promptHtml = row.promptPrivate
    ? '<div class="comparison-prompt redacted">Prompt redacted</div>'
    : '<div class="comparison-prompt"><strong>Prompt</strong><p>' + esc(row.promptText || 'Prompt saved but unavailable') + '</p>' + (row.negativePrompt ? '<strong>Negative</strong><p>' + esc(row.negativePrompt) + '</p>' : '') + '</div>';
  return '<article class="comparison-card">' +
    imageHtml +
    '<h3>' + esc(row.runId) + '</h3>' +
    '<div class="run-type-badge badge-controlled">' + esc(row.target || 'Controlled') + '</div>' +
    '<div class="comparison-meta">' +
      comparisonMetaItem('Status', row.status) +
      comparisonMetaItem('Size', row.size) +
      comparisonMetaItem('Steps', row.steps) +
      comparisonMetaItem('CFG', row.cfgScale) +
      comparisonMetaItem('Seed', row.seed) +
      comparisonMetaItem('Privacy', row.promptPrivate ? 'Prompt redacted' : 'Prompt saved') +
    '</div>' +
    promptHtml +
    '</article>';
}

function buildComparisonSummary(rows) {
  const lines = [
    'Controlled run comparison',
    'Existing metadata/images only. Not full A1111 parity.',
    ''
  ];
  rows.forEach((row, idx) => {
    lines.push((idx + 1) + '. ' + row.runId);
    if (row.error) {
      lines.push('   Error: ' + row.error, '');
      return;
    }
    lines.push(
      '   Target: ' + (row.target || 'unknown'),
      '   Status: ' + (row.status || 'unknown'),
      '   Size: ' + (row.size || 'unknown'),
      '   Steps: ' + (row.steps ?? 'unknown'),
      '   CFG: ' + (row.cfgScale ?? 'unknown'),
      '   Seed: ' + (row.seed ?? 'unknown'),
      '   Prompt privacy: ' + (row.promptPrivate ? 'Prompt redacted' : 'Prompt saved'),
      '   Prompt: ' + (row.promptPrivate ? 'Prompt redacted' : (row.promptText || 'Prompt saved but unavailable')),
      '   Image: ' + (row.primaryImage ? 'present' : 'missing'),
      ''
    );
    if (!row.promptPrivate && row.negativePrompt) lines.splice(lines.length - 2, 0, '   Negative prompt: ' + row.negativePrompt);
  });
  return lines.join('\n').trim() + '\n';
}

async function showRunComparison(runIds = state.libraryCompareIds) {
  const ids = [...new Set(runIds)].slice(0, 4);
  if (ids.length < 2) { notifyLog('Select 2-4 controlled runs before comparing.'); updateCompareControls(); return; }
  const overlay = $('run-compare-overlay');
  const content = $('run-compare-content');
  if (!overlay || !content) return;
  content.innerHTML = '<div class="empty-state">Loading comparison…</div>';
  overlay.hidden = false;
  overlay.scrollTop = 0;
  const details = await Promise.all(ids.map(async id => {
    try {
      const detail = await api('/api/runs/' + encodeURIComponent(id) + '/metadata');
      return extractComparisonRow(id, detail, null);
    } catch (err) {
      return extractComparisonRow(id, null, err);
    }
  }));
  state.lastComparisonRows = details;
  content.innerHTML = details.map(renderComparisonCard).join('');
}

function numericSeed(row) {
  if (!row.seed) return null;
  const m = String(row.seed).match(/^(\d+)/);
  return m ? Number(m[1]) : null;
}

async function compareLatestSweep() {
  try {
    const index = await api('/api/run-index?limit=50&offset=0&filter=controlled');
    const items = (index.items || []).slice(0, 24);
    if (items.length < 2) { notifyLog('No controlled runs available for latest-sweep comparison.'); return; }
    const rows = await Promise.all(items.map(async item => {
      try {
        const detail = await api('/api/runs/' + encodeURIComponent(item.id) + '/metadata');
        return extractComparisonRow(item.id, detail, null);
      } catch (err) {
        return null;
      }
    }));
    const groups = new Map();
    rows.filter(Boolean).filter(r => !r.error).forEach(row => {
      const key = [row.targetId || row.target, row.size, row.steps].join('|');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    });
    let best = null;
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const latest = group.slice(0, 4);
      const seeds = latest.map(numericSeed).filter(n => Number.isFinite(n)).sort((a, b) => a - b);
      const cfgs = [...new Set(latest.map(r => String(r.cfgScale)).filter(v => v !== 'null' && v !== 'undefined'))];
      const adjacentSeed = seeds.some((seed, idx) => idx > 0 && Math.abs(seed - seeds[idx - 1]) === 1);
      const variedCfg = cfgs.length > 1;
      if (adjacentSeed || variedCfg) { best = latest; break; }
    }
    if (!best) { notifyLog('No recent controlled seed/CFG sweep group found. Select 2-4 runs manually.'); return; }
    state.libraryCompareIds = best.slice(0, 4).map(r => r.runId);
    updateCompareControls();
    await showRunComparison(state.libraryCompareIds);
  } catch (err) {
    notifyLog('Compare latest sweep failed: ' + err.message);
  }
}

const SETTINGS_ALLOWED_KEYS = new Set(['target', 'width', 'height', 'steps', 'cfg_scale', 'seed', 'prompt', 'negative_prompt', 'quantity']);
const SETTINGS_BLOCKED_KEYS = new Set(['modelPath', 'model_path', 'checkpoint_path', 'checkpoint', 'lora', 'vae', 'controlnet', 'controlNet', 'version', 'modelVersion']);
const SETTINGS_ALLOWED_TARGETS = new Set(['sd15', 'sdxl-base', 'sdxl-turbo', 'flux-fp8', 'sdxl-photonic', 'sdxl-homochi', 'sdxl-pony', 'sd15-homofidelis']);

function loadSettingsJson(jsonStr) {
  let s;
  try { s = JSON.parse(jsonStr.trim()); } catch (e) { showCreateNote('Parse error: ' + e.message, 'privacy'); return; }
  if (!s || typeof s !== 'object' || Array.isArray(s)) { showCreateNote('Settings must be a JSON object.', 'privacy'); return; }
  for (const k of Object.keys(s)) {
    if (SETTINGS_BLOCKED_KEYS.has(k)) { showCreateNote('Rejected: "' + k + '" is not an allowed field.', 'privacy'); return; }
    if (!SETTINGS_ALLOWED_KEYS.has(k)) { showCreateNote('Rejected: unknown field "' + k + '". Only generation params accepted.', 'privacy'); return; }
  }
  if (s.target != null && !SETTINGS_ALLOWED_TARGETS.has(s.target)) { showCreateNote('Rejected: target "' + s.target + '" is not on the allowed list (sd15, sdxl-base, sdxl-turbo, flux-fp8, sdxl-photonic, sdxl-homochi, sdxl-pony, sd15-homofidelis).', 'privacy'); return; }
  if (s.width != null && (typeof s.width !== 'number' || s.width < 64 || s.width > 2048)) { showCreateNote('Rejected: width out of range (64–2048).', 'privacy'); return; }
  if (s.height != null && (typeof s.height !== 'number' || s.height < 64 || s.height > 2048)) { showCreateNote('Rejected: height out of range (64–2048).', 'privacy'); return; }
  if (s.steps != null && (typeof s.steps !== 'number' || s.steps < 1 || s.steps > 150)) { showCreateNote('Rejected: steps out of range (1–150).', 'privacy'); return; }
  if (s.cfg_scale != null && (typeof s.cfg_scale !== 'number' || !isFinite(s.cfg_scale))) { showCreateNote('Rejected: cfg_scale must be a finite number.', 'privacy'); return; }
  if (s.quantity != null && (typeof s.quantity !== 'number' || s.quantity < 1 || s.quantity > 100)) { showCreateNote('Rejected: quantity out of range (1–100).', 'privacy'); return; }
  if (s.target) { const m = $('model'); if (m) { m.value = s.target; applyControlledTargetDefaults(s.target); } }
  if (s.width) $('width').value = s.width;
  if (s.height) $('height').value = s.height;
  if (s.steps) $('steps').value = s.steps;
  if (s.cfg_scale != null) $('cfg_scale').value = s.cfg_scale;
  if (s.seed != null) $('seed').value = String(s.seed);
  if (s.quantity) $('quantity').value = s.quantity;
  if ($('preset')) $('preset').value = 'Custom';
  if (s.prompt) { $('prompt').value = s.prompt; $('prompt').dispatchEvent(new Event('input')); }
  if (s.negative_prompt) $('negative_prompt').value = s.negative_prompt;
  const seedNote = s.seed != null ? ' Seed ' + s.seed + ' loaded — click "Random seed" to vary.' : '';
  showCreateNote('Settings loaded.' + seedNote + ' Review before generating.', '');
}

// Sweep is allowed for any target present in the current capabilities map.
function isSweepableTarget(targetId) { return Boolean(state.controlledTargetMap[targetId]); }
const SWEEP_MAX_JOBS = 8;

function updatePromptStats(textareaId, countId) {
  const txt = ($( textareaId) || {}).value || '';
  const el = $(countId);
  if (!el) return;
  const est = Math.max(0, Math.round(txt.trim().length / 4));
  el.textContent = `${txt.length} chars · ~${est} tkn (approx)`;
}

async function runControlledSweep() {
  const axis = ($('sweep-axis') || {}).value || 'seed';
  const btn = $('btn-run-sweep');
  const statusEl = $('sweep-status');
  if (!statusEl) return;
  const base = getCoreParams();
  base.target = $('model').value;
  if (!isSweepableTarget(base.target)) { showCreateNote('Sweep rejected: select a valid model target first.', 'privacy'); return; }
  if (!base.prompt || !base.prompt.trim()) { showCreateNote('Enter a prompt before running a sweep.', 'privacy'); return; }
  let jobs = [];
  if (axis === 'seed') {
    const n = Math.min(SWEEP_MAX_JOBS, Math.max(2, parseInt(($('sweep-count') || {}).value) || 4));
    const startRaw = (($('sweep-seed-start') || {}).value || '').trim();
    const startSeed = /^\d+$/.test(startRaw) ? parseInt(startRaw) : null;
    for (let i = 0; i < n; i++) {
      const seed = startSeed !== null ? String((startSeed + i) % 2147483647) : String(Math.floor(Math.random() * 2147483647));
      jobs.push({ ...base, seed });
    }
  } else {
    const raw = (($('sweep-cfg-values') || {}).value || '').trim();
    const vals = raw.split(',').map(v => parseFloat(v.trim())).filter(v => !isNaN(v) && v >= 0 && v <= 30).slice(0, SWEEP_MAX_JOBS);
    if (vals.length < 2) { showCreateNote('CFG sweep needs at least 2 valid values in the 0–30 range.', 'privacy'); return; }
    for (const cfg of vals) { jobs.push({ ...base, cfg_scale: cfg }); }
  }
  if (btn) btn.disabled = true;
  statusEl.innerHTML = '';
  statusEl.hidden = false;
  const rows = jobs.map((_, i) => {
    const d = document.createElement('div');
    d.className = 'fineprint muted';
    d.textContent = `Job ${i + 1}/${jobs.length}: pending`;
    statusEl.appendChild(d);
    return d;
  });
  showCreateNote(`Running ${jobs.length}-job ${axis === 'seed' ? 'seed' : 'CFG'} sweep…`, '');
  const sweepResults = [];
  for (let i = 0; i < jobs.length; i++) {
    rows[i].textContent = `Job ${i + 1}/${jobs.length}: submitting…`;
    try {
      const { job_id } = await api('/api/actions/generate-controlled', { method: 'POST', body: JSON.stringify(jobs[i]) });
      rows[i].textContent = `Job ${i + 1}/${jobs.length}: running (${job_id.slice(0, 8)}…)`;
      rows[i].className = 'fineprint';
      let finalJob = null;
      for (let p = 0; p < 90; p++) {
        await new Promise(r => setTimeout(r, 2000));
        try { const jd = await api(`/api/jobs/${job_id}`); if (jd.status !== 'running' && jd.status !== 'queued') { finalJob = jd; break; } } catch (_) {}
      }
      const ok = finalJob && finalJob.status === 'PASS';
      const axisLabel = axis === 'seed' ? `seed=${jobs[i].seed}` : `cfg=${jobs[i].cfg_scale}`;
      rows[i].className = 'fineprint' + (ok ? '' : ' danger');
      rows[i].textContent = finalJob
        ? `Job ${i + 1}/${jobs.length}: ${finalJob.status}${finalJob.runId ? ' · ' + finalJob.runId : ''} · ${axisLabel}`
        : `Job ${i + 1}/${jobs.length}: timeout · ${axisLabel}`;
      sweepResults.push({ ok });
    } catch (err) {
      rows[i].className = 'fineprint danger';
      rows[i].textContent = `Job ${i + 1}/${jobs.length}: error — ${err.message}`;
      sweepResults.push({ ok: false });
    }
  }
  if (btn) btn.disabled = false;
  const passed = sweepResults.filter(r => r.ok).length;
  showCreateNote(`Sweep done: ${passed}/${jobs.length} passed. See Library for results.`, passed === jobs.length ? '' : 'privacy');
  await loadGallery(true);
}

function showCreateNote(msg, variant) {
  const note = $('create-note');
  if (!note) return;
  note.textContent = msg || '';
  note.className = 'create-note' + (variant ? ' ' + variant : '');
  note.hidden = !msg;
}

function applySectionVisibility() {
  SECTION_TOGGLES.forEach(([key]) => {
    const targets = $$(`[data-section-key="${key}"]`);
    const byId = $(key);
    if (byId) targets.push(byId);
    targets.forEach(el => { el.hidden = state.hiddenSections.has(key); });
  });
}

function loadSectionVisibility() {
  let hidden = [];
  try { hidden = JSON.parse(localStorage.getItem(HIDDEN_SECTIONS_KEY) || '[]'); } catch (_) {}
  state.hiddenSections = new Set(Array.isArray(hidden) ? hidden : []);
  renderSectionToggles();
  applySectionVisibility();
}

function saveSectionVisibility() {
  localStorage.setItem(HIDDEN_SECTIONS_KEY, JSON.stringify(Array.from(state.hiddenSections)));
  applySectionVisibility();
  updateHiddenSectionCount();
}

function updateHiddenSectionCount() {
  const countEl = $('hidden-section-count');
  if (!countEl) return;
  const n = state.hiddenSections.size;
  countEl.textContent = n ? `${n} section${n !== 1 ? 's' : ''} hidden` : 'All sections visible';
}

function renderSectionToggles() {
  const container = $('system-section-toggles');
  if (!container) return;
  container.innerHTML = SECTION_TOGGLES.map(([key, label]) => {
    const checked = state.hiddenSections.has(key) ? '' : 'checked';
    return `<label class="check-card section-toggle"><input type="checkbox" data-section-toggle="${esc(key)}" ${checked} /> ${esc(label)}</label>`;
  }).join('');
  updateHiddenSectionCount();
}

function replayInCreate(replay, runId) {
  closeRunDetail();
  showScreen('create');
  const modelSel = $('model');
  if (modelSel && replay.target) {
    modelSel.value = replay.target;
    applyControlledTargetDefaults(replay.target);
  }
  if (replay.width) $('width').value = replay.width;
  if (replay.height) $('height').value = replay.height;
  if (replay.steps) $('steps').value = replay.steps;
  if (replay.cfg_scale != null) $('cfg_scale').value = replay.cfg_scale;
  if (replay.seed != null) $('seed').value = String(replay.seed);
  if ($('preset')) $('preset').value = 'Custom';
  if (replay.prompt_saved && replay.prompt) {
    $('prompt').value = replay.prompt;
  } else {
    $('prompt').value = '';
  }
  $('prompt').dispatchEvent(new Event('input'));
  $('negative_prompt').value = (replay.prompt_saved && replay.negative_prompt) ? replay.negative_prompt : '';
  let noteMsg = 'Loaded settings from run ' + runId + '.';
  let noteVariant = '';
  if (replay.seed != null) { noteMsg += ' Seed ' + replay.seed + ' restored — click "Random seed" to vary output.'; }
  if (replay.privacy_note) { noteMsg += ' ' + replay.privacy_note; noteVariant = 'privacy'; }
  if (replay.flux_caveat) { noteMsg += ' ' + replay.flux_caveat; noteVariant = noteVariant || 'flux'; }
  const isMinimal = (replay.width && replay.width < 256) || (replay.height && replay.height < 256) || (replay.steps && replay.steps <= 1);
  if (isMinimal) { noteMsg += ' This replay came from a proof/minimal run. Review size and steps before generating.'; noteVariant = noteVariant || 'privacy'; }
  showCreateNote(noteMsg, noteVariant);
}

function metaItem(label, value, valueClass) {
  return '<div class="run-detail-meta-item"><div class="label">' + esc(label) + '</div><div class="value' + (valueClass ? ' ' + esc(valueClass) : '') + '">' + esc(String(value ?? '—')) + '</div></div>';
}

async function showRunDetail(runId) {
  const overlay = $('run-detail-overlay');
  const content = $('run-detail-content');
  if (!overlay || !content) return;
  content.innerHTML = '<div class="empty-state">Loading…</div>';
  overlay.hidden = false;
  overlay.scrollTop = 0;

  // Wire up header action buttons with the runId
  const btnBack = $('btn-detail-back');
  const btnReuse = $('btn-detail-reuse');
  const btnCopyId = $('btn-detail-copy-id');
  const btnCopyPath = $('btn-detail-copy-path');
  const btnSendUpscale = $('btn-detail-send-upscale');
  const btnCopySettings = $('btn-detail-copy-settings');
  const btnManifest = $('btn-detail-view-manifest');

  // Remove previous listeners by cloning; hide reuse until metadata confirms availability
  [btnBack, btnReuse, btnCopyId, btnCopyPath, btnSendUpscale, btnCopySettings, btnManifest].forEach(b => {
    if (b) { const n = b.cloneNode(true); b.parentNode.replaceChild(n, b); }
  });
  $('btn-detail-back').addEventListener('click', closeRunDetail);
  if ($('btn-detail-reuse')) $('btn-detail-reuse').hidden = true;

  let detail;
  try {
    detail = await api('/api/runs/' + encodeURIComponent(runId) + '/metadata');
  } catch (err) {
    content.textContent = '';
    const msg = document.createElement('div');
    msg.className = 'empty-state danger';
    msg.textContent = 'Failed to load run: ' + err.message;
    content.appendChild(msg);
    return;
  }

  const rc = detail.run_card || {};
  const cm = (detail.manifests && detail.manifests.controlled) || null;
  const primaryImage = detail.primary_image || null;
  const allImages = detail.images || [];
  const runType = detail.run_type || rc.run_type || '';
  const status = detail.status || rc.status || 'UNKNOWN';
  const isControlled = runType.startsWith('controlled-');
  const isSmoke = runType.endsWith('-smoke') || runType.includes('-smoke');
  const isFlux = runType === 'controlled-flux-fp8';
  const targetLabel = detail.controlled_target_label || '';
  const targetCaveat = detail.controlled_target_caveat || '';
  const promptPrivate = detail.prompt_private !== false;
  const firstFailedGate = detail.first_failed_gate;

  // Build parameter display from controlled manifest or run card
  const steps = (cm && cm.steps) || rc.steps || null;
  const cfgScale = (cm && cm.cfg_scale != null ? cm.cfg_scale : null) || rc.cfg_scale || null;
  const seedLabel = (cm && cm.seed_label) || rc.seed || null;
  const width = (cm && cm.width) || rc.width || null;
  const height = (cm && cm.height) || rc.height || null;
  const elapsedSec = cm && cm.wall_elapsed_seconds != null ? Math.round(cm.wall_elapsed_seconds) + 's' : null;

  // Primary image
  const primaryImgHtml = primaryImage
    ? '<div class="run-detail-primary"><img src="' + esc('/api/run-file?path=' + encodeURIComponent(runId + '/' + primaryImage)) + '" alt="Primary output" /></div>'
    : '<div class="run-detail-primary" style="padding:40px;text-align:center;color:var(--muted)">No image available</div>';

  // Thumbnails for non-primary images
  const thumbImages = allImages.filter(f => f !== primaryImage).slice(0, 12);
  const thumbsHtml = thumbImages.length
    ? '<div class="run-detail-thumbs">' + thumbImages.map(f =>
        '<div class="run-detail-thumb" data-thumb-img="' + esc(runId + '/' + f) + '" title="' + esc(f) + '"><img src="' + esc('/api/run-file?path=' + encodeURIComponent(runId + '/' + f)) + '" alt="' + esc(f) + '" loading="lazy" /></div>'
      ).join('') + '</div>'
    : '';

  // Type badge
  const filterCat = isControlled ? 'controlled' : isSmoke ? 'smoke' : runType === 'hires-fix' ? 'hires-fix' : runType === 'img2img' ? 'img2img' : runType === 'inpaint' ? 'inpaint' : 'other';
  const badgeClass = runTypeBadgeClass(filterCat, status);
  const typeLabel = isControlled ? (targetLabel || runType) : isSmoke ? 'Smoke proof' : runType || 'Run';
  const typeBadgeHtml = '<span class="run-type-badge ' + esc(badgeClass) + '">' + esc(typeLabel) + '</span>';

  // Status badge
  const statusClass = status === 'PASS' ? 'ok' : status === 'FAIL' ? 'fail' : '';

  // Caveat section
  let caveatHtml = '';
  if (isControlled && targetCaveat) {
    caveatHtml = '<div class="run-detail-caveat' + (isFlux ? ' caveat-flux' : '') + '">' + esc(targetCaveat) + '</div>';
  }
  if (isSmoke) {
    caveatHtml = '<div class="run-detail-caveat">Smoke proof run — validates the generation path only. Not a full generation output.</div>';
  }

  // Failed gate
  const failedGateHtml = status === 'FAIL'
    ? '<div class="run-detail-failed-gate">' + (firstFailedGate ? '<strong>First failed gate:</strong> ' + esc(firstFailedGate) : 'Run failed — no gate failure detail recorded.') + '</div>'
    : '';

  // Privacy notice
  const privacyHtml = '<div class="run-detail-privacy">' +
    (promptPrivate ? '🔒 Prompt redacted (save_prompts was off for this run)' : '📋 Prompt saved with this run') +
    '</div>';

  // Meta grid
  const metaHtml = '<div class="run-detail-meta">' +
    metaItem('Run ID', runId) +
    metaItem('Status', status, statusClass) +
    metaItem('Created', detail.created_at || rc.created_at || runId.slice(0, 15)) +
    (targetLabel ? metaItem('Target', targetLabel) : '') +
    (steps != null ? metaItem('Steps', steps) : '') +
    (cfgScale != null ? metaItem('CFG / Guidance', cfgScale) : '') +
    (seedLabel ? metaItem('Seed', seedLabel) : '') +
    (width && height ? metaItem('Dimensions', width + '×' + height) : '') +
    (elapsedSec ? metaItem('Elapsed', elapsedSec) : '') +
    '</div>';

  // Manifest section
  const hasManifest = detail.manifests && Object.keys(detail.manifests).length > 0;
  const manifestForView = detail.manifest;
  const manifestHtml = hasManifest
    ? '<details class="run-detail-manifest"><summary>Manifest JSON</summary><pre>' + esc(JSON.stringify(detail.manifests, null, 2)) + '</pre></details>'
    : '';

  // Assemble
  content.innerHTML = typeBadgeHtml + failedGateHtml + caveatHtml + privacyHtml + primaryImgHtml + thumbsHtml + metaHtml + manifestHtml;

  // Wire up copy/action buttons (after DOM is set)
  $('btn-detail-copy-id').addEventListener('click', () => navigator.clipboard.writeText(runId).catch(() => {}));
  $('btn-detail-copy-path').addEventListener('click', () => {
    const p = primaryImage ? (runId + '/' + primaryImage) : runId;
    navigator.clipboard.writeText(p).catch(() => {});
  });
  const upscaleBtn = $('btn-detail-send-upscale');
  if (upscaleBtn) {
    upscaleBtn.disabled = !primaryImage;
    upscaleBtn.title = primaryImage ? '' : 'No image available for this run';
    upscaleBtn.addEventListener('click', () => {
      if (!primaryImage) return;
      sendToUpscale(runId, primaryImage);
      closeRunDetail();
      showScreen('enhance');
    });
  }
  $('btn-detail-view-manifest').addEventListener('click', () => {
    if (manifestForView) notifyLog(JSON.stringify(manifestForView, null, 2));
    showScreen('system');
    closeRunDetail();
  });

  // Copy settings JSON — generation params only, prompt omitted if redacted
  const copySettingsBtn = $('btn-detail-copy-settings');
  if (copySettingsBtn) {
    if (!cm) {
      copySettingsBtn.disabled = true;
      copySettingsBtn.title = 'No generation settings for this run type';
    } else {
      copySettingsBtn.addEventListener('click', () => {
        const settings = { target: cm.controlledTarget, width: cm.width, height: cm.height, steps: cm.steps, cfg_scale: cm.cfg_scale, seed: cm.seed_label || null };
        if (!promptPrivate && cm.prompt) settings.prompt = cm.prompt;
        if (!promptPrivate && cm.negative_prompt) settings.negative_prompt = cm.negative_prompt;
        navigator.clipboard.writeText(JSON.stringify(settings, null, 2)).catch(() => {});
      });
    }
  }

  // Reuse in Create button
  const replayData = detail.replay || {};
  const reuseBtn = $('btn-detail-reuse');
  if (reuseBtn) {
    reuseBtn.hidden = !replayData.available;
    if (replayData.available) {
      reuseBtn.addEventListener('click', () => replayInCreate(replayData, runId));
    }
  }

  // Primary image click → open viewer
  const primaryImgEl = content.querySelector('.run-detail-primary img');
  if (primaryImgEl && primaryImage) {
    primaryImgEl.style.cursor = 'zoom-in';
    primaryImgEl.addEventListener('click', () => openImageViewer(runId + '/' + primaryImage, runId, primaryImage));
  }

  // Thumbnail click → open viewer
  content.querySelectorAll('[data-thumb-img]').forEach(el => {
    el.addEventListener('click', () => {
      const imgPath = el.dataset.thumbImg;
      const filename = imgPath.split('/').pop();
      openImageViewer(imgPath, runId, filename);
    });
  });
}

async function viewUpscaledOutputs(runId) {
  try {
    const detail = await api('/api/runs/' + encodeURIComponent(runId));
    const upscaledImages = (detail.images || []).filter(f => f.startsWith('upscaled/') && /\.(png|PNG)$/.test(f));
    if (!upscaledImages.length) { notifyLog('No upscaled images found in ' + runId); return; }
    const first = upscaledImages[0];
    setPreviewImage('/api/run-file?path=' + encodeURIComponent(runId + '/' + first), 'Upscaled: ' + first, runId + '/' + first, runId, first);
    showScreen('create');
    notifyLog('Upscaled outputs in run ' + runId + ':\n' + upscaledImages.join('\n'));
  } catch (err) { notifyLog('Error loading upscaled outputs: ' + err.message); }
}
async function openRun(id) {
  const detail = await api(`/api/runs/${id}`);
  const image = detail.images && detail.images[0];
  if (image) setPreviewImage(`/api/run-file?path=${encodeURIComponent(`${id}/${image}`)}`, `Run ${id}`, `${id}/${image}`, id, image);
  showScreen('create');
}
async function reuseRun(id) {
  const detail = await api(`/api/runs/${id}`);
  const m = detail.metadata || {};
  if (m.prompt && m.prompt !== '[REDACTED]') $('prompt').value = m.prompt;
  if (m.negative_prompt && m.negative_prompt !== '[REDACTED]') $('negative_prompt').value = m.negative_prompt;
  showScreen('create');
}
async function copyRun(id) {
  const detail = await api(`/api/runs/${id}`);
  await navigator.clipboard.writeText(JSON.stringify(detail.metadata || detail.manifest || detail, null, 2));
}

// ---- X/Y/Z Plot --------------------------------------------------------------
function updateXyzCellCount() {
  const xVals = $('xyz_x_values').value.split(',').filter(v => v.trim()).length;
  const yType = $('xyz_y_type').value;
  const yVals = yType ? $('xyz_y_values').value.split(',').filter(v => v.trim()).length : 1;
  const cells = xVals * (yVals || 1);
  const el = $('xyz-cell-count');
  const msg = $('xyz-validation-msg');
  if (el) el.textContent = 'Cells: ' + cells + ' / 16';
  if (msg) {
    if (cells > 16) msg.textContent = 'Too many cells (' + cells + '). Max is 16. Reduce X or Y values.';
    else if (yType && !$('xyz_y_values').value.trim()) msg.textContent = 'Y values required when Y axis is set.';
    else msg.textContent = '';
  }
}

async function submitXyz(event) {
  event.preventDefault();
  const prompt = $('xyz_prompt').value.trim();
  const negative = $('xyz_negative').value.trim();
  const xType = $('xyz_x_type').value;
  const xValues = $('xyz_x_values').value.trim();
  const yType = $('xyz_y_type').value;
  const yValues = $('xyz_y_values').value.trim();
  const msg = $('xyz-validation-msg');

  if (!xValues) { if (msg) msg.textContent = 'X values are required.'; return; }
  const xCount = xValues.split(',').filter(v => v.trim()).length;
  const yCount = yType ? yValues.split(',').filter(v => v.trim()).length : 1;
  if (yType && !yValues) { if (msg) msg.textContent = 'Y values required when Y axis is set.'; return; }
  if (xCount * yCount > 16) { if (msg) msg.textContent = 'Too many cells (' + (xCount * yCount) + '). Max is 16.'; return; }
  if (msg) msg.textContent = '';

  const params = {
    prompt,
    negative_prompt: negative,
    x_type: xType,
    x_values: xValues,
    save_prompts: $('set-save-prompts').checked
  };
  if (yType) { params.y_type = yType; params.y_values = yValues; }

  try {
    const result = await api('/api/actions/xyz-plot', { method: 'POST', body: JSON.stringify(params) });
    trackJob(result.job_id, 'Running X/Y/Z plot (' + (xCount * yCount) + ' cells)…');
  } catch (err) {
    if (msg) msg.textContent = 'Error: ' + err.message;
    notifyLog(err.message);
  }
}

async function runSimpleAction(action) {
  try {
    const result = await api(`/api/actions/${action}`, { method: 'POST', body: '{}' });
    trackJob(result.job_id, `Running ${action}…`);
  } catch (err) { notifyLog(err.message); }
}
async function loadOllamaModels() {
  const status = $('ollama-status');
  const modelSelect = $('ollama-model');
  const manualInput = $('ollama-model-manual');
  const baseUrlInput = $('ollama-base-url');
  const preferredModel = localStorage.getItem(OLLAMA_MODEL_KEY) || '';
  if (status) status.value = 'Checking...';
  try {
    const data = await api('/api/ollama/status');
    const models = data.models || [];
    if (baseUrlInput) baseUrlInput.value = data.baseUrl || 'Unknown';
    if (modelSelect) {
      modelSelect.innerHTML = '<option value="">Auto</option>' + models.map(model => `<option value="${esc(model.name)}">${esc(model.name)}</option>`).join('');
      const discovered = models.some(model => model.name === preferredModel);
      modelSelect.value = discovered ? preferredModel : '';
      if (manualInput) manualInput.value = discovered ? '' : preferredModel;
    }
    if (status) status.value = models.length ? `${models.length} model(s)` : 'No models';
  } catch (err) {
    if (status) status.value = 'Unavailable';
    if (baseUrlInput) baseUrlInput.value = 'Unavailable';
    if (manualInput && preferredModel) manualInput.value = preferredModel;
    notifyLog('Ollama unavailable: ' + err.message);
  }
}

async function enhancePromptWithOllama() {
  const promptEl = $('prompt');
  const btn = $('btn-enhance-prompt');
  const prompt = promptEl ? promptEl.value.trim() : '';
  if (!prompt) { showCreateNote('Prompt is required before enhancement.', 'privacy'); return; }
  if (btn) btn.disabled = true;
  showCreateNote('Enhancing prompt with Ollama...', '');
  try {
    const result = await api('/api/ollama/enhance', {
      method: 'POST',
      body: JSON.stringify({ prompt, model: getSelectedOllamaModel() })
    });
    promptEl.value = result.prompt || prompt;
    promptEl.dispatchEvent(new Event('input'));
    savePromptDraft();
    showCreateNote(`Prompt enhanced with ${result.model}.`, '');
  } catch (err) {
    showCreateNote('Ollama enhancement failed: ' + err.message, 'privacy');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function sendOllamaChat() {
  const input = $('ollama-chat-input');
  const output = $('ollama-chat-output');
  const btn = $('btn-ollama-send');
  const message = input ? input.value.trim() : '';
  if (!message) return;
  if (btn) btn.disabled = true;
  if (output) output.textContent = 'Ollama is responding...';
  try {
    const result = await api('/api/ollama/chat', {
      method: 'POST',
      body: JSON.stringify({ message, model: getSelectedOllamaModel() })
    });
    if (output) output.textContent = `${result.model}\n\n${result.reply}`;
  } catch (err) {
    if (output) output.textContent = 'Ollama chat failed: ' + err.message;
  } finally {
    if (btn) btn.disabled = false;
  }
}
async function explainUnsupported(feature) {
  try { await api('/api/actions/unsupported', { method: 'POST', body: JSON.stringify({ feature }) }); }
  catch (err) { notifyLog(err.message); }
}
function showScreen(id) { $$('.screen').forEach(el => el.classList.toggle('active', el.id === id)); $$('.nav-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.target === id)); if (id === 'library') loadGallery(true); }
function loadStyles() {
  const styles = JSON.parse(localStorage.getItem('styles') || '[]');
  $('style-select').innerHTML = '<option value="">No saved style</option>' + styles.map(s => `<option value="${esc(s.prompt)}">${esc(s.name)}</option>`).join('');
}
function saveCurrentStyle() {
  const prompt = $('prompt').value.trim();
  if (!prompt) return;
  const name = prompt.slice(0, 38);
  const styles = JSON.parse(localStorage.getItem('styles') || '[]');
  styles.push({ name, prompt });
  localStorage.setItem('styles', JSON.stringify(styles.slice(-40)));
  loadStyles();
}
function insertAtPrompt(text) { $('prompt').value = `${$('prompt').value.trim()} <lora:${text}>`.trim(); $('prompt').dispatchEvent(new Event('input')); }
function bindEvents() {
  $$('.nav-btn').forEach(btn => btn.addEventListener('click', () => {
    showScreen(btn.dataset.target);
    if (btn.dataset.target === 'enhance') { loadEnhanceRuns(); loadEsrganRuns(); }
    if (btn.dataset.target === 'edit') loadEditRuns();
    // Close mobile sidebar after navigation
    const sidebar = $('app-sidebar');
    const backdrop = $('sidebar-backdrop');
    const sidebarToggle = $('btn-sidebar-toggle');
    if (sidebar) sidebar.classList.remove('sidebar-open');
    if (backdrop) backdrop.hidden = true;
    if (sidebarToggle) sidebarToggle.setAttribute('aria-expanded', 'false');
  }));
  $('form-create').addEventListener('submit', submitCreate);
  $('btn-preview-create').addEventListener('click', previewCreateCommand);
  $('form-batch').addEventListener('submit', submitBatch);
  $('form-upscale').addEventListener('submit', submitUpscale);
  $('upscale-run').addEventListener('change', onUpscaleRunChange);
  if ($('form-img2img')) $('form-img2img').addEventListener('submit', submitImg2img);
  if ($('img2img-run')) $('img2img-run').addEventListener('change', onImg2imgRunChange);
  if ($('btn-img2img-preview')) $('btn-img2img-preview').addEventListener('click', () => previewGenerationCommand('img2img'));
  if ($('form-inpaint')) $('form-inpaint').addEventListener('submit', submitInpaint);
  if ($('inpaint-run')) $('inpaint-run').addEventListener('change', onInpaintRunChange);
  if ($('inpaint-image')) $('inpaint-image').addEventListener('change', onInpaintImageChange);
  if ($('btn-inpaint-preview')) $('btn-inpaint-preview').addEventListener('click', () => previewGenerationCommand('inpaint'));
  initInpaintCanvas();
  if ($('form-esrgan')) $('form-esrgan').addEventListener('submit', submitEsrgan);
  if ($('esrgan-run')) $('esrgan-run').addEventListener('change', onEsrganRunChange);
  $('form-hires-fix').addEventListener('submit', submitHiresFix);
  $('form-xyz').addEventListener('submit', submitXyz);
  $('model').addEventListener('change', e => applyControlledTargetDefaults(e.target.value));
  $('xyz_x_values').addEventListener('input', updateXyzCellCount);
  $('xyz_y_values').addEventListener('input', updateXyzCellCount);
  $('xyz_y_type').addEventListener('change', updateXyzCellCount);
  $('preset').addEventListener('change', e => { if (e.target.value !== 'Custom') applyPreset(e.target.value); });
  ['steps','cfg_scale','sampler','width','height'].forEach(id => $(id).addEventListener('input', () => { $('preset').value = 'Custom'; }));
  $('prompt').addEventListener('input', () => updatePromptStats('prompt', 'prompt-count'));
  $('negative_prompt').addEventListener('input', () => updatePromptStats('negative_prompt', 'neg-prompt-count'));
  $('prompt').addEventListener('input', savePromptDraft);
  $('negative_prompt').addEventListener('input', savePromptDraft);
  $('sweep-axis').addEventListener('change', e => {
    const isCfg = e.target.value === 'cfg';
    $('sweep-seed-opts').hidden = isCfg;
    $('sweep-cfg-opts').hidden = !isCfg;
    $('sweep-count-wrap').hidden = isCfg;
  });
  $('btn-run-sweep').addEventListener('click', runControlledSweep);
  $('style-select').addEventListener('change', e => { if (e.target.value) $('prompt').value = `${$('prompt').value.trim()} ${e.target.value}`.trim(); });
  $('btn-save-style').addEventListener('click', saveCurrentStyle);
  $('btn-reload-prompt').addEventListener('click', () => loadPromptDraft(true));
  $('btn-enhance-prompt').addEventListener('click', enhancePromptWithOllama);
  if ($('btn-ollama-refresh')) $('btn-ollama-refresh').addEventListener('click', loadOllamaModels);
  if ($('btn-ollama-send')) $('btn-ollama-send').addEventListener('click', sendOllamaChat);
  if ($('ollama-model')) $('ollama-model').addEventListener('change', () => {
    if ($('ollama-model-manual')) $('ollama-model-manual').value = '';
    saveSelectedOllamaModel();
  });
  if ($('ollama-model-manual')) $('ollama-model-manual').addEventListener('input', saveSelectedOllamaModel);
  $('set-save-prompts').addEventListener('change', e => saveBool('savePrompts', e.target.checked));
  $('btn-random-seed').addEventListener('click', () => { $('seed').value = String(Math.floor(Math.random() * 2147483647)); });
  $('btn-random-seed-ongoing').addEventListener('click', () => { $('seed').value = '-1'; });
  $('btn-reuse-seed').addEventListener('click', () => { if (state.lastSeed) $('seed').value = state.lastSeed; });
  $('btn-load-settings').addEventListener('click', () => { const v = ($('settings-import-input') || {}).value || ''; if (v.trim()) loadSettingsJson(v); else showCreateNote('Paste settings JSON first.', 'privacy'); });
  $('btn-paste-settings').addEventListener('click', async () => { try { const t = await navigator.clipboard.readText(); $('settings-import-input').value = t; loadSettingsJson(t); } catch { showCreateNote('Clipboard read failed — paste manually.', 'privacy'); } });
  $('btn-load-library').addEventListener('click', () => loadGallery(true));
  $('btn-compare-selected').addEventListener('click', () => showRunComparison());
  $('btn-compare-latest-sweep').addEventListener('click', compareLatestSweep);
  $('btn-clear-compare').addEventListener('click', clearCompareSelection);
  $('btn-compare-back').addEventListener('click', closeRunComparison);
  $('btn-copy-comparison-summary').addEventListener('click', async () => {
    const rows = state.lastComparisonRows || [];
    if (!rows.length) { notifyLog('No comparison summary to copy.'); return; }
    await navigator.clipboard.writeText(buildComparisonSummary(rows)).catch(() => {});
  });
  $('btn-refresh-all').addEventListener('click', async () => { await loadCapabilities(); await loadGallery(true); });
  // Library filter buttons
  const filterEl = $('library-filters');
  if (filterEl) {
    filterEl.addEventListener('click', e => {
      const btn = e.target.closest('.filter-btn');
      if (!btn) return;
      state.libraryFilter = btn.dataset.filter || 'all';
      filterEl.querySelectorAll('.filter-btn').forEach(b => b.classList.toggle('active', b === btn));
      loadGallery(true);
    });
  }
  // Close detail overlay on background click
  const overlay = $('run-detail-overlay');
  if (overlay) overlay.addEventListener('click', e => { if (e.target === overlay) closeRunDetail(); });
  const compareOverlay = $('run-compare-overlay');
  if (compareOverlay) compareOverlay.addEventListener('click', e => { if (e.target === compareOverlay) closeRunComparison(); });
  const loadMoreBtn = $('btn-load-more');
  if (loadMoreBtn) loadMoreBtn.addEventListener('click', () => loadGallery(false));
  const viewerOverlay = $('image-viewer-overlay');
  if (viewerOverlay) viewerOverlay.addEventListener('click', e => { if (e.target === viewerOverlay) closeImageViewer(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      const vo = $('image-viewer-overlay');
      if (vo && !vo.hidden) { closeImageViewer(); return; }
      const co = $('run-compare-overlay');
      if (co && !co.hidden) { closeRunComparison(); return; }
      closeRunDetail();
    }
  });
  $('btn-copy-last').addEventListener('click', async () => { if (state.lastParams) await navigator.clipboard.writeText(JSON.stringify(state.lastParams, null, 2)); });
  $('btn-send-img2img').addEventListener('click', () => explainUnsupported('img2img'));
  $('btn-send-upscale').addEventListener('click', () => explainUnsupported('upscale'));
  document.body.addEventListener('click', event => {
    const sizeBtn = event.target.closest('[data-size]');
    if (sizeBtn) { const [w,h] = sizeBtn.dataset.size.split('x'); $('width').value = w; $('height').value = h; $('preset').value = 'Custom'; }
    const unsupported = event.target.closest('[data-unsupported]');
    if (unsupported) explainUnsupported(unsupported.dataset.unsupported);
    const action = event.target.closest('[data-action]');
    if (action) {
      if (action.dataset.action === 'discover-assets') runDiscoverAssets();
      else if (action.dataset.action === 'check-model-stage') runModelStageCheck();
      else if (action.dataset.action === 'sdxl-smoke') runSdxlSmoke();
      else if (action.dataset.action === 'sdxl-turbo-smoke') runSdxlTurboSmoke();
      else if (action.dataset.action === 'flux-smoke') runFluxSmoke();
      else if (action.dataset.action === 'inventory-models') runModelInventory();
      else runSimpleAction(action.dataset.action);
    }
    const loraInsertBtn = event.target.closest('#btn-insert-lora');
    if (loraInsertBtn && !loraInsertBtn.disabled) {
      const sel = $('lora-select');
      const wt = $('lora-weight');
      if (sel && sel.value) {
        const weight = (wt && wt.value && !isNaN(Number(wt.value))) ? Number(wt.value) : 0.75;
        insertAtPrompt(`${sel.value}:${weight}`);
      }
    }
    const lora = event.target.closest('[data-insert-lora]');
    if (lora) insertAtPrompt(lora.dataset.insertLora);
    const detail = event.target.closest('[data-detail-run]');
    if (detail) showRunDetail(detail.dataset.detailRun);
    const compareInput = event.target.closest('[data-compare-run]');
    if (compareInput) toggleCompareRun(compareInput.dataset.compareRun, compareInput.checked);
    const compareImage = event.target.closest('[data-compare-image]');
    if (compareImage) openImageViewer(compareImage.dataset.compareImage, compareImage.dataset.compareImageRun, compareImage.dataset.compareImageName);
    const open = event.target.closest('[data-open-run]');
    if (open) openRun(open.dataset.openRun);
    const reuse = event.target.closest('[data-reuse-run]');
    if (reuse) reuseRun(reuse.dataset.reuseRun);
    const copy = event.target.closest('[data-copy-run]');
    if (copy) copyRun(copy.dataset.copyRun);
    const sendUpscale = event.target.closest('[data-send-upscale]');
    if (sendUpscale) sendToUpscale(sendUpscale.dataset.sendUpscale, sendUpscale.dataset.upscaleImage);
    const viewUpscaled = event.target.closest('[data-view-upscaled]');
    if (viewUpscaled) viewUpscaledOutputs(viewUpscaled.dataset.viewUpscaled);
    const sectionToggle = event.target.closest('[data-section-toggle]');
    if (sectionToggle) {
      const key = sectionToggle.dataset.sectionToggle;
      if (sectionToggle.checked) state.hiddenSections.delete(key);
      else state.hiddenSections.add(key);
      saveSectionVisibility();
    }
  });

  // Right-click context menu for any image with data-ctx-path set
  const ctxMenu = $('img-context-menu');
  let ctxTarget = null;
  document.addEventListener('contextmenu', e => {
    const img = e.target.closest('img[data-ctx-path]');
    if (!img || !ctxMenu) return;
    e.preventDefault();
    ctxTarget = img;
    ctxMenu.hidden = false;
    const x = Math.min(e.clientX, window.innerWidth - ctxMenu.offsetWidth - 8);
    const y = Math.min(e.clientY, window.innerHeight - ctxMenu.offsetHeight - 8);
    ctxMenu.style.left = x + 'px';
    ctxMenu.style.top = y + 'px';
  });
  document.addEventListener('click', () => { if (ctxMenu) ctxMenu.hidden = true; });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && ctxMenu) ctxMenu.hidden = true; });

  // Mobile sidebar toggle
  const sidebarToggle = $('btn-sidebar-toggle');
  const sidebar = $('app-sidebar');
  const backdrop = $('sidebar-backdrop');
  if (sidebarToggle && sidebar) {
    sidebarToggle.addEventListener('click', () => {
      const isOpen = sidebar.classList.contains('sidebar-open');
      sidebar.classList.toggle('sidebar-open', !isOpen);
      sidebarToggle.setAttribute('aria-expanded', String(!isOpen));
      if (backdrop) backdrop.hidden = isOpen;
    });
  }
  if (backdrop) backdrop.addEventListener('click', () => {
    if (sidebar) sidebar.classList.remove('sidebar-open');
    if (sidebarToggle) sidebarToggle.setAttribute('aria-expanded', 'false');
    backdrop.hidden = true;
  });

  // Batch / XYZ tabs
  const batchTabsBar = document.querySelector('.batch-tabs-bar');
  if (batchTabsBar) {
    batchTabsBar.addEventListener('click', e => {
      const tab = e.target.closest('[data-batch-tab]');
      if (!tab) return;
      batchTabsBar.querySelectorAll('[data-batch-tab]').forEach(t => {
        const active = t === tab;
        t.classList.toggle('active', active);
        t.setAttribute('aria-selected', String(active));
        const panel = $(t.dataset.batchTab);
        if (panel) panel.hidden = !active;
      });
    });
  }

  // Reset visible sections
  const resetSectionsBtn = $('btn-reset-sections');
  if (resetSectionsBtn) {
    resetSectionsBtn.addEventListener('click', () => {
      state.hiddenSections.clear();
      saveSectionVisibility();
      renderSectionToggles();
    });
  }
  if (ctxMenu) ctxMenu.addEventListener('click', e => {
    const btn = e.target.closest('.ctx-item');
    if (!btn || !ctxTarget) return;
    const imgPath = ctxTarget.dataset.ctxPath || '';
    const runId = ctxTarget.dataset.ctxRun || '';
    const filename = ctxTarget.dataset.ctxFile || imgPath.split('/').pop();
    const filePart = imgPath.includes('/') ? imgPath.split('/').slice(1).join('/') : imgPath;
    const imageUrl = imgPath ? '/api/run-file?path=' + encodeURIComponent(imgPath) : ctxTarget.src;
    switch (btn.dataset.action) {
      case 'view': openImageViewer(imgPath, runId, filename); break;
      case 'open-tab': window.open(imageUrl, '_blank'); break;
      case 'download': { const a = document.createElement('a'); a.href = imageUrl; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); break; }
      case 'copy-path': navigator.clipboard.writeText(imgPath).catch(() => {}); break;
      case 'img2img': sendToImg2img(runId, filePart); break;
      case 'inpaint': sendToInpaint(runId, filePart); break;
      case 'upscale': sendToUpscale(runId, filePart); break;
    }
    ctxMenu.hidden = true;
  });
}

async function init() {
  bindEvents();
  loadSectionVisibility();
  loadPromptDraft(false);
  await loadCapabilities();
  await loadOllamaModels();
  await loadGallery(true);
  setPill('pill-server', 'Check manually', 'run');
}
init();
