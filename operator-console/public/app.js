// Operator Console Client-side Controller

let activeJobInterval = null;
let allRunsCache = [];

const PRESETS = {
  smoke: { steps: 1, cfg: 7.0, sampler: 'euler_a', width: 512, height: 512 },
  thumbnail: { steps: 4, cfg: 7.0, sampler: 'euler_a', width: 384, height: 384 },
  fast: { steps: 8, cfg: 7.0, sampler: 'euler_a', width: 512, height: 512 },
  balanced: { steps: 16, cfg: 7.0, sampler: 'euler_a', width: 512, height: 512 },
  quality: { steps: 20, cfg: 7.0, sampler: 'euler_a', width: 512, height: 512 },
  quality_plus: { steps: 30, cfg: 7.0, sampler: 'euler_a', width: 512, height: 512 }
};

// Escape Helper
function escapeHtml(unsafe) {
  if (unsafe === undefined || unsafe === null) return '';
  if (typeof unsafe !== 'string') return String(unsafe);
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Settings initialization
function loadSettings() {
  const preset = localStorage.getItem('defPreset') || 'fast';
  const mode = localStorage.getItem('defMode') || 'cli';
  const steps = localStorage.getItem('defSteps') || '8';
  const cfg = localStorage.getItem('defCfg') || '7.0';
  const sampler = localStorage.getItem('defSampler') || 'euler_a';
  const width = localStorage.getItem('defWidth') || '512';
  const height = localStorage.getItem('defHeight') || '512';
  const count = localStorage.getItem('defBatchCount') || '3';
  const autoOpen = localStorage.getItem('autoOpen') === 'true'; // Default false
  const savePrompts = localStorage.getItem('savePrompts') === 'true'; // Default false

  // Apply to Settings Form
  document.getElementById('set-default-preset').value = preset;
  document.getElementById('set-default-mode').value = mode;
  document.getElementById('set-default-steps').value = steps;
  document.getElementById('set-default-cfg').value = cfg;
  document.getElementById('set-default-width').value = width;
  document.getElementById('set-default-height').value = height;
  document.getElementById('set-batch-count').value = count;
  document.getElementById('set-auto-open').checked = autoOpen;
  document.getElementById('set-save-prompts').checked = savePrompts;

  // Apply defaults to Generate Single Form
  document.getElementById('gen-preset').value = preset;
  document.getElementById('gen-mode').value = mode;
  document.getElementById('gen-steps').value = steps;
  document.getElementById('gen-cfg').value = cfg;
  document.getElementById('gen-sampler').value = sampler;
  document.getElementById('gen-width').value = width;
  document.getElementById('gen-height').value = height;

  // Apply defaults to Batch Form
  document.getElementById('batch-preset').value = preset;
  document.getElementById('batch-mode').value = mode;
  document.getElementById('batch-count').value = count;
}

function saveSettings() {
  const preset = document.getElementById('set-default-preset').value;
  const mode = document.getElementById('set-default-mode').value;
  const steps = document.getElementById('set-default-steps').value;
  const cfg = document.getElementById('set-default-cfg').value;
  const width = document.getElementById('set-default-width').value;
  const height = document.getElementById('set-default-height').value;
  const count = document.getElementById('set-batch-count').value;
  const autoOpen = document.getElementById('set-auto-open').checked;
  const savePrompts = document.getElementById('set-save-prompts').checked;

  localStorage.setItem('defPreset', preset);
  localStorage.setItem('defMode', mode);
  localStorage.setItem('defSteps', steps);
  localStorage.setItem('defCfg', cfg);
  localStorage.setItem('defWidth', width);
  localStorage.setItem('defHeight', height);
  localStorage.setItem('defBatchCount', count);
  localStorage.setItem('autoOpen', autoOpen ? 'true' : 'false');
  localStorage.setItem('savePrompts', savePrompts ? 'true' : 'false');

  const msg = document.getElementById('settings-saved-msg');
  msg.classList.remove('hidden');
  setTimeout(() => msg.classList.add('hidden'), 2000);
}

// Navigation
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    
    e.target.classList.add('active');
    const targetId = e.target.getAttribute('data-target');
    document.getElementById(targetId).classList.add('active');

    if (targetId === 'dashboard') loadLatestRun();
    if (targetId === 'gallery') loadGallery();
    if (targetId === 'history') loadRuns();
    if (targetId === 'server') checkServerStatusSilent();
  });
});

