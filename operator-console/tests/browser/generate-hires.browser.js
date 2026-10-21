'use strict';
// P06: High-Res Refine controls — scale or resize-to second pass, the full sd-cli upscaler list, the honest
// "not available" note, truthful per-target visibility, and the real server validator. No inference runs.
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { startServer, installModelSnapshots, runner, launchBrowser, runCleanups } = require('./helpers');

const { test, results, exitCode } = runner('generate-hires');
const ENDPOINT = '**/api/actions/generate-controlled';
const UPSCALERS = ['Latent', 'Latent (nearest)', 'Latent (nearest-exact)', 'Latent (antialiased)', 'Latent (bicubic)', 'Latent (bicubic antialiased)', 'Lanczos', 'Nearest'];

async function open(page, base) {
  const errors = [], bodies = [];
  page.on('pageerror', e => errors.push(String(e)));
  await installModelSnapshots(page, base);
  await page.route('**/api/models/secondary/activate', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ modelState: {} }) }));
  await page.route(ENDPOINT, route => { bodies.push(JSON.parse(route.request().postData() || '{}')); route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'intercepted by test' }) }); });
  await page.goto(base + '/dexdiffusion/?debug=1', { waitUntil: 'domcontentloaded' });
  if (!(await page.locator('.ca-shell').count())) await page.locator('[data-vbtn="4"]').click();
  await page.waitForSelector('.ca-shell');
  await page.locator('.ca-nav-item', { hasText: 'Create' }).click();
  await page.waitForSelector('.ca-shell[data-ca-module="generate"]');
  return { errors, bodies };
}
async function chooseTarget(page, id) {
  const select = page.locator('select', { has: page.locator(`option[value="${id}"]`) }).first();
  await select.waitFor({ state: 'visible' });
  await select.selectOption(id);
  await page.waitForTimeout(500);
}
async function generateOnce(page, bodies) {
  const before = bodies.length;
  await page.locator('.ca-generate-form textarea').first().fill('a red fox in snow');
  await page.locator('.ca-generate-form .ca-primary').click();
  for (let i = 0; i < 40 && bodies.length === before; i++) await page.waitForTimeout(100);
  assert.equal(bodies.length, before + 1, 'exactly one generation request was sent');
  return bodies[bodies.length - 1];
}
const enable = page => page.locator('label', { hasText: 'High-Res Refine' }).locator('input[type="checkbox"]').check();

