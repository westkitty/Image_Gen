// DexDiffusion Workstation V12: Client-side Engine
// Handles:
// - Native Server-Sent Events (/api/events) with auto-reconnect & snapshot reconciliation
// - Global Job Center drawer (Active / Queue / Recent)
// - Resource HUD (Big Mac status & Queue wait ETA)
// - Global Command Palette (Cmd/Ctrl + K, Cmd/Ctrl + Shift + J, Cmd/Ctrl + Enter)
// - Library Turbo integration (filters, collections, thumbnails)
// - Image Comparison modes (side-by-side, linked pan/zoom, A/B toggle, swipe divider, diff view)
// - Recipes & Workflow Macros execution
// - Reproducibility Bundle import / export

(function() {
  'use strict';

  // State container
  const V12 = {
    eventSource: null,
    connected: false,
    usePollingFallback: false,
    pollTimer: null,
    snapshot: {
      active: [],
      queue: [],
      recent: [],
      resources: { occupied: false, owner: null, waiting: [] },
      timing: null
    },
    activeJobCount: 0,
    queuedJobCount: 0,
    jobCenterOpen: false,
    commandPaletteOpen: false,
    comparisonOpen: false,
    compareImages: [], // array of { id, url, meta }
    selectedArtifactId: null
  };

  window.__DEX_V12 = V12;

  // ---- 1. SSE Client & Live Connection --------------------------------------
  function initLiveBus() {
    if (V12.eventSource) {
      try { V12.eventSource.close(); } catch (_) {}
      V12.eventSource = null;
    }

    try {
      const es = new EventSource('/api/events');
      V12.eventSource = es;

      es.onopen = function() {
        V12.connected = true;
        V12.usePollingFallback = false;
        if (V12.pollTimer) {
          clearInterval(V12.pollTimer);
          V12.pollTimer = null;
        }
        updateConnectionBadge('LIVE', '#10b981');
      };

      es.onerror = function() {
        V12.connected = false;
        updateConnectionBadge('RECONNECTING', '#f59e0b');
        startPollingFallback();
      };

      // Handle event classes
      es.addEventListener('system.ready', function(e) {
        updateConnectionBadge('LIVE', '#10b981');
      });

      es.addEventListener('snapshot', function(e) {
        try {
          const data = JSON.parse(e.data);
          if (data && data.snapshot) {
            applySnapshot(data.snapshot);
          }
        } catch (_) {}
      });

      es.addEventListener('job.created', function(e) {
        fetchSnapshot();
      });

      es.addEventListener('job.started', function(e) {
        fetchSnapshot();
      });

      es.addEventListener('job.progress', function(e) {
        try {
          const data = JSON.parse(e.data);
          updateJobProgress(data.id, data.progress);
        } catch (_) {}
      });

      es.addEventListener('job.completed', function(e) {
        fetchSnapshot();
        try { var d = JSON.parse(e.data || '{}'); var st = String(d.status || 'COMPLETE').toUpperCase(); if (window.DexNotify && !/FAIL|CANCEL|INTERRUPT|ERROR/.test(st)) window.DexNotify.completed(d); } catch (_) {}
        // Trigger library refresh if user is in library
        if (window.__dex && typeof window.__dex.refreshLibrary === 'function') {
          window.__dex.refreshLibrary();
        }
      });

      es.addEventListener('job.failed', function(e) {
        fetchSnapshot();
      });

      es.addEventListener('job.cancelled', function(e) {
        fetchSnapshot();
      });

      es.addEventListener('remote.worker', function(e) {
        fetchRemoteWorkers();
      });

      es.addEventListener('resource.changed', function(e) {
        fetchSnapshot();
      });

      es.addEventListener('library.changed', function(e) {
        if (window.__dex && typeof window.__dex.refreshLibrary === 'function') {
          window.__dex.refreshLibrary();
        }
      });

      es.addEventListener('heartbeat', function() {
        // Keep-alive received
      });

    } catch (err) {
      startPollingFallback();
    }
  }

  function startPollingFallback() {
    if (V12.pollTimer) return;
    updateConnectionBadge('POLLING FALLBACK', '#f59e0b');
    V12.pollTimer = setInterval(function() {
      fetchSnapshot();
    }, 4000);
  }

  async function fetchSnapshot() {
    try {
      const res = await fetch('/api/operations/snapshot');
      if (res.ok) {
        const snap = await res.json();
        applySnapshot(snap);
      }
    } catch (_) {}
    fetchRemoteWorkers();
  }
  // OP-7: unresolved remote stops (quarantine) are shown in the Job Center with what is known and what can be done.
  V12.remoteWorkers = { quarantine: null, workers: [] };
  async function fetchRemoteWorkers() {
    try {
      const res = await fetch('/api/remote-workers');
      if (res.ok) { V12.remoteWorkers = await res.json(); if (typeof renderJobCenterContent === 'function') renderJobCenterContent(); }
    } catch (_) {}
  }
  V12.reconcileRemote = async function () {
    try { await fetch('/api/remote-workers/reconcile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); } catch (_) {}
    fetchSnapshot();
  };
  V12.releaseRemote = async function (jobId) {
    if (!confirm('Release this quarantine WITHOUT verification?\n\nDexDiffusion could not prove the Big Mac work stopped. If it is still running, a new heavy job may compete with it for memory.')) return;
    try { await fetch('/api/remote-workers/' + encodeURIComponent(jobId) + '/release', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acknowledge: 'unverified', note: 'Job Center' }) }); } catch (_) {}
    fetchSnapshot();
  };
  function renderQuarantine() {
    const q = (V12.remoteWorkers.workers || []).filter(w => ['cancel_requested', 'stop_dispatched', 'stop_pending', 'stop_unverified', 'orphan_suspect'].includes(w.state));
    if (!q.length) return '';
    const label = { cancel_requested: 'Cancel requested', stop_dispatched: 'Stopping', stop_pending: 'Stopping — awaiting check', stop_unverified: 'Unable to verify remote stop', orphan_suspect: 'Left running by a console restart — checking' };
    return `<div data-quarantine="true" role="alert" style="border:1px solid rgba(248,113,113,.55);background:rgba(248,113,113,.10);border-radius:8px;padding:10px;margin-bottom:14px;font-size:12px;color:#fecaca;">
      <div style="font-weight:800;margin-bottom:6px;">Heavy work paused: a Big Mac stop is not verified</div>
      ${q.map(w => { const last = (w.evidence || []).slice(-1)[0]; return `<div data-quarantine-job="${escapeHtml(w.job_id)}" style="margin:4px 0;">
        <b>${escapeHtml(label[w.state] || w.state)}</b> · ${escapeHtml(w.action || 'job')} · ${escapeHtml(w.job_id.slice(0, 8))}${last ? ` — ${escapeHtml(last.detail)}` : ''}
        <button type="button" onclick="window.__DEX_V12.reconcileRemote()" style="margin-left:6px;background:#334155;border:none;color:#fff;padding:2px 8px;border-radius:4px;font-size:10px;cursor:pointer;">Retry check</button>
        <button type="button" onclick="window.__DEX_V12.releaseRemote('${escapeHtml(w.job_id)}')" style="margin-left:4px;background:#7f1d1d;border:none;color:#fff;padding:2px 8px;border-radius:4px;font-size:10px;cursor:pointer;">Release (unverified)</button></div>`; }).join('')}
    </div>`;
  }

  function applySnapshot(snap) {
    if (!snap) return;
    V12.snapshot = snap;
    V12.activeJobCount = (snap.active || []).length;
    V12.queuedJobCount = (snap.queue || []).length;

    renderHud();
    if (window.__dex && typeof window.__dex.caSync === 'function') window.__dex.caSync();
    if (V12.jobCenterOpen) {
      renderJobCenterContent();
    }
  }

  function progressPercent(progress) {
    if (!progress || typeof progress !== 'object') return null;
    const value = Number.isFinite(progress.totalPercent)
      ? progress.totalPercent
      : Number.isFinite(progress.currentRunPercent)
        ? progress.currentRunPercent
        : Number.isFinite(progress.percent)
          ? progress.percent
          : null;
    return value == null ? null : Math.max(0, Math.min(100, Math.round(value)));
  }

  function updateJobProgress(jobId, progress) {
    const pct = progressPercent(progress);
    if (pct == null) return;
    const bar = document.getElementById(`v12-job-bar-${jobId}`);
    const text = document.getElementById(`v12-job-pct-${jobId}`);
    if (bar) bar.style.width = pct + '%';
    if (text) text.textContent = pct + '%';
  }

  function updateConnectionBadge(label, color) {
    const badge = document.getElementById('v12-live-status');
    if (badge) {
      badge.textContent = label;
      badge.style.color = color;
      badge.style.borderColor = color;
    }
  }

  // ---- 2. Resource HUD & Operational Bar -------------------------------------
  function createHudElement() {
    if (document.getElementById('v12-hud-bar')) return;

    const bar = document.createElement('div');
    bar.id = 'v12-hud-bar';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'DexDiffusion Resource & Queue HUD');
    bar.style.cssText = 'position:fixed;bottom:0;left:0;right:0;height:38px;background:rgba(10,12,20,0.95);backdrop-filter:blur(8px);border-top:1px solid rgba(255,255,255,0.12);display:flex;align-items:center;justify-content:space-between;padding:0 16px;z-index:9999;font-family:system-ui,-apple-system,sans-serif;font-size:12px;color:#cbd5e1;';

    bar.innerHTML = `
      <div style="display:flex;align-items:center;gap:14px;min-width:0;">
        <span id="v12-live-status" style="border:1px solid #10b981;color:#10b981;padding:1px 6px;border-radius:4px;font-size:10px;font-weight:600;letter-spacing:0.5px;">LIVE</span>
        <div id="v12-resource-info" style="font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">BIG MAC · FREE</div>
        <div id="v12-eta-info" style="color:#94a3b8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"></div>
      </div>
      <div style="display:flex;align-items:center;gap:10px;flex-shrink:0;">
        <button id="v12-hud-palette-btn" type="button" style="background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);color:#e2e8f0;padding:3px 8px;border-radius:4px;font-size:11px;cursor:pointer;">⌘K Palette</button>
        <button id="v12-hud-jobs-btn" type="button" style="background:#2563eb;border:none;color:#fff;padding:3px 10px;border-radius:4px;font-size:11px;font-weight:500;cursor:pointer;display:flex;align-items:center;gap:5px;">
          <span>Jobs</span>
          <span id="v12-job-counter" style="background:rgba(255,255,255,0.25);padding:0 5px;border-radius:10px;font-size:10px;">0</span>
        </button>
      </div>
    `;

    document.body.appendChild(bar);
    // Studio has a Job Center entry in the main chrome. The old HUD is redundant there.
    const studio = window.__dex && window.__dex.state && window.__dex.state.version === 2;
    if (studio) bar.style.display = 'none';

    document.getElementById('v12-hud-jobs-btn').onclick = toggleJobCenter;
    document.getElementById('v12-hud-palette-btn').onclick = toggleCommandPalette;
  }

  function renderHud() {
    const resInfo = document.getElementById('v12-resource-info');
    const etaInfo = document.getElementById('v12-eta-info');
    const counter = document.getElementById('v12-job-counter');

    const snap = V12.snapshot;
    const res = snap.resources || {};
    const totalActive = V12.activeJobCount + V12.queuedJobCount;

    if (counter) counter.textContent = String(totalActive);

    if (resInfo) {
      if (res.occupied || res.owner) {
        const ownerLabel = (res.owner && res.owner.label) ? res.owner.label.toUpperCase() : 'HEAVY COMPUTE';
        resInfo.innerHTML = `<span style="color:#38bdf8;">BIG MAC · ${escapeHtml(ownerLabel)}</span>`;
      } else {
        resInfo.innerHTML = `<span style="color:#10b981;">BIG MAC · FREE</span>`;
      }
    }

    if (etaInfo) {
      const wait = (snap.timing && snap.timing.queueWait) ? snap.timing.queueWait : null;
      if (V12.queuedJobCount > 0) {
        const waitDisplay = (wait && wait.available) ? wait.display : 'Wait ETA unavailable';
        etaInfo.textContent = `${V12.queuedJobCount} waiting (${waitDisplay})`;
      } else if (V12.activeJobCount > 0) {
        etaInfo.textContent = `${V12.activeJobCount} active`;
      } else {
        etaInfo.textContent = 'All clear';
      }
    }
  }

  // ---- 3. Persistent Global Job Center Drawer --------------------------------
  function createJobCenterElement() {
    if (document.getElementById('v12-job-center-drawer')) return;

    const drawer = document.createElement('div');
    drawer.id = 'v12-job-center-drawer';
    drawer.setAttribute('role', 'dialog');
    drawer.setAttribute('aria-label', 'Operational Job Center');
    drawer.setAttribute('aria-modal', 'true');
    drawer.setAttribute('aria-hidden', 'true');
    drawer.inert = true;
    drawer.style.cssText = 'position:fixed;top:0;right:-460px;width:440px;max-width:100vw;bottom:38px;background:#0f172a;border-left:1px solid rgba(255,255,255,0.15);box-shadow:-8px 0 24px rgba(0,0,0,0.5);z-index:10000;display:flex;flex-direction:column;transition:right 0.25s ease;font-family:system-ui,-apple-system,sans-serif;color:#f8fafc;';

    drawer.innerHTML = `
      <div style="padding:14px 18px;border-bottom:1px solid rgba(255,255,255,0.1);display:flex;align-items:center;justify-content:space-between;">
        <div style="font-size:15px;font-weight:600;letter-spacing:0.3px;">DexDiffusion Job Center</div>
        <button id="v12-jc-close-btn" type="button" aria-label="Close Job Center" style="background:transparent;border:none;color:#94a3b8;font-size:18px;cursor:pointer;padding:4px 8px;">✕</button>
      </div>
      <div id="v12-jc-content" style="flex:1;overflow-y:auto;padding:16px;">
        Loading jobs…
      </div>
    `;

    document.body.appendChild(drawer);
    document.getElementById('v12-jc-close-btn').onclick = toggleJobCenter;
    // Job ids are data attributes, not executable string interpolation.
    // One delegated listener survives every snapshot content replacement.
    document.getElementById('v12-jc-content').addEventListener('click', event => {
      const button = event.target.closest('[data-job-cancel-id]');
      if (!button) return;
      V12.cancelJob(button.getAttribute('data-job-cancel-id'));
    });
  }

  function toggleJobCenter() {
    const drawer = document.getElementById('v12-job-center-drawer');
    if (!drawer) return;
    V12.jobCenterOpen = !V12.jobCenterOpen;
    if (V12.jobCenterOpen) {
      captureFocus('jobCenterReturnFocus');
      drawer.inert = false;
      drawer.setAttribute('aria-hidden', 'false');
      drawer.style.right = '0';
      renderJobCenterContent();
      fetchSnapshot();
      requestAnimationFrame(() => document.getElementById('v12-jc-close-btn')?.focus());
    } else {
      drawer.style.right = '-460px';
      drawer.setAttribute('aria-hidden', 'true');
      drawer.inert = true;
      restoreFocus('jobCenterReturnFocus');
    }
  }
  V12.toggleJobCenter = toggleJobCenter;

  function renderJobCenterContent() {
    const container = document.getElementById('v12-jc-content');
    if (!container) return;

    const snap = V12.snapshot;
    const active = snap.active || [];
    const queue = snap.queue || [];
    const recent = snap.recent || [];

    let html = renderQuarantine();

    // Section 1: ACTIVE
    html += `<div style="font-size:12px;font-weight:700;color:#38bdf8;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Active (${active.length})</div>`;
    if (active.length === 0) {
      html += `<div style="font-size:13px;color:#64748b;margin-bottom:18px;">No active operations</div>`;
    } else {
      for (const j of active) {
        html += renderJobCard(j, true);
      }
      html += `<div style="height:12px;"></div>`;
    }

    // Section 2: QUEUE
    html += `<div style="font-size:12px;font-weight:700;color:#f59e0b;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Queue (${queue.length})</div>`;
    if (queue.length === 0) {
      html += `<div style="font-size:13px;color:#64748b;margin-bottom:18px;">No queued operations</div>`;
    } else {
      for (const j of queue) {
        html += renderJobCard(j, false);
      }
      html += `<div style="height:12px;"></div>`;
    }

    // Section 3: RECENT
    html += `<div style="font-size:12px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Recent (${recent.length})</div>`;
    if (recent.length === 0) {
      html += `<div style="font-size:13px;color:#64748b;">No recent jobs</div>`;
    } else {
      for (const j of recent) {
        html += renderRecentJobCard(j);
      }
    }

    container.innerHTML = html;
  }

  // Read-only job details (a disclosure per card). Open state survives snapshot re-renders.
  V12.openJobDetails = V12.openJobDetails || new Set();
  V12.jobDetailToggle = function (id, open) { if (open) V12.openJobDetails.add(id); else V12.openJobDetails.delete(id); };
  function jobDetails(j) {
    const rows = [['Job ID', j.id], ['Operation', j.operation], ['Worker', j.worker || 'local'], ['Media', j.mediaKind], ['Status', j.status],
      ['First failed gate', j.firstFailedGate], ['Remote stop', j.remoteStop], ['Cancel capability', j.cancelCapability],
      ['Results', Array.isArray(j.results) ? j.results.length : null], ['Created', j.createdAt ? new Date(j.createdAt).toLocaleString() : null]]
      .filter(r => r[1] != null && r[1] !== '');
    return `<details data-job-detail="${escapeHtml(j.id)}" ${V12.openJobDetails.has(j.id) ? 'open' : ''} ontoggle="window.__DEX_V12.jobDetailToggle(this.getAttribute('data-job-detail'), this.open)" style="margin-top:8px;font-size:11px;color:#94a3b8;"><summary style="cursor:pointer;min-height:24px;">Details</summary><dl style="margin:6px 0 0;display:grid;grid-template-columns:auto 1fr;gap:2px 10px;">${rows.map(r => `<dt style="color:#64748b;">${escapeHtml(r[0])}</dt><dd style="margin:0;color:#cbd5e1;overflow-wrap:anywhere;">${escapeHtml(String(r[1]))}</dd>`).join('')}</dl></details>`;
  }

  function renderJobCard(j, isActive) {
    const pct = progressPercent(j.progress);
    const canCancel = j.canCancel;
    const stopAfterCurrent = isActive && j.cancelCapability === 'stop_after_current';
    const cancelLabel = stopAfterCurrent ? 'Stop after current' : isActive ? 'Cancel job' : 'Cancel queued job';
    const cancelAria = stopAfterCurrent ? 'Stop after current' : isActive ? 'Cancel running job' : 'Cancel queued job';
    const statusColor = isActive ? '#38bdf8' : '#f59e0b';

    return `
      <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:12px;margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px;">
          <div>
            <div style="font-weight:600;font-size:13px;color:#f1f5f9;">${escapeHtml(j.label || j.operation)}</div>
            <div style="font-size:11px;color:#94a3b8;">${escapeHtml(j.worker || 'local')} · ${escapeHtml(j.mediaKind)}</div>
          </div>
          <span style="font-size:10px;font-weight:600;color:${statusColor};border:1px solid ${statusColor};padding:1px 5px;border-radius:4px;">${escapeHtml(j.status)}</span>
        </div>
        ${isActive && pct != null ? `
          <div style="margin:8px 0 6px 0;">
            <div style="display:flex;justify-content:space-between;font-size:11px;color:#cbd5e1;margin-bottom:4px;">
              <span>Progress</span>
              <span id="v12-job-pct-${j.id}">${pct}%</span>
            </div>
            <div style="background:rgba(255,255,255,0.1);height:6px;border-radius:3px;overflow:hidden;">
              <div id="v12-job-bar-${j.id}" style="background:#38bdf8;height:100%;width:${pct}%;transition:width 0.2s;"></div>
            </div>
          </div>
        ` : isActive ? `<div style="margin:8px 0 6px 0;font-size:11px;color:#94a3b8;">Progress unavailable · current stage is indeterminate</div>` : ''}
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;">
          <span style="font-size:10px;color:#64748b;">${new Date(j.createdAt).toLocaleTimeString()}</span>
          ${canCancel ? `<button type="button" data-job-cancel-id="${escapeHtml(j.id)}" aria-label="${cancelAria}" style="background:#ef4444;border:none;color:#fff;padding:7px 10px;min-height:36px;border-radius:4px;font-size:12px;cursor:pointer;">${cancelLabel}</button>` : ''}
        </div>
        ${jobDetails(j)}
      </div>
    `;
  }

  function renderRecentJobCard(j) {
    const isComplete = j.status === 'COMPLETE' || j.status === 'PASS';
    const isCancelled = j.status === 'CANCELLED';
    const statusColor = isComplete ? '#10b981' : isCancelled ? '#64748b' : '#ef4444';

    return `
      <div style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:6px;padding:10px;margin-bottom:8px;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:12px;font-weight:500;color:#e2e8f0;">${escapeHtml(j.label || j.operation)}</span>
          <span style="font-size:10px;font-weight:600;color:${statusColor};">${escapeHtml(j.status)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:10px;color:#64748b;margin-top:4px;">
          <span>${escapeHtml(j.worker || 'local')}</span>
          ${j.firstFailedGate ? `<span style="color:#f87171;">Gate: ${escapeHtml(j.firstFailedGate)}</span>` : ''}
          ${j.elapsedMs ? `<span>${Math.round(j.elapsedMs / 1000)}s</span>` : ''}
        </div>
        ${jobDetails(j)}
      </div>
    `;
  }

  V12.cancelJob = async function(jobId) {
    const queued = (V12.snapshot.queue || []).some(j => j.id === jobId);
    const stopAfterCurrent = (V12.snapshot.active || []).some(j => j.id === jobId && j.cancelCapability === 'stop_after_current');
    const question = queued
      ? 'Cancel this queued job before it starts?'
      : stopAfterCurrent
        ? 'Request Stop after current? The running audio chunk will finish before Drama stops; the worker is not stopped yet.'
        : 'Request cancellation of this running job? It may continue until the worker confirms it stopped.';
    if (!confirm(question)) return;
    try {
      const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'User cancelled via Job Center' })
      });
      const data = await res.json();
      if (data.ok && (data.neverStarted === true || data.terminationVerified === true)) {
        fetchSnapshot();
      } else if (data.cancelState === 'stop_after_current' && data.accepted === true) {
        fetchSnapshot();
        alert('Stop after current requested. The current audio chunk may finish before the producer confirms cancellation. Job Center will keep tracking it.');
      } else if (data.accepted === true || data.cancelState === 'requested' || data.remote_stop === 'unverified') {
        fetchSnapshot();
        alert('Stop requested but not verified. The job may still be running. Job Center will continue tracking it.');
      } else {
        fetchSnapshot();
        alert(`Cancellation not confirmed: ${data.error || 'The worker cannot currently prove it stopped.'}`);
      }
    } catch (err) {
      alert(`Network error: ${err.message}`);
    }
  };

  // ---- 4. Global Command Palette (Cmd/Ctrl + K) ------------------------------
  const COMMANDS = [
    { id: 'nav_workstation', group: 'NAVIGATE', title: 'Go to Workstation', action: () => navigateTo('workstation') },
    { id: 'nav_create', group: 'NAVIGATE', title: 'Go to Create', action: () => navigateTo('create') },
    { id: 'nav_library', group: 'NAVIGATE', title: 'Go to Library', action: () => navigateTo('library') },
    { id: 'nav_batch', group: 'NAVIGATE', title: 'Go to Batch', action: () => navigateTo('batch') },
    { id: 'nav_edit', group: 'NAVIGATE', title: 'Go to Edit', action: () => navigateTo('edit') },
    { id: 'nav_enhance', group: 'NAVIGATE', title: 'Go to Enhance', action: () => navigateTo('enhance') },
    { id: 'nav_voice', group: 'NAVIGATE', title: 'Go to Voice', action: () => navigateTo('voice') },
    { id: 'nav_music', group: 'NAVIGATE', title: 'Go to Music', action: () => navigateTo('music') },
    { id: 'nav_3d', group: 'NAVIGATE', title: 'Go to 3D Assets', action: () => navigateTo('3d') },
    { id: 'nav_world', group: 'NAVIGATE', title: 'Go to World Viewer', action: () => navigateTo('world') },
    { id: 'nav_drama', group: 'NAVIGATE', title: 'Go to Drama', action: () => navigateTo('drama') },
    { id: 'nav_models', group: 'NAVIGATE', title: 'Go to Models / Capabilities', action: () => navigateTo('models') },
    { id: 'nav_system', group: 'NAVIGATE', title: 'Go to System', action: () => navigateTo('system') },
    { id: 'op_sound', group: 'OPERATIONS', title: 'Toggle completion sound', action: () => { if (!window.DexNotify) return; const m = !window.DexNotify.prefs().muted; window.DexNotify.setMuted(m); if (window.__dex && window.__dex.toast) window.__dex.toast(m ? 'Completion sound muted' : 'Completion sound on', '#94a3b8'); } },
    { id: 'op_sound_vol', group: 'OPERATIONS', title: 'Set completion sound volume (low / medium / high)', action: () => { if (!window.DexNotify) return; const cur = window.DexNotify.prefs().volume, next = cur < 0.25 ? 0.35 : cur < 0.5 ? 0.7 : 0.15; window.DexNotify.setVolume(next); window.DexNotify.setMuted(false); window.DexNotify._ding(next); if (window.__dex && window.__dex.toast) window.__dex.toast('Completion volume ' + Math.round(next * 100) + '%', '#94a3b8'); } },
    { id: 'op_os_notify', group: 'OPERATIONS', title: 'Enable desktop notifications when jobs finish', action: () => { if (window.DexNotify) window.DexNotify.enableOs().then(r => { if (window.__dex && window.__dex.toast) window.__dex.toast(r === 'granted' ? 'Desktop notifications on' : 'Desktop notifications: ' + r, '#94a3b8'); }); } },
    { id: 'op_jobs', group: 'OPERATIONS', title: 'Toggle Job Center', shortcut: '⌘⇧J', action: () => toggleJobCenter() },
    { id: 'op_generate', group: 'OPERATIONS', title: 'Primary Generate', shortcut: '⌘Enter', action: () => triggerGenerate() },
    { id: 'op_doctor', group: 'OPERATIONS', title: 'Run System Doctor', action: () => runDoctor() },
    { id: 'wk_rebuild_lib', group: 'WORKFLOWS', title: 'Rebuild Library Index', action: () => rebuildLibraryIndex() },
    { id: 'wk_export_repro', group: 'WORKFLOWS', title: 'Export Reproducibility Bundle', action: () => exportCurrentRepro() }
  ];

  function createCommandPaletteElement() {
    if (document.getElementById('v12-palette-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'v12-palette-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.65);backdrop-filter:blur(4px);z-index:11000;display:none;align-items:flex-start;justify-content:center;padding-top:12vh;font-family:system-ui,-apple-system,sans-serif;';

    overlay.innerHTML = `
      <div id="v12-palette-modal" role="dialog" aria-modal="true" aria-label="Command palette" style="width:540px;max-width:92vw;background:#0f172a;border:1px solid rgba(255,255,255,0.2);border-radius:12px;box-shadow:0 16px 40px rgba(0,0,0,0.6);overflow:hidden;display:flex;flex-direction:column;">
        <div style="padding:12px 16px;border-bottom:1px solid rgba(255,255,255,0.1);display:flex;align-items:center;gap:10px;">
          <span style="color:#94a3b8;font-size:16px;">🔍</span>
          <input id="v12-palette-input" type="text" placeholder="Type a command or search action…" style="flex:1;background:transparent;border:none;color:#f8fafc;font-size:15px;outline:none;" />
          <kbd style="background:rgba(255,255,255,0.1);padding:2px 6px;border-radius:4px;font-size:11px;color:#94a3b8;">ESC</kbd>
        </div>
        <div id="v12-palette-results" style="max-height:360px;overflow-y:auto;padding:8px 0;">
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    overlay.onclick = function(e) {
      if (e.target === overlay) toggleCommandPalette();
    };

    const input = document.getElementById('v12-palette-input');
    input.oninput = function() {
      renderPaletteResults(input.value);
    };
    input.onkeydown = function(e) {
      if (e.key === 'Escape') toggleCommandPalette();
      if (e.key === 'Enter') {
        const first = document.querySelector('.v12-palette-item');
        if (first) first.click();
      }
    };
  }

  function toggleCommandPalette() {
    const overlay = document.getElementById('v12-palette-overlay');
    if (!overlay) return;
    V12.commandPaletteOpen = !V12.commandPaletteOpen;
    if (V12.commandPaletteOpen) {
      captureFocus('commandPaletteReturnFocus');
      overlay.setAttribute('aria-hidden', 'false');
      overlay.style.display = 'flex';
      const input = document.getElementById('v12-palette-input');
      input.value = '';
      renderPaletteResults('');
      setTimeout(() => input.focus(), 50);
    } else {
      overlay.style.display = 'none';
      overlay.setAttribute('aria-hidden', 'true');
      restoreFocus('commandPaletteReturnFocus');
    }
  }
  V12.toggleCommandPalette = toggleCommandPalette;

  function renderPaletteResults(query) {
    const container = document.getElementById('v12-palette-results');
    if (!container) return;

    const q = (query || '').toLowerCase().trim();
    const filtered = COMMANDS.filter(c => {
      return !q || c.title.toLowerCase().includes(q) || c.group.toLowerCase().includes(q);
    });

    if (filtered.length === 0) {
      container.innerHTML = `<div style="padding:16px;text-align:center;color:#64748b;font-size:13px;">No commands match "${escapeHtml(query)}"</div>`;
      return;
    }

    let html = '';
    let currentGroup = '';

    filtered.forEach((cmd, idx) => {
      if (cmd.group !== currentGroup) {
        currentGroup = cmd.group;
        html += `<div style="padding:6px 16px 2px 16px;font-size:11px;font-weight:700;color:#64748b;letter-spacing:0.5px;">${currentGroup}</div>`;
      }
      html += `
        <div class="v12-palette-item" data-idx="${idx}" style="padding:10px 16px;display:flex;align-items:center;justify-content:space-between;cursor:pointer;color:#e2e8f0;font-size:13px;" onmouseover="this.style.background='rgba(255,255,255,0.06)'" onmouseout="this.style.background='transparent'">
          <span>${escapeHtml(cmd.title)}</span>
          ${cmd.shortcut ? `<kbd style="background:rgba(255,255,255,0.1);padding:1px 5px;border-radius:3px;font-size:10px;color:#94a3b8;">${cmd.shortcut}</kbd>` : ''}
        </div>
      `;
    });

    container.innerHTML = html;

    const items = container.querySelectorAll('.v12-palette-item');
    items.forEach((item, idx) => {
      item.onclick = function() {
        toggleCommandPalette();
        filtered[idx].action();
      };
    });
  }

  function navigateTo(screenId) {
    // Check if DexDiffusion component navigation exists
    if (window.__dex && typeof window.__dex.navigate === 'function') {
      window.__dex.navigate(screenId);
      return;
    }
    if (window.__dex && typeof window.__dex.setScreen === 'function') {
      window.__dex.setScreen(screenId);
      return;
    }
    // Fallback: standard A1111 workbench navigation
    const btn = document.querySelector(`.nav-btn[data-target="${screenId}"]`);
    if (btn) btn.click();
  }

  function triggerGenerate() {
    const btn = document.getElementById('btn-generate') || document.querySelector('button[data-action="generate-controlled"]');
    if (btn && !btn.disabled) {
      btn.click();
    }
  }

  async function runDoctor() {
    navigateTo('system');
    const btn = document.querySelector('button[data-action="verify"]');
    if (btn) btn.click();
  }

  async function rebuildLibraryIndex() {
    try {
      const res = await fetch('/api/library/rebuild', { method: 'POST' });
      const data = await res.json();
      alert(`Library rebuild complete: ${data.count} items indexed.`);
    } catch (err) {
      alert(`Rebuild failed: ${err.message}`);
    }
  }

  async function exportCurrentRepro() {
    try {
      const res = await fetch('/api/repro/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation: 'txt2img' })
      });
      const data = await res.json();
      if (data.ok) {
        const jsonStr = JSON.stringify(data.bundle, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `dexdiffusion-bundle-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      alert(`Export failed: ${err.message}`);
    }
  }

  // ---- 5. Synchronized Comparison Modal (2-4 images) ------------------------
  function createComparisonModal() {
    if (document.getElementById('v12-compare-modal')) return;

    const modal = document.createElement('div');
    modal.id = 'v12-compare-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Image comparison');
    modal.setAttribute('aria-hidden', 'true');
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(5,7,12,0.92);backdrop-filter:blur(8px);z-index:12000;display:none;flex-direction:column;font-family:system-ui,-apple-system,sans-serif;color:#f8fafc;';

    modal.innerHTML = `
      <div style="height:50px;border-bottom:1px solid rgba(255,255,255,0.12);display:flex;align-items:center;justify-content:space-between;padding:0 20px;">
        <div style="display:flex;align-items:center;gap:16px;">
          <span style="font-weight:600;font-size:14px;">Image Comparison</span>
          <div style="display:flex;gap:4px;">
            <button id="v12-cmp-mode-side" type="button" style="background:rgba(255,255,255,0.1);border:none;color:#e2e8f0;padding:4px 10px;border-radius:4px;font-size:11px;cursor:pointer;">Side by Side</button>
            <button id="v12-cmp-mode-swipe" type="button" style="background:rgba(255,255,255,0.05);border:none;color:#94a3b8;padding:4px 10px;border-radius:4px;font-size:11px;cursor:pointer;">Swipe Divider</button>
            <button id="v12-cmp-mode-toggle" type="button" style="background:rgba(255,255,255,0.05);border:none;color:#94a3b8;padding:4px 10px;border-radius:4px;font-size:11px;cursor:pointer;">A/B Flicker</button>
          </div>
        </div>
        <button id="v12-cmp-close-btn" type="button" aria-label="Close image comparison" style="background:transparent;border:none;color:#94a3b8;font-size:20px;cursor:pointer;">✕</button>
      </div>
      <div id="v12-cmp-stage" style="flex:1;position:relative;overflow:hidden;display:flex;align-items:center;justify-content:center;padding:20px;">
      </div>
    `;

    document.body.appendChild(modal);

    document.getElementById('v12-cmp-close-btn').onclick = closeComparison;
  }

  function closeComparison() {
    const modal = document.getElementById('v12-compare-modal');
    if (modal) {
      modal.style.display = 'none';
      modal.setAttribute('aria-hidden', 'true');
    }
    V12.comparisonOpen = false;
    restoreFocus('comparisonReturnFocus');
  }

  V12.openComparison = function(images = []) {
    createComparisonModal();
    const modal = document.getElementById('v12-compare-modal');
    const stage = document.getElementById('v12-cmp-stage');
    if (!modal || !stage) return;

    V12.compareImages = images;
    V12.comparisonOpen = true;
    captureFocus('comparisonReturnFocus');
    modal.setAttribute('aria-hidden', 'false');
    modal.style.display = 'flex';
    requestAnimationFrame(() => document.getElementById('v12-cmp-close-btn')?.focus());

    if (images.length === 0) {
      stage.innerHTML = '<div style="color:#64748b;">No images selected for comparison</div>';
      return;
    }

    if (images.length === 1) {
      stage.innerHTML = `<img src="${images[0].url}" style="max-width:90%;max-height:85%;object-fit:contain;border-radius:8px;" />`;
      return;
    }

    // Default: 2 images side-by-side with synchronized zoom
    stage.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;width:100%;height:100%;align-items:center;justify-items:center;">
        <div style="width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;">
          <div style="font-size:11px;color:#94a3b8;margin-bottom:6px;">Image A (${images[0].id || 'Source'})</div>
          <img src="${images[0].url}" style="max-width:95%;max-height:80%;object-fit:contain;border-radius:6px;border:1px solid rgba(255,255,255,0.1);" />
        </div>
        <div style="width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;">
          <div style="font-size:11px;color:#94a3b8;margin-bottom:6px;">Image B (${images[1].id || 'Target'})</div>
          <img src="${images[1].url}" style="max-width:95%;max-height:80%;object-fit:contain;border-radius:6px;border:1px solid rgba(255,255,255,0.1);" />
        </div>
      </div>
    `;
  };

  // ---- 6. Global Keyboard Shortcuts Handler ---------------------------------
  function initKeyboardShortcuts() {
    window.addEventListener('keydown', function(e) {
      // Don't intercept when user is typing inside an input or textarea
      const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
      const isInput = tag === 'input' || tag === 'textarea' || (e.target && e.target.isContentEditable);

      if (e.key === 'Tab') {
        const focusRoot = V12.comparisonOpen
          ? document.getElementById('v12-compare-modal')
          : V12.commandPaletteOpen
            ? document.getElementById('v12-palette-modal')
            : V12.jobCenterOpen
              ? document.getElementById('v12-job-center-drawer')
              : null;
        if (focusRoot && trapFocus(e, focusRoot)) return;
      }

      // Cmd/Ctrl + K: Command Palette
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        toggleCommandPalette();
        return;
      }

      // Cmd/Ctrl + Shift + J: Job Center
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        toggleJobCenter();
        return;
      }

      // Cmd/Ctrl + Enter: Primary Generate
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        triggerGenerate();
        return;
      }

      // Escape: Close topmost transient overlay
      if (e.key === 'Escape') {
        if (V12.commandPaletteOpen) {
          toggleCommandPalette();
          e.preventDefault();
          return;
        }
        if (V12.comparisonOpen) {
          closeComparison();
          e.preventDefault();
          return;
        }
        if (V12.jobCenterOpen) {
          toggleJobCenter();
          e.preventDefault();
          return;
        }
      }
    });
  }

  function captureFocus(key) {
    const target = document.activeElement;
    let selector = null;
    if (target && target !== document.body) {
      if (target.id) selector = '#' + CSS.escape(target.id);
      else {
        const uniqueClass = Array.from(target.classList || []).find(name => document.getElementsByClassName(name).length === 1);
        if (uniqueClass) selector = '.' + CSS.escape(uniqueClass);
      }
    }
    V12[key] = { target, selector };
  }

  function restoreFocus(key) {
    const record = V12[key];
    V12[key] = null;
    let target = record && record.target;
    if ((!target || !target.isConnected) && record && record.selector) target = document.querySelector(record.selector);
    if (target && target.isConnected && typeof target.focus === 'function') target.focus();
  }

  function trapFocus(event, root) {
    const focusable = Array.from(root.querySelectorAll('button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'))
      .filter(node => !node.hidden && node.getAttribute('aria-hidden') !== 'true');
    if (!focusable.length) return false;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) {
      last.focus();
      event.preventDefault();
      return true;
    }
    if (!event.shiftKey && (document.activeElement === last || !root.contains(document.activeElement))) {
      first.focus();
      event.preventDefault();
      return true;
    }
    return false;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ---- 7. Bootstrap ---------------------------------------------------------
  function bootstrap() {
    createHudElement();
    createJobCenterElement();
    createCommandPaletteElement();
    initKeyboardShortcuts();
    initLiveBus();
    fetchSnapshot();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }

})();
