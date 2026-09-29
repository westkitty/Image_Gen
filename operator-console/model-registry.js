'use strict';

/**
 * Model Registry: structured model cards, capabilities, preview provenance,
 * search/filter logic, dynamic target coverage, and compatibility checks.
 */

class ModelSwitchWarning {
  constructor({ code, message, severity = 'warning', resource_id = null }) {
    this.code = code;
    this.message = message;
    this.severity = severity;
    this.resource_id = resource_id;
  }
  toString() {
    return this.message;
  }
  includes(str) {
    return this.message.includes(str);
  }
  toJSON() {
    return {
      code: this.code,
      message: this.message,
      severity: this.severity,
      resource_id: this.resource_id
    };
  }
}

const KNOWN_CURATED_CARDS = [
  {
    id: 'flux2-klein-4b',
    display_name: 'FLUX.2 Klein 4B',
    family: 'flux2',
    backend: 'mflux',
    status: 'PROVEN',
    primary: true,
    preview_image: '/api/images/20260929-015539-controlled-flux2-klein-4b-s555862368-controlled-flux2-klein-4b.png',
    preview_provenance: 'exact-model',
    description: '4B distilled FLUX.2 model running natively on Apple Silicon via MFLUX.',
    why_use: 'Flagship fast generation with state-of-the-art prompt following and photoreal skin texture.',
    best_for: [
      'High-fidelity photorealism & skin micro-details',
      'Complex descriptive natural language prompts',
      'Fast 4-step generation on Big Mac Apple Silicon'
    ],
    specialties: ['Photoreal', 'Portraits', '4-Step Fast'],
    avoid_for: [
      'Negative prompt reliant workflows (guidance 1.0 does not use negative prompts)',
      'Parallel batching (sequential only on MFLUX)'
    ],
    native_resolution: '1024x1024',
    default_steps: 4,
    default_cfg: 1.0,
    speed_class: 'Fast (4 steps, ~35s)',
    supports_negative_prompt: false,
    supports_lora: false,
    supports_embeddings: false,
    prompt_profile: 'image.flux2',
    caveat: 'Distilled FLUX.2 uses guidance 1.0 and does not accept negative prompts.'
  },
  {
    id: 'flux-fp8',
    display_name: 'Flux.1 Schnell (fp8)',
    family: 'flux1',
    backend: 'sdcpp',
    status: 'PROVEN',
    primary: false,
    preview_image: null,
    preview_provenance: 'placeholder',
    description: 'Quantized 8-bit FLUX.1 Schnell model executed via stable-diffusion.cpp.',
    why_use: 'Fast 4-step generation through the SDCPP backend with high compositional complexity.',
    best_for: [
      'Concept art and intricate compositional staging',
      'Rapid 4-step iterations via SDCPP'
    ],
    specialties: ['Concept Art', 'Fast 4-Step', 'Composition'],
    avoid_for: [
      'Low-VRAM workloads',
      'Negative prompt shaping'
    ],
    native_resolution: '512x512',
    default_steps: 4,
    default_cfg: 3.5,
    speed_class: 'Fast (4 steps)',
    supports_negative_prompt: false,
    supports_lora: false,
    supports_embeddings: false,
    prompt_profile: 'image.flux1',
    caveat: 'Uses the fp8 runtime-proven Flux file with stable-diffusion.cpp.'
  },
  {
    id: 'sdxl-turbo',
    display_name: 'SDXL Turbo 1.0',
    family: 'sdxl_turbo',
    backend: 'sdcpp',
    status: 'PROVEN',
    primary: false,
    preview_image: '/api/images/20260926-194802-controlled-sdxl-turbo-s42-controlled-sdxl-turbo.png',
    preview_provenance: 'exact-model',
    description: 'Adversarial diffusion distillation model producing images in 1 to 4 steps.',
    why_use: 'Ultra-fast prompt experimentation, quick drafting, and near-instant thumbnailing.',
    best_for: [
      'Near-instant feedback and prompt brainstorming',
      'Low step counts (1-4 steps)',
      'Real-time seed exploration'
    ],
    specialties: ['Ultra-Fast', '1-4 Steps', 'Drafting'],
    avoid_for: [
      'Complex multi-character interactions',
      'High-detail micro textures requiring standard SDXL'
    ],
    native_resolution: '512x512',
    default_steps: 4,
    default_cfg: 1.0,
    speed_class: 'Ultra-Fast (< 5s)',
    supports_negative_prompt: false,
    supports_lora: true,
    supports_embeddings: false,
    prompt_profile: 'image.sdxl_turbo',
    caveat: 'Requires low steps (1-4) and CFG 1.0. Negative prompt ignored by Turbo pipeline.'
  },
  {
    id: 'sd15',
    display_name: 'Stable Diffusion 1.5',
    family: 'sd15',
    backend: 'sdcpp',
    status: 'PROVEN',
    primary: false,
    preview_image: '/api/images/20260707-182449-controlled-sd15-controlled-sd15.png',
    preview_provenance: 'exact-model',
    description: 'The foundation SD 1.5 model with the widest ecosystem of fine-tunes and LoRAs.',
    why_use: 'Proven baseline for native inpainting, outpainting, and legacy LoRA compatibility.',
    best_for: [
      'Inpainting and Outpainting repair canvas workhorse',
      'Extensive SD 1.5 LoRA and styling asset ecosystem',
      'Native batching up to 16 images'
    ],
    specialties: ['Inpaint/Outpaint', 'LoRA Depth', 'Ecosystem'],
    avoid_for: [
      'High-resolution output without High-Res Refine / Hires Fix (causes duplicate limbs)',
      'Complex multi-clause prompt adherence'
    ],
    native_resolution: '512x512',
    default_steps: 20,
    default_cfg: 7.0,
    speed_class: 'Standard (~10-15s)',
    supports_negative_prompt: true,
    supports_lora: true,
    supports_embeddings: true,
    prompt_profile: 'image.sd15',
    caveat: 'Native 512x512 resolution; use High-Res Refine for larger renders.'
  },
  {
    id: 'sdxl-base',
    display_name: 'SDXL Base 1.0',
    family: 'sdxl',
    backend: 'sdcpp',
    status: 'PROVEN',
    primary: false,
    preview_image: '/api/images/20260926-194845-controlled-sdxl-base-s42-controlled-sdxl-base.png',
    preview_provenance: 'exact-model',
    description: 'Official Stability AI SDXL base foundation model on Metal.',
    why_use: 'Standard 1024x1024 native generation with broad prompt comprehension.',
    best_for: [
      'Broad general-purpose SDXL generations',
      'Foundational SDXL LoRA compatibility',
      'Native 1024x1024 compositions'
    ],
    specialties: ['Foundation', '1024x1024 Native', 'General Purpose'],
    avoid_for: [
      'Fine-grained stylized anime without specialized LoRAs',
      'Rapid draft iterations (<15 steps)'
    ],
    native_resolution: '1024x1024',
    default_steps: 20,
    default_cfg: 7.0,
    speed_class: 'Standard (~25-35s)',
    supports_negative_prompt: true,
    supports_lora: true,
    supports_embeddings: false,
    prompt_profile: 'image.sdxl',
    caveat: 'Stability AI SDXL 1.0 base model; native 1024x1024.'
  },
  {
    id: 'sdxl-photonic',
    display_name: 'Photonic Fusion SDXL',
    family: 'sdxl',
    backend: 'sdcpp',
    status: 'PROVEN',
    primary: false,
    preview_image: '/api/images/20260928-174616-controlled-sdxl-photonic-s1391613307-controlled-sdxl-photonic.png',
    preview_provenance: 'exact-model',
    description: 'Pony-merged SDXL 1.0 checkpoint on wc2tb with custom embedded VAE.',
    why_use: 'Rich cinematic lighting, vibrant tones, and strong aesthetic adherence.',
    best_for: [
      'Dramatic cinematic lighting and vibrant palettes',
      'Pony score tag comprehension',
      'Vertical portrait dimensions (768x1024)'
    ],
    specialties: ['Cinematic', 'Vibrant', 'Pony Merge'],
    avoid_for: [
      'Ultra-fast generation (needs 30-40 steps)',
      'Strict photorealism without negative guidance'
    ],
    native_resolution: '768x1024',
    default_steps: 30,
    default_cfg: 6.0,
    speed_class: 'Standard (~25-35s)',
    supports_negative_prompt: true,
    supports_lora: true,
    supports_embeddings: false,
    prompt_profile: 'image.sdxl',
    caveat: 'Pony merge checkpoint on wc2tb; uses checkpoint embedded VAE.'
  },
  {
    id: 'sdxl-homochi',
    display_name: 'Homochi XL v2',
    family: 'sdxl',
    backend: 'sdcpp',
    status: 'STAGED',
    primary: false,
    preview_image: null,
    preview_provenance: 'placeholder',
    description: 'Migrated wc2tb SDXL checkpoint tuned for stylized and illustrative male characters.',
    why_use: 'Stylized character illustration and distinctive male figurative aesthetics.',
    best_for: [
      'Stylized male character illustration',
      'Expressive anime-adjacent male aesthetics',
      '1024x1024 compositions'
    ],
    specialties: ['Stylized', 'Male Figures', 'Illustration'],
    avoid_for: [
      'Strict unassisted raw photorealism',
      'Complex landscape architectures'
    ],
    native_resolution: '1024x1024',
    default_steps: 10,
    default_cfg: 6.5,
    speed_class: 'Standard (~15-25s)',
    supports_negative_prompt: true,
    supports_lora: true,
    supports_embeddings: false,
    prompt_profile: 'image.sdxl',
    caveat: 'Migrated wc2tb SDXL checkpoint; staged/selectable without individual smoke proof.'
  },
  {
    id: 'sdxl-pony',
    display_name: 'Pony Diffusion V6 XL',
    family: 'pony',
    backend: 'sdcpp',
    status: 'STAGED',
    primary: false,
    preview_image: null,
    preview_provenance: 'placeholder',
    description: 'Specialized stylized checkpoint trained extensively on Danbooru tag taxonomy.',
    why_use: 'Dynamic poses, stylized anime/character aesthetics, and specialized character LoRAs.',
    best_for: [
      'Stylized illustration and character art',
      'Danbooru tag-based prompt syntax',
      'Dynamic action poses and expressive anatomy'
    ],
    specialties: ['Anime/Stylized', 'Tag Adherence', 'Dynamic Poses'],
    avoid_for: [
      'Standard conversational prompts without score tags',
      'Unassisted natural photorealism'
    ],
    native_resolution: '1024x1024',
    default_steps: 25,
    default_cfg: 6.5,
    speed_class: 'Standard',
    supports_negative_prompt: true,
    supports_lora: true,
    supports_embeddings: false,
    prompt_profile: 'image.pony',
    caveat: 'Requires score tags (e.g. score_9, score_8_up) for intended quality.'
  },
  {
    id: 'sd15-homofidelis',
    display_name: 'HomoFidelis v5',
    family: 'sd15',
    backend: 'sdcpp',
    status: 'PROVEN',
    primary: false,
    preview_image: '/api/images/20260707-194819-controlled-sd15-homofidelis-controlled-sd15-homofidelis.png',
    preview_provenance: 'exact-model',
    description: 'SD 1.5 fine-tune tuned for male portraits and physique art.',
    why_use: 'Consistent male anatomy adherence in SD 1.5 pipelines.',
    best_for: [
      'Male portraiture and physique art on SD 1.5',
      'Broad SD 1.5 LoRA pairing'
    ],
    specialties: ['Male Anatomy', 'Portraits', 'SD1.5'],
    avoid_for: [
      'Complex multi-subject landscape compositions'
    ],
    native_resolution: '512x512',
    default_steps: 20,
    default_cfg: 7.0,
    speed_class: 'Standard (~10-15s)',
    supports_negative_prompt: true,
    supports_lora: true,
    supports_embeddings: true,
    prompt_profile: 'image.sd15',
    caveat: 'SD 1.5 checkpoint staged on wc2tb.'
  },
  {
    id: 'sdxl-juggernaut',
    display_name: 'Juggernaut XL Ragnarok',
    family: 'sdxl',
    backend: 'sdcpp',
    status: 'STAGED',
    primary: false,
    preview_image: null,
    preview_provenance: 'placeholder',
    description: 'Flagship photorealism SDXL checkpoint praised for athletic male anatomy and versatile lighting.',
    why_use: 'High-realism male anatomy, natural skin textures, and cinematic depth.',
    best_for: [
      'Athletic and muscular male portraiture',
      'Cinematic environmental lighting',
      'Vertical 832x1216 compositions'
    ],
    specialties: ['Photoreal', 'Athletic Anatomy', 'Cinematic'],
    avoid_for: [
      'Stylized 2D cartoons or flat vector art'
    ],
    native_resolution: '832x1216',
    default_steps: 35,
    default_cfg: 4.0,
    speed_class: 'Standard (~30-40s)',
    supports_negative_prompt: true,
    supports_lora: true,
    supports_embeddings: false,
    prompt_profile: 'image.sdxl',
    caveat: 'SDXL Checkpoint (~6.5GB). Excellent photorealism with strong male anatomy.'
  },
  {
    id: 'sdxl-realvisxl',
    display_name: 'RealVisXL V5.0',
    family: 'sdxl',
    backend: 'sdcpp',
    status: 'STAGED',
    primary: false,
    preview_image: null,
    preview_provenance: 'placeholder',
    description: 'Photoreal SDXL checkpoint with natural skin texture and authentic lighting.',
    why_use: 'Top photoreal benchmark for realistic human portraits and natural lighting.',
    best_for: [
      'Photoreal portraits and authentic skin tones',
      'Intimate scenes with realistic depth of field'
    ],
    specialties: ['Photoreal', 'Skin Texture', 'Portraits'],
    avoid_for: [
      'Cartoons, anime, or heavily stylized art'
    ],
    native_resolution: '1024x1024',
    default_steps: 30,
    default_cfg: 4.0,
    speed_class: 'Standard',
    supports_negative_prompt: true,
    supports_lora: true,
    supports_embeddings: false,
    prompt_profile: 'image.sdxl',
    caveat: 'SDXL photoreal checkpoint on wc2tb.'
  },
  {
    id: 'sdxl-cyberrealistic',
    display_name: 'CyberRealistic XL v10',
    family: 'sdxl',
    backend: 'sdcpp',
    status: 'STAGED',
    primary: false,
    preview_image: null,
    preview_provenance: 'placeholder',
    description: 'Photoreal checkpoint tuned for realistic male skin textures and defined musculature.',
    why_use: 'Sharp facial features, natural skin pores, and defined athletic forms.',
    best_for: [
      'Close-up male portraits with micro-contrast',
      'Realistic body hair and authentic musculature',
      'High-detail studio lighting'
    ],
    specialties: ['Micro Textures', 'Male Forms', 'Studio Realism'],
    avoid_for: [
      'Surreal or fantasy illustrative styles'
    ],
    native_resolution: '832x1216',
    default_steps: 30,
    default_cfg: 4.0,
    speed_class: 'Standard (~30-40s)',
    supports_negative_prompt: true,
    supports_lora: true,
    supports_embeddings: false,
    prompt_profile: 'image.sdxl',
    caveat: 'SDXL Checkpoint. Strong photoreal skin textures and musculature.'
  },
  {
    id: 'sdxl-epicrealism',
    display_name: 'epiCRealism XL Pure Fix',
    family: 'sdxl',
    backend: 'sdcpp',
    status: 'STAGED',
    primary: false,
    preview_image: null,
    preview_provenance: 'placeholder',
    description: 'Balanced photorealism benchmark with strong anatomy and texture adherence.',
    why_use: 'Reliable anatomy rendering and realistic skin micro-details.',
    best_for: [
      'Realistic male and female figures with accurate anatomy',
      'Natural lighting and environmental realism'
    ],
    specialties: ['Anatomy', 'Photoreal', 'Skin Texture'],
    avoid_for: [
      'Abstract or highly stylized anime'
    ],
    native_resolution: '832x1216',
    default_steps: 30,
    default_cfg: 5.0,
    speed_class: 'Standard (~30-40s)',
    supports_negative_prompt: true,
    supports_lora: true,
    supports_embeddings: false,
    prompt_profile: 'image.sdxl',
    caveat: 'Top photoreal benchmark on wc2tb.'
  },
  {
    id: 'sdxl-biglust',
    display_name: 'Big Lust v1.6',
    family: 'sdxl',
    backend: 'sdcpp',
    status: 'STAGED',
    primary: false,
    preview_image: null,
    preview_provenance: 'placeholder',
    description: 'Photoreal merge of bigASP and LUSTIFY with strong anatomical adherence.',
    why_use: 'Consistent masculine anatomy and adult figurative art.',
    best_for: [
      'Masculine physique and figurative rendering',
      'Consistent adult composition adherence'
    ],
    specialties: ['Figurative', 'Male Anatomy', 'Adult Composition'],
    avoid_for: [
      'General commercial product photography'
    ],
    native_resolution: '1024x1024',
    default_steps: 30,
    default_cfg: 5.0,
    speed_class: 'Standard (~30-40s)',
    supports_negative_prompt: true,
    supports_lora: true,
    supports_embeddings: false,
    prompt_profile: 'image.sdxl',
    caveat: 'SDXL Checkpoint. Photoreal NSFW-focused merge of bigASP and LUSTIFY.'
  },
  {
    id: 'sdxl-lustify',
    display_name: 'LUSTIFY! v8 Apex',
    family: 'sdxl',
    backend: 'sdcpp',
    status: 'STAGED',
    primary: false,
    preview_image: null,
    preview_provenance: 'placeholder',
    description: 'Core photoreal merge known for skin details and expressive figurative scenes.',
    why_use: 'Natural body rendering, expressive intimacy, and realistic skin tone fidelity.',
    best_for: [
      'Intimate figurative scenes and body portraits',
      'Natural skin warmth and specular highlights'
    ],
    specialties: ['Body Portraits', 'Skin Highlights', 'Adult Realism'],
    avoid_for: [
      'Stylized flat illustration'
    ],
    native_resolution: '832x1216',
    default_steps: 30,
    default_cfg: 5.0,
    speed_class: 'Standard (~30-40s)',
    supports_negative_prompt: true,
    supports_lora: true,
    supports_embeddings: false,
    prompt_profile: 'image.sdxl',
    caveat: 'SDXL Checkpoint. Photoreal merge with excellent male anatomy and skin details.'
  },
  {
    id: 'sdxl-biglove',
    display_name: 'Big Love Photo',
    family: 'sdxl',
    backend: 'sdcpp',
    status: 'STAGED',
    primary: false,
    preview_image: null,
    preview_provenance: 'placeholder',
    description: 'Photoreal male-leaning Lustify hybrid checkpoint on wc2tb.',
    why_use: 'Warm realistic lighting with focus on handsome male features and natural physique.',
    best_for: [
      'Male portraiture and couple interactions',
      'Warm atmospheric ambient light'
    ],
    specialties: ['Male Portraits', 'Atmospheric', 'Natural Physique'],
    avoid_for: [
      'High-speed drafting'
    ],
    native_resolution: '1024x1024',
    default_steps: 10,
    default_cfg: 6.5,
    speed_class: 'Standard (~20-30s)',
    supports_negative_prompt: true,
    supports_lora: true,
    supports_embeddings: false,
    prompt_profile: 'image.sdxl',
    caveat: 'SDXL Checkpoint. Photoreal male-leaning Lustify hybrid.'
  }
];

