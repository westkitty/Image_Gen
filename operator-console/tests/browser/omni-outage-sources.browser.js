'use strict';
// OMNI regression: worker outage must not erase saved worlds, source discovery
// must reach historical images, and reconnect must never resubmit a job.
// Real isolated HTTP/DOM with intercepted APIs: never invokes ML workers.
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { startServer, launchBrowser, openStudio, runCleanups } = require('./helpers');

(async () => {
  const srv = await startServer();
  const browser = await launchBrowser(chromium);
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const items = Array.from({ length: 510 }, (_, n) => ({
    id: 'fixture-history-' + String(n).padStart(3, '0') + '.png',
    thumbnailUrl: '/api/thumbnails/fixture-history-' + n + '.png',
    meta: { original_name: n === 509 ? 'oldest-drawing.png' : 'drawing-' + n + '.png' }
  }));
  const historyQueries = [];
  await page.route('**/api/library/images?*', route => {
    const u = new URL(route.request().url());
    if (u.searchParams.get('filter') !== 'all') return route.fallback();
    const q = (u.searchParams.get('q') || '').toLowerCase();
    const offset = Number(u.searchParams.get('offset') || 0);
    const limit = Number(u.searchParams.get('limit') || 100);
    const matches = q ? items.filter(item => item.meta.original_name.includes(q) || item.id.includes(q)) : items;
    historyQueries.push({ q, offset, limit });
    return route.fulfill({ json: { total: matches.length, offset, limit, items: matches.slice(offset, offset + limit) } });
  });
  await page.route('**/api/world/projects', route => route.fulfill({ json: {
    projects: [{ id: 'wp-outage-saved', mode: 'complete360', status: 'PARTIAL',
      currentStage: 'quality', sourceArtifactId: 'fixture-history-000.png',
      progress: { total: 1, done: 0, segments: [{ id: 'quality', status: 'BLOCKED', label: 'Geometry quality unverified' }] },
      artifacts: {} }]
  } }));
  await page.route('**/api/world/workers', async route => {
    await new Promise(resolve => setTimeout(resolve, 3500));
    await route.abort('failed').catch(() => {});
  });
  await openStudio(page, srv.base + '/dexdiffusion/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => window.__dex.setScreen('world'));
  // The slow 3.5-second worker probe must not delay the saved project.
  await page.getByText('wp-outage-saved').first().waitFor({ timeout: 2400 });
  await page.getByText(/World worker status unavailable/).waitFor({ timeout: 10000 });
  assert.equal(await page.evaluate(() => __dex.state.worldProjects.length), 1, 'saved World survives worker fetch error');
  // PERF-05: the project list must resolve before a deliberately stalled worker probe.
  await page.unroute('**/api/world/workers');
  let slowWorkerAnswered = false;
  await page.route('**/api/world/workers', route => {
    setTimeout(() => {
      slowWorkerAnswered = true;
      route.fulfill({ json: { workers: [] } }).catch(() => {});
    }, 2500);
  });
  const listStarted = Date.now();
  await page.evaluate(() => __dex.loadWorldProjects());
  const listElapsed = Date.now() - listStarted;
  assert.equal(await page.evaluate(() => __dex.state.worldProjects.length), 1);
  assert.ok(!slowWorkerAnswered, 'saved Worlds resolve while the worker probe remains pending');
  assert.ok(listElapsed < 2200, 'World list not delayed by worker probe: ' + listElapsed + ' ms');

  const sourceToggle = page.locator('[data-3d-source-observatory="world"]');
  assert.equal(await sourceToggle.getAttribute('aria-expanded'), 'false');
  await sourceToggle.click();
  assert.equal(await sourceToggle.getAttribute('aria-expanded'), 'true',
    'expanded state is exposed to assistive technology');
  await page.locator('[data-source-search="world"]').fill('oldest-drawing');
  await page.locator('[data-source-image-id="fixture-history-509.png"]').waitFor({ timeout: 10000 });
  await page.locator('[data-source-image-id="fixture-history-509.png"]').click();
  assert.equal(await page.evaluate(() => __dex.state.worldSourceArtifact), 'fixture-history-509.png');
  assert.ok(historyQueries.some(x => x.q === 'oldest-drawing'), 'the server was queried for an image outside the first 500');
  await page.evaluate(() => __dex.setScreen('3d'));
  await page.getByText('Required. 3D uses exactly the image').waitFor({ timeout: 10000 });
  const geometry = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth, inner: window.innerWidth
  }));
  assert.ok(geometry.scroll <= geometry.inner, '3D workflow has no horizontal overflow at 390px: ' + JSON.stringify(geometry));
  let fail = true;
  await page.route('**/api/generic-jobs/omni-job', route => fail
    ? route.abort('failed')
    : route.fulfill({ json: { job_id: 'omni-job', status: 'COMPLETE', mode: 'mesh', artifacts_detail: [] } }));
  await page.evaluate(() => {
    const original = window.setTimeout.bind(window);
    window.setTimeout = (handler, delay, ...args) => original(handler, Math.min(delay, 25), ...args);
    __dex.setState({ asset3dJob: { job_id: 'omni-job', status: 'RUNNING', mode: 'mesh' } });
    __dex.pollAsset3dJob('omni-job');
  });
  await page.locator('[data-asset-job-reconnect]').waitFor({ timeout: 10000 });
  assert.match(await page.locator('[role="alert"]').allTextContents().then(x => x.join(' ')), /job may still be running/);
  fail = false;
  await page.locator('[data-asset-job-reconnect]').click();
  await page.waitForFunction(() => __dex.state.asset3dJob?.status === 'COMPLETE', null, { timeout: 10000 });
  assert.equal(await page.evaluate(() => __dex.state.asset3dPollPaused), false);
  assert.deepEqual(errors, []);
  console.log('OMNI_OUTAGE_SOURCES_PASS', JSON.stringify({ project: 'wp-outage-saved', image: 'fixture-history-509.png', browser: geometry, job: 'COMPLETE' }));
  await runCleanups();
})().catch(async error => { console.error(error); await runCleanups(); process.exitCode = 1; });
