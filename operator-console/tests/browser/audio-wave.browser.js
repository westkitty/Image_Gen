'use strict';
// Optional azure waveform and text flicker while audio plays: real reading, real playback, real pixels. No worker is contacted.
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { startServer, installModelSnapshots, runner, launchBrowser, openStudio, makeWav } = require('./helpers');
const { test, exitCode } = runner('audio-wave');

// 0-2 s loud, 2-4 s silent, 4-6 s at half the amplitude
function fixture() {
  const wav = makeWav(6, 440, 24000, 0.8);
  for (let i = 0; i < 24000 * 6; i++) { const t = i / 24000, at = 44 + i * 2; if (t >= 2 && t < 4) wav.writeInt16LE(0, at); else if (t >= 4) wav.writeInt16LE(Math.round(wav.readInt16LE(at) / 2), at); }
  return wav;
}

// Serves the fixture like the real audio routes do: whole, or the span the Range header asks for.
const ranged = (wav, seen) => route => {
  const m = /bytes=(\d+)-(\d*)/.exec(route.request().headers().range || '');
  if (!m) return route.fulfill({ contentType: 'audio/wav', headers: { 'accept-ranges': 'bytes' }, body: wav });
  const from = +m[1], to = Math.min(wav.length, m[2] ? +m[2] + 1 : wav.length);
  if (seen && route.request().resourceType() !== 'media') seen.push(to - from);
  return route.fulfill({ status: 206, contentType: 'audio/wav', headers: { 'accept-ranges': 'bytes', 'content-range': `bytes ${from}-${to - 1}/${wav.length}` }, body: wav.subarray(from, to) });
};

async function open(browser, base, options = {}) {
  const { on = { wave: true, text: false }, ...contextOptions } = options;
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 800 } }, contextOptions));
  const page = await ctx.newPage(), errors = [], spans = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(() => {
    window.__rerouted = 0;
    for (const C of [window.AudioContext, window.webkitAudioContext]) if (C) C.prototype.createMediaElementSource = function () { window.__rerouted++; throw new Error('playback must not be rerouted'); };
  });
  await installModelSnapshots(page, base);
  const wav = fixture();
  await page.route('**/wave-fixture.wav', ranged(wav, spans));
  await page.route('**/broken-fixture.wav', r => r.request().resourceType() === 'media' ? r.fulfill({ contentType: 'audio/wav', body: wav }) : r.fulfill({ status: 500, body: 'no' }));
  await openStudio(page, base + '/dexdiffusion/', { waitUntil: 'domcontentloaded' });
  if (on) await page.evaluate(v => DexAudioWave.set(v), on);
  await page.evaluate(async () => { window.__blob = URL.createObjectURL(await (await fetch('/wave-fixture.wav')).blob()); });
  await page.mouse.click(640, 5);                    // a user gesture, so playback is allowed
  return { ctx, page, errors, spans };
}
// Plays a detached Audio (as the voice bar and Drama do) at `at` seconds, slowly enough to stay inside one passage.
const play = (page, at, url) => page.evaluate(async ([t, src]) => {
  if (window.__a) window.__a.pause();
  const a = window.__a = new Audio(src || window.__blob);
  await new Promise(done => { a.addEventListener('loadeddata', done, { once: true }); a.load(); });
  a.currentTime = t; a.playbackRate = 0.1; await a.play();   // load() resets the rate
}, [at, url]);
const active = page => page.waitForFunction(() => DexAudioWave.state().active && DexAudioWave.state().fade > 0.95);
const gone = page => page.waitForFunction(() => !DexAudioWave.state().active && !DexAudioWave.state().running);
const remains = page => page.evaluate(() => [document.querySelectorAll('[data-dex-flicker]').length, document.querySelectorAll('[data-audio-wave],style[data-audio-wave-style]').length, DexAudioWave.state().spans]);
// Share of the screen height drawn within a few pixels of the playhead (the middle of the screen).
const height = page => page.evaluate(() => {
  const mid = innerWidth / 2, c = [...document.querySelectorAll('[data-audio-wave] canvas')].find(e => { const r = e.getBoundingClientRect(); return r.left <= mid && r.right > mid; }), r = c.getBoundingClientRect();
  const w = 16, at = Math.max(0, Math.min(c.width - w, Math.round((mid - r.left) / r.width * c.width) - w / 2)), d = c.getContext('2d').getImageData(at, 0, w, c.height).data;
  let top = c.height, bottom = 0;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 24) { top = Math.min(top, y); bottom = Math.max(bottom, y); }
  return Math.max(0, bottom - top) / c.height * r.height / innerHeight;
});
const brand = page => page.evaluate(() => {
  const el = [...document.querySelectorAll('[data-dex-flicker]')].find(e => /DexDiffusion/.test(e.textContent) && e.getClientRects().length);
  return el && { fill: getComputedStyle(el).webkitTextFillColor, color: getComputedStyle(el).color };
});

