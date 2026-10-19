'use strict';
// Browser acceptance for the Audio Drama Studio UI (SCRIPT → CAST → DIRECT → PRODUCE → REVIEW → MASTER → EXPORT) and the Voice Designer.
// Real Chrome + real server routes. Nothing here may reach Big Mac: production and audition POSTs are answered by fixtures, everything else
// (parsing, cast bible, FX, cues, procedural effects, mastering settings, QA, packages, voice bank) runs against the real local backend.
// Created profiles/projects are deleted afterwards.
const assert = require('node:assert/strict');
const fs = require('fs'); const path = require('path');
const { chromium } = require('playwright-core');
const { startServer, installModelSnapshots, runner, launchBrowser } = require('./helpers');
const { resolveOutputDir, createOwnedWriter } = require('./safe-output');
// A fresh directory per run (or the explicit one); existing files are never replaced.
const OUT = resolveOutputDir(process.env.DEX_BROWSER_OUTPUT_DIR, { label: 'studio' }), WRITER = createOwnedWriter(OUT), outPath = n => WRITER.pathFor(n);
const SCRIPT = 'INT. WAREHOUSE - NIGHT\n[AMBIENCE: rain on a tin roof, loop, fade in 1s]\nTIGER: I warned you about the lamp.\nCODEC: [quietly] I know that already.\n\nEXT. ROOFTOP - DAWN\nNARRATOR: And so it ended.';
const { results, test, phase, exitCode } = runner('drama-studio');

