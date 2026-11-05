'use strict';
const test = require('node:test');
const assert = require('node:assert');
const CN = require('../controlnet');
const VP = require('../vision-pose');
const { resolveTargetFamily } = require('../extra-networks');

const PNG = 'data:image/png;base64,' + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]).toString('base64');
const sdxl = { id: 'sdxl-juggernaut', label: 'Juggernaut XL' }, sd15 = { id: 'sd15' }, pony = { id: 'sdxl-pony' };
const flux = { id: 'flux2-klein-4b', backend: 'mflux' }, fluxSd = { id: 'flux-fp8' };

test('every ControlNet model and the ControlNet engine live on WC2TB', () => {
  for (const c of Object.values(CN.CONTROLNETS)) assert.match(c.path, /^\/Volumes\/wc2tb\//);
  assert.match(CN.SDCLI_CONTROL, /^\/Volumes\/wc2tb\//);
});

test('ControlNets match their checkpoint architecture only', () => {
  assert.deepStrictEqual(CN.controlnetsForTarget(sd15, resolveTargetFamily), ['openpose-sd15']);
  assert.deepStrictEqual(CN.controlnetsForTarget(sdxl, resolveTargetFamily), ['openpose-sdxl']);
  assert.deepStrictEqual(CN.controlnetsForTarget(pony, resolveTargetFamily), ['openpose-sdxl']);
  assert.deepStrictEqual(CN.controlnetsForTarget({ id: 'sdxl-auto-foo', aliasOf: undefined }, resolveTargetFamily), ['openpose-sdxl']);
  assert.deepStrictEqual(CN.controlnetsForTarget(flux, resolveTargetFamily), []);
  assert.deepStrictEqual(CN.controlnetsForTarget(fluxSd, resolveTargetFamily), []);
});

test('normalizeControlnet accepts a pose PNG or a Library image id and rejects everything else', () => {
  assert.deepStrictEqual(CN.normalizeControlnet(undefined, sdxl, resolveTargetFamily), { control: null });
  const ok = CN.normalizeControlnet({ model: 'openpose-sdxl', image: PNG, strength: 0.8 }, sdxl, resolveTargetFamily);
  assert.strictEqual(ok.control.model, 'openpose-sdxl');
  assert.strictEqual(ok.control.strength, 0.8);
  assert.ok(Buffer.isBuffer(ok.control.png));
  assert.strictEqual(CN.normalizeControlnet({ model: 'openpose-sdxl', image: PNG }, sdxl, resolveTargetFamily).control.strength, CN.STRENGTH.default);
  assert.strictEqual(CN.normalizeControlnet({ model: 'openpose-sd15', image_id: 'abc.png' }, sd15, resolveTargetFamily).control.imageId, 'abc.png');
  const bad = [
    [{ model: 'openpose-sd15', image: PNG }, sdxl],                       // wrong architecture
    [{ model: 'openpose-sdxl', image: PNG }, flux],                       // FLUX has no ControlNet here
    [{ model: 'canny', image: PNG }, sdxl],
    [{ model: 'openpose-sdxl', image: PNG, strength: 3 }, sdxl],
    [{ model: 'openpose-sdxl', image: PNG, strength: 'x' }, sdxl],
    [{ model: 'openpose-sdxl' }, sdxl],
    [{ model: 'openpose-sdxl', image: PNG, image_id: 'a.png' }, sdxl],
    [{ model: 'openpose-sdxl', image: 'data:image/jpeg;base64,AAAA' }, sdxl],
    [{ model: 'openpose-sdxl', image: 'data:image/png;base64,' + Buffer.from('GIF89a........').toString('base64') }, sdxl],
    [{ model: 'openpose-sdxl', image_id: '../../etc/passwd' }, sdxl],
    [{ model: 'openpose-sdxl', image: PNG, path: '/tmp/x' }, sdxl],
    ['openpose-sdxl', sdxl],
  ];
  for (const [raw, spec] of bad) assert.ok(CN.normalizeControlnet(raw, spec, resolveTargetFamily).error, JSON.stringify(raw).slice(0, 80));
});

test('public ControlNet list carries no paths', () => {
  for (const c of CN.publicControlnets()) { assert.strictEqual(c.path, undefined); assert.strictEqual(c.sha256, undefined); }
});

test('pose detector output is validated before it reaches the editor', () => {
  const kp = Array.from({ length: 18 }, (_, i) => [10 + i, 20 + i, 0.9]).flat();
  const doc = VP.parsePoseOutput(JSON.stringify({ version: 1.3, canvas_width: 512, canvas_height: 512, people: [{ pose_keypoints_2d: kp, extra: 'x' }], source: 'apple' }));
  assert.strictEqual(doc.people.length, 1);
  assert.strictEqual(doc.people[0].extra, undefined);
  assert.strictEqual(doc.source, undefined);
  const missing = kp.slice(); missing[0] = 0; missing[1] = 0; missing[2] = 0;
  assert.strictEqual(VP.parsePoseOutput(JSON.stringify({ canvas_width: 512, canvas_height: 512, people: [{ pose_keypoints_2d: missing }] })).people.length, 1);
  for (const badDoc of [
    'not json',
    { canvas_width: 512, canvas_height: 512, people: [{ pose_keypoints_2d: kp.slice(3) }] },
    { canvas_width: 512, canvas_height: 512, people: [{ pose_keypoints_2d: kp.map((v, i) => (i === 0 ? 9999 : v)) }] },
    { canvas_width: 512, canvas_height: 512, people: [{ pose_keypoints_2d: kp.map((v, i) => (i === 2 ? 2 : v)) }] },
    { canvas_width: 8, canvas_height: 512, people: [] },
    { canvas_width: 512, canvas_height: 512, people: Array(11).fill({ pose_keypoints_2d: kp }) },
  ]) assert.throws(() => VP.parsePoseOutput(typeof badDoc === 'string' ? badDoc : JSON.stringify(badDoc)), VP.PoseError);
});

test('detectPose reports a missing detector and detector errors plainly', async () => {
  await assert.rejects(VP.detectPose('/x.png', { bin: '/nonexistent/vision-pose' }), e => e.code === 'unavailable');
  const fakeRun = (bin, args, opts, cb) => cb(Object.assign(new Error('x'), { killed: false }), '', 'Error: could not read the image\n');
  await assert.rejects(VP.detectPose('/x.png', { bin: __filename, run: fakeRun }), e => e.code === 'vision_failed' && /could not read the image/.test(e.message));
  const okRun = (bin, args, opts, cb) => cb(null, JSON.stringify({ canvas_width: 64, canvas_height: 64, people: [] }), '');
  assert.deepStrictEqual((await VP.detectPose('/x.png', { bin: __filename, run: okRun })).people, []);
});
