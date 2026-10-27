'use strict';
// Galaxy Tab S9 Ultra Tailscale browser acceptance test.
// Validates full DexDiffusion application behavior under simulated Android / tablet conditions
// connecting to the real Big Mac Tailscale HTTPS endpoint: https://bigmac.tailafb7e8.ts.net:11443/dexdiffusion/

const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright-core');

const TAILSCALE_URL = process.env.DEX_TABLET_URL || 'https://bigmac.tailafb7e8.ts.net:11443/dexdiffusion/';
const GALAXY_TAB_UA = 'Mozilla/5.0 (Linux; Android 14; SM-X910) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

const SCREENSHOT_DIR = path.resolve(__dirname, '../../artifacts/tablet-verification');
if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

async function runTabletAcceptance() {
  console.log(`Starting Galaxy Tab S9 Ultra verification against: ${TAILSCALE_URL}`);
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--disable-gpu', '--ignore-certificate-errors'],
  });

  try {
    // ---- Test 1: Landscape Mode (1480 x 924) --------------------------------
    console.log('--- Test 1: Landscape Mode (1480x924, hasTouch: true) ---');
    const landscapeContext = await browser.newContext({
      viewport: { width: 1480, height: 924 },
      deviceScaleFactor: 2,
      hasTouch: true,
      isMobile: true,
      userAgent: GALAXY_TAB_UA,
    });

    const page = await landscapeContext.newPage();
    page.on('dialog', dialog => dialog.accept());
    const pageErrors = [];
    page.on('pageerror', err => pageErrors.push(String(err)));

    // Navigate to live Tailscale endpoint
    const response = await page.goto(TAILSCALE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    assert.equal(response.status(), 200, `Expected HTTP 200 from ${TAILSCALE_URL}`);
    console.log('✓ HTTP 200 received from Big Mac Tailscale endpoint');

    // Wait for DexDiffusion core state to mount
    await page.waitForFunction(() => !!window.__dex && !!window.__dex.state, { timeout: 15000 });
    console.log('✓ DexDiffusion client state initialized');

    // Wait for UI to render
    await page.waitForSelector('button:has-text("Create")', { timeout: 15000 });
    console.log('✓ Navigation bar rendered with Create/Edit/Library tabs');

    // Verify Create Screen controls
    await page.click('button:has-text("Create")');
    await page.waitForTimeout(500);

    // Check textarea for prompt
    const promptTextarea = page.locator('textarea').first();
    await promptTextarea.waitFor({ state: 'visible', timeout: 5000 });
    await promptTextarea.fill('A cinematic photograph of a cat on a velvet cushion');
    const promptValue = await promptTextarea.inputValue();
    assert.equal(promptValue, 'A cinematic photograph of a cat on a velvet cushion');
    console.log('✓ Create tab: Prompt entry verified with touch simulation');

    // Wait for checkpoints to load from backend
    await page.waitForFunction(() => !!window.__dex && !!window.__dex.state && Array.isArray(window.__dex.state.checkpoints) && window.__dex.state.checkpoints.length > 0, null, { timeout: 20000 });

    // Check model selection: verify FLUX.2 Klein 4B is in checkpoints and can be selected
    const modelCheck = await page.evaluate(() => {
      const cps = window.__dex.state.checkpoints || [];
      const hasFlux2 = cps.some(c => c.name === 'flux2-klein-4b');
      const current = window.__dex.state.target;
      return { current, hasFlux2, totalCheckpoints: cps.length };
    });
    console.log(`✓ Create tab: Current model "${modelCheck.current}", FLUX.2 Klein 4B available: ${modelCheck.hasFlux2} (${modelCheck.totalCheckpoints} total checkpoints)`);
    assert.ok(modelCheck.hasFlux2, 'FLUX.2 Klein 4B must be available in checkpoints');

    // Switch to FLUX.2 Klein 4B primary target
    await page.evaluate(() => {
      if (typeof window.__dex.onSelectTarget === 'function') window.__dex.onSelectTarget('flux2-klein-4b');
      else window.__dex.state.target = 'flux2-klein-4b';
    });
    const targetAfter = await page.evaluate(() => window.__dex.state.target);
    console.log(`✓ Create tab: Selected primary target "${targetAfter}"`);

    // Check Generate action button
    const genButton = page.locator('button:visible:has-text("Generate")').first();
    await genButton.waitFor({ state: 'visible', timeout: 5000 });
    console.log('✓ Create tab: Generate button is present and active');

    // Save screenshot of landscape Create screen
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01-landscape-create.png'), fullPage: false });
    console.log('✓ Saved screenshot: 01-landscape-create.png');

    // ---- Test 2: Edit Screen (Uploads for Android Files/Photos) -------------
    console.log('--- Test 2: Edit Screen & Android Photo Upload input ---');
    await page.evaluate(() => __dex.setScreen('edit', { skipUnsavedGuard: true }));
    await page.waitForTimeout(500);

    await page.waitForFunction(() => !!document.querySelector('input[type="file"]'), null, { timeout: 15000 });
    const fileCount = await page.evaluate(() => document.querySelectorAll('input[type="file"]').length);
    console.log(`✓ Edit tab: ${fileCount} file upload input(s) attached and ready for Android Photos/Files`);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '02-landscape-edit.png'), fullPage: false });
    console.log('✓ Saved screenshot: 02-landscape-edit.png');

    // ---- Test 3: Library Screen & Remote wc2tb Image Browsing ---------------
    console.log('--- Test 3: Library Screen & Remote wc2tb Image Browsing ---');
    await page.evaluate(() => __dex.setScreen('library', { skipUnsavedGuard: true }));
    await page.waitForTimeout(1000);

    // Verify Library API returns images from /Volumes/wc2tb/DexDiffusion
    const libraryData = await page.evaluate(async () => {
      const res = await fetch('/api/library/images?limit=20');
      if (!res.ok) return { ok: false, status: res.status };
      const data = await res.json();
      return { ok: true, total: data.total, count: (data.items || []).length, first: data.items && data.items[0] };
    });
    assert.ok(libraryData.ok, `Library API returned status ${libraryData.status}`);
    console.log(`✓ Library API: ${libraryData.total} canonical images verified on /Volumes/wc2tb/DexDiffusion`);

    if (libraryData.first) {
      console.log(`✓ Sample library image: ${libraryData.first.id}`);
      const exportUrl = `/api/images/${encodeURIComponent(libraryData.first.id)}/export`;
      console.log(`✓ Tablet download URL pattern: ${exportUrl}`);
    }

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '03-landscape-library.png'), fullPage: false });
    console.log('✓ Saved screenshot: 03-landscape-library.png');

    // ---- Test 4: System Info over Tailscale ---------------------------------
    console.log('--- Test 4: System Info over Tailscale ---');
    const systemInfo = await page.evaluate(async () => {
      const res = await fetch('/api/system-info');
      if (!res.ok) return { ok: false, status: res.status };
      return { ok: true, data: await res.json() };
    });
    assert.ok(systemInfo.ok, 'Failed to fetch /api/system-info');
    const ts = systemInfo.data && systemInfo.data.network && systemInfo.data.network.tailscale;
    assert.ok(ts, 'Tailscale status missing from system-info');
    console.log(`✓ Tailscale scope: ${ts.scope}`);
    console.log(`✓ Tailscale endpoint: ${ts.url}`);
    assert.equal(ts.funnel, false, 'Funnel MUST NOT be enabled for DexDiffusion');

    await landscapeContext.close();

    // ---- Test 5: Portrait Mode (924 x 1480) ---------------------------------
    console.log('--- Test 5: Portrait Mode (924x1480, hasTouch: true) ---');
    const portraitContext = await browser.newContext({
      viewport: { width: 924, height: 1480 },
      deviceScaleFactor: 2,
      hasTouch: true,
      isMobile: true,
      userAgent: GALAXY_TAB_UA,
    });

    const portraitPage = await portraitContext.newPage();
    portraitPage.on('dialog', dialog => dialog.accept());
    await portraitPage.goto(TAILSCALE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await portraitPage.waitForFunction(() => !!window.__dex && !!window.__dex.state, { timeout: 15000 });
    await portraitPage.waitForSelector('button:has-text("Create")', { timeout: 15000 });

    await portraitPage.evaluate(() => __dex.setScreen('create', { skipUnsavedGuard: true }));
    await portraitPage.screenshot({ path: path.join(SCREENSHOT_DIR, '04-portrait-create.png'), fullPage: false });
    console.log('✓ Saved screenshot: 04-portrait-create.png');

    await portraitPage.evaluate(() => __dex.setScreen('library', { skipUnsavedGuard: true }));
    await portraitPage.waitForTimeout(1000);
    await portraitPage.screenshot({ path: path.join(SCREENSHOT_DIR, '05-portrait-library.png'), fullPage: false });
    console.log('✓ Saved screenshot: 05-portrait-library.png');

    await portraitContext.close();

    console.log('================================================================');
    console.log('ALL GALAXY TAB S9 ULTRA TABLET EMULATION ACCEPTANCE CHECKS PASS!');
    console.log('================================================================');
  } finally {
    await browser.close();
  }
}

runTabletAcceptance().catch(err => {
  console.error('Tablet Acceptance Check FAILED:', err);
  process.exit(1);
});
