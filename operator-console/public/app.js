// Operator Console — Client Controller
// Security note: all dynamic user content is passed through escapeHtml() before
// insertion into innerHTML. No raw user input is ever set as innerHTML directly.

let activeJobInterval = null;
let allRunsCache = [];

const PRESETS = {
  smoke:        { steps: 1,  cfg: 7.0, sampler: 'euler_a', width: 512, height: 512 },
  thumbnail:    { steps: 4,  cfg: 7.0, sampler: 'euler_a', width: 384, height: 384 },
  fast:         { steps: 8,  cfg: 7.0, sampler: 'euler_a', width: 512, height: 512 },
  balanced:     { steps: 16, cfg: 7.0, sampler: 'euler_a', width: 512, height: 512 },
  quality:      { steps: 20, cfg: 7.0, sampler: 'euler_a', width: 512, height: 512 },
  quality_plus: { steps: 30, cfg: 7.0, sampler: 'euler_a', width: 512, height: 512 }
};

// All user-controlled values are sanitized before HTML insertion
function escapeHtml(unsafe) {
  if (unsafe === undefined || unsafe === null) return '';
  if (typeof unsafe !== 'string') return String(unsafe);
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ============================================================
// SETTINGS
// ============================================================
function loadSettings() {
  const preset      = localStorage.getItem('defPreset')     || 'fast';
  const mode        = localStorage.getItem('defMode')       || 'cli';
  const steps       = localStorage.getItem('defSteps')      || '8';
  const cfg         = localStorage.getItem('defCfg')        || '7.0';
  const sampler     = localStorage.getItem('defSampler')    || 'euler_a';
  const width       = localStorage.getItem('defWidth')      || '512';
  const height      = localStorage.getItem('defHeight')     || '512';
  const count       = localStorage.getItem('defBatchCount') || '3';
  const autoOpen    = localStorage.getItem('autoOpen')    === 'true';
  const savePrompts = localStorage.getItem('savePrompts') === 'true';

  document.getElementById('set-default-preset').value = preset;
  document.getElementById('set-default-mode').value   = mode;
  document.getElementById('set-default-steps').value  = steps;
  document.getElementById('set-default-cfg').value    = cfg;
  document.getElementById('set-default-width').value  = width;
  document.getElementById('set-default-height').value = height;
  document.getElementById('set-batch-count').value    = count;
  document.getElementById('set-auto-open').checked    = autoOpen;
  document.getElementById('set-save-prompts').checked = savePrompts;

  document.getElementById('gen-preset').value   = preset;
  document.getElementById('gen-mode').value     = mode;
  document.getElementById('gen-steps').value    = steps;
  document.getElementById('gen-cfg').value      = cfg;
  document.getElementById('gen-sampler').value  = sampler;
  document.getElementById('gen-width').value    = width;
  document.getElementById('gen-height').value   = height;

  document.getElementById('batch-preset').value = preset;
  document.getElementById('batch-mode').value   = mode;
  document.getElementById('batch-count').value  = count;

  updatePrivacyIndicator();
  updatePrivacyWarning();
}

function saveSettings() {
  const preset      = document.getElementById('set-default-preset').value;
  const mode        = document.getElementById('set-default-mode').value;
  const steps       = document.getElementById('set-default-steps').value;
  const cfg         = document.getElementById('set-default-cfg').value;
  const width       = document.getElementById('set-default-width').value;
  const height      = document.getElementById('set-default-height').value;
  const count       = document.getElementById('set-batch-count').value;
  const autoOpen    = document.getElementById('set-auto-open').checked;
  const savePrompts = document.getElementById('set-save-prompts').checked;

  localStorage.setItem('defPreset',     preset);
  localStorage.setItem('defMode',       mode);
  localStorage.setItem('defSteps',      steps);
  localStorage.setItem('defCfg',        cfg);
  localStorage.setItem('defWidth',      width);
  localStorage.setItem('defHeight',     height);
  localStorage.setItem('defBatchCount', count);
  localStorage.setItem('autoOpen',      autoOpen    ? 'true' : 'false');
  localStorage.setItem('savePrompts',   savePrompts ? 'true' : 'false');

  updatePrivacyIndicator();
  updatePrivacyWarning();

  const msg = document.getElementById('settings-saved-msg');
  msg.classList.remove('hidden');
  setTimeout(() => msg.classList.add('hidden'), 2200);
}

function updatePrivacyIndicator() {
  const savePrompts = localStorage.getItem('savePrompts') === 'true';
  const el = document.getElementById('gen-privacy-indicator');
  if (!el) return;
  // Use textContent for the text portion; build the element safely
  el.className = savePrompts ? 'privacy-indicator privacy-warn' : 'privacy-indicator';
  const icon = el.querySelector('svg');
  const txt  = el.querySelector('span') || document.createTextNode('');
  if (savePrompts) {
    el.setAttribute('title', 'Prompts will be saved to run records');
    if (icon) icon.innerHTML = '<path d="M6 1L1 10h10L6 1z"/><line x1="6" y1="5" x2="6" y2="7.5"/><circle cx="6" cy="9" r="0.5" fill="currentColor"/>';
    if (txt instanceof Text) {
      txt.nodeValue = ' Prompts saved in records';
    } else {
      txt.textContent = 'Prompts saved in records';
    }
  } else {
    el.setAttribute('title', 'Prompt text is ephemeral and will not be saved to run records');
    if (icon) icon.innerHTML = '<rect x="2" y="5" width="8" height="6" rx="1"/><path d="M4 5V3.5a2 2 0 014 0V5"/>';
    if (txt instanceof Text) {
      txt.nodeValue = ' Prompts redacted in records';
    } else {
      txt.textContent = 'Prompts redacted in records';
    }
  }
}

function updatePrivacyWarning() {
  const savePrompts = document.getElementById('set-save-prompts').checked;
  const warn = document.getElementById('settings-privacy-warning');
  if (warn) warn.style.display = savePrompts ? 'block' : 'none';
}

document.getElementById('set-save-prompts').addEventListener('change', updatePrivacyWarning);

// ============================================================
// STATUS PILLS
// ============================================================
function setPillState(pillId, state, value) {
  const pill = document.getElementById(pillId);
  if (!pill) return;
  pill.className = 'status-pill' + (state ? ' pill-' + state : '');
  const val = pill.querySelector('.pill-value');
  if (val && value !== undefined) val.textContent = value;
}

function setGlobalStatus(backend, job, server, latest) {
  if (backend !== undefined) {
    const st = backend === 'Ready' ? 'ok' : backend === 'Checking' ? 'run' : 'err';
    setPillState('pill-backend', st, backend);
  }
  if (job !== undefined) {
    const st = job === 'Running' ? 'run' : job === 'Idle' ? 'ok' : 'warn';
    setPillState('pill-job', st, job);
    const genBtn = document.getElementById('btn-generate-submit');
    document.querySelectorAll('button[type="submit"]').forEach(b => b.disabled = (job === 'Running'));
    if (genBtn) {
      if (job === 'Running') genBtn.classList.add('running');
      else genBtn.classList.remove('running');
    }
  }
  if (server !== undefined) {
    const st = server === 'Running' ? 'ok' : (server.includes('Checking') ? 'run' : 'warn');
    setPillState('pill-server', st, server);
  }
  if (latest !== undefined) {
    const st = latest === 'PASS' ? 'ok' : latest === 'FAIL' ? 'err' : latest === 'PARTIAL' ? 'warn' : '';
    setPillState('pill-latest', st, latest);
  }
}

// ============================================================
// NAVIGATION
// ============================================================
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', e => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    e.currentTarget.classList.add('active');
    const targetId = e.currentTarget.getAttribute('data-target');
    const section  = document.getElementById(targetId);
    if (section) section.classList.add('active');

    if (targetId === 'dashboard') loadLatestRun();
    if (targetId === 'gallery')   loadGallery();
    if (targetId === 'history')   loadRuns();
    if (targetId === 'server')    checkServerStatusSilent();
  });
});

