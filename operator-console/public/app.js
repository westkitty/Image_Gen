// UI Logic

let activeJobInterval = null;
let allRunsCache = []; // Cache for filtering history

// Escape Helper
function escapeHtml(unsafe) {
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
  const count = localStorage.getItem('defBatchCount') || '3';

  document.getElementById('set-default-preset').value = preset;
  document.getElementById('set-default-mode').value = mode;
  document.getElementById('set-batch-count').value = count;

  // Apply to forms
  if(!document.getElementById('gen-preset').value) document.getElementById('gen-preset').value = preset;
  if(!document.getElementById('gen-mode').value) document.getElementById('gen-mode').value = mode;
  if(!document.getElementById('batch-preset').value) document.getElementById('batch-preset').value = preset;
  if(!document.getElementById('batch-mode').value) document.getElementById('batch-mode').value = mode;
  if(!document.getElementById('batch-count').value) document.getElementById('batch-count').value = count;
}

function saveSettings() {
  localStorage.setItem('defPreset', document.getElementById('set-default-preset').value);
  localStorage.setItem('defMode', document.getElementById('set-default-mode').value);
  localStorage.setItem('defBatchCount', document.getElementById('set-batch-count').value);
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

function closeRunDetail() {
  document.querySelector('[data-target="history"]').click();
}

// Drawer Logic
function openJobDrawer(title) {
  document.getElementById('job-drawer-title').textContent = title;
  document.getElementById('job-drawer').classList.remove('hidden');
  document.getElementById('job-drawer-error').classList.add('hidden');
  document.getElementById('job-drawer-log-wrap').classList.add('hidden');
  document.getElementById('job-drawer-status').textContent = 'Starting job...';
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
  if(backend !== undefined) document.getElementById('val-backend').textContent = escapeHtml(backend);
  if(job !== undefined) {
      document.getElementById('val-job').textContent = escapeHtml(job);
      if(job === 'Running') {
          document.querySelectorAll('button[type="submit"]').forEach(b => b.disabled = true);
      } else {
          document.querySelectorAll('button[type="submit"]').forEach(b => b.disabled = false);
      }
  }
  if(server !== undefined) document.getElementById('val-server').textContent = escapeHtml(server);
  if(latest !== undefined) document.getElementById('val-latest').textContent = escapeHtml(latest);
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
      document.getElementById('job-drawer-status').textContent = 'Error: ' + escapeHtml(JSON.stringify(data));
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

        loadLatestRun();
        
        // Auto navigate if there's a run ID and it was a generation task
        if (statusData.runId && statusData.status === 'PASS' && statusData.commandAction.includes('generate')) {
           setTimeout(() => {
             closeJobDrawer();
             navigateToRunDetail(statusData.runId);
           }, 1500);
        }
      }
    } catch (err) {
      clearInterval(activeJobInterval);
      setGlobalStatus('Unknown', 'Idle', undefined, undefined);
    }
  }, 1000);
}

// Generate Forms
function submitGenerateSingle() {
  const prompt = document.getElementById('gen-prompt').value;
  const negative_prompt = document.getElementById('gen-negative').value;
  const preset = document.getElementById('gen-preset').value;
  const mode = document.getElementById('gen-mode').value;
  const seed = document.getElementById('gen-seed').value;

  const payload = { prompt, negative_prompt, preset, mode };
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

  const payload = { prompt, negative_prompt, count: parseInt(count), preset, seedMode, seedStart, mode, api };
  runJob('/api/actions/generate-batch', payload, 'Batch Explore');
}

function submitServerAction(action) {
  // Can handle verify, server-start, server-stop, seed-test
  runJob(`/api/actions/${action}`, null, action.toUpperCase().replace('-', ' '));
}

function submitCleanup() {
  const days = document.getElementById('cleanup-days').value;
  if (confirm(`Are you sure you want to delete runs older than ${days} days?`)) {
    runJob('/api/actions/clean-old-runs', { days: parseInt(days) }, 'Cleanup Old Runs');
  }
}