function navigateToRunDetail(runId) {
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.getElementById('run-detail').classList.add('active');
  loadRunDetail(runId);
}

// Setup Back to History Button
document.getElementById('btn-back-to-history').addEventListener('click', () => {
  document.getElementById('btn-nav-history').click();
});

// Controls Synchronizer for Generate Single Form
document.getElementById('gen-preset').addEventListener('change', (e) => {
  const val = e.target.value;
  if (val && val !== 'Custom' && PRESETS[val]) {
    const config = PRESETS[val];
    document.getElementById('gen-steps').value = config.steps;
    document.getElementById('gen-cfg').value = config.cfg;
    document.getElementById('gen-sampler').value = config.sampler;
    document.getElementById('gen-width').value = config.width;
    document.getElementById('gen-height').value = config.height;
  }
});

// Modifying inputs marks preset as Custom
['gen-steps', 'gen-cfg', 'gen-sampler', 'gen-width', 'gen-height'].forEach(id => {
  document.getElementById(id).addEventListener('input', () => {
    document.getElementById('gen-preset').value = 'Custom';
  });
});

// Drawer Logic
function openJobDrawer(title) {
  document.getElementById('job-drawer-title').textContent = title;
  document.getElementById('job-drawer').classList.remove('hidden');
  document.getElementById('job-drawer-error').classList.add('hidden');
  document.getElementById('job-drawer-log-wrap').classList.add('hidden');
  document.getElementById('job-drawer-status').textContent = 'Starting job...';
  document.getElementById('job-drawer-log').textContent = '';
}

function closeJobDrawer() {
  document.getElementById('job-drawer').classList.add('hidden');
}

function toggleJobLog() {
  const logWrap = document.getElementById('job-drawer-log-wrap');
  logWrap.classList.toggle('hidden');
}

// Global Status Indicator (Pills)
function setGlobalStatus(backend, job, server, latest) {
  if (backend !== undefined) document.getElementById('val-backend').textContent = escapeHtml(backend);
  if (job !== undefined) {
    document.getElementById('val-job').textContent = escapeHtml(job);
    const btns = document.querySelectorAll('button[type="submit"]');
    if (job === 'Running') {
      btns.forEach(b => b.disabled = true);
    } else {
      btns.forEach(b => b.disabled = false);
    }
  }
  if (server !== undefined) document.getElementById('val-server').textContent = escapeHtml(server);
  if (latest !== undefined) document.getElementById('val-latest').textContent = escapeHtml(latest);
}

// API Calls & Polling
async function runJob(endpoint, payload = null, actionName = 'Job') {
  setGlobalStatus('Checking', 'Running', undefined, undefined);
  openJobDrawer(actionName);

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload ? JSON.stringify(payload) : undefined
    });
    const data = await res.json();
    if (data.job_id) {
      pollJob(data.job_id);
    } else {
      document.getElementById('job-drawer-status').textContent = 'Error: ' + escapeHtml(data.error || JSON.stringify(data));
      setGlobalStatus('Failed', 'Idle', undefined, undefined);
    }
  } catch (err) {
    document.getElementById('job-drawer-status').textContent = 'Fetch Error: ' + escapeHtml(err.message);
    setGlobalStatus('Unknown', 'Idle', undefined, undefined);
  }
}

