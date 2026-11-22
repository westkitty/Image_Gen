#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { request, saveOwner } = require('../local-engine-client');
const { createImageStore } = require('../image-store');
const { resolveStoragePaths, assertDataRootMount } = require('../storage-paths');
const { createPublicationOutbox } = require('../publication-outbox');
const { adapterId, resolveLoraRuntimePolicy } = require('../lora-runtime-policy');
const { canonicalSampler } = require('../controlled-args');
const { createTransferJournal, advanceTransfer, TransferPending, TransferBlocked } = require('../engine-transfer-journal');
const workflow = path.resolve(__dirname, '../../sdcpp-workflow');
function createJobPublication(env = process.env, host = os.hostname()) {
  const paths = resolveStoragePaths(env);
  const crossHostPublication = env.DEX_STORAGE_MODE !== 'internal-fallback' && !!paths.dataRoot && host.toLowerCase() === 'bigmac';
  if (crossHostPublication) assertDataRootMount(paths);
  const opts = { root: paths.imageRoot, runsRoot: paths.runsDir };
  let outbox = null;
  if (crossHostPublication) {
    outbox = createPublicationOutbox(path.join(paths.stateDir, 'publications'));
    opts.onPublished = entry => outbox.create(entry, path.join(paths.imageRoot, entry.image_id));
  }
  return { store: createImageStore(opts), outbox, imageRoot: paths.imageRoot };
}
function createJobImageStore(env = process.env, host = os.hostname()) {
  return createJobPublication(env, host).store;
}
async function publishAfterAcknowledgment({ acknowledge, publish, isStopping }) {
  const cleanup = await acknowledge();
  if (!cleanup.acknowledged || !cleanup.cleanup) throw new Error('Remote cleanup not verified');
  if (isStopping()) throw new Error('cancelled before publication');
  return publish();
}
// Classifies a failed engine result into a first failed gate plus a user-facing reason. The reason is built from fixed
// templates and file basenames only: directory paths, the prompt and the negative prompt never reach it.
const ABS_PATH = /(?<![\w.~\/])(?:~\/|\/)(?:[^\s'"`,;:()\[\]<>{}]*\/)*[^\s'"`,;:()\[\]<>{}\/]+/g;
const MODEL_FILE = /[^\s'"`,;:()\[\]<>{}\/]+\.(?:safetensors|gguf|ckpt|bin|pt|pth)\b/i;
function classifyEngineError(err, modelPath, { prompt, negativePrompt } = {}) {
  const isObj = err && typeof err === 'object';
  let message = String((isObj ? (err.error || err.message || err.status) : err) || 'unknown engine failure');
  const modelRead = isObj ? !!err.model_read : false;
  const modelBase = modelPath ? path.basename(String(modelPath)) : null;
  const namesModel = !!modelBase && message.includes(modelBase);
  if (/\[Errno (1|13)\]/.test(message) && (!modelRead || namesModel)) {
    const found = MODEL_FILE.exec(message.replace(ABS_PATH, m => path.basename(m)));
    const name = modelBase || (found && found[0]) || 'for this target';
    return { gate: 'model-read-denied', reason: `Big Mac engine cannot read the model file ${name}: Operation not permitted (check macOS file access for the engine worker)` };
  }
  for (const secret of [prompt, negativePrompt]) if (secret && String(secret).trim().length >= 3) message = message.split(String(secret)).join('[REDACTED]');
  message = message.replace(ABS_PATH, m => path.basename(m)).replace(/\s+/g, ' ').trim();
  if (message.length > 200) message = message.slice(0, 199) + '…';
  return { gate: 'engine-failed', reason: message || 'unknown engine failure' };
}
function parse(argv) {
  const args = {};
  const allowed = new Set(['target','prompt','negative-prompt','width','height','steps','seed','cfg','sampler','scheduler','save-prompts','lora-id','lora-strength','lora-ids','lora-strengths','backend-override','lora-apply-mode','clip-skip','tiling','eta','rng','vae','model-path','api','hires-scale','hires-width','hires-height','hires-steps','hires-denoise','hires-upscaler','batch-count','init-image','strength','control-net','control-image','control-strength']);
  for (let i = 0; i < argv.length; i += 2) {
    if (argv[i] === '--tiling') { args.tiling = true; i--; continue; }
    const key = argv[i].replace(/^--/, '');
    if (!argv[i].startsWith('--') || !allowed.has(key) || argv[i + 1] === undefined || args[key] !== undefined) throw new Error('Unsupported bridge setting: ' + argv[i]);
    args[key] = argv[i + 1];
  }
  return args;
}
let reasonPrinted = false;
async function main() {
  const args = parse(process.argv.slice(2));
  const registry = JSON.parse(spawnSync(process.execPath, [path.join(workflow, 'worker/build-registry.js')], { encoding: 'utf8' }).stdout);
  const spec = registry.models[args.target];
  if (!spec) throw new Error('Model is not installed in the local worker registry');
  if (args['model-path'] && args['model-path'] !== spec.path) throw new Error('Model path does not match installed registry ID');
  const loras = [];
  let prompt = args.prompt || '';
  prompt = prompt.replace(/<lora:([^:>]+):([^>]+)>/gi, (_, name, weight) => { loras.push({ name, weight: Number(weight) }); return ''; });
  if (args['lora-id']) loras.push({ name: args['lora-id'], weight: Number(args['lora-strength']) });
  if (args['lora-ids']) {
    const ids = String(args['lora-ids']).split(','), ws = String(args['lora-strengths'] || '').split(',');
    if (ids.length !== ws.length || args['lora-id']) throw new Error('lora-ids and lora-strengths must pair up');
    ids.forEach((id, i) => loras.push({ name: id, weight: Number(ws[i]) }));
  }
  const params = { target: args.target, steps: Number(args.steps || spec.defaultSteps), cfg_scale: Number(args.cfg ?? spec.defaultCfgScale ?? 1),
    sampler: canonicalSampler(args.sampler || spec.defaultSampler || 'euler'), scheduler: args.scheduler || 'discrete', loras,
    backend_override: args['backend-override'], lora_apply_mode: args['lora-apply-mode'] };
  const policy = resolveLoraRuntimePolicy(params);
  if (!policy.ok) throw new Error(policy.error);
  const settings = {};
  for (const key of ['clip-skip','eta','hires-scale','hires-width','hires-height','hires-steps','hires-denoise']) if (args[key] !== undefined) settings[key.replace(/-/g,'_')] = Number(args[key]);
  for (const key of ['rng','hires-upscaler']) if (args[key] !== undefined) settings[key.replace(/-/g,'_')] = args[key];
  if (args.tiling) settings.tiling = true;
  if (args['backend-override']) settings.backend = ['metal','gpu'].includes(args['backend-override']) ? 'MTL0' : args['backend-override'];
  if (args['lora-apply-mode']) settings.lora_apply_mode = args['lora-apply-mode'];
  if (args.vae && args.vae !== 'none') {
    const vae = Object.entries(registry.vaes).find(([,p]) => p === args.vae);
    if (!vae) throw new Error('VAE path does not match an installed registry ID');
    settings.vae_id = vae[0];
  }
  // img2img: the server resolves the init image; its bytes (never its path) cross the worker socket.
  let init = null;
  if (args['init-image'] !== undefined || args.strength !== undefined) {
    const strength = Number(args.strength);
    if (args['init-image'] === undefined || !Number.isFinite(strength) || strength < 0.01 || strength > 0.99) throw new Error('img2img needs --init-image and a --strength between 0.01 and 0.99');
    if (Number(args['batch-count'] || 1) !== 1 || Object.keys(settings).some(k => k.startsWith('hires_'))) throw new Error('img2img runs one image without hires fix');
    const bytes = fs.readFileSync(args['init-image']);
    if (bytes.length > 16 * 1024 * 1024 || !bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) throw new Error('The init image must be a PNG of at most 16 MB');
    init = { init_image: bytes.toString('base64'), strength };
  }
  // ControlNet: a registry id plus the pose/control image bytes (never a path) cross the worker socket.
  let control = null;
  if (args['control-net'] !== undefined || args['control-image'] !== undefined || args['control-strength'] !== undefined) {
    const strength = Number(args['control-strength']);
    if (!args['control-net'] || !args['control-image'] || !Number.isFinite(strength) || strength < 0 || strength > 2) throw new Error('ControlNet needs --control-net, --control-image and a --control-strength between 0 and 2');
    if (!registry.controlnets || !registry.controlnets[args['control-net']]) throw new Error('ControlNet is not installed in the engine registry');
    if (Object.keys(settings).some(k => k.startsWith('hires_'))) throw new Error('ControlNet runs without hires fix');
    const bytes = fs.readFileSync(args['control-image']);
    if (bytes.length > 16 * 1024 * 1024 || !bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) throw new Error('The control image must be a PNG of at most 16 MB');
    control = { control: { id: args['control-net'], image: bytes.toString('base64'), strength } };
  }
  // Fail before announcing a remote run when the worker cannot accept requests.
  // This keeps a missing socket from being mistaken for an orphaned inference.
  const health = await request({op:'health'});
  if ((health.recovery_uncertain || []).length) throw new Error('Big Mac local engine recovery requires process reconciliation');
  const d = new Date(), stamp = d.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const runId = `${stamp}-${init ? 'img2img' : 'controlled'}-${args.target}-${crypto.randomBytes(4).toString('hex')}`;
  const token = crypto.randomBytes(32).toString('hex');
  const seed = args.seed === undefined || Number(args.seed) < 0 ? crypto.randomInt(0, 2147483647) : Number(args.seed);
  const count = Number(args['batch-count'] || 1);
  const req = { ...(count>1?{batch_count:count}:{}), op: 'generate', run_id: runId, token, target: args.target, prompt, negative_prompt: args['negative-prompt'] || '',
    width: Number(args.width || spec.defaultWidth), height: Number(args.height || spec.defaultHeight), steps: params.steps,
    cfg: params.cfg_scale, sampler: params.sampler, scheduler: params.scheduler, seed,
    settings, save_prompts: args['save-prompts'] === 'true', loras: loras.map(l => ({ id: adapterId(l.name), strength: l.weight })), ...(init || {}), ...(control || {}) };
  const runsRoot = process.env.DEX_RUNS_DIR ? path.resolve(process.env.DEX_RUNS_DIR) : path.join(workflow, 'runs');
  const runDir = path.join(runsRoot, runId);
  // The durable transfer journal is internal (home volume), independent of DEX_DATA_ROOT,
  // and validated before any run is announced; a failure here generates nothing.
  const journal = createTransferJournal({ dataRoot: process.env.DEX_DATA_ROOT });
  journal.assertSafeRoot();
  const { store, outbox, imageRoot } = createJobPublication(process.env);
  fs.mkdirSync(runDir, { recursive: true, mode: 0o700 });
  const jobId = /^[a-f0-9-]{36}$/i.test(process.env.DEXDIFFUSION_JOB_ID || '') ? process.env.DEXDIFFUSION_JOB_ID : null;
  if (jobId) {
    fs.writeFileSync(path.join(runDir, 'job-owner.json'), JSON.stringify({ schema: 'dexdiffusion.run_owner.v1', job_id: jobId, run_id: runId }), { mode: 0o600, flag: 'wx' });
  }
  saveOwner(runId, token);
  const runFiles = Array.from({ length: count }, (_, i) => 'controlled-' + args.target + (count > 1 ? '-b' + String(i).padStart(2, '0') : '') + '.png');
  // Journaled before generate: a crash at any later point leaves a recoverable, owned entry.
  journal.begin({ runId, jobId, runDir, count, runFiles, meta: { target: args.target, backend: spec.backend || 'sdcpp', width: req.width,
    height: req.height, steps: req.steps, seed, sampler: req.sampler, scheduler: req.scheduler, cfg_scale: req.cfg, loras: req.loras,
    native_batch_count: count, save_prompts: req.save_prompts, ...(init ? { operation: 'img2img', strength: init.strength } : {}),
    ...(control ? { controlnet: { model: control.control.id, strength: control.control.strength } } : {}) } });
  const release = journal.lock(runId);
  console.log('SDCPP_RUN_ID: ' + runId);
  const owned = (op, extra={}) => request({ op, run_id: runId, token, ...extra });
  let stopping = false;
  const stop = () => { stopping = true; journal.requestCancel(runId); owned('cancel').catch(e => console.error(e.message)); };
  for (const sig of ['SIGTERM','SIGINT','SIGHUP']) process.on(sig, stop);
  const advance = extras => advanceTransfer(runId, { journal, owned, store, runsRoot, outbox, imageRoot, isStopping: () => stopping, manifestExtras: extras });
  try {
    let state;
    try { state = await request(req); }
    catch (e) {
      // Ask the worker whether the job exists: a definite "unknown" removes the entry, anything else keeps it.
      const outcome = await advance({}).catch(err => ({ state: 'pending', reason: err.reason }));
      if (outcome.state === 'no-output') throw e;
      throw new TransferPending('generate-unconfirmed', e.message);
    }
    journal.update(runId, { generate_confirmed: true });
    const deadline = Date.now() + 1850 * 1000;
    while (!['complete','failed','cancelled'].includes(state.status)) {
      if (Date.now() > deadline) { await owned('cancel'); throw new Error('Engine exceeded its bounded deadline'); }
      await new Promise(resolve => setTimeout(resolve, 750));
      state = await owned('status');
    }
    console.log('ENGINE_RESULT: ' + JSON.stringify(state));
    if (spec.backend === 'mflux' && Number.isFinite(state.generation_seconds)) console.log('MFLUX_TIMING: '+JSON.stringify({remote_generate_s:state.generation_seconds}));
    if (state.status !== 'complete' || stopping) {
      if (state.status === 'failed') {
        const failure = classifyEngineError(state, spec.path, { prompt, negativePrompt: req.negative_prompt });
        reasonPrinted = true;
        console.log('First failed gate: ' + failure.gate + '\nENGINE_FAILURE_REASON: ' + failure.reason);
      }
      await advance({});
      throw new Error(state.error || state.status);
    }
    // Order: durable journal bytes -> ACK -> canonical publication -> manifest -> journal removal.
    const outcome = await advance({ prompt: req.save_prompts ? prompt : '[REDACTED]', worker: state });
    if (outcome.state === 'discarded') throw new Error('cancelled before publication');
    if (outcome.state !== 'complete') throw new TransferPending(outcome.reason || 'transfer-incomplete');
    for (const output of count>1?outcome.logicalOutputs:[]) console.log('CONTROLLED_BATCH_IMAGE: '+output);
    console.log('SDCPP_REMOTE_CLEANUP: OK\nCONTROLLED_TARGET: ' + args.target + '\nCONTROLLED_OUTPUT_IMAGE: ' + outcome.logicalOutputs[0] + '\nCONTROLLED_MANIFEST: ' + outcome.manifestPath);
  } catch (e) {
    let pending = null;
    try { pending = journal.read(runId); } catch (_) { pending = { state: 'unreadable' }; }
    if (!pending || pending.state === 'requested') { try { await owned('cancel'); } catch (_) {} }
    if (pending) {
      // Never reported as published and never silently dropped: startup reconciliation owns it now.
      reasonPrinted = true;
      const reason = (e instanceof TransferPending || e instanceof TransferBlocked) ? e.reason : 'engine-transfer-pending';
      console.log('ENGINE_TRANSFER_PENDING: ' + runId + '\nFirst failed gate: engine-transfer-pending\nENGINE_FAILURE_REASON: result retained for recovery (' + reason + ')');
    }
    throw e;
  } finally {
    release();
  }
}
if (require.main === module) main().catch(e => {
  // Requests the worker rejects before any run (e.g. an adapter not allowed for the target) never reach the result
  // path above; give them the same sanitized reason so the job record is not left as 'unknown'.
  if (!reasonPrinted) { const failure = classifyEngineError(e); console.log('First failed gate: ' + failure.gate + '\nENGINE_FAILURE_REASON: ' + failure.reason); }
  console.error('Local engine generation failed: ' + e.message); process.exitCode = 1;
});
module.exports = { parse, publishAfterAcknowledgment, classifyEngineError, createJobImageStore, createJobPublication };
