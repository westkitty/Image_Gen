'use strict';
// Completion notifications: one ding per successful job (no repeat after SSE replay), none for failed/cancelled jobs, mute respected.
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { startServer, installModelSnapshots, runner, launchBrowser } = require('./helpers');
const { test, exitCode } = runner('notifications');

(async () => {
  const srv = process.env.DEX_TEST_BASE ? { base: process.env.DEX_TEST_BASE, stop() {} } : await startServer();
  const browser = await launchBrowser(chromium);
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', e => errors.push(String(e)));
    await page.addInitScript(() => {
      window.__es = []; window.__osc = 0;
      window.EventSource = class { constructor() { this.l = {}; window.__es.push(this); setTimeout(() => this.onopen && this.onopen(), 0); }
        addEventListener(t, f) { (this.l[t] = this.l[t] || []).push(f); } close() {} };
      const AC = class { constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; }
        resume() { return Promise.resolve(); }
        createOscillator() { window.__osc++; return { frequency: {}, connect() {}, start() {}, stop() {} }; }
        createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; } };
      window.AudioContext = AC;
    });
    await installModelSnapshots(page, srv.base);
    await page.route('**/api/extra-networks**', r => r.fulfill({ json: { loras: [], vaes: [], embeddings: { count: 0, items: [] } } }));
    await page.goto(srv.base + '/dexdiffusion/');
    await page.waitForFunction(() => window.__dex && window.DexNotify && window.__es.length > 0 && window.__es.some(e => (e.l['job.completed'] || []).length));
    const fire = (type, data) => page.evaluate(([t, d]) => { for (const es of window.__es) (es.l[t] || []).forEach(f => f({ data: JSON.stringify(d) })); }, [type, data]);
    const osc = () => page.evaluate(() => window.__osc);
    await test('a successful job dings once; replay of the same job id does not ding again', async () => {
      await page.evaluate(() => { localStorage.removeItem('dexdiffusion.notify.v1'); sessionStorage.removeItem('dexdiffusion.notify.seen.v1'); });
      const before = await osc();
      await fire('job.completed', { id: 'job-1', operation: 'txt2img' });
      assert.equal(await osc() - before, 2, 'two-note ding');
      await fire('job.completed', { id: 'job-1', operation: 'txt2img' });
      assert.equal(await osc() - before, 2, 'no repeat after replay');
    });
    await test('failed and cancelled jobs never ding', async () => {
      const before = await osc();
      await fire('job.failed', { id: 'job-2' }); await fire('job.cancelled', { id: 'job-3' });
      await fire('job.completed', { id: 'job-4', status: 'CANCELLED' });
      assert.equal(await osc(), before);
    });
    await test('mute silences the ding (preference persisted)', async () => {
      await page.evaluate(() => DexNotify.setMuted(true));
      const before = await osc();
      await fire('job.completed', { id: 'job-5', operation: 'img2img' });
      assert.equal(await osc(), before);
      assert.equal(await page.evaluate(() => DexNotify.prefs().muted), true);
    });
    assert.deepEqual(errors, []);
    await ctx.close();
  } finally { await srv.stop(); }
  process.exit(exitCode());
})();