(async () => {
  const srv = process.env.DEX_TEST_BASE ? { base: process.env.DEX_TEST_BASE, stop() {} } : await startServer();
  const browser = await launchBrowser(chromium);
  try {
    await test('off by default: playing audio draws nothing, changes no text and reads nothing twice', async () => {
      const { ctx, page, errors, spans } = await open(browser, srv.base, { on: null });
      assert.deepEqual(await page.evaluate(() => DexAudioWave.settings()), { wave: false, text: false });
      const before = spans.length;
      await play(page, 1, '/wave-fixture.wav'); await page.waitForTimeout(700);
      assert.deepEqual(await page.evaluate(() => [window.__a.paused, DexAudioWave.state().active, DexAudioWave.state().running]), [false, false, false]);
      assert.deepEqual(await remains(page), [0, 0, 0]); assert.equal(spans.length, before); assert.deepEqual(errors, []);
      await ctx.close();
    });

    await test('the overlay covers the screen, draws the real passage under the playhead, and never takes a click', async () => {
      const { ctx, page, errors } = await open(browser, srv.base);
      assert.equal(await page.locator('[data-audio-wave]').count(), 0, 'nothing is drawn before playback');
      await play(page, 1); await active(page);
      const box = await page.locator('[data-audio-wave]').evaluate(c => { const r = c.getBoundingClientRect(), s = getComputedStyle(c); return { w: r.width, h: r.height, events: s.pointerEvents, hidden: c.getAttribute('aria-hidden') }; });
      assert.deepEqual(box, { w: 1280, h: 800, events: 'none', hidden: 'true' });
      await page.waitForFunction(() => [...document.querySelectorAll('[data-audio-wave] canvas')].some(c => c.getContext('2d').getImageData(0, 0, c.width, c.height).data.some(v => v)));
      const loud = await height(page);
      assert.ok(loud > 0.74 && loud < 0.86, 'loud passage fills most of the screen height: ' + loud);
      const rgb = await page.evaluate(() => { const c = [...document.querySelectorAll('[data-audio-wave] canvas')].find(e => { const r = e.getBoundingClientRect(); return r.left <= 640 && r.right > 640; }), d = c.getContext('2d').getImageData(320, Math.round(c.height * 0.45), 1, 1).data; return [...d]; });
      assert.ok(rgb[0] < 12 && Math.abs(rgb[1] - 127) < 8 && rgb[2] > 245, 'azure ' + rgb); assert.ok(rgb[3] < 220, 'transparent ' + rgb[3]);
      await page.evaluate(() => { window.__a.currentTime = 5; }); await page.waitForTimeout(700);
      const half = await height(page);
      assert.ok(Math.abs(half / loud - 0.5) < 0.07, 'half the amplitude draws half the height: ' + half);
      await page.evaluate(() => { window.__a.currentTime = 2.9; }); await page.waitForTimeout(700);
      assert.ok(await height(page) < 0.02, 'silence is a flat line');
      assert.equal(await page.evaluate(() => window.__rerouted), 0); assert.deepEqual(errors, []);
      await ctx.close();
    });

    await test('only short spans are read, only a few are kept, and the picture does not redraw every frame', async () => {
      const { ctx, page, errors, spans } = await open(browser, srv.base);
      await page.evaluate(() => { window.__fills = 0; const f = CanvasRenderingContext2D.prototype.fill; CanvasRenderingContext2D.prototype.fill = function () { window.__fills++; return f.apply(this, arguments); }; });
      const before = spans.length;
      await play(page, 1, '/wave-fixture.wav'); await active(page); await page.waitForTimeout(1500);
      const read = spans.slice(before);
      assert.ok(read.length <= 3 && Math.max(...read) <= 24000 * 2 * 4, 'spans read: ' + read);
      const fills = await page.evaluate(() => window.__fills); await page.waitForTimeout(1000);
      assert.ok(fills <= 8, 'strips drawn: ' + fills); assert.equal(await page.evaluate(() => window.__fills), fills, 'nothing is redrawn while it slides');
      assert.ok((await page.evaluate(() => DexAudioWave.state().spans)) <= 6); assert.deepEqual(errors, []);
      await ctx.close();
    });

    await test('text flicker has its own switch, changes at most three times a second, and is restored', async () => {
      const { ctx, page, errors } = await open(browser, srv.base);
      await play(page, 1); await active(page); await page.waitForTimeout(400);
      assert.equal(await page.locator('[data-dex-flicker]').count(), 0, 'the waveform alone never touches text');
      await page.evaluate(() => DexAudioWave.set({ text: true }));
      await page.waitForFunction(() => DexAudioWave.state().level > 0.9 && DexAudioWave.state().marked > 0); await page.waitForTimeout(400);
      const loud = await brand(page);
      assert.ok(loud, 'the DexDiffusion brand is marked');
      await page.evaluate(() => { window.__a.currentTime = 2.9; }); await page.waitForFunction(() => DexAudioWave.state().level < 0.05); await page.waitForTimeout(500);
      const quiet = await brand(page);
      assert.notEqual(quiet.fill, loud.fill, 'the text dims when the sound does'); assert.equal(quiet.color, loud.color);
      assert.equal(await page.evaluate(() => [...document.querySelectorAll('[data-dex-flicker]')].every(e => DexAudioWave.isBright(getComputedStyle(e).color))), true, 'muted text is left alone');
      assert.equal(await page.locator('textarea[data-dex-flicker], input[data-dex-flicker]').count(), 0);
      const changes = await page.evaluate(async () => {
        const rule = document.querySelector('style[data-audio-wave-style]').sheet.cssRules[0].style, seen = []; let last = null;
        const a = window.__a; a.playbackRate = 1; const t0 = performance.now();
        while (performance.now() - t0 < 2000) { const v = rule.getPropertyValue('-webkit-text-fill-color'); if (v !== last) seen.push(v); last = v; a.currentTime = Math.floor((performance.now() - t0) / 60) % 2 ? 1 : 3; await new Promise(requestAnimationFrame); }
        return seen.length;
      });
      assert.ok(changes <= 8, 'text changes in two seconds: ' + changes);
      await page.evaluate(() => DexAudioWave.set({ text: false }));
      assert.deepEqual((await remains(page)).slice(0, 2), [0, 1], 'text is restored at once while the waveform stays');
      await page.evaluate(() => window.__a.pause()); await gone(page);
      assert.deepEqual(await remains(page), [0, 0, 0]); assert.deepEqual(errors, []);
      await ctx.close();
    });

    await test('the switches are on the System screen and in the command palette, survive a reload, and turn it off at once', async () => {
      const { ctx, page, errors } = await open(browser, srv.base, { on: null });
      await page.evaluate(() => { __dex.setScreen('system'); });
      const wave = page.locator('[data-audio-wave-setting="wave"]'), text = page.locator('[data-audio-wave-setting="text"]');
      await wave.waitFor();
      assert.deepEqual([await wave.isChecked(), await text.isChecked(), await text.isDisabled()], [false, false, true]);
      await wave.check(); await text.check();
      await page.reload(); await page.waitForFunction(() => window.DexAudioWave && window.__dex && __dex.state.capabilityData);
      assert.deepEqual(await page.evaluate(() => DexAudioWave.settings()), { wave: true, text: true });
      await page.mouse.click(640, 5);
      await play(page, 1, '/wave-fixture.wav'); await active(page); await page.waitForFunction(() => DexAudioWave.state().marked > 0);
      await page.evaluate(() => { __dex.setScreen('system'); }); await wave.waitFor();
      await wave.uncheck();
      assert.deepEqual(await page.evaluate(() => [DexAudioWave.state().active, DexAudioWave.state().running, window.__a.paused]), [false, false, false], 'off at once, and the sound goes on');
      assert.deepEqual(await remains(page), [0, 0, 0]);
      await page.evaluate(() => window.__DEX_V12.toggleCommandPalette());
      await page.fill('#v12-palette-input', 'waveform'); await page.locator('.v12-palette-item', { hasText: 'Toggle audio waveform' }).click();
      await active(page); assert.equal(await page.evaluate(() => localStorage.getItem('dex_audio_wave')), '1', 'switching on mid-song picks it up');
      assert.deepEqual(errors, []);
      await ctx.close();
    });

    await test('native players are covered, muting hides it, and a file that cannot be read plays with no picture', async () => {
      const { ctx, page, errors } = await open(browser, srv.base);
      await page.evaluate(() => { const a = document.createElement('audio'); a.controls = true; a.autoplay = true; a.src = '/wave-fixture.wav'; a.id = 'native-audio'; document.body.appendChild(a); });
      await active(page);
      await page.evaluate(() => { document.getElementById('native-audio').muted = true; });
      await gone(page);
      await page.evaluate(() => { document.getElementById('native-audio').remove(); });
      await play(page, 1, '/broken-fixture.wav');
      await page.waitForTimeout(700);
      assert.deepEqual(await page.evaluate(() => [window.__a.paused, window.__a.currentTime > 0, DexAudioWave.state().active, DexAudioWave.state().running]), [false, true, false, false]);
      await play(page, 1, '/wave-fixture.wav'); await active(page);
      assert.deepEqual(errors, []);
      await ctx.close();
    });

    await test('a hidden window and Reduce Motion both stop it, and it returns when they end', async () => {
      const { ctx, page, errors } = await open(browser, srv.base, { on: { wave: true, text: true } });
      await play(page, 1); await active(page);
      const hidden = v => page.evaluate(h => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => h }); document.dispatchEvent(new Event('visibilitychange')); }, v);
      await hidden(true);
      assert.deepEqual(await page.evaluate(() => [DexAudioWave.state().active, DexAudioWave.state().running, window.__a.paused]), [false, false, false]);
      await hidden(false); await active(page);
      await page.emulateMedia({ reducedMotion: 'reduce' }); await gone(page);
      assert.deepEqual(await remains(page), [0, 0, 0]);
      await page.evaluate(() => DexAudioWave.set({ wave: true })); await page.waitForTimeout(400);
      assert.equal(await page.evaluate(() => DexAudioWave.state().active), false, 'the switch never overrides Reduce Motion');
      await page.emulateMedia({ reducedMotion: 'no-preference' }); await active(page);
      assert.deepEqual(errors, []);
      await ctx.close();
    });
  } finally { await srv.stop(); }
  process.exit(exitCode());
})();
