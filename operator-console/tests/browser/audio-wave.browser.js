'use strict';
// Azure waveform and text flicker while audio plays: real decoding, real playback, real pixels. No worker is contacted.
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

async function open(browser, base, options = {}) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 800 } }, options));
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(() => {
    window.__rerouted = 0;
    for (const C of [window.AudioContext, window.webkitAudioContext]) if (C) C.prototype.createMediaElementSource = function () { window.__rerouted++; throw new Error('playback must not be rerouted'); };
  });
  await installModelSnapshots(page, base);
  const wav = fixture();
  await page.route('**/wave-fixture.wav', r => r.fulfill({ contentType: 'audio/wav', body: wav }));
  await page.route('**/broken-fixture.wav', r => r.request().resourceType() === 'media' ? r.fulfill({ contentType: 'audio/wav', body: wav }) : r.fulfill({ status: 500, body: 'no' }));
  await openStudio(page, base + '/dexdiffusion/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => { window.__blob = URL.createObjectURL(await (await fetch('/wave-fixture.wav')).blob()); });
  await page.mouse.click(640, 5);                    // a user gesture, so playback is allowed
  return { ctx, page, errors };
}
// Plays a detached Audio (as the voice bar and Drama do) at `at` seconds, slowly enough to stay inside one passage.
const play = (page, at, url) => page.evaluate(async ([t, src]) => {
  if (window.__a) window.__a.pause();
  const a = window.__a = new Audio(src || window.__blob); a.playbackRate = 0.1;
  await new Promise(done => { a.addEventListener('loadeddata', done, { once: true }); a.load(); });
  a.currentTime = t; await a.play();
}, [at, url]);
const active = page => page.waitForFunction(() => DexAudioWave.state().active && DexAudioWave.state().fade > 0.95);
// Share of the screen height that is drawn within a few pixels of the playhead.
const height = page => page.evaluate(() => {
  const c = document.querySelector('canvas[data-audio-wave]'), w = 16, d = c.getContext('2d').getImageData(Math.round(c.width / 2) - w / 2, 0, w, c.height).data;
  let top = c.height, bottom = 0;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 24) { top = Math.min(top, y); bottom = Math.max(bottom, y); }
  return Math.max(0, bottom - top) / c.height;
});
const brand = page => page.evaluate(() => {
  const el = [...document.querySelectorAll('[data-dex-flicker]')].find(e => /DexDiffusion/.test(e.textContent) && e.getClientRects().length);
  return el && { fill: getComputedStyle(el).webkitTextFillColor, shadow: getComputedStyle(el).textShadow, color: getComputedStyle(el).color };
});

(async () => {
  const srv = process.env.DEX_TEST_BASE ? { base: process.env.DEX_TEST_BASE, stop() {} } : await startServer();
  const browser = await launchBrowser(chromium);
  try {
    await test('the overlay covers the screen, draws the real passage under the playhead, and never takes a click', async () => {
      const { ctx, page, errors } = await open(browser, srv.base);
      assert.equal(await page.locator('canvas[data-audio-wave]').count(), 0, 'nothing is drawn before playback');
      await play(page, 1); await active(page);
      const box = await page.locator('canvas[data-audio-wave]').evaluate(c => { const r = c.getBoundingClientRect(), s = getComputedStyle(c); return { w: r.width, h: r.height, events: s.pointerEvents, hidden: c.getAttribute('aria-hidden') }; });
      assert.deepEqual(box, { w: 1280, h: 800, events: 'none', hidden: 'true' });
      const loud = await height(page);
      assert.ok(loud > 0.74 && loud < 0.86, 'loud passage fills most of the screen height: ' + loud);
      const rgb = await page.evaluate(() => { const c = document.querySelector('canvas[data-audio-wave]'), d = c.getContext('2d').getImageData(Math.round(c.width / 2), Math.round(c.height * 0.45), 1, 1).data; return [...d]; });
      assert.ok(rgb[0] < 12 && Math.abs(rgb[1] - 127) < 8 && rgb[2] > 245, 'azure ' + rgb); assert.ok(rgb[3] < 200, 'transparent ' + rgb[3]);
      await play(page, 5); await active(page); await page.waitForTimeout(300);
      const half = await height(page);
      assert.ok(Math.abs(half / loud - 0.5) < 0.07, 'half the amplitude draws half the height: ' + half);
      await play(page, 2.9); await active(page); await page.waitForTimeout(300);
      assert.ok(await height(page) < 0.02, 'silence is a flat line');
      assert.equal(await page.evaluate(() => window.__rerouted), 0); assert.deepEqual(errors, []);
      await ctx.close();
    });

    await test('bright text, the brand included, flickers with the level and is restored when playback stops', async () => {
      const { ctx, page, errors } = await open(browser, srv.base);
      await play(page, 1); await active(page);
      await page.waitForFunction(() => DexAudioWave.state().level > 0.9);
      const loud = await brand(page);
      assert.ok(loud, 'the DexDiffusion brand is marked'); assert.match(loud.shadow, /rgba?\(0, 127, 255/);
      await play(page, 2.9); await page.waitForFunction(() => DexAudioWave.state().level < 0.05);
      const quiet = await brand(page);
      assert.notEqual(quiet.fill, loud.fill, 'the text dims when the sound does'); assert.equal(quiet.shadow, 'none'); assert.equal(quiet.color, loud.color);
      assert.equal(await page.evaluate(() => [...document.querySelectorAll('[data-dex-flicker]')].every(e => DexAudioWave.isBright(getComputedStyle(e).color))), true, 'muted text is left alone');
      assert.equal(await page.locator('textarea[data-dex-flicker], input[data-dex-flicker]').count(), 0);
      await page.evaluate(() => window.__a.pause());
      await page.waitForFunction(() => !DexAudioWave.state().active);
      assert.deepEqual(await page.evaluate(() => [document.querySelectorAll('[data-dex-flicker]').length, document.querySelectorAll('canvas[data-audio-wave],style[data-audio-wave-style]').length]), [0, 0]);
      assert.deepEqual(errors, []);
      await ctx.close();
    });

    await test('native players are covered, muting hides it, and a file that cannot be read plays with no picture', async () => {
      const { ctx, page, errors } = await open(browser, srv.base);
      await page.evaluate(() => { const a = document.createElement('audio'); a.controls = true; a.autoplay = true; a.src = '/wave-fixture.wav'; a.id = 'native-audio'; document.body.appendChild(a); });
      await active(page);
      await page.evaluate(() => { document.getElementById('native-audio').muted = true; });
      await page.waitForFunction(() => !DexAudioWave.state().active);
      await page.evaluate(() => { document.getElementById('native-audio').remove(); });
      await play(page, 1, '/broken-fixture.wav');
      await page.waitForTimeout(700);
      assert.deepEqual(await page.evaluate(() => [window.__a.paused, window.__a.currentTime > 0, DexAudioWave.state().active]), [false, true, false]);
      assert.deepEqual(errors, []);
      await ctx.close();
    });

    await test('with reduced motion nothing is drawn and no text changes', async () => {
      const { ctx, page, errors } = await open(browser, srv.base, { reducedMotion: 'reduce' });
      await play(page, 1); await page.waitForTimeout(700);
      assert.deepEqual(await page.evaluate(() => [window.__a.paused, DexAudioWave.state().active, document.querySelectorAll('[data-dex-flicker]').length]), [false, false, 0]);
      assert.deepEqual(errors, []);
      await ctx.close();
    });
  } finally { await srv.stop(); }
  process.exit(exitCode());
})();
