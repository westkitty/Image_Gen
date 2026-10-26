#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { request, saveOwner } = require('../local-engine-client');
const { createImageStore } = require('../image-store');
const { adapterId, resolveLoraRuntimePolicy } = require('../lora-runtime-policy');
const { canonicalSampler } = require('../controlled-args');
const workflow = path.resolve(__dirname, '../../sdcpp-workflow');
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
  const allowed = new Set(['target','prompt','negative-prompt','width','height','steps','seed','cfg','sampler','scheduler','save-prompts','lora-id','lora-strength','backend-override','lora-apply-mode','clip-skip','tiling','eta','rng','vae','model-path','api','hires-scale','hires-width','hires-height','hires-steps','hires-denoise','hires-upscaler','batch-count']);
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
  // Fail before announcing a remote run when the worker cannot accept requests.
  // This keeps a missing socket from being mistaken for an orphaned inference.
  const health = await request({op:'health'});
  if ((health.recovery_uncertain || []).length) throw new Error('Big Mac local engine recovery requires process reconciliation');
  const d = new Date(), stamp = d.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const runId = `${stamp}-controlled-${args.target}-${crypto.randomBytes(4).toString('hex')}`;
  const token = crypto.randomBytes(32).toString('hex');
  const seed = args.seed === undefined || Number(args.seed) < 0 ? crypto.randomInt(0, 2147483647) : Number(args.seed);
  const count = Number(args['batch-count'] || 1);
  const req = { ...(count>1?{batch_count:count}:{}), op: 'generate', run_id: runId, token, target: args.target, prompt, negative_prompt: args['negative-prompt'] || '',
    width: Number(args.width || spec.defaultWidth), height: Number(args.height || spec.defaultHeight), steps: params.steps,
    cfg: params.cfg_scale, sampler: params.sampler, scheduler: params.scheduler, seed,
    settings, save_prompts: args['save-prompts'] === 'true', loras: loras.map(l => ({ id: adapterId(l.name), strength: l.weight })) };
  const runsRoot = process.env.DEX_RUNS_DIR ? path.resolve(process.env.DEX_RUNS_DIR) : path.join(workflow, 'runs');
  const runDir = path.join(runsRoot, runId);
  fs.mkdirSync(runDir, { recursive: true, mode: 0o700 });
  if (/^[a-f0-9-]{36}$/i.test(process.env.DEXDIFFUSION_JOB_ID || '')) {
    fs.writeFileSync(path.join(runDir, 'job-owner.json'), JSON.stringify({ schema: 'dexdiffusion.run_owner.v1', job_id: process.env.DEXDIFFUSION_JOB_ID, run_id: runId }), { mode: 0o600, flag: 'wx' });
  }
  saveOwner(runId, token);
  console.log('SDCPP_RUN_ID: ' + runId);
  const owned = (op, extra={}) => request({ op, run_id: runId, token, ...extra });
  let stopping = false;
  const stop = () => { stopping = true; owned('cancel').catch(e => console.error(e.message)); };
  for (const sig of ['SIGTERM','SIGINT','SIGHUP']) process.on(sig, stop);
  let stagingDir;
  try {
    let state = await request(req);
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
      throw new Error(state.error || state.status);
    }
    const store = createImageStore(process.env.DEX_IMAGES_ROOT_OVERRIDE ? { root: process.env.DEX_IMAGES_ROOT_OVERRIDE, runsRoot } : { runsRoot });
    const downloads=[];
    stagingDir=fs.mkdtempSync(path.join(os.tmpdir(),'dex-engine-transfer-'));
    const logicalOutputs=[];
    for (let index=0;index<count;index++) {
      const result = await owned('result',count>1?{index}:{});
      const data = Buffer.from(result.png, 'base64');
      if (crypto.createHash('sha256').update(data).digest('hex') !== result.sha256) throw new Error('Worker image checksum mismatch');
      if (stopping) throw new Error('cancelled before publication');
      const temp = path.join(stagingDir, 'output-'+index+'.png');
      fs.writeFileSync(temp, data, { mode: 0o600, flag: 'wx' });
      const runFile='controlled-'+args.target+(count>1?'-b'+String(index).padStart(2,'0'):'')+'.png';
      downloads.push({src:temp,runDir,runId,runFile,seed:seed+index});
      logicalOutputs.push(path.join(runDir,runFile));
    }
    if (stopping) throw new Error('cancelled before publication');
    // Downloads are already checksum-verified. Finish fallible remote cleanup
    // before committing canonical images; no network await follows publication.
    const entries=await publishAfterAcknowledgment({
      acknowledge: () => owned('ack'),
      publish: () => store.publishFiles(downloads,runDir),
      isStopping: () => stopping,
    });
    const entry=entries[0];
    const manifestPath = path.join(runDir, 'controlled-manifest.json');
    const logicalOutput = logicalOutputs[0];
    const manifest = { schema: 'dexdiffusion.local-engine.v1', run_id: runId, status: 'PASS', controlledTarget: args.target,
      backend: spec.backend || 'sdcpp', controlledOutputImage: logicalOutput, image_id: entry.image_id,
      local_png: logicalOutput, width: req.width, height: req.height, steps: req.steps, seed_label: String(seed),
      sampler:req.sampler,scheduler:req.scheduler,cfg_scale:req.cfg,loras:req.loras,
      prompt: req.save_prompts ? prompt : '[REDACTED]', runtime_controlled_proven: true, worker: state, native_batch_count:count, images:entries };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    for (const output of count>1?logicalOutputs:[]) console.log('CONTROLLED_BATCH_IMAGE: '+output);
    console.log('SDCPP_REMOTE_CLEANUP: OK\nCONTROLLED_TARGET: ' + args.target + '\nCONTROLLED_OUTPUT_IMAGE: ' + logicalOutput + '\nCONTROLLED_MANIFEST: ' + manifestPath);
  } catch (e) {
    try { await owned('cancel'); } catch (_) {}
    throw e;
  } finally {
    if (stagingDir) fs.rmSync(stagingDir,{recursive:true,force:true});
  }
}
if (require.main === module) main().catch(e => {
  // Requests the worker rejects before any run (e.g. an adapter not allowed for the target) never reach the result
  // path above; give them the same sanitized reason so the job record is not left as 'unknown'.
  if (!reasonPrinted) { const failure = classifyEngineError(e); console.log('First failed gate: ' + failure.gate + '\nENGINE_FAILURE_REASON: ' + failure.reason); }
  console.error('Local engine generation failed: ' + e.message); process.exitCode = 1;
});
module.exports = { parse, publishAfterAcknowledgment, classifyEngineError };
