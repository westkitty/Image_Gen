'use strict';
// P14: FLUX.2 reference edit card (Enhance) and the real /api/actions/flux2-edit validators. No image is generated.
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { startServer, installModelSnapshots, installImageFixtures, runner, launchBrowser, runCleanups } = require('./helpers');

const FX = { 'fx-landscape.png': { w: 800, h: 500, meta: { operation: 'txt2img', target: 'sd15', seed: 1, steps: 20, cfg: 7, sampler: 'euler_a', scheduler: 'discrete', vae: 'auto', loras: [], gen_schema: 1, prompt_saved: false } } };
const { test, results, exitCode } = runner('ref-edit');

async function newPage(browser, base) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [], posts = [];
  page.on('pageerror', e => errors.push(String(e)));
  await installModelSnapshots(page, base);
  await installImageFixtures(page, FX);
  await page.route('**/api/extra-networks**', r => r.fulfill({ json: { loras: [], vaes: [], embeddings: { count: 0, items: [] } } }));
  await page.route('**/api/actions/flux2-edit', r => { posts.push(r.request().postDataJSON()); r.fulfill({ status: 400, json: { error: 'intercepted by test' } }); });
  await page.goto(base + '/dexdiffusion/');
  await page.waitForFunction(() => window.__dex && __dex.state.modelTargets && __dex.state.modelTargets.length > 3 && __dex.state.capabilityData);
  await page.evaluate(() => __dex.sendToEnhance('fx-landscape.png'));
  await page.waitForSelector('[data-refedit-card]');
  return { page, ctx, errors, posts };
}
const previewHas = (page, re) => page.waitForFunction(src => new RegExp(src).test(document.querySelector('[data-refedit-field="preview"]').innerText), re.source, { timeout: 5000 });
const f = (page, k) => page.locator('[data-refedit-field="' + k + '"]');

(async () => {
  const srv = process.env.DEX_TEST_BASE ? { base: process.env.DEX_TEST_BASE, stop() {} } : await startServer();
  const browser = await launchBrowser(chromium);
  try {
    await test('the card shows the output size, blocks Run until a prompt and valid steps exist, then sends exactly the request', async () => {
      const { page, ctx, errors, posts } = await newPage(browser, srv.base);
      assert.match(await f(page, 'preview').innerText(), /800×500 → 800×496.*describe the edit/);
      await page.click('[data-refedit-card] button:has-text("Run reference edit")');
      await page.waitForTimeout(300);
      assert.equal(posts.length, 0, 'nothing sent without a prompt');
      await f(page, 'prompt').fill('the same scene at night'); await page.keyboard.press('Tab');
      await f(page, 'steps').fill('9'); await page.keyboard.press('Tab');
      await previewHas(page, /steps must be 1–8/);
      await f(page, 'steps').fill('6'); await f(page, 'seed').fill('77'); await page.keyboard.press('Tab');
      await page.click('[data-refedit-card] button:has-text("Run reference edit")');
      for (let i = 0; i < 30 && !posts.length; i++) await page.waitForTimeout(100);
      assert.equal(posts.length, 1);
      assert.deepEqual(posts[0], { image_id: 'fx-landscape.png', prompt: 'the same scene at night', steps: 6, seed: 77, save_prompts: false });
      assert.match(await page.locator('[data-refedit-card]').innerText(), /not ControlNet/);
      assert.deepEqual(errors, []);
      await ctx.close();
    });
    await test('server: validators refuse bad requests with the gate named, before any job exists', async () => {
      const lib = await (await fetch(srv.base + '/api/library/images?filter=all')).json();
      const pick = lib.items.find(it => /\.png$/i.test(it.id));
      assert.ok(pick, 'the library has an image');
      const post = async body => { const r = await fetch(srv.base + '/api/actions/flux2-edit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { s: r.status, j: await r.json() }; };
      const ok = { image_id: pick.id, prompt: 'a calm edit' };
      assert.equal((await post({ prompt: 'x' })).j.gate, 'source');
      assert.equal((await post({ image_id: 'does-not-exist.png', prompt: 'x' })).s, 404);
      assert.equal((await post({ image_id: pick.id, prompt: '   ' })).j.gate, 'prompt');
      assert.match((await post({ ...ok, prompt: 'a cat <lora:x:0.8>' })).j.error, /not supported by the FLUX\.2/);
      assert.equal((await post({ ...ok, steps: 9 })).j.gate, 'steps');
      assert.equal((await post({ ...ok, steps: 2.5 })).j.gate, 'steps');
      assert.equal((await post({ ...ok, seed: 'abc' })).j.gate, 'seed');
      assert.equal((await post({ ...ok, width: 500, height: 512 })).j.gate, 'width');
      assert.equal((await post({ ...ok, width: 512, height: 4096 })).j.gate, 'height');
    });
  } finally {
    await browser.close(); srv.stop && srv.stop();
    await runCleanups();
  }
  process.exitCode = exitCode(results.some(r => r[0] !== 'PASS'));
})().catch(async e => { console.error(e); await runCleanups(); process.exitCode = 2; });
