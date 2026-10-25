'use strict';
// Execute the production queue callback without importing server startup or invoking inference.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const EC = require('../public/dexdiffusion/edit-core');
const { resolveLoraRuntimePolicy } = require('../lora-runtime-policy');
const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
function load(name, next, context) {
  const start = source.indexOf('function ' + name + '(');
  return vm.runInNewContext(source.slice(start, source.indexOf(next, start)) + '\n' + name, context);
}
const validateStructuredLoras = load('validateStructuredLoras', '// Edit routes:', {});
const spec = { id: 'sd15', backend: 'sdcpp', label: 'fixture SD1.5', defaultWidth: 512, defaultHeight: 512, defaultSteps: 4, minSteps: 1, maxSteps: 150, defaultCfgScale: 1.5 };
const validate = load('validateControlledGenerationParams', 'function buildGenerateArgs', {
  validateStructuredLoras, validateControlledTarget: target => target === 'sd15', validatePrompt: () => true,
  validatePromptLoras: () => ({ok:true}), validateNegativePrompt: () => true, validateSeed: () => true,
  validateScheduler: () => true, validateVae: () => true, validateSavePrompts: () => true,
  validateSamplingFields: () => null, PromptParity: {validateForTarget: () => null},
  validateDimensions: () => null, validateIntRange: () => true, validateHiresFields: () => null,
  W: {isFixedSeedValue: () => false}, resolveLoraRuntimePolicy, CONTROLLED_TARGETS: [spec],
});
function params(loras) {
  return {target:'sd15', prompt:'a lake', negative_prompt:'', steps:4, cfg_scale:1.5, sampler:'lcm', scheduler:'lcm', operation:'batch', loras};
}

test('shared generation validation rejects malformed structured LoRAs before queue/plot dispatch', () => {
  for (const loras of [[null], {}, 'lcm_sd15', [{name:'lcm_sd15',weight:'bad'}], [{name:'lcm_sd15',weight:3}]]) {
    let result;
    assert.doesNotThrow(() => {result = validate(params(loras), {sd15:spec});}, 'malformed adapter input must be a validation error');
    assert.equal(typeof result, 'string', 'queue/plot request rejects malformed adapters');
    assert.match(result, /LoRA|loras/);
  }
  assert.equal(validate(params([{name:'lcm_sd15',weight:1}]), {sd15:spec}), null);
});

function queueHarness() {
  let dispatched = null;
  const start = source.indexOf('const queueRunner = W.createQueueRunner(');
  const end = source.indexOf('// ---- X/Y/Z plot', start);
  const config = vm.runInNewContext(source.slice(start, end) + '\nqueueRunner', {
    W: {createQueueRunner: config => config}, path, STATE_DIR: '/unused-fixture-state',
    normalizeControlledGenerationBody: body => body, expandWildcards: text => text,
    allControlledTargets: () => ({sd15:spec, 'flux2-klein-4b':{id:'flux2-klein-4b',backend:'mflux'}}),
    validateStructuredLoras, EC, validateControlledGenerationParams: p => validateStructuredLoras(p.loras),
    startControlledJob: (p, targets, opts) => {
      dispatched = p;
      queueMicrotask(() => opts.onDone({status:'PASS',results:[],seeds:[]}));
      return {jobId:'fixture'};
    }, jobs: {fixture:{seeds:[]}},
  });
  return {run: (body, prompt = 'a lake') => config.runItem({number:'1'}, prompt, {body}, {id:'fixture'}), dispatched: () => dispatched};
}

test('SDCPP queued generations serialize the effective structured adapter into the backend prompt', async () => {
  const h = queueHarness();
  await h.run(params([{name:'lcm_sd15',weight:0.75}]));
  assert.equal(h.dispatched().prompt, 'a lake <lora:lcm_sd15:0.75>');
  assert.deepEqual(JSON.parse(JSON.stringify(h.dispatched().loras)), [{name:'lcm_sd15',weight:0.75}]);
});

test('queued MFLUX adapters stay structured and never acquire SDCPP prompt tags', async () => {
  const h = queueHarness();
  await h.run({target:'flux2-klein-4b',loras:[{name:'pixelart_lora',weight:0.8}]});
  assert.equal(h.dispatched().prompt, 'a lake');
  assert.equal(h.dispatched().loras[0].name, 'pixelart_lora');
});

test('queued malformed adapters fail without dispatching a job', async () => {
  const h = queueHarness();
  const result = await h.run(params([null]));
  assert.equal(result.ok, false);
  assert.equal(result.gate, 'validation');
  assert.equal(h.dispatched(), null);
});

test('post-merge validation does not re-judge prompt-tag LoRAs (negative tag weights stay valid)', () => {
  const merged = [{name:'lcm_sd15',weight:-0.5}];
  assert.match(validate(params(merged), {sd15:spec}), /LoRA/, 'unchecked client lists still use the 0..2 shape policy');
  assert.equal(validate(params(merged), {sd15:spec}, {loraShapeChecked:true}), null, 'already-checked merged lists are not rejected');
  assert.match(validate(params([null]), {sd15:spec}), /LoRA|loras/, 'malformed lists still fail by default');
});