const CURATED_BY_ID = new Map(KNOWN_CURATED_CARDS.map(c => [c.id, c]));

/**
 * Creates an honest, family-level fallback model card for any auto-discovered
 * or dynamically added target.
 */
function createFallbackCard(target) {
  const id = target.id || 'unknown';
  const label = target.label || id.replace(/[-_]/g, ' ');

  let family = 'generic';
  if (id.startsWith('sdxl-') || (target.modelPath && target.modelPath.includes('/sdxl/'))) family = 'sdxl';
  else if (id.startsWith('sd15-') || id === 'sd15' || (target.modelPath && target.modelPath.includes('/sd15/'))) family = 'sd15';
  else if (id.startsWith('flux2-')) family = 'flux2';
  else if (id.startsWith('flux-')) family = 'flux1';
  else if (id.includes('pony')) family = 'pony';

  const isSDXL = family === 'sdxl';
  const isSD15 = family === 'sd15';
  const isFlux = family === 'flux2' || family === 'flux1';

  const defaultWidth = target.defaultWidth || (isSD15 ? 512 : 1024);
  const defaultHeight = target.defaultHeight || (isSD15 ? 512 : 1024);
  const defaultSteps = target.defaultSteps || (isFlux ? 4 : (isSD15 ? 20 : 30));
  const defaultCfg = target.defaultCfgScale != null ? target.defaultCfgScale : (isFlux ? 1.0 : (isSD15 ? 7.0 : 5.0));

  const status = (target.status || 'discovered').toUpperCase();
  const backend = target.backend || (family === 'flux2' ? 'mflux' : 'sdcpp');

  return {
    id,
    display_name: label,
    family,
    backend,
    status,
    primary: target.primary === true,
    preview_image: null,
    preview_provenance: 'placeholder',
    description: `Auto-discovered ${family.toUpperCase()} model checkpoint staged on Big Mac.`,
    why_use: `Provides additional ${family.toUpperCase()} generation capabilities discovered in the model repository.`,
    best_for: [
      `${family.toUpperCase()} ecosystem compatibility`,
      `Custom fine-tuned weights for specialized aesthetic exploration`
    ],
    specialties: [family.toUpperCase(), 'Discovered Checkpoint'],
    avoid_for: [
      `Unverified edge cases without prior smoke benchmark runs`
    ],
    native_resolution: `${defaultWidth}x${defaultHeight}`,
    default_steps: defaultSteps,
    default_cfg: defaultCfg,
    speed_class: isFlux ? 'Fast (4 steps)' : 'Standard',
    supports_negative_prompt: !target.noNegativePrompt && !isFlux,
    supports_lora: !isFlux,
    supports_embeddings: isSD15,
    prompt_profile: target.prompt_profile || `image.${family}`,
    caveat: target.caveat || `Auto-discovered ${family.toUpperCase()} checkpoint. Experimental; no dedicated proof benchmark recorded.`
  };
}

