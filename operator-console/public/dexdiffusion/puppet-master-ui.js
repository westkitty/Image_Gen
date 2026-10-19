// Puppet Master pose editor UI (CN-10 / CN-11 / CN-14). Framework-light: plain DOM with a mount(el, opts) API, so it runs
// standalone (no dc-runtime component state to rebuild the canvas under a drag) and can be hosted by any panel.
//
//   const pm = DexPuppetMaster.mount(el, { width: 512, height: 512, plan: 'openpose18',
//       backgroundUrl: 'blob:...' /* optional, data:image/* or blob: only */, onChange(pose) {}, onExport({ png, json, plan, openpose }) {} });
//   pm.getPose() / pm.setPose(pose) / pm.setBackground(url|null) / pm.destroy()
//
// Secure by construction: no remote URLs, no iframes, no dynamic code evaluation, no external scripts. Authoring only —
// no ControlNet model is installed, so poses cannot condition generation.
(function () {
  'use strict';
  const PP = window.DexPuppetPose;
  if (!PP) { console.error('puppet-master-ui: puppet-pose.js must load first'); return; }
  const NOTICE = 'Pose authoring only — no ControlNet model is installed, so poses cannot yet condition generation.';
  const HIT_PX = 14, HISTORY_MAX = 100, KEY_COALESCE_MS = 600;
  const SAFE_BG = /^(data:image\/(png|jpeg|webp|gif);|blob:)/i;

  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'style') n.style.cssText = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    return n;
  }

  function mount(host, opts = {}) {
    if (!(host instanceof Element)) throw new Error('mount(el): el must be an element');
    const state = {
      pose: PP.createPose(opts.plan || 'openpose18', { width: opts.width || 512, height: opts.height || 512 }),
      past: [], future: [], sel: { person: 0, joint: 0 }, drag: null, bg: null, connected: true, lastKey: { t: 0, joint: '' }, destroyed: false,
    };
    const cb = name => (typeof opts[name] === 'function' ? opts[name] : null);

    // ── DOM ──
    const notice = el('p', { 'data-puppet-notice': '', role: 'note', style: 'margin:0 0 8px;padding:6px 8px;border:1px solid #fbbf2455;background:#fbbf2412;color:#fbbf24;border-radius:6px;font-size:12px' }, NOTICE);
    const planSel = el('select', { 'data-puppet-field': 'plan', 'aria-label': 'Body plan' }, PP.planIds().map(id => el('option', { value: id }, PP.PLANS[id].label)));
    const tplSel = el('select', { 'data-puppet-field': 'template', 'aria-label': 'Template for selected person' });
    const personSel = el('select', { 'data-puppet-field': 'person', 'aria-label': 'Selected person' });
    const btn = (label, action, onclick, title) => el('button', { type: 'button', 'data-puppet-action': action, title: title || label, onclick }, label);
    const planNote = el('span', { 'data-puppet-plan-note': '', style: 'font-size:11px;opacity:.8' });
    const canvas = el('canvas', { 'data-puppet-canvas': '', tabindex: '0', role: 'application',
      'aria-label': 'Pose editor canvas. Tab or Shift+Tab selects the next or previous joint, arrow keys move it 1 pixel, Shift+arrow 10 pixels, V hides or shows it.',
      style: 'display:block;max-width:100%;height:auto;background:#000;border:1px solid #334155;border-radius:6px;touch-action:none;cursor:crosshair' });
    const status = el('div', { 'data-puppet-status': '', role: 'status', 'aria-live': 'polite', style: 'font-size:12px;min-height:16px;margin-top:6px' });
    const errBox = el('div', { 'data-puppet-error': '', role: 'alert', style: 'font-size:12px;color:#f87171;min-height:0' });
    const undoBtn = btn('Undo', 'undo', () => undo()), redoBtn = btn('Redo', 'redo', () => redo());
    const root = el('div', { 'data-puppet-master': '', style: 'display:grid;gap:8px;max-width:100%' },
      notice,
      el('div', { style: 'display:flex;flex-wrap:wrap;gap:6px;align-items:center' }, planSel, tplSel, personSel,
        btn('Mirror person', 'mirror-person', () => commit(PP.mirror(state.pose, state.sel.person))),
        btn('Mirror all', 'mirror-all', () => commit(PP.mirror(state.pose))),
        btn('Smaller', 'scale-down', () => commit(PP.scalePerson(state.pose, state.sel.person, 0.9))),
        btn('Larger', 'scale-up', () => commit(PP.scalePerson(state.pose, state.sel.person, 1.1))),
        btn('Add person', 'add-person', () => { const r = guard(() => PP.addPerson(state.pose, tplSel.value)); if (r) { state.sel = { person: r.people.length - 1, joint: 0 }; commit(r); } }),
        btn('Remove person', 'remove-person', () => { if (state.pose.people.length <= 1) return say('At least one person is required'); const r = PP.removePerson(state.pose, state.sel.person); state.sel = { person: Math.max(0, state.sel.person - 1), joint: 0 }; commit(r); }),
        el('label', { style: 'display:inline-flex;gap:4px;align-items:center;font-size:12px', title: 'When on, moving a joint also moves everything attached beyond it (drag a wrist and the hand follows).' }, el('input', { type: 'checkbox', 'data-puppet-field': 'connected', checked: true, onchange: e => { state.connected = e.target.checked; } }), 'Move connected limb'),
        btn('Hide/show joint', 'toggle-joint', () => toggleJoint()), undoBtn, redoBtn),
      planNote, canvas, status, errBox,
      el('div', { style: 'display:flex;flex-wrap:wrap;gap:6px' },
        btn('Export PNG', 'export-png', () => doExport('png')), btn('Export JSON', 'export-json', () => doExport('json'))));
    host.appendChild(root);

    // ── helpers ──
    const say = t => { status.textContent = t; };
    const guard = fn => { try { errBox.textContent = ''; return fn(); } catch (e) { errBox.textContent = e.message; return null; } };
    const people = () => state.pose.people;
    const names = () => PP.PLANS[state.pose.plan].names;
    function describeSel() {
      const k = people()[state.sel.person] && people()[state.sel.person].keypoints[state.sel.joint];
      return `Person ${state.sel.person + 1}, ${names()[state.sel.joint]}: ` + (k ? `${Math.round(k[0])}, ${Math.round(k[1])}` : 'hidden');
    }
    function syncControls() {
      planSel.value = state.pose.plan;
      tplSel.replaceChildren(...PP.templateNames(state.pose.plan).map(t => el('option', { value: t }, t)));
      personSel.replaceChildren(...people().map((_, i) => el('option', { value: String(i) }, 'Person ' + (i + 1))));
      personSel.value = String(state.sel.person);
      undoBtn.disabled = !state.past.length; redoBtn.disabled = !state.future.length;
      planNote.textContent = PP.PLANS[state.pose.plan].note + (PP.PLANS[state.pose.plan].openposeCompatible ? '' : ' JSON export uses the DexDiffusion pose format, not OpenPose.');
      canvas.setAttribute('data-plan', state.pose.plan); canvas.setAttribute('data-people', String(people().length));
    }
    function draw() {
      if (state.destroyed) return;
      const { width: w, height: h } = state.pose;
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
      if (state.bg) { ctx.save(); ctx.globalAlpha = 0.5; ctx.drawImage(state.bg, 0, 0, w, h); ctx.restore(); }
      PP.renderToCanvas(ctx, state.pose, { clear: false });
      const k = people()[state.sel.person] && people()[state.sel.person].keypoints[state.sel.joint];
      if (k) { ctx.save(); ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(2, w / 256); ctx.beginPath(); ctx.arc(k[0], k[1], 9 * Math.max(1, w / 512), 0, Math.PI * 2); ctx.stroke(); ctx.restore(); }
    }
    function refresh() { syncControls(); draw(); canvas.setAttribute('data-sel', state.sel.person + ':' + state.sel.joint); }
    function commit(next, { coalesceKey } = {}) {
      if (!next) return;
      const errs = PP.validatePose(next); if (errs.length) { errBox.textContent = errs[0]; return; }
      const now = Date.now();
      if (!(coalesceKey && state.lastKey.joint === coalesceKey && now - state.lastKey.t < KEY_COALESCE_MS && state.past.length)) { state.past.push(state.pose); if (state.past.length > HISTORY_MAX) state.past.shift(); }
      state.lastKey = { t: now, joint: coalesceKey || '' };
      state.future = []; state.pose = next; errBox.textContent = '';
      refresh(); say(describeSel()); if (cb('onChange')) cb('onChange')(PP.clone(state.pose));
    }
    function undo() { if (!state.past.length) return; state.future.push(state.pose); state.pose = state.past.pop(); fixSel(); state.lastKey = { t: 0, joint: '' }; refresh(); say('Undid. ' + describeSel()); if (cb('onChange')) cb('onChange')(PP.clone(state.pose)); }
    function redo() { if (!state.future.length) return; state.past.push(state.pose); state.pose = state.future.pop(); fixSel(); state.lastKey = { t: 0, joint: '' }; refresh(); say('Redid. ' + describeSel()); if (cb('onChange')) cb('onChange')(PP.clone(state.pose)); }
    function fixSel() { state.sel.person = Math.min(state.sel.person, Math.max(0, people().length - 1)); state.sel.joint = Math.min(state.sel.joint, names().length - 1); }
    function toggleJoint() {
      const { person, joint } = state.sel, k = people()[person] && people()[person].keypoints[joint];
      commit(PP.setVisible(state.pose, person, joint, !k));
    }

    // ── pointer ──
    function toCanvas(ev) {
      const r = canvas.getBoundingClientRect();
      return { x: (ev.clientX - r.left) * (canvas.width / r.width), y: (ev.clientY - r.top) * (canvas.height / r.height), scale: canvas.width / r.width };
    }
    function hit(p) {
      let best = null, bd = HIT_PX * p.scale;
      people().forEach((person, pi) => person.keypoints.forEach((k, ji) => { if (!k) return; const d = Math.hypot(k[0] - p.x, k[1] - p.y); if (d <= bd) { bd = d; best = { person: pi, joint: ji }; } }));
      return best;
    }
    canvas.addEventListener('pointerdown', ev => {
      if (ev.button !== undefined && ev.button !== 0) return;
      const p = toCanvas(ev), h = hit(p); canvas.focus();
      if (!h) return;
      ev.preventDefault();
      state.sel = h; state.drag = { start: state.pose, moved: false, id: ev.pointerId };
      try { canvas.setPointerCapture(ev.pointerId); } catch (_) {}
      refresh(); say(describeSel());
    });
    canvas.addEventListener('pointermove', ev => {
      if (!state.drag) return;
      const p = toCanvas(ev);
      state.pose = (state.connected ? PP.moveJointChain : PP.moveJoint)(state.drag.start, state.sel.person, state.sel.joint, p.x, p.y);   // live; history is pushed on release
      state.drag.moved = true; draw();
    });
    const endDrag = ev => {
      if (!state.drag) return;
      const d = state.drag; state.drag = null;
      try { canvas.releasePointerCapture(ev.pointerId); } catch (_) {}
      if (d.moved) { const next = state.pose; state.pose = d.start; commit(next); } else refresh();
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', ev => { if (state.drag) { state.pose = state.drag.start; state.drag = null; refresh(); } });

    // ── keyboard ──
    function allJoints() { const out = []; people().forEach((p, pi) => p.keypoints.forEach((k, ji) => { if (k) out.push([pi, ji]); })); return out; }
    canvas.addEventListener('keydown', ev => {
      if (ev.altKey || ev.ctrlKey || ev.metaKey) return;
      if (ev.key === 'Tab') {
        const list = allJoints(), cur = list.findIndex(([p, j]) => p === state.sel.person && j === state.sel.joint);
        const nxt = cur + (ev.shiftKey ? -1 : 1);
        if (nxt < 0 || nxt >= list.length || !list.length) return;       // leave the canvas at either end (no keyboard trap)
        ev.preventDefault(); state.sel = { person: list[nxt][0], joint: list[nxt][1] }; refresh(); say(describeSel()); return;
      }
      const step = ev.shiftKey ? 10 : 1, d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[ev.key];
      if (d) {
        ev.preventDefault();
        const k = people()[state.sel.person].keypoints[state.sel.joint]; if (!k) return say(describeSel() + ' (press V to show it)');
        commit((state.connected ? PP.moveJointChain : PP.moveJoint)(state.pose, state.sel.person, state.sel.joint, k[0] + d[0], k[1] + d[1]), { coalesceKey: state.sel.person + ':' + state.sel.joint });
      } else if (ev.key === 'v' || ev.key === 'V') { ev.preventDefault(); toggleJoint(); }
      else if ((ev.key === 'z' || ev.key === 'Z')) { ev.preventDefault(); ev.shiftKey ? redo() : undo(); }
    });
    canvas.addEventListener('focus', () => say(describeSel()));

    // ── controls ──
    planSel.addEventListener('change', () => { const r = guard(() => PP.changePlan(state.pose, planSel.value)); if (r) { state.sel = { person: Math.min(state.sel.person, r.people.length - 1), joint: 0 }; commit(r); } else syncControls(); });
    personSel.addEventListener('change', () => { state.sel = { person: Number(personSel.value) || 0, joint: 0 }; refresh(); say(describeSel()); });
    tplSel.addEventListener('change', () => { const r = guard(() => PP.applyTemplate(state.pose, state.sel.person, tplSel.value)); if (r) commit(r); });

    // ── export ──
    const toBlob = (c, type) => new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('canvas.toBlob failed'))), type));
    async function buildExport() {
      const pose = PP.clone(state.pose), off = document.createElement('canvas'); off.width = pose.width; off.height = pose.height;
      PP.renderToCanvas(off.getContext('2d'), pose);                        // clean skeleton on black: no reference image, no selection ring
      const png = await toBlob(off, 'image/png'), openpose = PP.PLANS[pose.plan].openposeCompatible;
      const doc = openpose ? PP.toOpenPoseJson(pose) : PP.toDexPoseJson(pose);
      const json = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
      return { png, json, plan: pose.plan, openpose, pose };
    }
    function download(blob, name) {
      const url = URL.createObjectURL(blob), a = el('a', { href: url, download: name, style: 'display:none' });
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
    }
    async function doExport(which) {
      try {
        errBox.textContent = '';
        const out = await buildExport();
        if (cb('onExport')) await cb('onExport')({ png: out.png, json: out.json, plan: out.plan, openpose: out.openpose, pose: out.pose });
        if (opts.download !== false) download(which === 'png' ? out.png : out.json, which === 'png' ? `pose-${out.plan}.png` : (out.openpose ? `pose-${out.plan}.json` : `pose-${out.plan}.dexpose.json`));
        say(`Exported ${which.toUpperCase()}` + (out.openpose ? '' : ' (non-OpenPose plan: DexDiffusion pose format)'));
      } catch (e) { errBox.textContent = 'Export failed: ' + e.message; }
    }

    // ── background reference (caller-supplied data:/blob: URL only) ──
    function setBackground(url) {
      if (url == null || url === '') { state.bg = null; draw(); return true; }
      if (typeof url !== 'string' || !SAFE_BG.test(url)) { errBox.textContent = 'Reference image must be a data: or blob: URL'; return false; }
      const img = new Image();
      img.onload = () => { if (!state.destroyed) { state.bg = img; draw(); } };
      img.onerror = () => { errBox.textContent = 'Reference image could not be decoded'; };
      img.src = url; return true;
    }

    refresh();
    if (opts.backgroundUrl) setBackground(opts.backgroundUrl);
    say(describeSel());

    const api = {
      getPose: () => PP.clone(state.pose),
      setPose(pose) { const errs = PP.validatePose(pose); if (errs.length) throw new Error(errs[0]); state.sel = { person: 0, joint: 0 }; commit(PP.clone(pose)); },
      setBackground, undo, redo, exportNow: buildExport,
      jointClientPoint(pi, ji) { const k = people()[pi] && people()[pi].keypoints[ji]; if (!k) return null; const r = canvas.getBoundingClientRect(); return { x: r.left + k[0] * r.width / canvas.width, y: r.top + k[1] * r.height / canvas.height }; },
      destroy() { state.destroyed = true; root.remove(); },
    };
    return api;
  }

  window.DexPuppetMaster = { mount, NOTICE };
})();