(async () => {
  const srv = process.env.DEX_TEST_BASE ? { base: process.env.DEX_TEST_BASE, stop() {} } : await startServer();
  const browser = await launchBrowser(chromium);
  try {
    await test('OP-4A independent second pass: sends exactly the chosen second-pass fields to hires-2pass; blanks inherit; exclusive with in-engine hires', async () => {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const { errors } = await open(page, srv.base);
      const sent = [];
      await page.route('**/api/actions/hires-2pass', route => { sent.push(JSON.parse(route.request().postData() || '{}')); route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'intercepted by test' }) }); });
      await chooseTarget(page, 'sd15');
      const f = k => page.locator('[data-second-pass] [data-second-field="' + k + '"]');
      await f('on').check();
      await f('prompt').fill('a detailed red fox'); await page.keyboard.press('Tab');
      const availableSecondTargets = await f('target').locator('option').evaluateAll(nodes => nodes.map(n => n.value).filter(Boolean));
      assert.ok(availableSecondTargets.includes('sdxl-base'), 'requested checkpoint absent; available: ' + JSON.stringify(availableSecondTargets));
      await f('target').selectOption('sdxl-base');
      await f('sampler').selectOption('heun');
      await f('denoise').fill('0.35'); await page.keyboard.press('Tab');
      await page.locator('.ca-generate-form textarea').first().fill('a red fox in snow');
      await page.locator('.ca-generate-form .ca-primary').click();
      for (let i = 0; i < 40 && !sent.length; i++) await page.waitForTimeout(100);
      assert.equal(sent.length, 1, 'one hires-2pass request');
      assert.deepEqual(sent[0].second_pass, { prompt: 'a detailed red fox', target: 'sdxl-base', sampler: 'heun', denoise: 0.35 }, 'only explicitly chosen fields; the rest inherit server-side');
      assert.equal(sent[0].target, 'sd15'); assert.equal(sent[0].prompt, 'a red fox in snow');
      assert.ok(!Object.keys(sent[0]).some(k => /^hires_/.test(k)) && !('quantity' in sent[0]));
      await enable(page);
      await page.waitForSelector('[data-second-pass] [data-second-field="on"]:disabled', { timeout: 3000 });
      assert.equal(await f('on').isDisabled(), true, 'cannot combine with in-engine High-Res Refine');
      assert.equal(await f('prompt').count(), 0, 'second-pass fields hidden while High-Res Refine is on');
      assert.deepEqual(errors, []);
      await page.close();
    });
    await test('scale mode: panel, final-size preview, request carries scale and the chosen upscaler', async () => {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const { errors, bodies } = await open(page, srv.base);
      await chooseTarget(page, 'sdxl-base');
      assert.equal(await page.locator('[data-dex-field="hires-panel"]').count(), 0, 'closed until enabled');
      await enable(page);
      await page.locator('[data-dex-field="hires-panel"]').waitFor({ state: 'visible' });
      assert.deepEqual(await page.locator('[data-dex-field="hires-upscaler"] option').evaluateAll(o => o.map(x => x.value)), UPSCALERS);
      assert.match(await page.locator('[data-dex-field="hires-unavailable"]').innerText(), /reuses the first-pass prompt, sampler, scheduler and checkpoint\. For separate second-pass settings use “Independent second pass”/);
      await page.locator('[data-dex-field="hires-scale"]').fill('1.5');
      await page.keyboard.press('Tab');
      await page.locator('[data-dex-field="hires-upscaler"]').selectOption('Latent (bicubic)');
      await page.waitForTimeout(250);
      const final = await page.locator('[data-dex-field="hires-final"]').innerText();
      const m = /→ (\d+)×(\d+)/.exec(final); assert.ok(m, final);
      const body = await generateOnce(page, bodies);
      assert.equal(body.hires_scale, 1.5);
      assert.equal(body.hires_upscaler, 'Latent (bicubic)');
      for (const k of ['hires_width', 'hires_height']) assert.equal(k in body, false, k);
      assert.equal(Math.round(body.width * 1.5 / 8) * 8, Number(m[1]), 'preview equals what the server will compute');
      assert.deepEqual(errors, []);
      await page.close();
    });

    await test('resize-to mode sends width and height (no scale) and the preview shows them', async () => {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const { errors, bodies } = await open(page, srv.base);
      await chooseTarget(page, 'sdxl-base');
      await enable(page);
      await page.locator('[data-dex-field="hires-mode"]').selectOption('size');
      await page.locator('[data-dex-field="hires-width"]').fill('1280');
      await page.locator('[data-dex-field="hires-height"]').fill('1152');
      await page.keyboard.press('Tab');
      await page.waitForTimeout(250);
      assert.match(await page.locator('[data-dex-field="hires-final"]').innerText(), /→ 1280×1152/);
      const body = await generateOnce(page, bodies);
      assert.equal(body.hires_width, 1280); assert.equal(body.hires_height, 1152);
      assert.equal('hires_scale' in body, false);
      assert.deepEqual(errors, []);
      await page.close();
    });

    await test('MFLUX target and a disabled High-Res checkbox send no hires fields', async () => {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const { errors, bodies } = await open(page, srv.base);
      await chooseTarget(page, 'sdxl-base');
      const plain = await generateOnce(page, bodies);
      assert.equal(Object.keys(plain).some(k => k.startsWith('hires')), false);
      await chooseTarget(page, 'flux2-klein-4b');
      assert.equal(await page.locator('label', { hasText: 'High-Res Refine' }).count(), 0, 'no hires control for MFLUX');
      const sent = await generateOnce(page, bodies);
      assert.equal(Object.keys(sent).some(k => k.startsWith('hires')), false);
      assert.deepEqual(errors, []);
      await page.close();
    });

    await test('real server validator: accepts both modes and all upscalers, rejects every bad combination', async () => {
      const post = async body => {
        const r = await fetch(srv.base + '/api/preview/generation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ job_type: 'txt2img', target: 'sdxl-base', prompt: 'a fox', width: 1024, height: 1024, steps: 10 }, body)) });
        return { status: r.status, data: await r.json() };
      };
      let r = await post({ hires_scale: 1.5, hires_steps: 6, hires_denoise: 0.4, hires_upscaler: 'Latent (nearest-exact)' });
      assert.equal(r.status, 200, JSON.stringify(r.data));
      let argv = r.data.preview.argv;
      assert.equal(argv[argv.indexOf('--hires-scale') + 1], '1.5'); assert.equal(argv[argv.indexOf('--hires-upscaler') + 1], 'Latent (nearest-exact)');
      r = await post({ hires_width: 1280, hires_height: 1536, hires_steps: 6 });
      assert.equal(r.status, 200, JSON.stringify(r.data));
      argv = r.data.preview.argv;
      assert.equal(argv[argv.indexOf('--hires-width') + 1], '1280'); assert.equal(argv.includes('--hires-scale'), false);
      for (const u of UPSCALERS) assert.equal((await post({ hires_scale: 1.2, hires_upscaler: u })).status, 200, u);
      assert.match((await post({ hires_scale: 1.5, hires_width: 1280, hires_height: 1280 })).data.error, /not both/);
      assert.match((await post({ hires_width: 1280 })).data.error, /together/);
      assert.match((await post({ hires_width: 1285, hires_height: 1280 })).data.error, /multiple of 8/);
      assert.match((await post({ hires_width: 512, hires_height: 1280 })).data.error, /at least the base size/);
      assert.match((await post({ hires_width: 2304, hires_height: 2304 })).data.error, /between 64 and 2048/);
      assert.equal((await post({ hires_scale: 2 })).status, 200, '1024 x 2.0 = 2048 is exactly the cap');
      assert.match((await post({ width: 1536, height: 1536, hires_scale: 1.5 })).data.error, /exceed 2048/);
      assert.match((await post({ hires_scale: 1.5, hires_upscaler: 'RealESRGAN' })).data.error, /hires_upscaler must be one of/);
      assert.match((await post({ target: 'flux2-klein-4b', steps: 4, hires_scale: 1.5 })).data.error, /MFLUX targets do not support/);
    });
  } finally {
    await runCleanups();
  }
  process.exitCode = exitCode(results.some(r => r[0] !== 'PASS'));
})().catch(async e => { console.error(e); await runCleanups(); process.exitCode = 2; });
