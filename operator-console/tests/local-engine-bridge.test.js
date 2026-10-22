'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { parse, publishAfterAcknowledgment } = require('../bin/local-engine-generate');
const { ownerPath } = require('../local-engine-client');
const { enabled } = require('../local-engine-routing');
const { targetRuntime } = require('../capabilities');

test('worker validates closed requests and owns cancellation/recovery', () => {
  const result = spawnSync('python3', ['-m','unittest','discover','-s',path.resolve(__dirname,'../../sdcpp-workflow/worker'),'-p','test_*.py','-v'], { encoding:'utf8',timeout:30000 });
  assert.equal(result.status,0,result.stderr + result.stdout);
  assert.match(result.stderr,/Ran \d+ tests/);
});
test('transport ownership forbids traversal and malformed identifiers', () => {
  assert.throws(() => ownerPath('../bad'));
  assert.match(ownerPath('20261021-150000-controlled-sd15'), /20261021-150000-controlled-sd15\.json$/);
});
test('generator parses sampling controls and rejects arbitrary command arguments', () => {
  assert.deepEqual(parse(['--target','sd15','--tiling','--eta','1.5']),{target:'sd15',tiling:true,eta:'1.5'});
  assert.throws(() => parse(['--command','rm']));
  assert.throws(() => parse(['--target','sd15','--target','sdxl-base']));
});
test('isolated fixture servers do not enable the live bridge implicitly', () => {
  assert.equal(enabled({ DEX_STATE_DIR:'/tmp/isolated' }),false);
  assert.equal(enabled({ DEX_LOCAL_ENGINE_BRIDGE:'0' }),false);
});
test('model availability follows worker reads and reports unavailable worker', () => {
  assert.equal(targetRuntime({id:'sd15'}, {localEngineEnabled:true,localEngineModels:{sd15:true}}, {}),'available');
  assert.equal(targetRuntime({id:'sd15'}, {localEngineEnabled:true,localEngineModels:{sd15:false}}, {}),'model-inaccessible');
  assert.equal(targetRuntime({id:'sd15'}, {localEngineEnabled:true}, {}),'worker-unavailable');
});
test('install registry preserves six adapters and original paths', () => {
  const result=spawnSync(process.execPath,[path.resolve(__dirname,'../../sdcpp-workflow/worker/build-registry.js')],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const registry=JSON.parse(result.stdout);
  assert.equal(Object.keys(registry.adapters).length,6);
  for (const scheduler of ['discrete','karras','exponential','ays','sgm_uniform','simple','kl_optimal','lcm']) {
    assert.ok(registry.schedulers.includes(scheduler), 'worker accepts the existing controlled scheduler ' + scheduler);
  }
  assert.equal(registry.adapters.sdxl_lightning_4step_lora.production.backend_override,'MTL0');
  assert.equal(registry.adapters.sdxl_lightning_4step_lora.production.lora_apply_mode,'at_runtime');
  assert.equal(registry.models['sdxl-base'].path,'/Volumes/wc2tb/ImageGen/checkpoints/sdxl/sd_xl_base_1.0.safetensors');
});
test('worker native batch uses the existing all-output transaction and rolls back partial publication', () => {
  const fs=require('node:fs'),os=require('node:os'),crypto=require('node:crypto');
  const {createImageStore}=require('../image-store');
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGMU0QhgYGBgYgADAAZ+AJD85S7OAAAAAElFTkSuQmCC','base64');
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'dex-engine-publication-'));
  try {
    const run=path.join(tmp,'20261021-150000-controlled-sd15');fs.mkdirSync(run);
    const job=crypto.randomUUID();fs.writeFileSync(path.join(run,'job-owner.json'),JSON.stringify({schema:'dexdiffusion.run_owner.v1',job_id:job,run_id:path.basename(run)}));
    const files=[0,1].map(index=>{const src=path.join(run,'.incoming-'+index+'.png');fs.writeFileSync(src,png);return {src,runId:path.basename(run),runFile:'controlled-sd15-b0'+index+'.png',seed:42+index};});
    let count=0;
    const store=createImageStore({root:path.join(tmp,'images'),runsRoot:tmp,fault:point=>{if(point==='after-publication' && ++count===1)throw new Error('injected mid-batch failure');}});
    assert.throws(()=>store.publishFiles(files,run),/injected mid-batch failure/);
    assert.equal(store.listCanonicalImages().length,0);
    assert.equal(store.readRunIndex(run).length,0);
    assert.ok(files.every(f=>fs.existsSync(f.src)));
  } finally {fs.rmSync(tmp,{recursive:true,force:true});}
});

test('lost cleanup acknowledgment and cancellation cannot commit canonical images', async () => {
  const fs=require('node:fs'),os=require('node:os');
  const {createImageStore}=require('../image-store');
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'dex-ack-'));
  try {
    const run=path.join(tmp,'20261022-040000-controlled-sd15');fs.mkdirSync(run);
    const src=path.join(tmp,'incoming.png');
    fs.writeFileSync(src,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGMU0QhgYGBgYgADAAZ+AJD85S7OAAAAAElFTkSuQmCC','base64'));
    const store=createImageStore({root:path.join(tmp,'images'),runsRoot:tmp});
    const publish=()=>store.publishFiles([{src,runId:path.basename(run),runFile:'output.png',seed:42}],run);
    for (const acknowledge of [async()=>{throw new Error('ack reply lost');},async()=>({acknowledged:true,cleanup:false})]) {
      await assert.rejects(publishAfterAcknowledgment({acknowledge,publish,isStopping:()=>false}));
      assert.equal(store.listCanonicalImages().length,0);
      assert.ok(fs.existsSync(src),'verified staging remains available before caller cleanup');
    }
    await assert.rejects(publishAfterAcknowledgment({acknowledge:async()=>({acknowledged:true,cleanup:true}),publish,isStopping:()=>true}),/cancelled before publication/);
    assert.equal(store.listCanonicalImages().length,0);
    const result=await publishAfterAcknowledgment({acknowledge:async()=>({acknowledged:true,cleanup:true}),publish,isStopping:()=>false});
    assert.equal(result.length,1);assert.equal(store.listCanonicalImages().length,1);
  } finally {fs.rmSync(tmp,{recursive:true,force:true});}
});

test('benchmark reads owned structured Metal and tensor evidence without a legacy raw log', async () => {
  const {extractMetrics,assertBenchmarkBackend}=await import('../../sdcpp-workflow/bin/sdcpp-lora-benchmark.mjs');
  assert.throws(()=>assertBenchmarkBackend('cpu',true),/no inference was started/);
  assert.doesNotThrow(()=>assertBenchmarkBackend('MTL0',true));
  assert.doesNotThrow(()=>assertBenchmarkBackend('cpu',false));
  const runId='20261022-040000-controlled-sd15';
  const worker={run_id:runId,status:'complete',evidence:['Initializing backend: MTL0','lora_apply_mode: at_runtime','(834 / 834) LoRA tensors have been applied','generate_image completed in 10.45s']};
  const stdout='ENGINE_RESULT: '+JSON.stringify(worker)+'\nSDCPP_REMOTE_CLEANUP: OK';
  const metrics=extractMetrics('',{runId},stdout);
  assert.equal(metrics.backend,'MTL0');assert.deepEqual(metrics.adapterTensorsApplied,['834/834']);
  assert.equal(metrics.engineGenerationSeconds,10.45);assert.equal(metrics.remoteCleanup,'verified');
  assert.equal(extractMetrics('',{runId:'other-run'},stdout).backend,'UNKNOWN','another run cannot supply proof');
});
