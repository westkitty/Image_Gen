'use strict';
// P08: A1111 inpaint options in the Edit workbench — inpaint area (whole / only masked + padding + work size),
// mask blur, masked content — through the real UI, plus the server validator over HTTP. No inference runs.
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { makePng, startServer, installModelSnapshots, installImageFixtures, runner, launchBrowser, runCleanups } = require('./helpers');

const FX = { 'fx-landscape.png': { w: 800, h: 500, meta: { operation: 'txt2img', target: 'sd15', seed: 1, steps: 20, cfg: 7, sampler: 'euler_a', scheduler: 'discrete', vae: 'auto', loras: [], gen_schema: 1, prompt_saved: false } } };
const { test, results, exitCode } = runner('edit-inpaint-parity');

async function newPage(browser, base) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [], posts = [];
  page.on('pageerror', e => errors.push(String(e)));
  await installModelSnapshots(page, base);
  await installImageFixtures(page, FX);
  await page.route('**/api/extra-networks**', r => r.fulfill({ json: { loras: [], vaes: [], embeddings: { count: 0, items: [] } } }));
  await page.route('**/api/models/secondary/activate', r => r.fulfill({ json: { ok: true, activeSecondaryModel: 'sd15', modelState: {} } }));
  await page.route('**/api/actions/inpaint', r => { posts.push(r.request().postDataJSON()); r.fulfill({ status: 400, json: { error: 'intercepted by test', gate: 'test' } }); });
  await page.route('**/api/library/images**', r => r.fulfill({ json: { filter: 'all', total: 1, items: [{ id: 'fx-landscape.png', url: '/api/images/fx-landscape.png', width: 800, height: 500, meta: FX['fx-landscape.png'].meta }] } }));
  await page.goto(base + '/dexdiffusion/');
  await page.waitForFunction(() => window.__dex && __dex.state.modelTargets && __dex.state.modelTargets.length > 3 && __dex.state.capabilityData);
  return { page, ctx, errors, posts };
}
async function openInpaint(page) {
  assert.ok(await page.evaluate(() => __dex.openImageInEdit('fx-landscape.png', 'inpaint')));
  await page.waitForFunction(() => __dex.ed && !__dex.ed.loading && __dex.ed.op === 'inpaint' && document.querySelector('[data-inpaint-options]') && document.querySelector('[data-mask-viewport] img'));
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.locator('[data-mask-viewport]').scrollIntoViewIfNeeded();
  await page.evaluate(() => __dex.edQuiet({ brush: { mode: 'paint', size: 40 } }));
  const g = await page.evaluate(() => { const im = document.querySelector('[data-mask-viewport] img').getBoundingClientRect(); return { x: im.x, y: im.y, w: im.width }; });
  const s = g.w / 800, sx = g.x + 300 * s, sy = g.y + 200 * s;
  await page.mouse.move(sx, sy); await page.mouse.down(); await page.mouse.move(sx + 40 * s, sy + 20 * s, { steps: 4 }); await page.mouse.up();
  await page.waitForFunction(() => ((__dex.ed.maskInfo || {}).coverage || 0) > 0);
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
    await test('defaults keep today\'s behaviour: whole picture, blur 4, original content, and nothing else is sent', async () => {
      const { page, ctx, errors, posts } = await newPage(browser, srv.base);
      await openInpaint(page);
      assert.equal(await page.locator('[data-edit-field="inpaint-padding"]').count(), 0, 'padding hidden for whole picture');
      const body = await run(page, posts);
      assert.equal(body.inpaint_area, 'whole'); assert.equal(body.mask_blur, 4); assert.equal(body.masked_content, 'original');
      for (const k of ['inpaint_padding', 'width', 'height']) assert.equal(k in body, false, k);
      assert.match(body.mask_data, /^data:image\/png;base64,/);
      assert.deepEqual(errors, []);
      await ctx.close();
    });

    // Playwright's fill (select-all, then insert) can interleave with a re-render landing between the two steps and append
    // instead of replace (pre-existing ~1-in-5 flake, identical with the pre-session Edit UI). Verify the value and refill.
    const setField = async (page, key, value) => {
      const loc = page.locator('[data-edit-field="' + key + '"]');
      for (let i = 0; i < 3; i++) {
        await loc.evaluate(el => { el.__probe = 1; });
        await loc.fill(value);
        const diag = await loc.evaluate(el => ({ same: el.__probe === 1, v: el.value, active: document.activeElement === el }));
        if (process.env.DEX_DIAG) console.log('DIAG', key, JSON.stringify(diag));
        if (await loc.inputValue() === value) break;
      }
      assert.equal(await loc.inputValue(), value, key);
      await commit(page);
    };
    await test('only masked: padding and work size appear, are sent, and the options persist across re-renders', async () => {
      const { page, ctx, errors, posts } = await newPage(browser, srv.base);
      await openInpaint(page);
      await page.locator('[data-edit-field="inpaint-area"]').selectOption('only_masked');
      await page.locator('[data-edit-field="inpaint-padding"]').waitFor({ state: 'visible' });
      await setField(page, 'inpaint-padding', '16');
      await setField(page, 'inpaint-w', '512');
      await setField(page, 'inpaint-h', '384');
      await setField(page, 'inpaint-blur', '9');
      await page.locator('[data-edit-field="inpaint-content"]').selectOption('fill');
      await page.waitForTimeout(250);
      assert.match(await page.locator('[data-edit-field="inpaint-area-note"]').innerText(), /pasted back into the untouched original/);
      const body = await run(page, posts);
      assert.equal(body.inpaint_area, 'only_masked'); assert.equal(body.inpaint_padding, 16); assert.equal(body.width, 512); assert.equal(body.height, 384);
      assert.equal(body.mask_blur, 9); assert.equal(body.masked_content, 'fill');
      assert.deepEqual(errors, []);
      await ctx.close();
    });

    await test('unavailable masked-content modes and controls are listed, not offered', async () => {
      const { page, ctx, errors } = await newPage(browser, srv.base);
      await openInpaint(page);
      const opts = await page.locator('[data-edit-field="inpaint-content"] option').evaluateAll(o => o.map(x => x.value));
      assert.deepEqual(opts, ['original', 'fill']);
      const text = await page.locator('[data-edit-field="inpaint-unavailable"]').innerText();
      for (const w of ['latent noise', 'latent nothing', 'conditioning-mask weight', 'soft inpainting']) assert.match(text, new RegExp(w, 'i'), w);
      assert.deepEqual(errors, []);
      await ctx.close();
    });

    await test('server validator (real source, no job starts): bad area/content/padding/blur are refused before any work', async () => {
      const lib = await (await fetch(srv.base + '/api/library/images?limit=1')).json().catch(() => ({}));
      const id = (lib.items || [])[0] && lib.items[0].id;
      if (!id) { console.log('  (no canonical image in this environment; HTTP validator checks skipped)'); return; }
      const post = async body => { const r = await fetch(srv.base + '/api/actions/inpaint', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ image_id: id, prompt: 'p', strength: 0.5, mask_data: 'data:image/png;base64,AAAA' }, body)) }); return { status: r.status, data: await r.json() }; };
      const cases = [
        [{ inpaint_area: 'tiles' }, /inpaint_area must be/],
        [{ masked_content: 'latent_noise' }, /not available/],
        [{ masked_content: 'latent_nothing' }, /not available/],
        [{ inpaint_area: 'only_masked', inpaint_padding: 999 }, /0-256/],
        [{ mask_blur: 99 }, /0-64/],
        [{ inpaint_padding: 8 }, /only applies when inpaint_area is only_masked/],
      ];
      for (const [body, re] of cases) { const r = await post(body); assert.equal(r.status, 400, JSON.stringify(body) + ' -> ' + JSON.stringify(r.data)); assert.match(r.data.error, re, JSON.stringify(body)); assert.equal(r.data.gate, 'inpaint-options'); }
    });
  } finally {
    await runCleanups();
  }
  process.exitCode = exitCode(results.some(r => r[0] !== 'PASS'));
})().catch(async e => { console.error(e); await runCleanups(); process.exitCode = 2; });
