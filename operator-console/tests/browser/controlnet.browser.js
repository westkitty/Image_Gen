'use strict';
// ControlNet panel in Create: compatible-model gating, pose from a photo (detector mocked), the pose editor, and the exact
// `controlnet` field sent with the generation request. No inference runs; the real server validator is exercised once.
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { startServer, installModelSnapshots, runner, launchBrowser, runCleanups, openStudio, chooseModel, makePng } = require('./helpers');

const { test, results, exitCode } = runner('controlnet');
const ENDPOINT = '**/api/actions/generate-controlled';

// OpenPose COCO-18 for a 400x600 photo: a standing person with the right arm raised.
const KP = [[200, 80], [200, 140], [160, 145], [150, 90], [150, 40], [240, 145], [250, 220], [255, 290], [175, 300], [175, 420], [175, 550], [225, 300], [225, 420], [225, 550], [190, 70], [210, 70], [180, 75], [220, 75]];
const POSE = { version: 1.3, canvas_width: 400, canvas_height: 600, people: [{ pose_keypoints_2d: KP.flatMap(([x, y]) => [x, y, 0.9]) }] };

async function open(page, base, { serverValidates = false } = {}) {
  const errors = [], bodies = [], poseRequests = [];
  page.on('pageerror', e => errors.push(String(e)));
  await installModelSnapshots(page, base);
  const caps = await (await fetch(base + '/api/capabilities')).json();
  const ids = (caps.modelTargets || caps.controlledTargets || []).map(t => t.id);
  caps.controlnets = [
    { id: 'openpose-sd15', label: 'OpenPose · SD 1.5', kind: 'openpose', family: 'sd15', targets: ids.filter(id => /^sd15/.test(id)) },
    { id: 'openpose-sdxl', label: 'OpenPose · SDXL (xinsir)', kind: 'openpose', family: 'sdxl', targets: ids.filter(id => /^sdxl/.test(id)) },
  ];
  await page.route('**/api/capabilities', r => r.request().method() === 'GET' ? r.fulfill({ json: caps }) : r.fallback());
  await page.route('**/api/models/secondary/activate', r => r.fulfill({ json: { modelState: {} } }));
  await page.route('**/api/controlnet/detect-pose', r => { poseRequests.push(r.request().postDataJSON()); r.fulfill({ json: { status: 'ok', pose: POSE } }); });
  await page.route(ENDPOINT, async r => {
    bodies.push(r.request().postDataJSON());
    if (serverValidates) return r.fallback();
    r.fulfill({ status: 400, json: { error: 'intercepted by test' } });
  });
  await openStudio(page, base + '/dexdiffusion/', { waitUntil: 'domcontentloaded' });
  // Create is the first screen of the masters layout (Image tab); the older nav has a Create category.
  const legacyCreate = page.locator('[data-studio-category="create"]');
  if (await legacyCreate.count()) await legacyCreate.click();
  await page.locator('[data-studio-advanced]').evaluate(el => { el.open = true; });
  return { errors, bodies, poseRequests };
}
async function generateOnce(page, bodies) {
  const before = bodies.length;
  await page.getByRole('textbox', { name: 'Describe your image', exact: true }).fill('a dancer on a stage');
  await page.getByRole('button', { name: 'Generate image', exact: true }).click();
  for (let i = 0; i < 40 && bodies.length === before; i++) await page.waitForTimeout(100);
  assert.equal(bodies.length, before + 1, 'exactly one generation request was sent');
  return bodies[bodies.length - 1];
}
const panel = page => page.locator('[data-controlnet-panel]');

