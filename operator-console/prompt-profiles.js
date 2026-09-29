'use strict';

// Model-aware prompt profiles for DexDiffusion generative workbench.
// Grounded in verified generator and model capabilities.

const PROFILES = {
  // FLUX.2 Klein 4B via MFLUX
  'image.flux2': {
    id: 'image.flux2',
    modality: 'image',
    family: 'flux2',
    generator: 'mflux',
    label: 'FLUX.2 Klein (MFLUX)',
    style: 'descriptive_prose',
    order: ['subject_action', 'environment', 'medium_style', 'lighting', 'composition_camera', 'physical_details'],
    targetVerbosity: 'medium_high',
    negativePromptSupported: false,
    loraSupported: false, // MFLUX FLUX.2 LoRA is unproven in this bridge
    embeddingsSupported: false,
    recommendedSettings: { width: 1024, height: 1024, steps: 4, guidance: 1.0 },
    guidance: 'Use natural descriptive prose. Prioritize subject action, concrete environment, medium, lighting, and camera angle. Avoid Stable Diffusion tag soup like "masterpiece, best quality, 8k". Never generate negative prompts as the distilled model does not accept them.',
    evidence: 'PROVEN in DexDiffusion primary slot',
  },

  // FLUX.1 via SDCPP
  'image.flux1': {
    id: 'image.flux1',
    modality: 'image',
    family: 'flux1',
    generator: 'sdcpp',
    label: 'FLUX.1 (SDCPP)',
    style: 'descriptive_prose',
    order: ['subject_action', 'environment', 'style', 'lighting', 'camera'],
    targetVerbosity: 'medium_high',
    negativePromptSupported: false,
    loraSupported: false,
    embeddingsSupported: false,
    recommendedSettings: { width: 1024, height: 1024, steps: 4, cfg_scale: 1.0 },
    guidance: 'Use FLUX descriptive natural language. Focus on physical context, composition, framing, and illumination. Avoid comma-separated quality tag spam.',
    evidence: 'PROVEN in SDCPP secondary suite',
  },

  // SDXL Turbo
  'image.sdxl_turbo': {
    id: 'image.sdxl_turbo',
    modality: 'image',
    family: 'sdxl_turbo',
    generator: 'sdcpp',
    label: 'SDXL Turbo (SDCPP)',
    style: 'concise_direct',
    order: ['subject', 'action', 'setting', 'key_details', 'style'],
    targetVerbosity: 'concise',
    negativePromptSupported: false,
    loraSupported: true,
    embeddingsSupported: false,
    recommendedSettings: { width: 768, height: 768, steps: 4, cfg_scale: 1.5, sampler: 'euler' },
    guidance: 'Keep prompt concise, explicit, and direct. SDXL Turbo is a distilled 1-4 step model. Long winding essays degrade output coherence. Avoid negative prompts.',
    evidence: 'PROVEN in SDCPP secondary suite',
  },

  // Pony-family SDXL
  'image.pony': {
    id: 'image.pony',
    modality: 'image',
    family: 'pony_sdxl',
    generator: 'sdcpp',
    label: 'Pony Diffusion V6 XL',
    style: 'tagged_scored',
    order: ['score_tags', 'rating_tag', 'source_tag', 'subject', 'features', 'clothing', 'pose', 'environment', 'style'],
    targetVerbosity: 'medium',
    negativePromptSupported: true,
    loraSupported: true,
    embeddingsSupported: false,
    recommendedSettings: { width: 1024, height: 1024, steps: 25, cfg_scale: 7.0, sampler: 'euler_a' },
    defaultScoreTags: 'score_9, score_8_up, score_7_up',
    defaultNegative: 'score_6, score_5, score_4, source_furry, source_cartoon, source_anime, censored, bad anatomy, deformed',
    guidance: 'Pony models rely on score tags (score_9, score_8_up, score_7_up), source tags (source_pony, source_anime), and rating tags (rating_safe, rating_explicit). Preserve existing score/source/rating tokens. Never replace them with generic quality sludge like "8k masterpiece best quality". Do not alter rating without explicit user request.',
    evidence: 'Staged on Big Mac (pony_diffusion_v6_xl.safetensors)',
  },

  // Generic SDXL & custom photoreal checkpoints
  'image.sdxl': {
    id: 'image.sdxl',
    modality: 'image',
    family: 'sdxl',
    generator: 'sdcpp',
    label: 'SDXL Base / Photonic / RealVis / Juggernaut',
    style: 'balanced_structured',
    order: ['subject', 'physical_attributes', 'action_pose', 'setting', 'visual_style', 'lighting', 'framing'],
    targetVerbosity: 'medium',
    negativePromptSupported: true,
    loraSupported: true,
    embeddingsSupported: false,
    recommendedSettings: { width: 1024, height: 1024, steps: 25, cfg_scale: 7.0, sampler: 'dpmpp2m' },
    defaultNegative: 'blurry, low quality, distorted, extra limbs, bad eyes, poorly drawn face',
    guidance: 'Structured balanced prompt: clear subject, physical details, action, setting, lighting, and camera framing. Supports targeted negative prompts and LoRA syntax.',
    evidence: 'PROVEN in SDCPP secondary suite (Photonic Fusion, SDXL Base)',
  },

  // SD1.5
  'image.sd15': {
    id: 'image.sd15',
    modality: 'image',
    family: 'sd15',
    generator: 'sdcpp',
    label: 'Stable Diffusion 1.5',
    style: 'clip_phrase_tags',
    order: ['subject', 'details', 'setting', 'lighting', 'art_style'],
    targetVerbosity: 'concise_medium',
    negativePromptSupported: true,
    loraSupported: true,
    embeddingsSupported: true,
    recommendedSettings: { width: 512, height: 512, steps: 20, cfg_scale: 7.0, sampler: 'euler_a' },
    defaultNegative: 'blurry, distorted, low quality, bad anatomy, deformed',
    guidance: 'Use shorter CLIP-friendly phrases and tags separated by commas. Do not convert SD1.5 prompts into long narrative essays. Supports negative prompt, weighting, and LoRA.',
    evidence: 'PROVEN in SDCPP secondary suite (v1-5-pruned-emaonly)',
  },

  // Audio: Kokoro Speech
  'voice.kokoro': {
    id: 'voice.kokoro',
    modality: 'voice',
    family: 'kokoro',
    generator: 'kokoro',
    label: 'Kokoro-82M TTS',
    style: 'exact_transcript',
    targetVerbosity: 'verbatim',
    negativePromptSupported: false,
    guidance: 'Spoken text is content. Do not rewrite transcript text. Only normalize punctuation if necessary for speech pacing.',
    evidence: 'PROVEN in DexDiffusion voice bridge',
  },

  // Audio: Qwen3-TTS Base Clone
  'voice.qwen_tts_base': {
    id: 'voice.qwen_tts_base',
    modality: 'voice',
    family: 'qwen_tts',
    generator: 'qwen-tts',
    label: 'Qwen3-TTS Base (Clone)',
    style: 'exact_transcript',
    targetVerbosity: 'verbatim',
    negativePromptSupported: false,
    guidance: 'Reference transcript is exact data. Target speech is user content. Never rewrite speech or reference text.',
    evidence: 'PROVEN in DexDiffusion voice bridge',
  },

  // Audio: Qwen VoiceDesign
  'voice.qwen_voicedesign': {
    id: 'voice.qwen_voicedesign',
    modality: 'voice',
    family: 'qwen_tts',
    generator: 'qwen-voicedesign',
    label: 'Qwen VoiceDesign',
    style: 'acoustic_voice_description',
    order: ['gender_age', 'register_timbre', 'texture_resonance', 'accent_dialect', 'pace_articulation', 'emotion_prosody'],
    targetVerbosity: 'concise_medium',
    negativePromptSupported: false,
    guidance: 'Enhance ONLY the voice description (timbre, register, resonance, accent, pace, emotional tone). Never alter the spoken text.',
    evidence: 'PROVEN in DexDiffusion voice bridge',
  },

  // Audio: ACE-Step 1.5 Music
  'music.ace_step': {
    id: 'music.ace_step',
    modality: 'music',
    family: 'ace_step',
    generator: 'ace-step',
    label: 'ACE-Step 1.5 Music',
    style: 'music_caption_and_lyrics',
    channels: ['caption', 'lyrics'],
    sectionTags: ['[Intro]', '[Verse]', '[Pre-Chorus]', '[Chorus]', '[Bridge]', '[Build]', '[Drop]', '[Breakdown]', '[Instrumental]', '[Outro]'],
    targetVerbosity: 'medium',
    negativePromptSupported: false,
    guidance: 'Maintain music caption and lyrics as separate channels. Caption specifies genre, tempo, instruments, arrangement, production, and mood. Lyrics are a temporal script with section tags; preserve lyric words verbatim unless explicit rewrite mode is requested.',
    evidence: 'PROVEN in DexDiffusion music bridge',
  },

  // Audio: Magenta RT Instrumental
  'music.magenta_rt': {
    id: 'music.magenta_rt',
    modality: 'music',
    family: 'magenta_rt',
    generator: 'magenta-rt',
    label: 'Magenta RealTime 2',
    style: 'compact_music_semantics',
    targetVerbosity: 'concise',
    negativePromptSupported: false,
    guidance: 'Use compact musical semantics: genre, instrumentation, tempo, and mood. Do not inject lyrics or section tags.',
    evidence: 'PROVEN in DexDiffusion music bridge',
  },

  // Video: LTX
  'video.ltx': {
    id: 'video.ltx',
    modality: 'video',
    family: 'ltx',
    generator: 'ltx',
    label: 'LTX Video',
    style: 'cinematic_motion_action',
    order: ['subject', 'motion_action', 'camera_movement', 'environment', 'lighting'],
    targetVerbosity: 'medium',
    negativePromptSupported: false,
    guidance: 'Prompt specifies continuous camera motion, subject kinematics, lighting shifts, and physical interaction over time. Generation backend is currently dormant.',
    evidence: 'DORMANT / UNWIRED in current architecture',
  },

  // Detailer: Face
  'detailer.face': {
    id: 'detailer.face',
    modality: 'detailer',
    family: 'apple_vision',
    generator: 'inpaint',
    label: 'Detailer · Face',
    style: 'targeted_face_restoration',
    defaultDeltaPrompt: 'preserve identity, pose and facial expression; improve anatomy, eyes, skin texture, mouth and fine facial detail',
    negativePromptSupported: true,
    guidance: 'Targeted inpainting for facial regions. Focus exclusively on facial fidelity, eye clarity, and skin texture while locking identity.',
    evidence: 'Native Apple Vision face detection + inpaint path',
  },

  // Detailer: Hand
  'detailer.hand': {
    id: 'detailer.hand',
    modality: 'detailer',
    family: 'apple_vision',
    generator: 'inpaint',
    label: 'Detailer · Hand',
    style: 'targeted_hand_anatomy',
    defaultDeltaPrompt: 'preserve hand pose, interaction and perspective; correct finger anatomy, joints, fingernails and natural skin folds',
    negativePromptSupported: true,
    guidance: 'Targeted inpainting for hands derived from pose landmarks. Corrects extra fingers, joint malformations, and anatomy.',
    evidence: 'Native Apple Vision hand pose derivation + inpaint path',
  },

  // Detailer: Person
  'detailer.person': {
    id: 'detailer.person',
    modality: 'detailer',
    family: 'apple_vision',
    generator: 'inpaint',
    label: 'Detailer · Person',
    style: 'targeted_person_enhancement',
    defaultDeltaPrompt: 'preserve person posture and clothing; improve fabric texture, edge definition, lighting coherence and overall anatomy',
    negativePromptSupported: true,
    guidance: 'Targeted inpainting for full human figure. Enhances garment texture, seams, and lighting integration.',
    evidence: 'Native Apple Vision person segmentation + inpaint path',
  }
};

