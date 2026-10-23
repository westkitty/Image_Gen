'use strict';
// V2 parity rows 4 (Job Center), 5 (help), 6 (contextual information) and 7 (connection truth).
// The console is a real isolated server; job snapshots and cancel replies are fixtures. No inference runs.
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { startServer, installModelSnapshots, runner, launchBrowser, runCleanups, openStudio, chooseModel } = require('./helpers');

const { test, results, exitCode } = runner('v2-parity-assistance');

const JOBS = {
  active: [
    { id: 'job-run-1', label: 'Image generation', operation: 'controlled-generate', mediaKind: 'image', worker: 'sdcpp', status: 'RUNNING', canCancel: true, progress: { percent: 40, determinate: true }, createdAt: new Date().toISOString() },
    { id: 'job-run-2', label: 'Drama production', operation: 'drama-production', mediaKind: 'voice', worker: 'drama-producer', status: 'RUNNING', canCancel: true, createdAt: new Date().toISOString() }],
  queue: [{ id: 'job-q-1', label: 'Queued batch', operation: 'batch', mediaKind: 'image', worker: 'sdcpp', status: 'QUEUED', canCancel: true, createdAt: new Date().toISOString() }],
  recent: [
    { id: 'job-done-1', label: 'Finished image', operation: 'controlled-generate', mediaKind: 'image', worker: 'sdcpp', status: 'COMPLETE', elapsedMs: 12000, results: [{}, {}], createdAt: new Date().toISOString() },
    { id: 'job-bad-1', label: 'Failed edit', operation: 'edit', mediaKind: 'image', worker: 'sdcpp', status: 'FAILED', firstFailedGate: 'worker-exit', createdAt: new Date().toISOString() }],
  resources: {},
};

// Row 6 (Context follows the real Create state) has timed out intermittently with no reproduced cause. On that timeout only, attach the
// state that separates the candidate causes (wrong target/sampler, swallowed render error, throttled animation frames, console errors)
// and rethrow the original error: the assertion and its timeout are unchanged.
async function failWithEvidence(page, consoleLog, err) {
  let evidence;
  try {
    evidence = await page.evaluate(async () => {
      const d = window.__dex, out = {};
      const grab = (k, f) => { try { out[k] = f(); } catch (e) { out[k] = 'unreadable: ' + e; } };
      grab('target', () => d.state.target); grab('sampler', () => d.state.sampler);
      grab('controlsSampler', () => d._controls().sampler);
      grab('fluxTarget', () => { const t = (d.state.modelTargets || []).find(x => x.id === 'flux2-klein-4b'); return t && { backend: t.backend, runtime: t.runtime, status: t.status }; });
      grab('dexTarget', () => localStorage.getItem('dex_target'));
      grab('drawerText', () => (document.querySelector('[data-v2-drawer="context"]') || {}).innerText);
      grab('visibility', () => document.visibilityState);
      grab('renderError', () => d.__renderError && String(d.__renderError.stack || d.__renderError).slice(0, 600));
      grab('renderFailures', () => d.__renderFailures);
      let raf = 'STARVED';
      await new Promise(res => { requestAnimationFrame(() => { raf = 'alive'; res(); }); setTimeout(res, 1500); });
      out.rafProbe = raf;
      return out;
    });
  } catch (e) { evidence = { captureFailed: String(e) }; }
  err.message += '\nROW6-CONTEXT-EVIDENCE ' + JSON.stringify({ ...evidence, console: consoleLog });
  throw err;
}

