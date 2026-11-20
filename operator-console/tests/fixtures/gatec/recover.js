'use strict';
// What a console restart does, in a test-owned HOME: image-store journal recovery,
// engine-transfer reconciliation (when the implementation has it), then generic
// INTERRUPTED-job reconciliation. Prints one JSON line.
const fs = require('node:fs');
const path = require('node:path');
const impl = path.resolve(process.env.DEX_GATEC_IMPL_ROOT, 'operator-console');
const { createImageStore } = require(path.join(impl, 'image-store'));
const { validateImage } = require(path.join(impl, 'image-validation'));
const { reconcileInterruptedPublications } = require(path.join(impl, 'publication-recovery'));
const M = require(path.join(impl, 'media'));
const client = require(path.join(impl, 'local-engine-client'));
(async () => {
  const runsRoot = process.env.DEX_RUNS_DIR, imageRoot = process.env.DEX_IMAGES_ROOT_OVERRIDE;
  const jobsFile = path.join(process.env.DEX_STATE_DIR, 'jobs.json');
  if (!fs.existsSync(jobsFile)) {
    fs.mkdirSync(path.dirname(jobsFile), { recursive: true });
    const seed = M.createJobStore(jobsFile);
    seed.create({ job_id: process.env.DEXDIFFUSION_JOB_ID, media_kind: 'image', operation: 'controlled-generate', worker_id: 'bigmac-local', params: { quantity: Number(process.env.GATEC_COUNT || 1) } });
    seed.transition(process.env.DEXDIFFUSION_JOB_ID, 'RUNNING');
    seed.flush();
  }
  const jobStore = M.createJobStore(jobsFile); // restart: RUNNING -> INTERRUPTED
  const store = createImageStore({ root: imageRoot, runsRoot });
  const out = { journal: store.recoverPendingPublications(), transfers: null };
  let transfer = null;
  try { transfer = require(path.join(impl, 'engine-transfer-journal')); } catch (err) { if (err.code !== 'MODULE_NOT_FOUND') throw err; }
  if (transfer) {
    out.transfers = await transfer.reconcileTransfers({ journal: transfer.createTransferJournal({}), store, runsRoot, validateImage,
      ownedFor: runId => transfer.ownerBackedRequest(runId, client) });
  }
  out.jobs = reconcileInterruptedPublications({ jobStore, runsRoot, imageStore: store, validateImage });
  out.job = jobStore.get(process.env.DEXDIFFUSION_JOB_ID);
  process.stdout.write(JSON.stringify(out) + '\n');
})().catch(err => { process.stdout.write(JSON.stringify({ error: err.message }) + '\n'); process.exitCode = 1; });
