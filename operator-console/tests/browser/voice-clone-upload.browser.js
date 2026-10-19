'use strict';
// Browser acceptance for Voice Sample Uploads in Qwen3-TTS Base Voice Clone.
// Verifies:
// 1. Upload button opens the system file picker.
// 2. WAV, MP3, M4A, and FLAC files can be selected and staged.
// 3. Audio duration, preview player, and original filename display correctly.
// 4. Corrupt and oversize audio errors display visibly in the UI.
// 5. The real staged audio reference reaches Qwen3-TTS Base generate request.
// 6. Voice Profiles sample upload and existing voice functionality remain intact.

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const { chromium } = require('playwright-core');
const { startServer, installModelSnapshots, makeWav, runner, launchBrowser } = require('./helpers');
const { test, exitCode } = runner('voice-clone-upload');

function makeAudioFormats(sec = 2, hz = 440) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-upload-fixtures-'));
  const wavPath = path.join(dir, 'sample.wav');
  fs.writeFileSync(wavPath, makeWav(sec, hz));

  const mp3Path = path.join(dir, 'sample.mp3');
  execSync(`ffmpeg -v error -y -i "${wavPath}" -c:a libmp3lame "${mp3Path}"`);

  const m4aPath = path.join(dir, 'sample.m4a');
  execSync(`ffmpeg -v error -y -i "${wavPath}" -c:a aac "${m4aPath}"`);

  const flacPath = path.join(dir, 'sample.flac');
  execSync(`ffmpeg -v error -y -i "${wavPath}" -c:a flac "${flacPath}"`);

  return {
    dir,
    wav: { name: 'sample.wav', mimeType: 'audio/wav', buffer: fs.readFileSync(wavPath) },
    mp3: { name: 'sample.mp3', mimeType: 'audio/mpeg', buffer: fs.readFileSync(mp3Path) },
    m4a: { name: 'sample.m4a', mimeType: 'audio/mp4', buffer: fs.readFileSync(m4aPath) },
    flac: { name: 'sample.flac', mimeType: 'audio/flac', buffer: fs.readFileSync(flacPath) },
    cleanup() { fs.rmSync(dir, { recursive: true, force: true }); }
  };
}

