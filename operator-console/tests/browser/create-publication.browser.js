'use strict';

const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const { createHash } = require('node:crypto');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright-core');
const { launchBrowser, onCleanup, openStudio, runCleanups } = require('./helpers');
const { resolveOutputDir, createOwnedWriter } = require('./safe-output');

const route = '/api/actions/generate-controlled';
const fixture = { target: 'sd15', width: 512, height: 512, prompt: 'A blue ceramic cup', seed: 42 };

async function startFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-create-fixture-'));
  const env = {
    PATH: process.env.PATH, DEX_TEST_ISOLATION: '1', DEX_CREATE_FIXTURE_ROOT: root,
    DEX_IMAGE_VALIDATION_PYTHON: process.env.DEX_IMAGE_VALIDATION_PYTHON || 'python3',
    OLLAMA_BASE_URL: 'http://127.0.0.1:9',
  };
  for (const [key, subdir] of Object.entries({
    HOME: 'home', DEX_STATE_DIR: 'state', DEX_IMAGES_ROOT_OVERRIDE: 'images',
    DEX_MEDIA_ROOT_OVERRIDE: 'media', DEX_RUNS_DIR: 'runs', DEX_LOGS_DIR: 'logs',
    DEX_SCRATCH_ROOT: 'scratch', TMPDIR: 'tmp',
  })) {
    env[key] = path.join(root, subdir);
    fs.mkdirSync(env[key]);
  }
  const child = fork(path.join(__dirname, '../fixtures/isolated-create-console.js'), [], { env });
  const exited = once(child, 'exit');
  onCleanup(async () => {
    child.kill();
    if (!(await Promise.race([exited, delay(2000, null, { ref: false })]))) {
      child.kill('SIGKILL');
      await exited;
    }
    fs.rmSync(root, { recursive: true, force: true });
  });
  const port = await Promise.race([
    once(child, 'message', { signal: AbortSignal.timeout(12000) }).then(([value]) => value),
    exited.then(([code]) => { throw new Error('Fixture exited before listen: ' + code); }),
  ]);
  return { base: 'http://127.0.0.1:' + port, env };
}

