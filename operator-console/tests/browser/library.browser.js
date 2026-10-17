'use strict';
// Library: Grid/List, independent rows/columns/density, persisted preferences, real paging, full-size viewer with
// Previous/Next over the ACTIVE filtered+sorted collection, keyboard/touch, original Download, Copy fallback, bad-image recovery.
// The Library endpoints are served from an in-test fixture so the browser exercises the real UI against a known 84-image set.
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { makePng, startServer, installModelSnapshots, runner, launchBrowser } = require('./helpers');
const { test, exitCode } = runner('library');

const N = 84;
const ALL = Array.from({ length: N }, (_, i) => {
  const id = `20261017-${String(100000 + i)}-fx-${i}.png`;
  return { id, url: '/api/images/' + id, thumbnailUrl: '/api/thumbnails/' + id, downloadUrl: '/api/images/' + id + '/export', width: 64, height: 64, keeper: i % 7 === 0, meta: { operation: 'txt2img', target: 'sd15', seed: i } };
}).reverse(); // newest first, like the server
const BAD = ALL[3].id;
const PNG = makePng(64, 64);

async function newPage(browser, base, ctxOpts) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 900 } }, ctxOpts));
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  const reqs = { thumbs: 0, full: 0, list: [] };
  await installModelSnapshots(page, base);
  await page.route('**/api/extra-networks**', r => r.fulfill({ json: { loras: [], vaes: [], embeddings: { count: 0, items: [] } } }));
  await page.route('**/api/library/images**', r => {
    const u = new URL(r.request().url()), filter = u.searchParams.get('filter') || 'all', sort = u.searchParams.get('sort') || 'desc';
    const limit = Math.min(500, parseInt(u.searchParams.get('limit') || '200', 10)), offset = parseInt(u.searchParams.get('offset') || '0', 10);
    let ids = filter === 'keepers' ? ALL.filter(x => x.keeper) : ALL.slice();
    if (sort === 'asc') ids = ids.slice().reverse();
    reqs.list.push(u.search);
    r.fulfill({ json: { filter, total: ids.length, offset, limit, items: ids.slice(offset, offset + limit) } });
  });
  await page.route(/\/api\/thumbnails\/[^/]+$/, r => { reqs.thumbs++; r.fulfill({ contentType: 'image/png', body: PNG }); });
  await page.route(/\/api\/images\/[^/]+$/, r => { if (decodeURIComponent(r.request().url()).includes(BAD)) return r.fulfill({ status: 404, body: 'gone' }); reqs.full++; r.fulfill({ contentType: 'image/png', body: PNG }); });
  await page.route(/\/api\/images\/[^/]+\/export$/, r => r.fulfill({ contentType: 'image/png', headers: { 'Content-Disposition': 'attachment; filename="x.png"' }, body: PNG }));
  await page.route(/\/api\/images\/[^/]+\/meta$/, r => r.fulfill({ status: 404, json: { error: 'n/a' } }));
  await page.goto(base + '/dexdiffusion/');
  await page.waitForFunction(() => window.__dex && __dex.state.modelTargets && __dex.state.modelTargets.length > 3 && __dex.state.capabilityData);
  await page.evaluate(() => __dex.setScreen('library'));
  await page.waitForSelector('[data-lib-controls]');
  await page.waitForSelector('[data-lib-thumb]');
  return { page, ctx, errors, reqs };
}
const cells = page => page.locator('[data-lib-grid] [data-lib-thumb]').count();
const pick = (page, key, v) => page.selectOption('[data-lib-control="' + key + '"]', String(v));
const counter = page => page.locator('[data-lightbox-count]').innerText();

