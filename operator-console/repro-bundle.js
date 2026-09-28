'use strict';

// F12: Reproducibility Bundles
// Schema `dexdiffusion.repro.v1`
// Export and import reproducible settings bundles.
// JSON format, portable references, privacy safe.
// Import restores settings; DOES NOT auto-execute.

const SCHEMA_VERSION = 'dexdiffusion.repro.v1';

function exportReproBundle({
  appVersion = 'dexdiffusion-v12',
  operation = 'generate',
  worker = 'sdcpp',
  target = null,
  seed = null,
  dimensions = { width: 512, height: 512 },
  steps = 20,
  guidance = 7,
  sampler = 'euler_a',
  scheduler = 'karras',
  strength = null,
  enhancement = null,
  lineage = null,
  recipeRef = null,
  macroRef = null,
  artifactId = null,
  savedPrompt = null,
  includePrompt = false
} = {}) {
  const bundle = {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: Date.now(),
    appVersion,
    operation: String(operation || 'generate'),
    worker: String(worker || 'default'),
    target: target ? String(target) : null,
    settings: {
      seed: seed != null ? Number(seed) : null,
      width: dimensions && dimensions.width ? Number(dimensions.width) : 512,
      height: dimensions && dimensions.height ? Number(dimensions.height) : 512,
      steps: steps != null ? Number(steps) : 20,
      guidance: guidance != null ? Number(guidance) : 7,
      sampler: sampler ? String(sampler) : 'euler_a',
      scheduler: scheduler ? String(scheduler) : 'karras',
      strength: strength != null ? Number(strength) : null
    },
    enhancement: enhancement ? { ...enhancement } : null,
    lineage: lineage ? {
      parentId: lineage.parentId || null,
      operation: lineage.operation || null
    } : null,
    recipeRef: recipeRef || null,
    macroRef: macroRef || null,
    artifactId: artifactId ? String(artifactId) : null,
    promptIncluded: Boolean(includePrompt && savedPrompt),
    promptText: (includePrompt && savedPrompt) ? String(savedPrompt) : null
  };

  return bundle;
}

function validateReproBundle(bundle) {
  if (!bundle || typeof bundle !== 'object') {
    return { valid: false, error: 'Bundle must be a JSON object' };
  }
  if (bundle.schemaVersion !== SCHEMA_VERSION) {
    return { valid: false, error: `Unsupported schema version: ${bundle.schemaVersion} (expected ${SCHEMA_VERSION})` };
  }
  if (!bundle.operation) {
    return { valid: false, error: 'Bundle missing operation field' };
  }
  if (!bundle.settings || typeof bundle.settings !== 'object') {
    return { valid: false, error: 'Bundle missing valid settings object' };
  }
  return { valid: true };
}

function checkBundleCompatibility(bundle, availableTargets = []) {
  const issues = [];
  const targetId = bundle.target;
  if (targetId && availableTargets.length > 0) {
    const found = availableTargets.find(t => t.id === targetId);
    if (!found) {
      issues.push(`Target model '${targetId}' is not installed or available in this runtime.`);
    } else if (found.status === 'unavailable' || found.status === 'broken') {
      issues.push(`Target model '${targetId}' is currently ${found.status}.`);
    }
  }
  return {
    compatible: issues.length === 0,
    issues
  };
}

module.exports = {
  exportReproBundle,
  validateReproBundle,
  checkBundleCompatibility,
  SCHEMA_VERSION
};