async function main() {
  const { base, env } = await startFixture();
  const browser = await launchBrowser(chromium);
  const page = await browser.newPage({ viewport: { width: 1320, height: 860 } });
  await openStudio(page, base + '/dexdiffusion/');
  const resources = async () => (await page.request.get(base + '/api/resources')).json();
  const initial = await resources();
  assert.equal(initial.owner, null);
  const projectResponse = await page.request.post(base + '/api/drama/projects', {
    data: { title: 'Isolated Drama fixture', script: 'NARRATOR: This is a synthetic line.' },
  });
  assert.ok(projectResponse.ok(), await projectResponse.text());
  const { project } = await projectResponse.json();
  const profileResponse = await page.request.post(base + '/api/voice/profiles', {
    data: { name: 'Narrator fixture', type: 'preset', preset_voice: 'af_heart' },
  });
  assert.ok(profileResponse.ok(), await profileResponse.text());
  const { profile } = await profileResponse.json();
  const cast = await page.request.put(base + '/api/drama/projects/' + project.id + '/actors/' + project.actors[0].id, {
    data: { voice_profile_id: profile.id },
  });
  assert.ok(cast.ok(), await cast.text());
  const refused = await page.request.post(base + '/api/drama/projects/' + project.id + '/produce', { data: { asr: false } });
  assert.equal(refused.status(), 409, await refused.text());
  const blocked = await refused.json();
  assert.equal(blocked.gate, 'production-blocked');
  assert.ok(blocked.plan.cast_problems.some(problem => problem.reason === 'engine-unavailable'), JSON.stringify(blocked.plan.cast_problems));
  const afterDrama = await resources();
  assert.equal(afterDrama.owner, null);
  assert.deepEqual(afterDrama.waiting, []);
  assert.equal(afterDrama.quarantine, initial.quarantine);
  assert.equal((await page.request.get(base + '/api/library/images')).status(), 200);

  await page.getByRole('textbox', { name: 'Describe your image' }).fill(fixture.prompt);
  let lostResponse = null;
  let submittedKey = null;
  await page.route(base + route, async interception => {
    if (lostResponse) return interception.continue();
    submittedKey = interception.request().headers()['idempotency-key'];
    // Prime the actual Library cache immediately before the worker publishes.
    const prior = await page.request.get(base + '/api/library/images');
    assert.equal((await prior.json()).total, 0);
    const response = await interception.fetch();
    lostResponse = await response.json();
    await interception.abort('connectionreset');
  });
  const admitted = page.waitForResponse(res => res.url() === base + route && res.request().method() === 'POST');
  await page.getByRole('button', { name: 'Generate image', exact: true }).click();
  const response = await admitted;
  assert.equal(response.status(), 200, await response.text());
  const { job_id, replayed } = await response.json();
  assert.ok(submittedKey);
  assert.equal(job_id, lostResponse.job_id);
  assert.equal(job_id, submittedKey);
  assert.equal(replayed, true);
  assert.equal(response.request().headers()['idempotency-key'], submittedKey);
  await page.getByText('Saved to Library', { exact: true }).waitFor({ timeout: 15000 });
  const jobsFile = path.join(env.DEX_STATE_DIR, 'jobs.json');
  const readJob = id => JSON.parse(fs.readFileSync(jobsFile, 'utf8')).jobs.find(job => job.job_id === id);
  const job = readJob(job_id);
  assert.equal(job.status, 'COMPLETE');
  assert.equal(job.artifacts.length, 1);
  assert.ok(!fs.readFileSync(jobsFile, 'utf8').includes(fixture.prompt));
  const [id] = job.artifacts;
  const image = await page.request.get(base + '/api/images/' + id);
  assert.equal(image.status(), 200);
  assert.equal(createHash('sha256').update(await image.body()).digest('hex'),
    job.artifact_validation.artifacts[0].sha256);
  const library = await (await page.request.get(base + '/api/library/images')).json();
  assert.ok(library.items.some(item => item.id === id));
  assert.equal((await resources()).owner, null);
  assert.equal(fs.readdirSync(env.DEX_RUNS_DIR).length, 1, 'a lost response does not execute a second generation');

  if (process.env.DEX_CREATE_SCREENSHOTS) {
    const out = createOwnedWriter(resolveOutputDir(process.env.DEX_CREATE_SCREENSHOTS, { label: 'create-reference' }));
    await page.screenshot({ path: out.pathFor('create.png') });
    await page.getByRole('button', { name: 'Open in Library', exact: true }).click();
    await page.locator('[data-library-primary-actions=' + JSON.stringify(id) + ']').waitFor();
    await page.screenshot({ path: out.pathFor('library.png') });
  }

  const invalid = await page.request.post(base + route, { data: { ...fixture, seed: 43 } });
  assert.equal(invalid.status(), 200, await invalid.text());
  const invalidId = (await invalid.json()).job_id;
  await page.waitForFunction(async ({ id }) => (await (await fetch('/api/jobs/' + id)).json()).status === 'FAIL',
    { id: invalidId }, { timeout: 15000 });
  const failed = readJob(invalidId);
  assert.equal(failed.status, 'FAILED');
  assert.deepEqual(failed.artifacts, []);
  assert.equal((await (await page.request.get(base + '/api/library/images')).json()).total, library.total);

  const before = fs.readdirSync(env.DEX_RUNS_DIR);
  const workersFile = path.join(env.DEX_STATE_DIR, 'remote-workers.json');
  fs.renameSync(workersFile, workersFile + '.saved');
  fs.mkdirSync(workersFile);
  const refusedWorker = await page.request.post(base + route, { data: fixture });
  assert.equal(refusedWorker.status(), 200, await refusedWorker.text());
  const refusedWorkerId = (await refusedWorker.json()).job_id;
  await page.waitForFunction(async ({ id }) => (await (await fetch('/api/jobs/' + id)).json()).status === 'FAIL',
    { id: refusedWorkerId }, { timeout: 15000 });
  assert.equal(readJob(refusedWorkerId).first_failed_gate, 'job-storage-unavailable');
  assert.equal((await resources()).owner, null);
  assert.match((await resources()).quarantine, /ledger requires recovery/);
  assert.deepEqual(fs.readdirSync(env.DEX_RUNS_DIR), before);

  fs.renameSync(jobsFile, jobsFile + '.saved');
  fs.mkdirSync(jobsFile);
  const rejected = await page.request.post(base + route, { data: fixture });
  assert.equal(rejected.status(), 503);
  assert.deepEqual(await rejected.json(), { error: 'Job storage unavailable', gate: 'job-storage-unavailable' });
  assert.deepEqual(fs.readdirSync(env.DEX_RUNS_DIR), before);
  console.log('[create-publication] PASS Drama engine unavailable; Create and Library still work; corrupt output and failed ledger writes rejected');
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await runCleanups();
  process.exit(process.exitCode || 0);
});
