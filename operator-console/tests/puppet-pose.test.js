'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../public/dexdiffusion/puppet-pose.js');
// Deep-equal poses within float rounding (reflection twice is exact only up to 1e-12).
const near = (a, b, msg) => assert.deepEqual(JSON.parse(JSON.stringify(a), (_, v) => (typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v)), JSON.parse(JSON.stringify(b), (_, v) => (typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v)), msg);

test('openpose18 keypoint order and limb table match the OpenPose COCO-18 layout', () => {
  assert.deepEqual(P.OPENPOSE_NAMES, ['nose', 'neck', 'r_shoulder', 'r_elbow', 'r_wrist', 'l_shoulder', 'l_elbow', 'l_wrist', 'r_hip', 'r_knee', 'r_ankle', 'l_hip', 'l_knee', 'l_ankle', 'r_eye', 'l_eye', 'r_ear', 'l_ear']);
  assert.equal(P.OPENPOSE_LIMBS.length, 17);
  assert.equal(P.OPENPOSE_COLORS.length, 18);
  assert.deepEqual(P.OPENPOSE_LIMBS[0], [1, 2]);               // neck -> r_shoulder
  assert.deepEqual(P.OPENPOSE_LIMBS[16], [15, 17]);            // l_eye -> l_ear
  assert.deepEqual(P.OPENPOSE_COLORS[0], [255, 0, 0]);
  assert.deepEqual(P.OPENPOSE_COLORS[17], [255, 0, 85]);
  for (const id of P.planIds()) {
    const plan = P.PLANS[id];
    for (const [a, b] of plan.limbs) assert.ok(a >= 0 && b >= 0 && a < plan.names.length && b < plan.names.length && a !== b, id);
  }
});

test('default templates are valid for every plan and template', () => {
  for (const id of P.planIds()) for (const t of P.templateNames(id)) {
    const pose = P.createPose(id, { template: t, people: 2 });
    assert.deepEqual(P.validatePose(pose), [], id + '/' + t);
    assert.equal(pose.people[0].keypoints.length, P.PLANS[id].names.length);
  }
});

test('OpenPose JSON round trip', () => {
  let pose = P.createPose('openpose18', { width: 640, height: 480, template: 'tpose', people: 2 });
  pose = P.setVisible(pose, 0, 7, false);
  const json = P.toOpenPoseJson(pose);
  assert.equal(json.version, 1.3);
  assert.equal(json.canvas_width, 640);
  assert.equal(json.people.length, 2);
  assert.equal(json.people[0].pose_keypoints_2d.length, 54);
  assert.deepEqual(json.people[0].pose_keypoints_2d.slice(21, 24), [0, 0, 0], 'absent joint is 0,0,0');
  const back = P.importOpenPoseJson(JSON.parse(JSON.stringify(json)));
  assert.deepEqual(back, pose);
  assert.equal(back.people[0].keypoints[7], null);
  assert.deepEqual(P.importOpenPoseJson(JSON.stringify(json)), pose);
});

test('mirror swaps left/right and reflects x', () => {
  const pose = P.createPose('openpose18', { template: 'standing' });
  const m = P.mirror(pose);
  const N = P.OPENPOSE_NAMES, k = (p, n) => p.people[0].keypoints[N.indexOf(n)];
  for (const n of N) {
    const partner = n.startsWith('r_') ? 'l_' + n.slice(2) : n.startsWith('l_') ? 'r_' + n.slice(2) : n;
    assert.ok(Math.abs(k(m, n)[0] - (pose.width - k(pose, partner)[0])) < 1e-9, n);
    assert.equal(k(m, n)[1], k(pose, partner)[1], n);
  }
  assert.ok(k(pose, 'r_wrist')[0] < k(pose, 'l_wrist')[0], 'subject right is viewer left');
  near(P.mirror(m), pose, 'mirror twice = identity');
  // per-person mirror keeps the person in place and leaves others alone
  const two = P.moveJoint(P.createPose('openpose18', { people: 2 }), 1, 4, 300, 50);   // asymmetric
  const pm = P.mirror(two, 1);
  assert.deepEqual(pm.people[0], two.people[0]);
  assert.notDeepEqual(pm.people[1], two.people[1]);
  assert.ok(Math.abs(P.bbox(pm.people[1]).cx - P.bbox(two.people[1]).cx) < 1e-9);
  near(P.mirror(pm, 1), two);
});

test('mirror works for custom plans and keeps unpaired joints', () => {
  const q = P.createPose('quadruped');
  const m = P.mirror(q), N = P.PLANS.quadruped.names;
  assert.ok(Math.abs(m.people[0].keypoints[N.indexOf('r_f_paw')][0] - (q.width - q.people[0].keypoints[N.indexOf('l_f_paw')][0])) < 1e-9);
  assert.ok(Math.abs(m.people[0].keypoints[N.indexOf('nose')][0] - (q.width - q.people[0].keypoints[N.indexOf('nose')][0])) < 1e-9);
  near(P.mirror(m), q);
});