function pollJob(jobId) {
  if (activeJobInterval) clearInterval(activeJobInterval);

  activeJobInterval = setInterval(async () => {
    try {
      const res = await fetch(`/api/jobs/${jobId}/log`);
      const data = await res.json();
      
      const logText = data.stdout + '\n' + data.stderr;
      document.getElementById('job-drawer-log').textContent = logText || 'Waiting for output...';
      const logWrap = document.getElementById('job-drawer-log-wrap');
      logWrap.scrollTop = logWrap.scrollHeight;

      // Check status from main job endpoint
      const statusRes = await fetch(`/api/jobs/${jobId}`);
      const statusData = await statusRes.json();

      document.getElementById('job-drawer-status').textContent = `Elapsed: ${Math.floor((Date.now() - statusData.createdAt)/1000)}s | Status: ${statusData.status}`;

      if (statusData.status === 'PASS' || statusData.status === 'FAIL' || statusData.status === 'PARTIAL') {
        clearInterval(activeJobInterval);
        
        let backendState = statusData.status === 'PASS' ? 'Ready' : 'Failed';
        setGlobalStatus(backendState, 'Idle', undefined, statusData.status);
        
        if (statusData.status === 'FAIL') {
          document.getElementById('job-drawer-error').classList.remove('hidden');
          document.getElementById('job-drawer-gate').textContent = statusData.firstFailedGate || 'Unknown';
        }

        // Post-generation routing check
        const isGen = statusData.commandAction.includes('generate');
        const autoOpen = localStorage.getItem('autoOpen') === 'true';

        if (statusData.runId && statusData.status === 'PASS' && isGen) {
          // Render image inline in the Generate Single right-hand preview panel
          await renderInlinePreview(statusData.runId);

          if (autoOpen) {
            setTimeout(() => {
              closeJobDrawer();
              navigateToRunDetail(statusData.runId);
            }, 1000);
          } else {
            setTimeout(() => {
              closeJobDrawer();
            }, 1000);
          }
        } else {
          setTimeout(() => {
            closeJobDrawer();
          }, 1500);
        }
        
        loadLatestRun();
      }
    } catch (err) {
      clearInterval(activeJobInterval);
      setGlobalStatus('Unknown', 'Idle', undefined, undefined);
    }
  }, 1000);
}

// Inline Preview Loader
async function renderInlinePreview(runId) {
  const container = document.getElementById('preview-single');
  const metaPanel = document.getElementById('preview-metadata-panel');
  container.innerHTML = '<p class="text-muted">Loading image preview...</p>';

  try {
    const res = await fetch(`/api/runs/${encodeURIComponent(runId)}`);
    const data = await res.json();
    if (data.error || !data.metadata) {
      container.innerHTML = '<p class="text-danger">Failed to fetch run data.</p>';
      return;
    }

    const m = data.metadata;
    if (m.primaryImage) {
      const safeId = encodeURIComponent(runId);
      const safeImg = encodeURIComponent(m.primaryImage);
      container.innerHTML = `<img src="/api/run-file?path=${safeId}/${safeImg}" alt="Inline generated preview">`;
      
      // Update inline metadata
      metaPanel.classList.remove('hidden');
      document.getElementById('preview-run-id').textContent = m.id;
      document.getElementById('preview-meta-details').textContent = m.settings || 'No settings info available';
      
      // Prompt privacy display checks
      const valPrompt = document.getElementById('preview-prompt-val');
      if (!m.prompt || m.prompt === '[REDACTED]') {
        valPrompt.textContent = 'Prompt redacted';
        valPrompt.className = 'meta-val text-muted';
      } else {
        valPrompt.textContent = m.prompt;
        valPrompt.className = 'meta-val';
        // Check if legacy prompt
        const savePrompts = localStorage.getItem('savePrompts') === 'true';
        if (!savePrompts) {
          const warning = document.createElement('div');
          warning.className = 'legacy-warning-banner';
          warning.textContent = 'Legacy run may contain stored prompt text.';
          valPrompt.appendChild(warning);
        }
      }

      // Configure button clicks
      document.getElementById('btn-preview-detail').onclick = () => navigateToRunDetail(runId);
      document.getElementById('btn-preview-gallery').onclick = () => {
        document.getElementById('btn-nav-gallery').click();
      };
    } else {
      container.innerHTML = '<div class="empty-state"><p class="empty-title">Verified PNG ready.</p><p class="text-muted">Run did not output a previewable image.</p></div>';
      metaPanel.classList.add('hidden');
    }
  } catch(e) {
    container.innerHTML = '<p class="text-danger">Failed to load preview.</p>';
    metaPanel.classList.add('hidden');
  }
}

