'use strict';
// Stock A1111 scripts in the Edit workbench (SD upscale, Loopback, Poor man's / mk2 outpainting): the Script dropdown
// reroutes Run to /api/scripts/<kind> with the exact options; the real server's dry-run validators answer the pass count and
// result size and refuse what the engine cannot do. Run POSTs are intercepted — no inference runs in this suite.
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { startServer, installModelSnapshots, installImageFixtures, runner, launchBrowser, runCleanups } = require('./helpers');

const FX = { 'fx-square.png': { w: 512, h: 512, meta: { operation: 'txt2img', target: 'sdxl-photonic', seed: 1, steps: 20, cfg: 7, sampler: 'euler_a', scheduler: 'discrete', vae: 'auto', loras: [], gen_schema: 1, prompt_saved: false } } };
const { test, results, exitCode } = runner('edit-scripts');

async function newPage(browser, base) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [], posts = [];
  page.on('pageerror', e => errors.push(String(e)));
  await installModelSnapshots(page, base);
  await installImageFixtures(page, FX);
  await page.route('**/api/extra-networks**', r => r.fulfill({ json: { loras: [], vaes: [], embeddings: { count: 0, items: [] } } }));
  await page.route('**/api/models/secondary/activate', r => r.fulfill({ json: { ok: true, activeSecondaryModel: 'sd15', modelState: {} } }));
  await page.route('**/api/scripts/**', r => {
    const body = r.request().postDataJSON(), kind = new URL(r.request().url()).pathname.split('/').pop();
    posts.push({ kind, body });
    if (body.dry_run) return r.fulfill({ json: { ok: true, kind, passes: 3, result_size: '640x512' } });
    return r.fulfill({ status: 400, json: { error: 'intercepted by test', gate: 'test' } });
  });
  await page.goto(base + '/dexdiffusion/');
  await page.waitForFunction(() => window.__dex && __dex.state.modelTargets && __dex.state.modelTargets.length > 3 && __dex.state.capabilityData);
  return { page, ctx, errors, posts };
}
async function openEdit(page, op) {
  assert.ok(await page.evaluate(o => __dex.openImageInEdit('fx-square.png', o), op));
  await page.waitForFunction(o => __dex.ed && !__dex.ed.loading && __dex.ed.op === o && document.querySelector('[data-edit-scripts]'), op);
}
const f = (page, k) => page.locator('[data-edit-scripts] [data-script-field="' + k + '"]');
async function runAndCapture(page, posts) {
  const before = posts.length;
  await page.click('[data-edit-prompt]'); await page.fill('[data-edit-prompt]', 'a test prompt'); await page.click('[data-run-edit]');
  for (let i = 0; i < 50 && posts.length === before; i++) await page.waitForTimeout(100);
  assert.equal(posts.length, before + 1, 'one script request was sent');
  return posts[posts.length - 1];
}