function navigateToRunDetail(runId) {
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.getElementById('run-detail').classList.add('active');
  loadRunDetail(runId);
}

document.getElementById('btn-back-to-history').addEventListener('click', () => {
  document.getElementById('btn-nav-history').click();
});

// ============================================================
// PRESET SYNC
// ============================================================
document.getElementById('gen-preset').addEventListener('change', e => {
  const val = e.target.value;
  if (val && val !== 'Custom' && PRESETS[val]) {
    const c = PRESETS[val];
    document.getElementById('gen-steps').value   = c.steps;
    document.getElementById('gen-cfg').value     = c.cfg;
    document.getElementById('gen-sampler').value = c.sampler;
    document.getElementById('gen-width').value   = c.width;
    document.getElementById('gen-height').value  = c.height;
  }
});

['gen-steps','gen-cfg','gen-sampler','gen-width','gen-height'].forEach(id => {
  document.getElementById(id).addEventListener('input', () => {
    document.getElementById('gen-preset').value = 'Custom';
  });
});

// ============================================================
// JOB DRAWER
// ============================================================
function openJobDrawer(title) {
  document.getElementById('job-drawer').classList.remove('hidden');
  document.getElementById('job-drawer-title').textContent = title;
  document.getElementById('job-drawer-error').classList.add('hidden');
  document.getElementById('job-drawer-log-wrap').classList.add('hidden');
  document.getElementById('job-drawer-status').textContent = 'Starting…';
  document.getElementById('job-drawer-log').textContent = '';
}

function closeJobDrawer() {
  document.getElementById('job-drawer').classList.add('hidden');
}