// Generate Forms
function submitGenerateSingle() {
  const prompt = document.getElementById('gen-prompt').value;
  const negative_prompt = document.getElementById('gen-negative').value;
  const preset = document.getElementById('gen-preset').value;
  const mode = document.getElementById('gen-mode').value;
  const steps = document.getElementById('gen-steps').value;
  const cfg_scale = document.getElementById('gen-cfg').value;
  const sampler = document.getElementById('gen-sampler').value;
  const width = document.getElementById('gen-width').value;
  const height = document.getElementById('gen-height').value;
  const seed = document.getElementById('gen-seed').value;
  
  // Read prompt privacy setting
  const save_prompts = localStorage.getItem('savePrompts') === 'true';

  const payload = { 
    prompt, 
    negative_prompt, 
    preset, 
    mode, 
    steps: steps ? parseInt(steps) : undefined,
    cfg_scale: cfg_scale ? parseFloat(cfg_scale) : undefined,
    sampler,
    width: width ? parseInt(width) : undefined,
    height: height ? parseInt(height) : undefined,
    save_prompts
  };

  if (seed) payload.seed = seed;

  runJob('/api/actions/generate-single', payload, 'Generate Single');
}

function submitGenerateBatch() {
  const prompt = document.getElementById('batch-prompt').value;
  const negative_prompt = document.getElementById('batch-negative').value;
  const count = document.getElementById('batch-count').value;
  const preset = document.getElementById('batch-preset').value;
  const seedMode = document.getElementById('batch-seed-mode').value;
  const seedStart = document.getElementById('batch-seed-start').value;
  const mode = document.getElementById('batch-mode').value;
  const api = document.getElementById('batch-api').value;

  const save_prompts = localStorage.getItem('savePrompts') === 'true';

  const payload = { 
    prompt, 
    negative_prompt, 
    count: parseInt(count), 
    preset, 
    seedMode, 
    seedStart, 
    mode, 
    api,
    save_prompts
  };

  runJob('/api/actions/generate-batch', payload, 'Batch Explore');
}

function submitServerAction(action) {
  runJob(`/api/actions/${action}`, null, action.toUpperCase().replace('-', ' '));
}

function submitCleanup() {
  const days = document.getElementById('cleanup-days').value;
  if (confirm(`Are you sure you want to delete runs older than ${days} days?`)) {
    runJob('/api/actions/clean-old-runs', { days: parseInt(days) }, 'Cleanup Old Runs');
  }
}

// Gallery rendering
async function loadGallery() {
  const grid = document.getElementById('gallery-grid');
  grid.innerHTML = '<p class="text-muted">Loading gallery...</p>';

  try {
    const res = await fetch('/api/runs');
    const data = await res.json();
    
    // Filter to runs containing a primary image only
    const imageRuns = data.runs.filter(r => r.primaryImage && r.type !== 'verify' && r.type !== 'server-status');
    grid.innerHTML = '';

    if (imageRuns.length === 0) {
      grid.innerHTML = '<p class="text-muted">No images in gallery yet. Generate some images to populate it!</p>';
      return;
    }

    imageRuns.forEach(run => {
      const card = document.createElement('div');
      card.className = 'gallery-card';
      card.onclick = () => navigateToRunDetail(run.id);

      const safeId = encodeURIComponent(run.id);
      const safeImg = encodeURIComponent(run.primaryImage);
      const imgUrl = `/api/run-file?path=${safeId}/${safeImg}`;

      let displayPrompt = 'Prompt redacted';
      let promptClass = 'gallery-card-prompt text-muted';
      if (run.prompt && run.prompt !== '[REDACTED]') {
        displayPrompt = run.prompt;
        promptClass = 'gallery-card-prompt';
      }

      card.innerHTML = `
        <div class="gallery-card-img">
          <img src="${imgUrl}" alt="Gallery generation" loading="lazy">
        </div>
        <div class="gallery-card-info">
          <div class="gallery-card-title">
            <span>${escapeHtml(run.title || run.type)}</span>
            <span class="badge ${run.status === 'PASS' ? 'badge-pass' : 'badge-fail'}">${escapeHtml(run.status)}</span>
          </div>
          <div class="gallery-card-meta">${escapeHtml(run.id)}</div>
          <div class="${promptClass}">${escapeHtml(displayPrompt)}</div>
        </div>
      `;
      grid.appendChild(card);
    });
  } catch(e) {
    grid.innerHTML = '<p class="text-danger">Failed to load gallery.</p>';
  }
}

