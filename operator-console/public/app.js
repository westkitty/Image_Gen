'use strict';

const state = { capabilities: null, runs: [], lastJob: null, lastParams: null, lastSeed: '', activeImage: null, poller: null, modelInventory: null, controlledTargets: [], controlledTargetMap: {}, libraryFilter: 'all', libraryIndex: [], libraryOffset: 0, libraryHasMore: false, libraryLoading: false };
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

const FALLBACK_CONTROLLED_TARGETS = [
  { id: 'sd15', label: 'SD1.5 standard', status: 'supported', mode: 'existing supported txt2img', caveat: 'Normal supported generation path. Full Automatic1111 parity is still not claimed.', defaultWidth: 512, defaultHeight: 512, defaultSteps: 20, defaultCfgScale: 7, defaultSampler: 'euler_a' },
  { id: 'sdxl-base', label: 'SDXL base', status: 'proofed', mode: 'proofed controlled generation', caveat: 'Controlled proofed path; not full A1111 parity.', defaultWidth: 512, defaultHeight: 512, defaultSteps: 4, defaultCfgScale: 7, defaultSampler: 'euler_a' },
  { id: 'sdxl-turbo', label: 'SDXL Turbo', status: 'proofed', mode: 'proofed controlled generation', caveat: 'Controlled proofed path; not full A1111 parity.', defaultWidth: 512, defaultHeight: 512, defaultSteps: 4, defaultCfgScale: 0, defaultSampler: 'euler_a' },
  { id: 'flux-fp8', label: 'Flux fp8', status: 'proofed', mode: 'proofed controlled generation', caveat: 'Controlled proofed path; not full A1111 parity. Uses the fp8 runtime-proven Flux file, not the full Flux file.', defaultWidth: 512, defaultHeight: 512, defaultSteps: 4, defaultCfgScale: 3.5, defaultSampler: 'euler' }
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
  if (!res.ok) throw new Error((json && json.error) || res.statusText);
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
  $('vae').innerHTML = (caps.vaes || []).map(v => `<option value="${esc(v.id)}">${esc(v.name)}</option>`).join('') || '<option value="auto">Auto</option>';
  $('sampler').innerHTML = (caps.samplers || []).map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
  $('scheduler').innerHTML = (caps.schedulers || []).map(s => `<option value="${esc(s.id)}" ${s.supported ? '' : 'data-limited="1"'}>${esc(s.name)}${s.supported ? '' : ' — visible only'}</option>`).join('');
  $('aspect-presets').innerHTML = ASPECTS.map(([label, w, h]) => `<button type="button" class="ghost small" data-size="${w}x${h}">${label} ${w}×${h}</button>`).join('');
  $('set-save-prompts').checked = loadBool('savePrompts');
  applyPreset('quality');
  const selectedTarget = $('model').value || 'sd15';
  applyControlledTargetDefaults(selectedTarget);
  loadStyles();
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
    save_prompts: $('set-save-prompts').checked
  };
}