/**
 * Resolves the appropriate prompt profile for a given context.
 * Uses exact model matches first, then falls back to model family, then generator default.
 */
function resolvePromptProfile({ modality = 'image', operation = 'txt2img', generatorId = '', modelIdentity = '', target = '' } = {}) {
  const normModel = String(modelIdentity || target || '').toLowerCase();
  const normGen = String(generatorId || '').toLowerCase();
  const normOp = String(operation || '').toLowerCase();
  const normMod = String(modality || '').toLowerCase();

  // 1. Detailer operations
  if (normOp === 'detail_face' || normOp === 'detailer_face') return PROFILES['detailer.face'];
  if (normOp === 'detail_hand' || normOp === 'detailer_hand') return PROFILES['detailer.hand'];
  if (normOp === 'detail_person' || normOp === 'detailer_person') return PROFILES['detailer.person'];

  // 2. Audio modalities
  if (normMod === 'voice' || normOp.includes('voice') || normGen.includes('voice')) {
    if (normOp.includes('design') || normGen.includes('voicedesign')) return PROFILES['voice.qwen_voicedesign'];
    if (normGen.includes('qwen') || normOp.includes('clone')) return PROFILES['voice.qwen_tts_base'];
    return PROFILES['voice.kokoro'];
  }
  if (normMod === 'music' || normGen.includes('music') || normOp.includes('music')) {
    if (normGen.includes('magenta') || normOp.includes('magenta')) return PROFILES['music.magenta_rt'];
    return PROFILES['music.ace_step'];
  }
  if (normMod === 'video' || normGen === 'ltx') {
    return PROFILES['video.ltx'];
  }

  // 3. Image models: exact model & family matching
  if (normModel.includes('flux2') || normModel.includes('klein') || normGen === 'mflux') {
    return PROFILES['image.flux2'];
  }
  if (normModel.includes('flux1') || normModel.includes('flux-') || normModel.includes('schnell')) {
    return PROFILES['image.flux1'];
  }
  if (normModel.includes('turbo')) {
    return PROFILES['image.sdxl_turbo'];
  }
  if (normModel.includes('pony') || normModel.includes('emberpony') || normModel.includes('camoosepony')) {
    return PROFILES['image.pony'];
  }
  if (normModel.includes('sd15') || normModel.includes('v1-5') || normModel.includes('homofidelis')) {
    return PROFILES['image.sd15'];
  }
  if (normModel.includes('sdxl') || normModel.includes('photonic') || normModel.includes('realvis') || normModel.includes('juggernaut') || normModel.includes('epicrealism') || normModel.includes('homochi') || normModel.includes('big_love') || normModel.includes('lustify') || normModel.includes('cyberrealistic') || normModel.includes('big_lust')) {
    return PROFILES['image.sdxl'];
  }

  // Fallback by generator
  if (normGen === 'mflux') return PROFILES['image.flux2'];
  return PROFILES['image.sdxl'];
}

module.exports = {
  PROFILES,
  resolvePromptProfile,
};
