'use strict';

// F11: Declarative Workflow Macros Store & Runner
// Versioned schema `dexdiffusion.macro.v1`.
// Declarative steps ONLY: generate, img2img, enhance, upscale, keeper, collection, wait_input.
// NO arbitrary shell strings, NO file paths, NO arbitrary URLs.
// Prompt privacy: prompts requested at execution time or explicitly saved with user confirmation.

const { openResourceLedger } = require('./resource-ledger');
const crypto = require('crypto');

const SCHEMA_VERSION = 'dexdiffusion.macro.v1';

const ALLOWED_STEP_TYPES = new Set([
  'generate',
  'img2img',
  'enhance',
  'upscale',
  'mark_keeper',
  'add_to_collection',
  'wait_input'
]);

function validateMacroDefinition(macro) {
  if (!macro || typeof macro !== 'object') throw new Error('Macro must be an object');
  if (!macro.name || typeof macro.name !== 'string' || !macro.name.trim()) throw new Error('Macro name is required');
  if (!Array.isArray(macro.steps) || macro.steps.length === 0) throw new Error('Macro must contain at least one step');

  for (let i = 0; i < macro.steps.length; i++) {
    const step = macro.steps[i];
    if (!step || typeof step !== 'object') throw new Error(`Step ${i + 1} must be an object`);
    if (!step.type || !ALLOWED_STEP_TYPES.has(step.type)) {
      throw new Error(`Step ${i + 1} type '${step.type}' is invalid. Allowed: ${Array.from(ALLOWED_STEP_TYPES).join(', ')}`);
    }
  }
  return true;
}

function createMacroStore(filePath) {
  const ledger = openResourceLedger(filePath, { schema: SCHEMA_VERSION, key: 'macros', label: 'Macros' });
  let macros = new Map(ledger.items.map(item => [item.id, item]));

  function commit(next) {
    ledger.write(next.values());
    macros = next;
  }
  function save(record) {
    commit(new Map(macros).set(record.id, record));
    return record;
  }

  function list() {
    ledger.assertReadable();
    return Array.from(macros.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  function get(id) {
    ledger.assertReadable();
    return macros.get(id) || null;
  }

  function create({
    name,
    description = '',
    steps = [],
    tags = [],
    savedPrompt = null
  }) {
    const raw = { name, description, steps, tags };
    validateMacroDefinition(raw);

    const id = 'mac_' + (crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Date.now().toString(36));
    const now = Date.now();

    const sanitizedSteps = steps.map((s, idx) => {
      const stepCopy = {
        stepId: s.stepId || `step_${idx + 1}`,
        type: s.type,
        label: s.label || `${s.type} step`,
        target: s.target || null,
        recipeId: s.recipeId || null,
        collectionId: s.collectionId || null,
        settings: s.settings && typeof s.settings === 'object' ? { ...s.settings } : {}
      };
      // Ensure no raw shell execution or forbidden parameters
      delete stepCopy.settings.command;
      delete stepCopy.settings.exec;
      delete stepCopy.settings.script;
      return stepCopy;
    });

    const macro = {
      schemaVersion: SCHEMA_VERSION,
      id,
      name: name.trim(),
      description: String(description || '').trim(),
      steps: sanitizedSteps,
      tags: Array.isArray(tags) ? tags.map(String) : [],
      promptSaved: Boolean(savedPrompt),
      savedPrompt: savedPrompt ? String(savedPrompt) : null,
      createdAt: now,
      updatedAt: now
    };

    return save(macro);
  }

  function update(id, patch = {}) {
    const existing = get(id);
    if (!existing) return null;
    const m = { ...existing };
    if (patch.name !== undefined) {
      if (!patch.name || typeof patch.name !== 'string' || !patch.name.trim()) throw new Error('Name cannot be empty');
      m.name = patch.name.trim();
    }
    if (patch.description !== undefined) m.description = String(patch.description).trim();
    if (patch.tags !== undefined && Array.isArray(patch.tags)) m.tags = patch.tags.map(String);
    if (patch.steps !== undefined && Array.isArray(patch.steps)) {
      validateMacroDefinition({ name: m.name, steps: patch.steps });
      m.steps = patch.steps;
    }
    m.updatedAt = Date.now();
    return save(m);
  }

  function remove(id) {
    if (!get(id)) return false;
    const next = new Map(macros);
    next.delete(id);
    commit(next);
    return true;
  }

  return {
    list,
    get,
    create,
    update,
    remove,
    validate: validateMacroDefinition,
    count: () => macros.size
  };
}

module.exports = {
  createMacroStore,
  validateMacroDefinition,
  SCHEMA_VERSION,
  ALLOWED_STEP_TYPES
};