test('edit operations stay in bounds and do not mutate their input', () => {
  const pose = P.createPose('openpose18');
  const snap = JSON.stringify(pose);
  const moved = P.moveJoint(pose, 0, 1, -50, 9999);
  assert.deepEqual(moved.people[0].keypoints[1].slice(0, 2), [0, 512]);
  const t = P.translatePerson(pose, 0, 5000, 5000);
  assert.deepEqual(P.validatePose(t), []);
  const s = P.scalePerson(pose, 0, 5);
  assert.deepEqual(P.validatePose(s), []);
  assert.equal(JSON.stringify(pose), snap);
  assert.throws(() => P.moveJoint(pose, 0, 1, NaN, 1), /finite/);
  assert.throws(() => P.moveJoint(pose, 3, 1, 1, 1), /no such person/);
  assert.throws(() => P.scalePerson(pose, 0, 0), /scale/);
  assert.equal(P.moveJoint(P.setVisible(pose, 0, 4, false), 0, 4, 10, 10).people[0].keypoints[4], null);
  assert.ok(P.setVisible(P.setVisible(pose, 0, 4, false), 0, 4, true).people[0].keypoints[4]);
  assert.equal(P.removePerson(P.addPerson(pose), 1).people.length, 1);
});

test('people are capped at 10', () => {
  let pose = P.createPose('openpose18', { people: 10 });
  assert.throws(() => P.addPerson(pose), /at most 10/);
  assert.throws(() => P.createPose('openpose18', { people: 11 }), /people must be/);
  const over = JSON.parse(JSON.stringify(P.toOpenPoseJson(pose)));
  over.people.push(over.people[0]);
  assert.throws(() => P.importOpenPoseJson(over), /at most 10/);
});

test('import rejects malformed, non-finite, out-of-bounds and oversize input', () => {
  const good = () => JSON.parse(JSON.stringify(P.toOpenPoseJson(P.createPose('openpose18'))));
  const bad = (mut, re) => { const j = good(); mut(j); assert.throws(() => P.importOpenPoseJson(j), re); };
  bad(j => { j.people[0].pose_keypoints_2d[3] = NaN; }, /non-finite/);
  bad(j => { j.people[0].pose_keypoints_2d[3] = Infinity; }, /non-finite/);
  bad(j => { j.people[0].pose_keypoints_2d[3] = '10'; }, /non-finite/);
  bad(j => { j.people[0].pose_keypoints_2d[0] = 99999; }, /outside canvas/);
  bad(j => { j.people[0].pose_keypoints_2d[1] = -1; }, /outside canvas/);
  bad(j => { j.people[0].pose_keypoints_2d[2] = 2; }, /confidence/);
  bad(j => { j.people[0].pose_keypoints_2d.pop(); }, /54 numbers/);
  bad(j => { j.people[0].pose_keypoints_2d = new Array(75).fill(1); }, /54 numbers/);
  bad(j => { j.canvas_width = 10; }, /canvas/);
  bad(j => { j.canvas_height = 4096; }, /canvas/);
  bad(j => { j.canvas_width = 512.5; }, /canvas/);
  bad(j => { j.people = 'x'; }, /people must be an array/);
  bad(j => { j.people = [null]; }, /54 numbers/);
  assert.throws(() => P.importOpenPoseJson('{not json'), /not valid JSON/);
  assert.throws(() => P.importOpenPoseJson('[]'), /object/);
  assert.throws(() => P.importOpenPoseJson(' '.repeat(300000)), /too large/);
  assert.throws(() => P.importOpenPoseJson({ people: [] }), /canvas/);
  assert.equal(P.importOpenPoseJson({ people: [] }, { width: 512, height: 512 }).people.length, 0);
});

test('validatePose rejects bad poses without throwing', () => {
  const p = P.createPose('openpose18');
  const v = mut => { const c = P.clone(p); mut(c); return P.validatePose(c); };
  assert.ok(v(c => { c.people[0].keypoints[0][0] = NaN; }).length);
  assert.ok(v(c => { c.people[0].keypoints[0][0] = 513; }).length);
  assert.ok(v(c => { c.people[0].keypoints.pop(); }).length);
  assert.ok(v(c => { c.plan = 'robot'; }).length);
  assert.ok(v(c => { c.width = 32; }).length);
  assert.ok(v(c => { c.width = 4096; }).length);
  assert.ok(v(c => { c.plan = '__proto__'; }).length);
  assert.ok(P.validatePose(null).length);
  assert.ok(P.validatePose({ plan: 'openpose18', width: 512, height: 512, people: new Array(11).fill({ keypoints: [] }) }).length);
});