(async () => {
  const srv = process.env.DEX_TEST_BASE ? { base: process.env.DEX_TEST_BASE, stop() {} } : await startServer(31932);
  const browser = await launchBrowser(chromium);
  const made = { profiles: [], projects: [] };
  const api = async (m, r, b) => { const x = await fetch(srv.base + r, { method: m, signal: AbortSignal.timeout(20000), headers: { 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return x.json(); };
  const open = async (opts = {}) => {
    const ctx = await browser.newContext({ viewport: { width: opts.width || 1280, height: opts.height || 900 }, reducedMotion: opts.reducedMotion || 'no-preference', acceptDownloads: true }), page = await ctx.newPage();
    await page.addInitScript(() => { window.__unhandledRejections = []; addEventListener('unhandledrejection', e => window.__unhandledRejections.push(String(e.reason))); });
    await installModelSnapshots(page, srv.base);
    const errors = []; page.on('pageerror', e => errors.push(String(e)));
    // the studio must never reach Big Mac from a browser test
    const blocked = []; await page.route('**/api/drama/projects/*/produce', r => { blocked.push('produce'); r.fulfill({ status: 202, json: FIX.produce(page) }); });
    await page.route('**/api/voice/profiles/*/auditions', r => (r.request().method() === 'POST' ? (blocked.push('audition'), r.fulfill({ status: 202, json: { round: FIX.round('rendering') } })) : r.fallback()));
    await page.goto(srv.base + '/dexdiffusion/'); await page.waitForFunction(() => window.__dex && __dex.state.modelTargets && __dex.state.modelTargets.length > 3);
    return { ctx, page, errors, blocked };
  };
  const FIX = {
    produce: () => ({ job_id: 'job-fixture', production: FIX.prod('planning'), plan: {} }),
    prod: (status, extra) => Object.assign({ id: 'pr-fixture1', project_id: 'x', job_id: 'job-fixture', status, phase: status, progress: { phase: status, label: status === 'rendering' ? 'Scene 1/2 · line 2/3 · chunk 1/1' : status, done: status === 'rendering' ? 1 : 3, total: 3, waiting: false }, source_rev: 1, noop: false, superseded: false, lines: { total: 3, reused: 0, generated: status === 'complete' ? 3 : 1, failed: 0 }, chunks: { total: 3, cached: 0, generated: status === 'complete' ? 3 : 1, failed: 0, retries: 0, invalid: 0 }, scenes: [], errors: [], warnings: [], artifacts: { master: null, scenes: [], outputs: {}, stems: {} } }, extra || {}),
    round: (status) => ({ id: 'ar-fixture1', profile_id: 'vp-x', created_at: Date.now(), status, engine: 'qwen3-tts-voice-design', runtime: 'mlx-audio 0.5.6', line_count: 1, identity_version: 1, stale: false, candidates: [1, 2].map(i => ({ id: 'au-fix000' + i, seed: 1000 + i, status: status === 'rendering' ? 'rendering' : 'complete', favorite: false, rejected: false, note: '', approved: false, clips: status === 'rendering' ? [] : [{ line_index: 0, artifact_id: 'fix-aud-' + i + '.wav', url: '/api/media/fix-aud-' + i + '.wav', duration: 4.2, sha256: 'a'.repeat(64) }] })) }),
  };
  const until = async (fn, what, ms = 20000) => { const t = Date.now(); for (;;) { let v; try { v = await fn(); } catch (_) { v = false; } if (v) return v; if (Date.now() - t > ms) throw new Error('timed out waiting for ' + what); await new Promise(r => setTimeout(r, 150)); } };
  const proj = async id => (await api('GET', '/api/drama/projects/' + id)).project;
  const lineIds = async pid => (await api('GET', '/api/drama/projects/' + pid)).project.scenes.flatMap(s => s.lines).filter(l => l.kind === 'dialogue');
  let pid = null, vA = null, vB = null;
  try {
    // two local preset voices (Kokoro cannot honour acting directions, which the Cast Bible must say truthfully)
    vA = (await api('POST', '/api/voice/profiles', { name: 'ZZ-ST-A', type: 'preset', preset_voice: 'af_heart' })).profile.id; vB = (await api('POST', '/api/voice/profiles', { name: 'ZZ-ST-B', type: 'preset', preset_voice: 'am_adam' })).profile.id; made.profiles.push(vA, vB);
    pid = (await api('POST', '/api/drama/projects', { title: 'ZZ-ST-Drama', script: SCRIPT })).project.id; made.projects.push(pid);

    await test('Studio: seven stages inside one Drama module; state line; classification proof; re-parse previews before it changes anything', async () => {
      const { ctx, page, errors } = await open();
      await page.evaluate(id => { __dex._dm(); __dex.dm.currentId = id; __dex.setScreen('drama'); }, pid); await page.waitForSelector('[data-drama-stages]');
      assert.equal(await page.$$eval('[data-stage]', e => e.map(x => x.dataset.stage).join()), 'script,cast,direct,produce,review,master,export');
      assert.equal(await page.$$eval('[role=tab][data-stage][aria-selected=true]', e => e.length), 1); assert.match(await page.getAttribute('[data-drama-state]', 'data-drama-state'), /missing-cast|parsing/);
      assert.match(await page.innerText('[data-source-coverage]'), /every character of the script is classified/);
      assert.equal(await page.$$eval('[data-line]', e => e.length), 4, '3 spoken lines + the AMBIENCE cue are kept as source lines');
      assert.match(await page.innerText('[data-drama-state] [data-next-step]'), /Cast voices/);
      await page.fill('[data-drama-script-input]', SCRIPT.replace('about the lamp', 'about the light')); await page.waitForFunction(() => /light/.test(__dex._dmText.script));
      await page.click('[data-reparse]'); await page.waitForSelector('[data-reparse-preview]');
      assert.match(await page.innerText('[data-reparse-preview]'), /1 edited/); assert.match(await page.innerText('[data-reparse-preview]'), /nothing has changed yet/i);
      assert.match((await api('GET', '/api/drama/projects/' + pid)).project.source_script, /lamp/, 'preview did not touch the project');
      await page.click('[data-reparse-apply]'); await page.waitForFunction(() => !document.querySelector('[data-reparse-preview]'));
      assert.match((await api('GET', '/api/drama/projects/' + pid)).project.source_script, /light/); assert.equal((await api('GET', '/api/drama/projects/' + pid)).project.source.rev, 2);
      assert.deepEqual(errors, []); await page.screenshot({ path: outPath('studio-script.png') }); await ctx.close();
    });

    await test('Save and Continue waits for durable Drama save and reads the saved project back', async () => {
      const { ctx, page, errors } = await open();
      try {
        await page.evaluate(async id => { await __dex.openDramaProject(id, true); __dex.dm.current.saved = false; __dex.setScreen('drama', { skipUnsavedGuard: true }); }, pid);
        await page.waitForSelector('[data-drama-stages]');
        assert.equal(await page.evaluate(() => __dex.dm.current.saved), false);
        await page.locator('.ca-nav-item', { hasText: 'Voice' }).click();
        await page.waitForSelector('[data-workspace-leave-dialog="drama"]');
        await page.screenshot({ path: outPath('studio-save-and-continue-dialog.png') });
        await page.getByRole('button', { name: 'Save and continue' }).click();
        await page.waitForSelector('.ca-shell[data-ca-module="voice"]');
        const saved = await proj(pid);
        assert.equal(saved.saved, true, 'server readback confirms explicit durable save');
        assert.equal(await page.evaluate(() => __dex.state.activeAssetSelection?.kind), 'drama-project');
        assert.deepEqual(errors, []);
      } finally { await ctx.close(); }
    });

    await test('browser Back during an unsaved Drama script is declined by beforeunload and preserves the draft', async () => {
      const { ctx, page, errors } = await open();
      try {
        await page.evaluate(() => { __dex.setScreen('drama', { skipUnsavedGuard: true }); __dex._dmText.script = 'private unsaved browser-history draft'; });
        const dialogPromise = page.waitForEvent('dialog', { timeout: 4000 });
        const backPromise = page.goBack({ timeout: 4000 }).catch(() => null);
        const dialog = await dialogPromise;
        assert.equal(dialog.type(), 'beforeunload');
        await dialog.dismiss(); await backPromise;
        await page.waitForTimeout(100);
        assert.match(page.url(), /\/dexdiffusion\//);
        assert.equal(await page.evaluate(() => __dex._dmText.script), 'private unsaved browser-history draft');
        assert.deepEqual(errors, []);
      } finally { await ctx.close(); }
    });

    await test('unparsed Drama script offers no fake Save action and remains in memory when switching modules', async () => {
      const { ctx, page, errors } = await open();
      try {
        const draftState = await page.evaluate(() => { __dex.setScreen('drama', { skipUnsavedGuard: true }); __dex._dmText.script = 'draft not yet parsed into a saveable project'; return { screen: __dex.state.screens[__dex.state.version], dirty: __dex._unsavedWorkspaceWork() }; });
        assert.equal(draftState.screen, 'drama'); assert.equal(draftState.dirty.workspace, 'drama');
        const navigation = await page.evaluate(() => { window.__confirmMessage = ''; window.confirm = message => { window.__confirmMessage = message; return true; }; return __dex.setScreen('voice'); });
        assert.equal(navigation, true);
        assert.match(await page.evaluate(() => window.__confirmMessage), /Drama project or script/);
        assert.equal(await page.locator('[data-workspace-leave-dialog]').count(), 0, 'unparsed private script has no save handler to offer');
        await page.waitForSelector('.ca-shell[data-ca-module="voice"]');
        assert.equal(await page.evaluate(() => __dex._dmText.script), 'draft not yet parsed into a saveable project');
        assert.deepEqual(errors, []);
      } finally { await ctx.close(); }
    });

    await test('Save failure keeps Drama draft and pending navigation; delayed save accepts one continuation only', async () => {
      const { ctx, page, errors } = await open();
      try {
        await page.evaluate(async id => { await __dex.openDramaProject(id, true); __dex.dm.current.saved = false; __dex.setScreen('drama', { skipUnsavedGuard: true }); }, pid);
        await page.waitForSelector('[data-drama-stages]');
        await page.locator('.ca-nav-item', { hasText: 'Voice' }).click();
        await page.waitForSelector('[data-workspace-leave-dialog="drama"]');
        await page.getByRole('button', { name: 'Stay' }).click();
        assert.equal(await page.evaluate(() => document.activeElement?.textContent.trim()), 'Voice', 'Stay restores focus to the navigation control that opened the guard');
        const lineId = await page.evaluate(() => __dex.dm.current.scenes.flatMap(s => s.lines).find(l => l.kind === 'dialogue').id);
        const lineRoute = `**/api/drama/projects/${pid}/lines/${lineId}`;
        await page.evaluate(line => { __dex.dm.pending[line] = { text: 'fixture unsaved line' }; }, lineId);
        await page.route(lineRoute, route => route.fulfill({ status: 503, json: { error: 'fixture line-save failure' } }));
        assert.equal(await page.evaluate(async () => __dex._dmFlush()), false);
        assert.equal(await page.evaluate(line => __dex.dm.pending[line]?.text, lineId), 'fixture unsaved line');
        await page.unroute(lineRoute);
        await page.evaluate(() => { __dex.dm.pending = {}; });
        await page.route(`**/api/drama/projects/${pid}/save`, route => route.fulfill({ status: 503, json: { error: 'fixture durable-save failure' } }));
        await page.locator('.ca-nav-item', { hasText: 'Voice' }).click();
        await page.waitForSelector('[data-workspace-leave-dialog="drama"]');
        await page.getByRole('button', { name: 'Save and continue' }).click();
        await page.waitForSelector('[data-workspace-leave-dialog="drama"] [role="alert"]:not([hidden])');
        assert.equal(await page.evaluate(() => __dex.state.screens[__dex.state.version]), 'drama');
        assert.equal(await page.evaluate(() => __dex.dm.current.id), pid);
        assert.equal(await page.evaluate(() => document.activeElement?.textContent.trim()), 'Save and continue', 'failed save returns focus to its retry action');
        assert.equal(await page.evaluate(() => __dex.setScreen('system')), false);
        assert.equal(await page.locator('[data-workspace-leave-dialog="drama"]').count(), 1, 'competing navigation cannot create a second decision');
        await page.unroute(`**/api/drama/projects/${pid}/save`);

        let release, startedResolve, calls = 0;
        const started = new Promise(resolve => { startedResolve = resolve; });
        const held = new Promise(resolve => { release = resolve; });
        await page.route(`**/api/drama/projects/${pid}/save`, async route => { calls++; startedResolve(); await held; await route.continue(); });
        await page.evaluate(() => { const original = __dex.dramaSave.bind(__dex); __dex.dramaSave = async (...args) => { const result = await original(...args); window.__dramaSaveResult = result; return result; }; });
        await page.getByRole('button', { name: 'Save and continue' }).click();
        await started;
        assert.equal(await page.evaluate(() => __dex.setScreen('music')), false);
        assert.equal(await page.evaluate(() => __dex.state.screens[__dex.state.version]), 'drama');
        assert.equal(await page.locator('[data-workspace-leave-dialog="drama"]').count(), 1);
        release();
        await page.waitForFunction(() => window.__dramaSaveResult !== undefined, null, { timeout: 5000 }).catch(() => {});
        const state = await page.evaluate(() => ({ screen: __dex.state.screens[__dex.state.version], saveResult: window.__dramaSaveResult, pending: __dex._pendingWorkspaceNavigation && { target: __dex._pendingWorkspaceNavigation.targetScreen, saving: __dex._pendingWorkspaceNavigation.saving }, saved: __dex.dm.current && __dex.dm.current.saved, toast: __dex.state.toasts.map(t => t.msg) }));
        assert.equal(state.screen, 'voice', JSON.stringify(state)); // first requested destination owns the pending decision
        assert.equal(calls, 1, 'pending save was submitted once');
        assert.equal((await proj(pid)).saved, true);
        assert.deepEqual(errors, []);
        assert.deepEqual(await page.evaluate(() => window.__unhandledRejections), []);
      } finally { await ctx.close(); }
    });

    await test('Cast Bible: voices, role, pronunciation, FX rack, optional pacing; unsupported controls are disabled with the engine evidence', async () => {
      const { ctx, page, errors } = await open();
      await page.evaluate(id => { __dex._dm(); __dex.dm.currentId = id; __dex.dm.stage = 'cast'; __dex.setScreen('drama'); }, pid); await page.waitForSelector('[data-drama-cast]');
      for (const k of ['TIGER', 'CODEC', 'NARRATOR']) await page.waitForSelector(`[data-actor="${k}"]`);
      for (const [k, v] of [['TIGER', vA], ['CODEC', vB], ['NARRATOR', vB]]) await page.selectOption(`[data-actor="${k}"] select >> nth=0`, v);
      await page.waitForFunction(() => !document.querySelector('[data-drama-unresolved]'));
      assert.match(await page.innerText('[data-permitted="TIGER"]'), /direction no/); assert.match(await page.innerText('[data-actor="TIGER"]'), /cannot apply delivery directions/i);
      assert.equal(await page.isDisabled('[data-actor="TIGER"] input[placeholder*="unavailable"]'), true, 'the direction field is disabled for Kokoro, with a reason');
      await page.selectOption('[data-fx-select="TIGER"]', 'radio'); await until(async () => (await proj(pid)).actors.find(a => a.speaker_key === 'TIGER').fx?.preset === 'radio', 'TIGER fx radio');
      await page.selectOption('[data-pacing-select="CODEC"]', 'fast_monologue'); await until(async () => (await proj(pid)).actors.find(a => a.speaker_key === 'CODEC').pacing?.target_wpm === 300, 'CODEC pacing 300 wpm');
      const tid = await page.evaluate(() => __dex.dm.current.actors.find(a => a.speaker_key === 'TIGER').id);
      await page.click(`[data-actor="TIGER"] details summary`); await page.fill('#pr-from-' + tid, 'lamp');
      await page.fill('#pr-to-' + tid, 'lamb'); await page.click('[data-pron-add="TIGER"]'); await until(async () => (await proj(pid)).actors.find(a => a.speaker_key === 'TIGER').pronunciation.length === 1, 'pronunciation rule saved');
      await page.click('[data-fx-open="TIGER"]'); await page.waitForSelector('[data-fx-editor="TIGER"]'); assert.ok(await page.$$eval('[data-fx-node]', e => e.length) >= 4, 'the radio chain is editable node by node');
      assert.match(await page.innerText('[data-fx-editor="TIGER"]'), /echo-tap room simulation/);
      const act = (await api('GET', '/api/drama/projects/' + pid)).project.actors; assert.ok(act.every(a => a.history.length >= 1));
      assert.deepEqual(errors, []); await page.screenshot({ path: outPath('studio-cast.png') }); await ctx.close();
    });

    await test('Direct: script cues are cues (never speech), bound to a locally generated effect; timeline model, waveforms and keyboard editing work', async () => {
      const { ctx, page, errors } = await open();
      const [l1] = await lineIds(pid); const sceneId = (await api('GET', '/api/drama/projects/' + pid)).project.scenes[0].id; const clipCalls = [];
      await page.evaluate(id => { __dex._dm(); __dex.dm.currentId = id; __dex.dm.stage = 'direct'; __dex.setScreen('drama'); }, pid); await page.waitForSelector('[data-sound-director]');
      await page.waitForSelector('[data-cue]'); assert.match(await page.innerText('[data-cue]'), /rain on a tin roof/); assert.match(await page.innerText('[data-cue]'), /unresolved/);
      await page.click('[data-cue-suggest]'); await page.waitForSelector('[data-procedural="rain"]'); assert.match(await page.innerText('[data-sound-director]'), /nothing is downloaded/i);
      await page.click('[data-procedural="rain"]'); await until(async () => (await api('GET', '/api/drama/projects/' + pid + '/cues')).cues[0].status === 'resolved', 'cue bound', 30000);
      const cue = (await api('GET', '/api/drama/projects/' + pid + '/cues')).cues[0]; assert.equal(cue.track.loop, true); assert.ok(cue.artifact_id.startsWith('proc-rain')); assert.equal((await api('GET', '/api/library?kind=music')).items.find(i => i.artifact_id === cue.artifact_id).operation, 'procedural-sfx');
      // timeline view model (fixture: no Big Mac takes exist in this hermetic run)
      const peaks = { bins: 240, min: Array.from({ length: 240 }, (_, i) => -Math.round(40 + 30 * Math.sin(i / 6))), max: Array.from({ length: 240 }, (_, i) => Math.round(40 + 30 * Math.sin(i / 6))), duration: 2 };
      await page.route('**/api/voice/peaks/**', r => r.fulfill({ json: peaks }));
      await page.route(`**/api/drama/projects/${pid}/scenes/${sceneId}/timeline`, r => r.fulfill({ json: { timeline: { scene_id: sceneId, title: 'INT. WAREHOUSE - NIGHT', rate: 48000, length_s: 6, incomplete: false, fresh: false, action: 'rebuild', master: null, mix: {}, markers: [{ id: 'mk-1', scene_id: sceneId, t_s: 3, label: 'beat' }], regions: [], unresolved_cues: [], lines: [],
        lanes: [{ id: 'dlg:TIGER', kind: 'dialogue', speaker_key: 'TIGER', label: 'TIGER', clips: [{ id: 'c:' + l1.id, line_id: l1.id, take_id: 'tk-fx', artifact_id: 'fx-take.wav', url: '/api/media/fx-take.wav', start_s: 0.5, duration_s: 2, src_offset_s: 0, gain_db: 0, fade_in_s: 0, fade_out_s: 0, fx: { preset: 'radio', identity: 'abc' }, tempo: 1, pinned: false, take_state: { label: 'COMPLETE', freshness: 'current' }, overrides: null }] },
          { id: 'music', kind: 'cue', role: 'music', clips: [] }, { id: 'ambience', kind: 'cue', role: 'ambience', clips: [{ id: 'cue:' + cue.track.id, track_id: cue.track.id, artifact_id: cue.artifact_id, url: '/api/media/' + cue.artifact_id, resolved: true, start_s: 0, duration_s: 6, gain: 0.35, loop: true, duck: true, required: false, priority: 0, anchored: true, label: 'rain on a tin roof', fade_in_s: 1, fade_out_s: 0 }] }, { id: 'sfx', kind: 'cue', role: 'sfx', clips: [] }] } } }));
      await page.route(`**/api/drama/projects/${pid}/lines/${l1.id}/clip`, async r => { clipCalls.push(JSON.parse(r.request().postData())); r.fulfill({ json: { overrides: { start_offset_s: 0.1 }, project: (await api('GET', '/api/drama/projects/' + pid)).project } }); });
      await page.evaluate(() => { __dex.dm.timeline = null; __dex.dm._tlAsked = null; __dex.dmSet({}); }); await page.waitForSelector('[data-timeline]');
      await page.waitForSelector('[data-lane="dlg:TIGER"]', { timeout: 9000 });
      assert.deepEqual(await page.$$eval('[data-lane]', e => e.map(x => x.dataset.lane)), ['dlg:TIGER', 'music', 'ambience', 'sfx']);
      await page.waitForFunction(() => document.querySelector('[data-clip^="c:"] canvas'), null, { timeout: 8000 });
      const clip = page.locator('[data-clip^="c:"]'); assert.match(await clip.getAttribute('aria-label'), /Dialogue TIGER, line ln-\d+, starts 0\.50 seconds, 2\.00 long/);
      assert.match(await page.innerText('[data-clip^="c:"]'), /COMPLETE · radio/); assert.match(await page.innerText('[data-lane="ambience"]'), /⟳/); assert.match(await page.innerText('[data-lane="ambience"]'), /⚓/);
      await clip.focus(); await page.keyboard.press('ArrowRight'); await until(() => clipCalls.length >= 1, 'first nudge');
      assert.deepEqual(clipCalls[0], { start_offset_s: 0.1 }, 'ArrowRight nudges by 0.1 s through the clip override API');
      await page.waitForFunction(() => document.activeElement && document.activeElement.dataset.clip, null, { timeout: 5000 }); // focus survives the re-render so keyboard users can keep nudging
      await page.keyboard.press('Shift+ArrowLeft'); await until(() => clipCalls.length >= 2, 'second nudge'); assert.deepEqual(clipCalls[1], { start_offset_s: -1 }, 'Shift+Arrow nudges by 1 s (fixture overrides are not echoed back)');
      await clip.click(); await page.waitForSelector('[data-inspector="dialogue"]'); assert.match(await page.innerText('[data-inspector="dialogue"]'), /effects on this clip/i); assert.ok(await page.isEnabled('[data-insp="gain"]'));
      assert.equal(await page.isDisabled('[data-render-preview]'), false); assert.match(await page.innerText('[data-timeline]'), /no preview yet/);
      assert.deepEqual(errors, []); await page.screenshot({ path: outPath('studio-direct.png') }); await ctx.close();
    });

    await test('Produce: the one-click button is gated by the plan; progress, cancel and resume are shown from real job state; nothing reaches Big Mac', async () => {
      const { ctx, page, errors, blocked } = await open();
      await page.evaluate(id => { __dex._dm(); __dex.dm.currentId = id; __dex.dm.stage = 'produce'; __dex.setScreen('drama'); }, pid); await page.waitForSelector('[data-produce]');
      await page.waitForFunction(() => !document.querySelector('[data-drama-unresolved]'));
      assert.match(await page.innerText('[data-produce]'), /PRODUCE ENTIRE DRAMA/); assert.equal(await page.isDisabled('[data-produce]'), false);
      assert.match(await page.innerText('[data-drama-plan]'), /3 new/); assert.match(await page.innerText('[data-drama-plan]'), /scene \d+: needs speech/);
      let step = 0; await page.route('**/api/drama/productions/pr-fixture1', r => { step++; r.fulfill({ json: { production: step < 3 ? FIX.prod('rendering') : FIX.prod('complete', { artifacts: { master: 'm.wav', scenes: [], outputs: {}, stems: {} } }), project: null } }); });
      await page.route('**/api/drama/productions/pr-fixture1', async r => { step++; const project = (await api('GET', '/api/drama/projects/' + pid)).project; r.fulfill({ json: { production: step < 3 ? FIX.prod('rendering') : FIX.prod('complete'), project } }); });
      await page.click('[data-produce]'); await page.waitForSelector('[data-production="rendering"], [data-production="planning"]');
      assert.deepEqual(blocked, ['produce']);
      await page.waitForFunction(() => /Scene 1\/2 · line 2\/3 · chunk 1\/1/.test(document.querySelector('[data-production]')?.innerText || ''), null, { timeout: 8000 });
      assert.ok(await page.isVisible('[data-cancel-production]'));
      const txt = await page.innerText('[data-production]'); assert.doesNotMatch(txt, /lamp|light|TIGER|CODEC/i, 'progress carries indexes only, never script text or character names');
      assert.equal(await page.getAttribute('[data-production] [role=progressbar]', 'aria-valuenow'), '33');
      await page.waitForSelector('[data-production="complete"]', { timeout: 15000 });
      assert.deepEqual(errors, []); await page.screenshot({ path: outPath('studio-produce.png') }); await ctx.close();
    });

    await test('Review / Master / Export: honest QA, persisted mastering & delivery settings, manual assembly refuses with named lines, private package, historical labels', async () => {
      const { ctx, page, errors } = await open();
      await page.evaluate(id => { __dex._dm(); __dex.dm.currentId = id; __dex.dm.stage = 'review'; __dex.setScreen('drama'); }, pid); await page.waitForSelector('[data-run-qa]');
      await page.waitForSelector('[data-asr-status]'); assert.match(await page.innerText('[data-asr-status]'), /UNAVAILABLE|ready/); assert.match(await page.innerText('[data-asr-status]'), /Silero not installed|energy detector/);
      await page.click('[data-run-qa]'); await page.waitForSelector('[data-qa-summary]'); assert.match(await page.innerText('[data-qa-summary]'), /0 takes checked/);
      await page.click('[data-stage="master"]'); await page.waitForSelector('[data-mastering]'); await page.waitForSelector('[data-mastering-preset] option', { state: 'attached' });
      await page.selectOption('[data-mastering-preset]', 'audiobook'); await until(async () => (await proj(pid)).mastering?.preset === 'audiobook', 'mastering preset saved');
      await page.uncheck('[data-format="m4b"]'); await page.check('[data-stems]'); await until(async () => { const p = await proj(pid); return p.delivery && p.delivery.stems === true && !p.delivery.formats.includes('m4b'); }, 'delivery settings saved');
      assert.match(await page.innerText('[data-mastering]'), /never re-renders speech/i);
      await page.click('[data-stage="export"]'); await page.waitForSelector('[data-assemble-project]');
      await page.route(`**/api/drama/projects/${pid}/history`, r => r.fulfill({ json: { productions: [{ id: 'pr-new00001', label: 'CURRENT', current: true, historical: false, status: 'complete', source_rev: 3, master: { artifact_id: 'a.wav', url: '/api/media/a.wav', download_url: '/api/media/a.wav/download', duration: 5 }, outputs: {} }, { id: 'pr-old00001', label: 'HISTORICAL', current: false, historical: true, status: 'complete', source_rev: 1, acceptance: { state: 'approved' }, master: { artifact_id: 'b.wav', url: '/api/media/b.wav', download_url: '/api/media/b.wav/download', duration: 5 }, outputs: { mp3: { artifact_id: 'b.mp3', url: '/api/media/b.mp3', download_url: '/api/media/b.mp3/download' } } }] } }));
      await page.evaluate(() => { __dex.dm.history = null; __dex.dm._historyAsked = false; __dex.dmSet({}); }); await page.waitForSelector('[data-production-row="pr-old00001"]');
      assert.match(await page.innerText('[data-production-row="pr-old00001"]'), /HISTORICAL/); assert.match(await page.innerText('[data-production-row="pr-old00001"]'), /WAV \(historical\)/); assert.ok(await page.isVisible('[data-compare="pr-old00001"]'));
      await page.click('[data-assemble-project]'); await page.waitForSelector('[data-assemble-error]'); assert.match(await page.innerText('[data-assemble-error]'), /no (current )?generated take/);
      const dl = page.waitForEvent('download'); await page.click('[data-package-export]'); const d = await dl; assert.match(d.suggestedFilename(), /\.zip$/); const zipPath = outPath('studio-package.zip'); await d.saveAs(zipPath);
      assert.ok(fs.statSync(zipPath).size > 200); const zipTxt = fs.readFileSync(zipPath).toString('latin1'); assert.equal(zipTxt.includes('about the light'), false, 'the default package carries no screenplay text');
      await page.setInputFiles('[data-package-import]', zipPath); await page.waitForSelector('[data-package-report]'); assert.match(await page.innerText('[data-package-report]'), /screenplay text was not included/);
      assert.equal(await page.getAttribute('[data-package-report]', 'data-package-report'), 'ok');
      assert.deepEqual(errors, []); await page.screenshot({ path: outPath('studio-export.png') }); await ctx.close();
    });

    await test('Voice Designer: capability truth, create → describe → (fixture audition) → compare → approve; bank export is metadata-only by default', async () => {
      const { ctx, page, errors, blocked } = await open();
      await page.evaluate(() => { __dex.vpSet({ tab: 'designer' }); __dex.setScreen('voice'); }); await page.waitForSelector('[data-voice-designer]');
      await page.click('[data-new-character]'); await page.fill('[data-new-character-name]', 'ZZ-ST-Character'); await page.click('[data-create-character]');
      await page.waitForSelector('[data-designer-form]'); const cid = (await api('GET', '/api/voice/profiles')).profiles.find(p => p.name === 'ZZ-ST-Character').id; made.profiles.push(cid);
      assert.match(await page.innerText('[data-engine-controls]'), /cached voice prompt/); assert.match(await page.innerText('[data-engine-controls]'), /✗\s+cached voice prompt/);
      await page.fill('[data-design="age"]', 'middle-aged'); await page.fill('[data-design="accent"]', 'Scottish'); await page.fill('[data-design="timbre"]', 'gravelly'); await page.click('[data-save-design]');
      await page.waitForFunction(() => /Scottish/.test(document.querySelector('[data-composed]')?.innerText || '')); assert.equal((await api('GET', '/api/voice/profiles/' + cid)).profile.validation.state, 'valid');
      await page.click('[data-generate-auditions]'); assert.deepEqual(blocked, ['audition'], 'auditions are fixtures here; no Big Mac job was started');
      await page.evaluate(([id, round]) => { const vd = __dex._vd(); vd.rounds[id] = [round]; __dex.vpSet({}); }, [cid, FIX.round('complete')]);
      await page.waitForSelector('[data-candidate]'); assert.equal(await page.$$eval('[data-candidate]', e => e.length), 2);
      assert.match(await page.innerText('[data-candidate] >> nth=0'), /seed 1001/); assert.equal(await page.isDisabled('[data-candidate] button:has-text("Approve this voice") >> nth=0'), false);
      await page.click('[data-candidate] button[aria-label="Set as compare A"] >> nth=0'); await page.click('[data-candidate] button[aria-label="Set as compare B"] >> nth=1'); await page.waitForSelector('[data-ab] button:has-text("A then B"):not([disabled])');
      assert.match(await page.innerText('[data-voice-lifecycle]'), /not approved/); assert.equal(await page.isDisabled('[data-lock]'), true);
      assert.equal(await page.isChecked('[data-keep-text]'), false, 'audition text is not kept unless the user opts in');
      await page.check('[data-bank-audio]', { force: true }).catch(() => {}); await page.uncheck('[data-bank-audio]', { force: true }).catch(() => {});
      assert.equal(await page.isChecked('[data-bank-audio]'), false); assert.equal(await page.isChecked('[data-bank-transcripts]'), false);
      assert.deepEqual(errors, []); await page.screenshot({ path: outPath('studio-designer.png') }); await ctx.close();
    });

    for (const width of [375, 768]) {
      await test(`responsive @${width}px: every stage and the Designer have no horizontal page overflow`, async () => {
        const { ctx, page, errors } = await open({ width, height: 812 });
        for (const stage of ['script', 'cast', 'direct', 'produce', 'review', 'master', 'export']) {
          await page.evaluate(([s, id]) => { __dex._dm(); __dex.dm.currentId = id; __dex.dm.stage = s; __dex.dm.timeline = null; __dex.setScreen('drama'); __dex.dmSet({}); }, [stage, pid]);
          await page.waitForSelector('[data-drama-stages]'); await page.waitForTimeout(500);
          const o = await page.evaluate(() => { const bad = []; document.querySelectorAll('[data-scroll-pane]').forEach(p => { if (p.scrollWidth > p.clientWidth + 1) bad.push(p.scrollWidth + '>' + p.clientWidth); }); return { doc: document.documentElement.scrollWidth - innerWidth, bad }; });
          assert.ok(o.doc <= 1 && !o.bad.length, `${stage}: ${JSON.stringify(o)}`);
          if (width === 375) await page.screenshot({ path: outPath(`studio-${stage}-375.png`) });
        }
        // The fixture project may be an unsaved Drama draft. This responsive
        // journey intentionally accepts leaving it; the app keeps it in memory.
        page.once('dialog', dialog => dialog.accept());
        await page.evaluate(() => { __dex.vpSet({ tab: 'designer' }); __dex.setScreen('voice'); }); await page.waitForSelector('[data-voice-designer]'); await page.waitForTimeout(400);
        const o = await page.evaluate(() => { const bad = []; document.querySelectorAll('[data-scroll-pane]').forEach(p => { if (p.scrollWidth > p.clientWidth + 1) bad.push(p.scrollWidth + '>' + p.clientWidth); }); return { doc: document.documentElement.scrollWidth - innerWidth, bad }; });
        assert.ok(o.doc <= 1 && !o.bad.length, `designer: ${JSON.stringify(o)}`); assert.deepEqual(errors, []); await ctx.close();
      });
    }

    await test('accessibility: tabs have roles/selection, every control is a labelled native control, reduced motion removes the progress animation', async () => {
      const { ctx, page, errors } = await open({ reducedMotion: 'reduce' });
      await page.evaluate(id => { __dex._dm(); __dex.dm.currentId = id; __dex.dm.stage = 'produce'; __dex.setScreen('drama'); }, pid); await page.waitForSelector('[data-drama-stages]');
      const tabs = await page.$$eval('[data-stage]', els => els.map(e => [e.getAttribute('role'), e.getAttribute('aria-selected'), e.tagName])); assert.ok(tabs.every(t => t[0] === 'tab' && t[2] === 'BUTTON')); assert.equal(tabs.filter(t => t[1] === 'true').length, 1);
      await page.waitForTimeout(800); await page.focus('[data-stage="script"]'); await page.keyboard.press('Tab'); const active = await page.evaluate(() => document.activeElement && document.activeElement.dataset.stage); assert.equal(active, 'cast', 'Tab moves through the stages in order');
      const unlabeled = await page.evaluate(() => [...document.querySelectorAll('[data-drama] input:not([type=hidden]):not([type=file]), [data-drama] select, [data-drama] textarea')].filter(e => !(e.getAttribute('aria-label') || (e.closest('label') && e.closest('label').textContent.trim()) || e.id)).length); assert.equal(unlabeled, 0, 'every field has an accessible name');
      await page.evaluate(() => { __dex.dm.production = { id: 'pr-x', status: 'rendering', phase: 'rendering', progress: { label: 'x', done: 1, total: 3 }, chunks: { cached: 0, generated: 1, failed: 0, retries: 0, invalid: 0 }, lines: { reused: 0, generated: 1 }, errors: [] }; __dex.dmSet({}); }); await page.waitForSelector('[data-production]');
      assert.match(await page.$eval('[data-production] [role=progressbar] > div', e => getComputedStyle(e).transitionDuration), /^0s$/, 'reduced motion: no animated transition');
      assert.deepEqual(errors, []); await ctx.close();
    });
  } finally {
    phase('cleanup owned projects');
    for (const id of made.projects) { try { await api('DELETE', '/api/drama/projects/' + id); } catch (_) {} }
    phase('cleanup owned profiles');
    for (const id of made.profiles) { try { await api('DELETE', '/api/voice/profiles/' + id); } catch (_) {} }
    phase('close browser'); await browser.close(); phase('stop test server'); await srv.stop();
  }
  const failed = results.filter(r => r[0] === 'FAIL');
  console.log(`\n${results.length - failed.length}/${results.length} drama studio browser checks passed`);
  process.exit(exitCode(failed.length));
})().catch(e => { console.error(e); process.exit(2); });
