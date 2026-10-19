'use strict';

// One real OpenVoice V2 conversion through the production server, job store,
// shared lease, SSH bridge and canonical media path, all in owned test state.
// The only live inputs are previously verified synthetic audio recordings.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright-core');
const { startServer, launchBrowser, installModelSnapshots, preserveSuiteState } = require('../browser/helpers');
const Asr = require('../../asr-adapter');
const CleanupOwner = require('../../cleanup-owner');
let activeServer = null, activeReport = null;

const REPO = path.resolve(__dirname, '../../..');
const LIVE_STATE = path.join(REPO, 'sdcpp-workflow/state');
const SOURCE_ID = 'stg-c37e6411210e46045ed1a5ca'; // Qwen3-TTS synthetic voice-design speech, 4.75 s
const TARGET_PROFILE = 'vp-72f5a16f6e'; // fictional synthetic VoxCPM2 test fixture; remains draft in live state
const TARGET_SAMPLE = 'sm-6922ea816d';
const hex = b => crypto.createHash('sha256').update(b).digest('hex');
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function json(base, route, init = {}) {
  const r = await fetch(base + route, init);
  const type = r.headers.get('content-type') || '';
  return { status: r.status, data: type.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()), headers: r.headers };
}
const body = x => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x) });
const put = x => ({ method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x) });
function fail(msg) { throw new Error(msg); }

