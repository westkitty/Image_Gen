'use strict';
// Model + LoRA pickers: hover cards from the source archive (usage, trigger words, source link),
// "Randomize into prompt" and "Add trigger words", and the staged LoRAs listed in the LoRA picker.
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { startServer, installModelSnapshots, runner, launchBrowser, openStudio } = require('./helpers');
const { test, exitCode } = runner('source-hover');

(async () => {
  const srv = process.env.DEX_TEST_BASE ? { base: process.env.DEX_TEST_BASE, stop() {} } : await startServer();
  const browser = await launchBrowser(chromium);
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', e => errors.push(String(e)));
    await installModelSnapshots(page, srv.base);
    await openStudio(page, srv.base + '/dexdiffusion/');
    await page.waitForFunction(() => window.__dex && __dex.state.modelTargets && __dex.state.modelTargets.length > 3 && __dex.state.capabilityData);
    await page.evaluate(() => __dex.setScreen('create'));

    await test('model picker rows show a hover card with a source link', async () => {
      await page.click('[data-model-picker="create"] button[aria-haspopup="listbox"]');
      const row = page.locator('[data-model-id="flux2-klein-4b"]').first();
      await row.hover();
      await page.waitForSelector('.dsh-card a[href^="https://huggingface.co/"]');
      assert.match(await page.locator('.dsh-card h4').innerText(), /Klein/i);
      assert.equal(await page.locator('.dsh-card a[target="_blank"]').first().getAttribute('rel'), 'noopener noreferrer');
      await page.keyboard.press('Escape');
    });

    await test('source hover card stays inside a narrow native-sized window', async () => {
      await page.setViewportSize({ width: 390, height: 800 });
      await page.click('[data-model-picker="create"] button[aria-haspopup="listbox"]');
      await page.locator('[data-model-id="flux2-klein-4b"]').first().hover();
      const card = page.locator('.dsh-card');
      await card.waitFor({ state: 'visible' });
      const box = await card.boundingBox();
      assert.ok(box.x >= 0 && box.y >= 0, `card origin must be visible: ${JSON.stringify(box)}`);
      assert.ok(box.x + box.width <= 390, `card must fit viewport width: ${JSON.stringify(box)}`);
      assert.ok(box.y + box.height <= 800, `card must fit viewport height: ${JSON.stringify(box)}`);
      await page.keyboard.press('Escape');
      await page.setViewportSize({ width: 1280, height: 900 });
    });

    await test('slow source lookups show a loading state without blocking the picker', async () => {
      await page.route('**/api/source-info/lora/klein_anatomy_fixer_klein4b', async route => {
        await page.waitForTimeout(450);
        await route.continue();
      });
      await page.evaluate(() => __dex.selectModelWithValidation && __dex.selectModelWithValidation('flux2-klein-4b'));
      await page.waitForSelector('[data-dex-field="create-lora-adapter"]');
      await page.click('[data-dex-field="create-lora-adapter"]');
      const row = page.locator('[data-lora-id="klein_anatomy_fixer_klein4b"]');
      await row.hover();
      const card = page.locator('.dsh-card');
      await card.waitFor({ state: 'visible' });
      await page.waitForFunction(() => document.querySelector('.dsh-card h4')?.textContent.includes('Loading source information'));
      assert.equal(await card.locator('[data-act]').count(), 0, 'loading card has no premature actions');
      await page.waitForFunction(() => !document.querySelector('.dsh-card h4')?.textContent.includes('Loading source information'));
      await page.keyboard.press('Escape');
      await page.unroute('**/api/source-info/lora/klein_anatomy_fixer_klein4b');
    });

    await test('LoRA picker lists staged Klein LoRAs and hover shows triggers, usage and source', async () => {
      await page.evaluate(() => __dex.selectModelWithValidation && __dex.selectModelWithValidation('flux2-klein-4b'));
      await page.waitForSelector('[data-dex-field="create-lora-adapter"]');
      await page.click('[data-dex-field="create-lora-adapter"]');
      await page.waitForSelector('[data-lora-id="klein_anatomy_male_klein4b"]');
      const names = await page.$$eval('[data-lora-id]', e => e.map(x => x.getAttribute('data-lora-id')));
      assert.ok(names.includes('klein_fixes_nsfw_klein4b'), names.join());
      assert.ok(!names.some(n => /klein9/.test(n)), 'unstaged Klein 9B adapters are absent');
      const blocked = page.locator('[data-lora-id="sdxl_uncut_penis_sdxl"]');
      assert.equal(await blocked.isDisabled(), true, 'other-family adapters cannot be picked');
      await page.locator('[data-lora-id="klein_anatomy_male_klein4b"]').hover();
      await page.waitForSelector('.dsh-card code');
      const card = await page.locator('.dsh-card').innerText();
      assert.match(card, /uncut penis/);
      assert.match(card, /UNTESTED|staged/i);
      assert.ok(await page.locator('.dsh-card a[href^="https://civitai.com/models/2364523"]').count() >= 1);
    });

    await test('Randomize into prompt and Add trigger words write into the prompt box', async () => {
      await page.evaluate(() => { const p = document.querySelector('[data-dex-field="prompt"]'); p.value = 'a man on a beach'; p.dispatchEvent(new Event('input', { bubbles: true })); });
      await page.locator('.dsh-card [data-act="trig"]').click();
      const v1 = await page.evaluate(() => document.querySelector('[data-dex-field="prompt"]').value);
      assert.match(v1, /^a man on a beach, /); assert.match(v1, /uncut penis|circumcised penis/);
      assert.match(await page.evaluate(() => __dex.state.prompt), /beach/);
      await page.locator('.dsh-card [data-act="rand"]').click();
      assert.ok((await page.locator('.dsh-card [data-role="msg"]').innerText()).length > 0);
    });

    await test('a failed source lookup is not cached: hovering again loads the card', async () => {
      let calls = 0;
      await page.route('**/api/source-info/lora/klein_fixes_nsfw_klein4b', r => (++calls === 1 ? r.abort() : r.continue()));
      const row = page.locator('[data-lora-id="klein_fixes_nsfw_klein4b"]');
      await row.hover();
      await page.waitForSelector('.dsh-card h4:has-text("Could not load")');
      await page.locator('[data-lora-id="klein_ultimate_blowjob_klein4b"]').hover();
      await page.waitForTimeout(250);
      await row.hover();
      await page.waitForSelector('.dsh-card code');
      assert.ok(calls >= 2);
    });

    await test('several staged LoRAs can be stacked, weighted, capped and removed', async () => {
      await page.evaluate(() => __dex._setStack([]));
      await page.locator('[data-lora-id="klein_anatomy_fixer_klein4b"] ').click();
      await page.locator('[data-lora-id="klein_anatomy_male_klein4b"]').click();
      await page.locator('[data-lora-id="klein_fixes_nsfw_klein4b"]').click();
      await page.waitForFunction(() => document.querySelectorAll('[data-stack-item]').length === 3);
      await page.keyboard.press('Escape');
      await page.locator('[data-lora-picker-modal]').waitFor({ state: 'hidden' });
      const eff = await page.evaluate(() => __dex.getEffectiveCreateLoras().map(l => [l.id, l.weight]));
      assert.deepEqual(eff.map(x => x[0]), ['klein_anatomy_fixer_klein4b', 'klein_anatomy_male_klein4b', 'klein_fixes_nsfw_klein4b']);
      assert.equal(await page.locator('[data-stack-item]').count(), 3);
      assert.match(await page.locator('[data-dex-field="lora-stack-total"]').innerText(), /Total strength 1\.10 \/ 1\.8/);
      await page.locator('[data-stack-item="klein_anatomy_male_klein4b"] input').fill('1.5');
      await page.locator('[data-stack-item="klein_anatomy_male_klein4b"] input').blur();
      await page.waitForFunction(() => document.querySelector('[data-dex-field="lora-stack-total"]')?.textContent.includes('over the limit'));
      assert.match(await page.locator('[data-dex-field="lora-stack-total"]').innerText(), /over the limit/);
      await page.locator('[data-stack-item="klein_anatomy_male_klein4b"] button').click();
      await page.waitForFunction(() => document.querySelectorAll('[data-stack-item]').length === 2);
      assert.equal(await page.locator('[data-stack-item]').count(), 2);
      assert.equal(await page.evaluate(() => __dex.getEffectiveCreateLoras().length), 2);
      assert.match(await page.locator('[data-dex-field="lora-stack-total"]').innerText(), /Total strength 0\.50/);
      await page.evaluate(() => __dex._setStack([]));
    });

    await test('LoRA keyboard focus survives an unrelated render and Escape clears the hover card', async () => {
      const trigger = page.locator('[data-dex-field="create-lora-adapter"]');
      await trigger.click();
      const dialog = page.locator('[data-lora-picker-modal]');
      const search = dialog.getByRole('searchbox');
      await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Search LoRAs');
      await search.press('ArrowDown');
      assert.match(await page.locator(':focus').innerText(), /None/);
      await page.keyboard.press('ArrowDown');
      const focusedId = await page.locator(':focus').getAttribute('data-lora-id');
      assert.ok(focusedId);
      await page.evaluate(async () => {
        __dex.setState({ prompt: 'fixture focus update' });
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
      assert.equal(await page.locator(':focus').getAttribute('data-lora-id'), focusedId);
      await dialog.getByRole('button', { name: 'Close LoRA picker' }).focus();
      await page.keyboard.press('Shift+Tab');
      assert.ok(await page.locator('[data-lora-picker-modal] :focus').count());
      await page.keyboard.press('Tab');
      assert.equal(await page.locator(':focus').getAttribute('aria-label'), 'Close LoRA picker');
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
      assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
      assert.equal(await trigger.evaluate(el => el === document.activeElement), true);
      assert.equal(await page.locator('.dsh-card').count(), 0);
    });

    await test('typing leaves the closed model and LoRA option lists intact', async () => {
      const modelPicker = page.locator('[data-model-picker="create"]');
      await modelPicker.locator('button[aria-haspopup="listbox"]').click();
      await modelPicker.locator('[data-model-id="flux2-klein-4b"]').waitFor();
      await page.keyboard.press('Escape');
      await modelPicker.locator('[data-model-picker-modal]').waitFor({ state: 'hidden' });

      const mutations = await page.evaluate(async () => {
        const selectors = ['[data-model-id]', '[data-lora-id]'];
        const lists = ['[data-model-picker-modal="create"]', '[data-lora-picker-modal]']
          .map(selector => document.querySelector(selector));
        const optionCounts = lists.map((list, i) => list.querySelectorAll(selectors[i]).length);
        const count = [0, 0];
        const observers = lists.map((list, i) => {
          const observer = new MutationObserver(changes => {
            for (const change of changes) {
              for (const node of [...change.addedNodes, ...change.removedNodes]) {
                if (node.nodeType === Node.ELEMENT_NODE) {
                  count[i] += Number(node.matches(selectors[i])) + node.querySelectorAll(selectors[i]).length;
                }
              }
            }
          });
          observer.observe(list, { childList: true, subtree: true });
          return observer;
        });
        const prompt = document.querySelector('[data-dex-field="prompt"]');
        for (const text of ['closed picker fixture', 'closed picker fixture keeps typing']) {
          prompt.value = text;
          prompt.dispatchEvent(new Event('input', { bubbles: true }));
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        }
        observers.forEach(observer => observer.disconnect());
        return { optionCounts, count, prompt: __dex.state.prompt, connected: lists.every(list => list.isConnected) };
      });
      assert.ok(mutations.optionCounts.every(count => count > 0), 'both hidden option lists were populated');
      assert.equal(mutations.connected, true, 'both option lists stayed mounted');
      assert.deepEqual(mutations.count, [0, 0], 'prompt input must not rebuild either option list');
      assert.equal(mutations.prompt, 'closed picker fixture keeps typing');
    });

    await test('no page errors', async () => { assert.deepEqual(errors, []); });
  } finally { await browser.close(); srv.stop && srv.stop(); }
  process.exit(exitCode());
})().catch(e => { console.error(e); process.exit(1); });
