'use strict';
// Repeatable UI performance probe (headless Chrome, isolated private-port server, fixture-served Library).
//   node tests/perf/ui-perf.js [runs=5] [label=now]  ->  JSON on stdout (medians, min, max in ms)
// Measures: cold UI start (navigation start -> capability data ready), typing latency, Library list load,
// Grid<->List toggle, viewer Next latency, and bounded memory: <img> elements and JS heap while browsing a 5000-image Library.
// Conditions are recorded in the output; compare only runs made on the same machine under similar load.
const { chromium } = require('playwright-core');
const { makePng, startServer, installModelSnapshots, launchBrowser } = require('../browser/helpers');
const RUNS = Math.max(1, parseInt(process.argv[2], 10) || 5), LABEL = process.argv[3] || 'now';
const PNG = makePng(64, 64);
const T = 5000, mk = i => ({ id: `20261017-${900000 + i}-big-${i}.png`, url: '/api/images/big-' + i + '.png', thumbnailUrl: '/api/thumbnails/big-' + i + '.png', width: 64, height: 64, keeper: false, meta: { operation: 'txt2img', seed: i } });
const med = a => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor((s.length - 1) / 2)]; };
const stat = a => ({ median: +med(a).toFixed(1), min: +Math.min(...a).toFixed(1), max: +Math.max(...a).toFixed(1), n: a.length });

(async () => {
  const srv = await startServer();
  const browser = await launchBrowser(chromium);
  const out = { label: LABEL, runs: RUNS, node: process.version, when: new Date().toISOString(), conditions: 'headless Chrome, isolated server, Library endpoints fixture-served (5000 items), model catalogue snapshot', metrics: {} };
  const push = (k, v) => { (out.metrics[k] = out.metrics[k] || []).push(v); };
  try {
    for (let r = 0; r < RUNS; r++) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await ctx.newPage();
      await installModelSnapshots(page, srv.base);
      await page.route('**/api/extra-networks**', x => x.fulfill({ json: { loras: [], vaes: [], embeddings: { count: 0, items: [] } } }));
      await page.route('**/api/library/images**', x => { const u = new URL(x.request().url()), limit = Math.min(500, +u.searchParams.get('limit') || 200), off = +u.searchParams.get('offset') || 0; x.fulfill({ json: { filter: 'all', total: T, offset: off, limit, items: Array.from({ length: Math.max(0, Math.min(limit, T - off)) }, (_, i) => mk(off + i)) } }); });
      await page.route(/\/api\/(images|thumbnails)\/[^/]+$/, x => x.fulfill({ contentType: 'image/png', body: PNG }));
      const t0 = Date.now();
      await page.goto(srv.base + '/dexdiffusion/', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__dex && __dex.state.capabilityData && __dex.state.modelTargets && __dex.state.modelTargets.length > 3);
      push('ui_start_ms', Date.now() - t0);

      await page.evaluate(() => __dex.setScreen('create'));
      await page.waitForSelector('[data-dex-field="prompt"]');
      const typing = await page.evaluate(async () => {
        const el = document.querySelector('[data-dex-field="prompt"]'); el.focus(); const lat = [];
        for (let i = 0; i < 120; i++) {
          const t = performance.now(); el.value += 'a'; el.dispatchEvent(new Event('input', { bubbles: true }));
          await new Promise(r => requestAnimationFrame(() => r())); lat.push(performance.now() - t);
        }
        lat.sort((a, b) => a - b); return { p50: lat[60], p95: lat[Math.floor(lat.length * 0.95)], max: lat[lat.length - 1] };
      });
      push('typing_p50_ms', typing.p50); push('typing_p95_ms', typing.p95);

      if (process.env.DEX_PERF_SKIP_LIBRARY === '1') { await ctx.close(); continue; }   // baseline commits without the new Library UI
      const tl = Date.now();
      await page.evaluate(() => __dex.setScreen('library'));
      await page.waitForSelector('[data-lib-grid] [data-lib-thumb]');
      push('library_first_page_ms', Date.now() - tl);
      const tg = Date.now(); await page.click('[data-lib-view="list"]'); await page.waitForSelector('[data-lib-list]'); push('grid_to_list_ms', Date.now() - tg);
      const tl2 = Date.now(); await page.click('[data-lib-view="grid"]'); await page.waitForSelector('[data-lib-grid]'); push('list_to_grid_ms', Date.now() - tl2);

      await page.locator('[data-lib-grid] [data-lib-thumb] img').first().click();
      await page.waitForSelector('[data-lightbox]');
      const nav = [];
      for (let i = 0; i < 20; i++) { const before = await page.locator('[data-lightbox-count]').innerText(); const t = Date.now(); await page.keyboard.press('ArrowRight'); await page.waitForFunction(b => document.querySelector('[data-lightbox-count]').textContent !== b, before); nav.push(Date.now() - t); }
      push('viewer_next_ms', med(nav));
      await page.keyboard.press('Escape');
      const mem = await page.evaluate(() => ({ imgs: document.querySelectorAll('img').length, heapMB: performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null }));
      push('img_elements', mem.imgs); if (mem.heapMB != null) push('js_heap_mb', mem.heapMB);
      await ctx.close();
    }
  } finally { await srv.stop(); }
  for (const k of Object.keys(out.metrics)) out.metrics[k] = stat(out.metrics[k]);
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
})();