function toggleJobLog() {
  document.getElementById('job-drawer-log-wrap').classList.toggle('hidden');
}

// ============================================================
// STAGE STATE
// ============================================================
function setStageLoading() {
  const canvas = document.getElementById('preview-single');
  if (!canvas) return;
  canvas.className = 'stage-canvas';
  const shimmer = document.createElement('div');
  shimmer.className = 'stage-shimmer';
  canvas.replaceChildren(shimmer);
}

function setStageEmpty() {
  const canvas = document.getElementById('preview-single');
  if (!canvas) return;
  canvas.className = 'stage-canvas';

  const wrap = document.createElement('div');
  wrap.className = 'stage-empty';

  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('class', 'stage-empty-icon');
  icon.setAttribute('viewBox', '0 0 40 40');
  icon.setAttribute('fill', 'none');
  icon.setAttribute('stroke', 'currentColor');
  icon.setAttribute('stroke-width', '1.2');
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = '<rect x="4" y="4" width="32" height="32" rx="4"/><circle cx="14" cy="14" r="4"/><polyline points="4 28 14 18 22 26 28 20 36 28"/>';

  const t1 = document.createElement('p');
  t1.className = 'stage-empty-title';
  t1.textContent = 'No verified image yet.';

  const t2 = document.createElement('p');
  t2.className = 'stage-empty-sub';
  t2.textContent = 'Generate a fast SD 1.5 image and it will appear here, centered and ready.';

  wrap.appendChild(icon);
  wrap.appendChild(t1);
  wrap.appendChild(t2);
  canvas.replaceChildren(wrap);
}

// ============================================================
// API JOB RUNNER
// ============================================================
async function runJob(endpoint, payload, actionName) {
  setGlobalStatus('Checking', 'Running', undefined, undefined);
  openJobDrawer(actionName || 'Job');
  if (endpoint.includes('generate')) setStageLoading();

  try {
    const res  = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload ? JSON.stringify(payload) : undefined
    });
    const data = await res.json();
    if (data.job_id) {
      pollJob(data.job_id, endpoint);
    } else {
      document.getElementById('job-drawer-status').textContent =
        'Error: ' + (data.error || JSON.stringify(data));
      setGlobalStatus('Failed', 'Idle', undefined, undefined);
      if (endpoint.includes('generate')) setStageEmpty();
    }
  } catch (err) {
    document.getElementById('job-drawer-status').textContent = 'Fetch error: ' + err.message;
    setGlobalStatus('Unknown', 'Idle', undefined, undefined);
    if (endpoint.includes('generate')) setStageEmpty();
  }
}

function pollJob(jobId, endpoint) {
  if (activeJobInterval) clearInterval(activeJobInterval);

  activeJobInterval = setInterval(async () => {
    try {
      const [logRes, statusRes] = await Promise.all([
        fetch('/api/jobs/' + jobId + '/log'),
        fetch('/api/jobs/' + jobId)
      ]);
      const logData    = await logRes.json();
      const statusData = await statusRes.json();

      const logText = (logData.stdout || '') + '\n' + (logData.stderr || '');
      document.getElementById('job-drawer-log').textContent = logText || 'Waiting for output…';
      const logWrap = document.getElementById('job-drawer-log-wrap');
      logWrap.scrollTop = logWrap.scrollHeight;

      const elapsed = Math.floor((Date.now() - statusData.createdAt) / 1000);
      document.getElementById('job-drawer-status').textContent =
        'Elapsed: ' + elapsed + 's | Status: ' + statusData.status;

      const terminal = ['PASS','FAIL','PARTIAL'].includes(statusData.status);
      if (!terminal) return;

      clearInterval(activeJobInterval);
      setGlobalStatus(statusData.status === 'PASS' ? 'Ready' : 'Failed', 'Idle', undefined, statusData.status);

      if (statusData.status === 'FAIL') {
        document.getElementById('job-drawer-error').classList.remove('hidden');
        document.getElementById('job-drawer-gate').textContent =
          statusData.firstFailedGate || 'Unknown';
      }

      const isGen = statusData.commandAction &&
        (statusData.commandAction.includes('generate') || statusData.commandAction.includes('cli'));
      const autoOpen = localStorage.getItem('autoOpen') === 'true';

      if (statusData.runId && statusData.status === 'PASS' && isGen) {
        await renderInlinePreview(statusData.runId);
        setTimeout(() => {
          closeJobDrawer();
          if (autoOpen) navigateToRunDetail(statusData.runId);
        }, 800);
      } else {
        if (statusData.status !== 'PASS' && (endpoint || '').includes('generate')) {
          setStageEmpty();
        }
        setTimeout(() => closeJobDrawer(), 1500);
      }

      loadLatestRun();
    } catch (err) {
      clearInterval(activeJobInterval);
      setGlobalStatus('Unknown', 'Idle', undefined, undefined);
    }
  }, 1000);
}

