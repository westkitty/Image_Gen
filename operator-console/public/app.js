// UI Logic

let activeJobInterval = null;

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

  txt.textContent = `Backend Status: ${statusStr}`;
}

function showJobSpinner() {
  document.getElementById('global-job-status').classList.remove('hidden');
}

function hideJobSpinner() {
  document.getElementById('global-job-status').classList.add('hidden');
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
      document.getElementById('job-log-output').textContent = 'Error: ' + JSON.stringify(data);
      hideJobSpinner();
    }
  } catch (err) {
    document.getElementById('job-log-output').textContent = 'Fetch Error: ' + err.message;
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
        // Trigger a refresh of the latest runs
        loadLatestRun();
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
  const preset = document.getElementById('gen-preset').value;
  const mode = document.getElementById('gen-mode').value;
  const seed = document.getElementById('gen-seed').value;

  const payload = { prompt, preset, mode };
  if (seed) payload.seed = seed;

  if (mode === 'cli') {
    runJob('/api/actions/generate-fast', payload);
  } else {
    runJob('/api/actions/server-generate', { ...payload, api: 'openai' });
  }
}

function submitGenerateBatch() {
  const prompt = document.getElementById('batch-prompt').value;
  const count = document.getElementById('batch-count').value;
  const preset = document.getElementById('batch-preset').value;
  const seedMode = document.getElementById('batch-seed-mode').value;

  const payload = { prompt, count: parseInt(count), preset, seedMode: seedMode, mode: 'cli', seedStart: 42 };
  runJob('/api/actions/generate-batch', payload);
}

// Data Loading
async function loadRuns() {
  const res = await fetch('/api/runs');
  const data = await res.json();
  const list = document.getElementById('run-list');
  list.innerHTML = '';
  
  if (data.runs.length === 0) {
    list.innerHTML = '<p>No runs found.</p>';
    return;
  }

  data.runs.forEach(run => {
    const item = document.createElement('div');
    item.className = 'run-item';
    
    // Safely resolve the image path through our static handler
    let imgHtml = '';
    if (run.primary_image) {
      imgHtml = `<div class="run-item-img"><img src="/api/run-file?path=${run.id}/${run.primary_image}" alt="Primary Image"></div>`;
    }

    item.innerHTML = `
      ${imgHtml}
      <div class="run-item-info">
        <strong>${run.run_type || 'Unknown'}</strong> - <span class="mono">${run.status || 'UNKNOWN'}</span><br>
        <span class="mono">${run.id}</span><br>
        <small>${run.prompt || 'No prompt'}</small>
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
      imgHtml = `<img src="/api/run-file?path=${latest.id}/${latest.primary_image}" alt="Latest generated" style="max-width: 100%; border-radius: 6px;">`;
      
      // Update Single Preview if it was a cli/server run
      if (latest.run_type !== 'batch') {
        document.getElementById('preview-single').innerHTML = imgHtml;
      }
    }

    targetDiv.innerHTML = `
      <p><strong>Run ID:</strong> <span class="mono">${latest.id}</span></p>
      <p><strong>Status:</strong> ${latest.status}</p>
      <p><strong>Prompt:</strong> ${latest.prompt}</p>
      <div style="margin-top: 10px;">${imgHtml}</div>
    `;
  }
}

async function checkServerStatusSilent() {
  const res = await fetch('/api/server-status');
  const data = await res.json();
  setGlobalStatus(data.status);
}

// Init
window.onload = () => {
  loadLatestRun();
  checkServerStatusSilent();
};
