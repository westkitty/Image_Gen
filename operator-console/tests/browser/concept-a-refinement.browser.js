'use strict';
// Focused Concept A.1 acceptance: shell identity, live-state bindings, Help, queue dock,
// planned-control truth, and narrow geometry. This suite does not generate or create records.
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { startServer, installModelSnapshots, runner, launchBrowser, runCleanups } = require('./helpers');
const { resolveOutputDir, createOwnedWriter } = require('./safe-output');
const OUT = resolveOutputDir(process.env.DEX_BROWSER_OUTPUT_DIR, { label: 'concept-a' }), WRITER = createOwnedWriter(OUT), outPath = n => WRITER.pathFor(n);

const { test, results, exitCode } = runner('concept-a-refinement');

async function openConcept(page, base) {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await installModelSnapshots(page, base);
  // Concept A is a developer-only legacy shell. The normal Studio intentionally
  // hides its version switch; select V4 in this isolated browser profile.
  await page.addInitScript(() => {
    localStorage.setItem('dex_studio_nav_migrated', '{"fixture":true}');
    localStorage.setItem('dex_developer', '1');
    localStorage.setItem('dex_version', '4');
  });
  await page.goto(base + '/dexdiffusion/', { waitUntil: 'domcontentloaded' });
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
      assert.equal(await page.locator('.ca-nav-item .ca-svg-icon').first().evaluate(e => e.namespaceURI), 'http://www.w3.org/2000/svg');
      await page.waitForFunction(() => { const icon = document.querySelector('.ca-nav-item .ca-svg-icon'); return icon && icon.getBoundingClientRect().width > 0; }, null, { timeout: 2000 });
      assert.ok(await page.locator('.ca-brand img[src*="grok_image_1775521844329.jpg"]').count());
      assert.equal(await page.locator('.ca-shell[data-ca-module="workstation"]').count(), 1);
      await page.locator('.ca-nav-item', { hasText: 'Create' }).click();
      await page.waitForSelector('.ca-shell[data-ca-module="generate"]');
      // Startup re-renders can detach the button between lookup and read (computed style of a detached node is ''); wait for a
      // connected primary action, then require its accent colour.
      const accent = await page.waitForFunction(() => { const e = document.querySelector('.ca-primary'); const bg = e && e.isConnected ? getComputedStyle(e).backgroundColor : ''; return /rgb/.test(bg) ? bg : null; }, null, { timeout: 5000 }).then(h => h.jsonValue()).catch(() => '');
      assert.match(accent, /rgb/);
      assert.deepEqual(errors, []);
      await page.close();
    });

    await test('contextual inspector and Generate result remain live surfaces', async () => {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const errors = await openConcept(page, srv.base);
      await page.locator('.ca-nav-item', { hasText: 'Create' }).click();
      await page.waitForSelector('.ca-shell[data-ca-module="generate"]');
      assert.equal(await page.locator('.ca-inspector').count(), 1);
      assert.match(await page.locator('.ca-inspector').innerText(), /Target|Output|Prompt record/);
      assert.ok(await page.locator('.ca-results-column').count());
      assert.ok(await page.locator('.ca-results-column').locator('h3').count());
      assert.equal(await page.locator('.ca-results-column').getByText('No image result in this workspace yet').count(), 1);
      assert.equal(await page.locator('.ca-results-column').getByRole('button', { name: 'Generate Image' }).count(), 1);
      assert.deepEqual(errors, []);
      await page.close();
    });

    await test('Help provides step cards, FAQ disclosure, and full tutorial routing', async () => {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const errors = await openConcept(page, srv.base);
      await page.locator('.ca-nav-item', { hasText: 'Create' }).click();
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

    await test('Voice and Music primary actions stay visible above the shared queue dock', async () => {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const errors = await openConcept(page, srv.base);
      for (const [moduleId, screen, bar] of [['voice', 'voice', 'voice'], ['music', 'music', 'music']]) {
        await page.evaluate(([s, id]) => { __dex.setScreen(s); if (id === 'voice') __dex.vpSet({ tab: 'quick' }); }, [screen, moduleId]);
        await page.waitForFunction(id => document.querySelector('.ca-shell')?.dataset.caModule === id, moduleId);
        const geometry = await page.waitForFunction(({ moduleId, bar }) => {
          const shell = document.querySelector('.ca-shell'), canvas = document.querySelector('.ca-canvas');
          const button = document.querySelector(`[data-media-generate-bar="${bar}"] button`);
          if (!shell || shell.dataset.caModule !== moduleId || !canvas || !button || !button.isConnected) return null;
          const b = button.getBoundingClientRect(), c = canvas.getBoundingClientRect();
          if (!b.width || !b.height || !c.width || !c.height) return null;
          return { button: { y: b.y, bottom: b.bottom }, canvas: { y: c.y, bottom: c.bottom } };
        }, { moduleId, bar }, { timeout: 5000 }).then(h => h.jsonValue());
        assert.ok(geometry.button.y >= geometry.canvas.y && geometry.button.bottom <= geometry.canvas.bottom + 1, `${moduleId} primary action is visible above the queue dock`);
      }
      assert.deepEqual(errors, []);
      await page.screenshot({ path: outPath('music-primary-action-visible.png') });
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
      for (const label of ['Workstation', 'Create', 'Edit', 'Voice', 'Drama', 'Music', '3D Assets', 'World Viewer', 'Library', 'System']) {
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
      await page.locator('.ca-nav-item', { hasText: 'Create' }).click();
      await page.waitForSelector('.ca-shell[data-ca-module="generate"]');
      const geometry = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, shell: document.querySelector('.ca-shell').getBoundingClientRect().width }));
      assert.ok(geometry.scrollWidth <= geometry.width + 2, JSON.stringify(geometry));
      assert.ok(geometry.shell <= geometry.width + 2, JSON.stringify(geometry));
      assert.deepEqual(errors, []);
      await page.close();
    });

    await test('Dexter stays identifiable, the inspector works as a mobile drawer, and Quick Prompt keeps its caret', async () => {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      const errors = await openConcept(page, srv.base);
      const brand = page.locator('.ca-brand');
      assert.equal(await brand.getAttribute('aria-label'), 'Dexter Studio home · Workstation');
      const brandImage = await brand.locator('img').evaluate(e => ({ fit: getComputedStyle(e).objectFit, src: e.src, module: document.querySelector('.ca-shell')?.getAttribute('data-ca-module'), html: e.outerHTML, owner: e.parentElement?.outerHTML.slice(0, 240) }));
      assert.equal(brandImage.fit, 'contain', JSON.stringify(brandImage));
      assert.equal(await page.locator('.ca-nav-item').count(), 10);

      const inspectorOpener = page.locator('.ca-inspector-open');
      await inspectorOpener.click();
      await page.waitForSelector('.ca-inspector.is-open');
      assert.equal(await page.locator('.ca-inspector').getAttribute('role'), 'dialog');
      assert.equal(await page.locator('.ca-inspector').getAttribute('aria-modal'), 'true');
      await page.waitForFunction(() => document.activeElement?.classList.contains('ca-inspector-close'), null, { timeout: 1500 }).catch(async () => {
        throw new Error('inspector did not receive focus: ' + await page.evaluate(() => JSON.stringify({ active: document.activeElement?.tagName, drawer: getComputedStyle(document.querySelector('.ca-inspector')).display })));
      });
      await page.evaluate(() => __dex.caSync());
      await page.waitForFunction(() => document.activeElement?.classList.contains('ca-inspector-close'), null, { timeout: 1500 }).catch(() => { throw new Error('inspector focus was lost on a redraw'); });
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.activeElement?.classList.contains('ca-inspector-open'), null, { timeout: 1500 }).catch(() => { throw new Error('focus was not restored to the inspector opener'); });

      const prompt = page.locator('[data-dex-quick-prompt]');
      const text = 'A red kite over the lake.\nLate afternoon light.';
      await prompt.fill(text);
      await prompt.evaluate(e => e.setSelectionRange(3, 12, 'forward'));
      await page.locator('.ca-workstation .ca-panel').filter({ has: prompt }).getByRole('button', { name: 'Continue in Create' }).click();
      await page.waitForSelector('.ca-shell[data-ca-module="generate"]');
      await page.waitForFunction(() => document.activeElement?.getAttribute('data-dex-field') === 'prompt', null, { timeout: 2500 }).catch(async () => { throw new Error('prompt was not focused after handoff: ' + JSON.stringify(await page.evaluate(() => ({ active: document.activeElement?.outerHTML?.slice(0, 180), module: document.querySelector('.ca-shell')?.getAttribute('data-ca-module'), prompts: [...document.querySelectorAll('[data-dex-field="prompt"]')].map(e => ({ connected: e.isConnected, disabled: e.disabled, hidden: e.hidden, display: getComputedStyle(e).display, rects: e.getClientRects().length, html: e.outerHTML.slice(0, 150) })), selection: __dex.ca.promptSelection, screen: __dex.state.screens[__dex.state.version] })))); });
      const transferred = await page.locator('[data-dex-field="prompt"]').evaluate(e => ({ value: e.value, start: e.selectionStart, end: e.selectionEnd, direction: e.selectionDirection }));
      assert.deepEqual(transferred, { value: text, start: 3, end: 12, direction: 'forward' });
      assert.deepEqual(errors, []);
      await page.close();
    });

    await test('missing Workstation preview is labeled without fabricating an image', async () => {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      const errors = await openConcept(page, srv.base);
      const preview = page.locator('.ca-asset-card img').first();
      if (await preview.count()) {
        await preview.evaluate(e => e.dispatchEvent(new Event('error')));
        await page.waitForFunction(() => !!document.querySelector('.ca-asset-preview[aria-label^="Preview unavailable for"]'));
        assert.match(await page.locator('.ca-asset-preview').first().innerText(), /Preview unavailable/);
      }
      assert.deepEqual(errors, []);
      await page.close();
    });

    await test('3D source preview failure is explained without a broken-image placeholder', async () => {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const errors = await openConcept(page, srv.base);
      await page.evaluate(() => { __dex.setState({ asset3dSourceArtifact: 'missing-3d-source.png' }); __dex.setScreen('3d'); });
      const fallback = page.locator('[data-ca-module="assets3d"] [role="status"]').filter({ hasText: 'Source preview unavailable' });
      await fallback.waitFor();
      assert.match(await fallback.innerText(), /Verify the canonical image in Library/);
      assert.equal(await page.locator('[data-ca-module="assets3d"] img[alt="Selected canonical source preview"]').count(), 0);
      assert.deepEqual(errors, []);
      await page.screenshot({ path: outPath('3d-source-preview-unavailable.png') });
      await page.close();
    });

    await test('Library switches between canonical images and the separate mixed-media index', async () => {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      const errors = await openConcept(page, srv.base);
      await page.locator('.ca-nav-item', { hasText: 'Library' }).click();
      await page.waitForSelector('.ca-shell[data-ca-module="media"]');
      assert.equal(await page.locator('.ca-media-stack [data-lib-controls]').count(), 1);
      assert.equal(await page.locator('.ca-library-tabs [role="tab"]').count(), 2);
      await page.getByRole('tab', { name: 'Audio & video index' }).click();
      await page.waitForSelector('[aria-label="Audio and video index"]');
      assert.equal(await page.locator('.ca-media-stack [data-lib-controls]').count(), 0, 'image workbench is not duplicated below media');
      assert.equal(await page.locator('.ca-media-stack').getByRole('button', { name: 'Voice', exact: true }).count(), 1);
      assert.equal(await page.locator('.ca-media-stack [role="tabpanel"]').count(), 2);
      assert.equal(await page.locator('#ca-library-view-images').isHidden(), true);
      await page.getByRole('tab', { name: 'Audio & video index' }).press('ArrowLeft');
      await page.waitForFunction(() => document.querySelector('[data-ca-library-tab="images"]')?.getAttribute('aria-selected') === 'true');
      await page.waitForSelector('.ca-media-stack [data-lib-controls]');
      assert.equal(await page.locator('#ca-library-view-media').isHidden(), true);
      assert.deepEqual(errors, []);
      await page.close();
    });

    await test('unsaved Drama script survives a cancelled command-palette navigation', async () => {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      const errors = await openConcept(page, srv.base);
      assert.equal(await page.evaluate(() => __dex.caNavigate('drama')), true);
      await page.waitForSelector('.ca-shell[data-ca-module="drama"]');
      const script = 'UNSAVED DRAMA DRAFT — KEEP THIS TEXT';
      await page.locator('[data-drama-script] textarea').fill(script);
      assert.equal(await page.locator('[data-drama-draft-state]').getAttribute('data-drama-draft-state'), 'unsaved');
      assert.match(await page.locator('[data-drama-draft-state]').innerText(), /held in memory only/);
      const navDialogPromise = page.waitForEvent('dialog');
      const navPromise = page.evaluate(() => __dex.caNavigate('media'));
      const navDialog = await navDialogPromise;
      assert.match(navDialog.message(), /Drama project or script/);
      await navDialog.dismiss();
      assert.equal(await navPromise, false);
      assert.equal(await page.evaluate(() => __dex.state.screens[__dex.state.version]), 'drama');
      await page.locator('.ca-search').click();
      await page.locator('#v12-palette-input').fill('Go to Library');
      const item = page.locator('.v12-palette-item').filter({ hasText: 'Go to Library' });
      assert.equal(await item.count(), 1);
      const dialogPromise = page.waitForEvent('dialog');
      const clickPromise = item.click();
      const dialog = await dialogPromise;
      assert.match(dialog.message(), /Drama project or script/);
      await dialog.dismiss();
      await clickPromise;
      assert.equal(await page.evaluate(() => __dex.state.screens[__dex.state.version]), 'drama');
      assert.equal(await page.locator('[data-drama-script] textarea').inputValue(), script);
      assert.equal(await page.evaluate(() => __dex._dmText.script), script);
      await page.screenshot({ path: outPath('drama-unsaved-script-navigation-cancelled.png') });
      assert.deepEqual(errors, []);
      await page.close();
    });
  } finally {
    await runCleanups();
  }
  process.exitCode = exitCode(results.some(r => r[0] !== 'PASS'));
})().catch(async e => { console.error(e); await runCleanups(); process.exitCode = 2; });