(async () => {
  const srv = process.env.DEX_TEST_BASE ? { base: process.env.DEX_TEST_BASE, stop() {} } : await startServer();
  const browser = await launchBrowser(chromium);
  try {
    await test('img2img + SD upscale: Run sends /api/scripts/sd-upscale with the tile options, strength and prompt (no resize fields)', async () => {
      const { page, ctx, errors, posts } = await newPage(browser, srv.base);
      await openEdit(page, 'img2img');
      assert.deepEqual(await f(page, 'kind').locator('option').allTextContents(), ['None', 'SD upscale', 'Loopback']);
      await f(page, 'kind').selectOption('sd-upscale');
      await f(page, 'scale').fill('1.5'); await page.keyboard.press('Tab');
      await f(page, 'upscaler').selectOption('nearest');
      await page.click('[data-script-preview]');
      await page.waitForSelector('[data-script-plan]');
      assert.match(await page.locator('[data-script-plan]').innerText(), /3 pass\(es\) → 640x512/);
      assert.equal(posts[0].body.dry_run, true);
      const { kind, body } = await runAndCapture(page, posts);
      assert.equal(kind, 'sd-upscale');
      assert.deepEqual(body.script, { scale: 1.5, overlap: 64, tile_width: 512, tile_height: 512, upscaler: 'nearest' });
      assert.equal(body.image_id, 'fx-square.png'); assert.equal(body.prompt, 'a test prompt'); assert.equal(typeof body.strength, 'number');
      for (const k of ['resize_mode', 'resize_by', 'source_prep', 'exact_steps', 'dry_run']) assert.equal(k in body, false, k);
      assert.deepEqual(errors, []);
      await ctx.close();
    });
    await test('img2img + Loopback: loops, final strength and curve are sent', async () => {
      const { page, ctx, posts } = await newPage(browser, srv.base);
      await openEdit(page, 'img2img');
      await f(page, 'kind').selectOption('loopback');
      await f(page, 'loops').fill('3'); await page.keyboard.press('Tab');
      await f(page, 'final_strength').fill('0.25'); await page.keyboard.press('Tab');
      await f(page, 'curve').selectOption('Lazy');
      const { kind, body } = await runAndCapture(page, posts);
      assert.equal(kind, 'loopback'); assert.deepEqual(body.script, { loops: 3, final_strength: 0.25, curve: 'Lazy' }, JSON.stringify(body.script));
      // SC-25: the script choice and its options survive a reload (per-browser settings; no prompt text is stored).
      await page.reload(); await page.waitForFunction(() => window.__dex && __dex.state.capabilityData);
      await openEdit(page, 'img2img');
      assert.equal(await f(page, 'kind').inputValue(), 'loopback');
      assert.equal(await f(page, 'loops').inputValue(), '3'); assert.equal(await f(page, 'curve').inputValue(), 'Lazy');
      assert.ok(!/test prompt/.test(await page.evaluate(() => localStorage.getItem('dex_edit_scripts'))));
      await ctx.close();
    });
    await test('outpaint + mk2: directions, fall-off and colour variation are sent; latent masked-content modes are not offered', async () => {
      const { page, ctx, posts } = await newPage(browser, srv.base);
      await openEdit(page, 'outpaint');
      assert.deepEqual(await f(page, 'kind').locator('option').allTextContents(), ['None', "Poor man's outpainting", 'Outpainting mk2']);
      await f(page, 'kind').selectOption('outpaint-poor');
      await f(page, 'masked_content').waitFor();
      assert.deepEqual(await f(page, 'masked_content').locator('option').allTextContents(), ['fill', 'original']);
      await f(page, 'kind').selectOption('outpaint-mk2');
      for (const d of ['up', 'down']) await page.locator('[data-edit-scripts] [data-script-field="directions"] label', { hasText: d }).locator('input').uncheck();
      await f(page, 'noise_q').fill('0.5'); await page.keyboard.press('Tab');
      const { kind, body } = await runAndCapture(page, posts);
      assert.equal(kind, 'outpaint-mk2');
      assert.deepEqual(body.script.directions, ['left', 'right']); assert.equal(body.script.noise_q, 0.5); assert.equal(body.script.pixels, 128);
      for (const k of ['left', 'right', 'top', 'bottom']) assert.equal(k in body, false, 'canvas-extension fields are not mixed in: ' + k);
      await ctx.close();
    });
    await test('Edit names the model the edit worker really runs and offers only that model', async () => {
      const { page, ctx } = await newPage(browser, srv.base);
      await openEdit(page, 'img2img');
      const worker = await page.evaluate(() => __dex.state.capabilityData.editWorkerTarget);
      assert.equal(worker, 'sd15');
      assert.match(await page.locator('[data-edit-worker-model]').innerText(), /run on sd15/);
      assert.deepEqual(await page.evaluate(() => __dex._editTargets().map(t => t.id)), ['sd15']);
      assert.equal(await page.evaluate(() => __dex.ed.state.editModel), 'sd15', 'a Photonic source still edits on sd15, and says so');
      assert.ok(await page.evaluate(() => __dex.ed.state.notes.some(n => /Edit runs on sd15/.test(n))));
      await ctx.close();
    });
    await test('server dry run (real validators, no job): pass counts, result sizes and engine refusals', async () => {
      const lib = await (await fetch(srv.base + '/api/library/images?limit=50')).json().catch(() => ({}));
      const src = (lib.items || []).find(it => it.width === 512 && it.height === 512);
      if (!src) { console.log('  (no 512x512 canonical image in this environment; HTTP checks skipped)'); return; }
      const post = async (kind, body) => { const r = await fetch(srv.base + '/api/scripts/' + kind, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ image_id: src.id, prompt: 'p', steps: 8, dry_run: true }, body)) }); return { status: r.status, data: await r.json() }; };
      const jobsBefore = (await (await fetch(srv.base + '/api/jobs')).json()).jobs.length;
      let r = await post('sd-upscale', { script: { scale: 1.5 } }); assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.passes, 4); assert.equal(r.data.result_size, '768x768');
      r = await post('loopback', { script: { loops: 5 } }); assert.equal(r.data.passes, 5); assert.equal(r.data.result_size, '512x512');
      r = await post('outpaint-poor', { script: { pixels: 128, directions: ['left', 'right'] } }); assert.equal(r.data.passes, 2); assert.equal(r.data.result_size, '768x512');
      r = await post('outpaint-mk2', { script: { pixels: 128, directions: ['right'] } }); assert.equal(r.data.passes, 1); assert.equal(r.data.result_size, '640x512');
      for (const [kind, script, re] of [['loopback', { loops: 0 }, /loops/], ['loopback', { interrogate: 'CLIP' }, /interrogator/], ['sd-upscale', { upscaler: 'realesrgan' }, /not wired/],
        ['outpaint-poor', { masked_content: 'latent noise' }, /latent|not/i], ['sd-upscale', { overlap: 30 }, /overlap/]]) {
        r = await post(kind, { script }); assert.equal(r.status, 400, kind + ' ' + JSON.stringify(script)); assert.match(r.data.error, re);
      }
      assert.equal((await (await fetch(srv.base + '/api/jobs')).json()).jobs.length, jobsBefore, 'dry runs and refusals create no job');
    });
  } finally {
    await runCleanups();
  }
  const failed = results.filter(r => r[0] !== 'PASS');
  console.log(`\n${results.length - failed.length}/${results.length} edit-scripts browser checks passed`);
  process.exitCode = exitCode(failed.length);
})().catch(async e => { console.error(e); await runCleanups(); process.exitCode = 2; });
