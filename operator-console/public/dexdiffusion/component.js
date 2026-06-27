// DexDiffusion component — ported verbatim from DexDiffusion_Combined.dc.html
// Runs on the lightweight DC-compatible runtime in dc-runtime.js (DCLogic + React.createElement).
// The fictional A1111 onGenerate() stub (sdapi/v1) was removed so the real port-31337
// generate-controlled flow (the first onGenerate) is the one that runs.

class Component extends DCLogic {
  state = {
    version: (() => { const v = Number(localStorage.getItem('dex_version')); return v === 2 || v === 3 ? v : 1; })(),
    screens: { 1: 'create', 2: 'create', 3: 'create' },
    // Create
    target: 'sd15',
    prompt: '', negPrompt: '',
    steps: 20, cfg: 7, seed: -1, width: 512, height: 512,
    jobStatus: 'idle', progress: 0, currentImageSrc: null, lastSeed: null, errorMsg: '',
    // Batch
    batchAxisX: 'seed', batchValuesX: '-1,-1,-1,-1',
    batchPrompt: '', batchNeg: '', batchSteps: 20, batchCfg: 7, batchW: 512, batchH: 512,
    batchQueue: [], batchRunning: false, batchDone: 0, batchTotal: 0,
    batchStatus: 'idle',
    // img2img
    i2iPrompt: '', i2iNeg: '', i2iDenoise: 0.75,
    i2iSteps: 20, i2iCfg: 7, i2iSeed: -1, i2iSrcRunId: 'last',
    i2iStatus: 'idle', i2iProgress: 0, i2iResult: null,
    // Enhance
    enhSrcRunId: 'last', enhScale: 2, enhMethod: 'pillow',
    enhStatus: 'idle', enhResult: null,
    // Models
    checkpoints: [], loadingCheckpoints: false, activeCheckpoint: '',
    // Global
    backendUrl: localStorage.getItem('dex_backend_url') || 'http://127.0.0.1:31337',
    backendOnline: false,
    runs: (() => { try { return JSON.parse(localStorage.getItem('dex_runs') || '[]'); } catch { return []; } })(),
    savePrompts: localStorage.getItem('dex_save_prompts') === 'true',
    toasts: [],
  };

  _pingTimer = null; _pollTimer = null; _toastId = 0;

  componentDidMount() {
    this.pingBackend();
    this._pingTimer = setInterval(() => this.pingBackend(), 20000);
    this.loadRuns();
    this.loadModels();
  }
  componentWillUnmount() {
    clearInterval(this._pingTimer); clearInterval(this._pollTimer);
  }

  // ── Toast ─────────────────────────────────────────────────────
  toast(msg, color = '#65d66e') {
    const id = ++this._toastId;
    this.setState(s => ({ toasts: [...s.toasts, { id, msg, color }] }));
    setTimeout(() => this.setState(s => ({ toasts: s.toasts.filter(t => t.id !== id) })), 3200);
  }

  // ── Backend ping ──────────────────────────────────────────────
  async pingBackend() {
    try {
      const r = await fetch(this.state.backendUrl + '/api/version', { signal: AbortSignal.timeout(3000) });
      this.setState({ backendOnline: r.ok });
    } catch { this.setState({ backendOnline: false }); }
  }

  // ── Load runs from real API ───────────────────────────────────
  async loadRuns() {
    try {
      const r = await fetch(this.state.backendUrl + '/api/run-index?limit=50', { signal: AbortSignal.timeout(6000) });
      if (!r.ok) return;
      const data = await r.json();
      const runs = (data.items || []).map(item => ({
        id: item.id,
        model: item.type || item.target || 'sd15',
        size: (item.width && item.height) ? item.width + 'x' + item.height : (item.size || '—'),
        seed: item.seed != null ? item.seed : '—',
        timestamp: item.createdAt || Date.now(),
        imageFile: item.image || item.outputImage || null,
        badge: item.status === 'PASS' ? 'PASS' : item.status === 'FAIL' ? 'FAIL' : '—',
        badgeColor: item.status === 'PASS' ? '#65d66e' : item.status === 'FAIL' ? '#ef4444' : '#fbbf24',
        badgeBg: item.status === 'PASS' ? 'rgba(101,214,110,.1)' : item.status === 'FAIL' ? 'rgba(239,68,68,.1)' : 'rgba(251,191,36,.1)',
        thumb: 'linear-gradient(135deg,#0e2a1a,#1a0e2a)',
      }));
      try { localStorage.setItem('dex_runs', JSON.stringify(runs)); } catch {}
      this.setState({ runs });
    } catch {}
  }

  // ── Job status helpers ────────────────────────────────────────
  // The real backend reports terminal jobs as PASS / PARTIAL / FAIL (not
  // done/error/failed). Treat anything that is not queued/running as finished.
  _jobTerminal(s) { return !!s && s !== 'queued' && s !== 'running' && s !== 'pending'; }
  _jobOk(s) { return s === 'PASS' || s === 'PARTIAL' || s === 'done' || s === 'complete' || s === 'succeeded'; }
  // Build a /api/run-file URL, tolerating an absolute path or a bare filename.
  _imgUrl(runId, file) {
    if (!runId || !file) return null;
    const name = String(file).split('/').pop();
    return this.state.backendUrl + '/api/run-file?path=' + runId + '/' + name;
  }

