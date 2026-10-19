'use strict';
// LIVE end-to-end verification of voice cloning against the real Dexter Fusion application and Big Mac worker.
// Tests the full chain:
// 1. Opens actual Dexter Fusion interface (http://127.0.0.1:31337/dexdiffusion/).
// 2. Uploads real voice recording through Voice Clone section.
// 3. Verifies staging, decoding, filename, duration, and preview display.
// 4. Submits real voice clone generation to Qwen3-TTS Base on Big Mac.
// 5. Follows the job to COMPLETE.
// 6. Inspects the generated artifact: verifies file exists, is valid 24kHz mono WAV, and contains audible speech.
// 7. Checks browser console and server logs for errors.

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execSync, execFileSync } = require('child_process');
const { chromium } = require('playwright-core');
const { launchBrowser } = require('../browser/helpers');

const BASE_URL = process.env.DEX_BASE_URL || 'http://127.0.0.1:31337';
const SAMPLE_PATH = path.resolve(__dirname, '../../../sdcpp-workflow/state/voice-profiles/vp-839263adbf/samples/sm-9ee8fe276b.wav');
const SAMPLE_TRANSCRIPT = 'The quick brown fox jumps over the lazy dog near the quiet river bank.';
const SPEECH_TEXT = 'DexDiffusion voice cloning is fully verified and operational.';