/**
 * Resolves all model cards by combining known curated cards with any live capability targets.
 * Ensures: selectable capability target IDs MINUS model-card IDs = empty set!
 */
function resolveAllModelCards(availableTargets = null) {
  if (!availableTargets || !Array.isArray(availableTargets) || availableTargets.length === 0) {
    return [...KNOWN_CURATED_CARDS];
  }

  const cards = [];
  const coveredIds = new Set();

  for (const target of availableTargets) {
    const curated = CURATED_BY_ID.get(target.id);
    if (curated) {
      // Overlay live runtime status if available
      cards.push({
        ...curated,
        status: (target.status || curated.status).toUpperCase(),
        primary: target.primary === true || curated.primary === true,
        backend: target.backend || curated.backend
      });
    } else {
      cards.push(createFallbackCard(target));
    }
    coveredIds.add(target.id);
  }

  // Include any remaining curated cards that were not in availableTargets (for fallback/offline usage)
  for (const card of KNOWN_CURATED_CARDS) {
    if (!coveredIds.has(card.id)) {
      cards.push(card);
    }
  }

  return cards;
}

/**
 * Returns all model cards, dynamically resolved and optionally filtered.
 */
function getModelCards(options = {}, availableTargets = null) {
  const allCards = resolveAllModelCards(availableTargets);
  const { search, family, status } = options;

  return allCards.filter(card => {
    if (family && family !== 'all' && card.family !== family) return false;
    if (status && status !== 'all' && card.status.toLowerCase() !== status.toLowerCase()) return false;
    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      const match = card.display_name.toLowerCase().includes(q) ||
                    card.id.toLowerCase().includes(q) ||
                    card.specialties.some(s => s.toLowerCase().includes(q)) ||
                    card.best_for.some(b => b.toLowerCase().includes(q));
      if (!match) return false;
    }
    return true;
  });
}

