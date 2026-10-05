'use strict';

// F13: Unified Recipes Store
// Versioned schema `dexdiffusion.recipe.v1`.
// Default behavior: saves parameters/settings, NOT private prompt text.
// Prompt text is saved ONLY if explicitly enabled with user confirmation.
// Provides CRUD and migration import from legacy localStorage styles.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SCHEMA_VERSION = 'dexdiffusion.recipe.v1';

const ALLOWED_CATEGORIES = new Set(['generation', 'edit', 'enhance', 'voice', 'music']);

function createRecipeStore(filePath) {
  let recipes = new Map(); // id -> recipe

  function load() {
    if (!filePath) return;
    try {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && parsed.version === SCHEMA_VERSION && Array.isArray(parsed.recipes)) {
          recipes.clear();
          for (const r of parsed.recipes) {
            if (r && r.id) {
              recipes.set(r.id, r);
            }
          }
        }
      }
    } catch (_) {
      recipes = new Map();
    }
  }

  function save() {
    if (!filePath) return;
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const tmp = `${filePath}.tmp.${Date.now()}`;
      const payload = {
        version: SCHEMA_VERSION,
        updatedAt: Date.now(),
        recipes: Array.from(recipes.values())
      };
      fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
      fs.renameSync(tmp, filePath);
    } catch (err) {
      console.error('Failed to save recipes:', err.message);
    }
  }

  load();

  function list({ category = null, search = '' } = {}) {
    let items = Array.from(recipes.values());
    if (category && ALLOWED_CATEGORIES.has(category)) {
      items = items.filter(r => r.category === category);
    }
    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      items = items.filter(r => {
        return (r.name && r.name.toLowerCase().includes(q)) ||
               (r.description && r.description.toLowerCase().includes(q)) ||
               (r.target && r.target.toLowerCase().includes(q)) ||
               (r.tags && r.tags.some(t => t.toLowerCase().includes(q)));
      });
    }
    return items.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  function get(id) {
    return recipes.get(id) || null;
  }

  function create({
    name,
    description = '',
    category = 'generation',
    target = null,
    worker = null,
    parameters = {},
    tags = [],
    includePrompt = false,
    prompt = null
  }) {
    if (!name || typeof name !== 'string' || !name.trim()) {
      throw new Error('Recipe name is required');
    }
    const cat = ALLOWED_CATEGORIES.has(category) ? category : 'generation';
    const id = 'rcp_' + (crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Date.now().toString(36));
    const now = Date.now();

    // Clean parameters to ensure no hidden private fields unless includePrompt is true
    const cleanParams = { ...parameters };
    delete cleanParams.prompt;
    delete cleanParams.negative_prompt;

    const recipe = {
      schemaVersion: SCHEMA_VERSION,
      id,
      name: name.trim(),
      description: String(description || '').trim(),
      category: cat,
      target: target ? String(target) : null,
      worker: worker ? String(worker) : null,
      parameters: cleanParams,
      tags: Array.isArray(tags) ? tags.map(String) : [],
      promptSaved: Boolean(includePrompt && prompt),
      savedPrompt: (includePrompt && prompt) ? String(prompt) : null,
      createdAt: now,
      updatedAt: now
    };

    recipes.set(id, recipe);
    save();
    return recipe;
  }

  function update(id, patch = {}) {
    const r = recipes.get(id);
    if (!r) return null;
    if (patch.name !== undefined) {
      if (!patch.name || typeof patch.name !== 'string' || !patch.name.trim()) throw new Error('Name cannot be empty');
      r.name = patch.name.trim();
    }
    if (patch.description !== undefined) r.description = String(patch.description).trim();
    if (patch.category !== undefined && ALLOWED_CATEGORIES.has(patch.category)) r.category = patch.category;
    if (patch.target !== undefined) r.target = patch.target ? String(patch.target) : null;
    if (patch.worker !== undefined) r.worker = patch.worker ? String(patch.worker) : null;
    if (patch.tags !== undefined && Array.isArray(patch.tags)) r.tags = patch.tags.map(String);
    if (patch.parameters !== undefined && patch.parameters && typeof patch.parameters === 'object') {
      const cleanParams = { ...patch.parameters };
      delete cleanParams.prompt;
      delete cleanParams.negative_prompt;
      r.parameters = cleanParams;
    }
    if (patch.includePrompt !== undefined) {
      if (patch.includePrompt && patch.prompt) {
        r.promptSaved = true;
        r.savedPrompt = String(patch.prompt);
      } else {
        r.promptSaved = false;
        r.savedPrompt = null;
      }
    }
    r.updatedAt = Date.now();
    save();
    return r;
  }

  function remove(id) {
    if (recipes.delete(id)) {
      save();
      return true;
    }
    return false;
  }

  function duplicate(id, newName = null) {
    const orig = recipes.get(id);
    if (!orig) return null;
    const name = newName || `${orig.name} (Copy)`;
    return create({
      name,
      description: orig.description,
      category: orig.category,
      target: orig.target,
      worker: orig.worker,
      parameters: orig.parameters,
      tags: [...orig.tags],
      includePrompt: orig.promptSaved,
      prompt: orig.savedPrompt
    });
  }

  function importLegacyStyles(legacyStylesArray = []) {
    let importedCount = 0;
    if (!Array.isArray(legacyStylesArray)) return { importedCount: 0 };
    for (const item of legacyStylesArray) {
      if (item && item.name) {
        create({
          name: item.name,
          description: item.description || 'Imported from browser styles',
          category: 'generation',
          target: item.target || null,
          parameters: item.parameters || item.settings || {},
          tags: ['imported']
        });
        importedCount++;
      }
    }
    return { importedCount };
  }

  return {
    list,
    get,
    create,
    update,
    remove,
    duplicate,
    importLegacyStyles,
    count: () => recipes.size
  };
}

module.exports = {
  createRecipeStore,
  SCHEMA_VERSION,
  ALLOWED_CATEGORIES
};
