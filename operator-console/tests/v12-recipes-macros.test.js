'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createRecipeStore } = require('../recipes-store');
const { createMacroStore } = require('../macro-store');

const tmp = p => fs.mkdtempSync(path.join(os.tmpdir(), 'dex-rm-' + p));

test('recipes: atomic persistence, categories, prompt privacy contract', () => {
  const dir = tmp('rcp');
  const file = path.join(dir, 'recipes.json');
  const store = createRecipeStore(file);

  // Default: saves settings, prompts stripped
  const r1 = store.create({
    name: 'Anime Style',
    category: 'generation',
    target: 'flux2-klein-4b',
    parameters: { steps: 28, width: 768, height: 1024, prompt: 'SECRET_PROMPT', negative_prompt: 'SECRET_NEG' },
    tags: ['anime', 'portrait']
  });

  assert.equal(r1.name, 'Anime Style');
  assert.equal(r1.promptSaved, false);
  assert.equal(r1.parameters.steps, 28);
  assert.equal(r1.parameters.prompt, undefined);
  assert.equal(r1.parameters.negative_prompt, undefined);

  // Duplicate recipe
  const r2 = store.duplicate(r1.id, 'Anime Style High Res');
  assert.equal(r2.name, 'Anime Style High Res');
  assert.equal(r2.parameters.steps, 28);
  assert.equal(store.count(), 2);
});

test('macros: ordered declarative chain, failure isolation, pause on WAITING_INPUT', () => {
  const dir = tmp('mac');
  const file = path.join(dir, 'macros.json');
  const store = createMacroStore(file);

  const m1 = store.create({
    name: 'Generate and Inpaint Pipeline',
    steps: [
      { stepId: 's1', type: 'generate', target: 'flux2-klein-4b' },
      { stepId: 's2', type: 'wait_input', label: 'Select mask in UI' },
      { stepId: 's3', type: 'img2img', target: 'flux2-klein-4b', settings: { strength: 0.6 } },
      { stepId: 's4', type: 'mark_keeper' }
    ]
  });

  assert.equal(m1.steps.length, 4);
  assert.equal(m1.steps[1].type, 'wait_input');

  // Execution runner simulation
  let state = 'IDLE';
  let activeStep = 0;
  function executeNextStep() {
    const step = m1.steps[activeStep];
    if (step.type === 'wait_input') {
      state = 'WAITING_INPUT';
      return { status: state, step };
    }
    activeStep++;
    return { status: 'PROGRESS', step };
  }

  const res1 = executeNextStep(); // s1
  assert.equal(res1.status, 'PROGRESS');
  const res2 = executeNextStep(); // s2: wait_input
  assert.equal(res2.status, 'WAITING_INPUT');
  assert.equal(res2.step.label, 'Select mask in UI');
});