// History loading & rendering
// When prompt saving is OFF, stored prompts are redacted, so prompt search
// can only ever match the current session's nothing-on-disk. Disable it and
// say so, per the prompt-privacy contract.
function applyPromptSearchState() {
  const savePrompts = localStorage.getItem('savePrompts') === 'true';
  const input = document.getElementById('filter-prompt');
  const note = document.getElementById('filter-prompt-note');
  if (!input) return;
  if (savePrompts) {
    input.disabled = false;
    input.placeholder = 'Search prompts...';
    if (note) note.textContent = '';
  } else {
    input.disabled = true;
    input.value = '';
    input.placeholder = 'Disabled (prompt privacy on)';
    if (note) note.textContent = 'Prompt search is disabled while prompts are redacted. Enable "Save prompts" in Settings to search.';
  }
}

async function loadRuns() {
  const res = await fetch('/api/runs');
  const data = await res.json();
  allRunsCache = data.runs;
  applyPromptSearchState();
  renderRunHistory();
}

function renderRunHistory() {
  const list = document.getElementById('run-list');
  list.innerHTML = '';
  
  if (allRunsCache.length === 0) {
    list.innerHTML = '<p class="text-muted">No runs found.</p>';
    return;
  }

  const fType = document.getElementById('filter-type').value;
  const fStatus = document.getElementById('filter-status').value;
  const fPrompt = document.getElementById('filter-prompt').value.toLowerCase();

  const filtered = allRunsCache.filter(run => {
    if (fType && run.type !== fType) return false;
    if (fStatus && run.status !== fStatus) return false;
    if (fPrompt && (!run.prompt || !run.prompt.toLowerCase().includes(fPrompt))) return false;
    return true;
  });

  if (filtered.length === 0) {
    list.innerHTML = '<p class="text-muted">No runs match filters.</p>';
    return;
  }

  filtered.forEach(run => {
    const item = document.createElement('div');
    item.className = 'run-table-row';
    item.onclick = () => navigateToRunDetail(run.id);

    const hasPrompt = run.prompt && run.prompt !== '[REDACTED]';
    let displayPrompt = '';
    if (hasPrompt) {
      displayPrompt = run.prompt;
      // check if legacy warning is needed
      const savePrompts = localStorage.getItem('savePrompts') === 'true';
      if (!savePrompts) {
        displayPrompt += ' (Legacy run may contain stored prompt text)';
      }
    } else {
      displayPrompt = 'Prompt redacted';
    }

    const typeLabel = escapeHtml(run.title || run.type);
    const statusClass = run.status === 'PASS' ? 'badge-pass'
      : (run.status === 'FAIL' ? 'badge-fail'
      : (run.status === 'PARTIAL' ? 'badge-partial' : 'badge-log'));

    item.innerHTML = `
      <span class="badge ${statusClass}">${escapeHtml(run.status)}</span>
      <span class="mono" style="font-size:12px;">${escapeHtml(run.id.split('-')[0])}</span>
      <strong>${typeLabel}</strong>
      <span class="text-muted" style="font-size:12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(displayPrompt)}</span>
      <span class="text-muted" style="font-size:11px; text-align:right;">${escapeHtml(run.id.split('-').slice(1,3).join(' '))}</span>
    `;
    list.appendChild(item);
  });
}