test('custom plans cannot be exported as OpenPose JSON but have a labelled Dex format', () => {
  for (const id of ['quadruped', 'winged']) {
    const pose = P.createPose(id);
    assert.equal(P.PLANS[id].openposeCompatible, false);
    assert.throws(() => P.toOpenPoseJson(pose), /cannot be exported as OpenPose/);
    const d = P.toDexPoseJson(pose);
    assert.equal(d.format, 'dexdiffusion-pose');
    assert.equal(d.openpose_compatible, false);
    assert.equal(d.plan, id);
    assert.deepEqual(P.importDexPoseJson(JSON.stringify(d)), pose);
    assert.throws(() => P.importOpenPoseJson(d), /54 numbers|canvas|people/);
  }
  assert.equal(P.toDexPoseJson(P.createPose('openpose18')).openpose_compatible, true);
  assert.throws(() => P.importDexPoseJson({ format: 'other' }), /not a dexdiffusion-pose/);
  assert.throws(() => P.importDexPoseJson({ format: 'dexdiffusion-pose', version: 1, plan: 'winged', canvas_width: 512, canvas_height: 512, people: [{ keypoints: [] }] }), /keypoints/);
});

test('renderToCanvas draws ControlNet colours with a recording context', () => {
  const calls = [];
  const ctx = new Proxy({}, { get: (_, n) => (n === 'save' || n === 'restore' || n === 'beginPath' ? () => calls.push([n]) : (...a) => calls.push([n, ...a])), set: (_, n, v) => { calls.push(['set:' + n, v]); return true; } });
  P.renderToCanvas(ctx, P.createPose('openpose18'));
  assert.ok(calls.some(c => c[0] === 'fillRect'));
  assert.equal(calls.filter(c => c[0] === 'ellipse').length, 17, '17 limb sticks');
  assert.equal(calls.filter(c => c[0] === 'arc').length, 18, '18 joints');
  const fills = calls.filter(c => c[0] === 'set:fillStyle').map(c => c[1]);
  assert.ok(fills.includes('rgb(153,0,0)'), 'limb 0 is red at 0.6');
  assert.ok(fills.includes('rgb(255,0,0)'), 'joint 0 is full red');
  assert.throws(() => P.renderToCanvas(ctx, { plan: 'openpose18', width: 512, height: 512, people: [{ keypoints: [] }] }));
});

test('moveJointChain: dragging an elbow carries the forearm and hand and preserves limb lengths', () => {
  const PP = require('../public/dexdiffusion/puppet-pose.js');
  const pose = PP.createPose('openpose18', { width: 512, height: 512, template: 'standing' });
  const k = pose.people[0].keypoints, len = (a, b) => Math.hypot(k[a][0] - k[b][0], k[a][1] - k[b][1]);
  const upper = len(2, 3), fore = len(3, 4);
  const moved = PP.moveJointChain(pose, 0, 3, k[3][0] + 20, k[3][1] + 15);
  const m = moved.people[0].keypoints, ml = (a, b) => Math.hypot(m[a][0] - m[b][0], m[a][1] - m[b][1]);
  assert.deepEqual([m[3][0] - k[3][0], m[3][1] - k[3][1]], [20, 15]);
  assert.deepEqual([m[4][0] - k[4][0], m[4][1] - k[4][1]], [20, 15], 'wrist follows the elbow');
  assert.ok(Math.abs(ml(3, 4) - fore) < 1e-9, 'forearm length preserved');
  assert.ok(Math.abs(ml(2, 3) - upper) > 0, 'upper arm changes because only the elbow end moved');
  assert.deepEqual(m[5], k[5], 'the other arm is untouched'); assert.deepEqual(pose.people[0].keypoints[3], k[3], 'input is not mutated');
});
test('moveJointChain: the root joint, a leaf and an absent joint behave like a plain move; the limb stops at the canvas edge', () => {
  const PP = require('../public/dexdiffusion/puppet-pose.js');
  const pose = PP.createPose('openpose18', { width: 512, height: 512, template: 'standing' });
  const k = pose.people[0].keypoints;
  assert.deepEqual(PP.moveJointChain(pose, 0, 4, k[4][0] + 5, k[4][1]).people[0].keypoints[4].slice(0, 2), [k[4][0] + 5, k[4][1]]);
  const far = PP.moveJointChain(pose, 0, 3, 100000, k[3][1]).people[0].keypoints;
  assert.ok(far[3][0] <= 512 && far[4][0] <= 512, 'neither elbow nor wrist leaves the canvas');
  assert.ok(Math.abs((far[4][0] - far[3][0]) - (k[4][0] - k[3][0])) < 1e-9, 'forearm vector preserved at the edge');
  assert.ok(PP.validatePose(far.length ? PP.moveJointChain(pose, 0, 3, 100000, k[3][1]) : pose));
});