// ============================================================
// INLINE PREVIEW — maps to new stage-canvas layout
// ============================================================
async function renderInlinePreview(runId) {
  const canvas    = document.getElementById('preview-single');
  const metaPanel = document.getElementById('preview-metadata-panel');

  canvas.className = 'stage-canvas';
  setStageLoading();

  try {
    const res  = await fetch('/api/runs/' + encodeURIComponent(runId));
    const data = await res.json();
    if (data.error || !data.metadata) {
      const errP = document.createElement('p');
      errP.className = 'text-danger';
      errP.style.padding = '20px';
      errP.textContent = 'Failed to fetch run data.';
      canvas.replaceChildren(errP);
      return;
    }

    const m = data.metadata;
    if (m.primaryImage) {
      const imgSrc = '/api/run-file?path=' +
        encodeURIComponent(runId) + '/' + encodeURIComponent(m.primaryImage);

      canvas.className = 'stage-canvas stage-success';
      const img = document.createElement('img');
      img.src = imgSrc;
      img.alt = 'Generated image';
      canvas.replaceChildren(img);

      metaPanel.classList.remove('hidden');
      document.getElementById('preview-run-id').textContent = m.id;
      document.getElementById('preview-meta-details').textContent = m.settings || m.status || '';

      const valEl = document.getElementById('preview-prompt-val');
      if (!m.prompt || m.prompt === '[REDACTED]') {
        valEl.textContent = 'Prompt redacted';
      } else {
        const savePrompts = localStorage.getItem('savePrompts') === 'true';
        valEl.textContent = savePrompts ? m.prompt : 'Prompt redacted (legacy run)';
      }

      document.getElementById('btn-preview-detail').onclick  = () => navigateToRunDetail(runId);
      document.getElementById('btn-preview-gallery').onclick = () =>
        document.getElementById('btn-nav-gallery').click();
    } else {
      canvas.className = 'stage-canvas';
      const wrap = document.createElement('div');
      wrap.className = 'stage-empty';
      const t1 = document.createElement('p');
      t1.className = 'stage-empty-title';
      t1.style.color = 'var(--green)';
      t1.textContent = 'Verified PNG ready.';
      const t2 = document.createElement('p');
      t2.className = 'stage-empty-sub';
      t2.textContent = 'Run completed successfully but no previewable image found.';
      wrap.appendChild(t1);
      wrap.appendChild(t2);
      canvas.replaceChildren(wrap);
      metaPanel.classList.add('hidden');
    }
  } catch (e) {
    const errP = document.createElement('p');
    errP.className = 'text-danger';
    errP.style.padding = '20px';
    errP.textContent = 'Failed to load preview.';
    canvas.replaceChildren(errP);
    metaPanel.classList.add('hidden');
  }
}

// ============================================================
// GENERATE FORMS
// ============================================================
function submitGenerateSingle() {
  const prompt          = document.getElementById('gen-prompt').value;
  const negative_prompt = document.getElementById('gen-negative').value;
  const preset          = document.getElementById('gen-preset').value;
  const mode            = document.getElementById('gen-mode').value;
  const steps           = document.getElementById('gen-steps').value;
  const cfg_scale       = document.getElementById('gen-cfg').value;
  const sampler         = document.getElementById('gen-sampler').value;
  const width           = document.getElementById('gen-width').value;
  const height          = document.getElementById('gen-height').value;
  const seed            = document.getElementById('gen-seed').value;
  const save_prompts    = localStorage.getItem('savePrompts') === 'true';

  const payload = {
    prompt, negative_prompt, preset, mode,
    steps:     steps     ? parseInt(steps)       : undefined,
    cfg_scale: cfg_scale ? parseFloat(cfg_scale) : undefined,
    sampler,
    width:     width     ? parseInt(width)        : undefined,
    height:    height    ? parseInt(height)       : undefined,
    save_prompts
  };
  if (seed) payload.seed = seed;
  runJob('/api/actions/generate-single', payload, 'Generate Single');
}

function submitGenerateBatch() {
  const prompt          = document.getElementById('batch-prompt').value;
  const negative_prompt = document.getElementById('batch-negative').value;
  const count           = document.getElementById('batch-count').value;
  const preset          = document.getElementById('batch-preset').value;
  const seedMode        = document.getElementById('batch-seed-mode').value;
  const seedStart       = document.getElementById('batch-seed-start').value;
  const mode            = document.getElementById('batch-mode').value;
  const api             = document.getElementById('batch-api').value;
  const save_prompts    = localStorage.getItem('savePrompts') === 'true';

  runJob('/api/actions/generate-batch',
    { prompt, negative_prompt, count: parseInt(count), preset, seedMode, seedStart, mode, api, save_prompts },
    'Batch Explore');
}

function submitServerAction(action) {
  runJob('/api/actions/' + action, null, action.toUpperCase().replace(/-/g, ' '));
}

