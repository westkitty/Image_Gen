'use strict';
// Viewer basics: Rotate / Flip / Crop create a NEW image through /api/actions/transform (the request names the source id and
// validated operations), the new version opens in Library, and drag-to-pan moves a zoomed image. No pixel work is faked in the browser.
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { makePng, startServer, installModelSnapshots, runner, launchBrowser } = require('./helpers');
const { test, exitCode } = runner('transform');
const PNG = makePng(64, 64), SRC = '20261017-100000-fx-src.png', NEW = '20261017-100001-fx-new-tf-abc.png';

(async () => {
  const srv = process.env.DEX_TEST_BASE ? { base: process.env.DEX_TEST_BASE, stop() {} } : await startServer();
  const browser = await launchBrowser(chromium);
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', e => errors.push(String(e)));
    const posts = [];
    await installModelSnapshots(page, srv.base);
    await page.route('**/api/extra-networks**', r => r.fulfill({ json: { loras: [], vaes: [], embeddings: { count: 0, items: [] } } }));
    const item = id => ({ id, url: '/api/images/' + id, thumbnailUrl: '/api/thumbnails/' + id, downloadUrl: '/api/images/' + id + '/export', width: 640, height: 480, keeper: false, meta: { operation: 'txt2img', seed: 1 } });
    await page.route('**/api/library/images**', r => r.fulfill({ json: { filter: 'all', total: 1, offset: 0, limit: 24, items: [item(SRC)] } }));
    await page.route(/\/api\/(images|thumbnails)\/[^/]+$/, r => r.fulfill({ contentType: 'image/png', body: PNG }));
    await page.route(/\/api\/images\/[^/]+\/meta$/, r => { const id = decodeURIComponent(r.request().url().split('/').slice(-2)[0]); r.fulfill({ json: Object.assign(item(id), { path: '/x', runId: 'r', parent: null, children: [], ancestors: [] }) }); });
    await page.route('**/api/actions/transform', r => { posts.push(r.request().postDataJSON()); r.fulfill({ json: { job_id: 'tf-1', status: 'running', result: { width: 480, height: 640 } } }); });
    await page.route('**/api/jobs/tf-1', r => r.fulfill({ json: { id: 'tf-1', status: 'PASS', results: [{ index: 0, status: 'DONE', imageId: NEW, imageUrl: '/api/images/' + NEW }] } }));
    await page.goto(srv.base + '/dexdiffusion/');
    await page.waitForFunction(() => window.__dex && __dex.state.capabilityData && __dex.state.modelTargets && __dex.state.modelTargets.length > 3);
    await page.evaluate(() => __dex.setScreen('library'));
    await page.waitForSelector('[data-lib-grid] [data-lib-thumb] img');
    const open = async () => { await page.locator('[data-lib-grid] [data-lib-thumb] img').first().click(); await page.waitForSelector('[data-lightbox]'); };

    await test('Rotate clockwise sends one validated request for the exact source id and opens the new version', async () => {
      await open();
      await page.locator('[data-lightbox] button:text-is("↻ Rotate")').click();
      await page.waitForFunction(() => __dex._ws().lib.selectedId, null, { timeout: 8000 });
      assert.equal(posts.length, 1); assert.equal(posts[0].image_id, SRC); assert.deepEqual(posts[0].ops, [{ op: 'rotate', degrees: 90 }]);
      assert.equal(await page.evaluate(() => __dex._ws().lib.selectedId), NEW);
      assert.equal(await page.evaluate(() => __dex.state.screens[__dex.state.version]), 'library');
    });
    await test('Flip and Crop 16:9 send the right operations (crop box is centred and inside the image)', async () => {
      await page.evaluate(() => __dex._ws().lib.selectedId = null);
      await open(); await page.locator('[data-lightbox] button:text-is("⇋ Flip")').click(); await page.waitForFunction(() => true);
      for (let i = 0; i < 25 && posts.length < 2; i++) await new Promise(r => setTimeout(r, 200));
      assert.deepEqual(posts[1].ops, [{ op: 'flip', axis: 'h' }]);
      await open(); await page.locator('[data-lightbox] button:text-is("Crop 16:9")').click();
      for (let i = 0; i < 25 && posts.length < 3; i++) await new Promise(r => setTimeout(r, 200));
      const c = posts[2].ops[0]; assert.equal(c.op, 'crop'); assert.deepEqual([c.x, c.y, c.w, c.h], [0, 60, 640, 360]);
    });
    await test('transform requests carry only the source id and operations (no path or overwrite field)', async () => {
      assert.ok(posts.every(p => p.image_id === SRC && !('overwrite' in p) && !('path' in p)));
    });
    await test('zoomed images can be dragged to pan without toggling zoom', async () => {
      await open();
      await page.evaluate(() => { const i = document.querySelector('[data-lightbox-image]'); i.src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="3000" height="2000"><rect width="3000" height="2000" fill="#345"/></svg>'); });
      await page.locator('[data-lightbox] button:text-is("100%")').click();
      await page.waitForFunction(() => { const b = document.querySelector('[data-lightbox-image]').parentElement; return b.scrollWidth > b.clientWidth; });
      const box = await page.locator('[data-lightbox-image]').evaluate(i => { const r = i.parentElement.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
      await page.mouse.move(box.x, box.y); await page.mouse.down(); await page.mouse.move(box.x - 200, box.y - 120, { steps: 6 }); await page.mouse.up();
      const sc = await page.evaluate(() => { const b = document.querySelector('[data-lightbox-image]').parentElement; return [b.scrollLeft, b.scrollTop]; });
      assert.ok(sc[0] > 100 && sc[1] > 60, 'panned by drag: ' + sc);
      assert.ok(await page.evaluate(() => document.querySelector('[data-lightbox-image]').style.maxWidth === 'none'), 'still zoomed after the drag');
    });
    assert.deepEqual(errors, []);
    await ctx.close();
  } finally { await srv.stop(); }
  process.exit(exitCode());
})();
