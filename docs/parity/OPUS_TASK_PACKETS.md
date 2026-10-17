# Engine-level parity blockers — task packets (2026-10-16)

These rows cannot be closed by UI or wiring work: the installed engines (stable-diffusion.cpp `sd-cli` rev `7f0e728` on Big Mac, MFLUX for FLUX.2 Klein 4B) do not implement the behaviour. Each packet is a self-contained design task. **None is authorised for implementation yet**: each needs a user decision because it changes or adds an inference engine on Big Mac (rebuilding sd.cpp, patching it, or adding a PyTorch sampler runtime). Until then the rows stay BLOCKED, and the UI shows the controls as unavailable with the reason. The server rejects them with that reason too.

Shared constraints for every packet:
- Metal only. No Docker, no cloud inference.
- The FLUX.2 Klein 4B MFLUX runtime and its venv are protected.
- Canonical images live only in `/Users/andrew/images_made`. Remote outputs are ephemeral.
- Prompt-saving defaults to OFF, so no prompt text may appear in logs.
- Any engine change ships as a separately named binary or runtime next to the current `sd-cli`, never replacing it, and is selected per target by `capabilities.js` only after a live proof.

## OP-1 Stepwise conditioning: prompt editing, alternation, AND (PR-11, PR-12, PR-13)
- **Need:** A1111's `prompt_parser.get_learned_conditioning_prompt_schedules` produces a per-step conditioning schedule. `[a:b:when]`, `[a|b]` and `AND` change the conditioning *inside* the sampling loop; with `AND`, several noise predictions are combined with weights.
- **Engine gap:** sd.cpp builds one conditioning per prompt for the whole run (its `parse_prompt_attention` handles weights and BREAK only).
- **Options:**
  - (a) Patch sd.cpp. Make the denoiser callback select the conditioning by step index (schedules), and for `AND` run one prediction per subprompt and take the weighted sum, as in `CFGDenoiser.combine_denoised`. Contribute the patch upstream.
  - (b) A PyTorch k-diffusion sampler process on Big Mac (MPS) for SD1.5/SDXL only.
- **Recommendation:** (a). It keeps one engine, and the step loop is in `denoiser.hpp` / `stable-diffusion.cpp sample()`.
- **Proof needed:** the parser output must match `prompt_parser.py` on a corpus. A live A/B must show that `[red:blue:0.5]` differs from both `red` and `blue` alone, deterministically.
- **Text replacement is not an acceptable substitute.**

## OP-2 Latent-noise compatibility: variation seed/strength, resize-from (SD-04…SD-10, SC-04 var axes)
- **Need:** A1111 `create_random_tensors` slerps the main-seed noise with subseed noise by `subseed_strength`. `seed_resize_from_w/h` generates noise at the old size and pastes it centred.
- **Engine gap:** sd-cli creates its noise internally from `--seed` and `--rng`.
- **Option:** add `--subseed`, `--subseed-strength` and `--seed-resize-from WxH` to sd.cpp, implementing the slerp in latent space on the same RNG stream (`cuda` RNG is sd-webui compatible per the sd.cpp docs).
- **Proof needed:**
  - subseed_strength 0 must give pixels identical to the plain seed;
  - strength 1 must equal the subseed run;
  - 0.5 must differ from both and be deterministic.

## OP-3 Sampler and noise knobs (SD-16…SD-29, GN-02 remaining samplers, GN-03 remaining schedulers, SC-09)
- **Gap:**
  - Samplers: LMS, DPM2 a, DPM++ SDE/2M SDE/3M SDE/2M SDE Heun, DPM fast/adaptive, DDIM, PLMS, UniPC, Restart.
  - Schedulers: Polyexponential, Beta, Align Your Steps.
  - Knobs: s_churn/tmin/tmax/noise, sigma min/max/rho, eta noise seed delta, initial/extra noise multipliers, SGM noise, discard penultimate sigma, NGMS/skip early cond, zero-terminal-SNR.
- **Option:** port the k-diffusion formulas into sd.cpp's `denoiser.hpp`. Each sampler must be validated against k-diffusion reference sigmas and steps on a fixed latent, with a numerical tolerance stated per sampler.
- **Risk:** large surface. Split it into one packet per sampler family.

## OP-4 Hires second pass and SDXL refiner (HR-08…HR-12, HR-14…HR-18, RS-17)
- **Need:**
  - A1111 runs the hires pass as a second sampling run with its own prompt, negative, checkpoint, sampler and scheduler.
  - The refiner swaps the UNet at a switch point measured in model timesteps, with `refiner_switch_by_sample_steps` for compatibility.
  - Base and final artifacts are both kept.
- **Engine gap:** sd-cli `--hires*` reuses first-pass settings and writes only the final image. `--high-noise-*` is Wan-style and not equivalent.
- **Option:** orchestrate two sd-cli invocations, a txt2img and then an img2img at the hires size.
  - This reproduces A1111 hires semantics only for *pixel-space* upscalers.
  - Latent upscalers need latent hand-off (an sd.cpp patch: dump and load latents).
  - The refiner needs a UNet swap mid-loop (an sd.cpp patch).
- **Proof needed:** base and final are recorded as two lineage-linked artifacts. The second pass must run the chosen sampler (log line) and prompt (hash only).

## OP-5 Masked latent modes and soft inpainting (IP-07 latent noise/nothing, IP-10, IP-13, ED-13, SC-23)
- **Need:**
  - latent noise and latent nothing initialise the masked latent;
  - inpainting_mask_weight scales the conditioning mask;
  - soft inpainting blends latents per step;
  - img2img alternative inverts the Euler noise.
- **Engine gap:** these all require access inside the sampling loop that sd-cli does not expose.
- **Option:** an sd.cpp patch adding a masked-latent init mode and a per-step latent blend hook.

## OP-6 ControlNet timing and multiple units (CN-05, CN-09)
- **Gap:** after the weights in `APPROVAL_PACKET_MODELS.md` are installed, `--control-net` and `--control-strength` work for SD1.5. Start/end fractions and multiple control units still need an sd.cpp patch: per-step gating of the control residuals, and a list of (model, image, strength) entries.

## OP-7 Safety-critical cancellation of shared sd-server paths (JO-02 remainder)
- **Gap:**
  - `batch-generate` and the legacy `/api/actions/xyz-plot` use the shared sd-server tunnel.
  - Their remote work cannot be stopped by run id, so Cancel reports the Big Mac side as **unverified**.
- **Design task:**
  - Tag each sd-server request with a request id.
  - Add a server-side abort, or route these paths through per-run sd-cli like controlled generation.
  - Hold the heavy lease until the stop is verified.
- No engine change is needed if those paths move to the per-run sd-cli path. **This one can be done without approval.**