function submitCleanup() {
  const days = document.getElementById('cleanup-days').value;
  if (confirm('Delete runs older than ' + days + ' days. This cannot be undone. Continue?')) {
    runJob('/api/actions/clean-old-runs', { days: parseInt(days) }, 'Cleanup Old Runs');
  }
}

// ============================================================
// GALLERY
// ============================================================
async function loadGallery() {
  const grid  = document.getElementById('gallery-grid');
  const count = document.getElementById('gallery-count');

  // Clear and show loading state (safe DOM, no innerHTML)
  const loadP = document.createElement('p');
  loadP.className = 'text-muted';
  loadP.style.cssText = 'padding:8px;font-size:13px;';
  loadP.textContent = 'Loading…';
  grid.replaceChildren(loadP);
  if (count) count.textContent = '—';

  try {
    const res      = await fetch('/api/runs');
    const data     = await res.json();
    const imageRuns = data.runs.filter(r =>
      r.primaryImage && r.type !== 'verify' && r.type !== 'server-status'
    );

    grid.replaceChildren();
    if (count) count.textContent = imageRuns.length + ' image' + (imageRuns.length !== 1 ? 's' : '');

    if (imageRuns.length === 0) {
      const p = document.createElement('p');
      p.className = 'text-muted';
      p.style.cssText = 'padding:8px;font-size:13px;';
      p.textContent = 'No images yet. Generate some images to populate the gallery.';
      grid.appendChild(p);
      return;
    }

    imageRuns.forEach(run => {
      const card    = document.createElement('div');
      card.className = 'gallery-card';
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      card.addEventListener('click', () => navigateToRunDetail(run.id));
      card.addEventListener('keydown', e => { if (e.key === 'Enter') navigateToRunDetail(run.id); });

      const imgUrl = '/api/run-file?path=' +
        encodeURIComponent(run.id) + '/' + encodeURIComponent(run.primaryImage);

      // Image wrapper
      const imgWrap = document.createElement('div');
      imgWrap.className = 'gallery-card-img';
      const img = document.createElement('img');
      img.src     = imgUrl;
      img.alt     = 'Generated image';
      img.loading = 'lazy';
      imgWrap.appendChild(img);

      // Info
      const info = document.createElement('div');
      info.className = 'gallery-card-info';

      const titleRow = document.createElement('div');
      titleRow.className = 'gallery-card-title';
      const titleSpan = document.createElement('span');
      titleSpan.textContent = run.title || run.type;
      const badge = document.createElement('span');
      badge.className = 'badge ' + (run.status === 'PASS' ? 'badge-pass' : 'badge-fail');
      badge.textContent = run.status;
      titleRow.appendChild(titleSpan);
      titleRow.appendChild(badge);

      const meta = document.createElement('div');
      meta.className = 'gallery-card-meta';
      meta.textContent = run.id;

      const promptEl = document.createElement('div');
      const hasPrompt = run.prompt && run.prompt !== '[REDACTED]';
      if (hasPrompt) {
        promptEl.className = 'gallery-card-prompt';
        promptEl.textContent = run.prompt;
      } else {
        promptEl.className = 'gallery-card-prompt text-muted';
        promptEl.style.fontStyle = 'italic';
        promptEl.style.opacity = '0.6';
        promptEl.textContent = 'Prompt redacted';
      }

      info.appendChild(titleRow);
      info.appendChild(meta);
      info.appendChild(promptEl);

      card.appendChild(imgWrap);
      card.appendChild(info);
      grid.appendChild(card);
    });
  } catch (e) {
    const errP = document.createElement('p');
    errP.className = 'text-danger';
    errP.style.cssText = 'padding:8px;font-size:13px;';
    errP.textContent = 'Failed to load gallery.';
    grid.replaceChildren(errP);
  }
}

// ============================================================
// RUN HISTORY
// ============================================================
function applyPromptSearchState() {
  const savePrompts = localStorage.getItem('savePrompts') === 'true';
  const input = document.getElementById('filter-prompt');
  const note  = document.getElementById('filter-prompt-note');
  if (!input) return;
  if (savePrompts) {
    input.disabled    = false;
    input.placeholder = 'Search prompts…';
    if (note) note.textContent = '';
  } else {
    input.disabled    = true;
    input.value       = '';
    input.placeholder = 'Disabled (privacy on)';
    if (note) note.textContent = 'Prompt search disabled while prompts are redacted.';
  }
}

async function loadRuns() {
  const res  = await fetch('/api/runs');
  const data = await res.json();
  allRunsCache = data.runs;
  applyPromptSearchState();
  renderRunHistory();
}

