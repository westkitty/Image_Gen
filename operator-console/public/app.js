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

  // Apply to forms if they are empty or just initialized
  document.getElementById('gen-preset').value = preset;
  document.getElementById('gen-mode').value = mode;
  document.getElementById('batch-preset').value = preset;
  document.getElementById('batch-mode').value = mode;
  document.getElementById('batch-count').value = count;
  document.getElementById('srv-preset').value = preset;
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
  // Go back to history
  document.querySelector('[data-target="history"]').click();
}

// Modal Logic
function openJobModal() {
  document.getElementById('job-modal').classList.remove('hidden');
}

function closeJobModal() {
  document.getElementById('job-modal').classList.add('hidden');
}

// Global Status Indicator
function setGlobalStatus(statusStr) {
  const dot = document.querySelector('#global-backend-status .indicator-dot');
  const txt = document.querySelector('#global-backend-status .indicator-text');
  dot.className = 'indicator-dot'; // reset
  
  if (statusStr === 'PASS' || statusStr === 'running') dot.classList.add('pass');
  else if (statusStr === 'PARTIAL') dot.classList.add('partial');
  else if (statusStr === 'FAIL') dot.classList.add('fail');
  else dot.classList.add('unknown');

  txt.textContent = `Backend Status: ${escapeHtml(statusStr)}`;
}

function showJobSpinner() {
  document.getElementById('global-job-status').classList.remove('hidden');
  // disable submit buttons
  document.querySelectorAll('button[type="submit"]').forEach(b => b.disabled = true);
}

function hideJobSpinner() {
  document.getElementById('global-job-status').classList.add('hidden');
  // enable submit buttons
  document.querySelectorAll('button[type="submit"]').forEach(b => b.disabled = false);
}

// API Calls & Polling
async function runJob(endpoint, payload = null) {
  showJobSpinner();
  openJobModal();
  document.getElementById('job-log-output').textContent = 'Starting job...';

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
      document.getElementById('job-log-output').textContent = 'Error: ' + escapeHtml(JSON.stringify(data));
      hideJobSpinner();
    }
  } catch (err) {
    document.getElementById('job-log-output').textContent = 'Fetch Error: ' + escapeHtml(err.message);
    hideJobSpinner();
  }
}

