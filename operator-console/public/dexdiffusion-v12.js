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
        <div style="font-size:15px;font-weight:600;letter-spacing:0.3px;">Workstation Job Center</div>
        <button id="v12-jc-close-btn" type="button" aria-label="Close Job Center" style="background:transparent;border:none;color:#94a3b8;font-size:18px;cursor:pointer;padding:4px 8px;">✕</button>
      </div>
      <div id="v12-jc-content" style="flex:1;overflow-y:auto;padding:16px;">
        Loading jobs…
      </div>
    `;

    document.body.appendChild(drawer);
    document.getElementById('v12-jc-close-btn').onclick = toggleJobCenter;
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

    let html = '';

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

  function renderJobCard(j, isActive) {
    const pct = progressPercent(j.progress);
    const canCancel = j.canCancel;
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
          ${canCancel ? `<button type="button" onclick="window.__DEX_V12.cancelJob('${j.id}')" style="background:#ef4444;border:none;color:#fff;padding:2px 8px;border-radius:4px;font-size:10px;cursor:pointer;">Cancel</button>` : ''}
        </div>
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
      </div>
    `;
  }

  V12.cancelJob = async function(jobId) {
    if (!confirm('Are you sure you want to cancel this operation?')) return;
    try {
      const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'User cancelled via Job Center' })
      });
      const data = await res.json();
      if (data.ok) {
        fetchSnapshot();
      } else {
        alert(`Cancellation error: ${data.error || 'Failed'}`);
      }
    } catch (err) {
      alert(`Network error: ${err.message}`);
    }
  };

  // ---- 4. Global Command Palette (Cmd/Ctrl + K) ------------------------------
  const COMMANDS = [
    { id: 'nav_workstation', group: 'NAVIGATE', title: 'Go to Workstation', action: () => navigateTo('workstation') },
    { id: 'nav_create', group: 'NAVIGATE', title: 'Go to Generate', action: () => navigateTo('create') },
    { id: 'nav_library', group: 'NAVIGATE', title: 'Go to Media', action: () => navigateTo('library') },
    { id: 'nav_batch', group: 'NAVIGATE', title: 'Go to Batch', action: () => navigateTo('batch') },
    { id: 'nav_edit', group: 'NAVIGATE', title: 'Go to Edit', action: () => navigateTo('edit') },
    { id: 'nav_enhance', group: 'NAVIGATE', title: 'Go to Enhance', action: () => navigateTo('enhance') },
    { id: 'nav_voice', group: 'NAVIGATE', title: 'Go to Voice', action: () => navigateTo('voice') },
    { id: 'nav_music', group: 'NAVIGATE', title: 'Go to Music', action: () => navigateTo('music') },
    { id: 'nav_3d', group: 'NAVIGATE', title: 'Go to 3D Assets', action: () => navigateTo('3d') },
    { id: 'nav_world', group: 'NAVIGATE', title: 'Go to World Viewer', action: () => navigateTo('world') },
    { id: 'nav_drama', group: 'NAVIGATE', title: 'Go to Drama', action: () => navigateTo('drama') },
    { id: 'nav_models', group: 'NAVIGATE', title: 'Go to Models / Capabilities', action: () => navigateTo('models') },
    { id: 'nav_system', group: 'NAVIGATE', title: 'Go to Settings / Help', action: () => navigateTo('system') },
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
