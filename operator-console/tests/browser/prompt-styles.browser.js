'use strict';
// P04 S04.2: prompt styles through the real UI and API — create, list, preview, apply, edit/rename, delete,
// duplicate-name rejection, A1111 placeholder semantics, privacy of the generation path, and persistence.
// The suite points the server at a throw-away styles file, so the user's own styles are never touched.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright-core');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-styles-browser-'));
const stylesFile = path.join(tmp, 'styles.json');
process.env.DEX_STYLES_FILE = stylesFile;
const { startServer, installModelSnapshots, runner, launchBrowser, runCleanups } = require('./helpers');

const { test, results, exitCode } = runner('prompt-styles');

async function open(page, base) {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await installModelSnapshots(page, base);
  await page.route('**/api/models/secondary/activate', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ modelState: {} }) }));
  await page.goto(base + '/dexdiffusion/', { waitUntil: 'domcontentloaded' });
  if (!(await page.locator('.ca-shell').count())) await page.locator('[data-vbtn="4"]').click();
  await page.waitForSelector('.ca-shell');
  await page.locator('.ca-nav-item', { hasText: 'Create' }).click();
  await page.waitForSelector('.ca-shell[data-ca-module="generate"]');
  await page.locator('[data-dex-field="styles-panel"]').waitFor({ state: 'attached' });
  await page.waitForTimeout(300);
  return errors;
}
const api = async (base, route, method = 'GET', body) => {
  const r = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json() };
};
async function chooseTarget(page, id) {
  const select = page.locator('select', { has: page.locator(`option[value="${id}"]`) }).first();
  await select.waitFor({ state: 'visible' });
  await select.selectOption(id);
  await page.waitForTimeout(400);
}
const openPanel = page => page.locator('[data-dex-field="styles-panel"] > summary').click();

