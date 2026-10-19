// Truthful, short descriptions of Create/Edit settings, written against what the installed workers actually do.
// Pure data + a renderer so tests can lock the wording to the implementation (see tests/settings-help.test.js).
(function (root, factory) { if (typeof module === 'object' && module.exports) module.exports = factory(); else root.DexSettingsHelp = factory(); })(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const GROUPS = [
    { id: 'checkpoints', title: 'Checkpoints, LoRAs and VAE', items: [
      ['Model target', 'The checkpoint and backend that render the image. FLUX.2 Klein runs on MFLUX; Stable Diffusion models run on stable-diffusion.cpp. Only targets that have passed a real generation are marked proven.'],
      ['LoRA', 'Small add-on weights applied on top of a Stable Diffusion checkpoint. They must match the checkpoint family (SD1.5 vs SDXL). FLUX.2 Klein does not take LoRAs here.'],
      ['VAE', '"Default VAE" uses the VAE built into the checkpoint, which is what produced the proven results. Choose another only if it matches the checkpoint family; it replaces the decoder that turns the finished latent into pixels.'],
    ] },
    { id: 'sampling', title: 'Samplers and schedulers', items: [
      ['Sampler', 'The method that removes noise step by step. The list is limited to what the installed stable-diffusion.cpp accepts; FLUX.2 Klein uses its own fixed sampler and ignores this setting.'],
      ['Scheduler', 'Chooses how the noise levels are spaced across the steps (for example discrete or karras). Same availability as the sampler: Stable Diffusion models only.'],
      ['Steps / CFG', 'Steps is how many denoising passes run (more is slower, with diminishing returns). CFG is how strongly the prompt is enforced; very high values over-saturate.'],
      ['Seed', '-1 picks a random seed and the actual seed is recorded with the image. Reusing a seed with identical settings reproduces the same image.'],
    ] },
    { id: 'refinement', title: 'High-Res Refine', items: [
      ['High-Res Refine', 'A two-pass process done in pixel space: the base image is created and saved first, then enlarged on the MacBook with an ordinary resampler, then refined by an img2img pass at the new size. It is not the in-engine latent hand-off of other tools, and it is refused for FLUX.2 Klein (no img2img denoise path). If the refine pass fails, the saved base image stays.'],
      ['Denoise strength', 'How much the second pass may change the enlarged image: low keeps it close to the base, high repaints more.'],
    ] },
    { id: 'edit', title: 'Source preparation and scripts', items: [
      ['Source preparation', 'Reshapes the source image before an Edit run: Just resize (stretch), Crop and resize (cover then centre-crop) or Resize and fill (fit, then extend the edge pixels into the empty bands). It can resize to a size or by a factor and flattens transparency onto a chosen colour.'],
      ['Script operations', 'Multi-step edit recipes such as outpainting (extend the canvas, then repaint only the new area) and SD upscale (tile-wise enlarge and refine). Each step runs as a normal job and can be cancelled.'],
      ['Detailer', 'Finds a region (face, person, hand) with the on-device Apple Vision detector, then repaints only that region with an SD1.5 inpaint pass and blends it back. It needs the SD1.5 edit model; it does not use blur or sharpening.'],
    ] },
  ];
  const flat = () => GROUPS.flatMap(g => g.items.map(([name, text]) => ({ group: g.id, name, text })));
  return { GROUPS, flat };
});