(async () => {
  const srv = await startServer();
  const browser = await launchBrowser(chromium);
  try {
    await test('FLUX shows why ControlNet is unavailable and sends no controlnet field', async () => {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const { errors, bodies } = await open(page, srv.base);
      await chooseModel(page, 'flux2-klein-4b');
      await panel(page).locator('[data-cn-field="incompatible"]').waitFor();
      assert.equal(await panel(page).locator('[data-cn-field="on"]').isDisabled(), true);
      const body = await generateOnce(page, bodies);
      assert.equal(body.controlnet, undefined);
      assert.deepEqual(errors, []);
      await page.close();
    });

    await test('pose from a photo -> editor -> the rendered OpenPose map is sent with the SDXL request', async () => {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const { errors, bodies, poseRequests } = await open(page, srv.base);
      await chooseModel(page, 'sdxl-base');
      await panel(page).locator('[data-cn-field="on"]').check();
      const chooser = page.waitForEvent('filechooser');
      await panel(page).locator('[data-cn-action="photo"]').click();
      await (await chooser).setFiles({ name: 'photo.png', mimeType: 'image/png', buffer: makePng(400, 600) });
      await page.locator('[data-cn-editor]').waitFor();
      assert.equal(poseRequests.length, 1);
      assert.match(poseRequests[0].image, /^data:image\/png;base64,/);
      if (process.env.DEX_CN_SHOT) await page.screenshot({ path: process.env.DEX_CN_SHOT + '-editor.png' });
      await page.locator('[data-cn-editor] [data-cn-action="use"]').click();
      await page.locator('[data-cn-editor]').waitFor({ state: 'detached' });
      await panel(page).locator('[data-cn-field="preview"]').waitFor();
      await panel(page).locator('[data-cn-field="strength"]').fill('1.2'); await page.keyboard.press('Tab');
      if (process.env.DEX_CN_SHOT) { await page.waitForTimeout(300); await panel(page).scrollIntoViewIfNeeded(); await page.screenshot({ path: process.env.DEX_CN_SHOT + '-panel.png' }); }
      const body = await generateOnce(page, bodies);
      assert.equal(body.target, 'sdxl-base');
      assert.equal(body.controlnet.model, 'openpose-sdxl');
      assert.equal(body.controlnet.strength, 1.2);
      assert.match(body.controlnet.image, /^data:image\/png;base64,/);
      const dims = await page.evaluate(async src => { const i = new Image(); i.src = src; await i.decode(); const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const x = c.getContext('2d'); x.drawImage(i, 0, 0); const d = x.getImageData(0, 0, i.width, i.height).data; let lit = 0; for (let k = 0; k < d.length; k += 4) if (d[k] + d[k + 1] + d[k + 2] > 60) lit++; return { w: i.width, h: i.height, lit }; }, body.controlnet.image);
      assert.equal(dims.w, body.width); assert.equal(dims.h, body.height);
      assert.ok(dims.lit > 500, 'the pose map has a drawn skeleton, not a blank image');
      assert.deepEqual(errors, []);
      await page.close();
    });

    await test('SD 1.5 gets the SD 1.5 ControlNet; Hires turns ControlNet off; a missing pose is refused by the real server', async () => {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const { errors, bodies } = await open(page, srv.base, { serverValidates: true });
      await chooseModel(page, 'sd15');
      await panel(page).locator('[data-cn-field="on"]').check();
      await panel(page).locator('[data-cn-action="draw"]').click();
      await page.locator('[data-cn-editor] [data-cn-action="use"]').click();
      await panel(page).locator('[data-cn-field="preview"]').waitFor();
      let body = await generateOnce(page, bodies);
      assert.equal(body.controlnet.model, 'openpose-sd15');
      await panel(page).locator('[data-cn-action="clear"]').click();
      body = await generateOnce(page, bodies);
      assert.deepEqual(body.controlnet, { model: 'openpose-sd15' });
      await page.getByText(/Add a pose for ControlNet, or turn ControlNet off/).first().waitFor({ timeout: 8000 });
      await page.locator('label', { hasText: 'High-Res Refine' }).locator('input[type="checkbox"]').check();
      await page.waitForFunction(() => document.querySelector('[data-controlnet-panel] [data-cn-field="on"]')?.disabled === true, null, { timeout: 5000 });
      body = await generateOnce(page, bodies);
      assert.equal(body.controlnet, undefined, 'Hires on: ControlNet is not sent');
      assert.deepEqual(errors, []);
      await page.close();
    });
  } finally {
    await runCleanups();
  }
  process.exitCode = exitCode(results.some(r => r[0] !== 'PASS'));
})().catch(async e => { console.error(e); await runCleanups(); process.exitCode = 2; });