  // ── Job poller ────────────────────────────────────────────────
  _startPoll(jobId, onComplete) {
    clearInterval(this._pollTimer);
    this._pollTimer = setInterval(async () => {
      try {
        const r = await fetch(this.state.backendUrl + '/api/jobs/' + jobId, { signal: AbortSignal.timeout(3000) });
        if (!r.ok) return;
        const job = await r.json();
        if (job.progress != null) this.setState({ progress: Math.min(99, Math.round(job.progress)) });
        if (this._jobTerminal(job.status)) {
          clearInterval(this._pollTimer);
          onComplete(job);
        }
      } catch {}
    }, 900);
  }

  setVersion(v) { try { localStorage.setItem('dex_version', String(v)); } catch {} this.setState({ version: v }); }
  setScreen(s) { const { version, screens } = this.state; this.setState({ screens: { ...screens, [version]: s } }); }

  // ── Models — load from /api/capabilities ──────────────────────
  async loadModels() {
    this.setState({ loadingCheckpoints: true });
    try {
      const r = await fetch(this.state.backendUrl + '/api/capabilities', { signal: AbortSignal.timeout(8000) });
      if (r.ok) {
        const data = await r.json();
        // Real backend exposes the controlled-generate targets under `modelTargets`
        // (the handoff doc called this `controlledTargets`); accept either.
        const targets = data.modelTargets || data.controlledTargets || [];
        const checkpoints = targets.map(t => ({
          title: t.label || t.id,
          name: t.id,
          hash: t.status || '',
          status: t.status,
        }));
        this.setState({ checkpoints, loadingCheckpoints: false });
        this.toast('Loaded ' + checkpoints.length + ' targets', '#38bdf8');
      } else { this.setState({ loadingCheckpoints: false }); this.toast('Failed to load capabilities (' + r.status + ')', '#ef4444'); }
    } catch(e) { this.setState({ loadingCheckpoints: false }); this.toast('Cannot reach backend', '#ef4444'); }
  }

  loadCheckpoint(name) {
    // Setting the active target — no separate HTTP call needed; target is passed on generate
    this.setState({ activeCheckpoint: name, target: name });
    this.toast('Target set: ' + name, '#38bdf8');
  }