function renderRunHistory() {
  const list = document.getElementById('run-list');
  list.replaceChildren();

  if (allRunsCache.length === 0) {
    const p = document.createElement('p');
    p.className   = 'text-muted';
    p.style.fontSize = '13px';
    p.textContent = 'No runs found.';
    list.appendChild(p);
    return;
  }

  const fType   = document.getElementById('filter-type').value;
  const fStatus = document.getElementById('filter-status').value;
  const fPrompt = document.getElementById('filter-prompt').value.toLowerCase();

  const filtered = allRunsCache.filter(run => {
    if (fType   && run.type   !== fType)   return false;
    if (fStatus && run.status !== fStatus) return false;
    if (fPrompt && (!run.prompt || !run.prompt.toLowerCase().includes(fPrompt))) return false;
    return true;
  });

  if (filtered.length === 0) {
    const p = document.createElement('p');
    p.className   = 'text-muted';
    p.style.fontSize = '13px';
    p.textContent = 'No runs match filters.';
    list.appendChild(p);
    return;
  }

  filtered.forEach(run => {
    const item = document.createElement('div');
    item.className = 'run-table-row';
    item.setAttribute('role', 'button');
    item.setAttribute('tabindex', '0');
    item.addEventListener('click', () => navigateToRunDetail(run.id));
    item.addEventListener('keydown', e => { if (e.key === 'Enter') navigateToRunDetail(run.id); });

    const hasPrompt = run.prompt && run.prompt !== '[REDACTED]';
    const displayPrompt = hasPrompt
      ? (localStorage.getItem('savePrompts') !== 'true' ? run.prompt + ' (legacy — stored)' : run.prompt)
      : 'Prompt redacted';

    const statusClass = run.status === 'PASS'    ? 'badge-pass'
                      : run.status === 'FAIL'    ? 'badge-fail'
                      : run.status === 'PARTIAL' ? 'badge-partial'
                      : 'badge-log';

    // Date/time from run ID e.g. 20260620-181408-cli
    const parts   = run.id.split('-');
    const dateRaw = parts[0] || '';
    const timeRaw = parts[1] || '';
    const dateStr = dateRaw.replace(/(\d{4})(\d{2})(\d{2})/, '$2/$3');
    const timeStr = timeRaw.replace(/(\d{2})(\d{2})(\d{2})/, '$1:$2');

    // Build cells using textContent (safe)
    const badge = document.createElement('span');
    badge.className = 'badge ' + statusClass;
    badge.textContent = run.status;

    const dt = document.createElement('span');
    dt.className = 'mono text-muted';
    dt.style.fontSize = '11px';
    dt.textContent = dateStr + ' ' + timeStr;

    const type = document.createElement('strong');
    type.style.fontSize = '12.5px';
    type.textContent = run.title || run.type;

    const prompt = document.createElement('span');
    prompt.className = 'text-muted';
    prompt.style.cssText = 'font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
    prompt.textContent = displayPrompt;

    const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    arrow.setAttribute('viewBox', '0 0 10 10');
    arrow.setAttribute('fill', 'none');
    arrow.setAttribute('stroke', 'currentColor');
    arrow.setAttribute('stroke-width', '1.5');
    arrow.setAttribute('width', '10');
    arrow.setAttribute('height', '10');
    arrow.setAttribute('aria-hidden', 'true');
    arrow.style.cssText = 'color:var(--text-muted);flex-shrink:0;';
    arrow.innerHTML = '<polyline points="3 2 7 5 3 8"/>';

    item.appendChild(badge);
    item.appendChild(dt);
    item.appendChild(type);
    item.appendChild(prompt);
    item.appendChild(arrow);
    list.appendChild(item);
  });
}

