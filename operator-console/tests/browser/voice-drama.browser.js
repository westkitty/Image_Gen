'use strict';
// Browser acceptance for Voice Profiles, long-form controls and the Drama workflow. Real Chrome + real
// server routes; nothing here starts a Big Mac job (renders are only attempted where they must be refused).
// Created profiles/projects are deleted afterwards.
const assert = require('node:assert/strict');
const fs = require('fs'); const path = require('path');
const { chromium } = require('playwright-core');
const { startServer, makeWav, runner, launchBrowser, runCleanups } = require('./helpers');
const OUT = path.join(__dirname, '..', '..', '..', 'output', 'playwright'); fs.mkdirSync(OUT, { recursive: true });
const SCRIPT = 'INT. WAREHOUSE - NIGHT\n\nTIGER: I warned you.\nCODEC: [quietly] I know.\n\nThe rain hammers the roof.\n\n[pause 2s]\nTIGER (angry): Then why come back?\n\nEXT. ROOFTOP - DAWN\n\nNARRATOR: And so it ended.';
const { results, test, phase, exitCode } = runner('voice-drama');

(async () => {
  const srv = process.env.DEX_TEST_BASE ? { base: process.env.DEX_TEST_BASE, stop() {} } : await startServer(31931);
  const browser = await launchBrowser(chromium);
  const made = { profiles: [], projects: [] };
  const api = async (m, r, b) => { const x = await fetch(srv.base + r, { method: m, headers: { 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return x.json(); };
  const open = async (opts = {}) => {
    const ctx = await browser.newContext({ viewport: { width: opts.width || 1280, height: opts.height || 900 } }), page = await ctx.newPage();
    const errors = []; page.on('pageerror', e => errors.push(String(e)));
    await page.goto(srv.base + '/dexdiffusion/'); await page.waitForFunction(() => window.__dex && __dex.state.modelTargets && __dex.state.modelTargets.length > 3);
    return { ctx, page, errors };
  };
  try {
    // leftovers from an interrupted earlier run
    for (const p of (await api('GET', '/api/voice/profiles')).profiles) if (p.name.startsWith('ZZ-UI-')) await api('DELETE', '/api/voice/profiles/' + p.id);
    for (const p of (await api('GET', '/api/drama/projects')).projects) if (p.title.startsWith('ZZ-UI-') || p.title === 'Untitled drama') await api('DELETE', '/api/drama/projects/' + p.id);
    await test('Voice profiles: designed + preset voices, validation, capability truth, direction gating, long-form estimate', async () => {
      const { ctx, page, errors } = await open();
      await page.evaluate(() => __dex.setScreen('voice')); await page.waitForSelector('[data-voice-profiles]'); await page.waitForFunction(() => __dex.vp && __dex.vp.profiles);
      await page.click('[data-new-voice-button]');
      await page.click('[data-new-type="designed"]'); await page.fill('[data-new-name]', 'ZZ-UI-Designed');
      await page.fill('[data-new-voice] textarea', 'a calm older woman with a warm slow voice and a slight rasp');
      await page.click('[data-create-voice]'); await page.waitForSelector('[data-profile-editor]');
      let ed = await page.innerText('[data-profile-editor]'); assert.match(ed, /ready to render/); assert.match(ed, /VALID/i);
      assert.equal(await page.isEnabled('[data-profile-render] input[placeholder*="whispering"]'), true, 'VoiceDesign honors delivery directions');
      assert.match(await page.$eval('[data-engine-caps]', e => e.textContent), /Delivery \/ performance direction/);
      await page.fill('[data-profile-render] textarea', 'word '.repeat(1200));
      await page.waitForFunction(() => /long-form/.test(document.querySelector('[data-profile-render]').innerText));
      await page.click('[data-new-voice-button]'); await page.click('[data-new-type="preset"]'); await page.fill('[data-new-name]', 'ZZ-UI-Preset'); await page.click('[data-create-voice]');
      await page.waitForSelector('[data-profile-editor]:has-text("ZZ-UI-Preset")');
      assert.equal(await page.isEnabled('[data-profile-render] input[placeholder*="unavailable"]'), false, 'Kokoro cannot honor direction → disabled, with explanation');
      assert.match(await page.innerText('[data-profile-render]'), /not supported by Kokoro/i);
      const profs = (await api('GET', '/api/voice/profiles')).profiles; profs.filter(p => p.name.startsWith('ZZ-UI-')).forEach(p => made.profiles.push(p.id));
      assert.equal(made.profiles.length, 2, JSON.stringify(profs.map(p => p.name))); assert.deepEqual(errors, []);
      await page.screenshot({ path: path.join(OUT, 'voice-profiles.png') }); await ctx.close();
    });

    await test('Cloned voice: invalid until a sample WITH transcript is approved; multiple samples; active sample; remove', async () => {
      const { ctx, page } = await open();
      await page.evaluate(() => { __dex.setScreen('voice'); });
      await page.waitForSelector('[data-voice-profiles]'); await page.click('[data-new-voice-button]'); await page.click('[data-new-type="cloned"]'); await page.fill('[data-new-name]', 'ZZ-UI-Clone'); await page.click('[data-create-voice]');
      await page.waitForSelector('[data-profile-editor]:has-text("ZZ-UI-Clone")');
      const pid = (await api('GET', '/api/voice/profiles')).profiles.find(p => p.name === 'ZZ-UI-Clone').id; made.profiles.push(pid);
      assert.match(await page.innerText('[data-profile-validation]'), /add at least one reference sample/);
      for (const [i, hz] of [[1, 220], [2, 330]]) {
        await page.setInputFiles('[data-profile-editor] input[type=file]', { name: `s${i}.wav`, mimeType: 'audio/wav', buffer: makeWav(5, hz) });
        await page.waitForSelector('[data-pending-sample]');
        await page.fill('[data-pending-sample] textarea', i === 1 ? 'This is the first sample.' : 'Second sample words.');
        await page.click('[data-pending-sample] button:has-text("Approve")'); await page.waitForFunction(n => document.querySelectorAll('[data-sample]').length === n, i, { timeout: 15000 });
      }
      await page.waitForFunction(() => document.querySelectorAll('[data-sample]').length === 2);
      assert.match(await page.innerText('[data-profile-validation]'), /ready to render|uses one reference/);
      const act = async () => (await api('GET', '/api/voice/profiles/' + pid)).profile.samples.map(s => s.active);
      assert.deepEqual(await act(), [true, false]);
      await page.locator('[data-sample]').nth(1).locator('button:has-text("Use this sample")').click(); await page.waitForFunction(() => /active/.test(document.querySelectorAll('[data-sample]')[1].innerText));
      assert.deepEqual(await act(), [false, true]);
      const p = (await api('GET', '/api/voice/profiles/' + pid)).profile; assert.ok(p.samples.every(s => s.diagnostics && s.diagnostics.duration > 4.9));
      await page.on('dialog', d => d.accept());
      await page.locator('[data-sample]').nth(0).locator('button:has-text("Remove")').click(); await page.waitForFunction(() => document.querySelectorAll('[data-sample]').length === 1);
      assert.deepEqual(await act(), [true]);
      await ctx.close();
    });

    await test('Voice render state belongs to the voice that started it (no progress/result/error leaks onto another voice)', async () => {
      const { ctx, page, errors } = await open();
      let polls = 0;
      await page.route('**/api/voice/render', async r => { if (r.request().method() !== 'POST') return r.fallback(); r.fulfill({ json: { job_id: 'job-own-1', long_form: false, chunks: 1, delivery: {}, warnings: [] } }); });
      await page.route('**/api/voice/render/job-own-1', async r => {
        polls++;
        if (polls < 6) return r.fulfill({ json: { status: 'RUNNING', label: 'Generating chunk 1/1', progress: { done: 0, total: 1 } } });
        r.fulfill({ json: { status: 'COMPLETE', label: 'Done', artifact: { artifact_id: 'art-own-1', url: '/api/media/none.wav', download_url: '/api/media/none.wav', duration: 1.5, sha256: 'ab'.repeat(32), meta: {} } } });
      });
      await page.evaluate(() => __dex.setScreen('voice')); await page.waitForSelector('[data-voice-profiles]'); await page.waitForFunction(() => __dex.vp && __dex.vp.profiles);
      const mk = async name => { await page.click('[data-new-voice-button]'); await page.click('[data-new-type="preset"]'); await page.fill('[data-new-name]', name); await page.click('[data-create-voice]'); await page.waitForSelector(`[data-profile-editor]:has-text("${name}")`); };
      await mk('ZZ-UI-Own-A'); await mk('ZZ-UI-Own-B');
      (await api('GET', '/api/voice/profiles')).profiles.filter(x => x.name.startsWith('ZZ-UI-Own-')).forEach(x => made.profiles.push(x.id));
      // start on B (the profile created last is selected), then look at A while it runs
      await page.fill('[data-profile-render] textarea', 'Hello there.');
      await page.click('[data-render-speech]'); await page.waitForSelector('[data-render-progress]');
      await page.click('[data-profile="' + (await api('GET', '/api/voice/profiles')).profiles.find(x => x.name === 'ZZ-UI-Own-A').id + '"]');
      await page.waitForSelector('[data-profile-editor]:has-text("ZZ-UI-Own-A")');
      assert.equal(await page.$('[data-render-progress]'), null, 'B\'s progress must not show on A');
      assert.match(await page.innerText('[data-render-speech]'), /Waiting: "ZZ-UI-Own-B" is rendering/);
      assert.equal(await page.isDisabled('[data-render-speech]'), true);
      await page.waitForFunction(() => __dex.vp.render && __dex.vp.render.status === 'COMPLETE', null, { timeout: 20000 });
      assert.equal(await page.$('[data-render-result]'), null, 'B\'s finished result must not show on A');
      assert.equal(await page.isEnabled('[data-render-speech]'), true, 'A can render once B is done');
      await page.click('[data-profile="' + (await api('GET', '/api/voice/profiles')).profiles.find(x => x.name === 'ZZ-UI-Own-B').id + '"]');
      await page.waitForSelector('[data-render-result]'); // owner still shows it
      assert.deepEqual(errors, []); await ctx.close();
    });

    await test('Drama: paste → parse → review/edit → cast → privacy banner → save/unsave → blocked render → assemble refuses without takes', async () => {
      const { ctx, page, errors } = await open();
      await page.evaluate(() => __dex.setScreen('drama')); await page.waitForSelector('[data-drama-script-input]');
      await page.fill('[data-drama-script-input]', SCRIPT);
      await page.click('[data-parse]'); await page.waitForSelector('[data-drama-cast]');
      const pid = await page.evaluate(() => __dex.dm.current.id); made.projects.push(pid);
      assert.equal(await page.$$eval('[data-scene]', e => e.length), 2); assert.equal(await page.$$eval('[data-line]', e => e.length), 5);
      assert.match(await page.innerText('[data-drama-unresolved]'), /TIGER.*CODEC|CODEC.*TIGER/s);
      for (const k of ['TIGER', 'CODEC', 'NARRATOR']) assert.ok(await page.$(`[data-actor="${k}"]`), 'speaker discovered ' + k);
      assert.match(await page.innerText('[data-drama-privacy="unsaved"]'), /UNSAVED working script/);
      // blocked render surfaces the reason (no job)
      await page.click('[data-render-project]'); await page.waitForFunction(() => /assign voices to/.test(__dex.dm.error || ''));
      assert.match(await page.evaluate(() => __dex.dm.error), /TIGER/);
      // bind two actors to voices
      const ids = made.profiles; await page.evaluate(() => {});
      const p1 = made.profiles[0], p2 = made.profiles[1];
      await page.selectOption('[data-actor="TIGER"] select', p1); await page.waitForFunction(() => !/TIGER/.test(document.querySelector('[data-drama-unresolved]').innerText));
      await page.selectOption('[data-actor="CODEC"] select', p2); await page.selectOption('[data-actor="NARRATOR"] select', p2);
      await page.waitForFunction(() => !document.querySelector('[data-drama-unresolved]'));
      // edit a line direction by typing, then verify the server has it (debounced PATCH, no lost input)
      const ln = '[data-line] input[placeholder="e.g. quietly"]'; await page.locator(ln).first().fill('furious but controlled');
      await page.waitForFunction(async id => (await (await fetch('/api/drama/projects/' + id)).json()).project.scenes[0].lines.some(l => l.direction === 'furious but controlled'), pid, { timeout: 8000 });
      // reassign a speaker through the UI
      await page.locator('[data-line] input[list="dm-speakers"]').first().fill('Rex'); await page.keyboard.press('Tab');
      await page.waitForFunction(() => document.querySelector('[data-actor="REX"]'));
      // privacy: unsaved → not on disk → save → saved
      assert.equal((await api('GET', '/api/drama/projects')).projects.find(p => p.id === pid).saved, false);
      await page.click('[data-drama-save]'); await page.waitForSelector('[data-drama-privacy="saved"]');
      assert.ok(fs.existsSync(path.join(__dirname, '..', '..', '..', 'sdcpp-workflow', 'state', 'drama', pid + '.json')));
      assert.match(await page.innerText('[data-drama-privacy="saved"]'), /still never copied into job logs/);
      // assemble without takes → visible refusal naming lines
      await page.click('[data-assemble-project]'); await page.waitForSelector('[data-assemble-error]');
      assert.match(await page.innerText('[data-assemble-error]'), /no generated take/);
      assert.deepEqual(errors, []);
      await page.screenshot({ path: path.join(OUT, 'drama.png'), fullPage: false });
      await page.once('dialog', d => d.accept()); await page.click('[data-drama-unsave]'); await page.waitForSelector('[data-drama-privacy="unsaved"]');
      assert.equal(fs.existsSync(path.join(__dirname, '..', '..', '..', 'sdcpp-workflow', 'state', 'drama', pid + '.json')), false);
      await ctx.close();
    });

    await test('Drama LLM parse mode reports rejection/failure visibly (never silently falls back)', async () => {
      const { ctx, page } = await open();
      // The model call itself is covered by unit tests with a fake chat; here we assert how the UI shows a refusal.
      await page.route('**/api/drama/projects', r => r.request().method() === 'POST' ? r.fulfill({ status: 422, json: { ok: false, mode: 'llm', errors: ['1 line(s) were not verbatim text from your script and were rejected: the model may not rewrite dialogue'], rejected: [{ index: 0, speaker: 'TIGER', text: 'I TOLD you so.' }] } }) : r.fallback());
      await page.evaluate(() => __dex.setScreen('drama')); await page.waitForSelector('[data-drama-script-input]');
      await page.click('[data-parse-mode="llm"]'); await page.fill('[data-drama-script-input]', 'TIGER: I warned you.');
      await page.click('[data-parse]'); await page.waitForSelector('[data-parse-error]');
      const txt = await page.innerText('[data-parse-error]');
      assert.match(txt, /not verbatim/); assert.match(txt, /rejected: TIGER: I TOLD you so\./);
      assert.equal(await page.$('[data-drama-cast]'), null, 'no project is created from a rejected parse');
      await ctx.close();
    });

    for (const width of [375, 768]) {
      await test(`responsive @${width}px: Voice profiles + Drama have no horizontal overflow`, async () => {
        const { ctx, page } = await open({ width, height: 812 });
        const pid = (await api('POST', '/api/drama/projects', { title: 'ZZ-UI-Resp', script: SCRIPT })).project.id; made.projects.push(pid);
        for (const screen of ['voice', 'drama']) {
          await page.evaluate(([s, id]) => { if (s === 'drama') { __dex._dm(); __dex.dm.currentId = id; } __dex.setScreen(s); }, [screen, pid]);
          await page.waitForTimeout(700);
          if (screen === 'voice') { await page.waitForSelector('[data-voice-profiles]'); const first = await page.$('[data-profile]'); if (first) await first.click(); await page.waitForTimeout(300); }
          else await page.waitForSelector('[data-drama]');
          const o = await page.evaluate(() => { const bad = []; document.querySelectorAll('[data-scroll-pane]').forEach(p => { if (p.scrollWidth > p.clientWidth + 1) bad.push(p.scrollWidth + '>' + p.clientWidth); }); return { doc: document.documentElement.scrollWidth - innerWidth, bad }; });
          assert.ok(o.doc <= 1 && !o.bad.length, `${screen}: ${JSON.stringify(o)}`);
          await page.screenshot({ path: path.join(OUT, `${screen}-${width}.png`) });
        }
        await ctx.close();
      });
    }
  } finally {
    for (const id of made.projects) { try { await api('DELETE', '/api/drama/projects/' + id); } catch (_) {} }
    for (const id of made.profiles) { try { await api('DELETE', '/api/voice/profiles/' + id); } catch (_) {} }
    await browser.close(); await srv.stop();
  }
  const failed = results.filter(r => r[0] === 'FAIL');
  console.log(`\n${results.length - failed.length}/${results.length} voice/drama browser checks passed`);
  fs.writeFileSync(path.join(OUT, 'voice-drama-results.json'), JSON.stringify(results, null, 1));
  process.exit(exitCode(failed.length));
})().catch(e => { console.error(e); runCleanups().then(() => process.exit(2)); });
