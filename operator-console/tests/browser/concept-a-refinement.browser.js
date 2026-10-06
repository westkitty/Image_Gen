'use strict';
// Focused Concept A.1 acceptance: shell identity, live-state bindings, Help, queue dock,
// planned-control truth, and narrow geometry. This suite does not generate or create records.
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { startServer, installModelSnapshots, runner, launchBrowser, runCleanups } = require('./helpers');

const { test, results, exitCode } = runner('concept-a-refinement');

async function openConcept(page, base) {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await installModelSnapshots(page, base);
  await page.goto(base + '/dexdiffusion/', { waitUntil: 'domcontentloaded' });
  if (!(await page.locator('.ca-shell').count())) {
    await page.locator('[data-vbtn="4"]').click();
  }
  await page.waitForSelector('.ca-shell');
  await page.waitForTimeout(250);
  return errors;
}

(async () => {
  const srv = process.env.DEX_TEST_BASE ? { base: process.env.DEX_TEST_BASE, stop() {} } : await startServer();
  const browser = await launchBrowser(chromium);
  try {
    await test('Concept A.1 shell has Dexter, ten SVG modules, and accent state', async () => {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const errors = await openConcept(page, srv.base);
      assert.equal(await page.locator('.ca-nav-item').count(), 10);
      assert.equal(await page.locator('.ca-nav-item .ca-svg-icon').count(), 10);
      assert.ok(await page.locator('.ca-brand img[src*="grok_image_1775521844329.jpg"]').count());
      assert.equal(await page.locator('.ca-shell[data-ca-module="workstation"]').count(), 1);
      await page.locator('.ca-nav-item', { hasText: 'Generate' }).click();
      await page.waitForSelector('.ca-shell[data-ca-module="generate"]');
      assert.match(await page.locator('.ca-primary').first().evaluate(e => getComputedStyle(e).backgroundColor), /rgb/);
      assert.deepEqual(errors, []);
      await page.close();
    });

    await test('contextual inspector and Generate result remain live surfaces', async () => {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const errors = await openConcept(page, srv.base);
      await page.locator('.ca-nav-item', { hasText: 'Generate' }).click();
      await page.waitForSelector('.ca-shell[data-ca-module="generate"]');
      assert.equal(await page.locator('.ca-inspector').count(), 1);
      assert.match(await page.locator('.ca-inspector').innerText(), /Target|Output|Prompt record/);
      assert.ok(await page.locator('.ca-results-column').count());
      assert.ok(await page.locator('.ca-results-column').locator('h3').count());
      assert.deepEqual(errors, []);
      await page.close();
    });

    await test('Help provides step cards, FAQ disclosure, and full tutorial routing', async () => {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const errors = await openConcept(page, srv.base);
      await page.locator('.ca-nav-item', { hasText: 'Generate' }).click();
      await page.waitForSelector('.ca-shell[data-ca-module="generate"]');
      await page.locator('[data-ca-open-help="generate"]').first().click();
      await page.waitForSelector('[data-ca-help-dialog]');
      assert.ok(await page.locator('.ca-help-step').count() >= 2);
      await page.locator('[data-ca-help-tab="faq"]').click();
      await page.waitForTimeout(250);
      assert.ok(await page.locator('.ca-help-faq details').count() >= 1);
      await page.locator('.ca-help-faq details').first().locator('summary').press('Enter');
      assert.equal(await page.locator('.ca-help-faq details').first().evaluate(e => e.open), true);
      await page.locator('button', { hasText: 'View full tutorial' }).click();
      await page.waitForSelector('.ca-shell[data-ca-module="settings"]');
      assert.equal(await page.locator('.ca-help-search input[type="search"]').count(), 1);
      assert.deepEqual(errors, []);
      await page.close();
    });

    await test('queue dock expands from the shared V12 snapshot and Music planned tabs stay disabled', async () => {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const errors = await openConcept(page, srv.base);
      const snapshotCounts = await page.evaluate(() => ({ active: (__DEX_V12.snapshot.active || []).length, queue: (__DEX_V12.snapshot.queue || []).length, recent: (__DEX_V12.snapshot.recent || []).length }));
      await page.locator('.ca-queue-bar button').first().click();
      await page.waitForSelector('.ca-queue-expanded');
      assert.equal(await page.locator('.ca-queue-column').count(), 3);
      const rendered = await page.locator('.ca-queue-column h4 span').allTextContents();
      const snapshotAfter = await page.evaluate(() => ({ active: (__DEX_V12.snapshot.active || []).length, queue: (__DEX_V12.snapshot.queue || []).length, recent: (__DEX_V12.snapshot.recent || []).length }));
      assert.deepEqual(rendered.map(Number), [snapshotAfter.active, snapshotAfter.queue, snapshotAfter.recent], 'queue counts rendered=' + JSON.stringify(rendered) + ' snapshot=' + JSON.stringify(snapshotAfter) + ' initial=' + JSON.stringify(snapshotCounts));
      await page.locator('.ca-nav-item', { hasText: 'Music' }).click();
      await page.waitForSelector('.ca-shell[data-ca-module="music"]');
      const planned = await page.locator('.ca-header-tabs button:disabled').allTextContents();
      assert.ok(planned.some(x => /Stems/.test(x)));
      assert.ok(planned.some(x => /Mastering/.test(x)));
      await page.locator('.ca-header-tabs button', { hasText: 'Instrumental' }).click();
      assert.equal(await page.evaluate(() => __dex._mws().instrumental), true);
      await page.waitForFunction(() => [...document.querySelectorAll('.ca-header-tabs button')].some(b => b.textContent.includes('Instrumental') && b.getAttribute('aria-selected') === 'true'));
      assert.equal(await page.locator('.ca-header-tabs button', { hasText: 'Instrumental' }).getAttribute('aria-selected'), 'true');
      await page.locator('.ca-header-tabs button', { hasText: 'Song' }).click();
      assert.equal(await page.evaluate(() => __dex._mws().instrumental), false);
      assert.deepEqual(errors, []);
      await page.close();
    });

    await test('queue progress is truthful and Help delegation is removed on teardown', async () => {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const errors = await openConcept(page, srv.base);
      await page.evaluate(() => {
        __DEX_V12.snapshot = {
          active: [
            { id: 'measured', label: 'Measured job', status: 'RUNNING', progress: { currentRunPercent: 25, totalPercent: 40 } },
            { id: 'unknown', label: 'Unknown job', status: 'RUNNING', progress: null },
          ],
          queue: [], recent: [], resources: {}, timing: null,
        };
        __DEX_V12.activeJobCount = 2;
        __DEX_V12.queuedJobCount = 0;
        __dex.caSync();
      });
      await page.locator('.ca-queue-bar button').first().click();
      const measured = page.locator('.ca-queue-row', { hasText: 'Measured job' });
      assert.equal(await measured.locator('[role=progressbar]').getAttribute('aria-valuenow'), '40');
      assert.equal(await page.locator('.ca-queue-row', { hasText: 'Unknown job' }).locator('[role=progressbar]').count(), 0);
      await page.evaluate(() => __DEX_V12.toggleJobCenter());
      assert.match(await page.locator('#v12-jc-content').innerText(), /Progress unavailable/);
      assert.doesNotMatch(await page.locator('#v12-jc-content').innerText(), /Unknown job[^]*0%/);
      const delegatedAfterUnmount = await page.evaluate(() => {
        let calls = 0;
        __dex.caOpenHelp = () => { calls += 1; };
        __dex.componentWillUnmount();
        const trigger = document.createElement('button');
        trigger.dataset.caOpenHelp = 'generate';
        document.body.appendChild(trigger);
        trigger.click();
        trigger.remove();
        return calls;
      });
      assert.equal(delegatedAfterUnmount, 0);
      assert.deepEqual(errors, []);
      await page.close();
    });

    await test('command palette lists and navigates the complete Concept A module set', async () => {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const errors = await openConcept(page, srv.base);
      await page.locator('.ca-search').focus();
      await page.locator('.ca-search').click();
      await page.waitForSelector('#v12-palette-overlay', { state: 'visible' });
      await page.waitForFunction(() => document.activeElement?.id === 'v12-palette-input');
      const paletteText = await page.locator('#v12-palette-results').innerText();
      for (const label of ['Workstation', 'Generate', 'Edit', 'Media', 'Voice', 'Music', '3D Assets', 'World Viewer', 'Drama', 'Settings / Help']) {
        assert.match(paletteText, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      }
      await page.fill('#v12-palette-input', 'World Viewer');
      await page.locator('.v12-palette-item', { hasText: 'Go to World Viewer' }).click();
      await page.waitForSelector('.ca-shell[data-ca-module="world"]');
      assert.deepEqual(errors, []);
      await page.close();
    });

    await test('shared dialogs move focus inside and restore their opener', async () => {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const errors = await openConcept(page, srv.base);
      const opener = page.locator('.ca-search');

      await opener.focus();
      await opener.click();
      await page.waitForFunction(() => document.activeElement?.id === 'v12-palette-input');
      assert.equal(await page.locator('#v12-palette-modal').getAttribute('role'), 'dialog');
      await page.keyboard.press('Escape');
      assert.equal(await opener.evaluate(e => document.activeElement === e), true);

      await page.evaluate(() => __DEX_V12.toggleJobCenter());
      await page.waitForFunction(() => document.activeElement?.id === 'v12-jc-close-btn');
      assert.equal(await page.locator('#v12-job-center-drawer').getAttribute('aria-hidden'), 'false');
      await page.waitForTimeout(400); // snapshot refresh may remount the Concept A opener
      await page.keyboard.press('Escape');
      assert.equal(await opener.evaluate(e => document.activeElement === e), true);
      assert.equal(await page.locator('#v12-job-center-drawer').getAttribute('aria-hidden'), 'true');

      await page.evaluate(() => __DEX_V12.openComparison([]));
      await page.waitForFunction(() => document.activeElement?.id === 'v12-cmp-close-btn');
      assert.equal(await page.locator('#v12-compare-modal').getAttribute('aria-modal'), 'true');
      await page.keyboard.press('Escape');
      assert.equal(await opener.evaluate(e => document.activeElement === e), true);
      assert.deepEqual(errors, []);
      await page.close();
    });

    await test('narrow Concept A geometry has no document-wide horizontal overflow', async () => {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      const errors = await openConcept(page, srv.base);
      assert.equal(await page.locator('.ca-nav').isVisible(), true);
      await page.locator('.ca-nav-item', { hasText: 'Generate' }).click();
      await page.waitForSelector('.ca-shell[data-ca-module="generate"]');
      const geometry = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, shell: document.querySelector('.ca-shell').getBoundingClientRect().width }));
      assert.ok(geometry.scrollWidth <= geometry.width + 2, JSON.stringify(geometry));
      assert.ok(geometry.shell <= geometry.width + 2, JSON.stringify(geometry));
      assert.deepEqual(errors, []);
      await page.close();
    });
  } finally {
    await runCleanups();
  }
  process.exitCode = exitCode(results.some(r => r[0] !== 'PASS'));
})().catch(async e => { console.error(e); await runCleanups(); process.exitCode = 2; });