// ============================================================
// DASHBOARD — LATEST RUN
// ============================================================
async function loadLatestRun() {
  try {
    const res  = await fetch('/api/runs');
    const data = await res.json();
    if (!data.runs || data.runs.length === 0) return;

    const latest    = data.runs[0];
    const targetDiv = document.getElementById('dashboard-latest-run');
    setGlobalStatus(undefined, undefined, undefined, latest.status);

    let promptText = 'Prompt redacted';
    if (latest.prompt && latest.prompt !== '[REDACTED]') {
      promptText = latest.prompt;
      if (localStorage.getItem('savePrompts') !== 'true') promptText += ' (legacy — stored)';
    }

    // Silently seed the generate preview if empty
    if (latest.primaryImage && latest.type !== 'batch-generate') {
      const imgUrl   = '/api/run-file?path=' +
        encodeURIComponent(latest.id) + '/' + encodeURIComponent(latest.primaryImage);
      const previewEl = document.getElementById('preview-single');
      if (previewEl && previewEl.querySelector('.stage-empty')) {
        previewEl.className = 'stage-canvas stage-success';
        const seedImg = document.createElement('img');
        seedImg.src = imgUrl;
        seedImg.alt = 'Latest cached preview';
        previewEl.replaceChildren(seedImg);

        const metaPanel = document.getElementById('preview-metadata-panel');
        if (metaPanel) {
          metaPanel.classList.remove('hidden');
          document.getElementById('preview-run-id').textContent       = latest.id;
          document.getElementById('preview-meta-details').textContent = latest.status;
          document.getElementById('preview-prompt-val').textContent   =
            (latest.prompt && latest.prompt !== '[REDACTED]') ? latest.prompt : 'Prompt redacted';
        }
      }
    }

    // Build dashboard latest run block (safe DOM)
    targetDiv.replaceChildren();
    const grid = document.createElement('div');
    grid.style.cssText = 'font-size:13px;display:grid;grid-template-columns:80px 1fr;gap:6px;';

    const statusClass = latest.status === 'PASS' ? 'badge-pass' : 'badge-fail';

    if (latest.type === 'verify' || latest.type === 'server-status') {
      appendMetaRow(grid, 'Check', latest.title);
      const statusBadge = document.createElement('span');
      statusBadge.className = 'badge ' + statusClass;
      statusBadge.textContent = latest.status;
      appendMetaRowEl(grid, 'Status', statusBadge);
      appendMetaRow(grid, 'ID', latest.id);
    } else {
      appendMetaRow(grid, 'Run ID', latest.id);
      const statusBadge = document.createElement('span');
      statusBadge.className = 'badge ' + statusClass;
      statusBadge.textContent = latest.status;
      appendMetaRowEl(grid, 'Status', statusBadge);
      appendMetaRow(grid, 'Prompt', promptText);
    }
    targetDiv.appendChild(grid);

    if (latest.primaryImage) {
      const imgUrl = '/api/run-file?path=' +
        encodeURIComponent(latest.id) + '/' + encodeURIComponent(latest.primaryImage);
      const img = document.createElement('img');
      img.src = imgUrl;
      img.alt = 'Latest generated';
      img.style.cssText = 'width:180px;border-radius:8px;cursor:pointer;border:1px solid var(--border-subtle);margin-top:10px;display:block;';
      img.addEventListener('click', () => navigateToRunDetail(latest.id));
      targetDiv.appendChild(img);
    }
  } catch (e) { /* silent */ }
}

function appendMetaRow(container, label, value) {
  const lEl = document.createElement('strong');
  lEl.style.color = 'var(--text-muted)';
  lEl.textContent = label;
  const vEl = document.createElement('span');
  vEl.textContent = value;
  container.appendChild(lEl);
  container.appendChild(vEl);
}

function appendMetaRowEl(container, label, valueEl) {
  const lEl = document.createElement('strong');
  lEl.style.color = 'var(--text-muted)';
  lEl.textContent = label;
  container.appendChild(lEl);
  container.appendChild(valueEl);
}

