'use strict';
const assert = require('node:assert/strict');
const { chromium, webkit } = require('playwright-core');
const { startServer, launchBrowser, runCleanups, openStudio } = require('./helpers');

(async () => {
  const { base } = await startServer();
  const engines = [{ name: 'chromium', launch: () => launchBrowser(chromium) },
                   { name: 'webkit', launch: () => webkit.launch(Object.assign({ headless: true }, process.env.DEX_WEBKIT_PATH ? { executablePath: process.env.DEX_WEBKIT_PATH } : {})) }].filter(e => !process.env.DEX_TEST_ENGINE || e.name === process.env.DEX_TEST_ENGINE);
  try {
    for (const engine of engines) {
      let browser;
      try { browser = await engine.launch(); } catch (error) {
        if (engine.name === 'webkit' && !process.env.DEX_TEST_ENGINE) {
          console.warn('webkit browser unavailable; skipping optional WebKit check: ' + error.message.split('\n')[0]);
          continue;
        }
        console.error(engine.name + ' browser unavailable: ' + error.message);
        throw error;
      }
      try {
        // A page loading over an otherwise healthy server must not announce an outage
        // while its first health probe is still pending.
        const page = await browser.newPage({ serviceWorkers: 'block' });
        let release, sawInitial = false;
        const gate = new Promise(resolve => { release = resolve; });
        await page.route('**/api/version', async route => {
          if (!sawInitial) {
            sawInitial = true;
            await gate;
          }
          await route.continue().catch(() => {});
        });
        await openStudio(page, base + '/dexdiffusion/', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForFunction(() => window.__dex && __dex.state.backendOnline === null, null, { timeout: 15000 });
        assert.equal(await page.locator('[data-studio-offline]').count(), 0,
          engine.name + ': no false outage banner before a health result');
        release();
        await page.waitForFunction(() => __dex.state.backendOnline === true, null, { timeout: 15000 });
        assert.equal(await page.locator('[data-studio-offline]').count(), 0);

        // Losing the backend after Studio has opened must leave the current
        // workspace and unsent draft available for recovery without a reload.
        const prompt = page.locator('[data-dex-field="prompt"]');
        await prompt.fill('connectivity recovery draft');
        await page.evaluate(() => __dex.setScreen('library', { skipUnsavedGuard: true }));
        await page.waitForFunction(() => __dex.state.screens[__dex.state.version] === 'library');

        // One transient fetch failure should not immediately erase an established
        // healthy connection. Two distinct failed attempts do mark an outage.
        await page.unroute('**/api/version');
        // Freeze incidental window-focus/interval polling while testing two controlled probes.
        await page.evaluate(() => {
          clearInterval(__dex._pingTimer);
          window.removeEventListener('focus', __dex._backendResumeHandler);
          window.removeEventListener('online', __dex._backendResumeHandler);
          document.removeEventListener('visibilitychange', __dex._backendVisibilityHandler);
        });
        let failedProbes = 0, releaseSecond;
        const secondGate = new Promise(resolve => { releaseSecond = resolve; });
        await page.route('**/api/version', async route => {
          failedProbes++;
          if (failedProbes === 2) await secondGate;
          await route.abort('failed').catch(() => {});
        });
        await page.evaluate(() => __dex.pingBackend());
        try {
          await page.waitForFunction(() => __dex._pingFailures === 1, null, { timeout: 15000 });
        } catch (err) {
          console.error(engine.name + ' connectivity debug', { failedProbes,
            state: await page.evaluate(() => ({ online: __dex.state.backendOnline,
              failures: __dex._pingFailures, generation: __dex._pingGeneration,
              backendUrl: __dex.state.backendUrl, mounted: __dex._backendMounted,
              retryPending: !!__dex._pingRetryTimer })) });
          releaseSecond();
          throw err;
        }
        assert.equal(await page.evaluate(() => __dex.state.backendOnline), true,
          engine.name + ': first transient failure preserves last verified availability');
        releaseSecond();
        await page.waitForFunction(() => __dex.state.backendOnline === false, null, { timeout: 15000 });
        assert.ok(failedProbes >= 2, engine.name + ': two distinct probes were attempted');
        assert.match(await page.locator('[data-studio-offline]').innerText(), /Connection lost/);
        assert.equal(await page.evaluate(() => __dex.state.screens[__dex.state.version]), 'library',
          engine.name + ': outage keeps the active workspace');
        assert.equal(await page.evaluate(() => __dex.state.prompt), 'connectivity recovery draft',
          engine.name + ': outage keeps the unsent prompt draft');
        await page.unroute('**/api/version');
        await page.locator('[data-studio-offline]').getByRole('button', { name: 'Retry connection' }).click();
        await page.waitForFunction(() => __dex.state.backendOnline === true, null, { timeout: 15000 });
        await page.locator('[data-studio-offline]').waitFor({ state: 'detached', timeout: 5000 });
        assert.equal(await page.locator('[data-studio-offline]').count(), 0,
          engine.name + ': manual retry clears outage without reloading the Studio');
        await page.close();

        // WKWebView environments without AbortSignal.timeout must still probe
        // successfully: ping uses AbortController and a cleared timer instead.
        const oldSafari = await browser.newPage({ serviceWorkers: 'block' });
        await openStudio(oldSafari, base + '/dexdiffusion/', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await oldSafari.evaluate(() => {
          try { Object.defineProperty(AbortSignal, 'timeout', { configurable: true, value: undefined }); } catch (_) {}
        });
        await oldSafari.evaluate(() => __dex.pingBackend());
        await oldSafari.waitForFunction(() => window.__dex && __dex.state.backendOnline === true, null, { timeout: 15000 });
        assert.equal(await oldSafari.locator('[data-studio-offline]').count(), 0);
        await oldSafari.close();

        // Late results from an obsolete request must never override a newer success.
        const racing = await browser.newPage({ serviceWorkers: 'block' });
        let releaseLate, startedLate, first = true;
        const lateGate = new Promise(resolve => { releaseLate = resolve; });
        const firstStarted = new Promise(resolve => { startedLate = resolve; });
        await racing.route('**/api/version', async route => {
          if (first) {
            first = false;
            startedLate();
            await lateGate;
            await route.abort('failed').catch(() => {});
          } else {
            await route.continue().catch(() => {});
          }
        });
        await openStudio(racing, base + '/dexdiffusion/', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await firstStarted;
        await racing.waitForFunction(() => window.__dex !== undefined, null, { timeout: 10000 });
        await racing.evaluate(() => __dex.pingBackend());
        await racing.waitForTimeout(200);
        assert.equal(await racing.evaluate(() => __dex._pingController !== null), true,
          engine.name + ': a second probe must not cancel a blocked first probe');
        releaseLate();
        await racing.waitForFunction(() => __dex.state.backendOnline === true, null, { timeout: 15000 });
        assert.equal(await racing.evaluate(() => __dex.state._pingFailures || __dex._pingFailures), 0,
          engine.name + ': transient failure followed by a valid retry resets failures');
        assert.equal(await racing.evaluate(() => __dex.state.backendOnline), true,
          engine.name + ': the native recovery policy preserves eventual success');
        await racing.close();
        console.log(engine.name + ': connectivity startup, two-strike outage, retry, WebKit-safe timeout, single-flight retry PASS');
      } finally {
        await browser.close();
      }
    }
    console.log('STUDIO_CONNECTIVITY_REGRESSION_PASS');
  } finally {
    await runCleanups();
  }
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
