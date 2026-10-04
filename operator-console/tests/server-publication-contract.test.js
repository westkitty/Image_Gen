'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const M = require('../media'), J = require('../job-contract');
const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
function load(name, end, context) {
  const start = source.indexOf('function ' + name + '(');
  return vm.runInNewContext(source.slice(start, source.indexOf(end, start)) + '\n' + name, context);
}
test('executed server finalization rejects metadata failure before success reaches consumers', () => {
  const finalize = load('finalizeJobImages', '// ---- Capability truth:', {
    RUNS_DIR:'/owned/runs', path, fs:{existsSync:()=>true}, JOB_IMAGE_FIELDS:[],
    imageStore:{finalizeRun:()=>{throw new Error('owned metadata failure');}},
  });
  const job = {status:'PASS',stderr:''}; finalize(job,'/owned/runs/20261003-120000-owned');
  assert.equal(job.status,'FAIL'); assert.equal(job.firstFailedGate,'canonicalization-failed');
  assert.match(job.stderr,/owned metadata failure/);
});
test('generic server completion requires a fresh canonical receipt and releases lease on rejection', () => {
  const store=M.createJobStore(null); let releases=0;
  const sync=load('syncGenericTerminal','function updateSequentialProgress',{
    jobStore:store, TERMINAL:J.TERMINAL, artifactReceipt:J.artifactReceipt,
    JOB_IMAGE_FIELDS:['controlledOutputImage','hiresBaseImage','hiresFinalImage','upscaledImage'],RUNS_DIR:'/owned/runs',path,
    imageStore:{resolveImage:id=>id==='valid.png'?{path:'/owned/valid.png'}:null,readRunIndex:run=>run.endsWith('20261003-120000-legacy')?[{image_id:'valid.png'}]:[]},
    validateImage:()=>({sha256:'a'.repeat(64)}), arbiter:{release:()=>releases++},
  });
  for (const id of ['missing','empty','valid']) {
    store.create({job_id:id,media_kind:'image',operation:'controlled-generate',worker_id:'mflux'});
    const job={id,status:'PASS',stderr:'',results:id==='empty'?[]:[{imageId:id+'.png'}]}; sync(job);
    assert.equal(store.get(id).status,id==='valid'?'COMPLETE':'FAILED');
    if(id==='valid') assert.equal(store.get(id).artifact_validation.validated,true);
    else assert.equal(job.firstFailedGate,'output-invalid');
    const before=store.get(id).status; job.status='FAIL'; sync(job); assert.equal(store.get(id).status,before);
  }
  assert.equal(releases,6);
  store.create({job_id:'hires',media_kind:'image',operation:'hires-fix',worker_id:'sdcpp'});
  sync({id:'hires',status:'PASS',results:[],hiresFinalImageUrl:'/api/images/valid.png'});
  assert.equal(store.get('hires').status,'COMPLETE','legacy final-output field must receive a validated receipt');
  store.create({job_id:'legacy',media_kind:'image',operation:'cli-generate',worker_id:'sdcpp'});
  sync({id:'legacy',status:'PASS',results:[],runId:'20261003-120000-legacy'});
  assert.equal(store.get('legacy').status,'COMPLETE','legacy run-only output must receive a validated receipt');
  store.create({job_id:'probe',media_kind:'image',operation:'probe',worker_id:'sdcpp',artifact_required:false});
  sync({id:'probe',status:'PASS',results:[]}); assert.equal(store.get('probe').status,'COMPLETE');
});