// Data Loading
async function loadRuns() {
  const res = await fetch('/api/runs');
  const data = await res.json();
  allRunsCache = data.runs;
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
    item.className = 'card interactive-card run-item';
    item.onclick = () => navigateToRunDetail(run.id);
    
    let imgHtml = '';
    if (run.primaryImage) {
      const safeId = encodeURIComponent(run.id);
      const safeImg = encodeURIComponent(run.primaryImage);
      imgHtml = `<div class="run-item-img"><img src="/api/run-file?path=${safeId}/${safeImg}" alt="Thumbnail"></div>`;
    }

    item.innerHTML = `
      ${imgHtml}
      <div class="run-item-info">
        <strong>${escapeHtml(run.title || run.type)}</strong> - <span class="mono">${escapeHtml(run.status)}</span><br>
        <span class="mono">${escapeHtml(run.id)}</span><br>
        <small class="text-muted">${escapeHtml(run.prompt || 'Not applicable')}</small>
      </div>
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
      imgHtml = `<img src="/api/run-file?path=${safeId}/${safeImg}" alt="Latest generated" style="width: 100%; border-radius: 6px; cursor: pointer;" onclick="navigateToRunDetail('${escapeHtml(latest.id)}')">`;
      
      if (latest.type !== 'batch-generate') {
        document.getElementById('preview-single').innerHTML = imgHtml;
      }
    }

    setGlobalStatus(undefined, undefined, undefined, latest.status);

    let promptText = latest.prompt || 'not applicable';

    if(latest.type === 'verify' || latest.type === 'server-status') {
      targetDiv.innerHTML = `
        <p><strong>Latest check:</strong> ${escapeHtml(latest.title)}</p>
        <p><strong>Status:</strong> ${escapeHtml(latest.status)}</p>
        <p><strong>ID:</strong> <span class="mono"><a href="#" onclick="navigateToRunDetail('${escapeHtml(latest.id)}')">${escapeHtml(latest.id)}</a></span></p>
      `;
    } else {
      targetDiv.innerHTML = `
        <p><strong>Run ID:</strong> <span class="mono"><a href="#" onclick="navigateToRunDetail('${escapeHtml(latest.id)}')">${escapeHtml(latest.id)}</a></span></p>
        <p><strong>Status:</strong> ${escapeHtml(latest.status)}</p>
        <p><strong>Prompt:</strong> ${escapeHtml(promptText)}</p>
        <div style="margin-top: 10px;">${imgHtml}</div>
      `;
    }
  }
}

async function loadRunDetail(runId) {
  const container = document.getElementById('run-detail-content');
  container.innerHTML = '<p class="text-muted">Loading run...</p>';

  try {
    const res = await fetch(`/api/runs/${encodeURIComponent(runId)}`);
    const data = await res.json();
    
    if (data.error) {
      container.innerHTML = `<p class="text-danger">Error: ${escapeHtml(data.error)}</p>`;
      return;
    }

    const m = data.metadata;
    let html = `
      <div class="metadata-grid" style="margin-bottom: 20px;">
        <p><strong>ID:</strong> <span class="mono">${escapeHtml(m.id)}</span></p>
        <p><strong>Type:</strong> ${escapeHtml(m.type || m.run_type || 'unknown')}</p>
        <p><strong>Status:</strong> ${escapeHtml(m.status)}</p>
        <p><strong>Prompt:</strong> ${escapeHtml(m.prompt || 'not applicable')}</p>
    `;

    if (m.negative_prompt) {
      html += `<p><strong>Negative:</strong> ${escapeHtml(m.negative_prompt)}</p>`;
    }
    html += `</div>`;

    if (m.primary_image || m.primaryImage) {
      const pimg = m.primary_image || m.primaryImage;
      const safeId = encodeURIComponent(m.id);
      const safeImg = encodeURIComponent(pimg);
      html += `
        <div class="detail-hero" style="margin-bottom: 20px;">
          <h3>Primary Image</h3>
          <img src="/api/run-file?path=${safeId}/${safeImg}" style="max-width: 100%; border-radius: 6px;" alt="Primary result">
        </div>
      `;
    }

    // Reports links
    if (data.reports && data.reports.length > 0) {
      html += `<h3>Reports</h3><ul class="report-list">`;
      for(let r of data.reports) {
         const sId = encodeURIComponent(m.id);
         const sR = encodeURIComponent(r);
         html += `<li><a href="/api/run-file?path=${sId}/${sR}" target="_blank">${escapeHtml(r)}</a></li>`;
         
         // If it's verify report or metrics, maybe load it inline?
      }
      html += `</ul>`;
    }

    // Manifest / batch viewing
    if (data.manifest && data.manifest.jobs) {
      html += `<h3 style="margin-top:20px;">Batch Images</h3><div class="image-grid">`;
      data.manifest.jobs.forEach(job => {
        if (job.status === 'PASS' && job.outputs && job.outputs.images) {
          job.outputs.images.forEach(img => {
            const sId = encodeURIComponent(m.id);
            const sImg = encodeURIComponent(img);
            html += `<img src="/api/run-file?path=${sId}/${sImg}" alt="Batch image" style="width:100%; border-radius:4px;">`;
          });
        }
      });
      html += `</div>`;
    }

    container.innerHTML = html;

  } catch (err) {
    container.innerHTML = `<p class="text-danger">Error loading run: ${escapeHtml(err.message)}</p>`;
  }
}

async function checkServerStatusSilent() {
  setGlobalStatus('Checking', undefined, 'Unknown', undefined);
  try {
    const res = await fetch('/api/actions/server-status', { method: 'POST' });
    const data = await res.json();
    if(data.job_id) {
        // Poll it to get result quietly
        const sid = setInterval(async () => {
            const stRes = await fetch(`/api/jobs/${data.job_id}`);
            const stData = await stRes.json();
            if(stData.status === 'PASS' || stData.status === 'FAIL') {
                clearInterval(sid);
                const outRes = await fetch(`/api/jobs/${data.job_id}/log`);
                const outData = await outRes.json();
                
                let srv = 'Stopped';
                if(outData.stdout.includes('listening')) srv = 'Running';
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