(async () => {
  const srv = process.env.DEX_TEST_BASE ? { base: process.env.DEX_TEST_BASE, stop() {} } : await startServer();
  const browser = await launchBrowser(chromium);
  try {
    await test('API: create validates, names are unique, apply follows A1111 placeholder/append semantics and rejects unknown ids', async () => {
      let r = await api(srv.base, '/api/styles', 'POST', { name: '' });
      assert.equal(r.status, 400); assert.match(r.data.error, /name is required/);
      r = await api(srv.base, '/api/styles', 'POST', { name: 'Cinematic', prompt: 'cinematic lighting', negative_prompt: 'flat' });
      assert.equal(r.status, 201);
      const cin = r.data.style;
      r = await api(srv.base, '/api/styles', 'POST', { name: 'cinematic', prompt: 'x' });
      assert.equal(r.status, 400); assert.match(r.data.error, /already exists/);
      r = await api(srv.base, '/api/styles', 'POST', { name: 'Wrap', prompt: 'masterpiece, {prompt}, 8k' });
      const wrap = r.data.style;
      r = await api(srv.base, '/api/styles/apply', 'POST', { style_ids: [wrap.id, cin.id], prompt: 'a fox', negative_prompt: 'blurry' });
      assert.equal(r.status, 200);
      assert.equal(r.data.prompt, 'masterpiece, a fox, 8k, cinematic lighting');
      assert.equal(r.data.negative_prompt, 'blurry, flat');
      assert.deepEqual(r.data.applied, ['Wrap', 'Cinematic']);
      r = await api(srv.base, '/api/styles/apply', 'POST', { style_ids: ['sty_nope'], prompt: 'x' });
      assert.equal(r.status, 404);
      r = await api(srv.base, '/api/styles/apply', 'POST', { style_ids: [], prompt: 'x' });
      assert.equal(r.status, 400);
      r = await api(srv.base, '/api/styles/apply', 'POST', { style_ids: [cin.id], prompt: 'a fox', target: 'sdxl-base' });
      assert.equal(r.data.syntax_error, null);
      for (const s of [cin, wrap]) assert.equal((await api(srv.base, '/api/styles/' + s.id, 'DELETE')).status, 200);
      assert.equal((await api(srv.base, '/api/styles/' + cin.id, 'DELETE')).status, 404);
    });

    await test('API: a style that would create unexecutable syntax is reported, not silently applied', async () => {
      const r0 = await api(srv.base, '/api/styles', 'POST', { name: 'Sched', prompt: '[red:blue:0.5] {prompt}' });
      const r = await api(srv.base, '/api/styles/apply', 'POST', { style_ids: [r0.data.style.id], prompt: 'a fox', target: 'sdxl-base' });
      assert.match(r.data.syntax_error, /prompt scheduling/);
      await api(srv.base, '/api/styles/' + r0.data.style.id, 'DELETE');
    });

    await test('UI: save the current prompt as a style, preview and apply it, then edit/rename and delete it', async () => {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      page.on('dialog', d => d.accept());
      const errors = await open(page, srv.base);
      await chooseTarget(page, 'sdxl-base');
      await openPanel(page);
      await page.waitForFunction(() => /No styles yet/.test(document.querySelector('[data-dex-field="styles-empty"]')?.textContent || ''));
      await page.locator('[data-dex-field="prompt"]').fill('a red fox');
      await page.locator('[data-dex-field="negative-prompt"]').fill('blurry');
      await page.locator('[data-dex-field="style-from-prompt"]').click();
      await page.locator('[data-dex-field="style-editor"]').waitFor({ state: 'visible' });
      assert.match(await page.locator('[data-dex-field="style-editor"]').innerText(), /saves the text below on disk/);
      await page.locator('[data-dex-field="style-prompt"]').fill('golden hour, {prompt}, sharp focus');
      await page.locator('[data-dex-field="style-negative_prompt"]').fill('lowres');
      await page.locator('[data-dex-field="style-name"]').fill('Golden');
      await page.locator('[data-dex-field="style-save"]').click();
      await page.locator('[data-style-id]').first().waitFor({ state: 'visible' });
      assert.match(await page.locator('[data-dex-field="style-note"]').innerText(), /Saved style "Golden"/);
      // Preview before applying: the prompt box is untouched.
      await page.locator('[data-dex-field="style-check"]').first().check();
      await page.locator('[data-dex-field="style-preview-button"]').click();
      await page.locator('[data-dex-field="style-preview-prompt"]').waitFor({ state: 'visible' });
      assert.equal(await page.locator('[data-dex-field="style-preview-prompt"]').innerText(), 'golden hour, a red fox, sharp focus');
      assert.equal(await page.locator('[data-dex-field="style-preview-negative"]').innerText(), 'blurry, lowres');
      assert.equal(await page.locator('[data-dex-field="prompt"]').inputValue(), 'a red fox', 'preview does not change the prompt');
      // Apply writes the materialised text into both boxes.
      await page.locator('[data-dex-field="style-apply"]').click();
      await page.waitForFunction(() => document.querySelector('[data-dex-field="prompt"]').value === 'golden hour, a red fox, sharp focus');
      assert.equal(await page.locator('[data-dex-field="negative-prompt"]').inputValue(), 'blurry, lowres');
      // Edit + rename keeps the style, changes the name.
      await page.locator('[data-dex-field="style-edit"]').first().click();
      await page.locator('[data-dex-field="style-name"]').fill('Golden Hour');
      await page.locator('[data-dex-field="style-save"]').click();
      await page.waitForFunction(() => /Updated style "Golden Hour"/.test(document.querySelector('[data-dex-field="style-note"]')?.textContent || ''));
      assert.equal(await page.locator('[data-style-id]').count(), 1);
      assert.match(await page.locator('[data-style-id]').first().innerText(), /Golden Hour/);
      // Duplicate names are refused visibly.
      await page.locator('[data-dex-field="style-new"]').click();
      await page.locator('[data-dex-field="style-name"]').fill('golden hour');
      await page.locator('[data-dex-field="style-prompt"]').fill('x');
      await page.locator('[data-dex-field="style-save"]').click();
      await page.locator('[data-dex-field="style-error"]').waitFor({ state: 'visible' });
      assert.match(await page.locator('[data-dex-field="style-error"]').innerText(), /already exists/);
      await page.getByRole('button', { name: 'Cancel' }).click();
      // Delete.
      await page.locator('[data-dex-field="style-delete"]').first().click();
      await page.waitForFunction(() => document.querySelector('[data-dex-field="styles-empty"]'));
      assert.equal(await page.locator('[data-style-id]').count(), 0);
      assert.deepEqual(errors, []);
      await page.close();
    });

    await test('UI: applying a style the target cannot run is refused with the reason and leaves the prompt unchanged', async () => {
      const made = await api(srv.base, '/api/styles', 'POST', { name: 'Alt', prompt: '[a|b] {prompt}' });
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const errors = await open(page, srv.base);
      await chooseTarget(page, 'sdxl-base');
      await openPanel(page);
      await page.locator('[data-dex-field="prompt"]').fill('a fox');
      await page.locator('[data-dex-field="style-check"]').first().check();
      await page.locator('[data-dex-field="style-apply"]').click();
      await page.locator('[data-dex-field="style-note"]').waitFor({ state: 'visible' });
      await page.waitForFunction(() => /Not applied/.test(document.querySelector('[data-dex-field="style-note"]')?.textContent || ''));
      assert.equal(await page.locator('[data-dex-field="prompt"]').inputValue(), 'a fox', 'prompt unchanged when refused');
      assert.deepEqual(errors, []);
      await page.close();
      await api(srv.base, '/api/styles/' + made.data.style.id, 'DELETE');
    });

    await test('persistence: the styles file is versioned and holds only user templates', async () => {
      const r = await api(srv.base, '/api/styles', 'POST', { name: 'Persist', prompt: 'p {prompt}', negative_prompt: 'n' });
      const raw = JSON.parse(fs.readFileSync(stylesFile, 'utf8'));
      assert.equal(raw.schema, 'dexdiffusion.styles.v1');
      assert.deepEqual(raw.styles.map(s => s.name), ['Persist']);
      assert.deepEqual(Object.keys(raw.styles[0]).sort(), ['createdAt', 'id', 'name', 'negative_prompt', 'prompt', 'updatedAt']);
      await api(srv.base, '/api/styles/' + r.data.style.id, 'DELETE');
    });
  } finally {
    await runCleanups();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  process.exitCode = exitCode(results.some(r => r[0] !== 'PASS'));
})().catch(async e => { console.error(e); await runCleanups(); fs.rmSync(tmp, { recursive: true, force: true }); process.exitCode = 2; });
