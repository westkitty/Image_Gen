'use strict';
// P09: A1111 Extras in the Enhance workbench — scale by/to, crop, upscaler 1/2 + visibility, honest face-restoration
// note — through the real UI, plus the server validator over HTTP. No image is processed.
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { startServer, installModelSnapshots, installImageFixtures, runner, launchBrowser, runCleanups } = require('./helpers');

const FX = { 'fx-landscape.png': { w: 800, h: 500, meta: { operation: 'txt2img', target: 'sd15', seed: 1, steps: 20, cfg: 7, sampler: 'euler_a', scheduler: 'discrete', vae: 'auto', loras: [], gen_schema: 1, prompt_saved: false } } };
const { test, results, exitCode } = runner('extras');

async function newPage(browser, base) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [], posts = [];
  page.on('pageerror', e => errors.push(String(e)));
  await installModelSnapshots(page, base);
  await installImageFixtures(page, FX);
  await page.route('**/api/extra-networks**', r => r.fulfill({ json: { loras: [], vaes: [], embeddings: { count: 0, items: [] } } }));
  await page.route('**/api/actions/upscale', r => { posts.push(r.request().postDataJSON()); r.fulfill({ status: 400, json: { error: 'intercepted by test', gate: 'test' } }); });
  await page.goto(base + '/dexdiffusion/');
  await page.waitForFunction(() => window.__dex && __dex.state.modelTargets && __dex.state.modelTargets.length > 3 && __dex.state.capabilityData);
  await page.evaluate(() => __dex.sendToEnhance('fx-landscape.png'));
  await page.waitForSelector('[data-extras-card]');
  return { page, ctx, errors, posts };
}
const previewMatches = (page, re) => page.waitForFunction(src => new RegExp(src).test(document.querySelector('[data-extras-field="preview"]').innerText), re.source, { timeout: 5000 });
const field = (page, k) => page.locator('[data-extras-field="' + k + '"]');

(async () => {
  const srv = process.env.DEX_TEST_BASE ? { base: process.env.DEX_TEST_BASE, stop() {} } : await startServer();
  const browser = await launchBrowser(chromium);
  try {
    await test('default plan is shown and Run sends exactly the extras object', async () => {
      const { page, ctx, errors, posts } = await newPage(browser, srv.base);
      await previewMatches(page, /800×500 → 1600×1000/);
      await page.click('[data-extras-card] button:has-text("Run Extras")');
      for (let i = 0; i < 30 && !posts.length; i++) await page.waitForTimeout(100);
      assert.equal(posts.length, 1);
      assert.equal(posts[0].image_id, 'fx-landscape.png');
      assert.deepEqual(posts[0].extras, { mode: 'by', scale: 2, width: 1024, height: 1024, crop: true, upscaler: 'lanczos', upscaler2: 'none', visibility: 0.5, max_side: 0 });
      assert.deepEqual(errors, []);
      await ctx.close();
    });
    await test('scale-to with crop, second upscaler and visibility drive the preview and request', async () => {
      const { page, ctx, posts } = await newPage(browser, srv.base);
      await field(page, 'mode').selectOption('to');
      await field(page, 'width').fill('1024'); await field(page, 'height').fill('1024'); await page.keyboard.press('Tab');
      await previewMatches(page, /800×500 → 1024×1024/);
      await field(page, 'crop').uncheck();
      await previewMatches(page, /→ 1632×1024/);   // A1111 upscaler.py: int((800*2.048)//8*8) = 1632
      await field(page, 'upscaler2').selectOption('nearest');
      await field(page, 'visibility').fill('0.25'); await page.keyboard.press('Tab');
      await page.click('[data-extras-card] button:has-text("Run Extras")');
      for (let i = 0; i < 30 && !posts.length; i++) await page.waitForTimeout(100);
      assert.deepEqual(posts[0].extras, { mode: 'to', scale: 2, width: 1024, height: 1024, crop: false, upscaler: 'lanczos', upscaler2: 'nearest', visibility: 0.25, max_side: 0 });
      await ctx.close();
    });
    await test('invalid input blocks Run with the reason; face restoration is stated unavailable', async () => {
      const { page, ctx, posts } = await newPage(browser, srv.base);
      await field(page, 'scale').fill('20'); await page.keyboard.press('Tab');
      await previewMatches(page, /scale must be between 1 and 8/);
      await page.click('[data-extras-card] button:has-text("Run Extras")');
      await page.waitForTimeout(400);
      assert.equal(posts.length, 0, 'nothing sent');
      assert.match(await field(page, 'face-note').innerText(), /GFPGAN.*not available/s);
      await ctx.close();
    });
    await test('server: validation errors over HTTP (no job created)', async () => {
      const post = async body => { const r = await fetch(srv.base + '/api/actions/upscale', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { s: r.status, j: await r.json() }; };
      const bad = await post({ image_id: 'does-not-exist.png', extras: { gfpgan: 0.7 } });
      assert.ok(bad.s === 400 || bad.s === 404, String(bad.s));
      const face = await post({ path: '20260101-000000-x/a.png', extras: { codeformer: 1 } });
      assert.equal(face.s, 400); assert.match(face.j.error, /not available/);
      const unk = await post({ path: '20260101-000000-x/a.png', extras: { sharpen: 3 } });
      assert.equal(unk.s, 400); assert.match(unk.j.error, /Unexpected extras field/);
    });
  } finally {
    await browser.close(); srv.stop && srv.stop();
    await runCleanups();
  }
  process.exitCode = exitCode(results.some(r => r[0] !== 'PASS'));
})().catch(async e => { console.error(e); await runCleanups(); process.exitCode = 2; });
