'use strict';
// P07: A1111 img2img source geometry in the Edit workbench — resize modes, resize-to/by, transparency colour,
// exact steps — through the real UI, with the server validator exercised over HTTP. No inference runs.
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { makePng, startServer, installModelSnapshots, installImageFixtures, runner, launchBrowser, runCleanups } = require('./helpers');

const FX = { 'fx-landscape.png': { w: 800, h: 500, meta: { operation: 'txt2img', target: 'sd15', seed: 1, steps: 20, cfg: 7, sampler: 'euler_a', scheduler: 'discrete', vae: 'auto', loras: [], gen_schema: 1, prompt_saved: false } } };
const { test, results, exitCode } = runner('edit-img2img-parity');

async function newPage(browser, base) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [], posts = [];
  page.on('pageerror', e => errors.push(String(e)));
  await installModelSnapshots(page, base);
  await installImageFixtures(page, FX);
  await page.route('**/api/extra-networks**', r => r.fulfill({ json: { loras: [], vaes: [], embeddings: { count: 0, items: [] } } }));
  await page.route('**/api/models/secondary/activate', r => r.fulfill({ json: { ok: true, activeSecondaryModel: 'sd15', modelState: {} } }));
  await page.route('**/api/actions/img2img', r => { posts.push(r.request().postDataJSON()); r.fulfill({ status: 400, json: { error: 'intercepted by test', gate: 'test' } }); });
  await page.route('**/api/library/images**', r => r.fulfill({ json: { filter: 'all', total: 1, items: [{ id: 'fx-landscape.png', url: '/api/images/fx-landscape.png', width: 800, height: 500, meta: FX['fx-landscape.png'].meta }] } }));
  await page.goto(base + '/dexdiffusion/');
  await page.waitForFunction(() => window.__dex && __dex.state.modelTargets && __dex.state.modelTargets.length > 3 && __dex.state.capabilityData);
  return { page, ctx, errors, posts };
}
async function openImg2img(page) {
  assert.ok(await page.evaluate(() => __dex.openImageInEdit('fx-landscape.png', 'img2img')));
  await page.waitForFunction(() => __dex.ed && !__dex.ed.loading && __dex.ed.op === 'img2img' && document.querySelector('[data-section="prep"]'));
  await page.evaluate(() => { __dex.ed.openSections.prep = true; __dex.edSet({}); });
  await page.waitForSelector('[data-edit-resize]');
}
const run = async (page, posts) => {
  const before = posts.length;
  await page.click('[data-edit-prompt]'); await page.fill('[data-edit-prompt]', 'a test prompt'); await page.click('[data-run-edit]');
  for (let i = 0; i < 40 && posts.length === before; i++) await page.waitForTimeout(100);
  assert.equal(posts.length, before + 1, 'one img2img request was sent');
  return posts[posts.length - 1];
};
const commit = page => page.keyboard.press('Tab');