async function loadLatestRun() {
  const res = await fetch('/api/runs');
  const data = await res.json();
  
  if (data.runs && data.runs.length > 0) {
    const latest = data.runs[0];
    const targetDiv = document.getElementById('dashboard-latest-run');
    
    let imgHtml = '';
    if (latest.primaryImage) {
      const safeId = encodeURIComponent(latest.id);
      const safeImg = encodeURIComponent(latest.primaryImage);
      imgHtml = `<img src="/api/run-file?path=${safeId}/${safeImg}" alt="Latest generated" style="width: 256px; border-radius: 8px; cursor: pointer; border: 1px solid var(--border-subtle);" onclick="navigateToRunDetail('${escapeHtml(latest.id)}')">`;
      
      // Update generate page preview silently if not active
      if (latest.type !== 'batch-generate') {
        const previewEl = document.getElementById('preview-single');
        // only replace if empty state is showing
        if (previewEl.querySelector('.empty-state')) {
          previewEl.innerHTML = `<img src="/api/run-file?path=${safeId}/${safeImg}" alt="Cached preview image">`;
          document.getElementById('preview-metadata-panel').classList.remove('hidden');
          document.getElementById('preview-run-id').textContent = latest.id;
          document.getElementById('preview-meta-details').textContent = latest.status;
          document.getElementById('preview-prompt-val').textContent = (latest.prompt && latest.prompt !== '[REDACTED]') ? latest.prompt : 'Prompt redacted';
        }
      }
    }

    setGlobalStatus(undefined, undefined, undefined, latest.status);

    let promptText = 'Prompt redacted';
    if (latest.prompt && latest.prompt !== '[REDACTED]') {
      promptText = latest.prompt;
      const savePrompts = localStorage.getItem('savePrompts') === 'true';
      if (!savePrompts) {
        promptText += ' (Legacy run may contain stored prompt text)';
      }
    }

    if (latest.type === 'verify' || latest.type === 'server-status') {
      targetDiv.innerHTML = `
        <div class="metadata-grid">
          <p><strong>Check:</strong> <span>${escapeHtml(latest.title)}</span></p>
          <p><strong>Status:</strong> <span class="text-success">${escapeHtml(latest.status)}</span></p>
          <p><strong>ID:</strong> <span class="mono"><a href="#" onclick="navigateToRunDetail('${escapeHtml(latest.id)}')">${escapeHtml(latest.id)}</a></span></p>
        </div>
      `;
    } else {
      targetDiv.innerHTML = `
        <div class="metadata-grid" style="margin-bottom: 12px;">
          <p><strong>Run ID:</strong> <span class="mono"><a href="#" onclick="navigateToRunDetail('${escapeHtml(latest.id)}')">${escapeHtml(latest.id)}</a></span></p>
          <p><strong>Status:</strong> <span>${escapeHtml(latest.status)}</span></p>
          <p><strong>Prompt:</strong> <span>${escapeHtml(promptText)}</span></p>
        </div>
        ${imgHtml}
      `;
    }
  }
}