(async () => {
  const srv = process.env.DEX_TEST_BASE ? { base: process.env.DEX_TEST_BASE, stop() {} } : await startServer();
  const browser = await launchBrowser(chromium);
  const audioFixtures = makeAudioFormats(2, 440);

  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));

    const generatePosts = [];
    await installModelSnapshots(page, srv.base);
    await page.route('**/api/media/generate', route => {
      const data = route.request().postDataJSON();
      generatePosts.push(data);
      route.fulfill({ status: 200, json: { job_id: 'job-test-clone-001', status: 'QUEUED' } });
    });

    await page.goto(srv.base + '/dexdiffusion/');
    await page.waitForFunction(() => window.__dex && __dex.state.modelTargets && __dex.state.modelTargets.length > 3);

    // Switch to Voice workspace -> Quick (one-shot) -> Voice Clone · Qwen Base
    await page.evaluate(() => {
      __dex.setScreen('voice');
      __dex.vpSet({ tab: 'quick' });
      __dex.mSet({ voiceMode: 'clone' });
    });

    await page.waitForSelector('[data-reference-stager="voiceRef"]');

    await test('Upload button exists and opens the file picker on click', async () => {
      const uploadBtn = page.locator('[data-upload-button="voiceRef"]');
      await uploadBtn.waitFor({ state: 'visible' });
      assert.equal(await uploadBtn.innerText(), 'Upload audio');

      // Clicking the Upload button must trigger filechooser
      const [fileChooser] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 5000 }),
        uploadBtn.click()
      ]);
      assert.ok(fileChooser, 'file chooser event was emitted by upload button click');
    });

    await test('WAV, MP3, M4A, and FLAC files can be selected, display filename, duration and preview player', async () => {
      const formats = [
        audioFixtures.wav,
        audioFixtures.mp3,
        audioFixtures.m4a,
        audioFixtures.flac
      ];

      for (const item of formats) {
        const fileInput = page.locator('input[data-reference-input="voiceRef"]');
        await fileInput.setInputFiles({ name: item.name, mimeType: item.mimeType, buffer: item.buffer });

        // Wait for filename to be updated in the DOM
        await page.waitForFunction(expected => {
          const el = document.querySelector('[data-reference-filename="voiceRef"]');
          return el && el.innerText === expected;
        }, item.name, { timeout: 10000 });

        // Duration is rendered
        const durationEl = page.locator('[data-reference-duration="voiceRef"]');
        const durationText = await durationEl.innerText();
        assert.match(durationText, /0:02/, `Duration text contains formatted duration for ${item.name}`);

        // Preview audio player exists and has valid source
        const player = page.locator('[data-reference-card="voiceRef"] audio');
        await player.waitFor({ state: 'attached' });
        const src = await player.getAttribute('src');
        assert.match(src, /\/api\/staging\/stg-/, `Audio preview src points to staged file for ${item.name}`);

        // Replace button is available for replacing with next file
        const replaceBtn = page.locator('[data-replace-button="voiceRef"]');
        assert.ok(await replaceBtn.isVisible(), 'Replace button is visible on staged card');
      }
    });

    await test('Errors display visibly when invalid audio or oversize file is selected', async () => {
      const fileInput = page.locator('input[data-reference-input="voiceRef"]');

      // 1. Invalid audio file (fake wav text)
      await fileInput.setInputFiles({
        name: 'corrupt.wav',
        mimeType: 'audio/wav',
        buffer: Buffer.from('this is plain text and not a real audio file')
      });

      await page.waitForSelector('[data-reference-error="voiceRef"]', { timeout: 10000 });
      const errText1 = await page.locator('[data-reference-error="voiceRef"]').innerText();
      assert.match(errText1, /reference-invalid|audio could not be decoded/i, 'Error message is displayed in UI for corrupt audio');

      // 2. Oversize audio (> 40 MB)
      const bigBuf = Buffer.alloc(41 * 1024 * 1024);
      await fileInput.setInputFiles({
        name: 'too-big.wav',
        mimeType: 'audio/wav',
        buffer: bigBuf
      });

      await page.waitForFunction(() => {
        const el = document.querySelector('[data-reference-error="voiceRef"]');
        return el && /40 MB max/i.test(el.innerText);
      }, null, { timeout: 10000 });
      const errText2 = await page.locator('[data-reference-error="voiceRef"]').innerText();
      assert.match(errText2, /40 MB max/i, 'Error message is displayed in UI for oversize audio');

      // 3. Remove button clears error and returns to empty stager
      const removeBtn = page.locator('[data-remove-button="voiceRef"]');
      if (await removeBtn.isVisible()) {
        await removeBtn.click();
        await page.waitForSelector('[data-reference-stager="voiceRef"]');
      }
    });

    await test('Valid audio reaches Qwen3-TTS Base payload with staged_ref', async () => {
      // Stage fresh valid audio
      const fileInput = page.locator('input[data-reference-input="voiceRef"]');
      await fileInput.setInputFiles({
        name: 'tiger-voice.wav',
        mimeType: 'audio/wav',
        buffer: audioFixtures.wav.buffer
      });
      await page.waitForSelector('[data-reference-card="voiceRef"]');

      // Fill in text to speak and reference transcript
      await page.evaluate(() => {
        __dex._mtext.voiceText = 'DexDiffusion Qwen3-TTS Base Voice Clone verification.';
        __dex._mtext.voiceTranscript = 'Original reference sample spoken words.';
        // Enable worker for test
        const w = __dex._mws().workers && __dex._mws().workers.find(x => x.id === 'qwen3-tts-base');
        if (w) { w.enabled = true; w.runtime_available = true; w.model_available = true; }
        __dex.setState({});
      });

      // Click Generate button
      const genBtn = page.locator('button:has-text("Generate")').first();
      await genBtn.waitFor({ state: 'visible' });
      await genBtn.click();

      await page.waitForFunction(() => true);
      for (let i = 0; i < 30 && !generatePosts.length; i++) await new Promise(r => setTimeout(r, 100));

      assert.equal(generatePosts.length, 1, 'Generate sent exactly one request');
      const post = generatePosts[0];
      assert.equal(post.worker, 'qwen3-tts-base');
      assert.equal(post.media_kind, 'voice');
      assert.equal(post.operation, 'clone');
      assert.equal(post.text, 'DexDiffusion Qwen3-TTS Base Voice Clone verification.');
      assert.equal(post.ref_text, 'Original reference sample spoken words.');
      assert.match(post.staged_ref, /^stg-[a-f0-9]+$/, 'Real staged audio reference ID passed to Qwen3-TTS Base');
    });

    await test('Voice Profiles cloned voice sample upload button and error handling work', async () => {
      await page.evaluate(() => {
        __dex.vpSet({ tab: 'profiles' });
      });
      await page.waitForSelector('[data-voice-profiles]');

      // Create cloned profile
      await page.click('[data-new-voice-button]');
      await page.click('[data-new-type="cloned"]');
      await page.fill('[data-new-name]', 'ZZ-Upload-Test-Voice');
      await page.click('[data-create-voice]');
      await page.waitForSelector('[data-profile-editor]');

      // Upload button is visible
      const sampleUploadBtn = page.locator('[data-upload-button="sample"]');
      await sampleUploadBtn.waitFor({ state: 'visible' });
      assert.equal(await sampleUploadBtn.innerText(), 'Upload sample');

      // Select corrupt audio to verify error display
      const sampleInput = page.locator('[data-profile-editor] input[type="file"]');
      await sampleInput.setInputFiles({
        name: 'bad-sample.wav',
        mimeType: 'audio/wav',
        buffer: Buffer.from('not valid audio')
      });

      await page.waitForSelector('[data-sample-error="1"]', { timeout: 10000 });
      const sampleErr = await page.locator('[data-sample-error="1"]').innerText();
      assert.match(sampleErr, /reference-invalid|audio could not be decoded/i);

      // Clean up test voice profile
      const profId = await page.evaluate(() => __dex._vp().selected);
      if (profId) {
        await fetch(srv.base + '/api/voice/profiles/' + profId, { method: 'DELETE' });
      }
    });

    assert.deepEqual(errors, [], 'No page errors occurred during test');
    await ctx.close();
  } finally {
    audioFixtures.cleanup();
    await browser.close();
    await srv.stop();
  }

  process.exit(exitCode());
})();
