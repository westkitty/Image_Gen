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

const CURATED_LORA_PROVENANCE = Object.freeze({
  'sdxl_lightning_4step_lora.safetensors': {
    source_url: 'https://huggingface.co/ByteDance/SDXL-Lightning',
    source_model_id: 'ByteDance/SDXL-Lightning', classification: 'acceleration', family: FAMILIES.SDXL,
    description: 'SDXL Lightning 4-step acceleration adapter. Metal compatibility is not yet proven.'
  },
  'hyper-sdxl-8steps-cfg-lora.safetensors': {
    source_url: 'https://huggingface.co/ByteDance/Hyper-SD',
    source_model_id: 'ByteDance/Hyper-SD', classification: 'acceleration', family: FAMILIES.SDXL,
    description: 'Hyper-SDXL 8-step CFG-preserved acceleration adapter. Metal compatibility is not yet proven.'
  },
  'lcm_sdxl.safetensors': {
    source_url: 'https://huggingface.co/latent-consistency/lcm-lora-sdxl',
    source_model_id: 'latent-consistency/lcm-lora-sdxl', classification: 'acceleration', family: FAMILIES.SDXL,
    description: 'Latent Consistency Model SDXL acceleration adapter. Compatibility is not yet proven.'
  },
  'pixelart_lora.safetensors': {
    source_url: 'https://huggingface.co/adirik/pixel-art-lora-flux.2-klein-4B',
    source_model_id: 'adirik/pixel-art-lora-flux.2-klein-4B', classification: 'style', family: FAMILIES.FLUX2,
    trigger_words: ['PXART4'], license: 'Apache-2.0', rs_lora: true,
    description: 'STYLE adapter for FLUX.2 Klein. MFLUX applies verified rsLoRA-equivalent scaling; no acceleration claim.'
  },
  'lcm_sd15.safetensors': {
    source_url: 'https://huggingface.co/latent-consistency/lcm-lora-sdv1-5',
    source_model_id: 'latent-consistency/lcm-lora-sdv1-5', classification: 'acceleration', family: FAMILIES.SD15,
    description: 'Latent Consistency Model SD 1.5 acceleration adapter. Current device compatibility is not yet proven.'
  },
  'hyper-sd15-8steps-cfg-lora.safetensors': {
    source_url: 'https://huggingface.co/ByteDance/Hyper-SD',
    source_model_id: 'ByteDance/Hyper-SD', classification: 'acceleration', family: FAMILIES.SD15,
    description: 'Hyper-SD 1.5 8-step CFG-preserved acceleration adapter. Metal compatibility is not yet proven.'
  }
});

/**
 * Infer the asset family from filename or metadata.
 */
function inferAssetFamily(filename) {
  const f = String(filename || '').toLowerCase();
  if (f.includes('flux2') || f.includes('flux_2')) return FAMILIES.FLUX2;
  if (f.includes('flux1') || f.includes('flux_1') || f.includes('schnell') || /(^|[^a-z])dev([^a-z]|$)/.test(f)) return FAMILIES.FLUX1;  // 'dev' as a word: not 'developer'/'devil'
  if (f.includes('sd15') || f.includes('sd_1_5') || f.includes('sdv1-5') || f.includes('homofidelis')) return FAMILIES.SD15;
  if (f.includes('pony')) return FAMILIES.PONY;
  if (f.includes('turbo') || f.includes('lightning') || f.includes('hyper')) {
    if (f.includes('sd15')) return FAMILIES.SD15;
    if (f.includes('sdxl')) return FAMILIES.SDXL;
    return FAMILIES.SDXL_TURBO;
  }
  if (f.includes('sdxl') || f.includes('sd_xl') || f.includes('camoosexl') || f.includes('photonic') || f.includes('realvis') || f.includes('epicrealism') || f.includes('juggernaut')) return FAMILIES.SDXL;
  if (f.includes('ltx')) return FAMILIES.LTX;
  return FAMILIES.UNKNOWN;
}

/**
 * Normalizes a target model ID to a canonical family.
 */