(async () => {
  const srv = process.env.DEX_TEST_BASE ? { base: process.env.DEX_TEST_BASE, stop() {} } : await startServer();
  const browser = await launchBrowser(chromium);
  try {
    await test('grid mode: rows and columns each change the visible page independently; range and total are exact', async () => {
      const { page, ctx, errors } = await newPage(browser, srv.base);
      await page.evaluate(() => localStorage.removeItem('dexdiffusion.library.prefs.v1'));
      await pick(page, 'cols', 4); await pick(page, 'rows', 3);
      await page.waitForFunction(() => document.querySelectorAll('[data-lib-grid] [data-lib-thumb]').length === 12);
      assert.equal(await page.locator('[data-lib-range]').getAttribute('data-lib-range'), '1-12/84');
      await pick(page, 'rows', 5);
      await page.waitForFunction(() => document.querySelectorAll('[data-lib-grid] [data-lib-thumb]').length === 20);
      assert.equal(await page.locator('[data-lib-control="cols"]').inputValue(), '4', 'rows must not reset columns');
      await pick(page, 'cols', 2);
      await page.waitForFunction(() => document.querySelectorAll('[data-lib-grid] [data-lib-thumb]').length === 10);
      assert.equal(await page.locator('[data-lib-control="rows"]').inputValue(), '5', 'columns must not reset rows');
      assert.match(await page.locator('[data-lib-pager]').innerText(), /Showing 1–10 of 84/);
      await page.click('[data-lib-page="next"]');
      await page.waitForFunction(() => /Showing 11–20 of 84/.test(document.querySelector('[data-lib-pager]').innerText));
      assert.deepEqual(errors, []); await ctx.close();
    });

    await test('density changes the cell size; effective columns are clamped to the viewport and disclosed', async () => {
      const { page, ctx } = await newPage(browser, srv.base, { viewport: { width: 420, height: 800 } });
      await pick(page, 'cols', 8); await pick(page, 'density', 'comfortable');
      await page.waitForFunction(() => /limited by screen width/.test((document.querySelector('[data-lib-effective]') || {}).innerText || ''), null, { timeout: 8000 });
      const w = async () => { await page.waitForTimeout(700); for (let i = 0; i < 20; i++) { const bb = await page.locator('[data-lib-grid] [data-lib-thumb]').first().boundingBox().catch(() => null); if (bb) return bb.width; await page.waitForTimeout(150); } throw new Error('no cell'); };
      await pick(page, 'cols', 0); await pick(page, 'density', 'compact'); const wc = await w();
      await pick(page, 'density', 'large'); const wl = await w();
      assert.ok(wl > wc, 'large cells are wider than compact ones (' + wl + ' vs ' + wc + ')');
      await ctx.close();
    });

    await test('preferences persist across reload; list mode shows one entry per row with Download links', async () => {
      const { page, ctx } = await newPage(browser, srv.base);
      await pick(page, 'cols', 5); await pick(page, 'rows', 2); await pick(page, 'density', 'compact');
      await page.click('[data-lib-view="list"]');
      await page.waitForSelector('[data-lib-list]');
      await page.waitForFunction(() => document.querySelectorAll('[data-lib-list] [data-lib-thumb]').length === 2);
      assert.match(await page.locator('[data-lib-download]').first().getAttribute('href'), /\/export$/);
      await page.reload();
      await page.waitForFunction(() => window.__dex && __dex.state.capabilityData);
      await page.evaluate(() => __dex.setScreen('library')); await page.waitForSelector('[data-lib-controls]');
      assert.equal(await page.locator('[data-lib-view="list"]').getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('[data-lib-control="rows"]').inputValue(), '2');
      assert.equal(await page.locator('[data-lib-control="density"]').inputValue(), 'compact');
      await page.click('[data-lib-view="grid"]'); await page.waitForSelector('[data-lib-grid]');
      assert.equal(await page.locator('[data-lib-control="cols"]').inputValue(), '5');
      await ctx.close();
    });

    await test('thumbnails are bounded: browsing the grid fetches thumbnails, not full-resolution images', async () => {
      const { page, ctx, reqs } = await newPage(browser, srv.base);
      await pick(page, 'rows', 4); await page.waitForTimeout(400);
      assert.ok(reqs.thumbs > 0 && reqs.thumbs <= 60, 'thumbnails fetched: ' + reqs.thumbs);
      assert.equal(reqs.full, 0, 'no full-size fetch before a viewer is opened');
      await ctx.close();
    });

    await test('viewer: opens full size, Previous/Next, counter, boundaries, keyboard, original Download, Escape returns focus', async () => {
      const { page, ctx } = await newPage(browser, srv.base);
      await page.evaluate(() => localStorage.removeItem('dexdiffusion.library.prefs.v1'));
      await page.locator('[data-lib-grid] [data-lib-thumb] img').nth(1).click();
      await page.waitForSelector('[data-lightbox]');
      assert.equal(await counter(page), '2 / 84');
      assert.equal(await page.locator('[data-lightbox-prev]').isDisabled(), false);
      await page.click('[data-lightbox-next]'); assert.equal(await counter(page), '3 / 84');
      await page.keyboard.press('ArrowRight'); assert.equal(await counter(page), '4 / 84');
      await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft');
      assert.equal(await counter(page), '1 / 84');
      assert.equal(await page.locator('[data-lightbox-prev]').isDisabled(), true, 'first boundary');
      await page.keyboard.press('ArrowLeft'); assert.equal(await counter(page), '1 / 84', 'no wrap at the start');
      const href = await page.locator('[data-lightbox-download]').getAttribute('href');
      assert.match(href, new RegExp(ALL[0].id.replace(/\./g, '\\.') + '/export$'));
      const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-lightbox-download]')]);
      assert.equal(dl.suggestedFilename(), ALL[0].id, 'download keeps the original canonical filename');
      await page.keyboard.press('Escape'); await page.waitForSelector('[data-lightbox]', { state: 'detached' });
      assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.tagName), 'IMG', 'focus returns to the thumbnail');
      await ctx.close();
    });

    await test('viewer navigation follows the active filter and sort, not the unfiltered library', async () => {
      const { page, ctx } = await newPage(browser, srv.base);
      await page.click('button:has-text("★ Keepers")');
      const keepers = ALL.filter(x => x.keeper).length;
      await page.waitForFunction(n => new RegExp('of ' + n + '\\b').test(document.querySelector('[data-lib-pager]').innerText), keepers);
      await page.locator('[data-lib-grid] [data-lib-thumb] img').first().click();
      await page.waitForSelector('[data-lightbox]');
      assert.equal(await counter(page), '1 / ' + keepers);
      const seen = [];
      for (let i = 0; i < keepers; i++) { seen.push(await page.locator('[data-lightbox] [data-lightbox-image]').getAttribute('alt')); await page.keyboard.press('ArrowRight'); }
      assert.ok(seen.every(id => ALL.find(x => x.id === id).keeper), 'only keepers were visited');
      assert.equal(await counter(page), keepers + ' / ' + keepers, 'stops at the last item');
      await page.keyboard.press('Escape');
      await page.click('button:has-text("All")');
      await pick(page, 'sort', 'asc');
      await page.waitForFunction(id => !!document.querySelector('[data-lib-thumb="' + id + '"]') || true, ALL[N - 1].id);
      await page.locator('[data-lib-grid] [data-lib-thumb] img').first().click();
      await page.waitForSelector('[data-lightbox]');
      assert.equal(await page.locator('[data-lightbox] [data-lightbox-image]').getAttribute('alt'), ALL[N - 1].id, 'oldest-first puts the oldest image first');
      await ctx.close();
    });

    await test('arrow keys are not hijacked while typing; swipe navigates only when not zoomed', async () => {
      const { page, ctx } = await newPage(browser, srv.base, { hasTouch: true });
      await page.locator('[data-lib-grid] [data-lib-thumb] img').first().evaluate(el => el.click());
      await page.waitForSelector('[data-lightbox]');
      await page.evaluate(() => { const i = document.createElement('input'); i.id = 'zz'; document.querySelector('[data-lightbox]').append(i); i.focus(); });
      await page.keyboard.press('ArrowRight'); assert.equal(await counter(page), '1 / 84', 'text field keeps its arrow keys');
      await page.evaluate(() => document.getElementById('zz').remove());
      const swipe = (dx, dy = 0) => page.evaluate(([dx, dy]) => {
        const box = document.querySelector('[data-lightbox] [data-lightbox-image]').parentElement, mk = (x, y) => new Touch({ identifier: 1, target: box, clientX: x, clientY: y });
        box.dispatchEvent(new TouchEvent('touchstart', { touches: [mk(200, 300)], bubbles: true }));
        box.dispatchEvent(new TouchEvent('touchend', { changedTouches: [mk(200 + dx, 300 + dy)], touches: [], bubbles: true }));
      }, [dx, dy]);
      await swipe(-120); assert.equal(await counter(page), '2 / 84', 'swipe left = next');
      await swipe(120); assert.equal(await counter(page), '1 / 84', 'swipe right = previous');
      await swipe(-30); assert.equal(await counter(page), '1 / 84', 'short swipe ignored');
      await swipe(-120, 150); assert.equal(await counter(page), '1 / 84', 'vertical-dominant gesture ignored');
      await page.click('[data-lightbox] [data-lightbox-image]'); // zoom in
      await swipe(-120); assert.equal(await counter(page), '1 / 84', 'zoomed image pans instead of navigating');
      await ctx.close();
    });

    await test('a missing/corrupt image shows a recoverable error; Previous/Next and Close still work; Copy never fakes success', async () => {
      const { page, ctx } = await newPage(browser, srv.base);
      await page.locator('[data-lib-grid] [data-lib-thumb] img').nth(2).click();
      await page.waitForSelector('[data-lightbox]');
      await page.click('[data-lightbox-next]'); // index 4 -> ALL[3] is the bad one
      await page.waitForSelector('[data-lightbox-error]', { state: 'visible' });
      assert.match(await page.locator('[data-lightbox-error]').innerText(), /could not be loaded/);
      await page.click('[data-lightbox-next]'); assert.equal(await counter(page), '5 / 84');
      await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-lightbox-error]')).display === 'none');
      await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true }); });
      await page.click('button:has-text("Copy Image")');
      await page.waitForFunction(() => /Copy unavailable/.test(document.querySelector('[data-lightbox]').innerText));
      await page.click('button[aria-label="Close fullscreen image"]'); await page.waitForSelector('[data-lightbox]', { state: 'detached' });
      assert.match(await page.locator('[data-lib-pager]').innerText(), /of 84/, 'library state intact after the viewer closes');
      await ctx.close();
    });

    await test('large library (5000 images): DOM and requests stay bounded to the page; paging reaches the end', async () => {
      const { page, ctx, reqs } = await newPage(browser, srv.base);
      const T = 5000, mk = i => ({ id: `20261017-${String(900000 + i)}-big-${i}.png`, url: '/api/images/big-' + i + '.png', thumbnailUrl: '/api/thumbnails/big-' + i + '.png', width: 64, height: 64, keeper: false, meta: { operation: 'txt2img', seed: i } });
      await page.unroute('**/api/library/images**');
      await page.route('**/api/library/images**', r => { const u = new URL(r.request().url()), limit = Math.min(500, +u.searchParams.get('limit') || 200), off = +u.searchParams.get('offset') || 0;
        r.fulfill({ json: { filter: 'all', total: T, offset: off, limit, items: Array.from({ length: Math.max(0, Math.min(limit, T - off)) }, (_, i) => mk(off + i)) } }); });
      await pick(page, 'rows', 20); await pick(page, 'cols', 6);
      await page.waitForFunction(() => document.querySelectorAll('[data-lib-grid] [data-lib-thumb]').length === 120);
      assert.match(await page.locator('[data-lib-pager]').innerText(), /Showing 1–120 of 5000/);
      const nodes = await page.evaluate(() => document.querySelectorAll('img').length);
      assert.ok(nodes <= 140, 'img elements bounded: ' + nodes);
      // page to the end, waiting for each page to land (the Next button is disabled while a page loads)
      for (let i = 0; i < 60; i++) {
        const cur = await page.locator('[data-lib-range]').getAttribute('data-lib-range');
        if (/-5000\/5000$/.test(cur)) break;
        await page.waitForFunction(() => !document.querySelector('[data-lib-page="next"]').disabled, null, { timeout: 8000 });
        await page.click('[data-lib-page="next"]');
        await page.waitForFunction(b => document.querySelector('[data-lib-range]').getAttribute('data-lib-range') !== b, cur, { timeout: 8000 });
      }
      assert.equal(await page.locator('[data-lib-range]').getAttribute('data-lib-range'), '4921-5000/5000');
      assert.equal(await page.locator('[data-lib-page="next"]').isDisabled(), true, 'last page has no Next');
      assert.equal(reqs.full, 0, 'no full-resolution image fetched while browsing');
      await ctx.close();
    });
  } finally { await srv.stop(); }
  process.exit(exitCode());
})();
