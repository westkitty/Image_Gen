// DexDiffusion ControlNet panel for Create (OpenPose on SD 1.5 / SDXL checkpoints).
//
// Flow: get a pose (detect it in a photo with Apple Vision on the Mac, start from a standing figure, or upload a ready
// OpenPose map) -> adjust it in the Puppet Master editor -> the rendered OpenPose stick figure (black background, the
// standard annotator colours) is sent with the Create request as `controlnet: { model, image, strength }`.
// The server and engine own every path; the browser only names a ControlNet id. FLUX models have no ControlNet here.
(function () {
  'use strict';
  const C = window.DexDiffusionComponent;
  if (!C) return;
  const P = C.prototype;
  const h = (...a) => React.createElement(...a);
  const UI = window.DexUI || {};
  const css = UI.css || {};
  const btn = UI.btn, chip = UI.chip;
  const numText = UI.numText || (p => p);
  const PP = window.DexPuppetPose;
  const DEFAULT_STRENGTH = 0.9;

  const readFile = file => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('Could not read the file'));
    r.readAsDataURL(file);
  });
  const loadImage = url => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not open the image'));
    img.src = url;
  });
  const pickFile = accept => new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = accept;
    input.onchange = () => resolve(input.files && input.files[0] || null);
    input.click();
  });
  // Fit a w x h picture inside W x H, centred (letterbox), so the pose keeps its proportions at the generation size.
  const fitBox = (w, h, W, H) => { const s = Math.min(W / w, H / h); return { s, dx: (W - w * s) / 2, dy: (H - h * s) / 2 }; };
  // Re-encode any picture as PNG at the generation size (letterboxed on black, as a pose map expects).
  async function toPngAt(url, W, H, alpha) {
    const img = await loadImage(url);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    if (!alpha) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); }
    const f = fitBox(img.naturalWidth, img.naturalHeight, W, H);
    ctx.drawImage(img, f.dx, f.dy, img.naturalWidth * f.s, img.naturalHeight * f.s);
    return c.toDataURL('image/png');
  }
  function fitPose(pose, W, H) {
    const f = fitBox(pose.width, pose.height, W, H);
    return { plan: pose.plan, width: W, height: H, people: pose.people.map(p => ({ keypoints: p.keypoints.map(k => (k ? [Math.round((k[0] * f.s + f.dx) * 100) / 100, Math.round((k[1] * f.s + f.dy) * 100) / 100, k[2]] : null)) })) };
  }
  function renderPose(pose) {
    const c = document.createElement('canvas'); c.width = pose.width; c.height = pose.height;
    PP.renderToCanvas(c.getContext('2d'), pose);
    return c.toDataURL('image/png');
  }

  P._cn = function () {
    const ws = this._ws();
    if (!ws.controlnet) ws.controlnet = { on: false, strength: DEFAULT_STRENGTH, image: null, pose: null, background: null, source: '', busy: false, note: '' };
    return ws.controlnet;
  };
  P._cnSet = function (patch) { this.wsSet({ controlnet: Object.assign({}, this._cn(), patch) }); };
  // ControlNet ids usable with the selected checkpoint (server-computed in /api/capabilities).
  P._cnModelsFor = function (target) {
    const list = ((this.state.capabilityData || {}).controlnets) || [];
    return list.filter(c => (c.targets || []).includes(target || this.state.target));
  };
  // Added to the Create request by _createBody.
  P._cnBody = function () {
    const cn = this._cn(), models = this._cnModelsFor();
    if (!cn.on || !models.length || this._ws().hires) return null;
    // No pose yet: send the field without an image so the server answers with a clear "add a pose" message.
    if (!cn.image) return { model: models[0].id };
    return { model: models[0].id, image: cn.image, strength: Math.max(0, Math.min(2, Number(cn.strength) || DEFAULT_STRENGTH)) };
  };

  // ── pose sources ──
  P.cnPoseFromPhoto = async function () {
    const file = await pickFile('image/png,image/jpeg');
    if (!file) return;
    const W = +this.state.width || 1024, H = +this.state.height || 1024;
    this._cnSet({ busy: true, note: 'Finding the pose with Apple Vision…' });
    try {
      let url = await readFile(file);
      if (!/^data:image\/(png|jpeg);/.test(url)) url = await toPngAt(url, W, H, true);
      const res = await this._api('/api/controlnet/detect-pose', { image: url });
      if (!res.ok) throw new Error((res.data && res.data.error) || 'Pose detection failed');
      const pose = fitPose(PP.importOpenPoseJson(res.data.pose), W, H);
      const background = await toPngAt(url, W, H);
      const n = pose.people.length;
      this._cnSet({ busy: false, on: true, pose, background, source: 'photo', note: `Found ${n} ${n === 1 ? 'person' : 'people'}. Check the joints, then use the pose.` });
      this.cnOpenEditor();
    } catch (e) {
      this._cnSet({ busy: false, note: e.message });
    }
  };
  P.cnPoseFromScratch = function () {
    const W = +this.state.width || 1024, H = +this.state.height || 1024;
    this._cnSet({ on: true, pose: PP.createPose('openpose18', { width: W, height: H }), background: null, source: 'drawn', note: 'Drag the joints into the pose you want.' });
    this.cnOpenEditor();
  };
  P.cnUploadPoseMap = async function () {
    const file = await pickFile('image/png,image/jpeg');
    if (!file) return;
    const W = +this.state.width || 1024, H = +this.state.height || 1024;
    try {
      const image = await toPngAt(await readFile(file), W, H);
      this._cnSet({ on: true, image, pose: null, background: null, source: 'map', note: 'Using your pose map as it is. It should be an OpenPose stick figure on black.' });
    } catch (e) { this._cnSet({ note: e.message }); }
  };

  // ── pose editor (plain DOM overlay, so a re-render never rebuilds the canvas under a drag) ──
  P.cnOpenEditor = function () {
    const cn = this._cn();
    if (!window.DexPuppetMaster || !cn.pose) return;
    const W = +this.state.width || cn.pose.width, H = +this.state.height || cn.pose.height;
    const pose = cn.pose.width === W && cn.pose.height === H ? cn.pose : fitPose(cn.pose, W, H);
    const overlay = document.createElement('div');
    overlay.setAttribute('data-cn-editor', '');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', 'ControlNet pose editor');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(2,6,12,.86);display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:24px';
    const box = document.createElement('div');
    box.style.cssText = 'background:#0b1220;border:1px solid #334155;border-radius:10px;padding:14px;max-width:min(1100px,100%);width:100%;color:#e2e8f0;font:13px "DM Sans",sans-serif';
    const head = document.createElement('div');
    head.style.cssText = 'display:flex;gap:8px;align-items:center;justify-content:space-between;margin-bottom:8px';
    head.innerHTML = '<strong>Pose for ControlNet</strong>';
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:6px';
    const mk = (label, color, fn, attr) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.setAttribute('data-cn-action', attr); b.style.cssText = `border:1px solid ${color}66;background:${color}16;color:${color};border-radius:7px;padding:7px 12px;font-weight:700;cursor:pointer`; b.onclick = fn; return b; };
    const host = document.createElement('div');
    let pm = null;
    const close = () => { try { pm && pm.destroy(); } catch (_) {} overlay.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = e => { if (e.key === 'Escape') close(); };
    actions.append(
      mk('Use this pose', '#65d66e', () => {
        try {
          const p = pm.getPose();
          if (!PP.PLANS[p.plan].openposeCompatible) throw new Error('Only the Humanoid (OpenPose 18) body plan works with the OpenPose ControlNet.');
          this._cnSet({ pose: p, image: renderPose(p), on: true, note: 'Pose ready. It will guide the next generation.' });
          close();
        } catch (e) { window.alert(e.message); }
      }, 'use'),
      mk('Cancel', '#94a3b8', close, 'cancel'));
    head.append(actions);
    box.append(head, host);
    overlay.append(box);
    document.body.append(overlay);
    document.addEventListener('keydown', onKey);
    pm = window.DexPuppetMaster.mount(host, { width: W, height: H, plan: 'openpose18', backgroundUrl: cn.background || undefined, download: false });
    pm.setPose(pose);
  };

  // ── Create panel ──
  P.buildControlNetPanel = function (spec) {
    const cn = this._cn(), models = this._cnModelsFor(spec && spec.id);
    const caps = this.state.capabilityData || {};
    const installed = Array.isArray(caps.controlnets) && caps.controlnets.length > 0;
    const hiresOn = !!this._ws().hires;
    const row = css.row || { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' };
    const muted = css.muted || { fontSize: 11, color: '#8193a8' };
    return h('div', { 'data-controlnet-panel': 'true', style: { borderTop: '1px solid rgba(148,163,184,.12)', marginTop: 8, paddingTop: 8, display: 'grid', gap: 6 } },
      h('label', { style: Object.assign({}, row, { color: '#dbe4ee', fontSize: 12 }) },
        h('input', { type: 'checkbox', 'data-cn-field': 'on', checked: !!cn.on && models.length > 0, disabled: !models.length || hiresOn, onChange: e => this._cnSet({ on: e.target.checked }) }),
        'ControlNet · OpenPose (copy a pose from a photo or a stick figure)',
        models.length ? chip(models[0].label, '#a78bfa') : null),
      !installed ? h('div', { style: muted }, 'ControlNet runs on the Big Mac engine; it is not available right now.')
        : !models.length ? h('div', { style: muted, 'data-cn-field': 'incompatible' }, 'ControlNet works with SD 1.5 and SDXL checkpoints (including Pony). Pick one of those to use it; FLUX has no ControlNet here.')
        : hiresOn ? h('div', { style: muted }, 'Turn off High-Res Refine to use ControlNet (upscale afterwards instead).')
        : null,
      cn.on && models.length && !hiresOn ? h('div', { style: { display: 'grid', gap: 6 } },
        h('div', { style: row },
          btn(cn.busy ? 'Finding pose…' : 'Pose from a photo', () => this.cnPoseFromPhoto(), '#38bdf8', { disabled: cn.busy, 'data-cn-action': 'photo' }),
          btn('Draw a pose', () => this.cnPoseFromScratch(), '#38bdf8', { 'data-cn-action': 'draw' }),
          btn('Upload a pose map', () => this.cnUploadPoseMap(), '#94a3b8', { 'data-cn-action': 'upload' }),
          cn.pose ? btn('Edit pose', () => this.cnOpenEditor(), '#a78bfa', { 'data-cn-action': 'edit' }) : null,
          cn.image ? btn('Clear', () => this._cnSet({ image: null, pose: null, background: null, note: '' }), '#f87171', { 'data-cn-action': 'clear' }) : null),
        h('div', { style: Object.assign({}, row, { alignItems: 'flex-start' }) },
          cn.image ? h('img', { src: cn.image, alt: 'ControlNet pose map', 'data-cn-field': 'preview', style: { width: 128, height: 128, objectFit: 'contain', background: '#000', border: '1px solid #334155', borderRadius: 6 } })
            : h('div', { style: Object.assign({}, muted, { width: 128, height: 128, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', border: '1px dashed #334155', borderRadius: 6 }) }, 'No pose yet'),
          h('div', { style: { display: 'grid', gap: 4 } },
            h('label', { style: muted }, 'Control strength (0–2, default 0.9)'),
            h('input', numText({ value: String(cn.strength), 'data-cn-field': 'strength', 'aria-label': 'ControlNet strength', style: Object.assign({}, css.input, { width: 90 }), onChange: e => this._cnSet({ strength: e.target.value }) })),
            h('div', { style: muted }, 'Higher follows the pose more strictly. The pose map is stretched to fit the image size you generate.'))),
        cn.note ? h('div', { style: Object.assign({}, muted, { color: '#cbd5e1' }), role: 'status', 'data-cn-field': 'note' }, cn.note) : null,
        !cn.image ? h('div', { style: Object.assign({}, muted, { color: '#fde68a' }) }, 'Add a pose before generating, or turn ControlNet off.') : null) : null);
  };
})();