function resolveTargetFamily(targetId) {
  const t = String(targetId || '').toLowerCase();
  // Auto-discovered checkpoints are named `<architecture>-auto-<filename>`: the architecture prefix comes from the
  // directory the file was found in and must win over words that merely appear in the filename.
  const auto = /^(sdxl|sd15)-auto-/.exec(t);
  if (auto && auto[1] === 'sd15') return FAMILIES.SD15;
  if (auto && auto[1] === 'sdxl') return t.includes('turbo') ? FAMILIES.SDXL_TURBO : t.includes('pony') ? FAMILIES.PONY : FAMILIES.SDXL;
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
    // Family agreement narrows candidates, but does not prove that this adapter
    // loads or produces valid output with the selected backend and checkpoint.
    return assetType === 'lora' ? 'Unproven' : 'Compatible';
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
    const curated = CURATED_LORA_PROVENANCE[filename.toLowerCase()] || null;
    const baseName = filename.replace(/\.(safetensors|ckpt|pt|bin)$/i, '');
    const family = curated?.family || lora.header_family || inferAssetFamily(filename);
    let compatibility = evaluateCompatibility(family, targetFamily, 'lora');
    const proofTargetIds = Array.isArray(lora.proof_target_ids) ? lora.proof_target_ids : [];
    const proofStatus = lora.proof_status || (lora.full_path ? 'FILE_INSTALLED_UNTESTED' : 'NOT_INSTALLED');
    if (proofStatus === 'PROVEN' && proofTargetIds.includes(currentTargetId)) compatibility = 'Compatible';
    const productionRoutes = Array.isArray(lora.production_routes) ? lora.production_routes : [];
    // A same-family acceleration route from the runtime policy makes the adapter
    // usable on this checkpoint, but it is not proven here: keep that visible.
    const familyRoute = curated && curated.classification === 'acceleration' && !proofTargetIds.includes(currentTargetId)
      ? productionRoutes.find(r => r && r.target === currentTargetId && r.family_only === true && r.verified === false) || null
      : null;
    if (familyRoute) compatibility = 'Compatible';

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
    } else if (curated?.trigger_words) {
      triggerWords = curated.trigger_words;
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
      trigger_words: lora.header_triggers && lora.header_triggers.length ? lora.header_triggers : triggerWords,
      family_source: lora.header_family ? 'header' : 'filename',
      trigger_source: lora.header_triggers && lora.header_triggers.length ? 'dataset tag frequency (kohya metadata) — candidates, not guaranteed trigger words' : 'built-in notes',
      is_speed_adapter: isSpeedAdapter || curated?.classification === 'acceleration',
      family_only: !!familyRoute,
      target_proof: familyRoute ? 'Unproven on this checkpoint' : (proofStatus === 'PROVEN' && proofTargetIds.includes(currentTargetId) ? 'PROVEN' : null),
      default_weight: 1.0,
      min_weight: baseName === 'pixelart_lora' ? 0.25 : 0.0,
      max_weight: baseName === 'pixelart_lora' ? 1.5 : 2.0,
      step: 0.05,
      status: lora.status || 'available',
      provenance: lora.full_path ? 'local-wc2tb' : 'staged',
      description: (proofStatus === 'PROVEN'
        ? `${curated?.description || ''} CPU inference verified on ${proofTargetIds.join(', ')}${(lora.metal_target_ids || []).length ? `; Metal at_runtime verified on ${(lora.metal_target_ids || []).join(', ')}` : '; Metal remains unverified'}.`
        : curated?.description || '') + (familyRoute ? ` Unproven on this checkpoint (${currentTargetId}): family-compatible route with the verified recipe; no inference receipt yet.` : ''),
      classification: curated?.classification || 'unknown',
      source_url: curated?.source_url || null,
      source_model_id: curated?.source_model_id || null,
      source_status: curated ? 'verified' : 'unavailable',
      license: curated?.license || null,
      rs_lora: curated?.rs_lora === true,
      mflux_rslora_verified: lora.mflux_rslora_verified === true,
      proof_status: proofStatus,
      proof_target_ids: proofTargetIds,
      proof_backend: lora.proof_backend || null,
      proof_device: lora.proof_device || null,
      proof_apply_modes: Array.isArray(lora.proof_apply_modes) ? lora.proof_apply_modes : [],
      proof_run_ids: Array.isArray(lora.proof_run_ids) ? lora.proof_run_ids : [],
      metal_inference_status: lora.metal_inference_status || 'UNTESTED',
      metal_target_ids: Array.isArray(lora.metal_target_ids) ? lora.metal_target_ids : [],
      metal_backend: lora.metal_backend || null,
      metal_apply_mode: lora.metal_apply_mode || null,
      metal_performance_status: lora.metal_performance_status || 'UNMEASURED',
      metal_performance_summary: lora.metal_performance_summary || null,
      production_routes: productionRoutes
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
    const family = vae.header_family || inferAssetFamily(filename);
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
      const family = emb.header_family || inferAssetFamily(filename);
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
