'use strict';
// Progressive batch results: each canonicalized image appears as soon as ITS run finishes (not when the whole batch ends);
// a failed or cancelled tail keeps the finished images; a refresh re-attaches to the running batch. (The completion ding is driven by the SSE job.completed event and is tested in notifications.browser.js.)
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { makePng, startServer, installModelSnapshots, runner, launchBrowser, openStudio } = require('./helpers');
const { test, exitCode } = runner('progressive-batch');
const PNG = makePng(64, 64);
const cell = (i, status = 'DONE') => status === 'DONE'
  ? { index: i, status: 'DONE', imageId: `20261017-120000-fx-s${1000 + i}-fx.png`, imageUrl: `/api/images/20261017-120000-fx-s${1000 + i}-fx.png`, seed: 1000 + i, target: 'sd15', runId: 'run-' + i }
  : { index: i, status: 'FAILED', seed: 1000 + i, target: 'sd15', runId: 'run-' + i };

async function boot(browser, base, script) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  const state = { n: 0, posts: [] };
  await installModelSnapshots(page, base);
    await page.route('**/api/extra-networks**', r => r.fulfill({ json: { loras: [], vaes: [], embeddings: { count: 0, items: [] } } }));
  await page.route('**/api/library/images**', r => r.fulfill({ json: { filter: 'all', total: 0, items: [] } }));
  await page.route(/\/api\/images\/[^/]+$/, r => r.fulfill({ contentType: 'image/png', body: PNG }));
  await page.route('**/api/actions/generate-controlled', r => { state.posts.push(r.request().postDataJSON()); r.fulfill({ json: { job_id: 'job-b1', status: 'queued', seeds: [1000, 1001, 1002, 1003] } }); });
  await page.route('**/api/jobs/job-b1', r => r.fulfill({ json: script(state) }));
  await openStudio(page, base + '/dexdiffusion/');
  await page.waitForFunction(() => window.__dex && __dex.state.capabilityData && __dex.state.modelTargets && __dex.state.modelTargets.length > 3);
  await page.evaluate(() => { __dex.setScreen('create'); __dex.setState({ target: 'sd15', prompt: 'a small red cube', seed: '1000' }); __dex.wsSet({ quantity: 4 }); });
  return { page, ctx, errors, state };
}
const doneCount = page => page.evaluate(() => (__dex._ws().results || []).filter(r => r.status === 'DONE').length);
const statuses = page => page.evaluate(() => (__dex._ws().results || []).map(r => r.status).join(','));

(async () => {
  const srv = process.env.DEX_TEST_BASE ? { base: process.env.DEX_TEST_BASE, stop() {} } : await startServer();
  const browser = await launchBrowser(chromium);
  try {
    await test('images appear one by one while the batch is still running; the Fast batch flag is off by default', async () => {
      let phase = 0;
      const { page, ctx, errors, state } = await boot(browser, srv.base, () => ({ id: 'job-b1', status: 'running', seeds: [1000, 1001, 1002, 1003], controlledTarget: 'sd15', stage: { key: 'generating', label: 'Generating', determinate: false }, results: Array.from({ length: phase }, (_, i) => cell(i)) }));
      await page.getByRole('button', { name: 'Generate image', exact: true }).click();
      await page.waitForFunction(() => __dex._ws().activeJobId === 'job-b1');
      assert.equal(state.posts[0].fast_batch, false, 'progressive sequential is the default'); assert.equal(state.posts[0].quantity, 4);
      assert.equal(await statuses(page), 'QUEUED,QUEUED,QUEUED,QUEUED');
      phase = 1; await page.waitForFunction(() => (__dex._ws().results || []).filter(r => r.status === 'DONE').length === 1, null, { timeout: 8000 });
      assert.equal(await statuses(page), 'DONE,QUEUED,QUEUED,QUEUED', 'first image visible while three cells are still pending');
      assert.equal(await page.evaluate(() => __dex.state.jobStatus), 'generating');
      assert.ok(await page.evaluate(() => !!__dex.state.currentImageSrc), 'the finished image is displayed');
      phase = 3; await page.waitForFunction(() => (__dex._ws().results || []).filter(r => r.status === 'DONE').length === 3, null, { timeout: 8000 });
      assert.equal(await statuses(page), 'DONE,DONE,DONE,QUEUED');
      assert.equal(new Set(await page.evaluate(() => __dex._ws().results.map(r => r.imageId).filter(Boolean))).size, 3, 'no duplicate result cards');
      assert.deepEqual(errors, []); await ctx.close();
    });

    await test('a failed last cell leaves the first three finished images and ends PARTIAL', async () => {
      let done = false;
      const { page, ctx } = await boot(browser, srv.base, () => ({ id: 'job-b1', status: done ? 'PARTIAL' : 'running', seeds: [1000, 1001, 1002, 1003], controlledTarget: 'sd15', stage: { key: 'generating', label: 'Generating' }, results: done ? [cell(0), cell(1), cell(2), cell(3, 'FAILED')] : [cell(0), cell(1), cell(2)] }));
      await page.getByRole('button', { name: 'Generate image', exact: true }).click();
      await page.waitForFunction(() => (__dex._ws().results || []).filter(r => r.status === 'DONE').length === 3, null, { timeout: 8000 });
      done = true;
      await page.waitForFunction(() => __dex.state.jobStatus === 'complete', null, { timeout: 8000 });
      assert.equal(await statuses(page), 'DONE,DONE,DONE,FAILED');
      await ctx.close();
    });

    await test('cancelling the remainder keeps finished images and returns Create to idle', async () => {
      let cancelled = false;
      const { page, ctx } = await boot(browser, srv.base, () => ({ id: 'job-b1', status: cancelled ? 'CANCELLED' : 'running', remoteStop: 'cancelled_verified', seeds: [1000, 1001, 1002, 1003], controlledTarget: 'sd15', stage: { key: 'generating', label: 'Generating' }, results: [cell(0), cell(1)] }));
      await page.getByRole('button', { name: 'Generate image', exact: true }).click();
      await page.waitForFunction(() => (__dex._ws().results || []).filter(r => r.status === 'DONE').length === 2, null, { timeout: 8000 });
      cancelled = true;
      await page.waitForFunction(() => __dex.state.jobStatus === 'idle', null, { timeout: 8000 });
      assert.equal(await doneCount(page), 2, 'finished images remain after cancellation');
      await ctx.close();
    });

    await test('a page refresh re-attaches to the running batch and restores finished cells and the batch size', async () => {
      const { page, ctx } = await boot(browser, srv.base, () => ({ id: 'job-b1', status: 'running', seeds: [1000, 1001, 1002, 1003], controlledTarget: 'sd15', stage: { key: 'generating', label: 'Generating' }, results: [cell(0), cell(1)] }));
      await page.getByRole('button', { name: 'Generate image', exact: true }).click();
      await page.waitForFunction(() => (__dex._ws().results || []).filter(r => r.status === 'DONE').length === 2, null, { timeout: 8000 });
      await page.reload();
      await page.waitForFunction(() => window.__dex && __dex.state.capabilityData);
      await page.waitForFunction(() => (__dex._ws().results || []).length === 4 && (__dex._ws().results || []).filter(r => r.status === 'DONE').length === 2, null, { timeout: 10000 });
      assert.equal(await statuses(page), 'DONE,DONE,QUEUED,QUEUED');
      await ctx.close();
    });
  } finally { await srv.stop(); }
  process.exit(exitCode());
})();
