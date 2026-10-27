'use strict';
// Submits a controlled FLUX.2 Klein 4B generation job over the private Tailscale HTTPS endpoint,
// polls the job to completion, and verifies that the output is persisted on Big Mac /Volumes/wc2tb.

const https = require('https');
const { execFileSync } = require('child_process');

const BASE_URL = 'https://bigmac.tailafb7e8.ts.net:11443';

function requestJson(url, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      method: options.method || 'GET',
      headers: Object.assign({
        'content-type': 'application/json',
        'x-dex-request': '1',
      }, options.headers || {}),
    }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, data: data ? JSON.parse(data) : null });
        } catch (_) {
          resolve({ status: res.statusCode, headers: res.headers, raw: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

async function run() {
  let jobId = process.argv[2];
  let jobData = null;
  let done = false;
  const startTime = Date.now();

  if (!jobId) {
    console.log(`Submitting FLUX.2 Klein 4B generation over Tailscale: ${BASE_URL}/api/actions/generate-controlled`);
    const payload = {
      target: 'flux2-klein-4b',
      prompt: 'A tiny origami fox sitting in morning sunlight, cinematic macro photograph',
      seed: 882205,
      width: 512,
      height: 512,
      steps: 4,
      save_prompts: true,
    };

    const submitRes = await requestJson(`${BASE_URL}/api/actions/generate-controlled`, {
      method: 'POST',
      headers: {
        Origin: 'https://bigmac.tailafb7e8.ts.net:11443',
      },
    }, payload);

    console.log('Submission HTTP status:', submitRes.status);
    if (submitRes.status !== 200 || !submitRes.data || !submitRes.data.job_id) {
      throw new Error('Job submission failed: ' + JSON.stringify(submitRes.data || submitRes.raw));
    }

    jobId = submitRes.data.job_id;
    console.log(`Job created successfully: ${jobId}`);

    // Poll for completion
    console.log('Polling job status...');

    while (!done && Date.now() - startTime < 180000) {
      await new Promise(r => setTimeout(r, 2000));
      const pollRes = await requestJson(`${BASE_URL}/api/jobs/${jobId}`);
      if (pollRes.status !== 200) {
        console.log(`Poll HTTP ${pollRes.status}, retrying...`);
        continue;
      }
      jobData = pollRes.data;
      const s = String(jobData.status || '').toUpperCase();
      const percent = typeof jobData.progress === 'object' && jobData.progress ? jobData.progress.totalPercent : jobData.progress;
      console.log(`Status: ${jobData.status}, progress: ${percent || 0}%`);
      if (s === 'PASS' || s === 'COMPLETED' || s === 'DONE' || s === 'FAIL' || s === 'FAILED') {
        done = true;
      }
    }
  } else {
    console.log(`Using existing job ${jobId} for verification...`);
    const pollRes = await requestJson(`${BASE_URL}/api/jobs/${jobId}`);
    if (pollRes.status !== 200) {
      throw new Error(`Failed to fetch job ${jobId}: HTTP ${pollRes.status}`);
    }
    jobData = pollRes.data;
    done = true;
  }

  const s = String(jobData ? jobData.status : '').toUpperCase();
  if (!done || !jobData || (s !== 'PASS' && s !== 'COMPLETED' && s !== 'DONE')) {
    throw new Error(`Job did not complete successfully. Status: ${jobData ? jobData.status : 'timeout'}, error: ${jobData ? jobData.error : 'none'}`);
  }

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`✓ Job completed in ${durationSec}s!`);
  console.log('Job results:', JSON.stringify(jobData.results, null, 2));

  const outputImage = (jobData.results && jobData.results[0] && (jobData.results[0].imageId || jobData.results[0].filename))
    || (jobData.images && jobData.images[0] && jobData.images[0].image_id)
    || (jobData.controlledOutputImage ? require('path').basename(jobData.controlledOutputImage) : null);
  if (!outputImage) throw new Error('No output image recorded in job');

  const filename = typeof outputImage === 'object' ? (outputImage.filename || outputImage.imageId) : outputImage;
  console.log(`Generated canonical filename: ${filename}`);

  // Verify fetch over Tailscale HTTPS
  console.log(`Verifying image fetch over Tailscale: ${BASE_URL}/api/images/${filename}`);
  const imgRes = await requestJson(`${BASE_URL}/api/images/${filename}`);
  console.log(`Image GET HTTP status: ${imgRes.status}, Content-Type: ${imgRes.headers['content-type']}, Content-Length: ${imgRes.headers['content-length']}`);
  if (imgRes.status !== 200) throw new Error('Failed to retrieve generated image over Tailscale');

  // Verify storage on Big Mac /Volumes/wc2tb
  const remoteCheck = execFileSync('ssh', [
    'westcat',
    `ls -lh /Volumes/wc2tb/DexDiffusion/images/${filename} && shasum -a 256 /Volumes/wc2tb/DexDiffusion/images/${filename}`,
  ], { encoding: 'utf8' }).trim();

  console.log('✓ Big Mac /Volumes/wc2tb image proof:\n' + remoteCheck);

  // Verify local MacBook /Users/andrew/images_made was untouched
  const localCheck = require('fs').existsSync(`/Users/andrew/images_made/${filename}`);
  console.log(`Local MacBook check: ${filename} in /Users/andrew/images_made: ${localCheck} (MUST BE FALSE)`);
  if (localCheck) throw new Error('Violation: Generated image was written to local MacBook storage!');

  console.log('================================================================');
  console.log('TAILSCALE LIVE GENERATION VERIFICATION COMPLETE AND PROVEN!');
  console.log('================================================================');
}

run().catch(err => {
  console.error('Live Generation Verification FAILED:', err);
  process.exit(1);
});