async function finishPreservedRun(srv, report, liveProfilePath, beforeProfile) {
  const profileId = report.target.test_profile_id, jobId = report.managed_job.id, artifactId = report.artifact.id;
  const jobResult = await json(srv.base, `/api/generic-jobs/${encodeURIComponent(jobId)}`), job = jobResult.data;
  assert.equal(job.status, 'COMPLETE'); assert.equal(job.worker_id, 'openvoice-v2');
  assert.equal(job.owned_resources[0].state, 'succeeded');
  const recBytes = (await json(srv.base, `/api/media/${encodeURIComponent(artifactId)}`)).data;
  assert.equal(hex(recBytes), report.artifact.sha256);
  const stageId = report.artifact.parent;
  assert.equal((await json(srv.base, `/api/staging/${stageId}`)).status, 200);
  const det = Asr.detect(); assert.ok(det.available, 'local ASR is required by the production Drama attach route');
  const mediaRoot = path.join(srv.stateDir, 'media');
  const registry = JSON.parse(fs.readFileSync(path.join(srv.stateDir, 'media-artifacts.json')));
  const rec = registry.artifacts[artifactId]; assert.ok(rec.canonical_path.startsWith(mediaRoot + path.sep));
  const heard = await Asr.transcribe(rec.canonical_path, det);
  report.local_asr = Object.assign({}, report.local_asr, { text: heard.text, engine: heard.engine, model: path.basename(det.model) });
  const projectResult = await json(srv.base, '/api/drama/projects', body({ title: 'TEST ONLY OpenVoice managed conversion', script: `OPENVOICE FIXTURE: ${heard.text}` }));
  assert.equal(projectResult.status, 201, JSON.stringify(projectResult.data));
  const project = projectResult.data.project, line = project.scenes.flatMap(s => s.lines).find(l => l.kind !== 'direction' && l.render !== false);
  const scene = project.scenes.find(s => s.lines.some(l => l.id === line.id)) || project.scenes[0];
  const actor = project.actors.find(a => a.speaker_key === line.speaker_key);
  assert.equal((await json(srv.base, `/api/drama/projects/${project.id}/actors/${actor.id}`, put({ voice_profile_id: profileId }))).status, 200);
  report.drama = { project_id: project.id, scene_id: scene.id, line_id: line.id, take_id: null };

  const browser = await launchBrowser(chromium);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  try {
    await installModelSnapshots(page, srv.base); await page.goto(srv.base + '/dexdiffusion/');
    await page.waitForFunction(() => window.__dex && __dex.state && __dex.state.modelTargets && __dex.state.modelTargets.length > 3);
    await page.evaluate(() => { __dex.setScreen('voice'); __dex.vpSet({ tab: 'profiles' }); });
    await page.evaluate(() => __dex.loadVoiceProfiles());
    await page.getByLabel('Approved target voice').selectOption(profileId);
    await page.evaluate(({ stageId: stg, jobId: job, artifactId: art }) => {
      const base = __dex.state.backendUrl;
      __dex.vpSet({ conversionSource: { id: stg, name: 'synthetic-qwen-voice-design-source.wav', url: base + '/api/staging/' + encodeURIComponent(stg) },
        conversionJob: { id: job, status: 'COMPLETE', progress: { phase: 'complete', label: 'Converted with OpenVoice V2' } },
        conversionArtifact: { id: art, jobId: job, url: base + '/api/media/' + encodeURIComponent(art) }, conversionBusy: false });
    }, { stageId, jobId, artifactId });
    await page.evaluate(() => __dex.loadVoiceProfiles());
    await page.locator('[data-openvoice-conversion] select').nth(1).selectOption(project.id);
    await page.waitForFunction(id => [...document.querySelectorAll('[data-openvoice-conversion] select')][2]?.querySelector(`option[value="${CSS.escape(id)}"]`), line.id);
    await page.locator('[data-openvoice-conversion] select').nth(2).selectOption(line.id);
    const [attachResponse] = await Promise.all([
      page.waitForResponse(r => r.url().includes(`/lines/${line.id}/conversions`) && r.request().method() === 'POST'),
      page.locator('[data-openvoice-attach]').click()
    ]);
    assert.equal(attachResponse.status(), 201, await attachResponse.text());
    const attached = await attachResponse.json(); report.drama.take_id = attached.take.id; report.drama.asr = attached.word_integrity;
    assert.equal(attached.word_integrity.status, 'PASS');
    const players = page.locator('[data-openvoice-conversion] audio'); assert.equal(await players.count(), 3);
    for (const i of [0, 2]) {
      const state = await players.nth(i).evaluate(async a => {
        const r = await fetch(a.src), bytes = await r.arrayBuffer();
        return { status: r.status, type: r.headers.get('content-type'), bytes: bytes.byteLength, readyState: a.readyState };
      });
      assert.equal(state.status, 200); assert.match(state.type, /audio\/wav/i); assert.ok(state.bytes > 1000);
      report.browser_audio = report.browser_audio || []; report.browser_audio.push({ index: i, response_status: state.status, content_type: state.type, bytes: state.bytes, playback_ready: state.readyState >= 2 });
    }
    await page.evaluate(() => { __dex.setScreen('drama'); __dex.loadDramaProjects(); });
    await page.waitForSelector('[data-drama="1"]');
    await page.locator('[data-drama="1"] select[aria-label="Open project"]').selectOption(project.id);
    const takeCard = page.locator(`[data-take="${attached.take.id}"]`); await takeCard.waitFor();
    const select = takeCard.getByRole('button', { name: 'Select', exact: true }); if (await select.count()) await select.click();
    let opened = (await json(srv.base, `/api/drama/projects/${project.id}`)).data.project;
    let lineNow = opened.scenes.flatMap(s => s.lines).find(l => l.id === line.id); report.drama.prior_take_id = lineNow.active_take_id;
    await takeCard.getByRole('button', { name: 'Reject', exact: true }).click();
    await takeCard.getByRole('button', { name: 'Undo selection', exact: true }).click();
    opened = (await json(srv.base, `/api/drama/projects/${project.id}`)).data.project;
    lineNow = opened.scenes.flatMap(s => s.lines).find(l => l.id === line.id); assert.equal(lineNow.active_take_id, attached.take.id);
    report.drama.undo_restored_take_id = lineNow.active_take_id;
    const preview = await page.evaluate(async ({ p, s }) => {
      const r = await fetch(`${__dex.state.backendUrl}/api/drama/projects/${encodeURIComponent(p)}/scenes/${encodeURIComponent(s)}/preview`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      return { status: r.status, data: await r.json() };
    }, { p: project.id, s: scene.id });
    assert.equal(preview.status, 200, JSON.stringify(preview.data)); report.drama.preview = { reused: preview.data.reused, timeline_state: preview.data.timeline && preview.data.timeline.state };
    const assembly = await json(srv.base, `/api/drama/projects/${project.id}/assemble`, body({ scene_id: scene.id, historical: false }));
    assert.equal(assembly.status, 200, JSON.stringify(assembly.data));
    const finalProject = assembly.data.project, ex = assembly.data.artifact;
    assert.ok(finalProject && ex && ex.artifact_id); assert.ok(assembly.data.manifest.items.some(i => i.take_id === attached.take.id));
    const exportBytes = (await json(srv.base, `/api/media/${encodeURIComponent(ex.artifact_id)}`)).data;
    report.drama.export_artifact_id = ex.artifact_id; report.drama.export_sha256 = hex(exportBytes); report.drama.export_contains_take = attached.take.id;
    await page.evaluate(() => __dex.setScreen('voice'));
    const remove = page.getByRole('button', { name: 'Remove source', exact: true }); if (await remove.count()) await remove.click();
    assert.equal((await json(srv.base, `/api/staging/${stageId}`)).status, 404);
    report.cleanup.local_source_stage_removed = true; report.browser_console_errors = errors; assert.deepEqual(errors, []);
  } finally { await context.close(); await browser.close(); }
  assert.deepEqual(fs.readFileSync(liveProfilePath), beforeProfile); report.production_fixture_unchanged = true;
  return report;
}

(async () => {
  const resumeReceiptPath = process.env.DEX_OPENVOICE_RESUME_RECEIPT || '';
  const resumeReceipt = resumeReceiptPath ? JSON.parse(fs.readFileSync(resumeReceiptPath, 'utf8')) : null;
  const liveProfilePath = path.join(LIVE_STATE, 'voice-profiles', TARGET_PROFILE, 'profile.json');
  const beforeProfile = fs.readFileSync(liveProfilePath);
  const liveProfile = JSON.parse(beforeProfile);
  assert.equal(liveProfile.approval.state, 'draft', 'production synthetic profile must remain unapproved');
  assert.equal(liveProfile.consent.kind, 'fictional');
  assert.equal(liveProfile.samples.find(s => s.id === TARGET_SAMPLE).review.state, 'unreviewed');
  const sourceMeta = JSON.parse(fs.readFileSync(path.join(LIVE_STATE, 'staging', SOURCE_ID + '.json')));
  const sourceBytes = fs.readFileSync(path.join(LIVE_STATE, 'staging', sourceMeta.file));
  const targetBytes = fs.readFileSync(path.join(LIVE_STATE, 'voice-profiles', TARGET_PROFILE, 'samples', liveProfile.samples.find(s => s.id === TARGET_SAMPLE).file));
  assert.equal(sourceMeta.kind, 'audio'); assert.equal(sourceMeta.duration, 4.75);
  assert.equal(hex(sourceBytes), 'da2fc413e33991bbb16d5d1f296790d45fa58229d03a1255a4aa954332e6eabb');
  assert.equal(hex(targetBytes), liveProfile.samples.find(s => s.id === TARGET_SAMPLE).sha256);
  assert.notEqual(hex(sourceBytes), hex(targetBytes));

  const srv = await startServer();
  activeServer = srv;
  let browser;
  const report = resumeReceipt ? resumeReceipt.report : { source: { id: SOURCE_ID, sha256: hex(sourceBytes), synthetic_provenance: 'Qwen3-TTS VoiceDesign output; exact staged WAV previously shown in DexDiffusion Voice' },
    target: { source_profile_id: TARGET_PROFILE, source_sample_id: TARGET_SAMPLE, sha256: hex(targetBytes), synthetic_provenance: liveProfile.consent.note },
    isolated_state_dir: srv.stateDir, managed_job: null, artifact: null, drama: null, cleanup: null };
  activeReport = report;
  try {
    if (resumeReceipt) {
      const finalReport = await finishPreservedRun(srv, report, liveProfilePath, beforeProfile);
      process.stdout.write(JSON.stringify(finalReport, null, 2) + '\n');
      return;
    }
    let converter = null, probeDeadline = Date.now() + 45000;
    while (Date.now() < probeDeadline) {
      const converters = await json(srv.base, '/api/voice/converters');
      converter = converters.data.converters.find(x => x.id === 'openvoice-v2');
      if (converter && converter.availability.enabled) break;
      await sleep(1500);
    }
    assert.ok(converter && converter.availability.enabled, `OpenVoice capability unavailable after remote probe: ${JSON.stringify(converter && converter.availability)}`);
    const isolatedMedia = path.join(srv.stateDir, 'media');
    assert.equal(fs.realpathSync(isolatedMedia), path.join(fs.realpathSync(srv.stateDir), 'media'));

    // Create a clearly test-only target profile in the isolated profile registry.
    const targetStage = await json(srv.base, '/api/staging?accept=audio', { method: 'POST', body: targetBytes, headers: { 'content-type': 'audio/wav' } });
    assert.equal(targetStage.status, 200);
    const created = await json(srv.base, '/api/voice/profiles', body({ id: 'vp-0a11ce2026', type: 'cloned', name: 'TEST ONLY Synthetic OpenVoice target', language: 'en', description: 'Synthetic-only engineering fixture; no real speaker.', notes: `Test-only fixture. Synthetic reference sha256=${hex(targetBytes)}. No human audition or real-person consent is claimed.` }));
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const pid = created.data.profile.id;
    assert.equal((await json(srv.base, `/api/voice/profiles/${pid}/consent`, put({ kind: 'fictional', note: 'Synthetic VoxCPM2 audio only; no real person.' }))).status, 200);
    const sample = await json(srv.base, `/api/voice/profiles/${pid}/samples`, body({ staged_id: targetStage.data.id, name: 'TEST ONLY synthetic reference', transcript: liveProfile.samples.find(s => s.id === TARGET_SAMPLE).transcript }));
    assert.equal(sample.status, 201, JSON.stringify(sample.data));
    const sid = sample.data.sample.id;
    const review = await json(srv.base, `/api/voice/profiles/${pid}/samples/${sid}/review`, put({ state: 'approved', note: 'Isolated synthetic fixture QA authorization only; not human listening acceptance.' }));
    assert.equal(review.status, 200);
    const approval = await json(srv.base, `/api/voice/profiles/${pid}/approve`, body({ note: 'TEST ONLY synthetic fixture authorization; not a human approval.' }));
    assert.equal(approval.status, 200);
    report.target.test_profile_id = pid; report.target.test_sample_id = sid; report.target.identity_version = approval.data.profile.identity_version;

    // Exercise the production server-side authorization refusal before starting inference.
    const unapproved = await json(srv.base, '/api/voice/profiles', body({ type: 'cloned', name: 'TEST ONLY unapproved profile', language: 'en', description: 'Synthetic test profile, intentionally draft.' }));
    assert.equal(unapproved.status, 201);
    const guardStage = await json(srv.base, '/api/staging?accept=audio', { method: 'POST', body: sourceBytes, headers: { 'content-type': 'audio/wav' } });
    assert.equal(guardStage.status, 200);
    const beforeJobs = await json(srv.base, '/api/generic-jobs');
    const refused = await json(srv.base, '/api/voice/convert', body({ source_staged_id: guardStage.data.id, target_profile_id: unapproved.data.profile.id }));
    assert.equal(refused.status, 409); assert.equal(refused.data.gate, 'consent-required');
    const afterJobs = await json(srv.base, '/api/generic-jobs');
    assert.equal(afterJobs.data.jobs.length, beforeJobs.data.jobs.length, 'unapproved request must not create a job');
    assert.equal((await json(srv.base, '/api/staging/' + guardStage.data.id, { method: 'DELETE' })).data.removed, true);
    report.production_guard = { status: refused.status, gate: refused.data.gate, job_count_unchanged: true };

    // Create the Drama project after output ASR is known, so its exact synthetic
    // line text can be checked by the existing local ASR gate without a bypass.
    browser = await launchBrowser(chromium);
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(String(e)));
    await installModelSnapshots(page, srv.base);
    await page.goto(srv.base + '/dexdiffusion/');
    await page.waitForFunction(() => window.__dex && __dex.state && __dex.state.modelTargets && __dex.state.modelTargets.length > 3);
    await page.evaluate(() => { __dex.setScreen('voice'); __dex.vpSet({ tab: 'profiles' }); });
    const sourceFile = path.join(os.tmpdir(), `dexvoice-source-${process.pid}.wav`);
    fs.writeFileSync(sourceFile, sourceBytes, { flag: 'wx', mode: 0o600 });
    try {
      const sourceInput = page.locator('[data-openvoice-conversion] input[type=file]');
      await sourceInput.setInputFiles({ name: 'synthetic-qwen-voice-design-source.wav', mimeType: 'audio/wav', buffer: sourceBytes });
      await page.getByLabel('Approved target voice').selectOption(pid);
      const [convertResponse] = await Promise.all([
        page.waitForResponse(r => r.url().endsWith('/api/voice/convert') && r.request().method() === 'POST'),
        page.locator('[data-openvoice-start]').click()
      ]);
      assert.equal(convertResponse.status(), 202, await convertResponse.text());
      const conversionRequest = convertResponse.request().postDataJSON(), conversionStarted = await convertResponse.json();
      report.managed_job = { id: conversionStarted.job_id, target_profile_id: pid, source_staged_id: conversionRequest.source_staged_id };
      let job = null, end = Date.now() + 20 * 60 * 1000, leaseObserved = false;
      const progressObserved = new Set();
      while (Date.now() < end) {
        const result = await json(srv.base, `/api/generic-jobs/${encodeURIComponent(conversionStarted.job_id)}`);
        job = result.data;
        if (job.progress && job.progress.phase) progressObserved.add(job.progress.phase);
        const resources = await json(srv.base, '/api/resources');
        if (resources.data.owner && resources.data.owner.job_id === conversionStarted.job_id) leaseObserved = true;
        const terminal = job && ['COMPLETE', 'FAILED', 'CANCELLED', 'INTERRUPTED'].includes(job.status);
        const cleaned = terminal && (job.owned_resources || []).length > 0 && job.owned_resources.every(r => r.state === 'succeeded' || r.state === 'failed');
        if (cleaned && (job.status !== 'COMPLETE' || job.owned_resources.every(r => r.state === 'succeeded'))) break;
        await sleep(1200);
      }
      assert.ok(job, 'managed conversion job record not found');
      if (job.status !== 'COMPLETE') fail(`managed conversion ${job.status}: ${job.error || job.first_failed_gate || 'no failure detail'}`);
      assert.equal(job.status, 'COMPLETE');
      assert.equal(job.worker_id, 'openvoice-v2');
      assert.equal(leaseObserved, true, 'managed conversion never appeared as owner of the shared heavy-compute lease');
      assert.ok(progressObserved.size >= 2, `insufficient real progress transitions observed: ${[...progressObserved]}`);
      report.managed_job = { id: job.job_id, status: job.status, worker: job.worker_id, progress_phases: [...progressObserved], lease_observed: leaseObserved,
        resource_lease_after_terminal: job.resource_lease, owned_resources: job.owned_resources };
      assert.equal(job.artifacts.length, 1);
      assert.equal(job.owned_resources.length, 1);
      assert.equal(job.owned_resources[0].state, 'succeeded');
      assert.equal(job.owned_resources[0].receipt.in_band_verified, true);
      const artifactId = job.artifacts[0];
      const bytes = (await json(srv.base, `/api/media/${encodeURIComponent(artifactId)}`)).data;
      const sha = hex(bytes);
      const registry = JSON.parse(fs.readFileSync(path.join(srv.stateDir, 'media-artifacts.json')));
      const rec = registry.artifacts[artifactId];
      assert.ok(rec); assert.equal(rec.sha256, sha); assert.ok(rec.canonical_path.startsWith(isolatedMedia + path.sep));
      assert.equal(rec.parent, conversionRequest.source_staged_id);
      assert.equal(rec.meta.conversion.source_audio_id, conversionRequest.source_staged_id);
      assert.equal(rec.meta.conversion.target_profile_id, pid);
      assert.equal(rec.meta.conversion.target_profile_version, approval.data.profile.identity_version);
      assert.notEqual(rec.meta.conversion.source_wav_sha256, rec.meta.conversion.target_wav_sha256);
      assert.equal(rec.meta.conversion.converter_checkpoint_sha256, '9652c27e92b6b2a91632590ac9962ef7ae2b712e5c5b7f4c34ec55ee2b37ab9e');
      assert.equal(rec.meta.conversion.watermark_model_sha256, '7a3d873d115c2c644685fb4cf109bdb299718296b88c871d3cf1c8e4cbc13144');
      const currentResources = (await json(srv.base, '/api/resources')).data;
      assert.equal(currentResources.owner, null);
      const cleanupPath = job.owned_resources[0].path;
      assert.ok(CleanupOwner.validRemotePath(cleanupPath));
      const cleanupProof = execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', job.owned_resources[0].host,
        `test ! -e '${cleanupPath}' && test ! -L '${cleanupPath}' && echo DEXVOICE_REMOTE_DIR_ABSENT`], { encoding: 'utf8', timeout: 20000 }).trim();
      assert.equal(cleanupProof, 'DEXVOICE_REMOTE_DIR_ABSENT');
      report.artifact = { id: artifactId, sha256: sha, bytes: bytes.length, parent: rec.parent, duration_s: rec.duration,
        sample_rate: rec.meta.sample_rate, channels: rec.meta.channels, format: rec.mime, conversion: rec.meta.conversion };
      report.cleanup = { remote_resource_path: cleanupPath, remote_receipt: job.owned_resources[0].receipt,
        remote_directory_absent_readback: cleanupProof, lease_released: currentResources.owner === null };

      const asr = Asr.detect(); report.local_asr = { available: asr.available, model: asr.model && path.basename(asr.model), reason: asr.reason || null };
      if (!asr.available) fail(`Drama attachment requires local ASR, which is unavailable: ${asr.reason}`);
      const heard = await Asr.transcribe(rec.canonical_path, asr);
      report.local_asr.text = heard.text; report.local_asr.engine = heard.engine;
      const proj = await json(srv.base, '/api/drama/projects', body({ title: 'TEST ONLY OpenVoice managed conversion', script: `OPENVOICE FIXTURE: ${heard.text}` }));
      assert.equal(proj.status, 201, JSON.stringify(proj.data));
      const project = proj.data.project;
      const line = project.scenes.flatMap(s => s.lines).find(l => l.kind !== 'direction' && l.render !== false);
      assert.ok(line);
      const scene = project.scenes.find(s => s.id === line.scene_id) || project.scenes[0];
      const actor = project.actors.find(a => a.speaker_key === line.speaker_key);
      const bound = await json(srv.base, `/api/drama/projects/${project.id}/actors/${actor.id}`, put({ voice_profile_id: pid }));
      assert.equal(bound.status, 200);
      report.drama = { project_id: project.id, scene_id: scene.id, line_id: line.id };

      // Attach from the Voice UI; this invokes the same server route and mandatory local ASR gate.
      await page.evaluate(() => __dex.loadVoiceProfiles());
      await page.locator('[data-openvoice-conversion] select').nth(1).selectOption(project.id);
      await page.waitForFunction(id => {
        const els = [...document.querySelectorAll('[data-openvoice-conversion] select')];
        return els.length > 2 && els[2].querySelector(`option[value="${CSS.escape(id)}"]`);
      }, line.id);
      await page.locator('[data-openvoice-conversion] select').nth(2).selectOption(line.id);
      const [attachRequest] = await Promise.all([
        page.waitForRequest(r => r.url().includes(`/lines/${line.id}/conversions`) && r.method() === 'POST'),
        page.locator('[data-openvoice-attach]').click()
      ]);
      const attachResponse = await attachRequest.response();
      assert.equal(attachResponse.status(), 201, await attachResponse.text());
      const attached = await attachResponse.json();
      report.drama.take_id = attached.take.id; report.drama.asr = attached.word_integrity;
      assert.equal(attached.word_integrity.status, 'PASS');

      // The Voice panel exposes the real source/output audio elements. Verify the
      // same served WAV bytes through their URLs; headless Chromium may not decode audio.
      const players = page.locator('[data-openvoice-conversion] audio');
      assert.equal(await players.count(), 3); // staged source, A/B source, converted result
      for (const i of [0, 2]) {
        const state = await players.nth(i).evaluate(async a => {
          const r = await fetch(a.src), bytes = await r.arrayBuffer();
          return { status: r.status, type: r.headers.get('content-type'), bytes: bytes.byteLength, playback_ready: a.readyState >= 2 };
        });
        assert.equal(state.status, 200); assert.match(state.type, /audio\/wav/i); assert.ok(state.bytes > 1000);
        report.browser_audio = report.browser_audio || []; report.browser_audio.push({ index: i, ...state });
      }

      // Open the actual Drama screen, select the converted take, preview, export,
      // and undo a temporary rejection to prove selection history restores it.
      await page.evaluate(() => __dex.setScreen('drama'));
      await page.waitForSelector('[data-drama="1"]');
      const projectOption = page.locator('[data-drama="1"] select option').filter({ hasText: 'TEST ONLY OpenVoice managed conversion' }).first();
      if (await projectOption.count()) await page.locator('[data-drama="1"] select').first().selectOption(project.id);
      else {
        const title = page.getByText('TEST ONLY OpenVoice managed conversion', { exact: true }).first();
        if (await title.count()) await title.click();
      }
      await page.waitForSelector(`[data-take="${attached.take.id}"]`);
      const takeCard = page.locator(`[data-take="${attached.take.id}"]`);
      const selectTake = takeCard.getByRole('button', { name: 'Select', exact: true });
      if (await selectTake.count()) await selectTake.click();
      let currentProject = (await json(srv.base, `/api/drama/projects/${project.id}`)).data.project;
      let currentLine = currentProject.scenes.flatMap(s => s.lines).find(l => l.id === line.id);
      report.drama.prior_take_id = currentLine.active_take_id;
      await takeCard.getByRole('button', { name: 'Reject' }).click();
      await takeCard.getByRole('button', { name: 'Undo selection' }).click();
      currentProject = (await json(srv.base, `/api/drama/projects/${project.id}`)).data.project;
      currentLine = currentProject.scenes.flatMap(s => s.lines).find(l => l.id === line.id);
      assert.equal(currentLine.active_take_id, attached.take.id);
      report.drama.undo_restored_take_id = currentLine.active_take_id;

      const preview = await page.evaluate(async ({ p, s }) => {
        const r = await fetch(`${__dex.state.backendUrl}/api/drama/projects/${encodeURIComponent(p)}/scenes/${encodeURIComponent(s)}/preview`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
        return { status: r.status, data: await r.json() };
      }, { p: project.id, s: scene.id });
      assert.equal(preview.status, 200, JSON.stringify(preview.data));
      const assembly = await json(srv.base, `/api/drama/projects/${project.id}/assemble`, body({ scene_id: scene.id, historical: false }));
      assert.equal(assembly.status, 200, JSON.stringify(assembly.data));
      const ex = assembly.data.artifact; assert.ok(ex && ex.artifact_id);
      assert.equal(assembly.data.manifest.items.some(i => i.take_id === attached.take.id), true);
      const exportBytes = (await json(srv.base, `/api/media/${encodeURIComponent(ex.artifact_id)}`)).data;
      assert.ok(exportBytes.length > bytes.length);
      report.drama.export_artifact_id = ex.artifact_id; report.drama.export_sha256 = hex(exportBytes);
      report.drama.export_contains_take = attached.take.id;

      // Remove the source stage through the Voice UI's ownership-scoped control.
      await page.evaluate(() => __dex.setScreen('voice'));
      const remove = page.getByRole('button', { name: 'Remove source' });
      if (await remove.count()) await remove.click();
      const stagedCheck = await json(srv.base, `/api/staging/${conversionRequest.source_staged_id}`);
      assert.equal(stagedCheck.status, 404);
      report.cleanup.local_source_stage_removed = true;
      report.browser_console_errors = pageErrors;
      assert.deepEqual(pageErrors, []);
    } finally { try { fs.unlinkSync(sourceFile); } catch (_) {} }
    await context.close();
    // The production fixture remains exactly as it started: draft, synthetic, unreviewed.
    assert.deepEqual(fs.readFileSync(liveProfilePath), beforeProfile);
    report.production_fixture_unchanged = true;
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } finally {
    if (browser) await browser.close().catch(() => {});
    await srv.stop();
  }
})().catch(e => {
  if (activeServer && activeReport && activeReport.managed_job && activeReport.managed_job.id) {
    preserveSuiteState(activeServer.stateDir);
    const receipt = path.join(os.tmpdir(), `dexvoice-openvoice-failed-${Date.now()}.json`);
    try { fs.writeFileSync(receipt, JSON.stringify({ error: String(e.message || e), report: activeReport, state_dir: activeServer.stateDir }, null, 2), { flag: 'wx', mode: 0o600 }); } catch (_) {}
    console.error(`OpenVoice fixture state preserved for diagnosis: ${activeServer.stateDir}`);
    console.error(`Failure receipt: ${receipt}`);
  }
  console.error(e && e.stack || e); process.exitCode = 1;
});
