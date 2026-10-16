'use strict';
// P04 slice 1: the prompt editor states what each backend really does with A1111 syntax, never claims
// unproven support, keeps typing/focus intact, and the server refuses constructs no backend executes.
// The generation POST is intercepted and refused; no inference runs.
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { startServer, installModelSnapshots, runner, launchBrowser, runCleanups } = require('./helpers');

const { test, results, exitCode } = runner('prompt-language');

async function open(page, base) {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await installModelSnapshots(page, base);
  await page.route('**/api/models/secondary/activate', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ modelState: {} }) }));
  await page.goto(base + '/dexdiffusion/', { waitUntil: 'domcontentloaded' });
  if (!(await page.locator('.ca-shell').count())) await page.locator('[data-vbtn="4"]').click();
  await page.waitForSelector('.ca-shell');
  await page.locator('.ca-nav-item', { hasText: 'Generate' }).click();
  await page.waitForSelector('.ca-shell[data-ca-module="generate"]');
  await page.waitForTimeout(300);
  return errors;
}
// Startup/target-switch re-renders are known to remount the form for a couple of seconds (ledger: open item);
// typing assertions wait for the DOM to be quiet so they test the editor, not that transient.
async function waitQuiet(page, quietMs = 700, capMs = 10000) {
  await page.evaluate(([quiet, cap]) => new Promise(resolve => {
    let timer = setTimeout(done, quiet); const cut = setTimeout(done, cap);
    const mo = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(done, quiet); });
    mo.observe(document.body, { childList: true, subtree: true });
    function done() { mo.disconnect(); clearTimeout(timer); clearTimeout(cut); resolve(); }
  }), [quietMs, capMs]);
}
async function chooseTarget(page, id) {
  const select = page.locator('select', { has: page.locator(`option[value="${id}"]`) }).first();
  await select.waitFor({ state: 'visible' });
  await select.selectOption(id);
  await page.waitForTimeout(400);
}

(async () => {
  const srv = process.env.DEX_TEST_BASE ? { base: process.env.DEX_TEST_BASE, stop() {} } : await startServer();
  const browser = await launchBrowser(chromium);
  try {
    await test('the old blanket claim is gone and help text matches the selected backend', async () => {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const errors = await open(page, srv.base);
      const placeholder = await page.locator('[data-dex-field="prompt"]').getAttribute('placeholder');
      assert.doesNotMatch(placeholder, /A1111 syntax supported/);
      await chooseTarget(page, 'sdxl-base');
      assert.match(await page.locator('[data-dex-field="prompt-syntax-help"]').innerText(), /Not supported yet: \[a:b:0\.5\] scheduling/);
      await chooseTarget(page, 'flux2-klein-4b');
      assert.match(await page.locator('[data-dex-field="prompt-syntax-help"]').innerText(), /plain language/);
      assert.match(await page.locator('[data-dex-field="token-count"]').innerText(), /unknown for this backend/);
      assert.deepEqual(errors, []);
      await page.close();
    });

    await test('typing keeps focus and cursor while MFLUX emphasis notes appear and clear', async () => {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const errors = await open(page, srv.base);
      await chooseTarget(page, 'flux2-klein-4b');
      await waitQuiet(page);
      const box = page.locator('[data-dex-field="prompt"]');
      await box.click();
      await page.keyboard.type('a red fox ');
      assert.equal(await page.locator('[data-dex-field="prompt-notes"]').isHidden(), true);
      await page.keyboard.type('(snowy:1.4) forest');
      await page.waitForTimeout(150);
      assert.match(await page.locator('[data-dex-field="prompt-notes"]').innerText(), /does not apply emphasis weights/);
      assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('[data-dex-field="prompt"]')), true, 'focus retained');
      assert.equal(await box.inputValue(), 'a red fox (snowy:1.4) forest');
      await box.fill('a red fox');
      await page.waitForTimeout(150);
      assert.equal(await page.locator('[data-dex-field="prompt-notes"]').isHidden(), true);
      assert.deepEqual(errors, []);
      await page.close();
    });

    await test('the server rejects schedule/alternation/AND with offset and hint, and accepts supported emphasis', async () => {
      const post = async body => {
        const r = await fetch(srv.base + '/api/preview/generation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ job_type: 'txt2img', target: 'sdxl-base', steps: 20 }, body)) });
        return { status: r.status, data: await r.json() };
      };
      let r = await post({ prompt: 'a [red:blue:0.5] fox' });
      assert.equal(r.status, 400);
      assert.match(r.data.error, /offset 2/); assert.match(r.data.error, /per-step conditioning/);
      r = await post({ prompt: 'a [red|blue] fox' });
      assert.equal(r.status, 400); assert.match(r.data.error, /alternating prompts/);
      r = await post({ prompt: 'a cat AND a dog' });
      assert.equal(r.status, 400); assert.match(r.data.error, /lowercase "and"/);
      r = await post({ prompt: 'a red fox', negative_prompt: 'bad [x|y]' });
      assert.equal(r.status, 400); assert.match(r.data.error, /negative prompt/);
      r = await post({ prompt: 'a (red:1.3) fox [small] BREAK snow \\(literal\\)' });
      assert.equal(r.status, 200);
      assert.ok(r.data.preview.argv.includes('a (red:1.3) fox [small] BREAK snow \\(literal\\)'), 'supported syntax is passed through verbatim');
      r = await post({ target: 'flux2-klein-4b', steps: 4, prompt: 'a (red:1.3) fox' });
      assert.equal(r.status, 200, 'literal text is allowed on MFLUX (with a note)');
      r = await post({ target: 'flux2-klein-4b', steps: 4, prompt: 'a cat BREAK a dog' });
      assert.match(r.data.error, /BREAK/);
      assert.equal(r.status, 400);
    });
  } finally {
    await runCleanups();
  }
  process.exitCode = exitCode(results.some(r => r[0] !== 'PASS'));
})().catch(async e => { console.error(e); await runCleanups(); process.exitCode = 2; });