  // ── Generate (txt2img) ────────────────────────────────────────
  async onGenerate() {
    const { jobStatus, prompt, negPrompt, steps, cfg, seed, width, height,
            target, backendUrl, savePrompts } = this.state;
    if (jobStatus === 'generating') {
      clearInterval(this._pollTimer);
      this.setState({ jobStatus: 'idle', progress: 0 });
      return;
    }
    if (!prompt.trim()) { this.toast('Enter a prompt first', '#fbbf24'); return; }
    this.setState({ jobStatus: 'generating', progress: 0, currentImageSrc: null, errorMsg: '' });
    const body = {
      target: target || 'sd15',
      prompt: prompt.trim(),
      negative_prompt: negPrompt || '',
      steps: +steps, cfg_scale: +cfg, seed: +seed,
      width: +width, height: +height,
      sampler: 'euler_a', scheduler: 'discrete',
      save_prompts: savePrompts,
    };
    try {
      const r = await fetch(backendUrl + '/api/actions/generate-controlled', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: r.statusText }));
        this.setState({ jobStatus: 'error', errorMsg: err.error || r.statusText });
        this.toast(err.error || 'Generate failed', '#ef4444'); return;
      }
      const { job_id } = await r.json();
      this._startPoll(job_id, (job) => this._onGenerateDone(job, body, backendUrl));
    } catch(e) {
      this.setState({ jobStatus: 'error', errorMsg: e.message });
      this.toast(e.message, '#ef4444');
    }
  }

  _onGenerateDone(job, params, backendUrl) {
    if (this._jobOk(job.status)) {
      const runId = job.runId;
      const imgFile = job.controlledOutputImage;
      const imgSrc = this._imgUrl(runId, imgFile);
      const run = {
        id: runId || ('local-' + Date.now()),
        model: params.target || 'sd15',
        size: params.width + 'x' + params.height,
        seed: params.seed,
        timestamp: Date.now(),
        imageFile: imgFile ? String(imgFile).split('/').pop() : null,
        badge: job.status === 'PARTIAL' ? 'PARTIAL' : 'PASS',
        badgeColor: '#65d66e', badgeBg: 'rgba(101,214,110,.1)',
        thumb: 'linear-gradient(135deg,#0e2a1a,#1a0e2a)',
      };
      const runs = [run, ...this.state.runs].slice(0, 100);
      try { localStorage.setItem('dex_runs', JSON.stringify(runs)); } catch {}
      this.setState({ jobStatus: 'complete', progress: 100, currentImageSrc: imgSrc, lastSeed: params.seed, runs });
      this.toast('Done · ' + (runId || ''), '#65d66e');
      setTimeout(() => this.loadRuns(), 1500);
    } else {
      const gate = job.firstFailedGate ? ' · gate: ' + job.firstFailedGate : '';
      this.setState({ jobStatus: 'error', progress: 0, errorMsg: 'Job ' + (job.status || 'failed') + gate + ' (exit ' + (job.exitCode ?? '?') + ')' });
      this.toast('Generation failed' + gate, '#ef4444');
    }
  }

  // ── Batch / Sweep ─────────────────────────────────────────────
  async onBatchSubmit() {
    const { batchAxisX, batchValuesX, batchPrompt, batchNeg, batchSteps, batchCfg, batchW, batchH, backendUrl, savePrompts, target } = this.state;
    const vals = batchValuesX.split(',').map(v => v.trim()).filter(Boolean);
    if (!vals.length) { this.toast('Enter axis values first', '#fbbf24'); return; }
    if (!batchPrompt.trim()) { this.toast('Enter a batch prompt', '#fbbf24'); return; }
    this.setState({ batchRunning: true, batchDone: 0, batchTotal: vals.length, batchStatus: 'running' });
    this.toast('Batch started · ' + vals.length + ' jobs', '#38bdf8');
    let done = 0;
    for (const v of vals) {
      const body = {
        target: target || 'sd15',
        prompt: batchPrompt,
        negative_prompt: batchNeg,
        steps: batchAxisX === 'steps' ? +v : +batchSteps,
        cfg_scale: batchAxisX === 'cfg' ? +v : +batchCfg,
        seed: batchAxisX === 'seed' ? +v : -1,
        width: +batchW, height: +batchH,
        sampler: 'euler_a', scheduler: 'discrete',
        save_prompts: savePrompts,
      };
      try {
        const r = await fetch(backendUrl + '/api/actions/generate-controlled', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        if (r.ok) {
          const { job_id } = await r.json();
          await new Promise(resolve => {
            const t = setInterval(async () => {
              try {
                const jr = await fetch(backendUrl + '/api/jobs/' + job_id, { signal: AbortSignal.timeout(3000) });
                if (jr.ok) {
                  const job = await jr.json();
                  if (this._jobTerminal(job.status)) {
                    clearInterval(t); resolve();
                  }
                }
              } catch { clearInterval(t); resolve(); }
            }, 1200);
          });
        }
      } catch {}
      done++;
      this.setState({ batchDone: done });
    }
    this.setState({ batchRunning: false, batchStatus: 'done' });
    this.toast('Batch complete · ' + done + ' images', '#65d66e');
    setTimeout(() => this.loadRuns(), 1500);
  }

  // ── img2img ───────────────────────────────────────────────────
  async onImg2imgSubmit() {
    const { i2iPrompt, i2iNeg, i2iDenoise, i2iSteps, i2iCfg, i2iSeed, i2iSrcRunId, backendUrl, runs, prompt, negPrompt } = this.state;
    const srcRun = i2iSrcRunId ? runs.find(r => r.id === i2iSrcRunId) : runs[0];
    if (!srcRun) { this.toast('No source run — generate an image first', '#fbbf24'); return; }
    if (!srcRun.imageFile) { this.toast('Source run has no image file', '#fbbf24'); return; }
    this.setState({ i2iStatus: 'generating', i2iProgress: 0, i2iResult: null });
    const body = {
      run_id: srcRun.id,
      init_image_file: srcRun.imageFile,
      strength: +i2iDenoise,
      prompt: i2iPrompt || prompt,
      negative_prompt: i2iNeg || negPrompt,
      steps: +i2iSteps, cfg_scale: +i2iCfg, seed: +i2iSeed,
    };
    try {
      const r = await fetch(backendUrl + '/api/actions/img2img', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: r.statusText }));
        this.setState({ i2iStatus: 'error' });
        this.toast(err.error || 'img2img failed', '#ef4444'); return;
      }
      const { job_id } = await r.json();
      const poll = setInterval(async () => {
        try {
          const jr = await fetch(backendUrl + '/api/jobs/' + job_id, { signal: AbortSignal.timeout(3000) });
          if (!jr.ok) return;
          const job = await jr.json();
          if (job.progress != null) this.setState({ i2iProgress: Math.min(99, Math.round(job.progress)) });
          if (this._jobTerminal(job.status)) {
            clearInterval(poll);
            if (this._jobOk(job.status) && job.runId && job.controlledOutputImage) {
              const imgSrc = this._imgUrl(job.runId, job.controlledOutputImage);
              this.setState({ i2iStatus: 'done', i2iProgress: 100, i2iResult: imgSrc });
              this.toast('img2img complete', '#65d66e');
              setTimeout(() => this.loadRuns(), 1500);
            } else { this.setState({ i2iStatus: 'error' }); this.toast('img2img failed', '#ef4444'); }
          }
        } catch {}
      }, 900);
    } catch(e) { this.setState({ i2iStatus: 'error' }); this.toast(e.message, '#ef4444'); }
  }

  // ── Enhance ───────────────────────────────────────────────────
  async onEnhanceSubmit() {
    const { enhSrcRunId, enhScale, enhMethod, backendUrl, runs } = this.state;
    const srcRun = enhSrcRunId ? runs.find(r => r.id === enhSrcRunId) : runs[0];
    if (!srcRun) { this.toast('No source run — generate an image first', '#fbbf24'); return; }
    if (!srcRun.imageFile) { this.toast('Source run has no image file', '#fbbf24'); return; }
    this.setState({ enhStatus: 'running', enhResult: null });
    const endpoint = enhMethod === 'realesrgan' ? '/api/actions/upscale-esrgan' : '/api/actions/upscale';
    const body = { runId: srcRun.id, image: srcRun.imageFile, scale: +enhScale, resample: 'lanczos' };
    try {
      const r = await fetch(backendUrl + endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: r.statusText }));
        this.setState({ enhStatus: 'error' });
        this.toast(err.error || 'Enhance failed', '#ef4444'); return;
      }
      const { job_id } = await r.json();
      const poll = setInterval(async () => {
        try {
          const jr = await fetch(backendUrl + '/api/jobs/' + job_id, { signal: AbortSignal.timeout(3000) });
          if (!jr.ok) return;
          const job = await jr.json();
          if (this._jobTerminal(job.status)) {
            clearInterval(poll);
            if (this._jobOk(job.status)) {
              const imgFile = job.upscaledImage;
              const imgSrc = imgFile ? backendUrl + '/api/run-file?path=' + imgFile : null;
              this.setState({ enhStatus: 'done', enhResult: imgSrc });
              this.toast('Enhanced ' + enhScale + '× (' + enhMethod + ')', '#65d66e');
              setTimeout(() => this.loadRuns(), 1500);
            } else { this.setState({ enhStatus: 'error' }); this.toast('Enhance failed', '#ef4444'); }
          }
        } catch {}
      }, 900);
    } catch(e) { this.setState({ enhStatus: 'error' }); this.toast(e.message, '#ef4444'); }
  }


  // legacy stub kept for any remaining callers
  completeGeneration(imgSrc, seed, params) {
    const run = {
      id: 'local-' + Date.now(), timestamp: Date.now(),
      model: params.target || 'sd15', size: (params.width||512)+'x'+(params.height||512),
      seed, imageFile: null,
      badge: 'PASS', badgeColor: '#65d66e', badgeBg: 'rgba(101,214,110,.1)',
      thumb: 'linear-gradient(135deg,#0e2a1a,#1a0e2a)',
    };
    const runs = [run, ...this.state.runs].slice(0, 100);
    try { localStorage.setItem('dex_runs', JSON.stringify(runs)); } catch {}
    this.setState({ jobStatus: 'complete', progress: 100, currentImageSrc: imgSrc, lastSeed: seed, runs });
  }

  buildImageDisplay(jobStatus, progress, imageSrc, lastSeed, errorMsg) {
    if (jobStatus === 'generating') {
      const steps = Math.round(progress / 100 * (+this.state.steps || 20));
      return React.createElement('div', { style: { textAlign: 'center', padding: '0 24px', maxWidth: 320 } },
        React.createElement('div', { style: { fontSize: 13, color: '#9090c8', marginBottom: 14, fontFamily: "'DM Sans',sans-serif" } },
          progress > 0 ? ('Generating… ' + progress + '%') : 'Queued — waiting for backend…'),
        React.createElement('div', { style: { height: 5, background: 'rgba(255,255,255,.08)', borderRadius: 3, overflow: 'hidden', marginBottom: 8 } },
          React.createElement('div', { style: { height: '100%', width: (progress || 3) + '%', background: 'linear-gradient(90deg,#38bdf8,#65d66e)', borderRadius: 3, transition: 'width .3s ease' } })),
        progress > 0 ? React.createElement('div', { style: { fontSize: 11, color: '#6060a0', fontFamily: "'IBM Plex Mono',monospace" } },
          'step ~' + steps + ' / ' + (this.state.steps || 20)) : null);
    }
    if (jobStatus === 'complete' && imageSrc) {
      return React.createElement('img', { src: imageSrc, alt: 'Generated image', crossOrigin: 'anonymous', style: { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 6 } });
    }
    if (jobStatus === 'complete') {
      return React.createElement('div', { style: { textAlign: 'center' } },
        React.createElement('div', { style: { width: 240, height: 240, background: 'linear-gradient(135deg,#0e2a1a,#1a0e2a)', borderRadius: 12, marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 8 } },
          React.createElement('div', { style: { fontSize: 13, color: '#65d66e', fontFamily: "'IBM Plex Mono',monospace" } }, '✓ Job done'),
          React.createElement('div', { style: { fontSize: 11, color: '#4a6878', fontFamily: "'IBM Plex Mono',monospace" } }, 'seed: ' + (lastSeed ?? '—'))),
        React.createElement('div', { style: { fontSize: 11, color: '#5060a0' } }, 'Image saved to runs/ — check Library'));
    }
    if (jobStatus === 'error') {
      return React.createElement('div', { style: { textAlign: 'center', padding: 20 } },
        React.createElement('div', { style: { fontSize: 14, color: '#ef4444', marginBottom: 8 } }, '✗ Generation failed'),
        React.createElement('div', { style: { fontSize: 11, color: '#7070a0', maxWidth: 260, lineHeight: 1.5 } }, errorMsg || 'Backend offline or job rejected. Check System screen.'));
    }
    return null;
  }

  renderVals() {
    const s = this.state;
    const { version, screens, prompt, negPrompt, steps, cfg, seed, width, height,
            jobStatus, progress, currentImageSrc, lastSeed, errorMsg,
            target, backendOnline, backendUrl, runs, savePrompts, toasts,
            batchAxisX, batchValuesX, batchPrompt, batchNeg, batchSteps, batchCfg, batchW, batchH,
            batchRunning, batchDone, batchTotal, batchStatus,
            i2iPrompt, i2iNeg, i2iDenoise, i2iSteps, i2iCfg, i2iSeed, i2iSrcRunId, i2iStatus, i2iProgress, i2iResult,
            enhSrcRunId, enhScale, enhMethod, enhStatus, enhResult,
            checkpoints, loadingCheckpoints, activeCheckpoint } = s;
    const screen = screens[version];
    const isGenerating = jobStatus === 'generating';

    // ── Library cards ──────────────────────────────────────────
    const libraryCards = runs.length > 0 ? runs : [{ id: 'no runs yet', badge: '—', badgeColor: '#6060a0', badgeBg: 'rgba(80,80,160,.08)', model: 'run generate to start', size: '—', thumb: 'linear-gradient(135deg,#0a0a18,#141428)' }];

    // ── Status chips ──────────────────────────────────────────
    const backendDot = backendOnline ? '#65d66e' : '#ef4444';
    const jobDot = isGenerating ? '#38bdf8' : jobStatus==='complete' ? '#65d66e' : jobStatus==='error' ? '#ef4444' : '#fbbf24';

    // ── Run log ───────────────────────────────────────────────
    const jobLogDisplay = runs.length === 0
      ? React.createElement('div', { style: { fontSize: 12, color: '#5060a0' } }, 'No runs yet.')
      : React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 5 } },
          ...runs.slice(0,12).map(r => React.createElement('div', { key: r.id,
            style: { padding: '6px 10px', background: 'rgba(255,255,255,.02)', border: '1px solid rgba(255,255,255,.07)', borderRadius: 7, fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, color: '#8888a8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
            r.id + ' · ' + r.model + ' · ' + r.size + ' · seed ' + r.seed)));

    // ── Batch progress display ────────────────────────────────
    const batchProgressDisplay = React.createElement('div', { style: { marginTop: 12 } },
      batchStatus === 'idle' ? React.createElement('div', { style: { fontSize: 12, color: '#5060a0' } }, 'Queue empty · configure above and submit') :
      batchStatus === 'running' ? React.createElement('div', null,
        React.createElement('div', { style: { fontSize: 12, color: '#38bdf8', marginBottom: 8, fontFamily: "'DM Sans',sans-serif" } }, 'Running job ' + batchDone + ' of ' + batchTotal + '…'),
        React.createElement('div', { style: { height: 5, background: 'rgba(255,255,255,.08)', borderRadius: 3, overflow: 'hidden', marginBottom: 8 } },
          React.createElement('div', { style: { height: '100%', width: Math.round((batchDone/Math.max(batchTotal,1))*100) + '%', background: 'linear-gradient(90deg,#38bdf8,#65d66e)', borderRadius: 3, transition: 'width .3s ease' } })),
        React.createElement('div', { style: { fontSize: 11, color: '#6060a0', fontFamily: "'IBM Plex Mono',monospace" } }, batchDone + ' / ' + batchTotal + ' complete')) :
      batchStatus === 'done' ? React.createElement('div', { style: { fontSize: 12, color: '#65d66e' } }, '✓ Batch complete · ' + batchTotal + ' images added to Library') :
      null
    );

    // ── img2img status display ────────────────────────────────
    const i2iStatusDisplay = React.createElement('div', { style: { marginTop: 8 } },
      i2iStatus === 'idle' ? null :
      i2iStatus === 'generating' ? React.createElement('div', null,
        React.createElement('div', { style: { fontSize: 12, color: '#a78bfa', marginBottom: 6 } }, 'img2img · ' + i2iProgress + '%'),
        React.createElement('div', { style: { height: 4, background: 'rgba(255,255,255,.08)', borderRadius: 2, overflow: 'hidden' } },
          React.createElement('div', { style: { height: '100%', width: i2iProgress + '%', background: 'linear-gradient(90deg,#8b5cf6,#38bdf8)', borderRadius: 2, transition: 'width .15s linear' } }))) :
      i2iStatus === 'done' && i2iResult ? React.createElement('img', { src: i2iResult, alt: 'img2img result', style: { maxWidth: '100%', maxHeight: 200, borderRadius: 6, objectFit: 'contain' } }) :
      i2iStatus === 'done' ? React.createElement('div', { style: { fontSize: 12, color: '#65d66e' } }, '✓ Done (sim · no image data)') :
      i2iStatus === 'error' ? React.createElement('div', { style: { fontSize: 12, color: '#ef4444' } }, '✗ img2img failed') :
      null
    );

    // ── Enhance status display ────────────────────────────────
    const enhStatusDisplay = React.createElement('div', { style: { marginTop: 8 } },
      enhStatus === 'running' ? React.createElement('div', { style: { fontSize: 12, color: '#38bdf8' } }, 'Upscaling…') :
      enhStatus === 'done' && enhResult ? React.createElement('img', { src: enhResult, alt: 'enhanced', style: { maxWidth: '100%', maxHeight: 200, borderRadius: 6, objectFit: 'contain' } }) :
      enhStatus === 'done' ? React.createElement('div', { style: { fontSize: 12, color: '#65d66e' } }, '✓ Enhance done') :
      enhStatus === 'error' ? React.createElement('div', { style: { fontSize: 12, color: '#ef4444' } }, '✗ Enhance failed') :
      null
    );

    // ── Models list display ───────────────────────────────────
    const modelsListDisplay = loadingCheckpoints
      ? React.createElement('div', { style: { fontSize: 12, color: '#38bdf8', fontFamily: "'IBM Plex Mono',monospace" } }, 'Loading…')
      : checkpoints.length === 0
        ? React.createElement('div', { style: { fontSize: 12, color: '#5060a0' } }, 'No checkpoints loaded — click Refresh above')
        : React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 5 } },
            ...checkpoints.map(cp => React.createElement('div', { key: cp.name,
              onClick: () => this.loadCheckpoint(cp.name),
              style: { padding: '8px 12px', border: '1px solid ' + (activeCheckpoint === cp.name ? 'rgba(101,214,110,.35)' : 'rgba(255,255,255,.08)'), background: activeCheckpoint === cp.name ? 'rgba(101,214,110,.07)' : 'rgba(255,255,255,.02)', borderRadius: 8, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
              React.createElement('span', { style: { fontSize: 12, color: activeCheckpoint === cp.name ? '#65d66e' : '#c0c0d8', fontFamily: "'IBM Plex Mono',monospace", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, marginRight: 8 } }, cp.title || cp.name),
              cp.hash ? React.createElement('span', { style: { fontSize: 10, color: '#5060a0', fontFamily: "'IBM Plex Mono',monospace", flexShrink: 0 } }, cp.hash.slice(0,8)) : null
            ))
          );

    // ── Source run options for i2i / enhance ──────────────────
    const srcRunOptions = React.createElement('select', {
      value: i2iSrcRunId, onChange: e => this.setState({ i2iSrcRunId: e.target.value }),
      style: { width: '100%', border: '1px solid rgba(255,255,255,.12)', background: 'rgba(0,0,0,.3)', color: '#e0e0f0', borderRadius: 7, padding: '7px', outline: 'none', fontSize: 12, fontFamily: "'DM Sans',sans-serif" }
    }, React.createElement('option', { value: 'last' }, runs[0] ? 'Last: ' + runs[0].id : '— no runs —'),
    ...runs.slice(0,20).map(r => React.createElement('option', { key: r.id, value: r.id }, r.id + ' · ' + r.size)));

    const enhSrcOptions = React.createElement('select', {
      value: enhSrcRunId, onChange: e => this.setState({ enhSrcRunId: e.target.value }),
      style: { width: '100%', border: '1px solid rgba(255,255,255,.12)', background: 'rgba(0,0,0,.3)', color: '#e0e0f0', borderRadius: 7, padding: '7px', outline: 'none', fontSize: 12, fontFamily: "'DM Sans',sans-serif" }
    }, React.createElement('option', { value: 'last' }, runs[0] ? 'Last: ' + runs[0].id : '— no runs —'),
    ...runs.slice(0,20).map(r => React.createElement('option', { key: r.id, value: r.id }, r.id + ' · ' + r.size)));

    // ── Toast overlay ─────────────────────────────────────────
    const toastOverlay = React.createElement('div', {
      style: { position: 'fixed', bottom: 20, right: 20, display: 'flex', flexDirection: 'column', gap: 8, zIndex: 9999, pointerEvents: 'none' }
    }, ...toasts.map(t => React.createElement('div', { key: t.id,
      style: { background: 'rgba(14,14,20,.96)', border: '1px solid ' + t.color, borderLeft: '3px solid ' + t.color, borderRadius: 8, padding: '9px 14px', fontSize: 13, color: t.color, fontFamily: "'DM Sans',sans-serif", fontWeight: 600, backdropFilter: 'blur(8px)', maxWidth: 360, lineHeight: 1.4 } },
      t.msg
    )));

    return {
      version, versionStr: String(version), screen,
      isV1: version===1, isV2: version===2, isV3: version===3,
      isV1Str: String(version===1), isV2Str: String(version===2), isV3Str: String(version===3),
      setV1: ()=>this.setVersion(1), setV2: ()=>this.setVersion(2), setV3: ()=>this.setVersion(3),
      isCreate: screen==='create', isBatch: screen==='batch', isEdit: screen==='edit',
      isEnhance: screen==='enhance', isLibrary: screen==='library', isModels: screen==='models', isSystem: screen==='system',
      isCreateStr: String(screen==='create'), isBatchStr: String(screen==='batch'),
      isEditStr: String(screen==='edit'), isEnhanceStr: String(screen==='enhance'),
      isLibraryStr: String(screen==='library'), isModelsStr: String(screen==='models'), isSystemStr: String(screen==='system'),
      navCreate: ()=>this.setScreen('create'), navBatch: ()=>this.setScreen('batch'),
      navEdit: ()=>this.setScreen('edit'), navEnhance: ()=>this.setScreen('enhance'),
      navLibrary: ()=>this.setScreen('library'), navModels: ()=>this.setScreen('models'), navSystem: ()=>this.setScreen('system'),
      // Create form
      prompt, negPrompt, steps: String(steps), cfg: String(cfg), seed: String(seed),
      width: String(width), height: String(height), promptLen: String(prompt.length),
      onPromptChange: e=>this.setState({prompt:e.target.value}),
      onNegChange: e=>this.setState({negPrompt:e.target.value}),
      onStepsChange: e=>this.setState({steps:e.target.value}),
      onCfgChange: e=>this.setState({cfg:e.target.value}),
      onSeedChange: e=>this.setState({seed:e.target.value}),
      onWidthChange: e=>this.setState({width:e.target.value}),
      onHeightChange: e=>this.setState({height:e.target.value}),
      setDim512: ()=>this.setState({width:512,height:512}),
      setDim768: ()=>this.setState({width:768,height:512}),
      setDim1024: ()=>this.setState({width:1024,height:1024}),
      onGenerate: ()=>this.onGenerate(),
      generateLabel: isGenerating ? ('Generating… ' + progress + '%') : 'Generate Image',
      genCursor: isGenerating ? 'default' : 'pointer',
      genOpacity: isGenerating ? '0.75' : '1',
      genBg1: isGenerating ? 'linear-gradient(90deg,#1a5068,#2a6034)' : 'linear-gradient(90deg,#38bdf8,#65d66e)',
      genBg2: isGenerating ? 'linear-gradient(90deg,#7a5008,#8a3810)' : 'linear-gradient(90deg,#f59e0b,#fb923c)',
      genBg3: isGenerating ? 'linear-gradient(135deg,#4a2a8a,#0a6a8a)' : 'linear-gradient(135deg,#8b5cf6,#22d3ee)',
      showJobResult: jobStatus !== 'idle',
      jobIdle: jobStatus === 'idle',
      imageDisplay: this.buildImageDisplay(jobStatus, progress, currentImageSrc, lastSeed, errorMsg),
      actionStatus: isGenerating ? ('generating · ' + progress + '%') : jobStatus==='complete' ? ('done · seed ' + lastSeed) : jobStatus==='error' ? 'error · check backend' : 'idle · no job',
      // Status chips
      backendDot, backendLabel: backendOnline ? 'Backend' : 'Offline',
      backendChipBg: backendOnline ? 'rgba(101,214,110,.08)' : 'rgba(239,68,68,.08)',
      backendChipBorder: backendOnline ? 'rgba(101,214,110,.2)' : 'rgba(239,68,68,.2)',
      jobDot, jobLabel: isGenerating ? (progress + '%') : jobStatus==='complete' ? 'Done' : jobStatus==='error' ? 'Error' : 'Idle',
      jobChipBg: isGenerating ? 'rgba(56,189,248,.07)' : jobStatus==='complete' ? 'rgba(101,214,110,.07)' : jobStatus==='error' ? 'rgba(239,68,68,.07)' : 'rgba(251,191,36,.07)',
      jobChipBorder: isGenerating ? 'rgba(56,189,248,.2)' : jobStatus==='complete' ? 'rgba(101,214,110,.2)' : jobStatus==='error' ? 'rgba(239,68,68,.2)' : 'rgba(251,191,36,.2)',
      // System
      backendUrl, backendStatusColor: backendOnline ? '#65d66e' : '#ef4444',
      backendStatusText: backendOnline ? '✓ Online' : '✗ Offline',
      onBackendUrlChange: e=>{ const u=e.target.value; this.setState({backendUrl:u}); localStorage.setItem('dex_backend_url',u); },
      onVerifyBackend: ()=>{ this.pingBackend(); this.toast('Pinging backend…', '#38bdf8'); },
      onStartServer: ()=>{ fetch(this.state.backendUrl+'/api/actions/server-start',{method:'POST'}).then(r=>r.json()).then(d=>{ const {job_id}=d; if(job_id) this._startPoll(job_id,()=>{ this.toast('Server started','#65d66e'); this.pingBackend(); }); }).catch(()=>this.toast('Start failed','#ef4444')); },
      onStopServer: ()=>{ fetch(this.state.backendUrl+'/api/actions/server-stop',{method:'POST'}).then(r=>r.json()).then(d=>{ const {job_id}=d; if(job_id) this._startPoll(job_id,()=>{ this.toast('Server stopped','#fbbf24'); this.pingBackend(); }); }).catch(()=>this.toast('Stop failed','#ef4444')); },
      onServerStatus: ()=>{ this.pingBackend(); this.loadRuns(); },
      target, onTargetChange: e=>this.setState({target:e.target.value}),
      onCopyParams: ()=>{ try{ navigator.clipboard.writeText(JSON.stringify({target,prompt,negPrompt,steps,cfg,seed,width,height},null,2)); this.toast('Params copied to clipboard', '#38bdf8'); }catch{} },
      onReuseLastSeed: ()=>{ if(lastSeed!=null){this.setState({seed:String(lastSeed)}); this.toast('Seed '+lastSeed+' reloaded', '#38bdf8');} },
      goToImg2img: ()=>this.setScreen('edit'),
      savePrompts, onSavePrompts: e=>{ const v=e.target.checked; this.setState({savePrompts:v}); localStorage.setItem('dex_save_prompts',String(v)); },
      onRefreshRuns: ()=>this.loadRuns(),
      libraryCards, runsCount: String(runs.length), jobLogDisplay,
      // Batch
      batchAxisX, batchValuesX, batchPrompt, batchNeg,
      batchSteps: String(batchSteps), batchCfg: String(batchCfg),
      batchW: String(batchW), batchH: String(batchH),
      batchRunning, batchDone: String(batchDone), batchTotal: String(batchTotal), batchStatus,
      onBatchAxisChange: e=>this.setState({batchAxisX:e.target.value}),
      onBatchValuesChange: e=>this.setState({batchValuesX:e.target.value}),
      onBatchPromptChange: e=>this.setState({batchPrompt:e.target.value}),
      onBatchNegChange: e=>this.setState({batchNeg:e.target.value}),
      onBatchStepsChange: e=>this.setState({batchSteps:e.target.value}),
      onBatchCfgChange: e=>this.setState({batchCfg:e.target.value}),
      onBatchWChange: e=>this.setState({batchW:e.target.value}),
      onBatchHChange: e=>this.setState({batchH:e.target.value}),
      onBatchSubmit: ()=>this.onBatchSubmit(),
      batchSubmitLabel: batchRunning ? ('Running ' + batchDone + '/' + batchTotal + '…') : batchStatus==='done' ? 'Run Again' : 'Submit Batch',
      batchProgressDisplay,
      // img2img
      i2iPrompt, i2iNeg, i2iDenoise: String(i2iDenoise), i2iSteps: String(i2iSteps),
      i2iCfg: String(i2iCfg), i2iSeed: String(i2iSeed), i2iSrcRunId, i2iStatus, i2iProgress: String(i2iProgress),
      onI2iPromptChange: e=>this.setState({i2iPrompt:e.target.value}),
      onI2iNegChange: e=>this.setState({i2iNeg:e.target.value}),
      onI2iDenoiseChange: e=>this.setState({i2iDenoise:e.target.value}),
      onI2iStepsChange: e=>this.setState({i2iSteps:e.target.value}),
      onI2iCfgChange: e=>this.setState({i2iCfg:e.target.value}),
      onI2iSeedChange: e=>this.setState({i2iSeed:e.target.value}),
      onImg2imgSubmit: ()=>this.onImg2imgSubmit(),
      i2iSubmitLabel: i2iStatus==='generating' ? ('img2img · ' + i2iProgress + '%') : 'Run img2img',
      i2iStatusDisplay, srcRunOptions,
      // Enhance
      enhSrcRunId, enhScale: String(enhScale), enhMethod, enhStatus,
      onEnhScaleChange: e=>this.setState({enhScale:e.target.value}),
      onEnhMethodChange: e=>this.setState({enhMethod:e.target.value}),
      onEnhSrcChange: e=>this.setState({enhSrcRunId:e.target.value}),
      onEnhanceSubmit: ()=>this.onEnhanceSubmit(),
      enhSubmitLabel: enhStatus==='running' ? 'Enhancing…' : 'Enhance Image',
      enhStatusDisplay, enhSrcOptions,
      // Models
      checkpoints, loadingCheckpoints, activeCheckpoint, modelsListDisplay,
      onLoadModels: ()=>this.loadModels(),
      loadModelsLabel: loadingCheckpoints ? 'Loading…' : 'Refresh Models',
      // Toasts
      toastOverlay,
    };
  }
}

// Expose for the bootstrap in index.html
window.DexDiffusionComponent = Component;
