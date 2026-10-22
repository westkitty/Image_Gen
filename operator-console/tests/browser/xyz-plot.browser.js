'use strict';
// P10: X/Y/Z plot in the Batch / Sweep workspace — axis controls, plan check, request shape, plus the real server
// validators over HTTP. No image is generated (queue creation is intercepted).
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { startServer, installModelSnapshots, installImageFixtures, runner, launchBrowser, runCleanups, openStudio } = require('./helpers');

const FX = { 'fx-landscape.png': { w: 800, h: 500, meta: { operation: 'txt2img', target: 'sd15', seed: 1, steps: 20, cfg: 7, sampler: 'euler_a', scheduler: 'discrete', vae: 'auto', loras: [], gen_schema: 1, prompt_saved: false } } };
const { test, results, exitCode } = runner('xyz-plot');

async function newPage(browser, base) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [], plans = [], starts = [];
  page.on('pageerror', e => errors.push(String(e)));
  await installModelSnapshots(page, base);
  await installImageFixtures(page, FX);
  await page.route('**/api/extra-networks**', r => r.fulfill({ json: { loras: [], vaes: [], embeddings: { count: 0, items: [] } } }));
  await page.route('**/api/models/secondary/activate', r => r.fulfill({ json: { ok: true, activeSecondaryModel: 'sd15', modelState: {} } }));
  await page.route('**/api/xyz/plan', r => { plans.push(r.request().postDataJSON()); r.continue(); });
  await page.route('**/api/xyz', r => { starts.push(r.request().postDataJSON()); r.fulfill({ status: 400, json: { error: 'intercepted by test' } }); });
  await openStudio(page, base + '/dexdiffusion/');
  await page.waitForFunction(() => window.__dex && __dex.state.modelTargets && __dex.state.modelTargets.length > 3 && __dex.state.capabilityData);
  await page.evaluate(() => { __dex.setState({ prompt: 'a red cat on a sofa', target: 'sd15' }); __dex.setScreen('batch'); });
  await page.waitForSelector('[data-xyz-panel]');
  return { page, ctx, errors, plans, starts };
}
const f = (page, k) => page.locator('[data-xyz-field="' + k + '"]');

(async () => {
  const srv = process.env.DEX_TEST_BASE ? { base: process.env.DEX_TEST_BASE, stop() {} } : await startServer();
  const browser = await launchBrowser(chromium);
  try {
    await test('defaults: X steps, Y CFG; Check plot asks the real server and lists the cells', async () => {
      const { page, ctx, errors, plans } = await newPage(browser, srv.base);
      await page.click('[data-xyz-panel] button:has-text("Check plot")');
      await page.waitForSelector('[data-xyz-field="plan"]');
      assert.match(await f(page, 'plan').innerText(), /4 cells · 2 × 2 × 1/);
      assert.match(await f(page, 'plan').innerText(), /1\. Steps: 10 · CFG scale: 5/);
      assert.equal(plans.length, 1);
      assert.deepEqual([plans[0].x, plans[0].y, plans[0].z], [{ type: 'steps', values: '10, 20' }, { type: 'cfg_scale', values: '5, 7' }, { type: 'none', values: '' }]);
      assert.equal(plans[0].settings.prompt, 'a red cat on a sofa');
      assert.deepEqual(errors, []);
      await ctx.close();
    });
    await test('editing values and a Z prompt S/R axis is sent; a missing search term is refused with the reason', async () => {
      const { page, ctx, starts } = await newPage(browser, srv.base);
      await f(page, 'x-values').fill('5-7'); await page.keyboard.press('Tab');
      await f(page, 'y-type').selectOption('none');
      await f(page, 'z-type').selectOption('prompt_sr');
      await f(page, 'z-values').fill('dog, cat'); await page.keyboard.press('Tab');
      await page.click('[data-xyz-panel] button:has-text("Start plot")');
      await page.waitForSelector('[data-xyz-field="error"]');
      assert.match(await f(page, 'error').innerText(), /"dog" was not found/);
      assert.equal(starts.length, 0, 'nothing was started');
      await f(page, 'z-values').fill('cat, tiger'); await page.keyboard.press('Tab');
      await page.click('[data-xyz-panel] button:has-text("Start plot")');
      for (let i = 0; i < 30 && !starts.length; i++) await page.waitForTimeout(100);
      assert.equal(starts.length, 1);
      assert.deepEqual(starts[0].z, { type: 'prompt_sr', values: 'cat, tiger' });
      assert.deepEqual(starts[0].x, { type: 'steps', values: '5-7' });
      await ctx.close();
    });
    await test('server: axis gating, bounds and per-cell validation over HTTP', async () => {
      const post = async (url, body) => { const r = await fetch(srv.base + url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { s: r.status, j: await r.json() }; };
      const st = { target: 'sd15', prompt: 'a red cat', steps: 20, width: 512, height: 512, seed: 7, quantity: 1 };
      const ok = await post('/api/xyz/plan', { settings: st, x: { type: 'steps', values: '10,20' }, y: { type: 'sampler', values: 'euler_a, dpmpp2m' } });
      assert.equal(ok.s, 200, JSON.stringify(ok.j)); assert.equal(ok.j.total, 4); assert.equal(ok.j.fixedSeed, 7);
      const flux = await post('/api/xyz/plan', { settings: { ...st, target: 'flux2-klein-4b' }, x: { type: 'cfg_scale', values: '5,6' } });
      assert.equal(flux.s, 400); assert.match(flux.j.error, /every cell would be identical/);
      const big = await post('/api/xyz/plan', { settings: st, x: { type: 'seed', values: '1-70' } });
      assert.equal(big.s, 400); assert.match(big.j.error, /limit is 64/);
      const badCell = await post('/api/xyz/plan', { settings: st, x: { type: 'width', values: '512, 8000' } });
      assert.equal(badCell.s, 400);
      const noPrompt = await post('/api/xyz/plan', { settings: { ...st, prompt: '' }, x: { type: 'steps', values: '5' } });
      assert.equal(noPrompt.s, 400); assert.match(noPrompt.j.error, /Enter a prompt/);
      const rnd = await post('/api/xyz/plan', { settings: { ...st, seed: -1 }, x: { type: 'steps', values: '5,6' } });
      assert.ok(Number.isInteger(rnd.j.fixedSeed) && rnd.j.fixedSeed >= 0, 'a random base seed is fixed once');
      const kept = await post('/api/xyz/plan', { settings: { ...st, seed: -1 }, x: { type: 'steps', values: '5,6' }, keep_random_seed: true });
      assert.equal(kept.j.fixedSeed, null);
      const nogrid = await post('/api/xyz/does-not-exist/grid', {});
      assert.equal(nogrid.s, 404);
    });
  } finally {
    await browser.close(); srv.stop && srv.stop();
    await runCleanups();
  }
  process.exitCode = exitCode(results.some(r => r[0] !== 'PASS'));
})().catch(async e => { console.error(e); await runCleanups(); process.exitCode = 2; });