// ============================================================
// RUN DETAIL
// ============================================================
async function loadRunDetail(runId) {
  const container = document.getElementById('run-detail-content');
  container.replaceChildren();
  const loading = document.createElement('p');
  loading.className   = 'text-muted';
  loading.style.fontSize = '13px';
  loading.textContent = 'Loading…';
  container.appendChild(loading);

  try {
    const res  = await fetch('/api/runs/' + encodeURIComponent(runId));
    const data = await res.json();
    if (data.error) {
      loading.className   = 'text-danger';
      loading.textContent = 'Error: ' + data.error;
      return;
    }

    container.replaceChildren();
    const m = data.metadata;
    const statusClass = m.status === 'PASS' ? 'badge-pass' : 'badge-fail';

    // Metadata card
    const metaCard = document.createElement('div');
    metaCard.style.cssText = 'background:var(--bg-card);border:1px solid var(--border-subtle);border-radius:var(--r-lg);padding:18px;margin-bottom:14px;';

    const metaGrid = document.createElement('div');
    metaGrid.className = 'metadata-grid';

    const displayPrompt = (!m.prompt || m.prompt === '[REDACTED]')
      ? 'Prompt redacted'
      : (localStorage.getItem('savePrompts') !== 'true' ? m.prompt + ' (legacy — stored)' : m.prompt);

    appendDetailRow(metaGrid, 'ID',     m.id);
    appendDetailRow(metaGrid, 'Type',   m.type || m.run_type || 'unknown');
    const stBadge = document.createElement('span');
    stBadge.className = 'badge ' + statusClass;
    stBadge.textContent = m.status;
    appendDetailRowEl(metaGrid, 'Status', stBadge);
    appendDetailRow(metaGrid, 'Prompt', displayPrompt);

    if (m.negative_prompt && m.negative_prompt !== '[REDACTED]') {
      appendDetailRow(metaGrid, 'Negative', m.negative_prompt);
    }
    if (m.settings) {
      appendDetailRow(metaGrid, 'Settings', m.settings);
    }
    metaCard.appendChild(metaGrid);
    container.appendChild(metaCard);

    // Image hero
    if (m.primary_image || m.primaryImage) {
      const pimg   = m.primary_image || m.primaryImage;
      const imgSrc = '/api/run-file?path=' + encodeURIComponent(m.id) + '/' + encodeURIComponent(pimg);

      const hero = document.createElement('div');
      hero.className = 'detail-hero';
      hero.style.marginBottom = '14px';
      const heroH = document.createElement('h3');
      heroH.textContent = 'Generated Output';
      const heroImg = document.createElement('img');
      heroImg.src = imgSrc;
      heroImg.alt = 'Primary result';
      hero.appendChild(heroH);
      hero.appendChild(heroImg);
      container.appendChild(hero);
    }

    // Reports
    if (data.reports && data.reports.length > 0) {
      const rCard = document.createElement('div');
      rCard.style.cssText = 'background:var(--bg-card);border:1px solid var(--border-subtle);border-radius:var(--r-lg);padding:14px 18px;';
      const rH = document.createElement('h3');
      rH.style.cssText = 'font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:var(--text-muted);margin-bottom:10px;';
      rH.textContent = 'Reports';
      const ul = document.createElement('ul');
      ul.className = 'report-list';
      data.reports.forEach(r => {
        const li = document.createElement('li');
        const a  = document.createElement('a');
        a.href   = '/api/run-file?path=' + encodeURIComponent(m.id) + '/' + encodeURIComponent(r);
        a.target = '_blank';
        a.rel    = 'noopener noreferrer';
        a.textContent = r;
        li.appendChild(a);
        ul.appendChild(li);
      });
      rCard.appendChild(rH);
      rCard.appendChild(ul);
      container.appendChild(rCard);
    }

    // Batch manifest
    if (data.manifest && data.manifest.images) {
      const bCard = document.createElement('div');
      bCard.style.cssText = 'background:var(--bg-card);border:1px solid var(--border-subtle);border-radius:var(--r-lg);padding:14px 18px;margin-top:12px;';
      const bH = document.createElement('h3');
      bH.style.cssText = 'font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:var(--text-muted);margin-bottom:10px;';
      bH.textContent = 'Batch Output';
      const bGrid = document.createElement('div');
      bGrid.className = 'batch-grid-out';
      data.manifest.images.forEach(img => {
        if (img.png_path) {
          const imgSrc = '/api/run-file?path=' + encodeURIComponent(m.id) + '/' + encodeURIComponent(img.png_path);
          const wrap = document.createElement('div');
          wrap.style.textAlign = 'center';
          const bi = document.createElement('img');
          bi.src = imgSrc;
          bi.alt = 'Batch image seed ' + img.seed;
          const lbl = document.createElement('div');
          lbl.className = 'mono text-muted';
          lbl.style.cssText = 'font-size:10.5px;margin-top:4px;';
          lbl.textContent = 'seed: ' + img.seed;
          wrap.appendChild(bi);
          wrap.appendChild(lbl);
          bGrid.appendChild(wrap);
        }
      });
      bCard.appendChild(bH);
      bCard.appendChild(bGrid);
      container.appendChild(bCard);
    }
  } catch (err) {
    container.replaceChildren();
    const errP = document.createElement('p');
    errP.className   = 'text-danger';
    errP.textContent = 'Error: ' + err.message;
    container.appendChild(errP);
  }
}

function appendDetailRow(container, label, value) {
  const lEl = document.createElement('strong');
  lEl.textContent = label;
  const vEl = document.createElement('span');
  vEl.textContent = value;
  container.appendChild(lEl);
  container.appendChild(vEl);
}

function appendDetailRowEl(container, label, valueEl) {
  const lEl = document.createElement('strong');
  lEl.textContent = label;
  container.appendChild(lEl);
  container.appendChild(valueEl);
}

// ============================================================
// SERVER STATUS (silent)
// ============================================================
async function checkServerStatusSilent() {
  setGlobalStatus('Checking', undefined, 'Checking…', undefined);
  try {
    const res  = await fetch('/api/actions/server-status', { method: 'POST' });
    const data = await res.json();
    if (data.job_id) {
      const sid = setInterval(async () => {
        const stRes  = await fetch('/api/jobs/' + data.job_id);
        const stData = await stRes.json();
        if (stData.status === 'PASS' || stData.status === 'FAIL') {
          clearInterval(sid);
          const outRes  = await fetch('/api/jobs/' + data.job_id + '/log');
          const outData = await outRes.json();
          const srv = (outData.stdout || '').includes('Server + tunnel appear UP') ? 'Running' : 'Stopped';
          setGlobalStatus('Ready', undefined, srv, undefined);
        }
      }, 1000);
    }
  } catch (e) {
    setGlobalStatus('Unknown', undefined, 'Unknown', undefined);
  }
}

// ============================================================
// INIT
// ============================================================
window.onload = () => {
  loadSettings();
  loadLatestRun();
  checkServerStatusSilent();
};
