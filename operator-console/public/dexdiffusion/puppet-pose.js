// Puppet Master pose model (CN-10 export, CN-14 body plans, CN-15 groundwork). Pure; no DOM except renderToCanvas(ctx).
// Authoring only: no ControlNet weights are installed, so nothing here conditions generation.
//
// Body plans
//   openpose18  COCO-18 in OpenPose order, 17 limbs, ControlNet openpose-annotator colours. Exportable as OpenPose JSON.
//   quadruped   DexDiffusion extension (side-view four-legged animal). NOT understood by a humanoid OpenPose ControlNet.
//   winged      DexDiffusion extension (bird / winged creature). NOT understood by a humanoid OpenPose ControlNet.
// Pose: { plan, width, height, people: [{ keypoints: [[x, y, confidence] | null, ...] }] }; null = absent joint.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DexPuppetPose = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const MAX_PEOPLE = 10, MIN_CANVAS = 64, MAX_CANVAS = 2048, MAX_JSON_CHARS = 262144;
  // ControlNet annotator colours (util.draw_bodypose), shared by limbs and joints.
  const OPENPOSE_COLORS = Object.freeze([[255, 0, 0], [255, 85, 0], [255, 170, 0], [255, 255, 0], [170, 255, 0], [85, 255, 0], [0, 255, 0], [0, 255, 85], [0, 255, 170], [0, 255, 255], [0, 170, 255], [0, 85, 255], [0, 0, 255], [85, 0, 255], [170, 0, 255], [255, 0, 255], [255, 0, 170], [255, 0, 85]].map(c => Object.freeze(c)));
  const OPENPOSE_NAMES = Object.freeze(['nose', 'neck', 'r_shoulder', 'r_elbow', 'r_wrist', 'l_shoulder', 'l_elbow', 'l_wrist', 'r_hip', 'r_knee', 'r_ankle', 'l_hip', 'l_knee', 'l_ankle', 'r_eye', 'l_eye', 'r_ear', 'l_ear']);
  // limbSeq of draw_bodypose, 1-indexed there, 0-indexed here.
  const OPENPOSE_LIMBS = Object.freeze([[1, 2], [1, 5], [2, 3], [3, 4], [5, 6], [6, 7], [1, 8], [8, 9], [9, 10], [1, 11], [11, 12], [12, 13], [1, 0], [0, 14], [14, 16], [0, 15], [15, 17]].map(l => Object.freeze(l)));

  const QUADRUPED_NAMES = Object.freeze(['nose', 'neck', 'r_f_shoulder', 'r_f_knee', 'r_f_paw', 'l_f_shoulder', 'l_f_knee', 'l_f_paw', 'r_b_hip', 'r_b_knee', 'r_b_paw', 'l_b_hip', 'l_b_knee', 'l_b_paw', 'tail_base', 'tail_tip', 'r_ear', 'l_ear']);
  const QUADRUPED_LIMBS = Object.freeze([[0, 1], [0, 16], [0, 17], [1, 2], [2, 3], [3, 4], [1, 5], [5, 6], [6, 7], [1, 14], [14, 8], [8, 9], [9, 10], [14, 11], [11, 12], [12, 13], [14, 15]].map(l => Object.freeze(l)));
  const WINGED_NAMES = Object.freeze(['head', 'neck', 'r_wing_root', 'r_wing_mid', 'r_wing_tip', 'l_wing_root', 'l_wing_mid', 'l_wing_tip', 'body_center', 'tail_base', 'tail_tip', 'r_foot', 'l_foot', 'r_eye', 'l_eye', 'beak']);
  const WINGED_LIMBS = Object.freeze([[0, 1], [0, 15], [0, 13], [0, 14], [1, 2], [2, 3], [3, 4], [1, 5], [5, 6], [6, 7], [1, 8], [8, 9], [9, 10], [8, 11], [8, 12]].map(l => Object.freeze(l)));

  // Normalised (0..1 of canvas) templates. Front view follows OpenPose convention: subject's right = viewer's left.
  const OP_STAND = [[.5, .17], [.5, .27], [.42, .28], [.40, .42], [.39, .55], [.58, .28], [.60, .42], [.61, .55], [.45, .55], [.45, .72], [.45, .90], [.55, .55], [.55, .72], [.55, .90], [.48, .15], [.52, .15], [.45, .16], [.55, .16]];
  const OP_TPOSE = OP_STAND.map((p, i) => ({ 3: [.28, .28], 4: [.15, .28], 6: [.72, .28], 7: [.85, .28] }[i] || p));
  const QUAD_STAND = [[.22, .33], [.32, .38], [.34, .45], [.33, .60], [.33, .75], [.38, .45], [.39, .60], [.39, .75], [.70, .45], [.71, .62], [.70, .75], [.75, .45], [.76, .62], [.75, .75], [.74, .38], [.88, .30], [.24, .27], [.27, .28]];
  const WING_PERCH = [[.50, .18], [.50, .28], [.42, .32], [.30, .40], [.18, .30], [.58, .32], [.70, .40], [.82, .30], [.50, .50], [.50, .66], [.50, .88], [.46, .72], [.54, .72], [.48, .16], [.52, .16], [.50, .22]];
  const WING_SPREAD = WING_PERCH.map((p, i) => ({ 3: [.28, .30], 4: [.08, .24], 6: [.72, .30], 7: [.92, .24] }[i] || p));

  const PLANS = Object.freeze({
    openpose18: Object.freeze({ id: 'openpose18', label: 'Humanoid (OpenPose 18)', openposeCompatible: true, names: OPENPOSE_NAMES, limbs: OPENPOSE_LIMBS,
      note: 'COCO-18 / OpenPose body layout, as read by the standard OpenPose ControlNet.', templates: { standing: OP_STAND, tpose: OP_TPOSE } }),
    quadruped: Object.freeze({ id: 'quadruped', label: 'Quadruped (DexDiffusion extension)', openposeCompatible: false, names: QUADRUPED_NAMES, limbs: QUADRUPED_LIMBS,
      note: 'DexDiffusion custom plan. A humanoid OpenPose ControlNet does NOT understand it; exports are labelled non-openpose.', templates: { standing: QUAD_STAND } }),
    winged: Object.freeze({ id: 'winged', label: 'Winged (DexDiffusion extension)', openposeCompatible: false, names: WINGED_NAMES, limbs: WINGED_LIMBS,
      note: 'DexDiffusion custom plan. A humanoid OpenPose ControlNet does NOT understand it; exports are labelled non-openpose.', templates: { perched: WING_PERCH, spread: WING_SPREAD } }),
  });
  const planIds = () => Object.keys(PLANS);
  const planColors = plan => Array.from({ length: PLANS[plan].names.length }, (_, i) => OPENPOSE_COLORS[i % OPENPOSE_COLORS.length]);

  class PoseError extends Error { constructor(m) { super(m); this.name = 'PoseError'; } }
  function getPlan(id) { if (typeof id !== 'string' || !Object.prototype.hasOwnProperty.call(PLANS, id)) throw new PoseError('unknown body plan: ' + String(id).slice(0, 40)); return PLANS[id]; }
  const templateNames = plan => Object.keys(getPlan(plan).templates);
  const isInt = v => typeof v === 'number' && Number.isInteger(v);
  const fin = v => typeof v === 'number' && Number.isFinite(v);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  function checkCanvas(w, h) {
    if (!isInt(w) || !isInt(h) || w < MIN_CANVAS || h < MIN_CANVAS || w > MAX_CANVAS || h > MAX_CANVAS) throw new PoseError(`canvas must be integers ${MIN_CANVAS}-${MAX_CANVAS}`);
  }
  const copy = pose => ({ plan: pose.plan, width: pose.width, height: pose.height, people: pose.people.map(p => ({ keypoints: p.keypoints.map(k => (k ? [k[0], k[1], k[2]] : null)) })) });
  function checkPerson(pose, i) { if (!isInt(i) || i < 0 || i >= pose.people.length) throw new PoseError('no such person: ' + i); }
  function bbox(person) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const k of person.keypoints) if (k) { x0 = Math.min(x0, k[0]); x1 = Math.max(x1, k[0]); y0 = Math.min(y0, k[1]); y1 = Math.max(y1, k[1]); }
    return x0 === Infinity ? null : { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
  }

  function templatePerson(plan, template, width, height) {
    const p = getPlan(plan), t = p.templates[template || Object.keys(p.templates)[0]];
    if (!t) throw new PoseError('unknown template: ' + String(template).slice(0, 40));
    return { keypoints: t.map(([x, y]) => [x * width, y * height, 1]) };
  }
  function createPose(plan, { width = 512, height = 512, template, people = 1 } = {}) {
    getPlan(plan); checkCanvas(width, height);
    if (!isInt(people) || people < 0 || people > MAX_PEOPLE) throw new PoseError(`people must be 0-${MAX_PEOPLE}`);
    const pose = { plan, width, height, people: [] };
    for (let i = 0; i < people; i++) {
      const p = templatePerson(plan, template, width, height);
      // Several people share the canvas side by side at reduced width.
      if (people > 1) { const sx = 1 / people, off = i * sx * width; p.keypoints = p.keypoints.map(([x, y, c]) => [x * sx + off, y, c]); }
      pose.people.push(p);
    }
    return pose;
  }
  // Replace one person with a template, keeping their horizontal/vertical centre and height.
  function applyTemplate(pose, pi, template) {
    checkPerson(pose, pi);
    const out = copy(pose), old = bbox(pose.people[pi]), p = templatePerson(pose.plan, template, pose.width, pose.height);
    out.people[pi] = p;
    const nb = bbox(p);
    if (!old || !nb || nb.h <= 0 || old.h <= 0) return out;
    const f = old.h / nb.h, cx = nb.cx, cy = nb.cy;
    p.keypoints = p.keypoints.map(k => [clamp(old.cx + (k[0] - cx) * f, 0, pose.width), clamp(old.cy + (k[1] - cy) * f, 0, pose.height), k[2]]);
    return out;
  }

  function moveJoint(pose, pi, ji, x, y) {
    checkPerson(pose, pi);
    if (!fin(x) || !fin(y)) throw new PoseError('joint position must be finite');
    const out = copy(pose), k = out.people[pi].keypoints;
    if (!isInt(ji) || ji < 0 || ji >= k.length) throw new PoseError('no such joint: ' + ji);
    if (!k[ji]) return out;                                    // absent joints cannot be dragged
    k[ji] = [clamp(x, 0, pose.width), clamp(y, 0, pose.height), k[ji][2]];
    return out;
  }
  // Connected-limb movement: the joint moves to (x, y) and everything hanging off it (its subtree when the skeleton is rooted at
  // the neck/body joint 1) moves by the same offset, so limb lengths and joint angles below it are preserved. Absent joints are
  // not created. Falls back to a plain single-joint move for the root and for plans whose graph has no joint 1.
  function descendants(plan, ji, root) {
    const adj = plan.limbs.reduce((m, [a, b]) => ((m[a] = m[a] || []).push(b), (m[b] = m[b] || []).push(a), m), {});
    const parent = { [root]: -1 }, order = [root];
    for (let i = 0; i < order.length; i++) for (const n of adj[order[i]] || []) if (!(n in parent)) { parent[n] = order[i]; order.push(n); }
    if (!(ji in parent) || ji === root) return [];
    const out = []; for (const n of order) { let c = n; while (c !== -1 && c !== ji) c = parent[c]; if (c === ji && n !== ji) out.push(n); }
    return out;
  }
  function moveJointChain(pose, pi, ji, x, y) {
    checkPerson(pose, pi);
    if (!fin(x) || !fin(y)) throw new PoseError('joint position must be finite');
    const k0 = pose.people[pi].keypoints[ji];
    if (!isInt(ji) || ji < 0 || ji >= pose.people[pi].keypoints.length) throw new PoseError('no such joint: ' + ji);
    if (!k0) return copy(pose);
    const plan = getPlan(pose.plan), kids = descendants(plan, ji, 1);
    if (!kids.length) return moveJoint(pose, pi, ji, x, y);
    // Clamp the offset so no descendant leaves the canvas: the whole limb stops at the edge instead of squashing.
    let dx = x - k0[0], dy = y - k0[1];
    for (const n of [ji, ...kids]) { const k = pose.people[pi].keypoints[n]; if (!k) continue; dx = clamp(dx, -k[0], pose.width - k[0]); dy = clamp(dy, -k[1], pose.height - k[1]); }
    const out = copy(pose), kp = out.people[pi].keypoints;
    for (const n of [ji, ...kids]) if (kp[n]) kp[n] = [kp[n][0] + dx, kp[n][1] + dy, kp[n][2]];
    return out;
  }
  // Toggle presence. Re-showing a joint puts it at `at`, else at the centre of the person's other joints.
  function setVisible(pose, pi, ji, visible, at) {
    checkPerson(pose, pi);
    const out = copy(pose), k = out.people[pi].keypoints;
    if (!isInt(ji) || ji < 0 || ji >= k.length) throw new PoseError('no such joint: ' + ji);
    if (!visible) { k[ji] = null; return out; }
    if (k[ji]) return out;
    let x, y;
    if (at && fin(at[0]) && fin(at[1])) { x = at[0]; y = at[1]; } else { const b = bbox(out.people[pi]); x = b ? b.cx : pose.width / 2; y = b ? b.cy : pose.height / 2; }
    k[ji] = [clamp(x, 0, pose.width), clamp(y, 0, pose.height), 1];
    return out;
  }
  function translatePerson(pose, pi, dx, dy) {
    checkPerson(pose, pi);
    if (!fin(dx) || !fin(dy)) throw new PoseError('translation must be finite');
    const out = copy(pose), b = bbox(pose.people[pi]); if (!b) return out;
    dx = clamp(dx, -b.x0, pose.width - b.x1); dy = clamp(dy, -b.y0, pose.height - b.y1);   // move the whole body, never distort it
    out.people[pi].keypoints = out.people[pi].keypoints.map(k => (k ? [k[0] + dx, k[1] + dy, k[2]] : null));
    return out;
  }
  function scalePerson(pose, pi, factor) {
    checkPerson(pose, pi);
    if (!fin(factor) || factor <= 0 || factor > 20) throw new PoseError('scale factor must be >0 and <=20');
    const out = copy(pose), b = bbox(pose.people[pi]); if (!b) return out;
    out.people[pi].keypoints = out.people[pi].keypoints.map(k => (k ? [clamp(b.cx + (k[0] - b.cx) * factor, 0, pose.width), clamp(b.cy + (k[1] - b.cy) * factor, 0, pose.height), k[2]] : null));
    return out;
  }
  // Left/right partner of each joint, derived from the r_ / l_ name prefixes.
  function mirrorMap(plan) {
    const names = getPlan(plan).names;
    return names.map((n, i) => { const m = /^([rl])_(.*)$/.exec(n); if (!m) return i; const j = names.indexOf((m[1] === 'r' ? 'l_' : 'r_') + m[2]); return j < 0 ? i : j; });
  }
  // Flip left-right and swap left/right joints. With personIndex: about that person's own bbox centre; without: about the canvas centre, all people.
  function mirror(pose, personIndex) {
    const map = mirrorMap(pose.plan), out = copy(pose);
    const flip = (person, axis) => ({ keypoints: person.keypoints.map((_, i) => { const k = person.keypoints[map[i]]; return k ? [clamp(2 * axis - k[0], 0, pose.width), k[1], k[2]] : null; }) });
    if (personIndex === undefined || personIndex === null) { out.people = pose.people.map(p => flip(p, pose.width / 2)); return out; }
    checkPerson(pose, personIndex);
    const b = bbox(pose.people[personIndex]);
    out.people[personIndex] = flip(pose.people[personIndex], b ? b.cx : pose.width / 2);
    return out;
  }
  function addPerson(pose, template) {
    if (pose.people.length >= MAX_PEOPLE) throw new PoseError(`at most ${MAX_PEOPLE} people`);
    const out = copy(pose); out.people.push(templatePerson(pose.plan, template, pose.width, pose.height));
    const i = out.people.length - 1;
    return translatePerson(scalePerson(out, i, 0.7), i, (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.08 * pose.width, 0);
  }
  function removePerson(pose, pi) { checkPerson(pose, pi); const out = copy(pose); out.people.splice(pi, 1); return out; }
  function changePlan(pose, plan, template) { return createPose(plan, { width: pose.width, height: pose.height, template, people: Math.max(1, pose.people.length) }); }

  // Returns a list of problems ([] = valid). Never throws.
  function validatePose(pose) {
    const errs = [];
    try {
      if (!pose || typeof pose !== 'object') return ['pose must be an object'];
      const plan = typeof pose.plan === 'string' && Object.prototype.hasOwnProperty.call(PLANS, pose.plan) ? PLANS[pose.plan] : null;
      if (!plan) return ['unknown body plan'];
      try { checkCanvas(pose.width, pose.height); } catch (e) { errs.push(e.message); }
      if (!Array.isArray(pose.people)) return errs.concat('people must be an array');
      if (pose.people.length > MAX_PEOPLE) return errs.concat(`at most ${MAX_PEOPLE} people`);
      pose.people.forEach((p, pi) => {
        if (!p || !Array.isArray(p.keypoints) || p.keypoints.length !== plan.names.length) { errs.push(`person ${pi}: keypoints must be an array of ${plan.names.length}`); return; }
        p.keypoints.forEach((k, ji) => {
          if (k === null) return;
          if (!Array.isArray(k) || k.length !== 3 || !k.every(fin)) { errs.push(`person ${pi} joint ${ji}: must be [x, y, confidence] of finite numbers or null`); return; }
          if (k[0] < 0 || k[1] < 0 || k[0] > pose.width || k[1] > pose.height) errs.push(`person ${pi} joint ${ji}: outside canvas`);
          if (k[2] < 0 || k[2] > 1) errs.push(`person ${pi} joint ${ji}: confidence outside 0-1`);
        });
      });
    } catch (e) { errs.push('invalid pose: ' + e.message); }
    return errs.slice(0, 20);
  }
  const assertValid = pose => { const e = validatePose(pose); if (e.length) throw new PoseError(e[0]); return pose; };

  // ── exporters ──────────────────────────────────────────────────────────
  function toOpenPoseJson(pose) {
    assertValid(pose);
    if (!PLANS[pose.plan].openposeCompatible) throw new PoseError(`plan "${pose.plan}" is a DexDiffusion extension and cannot be exported as OpenPose JSON (use toDexPoseJson)`);
    return { version: 1.3, canvas_width: pose.width, canvas_height: pose.height,
      people: pose.people.map(p => ({ person_id: [-1], pose_keypoints_2d: [].concat(...p.keypoints.map(k => (k ? [k[0], k[1], k[2]] : [0, 0, 0]))), face_keypoints_2d: [], hand_left_keypoints_2d: [], hand_right_keypoints_2d: [] })) };
  }
  function parseInput(json) {
    if (typeof json === 'string') { if (json.length > MAX_JSON_CHARS) throw new PoseError('JSON too large'); try { return JSON.parse(json); } catch (_) { throw new PoseError('not valid JSON'); } }
    return json;
  }
  function importOpenPoseJson(json, { width, height } = {}) {
    const o = parseInput(json);
    if (!o || typeof o !== 'object' || Array.isArray(o)) throw new PoseError('OpenPose JSON must be an object');
    const w = o.canvas_width !== undefined ? o.canvas_width : width, h = o.canvas_height !== undefined ? o.canvas_height : height;
    checkCanvas(w, h);
    if (!Array.isArray(o.people)) throw new PoseError('people must be an array');
    if (o.people.length > MAX_PEOPLE) throw new PoseError(`at most ${MAX_PEOPLE} people`);
    return { plan: 'openpose18', width: w, height: h, people: o.people.map((p, pi) => {
      const a = p && p.pose_keypoints_2d;
      if (!Array.isArray(a) || a.length !== 54) throw new PoseError(`person ${pi}: pose_keypoints_2d must have 54 numbers (COCO-18)`);
      if (!a.every(fin)) throw new PoseError(`person ${pi}: non-finite value`);
      const keypoints = [];
      for (let i = 0; i < 18; i++) {
        const x = a[i * 3], y = a[i * 3 + 1], c = a[i * 3 + 2];
        if (c < 0 || c > 1) throw new PoseError(`person ${pi} joint ${i}: confidence outside 0-1`);
        if (c === 0) { keypoints.push(null); continue; }              // OpenPose: confidence 0 = not detected
        if (x < 0 || y < 0 || x > w || y > h) throw new PoseError(`person ${pi} joint ${i}: outside canvas`);
        keypoints.push([x, y, c]);
      }
      return { keypoints };
    }) };
  }
  // DexDiffusion's own format, used for non-OpenPose plans; explicitly labelled so nothing downstream mistakes it.
  function toDexPoseJson(pose) {
    assertValid(pose); const plan = PLANS[pose.plan];
    return { format: 'dexdiffusion-pose', version: 1, openpose_compatible: plan.openposeCompatible, plan: pose.plan, joint_names: plan.names.slice(), limbs: plan.limbs.map(l => l.slice()), canvas_width: pose.width, canvas_height: pose.height,
      people: pose.people.map(p => ({ keypoints: p.keypoints.map(k => (k ? [k[0], k[1], k[2]] : null)) })) };
  }
  function importDexPoseJson(json) {
    const o = parseInput(json);
    if (!o || typeof o !== 'object' || o.format !== 'dexdiffusion-pose' || o.version !== 1) throw new PoseError('not a dexdiffusion-pose v1 document');
    if (!Array.isArray(o.people)) throw new PoseError('people must be an array');
    return assertValid({ plan: o.plan, width: o.canvas_width, height: o.canvas_height, people: o.people.map(p => ({ keypoints: p && p.keypoints })) });
  }

  // ── rendering ──────────────────────────────────────────────────────────
  // ControlNet draw_bodypose look on black: limbs are filled ellipses (stick width 4) that end up at 0.6 brightness, joints are
  // full-colour circles radius 4; both at a 512 px reference scale. Dimming limb colours by 0.6 equals the annotator's "canvas * 0.6".
  // opts.clear=false keeps what is already on the canvas (editor overlay on a reference image).
  function renderToCanvas(ctx, pose, opts = {}) {
    assertValid(pose);
    const w = pose.width, h = pose.height, s = Math.min(w, h) / 512, colors = planColors(pose.plan), limbs = PLANS[pose.plan].limbs;
    ctx.save();
    if (opts.clear !== false) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h); }
    for (const person of pose.people) {
      limbs.forEach(([a, b], li) => {
        const A = person.keypoints[a], B = person.keypoints[b]; if (!A || !B) return;
        const c = colors[li % colors.length], dx = B[0] - A[0], dy = B[1] - A[1], len = Math.hypot(dx, dy);
        ctx.fillStyle = `rgb(${Math.round(c[0] * .6)},${Math.round(c[1] * .6)},${Math.round(c[2] * .6)})`;
        ctx.beginPath(); ctx.ellipse((A[0] + B[0]) / 2, (A[1] + B[1]) / 2, Math.max(0.5, len / 2), 4 * s, Math.atan2(dy, dx), 0, Math.PI * 2); ctx.fill();
      });
    }
    for (const person of pose.people) person.keypoints.forEach((k, i) => {
      if (!k) return; const c = colors[i];
      ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`; ctx.beginPath(); ctx.arc(k[0], k[1], 4 * s, 0, Math.PI * 2); ctx.fill();
    });
    ctx.restore();
  }

  return { moveJointChain, MAX_PEOPLE, MIN_CANVAS, MAX_CANVAS, PLANS, OPENPOSE_COLORS, OPENPOSE_NAMES, OPENPOSE_LIMBS, PoseError, planIds, planColors, templateNames, getPlan, mirrorMap,
    createPose, applyTemplate, moveJoint, setVisible, translatePerson, scalePerson, mirror, addPerson, removePerson, changePlan, bbox, validatePose,
    toOpenPoseJson, importOpenPoseJson, toDexPoseJson, importDexPoseJson, renderToCanvas, clone: copy };
});
