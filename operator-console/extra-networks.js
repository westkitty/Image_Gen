'use strict';

/**
 * Extra Networks resource management (LoRA, Embeddings/Textual Inversion, VAE).
 * Provides structured state, model-family compatibility evaluation, and prompt serialization.
 */

// Model families used across DexDiffusion
const FAMILIES = {
  FLUX2: 'flux2',
  FLUX1: 'flux1',
  SDXL_TURBO: 'sdxl_turbo',
  SDXL: 'sdxl',
  PONY: 'pony',
  SD15: 'sd15',
  LTX: 'ltx2_video',
  UNKNOWN: 'unknown'
};

/**
 * Infer the asset family from filename or metadata.
 */
function inferAssetFamily(filename) {
  const f = String(filename || '').toLowerCase();
  if (f.includes('flux2') || f.includes('flux_2')) return FAMILIES.FLUX2;
  if (f.includes('flux1') || f.includes('flux_1') || f.includes('schnell') || f.includes('dev')) return FAMILIES.FLUX1;
  if (f.includes('sd15') || f.includes('sd_1_5') || f.includes('sdv1-5') || f.includes('homofidelis')) return FAMILIES.SD15;
  if (f.includes('pony')) return FAMILIES.PONY;
  if (f.includes('turbo') || f.includes('lightning') || f.includes('hyper')) {
    if (f.includes('sd15')) return FAMILIES.SD15;
    if (f.includes('sdxl')) return FAMILIES.SDXL;
    return FAMILIES.SDXL_TURBO;
  }
  if (f.includes('sdxl') || f.includes('camoosexl') || f.includes('photonic') || f.includes('realvis') || f.includes('epicrealism') || f.includes('juggernaut')) return FAMILIES.SDXL;
  if (f.includes('ltx')) return FAMILIES.LTX;
  return FAMILIES.UNKNOWN;
}

/**
 * Normalizes a target model ID to a canonical family.
 */
function resolveTargetFamily(targetId) {
  const t = String(targetId || '').toLowerCase();
  if (t.includes('flux2') || t.includes('klein')) return FAMILIES.FLUX2;
  if (t.includes('flux') || t.includes('schnell')) return FAMILIES.FLUX1;
  if (t.includes('turbo')) return FAMILIES.SDXL_TURBO;
  if (t.includes('pony')) return FAMILIES.PONY;
  if (t.includes('sd15') || t.includes('homofidelis')) return FAMILIES.SD15;
  if (t.includes('sdxl')) return FAMILIES.SDXL;
  if (t.includes('ltx')) return FAMILIES.LTX;
  return FAMILIES.UNKNOWN;
}

/**
 * Evaluates compatibility between an asset family and a target model family.
 * Returns: 'Compatible' | 'Probably compatible' | 'Unknown' | 'Incompatible' | 'Unproven'
 */
function evaluateCompatibility(assetFamily, targetFamily, assetType = 'lora') {
  if (assetFamily === FAMILIES.LTX) {
    return targetFamily === FAMILIES.LTX ? 'Compatible' : 'Incompatible';
  }
  if (targetFamily === FAMILIES.LTX) {
    return assetFamily === FAMILIES.LTX ? 'Compatible' : 'Incompatible';
  }

  // MFLUX FLUX.2 LoRA is currently unproven in local tests
  if (targetFamily === FAMILIES.FLUX2 && assetType === 'lora') {
    return 'Unproven';
  }

  // Exact family match
  if (assetFamily === targetFamily && assetFamily !== FAMILIES.UNKNOWN) {
    return 'Compatible';
  }

  // Pony / SDXL cross-compatibility
  if ((assetFamily === FAMILIES.PONY && targetFamily === FAMILIES.SDXL) ||
      (assetFamily === FAMILIES.SDXL && targetFamily === FAMILIES.PONY)) {
    return 'Probably compatible';
  }

  // SDXL Turbo / SDXL
  if ((assetFamily === FAMILIES.SDXL_TURBO && targetFamily === FAMILIES.SDXL) ||
      (assetFamily === FAMILIES.SDXL && targetFamily === FAMILIES.SDXL_TURBO)) {
    return 'Probably compatible';
  }

  if (assetFamily === FAMILIES.UNKNOWN || targetFamily === FAMILIES.UNKNOWN) {
    return 'Unknown';
  }

  return 'Incompatible';
}

/**
 * Builds structured LoRA cards from discovered assets.
 */