async function loadRunDetail(runId) {
  const container = document.getElementById('run-detail-content');
  container.innerHTML = '<p class="text-muted">Loading run detail...</p>';

  try {
    const res = await fetch(`/api/runs/${encodeURIComponent(runId)}`);
    const data = await res.json();
    
    if (data.error) {
      container.innerHTML = `<p class="text-danger">Error: ${escapeHtml(data.error)}</p>`;
      return;
    }

    const m = data.metadata;
    let displayPrompt = 'Prompt redacted';
    if (m.prompt && m.prompt !== '[REDACTED]') {
      displayPrompt = m.prompt;
      const savePrompts = localStorage.getItem('savePrompts') === 'true';
      if (!savePrompts) {
        displayPrompt += ' <div class="legacy-warning-banner">Legacy run may contain stored prompt text.</div>';
      }
    }

    let html = `
      <div class="metadata-grid" style="margin-bottom: 24px;">
        <p><strong>ID:</strong> <span class="mono">${escapeHtml(m.id)}</span></p>
        <p><strong>Type:</strong> <span>${escapeHtml(m.type || m.run_type || 'unknown')}</span></p>
        <p><strong>Status:</strong> <span class="badge ${m.status === 'PASS' ? 'badge-pass' : 'badge-fail'}">${escapeHtml(m.status)}</span></p>
        <p><strong>Prompt:</strong> <span>${displayPrompt}</span></p>
    `;

    if (m.negative_prompt && m.negative_prompt !== '[REDACTED]') {
      html += `<p><strong>Negative:</strong> <span>${escapeHtml(m.negative_prompt)}</span></p>`;
    }
    
    if (m.settings) {
      html += `<p><strong>Settings:</strong> <span>${escapeHtml(m.settings)}</span></p>`;
    }
    
    html += `</div>`;

    if (m.primary_image || m.primaryImage) {
      const pimg = m.primary_image || m.primaryImage;
      const safeId = encodeURIComponent(m.id);
      const safeImg = encodeURIComponent(pimg);
      html += `
        <div class="detail-hero" style="margin-bottom: 24px;">
          <h3>Generated Output</h3>
          <img src="/api/run-file?path=${safeId}/${safeImg}" alt="Primary result">
        </div>
      `;
    }

    // Reports links
    if (data.reports && data.reports.length > 0) {
      html += `<h3>Reports & Metrics</h3><ul class="report-list" style="margin-bottom: 24px;">`;
      for (let r of data.reports) {
         const sId = encodeURIComponent(m.id);
         const sR = encodeURIComponent(r);
         html += `<li><a href="/api/run-file?path=${sId}/${sR}" target="_blank">${escapeHtml(r)}</a></li>`;
      }
      html += `</ul>`;
    }

    // Manifest / batch viewing
    if (data.manifest && data.manifest.images) {
      html += `<h3 style="margin-top:20px; margin-bottom:12px;">Batch Output Images</h3><div class="batch-grid">`;
      data.manifest.images.forEach(img => {
        if (img.png_path) {
          const sId = encodeURIComponent(m.id);
          const sImg = encodeURIComponent(img.png_path);
          html += `
            <div style="text-align:center;">
              <img src="/api/run-file?path=${sId}/${sImg}" alt="Batch image">
              <div class="mono" style="font-size:11px; margin-top:4px; color:var(--text-muted);">seed: ${img.seed}</div>
            </div>
          `;
        }
      });
      html += `</div>`;
    }

    container.innerHTML = html;

  } catch (err) {
    container.innerHTML = `<p class="text-danger">Error loading run details: ${escapeHtml(err.message)}</p>`;
  }
}

async function checkServerStatusSilent() {
  setGlobalStatus('Checking', undefined, 'Checking...', undefined);
  try {
    const res = await fetch('/api/actions/server-status', { method: 'POST' });
    const data = await res.json();
    if (data.job_id) {
        const sid = setInterval(async () => {
            const stRes = await fetch(`/api/jobs/${data.job_id}`);
            const stData = await stRes.json();
            if (stData.status === 'PASS' || stData.status === 'FAIL') {
                clearInterval(sid);
                const outRes = await fetch(`/api/jobs/${data.job_id}/log`);
                const outData = await outRes.json();
                
                let srv = 'Stopped';
                if (outData.stdout.includes('Server + tunnel appear UP')) srv = 'Running';
                setGlobalStatus('Ready', undefined, srv, undefined);
            }
        }, 1000);
    }
  } catch(e) {
      setGlobalStatus('Unknown', undefined, 'Unknown', undefined);
  }
}

// Init
window.onload = () => {
  loadSettings();
  loadLatestRun();
  checkServerStatusSilent();
};