async function open(page, base, { jobs = false } = {}) {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await installModelSnapshots(page, base);
  if (jobs) {
    await page.route('**/api/events', r => r.abort());   // the live stream would push the real (empty) snapshot over the fixture
    await page.route('**/api/operations/snapshot', r => r.fulfill({ json: JOBS }));
  }
  await openStudio(page, base + '/dexdiffusion/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__dex && __dex.state.version === 2 && __dex.state.modelTargets && __dex.state.modelTargets.length > 3);
  return errors;
}

(async () => {
  const srv = process.env.DEX_TEST_BASE ? { base: process.env.DEX_TEST_BASE, stop() {} } : await startServer();
  const browser = await launchBrowser(chromium);
  try {
    for (const [w, h] of [[1348, 735], [390, 844]]) {
      await test(`row 5: Help opens module tutorials from the V2 header at ${w}x${h}; Escape closes and returns focus`, async () => {
        const page = await browser.newPage({ viewport: { width: w, height: h } });
        const errors = await open(page, srv.base);
        const btn = page.locator('[data-studio-help]');
        assert.equal(await btn.isVisible(), true, 'Help is a visible V2 control');
        const box = await btn.boundingBox();
        assert.ok(box.height >= (w <= 600 ? 44 : 30), 'target height ' + box.height);
        await btn.focus(); await page.keyboard.press('Enter');
        const drawer = page.locator('[data-v2-drawer="help"]');
        await drawer.waitFor({ state: 'visible' });
        assert.equal(await drawer.getAttribute('role'), 'dialog'); assert.equal(await drawer.getAttribute('aria-modal'), 'false');
        assert.match(await drawer.innerText(), /Generate runs the existing controlled image-generation paths/);
        const r = await drawer.boundingBox(); assert.ok(r.x >= -1 && r.x + r.width <= w + 1, 'drawer fits the viewport');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'no horizontal overflow');
        // The tutorial follows the active module and never invents a capability.
        await page.keyboard.press('Escape');
        await drawer.waitFor({ state: 'hidden' });
        await page.waitForFunction(() => document.activeElement && document.activeElement.hasAttribute('data-studio-help'), null, { timeout: 5000 }).catch(() => { throw new Error('focus did not return to the Help button'); });
        for (const [screen, re] of [['library', /Media is the asset hub/], ['music', /Stems or Mastering unavailable|planned/i], ['voice', /Voice exposes the installed and proven speech workers/]]) {
          await page.evaluate(s => __dex.setScreen(s), screen);
          await btn.click(); await drawer.waitFor({ state: 'visible' });
          assert.match(await drawer.innerText(), re, screen);
          await page.locator('[data-v2-drawer-close]').click(); await drawer.waitFor({ state: 'hidden' });
        }
        assert.deepEqual(errors, []);
        await page.close();
      });
    }

    await test('row 5: Escape closes the drawer even when focus is not inside it', async () => {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      const errors = await open(page, srv.base);
      for (const kind of ['help', 'context']) {
        const btn = page.locator(`[data-studio-${kind}]`);
        await btn.focus();
        await page.keyboard.press('Enter');
        await page.locator('[data-v2-drawer]').waitFor({ state: 'visible' });
        await page.waitForTimeout(200);   // let the drawer take focus, then move focus out of it (to <body>): Escape must still close it
        await page.evaluate(() => { if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); });
        assert.equal(await page.evaluate(() => !document.querySelector('[data-v2-drawer-host]').contains(document.activeElement)), true, 'focus is outside the drawer');
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !document.querySelector('[data-v2-drawer]') || !document.querySelector('[data-v2-drawer]').offsetParent, null, { timeout: 5000 });
        await page.waitForFunction(k => document.activeElement && document.activeElement.hasAttribute('data-studio-' + k), kind, { timeout: 5000 });
      }
      assert.deepEqual(errors, []);
      await page.close();
    });

    await test('row 5: the drawer\'s delayed focus never steals focus from a control the user already reached inside it', async () => {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      const errors = await open(page, srv.base);
      // Hold the drawer's 30ms focus timer so its firing can be ordered deterministically against the user's own focus move.
      await page.evaluate(() => {
        window.__heldFocus = []; window.__realSetTimeout = window.setTimeout;
        window.setTimeout = (fn, ms, ...a) => { if (ms === 30) { window.__heldFocus.push(fn); return 0; } return window.__realSetTimeout(fn, ms, ...a); };
      });
      await page.locator('[data-studio-context]').focus(); await page.keyboard.press('Enter');
      await page.locator('[data-v2-drawer="context"]').waitFor({ state: 'visible' });
      await page.evaluate(() => { window.setTimeout = window.__realSetTimeout; });
      assert.ok(await page.evaluate(() => window.__heldFocus.length) >= 1, 'the drawer scheduled its delayed focus');
      // Focus still outside the drawer: the timer must still move focus in (keyboard users land in the dialog).
      await page.evaluate(() => window.__heldFocus.forEach(f => f()));
      assert.equal(await page.evaluate(() => document.activeElement.hasAttribute('data-v2-drawer')), true, 'drawer takes focus when it is not already inside');
      // The user moves to a tab control before a late timer fires: the timer must leave that focus alone.
      await page.locator('[data-v2-drawer-tab="help"]').focus();
      await page.evaluate(() => window.__heldFocus.forEach(f => f()));
      assert.equal(await page.evaluate(() => document.activeElement.getAttribute('data-v2-drawer-tab')), 'help', 'late focus timer must not steal focus from the tab control');
      await page.keyboard.press('Enter');
      await page.locator('[data-v2-drawer="help"]').waitFor({ state: 'visible' });
      await page.keyboard.press('Escape'); await page.locator('[data-v2-drawer]').waitFor({ state: 'hidden' });
      assert.deepEqual(errors, []);
      await page.close();
    });

    await test('row 6: Context follows the real Create state and the selected library asset, without changing either', async () => {
      const page = await browser.newPage({ viewport: { width: 1348, height: 735 } });
      const consoleLog = []; page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') consoleLog.push(m.type() + ': ' + m.text().slice(0, 300)); });
      const errors = await open(page, srv.base);
      await chooseModel(page, 'sdxl-base');
      await page.evaluate(() => __dex.setState({ sampler: 'heun', steps: '17', prompt: 'keep me' }));
      const before = await page.evaluate(() => ({ t: __dex.state.target, p: __dex.state.prompt, s: __dex.state.steps }));
      await page.locator('[data-studio-context]').click();
      const drawer = page.locator('[data-v2-drawer="context"]'); await drawer.waitFor({ state: 'visible' });
      const text = await drawer.innerText();
      assert.match(text, /Target\s*SDXL/i); assert.match(text, /Steps \/ seed\s*17/); assert.match(text, /Sampler\s*heun/i);
      // The drawer is a non-modal overlay on the right; drive the model change through app state while it is open.
      await page.evaluate(() => __dex.onSelectTarget('flux2-klein-4b', { quiet: true, preserveSettings: true }));
      await page.waitForFunction(() => /Fixed \(flow-match Euler\)/.test(document.querySelector('[data-v2-drawer="context"]').innerText), null, { timeout: 15000 })
        .catch(err => failWithEvidence(page, consoleLog, err));
      assert.equal(await page.evaluate(() => __dex.state.prompt), 'keep me', 'opening Context never edits the form');
      assert.notEqual(before.t, await page.evaluate(() => __dex.state.target));
      // Library: nothing selected -> honest empty state.
      // The unsaved-work guard still applies while the drawer is open: declining keeps the screen and the typed prompt.
      const asked = []; page.once('dialog', d => { asked.push(d.message()); d.dismiss(); });
      assert.equal(await page.evaluate(() => __dex.setScreen('library')), false);
      assert.match(asked[0] || '', /not saved|Switch workspaces/i);
      assert.equal(await page.evaluate(() => __dex.state.screens[2]), 'create'); assert.equal(await page.evaluate(() => __dex.state.prompt), 'keep me');
      page.once('dialog', d => d.accept());
      assert.equal(await page.evaluate(() => __dex.setScreen('library')), true);
      await page.waitForFunction(() => /Select an indexed image/.test(document.querySelector('[data-v2-drawer="context"]').innerText), null, { timeout: 10000 })
        .catch(async e => { throw new Error('Library context text was: ' + JSON.stringify((await page.locator('[data-v2-drawer]').innerText()).slice(0, 400))); });
      assert.deepEqual(errors, []);
      await page.close();
    });

    await test('row 6: Context at 390x844 stays inside the viewport and is keyboard-operable', async () => {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      const errors = await open(page, srv.base);
      await page.locator('[data-studio-context]').focus(); await page.keyboard.press('Enter');
      const drawer = page.locator('[data-v2-drawer="context"]'); await drawer.waitFor({ state: 'visible' });
      const b = await drawer.boundingBox(); assert.ok(b.x >= -1 && b.x + b.width <= 391);
      // The drawer takes focus on a short timer after it opens; wait for that real event so it cannot land between the tab focus and Enter.
      await page.waitForFunction(() => document.activeElement && document.activeElement.hasAttribute('data-v2-drawer'), null, { timeout: 5000 });
      await page.locator('[data-v2-drawer-tab="help"]').focus(); await page.keyboard.press('Enter');
      await page.locator('[data-v2-drawer="help"]').waitFor({ state: 'visible' });
      await page.keyboard.press('Escape'); await page.locator('[data-v2-drawer]').waitFor({ state: 'hidden' });
      assert.deepEqual(errors, []);
      await page.close();
    });

    for (const [w, h] of [[1348, 735], [390, 844]]) {
      await test(`row 4: Job Center is reachable at ${w}x${h} and shows active, queued and recent work truthfully`, async () => {
        const page = await browser.newPage({ viewport: { width: w, height: h } });
        const errors = await open(page, srv.base, { jobs: true });
        await page.evaluate(j => { __DEX_V12.snapshot = j; }, JOBS);
        const jobs = page.locator('[data-studio-jobs]');
        assert.equal(await jobs.isVisible(), true, 'Jobs control is visible');
        await jobs.click();
        const dr = page.locator('#v12-job-center-drawer'); await dr.waitFor({ state: 'visible' });
        await page.waitForFunction(() => /Image generation/.test(document.querySelector('#v12-job-center-drawer').innerText));
        const t = await dr.innerText();
        assert.match(t, /ACTIVE \(2\)/); assert.match(t, /QUEUE \(1\)/); assert.match(t, /RECENT \(2\)/);
        assert.match(t, /40%/, 'determinate progress is shown as a number');
        assert.match(t, /Progress unavailable · current stage is indeterminate/, 'indeterminate work is not given a made-up percentage');
        assert.match(t, /COMPLETE/); assert.match(t, /FAILED/); assert.match(t, /Gate: worker-exit/);
        // Inspect one job: details are real snapshot fields, and they stay open across re-renders.
        const det = dr.locator('[data-job-detail="job-bad-1"]');
        await det.locator('summary').click();
        assert.match(await det.innerText(), /First failed gate\s*worker-exit/); assert.match(await det.innerText(), /Job ID\s*job-bad-1/);
        await page.evaluate(j => { __DEX_V12.snapshot = JSON.parse(JSON.stringify(j)); }, JOBS);
        await page.evaluate(() => { const f = window.__DEX_V12; if (typeof f.fetchSnapshot === 'function') f.fetchSnapshot(); });
        await page.waitForTimeout(400);
        assert.equal(await dr.locator('[data-job-detail="job-bad-1"]').evaluate(e => e.open), true, 'details survive a refresh');
        assert.deepEqual(errors, []);
        await page.close();
      });
    }

    await test('row 4: cancelling distinguishes a request from a confirmed stop (and a queued job from a running one)', async () => {
      const page = await browser.newPage({ viewport: { width: 1348, height: 735 } });
      const errors = await open(page, srv.base, { jobs: true });
      const calls = [], msgs = [];
      await page.route('**/api/jobs/*/cancel', r => { calls.push(r.request().url().split('/').slice(-2)[0]); const id = calls[calls.length - 1];
        r.fulfill(id === 'job-q-1' ? { json: { ok: true, neverStarted: true, status: 'CANCELLED' } } : { status: 202, json: { ok: false, accepted: true, status: 'RUNNING', remote_stop: 'unverified', terminationVerified: false } }); });
      page.on('dialog', async d => { msgs.push(d.message()); await d.accept(); });
      await page.evaluate(j => { __DEX_V12.snapshot = j; }, JOBS);
      await page.locator('[data-studio-jobs]').click();
      const dr = page.locator('#v12-job-center-drawer'); await dr.waitFor({ state: 'visible' });
      await dr.locator('[data-job-cancel-id="job-run-1"]').click();
      await page.waitForFunction(() => true); for (let i = 0; i < 40 && msgs.length < 2; i++) await page.waitForTimeout(100);
      assert.match(msgs[0], /may continue until the worker confirms it stopped/);
      assert.match(msgs[1], /not verified|may still be running/i, 'an unverified stop is never reported as stopped');
      assert.ok(!msgs.some(m => /cancelled successfully|has been cancelled|stop verified/i.test(m)));
      await dr.locator('[data-job-cancel-id="job-q-1"]').click();
      for (let i = 0; i < 40 && msgs.length < 3; i++) await page.waitForTimeout(100);
      assert.match(msgs[2], /Cancel this queued job before it starts/);
      assert.deepEqual(calls, ['job-run-1', 'job-q-1']);
      assert.deepEqual(errors, []);
      await page.close();
    });

    await test('row 7: losing the console is reported as offline everywhere and recovery is truthful', async () => {
      const page = await browser.newPage({ viewport: { width: 1348, height: 735 } });
      const errors = await open(page, srv.base);
      assert.equal(await page.locator('[data-studio-offline]').count(), 0, 'no offline banner while the console answers');
      await page.route('**/api/version', r => r.abort());
      await page.evaluate(() => __dex.pingBackend());
      await page.locator('[data-studio-offline]').waitFor({ state: 'visible' });
      assert.match(await page.locator('[data-studio-offline]').innerText(), /Connection lost/);
      await page.evaluate(() => __dex.setScreen('system'));
      assert.match(await page.locator('[data-scroll-pane]').first().innerText(), /Offline/);
      await page.unroute('**/api/version');
      await page.locator('[data-studio-offline] button', { hasText: 'Retry connection' }).click();
      await page.locator('[data-studio-offline]').waitFor({ state: 'detached' });
      assert.equal(await page.evaluate(() => __dex.state.backendOnline), true);
      // Context (System) exposes the event-stream and queue truth rather than a canned "online".
      await page.locator('[data-studio-context]').click();
      const t = await page.locator('[data-v2-drawer="context"]').innerText();
      assert.match(t, /Event stream\s*(Connected|Reconnecting)/); assert.match(t, /Active jobs\s*\d/); assert.match(t, /Target count\s*\d+/);
      assert.deepEqual(errors.filter(e => !/Failed to fetch|aborted/i.test(e)), []);
      await page.close();
    });

    await test('row 7/52: System Doctor renders real check rows and states, and a failing check is not hidden', async () => {
      const page = await browser.newPage({ viewport: { width: 1348, height: 735 } });
      const errors = await open(page, srv.base);
      await page.route('**/api/doctor', r => r.fulfill({ json: { overall: 'FAIL', rows: [{ check: 'Console', state: 'PASS', detail: 'listening on loopback' }, { check: 'Big Mac worker', state: 'FAIL', detail: 'socket not answering' }] } }));
      await page.evaluate(() => __dex.setScreen('system'));
      await page.getByRole('button', { name: 'Run Doctor' }).click();
      await page.waitForFunction(() => /Big Mac worker/.test(document.body.innerText));
      const t = await page.locator('[data-scroll-pane]').first().innerText();
      assert.match(t, /PASS\s*Console/); assert.match(t, /FAIL\s*Big Mac worker[\s\S]*socket not answering/); assert.match(t, /DEXDIFFUSION DOCTOR\s*FAIL/i);
      assert.deepEqual(errors, []);
      await page.close();
    });
  } finally {
    await runCleanups();
  }
  process.exitCode = exitCode(results.some(r => r[0] !== 'PASS'));
})().catch(async e => { console.error(e); await runCleanups(); process.exitCode = 2; });