function buildLoraCards(discoveredLoras = [], currentTargetId = 'flux2-klein-4b') {
  const targetFamily = resolveTargetFamily(currentTargetId);

  return discoveredLoras.map(lora => {
    const filename = lora.filename || '';
    const baseName = filename.replace(/\.(safetensors|ckpt|pt|bin)$/i, '');
    const family = inferAssetFamily(filename);
    const compatibility = evaluateCompatibility(family, targetFamily, 'lora');

    // Known trigger words and notes
    let triggerWords = [];
    let isSpeedAdapter = false;
    if (filename.includes('sdxl_lightning')) {
      triggerWords = [];
      isSpeedAdapter = true;
    } else if (filename.includes('Hyper-SD')) {
      triggerWords = [];
      isSpeedAdapter = true;
    } else if (filename.includes('lcm')) {
      triggerWords = [];
      isSpeedAdapter = true;
    } else if (filename.includes('EmberPony')) {
      triggerWords = ['ember', 'warm light', 'glowing'];
    } else if (filename.includes('CAMoose')) {
      triggerWords = ['camoose style'];
    }

    return {
      id: lora.id || baseName,
      name: baseName,
      filename,
      size_bytes: lora.size_bytes || 0,
      family,
      compatibility,
      trigger_words: triggerWords,
      is_speed_adapter: isSpeedAdapter,
      default_weight: 1.0,
      min_weight: 0.0,
      max_weight: 2.0,
      step: 0.05,
      status: lora.status || 'available',
      provenance: lora.full_path ? 'local-wc2tb' : 'staged'
    };
  });
}

/**
 * Builds structured VAE cards from discovered assets.
 */
function buildVaeCards(discoveredVaes = [], currentTargetId = 'flux2-klein-4b') {
  const targetFamily = resolveTargetFamily(currentTargetId);

  return discoveredVaes.map(vae => {
    const filename = vae.filename || '';
    const baseName = filename.replace(/\.(safetensors|ckpt|pt|bin)$/i, '');
    const family = inferAssetFamily(filename);
    const compatibility = evaluateCompatibility(family, targetFamily, 'vae');

    return {
      id: vae.id || baseName,
      name: baseName,
      filename,
      size_bytes: vae.size_bytes || 0,
      family,
      compatibility,
      status: vae.status || 'available',
      provenance: vae.full_path ? 'local-wc2tb' : 'staged'
    };
  });
}

/**
 * Returns structured representation of Textual Inversion embeddings.
 * Enforces honest empty state when no embeddings exist.
 */
function buildEmbeddingState(discoveredEmbeddings = [], currentTargetId = 'flux2-klein-4b') {
  const targetFamily = resolveTargetFamily(currentTargetId);
  const items = Array.isArray(discoveredEmbeddings) ? discoveredEmbeddings : [];

  return {
    count: items.length,
    empty_state_message: items.length === 0 ? 'No Textual Inversion embeddings discovered' : null,
    items: items.map(emb => {
      const filename = emb.filename || '';
      const baseName = filename.replace(/\.(safetensors|ckpt|pt|bin)$/i, '');
      const family = inferAssetFamily(filename);
      return {
        id: emb.id || baseName,
        name: baseName,
        filename,
        family,
        compatibility: evaluateCompatibility(family, targetFamily, 'embedding')
      };
    })
  };
}

/**
 * Serializes active LoRAs into prompt tokens: `<lora:filename:weight>`.
 */
function serializeActiveLoras(activeLoras = []) {
  if (!Array.isArray(activeLoras) || activeLoras.length === 0) return '';
  return activeLoras
    .filter(l => l && l.filename && Number(l.weight) > 0)
    .map(l => `<lora:${l.filename.replace(/\.(safetensors|ckpt|pt|bin)$/i, '')}:${Number(l.weight).toFixed(2)}>`)
    .join(' ');
}

/**
 * Extracts active LoRA specifications from a prompt.
 */
function parseLorasFromPrompt(prompt) {
  if (typeof prompt !== 'string') return [];
  const regex = /<lora:([^:>]+):([^>]+)>/g;
  const loras = [];
  let match;
  while ((match = regex.exec(prompt)) !== null) {
    const weightNum = parseFloat(match[2]);
    loras.push({
      name: match[1].trim(),
      weight: Number.isFinite(weightNum) ? weightNum : 1.0
    });
  }
  return loras;
}

module.exports = {
  FAMILIES,
  inferAssetFamily,
  resolveTargetFamily,
  evaluateCompatibility,
  buildLoraCards,
  buildVaeCards,
  buildEmbeddingState,
  serializeActiveLoras,
  parseLorasFromPrompt
};