/**
 * Returns a specific model card by ID.
 */
function getModelCardById(id, availableTargets = null) {
  if (!id) return null;
  const allCards = resolveAllModelCards(availableTargets);
  return allCards.find(c => c.id === id) || null;
}

/**
 * Checks for structured warnings when switching from one model to another.
 * Emits schema:
 * {
 *   code: string,
 *   message: string,
 *   severity: 'warning' | 'error',
 *   resource_id: string | null
 * }
 */
function checkModelSwitchWarnings(fromModelId, toModelId, activeResources = {}, availableTargets = null) {
  const toCard = getModelCardById(toModelId, availableTargets);
  const warnings = [];

  if (!toCard) return warnings;

  // Active negative prompt warning
  if (activeResources.negativePrompt && !toCard.supports_negative_prompt) {
    warnings.push(new ModelSwitchWarning({
      code: 'NEGATIVE_PROMPT_UNSUPPORTED',
      message: `Selected model ${toCard.display_name} does not support negative prompts; negative prompt will be ignored.`,
      severity: 'warning',
      resource_id: 'negativePrompt'
    }));
  }

  // Active LoRAs compatibility
  if (Array.isArray(activeResources.loras) && activeResources.loras.length > 0) {
    if (!toCard.supports_lora) {
      warnings.push(new ModelSwitchWarning({
        code: 'LORA_UNSUPPORTED',
        message: `Selected model ${toCard.display_name} does not currently support LoRAs in this backend.`,
        severity: 'warning',
        resource_id: 'loras'
      }));
    } else {
      activeResources.loras.forEach(l => {
        const loraName = typeof l === 'string' ? l : (l && l.name);
        const loraFamily = typeof l === 'object' && l ? l.family : null;

        if (loraFamily) {
          const isPonyCross = (loraFamily === 'pony' && toCard.family === 'sdxl') ||
                              (loraFamily === 'sdxl' && toCard.family === 'pony');
          if (loraFamily !== toCard.family && !isPonyCross) {
            warnings.push(new ModelSwitchWarning({
              code: 'LORA_FAMILY_MISMATCH',
              message: `Active LoRA "${loraName}" (${loraFamily}) may be incompatible with ${toCard.display_name} (${toCard.family}).`,
              severity: 'warning',
              resource_id: loraName
            }));
          }
        }
      });
    }
  }

  return warnings;
}

module.exports = {
  ModelSwitchWarning,
  MODEL_CARDS: KNOWN_CURATED_CARDS,
  KNOWN_CURATED_CARDS,
  createFallbackCard,
  resolveAllModelCards,
  getModelCards,
  getModelCardById,
  checkModelSwitchWarnings
};