function setPreviewImage(url, title = 'Selected image') {
  state.activeImage = url;
  $('preview-stage').innerHTML = `<img src="${esc(url)}" alt="${esc(title)}" />`;
  $('preview-subtitle').textContent = title;
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
  $('latest-job').textContent = label;
  clearInterval(state.poller);
  state.poller = setInterval(() => pollJob(jobId), 1200);
  await pollJob(jobId);
}
async function pollJob(jobId) {
  try {
    const job = await api(`/api/jobs/${jobId}`);
    const log = await api(`/api/jobs/${jobId}/log`);
    notifyLog([log.stdout, log.stderr].filter(Boolean).join('\n\n'));
    const targetLine = job.controlledTarget ? `<br>Target: ${esc(job.controlledTarget)}` : '';
    const outputLine = job.controlledOutputImage ? `<br>Output: ${esc(job.controlledOutputImage)}` : '';
    $('latest-job').innerHTML = `<strong>${esc(job.commandAction)}</strong><br>Status: ${esc(job.status)}${targetLine}${outputLine}${job.runId ? `<br>Run: ${esc(job.runId)}` : ''}`;
    if (job.status !== 'running' && job.status !== 'queued') {
      clearInterval(state.poller);
      setPill('pill-job', job.status, job.status === 'PASS' ? 'ok' : job.status === 'PARTIAL' ? 'run' : 'bad');
      setPill('pill-latest', job.status, job.status === 'PASS' ? 'ok' : 'bad');
      if (job.runId) await loadRunIntoPreview(job.runId);
      await loadGallery(true);
    }
  } catch (err) { notifyLog(err.message); }
}
async function loadRunIntoPreview(runId) {
  try {
    const detail = await api(`/api/runs/${runId}`);
    const image = detail.images && detail.images[0];
    if (image) setPreviewImage(`/api/run-file?path=${encodeURIComponent(`${runId}/${image}`)}`, `Run ${runId}`);
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
    ['upscale', 'AI / Extras Upscale', 'Real-ESRGAN, tiled finalization, A1111 Extras parity.'],
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
        setPreviewImage(imgUrl, 'Upscaled: ' + job.upscaledImage);
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
      msg.textContent = 'No runs match this filter.';
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
}

function openImageViewer(imgPath, runId, filename) {
  const overlay = $('image-viewer-overlay');
  const img = $('image-viewer-img');
  const info = $('image-viewer-info');
  if (!overlay || !img) return;
  img.src = '/api/run-file?path=' + encodeURIComponent(imgPath);
  img.alt = filename || imgPath;
  if (info) info.textContent = (runId ? runId + '  ·  ' : '') + (filename || imgPath);
  overlay.hidden = false;
  overlay.focus();
  [['btn-viewer-copy-path', () => navigator.clipboard.writeText(imgPath).catch(() => {})],
   ['btn-viewer-upscale', () => { closeImageViewer(); const parts = imgPath.split('/'); sendToUpscale(runId, parts.slice(1).join('/')); }],
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
  return 'badge-other';
}

function runIndexCard(r) {
  const img = r.primaryImage;
  const imgUrl = img ? '/api/run-file?path=' + encodeURIComponent(r.id + '/' + img) : '';
  const badgeClass = runTypeBadgeClass(r.filterCategory, r.status);
  const labelText = r.controlledTargetLabel || r.type || r.id;
  const statusBadge = r.status === 'FAIL' ? ' <span class="run-type-badge badge-fail">FAIL</span>' : '';
  const upscaledBadge = r.hasUpscaled ? '<span class="derived-badge">Upscaled ✓</span>' : '';
  return '<article class="image-card" data-run="' + esc(r.id) + '">' +
    (imgUrl ? '<img src="' + esc(imgUrl) + '" alt="Run ' + esc(r.id) + '" loading="lazy" />' : '<div style="height:120px;background:#071018;border-radius:14px;margin-bottom:8px"></div>') +
    '<div class="run-type-badge ' + esc(badgeClass) + '">' + esc(labelText) + '</div>' + statusBadge + upscaledBadge +
    '<h3 style="margin:4px 0 2px">' + esc(r.title || r.type) + '</h3>' +
    '<p>' + esc(r.createdAt ? r.createdAt.replace(/(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/, '$1-$2-$3 $4:$5') : '') + ' · ' + esc(String(r.imageCount || 0)) + ' img</p>' +
    '<div class="quick-row" style="margin-top:6px">' +
    '<button class="ghost small" data-detail-run="' + esc(r.id) + '">Detail</button>' +
    '<button class="ghost small" data-send-upscale="' + esc(r.id) + '"' + (img ? ' data-upscale-image="' + esc(img) + '"' : '') + '>Upscale</button>' +
    '</div></article>';
}

function closeRunDetail() {
  const overlay = $('run-detail-overlay');
  if (overlay) overlay.hidden = true;
}

function showCreateNote(msg, variant) {
  const note = $('create-note');
  if (!note) return;
  note.textContent = msg || '';
  note.className = 'create-note' + (variant ? ' ' + variant : '');
  note.hidden = !msg;
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
  if (replay.privacy_note) { noteMsg += ' ' + replay.privacy_note; noteVariant = 'privacy'; }
  if (replay.flux_caveat) { noteMsg += ' ' + replay.flux_caveat; noteVariant = noteVariant || 'flux'; }
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
  const btnManifest = $('btn-detail-view-manifest');

  // Remove previous listeners by cloning; hide reuse until metadata confirms availability
  [btnBack, btnReuse, btnCopyId, btnCopyPath, btnSendUpscale, btnManifest].forEach(b => {
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
  const filterCat = isControlled ? 'controlled' : isSmoke ? 'smoke' : runType === 'hires-fix' ? 'hires-fix' : 'other';
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
  const failedGateHtml = (status === 'FAIL' && firstFailedGate)
    ? '<div class="run-detail-failed-gate"><strong>First failed gate:</strong> ' + esc(firstFailedGate) + '</div>'
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
  $('btn-detail-send-upscale').addEventListener('click', () => {
    if (primaryImage) sendToUpscale(runId, primaryImage);
    closeRunDetail();
    showScreen('enhance');
  });
  $('btn-detail-view-manifest').addEventListener('click', () => {
    if (manifestForView) notifyLog(JSON.stringify(manifestForView, null, 2));
    showScreen('system');
    closeRunDetail();
  });

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
    setPreviewImage('/api/run-file?path=' + encodeURIComponent(runId + '/' + first), 'Upscaled: ' + first);
    showScreen('create');
    notifyLog('Upscaled outputs in run ' + runId + ':\n' + upscaledImages.join('\n'));
  } catch (err) { notifyLog('Error loading upscaled outputs: ' + err.message); }
}
async function openRun(id) {
  const detail = await api(`/api/runs/${id}`);
  const image = detail.images && detail.images[0];
  if (image) setPreviewImage(`/api/run-file?path=${encodeURIComponent(`${id}/${image}`)}`, `Run ${id}`);
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
    if (btn.dataset.target === 'enhance') loadEnhanceRuns();
  }));
  $('form-create').addEventListener('submit', submitCreate);
  $('form-batch').addEventListener('submit', submitBatch);
  $('form-upscale').addEventListener('submit', submitUpscale);
  $('upscale-run').addEventListener('change', onUpscaleRunChange);
  $('form-hires-fix').addEventListener('submit', submitHiresFix);
  $('form-xyz').addEventListener('submit', submitXyz);
  $('model').addEventListener('change', e => applyControlledTargetDefaults(e.target.value));
  $('xyz_x_values').addEventListener('input', updateXyzCellCount);
  $('xyz_y_values').addEventListener('input', updateXyzCellCount);
  $('xyz_y_type').addEventListener('change', updateXyzCellCount);
  $('preset').addEventListener('change', e => { if (e.target.value !== 'Custom') applyPreset(e.target.value); });
  ['steps','cfg_scale','sampler','width','height'].forEach(id => $(id).addEventListener('input', () => { $('preset').value = 'Custom'; }));
  $('prompt').addEventListener('input', () => $('prompt-count').textContent = `${$('prompt').value.length} chars`);
  $('style-select').addEventListener('change', e => { if (e.target.value) $('prompt').value = `${$('prompt').value.trim()} ${e.target.value}`.trim(); });
  $('btn-save-style').addEventListener('click', saveCurrentStyle);
  $('set-save-prompts').addEventListener('change', e => saveBool('savePrompts', e.target.checked));
  $('btn-random-seed').addEventListener('click', () => { $('seed').value = String(Math.floor(Math.random() * 2147483647)); });
  $('btn-reuse-seed').addEventListener('click', () => { if (state.lastSeed) $('seed').value = state.lastSeed; });
  $('btn-load-library').addEventListener('click', () => loadGallery(true));
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
  const loadMoreBtn = $('btn-load-more');
  if (loadMoreBtn) loadMoreBtn.addEventListener('click', () => loadGallery(false));
  const viewerOverlay = $('image-viewer-overlay');
  if (viewerOverlay) viewerOverlay.addEventListener('click', e => { if (e.target === viewerOverlay) closeImageViewer(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      const vo = $('image-viewer-overlay');
      if (vo && !vo.hidden) { closeImageViewer(); return; }
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
    const lora = event.target.closest('[data-insert-lora]');
    if (lora) insertAtPrompt(lora.dataset.insertLora);
    const detail = event.target.closest('[data-detail-run]');
    if (detail) showRunDetail(detail.dataset.detailRun);
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
  });
}

async function init() {
  bindEvents();
  await loadCapabilities();
  await loadGallery(true);
  setPill('pill-server', 'Check manually', 'run');
}
init();
