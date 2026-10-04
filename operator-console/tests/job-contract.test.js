'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateTransition, artifactReceipt } = require('../job-contract');
const M = require('../media');
test('shared contract rejects terminal reversal, conflicting outcome and unvalidated completion', () => {
  const s = M.createJobStore(null), j = s.create({media_kind:'voice',worker_id:'kokoro',operation:'speech'});
  s.transition(j.job_id,'RUNNING');
  assert.match(s.transition(j.job_id,'COMPLETE',{artifacts:['x']}).error,/validated canonical/);
  assert.equal(j.status,'RUNNING');
  const rec = {artifact_id:'x',sha256:'a'.repeat(64),canonical:true,validated:true};
  assert.throws(() => artifactReceipt([{artifact_id:'x',sha256:'a'.repeat(64)}]), /validated canonical records/);
  assert.equal(s.transition(j.job_id,'COMPLETE',{artifacts:['x'],artifact_validation:artifactReceipt([rec])}).status,'COMPLETE');
  assert.match(s.transition(j.job_id,'FAILED').error,/illegal/);
  assert.match(s.transition(j.job_id,'COMPLETE',{artifacts:['different']}).error,/validated|immutable/);
  assert.equal(j.stage_id,'completed');
  assert.match(s.transition(j.job_id,'COMPLETE',{resource_lease:'fake'}).error,/resource lease/);
});
test('unknown percentage allowed; invented percentages rejected; measured counts accepted', () => {
  const j = {status:'RUNNING'};
  assert.match(validateTransition(j,'RUNNING',{progress:{percent:50}}),/measured/);
  assert.match(validateTransition(j,'RUNNING',{progress:{percent:60,sampling:{done:1,total:2}}}),/measured/);
  assert.equal(validateTransition(j,'RUNNING',{progress:{percent:null}}),null);
  assert.equal(validateTransition(j,'RUNNING',{progress:{percent:50,sampling:{done:1,total:2}}}),null);
});
test('explicit non-artifact operation permits completion but cannot smuggle unvalidated output', () => {
  assert.equal(validateTransition({status:'RUNNING',artifact_required:false,artifacts:[]},'COMPLETE'),null);
  assert.match(validateTransition({status:'RUNNING',artifact_required:false},'COMPLETE',{artifacts:['x']}),/validated/);
});