function pollJob(jobId) {
  if (activeJobInterval) clearInterval(activeJobInterval);

  activeJobInterval = setInterval(async () => {
    try {
      const res = await fetch(`/api/jobs/${jobId}/log`);
      const data = await res.json();
      
      const logText = data.stdout + '\n' + data.stderr;
      document.getElementById('job-log-output').textContent = logText || 'Waiting for output...';

      // Auto-scroll to bottom
      const modalBody = document.querySelector('.modal-body');
      modalBody.scrollTop = modalBody.scrollHeight;

      // Check status from main job endpoint
      const statusRes = await fetch(`/api/jobs/${jobId}`);
      const statusData = await statusRes.json();

      setGlobalStatus(statusData.status);

      if (statusData.status === 'PASS' || statusData.status === 'FAIL' || statusData.status === 'PARTIAL') {
        clearInterval(activeJobInterval);
        hideJobSpinner();
        
        // Output extra info
        const finalLog = document.getElementById('job-log-output').textContent;
        let summary = `\n\n--- JOB FINISHED ---\nStatus: ${statusData.status}\nExit Code: ${statusData.exitCode}`;
        if (statusData.firstFailedGate) {
          summary += `\nFailed Gate: ${statusData.firstFailedGate}`;
        }
        if (statusData.runId) {
          summary += `\nResulting Run ID: ${statusData.runId}`;
          // Link to run detail
          summary += `\nClosing this window or navigating to history will show the run.`;
        }
        document.getElementById('job-log-output').textContent = finalLog + summary;

        loadLatestRun();
        
        // Auto navigate if there's a run ID and it was a generation task
        if (statusData.runId && statusData.commandAction.startsWith('generate')) {
           setTimeout(() => {
             closeJobModal();
             navigateToRunDetail(statusData.runId);
           }, 1500);
        }
      }
    } catch (err) {
      clearInterval(activeJobInterval);
      hideJobSpinner();
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

  runJob('/api/actions/generate-fast', payload);
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
  runJob('/api/actions/generate-batch', payload);
}

function submitServerGenerate() {
  const prompt = document.getElementById('srv-prompt').value;
  const negative_prompt = document.getElementById('srv-negative').value;
  const preset = document.getElementById('srv-preset').value;
  const api = document.getElementById('srv-api').value;
  const seed = document.getElementById('srv-seed').value;

  const payload = { prompt, negative_prompt, preset, api };
  if (seed) payload.seed = seed;

  runJob('/api/actions/server-generate', payload);
}

function submitCleanup() {
  const days = document.getElementById('cleanup-days').value;
  if (confirm(`Are you sure you want to delete runs older than ${days} days?`)) {
    runJob('/api/actions/clean-old-runs', { days: parseInt(days) });
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
    list.innerHTML = '<p>No runs found.</p>';
    return;
  }

  const fType = document.getElementById('filter-type').value;
  const fStatus = document.getElementById('filter-status').value;
  const fPrompt = document.getElementById('filter-prompt').value.toLowerCase();

  const filtered = allRunsCache.filter(run => {
    if (fType && run.run_type !== fType) return false;
    if (fStatus && run.status !== fStatus) return false;
    if (fPrompt && (!run.prompt || !run.prompt.toLowerCase().includes(fPrompt))) return false;
    return true;
  });

  if (filtered.length === 0) {
    list.innerHTML = '<p>No runs match filters.</p>';
    return;
  }

  filtered.forEach(run => {
    const item = document.createElement('div');
    item.className = 'run-item';
    item.style.cursor = 'pointer';
    item.onclick = () => navigateToRunDetail(run.id);
    
    let imgHtml = '';
    if (run.primary_image) {
      const safeId = encodeURIComponent(run.id);
      const safeImg = encodeURIComponent(run.primary_image);
      imgHtml = `<div class="run-item-img"><img src="/api/run-file?path=${safeId}/${safeImg}" alt="Thumbnail"></div>`;
    }

    item.innerHTML = `
      ${imgHtml}
      <div class="run-item-info">
        <strong>${escapeHtml(run.run_type || 'Unknown')}</strong> - <span class="mono">${escapeHtml(run.status || 'UNKNOWN')}</span><br>
        <span class="mono">${escapeHtml(run.id)}</span><br>
        <small>${escapeHtml(run.prompt || 'No prompt')}</small>
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
    if (latest.primary_image) {
      const safeId = encodeURIComponent(latest.id);
      const safeImg = encodeURIComponent(latest.primary_image);
      imgHtml = `<img src="/api/run-file?path=${safeId}/${safeImg}" alt="Latest generated" style="max-width: 100%; border-radius: 6px; cursor: pointer;" onclick="navigateToRunDetail('${escapeHtml(latest.id)}')">`;
      
      // Update Single Preview if it was a cli/server run
      if (latest.run_type !== 'batch') {
        document.getElementById('preview-single').innerHTML = imgHtml;
      }
    }

    targetDiv.innerHTML = `
      <p><strong>Run ID:</strong> <span class="mono"><a href="#" onclick="navigateToRunDetail('${escapeHtml(latest.id)}')">${escapeHtml(latest.id)}</a></span></p>
      <p><strong>Status:</strong> ${escapeHtml(latest.status)}</p>
      <p><strong>Prompt:</strong> ${escapeHtml(latest.prompt)}</p>
      <div style="margin-top: 10px;">${imgHtml}</div>
    `;
  }
}

async function loadRunDetail(runId) {
  const container = document.getElementById('run-detail-content');
  container.innerHTML = '<p>Loading run...</p>';

  try {
    const res = await fetch(`/api/runs/${encodeURIComponent(runId)}`);
    const data = await res.json();
    
    if (data.error) {
      container.innerHTML = `<p>Error: ${escapeHtml(data.error)}</p>`;
      return;
    }

    const m = data.metadata;
    let html = `
      <div style="margin-bottom: 20px;">
        <h3>Run Info</h3>
        <p><strong>ID:</strong> <span class="mono">${escapeHtml(m.id)}</span></p>
        <p><strong>Type:</strong> ${escapeHtml(m.run_type)}</p>
        <p><strong>Status:</strong> ${escapeHtml(m.status)}</p>
        <p><strong>Prompt:</strong> ${escapeHtml(m.prompt)}</p>
    `;

    if (m.negative_prompt) {
      html += `<p><strong>Negative:</strong> ${escapeHtml(m.negative_prompt)}</p>`;
    }

    html += `</div>`;

    if (m.primary_image) {
      const safeId = encodeURIComponent(m.id);
      const safeImg = encodeURIComponent(m.primary_image);
      html += `
        <div style="margin-bottom: 20px;">
          <h3>Primary Image</h3>
          <img src="/api/run-file?path=${safeId}/${safeImg}" style="max-width: 100%; max-height: 600px; border-radius: 6px;" alt="Primary result">
        </div>
      `;
    }

    // Reports links
    if (data.reports && data.reports.length > 0) {
      html += `<h3>Reports</h3><ul>`;
      data.reports.forEach(r => {
         const sId = encodeURIComponent(m.id);
         const sR = encodeURIComponent(r);
         html += `<li><a href="/api/run-file?path=${sId}/${sR}" target="_blank">${escapeHtml(r)}</a></li>`;
      });
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
    container.innerHTML = `<p>Error loading run: ${escapeHtml(err.message)}</p>`;
  }
}

async function checkServerStatusSilent() {
  const res = await fetch('/api/server-status');
  const data = await res.json();
  setGlobalStatus(data.status);
}

// Init
window.onload = () => {
  loadSettings();
  loadLatestRun();
  checkServerStatusSilent();
};
