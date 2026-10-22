'use strict';
// V2 parity rows 3, 12 and 14: a visible command-palette entry that never strands V2 on an unrendered screen,
// the server-backed prompt-style manager inside Create, and CFG 0 reaching the request unchanged.
// Generation is intercepted and refused; this suite never runs inference.
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { startServer, installModelSnapshots, runner, launchBrowser, runCleanups, openStudio, chooseModel } = require('./helpers');

const { test, results, exitCode } = runner('v2-parity-extras');

async function open(page, base, bodies) {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await installModelSnapshots(page, base);
  await page.route('**/api/models/secondary/activate', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ modelState: {} }) }));
  await page.route('**/api/actions/generate-controlled', route => {
    bodies.push(JSON.parse(route.request().postData() || '{}'));
    route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'intercepted by test' }) });
  });
  await openStudio(page, base + '/dexdiffusion/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__dex && __dex.state.version === 2 && __dex.state.modelTargets && __dex.state.modelTargets.length > 3);
  return errors;
}

(async () => {
  const srv = process.env.DEX_TEST_BASE ? { base: process.env.DEX_TEST_BASE, stop() {} } : await startServer();
  const browser = await launchBrowser(chromium);
  try {
    await test('row 3: a visible Search entry opens the palette; "Go to Workstation" lands on Create, not an unrendered screen', async () => {
      const page = await browser.newPage({ viewport: { width: 1348, height: 735 } });
      const errors = await open(page, srv.base, []);
      await page.evaluate(() => __dex.setScreen('library'));
      const btn = page.locator('[data-studio-search]');
      assert.equal(await btn.isVisible(), true, 'Search is a visible V2 control');
      assert.match(await btn.getAttribute('aria-label'), /Search and commands/);
      await btn.click();
      await page.locator('#v12-palette-modal').waitFor({ state: 'visible' });
      await page.locator('#v12-palette-input').fill('Workstation');
      await page.locator('.v12-palette-item', { hasText: 'Go to Workstation' }).first().click();
      await page.waitForFunction(() => __dex.state.screens[2] === 'create');
      assert.equal(await page.locator('[data-screen-header="create"]').isVisible(), true, 'Create is actually rendered');
      assert.deepEqual(errors, []);
      await page.close();
    });

    await test('row 3: Cmd/Ctrl+K opens the palette in V2 and Escape closes it', async () => {
      const page = await browser.newPage({ viewport: { width: 1348, height: 735 } });
      const errors = await open(page, srv.base, []);
      await page.locator('[data-studio-search]').focus();
      await page.keyboard.press('Control+k');
      await page.locator('#v12-palette-modal').waitFor({ state: 'visible' });
      await page.keyboard.press('Escape');
      await page.locator('#v12-palette-modal').waitFor({ state: 'hidden' });
      assert.deepEqual(errors, []);
      await page.close();
    });

    await test('row 14: CFG 0 is accepted by the V2 input and sent as 0 (the server supports it)', async () => {
      const page = await browser.newPage({ viewport: { width: 1348, height: 735 } });
      const bodies = [];
      const errors = await open(page, srv.base, bodies);
      await chooseModel(page, 'sdxl-base');
      await page.locator('[data-studio-advanced]').evaluate(el => { el.open = true; });
      const cfg = page.locator('input[type="number"][step="0.5"]').first();
      assert.equal(await cfg.getAttribute('min'), '0');
      await cfg.fill('0'); await cfg.blur();
      await page.waitForFunction(() => String(__dex.state.cfg) === '0');
      await page.getByRole('textbox', { name: 'Describe your image', exact: true }).fill('a red fox');
      await page.getByRole('button', { name: 'Generate image', exact: true }).click();
      for (let i = 0; i < 40 && !bodies.length; i++) await page.waitForTimeout(100);
      assert.equal(bodies.length, 1);
      assert.equal(Number(bodies[0].cfg_scale), 0, JSON.stringify(bodies[0]));
      assert.deepEqual(errors, []);
      await page.close();
    });

    await test('row 12: the prompt-style manager is reachable in V2 Create (open, load from the server, create-editor opens)', async () => {
      const page = await browser.newPage({ viewport: { width: 1348, height: 735 } });
      const errors = await open(page, srv.base, []);
      await page.locator('[data-studio-advanced]').evaluate(el => { el.open = true; });
      const styles = page.locator('details', { has: page.locator(':scope > summary', { hasText: /^Prompt styles/ }) }).first();
      await styles.locator(':scope > summary').scrollIntoViewIfNeeded();
      await styles.locator(':scope > summary').click();
      await page.waitForFunction(() => document.querySelector('[data-dex-field="style-new"]'));
      await page.locator('[data-dex-field="style-new"]').click();
      await page.locator('[data-dex-field="style-editor"]').waitFor({ state: 'visible' });
      assert.match(await page.locator('[data-dex-field="style-editor"]').innerText(), /\{prompt\}/);
      assert.deepEqual(errors, []);
      await page.close();
    });
  } finally {
    await runCleanups();
  }
  process.exitCode = exitCode(results.some(r => r[0] !== 'PASS'));
})().catch(async e => { console.error(e); await runCleanups(); process.exitCode = 2; });
