'use strict';
// The canvas/settings divider (drag to resize, drag across to swap sides, persists) and System → Color scheme
// (replace a theme colour, prompt boxes brighter than their background).
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { startServer, installModelSnapshots, runner, launchBrowser, openStudio } = require('./helpers');
const { results, test, exitCode } = runner('studio-layout-theme');

const rgb = s => (/rgba?\((\d+), (\d+), (\d+)/.exec(s) || []).slice(1).map(Number);

(async () => {
  const srv = await startServer();
  const browser = await launchBrowser(chromium);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await installModelSnapshots(page, srv.base);
  const cols = () => page.evaluate(() => getComputedStyle(document.querySelector('[data-studio-create]')).gridTemplateColumns.split(' ').map(parseFloat));
  const drag = async (toX) => {
    const b = await page.locator('[data-dex-split="create"]').boundingBox();
    const y = b.y + b.height / 2;
    await page.mouse.move(b.x + b.width / 2, y); await page.mouse.down();
    await page.mouse.move(toX, y, { steps: 8 }); await page.mouse.up();
    await page.waitForTimeout(120);
  };
  try {
    await openStudio(page, srv.base);

    await test('Create shows a divider between the canvas and the settings', async () => {
      const bar = page.locator('[data-dex-split="create"]');
      await bar.waitFor({ state: 'visible' });
      assert.equal(await bar.getAttribute('role'), 'separator');
      assert.equal(await bar.getAttribute('data-settings-side'), 'right');
      const [, settings] = await cols();
      assert.equal(Math.round(settings), 370);
    });

    await test('dragging the divider left gives the settings more room', async () => {
      await drag(800);
      const [canvas, settings] = await cols();
      assert.equal(Math.round(canvas), 800);
      assert.equal(Math.round(settings), 640);
    });

    await test('dragging the divider all the way across swaps the settings and the canvas, keeping the width', async () => {
      await drag(4);
      const [settings, canvas] = await cols();
      assert.equal(Math.round(settings), 640);
      assert.equal(Math.round(canvas), 800);
      const sides = await page.evaluate(() => { const g = document.querySelector('[data-studio-create]'); return [g.children[0].getBoundingClientRect().left, g.children[1].getBoundingClientRect().left]; });
      assert.ok(sides[1] < sides[0], 'settings are now left of the canvas');
      assert.equal(await page.locator('[data-dex-split="create"]').getAttribute('data-settings-side'), 'left');
    });

    await test('the layout survives a reload, and double-click restores the default', async () => {
      await page.reload();
      await page.waitForFunction(() => window.__dex && __dex.state.version === 2 && document.querySelector('[data-studio-create]'));
      await page.locator('[data-dex-split="create"]').waitFor({ state: 'visible' });
      assert.equal(await page.locator('[data-dex-split="create"]').getAttribute('data-settings-side'), 'left');
      await page.locator('[data-dex-split="create"]').dblclick();
      await page.waitForTimeout(120);
      const [, settings] = await cols();
      assert.equal(Math.round(settings), 370);
      assert.equal(await page.locator('[data-dex-split="create"]').getAttribute('data-settings-side'), 'right');
    });

    await test('the keyboard can resize and swap through the divider', async () => {
      const bar = page.locator('[data-dex-split="create"]');
      await bar.focus(); await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(80);
      assert.equal(Math.round((await cols())[1]), 394);
      await page.keyboard.press('Enter'); await page.waitForTimeout(80);
      assert.equal(await bar.getAttribute('data-settings-side'), 'left');
      await page.keyboard.press('Home'); await page.waitForTimeout(80);
      assert.equal(await bar.getAttribute('data-settings-side'), 'right');
    });

    await test('prompt boxes are 20% brighter than the panel behind them', async () => {
      const bg = rgb(await page.locator('dex-prompt-field[data-dex-field="prompt"]').evaluate(e => getComputedStyle(e).backgroundColor));
      // Settings panel #160f22 under a rgba(17,10,30,.55) card → (19,12,32); 20% toward white → (66,61,77).
      [66, 61, 77].forEach((v, i) => assert.ok(Math.abs(bg[i] - v) <= 3, 'prompt box ' + bg));
    });

    await test('System → Color scheme replaces the workspace background everywhere, and resets', async () => {
      await page.evaluate(() => __dex.setScreen('system'));
      const panel = page.locator('[data-dex-theme-panel]');
      await panel.waitFor({ state: 'visible' });
      await panel.locator('[data-theme-role]').selectOption('workspace');
      assert.equal(await panel.locator('[data-theme-picker]').isVisible(), true, 'choosing a color opens the spectrum');
      const sv = panel.locator('[data-theme-sv]'), size = await sv.boundingBox();
      await sv.click({ position: { x: size.width * 0.8, y: size.height * 0.7 } });
      await page.waitForTimeout(150);
      const picked = await panel.locator('[data-theme-hex]').inputValue();
      assert.match(picked, /^#[0-9a-f]{6}$/);
      await page.evaluate(() => __dex.setScreen('create'));
      await page.waitForTimeout(150);
      const preview = rgb(await page.locator('[data-studio-preview="create"]').evaluate(e => getComputedStyle(e.closest('[data-v]').querySelector('[data-studio-layout]')).backgroundColor));
      assert.notDeepEqual(preview, [16, 15, 24], 'the workspace background changed: ' + picked + ' ' + JSON.stringify(await page.evaluate(() => DexTheme.state())));
      await page.reload();
      await page.waitForFunction(() => window.__dex && __dex.state.version === 2 && document.querySelector('[data-studio-layout]'));
      const after = rgb(await page.evaluate(() => getComputedStyle(document.querySelector('[data-studio-layout]')).backgroundColor));
      assert.notDeepEqual(after, [16, 15, 24], 'the change is kept after a reload');
      await page.evaluate(() => __dex.setScreen('system'));
      await page.locator('[data-theme-reset-all]').click();
      await page.waitForTimeout(150);
      assert.deepEqual(rgb(await page.evaluate(() => getComputedStyle(document.querySelector('[data-studio-layout]')).backgroundColor)), [16, 15, 24]);
    });

    await test('the prompt box brightness slider changes the lift', async () => {
      await page.locator('[data-theme-lift]').fill('40');
      await page.evaluate(() => __dex.setScreen('create'));
      await page.waitForTimeout(150);
      const bg = rgb(await page.locator('dex-prompt-field[data-dex-field="prompt"]').evaluate(e => getComputedStyle(e).backgroundColor));
      assert.ok(bg[0] > 100, 'brighter at 40%: ' + bg);
      assert.deepEqual(errors, []);
    });
  } finally {
    await browser.close(); await srv.stop();
  }
  process.exit(exitCode(results.some(result => result[0] === 'FAIL')));
})();