(async () => {
  const srv = process.env.DEX_TEST_BASE ? { base: process.env.DEX_TEST_BASE, stop() {} } : await startServer();
  const browser = await launchBrowser(chromium);
  try {
    await test('crop-and-resize to a size: request carries mode, size, colour; legacy quick prep is disabled and not sent', async () => {
      const { page, ctx, errors, posts } = await newPage(browser, srv.base);
      await openImg2img(page);
      assert.equal(await page.locator('[data-edit-field="resize-width"]').count(), 0, 'size fields hidden until a mode is chosen');
      await page.locator('[data-edit-field="resize-mode"]').selectOption('crop');
      await page.locator('[data-edit-field="resize-width"]').fill('512'); await commit(page);
      await page.locator('[data-edit-field="resize-height"]').fill('384'); await commit(page);
      await page.locator('[data-edit-field="resize-bg"]').fill('#00ff00');
      await page.waitForTimeout(200);
      assert.match(await page.locator('[data-edit-field="resize-preview"]').innerText(), /800×500 → 512×384/);
      assert.equal(await page.locator('select[aria-label="Quick source preparation"]').isDisabled(), true);
      const body = await run(page, posts);
      assert.equal(body.resize_mode, 'crop'); assert.equal(body.resize_width, 512); assert.equal(body.resize_height, 384);
      assert.equal(body.background_color, '#00ff00');
      for (const k of ['source_prep', 'resize_by', 'exact_steps']) assert.equal(k in body, false, k);
      assert.deepEqual(errors, []);
      await ctx.close();
    });

    await test('resize-by: preview applies the server rounding; fill mode and exact steps reach the request', async () => {
      const { page, ctx, errors, posts } = await newPage(browser, srv.base);
      await openImg2img(page);
      await page.locator('[data-edit-field="resize-mode"]').selectOption('fill');
      await page.locator('[data-edit-field="resize-kind"]').selectOption('by');
      await page.locator('[data-edit-field="resize-by"]').fill('1.5'); await commit(page);
      await page.waitForTimeout(200);
      assert.match(await page.locator('[data-edit-field="resize-preview"]').innerText(), /800×500 → 1200×744/, '500 × 1.5 = 750 → 744 (multiple of 8)');
      await page.locator('[data-edit-field="exact-steps"]').check();
      await page.waitForFunction(() => /Runs exactly/.test(document.querySelector('[data-edit-field="exact-steps-note"]')?.textContent || ''));
      assert.match(await page.locator('[data-edit-field="exact-steps-note"]').innerText(), /Runs exactly \d+ sampler steps \(sd-cli is asked for \d+/);
      const body = await run(page, posts);
      assert.equal(body.resize_mode, 'fill'); assert.equal(body.resize_by, 1.5); assert.equal(body.exact_steps, true);
      for (const k of ['resize_width', 'resize_height', 'source_prep']) assert.equal(k in body, false, k);
      assert.deepEqual(errors, []);
      await ctx.close();
    });

    await test('invalid sizes are explained in place; resize off falls back to the legacy quick preparation; unavailable options are listed', async () => {
      const { page, ctx, errors, posts } = await newPage(browser, srv.base);
      await openImg2img(page);
      await page.locator('[data-edit-field="resize-mode"]').selectOption('resize');
      await page.locator('[data-edit-field="resize-width"]').fill('500'); await commit(page);
      await page.locator('[data-edit-field="resize-height"]').fill('512'); await commit(page);
      await page.waitForTimeout(200);
      assert.match(await page.locator('[data-edit-field="resize-preview"]').innerText(), /multiple of 8/);
      assert.equal(await page.locator('[data-edit-field="resize-preview"]').getAttribute('role'), 'alert');
      await page.locator('[data-edit-field="resize-mode"]').selectOption('');
      await page.locator('select[aria-label="Quick source preparation"]').selectOption('crop-square');
      const body = await run(page, posts);
      assert.equal(body.source_prep, 'crop-square');
      for (const k of ['resize_mode', 'resize_width', 'exact_steps']) assert.equal(k in body, false, k);
      const text = await page.locator('[data-edit-field="img2img-unavailable"]').innerText();
      for (const w of ['Latent-upscale', 'image CFG', 'colour correction', 'batch img2img']) assert.match(text, new RegExp(w, 'i'), w);
      assert.deepEqual(errors, []);
      await ctx.close();
    });

    await test('server validator (real source, no job starts): bad modes, size XOR scale, colour, exact-steps limits, both prep styles', async () => {
      const lib = await (await fetch(srv.base + '/api/library/images?limit=1')).json().catch(() => ({}));
      const id = (lib.items || [])[0] && lib.items[0].id;
      if (!id) { console.log('  (no canonical image in this environment; HTTP validator checks skipped)'); return; }
      const post = async body => { const r = await fetch(srv.base + '/api/actions/img2img', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ image_id: id, prompt: 'p', strength: 0.5, steps: 8 }, body)) }); return { status: r.status, data: await r.json() }; };
      const cases = [
        [{ resize_mode: 'latent', resize_by: 2 }, /latent upscale is not available/],
        [{ resize_mode: 'crop' }, /target size/],
        [{ resize_mode: 'crop', resize_width: 512, resize_height: 512, resize_by: 2 }, /not both/],
        [{ resize_mode: 'crop', resize_width: 500, resize_height: 512 }, /multiple of 8/],
        [{ resize_mode: 'fill', resize_by: 9 }, /between 0\.25 and 4/],
        [{ resize_mode: 'fill', resize_by: 2, background_color: 'blue' }, /#rrggbb/],
        [{ resize_width: 512, resize_height: 512 }, /need a resize_mode/],
        [{ resize_mode: 'crop', resize_by: 2, source_prep: 'crop-square' }, /either source_prep or resize_mode/],
        [{ exact_steps: true, steps: 120, strength: 0.2 }, /exact_steps would need 595/],
      ];
      for (const [body, re] of cases) { const r = await post(body); assert.equal(r.status, 400, JSON.stringify(body) + ' -> ' + JSON.stringify(r.data)); assert.match(r.data.error, re, JSON.stringify(body)); }
    });
  } finally {
    await runCleanups();
  }
  process.exitCode = exitCode(results.some(r => r[0] !== 'PASS'));
})().catch(async e => { console.error(e); await runCleanups(); process.exitCode = 2; });
