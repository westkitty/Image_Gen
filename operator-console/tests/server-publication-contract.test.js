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
    imageStore:{resolveImage:id=>id==='valid.png'?{path:'/owned/valid.png'}:null,readRunIndex:run=>run.endsWith('20261003-120000-legacy')?[{image_id:'valid.png'}]:[],acknowledgePublication:()=>({acknowledged:0,unresolved:[]})},
    validateImage:()=>({sha256:'a'.repeat(64)}), arbiter:{release:()=>releases++},
    holdsLease: load('holdsLease','function syncGenericTerminal',{Date,remoteWorkers:{isQuarantined:id=>id==='quarantined'}}),
    remoteWorkers:{finished:()=>{}}, syncRemoteRunIds:()=>{},
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
  // A cancelled job whose Big Mac process is not yet confirmed stopped keeps the heavy lease. OP-7: age is not evidence.
  const before=releases;
  store.create({job_id:'held',media_kind:'image',operation:'controlled-generate',worker_id:'mflux'});
  sync({id:'held',status:'CANCELLED',results:[],remoteOrphan:{pending:true,at:Date.now()}});
  assert.equal(releases,before,'lease is held while the remote stop is unconfirmed');
  store.create({job_id:'stale',media_kind:'image',operation:'controlled-generate',worker_id:'mflux'});
  sync({id:'stale',status:'CANCELLED',results:[],remoteOrphan:{pending:true,at:Date.now()-24*3600e3}});
  assert.equal(releases,before,'an old unverified hold is NOT dropped: elapsed time never proves a remote stop');
  store.create({job_id:'quarantined',media_kind:'image',operation:'xyz-plot',worker_id:'sdcpp'});
  sync({id:'quarantined',status:'CANCELLED',results:[]});
  assert.equal(releases,before,'a quarantined worker record keeps the lease even without an in-memory hold (restart)');
  store.create({job_id:'probe',media_kind:'image',operation:'probe',worker_id:'sdcpp',artifact_required:false});
  sync({id:'probe',status:'PASS',results:[]}); assert.equal(store.get('probe').status,'COMPLETE');
});

test('a canonical output committed before terminal cancellation is retained with an API artifact receipt', () => {
  const store=M.createJobStore(null);
  const sync=load('syncGenericTerminal','function updateSequentialProgress',{
    jobStore:store, TERMINAL:J.TERMINAL, artifactReceipt:J.artifactReceipt,
    JOB_IMAGE_FIELDS:['controlledOutputImage','hiresBaseImage','hiresFinalImage','upscaledImage'],
    RUNS_DIR:'/owned/runs',path,
    imageStore:{resolveImage:id=>id==='published.png'?{path:'/owned/published.png'}:null,readRunIndex:()=>[],acknowledgePublication:()=>({acknowledged:0,unresolved:[]})},
    validateImage:()=>({sha256:'b'.repeat(64)}), arbiter:{release:()=>{}},
    holdsLease:()=>false, remoteWorkers:{finished:()=>{}}, syncRemoteRunIds:()=>{},
    eventBus:{publish:()=>{}}, timingStore:null, libraryIndex:null, imageMeta:{get:()=>null},
  });
  store.create({job_id:'cancel-after-commit',media_kind:'image',operation:'controlled-generate',worker_id:'sdcpp'});
  const job={id:'cancel-after-commit',status:'CANCELLED',results:[{imageId:'published.png'}],stderr:''};
  sync(job);
  const durable=store.get(job.id);
  assert.equal(durable.status,'CANCELLED');
  assert.deepEqual(Array.from(durable.artifacts),['published.png']);
  assert.equal(durable.artifact_validation.validated,true);
  assert.equal(durable.artifact_validation.artifacts[0].sha256,'b'.repeat(64));
});

test('late-cancel API projection resolves a controlled run path to its exact owned canonical artifact', () => {
  const resolve = load('canonicalControlledOutput','function syncGenericTerminal', {
    RUNS_DIR:'/owned/runs', path,
    fs:{readFileSync:(file)=>{
      assert.equal(file,'/owned/runs/20261017-072630-controlled-sd15/job-owner.json');
      return JSON.stringify({job_id:'job-1',run_id:'20261017-072630-controlled-sd15'});
    }},
    imageStore:{
      readRunIndex:()=>[{job_id:'job-1',run_id:'20261017-072630-controlled-sd15',run_file:'controlled-sd15.png',image_id:'canonical.png',sha256:'c'.repeat(64)}],
      resolveImage:id=>id==='canonical.png'?{path:'/owned/images/canonical.png'}:null,
    },
    validateImage:()=>({sha256:'c'.repeat(64),dimensions:[512,512]}),
  });
  const record=resolve({id:'job-1',runId:'20261017-072630-controlled-sd15',controlledOutputImage:'/owned/runs/20261017-072630-controlled-sd15/controlled-sd15.png'});
  assert.equal(record.entry.image_id,'canonical.png');
  assert.equal(record.image.path,'/owned/images/canonical.png');
  assert.equal(resolve({id:'other',runId:'20261017-072630-controlled-sd15',controlledOutputImage:'/owned/runs/20261017-072630-controlled-sd15/controlled-sd15.png'}),null);
  assert.equal(resolve({id:'job-1',runId:'20261017-072630-controlled-sd15',controlledOutputImage:'/tmp/foreign.png'}),null);
});