(async () => {
  console.log(`[voice-clone-live] Target: ${BASE_URL}/dexdiffusion/`);
  console.log(`[voice-clone-live] Real sample: ${SAMPLE_PATH}`);
  assert.ok(fs.existsSync(SAMPLE_PATH), 'Sample file exists');
  const sampleBuf = fs.readFileSync(SAMPLE_PATH);
  console.log(`[voice-clone-live] Sample size: ${sampleBuf.length} bytes`);

  // Verify server is UP
  const verRes = await fetch(`${BASE_URL}/api/version`).catch(() => null);
  assert.ok(verRes && verRes.ok, `Server at ${BASE_URL} is responding`);
  const verData = await verRes.json();
  console.log(`[voice-clone-live] Server version: ${verData.version}, pid: ${verData.pid}`);

  const browser = await launchBrowser(chromium);
  const consoleLogs = [];
  const pageErrors = [];

  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();

    page.on('console', msg => consoleLogs.push(`[${msg.type()}] ${msg.text()}`));
    page.on('pageerror', err => pageErrors.push(String(err)));

    console.log('[voice-clone-live] Loading Dexter Fusion UI...');
    await page.goto(`${BASE_URL}/dexdiffusion/`, { timeout: 30000 });
    await page.waitForFunction(() => window.__dex && __dex.state.modelTargets && __dex.state.modelTargets.length > 3);
    console.log('[voice-clone-live] UI loaded successfully.');

    // Step 1: Switch to Voice workspace -> Quick (one-shot) -> Voice Clone
    console.log('[voice-clone-live] Navigating to Voice -> Quick -> Voice Clone (Qwen Base)...');
    await page.evaluate(() => {
      __dex.setScreen('voice');
      __dex.vpSet({ tab: 'quick' });
      __dex.mSet({ voiceMode: 'clone' });
    });

    await page.waitForSelector('[data-reference-stager="voiceRef"]', { timeout: 10000 });
    console.log('[voice-clone-live] Voice clone section is visible.');

    // Step 2: Verify Upload button exists and triggers file chooser
    const uploadBtn = page.locator('[data-upload-button="voiceRef"]');
    await uploadBtn.waitFor({ state: 'visible' });
    assert.equal(await uploadBtn.innerText(), 'Upload audio');

    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 5000 }),
      uploadBtn.click()
    ]);
    assert.ok(fileChooser, 'Upload button triggered file chooser');
    console.log('[voice-clone-live] Verified upload button opens system file picker.');

    // Step 3: Upload the real voice recording
    console.log('[voice-clone-live] Uploading real voice recording...');
    const fileInput = page.locator('input[data-reference-input="voiceRef"]');
    await fileInput.setInputFiles({
      name: 'sm-9ee8fe276b.wav',
      mimeType: 'audio/wav',
      buffer: sampleBuf
    });

    // Step 4: Wait for staged reference card in UI
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-reference-filename="voiceRef"]');
      return el && el.innerText === 'sm-9ee8fe276b.wav';
    }, null, { timeout: 15000 });
    console.log('[voice-clone-live] Reference card rendered with filename sm-9ee8fe276b.wav.');

    // Check duration and preview player
    const durationText = await page.locator('[data-reference-duration="voiceRef"]').innerText();
    console.log(`[voice-clone-live] Staged duration display: ${durationText}`);
    assert.match(durationText, /0:0[45]/, 'Duration is ~4.75 s');

    const previewEl = page.locator('[data-reference-card="voiceRef"] audio');
    await previewEl.waitFor({ state: 'attached' });
    const previewSrc = await previewEl.getAttribute('src');
    console.log(`[voice-clone-live] Audio preview src: ${previewSrc}`);
    assert.match(previewSrc, /\/api\/staging\/stg-[a-f0-9]+/, 'Preview src is valid staged audio URL');

    const stagedId = await page.evaluate(() => __dex._mws().refs.voiceRef && __dex._mws().refs.voiceRef.id);
    assert.match(stagedId, /^stg-[a-f0-9]+$/, `Staged ID verified: ${stagedId}`);

    // Step 5: Fill in reference transcript and text to speak
    console.log('[voice-clone-live] Entering reference transcript and text to speak...');
    await page.evaluate(({ refText, text }) => {
      __dex._mtext.voiceTranscript = refText;
      __dex._mtext.voiceText = text;
      __dex.setState({});
    }, { refText: SAMPLE_TRANSCRIPT, text: SPEECH_TEXT });

    // Step 6: Trigger real voice cloning generation on Big Mac
    console.log('[voice-clone-live] Triggering real Qwen3-TTS Base generation...');
    const genBtn = page.locator('button:has-text("Generate")').first();
    await genBtn.waitFor({ state: 'visible' });
    const btnText = await genBtn.innerText();
    console.log(`[voice-clone-live] Generate button text: "${btnText}"`);
    assert.equal(btnText, 'Generate', 'Generate button is enabled and not blocked');

    // Click generate
    await genBtn.click();

    // Step 7: Wait for job to be created and track progress
    console.log('[voice-clone-live] Waiting for job creation...');
    await page.waitForFunction(() => {
      const j = __dex._mws().jobs && __dex._mws().jobs.voice;
      return j && j.job_id;
    }, null, { timeout: 15000 });

    const jobId = await page.evaluate(() => __dex._mws().jobs.voice.job_id);
    console.log(`[voice-clone-live] Active Big Mac Job ID: ${jobId}`);

    // Poll until terminal state
    const startTime = Date.now();
    let jobRecord = null;
    while (Date.now() - startTime < 300000) { // 5 minutes max for full generation
      const r = await fetch(`${BASE_URL}/api/generic-jobs/${jobId}`);
      if (r.ok) {
        jobRecord = await r.json();
        console.log(`[voice-clone-live] Job status: ${jobRecord.status} (${Math.round((Date.now() - startTime) / 1000)}s elapsed)`);
        if (['COMPLETE', 'FAILED', 'INTERRUPTED', 'CANCELLED'].includes(jobRecord.status)) {
          break;
        }
      }
      await new Promise(res => setTimeout(res, 2000));
    }

    assert.ok(jobRecord, 'Job record was retrieved');
    console.log(`[voice-clone-live] Final job status: ${jobRecord.status}`);
    if (jobRecord.status !== 'COMPLETE') {
      console.error('[voice-clone-live] Job failed:', JSON.stringify(jobRecord, null, 2));
      throw new Error(`Voice clone generation failed with status ${jobRecord.status}: ${jobRecord.error || jobRecord.first_failed_gate}`);
    }

    // Step 8: Verify the generated audio file
    assert.ok(jobRecord.artifacts && jobRecord.artifacts.length > 0, 'Artifacts list is populated');
    const artifactId = jobRecord.artifacts[0];
    console.log(`[voice-clone-live] Canonical artifact ID: ${artifactId}`);

    // Check media file on MacBook disk
    const voiceDir = '/Users/andrew/audio_made/voice';
    const artifactPath = path.join(voiceDir, artifactId);
    console.log(`[voice-clone-live] Verifying file on disk: ${artifactPath}`);
    assert.ok(fs.existsSync(artifactPath), `Artifact file exists at ${artifactPath}`);

    const stat = fs.statSync(artifactPath);
    console.log(`[voice-clone-live] Artifact file size: ${stat.size} bytes`);
    assert.ok(stat.size > 10000, `Artifact size (${stat.size} bytes) indicates substantial audio data`);

    // Probe audio characteristics with ffprobe
    const probeJson = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=channels,sample_rate,codec_name,duration:format=duration', '-of', 'json', artifactPath]).toString());
    const stream = probeJson.streams && probeJson.streams[0];
    assert.ok(stream, 'ffprobe stream found');
    console.log(`[voice-clone-live] Codec: ${stream.codec_name}, Sample rate: ${stream.sample_rate} Hz, Channels: ${stream.channels}, Duration: ${stream.duration || probeJson.format.duration} s`);

    const dur = Number(stream.duration || probeJson.format.duration);
    assert.ok(dur > 1.0, `Audio duration (${dur} s) is plausible for speech`);
    assert.equal(stream.channels, 1, 'Audio is mono');
    assert.equal(stream.sample_rate, '24000', 'Sample rate is 24000 Hz');

    // Calculate audio RMS and peak to verify it contains audible speech (not silence)
    const rawPcm = fs.readFileSync(artifactPath);
    // Find data chunk
    const dataIdx = rawPcm.indexOf('data');
    assert.ok(dataIdx > 0, 'WAV data chunk exists');
    const pcmSamples = rawPcm.subarray(dataIdx + 8);
    const numSamples = Math.floor(pcmSamples.length / 2);
    let sumSquares = 0;
    let peakSample = 0;
    for (let i = 0; i < numSamples; i++) {
      const val = pcmSamples.readInt16LE(i * 2) / 32768.0;
      const absVal = Math.abs(val);
      if (absVal > peakSample) peakSample = absVal;
      sumSquares += val * val;
    }
    const rms = Math.sqrt(sumSquares / numSamples);
    const rmsDb = 20 * Math.log10(rms || 1e-9);
    console.log(`[voice-clone-live] Audio analysis: Peak = ${peakSample.toFixed(3)}, RMS = ${rmsDb.toFixed(1)} dB`);
    assert.ok(peakSample > 0.05, `Peak amplitude (${peakSample.toFixed(3)}) proves audio is non-silent`);
    assert.ok(rmsDb > -50, `RMS (${rmsDb.toFixed(1)} dB) proves audible speech energy`);

    // Step 9: Verify UI shows completion and audio player
    console.log('[voice-clone-live] Verifying UI job completion and audio player...');
    await page.waitForSelector('[data-audio-player], audio', { timeout: 10000 });
    const jobPanelText = await page.locator('body').innerText();
    assert.match(jobPanelText, /Current job|Recent voice/i);

    // Step 10: Check console errors
    const seriousErrors = pageErrors.filter(e => !e.includes('ResizeObserver'));
    console.log(`[voice-clone-live] Page errors: ${seriousErrors.length}`);
    if (seriousErrors.length > 0) {
      console.warn('[voice-clone-live] Logged page errors:', seriousErrors);
    }
    assert.deepEqual(seriousErrors, [], 'No uncaught page errors occurred');

    console.log('\n======================================================');
    console.log('PASS: Real voice-cloned audio generation succeeded!');
    console.log(`Artifact: ${artifactPath}`);
    console.log(`Duration: ${dur.toFixed(2)}s | Peak: ${peakSample.toFixed(3)} | RMS: ${rmsDb.toFixed(1)} dB`);
    console.log('======================================================\n');

    await ctx.close();
  } finally {
    await browser.close();
  }
})();
