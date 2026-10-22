'use strict';
// P13: Interrupt in Create — the button appears only while a job runs, posts the cancel, and reports whether the Big Mac
// side was confirmed stopped (stubbed backend; the real remote stop is proven by tests/remote-cancel.test.js and live runs).
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { startServer, installModelSnapshots, installImageFixtures, runner, launchBrowser, runCleanups, openStudio } = require('./helpers');

const FX = { 'fx-landscape.png': { w: 800, h: 500, meta: { operation: 'txt2img', target: 'sd15', seed: 1, steps: 20, cfg: 7, sampler: 'euler_a', scheduler: 'discrete', vae: 'auto', loras: [], gen_schema: 1, prompt_saved: false } } };
const { test, results, exitCode } = runner('interrupt');

async function newPage(browser, base, cancelReply) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [], cancels = [];
  let cancelled = false;
  page.on('pageerror', e => errors.push(String(e)));
  await installModelSnapshots(page, base);
    await installImageFixtures(page, FX);
  await page.route('**/api/extra-networks**', r => r.fulfill({ json: { loras: [], vaes: [], embeddings: { count: 0, items: [] } } }));
  await page.route('**/api/models/secondary/activate', r => r.fulfill({ json: { ok: true, activeSecondaryModel: 'sd15', modelState: {} } }));
  await page.route('**/api/actions/generate-controlled', r => r.fulfill({ json: { job_id: 'job-int-1', status: 'running', seeds: [11], quantity: 1 } }));
  // OP-7 contract: 200 + remote_stop 'verified' only for a verified stop; 202 + remote_stop 'unverified' (quarantine) otherwise.
  await page.route('**/api/jobs/job-int-1/cancel', r => { cancels.push(r.request().postDataJSON()); cancelled = true; r.fulfill(cancelReply.ok
    ? { json: { ok: true, status: 'CANCELLED', remote_stop: 'verified' } }
    : { status: 202, json: { ok: false, status: 'CANCELLED', remote_stop: 'unverified', quarantine: true, gate: 'remote-stop-unverified', error: cancelReply.error } }); });
  await page.route('**/api/jobs/job-int-1', r => r.fulfill({ json: cancelled
    ? { id: 'job-int-1', status: 'CANCELLED', firstFailedGate: 'user-cancelled', remoteStop: cancelReply.ok ? 'cancelled_verified' : 'stop_unverified', remoteCancel: { ok: !!cancelReply.ok }, results: [] }
    : { id: 'job-int-1', status: 'running', commandAction: 'controlled-generate', progress: null, results: [] } }));
  await openStudio(page, base + '/dexdiffusion/');
  await page.waitForFunction(() => window.__dex && __dex.state.modelTargets && __dex.state.modelTargets.length > 3 && __dex.state.capabilityData);
  await page.evaluate(() => { __dex.setState({ prompt: 'a cup', target: 'sd15' }); __dex.setScreen('create'); });
  return { page, ctx, errors, cancels };
}
const toasts = page => page.evaluate(() => __dex.state.toasts.map(t => t.msg));

(async () => {
  const srv = process.env.DEX_TEST_BASE ? { base: process.env.DEX_TEST_BASE, stop() {} } : await startServer();
  const browser = await launchBrowser(chromium);
  try {
    await test('Interrupt is hidden when idle, appears while generating, and a confirmed stop returns Create to idle', async () => {
      const { page, ctx, errors, cancels } = await newPage(browser, srv.base, { ok: true });
      assert.equal(await page.locator('[data-cancel-job]').count(), 0);
      await page.getByRole('button', { name: 'Generate image', exact: true }).click();
      await page.waitForSelector('[data-cancel-job]');
      await page.click('[data-cancel-job]');
      await page.waitForFunction(() => __dex.state.jobStatus === 'idle');
      assert.equal(cancels.length, 1);
      assert.ok((await toasts(page)).some(t => /cancelled · Big Mac stop verified/i.test(t)), JSON.stringify(await toasts(page)));
      assert.equal(await page.locator('[data-cancel-job]').count(), 0);
      assert.equal(await page.getByRole('button', { name: 'Generate image', exact: true }).isDisabled(), false, 'Generate is available again');
      assert.deepEqual(errors, []);
      await ctx.close();
    });
    await test('an unverified remote stop is reported as such (heavy work paused), never as success', async () => {
      const { page, ctx } = await newPage(browser, srv.base, { ok: false, error: 'Cancelled locally, but the Big Mac side could not be verified stopped.' });
      await page.getByRole('button', { name: 'Generate image', exact: true }).click();
      await page.waitForSelector('[data-cancel-job]');
      await page.click('[data-cancel-job]');
      await page.waitForFunction(() => __dex.state.toasts.some(t => /could not be verified/.test(t.msg)));
      await page.waitForFunction(() => __dex._ws().interruptState === 'unverified');
      // The request-level answer was 'unverified'; the job record (stubbed CANCELLED + stop_unverified) then settles the screen.
      await page.waitForFunction(() => __dex.state.jobStatus === 'idle', null, { timeout: 15000 });
      const all = await toasts(page);
      assert.ok(!all.some(t => /stop verified|confirmed stopped/i.test(t)), JSON.stringify(all));
      assert.ok(all.some(t => /unable to verify the Big Mac stop — heavy work paused/.test(t)), JSON.stringify(all));
      await ctx.close();
    });
  } finally {
    await browser.close(); srv.stop && srv.stop();
    await runCleanups();
  }
  process.exitCode = exitCode(results.some(r => r[0] !== 'PASS'));
})().catch(async e => { console.error(e); await runCleanups(); process.exitCode = 2; });
