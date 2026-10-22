'use strict';
// PWA: valid manifest + icons, a service worker that caches static files only (never /api), and a truthful offline notice.
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { startServer, installModelSnapshots, runner, launchBrowser, openStudio } = require('./helpers');
const { test, exitCode } = runner('pwa');

(async () => {
  const srv = process.env.DEX_TEST_BASE ? { base: process.env.DEX_TEST_BASE, stop() {} } : await startServer();
  const browser = await launchBrowser(chromium);
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', e => errors.push(String(e)));
    await installModelSnapshots(page, srv.base);
    await page.route('**/api/extra-networks**', r => r.fulfill({ json: { loras: [], vaes: [], embeddings: { count: 0, items: [] } } }));
    await openStudio(page, srv.base + '/dexdiffusion/');
    await page.waitForFunction(() => window.__dex && __dex.state.capabilityData);
    await test('manifest is linked, valid, same-origin, scoped to /dexdiffusion/, with fetchable icons', async () => {
      const href = await page.getAttribute('link[rel="manifest"]', 'href');
      const res = await page.request.get(new URL(href, srv.base + '/dexdiffusion/').href);
      assert.equal(res.status(), 200); assert.match(res.headers()['content-type'] || '', /json/);
      const m = await res.json();
      assert.equal(m.start_url, '/dexdiffusion/'); assert.equal(m.scope, '/dexdiffusion/'); assert.equal(m.display, 'standalone');
      assert.ok(m.icons.some(i => i.sizes === '192x192') && m.icons.some(i => i.sizes === '512x512'));
      for (const i of m.icons) { const r = await page.request.get(new URL(i.src, srv.base + '/dexdiffusion/').href); assert.equal(r.status(), 200); assert.match(r.headers()['content-type'], /image\/png/); }
    });
    await test('service worker activates and caches no /api response', async () => {
      await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.ready.then(() => true), null, { timeout: 15000 });
      await page.evaluate(() => navigator.serviceWorker.ready);
      await page.reload(); await page.waitForFunction(() => window.__dex && __dex.state.capabilityData);
      const keys = await page.evaluate(async () => { const out = []; for (const n of await caches.keys()) { const c = await caches.open(n); for (const r of await c.keys()) out.push(new URL(r.url).pathname); } return out; });
      assert.ok(keys.length > 0, 'static assets cached');
      assert.ok(keys.every(p => !p.startsWith('/api/')), 'no /api path cached: ' + keys.filter(p => p.startsWith('/api/')).join(','));
    });
    await test('losing the console shows a truthful offline notice', async () => {
      await page.route('**/api/version', r => r.abort());
      await page.evaluate(() => window.dispatchEvent(new Event('offline')));
      await page.waitForSelector('[data-offline-notice]');
      assert.match(await page.locator('[data-offline-notice]').innerText(), /unavailable/);
    });
    assert.deepEqual(errors, []);
    await ctx.close();
  } finally { await srv.stop(); }
  process.exit(exitCode());
})();
