'use strict';
// Composer: one "N / limit" counter, any number of wildcard chips, reorder, and move between positive and negative.
// Uses synthetic wildcard names only.
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { startServer, installModelSnapshots, runner, launchBrowser, openStudio } = require('./helpers');
const { test, exitCode } = runner('wildcard-placement');

(async () => {
  const srv = process.env.DEX_TEST_BASE ? { base: process.env.DEX_TEST_BASE, stop() {} } : await startServer();
  const browser = await launchBrowser(chromium);
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', e => errors.push(String(e)));
    await installModelSnapshots(page, srv.base);
    await page.route('**/api/extra-networks**', r => r.fulfill({ json: { loras: [], vaes: [], embeddings: { count: 0, items: [] } } }));
    await openStudio(page, srv.base + '/dexdiffusion/');
    await page.waitForFunction(() => window.__dex && __dex.state.modelTargets && __dex.state.modelTargets.length > 3 && __dex.state.capabilityData);
    await page.evaluate(() => __dex.setScreen('create'));
    const prompts = () => page.evaluate(() => ({ p: __dex.state.prompt, n: __dex.state.negPrompt }));
    await page.evaluate(() => __dex.setState({ prompt: 'one __aa__ two __bb__ three __cc__ four __dd__', negPrompt: 'blurry' }));

    await test('four wildcards are all shown; one compact counter in N / limit form', async () => {
      await page.waitForFunction(() => document.querySelectorAll('dex-prompt-field [data-wildcard-chip="positive"]').length === 4);
      const c = await page.locator('[data-prompt-counter]:visible').allInnerTexts();
      assert.equal(c.length, 1, 'exactly one visible counter');
      assert.match(c[0], /^\d+ \/ 1000$/);
      await page.fill('[data-dex-field="prompt"]', 'hello');
      await page.waitForFunction(() => document.querySelector('[data-prompt-counter]').textContent === '5 / 1000');
    });
    await test('chips sit inside the prompt: + duplicates, x dismisses, keys reorder, and the value stays plain text', async () => {
      await page.evaluate(() => { document.activeElement.blur(); __dex.setState({ prompt: 'one, __aa__, two, __bb__', negPrompt: 'blurry' }); });
      const field = page.locator('dex-prompt-field[data-dex-field="prompt"]');
      await field.locator('[data-token="__bb__"]').waitFor();
      assert.equal(await field.locator('.dx-pchip').count(), 2);
      assert.equal(await field.evaluate(e => e.value), 'one, __aa__, two, __bb__');
      await field.locator('[data-token="__aa__"] [data-chip-duplicate]').click();
      assert.equal((await prompts()).p, 'one, __aa__, __aa__, two, __bb__');
      await field.locator('[data-token="__aa__"] [data-chip-remove]').first().click();
      assert.equal((await prompts()).p, 'one, __aa__, two, __bb__');
      await field.locator('[data-token="__aa__"]').focus();
      await page.keyboard.press('ArrowRight');
      assert.equal((await prompts()).p, 'one, __bb__, two, __aa__', 'keyboard reorder swaps only the tokens');
      assert.equal(await page.evaluate(() => document.activeElement.dataset.token), '__aa__', 'focus follows the chip');
    });
    await test('dragging a chip moves it inside the prompt and into the negative prompt', async () => {
      await page.evaluate(() => { document.activeElement.blur(); __dex.setState({ prompt: 'alpha beta, __aa__', negPrompt: 'blurry' }); });
      const field = page.locator('dex-prompt-field[data-dex-field="prompt"]');
      await field.locator('[data-token="__aa__"]').waitFor();
      const start = await field.boundingBox();
      await field.locator('[data-token="__aa__"]').dragTo(field, { targetPosition: { x: 12, y: 12 } });
      await page.waitForFunction(() => /^__aa__/.test(__dex.state.prompt));
      assert.equal((await prompts()).p, '__aa__, alpha beta');
      assert.ok(start.width > 0);
      const neg = page.locator('dex-prompt-field[data-dex-field="negative-prompt"]');
      await neg.evaluate(e => { e.disabled = false; e.removeAttribute('data-ctl-off'); for (let n = e.parentElement; n; n = n.parentElement) { if (n.tagName === 'DETAILS') n.open = true; if (getComputedStyle(n).display === 'none') n.style.display = 'block'; } }); // The default model has no negative prompt; a chip cannot be dropped on a disabled field.
      await field.locator('[data-token="__aa__"]').dragTo(neg);
      await page.waitForFunction(() => __dex.state.negPrompt.includes('__aa__'));
      const s = await prompts();
      assert.equal(s.p, 'alpha beta'); assert.equal(s.n, 'blurry, __aa__');
      await neg.locator('[data-wildcard-chip="negative"]').waitFor();
    });
    await test('typing a full token becomes a chip; typing, Enter and caret stay normal; the field empties', async () => {
      const field = page.locator('dex-prompt-field[data-dex-field="prompt"]');
      await page.evaluate(() => { document.activeElement.blur(); __dex.setState({ prompt: '' }); });
      await field.click();
      await page.keyboard.type('red __aa__ fox');
      await page.waitForFunction(() => __dex.state.prompt === 'red __aa__ fox');
      assert.equal(await field.locator('.dx-pchip').count(), 1);
      await page.keyboard.press('Enter'); await page.keyboard.type('next');
      await page.waitForFunction(() => __dex.state.prompt === 'red __aa__ fox\nnext');
      await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.press('Backspace');
      await page.waitForFunction(() => __dex.state.prompt === '');
      assert.equal(await field.evaluate(e => e.hasAttribute('data-empty')), true);
    });
    await test('A1111 keyboard editing still works in the chip field and leaves chips intact', async () => {
      const field = page.locator('dex-prompt-field[data-dex-field="prompt"]');
      await page.evaluate(() => { document.activeElement.blur(); __dex.setState({ prompt: 'red fox, __aa__' }); });
      await field.locator('[data-token="__aa__"]').waitFor();
      await field.evaluate(e => { e.focus(); e.setSelectionRange(0, 3); });
      await page.keyboard.press('ControlOrMeta+ArrowUp');
      await page.waitForFunction(() => __dex.state.prompt === '(red:1.1) fox, __aa__');
      assert.equal(await field.locator('.dx-pchip').count(), 1);
    });
    await test('bank library: copy the format, add from pasted text and from a file, edit, remove; tokens expand from edited banks', async () => {
      await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
      await page.evaluate(() => { document.activeElement.blur(); __dex.setState({ prompt: 'a fox' }); __dex.openPromptBuilder({ field: 'prompt', tab: 'randomize' }); });
      await page.locator('[data-pb-action="copy-bank-format"]').click();
      await page.waitForFunction(async () => /## bank: bank_name/.test(await navigator.clipboard.readText()));
      const format = await page.evaluate(() => navigator.clipboard.readText());
      assert.match(format, /Banks in the library now:\n- __/, 'the format lists the banks that exist');

      await page.locator('[data-pb-action="edit-library"]').click();
      assert.equal(await page.locator('[data-bank-action="edit"]').isDisabled(), true, 'Edit waits for a chosen bank');
      await page.locator('[data-bank-action="add"]').click();
      await page.locator('[data-bank-field="name"]').fill('zz test bank');
      await page.locator('[data-bank-field="entries"]').fill('# Heading becomes the description\n- solo entry\n* Solo Entry\n1. second entry\n');
      assert.match(await page.locator('[data-bank-form-status]').innerText(), /2 entries, 1 duplicates dropped/);
      await page.locator('[data-bank-action="save"]').click();
      await page.locator('[data-bank-row="zz_test_bank"]').waitFor();
      const saved = await page.evaluate(async () => (await fetch('/api/wildcards/zz_test_bank')).json());
      assert.deepEqual(saved.items, ['solo entry', 'second entry']); assert.equal(saved.description, 'Heading becomes the description');

      await page.locator('[data-bank-action="add"]').click();
      await page.locator('[data-bank-field="file"]').setInputFiles({ name: 'two banks.md', mimeType: 'text/markdown', buffer: Buffer.from('## bank: zz_one\n# tags: a, b\n- one\n\n## bank: zz_two\n- two\n') });
      await page.waitForFunction(() => /holds 2 banks/.test(document.querySelector('[data-bank-form-status]').textContent));
      await page.locator('[data-bank-action="save"]').click();
      await page.locator('[data-bank-row="zz_two"]').waitFor();
      assert.deepEqual((await page.evaluate(async () => (await fetch('/api/wildcards/zz_one')).json())).tags, ['a', 'b']);

      await page.locator('[data-bank-row="zz_test_bank"]').click();
      await page.locator('[data-bank-action="edit"]').click();
      await page.waitForFunction(() => /solo entry/.test((document.querySelector('[data-bank-field="entries"]') || {}).value || ''));
      await page.locator('[data-bank-field="entries"]').fill('only entry');
      await page.locator('[data-bank-action="save"]').click();
      await page.waitForFunction(async () => (await (await fetch('/api/wildcards/zz_test_bank')).json()).count === 1);
      const expanded = await page.evaluate(async () => (await (await fetch('/api/wildcards/expand', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: '__zz_test_bank__' }) })).json()).expanded);
      assert.equal(expanded, 'only entry', 'generation expands from the edited bank');

      for (const name of ['zz_test_bank', 'zz_one', 'zz_two']) {
        page.once('dialog', d => d.accept());
        await page.locator('[data-bank-row="' + name + '"]').click();
        await page.locator('[data-bank-action="remove"]').click();
        await page.locator('[data-bank-row="' + name + '"]').waitFor({ state: 'detached' });
      }
      assert.equal((await page.evaluate(async () => (await fetch('/api/wildcards/zz_one')).status)), 404);
      await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
      assert.deepEqual(errors, []);
    });
    await test('seed: Random checkbox, dice and reuse controls', async () => {
      await page.evaluate(() => __dex.setState({ seed: '-1', lastSeed: 4242 }));
      await page.waitForSelector('[data-dex-field="seed-random"]');
      assert.equal(await page.locator('[data-dex-field="seed-random"]').isChecked(), true, 'new seed entries default to random (-1)');
      await page.click('[data-dex-field="seed-reuse"]');
      await page.waitForFunction(() => __dex.state.seed === '4242');
      await page.waitForFunction(() => document.querySelector('[data-dex-field="seed-random"]').checked === false);
      await page.click('[data-dex-field="seed-random"]');
      await page.waitForFunction(() => __dex.state.seed === '-1');
      await page.click('[data-dex-field="seed-dice"]');
      await page.waitForFunction(() => /^\d+$/.test(String(__dex.state.seed)) && Number(__dex.state.seed) >= 0);
    });
    assert.deepEqual(errors, []);
    await ctx.close();
  } finally { await srv.stop(); }
  process.exit(exitCode());
})();
